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
 * Quotation upload, quotation approval and vendor selection are separate things: a
 * quotation (or a vendor named on its file) never selects a vendor. A vendor is
 * selected only by an explicit act — Step 1.3 approval WITH a vendor, a Quote
 * Required = No pick, Pending for PO, or the vendor chosen on the PO itself.
 *
 * How firmly a recorded vendor holds the PO:
 *   · approved with the quotation (APPROVED_QUOTATION) → LOCKED, the PO must use it;
 *   · picked on a Quote Required = No item (PO_PREPARATION) → a PRESELECTION the PO
 *     starts from; the user may change it on the PO (the change is audited).
 * Any other item takes ANY active Vendor Master vendor on the PO — "Select Previous
 * Vendor" and "Add New Vendor" are two ways to choose it, not two eligibility rules.
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
 * Whether the item's vendor is LOCKED: it was approved together with the quotation (Step 1.3,
 * vendorSource APPROVED_QUOTATION), so the PO must use it. A vendor picked on a Quote Required = No
 * item (PO_PREPARATION) is only a preselection — the PO may be raised on another vendor — and an
 * item with no vendor recorded is open.
 */
export const itemVendorLocked = (indent, item) => {
  const s = itemVendorState(indent, item);
  return s.state === ITEM_VENDOR_STATE.SET && s.vendorSource === ITEM_VENDOR_SOURCE.APPROVED_QUOTATION;
};

/**
 * Problems that stop `vendorId` from supplying the given indent items on one PO, for the items whose
 * vendor is LOCKED by their approved quotation (itemVendorLocked). `entries` = [{ indent, item, ref }]
 * (ref = item display number for messages); `vendorsById` = Map(id → Vendor-master doc) for the locked
 * vendors involved, so one since deleted or deactivated in the master is reported. Open items and
 * Quote Required = No preselections are not held here — poPickedVendorProblems checks the vendor chosen
 * for them. Returns [] when the PO may be raised. `skipMissing` is kept for callers that still pass it.
 */
export const poVendorProblems = (entries, vendorId, vendorsById = new Map()) => {
  const problems = [];
  for (const { indent, item, ref } of entries) {
    if (!itemVendorLocked(indent, item)) continue;
    const label = itemLabel(item, ref);
    const s = itemVendorState(indent, item);
    const fixed = vendorsById.get(String(s.vendorId));
    if (!fixed || fixed.isDeleted) {
      problems.push(`${label}: vendor "${s.vendorName}" no longer exists in the Vendor Master`);
    } else if (fixed.isActive === false) {
      problems.push(`${label}: vendor "${s.vendorName}" is inactive in the Vendor Master — reactivate it`);
    } else if (!sameId(s.vendorId, vendorId)) {
      problems.push(`${label}: the approved quotation is "${s.vendorName}" — this PO's vendor must be the same`);
    }
  }
  return problems;
};

/**
 * The vendor chosen on the PO for every item whose vendor is not locked by an approved quotation (no
 * vendor yet, or a Quote Required = No preselection being changed): ANY active Vendor Master vendor.
 * It is never limited to quoted or previous vendors — "Add New Vendor" must work for an item with no
 * purchase history. `vendor` = the PO vendor's Vendor Master record, or null / undefined when it is not
 * one (unknown id, or a legacy Party). Returns [] when the vendor may supply every open item.
 */
export const poPickedVendorProblems = (entries, vendor) => {
  const open = entries.filter(({ indent, item }) => !itemVendorLocked(indent, item));
  if (!open.length) return [];
  const first = itemLabel(open[0].item, open[0].ref);
  const label = open.length > 1 ? `${first} and ${open.length - 1} more item${open.length > 2 ? 's' : ''}` : first;
  if (!vendor || vendor.isDeleted) return [`${label}: the PO vendor must be an active vendor from the Vendor Master`];
  if (vendor.isActive === false) return [`${label}: vendor "${vendor.name || ''}" is inactive in the Vendor Master — choose an active vendor`];
  return [];
};

/** A JSL-format PO is always raised on Jindal Stainless Ltd (the PO form forces it; the server holds to it). */
export const isJslVendorName = (name) => /jindal/i.test(String(name || ''));

/** Distinct LOCKED vendor ids among the entries (for the Vendor-master lookup poVendorProblems needs). */
export const fixedVendorIds = (entries) => [...new Set(entries
  .map(({ indent, item }) => itemVendorState(indent, item))
  .filter((s) => s.state === ITEM_VENDOR_STATE.SET && s.vendorSource === ITEM_VENDOR_SOURCE.APPROVED_QUOTATION)
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
