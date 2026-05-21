/**
 * ProductionPlan — the PPC module's own truth: what the FACTORY must make.
 *
 * One document per (SKU, month). It holds:
 *   - the demand inputs the planner controls (FG stock, WIP, buffer)
 *   - `netToProduce` — the computed production target for the month
 *   - `days[]`       — the day-by-day target vs actually-produced
 *   - `wip{}`        — how many pieces sit at each shop-floor stage right now
 *
 * This is deliberately separate from dispatch data (Control Tower owns that).
 * Demand is read LIVE from sales orders — never copied here — so it can't drift.
 */

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// Shop-floor stages a jar travels through, in order.
export const PPC_STAGES = ['cutting', 'drawing', 'buffing', 'finishing', 'packing'];
export const PPC_STAGE_LABELS = {
  cutting:   'Cutting',
  drawing:   'Drawing',
  buffing:   'Buffing',
  finishing: 'Finishing',
  packing:   'Packing',
};

const dayPlanSchema = new Schema({
  date:        { type: Date, required: true },
  targetQty:   { type: Number, default: 0, min: 0 },
  producedQty: { type: Number, default: 0, min: 0 },
  note:        { type: String, default: '' },
}, { _id: false });

const ProductionPlanSchema = new Schema({
  skuId:    { type: Schema.Types.ObjectId, ref: 'SKU', required: true, index: true },
  skuCode:  { type: String, required: true },
  skuName:  { type: String, required: true },
  category: { type: String, default: '' },

  periodYear:  { type: Number, required: true },
  periodMonth: { type: Number, required: true, min: 1, max: 12 },

  // ── Demand inputs — planner controlled ──────────────────────────────
  fgStock:    { type: Number, default: 0, min: 0 },  // finished jars already in store
  openingWip: { type: Number, default: 0, min: 0 },  // jars already in the pipeline
  bufferPct:  { type: Number, default: 3, min: 0, max: 50 },

  // Snapshot of the open-order demand when the plan was last (re)generated.
  openOrderQtyAtPlan: { type: Number, default: 0, min: 0 },
  // The production target: ceil(max(0, demand - fgStock - wip) * (1 + buffer)).
  netToProduce:       { type: Number, default: 0, min: 0 },

  // ── Day-by-day plan vs actual production ────────────────────────────
  days: [dayPlanSchema],

  // ── Work-in-progress: pieces currently at each stage ────────────────
  wip: {
    cutting:   { type: Number, default: 0, min: 0 },
    drawing:   { type: Number, default: 0, min: 0 },
    buffing:   { type: Number, default: 0, min: 0 },
    finishing: { type: Number, default: 0, min: 0 },
    packing:   { type: Number, default: 0, min: 0 },
  },

  status: { type: String, enum: ['ACTIVE', 'DONE', 'ON_HOLD'], default: 'ACTIVE' },

  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// One plan per SKU per month.
ProductionPlanSchema.index({ skuId: 1, periodYear: 1, periodMonth: 1 }, { unique: true });
ProductionPlanSchema.index({ periodYear: 1, periodMonth: 1 });

const ProductionPlan = model('ProductionPlan', ProductionPlanSchema);
export default ProductionPlan;
