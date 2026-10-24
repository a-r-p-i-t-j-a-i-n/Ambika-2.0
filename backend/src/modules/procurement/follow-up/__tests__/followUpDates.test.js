/**
 * Follow-up mark-done date rules (followUp.dates.js), compared as IST days:
 *   - Actual Date may be backdated, never later than today
 *   - Next Date to Follow-up on or after the Actual Date
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { followUpDateError, istDayKey, isNextDateCycle, isNextBeforeActual, isBeforeToday } from '../followUp.dates.js';

// 24 Oct 2026, 15:00 IST.
const NOW = new Date('2026-10-24T09:30:00.000Z');
const FUTURE = 'Actual Date cannot be later than today';
const BEFORE = 'Next Date to Follow-up cannot be before the Actual Date';

test('actual date today, backdated, or omitted is accepted', () => {
  assert.equal(followUpDateError({ actualAt: '2026-10-24' }, NOW), null);
  assert.equal(followUpDateError({ actualAt: '2026-09-01' }, NOW), null);
  assert.equal(followUpDateError({}, NOW), null);
});

test('actual date later than today is rejected', () => {
  assert.equal(followUpDateError({ actualAt: '2026-10-25' }, NOW), FUTURE);
  assert.equal(followUpDateError({ actualAt: '2027-01-01', nextFollowUpDate: '2027-01-05' }, NOW), FUTURE);
});

test('next date on or after the actual date is accepted', () => {
  assert.equal(followUpDateError({ actualAt: '2026-10-24', nextFollowUpDate: '2026-10-24' }, NOW), null);
  assert.equal(followUpDateError({ actualAt: '2026-10-24', nextFollowUpDate: '2026-10-30' }, NOW), null);
  // Backdated actual with a next date still in the past: allowed (on/after actual).
  assert.equal(followUpDateError({ actualAt: '2026-10-01', nextFollowUpDate: '2026-10-03' }, NOW), null);
});

test('next date before the actual date is rejected', () => {
  assert.equal(followUpDateError({ actualAt: '2026-10-24', nextFollowUpDate: '2026-10-23' }, NOW), BEFORE);
  assert.equal(followUpDateError({ actualAt: '2026-10-10', nextFollowUpDate: '2026-10-09' }, NOW), BEFORE);
});

test('"today" is the IST day, not the UTC day', () => {
  // 25 Oct 01:30 IST is still 24 Oct in UTC — 25 Oct is today in IST, so allowed.
  const earlyIst = new Date('2026-10-24T20:00:00.000Z');
  assert.equal(istDayKey(earlyIst), '2026-10-25');
  assert.equal(followUpDateError({ actualAt: '2026-10-25' }, earlyIst), null);
  assert.equal(followUpDateError({ actualAt: '2026-10-26' }, earlyIst), FUTURE);
  // 24 Oct 23:59 IST: 25 Oct is still tomorrow.
  const lateIst = new Date('2026-10-24T18:29:00.000Z');
  assert.equal(followUpDateError({ actualAt: '2026-10-25' }, lateIst), FUTURE);
});

test('full timestamps (an omitted actual date defaults to now) compare by IST day', () => {
  const at = new Date('2026-10-24T09:00:00.000Z'); // 24 Oct, 14:30 IST
  assert.equal(followUpDateError({ actualAt: at, nextFollowUpDate: '2026-10-24' }, NOW), null);
  assert.equal(followUpDateError({ actualAt: at, nextFollowUpDate: '2026-10-23' }, NOW), BEFORE);
});

/* Edit Pending: which cycles keep nextFollowUpDate in step with plannedAt. */
const log = (...outcomes) => outcomes.map((outcome) => ({ outcome }));

test('a "Next Date to Follow Up" cycle syncs its next date', () => {
  assert.equal(isNextDateCycle({ followUpStatus: 'RESCHEDULED', nextFollowUpDate: '2026-10-29', communicationLog: log('CREATED', 'FOLLOWED_UP') }), true);
  // Several next-date cycles in a row: the latest is still a next-date cycle.
  assert.equal(isNextDateCycle({ followUpStatus: 'RESCHEDULED', nextFollowUpDate: '2026-11-02', communicationLog: log('CREATED', 'FOLLOWED_UP', 'FOLLOWED_UP') }), true);
});

test('pending, final-date, done and legacy-reschedule records do not sync', () => {
  assert.equal(isNextDateCycle({ followUpStatus: 'PENDING', nextFollowUpDate: null, communicationLog: log('CREATED') }), false);
  assert.equal(isNextDateCycle({ followUpStatus: 'READY_FOR_GRN', nextFollowUpDate: null, communicationLog: log('CREATED', 'READY_FOR_GRN') }), false);
  assert.equal(isNextDateCycle({ followUpStatus: 'DONE', nextFollowUpDate: null, communicationLog: log('CREATED', 'DONE') }), false);
  // Legacy /reschedule: RESCHEDULED with a next date, but it never tied plannedAt to it.
  assert.equal(isNextDateCycle({ followUpStatus: 'RESCHEDULED', nextFollowUpDate: '2026-10-29', communicationLog: log('CREATED', 'RESCHEDULED') }), false);
  assert.equal(isNextDateCycle({ followUpStatus: 'RESCHEDULED', nextFollowUpDate: '2026-10-29', communicationLog: log('CREATED', 'FOLLOWED_UP', 'RESCHEDULED') }), false);
  assert.equal(isNextDateCycle(null), false);
});

test('next-before-actual check used when an edit moves the synced next date', () => {
  assert.equal(isNextBeforeActual('2026-10-21', '2026-10-20'), true);
  assert.equal(isNextBeforeActual('2026-10-21', '2026-10-21'), false);
  assert.equal(isNextBeforeActual('2026-10-21', '2026-10-30'), false);
  assert.equal(isNextBeforeActual(null, '2026-10-01'), false); // no actual date yet → nothing to compare
});

/* Legacy /reschedule: next date not earlier than today (IST day). */
test('reschedule: yesterday rejected, today and future accepted (midday IST)', () => {
  // NOW = 24 Oct 2026, 15:00 IST
  assert.equal(isBeforeToday('2026-10-23', NOW), true);
  assert.equal(isBeforeToday('2026-10-24', NOW), false);
  assert.equal(isBeforeToday('2026-10-25', NOW), false);
  assert.equal(isBeforeToday(null, NOW), false);
});

test('reschedule: just after IST midnight, the UTC date is already "yesterday"', () => {
  // 25 Oct 01:30 IST = 24 Oct 20:00 UTC
  const earlyIst = new Date('2026-10-24T20:00:00.000Z');
  assert.equal(isBeforeToday('2026-10-24', earlyIst), true);  // IST yesterday, though still UTC today
  assert.equal(isBeforeToday('2026-10-25', earlyIst), false); // IST today
  assert.equal(isBeforeToday('2026-10-26', earlyIst), false); // future
  // A full timestamp late on 24 Oct IST is still yesterday.
  assert.equal(isBeforeToday('2026-10-24T18:00:00.000Z', earlyIst), true);
});

test('reschedule: just before IST midnight, today is still the IST day', () => {
  // 24 Oct 23:59 IST = 24 Oct 18:29 UTC
  const lateIst = new Date('2026-10-24T18:29:00.000Z');
  assert.equal(isBeforeToday('2026-10-23', lateIst), true);
  assert.equal(isBeforeToday('2026-10-24', lateIst), false);
  assert.equal(isBeforeToday('2026-10-25', lateIst), false);
});
