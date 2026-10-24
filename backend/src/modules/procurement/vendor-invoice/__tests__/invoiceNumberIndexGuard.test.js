/**
 * Vendor invoice numbering safeguard — the unique index is verified from the
 * database (listIndexes), never assumed from Mongoose's automatic build, and
 * invoice-number writes are refused until it is confirmed.
 *
 * No DB: listIndexes / the automatic build are injected. The guard against a
 * real local scratch DB runs in
 *   node src/scripts/e2eMultiGrnInvoiceFixture.js --number-race
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INVOICE_NUMBER_INDEX_NAME, expectedInvoiceNumberIndex, evaluateInvoiceNumberIndex,
  verifyInvoiceNumberIndex, assertInvoiceNumberProtection, getInvoiceNumberIndexStatus, resetInvoiceNumberIndexGuard,
} from '../invoiceNumberIndexGuard.js';

const GOOD = {
  v: 2, name: INVOICE_NUMBER_INDEX_NAME, key: { vendorId: 1, invoiceNumberKey: 1 }, unique: true,
  partialFilterExpression: { invoiceNumberKey: { $type: 'string' } },
};
const ID = { v: 2, key: { _id: 1 }, name: '_id_' };

let clock = 1_000_000;
const deps = (indexes, { autoIndexError = null, readError = null } = {}) => ({
  awaitAutoIndex: async () => { if (autoIndexError) throw new Error(autoIndexError); },
  readIndexes: async () => { if (readError) throw readError; return indexes; },
  now: () => clock,
});
const reset = () => { resetInvoiceNumberIndexGuard(); clock = 1_000_000; };
const rejects503 = (p) => assert.rejects(p, (e) => e.statusCode === 503 && /numbering safeguard is not in place/.test(e.message));

test('the expected index is the exact one the schema declares', () => {
  assert.deepEqual(expectedInvoiceNumberIndex(), {
    name: INVOICE_NUMBER_INDEX_NAME, key: { vendorId: 1, invoiceNumberKey: 1 }, unique: true,
    partialFilterExpression: { invoiceNumberKey: { $type: 'string' } },
  });
});

test('evaluate: the exact index passes', () => {
  assert.deepEqual(evaluateInvoiceNumberIndex([ID, GOOD]), { ok: true, problem: '' });
});

test('evaluate: missing, look-alike, and every wrong option are refused', () => {
  const bad = (indexes, rx) => {
    const r = evaluateInvoiceNumberIndex(indexes);
    assert.equal(r.ok, false);
    assert.match(r.problem, rx);
  };
  bad([ID], /is missing from the vendorinvoices collection/);
  bad([ID, { ...GOOD, name: 'vendorId_1_invoiceNumberKey_1' }], /same fields exists as "vendorId_1_invoiceNumberKey_1"/);
  bad([{ ...GOOD, unique: undefined }], /not unique/);
  bad([{ ...GOOD, partialFilterExpression: undefined }], /partial filter null/);
  bad([{ ...GOOD, partialFilterExpression: { invoiceNumberKey: { $exists: true } } }], /partial filter/);
  bad([{ ...GOOD, key: { invoiceNumberKey: 1, vendorId: 1 } }], /fields/);
  bad([{ ...GOOD, key: { vendorId: 1, invoiceNumberKey: -1 } }], /fields/);
  bad([{ ...GOOD, collation: { locale: 'en', strength: 2 } }], /unexpected collation/);
});

test('a "successful" automatic build is not trusted: no index in the DB → FAILED, writes refused', async () => {
  reset();
  await verifyInvoiceNumberIndex(deps([ID]));
  assert.equal(getInvoiceNumberIndexStatus().status, 'FAILED');
  await rejects503(assertInvoiceNumberProtection(deps([ID])));
});

test('a failed automatic build is reported, but the index actually present is what counts', async () => {
  reset();
  await verifyInvoiceNumberIndex(deps([ID, GOOD], { autoIndexError: 'E11000 during index build' }));
  assert.equal(getInvoiceNumberIndexStatus().status, 'OK');
  reset();
  await verifyInvoiceNumberIndex(deps([ID], { autoIndexError: 'IndexOptionsConflict' }));
  assert.match(getInvoiceNumberIndexStatus().problem, /automatic index build reported: IndexOptionsConflict/);
});

test('collection not created yet = index missing; an unreadable DB = FAILED with the reason', async () => {
  reset();
  await verifyInvoiceNumberIndex(deps(null, { readError: Object.assign(new Error('ns does not exist'), { code: 26, codeName: 'NamespaceNotFound' }) }));
  assert.match(getInvoiceNumberIndexStatus().problem, /missing/);
  reset();
  await verifyInvoiceNumberIndex(deps(null, { readError: new Error('connection reset') }));
  assert.equal(getInvoiceNumberIndexStatus().status, 'FAILED');
  assert.match(getInvoiceNumberIndexStatus().problem, /Could not read .* connection reset/);
});

test('before the first check, a write waits for verification (no writes on PENDING)', async () => {
  reset();
  assert.equal(getInvoiceNumberIndexStatus().status, 'PENDING');
  await assertInvoiceNumberProtection(deps([ID, GOOD]));
  assert.equal(getInvoiceNumberIndexStatus().status, 'OK');
});

test('after a failure, writes resume once the index exists — re-checked after 30 s, not before', async () => {
  reset();
  await rejects503(assertInvoiceNumberProtection(deps([ID])));
  clock += 10_000;
  await rejects503(assertInvoiceNumberProtection(deps([ID, GOOD]))); // too soon to re-read
  clock += 25_000;
  await assertInvoiceNumberProtection(deps([ID, GOOD]));
  assert.equal(getInvoiceNumberIndexStatus().status, 'OK');
});

test('a confirmed index is re-read after 5 minutes, so one dropped later is caught', async () => {
  reset();
  await assertInvoiceNumberProtection(deps([ID, GOOD]));
  clock += 60_000;
  await assertInvoiceNumberProtection(deps([ID])); // within 5 min: still trusted
  clock += 5 * 60_000;
  await rejects503(assertInvoiceNumberProtection(deps([ID])));
});

test('concurrent writes share one verification', async () => {
  reset();
  let reads = 0;
  const d = { ...deps([ID, GOOD]), readIndexes: async () => { reads += 1; return [ID, GOOD]; } };
  await Promise.all([assertInvoiceNumberProtection(d), assertInvoiceNumberProtection(d), assertInvoiceNumberProtection(d)]);
  assert.equal(reads, 1);
});
