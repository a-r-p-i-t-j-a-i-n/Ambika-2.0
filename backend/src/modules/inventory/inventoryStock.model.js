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

const inventoryStockSchema = new Schema({
  ...baseSchemaFields,

  skuId:   { type: Schema.Types.ObjectId, ref: 'SKU', required: true, index: true },
  skuCode: { type: String, trim: true, uppercase: true, default: '' },
  skuName: { type: String, trim: true, default: '' },
  unit:    { type: String, trim: true, default: 'PCS' },

  warehouse: { type: String, trim: true, default: DEFAULT_WAREHOUSE, index: true },

  qtyOnHand:   { type: Number, default: 0 },          // can dip below 0 only if allowNegative
  qtyReserved: { type: Number, default: 0, min: 0 },  // reserved (future dispatch use)

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
