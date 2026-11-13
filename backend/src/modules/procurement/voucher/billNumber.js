/**
 * One vendor bill number is recorded once per supplier — whichever document
 * recorded it. This is the single lookup behind every duplicate-bill check:
 *
 *   Vendor Invoice            VendorInvoice.invoiceNumber        (not REJECTED / deleted)
 *   Purchase Voucher          carries its invoice's number — covered by the row above
 *   Direct Purchase voucher   VendorVoucher.invoiceNumber        (not CANCELLED / deleted)
 *   Expense bill (Direct /    VendorVoucher.expenseInvoiceNo     (not CANCELLED / deleted)
 *     Against PO / Against GRN)
 *
 * "Same supplier" = same master id, or another Vendor / Party record with the
 * same VALID GSTIN (supplierIdentity.js). Numbers match trimmed and
 * case-insensitively.
 */
import VendorVoucher, { VOUCHER_STATUS, VOUCHER_TYPE } from './voucher.model.js';
import VendorInvoice, { INVOICE_STATUS } from '../vendor-invoice/vendorInvoice.model.js';
import { supplierIdsFor } from './supplierIdentity.js';
import { AppError } from '../../../utils/apiResponse.js';

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactNumber = (no) => new RegExp(`^${escapeRegex(String(no).trim())}$`, 'i');

/**
 * The live document already using this bill number for this supplier, or null.
 * `invoices` / `vouchers` switch each side off for callers that check their own
 * side themselves. Returns { kind, number, invoiceNumber?, voucherNumber?, voucherId? }.
 */
export const findBillNumberUse = async (vendorId, billNumber, {
  excludeVoucherId = null, excludeInvoiceId = null, invoices = true, vouchers = true,
} = {}) => {
  const no = String(billNumber || '').trim();
  if (!vendorId || !no) return null;
  const ids = await supplierIdsFor(vendorId);
  if (!ids.length) return null;
  const rx = exactNumber(no);

  if (invoices) {
    const inv = await VendorInvoice.findOne({
      vendorId: { $in: ids }, invoiceNumber: rx, isDeleted: { $ne: true }, invoiceStatus: { $ne: INVOICE_STATUS.REJECTED },
      ...(excludeInvoiceId ? { _id: { $ne: excludeInvoiceId } } : {}),
    }).select('invoiceNumber').lean();
    if (inv) return { kind: 'INVOICE', number: no, invoiceNumber: inv.invoiceNumber };
  }
  if (vouchers) {
    const v = await VendorVoucher.findOne({
      vendorId: { $in: ids },
      isDeleted: { $ne: true },
      voucherStatus: { $ne: VOUCHER_STATUS.CANCELLED },
      ...(excludeVoucherId ? { _id: { $ne: excludeVoucherId } } : {}),
      $or: [
        { voucherType: VOUCHER_TYPE.DIRECT_PURCHASE, invoiceNumber: rx },
        { voucherType: VOUCHER_TYPE.EXPENSE, expenseInvoiceNo: rx },
      ],
    }).select('voucherNumber voucherType').lean();
    if (v) return { kind: v.voucherType, number: no, voucherNumber: v.voucherNumber, voucherId: v._id };
  }
  return null;
};

/** Message for a hit, worded for the document being saved. */
export const billNumberUseMessage = (hit) => {
  if (!hit) return '';
  if (hit.kind === 'INVOICE') {
    return `Invoice ${hit.invoiceNumber} is already recorded for this vendor as a Vendor Invoice — it is paid through its Purchase Voucher`;
  }
  const what = hit.kind === VOUCHER_TYPE.EXPENSE ? 'expense voucher' : 'direct purchase voucher';
  return `Invoice ${hit.number} is already recorded for this vendor on ${what} ${hit.voucherNumber}`;
};

/** Throw 400 when the number is taken (see findBillNumberUse). */
export const assertBillNumberFree = async (vendorId, billNumber, opts) => {
  const hit = await findBillNumberUse(vendorId, billNumber, opts);
  if (hit) throw new AppError(billNumberUseMessage(hit), 400);
};
