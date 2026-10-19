/**
 * GRN Without PO (W/O PO) — a GRN raised with no Purchase Order at all; vendor
 * and items are entered by hand instead of sourced from a PO.
 *
 * Pure / DB-less tests: the request schemas (which fields flip from optional
 * to required, and vice versa, when isWithoutPo is set) and the model shape
 * (poId is no longer a hard requirement; isWithoutPo defaults to false so
 * every historical GRN reads exactly as it always has).
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createGrnSchema, updateGrnSchema, grnQuerySchema } from '../grn.validation.js';
import GoodsReceiptNote from '../grn.model.js';

const PO_ID = '6ac09965f1c61c40fa206c23';
const VENDOR_ID = '6ac09965f1c61c40fa206c24';
const SKU_ID = '6ac09965f1c61c40fa206c25';

const baseWopo = {
  isWithoutPo: true,
  vendorId: VENDOR_ID,
  vendorName: 'Walk-in Supplier',
  inventoryType: 'CONSUMABLE_PACKAGING',
  items: [{ itemName: 'Bolt M8', skuId: SKU_ID, receivedQty: 10 }],
};

test('a normal (PO-based) create still requires a PO (poId or poIds) — unchanged default behaviour', () => {
  const { error } = createGrnSchema.validate({ inventoryType: 'CONSUMABLE_PACKAGING' });
  assert.ok(error);
  assert.match(error.message, /Purchase Order/);
});

test('isWithoutPo defaults to false when omitted', () => {
  const { value } = createGrnSchema.validate({ poId: PO_ID, inventoryType: 'CONSUMABLE_PACKAGING' });
  assert.equal(value.isWithoutPo, false);
});

test('a W/O PO create needs no poId at all', () => {
  const { error } = createGrnSchema.validate(baseWopo);
  assert.equal(error, undefined);
});

test('a W/O PO create requires a vendor', () => {
  const { vendorId, vendorName, ...rest } = baseWopo;
  const { error } = createGrnSchema.validate(rest);
  assert.ok(error);
  assert.match(error.message, /[Vv]endor/);
});

test('a W/O PO create requires at least one item — there is no PO to auto-load from', () => {
  const { items, ...rest } = baseWopo;
  const { error: missingError } = createGrnSchema.validate(rest);
  assert.ok(missingError);
  const { error: emptyError } = createGrnSchema.validate({ ...rest, items: [] });
  assert.ok(emptyError);
});

test('a W/O PO create still runs every other GRN rule (Inventory Type required)', () => {
  const { inventoryType, ...rest } = baseWopo;
  const { error } = createGrnSchema.validate(rest);
  assert.ok(error);
  assert.match(error.message, /Inventory Type/);
});

test('an explicit poId is tolerated (but not required) on a W/O PO create', () => {
  const { error } = createGrnSchema.validate({ ...baseWopo, poId: PO_ID });
  assert.equal(error, undefined);
});

test('update schema accepts vendor fields (editable only on a W/O PO draft, enforced in the service)', () => {
  const { error, value } = updateGrnSchema.validate({ vendorName: 'New Vendor', vendorGST: '27AAAAA0000A1Z5' });
  assert.equal(error, undefined);
  assert.equal(value.vendorName, 'New Vendor');
});

test('query schema accepts an isWithoutPo filter, converted from the query-string form', () => {
  const { error, value } = grnQuerySchema.validate({ isWithoutPo: 'true' });
  assert.equal(error, undefined);
  assert.equal(value.isWithoutPo, true);
});

test('model: poId is no longer a hard requirement (a W/O PO GRN has none)', () => {
  assert.equal(GoodsReceiptNote.schema.path('poId').options.required, undefined);
  assert.equal(GoodsReceiptNote.schema.path('poId').options.default, null);
});

test('model: isWithoutPo defaults to false — every historical GRN reads unchanged', () => {
  assert.equal(GoodsReceiptNote.schema.path('isWithoutPo').defaultValue, false);
  const doc = new GoodsReceiptNote({ grnNumber: 'TEST', items: [{ itemName: 'x', receivedQty: 1 }] });
  assert.equal(doc.isWithoutPo, false);
  assert.equal(doc.poId, null);
});
