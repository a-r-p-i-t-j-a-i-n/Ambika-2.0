import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Coil → Circle conversion (the factory's blanking/cutting step).
 *
 * A raw-material COIL is consumed and cut into one or more CIRCLE SKUs. The
 * difference between the coil weight in and the total circle weight out is
 * SCRAP; yield% = circle weight / coil weight. Each conversion also writes the
 * matching inventory movements (coil CONVERT_OUT, each circle CONVERT_IN) so the
 * RM IMS on-hand always reconciles with the ledger.
 *
 * Mirrors the client's "Scrap Summary" + "Circle In/Out" sheets.
 */
const producedCircleSchema = new Schema({
  circleSkuId:   { type: Schema.Types.ObjectId, ref: 'SKU' },
  circleSkuCode: { type: String, trim: true, uppercase: true, default: '' },
  circleSkuName: { type: String, trim: true, default: '' },
  sizeLabel:     { type: String, trim: true, default: '' },     // e.g. "Cu - 0.8mm - 8.50""
  pcs:           { type: Number, default: 0, min: 0 },          // circles produced (pieces)
  weightKg:      { type: Number, default: 0, min: 0 },          // weight of those circles
  movementId:     { type: Schema.Types.ObjectId, ref: 'InventoryMovement' },
  movementNumber: { type: String, trim: true, default: '' },
}, { _id: true });

const coilConversionSchema = new Schema({
  ...baseSchemaFields,

  conversionNumber: { type: String, unique: true, trim: true, index: true }, // RMC-001/26-27
  conversionDate:   { type: Date, default: Date.now, index: true },

  // The coil consumed.
  batchNo:     { type: String, trim: true, default: '', index: true },
  coilSkuId:   { type: Schema.Types.ObjectId, ref: 'SKU', required: true, index: true },
  coilSkuCode: { type: String, trim: true, uppercase: true, default: '' },
  coilSkuName: { type: String, trim: true, default: '' },
  coilWeightKg:{ type: Number, required: true, min: 0 },        // weight in (coil)
  rate:        { type: Number, default: 0, min: 0 },            // ₹/kg of the coil

  circles:     [producedCircleSchema],

  // Derived & stored for the summary view.
  circlesWeightKg: { type: Number, default: 0, min: 0 },        // Σ circle weight
  scrapKg:         { type: Number, default: 0 },                // coil − circles (can be ~0)
  yieldRatioPct:   { type: Number, default: 0 },                // circles / coil × 100

  scrapVerified: { type: String, enum: ['PENDING', 'JOB_WORK', 'DONE'], default: 'PENDING' },
  coilMovementId:     { type: Schema.Types.ObjectId, ref: 'InventoryMovement' },
  coilMovementNumber: { type: String, trim: true, default: '' },

  remarks: { type: String, trim: true, default: '' },
}, baseSchemaOptions);

coilConversionSchema.index({ conversionDate: -1 });
coilConversionSchema.index({ coilSkuCode: 1, conversionDate: -1 });

const CoilConversion = model('CoilConversion', coilConversionSchema);
export default CoilConversion;
