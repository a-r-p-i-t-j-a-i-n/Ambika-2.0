import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

const SkuSchema = new Schema({
  ...baseSchemaFields,
  
  clientId: { type: Schema.Types.ObjectId, ref: 'Party' },
  
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true }, // Client's specific SKU code
  
  category: { type: String, trim: true },
  aliases: [{ type: String, trim: true }],
  unit: { type: String, default: 'PCS' }, // e.g., PCS, KGS, MTR, LTR
  pcsPerBox: { type: Number, default: 1, min: 1 },
  weightPerBox: { type: Number, default: 0, min: 0 }, // Weight in KGs
  weightPerPc: { type: Number, default: 0, min: 0 },
  
  leadDays: { type: Number, default: 7, min: 0 },
  sellingPrice: { type: Number, default: 0, min: 0 },
  
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
SkuSchema.index({ name: 'text', code: 'text', category: 'text', aliases: 'text' });
SkuSchema.index({ companyId: 1 });

export default model('SKU', SkuSchema);
