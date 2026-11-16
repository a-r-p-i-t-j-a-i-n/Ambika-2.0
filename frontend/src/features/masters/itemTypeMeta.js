/**
 * SKU item-type metadata — the single source of truth for an item's
 * classification label and colour.
 *
 * It lives in its own dependency-free module so any screen can import the map
 * without pulling in the SKU Master screen (and MUI DataGrid) behind it.
 * Consumed by SkusList (SKU Master) and by IMS -> Consumables & Packaging, so a
 * classification always reads and looks the same wherever it is shown.
 *
 * Keys are SKU.itemType values from backend/src/modules/skus/sku.model.js.
 */
export const TYPE_META = {
  FINISHED_GOOD: { label: 'Finished Good', color: '#0f766e' },
  RAW_MATERIAL:  { label: 'Raw Material',  color: '#b45309' },
  CONSUMABLE:    { label: 'Consumable',    color: '#1d4ed8' },
  PACKING:       { label: 'Packing',       color: '#7c3aed' },
  CIRCLE:        { label: 'Circle',        color: '#64748b' },
  // Further buy-side types (Purchase FMS). Before these were listed every one of
  // them rendered as "Finished Good" in the SKU Master.
  PACKAGING:         { label: 'Packaging',         color: '#7c3aed' },
  CHEMICAL:          { label: 'Chemical',          color: '#475569' },
  INK:               { label: 'Ink',               color: '#475569' },
  BUTTER_PAPER:      { label: 'Butter Paper',      color: '#475569' },
  SUBLIMATION_PAPER: { label: 'Sublimation Paper', color: '#475569' },
  STATIONERY:        { label: 'Stationery',        color: '#475569' },
  SPARE_PART:        { label: 'Spare Part',        color: '#475569' },
  WIP_MATERIAL:      { label: 'WIP Material',      color: '#475569' },
  SERVICE:           { label: 'Service',           color: '#9f1239' },
  JOB_WORK:          { label: 'Job Work',          color: '#9f1239' },
  SCRAP:             { label: 'Scrap',             color: '#78716c' },
};

/**
 * Where a purchased SKU of each type is stocked when its GRN's QC completes —
 * mirrors inventoryDestinationOf (backend sku.model.js), which decides it.
 */
export const TYPE_DESTINATION_HINT = {
  FINISHED_GOOD: 'Sold, never purchased — blocked from Purchase FMS.',
  RAW_MATERIAL: 'Purchased stock goes to RM IMS, at the GRN\'s Received At.',
  CIRCLE: 'Purchased stock goes to RM IMS, at the GRN\'s Received At.',
  CONSUMABLE: 'Purchased stock goes to Consumable & Packaging IMS.',
  PACKING: 'Purchased stock goes to Consumable & Packaging IMS.',
  PACKAGING: 'Purchased stock goes to Consumable & Packaging IMS.',
  SERVICE: 'Not material — bought through internal-service indents, never on a GRN.',
  JOB_WORK: 'Not material — bought through internal-service indents, never on a GRN.',
};
export const typeDestinationHint = (t) => TYPE_DESTINATION_HINT[t]
  || 'Purchased stock goes to the main store (not listed in an IMS screen).';

// ── "Other" grouping (UI only) ───────────────────────────────────────────────
// "Other" is NOT a stored itemType. It groups every existing type outside the
// five primary ones, so the SKU Master can filter them and the registration
// form can offer a short top-level list. An "Other" SKU is always saved with
// one of the real enum values below, so where its purchased stock is posted
// (inventoryDestinationOf, backend sku.model.js) is exactly what it was before.
export const OTHER_KEY = 'OTHER';

/** The five top-level item types, in SKU Master tab order. */
export const PRIMARY_ITEM_TYPES = ['FINISHED_GOOD', 'RAW_MATERIAL', 'CONSUMABLE', 'PACKING', 'CIRCLE'];

/** Registration dropdown: the five primary types plus "Other". */
export const PRIMARY_TYPE_OPTIONS = [
  { value: 'FINISHED_GOOD', label: 'Finished Goods' },
  { value: 'RAW_MATERIAL',  label: 'Raw Material' },
  { value: 'CONSUMABLE',    label: 'Consumables' },
  { value: 'PACKING',       label: 'Packing' },
  { value: 'CIRCLE',        label: 'Circles' },
  { value: OTHER_KEY,       label: 'Other' },
];

/**
 * The "Other" types a person can register by hand — the same list the form
 * offered before, minus the five primary types. Scrap stays out: Scrap IMS
 * creates those SKUs, never the SKU Master.
 */
export const OTHER_ITEM_TYPES = [
  'PACKAGING', 'CHEMICAL', 'INK', 'BUTTER_PAPER', 'SUBLIMATION_PAPER', 'STATIONERY',
  'SPARE_PART', 'WIP_MATERIAL', 'SERVICE', 'JOB_WORK',
];

/** Every known type the "Other" filter lists (includes Scrap). */
export const OTHER_FILTER_ITEM_TYPES = Object.keys(TYPE_META)
  .filter((t) => !PRIMARY_ITEM_TYPES.includes(t));

/** True when the stored itemType belongs to the "Other" group (or is the bare OTHER choice). */
export const isOtherItemType = (t) => t === OTHER_KEY
  || (!!t && !PRIMARY_ITEM_TYPES.includes(t));

export default TYPE_META;
