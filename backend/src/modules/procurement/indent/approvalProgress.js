/**
 * Step 1.3 item-wise progress — partial approval, holds and the vendor-history rule.
 *
 * Every quoted item (Step 1.2 "Quote Required? = Yes") is decided on its own:
 *
 *   APPROVED   a YES row with the approved vendor — the only rows that make an
 *              item PO-eligible (purchaseOrder.service approvedItemIdSet)
 *   ON_HOLD    the doer deliberately kept the item pending
 *   PENDING    no decision yet (no vendor chosen) — saved so its remarks / date
 *              / kept quotations survive, but never PO-eligible
 *
 * Items marked "Quote Not Required" at Step 1.2 are not part of this step. The
 * step itself is complete only when every quoted item is APPROVED; until then it
 * is PARTIAL (quotationApprovalStep.partial) and stays on the Step 1.3 queue.
 *
 * Pure: no DB access.
 */

export const APPROVAL_ROW_STATUS = {
  YES: 'YES',
  ON_HOLD: 'ON_HOLD',
  PENDING: 'PENDING',
  NOT_APPROVED: 'QUOTATION_NOT_APPROVED',
  NOT_REQUIRED: 'QUOTE_NOT_REQUIRED',
};

const idOf = (v) => (v ? String(v) : '');

/**
 * Step 1.2 split of an indent's items (`eligibleIds` = the items effective-approved at Step 1.1):
 *   notRequired  answered "Quote Required? = No" — their vendor is picked at Step 1.2, they have no quotation to
 *                approve, so they go STRAIGHT to PO creation
 *   quoted       everything else — waits for Step 1.3
 *   mixed        both exist: the indent releases its no-quote items to PO now AND stays open on Step 1.3
 */
export const splitByQuoteNeed = (eligibleIds = [], itemQuotations = []) => {
  const nr = new Set((itemQuotations || []).filter((q) => q?.statusDone === 'QUOTE_NOT_REQUIRED' && q.itemId).map((q) => idOf(q.itemId)));
  const ids = (eligibleIds || []).map(idOf).filter(Boolean);
  const notRequired = ids.filter((id) => nr.has(id));
  const quoted = ids.filter((id) => !nr.has(id));
  return { notRequired, quoted, mixed: notRequired.length > 0 && quoted.length > 0 };
};

/** Quoted-path items still owing a Step 1.3 decision: effective-approved at Step 1.1 and not "Quote Not Required" at Step 1.2. */
export const quotedItemIds = (indent, isItemApprovalEffective) => {
  const nr = new Set((indent?.quoteComparativeStep?.itemQuotations || [])
    .filter((q) => q.statusDone === 'QUOTE_NOT_REQUIRED' && q.itemId).map((q) => idOf(q.itemId)));
  return (indent?.items || [])
    .filter((it) => isItemApprovalEffective(indent, it) && !nr.has(idOf(it._id)))
    .map((it) => idOf(it._id));
};

/**
 * Saved rows kept, incoming rows win by itemId. A saved row for an item the
 * request does not mention is preserved (a stale / partial client can never drop
 * what an earlier submit recorded). Rows without an itemId are always the
 * request's own (legacy single-product shape).
 */
export const mergeApprovalRows = (saved = [], incoming = []) => {
  const mine = new Set(incoming.filter((r) => r.itemId).map((r) => idOf(r.itemId)));
  const kept = (saved || []).filter((r) => r.itemId && !mine.has(idOf(r.itemId)));
  return [...incoming, ...kept];
};

/**
 * Where the step stands, from the merged rows. `quoted` = quotedItemIds().
 * Items the rows never mention count as PENDING. `complete` = every quoted item
 * is APPROVED (and at least one exists).
 */
export const approvalProgress = (rows = [], quoted = []) => {
  const byItem = new Map((rows || []).filter((r) => r.itemId).map((r) => [idOf(r.itemId), r]));
  const approved = [];
  const onHold = [];
  const pending = [];
  quoted.forEach((id) => {
    const s = byItem.get(id)?.statusDone;
    if (s === APPROVAL_ROW_STATUS.YES) approved.push(id);
    else if (s === APPROVAL_ROW_STATUS.ON_HOLD) onHold.push(id);
    else pending.push(id);
  });
  return { approved, onHold, pending, complete: quoted.length > 0 && approved.length === quoted.length };
};

/** Indent status once some items are approved: PO progress rolled up, never PO_READY while items are still owed a decision. */
export const statusAfterApproval = ({ partial, approvedItemCount, poedItemCount }) => {
  if (!poedItemCount) return 'QUOTATION_APPROVED';
  if (!partial && poedItemCount >= approvedItemCount) return 'PO_READY';
  return 'PARTIAL_PO_CREATED';
};

/**
 * Why `vendorId` cannot be approved for an item at Step 1.3 ('' = it can). The
 * candidates are the item's ELIGIBLE vendors — quoted at Step 1.2 or previously
 * supplied (itemVendorHistory.js eligibleVendorsForItems) — the whole Vendor
 * Master is never a fallback. `history` = that eligible list for the item.
 */
export const approvalVendorHistoryProblem = ({ history = [], vendorId, itemName = '' }) => {
  const label = `"${itemName || 'item'}"`;
  if (!history.length) {
    return `No eligible vendors found for ${label} — none has quoted for it or supplied it before. Keep the item pending until a vendor has quoted or has purchase history`;
  }
  if (!history.some((h) => idOf(h.vendorId) === idOf(vendorId))) {
    return `The selected vendor has neither quoted for nor previously supplied ${label} — choose one of: ${history.map((h) => h.vendorName).join(', ')}`;
  }
  return '';
};
