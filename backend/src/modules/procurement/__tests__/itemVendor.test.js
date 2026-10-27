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
  itemQuotationPath, itemVendorState, poVendorProblems, fixedVendorIds, usesApprovedVendorList,
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

test('PO vendor: same vendor passes, different vendor refused, missing approval refused', () => {
  const a = item(1, { vendorId: V1, vendorName: 'Alpha', vendorSource: ITEM_VENDOR_SOURCE.APPROVED_QUOTATION });
  const ind = quoted([a]);
  const entries = [{ indent: ind, item: a, ref: 'Ind-1.1/26-27' }];
  const master = vendors(active(V1, 'Alpha'), active(V2, 'Beta'));
  assert.deepEqual(poVendorProblems(entries, V1, master), []);
  const [wrong] = poVendorProblems(entries, V2, master);
  assert.match(wrong, /Ind-1\.1\/26-27 \(Item 1\): the approved quotation is "Alpha"/);

  const legacy = item(2);
  const missing = poVendorProblems([{ indent: quoted([legacy]), item: legacy, ref: 'Ind-1.2/26-27' }], V1, master);
  assert.equal(missing.length, 1);
  assert.match(missing[0], /no vendor recorded — confirm the approved vendor on Pending for PO/);
  // Editing a PO that already holds the item: not re-blocked.
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
