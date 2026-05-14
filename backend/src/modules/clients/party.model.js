import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

const addressSchema = new Schema({
  label:  { type: String, default: 'Primary' },
  line1:  { type: String },
  line2:  { type: String },
  city:   { type: String },
  state:  { type: String },
  pin:    { type: String },
}, { _id: false });

const partySchema = new Schema({
  ...baseSchemaFields,

  code: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    uppercase: true,
  },
  name: {
    type: String,
    required: [true, 'Party name is required'],
    trim: true,
    index: true,
  },
  location: { type: String, trim: true },
  state:    { type: String, trim: true },
  gstNo:    { type: String, trim: true, uppercase: true },

  contactPerson: { type: String, trim: true },
  email:         { type: String, trim: true, lowercase: true },
  phone:         { type: String, trim: true },

  // Specialized Email Routing for Dispatch/Communication
  toEmails:  [{ type: String, trim: true, lowercase: true }],
  ccEmails:  [{ type: String, trim: true, lowercase: true }],
  bccEmails: [{ type: String, trim: true, lowercase: true }],

  creditPeriodDays: { type: Number, default: 30 },
  leadTimeDays:     { type: Number, default: 7 },

  addresses: [addressSchema],

}, baseSchemaOptions);

// ── Indexes ──────────────────────────────────────────────────
partySchema.index({ name: 'text', code: 'text', location: 'text' });
partySchema.index({ isActive: 1, name: 1 });
partySchema.index({ companyId: 1 });

const Party = model('Party', partySchema);
export default Party;

