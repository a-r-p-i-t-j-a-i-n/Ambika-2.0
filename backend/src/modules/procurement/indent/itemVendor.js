/**
 * Vendor selection per indent item — which vendor will supply an approved item,
 * and how the Purchase Order is held to it.
 *
 * The vendor is chosen per indent ITEM (an indent can feed several POs, one per
 * vendor — the same grain as items[].procurementStatus / poId). Where it comes
 * from depends on the item's quotation path:
 *
 *   REQUIRED      Step 1.2 received a quotation for the item → the vendor is the
 *                 one approved at Step 1.3 (vendorSource APPROVED_QUOTATION).
 *                 Missing (quotation approved before vendors were captured) →
 *                 no PO until the approved vendor is confirmed.
 *   NOT_REQUIRED  Steps 1.2/1.3 skipped for the item → the doer may pre-select a
 *                 vendor on Pending for PO (vendorSource PO_PREPARATION); with
 *                 none selected, the PO form's own Vendor field decides.
 *
 * Indents approved the older vendor-grain way (Step 1.3 approvedVendors[]) keep
 * that path: the PO vendor must be one of those approved vendors.
 *
 * Pure: no DB access.
 */

export const ITEM_VENDOR_SOURCE = {
  APPROVED_QUOTATION: 'APPROVED_QUOTATION',
  PO_PREPARATION:     'PO_PREPARATION',
};

export const QUOTATION_PATH = {
  REQUIRED:     'REQUIRED',
  NOT_REQUIRED: 'NOT_REQUIRED',
};

// SET — a vendor is fixed for the item · MISSING — quotation-required item with
// no approved vendor (PO blocked) · UNASSIGNED — not-required item, vendor still open.
export const ITEM_VENDOR_STATE = {
  SET:        'SET',
  MISSING:    'MISSING',
  UNASSIGNED: 'UNASSIGNED',
};

const sameId = (a, b) => !!a && !!b && String(a) === String(b);
const rowFor = (rows, item) => (rows || []).find((r) => sameId(r?.itemId, item?._id));

/** Older indents approved per vendor (Step 1.3 approvedVendors[]) — not item-wise. */
export const usesApprovedVendorList = (indent) => (indent?.quotationApprovalStep?.approvedVendors?.length || 0) > 0;

/** Whether the item went through the quotation steps (REQUIRED) or skipped them (NOT_REQUIRED). */
export const itemQuotationPath = (indent, item) => {
  const step12 = indent?.quoteComparativeStep;
  const step13 = indent?.quotationApprovalStep;
  const wholeIndentSkipped = !!step13?.skipped
    || step12?.statusDone === 'QUOTE_NOT_REQUIRED'
    || (!step12?.statusDone && indent?.quoteStep?.status === 'NOT_REQUIRED');
  if (wholeIndentSkipped) return QUOTATION_PATH.NOT_REQUIRED;
  if (rowFor(step12?.itemQuotations, item)?.statusDone === 'QUOTE_NOT_REQUIRED') return QUOTATION_PATH.NOT_REQUIRED;
  if (rowFor(step13?.itemApprovedQuotations, item)?.statusDone === 'QUOTE_NOT_REQUIRED') return QUOTATION_PATH.NOT_REQUIRED;
  return QUOTATION_PATH.REQUIRED;
};

/**
 * The vendor an approved item must be bought from. A vendor recorded under the
 * other path's source never counts (e.g. a Pending-for-PO pick left on an item
 * whose quotation became required again).
 */
export const itemVendorState = (indent, item) => {
  const path = itemQuotationPath(indent, item);
  const wanted = path === QUOTATION_PATH.REQUIRED ? ITEM_VENDOR_SOURCE.APPROVED_QUOTATION : ITEM_VENDOR_SOURCE.PO_PREPARATION;
  const has = !!item?.vendorId && item?.vendorSource === wanted;
  let state = ITEM_VENDOR_STATE.SET;
  if (!has) state = path === QUOTATION_PATH.REQUIRED ? ITEM_VENDOR_STATE.MISSING : ITEM_VENDOR_STATE.UNASSIGNED;
  return {
    path,
    state,
    vendorId: has ? item.vendorId : null,
    vendorName: has ? (item.vendorName || '') : '',
    vendorSource: has ? wanted : '',
  };
};

/** Display reference for messages, e.g. "Ind-50.1/26-27 (Steel Coil)". */
const itemLabel = (item, ref) => `${ref || 'Item'}${item?.itemName ? ` (${item.itemName})` : ''}`;

/**
 * Problems that stop `vendorId` from supplying the given indent items on one PO.
 * `entries` = [{ indent, item, ref }] (ref = item display number for messages);
 * `vendorsById` = Map(id → Vendor-master doc) for the fixed vendors involved, so
 * a fixed vendor since deleted or deactivated in the master is reported.
 * Returns [] when the PO may be raised. `skipMissing` — editing a PO that already
 * holds the items: a legacy item with no approved vendor stays editable there.
 */
export const poVendorProblems = (entries, vendorId, vendorsById = new Map(), { skipMissing = false } = {}) => {
  const problems = [];
  for (const { indent, item, ref } of entries) {
    const label = itemLabel(item, ref);
    const s = itemVendorState(indent, item);
    if (s.state === ITEM_VENDOR_STATE.MISSING) {
      if (skipMissing) continue;
      problems.push(`${label}: the approved quotation has no vendor recorded — confirm the approved vendor on Pending for PO before raising a PO`);
      continue;
    }
    if (s.state !== ITEM_VENDOR_STATE.SET) continue;
    const fixed = vendorsById.get(String(s.vendorId));
    if (!fixed || fixed.isDeleted) {
      problems.push(`${label}: vendor "${s.vendorName}" no longer exists in the Vendor Master`);
    } else if (fixed.isActive === false) {
      problems.push(`${label}: vendor "${s.vendorName}" is inactive in the Vendor Master — reactivate it${s.path === QUOTATION_PATH.NOT_REQUIRED ? ' or select another vendor on Pending for PO' : ''}`);
    } else if (!sameId(s.vendorId, vendorId)) {
      const why = s.vendorSource === ITEM_VENDOR_SOURCE.APPROVED_QUOTATION ? 'approved quotation' : 'vendor selected on Pending for PO';
      problems.push(`${label}: the ${why} is "${s.vendorName}" — this PO's vendor must be the same`);
    }
  }
  return problems;
};

/** Distinct fixed vendor ids among the entries (for the Vendor-master lookup). */
export const fixedVendorIds = (entries) => [...new Set(entries
  .map(({ indent, item }) => itemVendorState(indent, item))
  .filter((s) => s.state === ITEM_VENDOR_STATE.SET)
  .map((s) => String(s.vendorId)))];

// ── Who quoted (Step 1.2 vendor-tagged quotation files) ─────────────────────
// Each Step 1.2 item-wise quotation file can name the vendor who sent it (Vendor
// Master) with its quoted rate / delivery days. Step 1.3 then approves the item
// for one of THOSE vendors — not any vendor in the master. Files saved before
// vendors were recorded name none; such an item keeps the Vendor Master choice.

const numOrNull = (n) => (n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? null : Number(n));

/**
 * Distinct vendors named on a list of quotation files, in first-seen order —
 * [{ vendorId, vendorName, quotedRate, deliveryDays, files }] with the lowest
 * quoted rate and shortest delivery seen for that vendor (null = not given).
 */
export const vendorsOnQuotationFiles = (docs) => {
  const byId = new Map();
  (docs || []).forEach((d) => {
    if (!d?.vendorId) return;
    const id = String(d.vendorId);
    const rate = numOrNull(d.quotedRate);
    const days = numOrNull(d.deliveryDays);
    const cur = byId.get(id);
    if (!cur) {
      byId.set(id, { vendorId: id, vendorName: d.vendorName || '', quotedRate: rate, deliveryDays: days, files: 1 });
      return;
    }
    cur.files += 1;
    if (!cur.vendorName && d.vendorName) cur.vendorName = d.vendorName;
    if (rate !== null && (cur.quotedRate === null || rate < cur.quotedRate)) cur.quotedRate = rate;
    if (days !== null && (cur.deliveryDays === null || days < cur.deliveryDays)) cur.deliveryDays = days;
  });
  return [...byId.values()];
};

/** Vendors who quoted for the item at Step 1.2. */
export const quotedVendorsOf = (indent, item) => vendorsOnQuotationFiles(
  rowFor(indent?.quoteComparativeStep?.itemQuotations, item)?.quotationDocuments,
);

/** Vendors whose quotation was kept (approved) for the item at Step 1.3. */
export const keptVendorsOf = (indent, item) => vendorsOnQuotationFiles(
  rowFor(indent?.quotationApprovalStep?.itemApprovedQuotations, item)?.approvedQuotationDocuments,
);

/**
 * Why `vendorId` cannot be the approved vendor of an item ('' = it can). Applies
 * only once Step 1.2 recorded who quoted (`quoted` non-empty): the vendor must
 * have quoted for this item and, when the kept (approved) files name vendors
 * (`kept`), its quotation must be one of those kept.
 */
export const approvedVendorProblem = ({ quoted = [], kept = [], vendorId, vendorName = '', itemName = '' }) => {
  if (!quoted.length || !vendorId) return '';
  const who = vendorName ? `"${vendorName}"` : 'The selected vendor';
  const names = (list) => list.map((v) => v.vendorName || 'vendor').join(', ');
  if (!quoted.some((v) => sameId(v.vendorId, vendorId))) {
    return `${who} did not quote for "${itemName}" — the approved vendor must be one who quoted: ${names(quoted)}`;
  }
  if (kept.length && !kept.some((v) => sameId(v.vendorId, vendorId))) {
    return `${who}'s quotation for "${itemName}" was removed — keep its quotation, or approve a vendor whose quotation is kept: ${names(kept)}`;
  }
  return '';
};
