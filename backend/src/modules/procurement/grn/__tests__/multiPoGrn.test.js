/**
 * GRN against multiple Purchase Orders — one GRN covering several compatible
 * (same-vendor) POs at once, each line traceable back to its own PO.
 *
 * Pure / DB-less tests: the Joi schema (poId vs poIds, same precedent as
 * createInvoiceSchema's qcId/qcIds) and the model shape (poIds/poNumbers/
 * qcIds/qcNumbers default to [], so every historical GRN reads unchanged).
 *
 * NOT covered here (needs a live DB — this backend's test runner, `node
 * --test`, does not set one up for ANY procurement module today): actually
 * creating a multi-PO GRN, cross-vendor rejection, per-PO pending/received
 * qty and over-receipt correctness, concurrent completion and PO lock
 * cleanup, inventory posting exactly once, one QC per PO and its GRN-level
 * aggregation, PDF rendering, and single-PO/W-O-PO regression end-to-end.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createGrnSchema } from '../grn.validation.js';
import GoodsReceiptNote from '../grn.model.js';

const PO_1 = '6ac09965f1c61c40fa206c41';
const PO_2 = '6ac09965f1c61c40fa206c42';

const base = {};

test('createGrnSchema accepts poIds[] with two or more Purchase Orders (multi-PO GRN)', () => {
  const { error, value } = createGrnSchema.validate({ ...base, poIds: [PO_1, PO_2] });
  assert.equal(error, undefined);
  assert.deepEqual(value.poIds, [PO_1, PO_2]);
});

test('createGrnSchema still accepts a single legacy poId (regression)', () => {
  const { error } = createGrnSchema.validate({ ...base, poId: PO_1 });
  assert.equal(error, undefined);
});

test('createGrnSchema requires at least one of poId / poIds unless isWithoutPo', () => {
  const { error } = createGrnSchema.validate(base);
  assert.ok(error);
  assert.match(error.message, /Purchase Order/);
});

test('createGrnSchema rejects an empty poIds array', () => {
  const { error } = createGrnSchema.validate({ ...base, poIds: [] });
  assert.ok(error);
});

test('isWithoutPo still needs no poId/poIds at all (regression)', () => {
  const { error } = createGrnSchema.validate({
    ...base, isWithoutPo: true, vendorId: PO_1, vendorName: 'Walk-in Supplier',
    items: [{ itemName: 'Bolt M8', receivedQty: 10 }],
  });
  assert.equal(error, undefined);
});

test('model: poIds/poNumbers/qcIds/qcNumbers default to [] — every historical GRN reads unchanged', () => {
  const doc = new GoodsReceiptNote({ grnNumber: 'TEST', poId: PO_1, poNumber: 'AGL/PO-001/26-27', items: [{ itemName: 'x', receivedQty: 1 }] });
  assert.deepEqual(doc.poIds, []);
  assert.deepEqual(doc.poNumbers, []);
  assert.deepEqual(doc.qcIds, []);
  assert.deepEqual(doc.qcNumbers, []);
  assert.equal(doc.poId.toString(), PO_1);
});

test('model: a GRN line carries its own poId/poNumber (per-item PO identity)', () => {
  const doc = new GoodsReceiptNote({
    grnNumber: 'TEST', poId: PO_1, poNumber: 'AGL/PO-001/26-27',
    items: [{ itemName: 'x', receivedQty: 1, poId: PO_2, poNumber: 'AGL/PO-002/26-27' }],
  });
  assert.equal(doc.items[0].poId.toString(), PO_2);
  assert.equal(doc.items[0].poNumber, 'AGL/PO-002/26-27');
});
