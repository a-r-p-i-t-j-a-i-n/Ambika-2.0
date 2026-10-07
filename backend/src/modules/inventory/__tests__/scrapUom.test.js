/**
 * SCRAP OUT — quantity in a unit, and the buyer rule.
 *
 * What is under test is the pure decision logic in `scrapUom.js`, which both
 * the Joi schema and the service call, so a figure here is the figure the
 * stock check and the ledger use. The expected kilograms are the brief's,
 * worked by hand (1 Quintal = 100 kg, 1 Ton = 1000 kg) — not computed the way
 * the code computes them.
 *
 * WHAT IS NOT COVERED HERE, stated plainly:
 *   • that a Scrap Out larger than the balance is refused, and that "allow
 *     negative" lets it through — that is the preflight and the stock engine,
 *     exercised against a live database by src/scripts/e2eScrapOutFixture.js;
 *   • that a duplicate buyer is returned rather than created — that needs the
 *     unique index, so it is exercised there too.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCRAP_QTY_UNITS, toKg, hasAtMostDecimals, resolveScrapQuantity,
  buyerRequiredFor, buyerNameKey, normalizeGstNo,
} from '../scrapUom.js';

/* ── Conversion — the brief's own examples ─────────────────────────────── */

test('500 KG is 500 kg', () => {
  assert.equal(toKg(500, 'KG'), 500);
});

test('5 Quintal is 500 kg', () => {
  assert.equal(toKg(5, 'QUINTAL'), 500);
});

test('2 Ton is 2,000 kg', () => {
  assert.equal(toKg(2, 'TON'), 2000);
});

test('10 Quintal is 1,000 kg — fits inside 1,500 kg of stock', () => {
  const kg = toKg(10, 'QUINTAL');
  assert.equal(kg, 1000);
  assert.ok(kg <= 1500);
});

test('2 Ton is 2,000 kg — more than 1,500 kg of stock', () => {
  const kg = toKg(2, 'TON');
  assert.ok(kg > 1500);
});

test('the unit code is case-insensitive', () => {
  assert.equal(toKg(3, 'quintal'), 300);
  assert.equal(toKg(1, 'Ton'), 1000);
});

test('an unknown unit converts to NaN, never to a guessed number', () => {
  assert.ok(Number.isNaN(toKg(5, 'POUND')));
  assert.ok(Number.isNaN(toKg(5, '')));
});

test('the factors are exactly 1 / 100 / 1000', () => {
  assert.equal(SCRAP_QTY_UNITS.KG.factor, 1);
  assert.equal(SCRAP_QTY_UNITS.QUINTAL.factor, 100);
  assert.equal(SCRAP_QTY_UNITS.TON.factor, 1000);
});

/* ── Decimals convert exactly ───────────────────────────────────────────── */

test('decimal entries convert exactly to the 0.01 kg the ledger keeps', () => {
  assert.equal(toKg(2.5, 'QUINTAL'), 250);
  assert.equal(toKg(1.75, 'TON'), 1750);
  assert.equal(toKg(0.0125, 'QUINTAL'), 1.25);
  assert.equal(toKg(1.23456, 'TON'), 1234.56);
  assert.equal(toKg(12.34, 'KG'), 12.34);
});

test('float noise is not mistaken for an extra decimal place', () => {
  // 2.675 * 100 is 267.49999999999997 in binary floating point.
  assert.ok(hasAtMostDecimals(2.675, 3));
  // 0.1 + 0.2 is 0.30000000000000004: binary noise on what a person typed as
  // 0.3, so it must be accepted as two decimals, not refused as seventeen.
  assert.ok(hasAtMostDecimals(0.1 + 0.2, 2));
  assert.ok(hasAtMostDecimals(0.3, 2));
  // A genuine third decimal is still caught.
  assert.equal(hasAtMostDecimals(0.305, 2), false);
});

test('tiny values in exponent form are judged arithmetically, not by their string', () => {
  assert.equal(hasAtMostDecimals(1e-7, 5), false);
});

/* ── resolveScrapQuantity — the new request shape ──────────────────────── */

test('new shape: 5 Quintal resolves to 500 kg and keeps what was typed', () => {
  assert.deepEqual(resolveScrapQuantity({ quantity: 5, uom: 'QUINTAL' }),
    { ok: true, kg: 500, enteredQty: 5, enteredUom: 'QUINTAL' });
});

test('new shape: the unit is required', () => {
  const r = resolveScrapQuantity({ quantity: 5 });
  assert.equal(r.ok, false);
  assert.match(r.error, /unit/i);
});

test('new shape: zero is refused', () => {
  assert.equal(resolveScrapQuantity({ quantity: 0, uom: 'KG' }).ok, false);
});

test('new shape: a negative quantity is refused', () => {
  assert.equal(resolveScrapQuantity({ quantity: -5, uom: 'TON' }).ok, false);
});

test('new shape: text that is not a number is refused', () => {
  assert.equal(resolveScrapQuantity({ quantity: 'abc', uom: 'KG' }).ok, false);
});

test('new shape: too many decimals for the unit is refused, with the limit named', () => {
  const kg = resolveScrapQuantity({ quantity: 1.005, uom: 'KG' });
  assert.equal(kg.ok, false);
  assert.match(kg.error, /2 decimal/);
  const q = resolveScrapQuantity({ quantity: 0.01005, uom: 'QUINTAL' });
  assert.equal(q.ok, false);
  assert.match(q.error, /4 decimal/);
  const t = resolveScrapQuantity({ quantity: 0.000004, uom: 'TON' });
  assert.equal(t.ok, false);
});

test('new shape: the most precise entry each unit allows still makes at least 0.01 kg', () => {
  assert.deepEqual(resolveScrapQuantity({ quantity: 0.01, uom: 'KG' }).kg, 0.01);
  assert.deepEqual(resolveScrapQuantity({ quantity: 0.0001, uom: 'QUINTAL' }).kg, 0.01);
  assert.deepEqual(resolveScrapQuantity({ quantity: 0.00001, uom: 'TON' }).kg, 0.01);
});

test('new shape: an unknown unit is refused', () => {
  const r = resolveScrapQuantity({ quantity: 5, uom: 'POUND' });
  assert.equal(r.ok, false);
  assert.match(r.error, /KG, QUINTAL, TON/);
});

/* ── resolveScrapQuantity — the original shape still works ─────────────── */

test('legacy shape: quantityKg alone still resolves, as kilograms', () => {
  assert.deepEqual(resolveScrapQuantity({ quantityKg: 750 }),
    { ok: true, kg: 750, enteredQty: 750, enteredUom: 'KG' });
});

test('legacy shape: quantityKg of zero is refused', () => {
  assert.equal(resolveScrapQuantity({ quantityKg: 0 }).ok, false);
});

test('legacy shape keeps its ORIGINAL behaviour: 3+ decimals are rounded to 0.01 kg, not refused', () => {
  // Before this change the service did round2(quantityKg); a stale client
  // posting 10.125 kg must still save, as 10.13 kg.
  assert.deepEqual(resolveScrapQuantity({ quantityKg: 10.125 }),
    { ok: true, kg: 10.13, enteredQty: 10.13, enteredUom: 'KG' });
});

test('legacy shape: a figure that rounds to nothing is still refused, as before', () => {
  assert.equal(resolveScrapQuantity({ quantityKg: 0.004 }).ok, false);
});

test('sending both shapes at once is refused rather than guessed between', () => {
  const r = resolveScrapQuantity({ quantity: 5, uom: 'TON', quantityKg: 5 });
  assert.equal(r.ok, false);
});

test('sending no quantity at all is refused', () => {
  assert.equal(resolveScrapQuantity({}).ok, false);
});

/* ── The buyer rule ─────────────────────────────────────────────────────── */

test('only a SALE requires a buyer', () => {
  assert.equal(buyerRequiredFor('SALE'), true);
  for (const r of ['DISPOSAL', 'TRANSFER', 'CORRECTION_ADJUSTMENT', 'OTHER', undefined]) {
    assert.equal(buyerRequiredFor(r), false, `${r} must not require a buyer`);
  }
});

test('buyer names compare without case or extra spaces', () => {
  assert.equal(buyerNameKey('  Shree  Metal   Traders '), 'shree metal traders');
  assert.equal(buyerNameKey('SHREE METAL TRADERS'), buyerNameKey('shree metal traders'));
  assert.notEqual(buyerNameKey('Shree Metal Traders'), buyerNameKey('Shree Metals Traders'));
});

test('GSTIN compares upper-case with no spaces; blank stays blank', () => {
  assert.equal(normalizeGstNo(' 24abcde1234f1z5 '), '24ABCDE1234F1Z5');
  assert.equal(normalizeGstNo('24 ABCDE 1234F 1Z5'), '24ABCDE1234F1Z5');
  assert.equal(normalizeGstNo(''), '');
  assert.equal(normalizeGstNo(null), '');
});
