/**
 * GRN → RM stock: the opt-in, the Received At it posts to, and the scrap-location
 * rule that a GRN "Received At" now feeds.
 *
 * No database. The decisions under test were deliberately extracted as pure
 * functions (planGrnStockPosting, resolveScrapLocation) so the RULE can be
 * tested directly rather than through a mongod this repo has no harness for.
 * What is NOT covered here is stated plainly in the final report rather than
 * faked with mocks: the atomic claim, the transaction and the movement writes
 * all need a replica set.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { planGrnStockPosting } from '../grn.service.js';
import { completeGrnSchema, createGrnSchema, updateGrnSchema } from '../grn.validation.js';
import GoodsReceiptNote from '../grn.model.js';
import { RM_ITEM_TYPES } from '../../../skus/sku.model.js';
import { RM_RECEIVED_AT_LOCATIONS, DEFAULT_RM_RECEIVED_AT } from '../../../inventory/inventoryStock.model.js';
import { resolveScrapLocation } from '../../../inventory/rmIms.service.js';

// A GRN with one coil, one circle (both Raw Material) and one consumable.
const COIL = { skuId: 'a1', itemName: 'Coil 1250mm', receivedQty: 500 };
const CIRCLE = { skuId: 'a2', itemName: 'Circle 180mm', receivedQty: 300 };
const BOLT = { skuId: 'b1', itemName: 'Bolt M8', receivedQty: 200 };
const ITEM_TYPES = new Map([['a1', 'RAW_MATERIAL'], ['a2', 'CIRCLE'], ['b1', 'CONSUMABLE']]);

const plan = (addToRmStock, rmLocation = 'PLG01', lines = [COIL, CIRCLE, BOLT]) =>
  planGrnStockPosting({ lines, itemTypeBySku: ITEM_TYPES, addToRmStock, rmLocation, grnWarehouse: 'MAIN' });

// ── Test 1 — unticked: no RM movement ─────────────────────────────────────────
test('unticked: Raw Material lines post nothing, other item types are unaffected', () => {
  const steps = plan(false);
  const byName = Object.fromEntries(steps.map((s) => [s.line.itemName, s]));

  assert.equal(byName['Coil 1250mm'].post, false);
  assert.equal(byName['Circle 180mm'].post, false);
  // The whole point of gating RM and nothing else.
  assert.equal(byName['Bolt M8'].post, true);
  assert.equal(byName['Bolt M8'].warehouse, 'MAIN');
});

// ── Test 2 / 6 — ticked: exactly one posting per RM line ──────────────────────
test('ticked: every RM line posts exactly once, to the chosen Received At', () => {
  const steps = plan(true, 'PLG01');
  assert.equal(steps.filter((s) => s.post).length, 3);
  // One step per line — never one lumped movement for the whole GRN.
  assert.equal(steps.length, 3);

  const rm = steps.filter((s) => s.isRm);
  assert.equal(rm.length, 2, 'both RAW_MATERIAL and CIRCLE count as RM');
  for (const s of rm) assert.equal(s.warehouse, 'PLG01');
});

test('ticked with JW001: RM lands at the job worker, non-RM still at the GRN store', () => {
  const steps = plan(true, 'JW001');
  for (const s of steps) {
    assert.equal(s.warehouse, s.isRm ? 'JW001' : 'MAIN');
  }
});

// ── Test 7 — a non-RM line must never become RM stock ─────────────────────────
test('a non-RM line is never classified as RM, whatever the opt-in says', () => {
  for (const opted of [true, false]) {
    const bolt = plan(opted).find((s) => s.line.itemName === 'Bolt M8');
    assert.equal(bolt.isRm, false);
    assert.equal(bolt.warehouse, 'MAIN', 'a consumable never goes to a Received At');
  }
});

test('classification comes from the SKU master, not the item name', () => {
  // Named like a coil, classified as a consumable — the master wins.
  const liar = { skuId: 'b1', itemName: 'Coil 9999mm', receivedQty: 1 };
  const [step] = planGrnStockPosting({
    lines: [liar], itemTypeBySku: ITEM_TYPES, addToRmStock: false, rmLocation: 'PLG01', grnWarehouse: 'MAIN',
  });
  assert.equal(step.isRm, false);
  assert.equal(step.post, true);
});

test('an unknown SKU is not treated as Raw Material', () => {
  const [step] = planGrnStockPosting({
    lines: [{ skuId: 'zz', itemName: 'Mystery', receivedQty: 1 }],
    itemTypeBySku: ITEM_TYPES, addToRmStock: false, rmLocation: 'PLG01', grnWarehouse: 'MAIN',
  });
  assert.equal(step.isRm, false);
  assert.equal(step.post, true, 'unclassified lines keep posting exactly as before');
});

test('RM_ITEM_TYPES is the single classification list', () => {
  assert.deepEqual(RM_ITEM_TYPES, ['RAW_MATERIAL', 'CIRCLE']);
});

// ── Tests 13 / 14 — Received At: one definition, one default ──────────────────
test('stock is never posted by assumption', () => {
  // The guarantee moved, it did not go away. completeGrnSchema used to default
  // addToRmStock to false; now that the flag can be set on the GRN form, the
  // schema leaves an omitted field alone so the saved choice can be inherited,
  // and the floor is the model's own default instead.
  const { error, value } = completeGrnSchema.validate({}, { stripUnknown: true });
  assert.equal(error, undefined);
  assert.equal('addToRmStock' in value, false, 'an omitted flag must not be invented');
  assert.equal(GoodsReceiptNote.schema.path('addToRmStock').defaultValue, false,
    'a GRN that never opted in still reads as false');
  assert.equal(GoodsReceiptNote.schema.path('rmReceivedAtLocation').defaultValue, null);
});

test('Received At accepts only the RM locations', () => {
  // PLG01 remains the final fallback, applied by the service rather than the
  // schema (see DEFAULT_RM_RECEIVED_AT in grn.service complete()).
  assert.equal(DEFAULT_RM_RECEIVED_AT, 'PLG01');

  // Case is normalised, so a client sending lowercase still validates.
  const lower = completeGrnSchema.validate({ addToRmStock: true, rmReceivedAtLocation: 'jw001' }, { stripUnknown: true });
  assert.equal(lower.value.rmReceivedAtLocation, 'JW001');

  // MAIN is the GRN's own store and is NOT a Received At — it must be refused
  // rather than silently mapped onto one.
  const bad = completeGrnSchema.validate({ addToRmStock: true, rmReceivedAtLocation: 'MAIN' }, { stripUnknown: true });
  assert.ok(bad.error, 'MAIN must not be accepted as a Received At');

  assert.deepEqual(RM_RECEIVED_AT_LOCATIONS, ['PLG01', 'JW001']);
});

test('the opt-in survives stripUnknown — the bug that made the old checkbox dead', () => {
  // validate.js runs every schema with stripUnknown: true. A field the dialog
  // sends but the schema does not name is dropped before the service sees it,
  // which is exactly what happens to `allowOverReceipt` today.
  const { value } = completeGrnSchema.validate(
    { addToRmStock: true, rmReceivedAtLocation: 'JW001', somethingElse: 'x' },
    { stripUnknown: true },
  );
  assert.equal(value.addToRmStock, true);
  assert.equal(value.rmReceivedAtLocation, 'JW001');
  assert.equal(value.somethingElse, undefined);
});

// ── The scrap-location rule a GRN Received At now feeds ───────────────────────
test('the operator who made the cut outranks the coil receipt', () => {
  // The coil was RECEIVED at the plant but CUT at the job worker. Before this
  // change the receipt won, which would have recorded a job-work cut as
  // in-house and posted SCRAP_IN for offcuts that stayed with the job worker.
  assert.equal(resolveScrapLocation({ warehouse: 'PLG01' }, 'JW001'), 'JW001');
  assert.equal(resolveScrapLocation({ warehouse: 'JW001' }, 'PLG01'), 'PLG01');
});

test('the receipt is still used when the cut names no location of its own', () => {
  assert.equal(resolveScrapLocation({ warehouse: 'JW001' }, ''), 'JW001');
  assert.equal(resolveScrapLocation({ warehouse: 'PLG01' }, undefined), 'PLG01');
});

test('MAIN is not a cutting location, from either side', () => {
  // Every historical GRN receipt sits at MAIN; it must never become a location.
  assert.equal(resolveScrapLocation({ warehouse: 'MAIN' }, 'JW001'), 'JW001');
  assert.equal(resolveScrapLocation({ warehouse: 'MAIN' }, ''), null);
  assert.equal(resolveScrapLocation(null, null), null, 'unknown stays unknown, never guessed');
});

test('location matching is case-insensitive on both sides', () => {
  assert.equal(resolveScrapLocation({ warehouse: ' plg01 ' }, ''), 'PLG01');
  assert.equal(resolveScrapLocation(null, 'jw001'), 'JW001');
});

// ── The GRN form: Received At is captured when the GRN is raised ─────────────
// These guard the half that was missing — the create/edit path. Both fields
// were previously absent from createGrnSchema and updateGrnSchema, so anything
// the form sent was dropped by validate.js's stripUnknown before the service
// ever saw it.
const PO_ID = '6ac09965f1c61c40fa206c23';
const vCreate = (v) => createGrnSchema.validate({ poId: PO_ID, ...v }, { abortEarly: false, stripUnknown: true });
const vUpdate = (v) => updateGrnSchema.validate(v, { abortEarly: false, stripUnknown: true });

test('create accepts the opt-in and the location, and normalises case', () => {
  // Inventory Type is now required on every new GRN (it replaced the checkbox).
  const { error, value } = vCreate({ inventoryType: 'RM', addToRmStock: true, rmReceivedAtLocation: 'jw001' });
  assert.equal(error, undefined);
  assert.equal(value.addToRmStock, true);
  assert.equal(value.rmReceivedAtLocation, 'JW001');
});

test('create: Inventory Type is required and limited to RM / Consumable & Packaging', () => {
  assert.match(vCreate({}).error?.message || '', /Select the Inventory Type/);
  assert.ok(vCreate({ inventoryType: 'FG' }).error, 'Finished Goods are never purchased');
  assert.equal(vCreate({ inventoryType: 'CONSUMABLE_PACKAGING' }).error, undefined);
  assert.match(vCreate({ inventoryType: 'RM' }).error?.message || '', /Received At is required for a Raw Material/);
});

test('create: Received At is required once the box is ticked', () => {
  assert.ok(vCreate({ addToRmStock: true }).error, 'missing location must be refused');
  assert.ok(vCreate({ addToRmStock: true, rmReceivedAtLocation: null }).error, 'null is not a location');
  assert.match(vCreate({ addToRmStock: true }).error.message, /Received At is required/);
});

test('create: a GRN that is not opted in needs no location at all', () => {
  const { error, value } = vCreate({ inventoryType: 'CONSUMABLE_PACKAGING', addToRmStock: false });
  assert.equal(error, undefined);
  assert.equal(value.addToRmStock, false);
});

test('create: MAIN is the GRN store, never a Received At', () => {
  const { error } = vCreate({ addToRmStock: true, rmReceivedAtLocation: 'MAIN' });
  assert.ok(error);
  assert.match(error.message, /must be one of: PLG01, JW001/);
});

test('update accepts both fields and keeps the same required rule', () => {
  assert.equal(vUpdate({ addToRmStock: true, rmReceivedAtLocation: 'PLG01' }).error, undefined);
  assert.ok(vUpdate({ addToRmStock: true }).error, 'opting in without a location must be refused');
});

test('update: a PATCH that does not mention them leaves the saved choice alone', () => {
  // No default on either field, so neither key appears in the validated body
  // and Object.assign in the service cannot overwrite what is stored.
  const { error, value } = vUpdate({ remarks: 'just a note' });
  assert.equal(error, undefined);
  assert.equal('addToRmStock' in value, false);
  assert.equal('rmReceivedAtLocation' in value, false);
});

test('complete no longer injects defaults, so an omitted field can be inherited', () => {
  // It used to default addToRmStock to false and the location to PLG01, which
  // would have silently overridden the choice made on the form.
  const { error, value } = completeGrnSchema.validate({}, { stripUnknown: true });
  assert.equal(error, undefined);
  assert.equal('addToRmStock' in value, false);
  assert.equal('rmReceivedAtLocation' in value, false);
});

test('complete still accepts an explicit override of both', () => {
  const { error, value } = completeGrnSchema.validate(
    { addToRmStock: true, rmReceivedAtLocation: 'jw001' }, { stripUnknown: true },
  );
  assert.equal(error, undefined);
  assert.equal(value.addToRmStock, true);
  assert.equal(value.rmReceivedAtLocation, 'JW001');
});

// ── Test 20 — historical GRNs ─────────────────────────────────────────────────
test('a historical GRN carries no opt-in, so reading it posts nothing', () => {
  // addToRmStock is absent on every GRN written before this change. Absent is
  // falsy, so the plan treats it exactly as "not opted in".
  const legacy = undefined;
  const steps = plan(legacy);
  assert.equal(steps.filter((s) => s.isRm && s.post).length, 0);
});
