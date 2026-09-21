import mongoose from 'mongoose';
import { SCHEDULE_STATUS } from '../../config/constants.js';

const actualDispatchSchema = new mongoose.Schema({
  date:         { type: Date, required: true },
  qty:          { type: Number, required: true },
  // Which Delivery Challan produced this actual. Needed so cancelling a dispatch
  // can subtract exactly its own contribution from the phase instead of guessing
  // by date/qty. Null on rows written before cancellation existed.
  dcNumber:     { type: String, default: null },
  // Set when the challan is cancelled: the row is KEPT (history) but its qty is
  // taken out of totalActualQty, so restoring is an exact, lossless add-back.
  cancelled:    { type: Boolean, default: false },
  invoiceNo:    { type: String },
  invoiceDate:  { type: Date },
  invoiceDoc:   { type: String }, // Individual Drive Link
}, { _id: false });

const phaseSchema = new mongoose.Schema({
  phaseNo:      { type: String, required: true }, // P1, P2, ... P10 — display label
  plannedDate:  { type: Date, default: null },
  plannedQty:   { type: Number, default: 0, min: 0 },
  actualDispatches: [actualDispatchSchema],
  totalActualQty: { type: Number, default: 0 },
  // Lifecycle: PLANNED → IN_PROGRESS (first DC) → DISPATCHED (qty met) → DELAYED (date passed, short) → CANCELLED
  status: {
    type: String,
    enum: ['PLANNED', 'IN_PROGRESS', 'DISPATCHED', 'DELAYED', 'CANCELLED'],
    default: 'PLANNED',
  },
  notes: { type: String, default: null }, // planner note (e.g. "MD approval pending")
}, { _id: true }); // _id is the stable handle the UI / DCs reference as phaseId

const scheduleItemSchema = new mongoose.Schema({
  skuId:    { type: mongoose.Schema.Types.ObjectId, ref: 'SKU' },
  skuName:  { type: String, required: true },
  skuCode:  { type: String, trim: true },
  poQty:          { type: Number, default: 0 },
  dispatchedQty:  { type: Number, default: 0 },
  balanceQty:     { type: Number, default: 0 },
  phases:   [phaseSchema],
}, { _id: true });

const dispatchScheduleSchema = new mongoose.Schema({
  soNumber:  { type: String, required: true, index: true },
  poNumber:  { type: String, index: true },
  partyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Party', index: true },
  partyName: { type: String },
  orderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', index: true },

  companyHeader: {
    name:    { type: String, default: 'M/s AMBIKA GLOBAL' },
    address: { type: String },
    phone:   { type: String },
  },
  poDate:    { type: Date },
  items:     [scheduleItemSchema],
  pdfUrl:    { type: String, default: null },
  status: {
    type: String,
    enum: Object.values(SCHEDULE_STATUS),
    default: SCHEDULE_STATUS.DRAFT,
    index: true,
  },
}, { timestamps: true });

dispatchScheduleSchema.index({ soNumber: 1, status: 1 });
dispatchScheduleSchema.index({ 'items.phases.plannedDate': 1 });
dispatchScheduleSchema.index({ 'items.phases.status': 1 });

const DispatchSchedule = mongoose.model('DispatchSchedule', dispatchScheduleSchema);
export default DispatchSchedule;
