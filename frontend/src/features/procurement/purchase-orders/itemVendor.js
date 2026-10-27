/**
 * Vendor selection per approved indent item (backend indent/itemVendor.js). Rows
 * come from GET /procurement/purchase-orders/approved-items, which already says
 * the item's quotation path and whether its vendor is fixed:
 *   vendorState SET        — the PO must use vendorId (approved quotation / Pending-for-PO pick)
 *   vendorState MISSING    — quotation required, approved before vendors were recorded → confirm first
 *   vendorState UNASSIGNED — quotation not required, vendor still open (PO form decides)
 */

export const VENDOR_SOURCE_LABEL = {
  APPROVED_QUOTATION: 'From approved quotation',
  PO_PREPARATION: 'Selected on Pending for PO',
};

/** Why no PO can be raised for this row yet ('' = it can). */
export const itemVendorBlock = (row) => {
  if (row?.vendorState === 'MISSING') return 'Approved vendor missing — confirm it before raising a PO';
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

/** One fixed vendor shared by all rows, a conflict, or none. */
export const fixedVendorOf = (rows = []) => {
  const fixed = rows.filter((r) => r.vendorState === 'SET' && r.vendorId);
  const ids = [...new Set(fixed.map((r) => String(r.vendorId)))];
  if (ids.length > 1) return { conflict: true, vendors: [...new Set(fixed.map((r) => r.vendorName))] };
  if (!ids.length) return null;
  const f = fixed[0];
  return { conflict: false, vendorId: String(f.vendorId), vendorName: f.vendorName, vendorSource: f.vendorSource };
};
