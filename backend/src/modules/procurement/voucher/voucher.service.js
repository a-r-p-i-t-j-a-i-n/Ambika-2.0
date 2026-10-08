import fs from 'fs';
import path from 'path';
import VendorVoucher, { VOUCHER_STATUS, VOUCHER_TYPE } from './voucher.model.js';
import VendorInvoice, { INVOICE_STATUS } from '../vendor-invoice/vendorInvoice.model.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { generatePurchaseVoucherNumber, generateExpenseVoucherNumber } from '../../../utils/docNumberGenerator.js';
import { s3Enabled, buildKey, uploadBuffer } from '../../../common/uploads/s3.service.js';
import { buildVoucherPdfBuffer } from './voucher.pdf.js';
import { logger } from '../../../utils/logger.js';
import { registerApprovalDocument } from '../../approvals/approval.registry.js';
import { approvalService } from '../../approvals/approval.service.js';

const SERVER_BASE = (process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Expense total: basic + freight + packing + other + tax + TCS − TDS − advance.
const computeExpenseTotal = (d = {}) => round2(
  round2(d.basicValue) + round2(d.freightCharges) + round2(d.packingForwardingCharges)
  + round2(d.otherCharges) + round2(d.taxAmount) + round2(d.tcsAmount)
  - round2(d.tdsAmount) - round2(d.advanceAmount),
);

const findOrThrow = async (id) => {
  const v = await VendorVoucher.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!v) throw new AppError('Voucher not found', 404);
  return v;
};

/** Resolve the company profile once, for the approval engine's PDF adapter. */
const resolveCompanyForApproval = async () => {
  try {
    const CompanySettings = (await import('../../pricing/company-settings.model.js')).default;
    const s = await CompanySettings.findOne().lean();
    if (s) return { name: s.companyName, address: s.companyAddress, gstin: s.companyGstin, phone: s.companyPhone, email: s.companyEmail };
  } catch { /* env fallback */ }
  return {};
};

// Wire Voucher into the generic Digital Approval & Signature engine (see
// modules/approvals) — the engine calls back into this adapter, it never
// contains Voucher-specific logic itself.
registerApprovalDocument('VOUCHER', {
  model: VendorVoucher,
  numberField: 'voucherNumber',
  mirrorStatusField: 'approvalStatus',
  pdfUrlField: 'voucherPdfUrl',
  pdfFileNameField: 'voucherPdfFileName',
  uploadFolder: 'vouchers',
  buildPdfBuffer: async (v, opts) => {
    const company = await resolveCompanyForApproval();
    const doc = await withGrnRefs(typeof v?.toObject === 'function' ? v.toObject() : { ...v });
    return buildVoucherPdfBuffer(doc, company, opts?.signature || null);
  },
});

/** All GRN / QC references of a (multi-GRN) vendor invoice, legacy single refs as fallback. */
const invoiceGrnRefs = (inv) => {
  const lineGrnNumbers = [...new Set((inv.items || []).map((it) => it.grnNumber).filter(Boolean))];
  return {
    grnIds: inv.grnIds?.length ? inv.grnIds : (inv.grnId ? [inv.grnId] : []),
    grnNumbers: inv.grnNumbers?.length ? inv.grnNumbers : (lineGrnNumbers.length ? lineGrnNumbers : (inv.grnNumber ? [inv.grnNumber] : [])),
    qcIds: inv.qcIds?.length ? inv.qcIds : (inv.qcId ? [inv.qcId] : []),
  };
};

/**
 * Vouchers created before multi-GRN references were stored only carry the first
 * grnId — read the full list from their invoice (read-time, nothing is written).
 */
const withGrnRefs = async (v) => {
  if (v?.grnNumbers?.length || !v?.invoiceId) return v;
  try {
    const inv = await VendorInvoice.findById(v.invoiceId)
      .select('grnId grnNumber grnIds grnNumbers qcId qcIds items.grnNumber').lean();
    if (inv) Object.assign(v, invoiceGrnRefs(inv));
  } catch (err) { logger.warn(`[voucher] GRN refs lookup failed for ${v.voucherNumber}: ${err.message}`); }
  return v;
};

export const voucherService = {
  async create(data, user) {
    if (data.voucherType === VOUCHER_TYPE.EXPENSE) return this.createExpense(data, user);

    // ── PURCHASE — voucher only from an approved (payment-pending) invoice. ──
    const inv = await VendorInvoice.findOne({ _id: data.invoiceId, isDeleted: { $ne: true } });
    if (!inv) throw new AppError('Vendor invoice not found', 404);
    if (inv.invoiceStatus !== INVOICE_STATUS.PAYMENT_PENDING) {
      throw new AppError('Voucher can only be created from an approved (payment-pending) invoice', 400);
    }
    const existing = await VendorVoucher.findOne({ invoiceId: inv._id, isDeleted: { $ne: true }, voucherStatus: { $ne: VOUCHER_STATUS.CANCELLED } }).lean();
    if (existing) throw new AppError(`A voucher (${existing.voucherNumber}) already exists for this invoice`, 400);

    const netPayableAmount = round2(inv.netPayableAmount);
    const voucherNumber = await generatePurchaseVoucherNumber(data.voucherDate || new Date());

    // Step 1.11 is voucher passing / approval only — NO payment is recorded here.
    const voucher = await VendorVoucher.create({
      voucherNumber,
      voucherType: VOUCHER_TYPE.PURCHASE,
      voucherDate: data.voucherDate || new Date(),
      invoiceId: inv._id, invoiceNumber: inv.invoiceNumber,
      vendorId: inv.vendorId, vendorName: inv.vendorName,
      poId: inv.poId, poNumber: inv.poNumber, grnId: inv.grnId, qcId: inv.qcId,
      ...invoiceGrnRefs(inv),
      invoiceAmount: round2(inv.invoiceAmount),
      advancePaid: round2(inv.advancePaid),
      debitNoteAmount: round2(inv.debitNoteAmount),
      netPayableAmount,
      paidAmount: 0,
      balanceAmount: netPayableAmount,
      voucherStatus: VOUCHER_STATUS.DRAFT,
      remarks: data.remarks || '',
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `Purchase voucher created for ${inv.invoiceNumber}`, actorId: user?._id }],
    });
    return voucher;
  },

  // ── EXPENSE — direct company expense (no invoice/PO/GRN/QC). ──
  async createExpense(data, user) {
    if (!data.expenseCategory) throw new AppError('Expense category is required', 400);
    const total = computeExpenseTotal(data);
    const voucherNumber = await generateExpenseVoucherNumber(data.voucherDate || new Date());

    const voucher = await VendorVoucher.create({
      voucherNumber,
      voucherType: VOUCHER_TYPE.EXPENSE,
      voucherDate: data.voucherDate || new Date(),
      vendorName: data.partyName || '', // mirror so list search/display works
      partyName: data.partyName || '',
      expenseCategory: data.expenseCategory,
      expenseInvoiceNo: data.expenseInvoiceNo || '',
      expenseInvoiceDate: data.expenseInvoiceDate || null,
      invoiceDocument: data.invoiceDocument?.fileUrl
        ? { fileUrl: data.invoiceDocument.fileUrl, fileName: data.invoiceDocument.fileName || '' }
        : { fileUrl: '', fileName: '' },
      basicValue: round2(data.basicValue),
      freightCharges: round2(data.freightCharges),
      packingForwardingCharges: round2(data.packingForwardingCharges),
      otherCharges: round2(data.otherCharges),
      taxAmount: round2(data.taxAmount),
      tcsAmount: round2(data.tcsAmount),
      tdsAmount: round2(data.tdsAmount),
      advanceAmount: round2(data.advanceAmount),
      otherReason: data.otherReason || '',
      paymentTerms: data.paymentTerms || '',
      dueDate: data.dueDate || null,
      preparedBy: data.preparedBy || '',
      totalAmountPayable: total,
      // Downstream (Tally 1.12 + Final Payment 1.13) read net/balance.
      netPayableAmount: total,
      paidAmount: 0,
      balanceAmount: total,
      voucherStatus: VOUCHER_STATUS.DRAFT,
      remarks: data.remarks || '',
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `Expense voucher created (${data.expenseCategory})`, actorId: user?._id }],
    });
    return voucher;
  },

  async getAll(query) {
    // Eligibility helpers (used by Final Payment 1.13): minimum remaining balance
    // and excluded voucher statuses. tallyEntryStatus passes through ApiFeatures.
    const { minBalance, excludeStatus, ...rest } = query;
    const base = { isDeleted: { $ne: true } };
    if (minBalance !== undefined && minBalance !== '') {
      base.balanceAmount = { $gte: Number(minBalance) || 0 };
    }
    if (excludeStatus) {
      const list = String(excludeStatus).split(',').map((s) => s.trim()).filter(Boolean);
      if (list.length) base.voucherStatus = { $nin: list };
    }
    const features = new ApiFeatures(VendorVoucher.find(base), rest)
      .filter().search(['voucherNumber', 'invoiceNumber', 'vendorName', 'partyName', 'expenseCategory', 'referenceNumber'])
      .sort().select().paginate();
    return features.exec();
  },

  async getById(id) {
    const v = await VendorVoucher.findOne({ _id: id, isDeleted: { $ne: true } }).populate('createdBy', 'name').lean();
    if (!v) throw new AppError('Voucher not found', 404);
    return withGrnRefs(v);
  },

  async getByInvoice(invoiceId) {
    return VendorVoucher.find({ invoiceId, isDeleted: { $ne: true } }).sort('-createdAt').lean();
  },

  async getStats() {
    const rows = await VendorVoucher.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      {
        $group: {
          _id: null,
          total:         { $sum: 1 },
          posted:        { $sum: { $cond: [{ $in: ['$voucherStatus', [VOUCHER_STATUS.POSTED, VOUCHER_STATUS.PARTIALLY_PAID, VOUCHER_STATUS.FULLY_PAID]] }, 1, 0] } },
          partiallyPaid: { $sum: { $cond: [{ $eq: ['$voucherStatus', VOUCHER_STATUS.PARTIALLY_PAID] }, 1, 0] } },
          fullyPaid:     { $sum: { $cond: [{ $eq: ['$voucherStatus', VOUCHER_STATUS.FULLY_PAID] }, 1, 0] } },
          // Outstanding = unpaid balance on non-cancelled vouchers.
          outstanding:   { $sum: { $cond: [{ $ne: ['$voucherStatus', VOUCHER_STATUS.CANCELLED] }, '$balanceAmount', 0] } },
        },
      },
    ]);
    return rows[0] || { total: 0, posted: 0, partiallyPaid: 0, fullyPaid: 0, outstanding: 0 };
  },

  async update(id, data, user) {
    const v = await findOrThrow(id);
    if (v.approvalStatus === 'MD_APPROVED') {
      v.activityTimeline.push({ action: 'EDIT_BLOCKED', description: 'Edit blocked — voucher is MD-signed and locked', actorId: user?._id });
      await v.save();
      throw new AppError('This voucher has been digitally signed by the MD and is locked for editing', 400);
    }
    if (v.voucherStatus !== VOUCHER_STATUS.DRAFT) throw new AppError('Only draft vouchers can be edited', 400);
    // Never accept payment/status mutations here — those belong to Step 1.13.
    const { paidAmount, balanceAmount, voucherStatus, ...rest } = data;
    Object.assign(v, rest);
    // Expense vouchers: recompute the total from the (possibly edited) amounts.
    if (v.voucherType === VOUCHER_TYPE.EXPENSE) {
      v.totalAmountPayable = computeExpenseTotal(v);
      v.netPayableAmount = v.totalAmountPayable;
    }
    v.paidAmount = 0;
    v.balanceAmount = round2(v.netPayableAmount);
    v.updatedBy = user?._id;
    v.activityTimeline.push({ action: 'UPDATE', description: 'Voucher updated', actorId: user?._id });
    return v.save();
  },

  async remove(id, user) {
    const v = await findOrThrow(id);
    if (v.voucherStatus !== VOUCHER_STATUS.DRAFT) {
      throw new AppError('Only draft vouchers can be deleted', 400);
    }
    v.isDeleted = true;
    v.deletedAt = new Date();
    v.deletedBy = user?._id;
    v.activityTimeline.push({ action: 'DELETE', description: 'Voucher deleted', actorId: user?._id });
    return v.save();
  },

  /**
   * Step 1.11 — voucher passing / approval ONLY. No payment is recorded here:
   * paidAmount stays 0, balance stays = net payable, and the invoice is NOT
   * marked PAYMENT_COMPLETED. Moving to POSTED enables the Tally Entry (1.12);
   * the actual vendor payment is recorded in Step 1.13 Final Payment.
   */
  async post(id, data, user) {
    const v = await findOrThrow(id);
    if (v.voucherStatus !== VOUCHER_STATUS.DRAFT) throw new AppError('Only draft vouchers can be posted', 400);

    v.paidAmount = 0;
    v.balanceAmount = round2(v.netPayableAmount);
    v.voucherStatus = VOUCHER_STATUS.POSTED;
    v.postedAt = new Date();
    if (data?.remarks) v.remarks = data.remarks;
    v.updatedBy = user?._id;
    v.activityTimeline.push({ action: 'POST', description: 'Voucher passed / approved — pending final payment', actorId: user?._id });
    await v.save();

    // Link the voucher onto the invoice (purchase only; expense has no invoice).
    if (v.invoiceId) {
      try {
        await VendorInvoice.updateOne(
          { _id: v.invoiceId },
          { $set: { voucherId: v._id, voucherNumber: v.voucherNumber } },
        );
      } catch (err) { logger.error(`[voucher] invoice link failed for ${v.invoiceId}: ${err.message}`); }
    }

    // Ready for MD Approval (non-fatal).
    try {
      await approvalService.ensureReady({ documentType: 'VOUCHER', documentId: v._id, documentNumber: v.voucherNumber }, user);
    } catch (err) { logger.error(`[voucher] approval ensureReady failed for ${v.voucherNumber}: ${err.message}`); }

    return v;
  },

  /** Generate the voucher PDF (purchase vs expense layout), store it, persist the URL. */
  async generatePdf(id) {
    const v = await VendorVoucher.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!v) throw new AppError('Voucher not found', 404);

    // MD-signed vouchers are locked — the signed PDF lives in DocumentApproval and
    // is mirrored onto voucherPdfUrl/voucherPdfFileName by the approval engine.
    // Never re-render an unsigned copy over it; just hand back what's stored.
    if (v.approvalStatus === 'MD_APPROVED') {
      return { voucherPdfUrl: v.voucherPdfUrl, voucherPdfFileName: v.voucherPdfFileName };
    }

    let company = {};
    try {
      const CompanySettings = (await import('../../pricing/company-settings.model.js')).default;
      const s = await CompanySettings.findOne().lean();
      if (s) company = { name: s.companyName, address: s.companyAddress, gstin: s.companyGstin, phone: s.companyPhone, email: s.companyEmail };
    } catch { /* fall back to env */ }

    const buffer = await buildVoucherPdfBuffer(await withGrnRefs(v), company);
    const fileName = `${String(v.voucherNumber || 'VOUCHER').replace(/[^\w.-]/g, '_')}.pdf`;

    let voucherPdfUrl;
    if (s3Enabled) {
      const key = buildKey('vouchers', fileName);
      await uploadBuffer({ buffer, key, contentType: 'application/pdf' });
      voucherPdfUrl = `${SERVER_BASE}/api/v1/uploads/file?key=${encodeURIComponent(key)}`;
    } else {
      const dir = path.resolve(process.cwd(), 'uploads', 'vouchers');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fp = path.join(dir, `${Date.now()}-${fileName}`);
      fs.writeFileSync(fp, buffer);
      voucherPdfUrl = `${SERVER_BASE}/uploads/vouchers/${path.basename(fp)}`;
    }
    await VendorVoucher.updateOne({ _id: id }, { $set: { voucherPdfUrl, voucherPdfFileName: fileName } });
    return { voucherPdfUrl, voucherPdfFileName: fileName };
  },

  async cancel(id, data, user) {
    const v = await findOrThrow(id);
    if (v.approvalStatus === 'MD_APPROVED') {
      v.activityTimeline.push({ action: 'EDIT_BLOCKED', description: 'Cancel blocked — voucher is MD-signed and locked', actorId: user?._id });
      await v.save();
      throw new AppError('This voucher has been digitally signed by the MD and cannot be cancelled', 400);
    }
    if ([VOUCHER_STATUS.FULLY_PAID, VOUCHER_STATUS.PARTIALLY_PAID, VOUCHER_STATUS.POSTED].includes(v.voucherStatus)) {
      throw new AppError('A posted voucher cannot be cancelled', 400);
    }
    if (v.voucherStatus === VOUCHER_STATUS.CANCELLED) throw new AppError('Voucher is already cancelled', 400);
    v.voucherStatus = VOUCHER_STATUS.CANCELLED;
    v.cancelledAt = new Date();
    if (data.remarks) v.remarks = data.remarks;
    v.updatedBy = user?._id;
    v.activityTimeline.push({ action: 'CANCEL', description: 'Voucher cancelled', actorId: user?._id });
    return v.save();
  },
};
