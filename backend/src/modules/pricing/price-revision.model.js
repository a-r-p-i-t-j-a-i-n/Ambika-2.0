/**
 * PriceRevision — the append-only journal of every price change for every SKU.
 *
 * Design notes
 *   - "Current price" is just the latest LIVE revision per `(skuId, priceType)`
 *     with `effectiveFrom <= today`. We do NOT maintain a parallel "current price"
 *     collection. The `SKU.sellingPrice` / `SKU.rmCost` fields are a denormalised
 *     cache, updated whenever a revision becomes live.
 *
 *   - Two price streams are supported: SELLING (customer price) and RM_COST
 *     (raw material cost). Margin = SELLING - RM_COST when both exist.
 *
 *   - Approval workflow: a revision is created in one of two states:
 *       LIVE             — auto-approved (within threshold + actor has reviseAutoApprove)
 *       PENDING_APPROVAL — needs an MD approval click
 *
 *   - Corrections are NEW rows that point back at the bad row via `correctionOf`.
 *     The bad row is never edited or deleted.
 */

import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

export const PRICE_TYPES   = ['SELLING', 'RM_COST'];
export const REVISION_STATUSES = ['LIVE', 'PENDING_APPROVAL', 'REJECTED', 'SUPERSEDED'];

const PriceRevisionSchema = new Schema({
  ...baseSchemaFields,

  skuId:       { type: Schema.Types.ObjectId, ref: 'SKU', required: true, index: true },
  skuCode:     { type: String, required: true }, // denormalised for fast list rendering
  skuName:     { type: String, required: true },

  priceType:   { type: String, enum: PRICE_TYPES, required: true, default: 'SELLING' },

  oldPrice:    { type: Number, default: null }, // null on first-ever revision
  newPrice:    { type: Number, required: true, min: 0 },

  effectiveFrom: { type: Date, required: true, index: true },
  reason:        { type: String, default: '' },
  remarks:       { type: String, default: '' },

  attachmentUrl:  { type: String, default: '' },
  attachmentName: { type: String, default: '' },

  // ── Workflow ────────────────────────────────────────────────────
  status:          { type: String, enum: REVISION_STATUSES, required: true, default: 'LIVE', index: true },
  changePercent:   { type: Number, default: 0 }, // (new - old) / old * 100; 0 if no oldPrice

  requestedBy:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
  requestedByName: { type: String, default: '' },

  approvedBy:      { type: Schema.Types.ObjectId, ref: 'User', default: null },
  approvedByName:  { type: String, default: '' },
  approvedAt:      { type: Date, default: null },
  rejectionReason: { type: String, default: '' },

  // ── Lineage ─────────────────────────────────────────────────────
  supersedes:      { type: Schema.Types.ObjectId, ref: 'PriceRevision', default: null },
  correctionOf:    { type: Schema.Types.ObjectId, ref: 'PriceRevision', default: null },
  isCorrection:    { type: Boolean, default: false },

  // ── Margin snapshot (only on SELLING revisions) ─────────────────
  rmCostAtSave:    { type: Number, default: null },
  marginAtSave:    { type: Number, default: null },
  marginPercent:   { type: Number, default: null },
  marginAlert:     { type: Boolean, default: false },

  // ── Risk flags computed at submission time ──────────────────────
  flags: {
    overThreshold:        { type: Boolean, default: false },
    priceDecrease:        { type: Boolean, default: false },
    farFutureDated:       { type: Boolean, default: false },
    negativeMargin:       { type: Boolean, default: false },
  },
}, baseSchemaOptions);

// Latest revision per (sku, type)
PriceRevisionSchema.index({ skuId: 1, priceType: 1, effectiveFrom: -1 });
PriceRevisionSchema.index({ status: 1, createdAt: -1 });
PriceRevisionSchema.index({ priceType: 1, effectiveFrom: -1 });

const PriceRevision = model('PriceRevision', PriceRevisionSchema);
export default PriceRevision;
