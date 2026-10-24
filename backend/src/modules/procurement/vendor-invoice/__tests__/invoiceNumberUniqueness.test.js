/**
 * One live vendor invoice number per vendor — concurrency hardening.
 *
 * The atomic guarantee is the partial unique index on { vendorId,
 * invoiceNumberKey }; a duplicate-key error from it is answered with the same
 * validation message as the service's pre-check. This suite (no DB) covers the
 * key rules and the index shape. The real concurrent-create / rename race runs
 * against a local scratch DB:
 *   node src/scripts/e2eMultiGrnInvoiceFixture.js --number-race
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import VendorInvoice, {
  INVOICE_STATUS, normalizeInvoiceNumber, syncInvoiceNumberKey, invoiceNumberChanged,
} from '../vendorInvoice.model.js';

const VENDOR = new mongoose.Types.ObjectId();
const fresh = (extra = {}) => new VendorInvoice({ invoiceNumber: '  INV/24-25/001 ', qcId: new mongoose.Types.ObjectId(), vendorId: VENDOR, ...extra });
// As loaded from the database (not new, nothing modified yet).
const stored = (fields) => VendorInvoice.hydrate({
  _id: new mongoose.Types.ObjectId(), qcId: new mongoose.Types.ObjectId(), vendorId: VENDOR,
  invoiceStatus: INVOICE_STATUS.RECEIVED, isDeleted: false, ...fields,
});

test('normalizeInvoiceNumber trims and ignores case', () => {
  assert.equal(normalizeInvoiceNumber('  Inv-001 '), 'inv-001');
  assert.equal(normalizeInvoiceNumber('INV-001'), normalizeInvoiceNumber('inv-001'));
  assert.equal(normalizeInvoiceNumber(null), '');
});

test('a new live invoice gets the normalised key', () => {
  const inv = fresh();
  syncInvoiceNumberKey(inv);
  assert.equal(inv.invoiceNumberKey, 'inv/24-25/001');
});

test('an older invoice without a key stays unkeyed when edited without changing its number', () => {
  const inv = stored({ invoiceNumber: 'DUP-1' });
  inv.remarks = 'edited';
  inv.invoiceNumber = 'DUP-1'; // same value re-sent by the form
  syncInvoiceNumberKey(inv);
  assert.equal(inv.invoiceNumberKey, undefined);
});

test('renaming an invoice (even case only) re-keys it', () => {
  const legacy = stored({ invoiceNumber: 'DUP-1' });
  legacy.invoiceNumber = 'NEW-7';
  syncInvoiceNumberKey(legacy);
  assert.equal(legacy.invoiceNumberKey, 'new-7');

  const keyed = stored({ invoiceNumber: 'abc', invoiceNumberKey: 'abc' });
  keyed.invoiceNumber = 'ABC';
  syncInvoiceNumberKey(keyed);
  assert.equal(keyed.invoiceNumberKey, 'abc');
});

test('invoiceNumberChanged: a case-only change IS a change (so the duplicate lookup runs)', () => {
  assert.equal(invoiceNumberChanged('old-1', 'OLD-1'), true);
  assert.equal(invoiceNumberChanged('INV-1', 'INV-2'), true);
});

test('invoiceNumberChanged: the same number (or surrounding spaces, or not sent) is not a change', () => {
  assert.equal(invoiceNumberChanged('old-1', 'old-1'), false);
  assert.equal(invoiceNumberChanged('old-1', '  old-1 '), false);
  assert.equal(invoiceNumberChanged('old-1', undefined), false);
  assert.equal(invoiceNumberChanged('old-1', null), false);
});

// A document loaded WITHOUT a key whose key was then written to the database
// (e.g. by a backfill) before it is rejected / deleted: the save must still
// send $unset, or the stale key keeps blocking the number.
const unsetOf = (doc) => doc.getChanges().$unset || {};

test('rejecting an invoice loaded without a key still sends $unset for the key', () => {
  const inv = stored({ invoiceNumber: 'OLD-9' }); // no invoiceNumberKey when loaded
  inv.invoiceStatus = INVOICE_STATUS.REJECTED;
  syncInvoiceNumberKey(inv);
  assert.deepEqual(unsetOf(inv), { invoiceNumberKey: 1 });
});

test('deleting a draft loaded without a key still sends $unset for the key', () => {
  const inv = stored({ invoiceNumber: 'OLD-10', invoiceStatus: INVOICE_STATUS.DRAFT });
  inv.isDeleted = true;
  syncInvoiceNumberKey(inv);
  assert.deepEqual(unsetOf(inv), { invoiceNumberKey: 1 });
});

test('a live invoice edited without a number change sends no key change at all', () => {
  const legacy = stored({ invoiceNumber: 'OLD-11' });
  legacy.remarks = 'edited';
  syncInvoiceNumberKey(legacy);
  const ch = legacy.getChanges();
  assert.equal(ch.$unset?.invoiceNumberKey, undefined);
  assert.equal(ch.$set?.invoiceNumberKey, undefined);
});

test('rejecting or deleting frees the number (key removed)', () => {
  const rejected = stored({ invoiceNumber: 'R-1', invoiceNumberKey: 'r-1' });
  rejected.invoiceStatus = INVOICE_STATUS.REJECTED;
  syncInvoiceNumberKey(rejected);
  assert.equal(rejected.invoiceNumberKey, undefined);

  const deleted = stored({ invoiceNumber: 'D-1', invoiceNumberKey: 'd-1', invoiceStatus: INVOICE_STATUS.DRAFT });
  deleted.isDeleted = true;
  syncInvoiceNumberKey(deleted);
  assert.equal(deleted.invoiceNumberKey, undefined);
});

test('an invoice with no vendor is not keyed (the rule is per vendor)', () => {
  const inv = fresh({ vendorId: null });
  syncInvoiceNumberKey(inv);
  assert.equal(inv.invoiceNumberKey, undefined);
});

test('the key is maintained by a pre-save hook', () => {
  const hooks = VendorInvoice.schema.s.hooks._pres.get('save') || [];
  assert.ok(hooks.some((h) => String(h.fn).includes('syncInvoiceNumberKey')));
});

test('schema declares the partial unique index on { vendorId, invoiceNumberKey }', () => {
  const found = VendorInvoice.schema.indexes().find(([keys]) => keys.vendorId === 1 && keys.invoiceNumberKey === 1);
  assert.ok(found, 'index missing');
  const [, opts] = found;
  assert.equal(opts.unique, true);
  assert.deepEqual(opts.partialFilterExpression, { invoiceNumberKey: { $type: 'string' } });
});
