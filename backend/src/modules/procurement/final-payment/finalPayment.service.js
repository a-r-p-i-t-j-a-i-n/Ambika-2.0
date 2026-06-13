import VendorFinalPayment, { FINAL_PAYMENT_STATUS } from './finalPayment.model.js';
import VendorVoucher, { VOUCHER_STATUS } from '../voucher/voucher.model.js';
import VendorInvoice, { INVOICE_STATUS } from '../vendor-invoice/vendorInvoice.model.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { generateFinalPaymentNumber } from '../../../utils/docNumberGenerator.js';
import { logger } from '../../../utils/logger.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const EPS = 0.01;

// Tally Entry completion is tracked on the voucher as a plain string enum.
const VOUCHER_TALLY_COMPLETED = 'COMPLETED';

const findOrThrow = async (id) => {
  const p = await VendorFinalPayment.findOne({ _id: id, isDeleted: { $ne: true } });
  if (!p) throw new AppError('Final payment not found', 404);
  return p;
};

// Map a final-payment status to the resulting voucher status.
const voucherStatusFor = (paymentStatus) => ({
  [FINAL_PAYMENT_STATUS.PART_PAYMENT]:            VOUCHER_STATUS.PARTIALLY_PAID,
  [FINAL_PAYMENT_STATUS.FULL_PAYMENT]:            VOUCHER_STATUS.FULLY_PAID,
  [FINAL_PAYMENT_STATUS.SHORT_PAYMENT_COMPLETED]: VOUCHER_STATUS.SHORT_CLOSED,
}[paymentStatus]);

export const finalPaymentService = {
  // Rules 1-9: post a final payment against a tally-completed voucher.
  async create(data, user) {
    const v = await VendorVoucher.findOne({ _id: data.voucherId, isDeleted: { $ne: true } });
    if (!v) throw new AppError('Voucher not found', 404);

    // Rule 1 & 2: only from a voucher whose Tally Entry (1.12) is completed.
    if (v.tallyEntryStatus !== VOUCHER_TALLY_COMPLETED) {
      throw new AppError('Final payment can only be made after the Tally Entry is completed', 400);
    }
    if (v.voucherStatus === VOUCHER_STATUS.CANCELLED) {
      throw new AppError('Cannot pay against a cancelled voucher', 400);
    }

    const status = data.paymentStatus;
    const previousBalance = round2(v.balanceAmount);
    const paidAmount = round2(data.paidAmount);

    // Rule 6 (short) needs remarks; enforced in validation too.
    if (status === FINAL_PAYMENT_STATUS.SHORT_PAYMENT_COMPLETED && !data.remarks?.trim()) {
      throw new AppError('Remarks are required for Short Payment & Completed', 400);
    }

    if (status !== FINAL_PAYMENT_STATUS.CANCELLED) {
      if (!(paidAmount > 0)) throw new AppError('Paid amount must be greater than zero', 400);
      // Rule 3: cannot exceed the voucher balance.
      if (paidAmount > previousBalance + EPS) {
        throw new AppError(`Paid amount (${paidAmount}) exceeds the voucher balance (${previousBalance})`, 400);
      }
    }

    const balanceAfterPayment = round2(previousBalance - paidAmount);

    // Rule 4 & 5: shape validation per status.
    if (status === FINAL_PAYMENT_STATUS.PART_PAYMENT && balanceAfterPayment <= EPS) {
      throw new AppError('Part payment must leave a remaining balance — use Full Payment to clear it', 400);
    }
    if (status === FINAL_PAYMENT_STATUS.FULL_PAYMENT && balanceAfterPayment > EPS) {
      throw new AppError(`Full payment must equal the remaining balance (${previousBalance})`, 400);
    }

    const paymentNumber = await generateFinalPaymentNumber(data.paymentDate || new Date());
    const proof = data.proofDocument?.fileUrl
      ? { ...data.proofDocument, uploadedAt: new Date() }
      : { fileName: '', fileUrl: '', fileType: '', uploadedAt: null };

    const payment = await VendorFinalPayment.create({
      paymentNumber,
      voucherId: v._id, voucherNumber: v.voucherNumber,
      invoiceId: v.invoiceId, invoiceNumber: v.invoiceNumber,
      vendorId: v.vendorId, vendorName: v.vendorName,
      poId: v.poId, poNumber: v.poNumber,
      paymentStatus: status,
      paymentDate: data.paymentDate || new Date(),
      paidAmount: status === FINAL_PAYMENT_STATUS.CANCELLED ? 0 : paidAmount,
      paymentMode: data.paymentMode,
      paymentReferenceNumber: data.paymentReferenceNumber || '',
      remarks: data.remarks || '',
      previousBalance,
      balanceAfterPayment: status === FINAL_PAYMENT_STATUS.CANCELLED ? previousBalance : balanceAfterPayment,
      proofDocument: proof,
      performedBy: user?._id || null,
      performedByName: user?.name || '',
      createdBy: user?._id,
      activityTimeline: [{ action: 'CREATE', description: `Final payment ${paymentNumber} (${status})`, actorId: user?._id }],
    });

    // Rule 7: a cancelled payment posts no money.
    if (status === FINAL_PAYMENT_STATUS.CANCELLED) return payment;

    // Rule 8: roll the payment onto the voucher.
    const newVoucherPaid = round2((v.paidAmount || 0) + paidAmount);
    const newVoucherBalance = round2(previousBalance - paidAmount);
    const voucherStatus = voucherStatusFor(status) || v.voucherStatus;
    const closed = status === FINAL_PAYMENT_STATUS.FULL_PAYMENT || status === FINAL_PAYMENT_STATUS.SHORT_PAYMENT_COMPLETED;
    try {
      await VendorVoucher.updateOne(
        { _id: v._id },
        {
          $set: {
            paidAmount: newVoucherPaid,
            balanceAmount: Math.max(0, newVoucherBalance),
            voucherStatus,
            finalPaymentStatus: status,
            lastPaymentDate: payment.paymentDate,
          },
          $push: { activityTimeline: { action: 'FINAL_PAYMENT', description: `${paymentNumber} — ${status} (paid ₹${paidAmount})`, actorId: user?._id } },
        },
      );
    } catch (err) { logger.error(`[final-payment] voucher update failed for ${v._id}: ${err.message}`); }

    // Rule 9: full / short-closed settlement marks the invoice PAYMENT_COMPLETED.
    if (closed && v.invoiceId) {
      try {
        await VendorInvoice.updateOne(
          { _id: v.invoiceId },
          {
            $set: { invoiceStatus: INVOICE_STATUS.PAYMENT_COMPLETED },
            $push: { activityTimeline: { action: 'PAYMENT', description: `Settled via ${paymentNumber} (${status})`, actorId: user?._id } },
          },
        );
      } catch (err) { logger.error(`[final-payment] invoice update failed for ${v.invoiceId}: ${err.message}`); }
    }

    return payment;
  },

  async getAll(query) {
    const features = new ApiFeatures(VendorFinalPayment.find({ isDeleted: { $ne: true } }), query)
      .filter().search(['paymentNumber', 'voucherNumber', 'invoiceNumber', 'vendorName', 'paymentReferenceNumber'])
      .sort().select().paginate();
    return features.exec();
  },

  async getById(id) {
    const p = await VendorFinalPayment.findOne({ _id: id, isDeleted: { $ne: true } }).populate('createdBy', 'name').lean();
    if (!p) throw new AppError('Final payment not found', 404);
    return p;
  },

  async getByVoucher(voucherId) {
    return VendorFinalPayment.find({ voucherId, isDeleted: { $ne: true } }).sort('-createdAt').lean();
  },

  async getStats() {
    const rows = await VendorFinalPayment.aggregate([
      { $match: { isDeleted: { $ne: true }, paymentStatus: { $ne: FINAL_PAYMENT_STATUS.CANCELLED } } },
      {
        $group: {
          _id: null,
          total:       { $sum: 1 },
          paidAmount:  { $sum: '$paidAmount' },
          pending:     { $sum: '$balanceAfterPayment' }, // approximate: last-known remaining per payment
          part:        { $sum: { $cond: [{ $eq: ['$paymentStatus', FINAL_PAYMENT_STATUS.PART_PAYMENT] }, 1, 0] } },
          full:        { $sum: { $cond: [{ $eq: ['$paymentStatus', FINAL_PAYMENT_STATUS.FULL_PAYMENT] }, 1, 0] } },
          shortClosed: { $sum: { $cond: [{ $eq: ['$paymentStatus', FINAL_PAYMENT_STATUS.SHORT_PAYMENT_COMPLETED] }, 1, 0] } },
        },
      },
    ]);
    // Pending = outstanding balance across vouchers that have been part-paid (not yet closed).
    const pendingRows = await VendorVoucher.aggregate([
      { $match: { isDeleted: { $ne: true }, finalPaymentStatus: FINAL_PAYMENT_STATUS.PART_PAYMENT } },
      { $group: { _id: null, pendingAmount: { $sum: '$balanceAmount' } } },
    ]);
    const base = rows[0] || { total: 0, paidAmount: 0, part: 0, full: 0, shortClosed: 0 };
    return {
      total: base.total,
      paidAmount: round2(base.paidAmount),
      pendingAmount: round2(pendingRows[0]?.pendingAmount || 0),
      part: base.part,
      full: base.full,
      shortClosed: base.shortClosed,
    };
  },

  // Only non-money metadata is editable (date, mode, ref, proof, remarks).
  async update(id, data, user) {
    const p = await findOrThrow(id);
    if (p.paymentStatus === FINAL_PAYMENT_STATUS.CANCELLED) throw new AppError('A cancelled payment cannot be edited', 400);
    const { proofDocument, ...rest } = data;
    Object.assign(p, rest);
    if (proofDocument?.fileUrl) p.proofDocument = { ...proofDocument, uploadedAt: new Date() };
    p.updatedBy = user?._id;
    p.activityTimeline.push({ action: 'UPDATE', description: 'Final payment updated', actorId: user?._id });
    return p.save();
  },

  // Cancel reverses the money from the voucher (and re-opens the invoice if it had closed).
  async cancel(id, data, user) {
    const p = await findOrThrow(id);
    if (p.paymentStatus === FINAL_PAYMENT_STATUS.CANCELLED) throw new AppError('Payment is already cancelled', 400);

    const reversed = round2(p.paidAmount);
    const wasClosed = [FINAL_PAYMENT_STATUS.FULL_PAYMENT, FINAL_PAYMENT_STATUS.SHORT_PAYMENT_COMPLETED].includes(p.paymentStatus);

    p.paymentStatus = FINAL_PAYMENT_STATUS.CANCELLED;
    p.cancelledAt = new Date();
    if (data.remarks) p.remarks = data.remarks;
    p.updatedBy = user?._id;
    p.activityTimeline.push({ action: 'CANCEL', description: `Final payment cancelled (₹${reversed} reversed)`, actorId: user?._id });
    await p.save();

    // Reverse the money on the voucher.
    if (reversed > 0) {
      const v = await VendorVoucher.findOne({ _id: p.voucherId, isDeleted: { $ne: true } });
      if (v) {
        const newPaid = round2(Math.max(0, (v.paidAmount || 0) - reversed));
        const newBalance = round2((v.balanceAmount || 0) + reversed);
        v.paidAmount = newPaid;
        v.balanceAmount = newBalance;
        v.voucherStatus = newPaid <= EPS ? VOUCHER_STATUS.POSTED : VOUCHER_STATUS.PARTIALLY_PAID;
        v.finalPaymentStatus = newPaid <= EPS ? 'PENDING' : FINAL_PAYMENT_STATUS.PART_PAYMENT;
        v.activityTimeline.push({ action: 'FINAL_PAYMENT', description: `${p.paymentNumber} cancelled — ₹${reversed} reversed`, actorId: user?._id });
        await v.save();

        // Re-open the invoice if this payment had completed it.
        if (wasClosed && v.invoiceId) {
          try {
            await VendorInvoice.updateOne(
              { _id: v.invoiceId },
              { $set: { invoiceStatus: INVOICE_STATUS.PAYMENT_PENDING }, $push: { activityTimeline: { action: 'PAYMENT', description: `Re-opened — ${p.paymentNumber} cancelled`, actorId: user?._id } } },
            );
          } catch (err) { logger.error(`[final-payment] invoice reopen failed for ${v.invoiceId}: ${err.message}`); }
        }
      }
    }
    return p;
  },
};
