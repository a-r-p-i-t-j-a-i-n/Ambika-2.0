import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * PO Rate Change Request (Purchase FMS — Rate Change Approvals).
 *
 * Raised by the server when a PO line's rate differs from the vendor's rate in
 * the Vendor Master (the authoritative source: Vendor.products[] — one row per
 * vendor + SKU, so two vendors can carry the same SKU at different rates). The
 * draft PO keeps the proposed rate, but the PO cannot be approved and the
 * vendor's rate is not touched until an approver decides here.
 *
 *   PENDING → APPROVED   vendor rate + PO line updated together
 *   PENDING → REJECTED   vendor rate untouched; draft line reset to the vendor rate
 *   PENDING → WITHDRAWN  the PO line changed / was removed, or the PO was
 *                        deleted, cancelled, rejected or is no longer a draft
 *
 * This document holds the request's CURRENT state. Every event is also written,
 * append-only, to RateChangeHistory — the audit trail never changes.
 */
export const RATE_CHANGE_STATUS = {
  PENDING:   'PENDING',
  APPROVED:  'APPROVED',
  REJECTED:  'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
};

// A snapshot of the vendor-rate source (one Vendor.products[] row).
const vendorSourceSchema = new Schema({
  vendorProductId: { type: Schema.Types.ObjectId, default: null },
  rate:            { type: Number, default: null },
  unit:            { type: String, trim: true, default: '' },
  lastUpdatedAt:   { type: Date, default: null },
}, { _id: false });

const rateChangeRequestSchema = new Schema({
  requestNumber: { type: String, required: true, unique: true, trim: true }, // RC-001/26-27
  status: { type: String, enum: Object.values(RATE_CHANGE_STATUS), default: RATE_CHANGE_STATUS.PENDING, index: true },

  // Vendor + item (the rate source being changed).
  vendorId:        { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
  vendorName:      { type: String, trim: true, default: '' },
  vendorProductId: { type: Schema.Types.ObjectId, default: null }, // Vendor.products[]._id
  skuId:    { type: Schema.Types.ObjectId, ref: 'SKU', default: null },
  skuCode:  { type: String, trim: true, uppercase: true, default: '' },
  itemName: { type: String, trim: true, default: '' },
  unit:     { type: String, trim: true, default: '' }, // the PO line's unit (= the vendor rate's unit)
  currency: { type: String, trim: true, default: 'INR' },

  // Rates.
  existingVendorRate: { type: Number, default: null }, // Vendor Master rate when the request was raised
  originalPoRate:     { type: Number, default: null }, // the line's rate before this change
  requestedRate:      { type: Number, required: true, min: 0 },
  gstRate:  { type: Number, default: 0 },
  quantity: { type: Number, default: 0 },

  // Related documents.
  poId:     { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder', required: true, index: true },
  poRef:    { type: String, trim: true, default: '' }, // draft number, later the PO number
  poLineId: { type: Schema.Types.ObjectId, required: true },
  indentId:     { type: Schema.Types.ObjectId, ref: 'PurchaseIndent', default: null },
  indentNumber: { type: String, trim: true, default: '' },
  indentItemId: { type: Schema.Types.ObjectId, default: null },
  indentItemDisplayNumber: { type: String, trim: true, default: '' },
  quotationPath: { type: String, trim: true, default: '' }, // REQUIRED | NOT_REQUIRED (itemVendor.js)

  // Request.
  reason:          { type: String, trim: true, required: true },
  requestedBy:     { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  requestedByName: { type: String, trim: true, default: '' },
  requestedAt:     { type: Date, default: Date.now },

  // Decision.
  decidedBy:       { type: Schema.Types.ObjectId, ref: 'User', default: null },
  decidedByName:   { type: String, trim: true, default: '' },
  decidedAt:       { type: Date, default: null },
  decisionRemarks: { type: String, trim: true, default: '' },
  rejectionReason: { type: String, trim: true, default: '' },
  withdrawnReason: { type: String, trim: true, default: '' },
  selfApproved:    { type: Boolean, default: false }, // the MD approving their own request

  // Vendor-rate source before / after the approval.
  vendorSourceBefore: { type: vendorSourceSchema, default: null },
  vendorSourceAfter:  { type: vendorSourceSchema, default: null },

  // Last failed approval attempt (stale vendor rate) — shown to the approver.
  lastConflict: {
    at:                { type: Date, default: null },
    message:           { type: String, trim: true, default: '' },
    currentVendorRate: { type: Number, default: null },
  },
}, { timestamps: true });

// One open request per PO line: a duplicate submit can never raise two.
rateChangeRequestSchema.index(
  { poId: 1, poLineId: 1 },
  { unique: true, partialFilterExpression: { status: RATE_CHANGE_STATUS.PENDING }, name: 'one_pending_per_po_line' },
);
rateChangeRequestSchema.index({ status: 1, requestedAt: -1 });
rateChangeRequestSchema.index({ vendorId: 1, skuCode: 1, requestedAt: -1 });

const RateChangeRequest = model('RateChangeRequest', rateChangeRequestSchema);
export default RateChangeRequest;
