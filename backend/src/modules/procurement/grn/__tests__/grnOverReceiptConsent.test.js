/**
 * Per-line "Allow Over-Receipt" consent on a GRN.
 *
 * Pure / DB-less: the Joi schemas keep the per-line flag (validate.js runs with
 * stripUnknown), the model stores it, and applyOverReceiptConsent enforces the
 * rule the service applies on create / update / complete / correct. Saving and
 * completing through the API is covered by src/scripts/e2eOverReceiptFixture.js.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createGrnSchema, updateGrnSchema } from '../grn.validation.js';
import GoodsReceiptNote from '../grn.model.js';
import { applyOverReceiptConsent } from '../grn.service.js';

const line = (receivedQty, pendingBeforeGrn, extra = {}) => ({
  itemName: 'Item', receivedQty, pendingBeforeGrn,
  extraQty: Math.max(0, receivedQty - pendingBeforeGrn), ...extra,
});

test('below or exactly at pending needs no consent', () => {
  for (const r of [80, 100]) {
    const { missing, lines } = applyOverReceiptConsent([line(r, 100)]);
    assert.equal(missing, null);
    assert.equal(lines[0].allowOverReceipt, false);
  }
});

test('over pending without the flag is reported as missing consent', () => {
  const { missing } = applyOverReceiptConsent([line(120, 100)]);
  assert.equal(missing.receivedQty, 120);
});

test('over pending with the flag passes and keeps it', () => {
  const { missing, lines } = applyOverReceiptConsent([line(120, 100, { allowOverReceipt: true })]);
  assert.equal(missing, null);
  assert.equal(lines[0].allowOverReceipt, true);
});

test('pending 0 / received 10 is over and needs consent', () => {
  assert.ok(applyOverReceiptConsent([line(10, 0)]).missing);
  assert.equal(applyOverReceiptConsent([line(10, 0, { allowOverReceipt: true })]).missing, null);
});

test('a stale flag is cleared once the line is no longer over pending', () => {
  const { lines } = applyOverReceiptConsent([line(90, 100, { allowOverReceipt: true })]);
  assert.equal(lines[0].allowOverReceipt, false);
});

test('a line with nothing received never needs consent', () => {
  assert.equal(applyOverReceiptConsent([{ itemName: 'x', receivedQty: 0, pendingBeforeGrn: 0, extraQty: 5 }]).missing, null);
});

test('only the offending line is flagged when several lines are present', () => {
  const { missing, lines } = applyOverReceiptConsent([
    line(50, 100), line(130, 100, { itemName: 'Over' }), line(100, 100, { allowOverReceipt: true }),
  ]);
  assert.equal(missing.itemName, 'Over');
  assert.deepEqual(lines.map((l) => l.allowOverReceipt), [false, false, false]);
});

test('legacy GRN-wide consent satisfies every over line (older drafts / correction)', () => {
  const { missing, lines } = applyOverReceiptConsent([line(120, 100), line(10, 100)], { legacyConsent: true });
  assert.equal(missing, null);
  assert.deepEqual(lines.map((l) => l.allowOverReceipt), [true, false]);
});

test('the Joi item schema keeps the flag and defaults it to false', () => {
  const base = { poIds: ['6ac09965f1c61c40fa206c41'], items: [{ itemName: 'A', receivedQty: 5 }] };
  const a = createGrnSchema.validate(base, { stripUnknown: true });
  assert.equal(a.error, undefined);
  assert.equal(a.value.items[0].allowOverReceipt, false);
  const b = updateGrnSchema.validate({ items: [{ itemName: 'A', receivedQty: 5, allowOverReceipt: true }] }, { stripUnknown: true });
  assert.equal(b.value.items[0].allowOverReceipt, true);
});

test('the model stores the per-line flag (default false)', () => {
  const g = new GoodsReceiptNote({ items: [{ itemName: 'A', receivedQty: 1 }, { itemName: 'B', receivedQty: 1, allowOverReceipt: true }] });
  assert.equal(g.items[0].allowOverReceipt, false);
  assert.equal(g.items[1].allowOverReceipt, true);
});
