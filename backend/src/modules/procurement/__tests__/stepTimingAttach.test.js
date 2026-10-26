/**
 * attachStepTiming is display-only: a failed doer / user-name lookup must
 * never break a Purchase FMS list. No DB — with command buffering off, the
 * FmsTask query fails immediately, exercising the fallback.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { attachStepTiming } from '../stepTiming.js';

mongoose.set('bufferCommands', false);

test('lookup failure returns the rows unchanged (list still loads)', async () => {
  const rows = [{ _id: new mongoose.Types.ObjectId(), approvalStatus: 'DRAFT', poStatus: 'DRAFT' }];
  const out = await attachStepTiming('PO', rows);
  assert.equal(out, rows);
  assert.equal(out[0].stepTiming, undefined);
});

test('unknown list key or empty page is a no-op', async () => {
  const rows = [{ _id: 'x' }];
  assert.equal(await attachStepTiming('NOPE', rows), rows);
  assert.deepEqual(await attachStepTiming('PO', []), []);
});
