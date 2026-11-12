/**
 * Recycle Bin — a deleted dispatch phase: what the delete is noted as, and
 * putting it back (plus the production-plan line it drew on).
 *
 * DB-less: plain objects only.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { phaseDeleteSnapshot, putPhaseBack } from '../phaseRestore.js';
import { findPlanItem } from '../../ppc/productionPlanInherit.service.js';

const schedule = () => ({
  items: [
    { _id: 'i1', skuName: 'Jar 500', phases: [
      { _id: 'a1', phaseNo: 'P1', totalActualQty: 0, status: 'PLANNED' },
      { _id: 'a2', phaseNo: 'P2', totalActualQty: 0, status: 'PLANNED' },
    ] },
    { _id: 'i2', skuName: 'Dome 1L', phases: [
      { _id: 'b1', phaseNo: 'P1', totalActualQty: 0, status: 'PLANNED' },
      { _id: 'b2', phaseNo: 'P2', totalActualQty: 40, status: 'IN_PROGRESS' },
    ] },
  ],
});

// What deletePhaseNow does to the same data.
const applyDelete = (sched, phaseNo) => {
  sched.items.forEach((it) => {
    it.phases = it.phases.filter((p) => {
      if (p.phaseNo !== phaseNo) return true;
      if (p.totalActualQty > 0) { p.status = 'CANCELLED'; return true; }
      return false;
    });
  });
};

test('snapshot: same phaseNo across SKUs — dropped when empty, only cancelled when it has dispatches', () => {
  const snap = phaseDeleteSnapshot(schedule(), 'a2');
  assert.equal(snap.phaseNo, 'P2');
  assert.deepEqual(snap.removed.map((r) => [r.itemId, r.index, r.phase._id]), [['i1', 1, 'a2']]);
  assert.deepEqual(snap.cancelled, [{ itemId: 'i2', skuName: 'Dome 1L', phaseId: 'b2', prevStatus: 'IN_PROGRESS' }]);
  assert.equal(phaseDeleteSnapshot(schedule(), 'nope'), null);
});

test('put back: dropped phases return at their old place, the cancelled one gets its status back', () => {
  const s = schedule();
  const snap = phaseDeleteSnapshot(s, 'a1');
  applyDelete(s, 'P1');
  assert.deepEqual(s.items.map((it) => it.phases.map((p) => p._id)), [['a2'], ['b2']]);
  assert.equal(putPhaseBack(s.items, snap), 2);
  assert.deepEqual(s.items.map((it) => it.phases.map((p) => p._id)), [['a1', 'a2'], ['b1', 'b2']]);

  const s2 = schedule();
  const snap2 = phaseDeleteSnapshot(s2, 'b2');
  applyDelete(s2, 'P2');
  assert.equal(s2.items[1].phases[1].status, 'CANCELLED');
  putPhaseBack(s2.items, snap2);
  assert.equal(s2.items[1].phases[1].status, 'IN_PROGRESS');
  assert.deepEqual(s2.items[0].phases.map((p) => p._id), ['a1', 'a2']);
});

test('put back refuses — changing nothing — when the phase was planned again or the SKU is gone', () => {
  const s = schedule();
  const snap = phaseDeleteSnapshot(s, 'a1');
  applyDelete(s, 'P1');
  s.items[0].phases.push({ _id: 'new', phaseNo: 'P1', totalActualQty: 0, status: 'PLANNED' });
  assert.throws(() => putPhaseBack(s.items, snap), /planned again/);
  assert.deepEqual(s.items[1].phases.map((p) => p._id), ['b2']); // untouched

  const s2 = schedule();
  const snap2 = phaseDeleteSnapshot(s2, 'a1');
  applyDelete(s2, 'P1');
  s2.items.shift();
  assert.throws(() => putPhaseBack(s2.items, snap2), /no longer on this dispatch plan/);
});

test('put back twice: the second time changes nothing', () => {
  const s = schedule();
  const snap = phaseDeleteSnapshot(s, 'a1');
  applyDelete(s, 'P1');
  putPhaseBack(s.items, snap);
  assert.equal(putPhaseBack(s.items, snap), 0);
});

test('plan line lookup: by position when it still matches, else by SKU', () => {
  const items = [{ skuId: 'x', skuCode: 'A' }, { skuId: 'y', skuCode: 'B' }];
  assert.equal(findPlanItem(items, { itemIndex: 1, skuId: 'y' }), items[1]);
  assert.equal(findPlanItem([items[1], items[0]], { itemIndex: 1, skuId: 'y' }), items[1]);
  assert.equal(findPlanItem(items, { itemIndex: 0, skuCode: 'b' }), items[1]);
  assert.equal(findPlanItem(items, { itemIndex: 0, skuId: 'z' }), null);
});
