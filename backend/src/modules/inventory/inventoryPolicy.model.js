import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Inventory Policy — the IMS planning parameters for a stocked item.
 *
 * One row per SKU. Mirrors the client's "list item" sheet (average daily
 * consumption, lead time, safety factor, MOQ, max level, opening stock,
 * material in transit, converted resale name). On-hand stock itself lives in
 * InventoryStock; this only holds the planning inputs used to compute reorder
 * levels, days-of-cover and the stock projection.
 *
 * Derived (NOT stored — computed in ims.service):
 *   leadTimeDemand = avgDailyConsumption × leadDays
 *   maxLevel(target) = avgDailyConsumption × leadDays × safetyFactor   (sheet rule)
 *   reorderPoint   = leadTimeDemand
 */
const inventoryPolicySchema = new Schema({
  ...baseSchemaFields,

  skuId:   { type: Schema.Types.ObjectId, ref: 'SKU', required: true, unique: true, index: true },
  // Denormalized for fast list rendering without populating the SKU.
  skuCode:  { type: String, trim: true, uppercase: true, default: '' },
  skuName:  { type: String, trim: true, default: '' },
  itemType: { type: String, trim: true, default: '' },  // CONSUMABLE | PACKING | PACKAGING
  category: { type: String, trim: true, default: '' },
  unit:     { type: String, trim: true, default: 'PCS' },

  averageDailyConsumption: { type: Number, default: 0, min: 0 }, // ADC
  leadDays:        { type: Number, default: 16, min: 0 },        // indent → receipt
  safetyFactor:    { type: Number, default: 1.5, min: 0 },       // buffer multiplier
  moq:             { type: Number, default: 0, min: 0 },         // min order qty
  // Order-up-to / max level. If left 0 we derive ADC×lead×safetyFactor at read time.
  maxLevel:        { type: Number, default: 0, min: 0 },
  materialInTransit: { type: Number, default: 0, min: 0 },       // ordered, not yet received

  openingStock:    { type: Number, default: 0, min: 0 },         // the seeded opening balance
  convertedItemName: { type: String, trim: true, default: '' },  // resale alias

  remarks: { type: String, trim: true, default: '' },
}, baseSchemaOptions);

inventoryPolicySchema.index({ itemType: 1, category: 1 });
inventoryPolicySchema.index({ skuCode: 1 });

const InventoryPolicy = model('InventoryPolicy', inventoryPolicySchema);
export default InventoryPolicy;
