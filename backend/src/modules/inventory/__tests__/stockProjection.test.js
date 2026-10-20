/**
 * The shared RM / Consumables forecast burn-down, with Awaiting QC.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { projectStockSeries, AWAITING_QC_DAY } from '../stockProjection.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const TODAY = new Date('2026-10-19T00:00:00Z');

/** The loop both getForecast()s ran before the extraction — copied verbatim as the oracle. */
const legacyLoop = (m, n) => {
  const series = [];
  let projected = m.onHand;
  let reorderDay = null;
  let stockoutDay = null;
  for (let d = 0; d <= n; d += 1) {
    const date = new Date(TODAY.getTime() + d * 86400000);
    if (m.inTransit > 0 && d === Math.round(m.leadDays)) projected = round2(projected + m.inTransit);
    if (d > 0) projected = round2(projected - m.adc);
    const clamped = Math.max(0, projected);
    if (reorderDay === null && clamped <= m.reorderPoint) reorderDay = d;
    if (stockoutDay === null && clamped <= 0) stockoutDay = d;
    series.push({ day: d, date, projected: clamped });
  }
  return { series, reorderDay, stockoutDay };
};

test('with nothing awaiting QC the projection is identical to the old loop', () => {
  for (const m of [
    { onHand: 500, inTransit: 300, leadDays: 7, adc: 40, reorderPoint: 280 },
    { onHand: 0, inTransit: 0, leadDays: 16, adc: 3.5, reorderPoint: 56 },
    { onHand: 120.5, inTransit: 60, leadDays: 0.6, adc: 12.25, reorderPoint: 0 },
  ]) {
    for (const n of [7, 30, 120]) {
      assert.deepEqual(projectStockSeries({ ...m, awaitingQc: 0, days: n, today: TODAY }), legacyLoop(m, n));
    }
  }
});

test('Awaiting QC is not usable today; it joins the stock the next day', () => {
  const { series } = projectStockSeries({ onHand: 100, awaitingQc: 50, adc: 10, days: 3, today: TODAY });
  assert.equal(AWAITING_QC_DAY, 1);
  assert.deepEqual(series.map((s) => s.projected), [100, 140, 130, 120]); // day1: 100 + 50 − 10
});

test('Awaiting QC and in transit are separate quantities — each added once', () => {
  const { series } = projectStockSeries({ onHand: 0, awaitingQc: 40, inTransit: 60, leadDays: 3, adc: 0, days: 5, today: TODAY });
  assert.deepEqual(series.map((s) => s.projected), [0, 40, 40, 100, 100, 100]);
});

test('Awaiting QC postpones the stock-out day, never the out-of-stock today', () => {
  const without = projectStockSeries({ onHand: 0, adc: 10, days: 10, today: TODAY });
  const withAwaiting = projectStockSeries({ onHand: 0, awaitingQc: 50, adc: 10, days: 10, today: TODAY });
  assert.equal(without.stockoutDay, 0);
  assert.equal(withAwaiting.stockoutDay, 0, 'nothing is usable today');
  assert.equal(withAwaiting.series[1].projected, 40);
  assert.equal(withAwaiting.series.findIndex((s, i) => i > 0 && s.projected <= 0), 5);
});
