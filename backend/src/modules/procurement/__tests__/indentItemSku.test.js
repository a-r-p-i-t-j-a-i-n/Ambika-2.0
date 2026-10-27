/**
 * Purchase Indent items are bound to the SKU Master (indent/itemSku.js).
 *
 * Pure rule tests (no database). The DB wrapper and the create / edit routes
 * are covered against a scratch database by
 * src/scripts/e2eIndentSkuVendorHistoryFixture.js.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { bindItemsToSkus } from '../indent/itemSku.js';

const BOLT = { _id: '6ac09965f1c61c40fa206c41', code: 'RT-BOLT', name: 'Bolt M8 (SKU Master)', unit: 'PCS' };
const NUT = { _id: '6ac09965f1c61c40fa206c42', code: 'RT-NUT', name: 'Nut M8', unit: 'PCS' };

test('name and code come from the SKU record, not the request', () => {
  const { items, problems } = bindItemsToSkus(
    [{ skuId: BOLT._id, skuCode: 'TYPED', itemName: 'whatever the user typed', quantity: 4, unit: 'Box', remarks: 'r' }],
    [BOLT],
  );
  assert.deepEqual(problems, []);
  assert.equal(items[0].itemName, 'Bolt M8 (SKU Master)');
  assert.equal(items[0].skuCode, 'RT-BOLT');
  assert.equal(items[0].quantity, 4, 'quantity kept');
  assert.equal(items[0].unit, 'Box', 'unit kept as entered');
  assert.equal(items[0].remarks, 'r');
});

test('an item with only a SKU code binds by exact code (case-insensitive)', () => {
  const { items, problems } = bindItemsToSkus([{ skuCode: 'rt-nut', itemName: 'x' }], [NUT]);
  assert.deepEqual(problems, []);
  assert.equal(String(items[0].skuId), NUT._id);
  assert.equal(items[0].itemName, 'Nut M8');
});

test('a free-typed item with no SKU is refused', () => {
  const { problems } = bindItemsToSkus([{ itemName: 'Hand-typed widget' }], [BOLT]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /"Hand-typed widget" is not linked to SKU Master/);
});

test('an unknown / inactive skuId is refused — never re-matched by its code', () => {
  const { problems, items } = bindItemsToSkus([{ skuId: '6ac09965f1c61c40fa206c99', skuCode: 'RT-BOLT', itemName: 'Old bolt' }], [BOLT]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not an active item in SKU Master/);
  assert.notEqual(String(items[0].skuId), BOLT._id);
});

test('an unknown code is refused with the code in the message', () => {
  const { problems } = bindItemsToSkus([{ skuCode: 'NOPE-1', itemName: 'Ghost' }], [BOLT]);
  assert.match(problems[0], /SKU NOPE-1/);
});

test('every bad item is reported, good ones still bind', () => {
  const { problems, items } = bindItemsToSkus([{ skuId: BOLT._id, itemName: 'a' }, { itemName: 'b' }, { skuCode: 'X', itemName: 'c' }], [BOLT]);
  assert.equal(problems.length, 2);
  assert.equal(items[0].itemName, BOLT.name);
});
