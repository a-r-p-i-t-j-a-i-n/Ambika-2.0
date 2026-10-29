/**
 * CompanySettings — a single document that holds tunable thresholds.
 *
 * Today there's exactly one row (multi-tenant deferred). The service layer
 * lazily creates the singleton on first read.
 */

import mongoose from 'mongoose';
import env from '../../config/env.js';
import { BUILT_IN_PO_TERMS } from '../procurement/purchase-order/poTerms.js';

const { Schema, model } = mongoose;

// One fixed image printed on Purchase Order PDFs (see company-pdf-assets.js).
// The bytes are `select: false` — only the PDF builder and the admin preview
// ask for them — and live in this document rather than under the public
// /uploads static route, so the image is never reachable by URL.
const PdfAssetSchema = new Schema({
  data:           { type: Buffer, select: false },
  mimeType:       { type: String, enum: ['image/png', 'image/jpeg'] },
  fileName:       { type: String, trim: true },
  sizeBytes:      { type: Number },
  width:          { type: Number },
  height:         { type: Number },
  sha256:         { type: String },
  uploadedBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  uploadedByName: { type: String, trim: true },
  uploadedAt:     { type: Date },
}, { _id: false });

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

  // ── Purchase Order Terms & Conditions (defaults per PO format) ───
  // Copied onto each new PO when it is created; the buyer can edit a PO's own
  // copy from the PO form. Changing these never touches an existing PO.
  poTermsJsl:                { type: String, default: BUILT_IN_PO_TERMS.JSL },
  poTermsOther:              { type: String, default: BUILT_IN_PO_TERMS.OTHER },

  // ── PO authorised signatory (uploaded by settings.edit admins) ───
  // The company's fixed authorised signature + stamp — NOT the per-document
  // MD signature of the approval engine. Absent until an admin uploads one.
  authorisedSignature:       { type: PdfAssetSchema, default: undefined },
  companyStamp:              { type: PdfAssetSchema, default: undefined },

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
