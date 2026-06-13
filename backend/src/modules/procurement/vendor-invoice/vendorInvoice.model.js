import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Vendor Invoice / Debit Note — Purchase FMS Step 1.10.
 *
 * Created only after Incoming QC is PASSED or PARTIAL. Captures the supplier's
 * tax invoice, an optional debit note, and computes net payable after adjusting
 * the advance already paid (from the PI). Approval moves it to PAYMENT_PENDING,
 * ready for Step 1.11 Voucher processing.
 */

export const INVOICE_STATUS = {
  DRAFT:             'DRAFT',
  RECEIVED:          'RECEIVED',
  APPROVED:          'APPROVED',
  REJECTED:          'REJECTED',
  PAYMENT_PENDING:   'PAYMENT_PENDING',
  PAYMENT_COMPLETED: 'PAYMENT_COMPLETED',
};

const docSchema = new Schema({
  fileName:   { type: String, default: '' },
  fileUrl:    { type: String, default: '' },
  fileType:   { type: String, default: '' },
  uploadedAt: { type: Date, default: null },
}, { _id: false });

const vendorInvoiceSchema = new Schema({
  ...baseSchemaFields,

  // Supplier's invoice number (entered, not auto).
  invoiceNumber:       { type: String, required: [true, 'Invoice number is required'], trim: true, index: true },
  invoiceDate:         { type: Date, default: null },
  invoiceReceivedDate: { type: Date, default: Date.now },

  // ── Linkage (QC → GRN → PO → PI → Vendor) ──
  qcId:       { type: Schema.Types.ObjectId, ref: 'IncomingQC', required: true, index: true },
  qcNumber:   { type: String, trim: true, default: '' },
  grnId:      { type: Schema.Types.ObjectId, ref: 'GoodsReceiptNote' },
  grnNumber:  { type: String, trim: true, default: '' },
  poId:       { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder' },
  poNumber:   { type: String, trim: true, default: '' },
  piId:       { type: Schema.Types.ObjectId, ref: 'ProformaInvoice' },
  piNumber:   { type: String, trim: true, default: '' },
  vendorId:   { type: Schema.Types.ObjectId, ref: 'Party', index: true },
  vendorName: { type: String, trim: true, default: '' },
  vendorGST:  { type: String, trim: true, default: '' },
  vendorAddress: { type: String, trim: true, default: '' },

  // ── Financials ──
  invoiceAmount:    { type: Number, default: 0, min: 0 }, // gross invoice value
  taxableAmount:    { type: Number, default: 0, min: 0 },
  gstAmount:        { type: Number, default: 0, min: 0 },
  tdsAmount:        { type: Number, default: 0, min: 0 },
  otherCharges:     { type: Number, default: 0 },
  advancePaid:      { type: Number, default: 0, min: 0 }, // pulled from PI.paidAmount
  netPayableAmount: { type: Number, default: 0 },         // invoice − debitNote − advancePaid

  invoiceDocument: { type: docSchema, default: () => ({}) },

  // ── Debit note (optional) ──
  debitNoteRequired: { type: Boolean, default: false },
  debitNoteNumber:   { type: String, trim: true, default: '' },
  debitNoteAmount:   { type: Number, default: 0, min: 0 },
  debitNoteReason:   { type: String, trim: true, default: '' },
  debitNoteDocument: { type: docSchema, default: () => ({}) },

  // ── Status & approval ──
  invoiceStatus: { type: String, enum: Object.values(INVOICE_STATUS), default: INVOICE_STATUS.DRAFT, index: true },
  approvedBy:    { type: String, trim: true, default: '' },
  approvedById:  { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt:    { type: Date, default: null },
  approvalRemarks: { type: String, trim: true, default: '' },
  rejectedBy:    { type: String, trim: true, default: '' },
  rejectedAt:    { type: Date, default: null },
  rejectionRemarks: { type: String, trim: true, default: '' },

  // ── Voucher linkage (Step 1.11) ──
  voucherId:     { type: Schema.Types.ObjectId, ref: 'VendorVoucher', default: null },
  voucherNumber: { type: String, trim: true, default: '' },

  remarks: { type: String, trim: true, default: '' },
}, baseSchemaOptions);

vendorInvoiceSchema.index({ invoiceNumber: 'text', poNumber: 'text', grnNumber: 'text', vendorName: 'text' });
vendorInvoiceSchema.index({ vendorId: 1, invoiceStatus: 1 });
vendorInvoiceSchema.index({ invoiceDate: -1 });

const VendorInvoice = model('VendorInvoice', vendorInvoiceSchema);
export default VendorInvoice;
