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
};

export default TYPE_META;
