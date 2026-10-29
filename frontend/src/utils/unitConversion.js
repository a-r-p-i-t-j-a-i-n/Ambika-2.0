/**
 * Purchase unit → stock unit, as SKU Master configures it ("1 BOX = 25 PCS").
 *
 * Display-side mirror of backend/src/modules/skus/unitConversion.js. The server
 * decides and freezes every conversion; screens use this only to show the rule
 * and the stock figure a quantity will become, so the user can check it.
 */

const SYNONYMS = {
  KG: 'KGS', KGS: 'KGS', KILO: 'KGS', KILOS: 'KGS', KILOGRAM: 'KGS', KILOGRAMS: 'KGS',
  PC: 'PCS', PCS: 'PCS', PIECE: 'PCS', PIECES: 'PCS', NO: 'PCS', NOS: 'PCS',
  BOX: 'BOX', BOXES: 'BOX',
  CTN: 'CARTON', CARTON: 'CARTON', CARTONS: 'CARTON',
  PKT: 'PACKET', PACKET: 'PACKET', PACKETS: 'PACKET', PACK: 'PACK', PACKS: 'PACK',
};
const PACK_UNITS = new Set(['BOX', 'CARTON', 'PACKET', 'PACK', 'CASE', 'BUNDLE', 'BAG', 'DOZEN']);

const unitKey = (u) => {
  const s = String(u ?? '').trim().toUpperCase().replace(/\.$/, '');
  return SYNONYMS[s] || s;
};

/** True when two labels name one unit ("Pcs" = "PCS" = "Nos", "Kg" = "KGS"). */
export const sameUnit = (a, b) => unitKey(a) !== '' && unitKey(a) === unitKey(b);

/**
 * Why a purchase-unit → stock-unit pair cannot be meant as entered, or ''.
 * Mirrors the server (skus/unitConversion.js directionProblem): pieces bought
 * and packs stocked is the rule written backwards; a pack holding under one
 * piece is ambiguous.
 */
export const directionProblem = ({ unit, purchaseUnit, purchaseConversionFactor } = {}) => {
  const stock = String(unit || '').trim();
  const pu = String(purchaseUnit || '').trim();
  const f = Number(purchaseConversionFactor);
  if (!pu || !stock) return '';
  if (unitKey(pu) === 'PCS' && PACK_UNITS.has(unitKey(stock))) {
    return `Wrong way round — the vendor ships ${stock}, the store counts ${pu}. Set Purchase Unit ${stock} and IMS Stock Unit ${pu} (e.g. 1 ${stock} = 15 ${pu}).`;
  }
  if (PACK_UNITS.has(unitKey(pu)) && unitKey(stock) === 'PCS' && Number.isFinite(f) && f > 0 && f < 1) {
    return `1 ${pu} must hold at least 1 ${stock} — enter how many ${stock} are in 1 ${pu}.`;
  }
  return '';
};

/** { converts, stockUnit, purchaseUnit, factor } for a SKU (lookup row or master record). */
export const skuConversion = (sku) => {
  const stockUnit = String(sku?.unit || '').trim() || 'PCS';
  const purchaseUnit = String(sku?.purchaseUnit || '').trim();
  const factor = Number(sku?.purchaseConversionFactor);
  const converts = !!purchaseUnit && !sameUnit(purchaseUnit, stockUnit) && Number.isFinite(factor) && factor > 0;
  return { converts, stockUnit, purchaseUnit: converts ? purchaseUnit : '', factor: converts ? factor : null };
};

/** "1 BOX = 25 PCS", or '' when the SKU is bought in its stock unit. */
export const conversionRule = (sku) => {
  const c = skuConversion(sku);
  return c.converts ? `1 ${c.purchaseUnit} = ${c.factor} ${c.stockUnit}` : '';
};

/** A SKU whose saved conversion is the wrong way round: the warning to show, or ''. The server refuses its lines. */
export const reversedRuleWarning = (sku) => (skuConversion(sku).converts && directionProblem(sku)
  ? `${conversionRule(sku)} is the wrong way round in SKU Master — fix it there (Purchase Unit = the pack, IMS Stock Unit = the piece)`
  : '');

/** The unit a SKU is bought in: its purchase unit, else its stock unit. */
export const purchaseUnitOf = (sku) => {
  const c = skuConversion(sku);
  return c.converts ? c.purchaseUnit : String(sku?.unit || '').trim();
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The stock figure `qty` in `lineUnit` becomes for this SKU, e.g. 5 BOX → 125
 * PCS. null when nothing converts (a same-unit SKU, or a line already in the
 * stock unit).
 */
export const stockEquivalent = (sku, lineUnit, qty) => {
  const c = skuConversion(sku);
  if (!c.converts || !sameUnit(lineUnit, c.purchaseUnit)) return null;
  return { qty: round2(Number(((Number(qty) || 0) * c.factor).toFixed(8))), unit: c.stockUnit, rule: conversionRule(sku) };
};

/** "= 125 PCS" for a document line that froze its conversion (GRN / QC line fields). */
export const frozenStockText = (line, qty) => {
  const f = Number(line?.conversionFactor);
  if (!(f > 0) || !line?.stockUnit) return '';
  return `= ${round2(Number(((Number(qty) || 0) * f).toFixed(8)))} ${line.stockUnit}`;
};

/** "1 BOX = 25 PCS" from a document line's frozen fields. */
export const frozenRule = (line) => {
  const f = Number(line?.conversionFactor);
  return f > 0 && line?.stockUnit ? `1 ${line.unit} = ${f} ${line.stockUnit}` : '';
};
