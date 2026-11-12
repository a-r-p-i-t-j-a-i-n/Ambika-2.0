/**
 * Direct Purchase Voucher — goods bought straight from a vendor with no
 * Purchase Indent, PO or GRN behind them (voucherType DIRECT_PURCHASE).
 *
 * It is a purchase, never an expense, and it is FINANCIAL ONLY: saving,
 * posting, MD approval, Tally Entry and Final Payment post no stock. Goods
 * that have to be received into stock go through the existing receipt route
 * (GRN Without PO → Incoming QC), which is the only place stock is posted.
 *
 * Rules enforced here (the client is never trusted for any of them):
 *  • vendor = an ACTIVE, non-deleted Vendor Master record; its name is copied
 *    from the master
 *  • 1..200 items, each an ACTIVE, non-deleted SKU Master record that Purchase
 *    FMS may buy (no Finished Goods, no Scrap). Item name / SKU code / unit come
 *    from the SKU (its purchase unit when configured), as on a Purchase Indent
 *  • qty > 0 (≤ 3 dp), rate ≥ 0 (≤ 4 dp), discount ≤ the line's gross, GST 0–100
 *  • amounts use the PO engine's rounding: gross = round2(qty × rate),
 *    taxable = gross − discount, tax = round2(taxable × gst / 100)
 *  • grand total > 0
 *  • a vendor invoice number is used once per vendor (case-insensitive) across
 *    vendor invoices, expense bills and direct purchase vouchers
 */
import mongoose from 'mongoose';
import { VOUCHER_STATUS, VOUCHER_TYPE } from './voucher.model.js';
import { findBillNumberUse, assertBillNumberFree, billNumberUseMessage } from './billNumber.js';
import Vendor from '../../vendors/vendor.model.js';
import SKU from '../../skus/sku.model.js';
import { bindItemsToSkus } from '../indent/itemSku.js';
import { assertPurchasable } from '../purchase-item-guard.js';
import { AppError } from '../../../utils/apiResponse.js';

export const MAX_DIRECT_PURCHASE_ITEMS = 200;
const EPS = 0.005;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const decimalsOf = (n) => {
  const s = String(n);
  if (/e-/i.test(s)) return 99;
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};

/**
 * Pure: validate + compute every line and the voucher totals.
 * Returns { lines, totals, problems } — problems is a list of messages.
 */
export const computeDirectPurchaseLines = (items = []) => {
  const problems = [];
  const lines = (items || []).map((it, i) => {
    const n = `Item ${i + 1}${it.itemName ? ` (${it.itemName})` : ''}`;
    const quantity = Number(it.quantity);
    const rate = Number(it.rate ?? 0);
    const discountAmount = Number(it.discountAmount ?? 0);
    const gstRate = Number(it.gstRate ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) problems.push(`${n}: quantity must be greater than zero.`);
    else if (decimalsOf(quantity) > 3) problems.push(`${n}: quantity can have at most 3 decimals.`);
    if (!Number.isFinite(rate) || rate < 0) problems.push(`${n}: rate cannot be negative.`);
    else if (decimalsOf(rate) > 4) problems.push(`${n}: rate can have at most 4 decimals.`);
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) problems.push(`${n}: GST rate must be between 0 and 100.`);
    else if (decimalsOf(gstRate) > 2) problems.push(`${n}: GST rate can have at most 2 decimals.`);
    if (!Number.isFinite(discountAmount) || discountAmount < 0) problems.push(`${n}: discount cannot be negative.`);
    else if (decimalsOf(discountAmount) > 2) problems.push(`${n}: discount can have at most 2 decimals.`);

    // An invalid figure is already reported above; count it as 0 below so it
    // does not raise a second, misleading message.
    const q = Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
    const r = Number.isFinite(rate) && rate >= 0 ? rate : 0;
    const grossAmount = round2(q * r);
    const discount = round2(Number.isFinite(discountAmount) ? discountAmount : 0);
    if (discount > grossAmount + EPS) problems.push(`${n}: discount (${discount}) is more than the line amount (${grossAmount}).`);
    const taxableAmount = round2(Math.max(0, grossAmount - discount));
    const g = Number.isFinite(gstRate) ? gstRate : 0;
    const taxAmount = round2(taxableAmount * g / 100);
    return {
      ...(it._id ? { _id: it._id } : {}),
      skuId: it.skuId,
      skuCode: it.skuCode || '',
      itemName: it.itemName || '',
      description: String(it.description || '').trim(),
      hsn: String(it.hsn || '').trim(),
      quantity: q,
      unit: it.unit || '',
      rate: r,
      grossAmount,
      discountAmount: discount,
      taxableAmount,
      gstRate: g,
      taxAmount,
      lineTotal: round2(taxableAmount + taxAmount),
    };
  });
  const sum = (k) => round2(lines.reduce((s, l) => s + l[k], 0));
  const totals = {
    grossAmount: sum('grossAmount'),
    discountTotal: sum('discountAmount'),
    taxableAmount: sum('taxableAmount'),
    taxAmount: sum('taxAmount'),
  };
  totals.grandTotal = round2(totals.taxableAmount + totals.taxAmount);
  return { lines, totals, problems };
};

/** Active Vendor Master record, or a 400 that says why not. */
export const resolveDirectPurchaseVendor = async (vendorId) => {
  if (!vendorId) throw new AppError('Select the vendor from the Vendor Master', 400);
  if (!mongoose.isValidObjectId(vendorId)) throw new AppError('Vendor not found in the Vendor Master', 400);
  const vendor = await Vendor.findOne({ _id: vendorId, isDeleted: { $ne: true } })
    .select('name isActive products.skuId products.hsn').lean();
  if (!vendor) throw new AppError('Vendor not found in the Vendor Master', 400);
  if (vendor.isActive === false) throw new AppError(`Vendor "${vendor.name}" is inactive in the Vendor Master`, 400);
  return vendor;
};

/**
 * Bind every line to its SKU Master record (name / code / unit from the SKU)
 * and refuse unknown, inactive, deleted, finished-good or scrap SKUs. HSN falls
 * back to the vendor's own HSN for that SKU when the line has none.
 */
export const bindDirectPurchaseItems = async (items = [], vendor = null) => {
  if (!Array.isArray(items) || !items.length) throw new AppError('Add at least one purchase item', 400);
  if (items.length > MAX_DIRECT_PURCHASE_ITEMS) throw new AppError(`A direct purchase voucher can hold at most ${MAX_DIRECT_PURCHASE_ITEMS} items`, 400);
  // Only an id picked from the SKU list is accepted — never a typed code.
  const missing = items.findIndex((it) => !it?.skuId);
  if (missing >= 0) throw new AppError(`Item ${missing + 1}: pick the item from the SKU Master list.`, 400);
  const ids = [...new Set(items.map((it) => String(it.skuId)))].filter((x) => mongoose.isValidObjectId(x));
  const skus = ids.length
    ? await SKU.find({ _id: { $in: ids }, isDeleted: { $ne: true }, isActive: { $ne: false } })
      .select('_id code name unit purchaseUnit purchaseConversionFactor itemType category').lean()
    : [];
  const { items: bound, problems } = bindItemsToSkus(items, skus);
  if (problems.length) throw new AppError(problems.join(' '), 400);
  await assertPurchasable(bound);
  const vendorHsn = new Map((vendor?.products || []).filter((p) => p.skuId && p.hsn).map((p) => [String(p.skuId), p.hsn]));
  return bound.map((it) => ({ ...it, hsn: String(it.hsn || '').trim() || vendorHsn.get(String(it.skuId)) || '' }));
};

// The duplicate-bill lookup is shared by every document that records a vendor
// bill number (billNumber.js); re-exported so the voucher service keeps one import.
export { findBillNumberUse, assertBillNumberFree } from './billNumber.js';

/**
 * Other live documents of the same supplier already using this voucher's
 * invoice number — the write-then-verify race check (two concurrent saves of
 * one bill may both be refused, never both kept). Returns the conflict message
 * or null.
 */
export const directPurchaseNumberConflictAfterWrite = async (v) => {
  if (v?.voucherType !== VOUCHER_TYPE.DIRECT_PURCHASE || v.isDeleted || v.voucherStatus === VOUCHER_STATUS.CANCELLED) return null;
  return billNumberUseMessage(await findBillNumberUse(v.vendorId, v.invoiceNumber, { excludeVoucherId: v._id })) || null;
};

/**
 * Validate a full (merged) direct purchase payload and return the fields to
 * store: vendor, items and totals. Throws AppError 400 on any rule.
 */
export const resolveDirectPurchase = async (data, { excludeVoucherId = null, keepStoredItems = false } = {}) => {
  const invoiceNumber = String(data.invoiceNumber || '').trim();
  if (!invoiceNumber) throw new AppError('Vendor Invoice Number is required', 400);
  if (!data.invoiceDate) throw new AppError('Invoice Date is required', 400);
  const vendor = await resolveDirectPurchaseVendor(data.vendorId);
  // keepStoredItems: a header-only draft edit — the saved lines were bound to
  // the SKU Master when they were saved and are recomputed, not re-bound.
  if (keepStoredItems && !(data.items || []).length) throw new AppError('Add at least one purchase item', 400);
  const bound = keepStoredItems ? data.items : await bindDirectPurchaseItems(data.items, vendor);
  const { lines, totals, problems } = computeDirectPurchaseLines(bound);
  if (problems.length) throw new AppError(problems.join(' '), 400);
  if (!(totals.grandTotal > 0)) throw new AppError('The voucher total must be greater than zero', 400);
  await assertBillNumberFree(vendor._id, invoiceNumber, { excludeVoucherId });
  return {
    vendorId: vendor._id,
    vendorName: vendor.name,
    invoiceNumber,
    items: lines,
    grossAmount: totals.grossAmount,
    discountTotal: totals.discountTotal,
    taxableAmount: totals.taxableAmount,
    taxAmount: totals.taxAmount,
    invoiceAmount: totals.grandTotal,
    totalAmountPayable: totals.grandTotal,
    netPayableAmount: totals.grandTotal,
  };
};
