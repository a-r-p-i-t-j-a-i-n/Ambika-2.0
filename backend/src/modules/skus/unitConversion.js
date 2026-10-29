/**
 * Purchase unit → stock unit conversion, configured per SKU.
 *
 * A SKU is STOCKED in its `unit` (the inventory unit every IMS screen, stock
 * row and ledger movement already uses). It may be BOUGHT in another unit:
 *
 *   purchaseUnit              e.g. "BOX"  ('' = bought in the stock unit)
 *   purchaseConversionFactor  stock units in ONE purchase unit, e.g. 25
 *
 *   1 BOX = 25 PCS  →  PO 5 BOX, GRN 5 BOX, stock +125 PCS
 *
 * Indent, PO and GRN quantities, rates and values stay in the unit written on
 * the document. Quantities are converted exactly once, where received goods
 * become stock (Incoming QC completion), using the factor frozen on the GRN line
 * when the GRN was completed — never the SKU's current one — so editing the
 * factor never changes stock or history that already exists.
 *
 * A SKU with no purchase unit converts nothing (factor 1), whatever unit its
 * documents carry: that is how every SKU behaved before this existed.
 *
 * Pure — no database.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Stock quantities are kept to 2 decimals (inventory.service round2). */
const QTY_DECIMALS = 2;
/** The factor itself: enough for 1 BOX = 0.0425 KGS, no more. */
export const FACTOR_MAX_DECIMALS = 4;
export const FACTOR_MAX = 1000000;

// Spellings that mean the same unit. Kilograms follow the ledger (KGS); count
// units follow the purchase forms' own alias table (indentMeta UNIT_ALIASES,
// where PCS / PC / NOS all open as "Pcs"). Every other unit compares by its
// upper-cased text.
const SYNONYMS = {
  KG: 'KGS', KGS: 'KGS', KILO: 'KGS', KILOS: 'KGS', KILOGRAM: 'KGS', KILOGRAMS: 'KGS',
  PC: 'PCS', PCS: 'PCS', PIECE: 'PCS', PIECES: 'PCS', NO: 'PCS', NOS: 'PCS',
  BOX: 'BOX', BOXES: 'BOX',
  CTN: 'CARTON', CARTON: 'CARTON', CARTONS: 'CARTON',
  PKT: 'PACKET', PACKET: 'PACKET', PACKETS: 'PACKET', PACK: 'PACK', PACKS: 'PACK',
};

// Units that hold several pieces. A purchase unit of PIECES converted into a
// stock unit of one of these is the direction written backwards — "1 PCS =
// 15 BOX" for an item bought in boxes of 15 pieces — and is never what the
// client means: IMS counts and issues pieces, the vendor ships packs.
const PACK_UNITS = new Set(['BOX', 'CARTON', 'PACKET', 'PACK', 'CASE', 'BUNDLE', 'BAG', 'DOZEN']);
const isPieceUnit = (u) => unitKey(u) === 'PCS';
const isPackUnit = (u) => PACK_UNITS.has(unitKey(u));

/**
 * Why a purchase-unit / stock-unit pair cannot be meant as entered, or null.
 *
 *   PCS → BOX (any factor)   reversed: the pack is the purchase unit, the piece the stock unit
 *   BOX → PCS, factor < 1    ambiguous: a box holding less than one piece
 *
 * Every other pair (BOX → PCS ≥ 1, BAG → KGS, CARTON → BOX, PCS → KGS …) is
 * taken as written.
 */
export const directionProblem = ({ unit, purchaseUnit, purchaseConversionFactor } = {}) => {
  const stock = String(unit || '').trim();
  const pu = String(purchaseUnit || '').trim();
  const f = Number(purchaseConversionFactor);
  if (!pu || !stock) return null;
  if (isPieceUnit(pu) && isPackUnit(stock)) {
    return `"1 ${pu} = ${Number.isFinite(f) ? f : '?'} ${stock}" is the wrong way round — the Purchase Unit is what the vendor ships `
      + `(${stock}) and the IMS Stock Unit is what the store counts (${pu}). Set Purchase Unit ${stock}, IMS Stock Unit ${pu}, `
      + `and the factor = how many ${pu} are in 1 ${stock} (e.g. 1 ${stock} = 15 ${pu}).`;
  }
  if (isPackUnit(pu) && isPieceUnit(stock) && Number.isFinite(f) && f > 0 && f < 1) {
    return `1 ${pu} must hold at least 1 ${stock} — enter how many ${stock} are in 1 ${pu} (e.g. 15).`;
  }
  return null;
};

/** One spelling per unit, for comparing units — never for display. '' when blank. */
export const unitKey = (u) => {
  const s = String(u ?? '').trim().toUpperCase().replace(/\.$/, '');
  return SYNONYMS[s] || s;
};

/** True when two unit labels name the same unit ("Pcs" = "PCS" = "Nos", "Kg" = "KGS"). */
export const sameUnit = (a, b) => unitKey(a) !== '' && unitKey(a) === unitKey(b);

const decimals = (n) => {
  const s = String(n);
  if (/e-/i.test(s)) return Infinity;
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
};

/** True when `x` is a whole number of hundredths (no stock is lost by keeping it to 2 decimals). */
const isQtyExact = (x) => Math.abs(round2(x) - x) < 1e-9;

/**
 * The conversion a SKU is configured with.
 * @returns {{ converts: boolean, stockUnit: string, purchaseUnit: string, factor: number|null }}
 */
export const skuConversion = (sku = {}) => {
  const stockUnit = String(sku?.unit || '').trim() || 'PCS';
  const purchaseUnit = String(sku?.purchaseUnit || '').trim();
  const factor = Number(sku?.purchaseConversionFactor);
  const converts = !!purchaseUnit && !sameUnit(purchaseUnit, stockUnit) && Number.isFinite(factor) && factor > 0;
  return { converts, stockUnit, purchaseUnit: converts ? purchaseUnit : '', factor: converts ? factor : null };
};

/** "1 BOX = 25 PCS", or '' when the SKU converts nothing. */
export const conversionRuleText = (sku = {}) => {
  const c = skuConversion(sku);
  return c.converts ? `1 ${c.purchaseUnit} = ${c.factor} ${c.stockUnit}` : '';
};

/**
 * Validate and normalise a SKU's conversion settings — the merged state the SKU
 * would have after a save (stored values overlaid with the request).
 *
 *   no purchase unit              → no conversion (factor cleared)
 *   purchase unit = stock unit    → no conversion, when the factor is blank or 1
 *   purchase unit ≠ stock unit    → factor required: positive, finite,
 *                                   ≤ FACTOR_MAX, ≤ FACTOR_MAX_DECIMALS decimals
 *
 * @returns {{ value: { purchaseUnit: string, purchaseConversionFactor: number|null }, errors: string[] }}
 */
export const normalizeConversionConfig = ({ unit, purchaseUnit, purchaseConversionFactor } = {}) => {
  const stockUnit = String(unit || '').trim() || 'PCS';
  const pu = String(purchaseUnit ?? '').trim();
  const raw = purchaseConversionFactor;
  const blankFactor = raw === null || raw === undefined || raw === '';
  const factor = blankFactor ? null : Number(raw);
  const none = { purchaseUnit: '', purchaseConversionFactor: null };

  if (!pu) {
    if (!blankFactor) {
      return { value: none, errors: ['Pick the Purchase Unit the conversion factor applies to, or clear the factor.'] };
    }
    return { value: none, errors: [] };
  }
  if (sameUnit(pu, stockUnit)) {
    if (blankFactor || factor === 1) return { value: none, errors: [] };
    return {
      value: none,
      errors: [`Purchase Unit ${pu} is the same as the Stock Unit ${stockUnit}, so the factor must be 1 — or leave Purchase Unit blank.`],
    };
  }
  if (blankFactor) {
    return { value: none, errors: [`Conversion factor is required: how many ${stockUnit} are in 1 ${pu}?`] };
  }
  if (typeof raw === 'boolean' || !Number.isFinite(factor)) {
    return { value: none, errors: [`Conversion factor must be a number (how many ${stockUnit} are in 1 ${pu}).`] };
  }
  if (factor <= 0) {
    return { value: none, errors: [`Conversion factor must be greater than zero (how many ${stockUnit} are in 1 ${pu}).`] };
  }
  if (factor > FACTOR_MAX) {
    return { value: none, errors: [`Conversion factor cannot exceed ${FACTOR_MAX}.`] };
  }
  if (decimals(factor) > FACTOR_MAX_DECIMALS) {
    return { value: none, errors: [`Conversion factor can have at most ${FACTOR_MAX_DECIMALS} decimal places.`] };
  }
  const reversed = directionProblem({ unit: stockUnit, purchaseUnit: pu, purchaseConversionFactor: factor });
  if (reversed) return { value: none, errors: [reversed] };
  return { value: { purchaseUnit: pu, purchaseConversionFactor: factor }, errors: [] };
};

/** Why a document line's unit cannot be converted. */
export const UNIT_PROBLEM = {
  INCOMPATIBLE_UNIT: 'INCOMPATIBLE_UNIT',
  REVERSED_CONFIG: 'REVERSED_CONFIG', // the SKU's own conversion is written backwards

};

/**
 * How a document line (PO / GRN) in `lineUnit` converts into the SKU's stock.
 *
 *   SKU without a purchase unit  → factor 1, nothing recorded (today's behaviour)
 *   line in the purchase unit    → the SKU's factor
 *   line in the stock unit       → factor 1 (e.g. a PO raised before the
 *                                  purchase unit was configured)
 *   any other unit               → problem: it cannot be converted
 *
 * @returns {{ converts: boolean, factor: number, stockUnit: string, rule: string, problem: string|null }}
 */
export const lineConversion = (sku, lineUnit) => {
  const c = skuConversion(sku);
  const base = { converts: false, factor: 1, stockUnit: c.stockUnit, rule: '', problem: null };
  if (!sku || !c.converts) return base;
  // A configuration saved the wrong way round (1 PCS = 15 BOX) is refused,
  // never converted: it would multiply pieces into boxes.
  if (directionProblem(sku)) return { ...base, problem: UNIT_PROBLEM.REVERSED_CONFIG, rule: conversionRuleText(sku) };
  if (sameUnit(lineUnit, c.purchaseUnit)) {
    return { ...base, converts: true, factor: c.factor, rule: conversionRuleText(sku) };
  }
  if (sameUnit(lineUnit, c.stockUnit)) return base;
  return { ...base, problem: UNIT_PROBLEM.INCOMPATIBLE_UNIT, rule: conversionRuleText(sku) };
};

/** The refusal for a line whose unit is neither the SKU's purchase unit nor its stock unit. */
export const incompatibleUnitMessage = (itemName, lineUnit, sku) => {
  const c = skuConversion(sku);
  if (directionProblem(sku)) {
    return `"${itemName}": SKU Master's unit conversion (${conversionRuleText(sku)}) is the wrong way round, so it cannot be used. `
      + 'Open the SKU in SKU Master and set the Purchase Unit to the pack and the IMS Stock Unit to the piece.';
  }
  return `"${itemName}" is in ${String(lineUnit || '').trim() || 'no unit'}, but SKU Master buys it in ${c.purchaseUnit} `
    + `(${conversionRuleText(sku)}) and stocks it in ${c.stockUnit}. Use ${c.purchaseUnit} or ${c.stockUnit} for this item.`;
};

/**
 * `qty` document units in stock units. Stock is kept to 2 decimals, so a result
 * that needs more (2.5 PCS per BOX × 0.33 BOX = 0.825 PCS) is reported as
 * inexact instead of being rounded — rounding would create or lose stock.
 *
 * @returns {{ stockQty: number, exact: boolean }}
 */
export const toStockQty = (qty, factor) => {
  const f = Number(factor) > 0 ? Number(factor) : 1;
  const raw = (Number(qty) || 0) * f;
  // Products of two short decimals carry float noise (0.1 × 3 = 0.30000000000000004).
  const clean = Number(raw.toFixed(QTY_DECIMALS + FACTOR_MAX_DECIMALS + 2));
  return { stockQty: round2(clean), exact: isQtyExact(clean) };
};

/** The refusal for a quantity that does not convert into a whole number of hundredths. */
export const inexactQtyMessage = (itemName, qty, lineUnit, factor, stockUnit) => {
  const raw = Number(((Number(qty) || 0) * Number(factor)).toFixed(8));
  return `"${itemName}": ${qty} ${lineUnit} × ${factor} = ${raw} ${stockUnit}, which stock (kept to 2 decimals) cannot hold `
    + 'without rounding. Adjust the quantity so it converts exactly.';
};

/**
 * Cost per stock unit for `value` spread over `stockQty`, kept to 6 decimals so
 * stockQty × cost reproduces the received value (₹100 per BOX of 24 → ₹4.166667
 * per PCS; 120 PCS × that = ₹500.00). 0 when there is no quantity.
 */
export const stockUnitCost = (value, stockQty) => (Number(stockQty) > 0
  ? Math.round((Number(value) / Number(stockQty)) * 1e6) / 1e6
  : 0);
