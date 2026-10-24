/**
 * SKU Master spells kilograms KGS, whatever was typed or imported.
 *
 * A label only: every other unit is kept as given, and no quantity changes.
 * No database — documents and update casts are built in memory.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import SKU, { normalizeSkuUnit } from '../sku.model.js';

test('every kilogram spelling becomes KGS', () => {
  for (const u of ['KG', 'kg', 'Kg', ' KG ', 'KGS', 'Kgs', 'kgs', 'Kilogram', 'KILOGRAMS', 'kilo']) {
    assert.equal(normalizeSkuUnit(u), 'KGS', u);
  }
});

test('other units are left exactly as given', () => {
  for (const u of ['PCS', 'BOX', 'LTR', 'MTR', 'NOS', 'SET', 'Pcs', 'MT', 'KGSM', '']) {
    assert.equal(normalizeSkuUnit(u), u, u);
  }
  assert.equal(normalizeSkuUnit(null), null);
  assert.equal(normalizeSkuUnit(undefined), undefined);
});

test('a new SKU saved with KG is stored as KGS; the default stays PCS', () => {
  assert.equal(new SKU({ name: 'x', code: 'X', unit: 'KG' }).unit, 'KGS');
  assert.equal(new SKU({ name: 'x', code: 'X', unit: 'LTR' }).unit, 'LTR');
  assert.equal(new SKU({ name: 'x', code: 'X' }).unit, 'PCS');
});

test('an edit or sheet upsert that sets KG writes KGS', () => {
  const q = SKU.findOneAndUpdate({ code: 'X' }, { $set: { unit: 'Kg', pcsPerBox: 5 } });
  assert.deepEqual(q._castUpdate(q._update), { $set: { unit: 'KGS', pcsPerBox: 5 } });
});
