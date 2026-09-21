import mongoose from 'mongoose';
import { INVOICE_STATUS, STEP_STATUS } from '../../config/constants.js';

const invoiceSchema = new mongoose.Schema({
  invoiceNo:  { type: String, required: true, unique: true, trim: true, index: true },
  dcId:       { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryChallan', index: true },
  dcNumber:   { type: String, index: true },
  soNumber:   { type: String, index: true },
  poNumber:   { type: String },
  partyId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Party', index: true },
  partyName:  { type: String },
  invoiceDate:{ type: Date, required: true },

  skuSummary:         { type: String }, // "Steele 1.5 Ltr/ Steele 1.0 Ltr"
  dispatchQtySummary: { type: String }, // "800/ 100/ 1600"

  invoiceAmount:   { type: Number, default: 0, min: 0 },
  amountReceived:  { type: Number, default: 0, min: 0 },
  balance:         { type: Number, default: 0, min: 0 },

  invoiceUrl:   { type: String },          // legacy single (mirrors invoiceUrls[0])
  ewayBillUrl:  { type: String },          // legacy single (mirrors ewayBillUrls[0])
  invoiceUrls:  [{ type: String }],        // Step 2.7 — up to 5 invoice files
  ewayBillUrls: [{ type: String }],        // Step 2.7 — up to 5 e-way bill files
  pdirUrls:     [{ type: String }],        // Step 2.7 — up to 10 PDIR files

  // Step 2.7 dispatch/transport details (from the client's invoice form).
  transportType:   { type: String },       // Freight Paid / To Pay / Party Vehicle
  transporterName: { type: String },
  lrNo:            { type: String },

  // Step 2.07 - Invoice creation tracking
  creation: {
    planned: { type: Date },
    actual:  { type: Date },
    status:  { type: String, enum: Object.values(STEP_STATUS), default: STEP_STATUS.PENDING },
    timeDelay: { type: String },
  },
  // Step 2.08 - Email to client
  emailToClient: {
    planned:     { type: Date },
    actual:      { type: Date },
    status:      { type: String, enum: Object.values(STEP_STATUS), default: STEP_STATUS.PENDING },
    emailStatus: { type: String },
    timeDelay:   { type: String },
  },

  status: {
    type: String,
    enum: Object.values(INVOICE_STATUS),
    default: INVOICE_STATUS.PENDING,
    index: true,
  },
  remarks: { type: String },
}, { timestamps: true });

invoiceSchema.pre('save', function (next) {
  // Clamped at 0: `balance` is DERIVED, and the field carries min:0 — an
  // over-receipt (or a correction) would otherwise make this hook produce a
  // value the schema rejects, failing the whole save with a 422.
  this.balance = Math.max(0, (this.invoiceAmount || 0) - (this.amountReceived || 0));
  next();
});

invoiceSchema.index({ invoiceDate: -1 });

const Invoice = mongoose.model('Invoice', invoiceSchema);
export default Invoice;
