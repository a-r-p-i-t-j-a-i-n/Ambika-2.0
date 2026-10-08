/**
 * reportPiAdvanceOverAllocation.js — READ-ONLY report (no --commit mode)
 * ════════════════════════════════════════════════════════════════════
 * Lists historical records where a PI's advance is deducted on vendor invoices
 * by more than the PI has actually been paid. Two causes:
 *   • before the allocation fix, every invoice deducted the PI's FULL advance;
 *   • an advance payment deleted (reversed) after invoices had adjusted it
 *     (now blocked, but older data may exist).
 * It changes NOTHING. Any correction — and how the related voucher, Tally entry
 * and final payment should be adjusted — is an accounting decision.
 *
 * For each affected PI it prints: advance paid, total deducted, excess; each
 * live invoice with its deduction, the deduction the current rule would give
 * (first-come allocation), and its voucher / final-payment state; plus any
 * deleted advance payments on that PI. It also lists invoices whose advance
 * exceeds their own payable basis (invoice − debit note).
 *
 * USAGE
 *   node src/scripts/reportPiAdvanceOverAllocation.js
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import VendorInvoice, { INVOICE_STATUS } from '../modules/procurement/vendor-invoice/vendorInvoice.model.js';
import ProformaInvoice from '../modules/procurement/proforma-invoice/proformaInvoice.model.js';
import AdvancePayment from '../modules/procurement/advance-payment/advancePayment.model.js';
import VendorVoucher from '../modules/procurement/voucher/voucher.model.js';
import VendorFinalPayment, { FINAL_PAYMENT_STATUS } from '../modules/procurement/final-payment/finalPayment.model.js';
import { logger } from '../utils/logger.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const basisOf = (i) => Math.max(0, round2((i.invoiceAmount || 0) - (i.debitNoteAmount || 0)));

const run = async () => {
  await connectDB();

  const invoices = await VendorInvoice.find({
    isDeleted: { $ne: true },
    invoiceStatus: { $ne: INVOICE_STATUS.REJECTED },
    piId: { $ne: null },
  }).select('invoiceNumber piId piNumber invoiceAmount debitNoteAmount advancePaid netPayableAmount invoiceStatus createdAt')
    .sort({ createdAt: 1 }).lean();

  const byPi = new Map();
  for (const inv of invoices) {
    const k = String(inv.piId);
    if (!byPi.has(k)) byPi.set(k, []);
    byPi.get(k).push(inv);
  }
  const pis = await ProformaInvoice.find({ _id: { $in: [...byPi.keys()] } }).select('piNumber paidAmount').lean();
  const piById = new Map(pis.map((p) => [String(p._id), p]));

  const affected = [...byPi].filter(([piId, list]) =>
    round2(list.reduce((s, i) => s + (i.advancePaid || 0), 0)) > round2(piById.get(piId)?.paidAmount || 0));

  // Downstream documents for the affected invoices (read-only lookups).
  const affectedInvoiceIds = affected.flatMap(([, list]) => list.map((i) => i._id));
  const vouchers = await VendorVoucher.find({ invoiceId: { $in: affectedInvoiceIds }, isDeleted: { $ne: true } })
    .select('invoiceId voucherNumber voucherStatus advancePaid netPayableAmount paidAmount balanceAmount').lean();
  const voucherByInvoice = new Map(vouchers.map((v) => [String(v.invoiceId), v]));
  const payments = await VendorFinalPayment.find({
    voucherId: { $in: vouchers.map((v) => v._id) }, isDeleted: { $ne: true }, paymentStatus: { $ne: FINAL_PAYMENT_STATUS.CANCELLED },
  }).select('voucherId paymentNumber paidAmount').lean();
  const paidByVoucher = new Map();
  payments.forEach((p) => {
    const k = String(p.voucherId);
    const cur = paidByVoucher.get(k) || { count: 0, amount: 0, numbers: [] };
    paidByVoucher.set(k, { count: cur.count + 1, amount: round2(cur.amount + (p.paidAmount || 0)), numbers: [...cur.numbers, p.paymentNumber] });
  });
  const deletedAdvances = await AdvancePayment.find({ piId: { $in: affected.map(([id]) => id) }, isDeleted: true })
    .select('piId paymentNumber paidAmount paymentStatus deletedAt').lean();

  for (const [piId, list] of affected) {
    const paid = round2(piById.get(piId)?.paidAmount || 0);
    const deducted = round2(list.reduce((s, i) => s + (i.advancePaid || 0), 0));
    logger.info(`PI ${piById.get(piId)?.piNumber || piId}: advance paid ${paid} · deducted on invoices ${deducted} · EXCESS ${round2(deducted - paid)}`);
    let remaining = paid;
    for (const i of list) {
      const wouldBe = Math.max(0, Math.min(remaining, basisOf(i)));
      remaining = round2(remaining - wouldBe);
      const v = voucherByInvoice.get(String(i._id));
      const fp = v ? paidByVoucher.get(String(v._id)) : null;
      const downstream = v
        ? `voucher ${v.voucherNumber} [${v.voucherStatus}] advance ${v.advancePaid}, net ${v.netPayableAmount}, paid ${v.paidAmount}, balance ${v.balanceAmount}`
          + (fp ? ` · final payment(s) ${fp.numbers.join(', ')} = ${fp.amount}` : ' · no final payment')
        : 'no voucher';
      logger.info(`   ${i.invoiceNumber} [${i.invoiceStatus}] deducted ${i.advancePaid} · current rule ${wouldBe} · ${downstream}`);
    }
    deletedAdvances.filter((a) => String(a.piId) === piId).forEach((a) =>
      logger.info(`   deleted advance ${a.paymentNumber} (${a.paymentStatus}) ₹${a.paidAmount} on ${a.deletedAt ? new Date(a.deletedAt).toISOString().slice(0, 10) : '—'}`));
  }

  const aboveBasis = invoices.filter((i) => round2(i.advancePaid) > basisOf(i));
  aboveBasis.forEach((i) => logger.info(`Invoice ${i.invoiceNumber}: advance ${i.advancePaid} exceeds payable basis ${basisOf(i)} (net payable ${i.netPayableAmount})`));

  logger.info(`Summary — PIs over-deducted: ${affected.length} · invoices with advance above payable basis: ${aboveBasis.length}. Nothing was changed.`);
  await mongoose.disconnect();
};

run().catch(async (err) => {
  logger.error(`reportPiAdvanceOverAllocation failed: ${err.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
