import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Proforma Invoice — Purchase FMS Step 1.6 "PI Form".
 *
 * Always linked to a released Vendor PO (no standalone PIs). The approved PI
 * is the prerequisite for Step 1.7 Advance Payment — no payment is created
 * here; `paidAmount` stays 0 until the payment module writes to it.
 */

export const PI_APPROVAL_STATUS = {
  PENDING:  'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

export const PI_STATUS = {
  DRAFT:                     'DRAFT',
  RECEIVED:                  'RECEIVED',
  APPROVED:                  'APPROVED',
  READY_FOR_ADVANCE_PAYMENT: 'READY_FOR_ADVANCE_PAYMENT',
  PAYMENT_COMPLETED:         'PAYMENT_COMPLETED', // Step 1.7 — balance 0 or short-closed
  CANCELLED:                 'CANCELLED',
};

const piItemSchema = new Schema({
  itemName:    { type: String, required: [true, 'Item name is required'], trim: true },
  skuCode:     { type: String, trim: true, uppercase: true, default: '' },
  skuId:       { type: Schema.Types.ObjectId, ref: 'SKU' },
  quantity:    { type: Number, required: true, min: 0 },
  unit:        { type: String, trim: true, default: 'Pcs' },
  receivedQty: { type: Number, default: 0, min: 0 }, // GRN module (later) owns this
  balanceQty:  { type: Number, default: 0, min: 0 },
  rate:        { type: Number, default: 0, min: 0 },
  gstRate:     { type: Number, default: 0, min: 0, max: 100 },
  lineAmount:  { type: Number, default: 0, min: 0 }, // qty × rate × (1 + gst%) — server-computed
}, { _id: true });

const proformaInvoiceSchema = new Schema({
  ...baseSchemaFields,

  // ── Header ──
  piNumber:   { type: String, unique: true, trim: true, index: true }, // auto: PI-001/26-27
  piDate:     { type: Date, default: Date.now },
  uniqueCode: { type: String, trim: true, index: true },               // auto: PI-1 (global)

  // PO linkage (mandatory — PIs are never standalone)
  poId:         { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder', required: true, index: true },
  poNumber:     { type: String, trim: true, index: true },
  indentId:     { type: Schema.Types.ObjectId, ref: 'PurchaseIndent' },
  indentNumber: { type: String, trim: true },

  // Vendor snapshot (Party = Vendor)
  vendorId:      { type: Schema.Types.ObjectId, ref: 'Party', index: true },
  vendorName:    { type: String, trim: true, default: '' },
  vendorGST:     { type: String, trim: true, uppercase: true, default: '' },
  vendorPAN:     { type: String, trim: true, uppercase: true, default: '' },
  vendorAddress: { type: String, trim: true, default: '' },
  vendorEmail:   { type: String, trim: true, lowercase: true, default: '' },
  vendorPhone:   { type: String, trim: true, default: '' },

  // ── Lines & financials ──
  items:         { type: [piItemSchema], default: [] },
  totalValue:    { type: Number, default: 0, min: 0 },
  paidAmount:    { type: Number, default: 0, min: 0 },  // written by Step 1.7 Advance Payment
  balanceAmount: { type: Number, default: 0, min: 0 },  // totalValue − paidAmount

  // ── Status ──
  approvalStatus: { type: String, enum: Object.values(PI_APPROVAL_STATUS), default: PI_APPROVAL_STATUS.PENDING, index: true },
  piStatus:       { type: String, enum: Object.values(PI_STATUS), default: PI_STATUS.DRAFT, index: true },

  // ── Document ──
  piDocument: {
    fileName:   { type: String, default: '' },
    fileUrl:    { type: String, default: '' },
    fileType:   { type: String, default: '' },
    uploadedAt: { type: Date, default: null },
  },

  // ── Approval / rejection ──
  approvedBy:       { type: String, trim: true, default: '' },
  approvedById:     { type: Schema.Types.ObjectId, ref: 'User' },
  approvedAt:       { type: Date, default: null },
  approvalRemarks:  { type: String, trim: true, default: '' },
  rejectedBy:       { type: String, trim: true, default: '' },
  rejectedById:     { type: Schema.Types.ObjectId, ref: 'User' },
  rejectedAt:       { type: Date, default: null },
  rejectionRemarks: { type: String, trim: true, default: '' },

  // ── Timeline ──
  receivedAt: { type: Date, default: null },

}, baseSchemaOptions);

// ── Indexes ──────────────────────────────────────────────────
proformaInvoiceSchema.index({ piNumber: 'text', poNumber: 'text', vendorName: 'text', uniqueCode: 'text' });
proformaInvoiceSchema.index({ vendorId: 1, piStatus: 1 });
proformaInvoiceSchema.index({ piDate: -1 });

const ProformaInvoice = model('ProformaInvoice', proformaInvoiceSchema);
export default ProformaInvoice;
