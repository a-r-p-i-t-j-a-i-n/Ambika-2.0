/**
 * The per-day stock burn-down both IMS item pages draw (RM and Consumables).
 * Pure — no database — so the rule is tested on its own and the two modules
 * cannot drift apart.
 *
 *   day 0                 on hand (usable stock only)
 *   AWAITING_QC_DAY       + Awaiting QC: received on a completed GRN, not usable
 *                         until its Incoming QC accepts it. Assumed usable the
 *                         next day — it is already on site; only the inspection
 *                         is outstanding. (Before QC-gated posting this quantity
 *                         was already in on hand on day 0.)
 *   day round(leadDays)   + material in transit (ordered − received)
 *   every day > 0         − average daily consumption
 *
 * The three quantities never overlap (see inventory/awaitingQc.service.js), so
 * nothing is added twice.
 */
export const AWAITING_QC_DAY = 1;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param {object} p
 *   onHand, inTransit, awaitingQc, leadDays, adc, reorderPoint  (from deriveMetrics)
 *   days   number of days after today to project
 *   today  Date for day 0 (defaults to now)
 * @returns {{ series: {day, date, projected}[], reorderDay: number|null, stockoutDay: number|null }}
 */
export const projectStockSeries = ({
  onHand = 0, inTransit = 0, awaitingQc = 0, leadDays = 0, adc = 0, reorderPoint = 0, days = 30, today = new Date(),
}) => {
  const series = [];
  let projected = round2(onHand);
  let reorderDay = null;
  let stockoutDay = null;
  for (let d = 0; d <= days; d += 1) {
    const date = new Date(today.getTime() + d * 86400000);
    if (awaitingQc > 0 && d === AWAITING_QC_DAY) projected = round2(projected + awaitingQc);
    // Material-in-transit assumed to arrive after the lead time.
    if (inTransit > 0 && d === Math.round(leadDays)) projected = round2(projected + inTransit);
    if (d > 0) projected = round2(projected - adc);
    const clamped = Math.max(0, projected);
    if (reorderDay === null && clamped <= reorderPoint) reorderDay = d;
    if (stockoutDay === null && clamped <= 0) stockoutDay = d;
    series.push({ day: d, date, projected: clamped });
  }
  return { series, reorderDay, stockoutDay };
};

export default projectStockSeries;
