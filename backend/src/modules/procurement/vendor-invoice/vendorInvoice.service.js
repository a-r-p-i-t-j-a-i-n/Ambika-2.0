import VendorInvoice, { INVOICE_STATUS } from './vendorInvoice.model.js';
import IncomingQC, { QC_STATUS } from '../incoming-qc/incomingQc.model.js';
import ProformaInvoice from '../proforma-invoice/proformaInvoice.model.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Invoice can only be raised once QC has passed (fully or partially).
const QC_INVOICEABLE = [QC_STATUS.PASSED, QC_STATUS.PARTIAL];

const normalizeDoc = (d) => (d?.fileUrl
  ? { fileName: d.fileName || '', fileUrl: d.fileUrl, fileType: d.fileType || '', uploadedAt: new Date() }
  : { fileName: '', fileUrl: '', fileType: '', uploadedAt: null });

const computeNetPayable = (inv) =>
  round2((inv.invoiceAmount || 0) - (inv.debitNoteAmount || 0) - (inv.advancePaid || 0));

const findOrThrow = async (id) => {
  const inv = await VendorInvoice.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!inv) throw new AppError('Vendor invoice not found', 404);
  return inv;
};

export const vendorInvoiceService = {
  async create(data, user) {
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

    const doc = normalizeDoc(data.invoiceDocument);
    const debitDoc = normalizeDoc(data.debitNoteDocument);
    const base = {
      invoiceAmount: round2(data.invoiceAmount),
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
      invoiceAmount: base.invoiceAmount,
      taxableAmount: round2(data.taxableAmount),
      gstAmount: round2(data.gstAmount),
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

  async update(id, data, user) {
    const inv = await findOrThrow(id);
    if (![INVOICE_STATUS.DRAFT, INVOICE_STATUS.RECEIVED].includes(inv.invoiceStatus)) {
      throw new AppError('Only draft / received invoices can be edited', 400);
    }
    const { invoiceDocument, debitNoteDocument, ...rest } = data;
    Object.assign(inv, rest);
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
