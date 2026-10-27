/**
 * Planned dates for Step 1.02 / Step 1.03 (indent/quotationSteps.js), per the
 * Purchase FMS 1.0 sheet: working days with Friday as the weekly off, time of
 * day kept, weekdays read in IST.
 *   1.02 planned = indent approval + 3 working days (stamped into quoteStep.plannedAt)
 *   1.03 planned = Step 1.02 actual + 1 working day (derived; none until 1.02 is done)
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addWorkingDays, quoteComparativePlannedAt, quotationApprovalPlannedAt, WEEKLY_OFF_DAY,
} from '../indent/quotationSteps.js';
import { STEP_TIMING, resolveStepTiming } from '../stepTiming.rules.js';

const T = (iso) => new Date(iso);
const istDay = (d) => d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short' });
// The sheet stores times rounded to the minute.
const sameMinute = (a, b) => Math.abs(a.getTime() - T(b).getTime()) <= 60 * 1000;

// Real rows of the sheet's Indent FMS tab (IST wall clock converted to UTC):
// [indent, base, planned]. One per weekday pattern, incl. every Friday skip.
const SHEET_1_02 = [ // base = the sheet's indent timestamp; the rule (+3 working days) is what is checked
  ['Ind-1/24-25',   '2024-04-06T05:10Z', '2024-04-09T05:09Z'], // Sat→Tue
  ['Ind-10/24-25',  '2024-04-07T06:18Z', '2024-04-10T06:18Z'], // Sun→Wed
  ['Ind-45/24-25',  '2024-04-29T06:54Z', '2024-05-02T06:54Z'], // Mon→Thu
  ['Ind-11/24-25',  '2024-04-09T06:19Z', '2024-04-13T06:19Z'], // Tue→Sat (Fri skipped)
  ['Ind-23/24-25',  '2024-04-17T06:29Z', '2024-04-21T06:29Z'], // Wed→Sun (Fri skipped)
  ['Ind-27/24-25',  '2024-04-18T06:33Z', '2024-04-22T06:33Z'], // Thu→Mon (Fri skipped)
  ['Ind-273/24-25', '2024-07-26T08:50Z', '2024-07-29T08:50Z'], // Fri→Mon (start day never counts)
];
const SHEET_1_03 = [ // base = Step 1.2 actual
  ['Ind-168/24-25', '2024-06-24T07:13Z', '2024-06-25T07:13Z'], // Mon→Tue
  ['Ind-199/24-25', '2024-06-30T07:10Z', '2024-07-01T07:10Z'], // Sun→Mon
  ['Ind-470/24-25', '2024-10-19T09:39Z', '2024-10-20T09:39Z'], // Sat→Sun
  ['Ind-76/25-26',  '2025-05-15T06:21Z', '2025-05-17T06:21Z'], // Thu→Sat (Fri skipped)
];

test('weekly off is Friday', () => assert.equal(WEEKLY_OFF_DAY, 5));

test('Step 1.02: +3 working days reproduces the sheet', () => {
  for (const [ind, base, planned] of SHEET_1_02) {
    const got = quoteComparativePlannedAt(T(base));
    assert.ok(sameMinute(got, planned), `${ind}: ${got.toISOString()} ≠ ${planned}`);
    assert.notEqual(istDay(got), 'Fri', ind);
  }
});

test('Step 1.03: +1 working day after the 1.02 actual reproduces the sheet', () => {
  for (const [ind, actual, planned] of SHEET_1_03) {
    const got = quotationApprovalPlannedAt({ quoteComparativeStep: { statusDone: 'YES', actualAt: T(actual) } });
    assert.ok(sameMinute(got, planned), `${ind}: ${got.toISOString()} ≠ ${planned}`);
  }
});

test('calendar days would NOT match the sheet (guards against a silent switch)', () => {
  const [, base, planned] = SHEET_1_02[3]; // Tue→Sat
  const calendar = new Date(T(base).getTime() + 3 * 864e5);
  assert.ok(!sameMinute(calendar, planned));
});

test('the weekday is read in IST, not UTC', () => {
  // Thu 2026-10-29 20:00 UTC = Fri 30 Oct 01:30 IST → counting starts on a Friday:
  // Sat, Sun, Mon → Mon 02 Nov 01:30 IST.
  assert.equal(addWorkingDays(T('2026-10-29T20:00:00Z'), 3).toISOString(), '2026-11-01T20:00:00.000Z');
  // Thu 2026-10-29 10:00 UTC = Thu 15:30 IST → Fri skipped: Sat, Sun, Mon.
  assert.equal(addWorkingDays(T('2026-10-29T10:00:00Z'), 3).toISOString(), '2026-11-02T10:00:00.000Z');
  // Mon 2026-10-26 10:00 UTC → Thu, no Friday in the window.
  assert.equal(addWorkingDays(T('2026-10-26T10:00:00Z'), 3).toISOString(), '2026-10-29T10:00:00.000Z');
});

test('a date-only actual (UTC midnight) stays date-only: Thursday → Saturday', () => {
  const got = quotationApprovalPlannedAt({ quoteComparativeStep: { statusDone: 'YES', actualAt: T('2026-10-29T00:00:00Z') } });
  assert.equal(got.toISOString(), '2026-10-31T00:00:00.000Z');
});

test('missing or invalid dates give no planned date (never "now")', () => {
  assert.equal(addWorkingDays(null, 3), null);
  assert.equal(addWorkingDays(undefined, 1), null);
  assert.equal(addWorkingDays('not a date', 1), null);
  assert.equal(quoteComparativePlannedAt(null), null);
  assert.equal(quotationApprovalPlannedAt({ quoteComparativeStep: { statusDone: 'YES', actualAt: null } }), null);
  assert.equal(quotationApprovalPlannedAt(null), null);
});

test('Step 1.03 has no planned date until Step 1.02 is completed with a quotation', () => {
  const actual = T('2026-10-26T00:00:00Z');
  // 1.2 still pending
  assert.equal(quotationApprovalPlannedAt({ overallStatus: 'QUOTE_PENDING', quoteStep: { status: 'PENDING', plannedAt: actual } }), null);
  // 1.2 "Quote Not Required" → 1.3 skipped
  assert.equal(quotationApprovalPlannedAt({
    quoteComparativeStep: { statusDone: 'QUOTE_NOT_REQUIRED', actualAt: actual }, quotationApprovalStep: { skipped: true, actualAt: actual },
  }), null);
  // old receive-quote route: "not required" without a skip — still nothing to plan
  assert.equal(quotationApprovalPlannedAt({ quoteStep: { status: 'NOT_REQUIRED', actualAt: actual } }), null);
  // received
  assert.equal(quotationApprovalPlannedAt({ quoteComparativeStep: { statusDone: 'YES', actualAt: actual } }).toISOString(), '2026-10-27T00:00:00.000Z');
});

test('older records with only the quoteStep shape derive 1.03 from quoteStep.actualAt', () => {
  const got = quotationApprovalPlannedAt({ quoteStep: { status: 'RECEIVED', actualAt: T('2024-06-24T07:13:00Z') } });
  assert.equal(got.toISOString(), '2024-06-25T07:13:00.000Z');
});

test('a retried / repeated Step 1.2 save with the same actual date gives the same 1.03 planned date', () => {
  const indent = { quoteComparativeStep: { statusDone: 'YES', actualAt: T('2026-10-28T00:00:00Z') } };
  assert.equal(quotationApprovalPlannedAt(indent).toISOString(), quotationApprovalPlannedAt({ ...indent }).toISOString());
  assert.equal(quotationApprovalPlannedAt(indent).toISOString(), '2026-10-29T00:00:00.000Z'); // Wed → Thu
});

// ── What the lists show (step timing) ──────────────────────────────────────
const META = { QUOTE_COMPARATIVE: { code: '1.2', label: 'Quote' }, QUOTATION_APPROVAL: { code: '1.3', label: 'Approval' } };
const run = (key, doc) => resolveStepTiming({ _id: '64b000000000000000000001', ...doc }, STEP_TIMING[key], { meta: META });

test('1.02 list: planned is the stored quoteStep.plannedAt — an older indent keeps its historical value', () => {
  const old = T('2026-10-20T10:00:00Z'); // stamped by the old rule (= the approval instant)
  const r = run('INDENT_QUOTE_COMPARATIVE', { approvalStatus: 'APPROVED', overallStatus: 'QUOTE_PENDING', quoteStep: { status: 'PENDING', plannedAt: old } });
  assert.equal(r.plannedAt.toISOString(), old.toISOString());
});

test('1.03 list: pending row gets the derived planned date; skipped row gets none', () => {
  const pending = run('INDENT_QUOTATION_APPROVAL', {
    approvalStatus: 'APPROVED', overallStatus: 'QUOTE_RECEIVED',
    quoteComparativeStep: { statusDone: 'YES', actualAt: T('2026-10-29T00:00:00Z') }, quotationApprovalStep: { skipped: false },
  });
  assert.equal(pending.done, false);
  assert.equal(pending.plannedAt.toISOString(), '2026-10-31T00:00:00.000Z'); // Thu → Sat
  const skipped = run('INDENT_QUOTATION_APPROVAL', {
    approvalStatus: 'APPROVED', overallStatus: 'QUOTATION_APPROVED',
    quoteComparativeStep: { statusDone: 'QUOTE_NOT_REQUIRED', actualAt: T('2026-10-29T00:00:00Z') },
    quotationApprovalStep: { skipped: true, actualAt: T('2026-10-29T00:00:00Z') },
  });
  assert.equal(skipped.plannedAt, null);
});

test('full indent list at Step 1.3 shows the same derived planned date', () => {
  const r = run('INDENT', {
    approvalStatus: 'APPROVED', overallStatus: 'QUOTE_RECEIVED', approval: { approvedAt: T('2026-10-26T05:00:00Z') },
    quoteStep: { status: 'RECEIVED', plannedAt: T('2026-10-29T05:00:00Z') },
    quoteComparativeStep: { statusDone: 'YES', actualAt: T('2026-10-27T00:00:00Z') }, quotationApprovalStep: { skipped: false },
  });
  assert.equal(r.stepKey, 'QUOTATION_APPROVAL');
  assert.equal(r.plannedAt.toISOString(), '2026-10-28T00:00:00.000Z');
});
