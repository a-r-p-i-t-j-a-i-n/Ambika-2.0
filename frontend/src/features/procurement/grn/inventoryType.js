/**
 * LEGACY GRN Inventory Type — the manual, one-per-GRN choice that was retired
 * when GRN lines started routing automatically from the SKU master (see
 * inventoryDestination.js). Kept only so historical GRNs still show what was
 * chosen on them. No React here.
 */
export const INVENTORY_TYPE_OPTIONS = [
  { value: 'RM', label: 'Raw Material (RM)' },
  { value: 'CONSUMABLE_PACKAGING', label: 'Consumable & Packaging' },
];

export const inventoryTypeLabel = (v) => INVENTORY_TYPE_OPTIONS.find((o) => o.value === v)?.label || '';
