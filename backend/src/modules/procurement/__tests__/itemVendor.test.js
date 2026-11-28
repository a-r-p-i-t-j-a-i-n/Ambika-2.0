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
  itemQuotationPath, itemVendorState, itemVendorLocked, poVendorProblems, poPickedVendorProblems, fixedVendorIds, usesApprovedVendorList, isJslVendorName,
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
  // Step 1.3 does not need a vendor: the item reaches the PO, whose vendor is chosen there and checked by
  // poPickedVendorProblems instead of being refused here.
  assert.deepEqual(poVendorProblems([{ indent: quoted([legacy]), item: legacy, ref: 'Ind-1.2/26-27' }], V1, master), []);
  assert.deepEqual(poVendorProblems([{ indent: quoted([legacy]), item: legacy }], V1, master, { skipMissing: true }), []);
});

test('PO vendor: a vendor approved with the quotation is LOCKED; a Quote Required = No preselection is only a starting point the PO may change', () => {
  const open = item(1);
  const picked = item(2, { vendorId: V2, vendorName: 'Beta', vendorSource: ITEM_VENDOR_SOURCE.PO_PREPARATION });
  const approved = item(3, { vendorId: V2, vendorName: 'Beta', vendorSource: ITEM_VENDOR_SOURCE.APPROVED_QUOTATION });
  const ind = skipped([open, picked]);
  const master = vendors(active(V1, 'Alpha'), active(V2, 'Beta'));
  assert.equal(itemVendorLocked(ind, open), false);
  assert.equal(itemVendorLocked(ind, picked), false);
  assert.equal(itemVendorLocked(quoted([approved]), approved), true);
  // open item: nothing held here (the vendor chosen on the PO is checked by poPickedVendorProblems)
  assert.deepEqual(poVendorProblems([{ indent: ind, item: open }], V1, master), []);
  // preselection: the same vendor AND a different one are both fine here — the user may change it on the PO
  assert.deepEqual(poVendorProblems([{ indent: ind, item: picked }], V2, master), []);
  assert.deepEqual(poVendorProblems([{ indent: ind, item: picked }], V1, master), []);
  // approved with the quotation: held to that vendor
  const [p] = poVendorProblems([{ indent: quoted([approved]), item: approved }], V1, master);
  assert.match(p, /the approved quotation is "Beta" — this PO's vendor must be the same/);
});

test('PO vendor: fixed vendor deleted or deactivated in the Vendor Master is refused', () => {
  const a = item(1, { vendorId: V1, vendorName: 'Alpha', vendorSource: ITEM_VENDOR_SOURCE.APPROVED_QUOTATION });
  const entries = [{ indent: quoted([a]), item: a }];
  assert.match(poVendorProblems(entries, V1, new Map())[0], /no longer exists in the Vendor Master/);
  assert.match(poVendorProblems(entries, V1, vendors({ _id: V1, name: 'Alpha', isDeleted: true }))[0], /no longer exists/);
  const inactive = poVendorProblems(entries, V1, vendors({ _id: V1, name: 'Alpha', isActive: false }));
  assert.match(inactive[0], /"Alpha" is inactive in the Vendor Master — reactivate it$/);
  // A Quote Required = No preselection that has since gone inactive does not block the PO: the PO's own vendor decides.
  const p = item(2, { vendorId: V1, vendorName: 'Alpha', vendorSource: ITEM_VENDOR_SOURCE.PO_PREPARATION });
  assert.deepEqual(poVendorProblems([{ indent: skipped([p]), item: p }], V2, vendors({ _id: V1, name: 'Alpha', isActive: false }, active(V2, 'Beta'))), []);
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

// ── The vendor chosen on the PO: any ACTIVE Vendor Master vendor for every item that is not locked ──
test('PO vendor choice: an item with no vendor accepts any active vendor — previous or new, history or not', () => {
  const open = item(1);
  const entries = [{ indent: quoted([open]), item: open, ref: 'Ind-1.1/26-27' }]; // quoted + approved WITHOUT a vendor → MISSING
  assert.deepEqual(poPickedVendorProblems(entries, active(V1, 'Alpha')), []);
  assert.deepEqual(poPickedVendorProblems(entries, active(V2, 'Beta')), []);
  // not-required items are held to the very same rule
  assert.deepEqual(poPickedVendorProblems([{ indent: skipped([open]), item: open }], active(V2, 'Beta')), []);
});
test('PO vendor choice: inactive, deleted or not-a-Vendor-Master-record (unknown id / legacy Party) is refused', () => {
  const open = item(1);
  const entries = [{ indent: quoted([open]), item: open, ref: 'Ind-1.1/26-27' }];
  assert.match(poPickedVendorProblems(entries, { _id: V1, name: 'Alpha', isActive: false })[0], /Ind-1\.1\/26-27 \(Item 1\): vendor "Alpha" is inactive in the Vendor Master — choose an active vendor/);
  assert.match(poPickedVendorProblems(entries, { _id: V1, name: 'Alpha', isDeleted: true })[0], /must be an active vendor from the Vendor Master/);
  assert.match(poPickedVendorProblems(entries, null)[0], /must be an active vendor from the Vendor Master/);
  assert.match(poPickedVendorProblems(entries, undefined)[0], /must be an active vendor from the Vendor Master/);
});
test('PO vendor choice: a vendor approved with the quotation is left to poVendorProblems; a Quote Required = No preselection is checked here', () => {
  const locked = item(1, { vendorId: V1, vendorName: 'Alpha', vendorSource: ITEM_VENDOR_SOURCE.APPROVED_QUOTATION });
  const pre = item(2, { vendorId: V1, vendorName: 'Alpha', vendorSource: ITEM_VENDOR_SOURCE.PO_PREPARATION });
  // a locked item adds nothing, even for a vendor that is inactive (its own check reports that)
  assert.deepEqual(poPickedVendorProblems([{ indent: quoted([locked]), item: locked, ref: 'r1' }], { _id: V2, name: 'Beta', isActive: false }), []);
  // a preselection changed to an inactive vendor is refused
  assert.equal(poPickedVendorProblems([{ indent: skipped([pre]), item: pre, ref: 'r2' }], { _id: V2, name: 'Beta', isActive: false }).length, 1);
});
test('PO vendor choice: one message however many open items are on the PO', () => {
  const a = item(1); const b = item(2); const c = item(3);
  const ind = quoted([a, b, c]);
  const problems = poPickedVendorProblems([a, b, c].map((it, i) => ({ indent: ind, item: it, ref: 'r' + (i + 1) })), { _id: V1, name: 'Alpha', isActive: false });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /r1 \(Item 1\) and 2 more items/);
});
test('JSL vendor: only a Jindal vendor can take a JSL-format PO (name match, any case / suffix)', () => {
  assert.equal(isJslVendorName('Jindal Stainless Ltd'), true);
  assert.equal(isJslVendorName('JINDAL STAINLESS (HISAR) LIMITED'), true);
  assert.equal(isJslVendorName('Alpha Traders'), false);
  assert.equal(isJslVendorName(''), false);
  assert.equal(isJslVendorName(undefined), false);
});
