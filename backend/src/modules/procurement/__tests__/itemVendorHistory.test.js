import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sameSku, matchHistory, historyVendorProblem, PURCHASED_PO_STATUSES,
  mergeEligibleVendors, quotedVendorsForItem, eligibleVendorProblem,
} from '../indent/itemVendorHistory.js';

const S1 = '0000000000000000000000f1';
const S2 = '0000000000000000000000f2';
const A = '0000000000000000000000a1';
const B = '0000000000000000000000b2';
const C = '0000000000000000000000c3';
const D = '0000000000000000000000d4';
const vendor = (id, name, code = '', location = '') => ({ _id: id, name, code, location });
const VENDORS = [vendor(A, 'Alpha Traders', 'AL-1', 'Rajkot'), vendor(B, 'Beta Supplies', 'BE-1'), vendor(C, 'Gamma Steel')];
const item1 = { _id: 'i1', skuId: S1, skuCode: 'NUT-01', itemName: 'Nut' };

test('SKU matches by id when both sides have one, else by code (case-insensitive)', () => {
  assert.equal(sameSku({ skuId: S1 }, item1), true);
  assert.equal(sameSku({ skuId: S2, skuCode: 'NUT-01' }, item1), false, 'a different id never falls back to the code');
  assert.equal(sameSku({ skuCode: 'nut-01' }, item1), true);
  assert.equal(sameSku({ skuCode: 'OTHER' }, item1), false);
  assert.equal(sameSku({}, { _id: 'x' }), false, 'an item with no SKU matches nothing');
  assert.equal(sameSku({ skuCode: '' }, { skuCode: '' }), false);
});

test('only vendors with a PO line or a catalog entry for the SKU are listed — nobody else', () => {
  const pos = [
    { vendorId: A, poNumber: 'PO-1', poDate: '2026-10-01', items: [{ skuId: S1, rate: 5 }] },
    { vendorId: A, poNumber: 'PO-2', poDate: '2026-11-01', items: [{ skuId: S2 }, { skuCode: 'NUT-01', rate: 7 }] },
    { vendorId: B, poNumber: 'PO-3', poDate: '2026-09-01', items: [{ skuId: S2 }] }, // other SKU
  ];
  const catalog = [{ _id: C, products: [{ skuId: S1 }] }, { _id: B, products: [{ skuCode: 'ZZ' }] }];
  const list = matchHistory([item1], pos, catalog, VENDORS).get('i1');
  assert.deepEqual(list.map((h) => h.vendorName), ['Alpha Traders', 'Gamma Steel']);
  const alpha = list[0];
  assert.equal(alpha.poCount, 2);
  assert.equal(alpha.lastPoNumber, 'PO-2');
  assert.equal(alpha.lastRate, 7);
  assert.deepEqual(alpha.basis, ['PO']);
  assert.equal(alpha.vendorCode, 'AL-1');
  assert.equal(alpha.location, 'Rajkot');
  assert.deepEqual(list[1].basis, ['VENDOR']);
  assert.equal(list[1].poCount, 0);
});

test('a vendor with both a PO and a catalog entry appears once with both bases; PO-backed vendors sort first', () => {
  const pos = [{ vendorId: B, poNumber: 'PO-9', poDate: '2026-11-10', items: [{ skuId: S1 }] }];
  const catalog = [{ _id: A, products: [{ skuId: S1 }] }, { _id: B, products: [{ skuId: S1 }] }];
  const list = matchHistory([item1], pos, catalog, VENDORS).get('i1');
  assert.deepEqual(list.map((h) => h.vendorName), ['Beta Supplies', 'Alpha Traders']);
  assert.deepEqual(list[0].basis, ['PO', 'VENDOR']);
});

test('a vendor that is not a selectable Vendor Master record (deleted / inactive / legacy Party id) never lists', () => {
  const pos = [
    { vendorId: D, poNumber: 'PO-L', poDate: '2026-10-01', items: [{ skuId: S1 }] }, // not in the selectable set
    { vendorId: A, poNumber: 'PO-1', poDate: '2026-10-02', items: [{ skuId: S1 }] },
  ];
  const list = matchHistory([item1], pos, [{ _id: D, products: [{ skuId: S1 }] }], VENDORS).get('i1');
  assert.deepEqual(list.map((h) => h.vendorName), ['Alpha Traders']);
});

test('an item with no history gets an empty list (never every vendor)', () => {
  const none = { _id: 'i2', skuId: S2, skuCode: 'NEW-1', itemName: 'New item' };
  assert.deepEqual(matchHistory([none], [], [], VENDORS).get('i2'), []);
  const noSku = { _id: 'i3', itemName: 'Free text' };
  assert.deepEqual(matchHistory([noSku], [{ vendorId: A, items: [{ skuCode: '' }] }], [], VENDORS).get('i3'), []);
});

test('each item is matched on its own SKU', () => {
  const item2 = { _id: 'i2', skuId: S2, skuCode: 'BOLT', itemName: 'Bolt' };
  const pos = [
    { vendorId: A, poNumber: 'PO-1', poDate: '2026-10-01', items: [{ skuId: S1 }] },
    { vendorId: B, poNumber: 'PO-2', poDate: '2026-10-01', items: [{ skuId: S2 }] },
  ];
  const map = matchHistory([item1, item2], pos, [], VENDORS);
  assert.deepEqual(map.get('i1').map((h) => h.vendorName), ['Alpha Traders']);
  assert.deepEqual(map.get('i2').map((h) => h.vendorName), ['Beta Supplies']);
});

test('only placed POs count: no draft, no cancelled', () => {
  assert.ok(PURCHASED_PO_STATUSES.includes('APPROVED'));
  assert.ok(PURCHASED_PO_STATUSES.includes('CLOSED'));
  assert.ok(!PURCHASED_PO_STATUSES.includes('DRAFT'));
  assert.ok(!PURCHASED_PO_STATUSES.includes('CANCELLED'));
});

test('historyVendorProblem: empty history, missing vendor, vendor outside the history, valid pick', () => {
  const history = [{ vendorId: A, vendorName: 'Alpha Traders' }, { vendorId: C, vendorName: 'Gamma Steel' }];
  assert.match(historyVendorProblem({ history: [], vendorId: A, itemName: 'Nut' }), /No previous vendors found for "Nut"/);
  assert.match(historyVendorProblem({ history: [], vendorId: '', itemName: 'Nut' }), /No previous vendors found/);
  assert.match(historyVendorProblem({ history, vendorId: '', itemName: 'Nut' }), /Select the vendor for "Nut"/);
  const outside = historyVendorProblem({ history, vendorId: B, itemName: 'Nut' });
  assert.match(outside, /has not supplied "Nut" before/);
  assert.match(outside, /Alpha Traders, Gamma Steel/);
  assert.equal(historyVendorProblem({ history, vendorId: C, itemName: 'Nut' }), '');
});

// ── eligible = quoted OR previously supplied ───────────────────────────────
const quotedFile = (vendorId, quotedRate, deliveryDays, vendorName = '') => ({ vendorId, vendorName, quotedRate, deliveryDays, fileUrl: 'u' });
const indentWith = (item, rows) => ({ quoteComparativeStep: { itemQuotations: rows }, items: [item] });
const ACTIVE = new Map(VENDORS.map((v) => [v._id, v]));

test('eligible: a vendor who QUOTED but has no purchase history is offered (with its quote)', () => {
  const list = mergeEligibleVendors([], [{ vendorId: B, vendorName: 'Beta Supplies', quotedRate: 9, deliveryDays: 4 }], ACTIVE);
  assert.deepEqual(list.map((v) => v.vendorName), ['Beta Supplies']);
  assert.equal(list[0].quoted, true);
  assert.equal(list[0].quotedRate, 9);
  assert.deepEqual(list[0].basis, ['QUOTED']);
  assert.equal(list[0].poCount, 0);
});
test('eligible: a previously supplied vendor with NO quotation is offered', () => {
  const hist = matchHistory([item1], [{ vendorId: A, poNumber: 'PO-1', poDate: '2026-10-01', items: [{ skuId: S1, rate: 5 }] }], [], VENDORS).get('i1');
  const list = mergeEligibleVendors(hist, [], ACTIVE);
  assert.deepEqual(list.map((v) => v.vendorName), ['Alpha Traders']);
  assert.equal(list[0].quoted, false);
  assert.deepEqual(list[0].basis, ['PO']);
});
test('eligible: the UNION — quoted-only, history-only and both; each vendor once, quoted first, an unrelated vendor never', () => {
  const hist = matchHistory([item1], [{ vendorId: A, poNumber: 'PO-1', poDate: '2026-10-01', items: [{ skuId: S1 }] }], [{ _id: C, products: [{ skuId: S1 }] }], VENDORS).get('i1');
  const quoted = [{ vendorId: B, quotedRate: 3 }, { vendorId: A, quotedRate: 4, deliveryDays: 2 }];
  const list = mergeEligibleVendors(hist, quoted, ACTIVE);
  assert.deepEqual(list.map((v) => v.vendorName).sort(), ['Alpha Traders', 'Beta Supplies', 'Gamma Steel']);
  assert.equal(list.length, 3);
  assert.ok(list.slice(0, 2).every((v) => v.quoted), 'quoted vendors first');
  const alpha = list.find((v) => v.vendorId === A);
  assert.deepEqual(alpha.basis, ['QUOTED', 'PO']);
  assert.equal(alpha.poCount, 1);
  assert.equal(alpha.quotedRate, 4);
  assert.equal(list.some((v) => v.vendorId === D), false, 'a vendor with neither a quote nor history is not eligible');
});
test('eligible: a quoted vendor that is inactive / deleted in the master (not in the active map) is dropped', () => {
  const list = mergeEligibleVendors([], [{ vendorId: D, quotedRate: 1 }, { vendorId: A }], ACTIVE);
  assert.deepEqual(list.map((v) => v.vendorId), [A]);
});
test('quotedVendorsForItem: reads the Step 1.2 file tags of THIS item only; a Quote-Not-Required row has none', () => {
  const it = { _id: 'i1' };
  const rows = [
    { itemId: 'i1', statusDone: 'YES', quotationDocuments: [quotedFile(A, 5, 3), quotedFile(B, 6, 4), { fileUrl: 'untagged' }] },
    { itemId: 'i2', statusDone: 'YES', quotationDocuments: [quotedFile(C, 1, 1)] },
  ];
  assert.deepEqual(quotedVendorsForItem(indentWith(it, rows), it).map((v) => v.vendorId), [A, B]);
  const nr = [{ itemId: 'i1', statusDone: 'QUOTE_NOT_REQUIRED', quotationDocuments: [quotedFile(A, 5, 3)] }];
  assert.deepEqual(quotedVendorsForItem(indentWith(it, nr), it), []);
  assert.deepEqual(quotedVendorsForItem(indentWith(it, []), it), []);
});
test('eligibleVendorProblem: eligible passes; unrelated is refused naming the eligible ones; none at all says so', () => {
  const eligible = [{ vendorId: A, vendorName: 'Alpha' }, { vendorId: B, vendorName: 'Beta' }];
  assert.equal(eligibleVendorProblem({ eligible, vendorId: B, itemName: 'Nut' }), '');
  const why = eligibleVendorProblem({ eligible, vendorId: C, itemName: 'Nut' });
  assert.match(why, /neither quoted for nor previously supplied "Nut"/);
  assert.match(why, /Alpha, Beta/);
  assert.match(eligibleVendorProblem({ eligible: [], vendorId: A, itemName: 'Nut' }), /No eligible vendors found for "Nut"/);
  assert.match(eligibleVendorProblem({ eligible, vendorId: '', itemName: 'Nut' }), /Select the vendor/);
});
