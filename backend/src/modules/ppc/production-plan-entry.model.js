/**
 * ProductionPlanEntry — a plan the factory commits to WITHOUT needing an order.
 *
 * The dispatch side (DispatchSchedule → DispatchPhase) is anchored to a sales
 * order: `salesOrderId` is required there, so nothing can be planned until a PO
 * actually arrives. But planning does not wait for paperwork — for a regular
 * party the team already knows roughly what will be made and when, and the
 * director wants that visible party-wise on a calendar long before any PO.
 *
 * So this is the same idea turned the other way round: PARTY + DATE first,
 * order optional. One document = one party, one date, N SKU lines.
 *   - no order?  → `source: 'MANUAL'`, salesOrderId stays null
 *   - order came → link it via salesOrderId/soNumber; the plan is unchanged
 *
 * NOT to be confused with `ProductionPlan` (production-plan.model.js), which is
 * one doc per (SKU, month) holding shop-floor WIP and daily output. That one
 * answers "how much must the factory make this month"; this one answers "what
 * did we promise this party, on which day".
 */

import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

const planItemSchema = new Schema({
  skuId:       { type: Schema.Types.ObjectId, ref: 'SKU', required: true },
  skuCode:     { type: String, default: '' },
  skuName:     { type: String, required: true },
  plannedQty:  { type: Number, required: true, min: 0 },
  // Filled in as the shop floor reports against the plan. Kept here (rather than
  // derived) so the calendar can colour a day without a second aggregation.
  producedQty: { type: Number, default: 0, min: 0 },

  // ── Consumption by dispatch planning ────────────────────────────────
  // How much of this line has been pulled into a real dispatch plan ("inherit").
  // remaining = plannedQty - consumedQty, and that is what a later order may
  // still draw on. Stored rather than derived so the calendar can colour a day
  // without joining every schedule.
  consumedQty: { type: Number, default: 0, min: 0 },
  // Who took it, so a cancelled/edited plan can give the capacity back and the
  // calendar can say WHICH order consumed this day.
  consumptions: [{
    _id:      false,
    soNumber: { type: String, default: '' },
    phaseNo:  { type: String, default: '' },
    qty:      { type: Number, default: 0 },
    at:       { type: Date, default: Date.now },
  }],

  note:        { type: String, default: '' },
}, { _id: false });

const ProductionPlanEntrySchema = new Schema({
  ...baseSchemaFields,

  planNo:     { type: String, unique: true, index: true },

  // ── Who and when — the two things the planner always knows ──────────
  partyId:    { type: Schema.Types.ObjectId, ref: 'Party', required: true, index: true },
  partyName:  { type: String, required: true },
  plannedDate:{ type: Date, required: true, index: true },

  items: {
    type: [planItemSchema],
    validate: [(v) => Array.isArray(v) && v.length > 0, 'At least one SKU line is required'],
  },

  // Roll-ups kept in sync by the service on every write — the calendar reads
  // thousands of these and must never have to sum `items` client-side.
  totalPlannedQty:  { type: Number, default: 0, min: 0 },
  totalProducedQty: { type: Number, default: 0, min: 0 },
  // Roll-up of items[].consumedQty — drives the calendar's used/free colouring.
  totalConsumedQty: { type: Number, default: 0, min: 0 },
  // Which orders have drawn on this day's plan, for the calendar's tooltip.
  consumedBySo:     { type: [String], default: [] },

  // ── The optional order link ─────────────────────────────────────────
  // Present only when a PO/SO exists for this plan. Its absence is the whole
  // point of this model, so it must never become required.
  salesOrderId: { type: Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
  soNumber:     { type: String, default: '' },
  poNumber:     { type: String, default: '' },

  source: { type: String, enum: ['MANUAL', 'ORDER'], default: 'MANUAL' },

  planStatus: {
    type: String,
    enum: ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
    default: 'PLANNED',
    index: true,
  },
}, baseSchemaOptions);

// The calendar's primary read: every live plan in a date window.
ProductionPlanEntrySchema.index({ plannedDate: 1, isDeleted: 1 });
// The director's party-wise monthly view.
ProductionPlanEntrySchema.index({ partyId: 1, plannedDate: 1 });

const ProductionPlanEntry = model('ProductionPlanEntry', ProductionPlanEntrySchema);
export default ProductionPlanEntry;
