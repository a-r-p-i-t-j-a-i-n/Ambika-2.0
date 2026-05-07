import mongoose from 'mongoose';
import { SO_STATUS, STEP_STATUS } from '../../config/constants.js';

// ── Workflow Step Sub-Schema (used by O2D tracker) ──────────
const workflowStepSchema = new mongoose.Schema({
  planned:  { type: Date, default: null },
  actual:   { type: Date, default: null },
  status:   { type: String, enum: Object.values(STEP_STATUS), default: STEP_STATUS.PENDING },
  link:     { type: String, default: null },
  timeDelay:{ type: String, default: null },
}, { _id: false });

// ── Order Line Item ─────────────────────────────────────────
const orderItemSchema = new mongoose.Schema({
  skuId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SKU', required: true },
  skuName: { type: String, required: true },
  skuCode: { type: String, required: true },
  orderQty:      { type: Number, required: true, min: 0 },
  dispatchedQty: { type: Number, default: 0, min: 0 },
  balanceQty:    { type: Number, default: 0, min: 0 },
  asnCode:       { type: String, trim: true, default: null }, // ASN Code / FCI Code
  remark:        { type: String, default: null }, // "Short Close", "Extra Sent"
}, { _id: true });

// ── Main Sales Order Schema ─────────────────────────────────
const salesOrderSchema = new mongoose.Schema({
  soNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  poNumber: {
    type: String,
    trim: true,
    index: true,
  },
  poDate: {
    type: Date,
    default: null,
  },
  partyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Party',
    required: [true, 'Party is required'],
    index: true,
  },
  partyName:  { type: String, trim: true },
  location:   { type: String, trim: true },
  orderDate:  { type: Date, required: true, index: true },
  receivedAt: { type: Date, default: Date.now },
  financialYear: { type: String, trim: true }, // "25-26"

  // ── New fields from client's actual workflow ────────────
  transport:     { type: String, trim: true, default: 'Road' },  // Road, Rail, Air, Sea
  partyGroup:    { type: String, trim: true, default: null },
  month:         { type: String, trim: true },  // Derived from orderDate (e.g. "Dec", "Jan")
  orderDocument: { type: String, default: null }, // PO document link (URL or future S3 key)

  leadTimeDays:  { type: Number, default: 7 },

  status: {
    type: String,
    enum: Object.values(SO_STATUS),
    default: SO_STATUS.RECEIVED,
    index: true,
  },

  items: [orderItemSchema],

  // ── O2D Workflow Steps (13 Steps) ───────────────────────
  // Pre-Production
  poEntry:        workflowStepSchema,
  inventoryCheck: workflowStepSchema,
  paymentCheck:   workflowStepSchema,
  ocEntry:        workflowStepSchema,

  // Planning
  scheduling: {
    ...workflowStepSchema.obj,
    cancelLink: { type: String, default: null },
  },
  emailSchedule: {
    ...workflowStepSchema.obj,
    pdfLink:     { type: String, default: null },
    emailStatus: { type: String, default: null },
    printableLink: { type: String, default: null },
  },

  // Execution
  productionFollowUp: workflowStepSchema,
  loadingAdvice:      workflowStepSchema,
  loadingFollowUp:    workflowStepSchema,
  invoicing:          workflowStepSchema,
  dispatchDetails:    workflowStepSchema,

  // Post-Dispatch
  podFollowUp:     workflowStepSchema,
  paymentFollowUp: workflowStepSchema,

  remark: { type: String, trim: true },

  // ── Aggregated Totals ───────────────────────────────────
  totalOrderQty:      { type: Number, default: 0 },
  totalDispatchedQty: { type: Number, default: 0 },
  totalBalanceQty:    { type: Number, default: 0 },

  saleOrderLink: { type: String, default: null },
  uniqueO2DId:   { type: String, unique: true, sparse: true },
}, {
  timestamps: true,
  toJSON:  { virtuals: true },
  toObject: { virtuals: true },
});

// ── Pre-save: calculate totals & derive month ───────────────
salesOrderSchema.pre('save', function (next) {
  // Auto-derive month from orderDate
  if (this.orderDate) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    this.month = months[new Date(this.orderDate).getMonth()];
  }

  if (this.items && this.items.length > 0) {
    // Auto-calc balance per item
    this.items.forEach((item) => {
      item.balanceQty = Math.max(0, (item.orderQty || 0) - (item.dispatchedQty || 0));
    });
    this.totalOrderQty      = this.items.reduce((s, i) => s + (i.orderQty || 0), 0);
    this.totalDispatchedQty = this.items.reduce((s, i) => s + (i.dispatchedQty || 0), 0);
    this.totalBalanceQty    = this.items.reduce((s, i) => s + (i.balanceQty || 0), 0);
  }

  // Auto-determine order status based on dispatch progress
  if (this.totalOrderQty > 0 && this.totalBalanceQty <= 0) {
    this.status = SO_STATUS.COMPLETED;
  } else if (this.totalDispatchedQty > 0 && this.totalBalanceQty > 0) {
    if (this.status === SO_STATUS.RECEIVED) {
      this.status = SO_STATUS.IN_PROGRESS;
    }
  }

  next();
});

// ── Indexes ──────────────────────────────────────────────────
salesOrderSchema.index({ soNumber: 'text', poNumber: 'text', partyName: 'text' });
salesOrderSchema.index({ partyId: 1, status: 1 });
salesOrderSchema.index({ orderDate: -1 });
salesOrderSchema.index({ financialYear: 1 });
salesOrderSchema.index({ month: 1 });

const SalesOrder = mongoose.model('SalesOrder', salesOrderSchema);
export default SalesOrder;
