import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineIndentProblems, lineMatchesItemSku, submitQuantityProblems } from '../poLines.js';

const IND1 = '0000000000000000000000a1';
const IND2 = '0000000000000000000000a2';
const IT1 = '0000000000000000000000b1';
const IT2 = '0000000000000000000000b2';
const SKU1 = '0000000000000000000000c1';
const SKU2 = '0000000000000000000000c2';
const indent = (id, items) => ({ _id: id, indentNumber: 'Ind-1', items });
const item = (id, skuId, skuCode) => ({ _id: id, skuId, skuCode });
const INDENTS = [indent(IND1, [item(IT1, SKU1, 'NUT-1')]), indent(IND2, [item(IT2, SKU2, 'BOLT-2')])];

test('a line naming its own indent item with the same SKU is fine', () => {
  assert.deepEqual(lineIndentProblems(INDENTS, [{ indentId: IND1, indentItemId: IT1, skuId: SKU1, skuCode: 'NUT-1' }], { requireItemId: true }), []);
});
test('an indentItemId that is not on its indent is rejected (cross-indent / invented id)', () => {
  const [a] = lineIndentProblems(INDENTS, [{ indentId: IND1, indentItemId: IT2, itemName: 'Bolt' }]);
  assert.match(a, /"Bolt" is not an item of/);
  assert.equal(lineIndentProblems(INDENTS, [{ indentItemId: '0000000000000000000000ff', itemName: 'X' }]).length, 1);
});
test('a line without indentId finds its item on any of the PO indents', () => {
  assert.deepEqual(lineIndentProblems(INDENTS, [{ indentItemId: IT2, skuId: SKU2 }]), []);
});
test('an item with a different SKU than the line is rejected (id vs id, else code vs code)', () => {
  assert.equal(lineIndentProblems(INDENTS, [{ indentId: IND1, indentItemId: IT1, skuId: SKU2, itemName: 'Nut' }]).length, 1);
  assert.equal(lineIndentProblems(INDENTS, [{ indentId: IND1, indentItemId: IT1, skuCode: 'bolt-2', itemName: 'Nut' }]).length, 1);
  assert.deepEqual(lineIndentProblems(INDENTS, [{ indentId: IND1, indentItemId: IT1, skuCode: 'nut-1' }]), [], 'code match is case-insensitive');
  assert.equal(lineMatchesItemSku({ skuCode: 'A' }, { skuCode: '' }), true, 'compared only when both sides name a SKU');
});
test('item-wise creation requires every line to name its indent item; a plain line is fine elsewhere', () => {
  const plain = [{ itemName: 'Manual line', skuCode: 'ZZ' }];
  assert.match(lineIndentProblems(INDENTS, plain, { requireItemId: true })[0], /no indent item \(indentItemId\)/);
  assert.deepEqual(lineIndentProblems(INDENTS, plain), [], 'a standalone manual line stays valid on the edit / legacy paths');
  assert.equal(lineIndentProblems(INDENTS, [{ itemName: 'Derived', indentItemDisplayNumber: 'Ind-1.1/26-27' }]).length, 1, 'a line carrying an indent item reference but no id is an unmatched indent line');
});
test('submit quantities: every line must be a positive number', () => {
  assert.deepEqual(submitQuantityProblems([{ quantity: 1 }, { quantity: 0.5 }]), []);
  assert.equal(submitQuantityProblems([{ quantity: 1 }, { quantity: 0, itemName: 'Zero' }]).length, 1);
  assert.equal(submitQuantityProblems([{ quantity: -2 }]).length, 1);
  assert.equal(submitQuantityProblems([{ quantity: 'abc' }]).length, 1);
  assert.equal(submitQuantityProblems([]).length, 1);
});
