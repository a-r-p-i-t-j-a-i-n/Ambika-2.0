// Run: node --test src/features/procurement/purchase-orders/__tests__/poRateLookup.test.mjs  (from frontend/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOOKUP, lookupKeyOf, lookupParams, answerOf, startLookup, applyAnswer, awaitsRate, lookupBlock,
  rateChangeOf, isFirstRate, newRowId, resetLookup,
} from '../poRateLookup.js';

const row = (o = {}) => ({ itemName: 'Gloves', skuCode: 'G-1', skuId: 's1', unit: 'BOX', rate: '', gstRate: 18, hsn: '', ...o });
const FOUND = { found: true, rate: 250, unit: 'BOX', gstRate: 12, hsn: '3926' };
const run = (it, key, res, opts) => {
  const started = startLookup(it, key, opts);
  const answer = answerOf(res);
  return applyAnswer(started, key, answer, res);
};

test('lookupKeyOf: needs a vendor and an item; vendor, SKU, name and unit all change the key', () => {
  assert.equal(lookupKeyOf('', row()), '');
  assert.equal(lookupKeyOf('v1', { unit: 'BOX' }), '');
  const k = lookupKeyOf('v1', row());
  assert.notEqual(k, lookupKeyOf('v2', row()));
  assert.notEqual(k, lookupKeyOf('v1', row({ unit: 'Pcs' })));
  assert.notEqual(k, lookupKeyOf('v1', row({ skuCode: 'G-2' })));
  assert.equal(k, lookupKeyOf('v1', row({ skuCode: ' g-1 ', itemName: ' GLOVES ', unit: 'box' })));
  assert.notEqual(newRowId(), newRowId());
});

test('lookupParams: vendor + SKU + name + unit, empty parts left out', () => {
  assert.deepEqual(lookupParams('v1', row()), { vendorId: 'v1', skuId: 's1', skuCode: 'G-1', itemName: 'Gloves', unit: 'BOX' });
  assert.deepEqual(lookupParams('v1', { itemName: 'Loose', unit: '' }), { vendorId: 'v1', itemName: 'Loose' });
});

test('answerOf: found / none / no rate / unit / ambiguity / not-in-master / network failure', () => {
  assert.equal(answerOf(FOUND).status, LOOKUP.FOUND);
  assert.equal(answerOf({ found: false, problem: 'NONE', message: 'No vendor rate configured for this item — x' }).status, LOOKUP.NONE);
  assert.equal(answerOf({ found: false, problem: 'NO_RATE' }).status, LOOKUP.NO_RATE);
  assert.equal(answerOf({ found: false, problem: 'UNIT_MISMATCH', message: 'm' }).status, LOOKUP.UNIT_MISMATCH);
  assert.equal(answerOf({ found: false, problem: 'AMBIGUOUS' }).status, LOOKUP.AMBIGUOUS);
  assert.equal(answerOf({ found: false, problem: 'NONE' }).message, 'No vendor rate configured for this item.');
  assert.equal(answerOf(null, { status: 404, data: { message: 'Vendor not found in the Vendor Master' } }).status, LOOKUP.NONE);
  assert.equal(answerOf(null, { status: 500 }).status, LOOKUP.ERROR);
});

test('found: the rate, GST and HSN are filled and kept as the original vendor rate', () => {
  const r = run(row(), 'k1', FOUND);
  assert.equal(r.rate, 250);
  assert.equal(r.autoRate, 250);
  assert.equal(r.gstRate, 12);
  assert.equal(r.hsn, '3926');
  assert.equal(r.rateMatched, true);
  assert.equal(r.rateEdited, false);
  assert.equal(rateChangeOf(r).needsReason, false);
});

test('a rate typed before the answer arrives is kept, and is then compared against the vendor rate', () => {
  const r = run(row({ rate: '260', rateTyped: true, rateEdited: true }), 'k1', FOUND);
  assert.equal(r.rate, '260');
  assert.equal(r.autoRate, 250);
  const rc = rateChangeOf(r);
  assert.equal(rc.changed, true);
  assert.equal(rc.needsReason, true);
  assert.equal(rc.fetched, 250);
  // typing the vendor rate back is not a change
  assert.equal(rateChangeOf({ ...r, rate: '250' }).needsReason, false);
});

test('a typed GST is kept; the rate is still fetched', () => {
  const r = run(row({ gstRate: 5, gstTyped: true }), 'k1', FOUND);
  assert.equal(r.gstRate, 5);
  assert.equal(r.rate, 250);
});

test('another vendor / unit: the earlier answer, its rate and the edits on it are dropped first', () => {
  let r = run(row(), 'v1|BOX', FOUND);
  r = { ...r, rate: '260', rateTyped: true, rateEdited: true, rateChangeReason: 'freight' };
  const s = startLookup(r, 'v2|BOX');
  assert.equal(s.rate, '');
  assert.equal(s.autoRate, undefined);
  assert.equal(s.rateTyped, false);
  assert.equal(s.rateChangeReason, '');
  assert.equal(s.rateLookup.status, LOOKUP.LOADING);
  const r2 = applyAnswer(s, 'v2|BOX', answerOf({ found: true, rate: 260, unit: 'BOX', gstRate: 12 }), { found: true, rate: 260, unit: 'BOX', gstRate: 12 });
  assert.equal(r2.rate, 260);
  assert.equal(r2.autoRate, 260);
});

test('the new vendor has no rate: the old vendor\'s rate is NOT left on the line', () => {
  let r = run(row(), 'v1|BOX', FOUND);
  assert.equal(r.rate, 250);
  const none = { found: false, problem: 'NONE', message: 'No vendor rate configured for this item — V2 has no rate' };
  r = run(r, 'v2|BOX', none);
  assert.equal(r.rate, '');
  assert.equal(r.autoRate, undefined);
  assert.equal(r.rateLookup.status, LOOKUP.NONE);
  assert.equal(r.rateMatched, false);
  assert.equal(rateChangeOf(r).needsReason, false);
});

test('no vendor rate: a rate the doer types is the FIRST rate — flagged, not a change', () => {
  const none = { found: false, problem: 'NO_RATE' };
  let r = run(row(), 'k1', none);
  assert.equal(isFirstRate(r), false);
  r = { ...r, rate: '40' };
  assert.equal(isFirstRate(r), true);
  assert.equal(rateChangeOf(r).needsReason, false);
});

test('vendor cleared: the fetched rate goes with it (a saved PO\'s rate and a quotation rate stay)', () => {
  const filled = run(row(), 'v1|BOX', FOUND);
  const cleared = resetLookup(filled);
  assert.deepEqual([cleared.rate, cleared.autoRate, cleared.rateLookup], ['', undefined, undefined]);
  assert.equal(resetLookup(row()).rate, '');
  const saved = run(row({ rate: 104, manual: true }), 'k1', FOUND, { lockRates: true });
  assert.equal(resetLookup(saved, { lockRates: true }).rate, 104);
  const q = run(row({ fromQuotation: true, rate: 240, quotationRate: 240 }), 'k1', FOUND);
  assert.equal(resetLookup(q).rate, 240);
});

test('an answer for a key the row has moved on from is ignored', () => {
  const started = startLookup(row(), 'old');
  const moved = startLookup(started, 'new');
  const late = applyAnswer(moved, 'old', answerOf(FOUND), FOUND);
  assert.equal(late, moved);
  assert.equal(late.rate, '');
});

test('editing a saved PO: the first lookup never overwrites the saved rate, only sets the base', () => {
  const saved = row({ rate: 104, savedRate: 104, autoRate: 100, manual: true, rateEdited: true });
  const r = run(saved, 'k1', FOUND, { lockRates: true });
  assert.equal(r.rate, 104);
  assert.equal(r.gstRate, 18);
  assert.equal(r.autoRate, 250);
  // …but changing the unit afterwards is a fresh fetch
  const next = run(r, 'k2', { found: true, rate: 10, unit: 'Pcs', gstRate: 18 }, { lockRates: true });
  assert.equal(next.rate, 10);
});

test('a rate negotiated in an approved quotation is held; it is not a change, a different one is', () => {
  const q = row({ fromQuotation: true, rate: 240, quotationRate: 240, manual: true });
  const r = run(q, 'k1', FOUND);
  assert.equal(r.rate, 240);
  assert.equal(r.autoRate, 250);
  assert.equal(rateChangeOf(r).needsReason, false);
  assert.equal(rateChangeOf({ ...r, rate: 245 }).needsReason, true);
  // never blocked by a unit problem — the server skips the catalog for a quotation rate
  assert.equal(lookupBlock({ ...q, rateLookup: { status: LOOKUP.UNIT_MISMATCH, message: 'x' } }), '');
});

test('unit mismatch / ambiguity block the line with the server\'s message', () => {
  const mismatch = { found: false, problem: 'UNIT_MISMATCH', message: 'V1 prices "Tape" per Pcs, but the PO line is in BOX' };
  const r = run(row(), 'k1', mismatch);
  assert.equal(r.rate, '');
  assert.match(lookupBlock(r), /per Pcs/);
  assert.equal(lookupBlock(run(row(), 'k1', FOUND)), '');
  assert.equal(lookupBlock(run(row(), 'k1', { found: false, problem: 'NONE' })), '');
});

test('a covered change (pending / approved request at the saved rate) needs no new reason', () => {
  const r = { rate: 104, autoRate: 100, savedRate: 104, rateChangeStatus: 'PENDING' };
  assert.deepEqual([rateChangeOf(r).changed, rateChangeOf(r).covered, rateChangeOf(r).needsReason], [true, true, false]);
  assert.equal(rateChangeOf({ ...r, rate: 105 }).needsReason, true);
  assert.equal(rateChangeOf({ ...r, rateChangeStatus: 'REJECTED' }).needsReason, true);
});

test('awaitsRate: until the lookup for the current vendor + item + unit has answered', () => {
  const it = row();
  assert.equal(awaitsRate(it, ''), false);
  assert.equal(awaitsRate(it, 'v1'), true);
  const key = lookupKeyOf('v1', it);
  const loading = startLookup(it, key);
  assert.equal(awaitsRate(loading, 'v1'), true);
  assert.equal(awaitsRate(applyAnswer(loading, key, answerOf(FOUND), FOUND), 'v1'), false);
  assert.equal(awaitsRate(applyAnswer(loading, key, answerOf(FOUND), FOUND), 'v2'), true);
});

test('a failed lookup keeps the row as it is and says so', () => {
  const key = 'k1';
  const started = startLookup(row({ rate: 12, rateTyped: true }), key);
  const failed = applyAnswer(started, key, answerOf(null, { status: 500 }), null);
  assert.equal(failed.rateLookup.status, LOOKUP.ERROR);
  assert.equal(failed.rate, 12);
});
