import VendorVoucher, { VOUCHER_STATUS } from './voucher.model.js';
import VendorInvoice, { INVOICE_STATUS } from '../vendor-invoice/vendorInvoice.model.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { generateVoucherNumber } from '../../../utils/docNumberGenerator.js';
import { logger } from '../../../utils/logger.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const findOrThrow = async (id) => {
  const v = await VendorVoucher.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!v) throw new AppError('Voucher not found', 404);
  return v;
};

export const voucherService = {
  // Rule 1 & 2: voucher only from an approved (payment-pending) invoice.
  async create(data, user) {
    const inv = await VendorInvoice.findOne({ _id: data.invoiceId, isDeleted: { $ne: true } });
    if (!inv) throw new AppError('Vendor invoice not found', 404);
    if (inv.invoiceStatus !== INVOICE_STATUS.PAYMENT_PENDING) {
      throw new AppError('Voucher can only be created from an approved (payment-pending) invoice', 400);
    }
    const existing = await VendorVoucher.findOne({ invoiceId: inv._id, isDeleted: { $ne: true }, voucherStatus: { $ne: VOUCHER_STATUS.CANCELLED } }).lean();
    if (existing) throw new AppError(`A voucher (${existing.voucherNumber}) already exists for this invoice`, 400);

    const netPayableAmount = round2(inv.netPayableAmount);
    const voucherNumber = await generateVoucherNumber(data.voucherDate || new Date());

    // Step 1.11 is voucher passing / approval only — NO payment is recorded here.
    // paidAmount stays 0 and balance = net payable; the actual payment is recorded
    // in Step 1.13 Final Payment.
    const voucher = await VendorVoucher.create({
      voucherNumber,
      voucherDate: data.voucherDate || new Date(),
      invoiceId: inv._id, invoiceNumber: inv.invoiceNumber,
      vendorId: inv.vendorId, vendorName: inv.vendorName,
      poId: inv.poId, poNumber: inv.poNumber, grnId: inv.grnId, qcId: inv.qcId,
      invoiceAmount: round2(inv.invoiceAmount),
      advancePaid: round2(inv.advancePaid),
      debitNoteAmount: round2(inv.debitNoteAmount),
      netPayableAmount,
      paidAmount: 0,
      balanceAmount: netPayableAmount,
      voucherStatus: VOUCHER_STATUS.DRAFT,
      remarks: data.remarks || '',
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `Voucher created for ${inv.invoiceNumber}`, actorId: user?._id }],
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
      .filter().search(['voucherNumber', 'invoiceNumber', 'vendorName', 'referenceNumber'])
      .sort().select().paginate();
    return features.exec();
  },

  async getById(id) {
    const v = await VendorVoucher.findOne({ _id: id, isDeleted: { $ne: true } }).populate('createdBy', 'name').lean();
    if (!v) throw new AppError('Voucher not found', 404);
    return v;
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
    if (v.voucherStatus !== VOUCHER_STATUS.DRAFT) throw new AppError('Only draft vouchers can be edited', 400);
    // Never accept payment/status mutations here — those belong to Step 1.13.
    const { paidAmount, balanceAmount, voucherStatus, ...rest } = data;
    Object.assign(v, rest);
    v.paidAmount = 0;
    v.balanceAmount = round2(v.netPayableAmount);
    v.updatedBy = user?._id;
    v.activityTimeline.push({ action: 'UPDATE', description: 'Voucher updated', actorId: user?._id });
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

    // Link the voucher onto the invoice (do NOT mark it paid — that's Step 1.13).
    try {
      await VendorInvoice.updateOne(
        { _id: v.invoiceId },
        { $set: { voucherId: v._id, voucherNumber: v.voucherNumber } },
      );
    } catch (err) { logger.error(`[voucher] invoice link failed for ${v.invoiceId}: ${err.message}`); }

    return v;
  },

  async cancel(id, data, user) {
    const v = await findOrThrow(id);
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
