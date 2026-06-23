import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';

const { Schema, model } = mongoose;

// ── Status enums (Purchase Indent FMS) ──────────────────────────
export const INDENT_APPROVAL_STATUS = {
  DRAFT:            'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED:         'APPROVED',
  REJECTED:         'REJECTED',
};

export const INDENT_OVERALL_STATUS = {
  INDENT_GENERATED:       'INDENT_GENERATED',
  INDENT_APPROVED:        'INDENT_APPROVED',
  QUOTE_PENDING:          'QUOTE_PENDING',
  QUOTE_RECEIVED:         'QUOTE_RECEIVED',
  QUOTE_NOT_REQUIRED:     'QUOTE_NOT_REQUIRED',
  QUOTATION_APPROVED:     'QUOTATION_APPROVED',
  QUOTATION_NOT_APPROVED: 'QUOTATION_NOT_APPROVED',
  PARTIAL_PO_CREATED:     'PARTIAL_PO_CREATED', // some (not all) approved vendors POed
  PO_READY:               'PO_READY',
  // Internal-service flow (no PO/PI/GRN): quotation approved → service pending →
  // service completed (QC-eligible) → service QC result → closed.
  SERVICE_PENDING:        'SERVICE_PENDING',
  SERVICE_COMPLETED:      'SERVICE_COMPLETED',
  SERVICE_QC_PASSED:      'SERVICE_QC_PASSED',
  SERVICE_QC_FAILED:      'SERVICE_QC_FAILED',
  SERVICE_QC_PARTIAL:     'SERVICE_QC_PARTIAL',
  CLOSED:                 'CLOSED',
};

// Material purchase vs internal service / asset request.
export const INDENT_REQUEST_TYPE = {
  MATERIAL_PURCHASE: 'MATERIAL_PURCHASE',
  INTERNAL_SERVICE:  'INTERNAL_SERVICE',
};

export const QUOTE_STEP_STATUS = {
  PENDING:      'PENDING',
  RECEIVED:     'RECEIVED',
  NOT_REQUIRED: 'NOT_REQUIRED',
};

// Step 1.3 — Approved Quotation. statusDone values.
export const QUOTATION_APPROVAL_STATUS = {
  YES:          'YES',
  NOT_APPROVED: 'QUOTATION_NOT_APPROVED',
};

// Step 1.2 — per-vendor quotation status (multi-vendor comparative).
export const VENDOR_QUOTE_STATUS = {
  PENDING:      'PENDING',
  RECEIVED:     'RECEIVED',
  NOT_RECEIVED: 'NOT_RECEIVED',
  NOT_REQUIRED: 'NOT_REQUIRED',
};

// Reusable uploaded-document sub-schema (file metadata only).
const fileSchema = new Schema({
  fileName:   { type: String, default: '' },
  fileUrl:    { type: String, default: '' },
  fileType:   { type: String, default: '' },
  uploadedAt: { type: Date, default: null },
}, { _id: false });

// ── Workflow sub-steps ──────────────────────────────────────────
const quoteStepSchema = new Schema({
  plannedAt:          { type: Date, default: null },
  actualAt:           { type: Date, default: null },
  status:             { type: String, enum: Object.values(QUOTE_STEP_STATUS), default: QUOTE_STEP_STATUS.PENDING },
  quotationUploaded:  { type: Boolean, default: false },
  formLink:           { type: String, trim: true, default: '' },
  timeDelay:          { type: String, default: '' },
  remarks:            { type: String, trim: true, default: '' },
}, { _id: false });

// Step 1.2 — per-vendor quoted line item.
const vendorQuoteItemSchema = new Schema({
  skuId:        { type: Schema.Types.ObjectId, ref: 'SKU' },
  skuCode:      { type: String, trim: true, uppercase: true, default: '' },
  itemName:     { type: String, trim: true, default: '' },
  unit:         { type: String, trim: true, default: 'Pcs' },
  requestedQty: { type: Number, default: 0, min: 0 },
  quotedRate:   { type: Number, default: 0, min: 0 },
  gstRate:      { type: Number, default: 0, min: 0 },
  deliveryDays: { type: Number, default: 0, min: 0 },
  paymentTerms: { type: String, trim: true, default: '' },
  remarks:      { type: String, trim: true, default: '' },
  totalAmount:  { type: Number, default: 0, min: 0 }, // (requestedQty*quotedRate) + GST
}, { _id: false });

// Step 1.2 — one vendor's quotation (document + item-wise rates).
const vendorQuoteSchema = new Schema({
  vendorId:        { type: Schema.Types.ObjectId, ref: 'Party' },
  vendorName:      { type: String, trim: true, default: '' },
  vendorEmail:     { type: String, trim: true, lowercase: true, default: '' },
  vendorPhone:     { type: String, trim: true, default: '' },
  quotationStatus: { type: String, enum: Object.values(VENDOR_QUOTE_STATUS), default: VENDOR_QUOTE_STATUS.PENDING },
  quotationDocument: { type: fileSchema, default: () => ({}) },
  items:               { type: [vendorQuoteItemSchema], default: [] },
  totalQuotationValue: { type: Number, default: 0, min: 0 },
  remarks:             { type: String, trim: true, default: '' },
}, { _id: true });

// Step 1.2 — Receive Quote & Make Comparative (with file upload)
const quoteComparativeStepSchema = new Schema({
  stepNo:     { type: String, default: 'Step 1.2' },
  stepName:   { type: String, default: 'Receive Quote & Make Comparative 1.02' },
  statusDone: { type: String, enum: ['YES', 'QUOTE_NOT_REQUIRED'], default: null },
  // Legacy single-quotation upload (back-compat — older records read from here;
  // mirrors the first entry of quotationDocuments).
  quotationUploaded: {
    fileName:   { type: String, default: '' },
    fileUrl:    { type: String, default: '' },
    fileType:   { type: String, default: '' },
    uploadedAt: { type: Date, default: null },
  },
  // Simple multi-file upload — one or more quotation documents.
  quotationDocuments: { type: [fileSchema], default: [] },
  // Multi-vendor comparative — one entry per selected vendor.
  vendors:    { type: [vendorQuoteSchema], default: [] },
  actualAt:   { type: Date, default: null },
  updatedBy:  { type: Schema.Types.ObjectId, ref: 'User' },
  remarks:    { type: String, trim: true, default: '' },
}, { _id: false });

// Step 1.3 — per-vendor approved line item.
const approvedVendorItemSchema = new Schema({
  skuId:       { type: Schema.Types.ObjectId, ref: 'SKU' },
  skuCode:     { type: String, trim: true, uppercase: true, default: '' },
  itemName:    { type: String, trim: true, default: '' },
  unit:        { type: String, trim: true, default: 'Pcs' },
  approvedQty: { type: Number, default: 0, min: 0 },
  approvedRate:{ type: Number, default: 0, min: 0 },
  gstRate:     { type: Number, default: 0, min: 0 },
  totalAmount: { type: Number, default: 0, min: 0 },
}, { _id: false });

// Step 1.3 — one approved vendor (source for PO creation).
const approvedVendorSchema = new Schema({
  vendorId:    { type: Schema.Types.ObjectId, ref: 'Party' },
  vendorName:  { type: String, trim: true, default: '' },
  items:       { type: [approvedVendorItemSchema], default: [] },
  approvedQuotationDocument: { type: fileSchema, default: () => ({}) },
  approvalRemarks: { type: String, trim: true, default: '' },
  // Linkage once a PO has been raised for this vendor (one PO per approved vendor).
  poId:        { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder', default: null },
  poNumber:    { type: String, trim: true, default: '' },
}, { _id: true });

// Step 1.3 — Approved Quotation 1.03 (with approved-quotation file upload)
const quotationApprovalStepSchema = new Schema({
  stepNo:     { type: String, default: 'Step 1.3' },
  stepName:   { type: String, default: 'Approved Quotation 1.03' },
  statusDone: { type: String, enum: ['YES', 'QUOTATION_NOT_APPROVED'], default: null },
  // Set when Step 1.2 was marked QUOTE_NOT_REQUIRED — Step 1.3 is skipped and the
  // indent goes straight to PO/service eligibility without an approval upload.
  skipped:    { type: Boolean, default: false },
  // Legacy single approved-quotation upload (back-compat — mirrors the first
  // entry of approvedQuotationDocuments).
  approvedQuotation: {
    fileName:   { type: String, default: '' },
    fileUrl:    { type: String, default: '' },
    fileType:   { type: String, default: '' },
    uploadedAt: { type: Date, default: null },
  },
  // Simple multi-file upload — one or more approved-quotation documents.
  approvedQuotationDocuments: { type: [fileSchema], default: [] },
  // Multi-vendor approval — one or more approved vendors / item-wise splits.
  approvedVendors: { type: [approvedVendorSchema], default: [] },
  actualAt:   { type: Date, default: null },
  updatedBy:  { type: Schema.Types.ObjectId, ref: 'User' },
  remarks:    { type: String, trim: true, default: '' },
}, { _id: false });

// ── Indent line item (multi-item indent) ───────────────────────
const indentItemSchema = new Schema({
  skuId:    { type: Schema.Types.ObjectId, ref: 'SKU' }, // optional link to SKU master
  skuCode:  { type: String, trim: true, uppercase: true, default: '' },
  itemName: { type: String, required: [true, 'Product name is required'], trim: true },
  quantity: { type: Number, required: [true, 'Quantity is required'], min: 0 },
  unit:     { type: String, trim: true, default: 'Pcs' },
  // Set per-item during approval.
  revisedQuantity:  { type: Number, default: 0, min: 0 },
  approvedQuantity: { type: Number, default: 0, min: 0 },
  remarks:  { type: String, trim: true, default: '' },
}, { _id: true });

const indentSchema = new Schema({
  ...baseSchemaFields,

  indentNumber: { type: String, unique: true, trim: true, index: true }, // auto: Ind-1/24-25
  timestamp:    { type: Date, default: Date.now }, // when the indent was raised

  // Material purchase (full PO/PI/GRN flow) vs internal service/asset (no PO/PI/GRN).
  requestType:  { type: String, enum: Object.values(INDENT_REQUEST_TYPE), default: INDENT_REQUEST_TYPE.MATERIAL_PURCHASE, index: true },

  // ── Items (source of truth) ──
  items: { type: [indentItemSchema], default: [] },

  // ── Legacy single-product mirror (kept in sync from items[0] + aggregates) ──
  // Retained for backward compatibility, text search and any older reads — the
  // multi-item `items[]` array above is authoritative.
  productNameRevised: { type: String, trim: true, default: '' },
  skuCode:            { type: String, trim: true, uppercase: true, default: '' },
  skuId:              { type: Schema.Types.ObjectId, ref: 'SKU' },
  quantity:           { type: Number, min: 0, default: 0 },
  unit:               { type: String, trim: true, default: 'Pcs' },

  // ── Raised by / department ──
  raisedBy:    { type: String, trim: true },                 // name as entered on the form
  raisedById:  { type: Schema.Types.ObjectId, ref: 'User' }, // resolved from req.user when available
  department:  { type: String, trim: true, default: '' },    // Stores | Production | QC | Admin
  remarks:     { type: String, trim: true, default: '' },    // indent header remarks

  // ── Approval (aggregate mirror of per-item quantities) ──
  revisedQuantity:  { type: Number, default: 0, min: 0 },
  approvedQuantity: { type: Number, default: 0, min: 0 },
  approvalStatus:   { type: String, enum: Object.values(INDENT_APPROVAL_STATUS), default: INDENT_APPROVAL_STATUS.DRAFT, index: true },
  approval: {
    approvedBy:   { type: String, trim: true, default: '' },
    approvedById: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt:   { type: Date, default: null },
    remarks:      { type: String, trim: true, default: '' },
  },

  // ── Vendor link (Party = Vendor in Purchase FMS) ──
  vendorId:   { type: Schema.Types.ObjectId, ref: 'Party' },
  vendorName: { type: String, trim: true, default: '' },

  // ── Quote + quotation-approval workflow ──
  quoteStep:             { type: quoteStepSchema, default: () => ({}) },
  quoteComparativeStep:  { type: quoteComparativeStepSchema, default: () => ({}) }, // Step 1.2
  quotationApprovalStep: { type: quotationApprovalStepSchema, default: () => ({}) },

  // ── Master status ──
  overallStatus: { type: String, enum: Object.values(INDENT_OVERALL_STATUS), default: INDENT_OVERALL_STATUS.INDENT_GENERATED, index: true },

}, baseSchemaOptions);

// ── Indexes ──────────────────────────────────────────────────
indentSchema.index({ indentNumber: 'text', productNameRevised: 'text', skuCode: 'text', raisedBy: 'text', 'items.itemName': 'text', 'items.skuCode': 'text' });
indentSchema.index({ department: 1, approvalStatus: 1 });
indentSchema.index({ overallStatus: 1, createdAt: -1 });

const PurchaseIndent = model('PurchaseIndent', indentSchema);
export default PurchaseIndent;
