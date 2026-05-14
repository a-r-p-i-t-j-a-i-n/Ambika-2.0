import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

const AddressSchema = new Schema({
  label: { type: String, default: 'Billing' }, // e.g., 'Billing', 'Shipping', 'Plant'
  line1: { type: String, required: true },
  line2: { type: String },
  city:  { type: String, required: true },
  state: { type: String, required: true },
  pin:   { type: String, required: true },
  country: { type: String, default: 'India' }
}, { _id: false });

const ContactSchema = new Schema({
  name: { type: String, required: true },
  phone: { type: String },
  role: { type: String }, // e.g., 'Purchasing Manager'
  isPrimary: { type: Boolean, default: false }
}, { _id: false });

const ClientSchema = new Schema({
  ...baseSchemaFields,
  
  companyName: { type: String, required: true, trim: true },
  code:        { type: String, uppercase: true, unique: true, required: true }, // Internal Client Code
  
  gstNo:       { type: String, trim: true },
  
  contacts:    [ContactSchema],
  emails:      [{ type: String, trim: true, lowercase: true }],
  
  addresses:   [AddressSchema],
  
  paymentTerms:     { type: String }, // e.g., 'Advance', 'Net 30', 'Net 60'
  creditPeriodDays: { type: Number, default: 30, min: 0 },
  
  logisticsPreferences: { type: String },
  preferredTransporterIds: [{ type: Schema.Types.ObjectId, ref: 'Transporter' }]
  
}, baseSchemaOptions);

// Indexes
ClientSchema.index({ companyName: 1 });
ClientSchema.index({ companyId: 1 });

export default model('Client', ClientSchema);
