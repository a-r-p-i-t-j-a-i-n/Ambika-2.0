/**
 * The later-step records resting on a Purchase FMS record.
 *
 * Every step's delete uses these: a record goes (and what it set on earlier
 * records is undone) only while no later record rests on it; otherwise the
 * delete is refused and names those records, so the user deletes the latest
 * step first. Cancelled / rejected / deleted records never count.
 *
 * Models only (no services), so any step's service can import this.
 */
import { AppError } from '../../utils/apiResponse.js';
import VendorPurchaseOrder, { PO_STATUS } from './purchase-order/purchaseOrder.model.js';
import PurchaseFollowUp from './follow-up/followUp.model.js';
import ProformaInvoice, { PI_STATUS } from './proforma-invoice/proformaInvoice.model.js';
import AdvancePayment, { PAYMENT_STATUS as ADVANCE_STATUS } from './advance-payment/advancePayment.model.js';
import GoodsReceiptNote, { GRN_STATUS } from './grn/grn.model.js';
import IncomingQC, { QC_STATUS } from './incoming-qc/incomingQc.model.js';
import VendorInvoice, { INVOICE_STATUS } from './vendor-invoice/vendorInvoice.model.js';
import VendorVoucher, { VOUCHER_STATUS } from './voucher/voucher.model.js';
import PurchaseTallyEntry, { TALLY_ENTRY_STATUS } from './tally-entry/tallyEntry.model.js';
import VendorFinalPayment, { FINAL_PAYMENT_STATUS } from './final-payment/finalPayment.model.js';

const live = { isDeleted: { $ne: true } };
const rows = (label, numberOf) => (docs) => docs.map((d) => ({ label, number: numberOf(d) || '' }));

const followUpsOfPo = (poId) => PurchaseFollowUp.find({ poId, ...live }).select('followUpNumber').lean()
  .then(rows('Follow-up', (d) => d.followUpNumber));
const pisOfPo = (poId) => ProformaInvoice.find({ poId, ...live, piStatus: { $ne: PI_STATUS.CANCELLED } }).select('piNumber').lean()
  .then(rows('PI', (d) => d.piNumber));
const grnsOfPo = (poId) => GoodsReceiptNote.find({ $or: [{ poId }, { poIds: poId }], ...live, grnStatus: { $ne: GRN_STATUS.CANCELLED } })
  .select('grnNumber').lean().then(rows('GRN', (d) => d.grnNumber));
const advancesOf = (filter) => AdvancePayment.find({ ...filter, ...live, paymentStatus: { $ne: ADVANCE_STATUS.CANCELLED } })
  .select('paymentNumber').lean().then(rows('Advance payment', (d) => d.paymentNumber));
const invoicesOf = (filter) => VendorInvoice.find({ ...filter, ...live, invoiceStatus: { $ne: INVOICE_STATUS.REJECTED } })
  .select('invoiceNumber').lean().then(rows('Vendor Invoice', (d) => d.invoiceNumber));
const vouchersOf = (filter) => VendorVoucher.find({ ...filter, ...live, voucherStatus: { $ne: VOUCHER_STATUS.CANCELLED } })
  .select('voucherNumber').lean().then(rows('Voucher', (d) => d.voucherNumber));
const tallyOf = (filter) => PurchaseTallyEntry.find({ ...filter, ...live, tallyEntryStatus: { $ne: TALLY_ENTRY_STATUS.CANCELLED } })
  .select('entryNumber').lean().then(rows('Tally entry', (d) => d.entryNumber));
const finalPaymentsOf = (filter) => VendorFinalPayment.find({ ...filter, ...live, paymentStatus: { $ne: FINAL_PAYMENT_STATUS.CANCELLED } })
  .select('paymentNumber').lean().then(rows('Final payment', (d) => d.paymentNumber));

const all = async (lookups) => (await Promise.all(lookups)).flat();

export const laterStepsOf = {
  /** POs made from the indent (a cancelled PO has released its items), and a service QC on it. */
  indent: (indentId) => all([
    VendorPurchaseOrder.find({
      $or: [{ indentId }, { indentIds: indentId }, { 'items.indentId': indentId }], ...live, poStatus: { $ne: PO_STATUS.CANCELLED },
    }).select('poNumber draftNumber').lean().then(rows('Purchase Order', (d) => d.poNumber || d.draftNumber)),
    IncomingQC.find({ indentId, ...live, qcStatus: { $ne: QC_STATUS.CANCELLED } }).select('qcNumber').lean()
      .then(rows('Service QC', (d) => d.qcNumber)),
  ]),
  po: (poId) => all([
    followUpsOfPo(poId), pisOfPo(poId), advancesOf({ poId }), grnsOfPo(poId),
    invoicesOf({ poId }), vouchersOf({ poId }),
  ]),
  /** A follow-up made the PO ready for GRN — a GRN on that PO rests on it. */
  followUp: (poId) => grnsOfPo(poId),
  pi: (piId) => all([advancesOf({ piId }), invoicesOf({ piId })]),
  invoice: (invoiceId) => vouchersOf({ invoiceId }),
  voucher: (voucherId) => all([tallyOf({ voucherId }), finalPaymentsOf({ voucherId })]),
  tally: (voucherId) => finalPaymentsOf({ voucherId }),
};

/** "PI PI-004/26-27 cannot be deleted: Advance payment ADV-002 rests on it. Delete that first." */
export const laterStepsMessage = (what, steps) => {
  const names = steps.map((s) => `${s.label} ${s.number}`.trim()).join(', ');
  return `${what} cannot be deleted: ${names} ${steps.length === 1 ? 'rests' : 'rest'} on it. `
    + `Delete ${steps.length === 1 ? 'that' : 'those'} first (the latest step first), then delete this.`;
};

/** Refuse (409) when anything rests on the record. */
export const assertNothingAfter = (what, steps) => {
  if (steps.length) throw new AppError(laterStepsMessage(what, steps), 409);
};

/** The reason a completed record is deleted for — required, kept on its history. */
export const deleteReason = (reason, what) => {
  const why = String(reason || '').trim().slice(0, 500);
  if (!why) throw new AppError(`Give the reason for deleting ${what}`, 400);
  return why;
};
