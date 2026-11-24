/**
 * Step 1.3 item-wise progress (indent/approvalProgress.js): partial approval, holds,
 * reopening / completing later, the previous-vendors-only rule and how a PARTIAL
 * approval sits in the step queue and step timing. The API oracle
 * e2eApprovalPartialFixture.js re-checks the same rules against a real MongoDB
 * (partial submit, hold, reopen, complete later, duplicate-PO prevention).
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sift from 'sift';

import {
  quotedItemIds, mergeApprovalRows, approvalProgress, statusAfterApproval, approvalVendorHistoryProblem,
} from '../indent/approvalProgress.js';
import { quotationStepFilter, QUOTATION_APPROVAL_PENDING } from '../indent/quotationSteps.js';
import { STEP_TIMING } from '../stepTiming.rules.js';

const effective = (_indent, it) => it.approvalStatus !== 'REJECTED';
const I = (n) => `64b00000000000000000a${String(n).padStart(3, '0')}`;
const indent3 = (extra = {}) => ({
  items: [{ _id: I(1) }, { _id: I(2) }, { _id: I(3) }],
  quoteComparativeStep: { statusDone: 'YES', itemQuotations: [] },
  ...extra,
});
const row = (n, statusDone, extra = {}) => ({ itemId: I(n), statusDone, ...extra });

// ── which items owe a decision ─────────────────────────────────────────────
test('quotedItemIds: Quote Not Required and Step-1.1-rejected items owe no Step 1.3 decision', () => {
  const ind = indent3({
    items: [{ _id: I(1) }, { _id: I(2) }, { _id: I(3), approvalStatus: 'REJECTED' }, { _id: I(4) }],
    quoteComparativeStep: { itemQuotations: [{ itemId: I(2), statusDone: 'QUOTE_NOT_REQUIRED' }] },
  });
  assert.deepEqual(quotedItemIds(ind, effective), [I(1), I(4)]);
});

// ── partial submission ─────────────────────────────────────────────────────
test('partial submit: items 2 and 3 approved, item 1 on hold → step is NOT complete', () => {
  const p = approvalProgress([row(1, 'ON_HOLD'), row(2, 'YES'), row(3, 'YES')], [I(1), I(2), I(3)]);
  assert.deepEqual(p.approved, [I(2), I(3)]);
  assert.deepEqual(p.onHold, [I(1)]);
  assert.deepEqual(p.pending, []);
  assert.equal(p.complete, false);
});

test('an item with no row, or a PENDING row, is Pending — distinct from On Hold', () => {
  const p = approvalProgress([row(1, 'PENDING'), row(2, 'YES'), row(3, 'ON_HOLD')], [I(1), I(2), I(3), I(4)]);
  assert.deepEqual(p.pending, [I(1), I(4)]);
  assert.deepEqual(p.onHold, [I(3)]);
  assert.deepEqual(p.approved, [I(2)]);
});

test('held / pending rows are never PO-eligible (only YES rows count as approved)', () => {
  const p = approvalProgress([row(1, 'ON_HOLD'), row(2, 'PENDING'), row(3, 'QUOTATION_NOT_APPROVED')], [I(1), I(2), I(3)]);
  assert.deepEqual(p.approved, []);
});

// ── reopen + complete later ────────────────────────────────────────────────
test('completing the remaining item later keeps the earlier approvals and completes the step', () => {
  const saved = [row(1, 'ON_HOLD', { remarks: 'waiting for price' }), row(2, 'YES', { actualAt: '2026-11-20', remarks: 'ok' }), row(3, 'YES')];
  // second submit names only item 1 (the other two are retained from the saved rows)
  const merged = mergeApprovalRows(saved, [row(1, 'YES', { remarks: 'price agreed' })]);
  assert.equal(merged.length, 3);
  assert.equal(merged.find((r) => r.itemId === I(2)).remarks, 'ok');
  assert.equal(merged.find((r) => r.itemId === I(2)).actualAt, '2026-11-20');
  assert.equal(merged.find((r) => r.itemId === I(1)).statusDone, 'YES');
  assert.equal(approvalProgress(merged, [I(1), I(2), I(3)]).complete, true);
});

test('a stale client that omits a saved item can never drop its approval', () => {
  const saved = [row(2, 'YES'), row(3, 'YES')];
  const merged = mergeApprovalRows(saved, [row(1, 'ON_HOLD')]);
  assert.deepEqual(merged.map((r) => r.itemId).sort(), [I(1), I(2), I(3)]);
});

test('the incoming row for an item replaces the saved one (vendor / hold changes before a PO)', () => {
  const merged = mergeApprovalRows([row(2, 'YES')], [row(2, 'ON_HOLD')]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].statusDone, 'ON_HOLD');
});

test('nothing quoted → never "complete" by itself', () => {
  assert.equal(approvalProgress([], []).complete, false);
});

// ── status roll-up (duplicate-PO safety lives on the per-item PO links) ─────
test('statusAfterApproval: partial never reaches PO_READY; complete does once every approved item is POed', () => {
  assert.equal(statusAfterApproval({ partial: true, approvedItemCount: 2, poedItemCount: 0 }), 'QUOTATION_APPROVED');
  assert.equal(statusAfterApproval({ partial: true, approvedItemCount: 2, poedItemCount: 2 }), 'PARTIAL_PO_CREATED');
  assert.equal(statusAfterApproval({ partial: false, approvedItemCount: 3, poedItemCount: 2 }), 'PARTIAL_PO_CREATED');
  assert.equal(statusAfterApproval({ partial: false, approvedItemCount: 3, poedItemCount: 3 }), 'PO_READY');
  assert.equal(statusAfterApproval({ partial: false, approvedItemCount: 3, poedItemCount: 0 }), 'QUOTATION_APPROVED');
});

// ── eligible vendors only (quoted OR previously supplied) ──────────────────────────────────────────────────
const HIST = [{ vendorId: 'v1', vendorName: 'Alpha' }, { vendorId: 'v2', vendorName: 'Beta' }];
test('vendor history: a previous vendor passes', () => {
  assert.equal(approvalVendorHistoryProblem({ history: HIST, vendorId: 'v2', itemName: 'Bolt' }), '');
});
test('vendor history: a vendor who neither quoted nor supplied the item is refused and the allowed ones are named', () => {
  const why = approvalVendorHistoryProblem({ history: HIST, vendorId: 'v9', itemName: 'Bolt' });
  assert.match(why, /neither quoted for nor previously supplied "Bolt"/);
  assert.match(why, /Alpha, Beta/);
});
test('vendor history: an item with no eligible vendor says "No eligible vendors found" — no Vendor Master fallback', () => {
  const why = approvalVendorHistoryProblem({ history: [], vendorId: 'v1', itemName: 'Bolt' });
  assert.match(why, /No eligible vendors found for "Bolt"/);
  assert.match(why, /Keep the item pending/);
});

// ── queue + timing: a partial Step 1.3 is still pending ────────────────────
const queued = (d) => sift(QUOTATION_APPROVAL_PENDING)(d);
test('queue: a partial Step 1.3 (indent already QUOTATION_APPROVED / PARTIAL_PO_CREATED) stays on the Step 1.3 queue', () => {
  assert.equal(queued({ overallStatus: 'QUOTE_RECEIVED' }), true);
  assert.equal(queued({ overallStatus: 'QUOTATION_APPROVED', quotationApprovalStep: { partial: true } }), true);
  assert.equal(queued({ overallStatus: 'PARTIAL_PO_CREATED', quotationApprovalStep: { partial: true } }), true);
  assert.equal(queued({ overallStatus: 'QUOTATION_APPROVED', quotationApprovalStep: { partial: false, statusDone: 'YES' } }), false);
});
test('queue: PENDING / DONE / NOT_REQUIRED still partition the step when partial indents exist', () => {
  const docs = [
    { approvalStatus: 'APPROVED', overallStatus: 'QUOTE_RECEIVED', quotationApprovalStep: {} },
    { approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED', quotationApprovalStep: { partial: true } },
    { approvalStatus: 'APPROVED', overallStatus: 'PARTIAL_PO_CREATED', quotationApprovalStep: { partial: true } },
    { approvalStatus: 'APPROVED', overallStatus: 'PO_READY', quotationApprovalStep: { statusDone: 'YES' } },
    { approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED', quotationApprovalStep: { skipped: true } },
  ];
  const count = (st) => docs.filter(sift(quotationStepFilter('QUOTATION_APPROVAL', st))).length;
  assert.equal(count('PENDING'), 3);
  assert.equal(count('DONE'), 1);
  assert.equal(count('NOT_REQUIRED'), 1);
  assert.equal(count('PENDING') + count('DONE') + count('NOT_REQUIRED'), docs.length);
});
test('timing: a partial Step 1.3 is not reported done even though its indent moved to QUOTATION_APPROVED', () => {
  const step = STEP_TIMING.INDENT.steps.find((s) => s.key === 'QUOTATION_APPROVAL');
  const partial = { approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED', quotationApprovalStep: { partial: true, actualAt: new Date('2026-11-20') } };
  const full = { approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED', quotationApprovalStep: { partial: false, statusDone: 'YES', actualAt: new Date('2026-11-20') } };
  assert.equal(step.done(partial), false);
  assert.equal(step.done(full), true);
});
