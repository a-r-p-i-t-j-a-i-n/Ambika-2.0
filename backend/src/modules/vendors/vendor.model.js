import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

// A product/material a vendor supplies (Purchase FMS). Each line carries its own
// rate, unit and GST% because the same vendor quotes different rates per item.
const vendorProductSchema = new Schema({
  skuId:       { type: Schema.Types.ObjectId, ref: 'SKU', default: null },
  productName: { type: String, trim: true },
  skuCode:     { type: String, trim: true, uppercase: true },
  unit:        { type: String, trim: true, default: 'Pcs' },
  rate:        { type: Number, min: 0, default: 0 }, // current/latest rate (mirrors newest pricing history)
  gstRate:     { type: Number, min: 0, max: 100, default: 0 },
  hsn:         { type: String, trim: true, default: '' },
  notes:       { type: String, trim: true, default: '' }, // grade / spec mapping
  // Latest-rate audit (mirrors the most recent PricingHistory entry for this SKU).
  lastUpdatedAt: { type: Date, default: null },
  lastUpdatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
}, { _id: true });

// ── Vendor (Purchase FMS supplier) — entirely separate from Party (customers) ──
const vendorSchema = new Schema({
  ...baseSchemaFields,

  code:    { type: String, unique: true, sparse: true, trim: true, uppercase: true },
  name:    { type: String, required: [true, 'Vendor name is required'], trim: true, index: true },

  contactPerson: { type: String, trim: true },
  phone:         { type: String, trim: true },
  email:         { type: String, trim: true, lowercase: true },
  address:       { type: String, trim: true },
  location:      { type: String, trim: true },
  state:         { type: String, trim: true },

  // Tax & financial
  gstNo:   { type: String, trim: true, uppercase: true },
  panNo:   { type: String, trim: true, uppercase: true, default: '' },
  gstRate: { type: Number, min: 0, max: 100, default: 0 },
  tdsRate: { type: Number, min: 0, max: 100, default: 0 },
  creditPeriodDays: { type: Number, default: 0 },

  // Email routing (To / CC / BCC) used by PO / RFQ communication.
  toEmails:  [{ type: String, trim: true, lowercase: true }],
  ccEmails:  [{ type: String, trim: true, lowercase: true }],
  bccEmails: [{ type: String, trim: true, lowercase: true }],

  // Everything this vendor supplies (grouped under the vendor).
  products: { type: [vendorProductSchema], default: [] },
}, baseSchemaOptions);

vendorSchema.index({ name: 'text', code: 'text', gstNo: 'text' });
vendorSchema.index({ isActive: 1, name: 1 });

const Vendor = model('Vendor', vendorSchema);
export default Vendor;
