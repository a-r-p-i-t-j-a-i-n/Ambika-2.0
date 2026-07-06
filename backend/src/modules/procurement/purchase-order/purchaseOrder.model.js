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

// PO format — JSL (steel grade/width/finish + discount pricing) vs OTHER (normal).
export const PO_FORMAT_TYPE = {
  JSL:   'JSL',
  OTHER: 'OTHER',
};

const poItemSchema = new Schema({
  // Source-indent linkage per line — a multi-indent PO carries items from several
  // indents, so each row records where it came from. Single-indent POs simply
  // repeat the PO's own indent here.
  indentId:      { type: Schema.Types.ObjectId, ref: 'PurchaseIndent' },
  indentNumber:  { type: String, trim: true, default: '' },

  // OTHER-format fields (also used as the canonical description/rate for JSL so
  // downstream GRN/inventory keep working).
  itemName:      { type: String, trim: true, default: '' }, // not required — JSL items use grade/width/finish
  skuCode:       { type: String, trim: true, uppercase: true, default: '' },
  skuId:         { type: Schema.Types.ObjectId, ref: 'SKU' },
  // Source indent line-item linkage (item-level PO traceability). A PO line traces
  // back to the exact indent item it was raised for; older POs leave this null and
  // fall back to skuCode matching.
  indentItemId:  { type: Schema.Types.ObjectId, default: null },
  // Display-only item reference snapshot (e.g. Ind-50.1/26-27) — server-stamped
  // from the source indent item's line number so the PO, its PDF and downstream
  // traces show exactly which indent item the line came from.
  indentItemDisplayNumber: { type: String, trim: true, default: '' },
  hsn:           { type: String, trim: true, default: '' }, // auto-filled from Vendor Master
  quantity:      { type: Number, required: true, min: 0 },
  unit:          { type: String, trim: true, default: 'Pcs' },
  rate:          { type: Number, default: 0, min: 0 },
  gstRate:       { type: Number, default: 0, min: 0, max: 100 },
  taxableAmount: { type: Number, default: 0, min: 0 }, // qty × rate (server-computed)
  taxAmount:     { type: Number, default: 0, min: 0 }, // taxable × gst% (server-computed)
  totalAmount:   { type: Number, default: 0, min: 0 },

  // JSL-format fields (additive — empty/zero for OTHER items).
  grade:           { type: String, trim: true, default: '' },
  width:           { type: String, trim: true, default: '' },
  finish:          { type: String, trim: true, default: '' },
  baseRate:        { type: Number, default: 0, min: 0 },
  upfrontDiscount: { type: Number, default: 0, min: 0 },
  bonanzaDiscount: { type: Number, default: 0, min: 0 },
  finalPrice:      { type: Number, default: 0 }, // baseRate − upfront − bonanza (server-computed)
  value:           { type: Number, default: 0 }, // quantity × finalPrice (server-computed)

  // Future GRN linkage
  receivedQty:   { type: Number, default: 0, min: 0 },
  pendingQty:    { type: Number, default: 0, min: 0 },
}, { _id: true });

const vendorPurchaseOrderSchema = new Schema({
  ...baseSchemaFields,

  // ── Header ──
  // poNumber is assigned only on approval (generateVendorPoNumber) so the final
  // sequence follows approval order, not draft-creation order — sparse because
  // many DRAFT POs simultaneously have no poNumber yet.
  poNumber: { type: String, unique: true, sparse: true, trim: true, index: true }, // auto: AGL/PO-001/26-27
  // Temporary reference assigned at draft creation (generateVendorPoDraftNumber)
  // — never consumes the final poNumber sequence.
  draftNumber: { type: String, trim: true, default: '', index: true }, // e.g. DRAFT-001/26-27
  poDate:   { type: Date, default: Date.now },

  // PO format / layout. Existing records default to OTHER.
  poFormatType: { type: String, enum: Object.values(PO_FORMAT_TYPE), default: PO_FORMAT_TYPE.OTHER },

  // Indent linkage (mandatory — POs are never standalone).
  // indentId / indentNumber hold the PRIMARY (first) indent for backward
  // compatibility; indentIds / indentNumbers hold every indent a multi-indent PO
  // draws items from (a single-indent PO has one entry each).
  indentId:     { type: Schema.Types.ObjectId, ref: 'PurchaseIndent', required: true, index: true },
  indentNumber: { type: String, trim: true, index: true },
  indentIds:    { type: [{ type: Schema.Types.ObjectId, ref: 'PurchaseIndent' }], default: [], index: true },
  indentNumbers:{ type: [{ type: String, trim: true }], default: [] },

  // Vendor reference — polymorphic by design: NEW POs store a Vendor-master id,
  // legacy POs store a Party id. Resolved via resolveVendor() in the service, so
  // this is intentionally never populated (no static `ref`). The vendor* fields
  // below are snapshotted at PO time so the PO stays immutable history either way.
  vendorId:      { type: Schema.Types.ObjectId, required: true, index: true },
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
  finalMaterialDate:    { type: Date, default: null }, // confirmed delivery date — gates GRN
  expectedDeliveryDate: { type: Date, default: null }, // releasedAt + leadTime days

  // ── Step 1.6 — proforma invoice linkage (additive) ──
  piStatus:     { type: String, enum: Object.values(PO_PI_STATUS), default: PO_PI_STATUS.NOT_RECEIVED, index: true },
  piId:         { type: Schema.Types.ObjectId, ref: 'ProformaInvoice', default: null },
  piNumber:     { type: String, trim: true, default: '' },
  piReceivedAt: { type: Date, default: null },

  // ── Step 1.7 — advance payment lifecycle ──
  advancePaymentStatus: { type: String, enum: Object.values(PO_ADVANCE_PAYMENT_STATUS), default: PO_ADVANCE_PAYMENT_STATUS.NOT_STARTED, index: true },

  // ── Revision linkage (created via "Revise PO" on a cancelled PO) ──
  // The new PO points back to the cancelled one it was revised from; the cancelled
  // PO itself is never mutated (the "revised as" link is resolved by query).
  revisedFromPoId:     { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder', default: null, index: true },
  revisedFromPoNumber: { type: String, trim: true, default: '' },
  revisionNo:          { type: Number, default: 0 }, // 0 = original, 1 = first revision, …

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
