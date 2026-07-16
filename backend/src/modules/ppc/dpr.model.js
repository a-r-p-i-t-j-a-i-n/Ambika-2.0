/**
 * DprEntry — one Daily Production Report row: what a single MACHINE produced on a
 * single OPERATION during one SHIFT on one DATE. This is the shop-floor's source
 * record; every OEE number (Availability × Performance × Quality) is derived from
 * it by oee.service and re-stamped into `oee` on each save, so the yellow
 * "don't type, just drag the formula" columns of the client's Excel become
 * server-computed fields the operator never touches.
 *
 * Downtime and defects are stored as reason/qty ARRAYS (not 70 fixed columns) so
 * dashboards can $unwind them into Pareto charts and new reasons can be added
 * without a migration. The canonical keys live in dpr.constants.js.
 */
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const hourlySchema = new Schema({
  slot: { type: String, required: true }, // one of HOUR_SLOTS
  qty:  { type: Number, default: 0, min: 0 },
}, { _id: false });

const reasonMinutesSchema = new Schema({
  reason:  { type: String, required: true }, // canonical key
  minutes: { type: Number, default: 0, min: 0 },
}, { _id: false });

const defectSchema = new Schema({
  type: { type: String, required: true }, // canonical key
  qty:  { type: Number, default: 0, min: 0 },
}, { _id: false });

// The computed OEE block — written by oee.service, read-only to clients.
const oeeSchema = new Schema({
  productionQty:  { type: Number, default: 0 },
  netAvailable:   { type: Number, default: 0 }, // available − planned downtime (min)
  runTime:        { type: Number, default: 0 }, // net available − unplanned loss (min)
  plannedTotal:   { type: Number, default: 0 },
  downtimeTotal:  { type: Number, default: 0 },
  stdCycleMin:    { type: Number, default: 0 }, // standard minutes per piece
  availability:   { type: Number, default: 0 }, // 0..1
  performance:    { type: Number, default: 0 }, // 0..1  (a.k.a. Operator Eff)
  quality:        { type: Number, default: 0 }, // 0..1
  machineEff:     { type: Number, default: 0 }, // availability × performance
  operatorEff:    { type: Number, default: 0 }, // == performance
  oee:            { type: Number, default: 0 }, // availability × performance × quality
  reworkQty:      { type: Number, default: 0 },
  rejectQty:      { type: Number, default: 0 },
  goodQty:        { type: Number, default: 0 }, // produced − reject − rework
  reworkPct:      { type: Number, default: 0 },
  rejectPct:      { type: Number, default: 0 },
  rejectPpm:      { type: Number, default: 0 },
  partRate:       { type: Number, default: 0 },
  productionValue: { type: Number, default: 0 },
  rejectionValue:  { type: Number, default: 0 },
}, { _id: false });

const DprEntrySchema = new Schema({
  // ── Context (operator-entered, mostly dropdowns) ────────────────────────
  date:  { type: Date, required: true, index: true },
  shift: { type: String, default: 'A', index: true },

  machineCode: { type: String, uppercase: true, trim: true, required: true, index: true },
  machineId:   { type: Schema.Types.ObjectId, ref: 'Machine' },
  machineType: { type: String, trim: true, default: '' },

  operatorName: { type: String, trim: true, default: '' },
  operatorId:   { type: Schema.Types.ObjectId, ref: 'Operator' },

  skuCode: { type: String, uppercase: true, trim: true, required: true, index: true },
  skuName: { type: String, trim: true, default: '' },
  skuId:   { type: Schema.Types.ObjectId, ref: 'SKU' },

  operationNo:    { type: Number, default: 0 },
  operationName:  { type: String, trim: true, default: '' },
  operationLabel: { type: String, trim: true, default: '' },
  isLastOperation: { type: Boolean, default: false },

  dieNo:      { type: String, trim: true, default: '' },
  coilNo:     { type: String, trim: true, default: '' },
  circleSize: { type: String, trim: true, default: '' },

  // ── Timing ──────────────────────────────────────────────────────────────
  startTime: { type: String, default: '' }, // "08:30"
  stopTime:  { type: String, default: '' }, // "18:50"
  availableMinutes: { type: Number, default: 0, min: 0 },

  // ── Production (entered hour-by-hour) ───────────────────────────────────
  hourly:     [hourlySchema],
  strokes:    { type: Number, default: 0, min: 0 }, // No. of Strokes / Shots
  toolBreakdownMinutes: { type: Number, default: 0, min: 0 },

  // ── Downtime + defects (reason/qty arrays) ──────────────────────────────
  plannedItems:  [reasonMinutesSchema],
  downtimeItems: [reasonMinutesSchema],
  defectItems:   [defectSchema],
  reworkQty:     { type: Number, default: 0, min: 0 },

  // ── Process params snapshot (from Process Route, editable per row) ───────
  spm:    { type: Number, default: 0, min: 0 },
  cavity: { type: Number, default: 1, min: 1 },

  // ── Misc ────────────────────────────────────────────────────────────────
  rmConsumedKg: { type: Number, default: 0, min: 0 },
  circleWeightKg: { type: Number, default: 0, min: 0 },
  materialGrade: { type: String, trim: true, default: '' },
  remarks:      { type: String, trim: true, default: '', maxlength: 1000 },

  // ── Computed OEE ────────────────────────────────────────────────────────
  oee: { type: oeeSchema, default: () => ({}) },

  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  isDeleted: { type: Boolean, default: false, index: true },
}, { timestamps: true });

// Dashboards slice by date → machine / operator / sku, so index the common paths.
DprEntrySchema.index({ date: -1, machineCode: 1 });
DprEntrySchema.index({ date: -1, operatorName: 1 });
DprEntrySchema.index({ date: -1, skuCode: 1 });

const DprEntry = model('DprEntry', DprEntrySchema);
export default DprEntry;
