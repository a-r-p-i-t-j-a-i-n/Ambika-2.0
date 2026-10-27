/**
 * Step 1.2 / Step 1.3 as main Purchase FMS workflow steps (indent/quotationSteps.js):
 * which indents each step list shows per state, that the states partition the
 * step (no indent counted twice or lost), that "Quote Not Required" never
 * creates a pending Step 1.2 / 1.3 row, and each list's own step timing.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 *
 * Filters are evaluated with sift (mongoose's own matcher); the API oracle
 * e2eQuotationStepsFixture.js re-checks them against a real MongoDB.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sift from 'sift';

import {
  QUOTATION_FMS_STEPS, QUOTATION_STEP_STATES, QUOTE_COMPARATIVE_PENDING, QUOTATION_APPROVAL_PENDING,
  quotationStepFilter, isDownstreamOfQuotation,
} from '../indent/quotationSteps.js';
import { STEP_TIMING, resolveStepTiming } from '../stepTiming.rules.js';

const T = (iso) => new Date(iso);
const ID = (n) => `64b000000000000000000${String(n).padStart(3, '0')}`;

// One indent per real-life shape the workflow produces.
const INDENTS = {
  draft:          { approvalStatus: 'DRAFT', overallStatus: 'INDENT_GENERATED' },
  awaiting:       { approvalStatus: 'PENDING_APPROVAL', overallStatus: 'INDENT_GENERATED' },
  rejected:       { approvalStatus: 'REJECTED', overallStatus: 'CLOSED' },
  quotePending:   { approvalStatus: 'APPROVED', overallStatus: 'QUOTE_PENDING', quoteStep: { status: 'PENDING' } },
  quoteReceived:  {
    approvalStatus: 'APPROVED', overallStatus: 'QUOTE_RECEIVED',
    quoteStep: { status: 'RECEIVED' }, quoteComparativeStep: { statusDone: 'YES' }, quotationApprovalStep: { statusDone: null, skipped: false },
  },
  approved:       {
    approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED',
    quoteComparativeStep: { statusDone: 'YES' }, quotationApprovalStep: { statusDone: 'YES', skipped: false },
  },
  approvedPoed:   {
    approvalStatus: 'APPROVED', overallStatus: 'PO_READY',
    quoteComparativeStep: { statusDone: 'YES' }, quotationApprovalStep: { statusDone: 'YES', skipped: false },
  },
  notRequired:    {
    approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED',
    quoteStep: { status: 'NOT_REQUIRED' }, quoteComparativeStep: { statusDone: 'QUOTE_NOT_REQUIRED' },
    quotationApprovalStep: { statusDone: null, skipped: true },
  },
  notRequiredPo:  {
    approvalStatus: 'APPROVED', overallStatus: 'PARTIAL_PO_CREATED',
    quoteComparativeStep: { statusDone: 'QUOTE_NOT_REQUIRED' }, quotationApprovalStep: { skipped: true },
  },
  serviceSkipped: {
    approvalStatus: 'APPROVED', overallStatus: 'SERVICE_PENDING', requestType: 'INTERNAL_SERVICE',
    quoteComparativeStep: { statusDone: 'QUOTE_NOT_REQUIRED' }, quotationApprovalStep: { skipped: true },
  },
  // Pre item-wise records: only the old quoteStep shape.
  legacyReceived: { approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED', quoteStep: { status: 'RECEIVED' } },
  legacyNotReq:   { approvalStatus: 'APPROVED', overallStatus: 'QUOTE_NOT_REQUIRED', quoteStep: { status: 'NOT_REQUIRED' } },
};

const rowsAt = (step, state) => {
  const match = sift(quotationStepFilter(step, state));
  return Object.entries(INDENTS).filter(([, d]) => match(d)).map(([k]) => k).sort();
};

test('Step 1.2 pending = approved indents waiting for a quote — the doer-task source', () => {
  assert.deepEqual(rowsAt('QUOTE_COMPARATIVE', 'PENDING'), ['quotePending']);
  assert.deepEqual(QUOTE_COMPARATIVE_PENDING, { overallStatus: 'QUOTE_PENDING' });
});

test('Step 1.2 done vs not required', () => {
  assert.deepEqual(rowsAt('QUOTE_COMPARATIVE', 'DONE'), ['approved', 'approvedPoed', 'legacyReceived', 'quoteReceived']);
  assert.deepEqual(rowsAt('QUOTE_COMPARATIVE', 'NOT_REQUIRED'), ['legacyNotReq', 'notRequired', 'notRequiredPo', 'serviceSkipped']);
});

test('Step 1.3 pending = quote received, not skipped — never a "Quote Not Required" indent', () => {
  const pending = rowsAt('QUOTATION_APPROVAL', 'PENDING');
  // legacyNotReq came from the old receive-quote route, which never skipped Step 1.3
  // (the existing doer task treats it as pending too).
  assert.deepEqual(pending, ['legacyNotReq', 'quoteReceived']);
  for (const k of ['notRequired', 'notRequiredPo', 'serviceSkipped']) assert.ok(!pending.includes(k), k);
  assert.deepEqual(rowsAt('QUOTATION_APPROVAL', 'DONE'), ['approved', 'approvedPoed', 'legacyReceived']);
  assert.deepEqual(rowsAt('QUOTATION_APPROVAL', 'NOT_REQUIRED'), ['notRequired', 'notRequiredPo', 'serviceSkipped']);
});

test('draft, awaiting-approval and rejected indents never reach either step', () => {
  for (const step of QUOTATION_FMS_STEPS) {
    for (const state of [...QUOTATION_STEP_STATES, undefined]) {
      const rows = rowsAt(step, state);
      for (const k of ['draft', 'awaiting', 'rejected']) assert.ok(!rows.includes(k), `${step}/${state} has ${k}`);
    }
  }
});

test('the three states partition each step: every indent of the step in exactly one state', () => {
  for (const step of QUOTATION_FMS_STEPS) {
    const all = rowsAt(step, undefined);
    const byState = QUOTATION_STEP_STATES.flatMap((s) => rowsAt(step, s));
    assert.deepEqual([...byState].sort(), all, step);
    assert.equal(new Set(byState).size, byState.length, `${step}: an indent is in two states`);
  }
  // Step 1.3 only holds indents past Step 1.2.
  assert.ok(!rowsAt('QUOTATION_APPROVAL', undefined).includes('quotePending'));
});

test('Step 1.3 pending list = the existing Step 1.3 doer-task filter (plus not skipped)', () => {
  const taskMatch = sift(QUOTATION_APPROVAL_PENDING);
  const taskRows = Object.entries(INDENTS).filter(([, d]) => taskMatch(d)).map(([k]) => k).sort();
  assert.deepEqual(taskRows, rowsAt('QUOTATION_APPROVAL', 'PENDING'));
});

test('unknown step → no filter', () => {
  assert.equal(quotationStepFilter('PO_CREATE', 'PENDING'), null);
});

test('downstream statuses lock the quotation steps', () => {
  for (const s of ['PARTIAL_PO_CREATED', 'PO_READY', 'SERVICE_COMPLETED', 'SERVICE_QC_PASSED', 'CLOSED']) {
    assert.equal(isDownstreamOfQuotation({ overallStatus: s }), true, s);
  }
  for (const s of ['QUOTE_PENDING', 'QUOTE_RECEIVED', 'QUOTATION_APPROVED', 'SERVICE_PENDING']) {
    assert.equal(isDownstreamOfQuotation({ overallStatus: s }), false, s);
  }
});

// ── Per-step timing on the two step lists ───────────────────────────────────
const META = {
  QUOTE_COMPARATIVE: { code: '1.2', label: 'Receive Quote & Comparative' },
  QUOTATION_APPROVAL: { code: '1.3', label: 'Approved Quotation' },
};
const users = new Map([[ID(500), 'Vrutali'], [ID(501), 'Aarti']]);
const run = (key, doc, tasks = []) => resolveStepTiming({ _id: ID(1), ...doc }, STEP_TIMING[key], { meta: META, names: users, tasks });
const doerTask = (stepKey, status) => ({
  stepKey, entityType: 'INDENT', entityId: ID(1), status, openedAt: T('2026-10-20T00:00:00Z'), assignedDoerId: { name: 'Ashwini' },
});

test('Step 1.2 list: pending row shows planned + doer, no actual', () => {
  const r = run('INDENT_QUOTE_COMPARATIVE', {
    approvalStatus: 'APPROVED', overallStatus: 'QUOTE_PENDING', quoteStep: { status: 'PENDING', plannedAt: T('2026-10-20T10:00:00Z') },
  }, [doerTask('QUOTE_COMPARATIVE', 'OPEN')]);
  assert.equal(r.stepKey, 'QUOTE_COMPARATIVE');
  assert.equal(r.multiStep, false);
  assert.equal(r.done, false);
  assert.equal(r.plannedAt.toISOString(), '2026-10-20T10:00:00.000Z');
  assert.equal(r.actualAt, null);
  assert.equal(r.assignedDoerName, 'Ashwini');
});

test('Step 1.2 list: a row already at Step 1.3 still shows its Step 1.2 actual + performer', () => {
  const r = run('INDENT_QUOTE_COMPARATIVE', {
    ...INDENTS.quoteReceived,
    quoteComparativeStep: { statusDone: 'YES', actualAt: T('2026-10-21T00:00:00Z'), updatedBy: ID(500) },
  });
  assert.equal(r.stepKey, 'QUOTE_COMPARATIVE');
  assert.equal(r.done, true);
  assert.equal(r.actualAt.toISOString(), '2026-10-21T00:00:00.000Z');
  assert.equal(r.doneByName, 'Vrutali');
});

test('Step 1.3 list: approved row shows the approver; pending row has no actual', () => {
  const done = run('INDENT_QUOTATION_APPROVAL', {
    ...INDENTS.approved,
    quotationApprovalStep: { statusDone: 'YES', skipped: false, actualAt: T('2026-10-22T00:00:00Z'), updatedBy: ID(501) },
  });
  assert.equal(done.done, true);
  assert.equal(done.doneByName, 'Aarti');
  const pending = run('INDENT_QUOTATION_APPROVAL', INDENTS.quoteReceived, [doerTask('QUOTATION_APPROVAL', 'OPEN')]);
  assert.equal(pending.done, false);
  assert.equal(pending.actualAt, null);
  assert.equal(pending.assignedDoerName, 'Ashwini');
});

test('Step 1.3 list: a skipped (Quote Not Required) row is done with no fake actual or performer', () => {
  const r = run('INDENT_QUOTATION_APPROVAL', {
    ...INDENTS.notRequired,
    quotationApprovalStep: { skipped: true, actualAt: T('2026-10-21T00:00:00Z'), updatedBy: ID(500) },
  });
  assert.equal(r.done, true);
  assert.equal(r.actualAt, null);
  assert.equal(r.doneByName, null);
});

test('the full indent list keeps its current-step timing (unchanged)', () => {
  const r = run('INDENT', {
    ...INDENTS.notRequired,
    approval: { approvedAt: T('2026-10-20T00:00:00Z') },
    quoteComparativeStep: { statusDone: 'QUOTE_NOT_REQUIRED', actualAt: T('2026-10-21T00:00:00Z'), updatedBy: ID(500) },
    quotationApprovalStep: { skipped: true, actualAt: T('2026-10-21T00:00:00Z'), updatedBy: ID(500) },
  });
  assert.equal(r.stepKey, 'QUOTE_COMPARATIVE');
  assert.equal(r.multiStep, true);
  assert.equal(r.done, true);
});
