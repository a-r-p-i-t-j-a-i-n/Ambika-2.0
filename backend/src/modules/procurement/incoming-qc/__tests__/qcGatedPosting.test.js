/**
 * QC-gated stock posting — the pure rules (no database).
 *
 * On a GRN completed since QC-gated posting (stockPostingStage QC_COMPLETION)
 * nothing is stocked at GRN completion; each line's ACCEPTED qty posts when its
 * Incoming QC completes. These tests pin down what may post, what never may,
 * and the multi-PO duplicate guard. The transaction, the per-line claim and
 * concurrent completions are exercised against a scratch replica set by
 * src/scripts/e2eQcGatedPostingFixture.js.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isQcGatedGrn, qcScopeLines, qcItemsFromGrn, planAcceptedStockIn, duplicateQcFilter,
} from '../incomingQc.service.js';

const L1 = { _id: 'g1', poId: 'po1', skuId: 's1', skuCode: 'COIL', itemName: 'Coil', unit: 'KGS', batchNo: 'B1', receivedQty: 500, rate: 90,
  inventoryDestination: 'RM_IMS', stockWarehouse: 'JW001', stockStatus: 'AWAITING_QC' };
const L2 = { _id: 'g2', poId: 'po1', skuId: 's2', skuCode: 'BRUSH', itemName: 'Brush', unit: 'PCS', batchNo: '', receivedQty: 50, rate: 20,
  inventoryDestination: 'CP_IMS', stockWarehouse: 'MAIN', stockStatus: 'AWAITING_QC' };
const L3 = { _id: 'g3', poId: 'po2', skuId: 's3', skuCode: 'INK', itemName: 'Ink', unit: 'LTR', batchNo: '', receivedQty: 10, rate: 300,
  inventoryDestination: 'MAIN_STORE', stockWarehouse: 'MAIN', stockStatus: 'AWAITING_QC' };
const ZERO = { _id: 'g0', poId: 'po1', skuId: 's9', itemName: 'Not received', receivedQty: 0 };

const singlePo = { stockPostingStage: 'QC_COMPLETION', poIds: ['po1'], items: [L1, L2, ZERO] };
const multiPo = { stockPostingStage: 'QC_COMPLETION', poIds: ['po1', 'po2'], items: [L1, L2, L3] };

const qcLine = (g, accepted, rejected = 0, rework = 0) => ({
  grnItemId: g._id, itemName: g.itemName, receivedQty: g.receivedQty, acceptedQty: accepted, rejectedQty: rejected, reworkQty: rework,
});

test('only a QC_COMPLETION GRN is QC-gated; a missing marker is legacy', () => {
  assert.equal(isQcGatedGrn(singlePo), true);
  for (const g of [{}, { stockPostingStage: null }, { stockPostingStage: undefined }, null]) assert.equal(isQcGatedGrn(g), false);
});

test('scope: every received line on a single-PO GRN; only the QC\'s own PO on a multi-PO GRN', () => {
  assert.deepEqual(qcScopeLines(singlePo, 'po1').map((l) => l._id), ['g1', 'g2'], 'a 0-qty line is never inspected');
  assert.deepEqual(qcScopeLines(multiPo, 'po1').map((l) => l._id), ['g1', 'g2']);
  assert.deepEqual(qcScopeLines(multiPo, 'po2').map((l) => l._id), ['g3']);
});

test('QC lines are rebuilt from the GRN — received qty can never be inflated by the request', () => {
  const sent = [{ ...qcLine(L1, 600), receivedQty: 600, skuId: 'forged', batchNo: 'X' }, qcLine(L2, 50)];
  const { items, errors } = qcItemsFromGrn({ items: sent, scopeLines: qcScopeLines(singlePo) });
  assert.deepEqual(errors, []);
  assert.equal(items[0].receivedQty, 500, 'from the GRN');
  assert.equal(items[0].skuId, 's1', 'from the GRN');
  assert.equal(items[0].batchNo, 'B1', 'from the GRN');
  assert.equal(items[0].acceptedQty, 600, 'the inspection result is kept as sent (and then fails the balance rule)');
});

test('without items, every received line defaults to fully accepted', () => {
  const { items, errors } = qcItemsFromGrn({ items: null, scopeLines: qcScopeLines(singlePo) });
  assert.deepEqual(errors, []);
  assert.deepEqual(items.map((i) => [i.grnItemId, i.acceptedQty, i.rejectedQty]), [['g1', 500, 0], ['g2', 50, 0]]);
});

test('uninspected, duplicated or foreign lines are refused — nothing uninspected can post', () => {
  const scope = qcScopeLines(singlePo);
  assert.match(qcItemsFromGrn({ items: [qcLine(L1, 500)], scopeLines: scope }).errors.join(), /"Brush" has not been inspected/);
  assert.match(qcItemsFromGrn({ items: [qcLine(L1, 500), qcLine(L1, 500), qcLine(L2, 50)], scopeLines: scope }).errors.join(), /inspected more than once/);
  assert.match(qcItemsFromGrn({ items: [qcLine(L1, 500), qcLine(L2, 50), qcLine(L3, 10)], scopeLines: scope }).errors.join(), /"Ink" is not a received line/);
});

test('plan: accepted qty posts to the line\'s fixed warehouse; rejected and rework never post', () => {
  const qcItems = [qcLine(L1, 450, 30, 20), qcLine(L2, 0, 50)];
  const { steps, errors } = planAcceptedStockIn({ qcItems, scopeLines: qcScopeLines(singlePo) });
  assert.deepEqual(errors, []);
  assert.deepEqual(steps.map((s) => [s.grnLine._id, s.post, s.quantity, s.grnLine.stockWarehouse]),
    [['g1', true, 450, 'JW001'], ['g2', false, 0, 'MAIN']]);
});

test('plan: a line already posted (or holding a movement) is refused, never posted twice', () => {
  const posted = { ...L1, stockStatus: 'POSTED', movementId: 'm1', movementNumber: 'MOV-1' };
  const grn = { ...singlePo, items: [posted, L2] };
  const { errors } = planAcceptedStockIn({ qcItems: [qcLine(posted, 500), qcLine(L2, 50)], scopeLines: qcScopeLines(grn) });
  assert.match(errors.join(), /"Coil": already posted to stock \(MOV-1\)/);
  const stray = { ...L1, movementId: 'm9' }; // AWAITING_QC but a movement exists
  assert.match(planAcceptedStockIn({ qcItems: [qcLine(stray, 500), qcLine(L2, 50)], scopeLines: qcScopeLines({ ...singlePo, items: [stray, L2] }) }).errors.join(), /already posted/);
});

test('plan: received qty must match the GRN, accepted must stay within it', () => {
  const scope = qcScopeLines(singlePo);
  assert.match(planAcceptedStockIn({ qcItems: [{ ...qcLine(L1, 500), receivedQty: 501 }, qcLine(L2, 50)], scopeLines: scope }).errors.join(), /differs from the GRN's 500/);
  assert.match(planAcceptedStockIn({ qcItems: [qcLine(L1, 501), qcLine(L2, 50)], scopeLines: scope }).errors.join(), /outside 0–500/);
});

test('plan: a GRN line with no recorded destination is refused rather than guessed', () => {
  const bare = { ...L2, inventoryDestination: null, stockWarehouse: '' };
  const { errors } = planAcceptedStockIn({ qcItems: [qcLine(L1, 500), qcLine(bare, 50)], scopeLines: [L1, bare] });
  assert.match(errors.join(), /"Brush": the GRN line has no inventory destination/);
});

test('multi-PO: each PO\'s QC plans only its own lines', () => {
  const a = planAcceptedStockIn({ qcItems: [qcLine(L1, 500), qcLine(L2, 50)], scopeLines: qcScopeLines(multiPo, 'po1') });
  const b = planAcceptedStockIn({ qcItems: [qcLine(L3, 10)], scopeLines: qcScopeLines(multiPo, 'po2') });
  assert.deepEqual([a.errors, b.errors], [[], []]);
  assert.deepEqual(b.steps.map((s) => s.grnLine._id), ['g3']);
});

// ── The duplicate-QC guard ────────────────────────────────────────────────────
test('single-PO GRN: any other completed QC is a duplicate (safeguard unchanged)', () => {
  const f = duplicateQcFilter({ poIds: ['po1'] }, { _id: 'q2', grnId: 'grn', poId: 'po1' });
  assert.equal(f.grnId, 'grn');
  assert.deepEqual(f._id, { $ne: 'q2' });
  assert.equal('poId' in f, false, 'whole-GRN scope');
  assert.deepEqual(f.qcStatus.$in.sort(), ['FAILED', 'PARTIAL', 'PASSED']);
  // W/O PO GRN (no PO at all) keeps the same whole-GRN scope.
  assert.equal('poId' in duplicateQcFilter({ poIds: [] }, { _id: 'q', grnId: 'g', poId: null }), false);
});

test('multi-PO GRN: only a completed QC for the SAME PO is a duplicate — other POs can complete', () => {
  const f = duplicateQcFilter({ poIds: ['po1', 'po2'] }, { _id: 'q2', grnId: 'grn', poId: 'po2' });
  assert.equal(f.poId, 'po2');
});
