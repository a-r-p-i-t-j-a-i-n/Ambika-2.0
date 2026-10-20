import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

// ── Item classification ──────────────────────────────────────────────
// The top-level "kind" of an item. This is the primary axis the Price
// Tracker navigates by:
//   FINISHED_GOOD — what the company SELLS (jars, bowls) → tracked as SELLING price
//   RAW_MATERIAL  — steel / copper sheets the company BUYS → tracked as a buy price
//   CONSUMABLE    — buffs, brushes, bearings, belts, oils the company BUYS
//   PACKING       — boxes, partitions, stickers, tape the company BUYS
//   CIRCLE        — cut metal circles (reserved; not price-tracked today)
//   SCRAP         — metal offcuts left by cutting; held in kilograms, sold or
//                   disposed of, never bought (blocked in purchase-item-guard)
// `category` is the sub-group WITHIN an itemType (e.g. CONSUMABLE → "Bearing").
export const ITEM_TYPES = [
  'FINISHED_GOOD', 'RAW_MATERIAL', 'CONSUMABLE', 'PACKING', 'CIRCLE',
  // Purchase FMS purchasable categories (additive)
  'PACKAGING', 'CHEMICAL', 'INK', 'BUTTER_PAPER', 'SUBLIMATION_PAPER',
  'STATIONERY', 'SERVICE', 'SPARE_PART', 'JOB_WORK', 'WIP_MATERIAL',
  // Scrap IMS (additive). Scrap is a by-product of cutting, never something the
  // company purchases — purchase-item-guard blocks it from every procurement
  // flow, the same way it blocks finished goods.
  'SCRAP',
];

// Which item types are bought from suppliers (buy side) vs sold to customers.
export const BUY_SIDE_ITEM_TYPES = [
  'RAW_MATERIAL', 'CONSUMABLE', 'PACKING', 'CIRCLE',
  'PACKAGING', 'CHEMICAL', 'INK', 'BUTTER_PAPER', 'SUBLIMATION_PAPER',
  'STATIONERY', 'SERVICE', 'SPARE_PART', 'JOB_WORK', 'WIP_MATERIAL',
];

/**
 * The two item types Raw Material IMS owns: coils and the circles cut from
 * them. Lives here beside the other classifications so any module that has to
 * ask "is this line Raw Material?" reads the same list - RM IMS itself, and the
 * GRN, which posts RM lines only when the operator opts in.
 */
export const RM_ITEM_TYPES = ['RAW_MATERIAL', 'CIRCLE'];

// Item types that must NEVER enter Purchase FMS (produced internally, sold via O2D).
// FG / SALE_PRODUCT / READY_STOCK_PRODUCT are defensive aliases for legacy or imported data.
export const FG_BLOCKED_ITEM_TYPES = ['FINISHED_GOOD', 'FG', 'SALE_PRODUCT', 'READY_STOCK_PRODUCT'];

// ── Inventory destination of a received purchase ────────────────────────────
// Where a GRN line's stock lands is DERIVED from itemType, never stored on the
// SKU as a second classification: every IMS screen already scopes its listing by
// itemType, so a separate field could post stock to one module and list it in
// another. All modules share one ledger (InventoryStock / InventoryMovement);
// the destination decides the warehouse and which screen lists the item.
//
//   RM_IMS      Raw Material IMS — posts at the GRN's "Received At" (PLG01 / JW001)
//   CP_IMS      Consumable & Packaging IMS — posts at the GRN's own store (MAIN)
//   MAIN_STORE  posts at the GRN's own store (MAIN) but is listed by no IMS
//               screen — the existing behaviour for chemicals, ink, spares …
export const INVENTORY_DESTINATION = {
  RM_IMS: 'RM_IMS',
  CP_IMS: 'CP_IMS',
  MAIN_STORE: 'MAIN_STORE',
};

/** The item types Consumable & Packaging IMS lists (its single source of truth). */
export const CP_IMS_ITEM_TYPES = ['CONSUMABLE', 'PACKING', 'PACKAGING'];

/** Purchasable, stocked at the GRN's store, outside every IMS listing. */
export const MAIN_STORE_ITEM_TYPES = [
  'CHEMICAL', 'INK', 'BUTTER_PAPER', 'SUBLIMATION_PAPER', 'STATIONERY', 'SPARE_PART', 'WIP_MATERIAL',
];

/**
 * Buy-side, but not material: bought through internal-service indents, never
 * received on a GRN. Blocked from material GRNs only — NOT from the shared
 * purchase-item-guard, which also guards the indents that legitimately use them.
 */
export const NON_MATERIAL_ITEM_TYPES = ['SERVICE', 'JOB_WORK'];

/** Destination for an itemType, or null when a GRN cannot route it. */
export const inventoryDestinationOf = (itemType) => {
  const t = String(itemType || '').trim().toUpperCase();
  if (RM_ITEM_TYPES.includes(t)) return INVENTORY_DESTINATION.RM_IMS;
  if (CP_IMS_ITEM_TYPES.includes(t)) return INVENTORY_DESTINATION.CP_IMS;
  if (MAIN_STORE_ITEM_TYPES.includes(t)) return INVENTORY_DESTINATION.MAIN_STORE;
  return null;
};

const SkuSchema = new Schema({
  ...baseSchemaFields,

  clientId: { type: Schema.Types.ObjectId, ref: 'Party' },

  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true }, // Client's specific SKU code

  // Top-level classification — see ITEM_TYPES above. Defaults to FINISHED_GOOD
  // so every pre-existing SKU stays on the sell side until the backfill
  // migration reclassifies it.
  itemType: { type: String, enum: ITEM_TYPES, default: 'FINISHED_GOOD', index: true },
  category: { type: String, trim: true }, // sub-group within the itemType
  aliases: [{ type: String, trim: true }],

  // "Converted Item Name (For Resale)" — the client's Excel master column.
  // The name the item is sold on as, when it is resold under a different
  // description from the one it is bought/stocked under (CO-BS-50-00
  // "Brush - 5"" resells as "1.75" Brush"). Master data: it describes the
  // item's resale identity, so it lives here and nowhere else — IMS reads it
  // off the SKU rather than keeping its own copy.
  // Optional and defaulted, so SKUs written before this field existed keep
  // loading and saving untouched; no migration needed.
  // An explicit null from a client is stored as '' rather than null, so every
  // reader gets a string and never has to guard for it.
  convertedItemNameForResale: { type: String, trim: true, default: '', set: (v) => (v == null ? '' : v) },

  unit: { type: String, default: 'PCS' }, // e.g., PCS, KGS, MTR, LTR
  pcsPerBox: { type: Number, default: 1, min: 1 },
  weightPerBox: { type: Number, default: 0, min: 0 }, // Weight in KGs
  weightPerPc: { type: Number, default: 0, min: 0 },
  
  leadDays: { type: Number, default: 7, min: 0 },

  // ── Pricing (v2) ─────────────────────────────────────────────────
  // sellingPrice and rmCost are DENORMALISED caches of the latest LIVE
  // PriceRevision (effectiveFrom <= today). They keep all existing screens
  // that read SKU.sellingPrice working. The source of truth is PriceRevision.
  sellingPrice:        { type: Number, default: 0, min: 0 },
  sellingPriceFrom:    { type: Date,   default: null },
  rmCost:              { type: Number, default: 0, min: 0 },
  rmCostFrom:          { type: Date,   default: null },
  gstRate:             { type: Number, default: 18, min: 0, max: 28 },
  marginFloor:         { type: Number, default: 0, min: 0 },
  // Sticky note shown on the Pricing Master row (independent of per-revision reason).
  // Used for the "Remarks" column in the Current SKU Prices export sheet.
  pricingRemarks:      { type: String, default: '', trim: true, maxlength: 500 },
  
  dimensions: {
    length: { type: Number },
    width: { type: Number },
    height: { type: Number },
    unit: { type: String, default: 'CM' } // e.g., CM, INCH
  },
  packingDetails: { type: String }, // Detailed packing instructions
  
}, baseSchemaOptions);

// Indexes
SkuSchema.index({ code: 1 }, { unique: true });
SkuSchema.index({ clientId: 1, code: 1 });
SkuSchema.index({ name: 1 });
SkuSchema.index({ itemType: 1, category: 1 }); // fast Price-Tracker kind + sub-group filter
SkuSchema.index({ name: 'text', code: 'text', category: 'text', aliases: 'text' });
SkuSchema.index({ companyId: 1 });

export default model('SKU', SkuSchema);
