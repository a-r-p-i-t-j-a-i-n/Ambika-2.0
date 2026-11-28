import { test } from 'node:test';
import assert from 'node:assert/strict';
import sift from 'sift';
import { splitByQuoteNeed } from '../indent/approvalProgress.js';
import { QUOTATION_APPROVAL_PENDING, quotationStepFilter } from '../indent/quotationSteps.js';

const NR = (itemId) => ({ itemId, statusDone: 'QUOTE_NOT_REQUIRED' });
const YES = (itemId) => ({ itemId, statusDone: 'YES' });

test('items answered "Quote Required? = No" are split from the quoted ones', () => {
  const s = splitByQuoteNeed(['a', 'b', 'c', 'd', 'e'], [NR('a'), NR('b'), NR('c'), NR('d'), YES('e')]);
  assert.deepEqual(s.notRequired, ['a', 'b', 'c', 'd']);
  assert.deepEqual(s.quoted, ['e']);
  assert.equal(s.mixed, true);
});

test('only an indent with BOTH kinds is mixed — all no-quote (skips Step 1.3) and all quoted are not', () => {
  assert.equal(splitByQuoteNeed(['a', 'b'], [NR('a'), NR('b')]).mixed, false);
  assert.equal(splitByQuoteNeed(['a', 'b'], [YES('a'), YES('b')]).mixed, false);
  assert.equal(splitByQuoteNeed(['a'], []).mixed, false);
  assert.equal(splitByQuoteNeed([], [NR('a')]).mixed, false);
});

test('an item the rows never mention counts as quoted (it still owes a Step 1.3 decision); an ineligible item is ignored', () => {
  const s = splitByQuoteNeed(['a', 'b', 'c'], [NR('a'), NR('rejected-at-1.1')]);
  assert.deepEqual(s.notRequired, ['a']);
  assert.deepEqual(s.quoted, ['b', 'c']);
  assert.equal(s.mixed, true);
});

test('ids may be ObjectId-like', () => {
  const oid = (v) => ({ toString: () => v });
  const s = splitByQuoteNeed([oid('a'), oid('b')], [{ itemId: oid('a'), statusDone: 'QUOTE_NOT_REQUIRED' }]);
  assert.deepEqual([s.notRequired, s.quoted, s.mixed], [['a'], ['b'], true]);
});

// The state Step 1.2 leaves a MIXED indent in: PO-eligible (QUOTATION_APPROVED) but still on the Step 1.3 queue (partial).
test('a mixed indent (QUOTATION_APPROVED + partial step) stays on the Approved Quotation queue; a finished one leaves it', () => {
  const mixedOpen = { approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED', quotationApprovalStep: { statusDone: null, partial: true, skipped: false } };
  const done = { approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED', quotationApprovalStep: { statusDone: 'YES', partial: false, skipped: false } };
  const skipped = { approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED', quotationApprovalStep: { statusDone: null, partial: false, skipped: true } };
  assert.equal(sift(QUOTATION_APPROVAL_PENDING)(mixedOpen), true);
  assert.equal(sift(QUOTATION_APPROVAL_PENDING)(done), false);
  assert.equal(sift(QUOTATION_APPROVAL_PENDING)(skipped), false);
  assert.equal(sift(quotationStepFilter('QUOTATION_APPROVAL', 'PENDING'))(mixedOpen), true);
  assert.equal(sift(quotationStepFilter('QUOTATION_APPROVAL', 'PENDING'))(skipped), false);
  assert.equal(sift(quotationStepFilter('QUOTATION_APPROVAL', 'NOT_REQUIRED'))(skipped), true);
});
