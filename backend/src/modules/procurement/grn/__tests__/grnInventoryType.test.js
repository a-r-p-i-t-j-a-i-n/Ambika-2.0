/**
 * GRN Inventory Type — one per GRN, decides which IMS module the stock lands in.
 *
 * Pure rule tests (no database): findInventoryTypeConflicts / the refusal
 * message, and the request schemas. The posting itself is covered against a
 * local scratch database by src/scripts/e2eGrnQcFixture.js --invtype.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { findInventoryTypeConflicts, inventoryTypeConflictMessage } from '../grn.service.js';
import { createGrnSchema, updateGrnSchema, completeGrnSchema } from '../grn.validation.js';
import GoodsReceiptNote, { GRN_INVENTORY_TYPE } from '../grn.model.js';

const TYPES = new Map([['coil', 'RAW_MATERIAL'], ['circle', 'CIRCLE'], ['bolt', 'CONSUMABLE'], ['box', 'PACKAGING'], ['ink', 'INK'], ['free', '']]);
const line = (sku, receivedQty = 10) => ({ skuId: sku, itemName: `Item ${sku}`, receivedQty });
const typeOf = (l) => TYPES.get(l.skuId) || '';
const conflicts = (inventoryType, lines) => findInventoryTypeConflicts({ lines, typeOf, inventoryType }).map((l) => l.skuId);

test('RM GRN: coils and circles are accepted', () => {
  assert.deepEqual(conflicts('RM', [line('coil'), line('circle')]), []);
});

test('RM GRN: any non-RM received line is a conflict', () => {
  assert.deepEqual(conflicts('RM', [line('coil'), line('bolt'), line('ink')]), ['bolt', 'ink']);
});

test('Consumable & Packaging GRN: consumables, packaging and other purchasables are accepted', () => {
  assert.deepEqual(conflicts('CONSUMABLE_PACKAGING', [line('bolt'), line('box'), line('ink')]), []);
});

test('Consumable & Packaging GRN: a coil or circle is a conflict', () => {
  assert.deepEqual(conflicts('CONSUMABLE_PACKAGING', [line('bolt'), line('coil'), line('circle')]), ['coil', 'circle']);
});

test('lines not being received (qty 0) are not judged — how a mixed PO is split', () => {
  assert.deepEqual(conflicts('RM', [line('coil'), line('bolt', 0)]), []);
  assert.deepEqual(conflicts('CONSUMABLE_PACKAGING', [line('coil', 0), line('bolt')]), []);
});

test('a line with no SKU classification is not judged (as for the batch rule)', () => {
  assert.deepEqual(conflicts('RM', [line('free')]), []);
});

test('no Inventory Type (GRN raised before it existed) → no conflicts, legacy handling', () => {
  assert.deepEqual(conflicts(null, [line('coil'), line('bolt')]), []);
});

test('the refusal names the lines and tells the operator what to do', () => {
  const msg = inventoryTypeConflictMessage([line('bolt')], 'RM');
  assert.match(msg, /Inventory Type is "Raw Material \(RM\)", but "Item bolt" is not Raw Material/);
  assert.match(msg, /separate GRN with Inventory Type "Consumable & Packaging"/);
  const msg2 = inventoryTypeConflictMessage([line('coil'), line('circle')], 'CONSUMABLE_PACKAGING');
  assert.match(msg2, /"Item coil", "Item circle" are not Consumable & Packaging/);
  assert.match(msg2, /Inventory Type "Raw Material \(RM\)"/);
});

test('only RM and Consumable & Packaging exist — Finished Goods are never purchased', () => {
  assert.deepEqual(Object.values(GRN_INVENTORY_TYPE), ['RM', 'CONSUMABLE_PACKAGING']);
  assert.ok(updateGrnSchema.validate({ inventoryType: 'FG' }).error);
  assert.ok(completeGrnSchema.validate({ inventoryType: 'FINISHED_GOODS' }).error);
});

test('schemas: update / complete may omit it (saved choice inherited); create requires it', () => {
  assert.equal('inventoryType' in completeGrnSchema.validate({}, { stripUnknown: true }).value, false);
  assert.equal('inventoryType' in updateGrnSchema.validate({ remarks: 'x' }, { stripUnknown: true }).value, false);
  assert.ok(createGrnSchema.validate({ poId: '6ac09965f1c61c40fa206c23' }).error);
  // Consumable & Packaging needs no Received At.
  assert.equal(createGrnSchema.validate({ poId: '6ac09965f1c61c40fa206c23', inventoryType: 'CONSUMABLE_PACKAGING', rmReceivedAtLocation: null }).error, undefined);
});

test('historical GRNs read as "no Inventory Type", never reinterpreted', () => {
  assert.equal(GoodsReceiptNote.schema.path('inventoryType').defaultValue, null);
});
