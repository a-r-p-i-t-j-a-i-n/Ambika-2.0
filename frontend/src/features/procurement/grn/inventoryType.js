/**
 * GRN Inventory Type — which inventory module the received stock lands in, one
 * per GRN. Mirrors GRN_INVENTORY_TYPE on the server (which also enforces it).
 * Finished Goods are produced in-house and never purchased, so they are not an
 * option. No React here — plain helpers shared by the GRN form, the Complete GRN
 * dialog and the GRN page.
 */
export const INVENTORY_TYPE_OPTIONS = [
  { value: 'RM', label: 'Raw Material (RM)' },
  { value: 'CONSUMABLE_PACKAGING', label: 'Consumable & Packaging' },
];

export const INVENTORY_TYPE_HELP = 'Select the inventory type for the received material.';

export const inventoryTypeLabel = (v) => INVENTORY_TYPE_OPTIONS.find((o) => o.value === v)?.label || '';

/**
 * Received lines that do not belong to the chosen type (same rule as the server):
 * RM needs every received line to be Raw Material / Circle; Consumable &
 * Packaging allows none. `isRm(line)` → true / false; lines without a SKU are not judged.
 */
export const inventoryTypeConflicts = (lines = [], inventoryType, isRm) => lines
  .filter((l) => Number(l.receivedQty) > 0 && l.skuId)
  .filter((l) => (inventoryType === 'RM' ? !isRm(l) : inventoryType === 'CONSUMABLE_PACKAGING' && isRm(l)));

export const inventoryTypeConflictText = (conflicts, inventoryType) => {
  const names = conflicts.map((l) => `"${l.itemName}"`).join(', ');
  const other = inventoryType === 'RM' ? 'Consumable & Packaging' : 'Raw Material (RM)';
  const kind = inventoryType === 'RM' ? 'Raw Material' : 'Consumable & Packaging';
  return `${names} ${conflicts.length > 1 ? 'are' : 'is'} not ${kind}. Set ${conflicts.length > 1 ? 'their' : 'its'} received qty to 0 and receive ${conflicts.length > 1 ? 'them' : 'it'} on a separate GRN with Inventory Type "${other}".`;
};
