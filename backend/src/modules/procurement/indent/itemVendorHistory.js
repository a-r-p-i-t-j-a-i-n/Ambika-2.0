/**
 * Previous vendors of an indent item — the vendors a "Quote Required? = No" item
 * may be pre-assigned to at Step 1.2.
 *
 * No new history is stored: it is read from what the app already keeps.
 *   PO     a PO line for the item's SKU on a PO that was really placed (approved
 *          onward — never a draft or a cancelled PO), naming the vendor.
 *   VENDOR the item's SKU is on the vendor's catalog in the Vendor Master
 *          (Vendor.products — "everything this vendor supplies"; the PO form
 *          also adds a product there when a vendor is first used for it).
 * Only a vendor that is still an active, non-deleted Vendor Master record can be
 * selected (a PO that names a legacy Party id has no Vendor record, so it never
 * lists). The SKU is matched by id, else by code, the same way PO lines are
 * traced elsewhere.
 *
 * `matchHistory` / `historyVendorProblem` are pure; `vendorHistoryForItems` reads
 * the DB once for any number of items.
 */
import Vendor from '../../vendors/vendor.model.js';
import VendorPurchaseOrder, { PO_STATUS } from '../purchase-order/purchaseOrder.model.js';
import { quotedVendorsOf } from './itemVendor.js';

/** PO statuses that count as a purchase (a draft was never placed, a cancelled PO was withdrawn). */
export const PURCHASED_PO_STATUSES = [
  PO_STATUS.APPROVED, PO_STATUS.RELEASED_TO_VENDOR, PO_STATUS.PARTIAL_RECEIVED,
  PO_STATUS.FULLY_RECEIVED, PO_STATUS.CLOSED,
];

const idOf = (v) => (v ? String(v) : '');
const codeOf = (v) => String(v || '').trim().toUpperCase();

/** Whether a PO line / catalog product (`row`) is the same SKU as the indent `item`. */
export const sameSku = (row, item) => {
  if (row?.skuId && item?.skuId) return idOf(row.skuId) === idOf(item.skuId);
  const code = codeOf(item?.skuCode);
  return !!code && codeOf(row?.skuCode) === code;
};

const keyOf = (item) => idOf(item?._id);

/**
 * Pure matcher. `items` = indent items; `pos` = lean POs {_id, vendorId, poNumber,
 * poDate, items[{skuId, skuCode, rate}]}; `catalogVendors` = Vendor docs with
 * `products`; `vendors` = the selectable (active) Vendor docs involved.
 * Returns Map(itemKey → [{ vendorId, vendorName, vendorCode, location, poCount,
 * lastPoNumber, lastPoDate, lastRate, inCatalog, basis }]) — PO-backed vendors
 * first (latest PO first), then catalog-only vendors by name.
 */
export const matchHistory = (items, pos, catalogVendors, vendors) => {
  const selectable = new Map((vendors || []).map((v) => [idOf(v._id), v]));
  const out = new Map();
  for (const item of items || []) {
    const byVendor = new Map();
    const entry = (vendorId) => {
      if (!byVendor.has(vendorId)) {
        const v = selectable.get(vendorId);
        byVendor.set(vendorId, {
          vendorId, vendorName: v?.name || '', vendorCode: v?.code || '', location: v?.location || '',
          poCount: 0, lastPoNumber: '', lastPoDate: null, lastRate: null, inCatalog: false, basis: [],
        });
      }
      return byVendor.get(vendorId);
    };
    for (const po of pos || []) {
      const vid = idOf(po.vendorId);
      if (!vid || !selectable.has(vid)) continue;
      const lines = (po.items || []).filter((l) => sameSku(l, item));
      if (!lines.length) continue;
      const e = entry(vid);
      e.poCount += 1;
      const when = po.poDate ? new Date(po.poDate) : null;
      if (when && (!e.lastPoDate || when > e.lastPoDate)) {
        e.lastPoDate = when;
        e.lastPoNumber = po.poNumber || '';
        const rate = Number(lines[lines.length - 1].rate);
        e.lastRate = Number.isFinite(rate) && rate > 0 ? rate : null;
      }
    }
    for (const v of catalogVendors || []) {
      const vid = idOf(v._id);
      if (!selectable.has(vid)) continue;
      if (!(v.products || []).some((p) => sameSku(p, item))) continue;
      entry(vid).inCatalog = true;
    }
    const list = [...byVendor.values()].map((e) => ({
      ...e,
      basis: [...(e.poCount ? ['PO'] : []), ...(e.inCatalog ? ['VENDOR'] : [])],
    }));
    list.sort((a, b) => {
      if (!!a.poCount !== !!b.poCount) return a.poCount ? -1 : 1;
      const da = a.lastPoDate ? a.lastPoDate.getTime() : 0;
      const db = b.lastPoDate ? b.lastPoDate.getTime() : 0;
      return db - da || a.vendorName.localeCompare(b.vendorName);
    });
    out.set(keyOf(item), list);
  }
  return out;
};

/**
 * Previous vendors for each of `items` (indent items carrying _id / skuId /
 * skuCode) → Map(itemId → vendors[]). One PO query + one Vendor query in total.
 */
export const vendorHistoryForItems = async (items) => {
  const list = (items || []).filter((it) => it && (it.skuId || codeOf(it.skuCode)));
  if (!list.length) return new Map((items || []).map((it) => [keyOf(it), []]));
  const skuIds = [...new Set(list.map((it) => idOf(it.skuId)).filter(Boolean))];
  const skuCodes = [...new Set(list.map((it) => codeOf(it.skuCode)).filter(Boolean))];
  const lineHit = [
    ...(skuIds.length ? [{ skuId: { $in: skuIds } }] : []),
    ...(skuCodes.length ? [{ skuCode: { $in: skuCodes } }] : []),
  ];

  const [pos, catalogVendors] = await Promise.all([
    VendorPurchaseOrder.find({
      isDeleted: { $ne: true },
      poStatus: { $in: PURCHASED_PO_STATUSES },
      items: { $elemMatch: { $or: lineHit } },
    }).select('vendorId poNumber poDate items.skuId items.skuCode items.rate').lean(),
    Vendor.find({
      isDeleted: { $ne: true },
      isActive: { $ne: false },
      products: { $elemMatch: { $or: lineHit } },
    }).select('name code location products.skuId products.skuCode').lean(),
  ]);

  // Selectable vendors = active Vendor Master records among every candidate.
  const candidateIds = [...new Set([...pos.map((p) => idOf(p.vendorId)), ...catalogVendors.map((v) => idOf(v._id))].filter(Boolean))];
  const vendors = candidateIds.length
    ? await Vendor.find({ _id: { $in: candidateIds }, isDeleted: { $ne: true }, isActive: { $ne: false } }).select('name code location').lean()
    : [];
  return matchHistory(items, pos, catalogVendors, vendors);
};

/**
 * Why `vendorId` cannot be pre-selected for an item ('' = it can). `history` is
 * the item's previous vendors (vendorHistoryForItems).
 */
export const historyVendorProblem = ({ history = [], vendorId, itemName = '' }) => {
  const label = `"${itemName || 'item'}"`;
  if (!history.length) {
    return `No previous vendors found for ${label} — a vendor can only be selected from an item's purchase history. Set Quote Required to Yes and collect quotations instead`;
  }
  if (!vendorId) return `Select the vendor for ${label}`;
  if (!history.some((h) => idOf(h.vendorId) === idOf(vendorId))) {
    return `The selected vendor has not supplied ${label} before — choose one of its previous vendors: ${history.map((h) => h.vendorName).join(', ')}`;
  }
  return '';
};

// ── Eligible vendors = quoted OR previously supplied ─────────────────────────
// The vendors an item may be bought from when no vendor is fixed for it yet:
//   QUOTED   a Step 1.2 quotation file for THIS item names the vendor (Vendor Master id)
//   PO / VENDOR  the item's purchase history above (placed PO line / Vendor Master item list)
// The union is the one rule used by Step 1.3, Pending for PO and the PO itself
// (create / edit / submit). Never the whole Vendor Master; only active, non-deleted
// Vendor Master records. Step 1.2 "Quote Not Required" items have no quotation, so
// for them the history alone applies.

/** Vendors who quoted for the item at Step 1.2 (none for a "Quote Not Required" item). */
export const quotedVendorsForItem = (indent, item) => {
  const row = (indent?.quoteComparativeStep?.itemQuotations || []).find((r) => idOf(r?.itemId) === idOf(item?._id));
  if (row?.statusDone === 'QUOTE_NOT_REQUIRED') return [];
  return quotedVendorsOf(indent, item);
};

/**
 * Pure: merge an item's purchase history with the vendors who quoted for it.
 * `vendorsById` = Map(id → active Vendor doc) — a quoted vendor missing from it
 * (deleted / inactive) is dropped. Quoted vendors come first; each entry carries
 * `basis` (QUOTED / PO / VENDOR) and, when quoted, the lowest quotedRate / deliveryDays.
 */
export const mergeEligibleVendors = (history = [], quoted = [], vendorsById = new Map()) => {
  const out = new Map();
  (history || []).forEach((h) => out.set(idOf(h.vendorId), { ...h, quoted: false, quotedRate: null, deliveryDays: null, basis: [...(h.basis || [])] }));
  (quoted || []).forEach((q) => {
    const id = idOf(q.vendorId);
    const v = vendorsById.get(id);
    if (!id || !v) return;
    const cur = out.get(id) || {
      vendorId: id, vendorName: v.name || q.vendorName || '', vendorCode: v.code || '', location: v.location || '',
      poCount: 0, lastPoNumber: '', lastPoDate: null, lastRate: null, inCatalog: false, basis: [],
    };
    cur.quoted = true;
    cur.quotedRate = q.quotedRate ?? null;
    cur.deliveryDays = q.deliveryDays ?? null;
    cur.basis = ['QUOTED', ...cur.basis.filter((b) => b !== 'QUOTED')];
    out.set(id, cur);
  });
  return [...out.values()].sort((a, b) => (a.quoted === b.quoted ? 0 : a.quoted ? -1 : 1));
};

/**
 * Eligible vendors for each of `entries` = [{ indent, item }] → Map(itemId → vendors[]).
 * One purchase-history lookup plus one Vendor lookup for the quoted vendors.
 */
export const eligibleVendorsForItems = async (entries) => {
  const list = (entries || []).filter((e) => e?.item);
  const history = await vendorHistoryForItems(list.map((e) => e.item));
  const quotedBy = new Map(list.map((e) => [keyOf(e.item), quotedVendorsForItem(e.indent, e.item)]));
  const quotedIds = [...new Set([...quotedBy.values()].flat().map((q) => idOf(q.vendorId)).filter(Boolean))];
  const vendors = quotedIds.length
    ? await Vendor.find({ _id: { $in: quotedIds }, isDeleted: { $ne: true }, isActive: { $ne: false } }).select('name code location').lean()
    : [];
  const byId = new Map(vendors.map((v) => [idOf(v._id), v]));
  const out = new Map();
  list.forEach((e) => {
    const k = keyOf(e.item);
    out.set(k, mergeEligibleVendors(history.get(k) || [], quotedBy.get(k) || [], byId));
  });
  return out;
};

/** Why `vendorId` is not an eligible vendor for the item ('' = it is). `eligible` = the item's eligible vendors. */
export const eligibleVendorProblem = ({ eligible = [], vendorId, itemName = '' }) => {
  const label = `"${itemName || 'item'}"`;
  if (!eligible.length) {
    return `No eligible vendors found for ${label} — none has quoted for it or supplied it before. Collect a quotation (Step 1.2) or add the SKU to a vendor's Vendor Master item list`;
  }
  if (!vendorId) return `Select the vendor for ${label}`;
  if (!eligible.some((h) => idOf(h.vendorId) === idOf(vendorId))) {
    return `The selected vendor has neither quoted for nor previously supplied ${label} — choose one of: ${eligible.map((h) => h.vendorName).join(', ')}`;
  }
  return '';
};
