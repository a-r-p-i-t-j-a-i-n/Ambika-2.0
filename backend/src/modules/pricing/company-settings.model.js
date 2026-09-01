/**
 * CompanySettings — a single document that holds tunable thresholds.
 *
 * Today there's exactly one row (multi-tenant deferred). The service layer
 * lazily creates the singleton on first read.
 */

import mongoose from 'mongoose';
import env from '../../config/env.js';

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
  // One company name for the whole system — the same COMPANY_NAME the challan /
  // invoice PDFs and the outgoing emails print. This module used to carry its own
  // default ('Ambika Group'), which is not the company's name and only ever showed
  // up on quotes.
  companyName:               { type: String, default: () => env.COMPANY_NAME },
  companyAddress:            { type: String, default: '' },
  companyGstin:              { type: String, default: '' },
  companyPhone:              { type: String, default: '' },
  companyEmail:              { type: String, default: '' },

  quoteTerms:                { type: String, default: 'Prices are exclusive of GST unless stated otherwise. Quote valid for the duration shown.' },

  updatedBy:                 { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// The wrong name this module used to default to. Any settings row created before
// the fix has it PERSISTED, so a new schema default alone would never reach it.
const LEGACY_WRONG_NAME = 'Ambika Group';

CompanySettingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne({});
  if (!doc) doc = await this.create({});
  // Self-heal the stale default in place. Only the known-bad value is replaced —
  // a name someone actually typed in Settings is left exactly as they set it.
  if (!doc.companyName || doc.companyName.trim() === LEGACY_WRONG_NAME) {
    doc.companyName = env.COMPANY_NAME;
    await doc.save();
  }
  return doc;
};

const CompanySettings = model('CompanySettings', CompanySettingsSchema);
export default CompanySettings;
