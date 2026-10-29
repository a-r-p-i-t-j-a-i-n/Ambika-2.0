import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidRate, sameRate, matchVendorRate, evaluateLineRate, LINE_RATE, unsendableReason,
  rateDiff, selfApprovalBlock, isSelfApproval, otherLineAmounts, poTotals,
} from '../rateChange.rules.js';

const P = (o) => ({ _id: o.id || 'p', skuCode: '', productName: '', unit: 'Pcs', rate: 0, ...o });

test('isValidRate: finite and non-negative only', () => {
  assert.equal(isValidRate(0), true);
  assert.equal(isValidRate(12.5), true);
  for (const bad of [-1, NaN, Infinity, -Infinity, '10', null, undefined]) assert.equal(isValidRate(bad), false, String(bad));
});

test('sameRate ignores float noise but not real differences', () => {
  assert.equal(sameRate(0.1 + 0.2, 0.3), true);
  assert.equal(sameRate(100, '100'), true);
  assert.equal(sameRate(100, 100.01), false);
  assert.equal(sameRate(null, 0), false);
  assert.equal(sameRate('', 0), false);
});

test('matchVendorRate: SKU code first, then SKU id, then exact name', () => {
  const rows = [P({ id: 'a', skuCode: 'BOLT-1', rate: 10 }), P({ id: 'b', skuId: 'S2', rate: 20 }), P({ id: 'c', productName: 'Hex Nut  M8', rate: 30 })];
  assert.equal(matchVendorRate(rows, { skuCode: 'bolt-1', unit: 'PCS' }).product._id, 'a');
  assert.equal(matchVendorRate(rows, { skuId: 'S2', unit: 'Nos' }).product._id, 'b');
  assert.equal(matchVendorRate(rows, { itemName: 'hex nut m8', unit: 'pcs' }).product._id, 'c');
  assert.equal(matchVendorRate(rows, { skuCode: 'NOPE', unit: 'Pcs' }).problem, 'NONE');
});

test('matchVendorRate: picks the row in the line unit when a vendor carries a SKU twice', () => {
  const rows = [P({ id: 'pcs', skuCode: 'W', unit: 'Pcs', rate: 2 }), P({ id: 'box', skuCode: 'W', unit: 'BOX', rate: 50 })];
  assert.equal(matchVendorRate(rows, { skuCode: 'W', unit: 'Box' }).product._id, 'box');
  assert.equal(matchVendorRate(rows, { skuCode: 'W', unit: 'PCS' }).product._id, 'pcs');
  const m = matchVendorRate(rows, { skuCode: 'W', unit: 'KGS' });
  assert.equal(m.problem, 'UNIT_MISMATCH');
  assert.equal(m.candidates.length, 2);
});

test('matchVendorRate: duplicate rows with different rates in one unit are ambiguous; equal rates are fine', () => {
  const dup = [P({ id: 1, skuCode: 'D', rate: 5 }), P({ id: 2, skuCode: 'D', rate: 6 })];
  assert.equal(matchVendorRate(dup, { skuCode: 'D', unit: 'Pcs' }).problem, 'AMBIGUOUS');
  const same = [P({ id: 1, skuCode: 'D', rate: 5 }), P({ id: 2, skuCode: 'D', rate: 5 })];
  assert.equal(matchVendorRate(same, { skuCode: 'D', unit: 'Pcs' }).product._id, 1);
});

test('evaluateLineRate: unchanged / changed / no source / approved quotation', () => {
  const rows = [P({ skuCode: 'X', rate: 100 })];
  assert.equal(evaluateLineRate({ line: { skuCode: 'X', unit: 'Pcs', rate: 100 }, products: rows }).state, LINE_RATE.MATCHES);
  const ch = evaluateLineRate({ line: { skuCode: 'X', unit: 'Pcs', rate: 110 }, products: rows });
  assert.equal(ch.state, LINE_RATE.CHANGED);
  assert.equal(ch.vendorRate, 100);
  assert.equal(evaluateLineRate({ line: { skuCode: 'Y', unit: 'Pcs', rate: 5 }, products: rows }).state, LINE_RATE.NO_SOURCE);
  assert.equal(evaluateLineRate({ line: { skuCode: 'X', unit: 'Pcs', rate: 95 }, products: rows, quotationRate: 95 }).state, LINE_RATE.QUOTATION);
  // A quotation rate the line does NOT use is no excuse.
  assert.equal(evaluateLineRate({ line: { skuCode: 'X', unit: 'Pcs', rate: 97 }, products: rows, quotationRate: 95 }).state, LINE_RATE.CHANGED);
});

test('evaluateLineRate: same SKU, different vendors, different rates — each line judged by its own vendor', () => {
  const vendorA = [P({ skuCode: 'S', rate: 100 })];
  const vendorB = [P({ skuCode: 'S', rate: 120 })];
  const line = { skuCode: 'S', unit: 'Pcs', rate: 120 };
  assert.equal(evaluateLineRate({ line, products: vendorA }).state, LINE_RATE.CHANGED);
  assert.equal(evaluateLineRate({ line, products: vendorB }).state, LINE_RATE.MATCHES);
});

test('evaluateLineRate: a unit mismatch is only a problem when the rate was changed', () => {
  const rows = [P({ skuCode: 'B', unit: 'BOX', rate: 250 })];
  assert.equal(evaluateLineRate({ line: { skuCode: 'B', unit: 'PCS', rate: 250 }, products: rows }).state, LINE_RATE.MATCHES);
  const ev = evaluateLineRate({ line: { skuCode: 'B', unit: 'PCS', rate: 10 }, products: rows });
  assert.equal(ev.state, LINE_RATE.UNIT_MISMATCH);
  assert.match(unsendableReason(ev, { skuCode: 'B', itemName: 'Bolt box', unit: 'PCS' }, 'Acme'), /prices "Bolt box" per BOX.*PO line is in PCS/);
  assert.equal(unsendableReason({ state: LINE_RATE.CHANGED }, {}), '');
});

test('rateDiff: amount and percent; no percent from a zero base', () => {
  assert.deepEqual(rateDiff(100, 110), { amount: 10, percent: 10 });
  assert.deepEqual(rateDiff(80, 60), { amount: -20, percent: -25 });
  assert.deepEqual(rateDiff(0, 5), { amount: 5, percent: null });
  assert.deepEqual(rateDiff(null, 5), { amount: null, percent: null });
});

test('selfApprovalBlock: the requester cannot approve their own change, except the MD', () => {
  const req = { requestedBy: 'u1' };
  assert.match(selfApprovalBlock({ _id: 'u1', roles: ['PLANNER'] }, req), /another approver/);
  assert.equal(selfApprovalBlock({ _id: 'u2', roles: ['PLANNER'] }, req), '');
  assert.equal(selfApprovalBlock({ _id: 'u1', roles: ['MD'] }, req), '');
  // A leftover legacy role:'MD' on a user whose roles[] no longer has MD does not count.
  assert.match(selfApprovalBlock({ _id: 'u1', role: 'MD', roles: ['PLANNER'] }, req), /another approver/);
  assert.equal(isSelfApproval({ _id: 'u1' }, req), true);
  assert.equal(isSelfApproval({ _id: 'u2' }, req), false);
});

test('otherLineAmounts / poTotals: qty × rate, GST on taxable, totals from lines', () => {
  const a = otherLineAmounts({ quantity: 4, rate: 112.5, gstRate: 18 });
  assert.deepEqual(a, { taxableAmount: 450, taxAmount: 81, totalAmount: 531 });
  const b = otherLineAmounts({ quantity: 3, rate: 33.333, gstRate: 5 });
  assert.deepEqual(b, { taxableAmount: 100, taxAmount: 5, totalAmount: 105 });
  assert.deepEqual(poTotals([a, b]), { totalTaxableValue: 550, totalGSTAmount: 86, grandTotal: 636 });
});
