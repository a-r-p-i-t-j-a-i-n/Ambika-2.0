/**
 * GRN → RM stock: where Raw Material lands, the Received At it needs, and the
 * scrap-location rule that a GRN "Received At" feeds.
 *
 * No database. The decisions under test are pure functions (routeGrnLines,
 * assertRoutable, resolveScrapLocation) so the RULE is tested directly. The
 * claim, the transaction and the movement writes need a replica set and are
 * covered by src/scripts/e2eQcGatedPostingFixture.js against a scratch DB.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { routeGrnLines, assertRoutable } from '../grn.service.js';
import { completeGrnSchema, createGrnSchema, updateGrnSchema } from '../grn.validation.js';
import GoodsReceiptNote from '../grn.model.js';
import { RM_ITEM_TYPES } from '../../../skus/sku.model.js';
import { RM_RECEIVED_AT_LOCATIONS } from '../../../inventory/inventoryStock.model.js';
import { resolveScrapLocation } from '../../../inventory/rmIms.service.js';

// A GRN with one coil, one circle (both Raw Material) and one consumable.
const COIL = { skuId: 'a1', itemName: 'Coil 1250mm', receivedQty: 500 };
const CIRCLE = { skuId: 'a2', itemName: 'Circle 180mm', receivedQty: 300 };
const BOLT = { skuId: 'b1', itemName: 'Bolt M8', receivedQty: 200 };
const ITEM_TYPES = new Map([['a1', 'RAW_MATERIAL'], ['a2', 'CIRCLE'], ['b1', 'CONSUMABLE']]);
const typeOf = (l) => ITEM_TYPES.get(String(l.skuId)) || '';

const route = (rmLocation, lines = [COIL, CIRCLE, BOLT]) =>
  routeGrnLines({ lines, typeOf, rmLocation, grnWarehouse: 'MAIN' });

test('RM lines always route to RM IMS at the chosen Received At — there is no opt-out any more', () => {
  for (const loc of RM_RECEIVED_AT_LOCATIONS) {
    const rm = route(loc).filter((r) => r.isRm);
    assert.equal(rm.length, 2, 'both RAW_MATERIAL and CIRCLE count as RM');
    for (const r of rm) {
      assert.equal(r.destination, 'RM_IMS');
      assert.equal(r.warehouse, loc);
    }
  }
});

test('one route per received line — never one lumped decision for the whole GRN', () => {
  assert.equal(route('PLG01').length, 3);
});

test('a non-RM line never becomes RM stock, whatever Received At says', () => {
  for (const loc of ['PLG01', 'JW001', null]) {
    const bolt = route(loc).find((r) => r.line.itemName === 'Bolt M8');
    assert.equal(bolt.isRm, false);
    assert.equal(bolt.warehouse, 'MAIN', 'a consumable never goes to a Received At');
  }
});

test('classification comes from the SKU master, not the item name', () => {
  const liar = { skuId: 'b1', itemName: 'Coil 9999mm', receivedQty: 1 };
  const [r] = route('PLG01', [liar]);
  assert.equal(r.isRm, false);
  assert.equal(r.destination, 'CP_IMS');
});

test('Received At is required explicitly — no location is assumed for Raw Material', () => {
  const routes = route(null);
  assert.equal(routes.find((r) => r.isRm).warehouse, null, 'no default stands in');
  assert.throws(() => assertRoutable(routes), /Received At is required — "Coil 1250mm", "Circle 180mm" are Raw Material/);
  // A GRN with no RM line needs none.
  assert.doesNotThrow(() => assertRoutable(route(null, [BOLT])));
});

test('RM_ITEM_TYPES is the single classification list', () => {
  assert.deepEqual(RM_ITEM_TYPES, ['RAW_MATERIAL', 'CIRCLE']);
});

// ── Received At on the request schemas ────────────────────────────────────────
const PO_ID = '6ac09965f1c61c40fa206c23';
const vCreate = (v) => createGrnSchema.validate({ poId: PO_ID, ...v }, { abortEarly: false, stripUnknown: true });
const vUpdate = (v) => updateGrnSchema.validate(v, { abortEarly: false, stripUnknown: true });

test('Received At accepts only the RM locations, and normalises case', () => {
  assert.equal(vCreate({ rmReceivedAtLocation: 'jw001' }).value.rmReceivedAtLocation, 'JW001');
  assert.equal(vUpdate({ rmReceivedAtLocation: 'plg01' }).value.rmReceivedAtLocation, 'PLG01');
  assert.equal(completeGrnSchema.validate({ rmReceivedAtLocation: 'jw001' }).value.rmReceivedAtLocation, 'JW001');
  // MAIN is the GRN's own store and is NOT a Received At.
  for (const v of [vCreate({ rmReceivedAtLocation: 'MAIN' }), vUpdate({ rmReceivedAtLocation: 'MAIN' }),
    completeGrnSchema.validate({ rmReceivedAtLocation: 'MAIN' })]) {
    assert.match(v.error?.message || '', /must be one of: PLG01, JW001/);
  }
  assert.deepEqual(RM_RECEIVED_AT_LOCATIONS, ['PLG01', 'JW001']);
});

test('the schemas do not inject a location — "not chosen" stays not chosen', () => {
  assert.equal('rmReceivedAtLocation' in vCreate({}).value, false);
  assert.equal('rmReceivedAtLocation' in vUpdate({ remarks: 'x' }).value, false);
  assert.equal('rmReceivedAtLocation' in completeGrnSchema.validate({}).value, false);
});

test('the retired opt-in and Inventory Type are dropped from every request, never trusted', () => {
  const sent = { addToRmStock: true, inventoryType: 'RM', rmReceivedAtLocation: 'JW001' };
  for (const { value } of [vCreate(sent), vUpdate(sent), completeGrnSchema.validate(sent, { stripUnknown: true })]) {
    assert.equal('addToRmStock' in value, false);
    assert.equal('inventoryType' in value, false);
    assert.equal(value.rmReceivedAtLocation, 'JW001');
  }
});

test('historical GRNs keep reading as they were recorded', () => {
  assert.equal(GoodsReceiptNote.schema.path('addToRmStock').defaultValue, false);
  assert.equal(GoodsReceiptNote.schema.path('rmReceivedAtLocation').defaultValue, null);
  assert.equal(GoodsReceiptNote.schema.path('inventoryType').defaultValue, null);
});

// ── The scrap-location rule a GRN Received At feeds ───────────────────────────
test('the operator who made the cut outranks the coil receipt', () => {
  assert.equal(resolveScrapLocation({ warehouse: 'PLG01' }, 'JW001'), 'JW001');
  assert.equal(resolveScrapLocation({ warehouse: 'JW001' }, 'PLG01'), 'PLG01');
});

test('the receipt is still used when the cut names no location of its own', () => {
  assert.equal(resolveScrapLocation({ warehouse: 'JW001' }, ''), 'JW001');
  assert.equal(resolveScrapLocation({ warehouse: 'PLG01' }, undefined), 'PLG01');
});

test('MAIN is not a cutting location, from either side', () => {
  assert.equal(resolveScrapLocation({ warehouse: 'MAIN' }, 'JW001'), 'JW001');
  assert.equal(resolveScrapLocation({ warehouse: 'MAIN' }, ''), null);
  assert.equal(resolveScrapLocation(null, null), null, 'unknown stays unknown, never guessed');
});

test('location matching is case-insensitive on both sides', () => {
  assert.equal(resolveScrapLocation({ warehouse: ' plg01 ' }, ''), 'PLG01');
  assert.equal(resolveScrapLocation(null, 'jw001'), 'JW001');
});
