/**
 * Consumables Lead Time default, and the formulas that hang off it.
 *
 * No database: the constant and resolveMaxLevel are pure, and the fixture's
 * expected() is the same arithmetic the service performs. The parts that need
 * real data — the 72 explicit policies staying put, RM and FG not moving — are
 * covered by the before/after snapshot comparison, which is an integration
 * check and is reported separately.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { CONSUMABLES_DEFAULT_LEAD_DAYS, resolveMaxLevel } from '../ims.service.js';
import { expected } from '../../../scripts/e2eConsumablesFixture.js';

// ── The default itself ────────────────────────────────────────────────────────
test('Consumables default Lead Time is 16 days', () => {
  assert.equal(CONSUMABLES_DEFAULT_LEAD_DAYS, 16);
});

test('an item with no policy plans on 16 days, not the SKU master default of 7', () => {
  // lead/sf/moq null in the fixture means "no InventoryPolicy row".
  const e = expected({ code: 'X', opening: 600, received: 0, consumed: 450, lead: null, sf: null, moq: null });
  assert.equal(e.lead, 16);
  assert.equal(e.sf, 1.5, 'the Safety Factor default is unchanged');
  // ADC 5 ⇒ 5 × 16 = 80 reorder, 5 × 16 × 1.5 = 120 max.
  assert.equal(e.reorderPoint, 80);
  assert.equal(e.maxLevel, 120);
});

// ── An explicit policy still wins ─────────────────────────────────────────────
test('an explicit Lead Time of 10 stays 10', () => {
  const e = expected({ code: 'X', opening: 1000, received: 0, consumed: 900, lead: 10, sf: 2.5, moq: 0 });
  assert.equal(e.lead, 10);
  assert.equal(e.reorderPoint, 100);        // 10 × 10
  assert.equal(e.maxLevel, 250);            // 10 × 10 × 2.5
});

test('an explicit Lead Time of 7 stays 7 — the default never overrides a set value', () => {
  const e = expected({ code: 'X', opening: 1000, received: 0, consumed: 900, lead: 7, sf: 2.5, moq: 0 });
  assert.equal(e.lead, 7);
  assert.equal(e.reorderPoint, 70);         // 10 × 7
  assert.equal(e.maxLevel, 175);            // 10 × 7 × 2.5
});

// ── The formulas are untouched ────────────────────────────────────────────────
test('Max Level is still ADC × Lead Time × Safety Factor', () => {
  for (const [adc, lead, sf] of [[10, 16, 2.5], [5, 16, 1.5], [1, 10, 2], [0.07, 16, 1.5]]) {
    const { maxLevel } = resolveMaxLevel({ leadDays: lead, safetyFactor: sf, maxLevelMode: 'AUTO' }, adc);
    assert.equal(maxLevel, Math.round(adc * lead * sf * 100) / 100);
  }
});

test('Reorder At is still ADC × Lead Time, and carries no Safety Factor', () => {
  const a = expected({ code: 'X', opening: 1000, received: 0, consumed: 900, lead: 16, sf: 1.5, moq: 0 });
  const b = expected({ code: 'X', opening: 1000, received: 0, consumed: 900, lead: 16, sf: 5, moq: 0 });
  assert.equal(a.reorderPoint, 160);
  assert.equal(b.reorderPoint, 160, 'changing the Safety Factor must not move Reorder At');
  assert.notEqual(a.maxLevel, b.maxLevel, 'but it must still move Max Level');
});

test('a MANUAL max level still overrides the formula', () => {
  const { maxLevel, maxLevelMode } = resolveMaxLevel(
    { leadDays: 16, safetyFactor: 1.5, maxLevel: 999, maxLevelMode: 'MANUAL' }, 10,
  );
  assert.equal(maxLevel, 999);
  assert.equal(maxLevelMode, 'MANUAL');
});

// ── ADC is still measured-only ────────────────────────────────────────────────
test('ADC comes from measured consumption, never the stored planning figure', () => {
  // The fixture stores averageDailyConsumption 999 on every policy it writes;
  // expected() derives ADC purely from what was consumed in the window.
  const e = expected({ code: 'X', opening: 1000, received: 0, consumed: 900, lead: 16, sf: 1.5, moq: 0 });
  assert.equal(e.adc, 10, '900 consumed over 90 days is 10/day');
  assert.notEqual(e.adc, 999);
});

test('nothing consumed means ADC 0 and Days Cover unknown — not zero cover', () => {
  const e = expected({ code: 'X', opening: 250, received: 0, consumed: 0, lead: 16, sf: 2.5, moq: 0 });
  assert.equal(e.adc, 0);
  assert.equal(e.maxLevel, 0);
  assert.equal(e.reorderPoint, 0);
  assert.equal(e.daysCover, null, 'null means unknown; 0 would read as "no cover left"');
});

// ── Scope guard ───────────────────────────────────────────────────────────────
test('the constant is Consumables-only and does not equal the FG default', () => {
  // FG deliberately defaults to 7 (production lead time). If someone ever makes
  // these share a constant, this is the test that should stop them.
  assert.notEqual(CONSUMABLES_DEFAULT_LEAD_DAYS, 7);
});
