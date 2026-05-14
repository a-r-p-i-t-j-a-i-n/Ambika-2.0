import mongoose from 'mongoose';
import { SCHEDULE_STATUS } from '../../config/constants.js';

const actualDispatchSchema = new mongoose.Schema({
  date:         { type: Date, required: true },
  qty:          { type: Number, required: true },
  invoiceNo:    { type: String },
  invoiceDate:  { type: Date },
  invoiceDoc:   { type: String }, // Individual Drive Link
}, { _id: false });

const phaseSchema = new mongoose.Schema({
  phaseNo:      { type: String, required: true }, // P1, P2, ... P10
  plannedDate:  { type: Date, default: null },
  plannedQty:   { type: Number, default: 0, min: 0 },
  actualDispatches: [actualDispatchSchema],
  totalActualQty: { type: Number, default: 0 },
  status: { type: String, enum: ['PENDING', 'PARTIAL', 'COMPLETE'], default: 'PENDING' }
}, { _id: false });

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

const DispatchSchedule = mongoose.model('DispatchSchedule', dispatchScheduleSchema);
export default DispatchSchedule;
