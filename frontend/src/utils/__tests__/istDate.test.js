/**
 * istTodayStr — the India calendar date used as the Step 1.02 dialog's default
 * Actual Date. Plain node:test (the frontend has no unit-test runner):
 *
 *   node --test src/utils/__tests__/istDate.test.js
 *
 * Run it under any TZ (e.g. TZ=UTC, TZ=America/Los_Angeles) — the result must
 * not depend on the machine's own timezone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { istTodayStr } from '../istDate.js';

const at = (iso) => new Date(iso);
const utcDate = (iso) => new Date(iso).toISOString().slice(0, 10); // the old default

test('before midnight IST: India and UTC dates agree', () => {
  assert.equal(istTodayStr(at('2026-10-26T06:30:00Z')), '2026-10-26'); // 12:00 IST
  assert.equal(istTodayStr(at('2026-10-26T18:29:59.999Z')), '2026-10-26'); // 23:59:59.999 IST
});

test('00:00–05:30 IST: India date is the next day while the UTC date is still yesterday', () => {
  const cases = [
    ['2026-10-26T18:30:00.000Z', '2026-10-27'], // 00:00 IST exactly
    ['2026-10-26T20:00:00.000Z', '2026-10-27'], // 01:30 IST
    ['2026-10-26T23:59:59.999Z', '2026-10-27'], // 05:29:59.999 IST
  ];
  for (const [iso, india] of cases) {
    assert.equal(istTodayStr(at(iso)), india, iso);
    assert.equal(utcDate(iso), '2026-10-26', `${iso}: the old UTC default was a day behind`);
  }
});

test('from 05:30 IST the UTC date catches up and both agree again', () => {
  assert.equal(istTodayStr(at('2026-10-27T00:00:00Z')), '2026-10-27'); // 05:30 IST
  assert.equal(utcDate('2026-10-27T00:00:00Z'), '2026-10-27');
});

test('month and year boundaries roll over on the India date', () => {
  assert.equal(istTodayStr(at('2026-10-31T19:00:00Z')), '2026-11-01'); // 00:30 IST 1 Nov
  assert.equal(istTodayStr(at('2026-12-31T18:45:00Z')), '2027-01-01'); // 00:15 IST 1 Jan
  assert.equal(istTodayStr(at('2028-02-28T19:00:00Z')), '2028-02-29'); // leap day
});

test('format is YYYY-MM-DD — the date input value / API payload format', () => {
  assert.match(istTodayStr(at('2026-01-05T10:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(istTodayStr(at('2026-01-05T10:00:00Z')), '2026-01-05');
});

test('defaults to the current moment', () => {
  const before = istTodayStr(new Date());
  const got = istTodayStr();
  const after = istTodayStr(new Date());
  assert.ok(got === before || got === after);
});
