/**
 * CompanySettings — a single document that holds tunable thresholds.
 *
 * Today there's exactly one row (multi-tenant deferred). The service layer
 * lazily creates the singleton on first read.
 */

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const CompanySettingsSchema = new Schema({
  // ── Pricing approval engine ──────────────────────────────────────
  approvalThresholdPercent:  { type: Number, default: 5, min: 0, max: 100 },
  futureDateApprovalDays:    { type: Number, default: 60, min: 0 },
  defaultGstRate:            { type: Number, default: 18, min: 0, max: 28 },
  marginFloorDefault:        { type: Number, default: 0, min: 0 },

  // ── Quotes ───────────────────────────────────────────────────────
  quoteValidityDays:         { type: Number, default: 15, min: 1, max: 180 },
  quoteSeriesPrefix:         { type: String, default: 'Q' },

  // ── Branding (used by quote PDF) ─────────────────────────────────
  companyName:               { type: String, default: 'Ambika Group' },
  companyAddress:            { type: String, default: '' },
  companyGstin:              { type: String, default: '' },
  companyPhone:              { type: String, default: '' },
  companyEmail:              { type: String, default: '' },

  quoteTerms:                { type: String, default: 'Prices are exclusive of GST unless stated otherwise. Quote valid for the duration shown.' },

  updatedBy:                 { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

CompanySettingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({});
  if (!doc) doc = await this.create({});
  return doc;
};

const CompanySettings = model('CompanySettings', CompanySettingsSchema);
export default CompanySettings;
