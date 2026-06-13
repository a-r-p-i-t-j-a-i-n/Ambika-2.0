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
  PO_READY:               'PO_READY',
  CLOSED:                 'CLOSED',
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

// Step 1.2 — Receive Quote & Make Comparative (with file upload)
const quoteComparativeStepSchema = new Schema({
  stepNo:     { type: String, default: 'Step 1.2' },
  stepName:   { type: String, default: 'Receive Quote & Make Comparative 1.02' },
  statusDone: { type: String, enum: ['YES', 'QUOTE_NOT_REQUIRED'], default: null },
  quotationUploaded: {
    fileName:   { type: String, default: '' },
    fileUrl:    { type: String, default: '' },
    fileType:   { type: String, default: '' },
    uploadedAt: { type: Date, default: null },
  },
  actualAt:   { type: Date, default: null },
  updatedBy:  { type: Schema.Types.ObjectId, ref: 'User' },
  remarks:    { type: String, trim: true, default: '' },
}, { _id: false });

// Step 1.3 — Approved Quotation 1.03 (with approved-quotation file upload)
const quotationApprovalStepSchema = new Schema({
  stepNo:     { type: String, default: 'Step 1.3' },
  stepName:   { type: String, default: 'Approved Quotation 1.03' },
  statusDone: { type: String, enum: ['YES', 'QUOTATION_NOT_APPROVED'], default: null },
  approvedQuotation: {
    fileName:   { type: String, default: '' },
    fileUrl:    { type: String, default: '' },
    fileType:   { type: String, default: '' },
    uploadedAt: { type: Date, default: null },
  },
  actualAt:   { type: Date, default: null },
  updatedBy:  { type: Schema.Types.ObjectId, ref: 'User' },
  remarks:    { type: String, trim: true, default: '' },
}, { _id: false });

const indentSchema = new Schema({
  ...baseSchemaFields,

  indentNumber: { type: String, unique: true, trim: true, index: true }, // auto: Ind-1/24-25
  timestamp:    { type: Date, default: Date.now }, // when the indent was raised

  // ── Line / item ──
  productNameRevised: { type: String, required: [true, 'Product name is required'], trim: true },
  skuCode:            { type: String, trim: true, uppercase: true, default: '' },
  skuId:              { type: Schema.Types.ObjectId, ref: 'SKU' }, // optional link to SKU master
  quantity:           { type: Number, required: [true, 'Quantity is required'], min: 0 },
  unit:               { type: String, required: [true, 'Unit is required'], trim: true, default: 'Pcs' },

  // ── Raised by / department ──
  raisedBy:    { type: String, trim: true },                 // name as entered on the form
  raisedById:  { type: Schema.Types.ObjectId, ref: 'User' }, // resolved from req.user when available
  department:  { type: String, trim: true, default: '' },    // Stores | Production | QC | Admin

  // ── Approval ──
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
indentSchema.index({ indentNumber: 'text', productNameRevised: 'text', skuCode: 'text', raisedBy: 'text' });
indentSchema.index({ department: 1, approvalStatus: 1 });
indentSchema.index({ overallStatus: 1, createdAt: -1 });

const PurchaseIndent = model('PurchaseIndent', indentSchema);
export default PurchaseIndent;
