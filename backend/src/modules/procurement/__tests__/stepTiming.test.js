/**
 * Purchase FMS list step timing (stepTiming.rules.js): which existing field
 * feeds Planned / Actual / Done By / Assigned Doer, pending vs completed, and
 * that nothing is fabricated when data is missing.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { STEP_TIMING, resolveStepTiming, pickTask } from '../stepTiming.rules.js';

const T = (iso) => new Date(iso);
const ID = (n) => `64b000000000000000000${String(n).padStart(3, '0')}`;
const META = {
  INDENT_APPROVAL: { code: '1.1A', label: 'Indent Approval' },
  QUOTE_COMPARATIVE: { code: '1.2', label: 'Receive Quote & Comparative' },
  PO_RELEASE: { code: '1.4B', label: 'Release PO' },
};
const task = (stepKey, entityType, entityId, status, doer, openedAt = '2026-10-01T00:00:00Z') => ({
  stepKey, entityType, entityId, status, openedAt: T(openedAt), assignedDoerId: doer ? { _id: ID(900), name: doer } : null,
});
const run = (key, doc, ctx) => resolveStepTiming(doc, STEP_TIMING[key], { meta: META, ...ctx });

test('indent waiting for approval: pending at 1.1A with its doer, no actual', () => {
  const doc = { _id: ID(1), approvalStatus: 'PENDING_APPROVAL', overallStatus: 'INDENT_GENERATED', activityTimeline: [] };
  const r = run('INDENT', doc, { tasks: [task('INDENT_APPROVAL', 'INDENT', ID(1), 'OPEN', 'Asha Doer')] });
  assert.equal(r.stepKey, 'INDENT_APPROVAL');
  assert.equal(r.stepCode, '1.1A');
  assert.equal(r.multiStep, true);
  assert.equal(r.done, false);
  assert.equal(r.actualAt, null);
  assert.equal(r.doneByName, null);
  assert.equal(r.assignedDoerName, 'Asha Doer');
});

test('indent at quote step: planned is quoteStep.plannedAt', () => {
  const doc = {
    _id: ID(2), approvalStatus: 'APPROVED', overallStatus: 'QUOTE_PENDING',
    approval: { approvedAt: T('2026-10-20T10:00:00Z'), approvedBy: 'MD' },
    quoteStep: { plannedAt: T('2026-10-20T10:00:00Z') },
  };
  const r = run('INDENT', doc);
  assert.equal(r.stepKey, 'QUOTE_COMPARATIVE');
  assert.equal(r.plannedAt.toISOString(), '2026-10-20T10:00:00.000Z');
  assert.equal(r.done, false);
  assert.equal(r.assignedDoerName, null); // no task → no doer, never a guess
});

test('indent fully through quotation approval: actual + name resolved from the user id', () => {
  const doc = {
    _id: ID(3), approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED',
    quoteComparativeStep: { actualAt: T('2026-10-21T05:00:00Z'), updatedBy: ID(11) },
    quotationApprovalStep: { actualAt: T('2026-10-22T09:15:00Z'), updatedBy: ID(12) },
  };
  const names = new Map([[ID(12), 'Rahul Sharma']]);
  const r = run('INDENT', doc, { names });
  assert.equal(r.stepKey, 'QUOTATION_APPROVAL');
  assert.equal(r.done, true);
  assert.equal(r.actualAt.toISOString(), '2026-10-22T09:15:00.000Z');
  assert.equal(r.doneByName, 'Rahul Sharma');
});

test('"Quote Not Required" never shows the skipped Step 1.3 as performed — falls back to 1.2', () => {
  const doc = {
    _id: ID(30), approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED',
    quoteComparativeStep: { actualAt: T('2026-10-21T05:00:00Z'), updatedBy: ID(11) },
    quotationApprovalStep: { skipped: true, actualAt: T('2026-10-21T05:00:00Z'), updatedBy: ID(11) },
  };
  const r = run('INDENT', doc, { names: new Map([[ID(11), 'Quote User']]) });
  assert.equal(r.stepKey, 'QUOTE_COMPARATIVE');
  assert.equal(r.done, true);
  assert.equal(r.doneByName, 'Quote User');
  assert.equal(r.multiStep, true);
});

test('rejected indent shows the recorded rejection decision, not a pending step', () => {
  const doc = {
    _id: ID(4), approvalStatus: 'REJECTED', overallStatus: 'CLOSED',
    approval: { approvedAt: T('2026-10-23T08:00:00Z'), approvedBy: 'Nikhil Approver' },
  };
  const r = run('INDENT', doc);
  assert.equal(r.stepKey, 'INDENT_APPROVAL');
  assert.equal(r.done, true);
  assert.equal(r.doneByName, 'Nikhil Approver');
});

test('rejected draft with nothing recorded shows nothing', () => {
  const r = run('PO', { _id: ID(5), approvalStatus: 'DRAFT', poStatus: 'CANCELLED' });
  assert.equal(r.stepKey, null);
  assert.equal(r.actualAt, null);
  assert.equal(r.assignedDoerName, null);
});

test('PO approved but not released: pending at Release with the release doer', () => {
  const doc = {
    _id: ID(6), approvalStatus: 'APPROVED', releaseStatus: 'NOT_RELEASED', poStatus: 'APPROVED',
    approval: { decidedAt: T('2026-10-24T06:00:00Z'), decidedBy: 'MD' },
  };
  const r = run('PO', doc, { tasks: [
    task('PO_APPROVAL', 'PO', ID(6), 'DONE', 'Approver Doer'),
    task('PO_RELEASE', 'PO', ID(6), 'OPEN', 'Release Doer'),
  ] });
  assert.equal(r.stepKey, 'PO_RELEASE');
  assert.equal(r.done, false);
  assert.equal(r.assignedDoerName, 'Release Doer');
  assert.equal(r.actualAt, null);
});

test('released PO: doer and completer differ and are both shown', () => {
  const doc = {
    _id: ID(7), approvalStatus: 'APPROVED', releaseStatus: 'RELEASED', poStatus: 'RELEASED_TO_VENDOR',
    releasedAt: T('2026-10-25T10:15:00Z'), releasedBy: 'Someone Else',
  };
  const r = run('PO', doc, { tasks: [task('PO_RELEASE', 'PO', ID(7), 'DONE', 'Release Doer')] });
  assert.equal(r.done, true);
  assert.equal(r.doneByName, 'Someone Else');
  assert.equal(r.assignedDoerName, 'Release Doer');
});

test('rescheduled follow-up is pending (no actual / creator name); ready-for-GRN is done', () => {
  const base = { _id: ID(8), poId: ID(80), plannedAt: T('2026-10-27T00:00:00Z'), actualAt: T('2026-10-24T00:00:00Z'), performedByName: 'Creator' };
  const pending = run('FOLLOW_UP', { ...base, followUpStatus: 'RESCHEDULED', statusDone: 'NO' },
    { tasks: [task('MATERIAL_FOLLOWUP', 'PO', ID(80), 'OPEN', 'FU Doer')] });
  assert.equal(pending.done, false);
  assert.equal(pending.plannedAt.toISOString(), '2026-10-27T00:00:00.000Z');
  assert.equal(pending.actualAt, null);
  assert.equal(pending.doneByName, null);
  assert.equal(pending.assignedDoerName, 'FU Doer');
  assert.equal(pending.multiStep, false);

  const done = run('FOLLOW_UP', { ...base, followUpStatus: 'READY_FOR_GRN', statusDone: 'YES', performedByName: 'Completer' },
    { tasks: [task('MATERIAL_FOLLOWUP', 'PO', ID(80), 'DONE', 'FU Doer')] });
  assert.equal(done.done, true);
  assert.equal(done.actualAt.toISOString(), '2026-10-24T00:00:00.000Z');
  assert.equal(done.doneByName, 'Completer');
});

test('pending tally entry never shows its creator as Done By', () => {
  const r = run('TALLY', { _id: ID(9), voucherId: ID(90), tallyEntryStatus: 'PENDING', plannedAt: T('2026-10-20T00:00:00Z'), performedByName: 'Creator' });
  assert.equal(r.done, false);
  assert.equal(r.doneByName, null);
  assert.ok(r.plannedAt);
});

test('QC done-by comes from the COMPLETE audit entry; missing actor → null, not checkedByName', () => {
  const doc = {
    _id: ID(10), grnId: ID(100), qcStatus: 'PASSED', completedAt: T('2026-10-25T07:00:00Z'), checkedByName: 'QC Creator',
    activityTimeline: [{ action: 'CREATE', actorId: ID(13) }, { action: 'COMPLETE', actorId: ID(14) }],
  };
  assert.equal(run('QC', doc, { names: new Map([[ID(14), 'QC Finisher']]) }).doneByName, 'QC Finisher');
  assert.equal(run('QC', { ...doc, activityTimeline: [] }).doneByName, null);
});

test('service QC looks up the doer on the indent, GRN QC on the GRN', () => {
  const tasks = [task('INCOMING_QC', 'INDENT', ID(200), 'OPEN', 'Service QC Doer'), task('INCOMING_QC', 'GRN', ID(201), 'OPEN', 'GRN QC Doer')];
  assert.equal(run('QC', { _id: ID(11), sourceType: 'SERVICE', indentId: ID(200), qcStatus: 'DRAFT' }, { tasks }).assignedDoerName, 'Service QC Doer');
  assert.equal(run('QC', { _id: ID(12), sourceType: 'GRN', grnId: ID(201), qcStatus: 'DRAFT' }, { tasks }).assignedDoerName, 'GRN QC Doer');
});

test('advance / final payment entries use the saved time; cancelled shows nothing', () => {
  const ap = run('ADVANCE_PAYMENT', { _id: ID(13), piId: ID(130), paymentStatus: 'FULL_PAYMENT', createdAt: T('2026-10-25T11:45:00Z'), performedByName: 'Accounts' });
  assert.equal(ap.actualAt.toISOString(), '2026-10-25T11:45:00.000Z');
  assert.equal(ap.doneByName, 'Accounts');
  const fp = run('FINAL_PAYMENT', { _id: ID(14), voucherId: ID(140), paymentStatus: 'CANCELLED', createdAt: T('2026-10-25T11:45:00Z') });
  assert.equal(fp.actualAt, null);
  assert.equal(fp.done, false);
});

test('voucher with an unknown poster shows no name; invalid dates never leak', () => {
  const r = run('VOUCHER', { _id: ID(15), voucherStatus: 'POSTED', postedAt: 'not-a-date', activityTimeline: [] });
  assert.equal(r.done, true);
  assert.equal(r.actualAt, null);
  assert.equal(r.doneByName, null);
});

test('vendor invoice falls back to the QC-side task when the invoice has none', () => {
  const r = run('VENDOR_INVOICE', { _id: ID(16), qcId: ID(160), invoiceStatus: 'RECEIVED' },
    { tasks: [task('VENDOR_INVOICE', 'QC', ID(160), 'DONE', 'Invoice Doer')] });
  assert.equal(r.done, false);
  assert.equal(r.assignedDoerName, 'Invoice Doer');
});

test('pickTask prefers OPEN for pending, DONE for completed, newest first', () => {
  const tasks = [
    task('GRN', 'PO', ID(17), 'DONE', 'Old', '2026-09-01T00:00:00Z'),
    task('GRN', 'PO', ID(17), 'DONE', 'New', '2026-10-01T00:00:00Z'),
    task('GRN', 'PO', ID(17), 'OPEN', 'Open', '2026-08-01T00:00:00Z'),
  ];
  const ents = [{ entityType: 'PO', entityId: ID(17) }];
  assert.equal(pickTask(tasks, ents, 'GRN', true).assignedDoerId.name, 'New');
  assert.equal(pickTask(tasks, ents, 'GRN', false).assignedDoerId.name, 'Open');
  assert.equal(pickTask(tasks, [null], 'GRN', false), null);
});
