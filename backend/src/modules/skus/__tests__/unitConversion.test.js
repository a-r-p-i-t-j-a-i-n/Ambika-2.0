/**
 * Purchase unit → stock unit conversion (1 BOX = 25 PCS) — the pure rules.
 *
 * SKU Master configures it, the indent / PO / GRN carry the purchase unit, the
 * GRN line freezes the factor at completion and Incoming QC posts
 * accepted × factor to stock. The flow against a database (PO → GRN → QC →
 * stock → issue, duplicate completion, factor edits) is exercised by
 * src/scripts/e2eUnitConversionFixture.js.
 *
 * No database.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import SKU from '../sku.model.js';
import { createSkuSchema, updateSkuSchema, bulkUpsertSkuRowSchema } from '../sku.validation.js';
import {
  unitKey, sameUnit, skuConversion, conversionRuleText, normalizeConversionConfig,
  lineConversion, UNIT_PROBLEM, toStockQty, stockUnitCost,
} from '../unitConversion.js';
import { bindItemsToSkus } from '../../procurement/indent/itemSku.js';
import { convertGrnLines } from '../../procurement/grn/grn.service.js';
import { planAcceptedStockIn, qcItemsFromGrn, planRejectStockOut } from '../../procurement/incoming-qc/incomingQc.service.js';

const BOX25 = { _id: 's25', code: 'GLOVE', name: 'Gloves', unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: 25 };
const BOX24 = { _id: 's24', code: 'MASK', name: 'Masks', unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: 24 };
const SAME = { _id: 'sP', code: 'BRUSH', name: 'Brush', unit: 'PCS', purchaseUnit: '', purchaseConversionFactor: null };
const LEGACY = { _id: 'sL', code: 'OLD', name: 'Old item', unit: 'Nos' }; // saved before the fields existed
const grnLineFor = (sku, unit, qty) => ({ _id: 'gx', itemName: sku.code, skuId: sku._id, unit, receivedQty: qty, rate: 10 });

// ── Units ────────────────────────────────────────────────────────────────────

test('unit spellings: case, kilogram and piece spellings compare equal; others by text', () => {
  for (const [a, b] of [['PCS', 'Pcs'], ['pcs', 'Piece'], ['PCS', 'Nos'], ['Kg', 'KGS'], ['BOX', 'Box'], ['Box', 'boxes'], ['LTR', 'ltr']]) {
    assert.equal(sameUnit(a, b), true, `${a} = ${b}`);
  }
  for (const [a, b] of [['BOX', 'PCS'], ['KGS', 'PCS'], ['LTR', 'MTR'], ['', ''], ['BOX', '']]) {
    assert.equal(sameUnit(a, b), false, `${a} ≠ ${b}`);
  }
  assert.equal(unitKey(' pcs. '), 'PCS');
});

test('SKU conversion: "1 BOX = 25 PCS"; same-unit and legacy SKUs convert nothing', () => {
  assert.deepEqual(skuConversion(BOX25), { converts: true, stockUnit: 'PCS', purchaseUnit: 'BOX', factor: 25 });
  assert.equal(conversionRuleText(BOX25), '1 BOX = 25 PCS');
  assert.equal(conversionRuleText(BOX24), '1 BOX = 24 PCS');
  for (const sku of [SAME, LEGACY, {}, null, { unit: 'PCS', purchaseUnit: 'BOX' }, { unit: 'PCS', purchaseUnit: 'pcs', purchaseConversionFactor: 25 }]) {
    assert.equal(skuConversion(sku).converts, false, JSON.stringify(sku));
    assert.equal(conversionRuleText(sku), '');
  }
});

// ── SKU Master validation ────────────────────────────────────────────────────

test('config: a different purchase unit needs a positive, finite factor', () => {
  assert.deepEqual(normalizeConversionConfig({ unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: 25 }),
    { value: { purchaseUnit: 'BOX', purchaseConversionFactor: 25 }, errors: [] });
  assert.deepEqual(normalizeConversionConfig({ unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: '24' }).value,
    { purchaseUnit: 'BOX', purchaseConversionFactor: 24 }, 'a numeric string from a form');
  assert.equal(normalizeConversionConfig({ unit: 'KGS', purchaseUnit: 'BAG', purchaseConversionFactor: 0.25 }).errors.length, 0, 'fractions are fine');
  for (const bad of [undefined, null, '', 0, -5, '-1', 'abc', NaN, Infinity, -Infinity, true, 1e7, 1.23456]) {
    const r = normalizeConversionConfig({ unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: bad });
    assert.equal(r.errors.length, 1, `factor ${String(bad)} must be refused`);
    assert.deepEqual(r.value, { purchaseUnit: '', purchaseConversionFactor: null }, 'nothing half-saved');
  }
  assert.match(normalizeConversionConfig({ unit: 'PCS', purchaseUnit: 'BOX' }).errors[0], /how many PCS are in 1 BOX/);
});

test('config: no purchase unit, or the stock unit itself, means no conversion', () => {
  const none = { purchaseUnit: '', purchaseConversionFactor: null };
  assert.deepEqual(normalizeConversionConfig({ unit: 'PCS' }), { value: none, errors: [] });
  assert.deepEqual(normalizeConversionConfig({ unit: 'PCS', purchaseUnit: '  ' }), { value: none, errors: [] });
  assert.deepEqual(normalizeConversionConfig({ unit: 'PCS', purchaseUnit: 'Pcs', purchaseConversionFactor: 1 }), { value: none, errors: [] });
  assert.deepEqual(normalizeConversionConfig({ unit: 'PCS', purchaseUnit: 'Pcs' }), { value: none, errors: [] });
  assert.equal(normalizeConversionConfig({ unit: 'PCS', purchaseUnit: 'Pcs', purchaseConversionFactor: 25 }).errors.length, 1,
    'PCS = 25 PCS is incompatible');
  assert.equal(normalizeConversionConfig({ unit: 'PCS', purchaseConversionFactor: 25 }).errors.length, 1,
    'a factor without a purchase unit names nothing');
});

test('direction: always 1 [Purchase Unit] = factor [IMS Stock Unit] — 1 BOX = 15 PCS, never 1 PCS = 15 BOX', () => {
  const ok = normalizeConversionConfig({ unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: 15 });
  assert.deepEqual(ok, { value: { purchaseUnit: 'BOX', purchaseConversionFactor: 15 }, errors: [] });
  assert.equal(conversionRuleText({ unit: 'PCS', ...ok.value }), '1 BOX = 15 PCS');
  assert.equal(toStockQty(5, 15).stockQty, 75, '5 BOX received = 75 PCS');
  // The reported mistake: Stock Unit Box, Purchase Unit PCS, 15.
  const reversed = normalizeConversionConfig({ unit: 'Box', purchaseUnit: 'PCS', purchaseConversionFactor: 15 });
  assert.equal(reversed.errors.length, 1);
  assert.match(reversed.errors[0], /wrong way round .* Set Purchase Unit Box, IMS Stock Unit PCS/);
  for (const [pu, stock] of [['Nos', 'CARTON'], ['pcs', 'Pkt'], ['PIECES', 'DOZEN'], ['PCS', 'BOX']]) {
    assert.equal(normalizeConversionConfig({ unit: stock, purchaseUnit: pu, purchaseConversionFactor: 0.04 }).errors.length, 1, `${pu} → ${stock}`);
  }
  assert.match(normalizeConversionConfig({ unit: 'PCS', purchaseUnit: 'BOX', purchaseConversionFactor: 0.5 }).errors[0], /must hold at least 1 PCS/);
  for (const [pu, stock, f] of [['CARTON', 'BOX', 10], ['BAG', 'KGS', 25], ['PCS', 'KGS', 0.25], ['ROLL', 'METER', 50]]) {
    assert.deepEqual(normalizeConversionConfig({ unit: stock, purchaseUnit: pu, purchaseConversionFactor: f }).errors, [], `${pu} → ${stock} is fine`);
  }
});

test('a SKU already saved the wrong way round is refused downstream, never converted', () => {
  const saved = { _id: 'sR', code: 'REV', unit: 'Box', purchaseUnit: 'PCS', purchaseConversionFactor: 15 };
  for (const unit of ['PCS', 'Box', 'KGS']) {
    assert.equal(lineConversion(saved, unit).problem, UNIT_PROBLEM.REVERSED_CONFIG, unit);
  }
  const { problems } = convertGrnLines([grnLineFor(saved, 'PCS', 5)], () => saved);
  assert.match(problems[0], /1 PCS = 15 Box\) is the wrong way round/);
});

test('the SKU model defaults to no conversion and refuses a zero / negative / non-finite factor', () => {
  const doc = new SKU({ name: 'x', code: 'X', itemType: 'CONSUMABLE' });
  assert.equal(doc.purchaseUnit, '');
  assert.equal(doc.purchaseConversionFactor, null);
  for (const bad of [0, -1, Infinity, NaN]) {
    const err = new SKU({ name: 'x', code: 'X', itemType: 'CONSUMABLE', purchaseUnit: 'BOX', purchaseConversionFactor: bad }).validateSync();
    assert.ok(err?.errors?.purchaseConversionFactor, `model refuses ${bad}`);
  }
  assert.equal(new SKU({ name: 'x', code: 'X', itemType: 'CONSUMABLE', purchaseUnit: ' BOX ', purchaseConversionFactor: 25 }).validateSync(), undefined);
});

test('Joi: an edit or import that omits the stock unit no longer defaults it to PCS', () => {
  assert.equal(updateSkuSchema.validate({ sellingPrice: 10 }).value.unit, undefined, 'PATCH leaves the stored unit alone');
  assert.equal(bulkUpsertSkuRowSchema.validate({ name: 'x', code: 'X' }).value.unit, undefined);
  assert.equal(createSkuSchema.validate({ name: 'x', code: 'X', itemType: 'CONSUMABLE' }).value.unit, 'PCS', 'a new SKU still gets PCS');
  const v = updateSkuSchema.validate({ purchaseUnit: 'BOX', purchaseConversionFactor: 25 }).value;
  assert.deepEqual([v.purchaseUnit, v.purchaseConversionFactor], ['BOX', 25]);
  assert.equal(updateSkuSchema.validate({ purchaseConversionFactor: null }).error, undefined, 'clearing is allowed');
});

// ── Indent / PO / GRN lines ──────────────────────────────────────────────────

test('indent items take the purchase unit; same-unit and legacy SKUs keep the stock unit', () => {
  const { items, problems } = bindItemsToSkus(
    [{ skuId: 's25', quantity: 5 }, { skuId: 'sP', quantity: 3 }, { skuId: 'sL', quantity: 2 }],
    [BOX25, SAME, LEGACY],
  );
  assert.deepEqual(problems, []);
  assert.deepEqual(items.map((i) => [i.unit, i.quantity]), [['BOX', 5], ['PCS', 3], ['Nos', 2]], 'quantity is never converted here');
});

test('line conversion: purchase unit converts, stock unit is 1:1, anything else is incompatible', () => {
  assert.deepEqual(lineConversion(BOX25, 'Box'), { converts: true, factor: 25, stockUnit: 'PCS', rule: '1 BOX = 25 PCS', problem: null });
  assert.equal(lineConversion(BOX25, 'Pcs').factor, 1, 'a PO raised in PCS before the purchase unit existed');
  assert.equal(lineConversion(BOX25, 'Pcs').converts, false);
  assert.equal(lineConversion(BOX25, 'KGS').problem, UNIT_PROBLEM.INCOMPATIBLE_UNIT);
  for (const unit of ['BOX', 'KGS', 'Pcs', '']) {
    assert.deepEqual([lineConversion(SAME, unit).factor, lineConversion(SAME, unit).problem], [1, null], `same-unit SKU, ${unit}`);
    assert.deepEqual([lineConversion(LEGACY, unit).factor, lineConversion(LEGACY, unit).problem], [1, null], `legacy SKU, ${unit}`);
  }
});

test('stock quantity: 5 BOX × 25 = 125 PCS; results needing more than 2 decimals are inexact, never rounded', () => {
  assert.deepEqual(toStockQty(5, 25), { stockQty: 125, exact: true });
  assert.deepEqual(toStockQty(5, 24), { stockQty: 120, exact: true });
  assert.deepEqual(toStockQty(0.1, 3), { stockQty: 0.3, exact: true }, 'float noise is not inexactness');
  assert.deepEqual(toStockQty(1.5, 2.5), { stockQty: 3.75, exact: true });
  assert.equal(toStockQty(0.33, 2.5).exact, false, '0.825 PCS cannot be held to 2 decimals');
  assert.deepEqual(toStockQty(7, null), { stockQty: 7, exact: true }, 'no factor = 1:1');
});

test('valuation: the BOX value spread over PCS reproduces the received value', () => {
  // 5 BOX @ ₹100 = ₹500 → 120 PCS (24/BOX)
  const cost = stockUnitCost(500, 120);
  assert.equal(cost, 4.166667);
  assert.equal(Math.round(120 * cost * 100) / 100, 500);
  // 5 BOX @ ₹250 = ₹1250 → 125 PCS (25/BOX) = ₹10 per PCS
  assert.equal(stockUnitCost(1250, 125), 10);
  assert.equal(stockUnitCost(100, 0), 0);
});

const grnLine = (over) => ({
  _id: 'g1', itemName: 'Gloves', skuId: 's25', unit: 'BOX', receivedQty: 5, rate: 250,
  inventoryDestination: 'CP_IMS', stockWarehouse: 'MAIN', stockStatus: 'AWAITING_QC', ...over,
});
const skuOf = (l) => ({ s25: BOX25, s24: BOX24, sP: SAME, sL: LEGACY }[l.skuId] || null);

test('GRN lines: the purchase unit is stamped with its conversion; other lines are cleared (1:1)', () => {
  const { lines, problems } = convertGrnLines([
    grnLine(),
    grnLine({ _id: 'g2', itemName: 'Masks', skuId: 's24', receivedQty: 5 }),
    grnLine({ _id: 'g3', itemName: 'Brush', skuId: 'sP', unit: 'PCS', receivedQty: 50, stockUnit: 'X', conversionFactor: 9, stockQty: 1 }),
    grnLine({ _id: 'g4', itemName: 'Gloves in PCS', unit: 'Pcs', receivedQty: 40 }),
    grnLine({ _id: 'g5', itemName: 'Free text', skuId: null, unit: 'BOX', receivedQty: 3 }),
  ], skuOf);
  assert.deepEqual(problems, []);
  assert.deepEqual(lines.map((l) => [l.unit, l.receivedQty, l.stockUnit, l.conversionFactor, l.stockQty]), [
    ['BOX', 5, 'PCS', 25, 125],
    ['BOX', 5, 'PCS', 24, 120],
    ['PCS', 50, null, null, null],
    ['Pcs', 40, null, null, null],
    ['BOX', 3, null, null, null],
  ]);
  assert.deepEqual(lines.map((l) => l.rate), [250, 250, 250, 250, 250], 'the commercial rate is never touched');
});

test('GRN lines: a received line in an incompatible unit or with an inexact quantity is refused', () => {
  assert.match(convertGrnLines([grnLine({ unit: 'KGS' })], skuOf).problems[0], /"Gloves" is in KGS, but SKU Master buys it in BOX \(1 BOX = 25 PCS\)/);
  assert.deepEqual(convertGrnLines([grnLine({ unit: 'KGS', receivedQty: 0 })], skuOf).problems, [], 'a 0-qty draft row is not a receipt');
  const half = { ...BOX25, purchaseConversionFactor: 2.5 };
  assert.match(convertGrnLines([grnLine({ receivedQty: 0.33 })], () => half).problems[0], /0\.33 BOX × 2\.5 = 0\.825 PCS/);
});

// ── Incoming QC: the one conversion point ────────────────────────────────────

const frozen = grnLine({ stockUnit: 'PCS', conversionFactor: 25, stockQty: 125 });

test('QC posting: accepted BOX × the frozen factor; QC lines carry the conversion for display', () => {
  const scope = [frozen];
  const { items } = qcItemsFromGrn({ items: null, scopeLines: scope });
  assert.deepEqual([items[0].unit, items[0].stockUnit, items[0].conversionFactor], ['BOX', 'PCS', 25]);
  const all = planAcceptedStockIn({ qcItems: items, scopeLines: scope });
  assert.deepEqual(all.errors, []);
  assert.deepEqual(all.steps.map((s) => [s.quantity, s.stockQty, s.factor]), [[5, 125, 25]]);
  const part = planAcceptedStockIn({
    qcItems: [{ grnItemId: 'g1', receivedQty: 5, acceptedQty: 3, rejectedQty: 2, reworkQty: 0 }], scopeLines: scope,
  });
  assert.deepEqual(part.steps.map((s) => [s.quantity, s.stockQty]), [[3, 75]], 'only the accepted boxes post');
});

test('QC posting: the frozen factor wins — the SKU\'s current factor is never read', () => {
  // The GRN froze 25; whatever SKU Master says now is not an input to the plan.
  const plan = planAcceptedStockIn({ qcItems: qcItemsFromGrn({ items: null, scopeLines: [frozen] }).items, scopeLines: [frozen] });
  assert.equal(plan.steps[0].stockQty, 125);
});

test('QC posting: lines without a frozen factor (same-unit SKUs, legacy GRNs) post 1:1 as before', () => {
  const legacy = grnLine({ unit: 'PCS', receivedQty: 50 });
  const plan = planAcceptedStockIn({ qcItems: qcItemsFromGrn({ items: null, scopeLines: [legacy] }).items, scopeLines: [legacy] });
  assert.deepEqual(plan.steps.map((s) => [s.quantity, s.stockQty, s.factor]), [[50, 50, null]]);
});

test('QC posting: an accepted qty that would need rounding is refused', () => {
  const line = grnLine({ receivedQty: 1, stockUnit: 'PCS', conversionFactor: 2.5, stockQty: 2.5 });
  const plan = planAcceptedStockIn({
    qcItems: [{ grnItemId: 'g1', receivedQty: 1, acceptedQty: 0.33, rejectedQty: 0.67, reworkQty: 0 }], scopeLines: [line],
  });
  assert.equal(plan.steps.length, 0);
  assert.match(plan.errors[0], /0\.825 PCS/);
});

test('QC posting: a line already posted is refused — the conversion can never post twice', () => {
  const posted = { ...frozen, stockStatus: 'POSTED', movementId: 'm1', movementNumber: 'MOV-1' };
  const plan = planAcceptedStockIn({ qcItems: [{ grnItemId: 'g1', receivedQty: 5, acceptedQty: 5 }], scopeLines: [posted] });
  assert.equal(plan.steps.length, 0);
  assert.match(plan.errors[0], /already posted/);
});

test('legacy reject-out carries the GRN line\'s frozen factor (none on legacy lines → 1:1)', () => {
  const receipts = [{ _id: 'm1', skuId: 's25', batchNo: '', warehouse: 'MAIN' }];
  const conv = planRejectStockOut({
    qcItems: [{ grnItemId: 'g1', skuId: 's25', rejectedQty: 2, itemName: 'Gloves' }],
    grnItems: [{ ...frozen, movementId: 'm1' }], receipts,
  });
  assert.deepEqual(conv.steps.map((s) => [s.factor, s.stockUnit]), [[25, 'PCS']]);
  const old = planRejectStockOut({
    qcItems: [{ grnItemId: 'g1', skuId: 's25', rejectedQty: 2, itemName: 'Gloves' }],
    grnItems: [{ ...grnLine({ unit: 'PCS' }), movementId: 'm1' }], receipts,
  });
  assert.deepEqual(old.steps.map((s) => [s.factor, s.stockUnit]), [[null, null]]);
});
