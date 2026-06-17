import VendorInvoice, { INVOICE_STATUS, INVOICE_VARIANCE_STATUS } from './vendorInvoice.model.js';
import IncomingQC, { QC_STATUS } from '../incoming-qc/incomingQc.model.js';
import VendorPurchaseOrder from '../purchase-order/purchaseOrder.model.js';
import ProformaInvoice from '../proforma-invoice/proformaInvoice.model.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Build authoritative invoice items from the QC (received/accepted/rejected) and
 * PO (rate/GST), merging the user-editable fields (invoiceQty/rate/gstRate/remarks)
 * from the submitted rows. invoiceQty is hard-capped at the accepted qty.
 * Returns the items plus the recomputed financial totals.
 */
const computeInvoiceItems = (qcItems = [], poItems = [], submitted = []) => {
  const sameSku = (a, b) => a && b && String(a).toUpperCase() === String(b).toUpperCase();
  const matchSub = (qi, idx) => submitted.find((s) =>
    sameSku(s.skuCode, qi.skuCode) || (s.itemName && qi.itemName && s.itemName === qi.itemName)) || submitted[idx] || {};
  const matchPo = (qi) => poItems.find((p) =>
    sameSku(p.skuCode, qi.skuCode) || (p.itemName && qi.itemName && p.itemName === qi.itemName)) || {};

  const items = qcItems.map((qi, idx) => {
    const s = matchSub(qi, idx);
    const po = matchPo(qi);
    const acceptedQty = round2(qi.acceptedQty);
    // No upper cap here — excess is governed by the remarks / override check below.
    let invoiceQty = s.invoiceQty != null ? round2(s.invoiceQty) : acceptedQty;
    invoiceQty = Math.max(0, invoiceQty);
    const rate = round2(s.rate != null ? s.rate : po.rate);
    const gstRate = round2(s.gstRate != null ? s.gstRate : po.gstRate);
    const taxableAmount = round2(invoiceQty * rate);
    const gstAmount = round2(taxableAmount * gstRate / 100);
    const varianceQty = round2(invoiceQty - acceptedQty);
    const varianceStatus = varianceQty === 0
      ? INVOICE_VARIANCE_STATUS.MATCHED
      : (varianceQty < 0 ? INVOICE_VARIANCE_STATUS.SHORT : INVOICE_VARIANCE_STATUS.EXCESS);
    return {
      skuId: qi.skuId || undefined, skuCode: qi.skuCode || '', itemName: qi.itemName || '', unit: qi.unit || 'Pcs',
      orderedQty: round2(po.quantity), grnReceivedQty: round2(qi.receivedQty),
      receivedQty: round2(qi.receivedQty), acceptedQty, rejectedQty: round2(qi.rejectedQty),
      invoiceQty, varianceQty, varianceStatus,
      rate, gstRate, taxableAmount, gstAmount,
      totalAmount: round2(taxableAmount + gstAmount),
      remarks: (s.remarks || '').trim(),
    };
  });
  return {
    items,
    totals: {
      taxableAmount: round2(items.reduce((a, i) => a + i.taxableAmount, 0)),
      gstAmount:     round2(items.reduce((a, i) => a + i.gstAmount, 0)),
      invoiceAmount: round2(items.reduce((a, i) => a + i.totalAmount, 0)),
    },
  };
};

// Invoice can only be raised once QC has passed (fully or partially).
const QC_INVOICEABLE = [QC_STATUS.PASSED, QC_STATUS.PARTIAL];

const normalizeDoc = (d) => (d?.fileUrl
  ? { fileName: d.fileName || '', fileUrl: d.fileUrl, fileType: d.fileType || '', uploadedAt: new Date() }
  : { fileName: '', fileUrl: '', fileType: '', uploadedAt: null });

const computeNetPayable = (inv) =>
  round2((inv.invoiceAmount || 0) - (inv.debitNoteAmount || 0) - (inv.advancePaid || 0));

// Block invoicing more than the QC-accepted qty unless the caller has override
// rights or has justified each excess line with remarks.
const assertExcessAllowed = (items, allowExcess) => {
  if (allowExcess) return;
  const offenders = items.filter((i) => i.varianceStatus === INVOICE_VARIANCE_STATUS.EXCESS && !i.remarks);
  if (offenders.length) {
    throw new AppError(
      `Invoice qty exceeds QC-accepted qty for: ${offenders.map((o) => o.itemName).join(', ')}. Add remarks for each excess item, or use override permission.`,
      400,
    );
  }
};

const findOrThrow = async (id) => {
  const inv = await VendorInvoice.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!inv) throw new AppError('Vendor invoice not found', 404);
  return inv;
};

export const vendorInvoiceService = {
  async create(data, user, opts = {}) {
    const qc = await IncomingQC.findOne({ _id: data.qcId, isDeleted: { $ne: true } });
    if (!qc) throw new AppError('Incoming QC not found', 404);

    // Rule 1: QC must be PASSED or PARTIAL (never PENDING/FAILED).
    if (!QC_INVOICEABLE.includes(qc.qcStatus)) {
      throw new AppError('Invoice can only be created after Incoming QC is PASSED or PARTIAL', 400);
    }
    const existing = await VendorInvoice.findOne({ qcId: qc._id, isDeleted: { $ne: true }, invoiceStatus: { $ne: INVOICE_STATUS.REJECTED } }).lean();
    if (existing) throw new AppError(`An invoice (${existing.invoiceNumber}) already exists for this QC`, 400);

    // Rule 2 & 6: pull advance paid from the PI for net-payable adjustment.
    let advancePaid = 0;
    if (qc.piId) {
      const pi = await ProformaInvoice.findById(qc.piId).select('paidAmount').lean();
      advancePaid = round2(pi?.paidAmount || 0);
    }

    // Recompute items + totals authoritatively from the QC quantities + PO rates.
    let items = [];
    let itemTotals = null;
    if (qc.items?.length) {
      const po = qc.poId ? await VendorPurchaseOrder.findById(qc.poId).select('items').lean() : null;
      const r = computeInvoiceItems(qc.items, po?.items || [], data.items || []);
      items = r.items;
      itemTotals = r.totals;
      if (!items.some((it) => it.invoiceQty > 0)) {
        throw new AppError('Enter an invoice quantity on at least one item', 400);
      }
      assertExcessAllowed(items, opts.allowExcess);
    }

    const doc = normalizeDoc(data.invoiceDocument);
    const debitDoc = normalizeDoc(data.debitNoteDocument);
    const base = {
      invoiceAmount: itemTotals ? itemTotals.invoiceAmount : round2(data.invoiceAmount),
      debitNoteAmount: data.debitNoteRequired ? round2(data.debitNoteAmount) : 0,
      advancePaid,
    };
    const netPayableAmount = computeNetPayable(base);

    const inv = await VendorInvoice.create({
      invoiceNumber: data.invoiceNumber,
      invoiceDate: data.invoiceDate || null,
      invoiceReceivedDate: data.invoiceReceivedDate || new Date(),
      qcId: qc._id, qcNumber: qc.qcNumber,
      grnId: qc.grnId, grnNumber: qc.grnNumber,
      poId: qc.poId, poNumber: qc.poNumber,
      piId: qc.piId, piNumber: qc.piNumber,
      vendorId: qc.vendorId, vendorName: qc.vendorName,
      items,
      invoiceAmount: base.invoiceAmount,
      taxableAmount: itemTotals ? itemTotals.taxableAmount : round2(data.taxableAmount),
      gstAmount: itemTotals ? itemTotals.gstAmount : round2(data.gstAmount),
      tdsAmount: round2(data.tdsAmount),
      otherCharges: round2(data.otherCharges),
      advancePaid,
      netPayableAmount,
      invoiceDocument: doc,
      debitNoteRequired: !!data.debitNoteRequired,
      debitNoteNumber: data.debitNoteNumber || '',
      debitNoteAmount: base.debitNoteAmount,
      debitNoteReason: data.debitNoteReason || '',
      debitNoteDocument: debitDoc,
      invoiceStatus: doc.fileUrl ? INVOICE_STATUS.RECEIVED : INVOICE_STATUS.DRAFT,
      remarks: data.remarks || '',
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `Invoice created from ${qc.qcNumber}`, actorId: user?._id }],
    });
    return inv;
  },

  async getAll(query) {
    const features = new ApiFeatures(VendorInvoice.find({ isDeleted: { $ne: true } }), query)
      .filter().search(['invoiceNumber', 'poNumber', 'grnNumber', 'vendorName'])
      .sort().select().paginate();
    return features.exec();
  },

  async getById(id) {
    const inv = await VendorInvoice.findOne({ _id: id, isDeleted: { $ne: true } }).populate('createdBy', 'name').lean();
    if (!inv) throw new AppError('Vendor invoice not found', 404);
    return inv;
  },

  async getByQc(qcId) {
    return VendorInvoice.find({ qcId, isDeleted: { $ne: true } }).sort('-createdAt').lean();
  },

  async getStats() {
    const rows = await VendorInvoice.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          total:            { $sum: 1 },
          pendingApproval:  { $sum: { $cond: [{ $in: ['$invoiceStatus', [INVOICE_STATUS.DRAFT, INVOICE_STATUS.RECEIVED]] }, 1, 0] } },
          approved:         { $sum: { $cond: [{ $in: ['$invoiceStatus', [INVOICE_STATUS.APPROVED, INVOICE_STATUS.PAYMENT_PENDING, INVOICE_STATUS.PAYMENT_COMPLETED]] }, 1, 0] } },
          paymentPending:   { $sum: { $cond: [{ $eq: ['$invoiceStatus', INVOICE_STATUS.PAYMENT_PENDING] }, 1, 0] } },
          paymentCompleted: { $sum: { $cond: [{ $eq: ['$invoiceStatus', INVOICE_STATUS.PAYMENT_COMPLETED] }, 1, 0] } },
          netPayable:       { $sum: '$netPayableAmount' },
        },
      },
    ]);
    return rows[0] || { total: 0, pendingApproval: 0, approved: 0, paymentPending: 0, paymentCompleted: 0, netPayable: 0 };
  },

  async update(id, data, user, opts = {}) {
    const inv = await findOrThrow(id);
    if (![INVOICE_STATUS.DRAFT, INVOICE_STATUS.RECEIVED].includes(inv.invoiceStatus)) {
      throw new AppError('Only draft / received invoices can be edited', 400);
    }
    const { invoiceDocument, debitNoteDocument, items: submittedItems, ...rest } = data;
    Object.assign(inv, rest);

    // When items are supplied, re-derive items + amounts from QC + PO (authoritative).
    if (Array.isArray(submittedItems)) {
      const qc = await IncomingQC.findById(inv.qcId).select('items poId').lean();
      if (qc?.items?.length) {
        const po = inv.poId ? await VendorPurchaseOrder.findById(inv.poId).select('items').lean() : null;
        const r = computeInvoiceItems(qc.items, po?.items || [], submittedItems);
        assertExcessAllowed(r.items, opts.allowExcess);
        inv.items = r.items;
        inv.invoiceAmount = r.totals.invoiceAmount;
        inv.taxableAmount = r.totals.taxableAmount;
        inv.gstAmount = r.totals.gstAmount;
      }
    }

    if (invoiceDocument) inv.invoiceDocument = normalizeDoc(invoiceDocument);
    if (debitNoteDocument) inv.debitNoteDocument = normalizeDoc(debitNoteDocument);
    if (!inv.debitNoteRequired) inv.debitNoteAmount = 0;
    inv.netPayableAmount = computeNetPayable(inv);
    if (inv.invoiceDocument?.fileUrl && inv.invoiceStatus === INVOICE_STATUS.DRAFT) inv.invoiceStatus = INVOICE_STATUS.RECEIVED;
    inv.updatedBy = user?._id;
    inv.activityTimeline.push({ action: 'UPDATE', description: 'Invoice updated', actorId: user?._id });
    return inv.save();
  },

  // Rule 3 & 6 & 7: document mandatory; approval → PAYMENT_PENDING.
  async approve(id, data, user) {
    const inv = await findOrThrow(id);
    if ([INVOICE_STATUS.PAYMENT_PENDING, INVOICE_STATUS.PAYMENT_COMPLETED, INVOICE_STATUS.APPROVED].includes(inv.invoiceStatus)) {
      throw new AppError('Invoice is already approved', 400);
    }
    if (inv.invoiceStatus === INVOICE_STATUS.REJECTED) throw new AppError('Cannot approve a rejected invoice', 400);
    if (!inv.invoiceDocument?.fileUrl) throw new AppError('Upload the invoice document before approving', 400);

    inv.invoiceStatus = INVOICE_STATUS.PAYMENT_PENDING;
    inv.approvedBy = user?.name || '';
    inv.approvedById = user?._id;
    inv.approvedAt = new Date();
    inv.approvalRemarks = data.remarks || '';
    inv.updatedBy = user?._id;
    inv.activityTimeline.push({ action: 'APPROVE', description: 'Invoice approved — payment pending', actorId: user?._id });
    return inv.save();
  },

  async reject(id, data, user) {
    const inv = await findOrThrow(id);
    if ([INVOICE_STATUS.PAYMENT_PENDING, INVOICE_STATUS.PAYMENT_COMPLETED].includes(inv.invoiceStatus)) {
      throw new AppError('Cannot reject an approved invoice', 400);
    }
    inv.invoiceStatus = INVOICE_STATUS.REJECTED;
    inv.rejectedBy = user?.name || '';
    inv.rejectedAt = new Date();
    inv.rejectionRemarks = data.remarks || '';
    inv.updatedBy = user?._id;
    inv.activityTimeline.push({ action: 'REJECT', description: 'Invoice rejected', actorId: user?._id });
    return inv.save();
  },
};
