/**
 * "At most one active follow-up per PO" — concurrency hardening.
 *
 * No database (this repo has no mongod harness), so the actual atomic
 * guarantee (the partial unique index rejecting a concurrent duplicate
 * insert) is NOT exercised here — Mongoose index declarations are only
 * applied to a live MongoDB connection, never checked by `validateSync()` or
 * schema introspection alone. What IS covered, with no DB required:
 *   - the new isActiveFollowUp field defaults correctly for a fresh document
 *   - the schema declares the expected partial unique index shape
 *   - the FOLLOWUP_STATUS "active" definition (PENDING/RESCHEDULED) is
 *     unchanged, since the whole guard is built on top of it
 * A real concurrency test needs a live MongoDB — see the integration test
 * plan in the implementation report for exactly how to run one.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import PurchaseFollowUp, { FOLLOWUP_STATUS } from '../followUp.model.js';

test('FOLLOWUP_STATUS still defines PENDING and RESCHEDULED as the two active statuses', () => {
  assert.deepEqual(FOLLOWUP_STATUS, {
    PENDING: 'PENDING', DONE: 'DONE', RESCHEDULED: 'RESCHEDULED',
    READY_FOR_GRN: 'READY_FOR_GRN', CLOSED: 'CLOSED',
  });
});

test('a freshly-built follow-up document defaults isActiveFollowUp to true', () => {
  const fu = new PurchaseFollowUp({
    poId: new (PurchaseFollowUp.base.Types.ObjectId)(),
    plannedAt: new Date(),
  });
  assert.equal(fu.isActiveFollowUp, true);
  assert.equal(fu.followUpStatus, FOLLOWUP_STATUS.PENDING);
});

test('the schema declares a partial unique index on poId scoped to isActiveFollowUp:true', () => {
  const indexes = PurchaseFollowUp.schema.indexes();
  const activeIndex = indexes.find(([keys]) => Object.keys(keys).length === 1 && keys.poId === 1);
  assert.ok(activeIndex, 'expected an index keyed on poId alone');
  const [, options] = activeIndex;
  assert.equal(options.unique, true, 'the poId index must be unique');
  assert.deepEqual(options.partialFilterExpression, { isActiveFollowUp: true });
});

test('the legacy { poId, followUpStatus } index is untouched (not a uniqueness guarantee, just a query index)', () => {
  const indexes = PurchaseFollowUp.schema.indexes();
  const legacy = indexes.find(([keys]) => keys.poId === 1 && keys.followUpStatus === 1);
  assert.ok(legacy, 'expected the existing compound (poId, followUpStatus) index to still be declared');
  const [, options] = legacy;
  assert.ok(!options.unique, 'the legacy compound index must remain non-unique');
});
