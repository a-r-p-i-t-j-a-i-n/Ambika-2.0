/**
 * PO rate change rules (Purchase FMS — Rate Change Approvals). Pure — no
 * database — so the decisions are unit-testable.
 *
 * The authoritative vendor rate is the vendor's own catalog row in the Vendor
 * Master (Vendor.products[]): one rate per vendor + SKU (+ unit). A different
 * vendor's row for the same SKU is a different rate, and a vendor may carry the
 * same SKU in two units — so a PO line is matched to the row of ITS vendor, SKU
 * and unit, never to "the" rate of a SKU.
 */
import { sameUnit } from '../../skus/unitConversion.js';
import { isMdForDirectSave } from '../purchase-order/poDirectSave.js';

const upper = (s) => String(s || '').trim().toUpperCase();
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;

/** A usable rate: a finite number ≥ 0 (no NaN / Infinity / negative). */
export const isValidRate = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Two rates are the same price (compared to 4 decimals, so 99.999999 ≠ 100 but float noise is ignored). */
export const sameRate = (a, b) => a != null && b != null && a !== '' && b !== ''
  && Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && round4(a) === round4(b);

// A catalog row with no unit (very old data) prices whatever unit the line uses.
const unitFits = (product, lineUnit) => !String(product?.unit || '').trim() || sameUnit(product.unit, lineUnit);

/**
 * The vendor's catalog rows for a PO line, matched the way the PO form and
 * pricing history match them: SKU code → SKU id → exact item name (the first
 * key that finds anything wins). Then narrowed to the line's unit.
 *   { product }                          exactly one row prices this line
 *   { product: null, problem: 'NONE' }   the vendor has no rate for this item
 *   { problem: 'UNIT_MISMATCH', candidates }  rows exist, but in another unit
 *   { problem: 'AMBIGUOUS', candidates }      several rows, different rates, same unit
 */
export const matchVendorRate = (products = [], line = {}) => {
  const rows = products || [];
  let candidates = [];
  if (line.skuCode) candidates = rows.filter((p) => p.skuCode && upper(p.skuCode) === upper(line.skuCode));
  if (!candidates.length && line.skuId) candidates = rows.filter((p) => p.skuId && String(p.skuId) === String(line.skuId));
  if (!candidates.length && line.itemName) candidates = rows.filter((p) => p.productName && norm(p.productName) === norm(line.itemName));
  if (!candidates.length) return { product: null, problem: 'NONE', candidates: [] };

  const inUnit = candidates.filter((p) => unitFits(p, line.unit));
  if (!inUnit.length) return { product: null, problem: 'UNIT_MISMATCH', candidates };
  if (inUnit.length > 1 && !inUnit.every((p) => sameRate(p.rate, inUnit[0].rate))) {
    return { product: null, problem: 'AMBIGUOUS', candidates: inUnit };
  }
  return { product: inUnit[0], problem: null, candidates: inUnit };
};

export const LINE_RATE = {
  NO_SOURCE:     'NO_SOURCE',     // vendor has no rate for this item yet — nothing was fetched
  MATCHES:       'MATCHES',       // the line uses the vendor's rate
  QUOTATION:     'QUOTATION',     // the rate approved in the item's quotation (Step 1.3)
  CHANGED:       'CHANGED',       // the line's rate differs from the vendor's → needs approval
  UNIT_MISMATCH: 'UNIT_MISMATCH', // changed, but the vendor prices this item in another unit
  AMBIGUOUS:     'AMBIGUOUS',     // changed, and the vendor has several rates for it in this unit
};

/**
 * Classify one OTHER-format PO line against its vendor's catalog.
 * `quotationRate` = the rate approved for this vendor + item at Step 1.3 (multi-
 * vendor indents), if any — a line at that rate is not a doer's change.
 */
export const evaluateLineRate = ({ line = {}, products = [], quotationRate = null } = {}) => {
  const rate = Number(line.rate);
  if (quotationRate != null && sameRate(rate, quotationRate)) {
    return { state: LINE_RATE.QUOTATION, product: null, vendorRate: null };
  }
  const { product, problem, candidates } = matchVendorRate(products, line);
  if (problem === 'NONE') return { state: LINE_RATE.NO_SOURCE, product: null, vendorRate: null };
  if (problem) {
    // The rate the form fetched (from one of these rows) and the doer kept is
    // not a change, whatever the unit.
    const kept = candidates.find((p) => sameRate(p.rate, rate));
    if (kept) return { state: LINE_RATE.MATCHES, product: kept, vendorRate: Number(kept.rate) };
    return { state: LINE_RATE[problem], product: null, vendorRate: null, candidates };
  }
  const vendorRate = Number(product.rate) || 0;
  return {
    state: sameRate(rate, vendorRate) ? LINE_RATE.MATCHES : LINE_RATE.CHANGED,
    product,
    vendorRate,
  };
};

/** Why a changed rate cannot be sent for approval as it stands ('' = it can). */
export const unsendableReason = (evaluation, line = {}, vendorName = 'the vendor') => {
  const item = line.itemName || line.skuCode || 'an item';
  if (evaluation.state === LINE_RATE.UNIT_MISMATCH) {
    const units = [...new Set(evaluation.candidates.map((p) => p.unit).filter(Boolean))].join(' / ');
    return `${vendorName} prices "${item}" per ${units || 'another unit'}, but the PO line is in ${line.unit || 'no unit'} — `
      + `put the line in ${units || 'the vendor\'s unit'} to change its rate, or correct the unit in the Vendor Master`;
  }
  if (evaluation.state === LINE_RATE.AMBIGUOUS) {
    const rates = evaluation.candidates.map((p) => p.rate).join(', ');
    return `${vendorName} has ${evaluation.candidates.length} different rates for "${item}" in ${line.unit} (${rates}) — `
      + 'remove the duplicate in the Vendor Master before changing the rate';
  }
  return '';
};

/** Difference from one rate to another: amount per unit and percent (null when the base is 0 / missing). */
export const rateDiff = (from, to) => {
  if (from == null || !Number.isFinite(Number(from))) return { amount: null, percent: null };
  const amount = round4(Number(to) - Number(from));
  const percent = Number(from) > 0 ? round2((amount / Number(from)) * 100) : null;
  return { amount, percent };
};

export const RATE_REASON_MAX = 500;
export const REJECTION_REASON_MIN = 3;

/**
 * May `user` decide `request`? The approver permission is checked by the route;
 * this is the self-approval rule. The requester may not approve their own rate
 * change — except the MD, whose own POs already skip approval ("Save PO
 * Directly", poDirectSave.js). Rejecting your own request (withdrawing it) is
 * always allowed: it changes no rate.
 */
export const selfApprovalBlock = (user, request) => {
  if (!user || !request) return '';
  const own = request.requestedBy && String(request.requestedBy) === String(user._id);
  if (!own) return '';
  if (isMdForDirectSave(user)) return '';
  return 'You raised this rate change — another approver has to approve it';
};

/** True when `user` is approving a request they raised (allowed only for the MD). */
export const isSelfApproval = (user, request) => Boolean(user && request?.requestedBy
  && String(request.requestedBy) === String(user._id));

/** A PO line's amounts at its rate (OTHER format: taxable = qty × rate, tax = taxable × GST%). */
export const otherLineAmounts = (line = {}) => {
  const taxableAmount = round2((Number(line.quantity) || 0) * (Number(line.rate) || 0));
  const taxAmount = round2(taxableAmount * (Number(line.gstRate) || 0) / 100);
  return { taxableAmount, taxAmount, totalAmount: round2(taxableAmount + taxAmount) };
};

/** PO header totals from its lines' stored amounts. */
export const poTotals = (items = []) => {
  const totalTaxableValue = round2(items.reduce((s, l) => s + (Number(l.taxableAmount) || 0), 0));
  const totalGSTAmount = round2(items.reduce((s, l) => s + (Number(l.taxAmount) || 0), 0));
  return { totalTaxableValue, totalGSTAmount, grandTotal: round2(totalTaxableValue + totalGSTAmount) };
};

/** Readable money for messages (₹1,234.50). */
export const inr = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`);
