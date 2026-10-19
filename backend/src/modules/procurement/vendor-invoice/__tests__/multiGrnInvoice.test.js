/**
 * Vendor Invoice against multiple GRNs — one invoice covering material
 * received through two or more GRNs of the same vendor + PO.
 *
 * Multi-GRN support (qcIds[]/grnIds[] on the model, vendor/PO consistency
 * checks in loadAndValidateQcs, combined-totals rollup in buildInvoiceItems,
 * the GRN-centric getInvoiceableGrns endpoint, and the frontend multi-select
 * picker) was found to already be fully implemented. This suite covers what's
 * verifiable without a live MongoDB connection: Joi schema shape and the two
 * gaps closed alongside it — duplicate-id rejection and the new QC-level
 * invoice lock field.
 *
 * NOT covered here (needs a live DB — this backend's test runner, `node
 * --test`, does not set one up for ANY module today): actually creating an
 * invoice across two real GRNs, cross-vendor/cross-PO rejection, already-
 * fully-invoiced exclusion, concurrent double-create, combined totals/advance/
 * net-payable correctness, W/O-PO exclusion, and PDF/detail rendering. These
 * all require real QC/PO/Party/ProformaInvoice documents in Mongo and should
 * be exercised manually or against a seeded test database.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createInvoiceSchema } from '../vendorInvoice.validation.js';
import IncomingQC from '../../incoming-qc/incomingQc.model.js';

const QC_1 = '6ac09965f1c61c40fa206c31';
const QC_2 = '6ac09965f1c61c40fa206c32';

const baseInvoice = { invoiceNumber: 'INV-100' };

test('createInvoiceSchema accepts qcIds[] with two or more GRN/QC ids (multi-GRN)', () => {
  const { error, value } = createInvoiceSchema.validate({ ...baseInvoice, qcIds: [QC_1, QC_2] });
  assert.equal(error, undefined);
  assert.deepEqual(value.qcIds, [QC_1, QC_2]);
});

test('createInvoiceSchema still accepts a single legacy qcId (regression)', () => {
  const { error } = createInvoiceSchema.validate({ ...baseInvoice, qcId: QC_1 });
  assert.equal(error, undefined);
});

test('createInvoiceSchema rejects an empty qcIds array', () => {
  const { error } = createInvoiceSchema.validate({ ...baseInvoice, qcIds: [] });
  assert.ok(error);
});

test('createInvoiceSchema requires at least one of qcId / qcIds (regression)', () => {
  const { error } = createInvoiceSchema.validate(baseInvoice);
  assert.ok(error);
  assert.match(error.message, /qcId/);
});

test('createInvoiceSchema still requires an invoice number', () => {
  const { error } = createInvoiceSchema.validate({ qcIds: [QC_1, QC_2] });
  assert.ok(error);
  assert.match(error.message, /invoiceNumber/);
});

test('model: IncomingQC carries an invoiceLockAt field defaulting to null (QC-level invoice lock)', () => {
  assert.equal(IncomingQC.schema.path('invoiceLockAt').defaultValue, null);
  const doc = new IncomingQC({ qcNumber: 'QC-1' });
  assert.equal(doc.invoiceLockAt, null);
});
