/**
 * Party → Ordered SKUs: adding SKUs from the SKU master, and the request rules.
 *
 * DB-less: the merge (new / linked / already there), that the input list is
 * not changed, and the add / remove request schemas.
 *
 * NOT covered here (needs a live DB, which this runner never sets up): the
 * save itself and the remove.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { addToOrderedSkus } from '../party.service.js';
import { addOrderedSkusSchema, orderedSkuParamSchema } from '../party.validation.js';

const id = (n) => String(n).padStart(24, 'a');
const sku = (n, code, extra = {}) => ({ _id: id(n), name: `SKU ${n}`, code, unit: 'Pcs', pcsPerBox: 24, weightPerBox: 6, sellingPrice: 118, ...extra });

test('a new SKU is added with its unit, packing and price', () => {
  const { list, added, linked, already } = addToOrderedSkus([], [sku(1, 'fj1000-204')]);
  assert.deepEqual([added, linked, already], [['SKU 1'], [], []]);
  assert.equal(list.length, 1);
  assert.deepEqual(
    { skuId: list[0].skuId, skuName: list[0].skuName, skuCode: list[0].skuCode, unit: list[0].unit, pcsPerBox: list[0].pcsPerBox, sellingPrice: list[0].sellingPrice },
    { skuId: id(1), skuName: 'SKU 1', skuCode: 'FJ1000-204', unit: 'Pcs', pcsPerBox: 24, sellingPrice: 118 },
  );
});

test('a SKU already on the list (same id) is left as it is', () => {
  const current = [{ skuId: id(1), skuName: 'SKU 1', skuCode: 'FJ1000-204', sellingPrice: 150, priceHistory: [{ price: 150 }] }];
  const { list, added, already } = addToOrderedSkus(current, [sku(1, 'FJ1000-204')]);
  assert.deepEqual([added, already], [[], ['SKU 1']]);
  assert.equal(list.length, 1);
  assert.equal(list[0].sellingPrice, 150, 'the price learned from orders is kept');
  assert.equal(list[0].priceHistory.length, 1);
});

test('a sheet row with the same code but no SKU id gets linked, not duplicated', () => {
  const current = [{ skuName: 'Flat Jar', skuCode: 'FJ1000-204', skuId: null, sellingPrice: 158 }];
  const { list, added, linked } = addToOrderedSkus(current, [sku(2, 'fj1000-204')]);
  assert.deepEqual([added, linked], [[], ['SKU 2']]);
  assert.equal(list.length, 1);
  assert.equal(list[0].skuId, id(2));
  assert.equal(list[0].skuName, 'Flat Jar', 'the row keeps its own name');
});

test('several at once; the input list is not changed', () => {
  const current = [{ skuId: id(1), skuCode: 'A' }];
  const snapshot = JSON.stringify(current);
  const { list, added, already } = addToOrderedSkus(current, [sku(1, 'A'), sku(2, 'B'), sku(3, 'C')]);
  assert.equal(list.length, 3);
  assert.deepEqual([added, already], [['SKU 2', 'SKU 3'], ['SKU 1']]);
  assert.equal(JSON.stringify(current), snapshot);
});

test('add request: 1–100 distinct SKU ids', () => {
  assert.ok(addOrderedSkusSchema.validate({ skuIds: [id(1), id(2)] }).error === undefined);
  assert.ok(addOrderedSkusSchema.validate({ skuIds: [] }).error);
  assert.ok(addOrderedSkusSchema.validate({ skuIds: ['nope'] }).error);
  assert.ok(addOrderedSkusSchema.validate({ skuIds: [id(1), id(1)] }).error, 'duplicates refused');
  assert.ok(addOrderedSkusSchema.validate({}).error);
});

test('remove request: party id and item id', () => {
  assert.ok(orderedSkuParamSchema.validate({ id: id(1), itemId: id(2) }).error === undefined);
  assert.ok(orderedSkuParamSchema.validate({ id: id(1) }).error);
});
