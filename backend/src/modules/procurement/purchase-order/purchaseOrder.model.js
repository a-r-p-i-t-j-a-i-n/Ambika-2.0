import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Vendor Purchase Order — Purchase FMS Step 1.4
 * "Create PO & Release To Supplier / Storekeeper".
 *
 * NOTE on naming: the mongoose model 'PurchaseOrder' is already taken by the
 * legacy CUSTOMER PO (modules/purchase-orders). This is the procurement-side
 * vendor PO, so it registers as 'VendorPurchaseOrder' (collection
 * `vendorpurchaseorders`) while the API path stays /procurement/purchase-orders.
 *
 * A PO can only be created from an Indent whose quotation is approved
 * (overallStatus QUOTATION_APPROVED / PO_READY). Party = Vendor.
 */

export const PO_APPROVAL_STATUS = {
  DRAFT:    'DRAFT',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
};

export const PO_RELEASE_STATUS = {
  NOT_RELEASED: 'NOT_RELEASED',
  RELEASED:     'RELEASED',
};

// Step 1.5 — material follow-up tracking on the PO (additive).
export const PO_FOLLOWUP_STATUS = {
  NOT_STARTED:   'NOT_STARTED',
  PENDING:       'PENDING',
  IN_PROGRESS:   'IN_PROGRESS',
  READY_FOR_GRN: 'READY_FOR_GRN',
  CLOSED:        'CLOSED',
};

// Step 1.6 — proforma-invoice tracking on the PO (additive).
export const PO_PI_STATUS = {
  NOT_RECEIVED:              'NOT_RECEIVED',
  PI_RECEIVED:               'PI_RECEIVED',
  PI_APPROVED:               'PI_APPROVED',
  READY_FOR_ADVANCE_PAYMENT: 'READY_FOR_ADVANCE_PAYMENT',
  PAYMENT_COMPLETED:         'PAYMENT_COMPLETED', // Step 1.7
  PI_NOT_REQUIRED:           'PI_NOT_REQUIRED',   // PI optional — explicitly skipped (audited)
};

// Advance payment lifecycle (independent of PI presence).
export const PO_ADVANCE_PAYMENT_STATUS = {
  NOT_STARTED:  'NOT_STARTED',
  COMPLETED:    'COMPLETED',
  NOT_REQUIRED: 'NOT_REQUIRED', // set when PI is marked Not Required
};

export const PO_STATUS = {
  DRAFT:              'DRAFT',
  APPROVED:           'APPROVED',
  RELEASED_TO_VENDOR: 'RELEASED_TO_VENDOR',
  PARTIAL_RECEIVED:   'PARTIAL_RECEIVED',   // set by future GRN module
  FULLY_RECEIVED:     'FULLY_RECEIVED',     // set by future GRN module
  CANCELLED:          'CANCELLED',
  CLOSED:             'CLOSED',
};

const poItemSchema = new Schema({
  itemName:      { type: String, required: [true, 'Item name is required'], trim: true },
  skuCode:       { type: String, trim: true, uppercase: true, default: '' },
  skuId:         { type: Schema.Types.ObjectId, ref: 'SKU' },
  quantity:      { type: Number, required: true, min: 0 },
  unit:          { type: String, trim: true, default: 'Pcs' },
  rate:          { type: Number, default: 0, min: 0 },
  gstRate:       { type: Number, default: 0, min: 0, max: 100 },
  taxableAmount: { type: Number, default: 0, min: 0 }, // qty × rate (server-computed)
  taxAmount:     { type: Number, default: 0, min: 0 }, // taxable × gst% (server-computed)
  totalAmount:   { type: Number, default: 0, min: 0 },
  // Future GRN linkage
  receivedQty:   { type: Number, default: 0, min: 0 },
  pendingQty:    { type: Number, default: 0, min: 0 },
}, { _id: true });

const vendorPurchaseOrderSchema = new Schema({
  ...baseSchemaFields,

  // ── Header ──
  poNumber: { type: String, unique: true, trim: true, index: true }, // auto: AGL/PO-001/26-27
  poDate:   { type: Date, default: Date.now },

  // Indent linkage (mandatory — POs are never standalone)
  indentId:     { type: Schema.Types.ObjectId, ref: 'PurchaseIndent', required: true, index: true },
  indentNumber: { type: String, trim: true, index: true },

  // Vendor (Party = Vendor) — snapshot at PO time so the PO is immutable history
  vendorId:      { type: Schema.Types.ObjectId, ref: 'Party', required: true, index: true },
  vendorName:    { type: String, trim: true, default: '' },
  vendorGST:     { type: String, trim: true, uppercase: true, default: '' },
  vendorPAN:     { type: String, trim: true, uppercase: true, default: '' },
  vendorAddress: { type: String, trim: true, default: '' },
  vendorEmail:   { type: String, trim: true, lowercase: true, default: '' },
  vendorPhone:   { type: String, trim: true, default: '' },

  // Commercial terms
  deliveryTerms: { type: String, trim: true, default: '' },
  paymentTerms:  { type: String, trim: true, default: '' },
  leadTime:      { type: String, trim: true, default: '' },   // e.g. "7 days"
  creditPeriod:  { type: Number, default: 0, min: 0 },        // days

  // ── Lines & totals ──
  items: { type: [poItemSchema], default: [] },
  totalTaxableValue: { type: Number, default: 0, min: 0 },
  totalGSTAmount:    { type: Number, default: 0, min: 0 },
  grandTotal:        { type: Number, default: 0, min: 0 },

  // ── Workflow ──
  approvalStatus: { type: String, enum: Object.values(PO_APPROVAL_STATUS), default: PO_APPROVAL_STATUS.DRAFT, index: true },
  releaseStatus:  { type: String, enum: Object.values(PO_RELEASE_STATUS), default: PO_RELEASE_STATUS.NOT_RELEASED, index: true },
  poStatus:       { type: String, enum: Object.values(PO_STATUS), default: PO_STATUS.DRAFT, index: true },
  approval: {
    decidedBy:   { type: String, trim: true, default: '' },
    decidedById: { type: Schema.Types.ObjectId, ref: 'User' },
    decidedAt:   { type: Date, default: null },
    remarks:     { type: String, trim: true, default: '' },
  },

  // ── Release information ──
  releasedBy:              { type: String, trim: true, default: '' },
  releasedById:            { type: Schema.Types.ObjectId, ref: 'User' },
  releasedAt:              { type: Date, default: null },
  supplierEmailSent:       { type: Boolean, default: false },
  supplierEmailSentAt:     { type: Date, default: null },
  supplierAcknowledgement: { type: String, trim: true, default: '' },

  // ── Document storage ──
  poPdfUrl:      { type: String, trim: true, default: '' },
  poPdfFileName: { type: String, trim: true, default: '' },

  // ── Step 1.5 — material follow-up linkage (additive) ──
  followUpStatus:       { type: String, enum: Object.values(PO_FOLLOWUP_STATUS), default: PO_FOLLOWUP_STATUS.NOT_STARTED, index: true },
  readyForGrnAt:        { type: Date, default: null },
  expectedDeliveryDate: { type: Date, default: null }, // releasedAt + leadTime days

  // ── Step 1.6 — proforma invoice linkage (additive) ──
  piStatus:     { type: String, enum: Object.values(PO_PI_STATUS), default: PO_PI_STATUS.NOT_RECEIVED, index: true },
  piId:         { type: Schema.Types.ObjectId, ref: 'ProformaInvoice', default: null },
  piNumber:     { type: String, trim: true, default: '' },
  piReceivedAt: { type: Date, default: null },

  // ── Step 1.7 — advance payment lifecycle ──
  advancePaymentStatus: { type: String, enum: Object.values(PO_ADVANCE_PAYMENT_STATUS), default: PO_ADVANCE_PAYMENT_STATUS.NOT_STARTED, index: true },

  // ── PI Not Required — full audit trail (kept forever) ──
  piNotRequiredReason:  { type: String, trim: true, default: '' },
  piNotRequiredRemarks: { type: String, trim: true, default: '' },
  piNotRequiredBy:      { type: Schema.Types.ObjectId, ref: 'User', default: null },
  piNotRequiredByName:  { type: String, trim: true, default: '' },
  piNotRequiredAt:      { type: Date, default: null },

}, baseSchemaOptions);

// ── Indexes ──────────────────────────────────────────────────
vendorPurchaseOrderSchema.index({ poNumber: 'text', indentNumber: 'text', vendorName: 'text' });
vendorPurchaseOrderSchema.index({ vendorId: 1, poStatus: 1 });
vendorPurchaseOrderSchema.index({ poDate: -1 });

const VendorPurchaseOrder = model('VendorPurchaseOrder', vendorPurchaseOrderSchema);
export default VendorPurchaseOrder;
