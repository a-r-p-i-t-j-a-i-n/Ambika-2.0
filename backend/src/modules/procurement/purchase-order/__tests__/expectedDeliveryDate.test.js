/**
 * Expected Delivery Date — required at PO creation (Purchase FMS Step 1.4).
 *
 * No database (this repo has no mongod harness). Covered: the Joi validation
 * schemas that gate every PO create/update entry point. The service-level
 * persistence and the release-time fallback guard (purchaseOrder.service.js
 * create/createMulti/release/bulkRelease) are not exercised here — they need
 * a live PO document and are covered by manual/integration testing instead.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createPoSchema,
  createMultiPoSchema,
  createFromItemsSchema,
  revisePoSchema,
  updatePoSchema,
  previewPoSchema,
} from '../purchaseOrder.validation.js';

const ITEM = { itemName: 'Test Item', quantity: 10, unit: 'Pcs', rate: 100, gstRate: 18 };
const baseCreate = {
  indentId: '64b7f0c2a1b2c3d4e5f60718',
  vendorId: '64b7f0c2a1b2c3d4e5f60719',
  items: [ITEM],
};
const baseMulti = {
  indentIds: ['64b7f0c2a1b2c3d4e5f60718'],
  vendorId: '64b7f0c2a1b2c3d4e5f60719',
  items: [{ ...ITEM, indentId: '64b7f0c2a1b2c3d4e5f60718' }],
};

test('createPoSchema rejects a PO with no Expected Delivery Date', () => {
  const { error } = createPoSchema.validate(baseCreate);
  assert.ok(error, 'expected a validation error');
  assert.match(error.message, /expectedDeliveryDate/);
});

test('createPoSchema accepts a PO with a valid Expected Delivery Date', () => {
  const { error, value } = createPoSchema.validate({ ...baseCreate, expectedDeliveryDate: '2026-11-01' });
  assert.equal(error, undefined);
  assert.ok(value.expectedDeliveryDate);
});

test('createMultiPoSchema also requires Expected Delivery Date', () => {
  const { error } = createMultiPoSchema.validate(baseMulti);
  assert.ok(error);
  assert.match(error.message, /expectedDeliveryDate/);
});

test('createFromItemsSchema (New PO item-picker form) inherits the requirement', () => {
  const { error } = createFromItemsSchema.validate({ ...baseMulti, indentIds: undefined });
  assert.ok(error);
  assert.match(error.message, /expectedDeliveryDate/);
});

test('createFromItemsSchema accepts a valid submission with the date present', () => {
  const { error } = createFromItemsSchema.validate({ ...baseMulti, indentIds: undefined, expectedDeliveryDate: '2026-11-01' });
  assert.equal(error, undefined);
});

test('revisePoSchema (Revise PO) also requires Expected Delivery Date', () => {
  const { error } = revisePoSchema.validate({ ...baseMulti, indentIds: undefined });
  assert.ok(error);
  assert.match(error.message, /expectedDeliveryDate/);
});

test('updatePoSchema treats Expected Delivery Date as optional (draft edits need not resupply it every time)', () => {
  const { error } = updatePoSchema.validate({ remarks: 'minor edit' });
  assert.equal(error, undefined);
});

test('updatePoSchema still accepts an updated Expected Delivery Date when the user changes it', () => {
  const { error, value } = updatePoSchema.validate({ expectedDeliveryDate: '2026-12-15' });
  assert.equal(error, undefined);
  assert.ok(value.expectedDeliveryDate);
});

test('previewPoSchema (Preview PDF — no save) stays lenient and never blocks on a missing date', () => {
  const { error } = previewPoSchema.validate({ items: [ITEM] });
  assert.equal(error, undefined);
});
