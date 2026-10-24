/**
 * PI / Advance Payment optional after PO creation — a PO must not be forced
 * through a full PI + advance-payment cycle, or an explicit "Mark PI Not
 * Required", before it can reach GRN. `isPiSettledForGrn` (grn.service.js) is
 * the single gate this depends on: it now also treats the default
 * PO_PI_STATUS.NOT_RECEIVED (no PI ever created, undecided) as settled, same
 * as PAYMENT_COMPLETED and PI_NOT_REQUIRED. An APPROVED PI is settled too: its
 * advance payment (and the MD approval that payment needs) is a payment-only
 * gate and never holds the GRN back. Only a created PI still awaiting its
 * ordinary approval (PI_RECEIVED) blocks.
 *
 * Pure / DB-less test: grnService.create() itself loads real PO/GRN documents
 * from Mongo and isn't exercised here — see the module header comment for
 * what still needs a live database.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { isPiSettledForGrn } from '../grn.service.js';

test('NOT_RECEIVED (no PI, undecided) is settled — GRN can proceed without a PI decision', () => {
  assert.equal(isPiSettledForGrn('NOT_RECEIVED'), true);
});

test('PI_NOT_REQUIRED is settled (regression — explicit skip still supported)', () => {
  assert.equal(isPiSettledForGrn('PI_NOT_REQUIRED'), true);
});

test('PAYMENT_COMPLETED is settled (regression — a completed PI still supported)', () => {
  assert.equal(isPiSettledForGrn('PAYMENT_COMPLETED'), true);
});

test('PI_RECEIVED is NOT settled — a PI that exists must still be resolved', () => {
  assert.equal(isPiSettledForGrn('PI_RECEIVED'), false);
});

test('READY_FOR_ADVANCE_PAYMENT is settled — GRN never waits for the advance payment or its MD approval', () => {
  assert.equal(isPiSettledForGrn('READY_FOR_ADVANCE_PAYMENT'), true);
});

test('PI_APPROVED is settled — an approved PI never holds the GRN back', () => {
  assert.equal(isPiSettledForGrn('PI_APPROVED'), true);
});

test('unknown / missing PI status is NOT settled (defensive)', () => {
  assert.equal(isPiSettledForGrn(undefined), false);
  assert.equal(isPiSettledForGrn('SOMETHING_ELSE'), false);
});
