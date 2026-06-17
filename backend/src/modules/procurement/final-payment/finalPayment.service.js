import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import VendorFinalPayment, { FINAL_PAYMENT_STATUS } from './finalPayment.model.js';
import VendorVoucher, { VOUCHER_STATUS } from '../voucher/voucher.model.js';
import VendorInvoice, { INVOICE_STATUS } from '../vendor-invoice/vendorInvoice.model.js';
import { ApiFeatures } from '../../../utils/apiFeatures.js';
import { AppError } from '../../../utils/apiResponse.js';
import { generateFinalPaymentNumber } from '../../../utils/docNumberGenerator.js';
import { s3Enabled, buildKey, uploadBuffer } from '../../../common/uploads/s3.service.js';
import { logger } from '../../../utils/logger.js';
import env from '../../../config/env.js';

const SERVER_BASE = (process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/+$/, '');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const EPS = 0.01;

// ─────────────────────────────────────────────────────────────
// PDF — Vendor Payment Receipt (A4)
// ─────────────────────────────────────────────────────────────
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const INR = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PAY_STATUS_LABEL = {
  PART_PAYMENT: 'Part Payment', FULL_PAYMENT: 'Full Payment',
  SHORT_PAYMENT_COMPLETED: 'Short Payment & Completed', CANCELLED: 'Cancelled',
};

export const buildFinalPaymentPdfBuffer = (p, company = {}) => new Promise((resolve, reject) => {
  try {
    const M = 40;
    const doc = new PDFDocument({ size: 'A4', margin: M });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const W = 595.28 - M * 2;
    const navy = '#0b2545'; const blue = '#1d4ed8'; const line = '#dbe4f3';

    // Header band.
    doc.rect(0, 0, 595.28, 84).fill(navy);
    doc.fill('#ffffff').font('Helvetica-Bold').fontSize(17).text(company.name || env.COMPANY_NAME, M, 16, { width: W - 200 });
    doc.font('Helvetica').fontSize(8.5).fill('#cdd9f0')
      .text([company.address || env.COMPANY_ADDRESS, company.gstin ? `GSTIN: ${company.gstin}` : '', company.email || env.COMPANY_EMAIL].filter(Boolean).join('   •   '), M, 40, { width: W - 200 });
    doc.font('Helvetica-Bold').fontSize(14).fill('#ffffff').text('PAYMENT RECEIPT', M, 34, { width: W, align: 'right' });

    let y = 102;
    const half = W / 2 - 8;
    const CARD_H = 100;
    doc.roundedRect(M, y, half, CARD_H, 6).stroke(line);
    doc.roundedRect(M + half + 16, y, half, CARD_H, 6).stroke(line);

    // Left — payment details.
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('PAYMENT DETAILS', M + 10, y + 8);
    doc.font('Helvetica-Bold').fontSize(11).fill(navy).text(p.paymentNumber || '', M + 10, y + 21);
    doc.font('Helvetica').fontSize(8.5).fill(navy)
      .text(`Date: ${fmtDate(p.paymentDate)}`, M + 10, y + 38)
      .text(`Status: ${PAY_STATUS_LABEL[p.paymentStatus] || p.paymentStatus || '—'}`, M + 10, y + 51)
      .text(`Mode: ${(p.paymentMode || '').replace(/_/g, ' ')}`, M + 10, y + 64)
      .text(`Reference: ${p.paymentReferenceNumber || '—'}`, M + 10, y + 77);

    // Right — vendor + linkage. The vendor name may wrap, so the linkage lines
    // start below its measured height (no overlap).
    const vx = M + half + 26;
    const vW = half - 20;
    doc.font('Helvetica-Bold').fontSize(8).fill(blue).text('PAID TO', vx, y + 8);
    doc.font('Helvetica-Bold').fontSize(10.5).fill(navy);
    const vNameH = doc.heightOfString(p.vendorName || '—', { width: vW });
    doc.text(p.vendorName || '—', vx, y + 21, { width: vW });
    let ly = y + 21 + vNameH + 4;
    doc.font('Helvetica').fontSize(8.5).fill(navy);
    doc.text(`Voucher: ${p.voucherNumber || '—'}`, vx, ly, { width: vW }); ly += 13;
    doc.text(`Invoice: ${p.invoiceNumber || '—'}`, vx, ly, { width: vW }); ly += 13;
    doc.text(`PO: ${p.poNumber || '—'}`, vx, ly, { width: vW });

    y += CARD_H + 16;

    // Amount summary band.
    doc.roundedRect(M, y, W, 64, 6).fill('#f5f8ff');
    const col = W / 3;
    const cell = (label, value, i, strong) => {
      const cx = M + i * col;
      doc.font('Helvetica-Bold').fontSize(8).fill(blue).text(label, cx + 12, y + 12, { width: col - 24 });
      doc.font('Helvetica-Bold').fontSize(strong ? 15 : 12).fill(navy).text(value, cx + 12, y + 30, { width: col - 24 });
    };
    cell('PREVIOUS BALANCE', INR(p.previousBalance), 0);
    cell('PAID NOW', INR(p.paidAmount), 1, true);
    cell('BALANCE AFTER', INR(p.balanceAfterPayment), 2);
    y += 80;

    // Remarks.
    doc.font('Helvetica-Bold').fontSize(8.5).fill(navy).text('Remarks:', M, y);
    doc.font('Helvetica').fontSize(8.5).text(p.remarks || '—', M, y + 13, { width: W - 200 });

    // Signature.
    doc.font('Helvetica-Bold').fontSize(9).fill(navy).text(`For ${company.name || env.COMPANY_NAME}`, M + W - 180, y + 4, { width: 180, align: 'center' });
    doc.font('Helvetica').fontSize(8).text(`Prepared By: ${p.performedByName || '—'}`, M + W - 180, y + 44, { width: 180, align: 'center' });
    doc.font('Helvetica').fontSize(8).text('Authorized Signatory', M + W - 180, y + 58, { width: 180, align: 'center' });

    doc.end();
  } catch (err) { reject(err); }
});

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

    // Generate the payment receipt PDF (non-fatal — payment stands even if PDF fails).
    try {
      const { paymentPdfUrl, paymentPdfFileName } = await this.generatePdf(payment._id);
      payment.paymentPdfUrl = paymentPdfUrl;
      payment.paymentPdfFileName = paymentPdfFileName;
    } catch (err) { logger.error(`[final-payment] PDF generation failed for ${payment.paymentNumber}: ${err.message}`); }

    return payment;
  },

  /** Render + store the payment receipt PDF and persist its URL. */
  async generatePdf(id) {
    const p = await VendorFinalPayment.findOne({ _id: id, isDeleted: { $ne: true } }).lean();
    if (!p) throw new AppError('Final payment not found', 404);

    let company = {};
    try {
      const CompanySettings = (await import('../../pricing/company-settings.model.js')).default;
      const s = await CompanySettings.findOne().lean();
      if (s) company = { name: s.companyName, address: s.companyAddress, gstin: s.companyGstin, email: s.companyEmail };
    } catch { /* env fallback */ }

    const buffer = await buildFinalPaymentPdfBuffer(p, company);
    const fileName = `${String(p.paymentNumber || 'PAYMENT').replace(/[^\w.-]/g, '_')}.pdf`;
    let paymentPdfUrl;
    if (s3Enabled) {
      const key = buildKey('final-payments', fileName);
      await uploadBuffer({ buffer, key, contentType: 'application/pdf' });
      paymentPdfUrl = `${SERVER_BASE}/api/v1/uploads/file?key=${encodeURIComponent(key)}`;
    } else {
      const dir = path.resolve(process.cwd(), 'uploads', 'final-payments');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fp = path.join(dir, `${Date.now()}-${fileName}`);
      fs.writeFileSync(fp, buffer);
      paymentPdfUrl = `${SERVER_BASE}/uploads/final-payments/${path.basename(fp)}`;
    }
    await VendorFinalPayment.updateOne({ _id: id }, { $set: { paymentPdfUrl, paymentPdfFileName: fileName } });
    return { paymentPdfUrl, paymentPdfFileName: fileName };
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
