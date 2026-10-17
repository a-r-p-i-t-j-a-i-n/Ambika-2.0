import VendorInvoice, { INVOICE_STATUS, INVOICE_VARIANCE_STATUS } from './vendorInvoice.model.js';
import { getAdvancePosition, withPiAdvanceLock } from './piAdvance.js';
import IncomingQC, { QC_STATUS } from '../incoming-qc/incomingQc.model.js';
import VendorPurchaseOrder from '../purchase-order/purchaseOrder.model.js';
import ProformaInvoice from '../proforma-invoice/proformaInvoice.model.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
export { getAdvancePosition }; // re-exported for the controller / existing imports

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const sameSku = (a, b) => a && b && String(a).toUpperCase() === String(b).toUpperCase();
const itemKey = (qcId, skuCode, itemName) => `${String(qcId)}|${String(skuCode || itemName || '').toUpperCase()}`;

/**
 * Sum already-invoiced qty per (qcId, sku) across existing non-rejected invoices.
 * Considers both the per-item source qcId (multi-GRN) and the legacy header qcId.
 * Optionally excludes one invoice (when recomputing during an edit).
 */
const invoicedQtyMap = async (qcIds, excludeInvoiceId) => {
  const filter = {
    isDeleted: { $ne: true },
    invoiceStatus: { $ne: INVOICE_STATUS.REJECTED },
    $or: [{ qcId: { $in: qcIds } }, { qcIds: { $in: qcIds } }, { 'items.qcId': { $in: qcIds } }],
  };
  if (excludeInvoiceId) filter._id = { $ne: excludeInvoiceId };
  const invoices = await VendorInvoice.find(filter).select('qcId items').lean();
  const map = {};
  for (const inv of invoices) {
    for (const it of inv.items || []) {
      const qid = it.qcId || inv.qcId; // per-item source, else legacy header
      if (!qid) continue;
      const k = itemKey(qid, it.skuCode, it.itemName);
      map[k] = round2((map[k] || 0) + (Number(it.invoiceQty) || 0));
    }
  }
  return map;
};

/**
 * Build authoritative invoice items across one or more QCs (received/accepted from
 * the QC, rate/GST from the PO), merging user-editable fields from submitted rows
 * (matched by source qcId + sku). Tracks already-invoiced and pending per line.
 */
const buildInvoiceItems = (qcs = [], poItems = [], submitted = [], invoicedMap = {}) => {
  const matchPo = (qi) => poItems.find((p) =>
    sameSku(p.skuCode, qi.skuCode) || (p.itemName && qi.itemName && p.itemName === qi.itemName)) || {};
  const matchSub = (qcId, qi) => submitted.find((s) =>
    String(s.qcId || s.sourceQcId || '') === String(qcId)
    && (sameSku(s.skuCode, qi.skuCode) || (s.itemName && qi.itemName && s.itemName === qi.itemName))) || {};

  const items = [];
  for (const qc of qcs) {
    for (const qi of qc.items || []) {
      const s = matchSub(qc._id, qi);
      const po = matchPo(qi);
      const acceptedQty = round2(qi.acceptedQty);
      const alreadyInvoicedQty = round2(invoicedMap[itemKey(qc._id, qi.skuCode, qi.itemName)] || 0);
      const pendingInvoiceQty = Math.max(0, round2(acceptedQty - alreadyInvoicedQty));
      let invoiceQty = s.invoiceQty != null ? round2(s.invoiceQty) : pendingInvoiceQty;
      invoiceQty = Math.max(0, invoiceQty);
      const rate = round2(s.rate != null ? s.rate : po.rate);
      const gstRate = round2(s.gstRate != null ? s.gstRate : po.gstRate);
      const taxableAmount = round2(invoiceQty * rate);
      const gstAmount = round2(taxableAmount * gstRate / 100);
      const varianceQty = round2(invoiceQty - acceptedQty);
      const varianceStatus = varianceQty === 0
        ? INVOICE_VARIANCE_STATUS.MATCHED
        : (varianceQty < 0 ? INVOICE_VARIANCE_STATUS.SHORT : INVOICE_VARIANCE_STATUS.EXCESS);
      items.push({
        grnId: qc.grnId || undefined, grnNumber: qc.grnNumber || '',
        qcId: qc._id, qcNumber: qc.qcNumber || '',
        skuId: qi.skuId || undefined, skuCode: qi.skuCode || '', itemName: qi.itemName || '', unit: qi.unit || 'Pcs',
        orderedQty: round2(po.quantity), grnReceivedQty: round2(qi.receivedQty),
        receivedQty: round2(qi.receivedQty), acceptedQty, rejectedQty: round2(qi.rejectedQty),
        alreadyInvoicedQty, pendingInvoiceQty,
        invoiceQty, varianceQty, varianceStatus,
        rate, gstRate, taxableAmount, gstAmount,
        totalAmount: round2(taxableAmount + gstAmount),
        remarks: (s.remarks || '').trim(),
      });
    }
  }
  return {
    items,
    totals: {
      taxableAmount: round2(items.reduce((a, i) => a + i.taxableAmount, 0)),
      gstAmount:     round2(items.reduce((a, i) => a + i.gstAmount, 0)),
      invoiceAmount: round2(items.reduce((a, i) => a + i.totalAmount, 0)),
    },
  };
};

// Block invoicing more than the remaining (pending) accepted qty unless overridden
// or each excess line is justified with remarks.
const assertWithinPending = (items, allowExcess) => {
  if (allowExcess) return;
  const offenders = items.filter((i) => round2(i.invoiceQty) > round2(i.pendingInvoiceQty) && !i.remarks);
  if (offenders.length) {
    throw new AppError(
      `Invoice qty exceeds remaining accepted (pending) qty for: ${offenders.map((o) => o.itemName).join(', ')}. Reduce the qty, add remarks, or use override permission.`,
      400,
    );
  }
};

// Invoice can only be raised once QC has passed (fully or partially).
const QC_INVOICEABLE = [QC_STATUS.PASSED, QC_STATUS.PARTIAL];

const normalizeDoc = (d) => (d?.fileUrl
  ? { fileName: d.fileName || '', fileUrl: d.fileUrl, fileType: d.fileType || '', uploadedAt: new Date() }
  : { fileName: '', fileUrl: '', fileType: '', uploadedAt: null });

const computeNetPayable = (inv) =>
  round2((inv.invoiceAmount || 0) - (inv.debitNoteAmount || 0) - (inv.advancePaid || 0));

const uniq = (arr) => [...new Set(arr.filter(Boolean).map(String))];

/** Allocate what is available, but never more than the invoice's payable basis. */
const allocateAdvance = (available, invoiceAmount, debitNoteAmount) =>
  Math.max(0, Math.min(round2(available), round2((invoiceAmount || 0) - (debitNoteAmount || 0))));

// Validate a set of QCs can be invoiced together (same vendor, same PO, QC passed).
const loadAndValidateQcs = async (qcIdList) => {
  const qcs = await IncomingQC.find({ _id: { $in: qcIdList }, isDeleted: { $ne: true } }).lean();
  if (qcs.length !== qcIdList.length) throw new AppError('One or more selected QCs were not found', 404);
  for (const qc of qcs) {
    if (!QC_INVOICEABLE.includes(qc.qcStatus)) {
      throw new AppError(`QC ${qc.qcNumber} is not invoiceable — Incoming QC must be PASSED or PARTIAL`, 400);
    }
    // A GRN raised without a PO (W/O PO) has no PO rate/GST for an invoice line
    // to be priced against — explicitly refused rather than silently invoicing
    // at ₹0. uniq() below drops falsy poIds, so this would otherwise slip past
    // the "same PO" check entirely instead of being caught.
    if (qc.grnId && !qc.poId) {
      throw new AppError(`QC ${qc.qcNumber} was raised from a GRN with no Purchase Order (W/O PO) — Vendor Invoice is not yet supported for GRNs without a PO`, 400);
    }
  }
  const vendorIds = uniq(qcs.map((q) => q.vendorId));
  if (vendorIds.length > 1) throw new AppError('All selected GRNs/QCs must belong to the same vendor', 400);
  const poIds = uniq(qcs.map((q) => q.poId));
  if (poIds.length > 1) throw new AppError('All selected GRNs/QCs must belong to the same PO', 400);
  return qcs;
};

const findOrThrow = async (id) => {
  const inv = await VendorInvoice.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!inv) throw new AppError('Vendor invoice not found', 404);
  return inv;
};

export const vendorInvoiceService = {
  async create(data, user, opts = {}) {
    // Accept one QC (legacy) or many (multi-GRN). All must share vendor + PO.
    const qcIdList = uniq(data.qcIds?.length ? data.qcIds : (data.qcId ? [data.qcId] : []));
    if (!qcIdList.length) throw new AppError('Select at least one QC / GRN', 400);
    const qcs = await loadAndValidateQcs(qcIdList);
    const first = qcs[0];
    // The PI advance is allocated under the per-PI lock: read what is still
    // unallocated, take this invoice's share, and persist it before releasing.
    return withPiAdvanceLock(first.piId, () => this._createLocked(data, user, opts, qcs));
  },

  async _createLocked(data, user, opts, qcs) {
    const first = qcs[0];

    // Recompute items + totals authoritatively from QC quantities + PO rates,
    // accounting for what's already been invoiced on prior invoices.
    const po = first.poId ? await VendorPurchaseOrder.findById(first.poId).select('items').lean() : null;
    const invoicedMap = await invoicedQtyMap(qcs.map((q) => q._id));
    const { items, totals: itemTotals } = buildInvoiceItems(qcs, po?.items || [], data.items || [], invoicedMap);
    if (!items.length) throw new AppError('Selected QCs have no items to invoice', 400);
    if (!items.some((it) => it.invoiceQty > 0)) throw new AppError('Enter an invoice quantity on at least one item', 400);
    assertWithinPending(items, opts.allowExcess);

    const grnIds = uniq(qcs.map((q) => q.grnId));
    const grnNumbers = uniq(qcs.map((q) => q.grnNumber));

    const doc = normalizeDoc(data.invoiceDocument);
    const debitDoc = normalizeDoc(data.debitNoteDocument);
    // Rule 2 & 6: deduct only the PI advance not yet allocated to other invoices.
    const invoiceAmount = itemTotals.invoiceAmount;
    const debitNoteAmount = data.debitNoteRequired ? round2(data.debitNoteAmount) : 0;
    const { advanceAvailable } = await getAdvancePosition(first.piId);
    const advancePaid = allocateAdvance(advanceAvailable, invoiceAmount, debitNoteAmount);
    const base = { invoiceAmount, debitNoteAmount, advancePaid };
    const netPayableAmount = computeNetPayable(base);

    const inv = await VendorInvoice.create({
      invoiceNumber: data.invoiceNumber,
      invoiceDate: data.invoiceDate || null,
      invoiceReceivedDate: data.invoiceReceivedDate || new Date(),
      // Legacy single refs = first selected QC/GRN (back-compat).
      qcId: first._id, qcNumber: first.qcNumber,
      grnId: first.grnId, grnNumber: first.grnNumber,
      // Multi-GRN arrays.
      qcIds: qcs.map((q) => q._id), qcNumbers: uniq(qcs.map((q) => q.qcNumber)),
      grnIds, grnNumbers,
      poId: first.poId, poNumber: first.poNumber,
      piId: first.piId, piNumber: first.piNumber,
      vendorId: first.vendorId, vendorName: first.vendorName,
      items,
      invoiceAmount: base.invoiceAmount,
      taxableAmount: itemTotals.taxableAmount,
      gstAmount: itemTotals.gstAmount,
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
      activityTimeline: [{ action: 'CREATE', description: `Invoice created from ${uniq(qcs.map((q) => q.qcNumber)).join(', ')}`, actorId: user?._id }],
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
    return VendorInvoice.find({ $or: [{ qcId }, { qcIds: qcId }], isDeleted: { $ne: true } }).sort('-createdAt').lean();
  },

  /**
   * QCs that can still be invoiced — PASSED/PARTIAL material QCs with remaining
   * (uninvoiced) accepted qty. Optional vendorId/poId filters for multi-GRN
   * selection (one invoice = same vendor + same PO).
   */
  async getInvoiceableQcs(query = {}) {
    const filter = {
      isDeleted: { $ne: true },
      qcStatus: { $in: QC_INVOICEABLE },
      grnId: { $ne: null }, // material QCs only (service QCs have no GRN/PO)
      // Excludes QCs sourced from a W/O PO GRN — see loadAndValidateQcs for why
      // Vendor Invoice does not yet support a GRN with no PO.
      poId: { $ne: null },
    };
    if (query.vendorId) filter.vendorId = query.vendorId;
    if (query.poId) filter.poId = query.poId;
    const qcs = await IncomingQC.find(filter).sort('-createdAt').limit(300).lean();
    const invoicedMap = await invoicedQtyMap(qcs.map((q) => q._id));

    // Batch-load PO items (rate/GST/ordered qty) for the distinct POs.
    const poIds = uniq(qcs.map((q) => q.poId));
    const pos = poIds.length ? await VendorPurchaseOrder.find({ _id: { $in: poIds } }).select('items').lean() : [];
    const poItemsById = Object.fromEntries(pos.map((p) => [String(p._id), p.items || []]));
    const matchPo = (poItems, qi) => poItems.find((p) =>
      sameSku(p.skuCode, qi.skuCode) || (p.itemName && qi.itemName && p.itemName === qi.itemName)) || {};

    return qcs.map((qc) => {
      const poItems = poItemsById[String(qc.poId)] || [];
      let totalAccepted = 0; let totalPending = 0;
      const items = (qc.items || []).map((it) => {
        const po = matchPo(poItems, it);
        const accepted = round2(it.acceptedQty);
        const already = round2(invoicedMap[itemKey(qc._id, it.skuCode, it.itemName)] || 0);
        const pending = Math.max(0, round2(accepted - already));
        totalAccepted += accepted; totalPending += pending;
        return {
          skuId: it.skuId, skuCode: it.skuCode || '', itemName: it.itemName || '', unit: it.unit || 'Pcs',
          orderedQty: round2(po.quantity), grnReceivedQty: round2(it.receivedQty), receivedQty: round2(it.receivedQty),
          acceptedQty: accepted, rejectedQty: round2(it.rejectedQty),
          alreadyInvoicedQty: already, pendingInvoiceQty: pending,
          rate: round2(po.rate), gstRate: round2(po.gstRate),
        };
      });
      return {
        _id: qc._id, qcNumber: qc.qcNumber, grnId: qc.grnId, grnNumber: qc.grnNumber,
        poId: qc.poId, poNumber: qc.poNumber, piId: qc.piId, piNumber: qc.piNumber,
        vendorId: qc.vendorId, vendorName: qc.vendorName, qcStatus: qc.qcStatus, overallResult: qc.overallResult,
        totalAccepted: round2(totalAccepted), totalPendingInvoiceQty: round2(totalPending),
        items,
      };
    }).filter((q) => q.totalPendingInvoiceQty > 0); // hide fully-invoiced
  },

  /**
   * GRNs that can still be invoiced — a GRN-centric view of getInvoiceableQcs.
   * Users identify documents by GRN, not QC, so the invoice form selects GRNs and
   * the system auto-links each GRN's QC. Each entry keeps `_id` = the linked qcId
   * so the existing selection / create machinery (which submits qcIds[]) is
   * unchanged. Only GRNs whose QC is PASSED/PARTIAL with remaining pending qty
   * appear (fully-invoiced GRNs are already filtered out upstream).
   */
  async getInvoiceableGrns(query = {}) {
    const qcs = await this.getInvoiceableQcs(query);
    return qcs
      .filter((q) => q.grnId) // GRN-backed material QCs only
      .map((q) => ({
        _id: q._id, // = qcId — keeps the qcIds[] create payload working unchanged
        grnId: q.grnId, grnNumber: q.grnNumber,
        qcId: q._id, qcNumber: q.qcNumber,
        poId: q.poId, poNumber: q.poNumber,
        piId: q.piId, piNumber: q.piNumber,
        vendorId: q.vendorId, vendorName: q.vendorName,
        qcStatus: q.qcStatus, overallResult: q.overallResult,
        totalAccepted: q.totalAccepted,
        pendingInvoiceQty: q.totalPendingInvoiceQty,
        totalPendingInvoiceQty: q.totalPendingInvoiceQty, // alias for shared rows builder
        items: q.items,
      }));
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
    const existing = await findOrThrow(id);
    return withPiAdvanceLock(existing.piId, () => this._updateLocked(id, data, user, opts));
  },

  async _updateLocked(id, data, user, opts) {
    const inv = await findOrThrow(id); // re-read under the PI lock
    const EDITABLE_STATUSES = [INVOICE_STATUS.DRAFT, INVOICE_STATUS.RECEIVED, INVOICE_STATUS.APPROVED, INVOICE_STATUS.PAYMENT_PENDING];
    if (!EDITABLE_STATUSES.includes(inv.invoiceStatus)) {
      throw new AppError('Invoice cannot be edited after payment is completed or when rejected', 400);
    }
    const { invoiceDocument, debitNoteDocument, items: submittedItems, ...rest } = data;
    Object.assign(inv, rest);

    // When items are supplied, re-derive items + amounts from the invoice's QCs +
    // PO (authoritative), excluding THIS invoice from the already-invoiced tally.
    if (Array.isArray(submittedItems)) {
      const qcIdList = uniq(inv.qcIds?.length ? inv.qcIds : (inv.qcId ? [inv.qcId] : []));
      const qcs = await IncomingQC.find({ _id: { $in: qcIdList }, isDeleted: { $ne: true } }).lean();
      if (qcs.some((q) => q.items?.length)) {
        const po = inv.poId ? await VendorPurchaseOrder.findById(inv.poId).select('items').lean() : null;
        const invoicedMap = await invoicedQtyMap(qcIdList, inv._id);
        const r = buildInvoiceItems(qcs, po?.items || [], submittedItems, invoicedMap);
        assertWithinPending(r.items, opts.allowExcess);
        inv.items = r.items;
        inv.invoiceAmount = r.totals.invoiceAmount;
        inv.taxableAmount = r.totals.taxableAmount;
        inv.gstAmount = r.totals.gstAmount;
      }
    }

    if (invoiceDocument) inv.invoiceDocument = normalizeDoc(invoiceDocument);
    if (debitNoteDocument) inv.debitNoteDocument = normalizeDoc(debitNoteDocument);
    if (!inv.debitNoteRequired) inv.debitNoteAmount = 0;
    // Re-allocate this invoice's advance share: what other live invoices on the
    // PI hold is excluded from "available", so its own previous share is never
    // counted twice.
    // Once a voucher has been raised it carries its own copy of the advance, so
    // the share is frozen (capped only so it never exceeds the payable basis).
    if (inv.voucherId) {
      inv.advancePaid = Math.min(round2(inv.advancePaid), Math.max(0, round2(inv.invoiceAmount - inv.debitNoteAmount)));
    } else {
      const { advanceAvailable } = await getAdvancePosition(inv.piId, inv._id);
      inv.advancePaid = allocateAdvance(advanceAvailable, inv.invoiceAmount, inv.debitNoteAmount);
    }
    inv.netPayableAmount = computeNetPayable(inv);
    if (inv.invoiceDocument?.fileUrl && inv.invoiceStatus === INVOICE_STATUS.DRAFT) inv.invoiceStatus = INVOICE_STATUS.RECEIVED;
    inv.updatedBy = user?._id;
    inv.activityTimeline.push({ action: 'UPDATE', description: 'Invoice updated', actorId: user?._id });
    return inv.save();
  },

  async remove(id, user) {
    const inv = await findOrThrow(id);
    if (inv.invoiceStatus !== INVOICE_STATUS.DRAFT) {
      throw new AppError('Only draft vendor invoices can be deleted', 400);
    }
    inv.isDeleted = true;
    inv.deletedAt = new Date();
    inv.deletedBy = user?._id;
    inv.activityTimeline.push({ action: 'DELETE', description: 'Vendor invoice deleted', actorId: user?._id });
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
