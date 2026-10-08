/**
 * Scrap Out — the rules that decide a quantity and a buyer, with no database.
 *
 * ── WHY THIS FILE IS PURE ────────────────────────────────────────────────────
 * The Joi schema and the service both need the same answers ("how many
 * kilograms is 2.5 Quintal?", "does this reason need a buyer?"). Asking them in
 * two places is how the stock check and the write end up disagreeing about the
 * same entry. They live here once, as plain functions, so `node --test` can
 * pin every one of them — this repo has no database harness.
 *
 * ── KG STAYS THE LEDGER UNIT ────────────────────────────────────────────────
 * The scrap SKU is stocked in KGS (scrapSku.js), every balance, preflight and
 * engine guard compares kilograms, and the Scrap register's yield figures are
 * kilograms. A Quintal or a Ton is only how the weighbridge slip reads — it is
 * converted to kilograms BEFORE anything touches stock, and the entered figure
 * is kept beside it purely so the ledger can show what was actually typed.
 *
 * ── WHY EACH UNIT CAPS ITS DECIMALS ─────────────────────────────────────────
 * The ledger rounds to 0.01 kg. Left unbounded, a Ton entry can carry more
 * precision than the ledger can hold: 0.000004 Ton is 0.004 kg, which passes
 * "greater than zero" and then rounds to nothing, and 0.01005 Quintal is
 * 1.005 kg, which rounds the wrong way. Capping each unit at the decimals that
 * map onto whole hundredths of a kilogram (KG 2, Quintal 4, Ton 5) makes every
 * accepted entry convert EXACTLY — no rounding decision is ever taken for the
 * operator.
 */

export const SCRAP_QTY_UNITS = Object.freeze({
  KG:      Object.freeze({ code: 'KG',      label: 'KG',      factor: 1,    decimals: 2 }),
  QUINTAL: Object.freeze({ code: 'QUINTAL', label: 'Quintal', factor: 100,  decimals: 4 }),
  TON:     Object.freeze({ code: 'TON',     label: 'Ton',     factor: 1000, decimals: 5 }),
});

export const SCRAP_QTY_UNIT_CODES = Object.freeze(Object.keys(SCRAP_QTY_UNITS));

/** The smallest movement the ledger can record (it rounds to 0.01 kg). */
export const MIN_SCRAP_KG = 0.01;

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * True when `value` has no more than `places` decimals.
 *
 * Done arithmetically rather than by reading the string, because a JS number
 * this small prints in exponent form (1e-7) and a string test would wave it
 * through. The tolerance absorbs binary float noise (2.675 * 100), never a
 * genuine extra digit.
 */
export const hasAtMostDecimals = (value, places) => {
  const scaled = Number(value) * 10 ** places;
  return Number.isFinite(scaled) && Math.abs(scaled - Math.round(scaled)) < 1e-6;
};

/**
 * Kilograms for a quantity in a unit. Exact for every input the decimal caps
 * allow, because each cap maps onto whole hundredths of a kilogram.
 */
export const toKg = (quantity, unitCode) => {
  const unit = SCRAP_QTY_UNITS[String(unitCode || '').toUpperCase()];
  if (!unit) return NaN;
  return Math.round(Number(quantity) * unit.factor * 100) / 100;
};

/**
 * Resolve what a Scrap Out request actually moves.
 *
 * Two request shapes are accepted, so nothing that posts today breaks:
 *   • the new one — { quantity, uom } — what the screen now sends;
 *   • the original one — { quantityKg } — every client and script before it.
 * Sending both is refused rather than guessed between.
 *
 * @returns {{ ok: true, kg, enteredQty, enteredUom } | { ok: false, error }}
 */
export const resolveScrapQuantity = ({ quantity, uom, quantityKg } = {}) => {
  const has = (v) => v !== undefined && v !== null && v !== '';
  const newShape = has(quantity) || has(uom);

  if (newShape && has(quantityKg)) {
    return { ok: false, error: 'Send the quantity once — either quantity with a unit, or quantityKg.' };
  }

  if (!newShape) {
    // The ORIGINAL request shape keeps its original behaviour exactly: any
    // positive figure, rounded to the ledger's 0.01 kg, refused only when that
    // rounding leaves nothing. The decimal caps above belong to the new
    // { quantity, uom } shape, which is all the screen sends now; holding an
    // older client (a stale browser tab mid-deploy) to them would turn an entry
    // that used to save into a refusal, for no benefit to anyone.
    if (!has(quantityKg)) return { ok: false, error: 'Quantity is required.' };
    const raw = Number(quantityKg);
    if (!Number.isFinite(raw) || !(raw > 0)) return { ok: false, error: 'Quantity must be more than zero.' };
    const kg = round2(raw);
    if (!(kg > 0)) return { ok: false, error: 'Quantity must be more than zero.' };
    return { ok: true, kg, enteredQty: kg, enteredUom: 'KG' };
  }

  if (!has(quantity)) return { ok: false, error: 'Quantity is required.' };
  if (!has(uom)) return { ok: false, error: 'Choose a unit for the quantity (KG, Quintal or Ton).' };

  const unit = SCRAP_QTY_UNITS[String(uom).toUpperCase()];
  if (!unit) return { ok: false, error: `Unit must be one of: ${SCRAP_QTY_UNIT_CODES.join(', ')}.` };

  const q = Number(quantity);
  if (!Number.isFinite(q) || !(q > 0)) return { ok: false, error: 'Quantity must be more than zero.' };
  if (!hasAtMostDecimals(q, unit.decimals)) {
    return { ok: false, error: `${unit.label} allows up to ${unit.decimals} decimal places.` };
  }

  const kg = toKg(q, unit.code);
  if (!(kg >= MIN_SCRAP_KG)) {
    return { ok: false, error: `That is less than ${MIN_SCRAP_KG} kg, the smallest amount the ledger can record.` };
  }
  return { ok: true, kg, enteredQty: q, enteredUom: unit.code };
};

/**
 * Whether a Scrap Out reason has to name who received the scrap.
 *
 * Only a SALE does: it is the one reason where the other party is a buyer the
 * business has to be able to account for. Disposal, transfer, correction and
 * other keep the existing optional free-text "Issued to", which for a transfer
 * names a site, not a buyer.
 */
export const buyerRequiredFor = (reason) => reason === 'SALE';

/**
 * The comparison key for "is this the same buyer?" — case, surrounding space
 * and runs of inner whitespace do not make a different company.
 */
export const buyerNameKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** GSTIN as it is compared: upper-case, no spaces. Empty when not given. */
export const normalizeGstNo = (gstNo) => String(gstNo || '').replace(/\s+/g, '').toUpperCase();

export default {
  SCRAP_QTY_UNITS, SCRAP_QTY_UNIT_CODES, MIN_SCRAP_KG, round2, hasAtMostDecimals, toKg,
  resolveScrapQuantity, buyerRequiredFor, buyerNameKey, normalizeGstNo,
};
