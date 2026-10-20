/**
 * Where a received GRN line's stock lands — derived from the SKU master's Item
 * Type. DISPLAY ONLY: mirrors inventoryDestinationOf in
 * backend/src/modules/skus/sku.model.js, which is the authority. The server
 * re-derives every destination and never accepts one from the screen.
 * No React here — plain helpers shared by the GRN form, dialog and page.
 */
export const RM_TYPES = ['RAW_MATERIAL', 'CIRCLE'];
export const CP_TYPES = ['CONSUMABLE', 'PACKING', 'PACKAGING'];
export const MAIN_STORE_TYPES = ['CHEMICAL', 'INK', 'BUTTER_PAPER', 'SUBLIMATION_PAPER', 'STATIONERY', 'SPARE_PART', 'WIP_MATERIAL'];
export const NON_MATERIAL_TYPES = ['SERVICE', 'JOB_WORK'];
const NOT_PURCHASABLE = ['FINISHED_GOOD', 'FG', 'SALE_PRODUCT', 'READY_STOCK_PRODUCT', 'SCRAP'];

export const DESTINATION_META = {
  RM_IMS: { label: 'RM IMS', color: '#b45309' },
  CP_IMS: { label: 'C&P IMS', color: '#1d4ed8' },
  MAIN_STORE: { label: 'Main store', color: '#475569' },
};

export const destinationOf = (itemType) => {
  const t = String(itemType || '').toUpperCase();
  if (RM_TYPES.includes(t)) return 'RM_IMS';
  if (CP_TYPES.includes(t)) return 'CP_IMS';
  if (MAIN_STORE_TYPES.includes(t)) return 'MAIN_STORE';
  return null;
};

/** Why a line with this Item Type cannot be received on a GRN, or '' when it can (or is not known yet). */
export const routingProblemOf = (itemType) => {
  const t = String(itemType || '').toUpperCase();
  if (!t) return '';
  if (NON_MATERIAL_TYPES.includes(t)) return 'Service / Job Work — not received on a GRN';
  if (NOT_PURCHASABLE.includes(t)) return 'Finished Goods / Scrap — not purchasable';
  if (!destinationOf(t)) return 'No inventory destination — fix its Item Type in SKU Master';
  return '';
};

/** "RM IMS · JW001", "C&P IMS · MAIN", "Main store · MAIN" — or the label alone when the location is open. */
export const destinationText = (destination, warehouse) => {
  const m = DESTINATION_META[destination];
  if (!m) return '';
  return warehouse ? `${m.label} · ${warehouse}` : m.label;
};
