/**
 * PO Date ↔ Expected Delivery Date ↔ Lead Time (poLeadTime.js) and the
 * leadTimeDays field on the PO / Vendor Master Joi schemas. No database.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolvePoDelivery, utcDay, leadTimeLabel, MAX_LEAD_DAYS } from '../poLeadTime.js';
import { createFromItemsSchema, updatePoSchema, previewPoSchema } from '../purchaseOrder.validation.js';
import { createVendorSchema, updateVendorSchema } from '../../../vendors/vendor.validation.js';

const ymd = (d) => d.toISOString().slice(0, 10);
const refused = (args, re) => assert.throws(() => resolvePoDelivery(args), (e) => e.statusCode === 400 && re.test(e.message));

test('Lead Time only → Expected Delivery Date = PO Date + days', () => {
  const r = resolvePoDelivery({ poDate: '2026-10-29', leadTimeDays: 7 });
  assert.equal(ymd(r.expectedDeliveryDate), '2026-11-05');
  assert.equal(r.leadTimeDays, 7);
  assert.equal(r.leadTime, '7 days');
});

test('Expected Delivery Date only → Lead Time = calendar days between', () => {
  const r = resolvePoDelivery({ poDate: '2026-10-29', expectedDeliveryDate: '2026-11-05' });
  assert.equal(r.leadTimeDays, 7);
  assert.equal(r.leadTime, '7 days');
});

test('both sent and agreeing are accepted; disagreeing are refused', () => {
  assert.equal(resolvePoDelivery({ poDate: '2026-10-29', expectedDeliveryDate: '2026-11-05', leadTimeDays: 7 }).leadTimeDays, 7);
  refused({ poDate: '2026-10-29', expectedDeliveryDate: '2026-11-05', leadTimeDays: 6 }, /does not match/);
});

test('month end, year end and leap years', () => {
  const cases = [
    ['2026-01-31', 1, '2026-02-01'],
    ['2026-01-31', 30, '2026-03-02'],   // non-leap February
    ['2028-02-28', 1, '2028-02-29'],    // leap day
    ['2028-02-28', 2, '2028-03-01'],
    ['2026-02-28', 1, '2026-03-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-12-25', 10, '2027-01-04'],
    ['2027-12-31', 365, '2028-12-30'],  // across a leap year
  ];
  for (const [poDate, days, edd] of cases) {
    assert.equal(ymd(resolvePoDelivery({ poDate, leadTimeDays: days }).expectedDeliveryDate), edd, `${poDate} + ${days}`);
    assert.equal(resolvePoDelivery({ poDate, expectedDeliveryDate: edd }).leadTimeDays, days, `${poDate} → ${edd}`);
  }
});

test('same-day delivery is 0 days', () => {
  const r = resolvePoDelivery({ poDate: '2026-10-29', expectedDeliveryDate: '2026-10-29' });
  assert.equal(r.leadTimeDays, 0);
  assert.equal(r.leadTime, '0 days');
  assert.equal(leadTimeLabel(1), '1 day');
});

test('a time of day never shifts the count (UTC calendar days)', () => {
  // A full-ISO date from an API client: late evening UTC.
  const r = resolvePoDelivery({ poDate: '2026-10-29T23:30:00.000Z', expectedDeliveryDate: '2026-11-05T00:10:00.000Z' });
  assert.equal(r.leadTimeDays, 7);
  assert.equal(r.expectedDeliveryDate.toISOString(), '2026-11-05T00:00:00.000Z', 'stored at UTC midnight');
  assert.equal(utcDay('2026-10-29T00:00:00Z'), utcDay('2026-10-29T23:59:59Z'));
});

test('Expected Delivery Date before the PO Date is refused', () => {
  refused({ poDate: '2026-10-29', expectedDeliveryDate: '2026-10-28' }, /cannot be before the PO Date/);
});

test(`more than ${MAX_LEAD_DAYS} days out is refused (mistyped year)`, () => {
  refused({ poDate: '2026-10-29', expectedDeliveryDate: '2062-10-29' }, /more than 365 days/);
  refused({ poDate: '2026-10-29', leadTimeDays: 366 }, /more than 365 days/);
  assert.equal(resolvePoDelivery({ poDate: '2026-10-29', leadTimeDays: 365 }).leadTimeDays, 365);
});

test('a negative or fractional Lead Time is refused', () => {
  refused({ poDate: '2026-10-29', leadTimeDays: -1 }, /whole number/);
  refused({ poDate: '2026-10-29', leadTimeDays: 1.5 }, /whole number/);
});

test('nothing sent → nothing resolved; the free-text leadTime is ignored', () => {
  assert.deepEqual(resolvePoDelivery({ poDate: '2026-10-29' }), {});
  assert.deepEqual(resolvePoDelivery({ poDate: '2026-10-29', leadTimeDays: null, expectedDeliveryDate: '' }), {});
  // An older client sends "7 days" text with a date 3 days out: the date wins.
  const r = resolvePoDelivery({ poDate: '2026-10-29', expectedDeliveryDate: '2026-11-01', leadTime: '7 days' });
  assert.equal(r.leadTime, '3 days');
});

test('PO Date omitted → today (API clients that send only the date)', () => {
  const r = resolvePoDelivery({ expectedDeliveryDate: new Date(Date.now() + 7 * 864e5).toISOString() });
  assert.equal(r.leadTimeDays, 7);
});

test('an invalid date is refused', () => {
  refused({ poDate: '2026-10-29', expectedDeliveryDate: 'not a date' }, /not a valid date/);
});

// ── Joi ──
const MULTI = {
  vendorId: '64b7f0c2a1b2c3d4e5f60719',
  expectedDeliveryDate: '2026-11-05',
  items: [{ itemName: 'X', quantity: 1, indentId: '64b7f0c2a1b2c3d4e5f60718' }],
};

test('PO schemas take leadTimeDays as a whole number 0–365 or null', () => {
  assert.equal(createFromItemsSchema.validate({ ...MULTI, leadTimeDays: 7 }).error, undefined);
  assert.equal(createFromItemsSchema.validate({ ...MULTI, leadTimeDays: null }).error, undefined);
  assert.equal(createFromItemsSchema.validate(MULTI).error, undefined, 'still optional');
  assert.ok(createFromItemsSchema.validate({ ...MULTI, leadTimeDays: -1 }).error);
  assert.ok(createFromItemsSchema.validate({ ...MULTI, leadTimeDays: 2.5 }).error);
  assert.ok(createFromItemsSchema.validate({ ...MULTI, leadTimeDays: 366 }).error);
  assert.equal(updatePoSchema.validate({ leadTimeDays: 10 }).error, undefined);
  assert.equal(previewPoSchema.validate({ items: MULTI.items, leadTimeDays: null }).error, undefined);
});

test('Vendor Master leadTimeDays: optional, no default, null clears', () => {
  const base = { name: 'Acme Steel' };
  const created = createVendorSchema.validate(base);
  assert.equal(created.error, undefined);
  assert.equal('leadTimeDays' in created.value, false, 'no default — absent stays absent');
  assert.equal(createVendorSchema.validate({ ...base, leadTimeDays: 10 }).value.leadTimeDays, 10);
  assert.equal(updateVendorSchema.validate({ leadTimeDays: null }).error, undefined);
  assert.equal('leadTimeDays' in updateVendorSchema.validate({ phone: '1' }).value, false, 'an update without it never wipes it');
  assert.ok(createVendorSchema.validate({ ...base, leadTimeDays: -2 }).error);
  assert.ok(createVendorSchema.validate({ ...base, leadTimeDays: 1.5 }).error);
  assert.ok(createVendorSchema.validate({ ...base, leadTimeDays: 400 }).error);
});
