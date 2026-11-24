/**
 * Vendor selection per indent item (indent/itemVendor.js): which quotation path
 * an item is on, which vendor its PO must use, and what stops a PO.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 *
 * The API oracle e2eVendorSelectionFixture.js re-checks the same rules through
 * the real endpoints against a scratch MongoDB.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ITEM_VENDOR_SOURCE, ITEM_VENDOR_STATE, QUOTATION_PATH,
  itemQuotationPath, itemVendorState, poVendorProblems, poVendorHistoryProblems, fixedVendorIds, usesApprovedVendorList, isJslVendorName,
} from '../indent/itemVendor.js';

const ID = (n) => `64c000000000000000000${String(n).padStart(3, '0')}`;
const V1 = ID(901);
const V2 = ID(902);
const item = (n, extra = {}) => ({ _id: ID(n), itemName: `Item ${n}`, skuCode: `SKU-${n}`, ...extra });
const vendors = (...docs) => new Map(docs.map((d) => [String(d._id), d]));
const active = (id, name = `Vendor ${id.slice(-3)}`) => ({ _id: id, name, isActive: true });

// Quoted at Step 1.2 (item-wise) and approved at Step 1.3.
const quoted = (items, notRequiredIds = []) => ({
  indentNumber: 'Ind-1/26-27',
  quoteComparativeStep: {
    statusDone: 'YES',
    itemQuotations: items.map((it) => ({ itemId: it._id, statusDone: notRequiredIds.includes(it._id) ? 'QUOTE_NOT_REQUIRED' : 'YES' })),
  },
  quotationApprovalStep: { statusDone: 'YES', skipped: false },
  items,
});
// Whole indent "Quote Not Required" — Step 1.3 skipped.
const skipped = (items) => ({
  indentNumber: 'Ind-2/26-27',
  quoteComparativeStep: { statusDone: 'QUOTE_NOT_REQUIRED', itemQuotations: [] },
  quotationApprovalStep: { skipped: true },
  items,
});

test('quotation path: whole-indent skip, per-item not required, quoted, legacy quoteStep', () => {
  const a = item(1);
  const b = item(2);
  assert.equal(itemQuotationPath(skipped([a]), a), QUOTATION_PATH.NOT_REQUIRED);
  const mixed = quoted([a, b], [b._id]);
  assert.equal(itemQuotationPath(mixed, a), QUOTATION_PATH.REQUIRED);
  assert.equal(itemQuotationPath(mixed, b), QUOTATION_PATH.NOT_REQUIRED);
  // Older shape: only quoteStep.status, no Step 1.2 statusDone.
  assert.equal(itemQuotationPath({ quoteStep: { status: 'NOT_REQUIRED' }, items: [a] }, a), QUOTATION_PATH.NOT_REQUIRED);
  assert.equal(itemQuotationPath({ quoteStep: { status: 'RECEIVED' }, items: [a] }, a), QUOTATION_PATH.REQUIRED);
  // Step 1.3 row carrying QUOTE_NOT_REQUIRED (older records without the 1.2 row).
  const viaStep13 = { ...quoted([a]), quoteComparativeStep: { statusDone: 'YES', itemQuotations: [] },
    quotationApprovalStep: { statusDone: 'YES', itemApprovedQuotations: [{ itemId: a._id, statusDone: 'QUOTE_NOT_REQUIRED' }] } };
  assert.equal(itemQuotationPath(viaStep13, a), QUOTATION_PATH.NOT_REQUIRED);
});

test('vendor state: approved vendor SET, legacy approval MISSING, open not-required UNASSIGNED', () => {
  const withVendor = item(1, { vendorId: V1, vendorName: 'Alpha', vendorSource: ITEM_VENDOR_SOURCE.APPROVED_QUOTATION });
  const legacy = item(2); // approved before vendors were recorded
  const ind = quoted([withVendor, legacy]);
  assert.deepEqual(itemVendorState(ind, withVendor), {
    path: QUOTATION_PATH.REQUIRED, state: ITEM_VENDOR_STATE.SET, vendorId: V1, vendorName: 'Alpha', vendorSource: 'APPROVED_QUOTATION',
  });
  assert.equal(itemVendorState(ind, legacy).state, ITEM_VENDOR_STATE.MISSING);
  const open = item(3);
  assert.equal(itemVendorState(skipped([open]), open).state, ITEM_VENDOR_STATE.UNASSIGNED);
});

test('a vendor recorded under the other path never counts', () => {
  // Picked on Pending for PO, then Step 1.2 changed the item to "quotation required".
  const prePicked = item(1, { vendorId: V1, vendorName: 'Alpha', vendorSource: ITEM_VENDOR_SOURCE.PO_PREPARATION });
  assert.equal(itemVendorState(quoted([prePicked]), prePicked).state, ITEM_VENDOR_STATE.MISSING);
  // Approved at Step 1.3, then the indent's quotation became not required.
  const approved = item(2, { vendorId: V1, vendorName: 'Alpha', vendorSource: ITEM_VENDOR_SOURCE.APPROVED_QUOTATION });
  assert.equal(itemVendorState(skipped([approved]), approved).state, ITEM_VENDOR_STATE.UNASSIGNED);
});

test('PO vendor: same vendor passes, different vendor refused, an item approved without a vendor does not block', () => {
  const a = item(1, { vendorId: V1, vendorName: 'Alpha', vendorSource: ITEM_VENDOR_SOURCE.APPROVED_QUOTATION });
  const ind = quoted([a]);
  const entries = [{ indent: ind, item: a, ref: 'Ind-1.1/26-27' }];
  const master = vendors(active(V1, 'Alpha'), active(V2, 'Beta'));
  assert.deepEqual(poVendorProblems(entries, V1, master), []);
  const [wrong] = poVendorProblems(entries, V2, master);
  assert.match(wrong, /Ind-1\.1\/26-27 \(Item 1\): the approved quotation is "Alpha"/);

  const legacy = item(2);
  // Step 1.3 no longer needs a vendor: the item reaches the PO, whose vendor is checked against the
  // item's previous vendors (poVendorHistoryProblems) instead of being refused here.
  assert.deepEqual(poVendorProblems([{ indent: quoted([legacy]), item: legacy, ref: 'Ind-1.2/26-27' }], V1, master), []);
  assert.deepEqual(poVendorProblems([{ indent: quoted([legacy]), item: legacy }], V1, master, { skipMissing: true }), []);
});

test('PO vendor: open not-required item takes any vendor; a pre-selected one must match', () => {
  const open = item(1);
  const picked = item(2, { vendorId: V2, vendorName: 'Beta', vendorSource: ITEM_VENDOR_SOURCE.PO_PREPARATION });
  const ind = skipped([open, picked]);
  const master = vendors(active(V1, 'Alpha'), active(V2, 'Beta'));
  assert.deepEqual(poVendorProblems([{ indent: ind, item: open }], V1, master), []);
  assert.deepEqual(poVendorProblems([{ indent: ind, item: picked }], V2, master), []);
  const [p] = poVendorProblems([{ indent: ind, item: picked }], V1, master);
  assert.match(p, /vendor selected on Pending for PO is "Beta"/);
});

test('PO vendor: fixed vendor deleted or deactivated in the Vendor Master is refused', () => {
  const a = item(1, { vendorId: V1, vendorName: 'Alpha', vendorSource: ITEM_VENDOR_SOURCE.APPROVED_QUOTATION });
  const entries = [{ indent: quoted([a]), item: a }];
  assert.match(poVendorProblems(entries, V1, new Map())[0], /no longer exists in the Vendor Master/);
  assert.match(poVendorProblems(entries, V1, vendors({ _id: V1, name: 'Alpha', isDeleted: true }))[0], /no longer exists/);
  const inactive = poVendorProblems(entries, V1, vendors({ _id: V1, name: 'Alpha', isActive: false }));
  assert.match(inactive[0], /"Alpha" is inactive in the Vendor Master — reactivate it$/);
  // Not-required pick: the doer may also choose another vendor.
  const p = item(2, { vendorId: V1, vendorName: 'Alpha', vendorSource: ITEM_VENDOR_SOURCE.PO_PREPARATION });
  assert.match(poVendorProblems([{ indent: skipped([p]), item: p }], V1, vendors({ _id: V1, name: 'Alpha', isActive: false }))[0],
    /or select another vendor on Pending for PO/);
});

test('multi-item indent: items fixed to different vendors cannot share one PO', () => {
  const a = item(1, { vendorId: V1, vendorName: 'Alpha', vendorSource: ITEM_VENDOR_SOURCE.APPROVED_QUOTATION });
  const b = item(2, { vendorId: V2, vendorName: 'Beta', vendorSource: ITEM_VENDOR_SOURCE.APPROVED_QUOTATION });
  const ind = quoted([a, b]);
  const entries = [{ indent: ind, item: a }, { indent: ind, item: b }];
  const master = vendors(active(V1, 'Alpha'), active(V2, 'Beta'));
  assert.equal(poVendorProblems(entries, V1, master).length, 1); // b refused
  assert.equal(poVendorProblems(entries, V2, master).length, 1); // a refused
  assert.deepEqual(fixedVendorIds(entries).sort(), [V1, V2].sort());
  // Each on its own PO with its own vendor is fine.
  assert.deepEqual(poVendorProblems([entries[0]], V1, master), []);
  assert.deepEqual(poVendorProblems([entries[1]], V2, master), []);
});

test('older vendor-grain approvals are recognised', () => {
  assert.equal(usesApprovedVendorList({ quotationApprovalStep: { approvedVendors: [{ vendorId: V1 }] } }), true);
  assert.equal(usesApprovedVendorList(quoted([item(1)])), false);
});

// ── Items with no vendor fixed take the PO's vendor from their previous vendors only ──
const HIST = (...pairs) => pairs.map(([vendorId, vendorName]) => ({ vendorId, vendorName }));
test('PO vendor history: an item with no vendor fixed accepts only a previous vendor', () => {
  const open = item(1);
  const ind = quoted([open]); // quoted + approved WITHOUT a vendor → MISSING
  const entries = [{ indent: ind, item: open, ref: 'Ind-1.1/26-27' }];
  const history = new Map([[open._id, HIST([V1, 'Alpha'])]]);
  assert.deepEqual(poVendorHistoryProblems(entries, V1, 'Alpha', history), []);
  const [why] = poVendorHistoryProblems(entries, V2, 'Beta', history);
  assert.match(why, /"Beta" has neither quoted for nor previously supplied this item — choose one of: Alpha/);
});
test('PO vendor history: no eligible vendor at all → "No eligible vendors found" (never the whole Vendor Master)', () => {
  const open = item(1);
  const [why] = poVendorHistoryProblems([{ indent: quoted([open]), item: open, ref: 'Ind-1.1/26-27' }], V1, 'Alpha', new Map());
  assert.match(why, /No eligible vendors found/);
});
test('PO vendor history: not-required items with no vendor are held to the same rule; items with a fixed vendor are left to poVendorProblems', () => {
  const open = item(1);
  const fixed = item(2, { vendorId: V1, vendorName: 'Alpha', vendorSource: ITEM_VENDOR_SOURCE.APPROVED_QUOTATION });
  const ind = skipped([open]);
  assert.equal(poVendorHistoryProblems([{ indent: ind, item: open, ref: 'r1' }], V2, 'Beta', new Map([[open._id, HIST([V1, 'Alpha'])]])).length, 1);
  // a fixed item is not re-checked against history, even with an empty history
  assert.deepEqual(poVendorHistoryProblems([{ indent: quoted([fixed]), item: fixed, ref: 'r2' }], V1, 'Alpha', new Map()), []);
});
test('PO vendor history: every open item on the PO must have the vendor in its history', () => {
  const a = item(1); const b = item(2);
  const ind = quoted([a, b]);
  const history = new Map([[a._id, HIST([V1, 'Alpha'], [V2, 'Beta'])], [b._id, HIST([V2, 'Beta'])]]);
  const entries = [{ indent: ind, item: a, ref: 'r1' }, { indent: ind, item: b, ref: 'r2' }];
  assert.deepEqual(poVendorHistoryProblems(entries, V2, 'Beta', history), []);
  const problems = poVendorHistoryProblems(entries, V1, 'Alpha', history);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /r2/);
});
test('JSL vendor: only a Jindal vendor can take a JSL-format PO (name match, any case / suffix)', () => {
  assert.equal(isJslVendorName('Jindal Stainless Ltd'), true);
  assert.equal(isJslVendorName('JINDAL STAINLESS (HISAR) LIMITED'), true);
  assert.equal(isJslVendorName('Alpha Traders'), false);
  assert.equal(isJslVendorName(''), false);
  assert.equal(isJslVendorName(undefined), false);
});
