/**
 * Cut Coils → Circles — the Joi boundary for "Received At" and "Scrap checked?".
 *
 * `resolveScrapLocation`'s own precedence rules are tested against a live
 * conversion in grnRmStock.test.js and the e2eCutCoilsFixture/e2eScrapByCoilFixture
 * scripts; this file covers the layer in FRONT of all of that — what the Joi
 * schema accepts before any business logic runs at all. Before this, `warehouse`
 * was free text (`Joi.string().max(40)`), so a typo'd or malicious value would
 * reach resolveScrapLocation, fail its `SCRAP_LOCATIONS.includes()` check, and
 * silently default to PLG01 — recording a cut's scrap as in-house for a location
 * nobody actually chose. That is exactly the "Backend must enforce the location →
 * scrap behavior; do not rely only on frontend UI" requirement this locks in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmConvertSchema, rmCuttingHistoryQuerySchema } from '../rmIms.validation.js';

const base = {
  coilSkuId: '507f1f77bcf86cd799439011',
  coilWeightKg: 100,
  circles: [{ circleSkuId: '507f1f77bcf86cd799439012', pcs: 10, weightKg: 50 }],
};

const validate = (overrides) => rmConvertSchema.validate({ ...base, ...overrides });

/* ── "Received At" (warehouse) ───────────────────────────────────────────── */

test('PLG01 is accepted', () => {
  assert.equal(validate({ warehouse: 'PLG01' }).error, undefined);
});

test('JW001 is accepted', () => {
  assert.equal(validate({ warehouse: 'JW001' }).error, undefined);
});

test('lower case is accepted and normalized upper case', () => {
  const { error, value } = validate({ warehouse: 'jw001' });
  assert.equal(error, undefined);
  assert.equal(value.warehouse, 'JW001');
});

test('blank is still accepted — the receipt is the fallback (resolveScrapLocation)', () => {
  assert.equal(validate({ warehouse: '' }).error, undefined);
  assert.equal(validate({}).error, undefined);
});

test('MAIN — a real warehouse code, but not a cutting location — is refused, not silently defaulted', () => {
  const { error } = validate({ warehouse: 'MAIN' });
  assert.ok(error, 'expected a validation error');
  assert.match(error.message, /Received At must be one of: PLG01, JW001/);
});

test('an arbitrary string is refused', () => {
  assert.ok(validate({ warehouse: 'WAREHOUSE-7' }).error);
});

/* ── "Scrap checked?" (scrapVerified) ────────────────────────────────────── */

test('"Not yet checked" (PENDING) is accepted', () => {
  assert.equal(validate({ scrapVerified: 'PENDING' }).error, undefined);
});

test('"Verified" (DONE) is accepted', () => {
  assert.equal(validate({ scrapVerified: 'DONE' }).error, undefined);
});

test('omitted is accepted — the service defaults it to PENDING', () => {
  assert.equal(validate({}).error, undefined);
});

/**
 * JOB_WORK conflated "was this scrap sent to job work" (a LOCATION fact) with
 * "has it been checked" (a VERIFICATION fact) — precisely the mixing the Cut
 * Coils screen no longer offers. The model/ScrapRecord enums still carry it for
 * historical rows (see coilConversion.model.js); only fresh input through this
 * endpoint is refused it now.
 */
test('JOB_WORK is no longer accepted from this endpoint', () => {
  const { error } = validate({ scrapVerified: 'JOB_WORK' });
  assert.ok(error, 'expected a validation error');
});

test('REJECTED (the model\'s import-only value) is not accepted here either', () => {
  assert.ok(validate({ scrapVerified: 'REJECTED' }).error);
});

// ── Cutting History query ────────────────────────────────────────────────────
test('cutting-history query: location and status are restricted to the derived values', () => {
  const v = (q) => rmCuttingHistoryQuerySchema.validate(q);
  assert.equal(v({}).error, undefined);
  assert.equal(v({ location: 'jw001', status: 'partially_cut', page: 2, limit: 50 }).error, undefined);
  assert.equal(v({ location: 'jw001' }).value.location, 'JW001');
  assert.ok(v({ location: 'MAIN' }).error);
  assert.ok(v({ status: 'HALF_DONE' }).error);
  assert.ok(v({ limit: 201 }).error);
});
