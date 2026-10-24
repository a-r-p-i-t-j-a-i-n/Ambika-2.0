import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Generic Digital Approval & Signature engine (Purchase FMS).
 *
 * One row per (documentType, documentId) tracking a document's approval chain.
 * Only GRN and VOUCHER are wired up today (see approval.registry.js), but the
 * remaining document types are reserved so future modules can attach without a
 * schema change. `levels[]` models an ordered approval chain — today it's a
 * single MD level, but adding Dept Head → Purchase Manager → Finance → MD →
 * Accounts later is a data change to `levels`, not a redesign of this model.
 *
 * The parent document (GRN, Voucher, …) keeps its own small denormalized
 * `approvalStatus` mirror field (NOT_REQUIRED | READY_FOR_MD_APPROVAL |
 * MD_APPROVED) for fast list/gate checks — this collection is the append-only
 * source of truth, including the full audit history.
 */

export const APPROVAL_DOCUMENT_TYPE = {
  GRN:            'GRN',
  VOUCHER:        'VOUCHER',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  VENDOR_INVOICE: 'VENDOR_INVOICE',
  INCOMING_QC:    'INCOMING_QC',
  TALLY_ENTRY:    'TALLY_ENTRY',
  FINAL_PAYMENT:  'FINAL_PAYMENT',
  // Advance payment gate — the PI's MD approval (see proformaInvoice.service.js).
  PROFORMA_INVOICE: 'PROFORMA_INVOICE',
};

export const APPROVAL_STATUS = {
  READY_FOR_APPROVAL: 'READY_FOR_APPROVAL',
  APPROVED:            'APPROVED',
  REJECTED:            'REJECTED', // reserved for future use
};

export const APPROVAL_HISTORY_ACTION = {
  SIGNED:             'SIGNED',
  SIGNATURE_REPLACED: 'SIGNATURE_REPLACED',
  SIGNATURE_REMOVED:  'SIGNATURE_REMOVED',
};

// How the signature image was captured — drawn on the pad vs. an uploaded
// existing signature file. Both are normalized client-side to a PNG data URL
// before reaching the backend, so the sign/replace pipeline and PDF embedding
// never need to distinguish between them; this is stored purely for audit.
export const APPROVAL_SIGNATURE_TYPE = {
  DRAWN:    'DRAWN',
  UPLOADED: 'UPLOADED',
};

const approvalLevelSchema = new Schema({
  order:   { type: Number, required: true },
  roleKey: { type: String, required: true, trim: true, uppercase: true },
  label:   { type: String, trim: true, default: '' },
}, { _id: false });

const approvalHistorySchema = new Schema({
  action:            { type: String, enum: Object.values(APPROVAL_HISTORY_ACTION), required: true },
  levelOrder:        { type: Number, default: 1 },
  roleKey:           { type: String, trim: true, default: '' },
  actorId:           { type: Schema.Types.ObjectId, ref: 'User' },
  actorName:         { type: String, trim: true, default: '' },
  designation:       { type: String, trim: true, default: '' },
  signatureImageUrl: { type: String, trim: true, default: '' },
  signatureType:     { type: String, enum: Object.values(APPROVAL_SIGNATURE_TYPE) },
  signatureVersion:  { type: Number, default: 0 },
  pdfSnapshotUrl:    { type: String, trim: true, default: '' },
  previousPdfUrl:    { type: String, trim: true, default: '' },
  reason:            { type: String, trim: true, default: '' },
  timestamp:         { type: Date, default: Date.now },
}, { _id: false });

const documentApprovalSchema = new Schema({
  ...baseSchemaFields,

  documentType:   { type: String, enum: Object.values(APPROVAL_DOCUMENT_TYPE), required: true, index: true },
  documentId:     { type: Schema.Types.ObjectId, required: true, index: true },
  documentNumber: { type: String, trim: true, default: '' },

  // Ordered approval chain — single MD level by default (see registry defaults).
  levels: {
    type: [approvalLevelSchema],
    default: () => [{ order: 1, roleKey: 'MD', label: 'Managing Director' }],
  },
  currentLevelOrder: { type: Number, default: 1 },

  status: { type: String, enum: Object.values(APPROVAL_STATUS), default: APPROVAL_STATUS.READY_FOR_APPROVAL, index: true },

  signedByUserId:    { type: Schema.Types.ObjectId, ref: 'User' },
  signedByName:      { type: String, trim: true, default: '' },
  designation:       { type: String, trim: true, default: '' },
  signatureImageUrl: { type: String, trim: true, default: '' },
  signatureType:     { type: String, enum: Object.values(APPROVAL_SIGNATURE_TYPE) },
  signatureVersion:  { type: Number, default: 0 },
  signedAt:          { type: Date, default: null },

  // Snapshot taken the moment the document became ready — preserved forever.
  unsignedPdfUrl:      { type: String, trim: true, default: '' },
  unsignedPdfFileName: { type: String, trim: true, default: '' },
  // Latest signed version — regenerated on sign/replace.
  signedPdfUrl:        { type: String, trim: true, default: '' },
  signedPdfFileName:   { type: String, trim: true, default: '' },

  // Append-only audit trail — never overwritten, only pushed to.
  history: { type: [approvalHistorySchema], default: [] },
}, baseSchemaOptions);

documentApprovalSchema.index({ documentType: 1, documentId: 1 }, { unique: true });

const DocumentApproval = model('DocumentApproval', documentApprovalSchema);
export default DocumentApproval;
