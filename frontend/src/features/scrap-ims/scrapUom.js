/**
 * Scrap Out quantity units — the screen's copy of the server's rules.
 *
 * MIRRORS backend/src/modules/inventory/scrapUom.js, which is the authority:
 * the server converts and validates every entry again, so this copy exists
 * only to tell the operator BEFORE they press Save that "2 Ton" is 2,000 kg and
 * more than the 1,500 kg on hand. Keep the factors and decimal limits
 * identical — a difference would show one answer on screen and act on another.
 *
 * KG stays the stock unit: the balance, the "after" figure and the ledger are
 * all kilograms. A Quintal or a Ton is only how the figure is entered.
 */

export const SCRAP_QTY_UNITS = Object.freeze({
  KG:      Object.freeze({ code: 'KG',      label: 'KG',      factor: 1,    decimals: 2 }),
  QUINTAL: Object.freeze({ code: 'QUINTAL', label: 'Quintal', factor: 100,  decimals: 4 }),
  TON:     Object.freeze({ code: 'TON',     label: 'Ton',     factor: 1000, decimals: 5 }),
});

export const SCRAP_QTY_UNIT_OPTIONS = Object.values(SCRAP_QTY_UNITS).map((u) => ({
  value: u.code,
  label: u.label,
  hint: u.factor === 1 ? 'Kilograms — the stock unit.' : `1 ${u.label} = ${u.factor.toLocaleString('en-IN')} kg`,
}));

export const MIN_SCRAP_KG = 0.01;

export const hasAtMostDecimals = (value, places) => {
  const scaled = Number(value) * 10 ** places;
  return Number.isFinite(scaled) && Math.abs(scaled - Math.round(scaled)) < 1e-6;
};

export const toKg = (quantity, unitCode) => {
  const unit = SCRAP_QTY_UNITS[String(unitCode || '').toUpperCase()];
  if (!unit) return NaN;
  return Math.round(Number(quantity) * unit.factor * 100) / 100;
};

/**
 * What the typed figure means, for the screen.
 * @returns {{ empty: boolean, ok: boolean, kg: number, error: string }}
 */
export const readScrapQuantity = (raw, unitCode) => {
  if (raw === '' || raw === null || raw === undefined) return { empty: true, ok: false, kg: 0, error: '' };
  const unit = SCRAP_QTY_UNITS[unitCode];
  if (!unit) return { empty: false, ok: false, kg: 0, error: 'Choose a unit.' };
  const q = Number(raw);
  if (!Number.isFinite(q)) return { empty: false, ok: false, kg: 0, error: 'Enter a number.' };
  if (!(q > 0)) return { empty: false, ok: false, kg: 0, error: 'Quantity must be more than zero.' };
  if (!hasAtMostDecimals(q, unit.decimals)) {
    return { empty: false, ok: false, kg: 0, error: `${unit.label} allows up to ${unit.decimals} decimal places.` };
  }
  const kg = toKg(q, unit.code);
  if (!(kg >= MIN_SCRAP_KG)) {
    return { empty: false, ok: false, kg, error: `That is less than ${MIN_SCRAP_KG} kg — too small to record.` };
  }
  return { empty: false, ok: true, kg, error: '' };
};

/**
 * The figure AS TYPED, for display — to the unit's own decimal limit.
 *
 * Not `num()`: that rounds to 2 decimals, so 12.345 Ton would read "12.35 Ton"
 * beside a ledger figure of 12,345 kg — the one place meant to show exactly
 * what was typed would show something else. Each unit's limit is the most the
 * entry can carry, so nothing is ever rounded here.
 */
export const fmtEntered = (value, unitCode) => Number(value || 0).toLocaleString('en-IN', {
  maximumFractionDigits: SCRAP_QTY_UNITS[String(unitCode || '').toUpperCase()]?.decimals ?? 2,
});

/** Unit label for a stored code ("QUINTAL" → "Quintal"); unknown codes pass through. */
export const unitLabel = (unitCode) => SCRAP_QTY_UNITS[String(unitCode || '').toUpperCase()]?.label || unitCode || '';

/** The HTML step for the number box, so 2.125 Ton is not flagged by the browser. */
export const stepFor = (unitCode) => (SCRAP_QTY_UNITS[unitCode] ? `${10 ** -SCRAP_QTY_UNITS[unitCode].decimals}` : '0.01');
