/**
 * Vendor selection per approved indent item (backend indent/itemVendor.js). Rows
 * come from GET /procurement/purchase-orders/approved-items, which already says
 * the item's quotation path and whether a vendor was explicitly selected:
 *   vendorState SET        — a vendor was selected on purpose:
 *                              APPROVED_QUOTATION  approved with the quotation (Step 1.3) → LOCKED, the PO must use it
 *                              PO_PREPARATION      picked on a Quote Required = No item → a PRESELECTION the PO starts from; the user may change it
 *   vendorState MISSING    — quotation required, approved WITHOUT a vendor → NO vendor: the user chooses one on the PO
 *   vendorState UNASSIGNED — quotation not required, vendor still open → NO vendor: the user chooses one on the PO
 * A quotation (or a vendor named on its file) never selects a vendor. On the PO the user chooses with
 * "Select Previous Vendor" (row.previousVendors — placed-PO history) or "Add New Vendor" (any active
 * Vendor Master vendor). Nothing is ever picked automatically.
 */

export const VENDOR_SOURCE_LABEL = {
  APPROVED_QUOTATION: 'From approved quotation',
  PO_PREPARATION: 'Selected on Pending for PO',
};

/** A vendor approved WITH the quotation (Step 1.3): the PO must use it. */
export const isLockedRow = (row) => row?.vendorState === 'SET' && Boolean(row.vendorId) && row.vendorSource === 'APPROVED_QUOTATION';

/** A vendor picked on a Quote Required = No item: kept on the PO unless the user changes it. */
export const isPreselectedRow = (row) => row?.vendorState === 'SET' && Boolean(row.vendorId) && row.vendorSource !== 'APPROVED_QUOTATION';

/** The active Vendor Master vendors (anything not explicitly deactivated). */
export const activeVendors = (vendors = []) => vendors.filter((v) => v && v._id && v.isActive !== false);

/**
 * "Select Previous Vendor" options for an approved-item row: the vendors that really supplied it before
 * (row.previousVendors — placed POs) and are still active. Each is the Vendor Master record (so the PO form
 * has its GST / terms) plus the purchase reference it was listed for. Latest purchase first (server order).
 */
export const previousVendorOptions = (row, vendors = []) => {
  const byId = new Map(activeVendors(vendors).map((v) => [String(v._id), v]));
  return (row?.previousVendors || [])
    .filter((h) => byId.has(String(h.vendorId)))
    .map((h) => ({ ...byId.get(String(h.vendorId)), _previous: h }));
};

/** "Add New Vendor" options: every active Vendor Master vendor — no purchase history needed. */
export const newVendorOptions = (vendors = []) => activeVendors(vendors);

/** Purchase reference shown under a previous vendor: "Last PO VP/PO/3 · 20 Oct 26 · ₹95 · 2 POs". */
export const previousVendorCaption = (h, fmtDate = (d) => String(d || '')) => {
  if (!h) return '';
  const rate = Number(h.lastRate);
  return [
    h.lastPoNumber ? `Last PO ${h.lastPoNumber}` : '',
    h.lastPoDate ? fmtDate(h.lastPoDate) : '',
    Number.isFinite(rate) && rate > 0 ? `₹${rate.toLocaleString('en-IN')}` : '',
    h.poCount > 1 ? `${h.poCount} POs` : '',
  ].filter(Boolean).join(' · ');
};

/** Why no PO can be raised for this row yet ('' = it can). A missing vendor is NOT a block — it is chosen on the PO. */
export const itemVendorBlock = (row) => {
  if (row?.vendorUnavailable) return `Vendor "${row.vendorName}" is inactive or removed in the Vendor Master`;
  return '';
};

/**
 * Vendors already fixed for the given approved-item rows, each with its items
 * that can go on a PO now — rows with a missing or inactive / removed vendor are
 * left out (their PO would be refused). Sorted by vendor name.
 */
export const assignedVendorsOf = (rows = []) => {
  const byId = new Map();
  rows.forEach((r) => {
    if (r.vendorState !== 'SET' || !r.vendorId || itemVendorBlock(r)) return;
    const id = String(r.vendorId);
    if (!byId.has(id)) byId.set(id, { vendorId: id, vendorName: r.vendorName, items: [] });
    byId.get(id).items.push(r);
  });
  return [...byId.values()].sort((a, b) => a.vendorName.localeCompare(b.vendorName));
};

/** One LOCKED vendor shared by all rows (approved with the quotation), a conflict, or none. A preselection is not locked. */
export const fixedVendorOf = (rows = []) => {
  const fixed = rows.filter(isLockedRow);
  const ids = [...new Set(fixed.map((r) => String(r.vendorId)))];
  if (ids.length > 1) return { conflict: true, vendors: [...new Set(fixed.map((r) => r.vendorName))] };
  if (!ids.length) return null;
  const f = fixed[0];
  return { conflict: false, vendorId: String(f.vendorId), vendorName: f.vendorName, vendorSource: f.vendorSource };
};
