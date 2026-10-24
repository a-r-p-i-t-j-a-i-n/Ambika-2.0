/**
 * The conversion ledger's query (GET /rm-ims/conversion-ledger) — the Joi
 * boundary in front of rmImsService.listConversionLedger.
 *
 * The ledger replaced two lists, so its query must accept every filter value
 * either one accepted, with the same meaning — NONE (a cut that names no
 * physical coil) included — and refuse what neither accepted. The ledger's
 * answers themselves are checked against the database by
 * scripts/e2eConversionLedgerFixture.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmConversionLedgerQuerySchema } from '../rmIms.validation.js';

const validate = (q) => rmConversionLedgerQuerySchema.validate(q);

test('no filter at all is a valid query', () => {
  assert.equal(validate({}).error, undefined);
});

test('every entry type of both old lists is accepted, any case — NONE included — and COIL (any physical coil)', () => {
  for (const t of ['GRN', 'manual', 'none', 'coil', '']) {
    const { error, value } = validate({ entryType: t });
    assert.equal(error, undefined, t);
    assert.equal(value.entryType, t.toUpperCase());
  }
  assert.ok(validate({ entryType: 'IMPORT' }).error);
});

test('location and status are the cutting locations and cutting statuses, upper-cased', () => {
  assert.equal(validate({ location: 'jw001' }).value.location, 'JW001');
  assert.ok(validate({ location: 'ELSEWHERE' }).error);
  assert.equal(validate({ status: 'fully_cut' }).value.status, 'FULLY_CUT');
  assert.ok(validate({ status: 'DONE' }).error);
});

test('dates are calendar days, and "from" may not be after "to"', () => {
  assert.equal(validate({ from: '2026-03-01', to: '2026-03-31' }).error, undefined);
  assert.equal(validate({ from: '2026-03-01', to: '2026-03-01' }).error, undefined);
  assert.match(validate({ from: '2026-04-01', to: '2026-03-31' }).error.message, /From date cannot be after To date/);
  assert.ok(validate({ from: '01-03-2026' }).error);
});

test('a circle SKU must be an id; search and batch are trimmed', () => {
  assert.ok(validate({ circleSkuId: 'JSL204-07-700' }).error);
  assert.equal(validate({ circleSkuId: '507f1f77bcf86cd799439011' }).error, undefined);
  assert.equal(validate({ search: '  RMC-001/26-27 ' }).value.search, 'RMC-001/26-27');
  assert.equal(validate({ batchNo: ' ab12 ' }).value.batchNo, 'ab12');
});

test('pages start at 1 and hold at most 200 rows', () => {
  assert.ok(validate({ page: 0 }).error);
  assert.ok(validate({ limit: 201 }).error);
  assert.equal(validate({ page: 3, limit: 100 }).error, undefined);
});

test('sort: latest, oldest or az (any case); blank is the default; anything else is refused', () => {
  for (const v of ['latest', 'OLDEST', 'az', '']) assert.equal(validate({ sort: v }).error, undefined, v);
  assert.equal(validate({ sort: 'AZ' }).value.sort, 'az');
  assert.ok(validate({ sort: 'size' }).error);
});

test('coilSkuId: a SKU id, or blank; anything else is refused', () => {
  assert.equal(validate({ coilSkuId: '507f1f77bcf86cd799439011' }).error, undefined);
  assert.equal(validate({ coilSkuId: '' }).error, undefined);
  assert.ok(validate({ coilSkuId: 'JSL202-07' }).error);
});
