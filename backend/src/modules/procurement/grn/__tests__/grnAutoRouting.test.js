/**
 * Automatic SKU-based inventory routing for GRN lines — replaces the retired
 * manual, one-per-GRN Inventory Type.
 *
 * Pure rule tests (no database): the itemType → destination map, the per-line
 * router and its refusals, the posting-stage defaults that keep historical GRNs
 * legacy, and the audit script's classification flags. The posting itself is
 * covered against a local scratch database by
 * src/scripts/e2eQcGatedPostingFixture.js.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ITEM_TYPES, BUY_SIDE_ITEM_TYPES, RM_ITEM_TYPES, CP_IMS_ITEM_TYPES, MAIN_STORE_ITEM_TYPES,
  NON_MATERIAL_ITEM_TYPES, INVENTORY_DESTINATION, inventoryDestinationOf,
} from '../../../skus/sku.model.js';
import { IMS_ITEM_TYPES } from '../../../inventory/ims.service.js';
import { routeGrnLines, routingProblemMessage, assertRoutable, ROUTING_PROBLEM } from '../grn.service.js';
import GoodsReceiptNote, { GRN_STOCK_POSTING_STAGE, GRN_LINE_STOCK_STATUS } from '../grn.model.js';
import { classifySku } from '../../../../scripts/auditInventoryClassification.js';

// ── The destination map ───────────────────────────────────────────────────────
test('every buy-side item type is routed or explicitly blocked — exactly once', () => {
  const groups = [RM_ITEM_TYPES, CP_IMS_ITEM_TYPES, MAIN_STORE_ITEM_TYPES, NON_MATERIAL_ITEM_TYPES];
  const all = groups.flat();
  assert.equal(new Set(all).size, all.length, 'no type belongs to two groups');
  assert.deepEqual([...all].sort(), [...BUY_SIDE_ITEM_TYPES].sort(), 'the groups cover the buy side, no more, no less');
});

test('destinations: RM → RM IMS, consumable / packing / packaging → C&P IMS, the rest → main store', () => {
  for (const t of ['RAW_MATERIAL', 'CIRCLE']) assert.equal(inventoryDestinationOf(t), INVENTORY_DESTINATION.RM_IMS);
  for (const t of ['CONSUMABLE', 'PACKING', 'PACKAGING']) assert.equal(inventoryDestinationOf(t), INVENTORY_DESTINATION.CP_IMS);
  for (const t of ['CHEMICAL', 'INK', 'SPARE_PART', 'STATIONERY', 'BUTTER_PAPER', 'SUBLIMATION_PAPER', 'WIP_MATERIAL']) {
    assert.equal(inventoryDestinationOf(t), INVENTORY_DESTINATION.MAIN_STORE, t);
  }
});

test('nothing routes Service, Job Work, Finished Goods, Scrap or an unknown type', () => {
  for (const t of ['SERVICE', 'JOB_WORK', 'FINISHED_GOOD', 'FG', 'SCRAP', '', null, undefined, 'GADGET']) {
    assert.equal(inventoryDestinationOf(t), null, String(t));
  }
});

test('C&P IMS lists exactly the types the GRN routes to it (one list, not two)', () => {
  assert.equal(IMS_ITEM_TYPES, CP_IMS_ITEM_TYPES);
  // Chemicals, ink, spares stay outside the C&P listing — current behaviour preserved.
  for (const t of MAIN_STORE_ITEM_TYPES) assert.equal(IMS_ITEM_TYPES.includes(t), false, t);
});

test('every ITEM_TYPES value is known to the router (no silent fall-through)', () => {
  for (const t of ITEM_TYPES) {
    const [r] = routeGrnLines({ lines: [{ skuId: 'x', itemName: t, receivedQty: 1 }], typeOf: () => t, rmLocation: 'PLG01' });
    assert.ok(r.destination || r.problem, `${t} has neither a destination nor a refusal`);
  }
});

// ── The per-line router ───────────────────────────────────────────────────────
const TYPES = new Map([
  ['coil', 'RAW_MATERIAL'], ['circle', 'CIRCLE'], ['brush', 'CONSUMABLE'], ['box', 'PACKING'], ['wrap', 'PACKAGING'],
  ['ink', 'INK'], ['chem', 'CHEMICAL'], ['spare', 'SPARE_PART'], ['svc', 'SERVICE'], ['jw', 'JOB_WORK'],
  ['jar', 'FINISHED_GOOD'], ['scrap', 'SCRAP'],
]);
const line = (sku, receivedQty = 10) => ({ skuId: sku, itemName: `Item ${sku}`, receivedQty });
const typeOf = (l) => TYPES.get(l.skuId) || '';
const route = (lines, rmLocation = 'JW001') => routeGrnLines({ lines, typeOf, rmLocation, grnWarehouse: 'MAIN' });

test('a mixed GRN routes every line on its own: RM to Received At, the rest to the GRN store', () => {
  const byName = Object.fromEntries(route([line('coil'), line('brush'), line('box'), line('ink')]).map((r) => [r.line.skuId, r]));
  assert.deepEqual([byName.coil.destination, byName.coil.warehouse], ['RM_IMS', 'JW001']);
  assert.deepEqual([byName.brush.destination, byName.brush.warehouse], ['CP_IMS', 'MAIN']);
  assert.deepEqual([byName.box.destination, byName.box.warehouse], ['CP_IMS', 'MAIN']);
  assert.deepEqual([byName.ink.destination, byName.ink.warehouse], ['MAIN_STORE', 'MAIN']);
  assert.ok(Object.values(byName).every((r) => !r.problem));
});

test('lines not being received (qty 0) are not routed — how a partial receipt works', () => {
  const routes = route([line('coil', 0), line('brush'), line('svc', 0)]);
  assert.deepEqual(routes.map((r) => r.line.skuId), ['brush'], 'a Service line at 0 qty does not block the GRN');
});

test('Service and Job Work are refused, with a reason that tells the operator what to do', () => {
  const routes = route([line('brush'), line('svc'), line('jw')]);
  assert.deepEqual(routes.filter((r) => r.problem).map((r) => [r.line.skuId, r.problem]),
    [['svc', ROUTING_PROBLEM.NON_MATERIAL], ['jw', ROUTING_PROBLEM.NON_MATERIAL]]);
  assert.throws(() => assertRoutable(routes), /"Item svc", "Item jw" are Service \/ Job Work, not material.*internal-service indents/);
});

test('Finished Goods and Scrap are refused even if they reach the router', () => {
  const routes = route([line('jar'), line('scrap')]);
  assert.ok(routes.every((r) => r.problem === ROUTING_PROBLEM.NOT_PURCHASABLE));
  assert.throws(() => assertRoutable(routes), /Finished Goods and Scrap cannot be received from a vendor/);
});

test('an itemType with no destination is refused — never guessed into a module', () => {
  const routes = routeGrnLines({ lines: [line('odd')], typeOf: () => 'GADGET', rmLocation: 'PLG01' });
  assert.equal(routes[0].problem, ROUTING_PROBLEM.UNCLASSIFIED);
  assert.match(routingProblemMessage(routes), /classified as "GADGET" in the SKU master.*Correct the Item Type/);
});

test('a line with no SKU may sit on a draft, but completion refuses it', () => {
  const routes = route([line('nosuch')]);
  assert.equal(routes[0].problem, ROUTING_PROBLEM.NO_SKU);
  assert.doesNotThrow(() => assertRoutable(routes), 'draft save');
  assert.throws(() => assertRoutable(routes, { requireSku: true }), /not linked to a SKU/);
});

test('one refusal names every problem line at once', () => {
  const msg = routingProblemMessage(route([line('svc'), line('jar'), line('nosuch')]));
  assert.match(msg, /Service \/ Job Work/);
  assert.match(msg, /Finished Goods and Scrap/);
  assert.match(msg, /not linked to a SKU/);
});

// ── Posting stage: historical GRNs stay legacy ────────────────────────────────
test('a GRN without the marker is legacy — never "still has stock to post"', () => {
  assert.equal(GoodsReceiptNote.schema.path('stockPostingStage').defaultValue, null);
  assert.deepEqual(Object.values(GRN_STOCK_POSTING_STAGE), ['QC_COMPLETION']);
  const legacy = new GoodsReceiptNote({ grnNumber: 'GRN-OLD', items: [{ itemName: 'x', receivedQty: 1 }] });
  assert.equal(legacy.stockPostingStage, null);
  assert.equal(legacy.items[0].stockStatus, null, 'legacy lines carry no QC-gated status');
  assert.equal(legacy.items[0].inventoryDestination, null);
});

test('line stock status values', () => {
  assert.deepEqual(Object.values(GRN_LINE_STOCK_STATUS), ['AWAITING_QC', 'POSTED', 'NOT_POSTED']);
  const bad = new GoodsReceiptNote({ grnNumber: 'G', items: [{ itemName: 'x', receivedQty: 1, stockStatus: 'MAYBE' }] });
  assert.ok(bad.validateSync()?.errors['items.0.stockStatus']);
});

// ── Audit flags (read-only script) ────────────────────────────────────────────
test('audit: flags missing, unsupported, code / text conflicts and test data — never resolves them', () => {
  assert.deepEqual(classifySku({ code: 'X1', name: 'Thing' }).flags, ['MISSING_ITEM_TYPE']);
  assert.ok(classifySku({ code: 'X1', name: 'Thing', itemType: 'GADGET' }).flags.includes('UNSUPPORTED_ITEM_TYPE:GADGET'));
  // Consumable-coded item stored as Packing (FlyWheel CO-FW-00-00 in the source notes).
  assert.ok(classifySku({ code: 'CO-FW-00-00', name: 'FlyWheel', itemType: 'PACKING' }).flags.includes('CODE_SUGGESTS:CONSUMABLE'));
  // A non-JSL code typed as Raw Material (the indent quick-add defaults to RM).
  assert.ok(classifySku({ code: 'CO-BS-50-00', name: 'Brush', itemType: 'RAW_MATERIAL' }).flags.includes('RM_TYPE_NON_RM_CODE'));
  // Chemical by text, routed to C&P by type — destination differs from the hint.
  assert.ok(classifySku({ code: 'CO-CH-01', name: 'Thinner', category: 'Chemical & Oil', itemType: 'CONSUMABLE' }).flags
    .includes('TEXT_SUGGESTS:CHEMICAL'));
  assert.ok(classifySku({ code: 'QA-FMS-SKU-B', name: 'QA', itemType: 'CONSUMABLE' }).flags.includes('TEST_DATA'));
  assert.deepEqual(classifySku({ code: 'JSL204-07', name: 'Cu 0.70 mm', itemType: 'RAW_MATERIAL' }).flags, []);
});
