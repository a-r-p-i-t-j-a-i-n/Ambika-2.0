/**
 * Incoming QC rejection stock-out — WHERE the rejected quantity leaves from.
 *
 * planRejectStockOut maps each rejected QC line to the GRN_IN receipt its GRN
 * line actually posted, so the stock-out reverses that receipt (its store and
 * batch) — and posts nothing for a line that never entered stock. Pure, so the
 * rule is tested on its own; the DB writes are covered by
 * src/scripts/e2eGrnQcFixture.js --stock against a local scratch database.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { planRejectStockOut } from '../incomingQc.service.js';

const COIL = 'sku-coil';
const BOLT = 'sku-bolt';

// GRN lines + their receipts, as GRN completion leaves them.
const grnLine = (id, skuId, batchNo, movementId) => ({ _id: id, skuId, batchNo, movementId });
const receipt = (id, skuId, batchNo, warehouse) => ({ _id: id, skuId, batchNo, warehouse, txnType: 'GRN_IN', movementType: 'IN' });
const qcLine = (grnItemId, skuId, batchNo, rejectedQty, itemName = 'Item') => ({ grnItemId, skuId, batchNo, rejectedQty, itemName });

test('RM received at PLG01 → rejection leaves PLG01, same batch', () => {
  const { steps, errors } = planRejectStockOut({
    qcItems: [qcLine('g1', COIL, 'B-1', 120)],
    grnItems: [grnLine('g1', COIL, 'B-1', 'm1')],
    receipts: [receipt('m1', COIL, 'B-1', 'PLG01')],
  });
  assert.deepEqual(errors, []);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].post, true);
  assert.equal(steps[0].warehouse, 'PLG01');
  assert.equal(steps[0].batchNo, 'B-1');
  assert.equal(steps[0].receiptId, 'm1');
});

test('RM received at JW001 → rejection leaves JW001', () => {
  const { steps } = planRejectStockOut({
    qcItems: [qcLine('g1', COIL, 'B-JW', 50)],
    grnItems: [grnLine('g1', COIL, 'B-JW', 'm1')],
    receipts: [receipt('m1', COIL, 'B-JW', 'JW001')],
  });
  assert.equal(steps[0].warehouse, 'JW001');
});

test('non-RM item received at MAIN → rejection leaves MAIN (unchanged behaviour)', () => {
  const { steps } = planRejectStockOut({
    qcItems: [qcLine('g2', BOLT, '', 5)],
    grnItems: [grnLine('g2', BOLT, '', 'm2')],
    receipts: [receipt('m2', BOLT, '', 'MAIN')],
  });
  assert.equal(steps[0].post, true);
  assert.equal(steps[0].warehouse, 'MAIN');
});

test('RM with "Add to RM Stock" OFF (no receipt) → no stock-out', () => {
  const { steps, errors } = planRejectStockOut({
    qcItems: [qcLine('g1', COIL, 'B-OFF', 100)],
    grnItems: [grnLine('g1', COIL, 'B-OFF', undefined)],
    receipts: [],
  });
  assert.deepEqual(errors, []);
  assert.equal(steps[0].post, false);
  assert.equal(steps[0].reason, 'NOT_POSTED');
});

test('mixed GRN: posted bolt moves out, unposted coil does not', () => {
  const { steps } = planRejectStockOut({
    qcItems: [qcLine('g1', COIL, 'B-1', 10), qcLine('g2', BOLT, '', 4)],
    grnItems: [grnLine('g1', COIL, 'B-1', undefined), grnLine('g2', BOLT, '', 'm2')],
    receipts: [receipt('m2', BOLT, '', 'MAIN')],
  });
  assert.deepEqual(steps.map((s) => [s.item.grnItemId, s.post]), [['g1', false], ['g2', true]]);
});

test('accepted / rework only (rejected 0) → nothing planned', () => {
  const { steps } = planRejectStockOut({
    qcItems: [{ ...qcLine('g1', COIL, 'B-1', 0), acceptedQty: 80, reworkQty: 20 }],
    grnItems: [grnLine('g1', COIL, 'B-1', 'm1')],
    receipts: [receipt('m1', COIL, 'B-1', 'PLG01')],
  });
  assert.equal(steps.length, 0);
});

test('same SKU on two lines, different batches / stores → each reverses its own receipt', () => {
  const { steps } = planRejectStockOut({
    qcItems: [qcLine('g1', COIL, 'B-A', 10), qcLine('g2', COIL, 'B-B', 20)],
    grnItems: [grnLine('g1', COIL, 'B-A', 'm1'), grnLine('g2', COIL, 'B-B', 'm2')],
    receipts: [receipt('m1', COIL, 'B-A', 'PLG01'), receipt('m2', COIL, 'B-B', 'JW001')],
  });
  assert.deepEqual(steps.map((s) => [s.warehouse, s.batchNo]), [['PLG01', 'B-A'], ['JW001', 'B-B']]);
});

test('legacy GRN line without movementId → receipt found by SKU + batch', () => {
  const { steps, errors } = planRejectStockOut({
    qcItems: [qcLine('g1', COIL, 'B-1', 10)],
    grnItems: [grnLine('g1', COIL, 'B-1', undefined)],
    receipts: [receipt('m1', COIL, 'b-1', 'PLG01')], // batch compared case-insensitively
  });
  assert.deepEqual(errors, []);
  assert.equal(steps[0].warehouse, 'PLG01');
});

test('legacy fallback never takes a receipt that another line owns', () => {
  const { steps } = planRejectStockOut({
    qcItems: [qcLine('g2', COIL, 'B-1', 10)],
    grnItems: [grnLine('g1', COIL, 'B-1', 'm1'), grnLine('g2', COIL, 'B-1', undefined)],
    receipts: [receipt('m1', COIL, 'B-1', 'PLG01')],
  });
  assert.equal(steps[0].post, false, 'g2 posted nothing of its own');
});

test('ambiguous legacy match → error, nothing guessed', () => {
  const { steps, errors } = planRejectStockOut({
    qcItems: [qcLine('g1', COIL, 'B-1', 10, 'Coil')],
    grnItems: [grnLine('g1', COIL, 'B-1', undefined)],
    receipts: [receipt('m1', COIL, 'B-1', 'PLG01'), receipt('m2', COIL, 'B-1', 'JW001')],
  });
  assert.equal(steps.length, 0);
  assert.match(errors[0], /more than one stock receipt/);
});

test('receipt referenced by the GRN line is missing → error', () => {
  const { errors } = planRejectStockOut({
    qcItems: [qcLine('g1', COIL, 'B-1', 10, 'Coil')],
    grnItems: [{ ...grnLine('g1', COIL, 'B-1', 'm-gone'), movementNumber: 'MOV-9' }],
    receipts: [],
  });
  assert.match(errors[0], /MOV-9.*not found/);
});

test('QC line with no grnItemId → matched by SKU + batch when unique, else error', () => {
  const ok = planRejectStockOut({
    qcItems: [qcLine(undefined, COIL, 'B-1', 10)],
    grnItems: [grnLine('g1', COIL, 'B-1', 'm1')],
    receipts: [receipt('m1', COIL, 'B-1', 'PLG01')],
  });
  assert.equal(ok.steps[0].warehouse, 'PLG01');

  const bad = planRejectStockOut({
    qcItems: [qcLine(undefined, COIL, 'B-1', 10)],
    grnItems: [grnLine('g1', COIL, 'B-1', 'm1'), grnLine('g2', COIL, 'B-1', 'm2')],
    receipts: [],
  });
  assert.match(bad.errors[0], /cannot be matched/);
});

test('QC line SKU differs from its receipt → error', () => {
  const { errors } = planRejectStockOut({
    qcItems: [qcLine('g1', BOLT, '', 1, 'Bolt')],
    grnItems: [grnLine('g1', COIL, '', 'm1')],
    receipts: [receipt('m1', COIL, '', 'PLG01')],
  });
  assert.match(errors[0], /SKU differs/);
});
