/**
 * OEE engine — the single source of truth for every derived DPR number.
 *
 * Reverse-engineered from the client's own OEE sheet and verified against their
 * live rows (e.g. SAP01 Gobaa: 1300 pcs, SPM 35, 40 min net → 92.9% machine eff;
 * DAP02 Pressing: 1160 pcs, SPM 10, 620 avail − 300 loss → 52% availability,
 * 18.7% machine eff, 36.3% operator eff). Kept pure (no DB) so the entry form's
 * live preview and the stored value are computed by the exact same code.
 *
 *   Available          = stop − start                     (minutes)
 *   Net Available      = Available − Planned Downtime
 *   Run Time           = Net Available − Unplanned Downtime
 *   Availability       = Run Time / Net Available
 *   Std Cycle (min/pc) = 1 / (SPM × cavity)
 *   Performance        = (Qty × StdCycle) / Run Time        (= Operator Eff)
 *   Machine Eff        = (Qty × StdCycle) / Net Available   (= Availability × Perf)
 *   Quality            = (Qty − Reject − Rework) / Qty
 *   OEE                = Availability × Performance × Quality  (= Machine Eff × Quality)
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round = (v, dp = 2) => {
  const f = 10 ** dp;
  return Math.round((num(v) + Number.EPSILON) * f) / f;
};
const clamp01 = (v) => Math.min(1, Math.max(0, num(v)));
const sum = (arr, pick) => (arr || []).reduce((a, x) => a + num(pick(x)), 0);

/** Minutes between "HH:MM" start and stop; wraps past midnight for night shifts. */
export const minutesBetween = (start, stop) => {
  if (!start || !stop) return 0;
  const [sh, sm] = String(start).split(':').map(Number);
  const [eh, em] = String(stop).split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => !Number.isFinite(n))) return 0;
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // crossed midnight
  return mins;
};

/**
 * Compute the full OEE block for one DPR entry.
 * @param {object} e - normalised entry inputs (hourly[], plannedItems[],
 *                     downtimeItems[], defectItems[], reworkQty, spm, cavity,
 *                     availableMinutes|startTime/stopTime, partRate).
 */
export const computeOee = (e = {}) => {
  const productionQty = sum(e.hourly, (h) => h.qty);

  const availableMinutes = num(e.availableMinutes) || minutesBetween(e.startTime, e.stopTime);
  const plannedTotal = sum(e.plannedItems, (x) => x.minutes);
  const downtimeTotal = sum(e.downtimeItems, (x) => x.minutes);

  const netAvailable = Math.max(0, availableMinutes - plannedTotal);
  const runTime = Math.max(0, netAvailable - downtimeTotal);

  const spm = num(e.spm);
  const cavity = num(e.cavity) || 1;
  // Standard minutes to make one good piece. 0 when SPM unknown (buffing etc.).
  const stdCycleMin = spm > 0 ? 1 / (spm * cavity) : 0;

  const rejectQty = sum(e.defectItems, (x) => x.qty);
  const reworkQty = num(e.reworkQty);
  const goodQty = Math.max(0, productionQty - rejectQty - reworkQty);

  const availability = netAvailable > 0 ? clamp01(runTime / netAvailable) : 0;
  const earnedMinutes = productionQty * stdCycleMin; // "good-rate" minutes earned
  // Performance is capped at 100%: output above the theoretical max means the
  // standard cycle time (SPM) is understated, not true >100% efficiency. Capping
  // here keeps the stored value identical to the form's live preview and the
  // dashboards' weighted roll-ups (which also clamp). OEE decomposes cleanly as
  // Availability × Performance × Quality, so Machine Eff = Availability × Perf.
  const performance = runTime > 0 && stdCycleMin > 0 ? clamp01(earnedMinutes / runTime) : 0;
  const machineEff = availability * performance;
  const quality = productionQty > 0 ? clamp01(goodQty / productionQty) : 0;
  const oee = availability * performance * quality;

  const rejectPct = productionQty > 0 ? rejectQty / productionQty : 0;
  const reworkPct = productionQty > 0 ? reworkQty / productionQty : 0;
  const rejectPpm = productionQty > 0 ? (rejectQty / productionQty) * 1e6 : 0;

  const partRate = num(e.partRate);
  const productionValue = goodQty * partRate;
  const rejectionValue = rejectQty * partRate;

  return {
    productionQty: round(productionQty, 0),
    availableMinutes: round(availableMinutes, 0),
    netAvailable: round(netAvailable, 2),
    runTime: round(runTime, 2),
    plannedTotal: round(plannedTotal, 2),
    downtimeTotal: round(downtimeTotal, 2),
    stdCycleMin: round(stdCycleMin, 5),
    availability: round(availability, 4),
    performance: round(performance, 4),
    quality: round(quality, 4),
    machineEff: round(machineEff, 4),
    operatorEff: round(performance, 4),
    oee: round(oee, 4),
    reworkQty: round(reworkQty, 0),
    rejectQty: round(rejectQty, 0),
    goodQty: round(goodQty, 0),
    reworkPct: round(reworkPct, 4),
    rejectPct: round(rejectPct, 4),
    rejectPpm: round(rejectPpm, 0),
    partRate: round(partRate, 2),
    productionValue: round(productionValue, 2),
    rejectionValue: round(rejectionValue, 2),
  };
};

export default { computeOee, minutesBetween };
