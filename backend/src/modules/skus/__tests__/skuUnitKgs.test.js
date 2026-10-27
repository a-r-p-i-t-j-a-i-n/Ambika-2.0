/**
 * SKU Master keeps the unit exactly as entered — "kg", "Kg", "KG", "pcs",
 * "Piece" — trimmed only. The stock ledger still spells kilograms KGS
 * (normalizeSkuUnit), so stock rows keep one label per unit.
 *
 * No database — documents, update casts and Joi validation run in memory.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import SKU, { normalizeSkuUnit, trimSkuUnit } from '../sku.model.js';
import { createSkuSchema, updateSkuSchema, bulkUpsertSkuRowSchema } from '../sku.validation.js';

const MIXED_CASE = ['KG', 'kg', 'Kg', 'KGS', 'Kgs', 'PCS', 'pcs', 'Piece', 'pieces', 'Nos', 'LTR'];

test('the ledger spells every kilogram KGS', () => {
  for (const u of ['KG', 'kg', 'Kg', ' KG ', 'KGS', 'Kgs', 'kgs', 'Kilogram', 'KILOGRAMS', 'kilo']) {
    assert.equal(normalizeSkuUnit(u), 'KGS', u);
  }
});

test('the ledger leaves other units exactly as given', () => {
  for (const u of ['PCS', 'BOX', 'LTR', 'MTR', 'NOS', 'SET', 'Pcs', 'MT', 'KGSM', '']) {
    assert.equal(normalizeSkuUnit(u), u, u);
  }
  assert.equal(normalizeSkuUnit(null), null);
  assert.equal(normalizeSkuUnit(undefined), undefined);
});

test('the master unit setter only trims', () => {
  for (const u of MIXED_CASE) assert.equal(trimSkuUnit(u), u, u);
  assert.equal(trimSkuUnit('  Kg '), 'Kg');
  assert.equal(trimSkuUnit(null), null);
  assert.equal(trimSkuUnit(undefined), undefined);
});

test('a new SKU keeps the unit casing it was saved with; the default stays PCS', () => {
  for (const u of MIXED_CASE) assert.equal(new SKU({ name: 'x', code: 'X', unit: u }).unit, u, u);
  assert.equal(new SKU({ name: 'x', code: 'X', unit: ' pcs ' }).unit, 'pcs');
  assert.equal(new SKU({ name: 'x', code: 'X' }).unit, 'PCS');
});

test('an edit or sheet upsert writes the unit as given, not uppercased or relabelled', () => {
  for (const u of ['kg', 'Kg', 'KG', 'pcs', 'Piece']) {
    const q = SKU.findOneAndUpdate({ code: 'X' }, { $set: { unit: u, pcsPerBox: 5 } });
    assert.deepEqual(q._castUpdate(q._update), { $set: { unit: u, pcsPerBox: 5 } }, u);
  }
});

test('API validation accepts mixed-case units and passes them through unchanged', () => {
  for (const u of MIXED_CASE) {
    const create = createSkuSchema.validate({ name: 'x', code: 'X', itemType: 'CONSUMABLE', unit: u });
    assert.equal(create.error, undefined, u);
    assert.equal(create.value.unit, u, u);

    const update = updateSkuSchema.validate({ unit: u });
    assert.equal(update.error, undefined, u);
    assert.equal(update.value.unit, u, u);

    const row = bulkUpsertSkuRowSchema.validate({ name: 'x', code: 'X', unit: u });
    assert.equal(row.error, undefined, u);
    assert.equal(row.value.unit, u, u);
  }
});
