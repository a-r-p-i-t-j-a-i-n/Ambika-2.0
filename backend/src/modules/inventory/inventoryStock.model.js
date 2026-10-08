import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Inventory Stock — current on-hand balance per SKU per warehouse.
 *
 * This is a DERIVED cache: it is only ever mutated by `inventory.service`
 * alongside an append-only InventoryMovement row, so the on-hand quantity
 * always equals the sum of movement deltas. Never mutate it directly.
 *
 * Warehouse is a simple string defaulting to MAIN so callers (e.g. GRN) are
 * not forced to pick one — multi-warehouse can be layered on later.
 */
export const DEFAULT_WAREHOUSE = 'MAIN';

/**
 * "Received At" — the two physical locations Raw Material is received at.
 *
 * Not a new concept: the client's sheet records a "Received At" against every
 * RM receipt and it only ever holds these two values, which the RM screens
 * already map onto this engine's `warehouse` field (see rmImsMeta
 * RECEIVED_AT_OPTIONS). They live here so the GRN can reuse the SAME list and
 * the same default instead of inventing a second definition of the field.
 *
 * Deliberately NOT the same thing as a GRN's own `warehouse` (MAIN): that
 * stays untouched and keeps carrying non-RM lines. Nothing maps MAIN onto one
 * of these, and no historical row is rewritten.
 *
 * ScrapRecord carries an identical two-value list as SCRAP_LOCATIONS. It is
 * left exactly as it is — scrap is a different module with its own enum, and
 * folding the two together is a refactor this change has no reason to make.
 */
export const RM_RECEIVED_AT_LOCATIONS = ['PLG01', 'JW001'];
export const DEFAULT_RM_RECEIVED_AT = 'PLG01';

const inventoryStockSchema = new Schema({
  ...baseSchemaFields,

  skuId:   { type: Schema.Types.ObjectId, ref: 'SKU', required: true, index: true },
  skuCode: { type: String, trim: true, uppercase: true, default: '' },
  skuName: { type: String, trim: true, default: '' },
  unit:    { type: String, trim: true, default: 'PCS' },

  warehouse: { type: String, trim: true, default: DEFAULT_WAREHOUSE, index: true },

  qtyOnHand:   { type: Number, default: 0 },          // can dip below 0 only if allowNegative
  qtyReserved: { type: Number, default: 0, min: 0 },  // reserved (future dispatch use)

  // ── Secondary measure (Raw Material circles) ────────────────────────────────
  // A circle is STOCKED and PLANNED in pieces (that is what the client's sheet
  // adds up), but it is also WEIGHED: a conversion and a circle inward both
  // record kilograms alongside the piece count. Carrying the weight in its own
  // field is what stops the two ever being added together — the bug this
  // replaces let a kilogram figure land in `qtyOnHand` whenever a piece count
  // was missing.
  //
  // It is a RECORD, not a second balance to plan against: circles are issued in
  // pieces only, so this figure drifts low as stock goes out and must never be
  // used for Max Level, Available % or cover. Additive and defaulted, so every
  // existing row and every non-RM caller is completely unaffected.
  qtyOnHandKg: { type: Number, default: 0 },

  avgCost:  { type: Number, default: 0, min: 0 },     // weighted-average cost
  lastCost: { type: Number, default: 0, min: 0 },

  lastMovementAt: { type: Date, default: null },
}, baseSchemaOptions);

inventoryStockSchema.virtual('qtyAvailable').get(function () {
  return Math.max(0, (this.qtyOnHand || 0) - (this.qtyReserved || 0));
});
inventoryStockSchema.virtual('stockValue').get(function () {
  return Math.round((this.qtyOnHand || 0) * (this.avgCost || 0) * 100) / 100;
});
inventoryStockSchema.set('toJSON', { virtuals: true });
inventoryStockSchema.set('toObject', { virtuals: true });

// One stock row per SKU per warehouse.
inventoryStockSchema.index({ skuId: 1, warehouse: 1 }, { unique: true });
inventoryStockSchema.index({ skuCode: 1 });

const InventoryStock = model('InventoryStock', inventoryStockSchema);
export default InventoryStock;
