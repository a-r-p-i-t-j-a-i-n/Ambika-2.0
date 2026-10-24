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

// Invoice line item — sourced from the QC (received/accepted/rejected) with
// rate/GST from the PO. All amounts are recomputed server-side.
export const INVOICE_VARIANCE_STATUS = {
  MATCHED: 'MATCHED',
  SHORT:   'SHORT',
  EXCESS:  'EXCESS',
};

const invoiceItemSchema = new Schema({
  // ── Source GRN / QC (multi-GRN invoices — which GRN/QC this line came from) ──
  grnId:     { type: Schema.Types.ObjectId, ref: 'GoodsReceiptNote' },
  grnNumber: { type: String, trim: true, default: '' },
  qcId:      { type: Schema.Types.ObjectId, ref: 'IncomingQC' },
  qcNumber:  { type: String, trim: true, default: '' },
  // The exact QC line (and its GRN line) this invoice line bills. A GRN can carry
  // the same SKU on several lines (coils / batches), so qcId + SKU is not unique.
  // Absent on invoices created before line-level refs — those fall back to
  // qcId + SKU matching (see vendorInvoice.service.js resolveInvoicedByLine).
  qcItemId:  { type: Schema.Types.ObjectId, default: null },
  grnItemId: { type: Schema.Types.ObjectId, default: null },
  batchNo:   { type: String, trim: true, default: '' },

  skuId:   { type: Schema.Types.ObjectId, ref: 'SKU' },
  skuCode:  { type: String, trim: true, uppercase: true, default: '' },
  itemName: { type: String, trim: true, default: '' },
  unit:     { type: String, trim: true, default: 'Pcs' },
  // ── Order-vs-received comparison (server-computed) ──
  orderedQty:        { type: Number, default: 0, min: 0 }, // PO ordered qty
  grnReceivedQty:    { type: Number, default: 0, min: 0 }, // GRN received qty
  receivedQty:       { type: Number, default: 0, min: 0 }, // QC received (= GRN received)
  acceptedQty:       { type: Number, default: 0, min: 0 }, // QC accepted
  rejectedQty:       { type: Number, default: 0, min: 0 }, // QC rejected
  alreadyInvoicedQty:{ type: Number, default: 0, min: 0 }, // invoiced on prior invoices
  pendingInvoiceQty: { type: Number, default: 0, min: 0 }, // accepted − alreadyInvoiced
  invoiceQty:     { type: Number, default: 0, min: 0 }, // ≤ pendingInvoiceQty unless overridden
  varianceQty:    { type: Number, default: 0 },         // invoiceQty − acceptedQty
  varianceStatus: { type: String, enum: Object.values(INVOICE_VARIANCE_STATUS), default: INVOICE_VARIANCE_STATUS.MATCHED },
  rate:        { type: Number, default: 0, min: 0 },
  gstRate:     { type: Number, default: 0, min: 0, max: 100 },
  taxableAmount: { type: Number, default: 0, min: 0 }, // invoiceQty × rate
  gstAmount:     { type: Number, default: 0, min: 0 }, // taxable × gst%
  totalAmount:   { type: Number, default: 0, min: 0 }, // taxable + gst
  remarks:  { type: String, trim: true, default: '' },
}, { _id: true });

const vendorInvoiceSchema = new Schema({
  ...baseSchemaFields,

  // Supplier's invoice number (entered, not auto).
  invoiceNumber:       { type: String, required: [true, 'Invoice number is required'], trim: true, index: true },
  // Uniqueness key: the vendor invoice number normalised (normalizeInvoiceNumber).
  // Present only while the invoice is LIVE (not rejected / deleted) and was
  // created or renamed under the one-number-per-vendor rule — maintained by
  // syncInvoiceNumberKey below, never sent by clients. Invoices recorded before
  // the rule carry no key, so existing duplicates stay editable while their
  // number is unchanged.
  invoiceNumberKey:    { type: String, default: undefined },
  invoiceDate:         { type: Date, default: null },
  invoiceReceivedDate: { type: Date, default: Date.now },

  // ── Linkage (QC → GRN → PO → PI → Vendor) ──
  // Legacy single refs (kept in sync = first selected QC/GRN for back-compat).
  qcId:       { type: Schema.Types.ObjectId, ref: 'IncomingQC', required: true, index: true },
  qcNumber:   { type: String, trim: true, default: '' },
  grnId:      { type: Schema.Types.ObjectId, ref: 'GoodsReceiptNote' },
  grnNumber:  { type: String, trim: true, default: '' },
  // Multi-GRN: all selected QCs / GRNs on this invoice (same vendor + same PO).
  qcIds:      { type: [{ type: Schema.Types.ObjectId, ref: 'IncomingQC' }], default: [] },
  qcNumbers:  { type: [String], default: [] },
  grnIds:     { type: [{ type: Schema.Types.ObjectId, ref: 'GoodsReceiptNote' }], default: [] },
  grnNumbers: { type: [String], default: [] },
  poId:       { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder' },
  poNumber:   { type: String, trim: true, default: '' },
  piId:       { type: Schema.Types.ObjectId, ref: 'ProformaInvoice' },
  piNumber:   { type: String, trim: true, default: '' },
  vendorId:   { type: Schema.Types.ObjectId, ref: 'Party', index: true },
  vendorName: { type: String, trim: true, default: '' },
  vendorGST:  { type: String, trim: true, default: '' },
  vendorAddress: { type: String, trim: true, default: '' },

  // ── Line items (sourced from QC, priced from PO) ──
  items: { type: [invoiceItemSchema], default: [] },

  // ── Financials (recomputed from items when present) ──
  invoiceAmount:    { type: Number, default: 0, min: 0 }, // gross invoice value
  taxableAmount:    { type: Number, default: 0, min: 0 },
  gstAmount:        { type: Number, default: 0, min: 0 },
  tdsAmount:        { type: Number, default: 0, min: 0 },
  otherCharges:     { type: Number, default: 0 },
  // PI advance ALLOCATED to this invoice: min(PI advance still unallocated, invoice − debit note).
  // Across a PI's live (non-rejected) invoices these never sum past PI.paidAmount.
  advancePaid:      { type: Number, default: 0, min: 0 },
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

/** Vendor invoice number as compared for uniqueness: trimmed, case-insensitive. */
export const normalizeInvoiceNumber = (n) => String(n ?? '').trim().toLowerCase();

/**
 * Would saving `next` change the stored invoice number? Any change counts —
 * case-only too ("inv-1" → "INV-1"), since that re-keys the invoice and must be
 * validated like any rename. Whitespace around it is trimmed by the schema, so
 * it never counts. `next` null / undefined = number not being sent.
 */
export const invoiceNumberChanged = (current, next) =>
  next != null && String(next).trim() !== String(current ?? '').trim();

/**
 * Keep invoiceNumberKey in step with the document (runs on every save):
 *   rejected / deleted / no vendor → no key (the number is free again)
 *   new, or number / vendor changed → key = normalised number
 *   otherwise                       → unchanged (an older invoice stays unkeyed)
 *
 * The removal is always sent as $unset — markModified, because a document
 * loaded WITHOUT a key (an older invoice) sees `undefined → undefined` as no
 * change and would send nothing, leaving a key written to the database after
 * the load (e.g. by a backfill) on a rejected / deleted invoice, which would
 * keep blocking that number.
 */
export const syncInvoiceNumberKey = (doc) => {
  const live = !doc.isDeleted && doc.invoiceStatus !== INVOICE_STATUS.REJECTED;
  if (!live || !doc.vendorId) {
    doc.invoiceNumberKey = undefined;
    doc.markModified('invoiceNumberKey');
  } else if (doc.isNew || doc.isModified('invoiceNumber') || doc.isModified('vendorId')) {
    doc.invoiceNumberKey = normalizeInvoiceNumber(doc.invoiceNumber);
  }
};

vendorInvoiceSchema.pre('save', function (next) {
  syncInvoiceNumberKey(this);
  next();
});

// Atomic "one live invoice number per vendor" guarantee — enforced by MongoDB on
// every write, so two concurrent creates / renames with the same number can never
// both succeed (one gets a duplicate-key error, mapped to a validation message in
// vendorInvoice.service.js). The service's findOne pre-check stays as the friendly
// first line and the only check against older, unkeyed invoices. Partial: only
// keyed (live) invoices are indexed — same pattern as the Follow-up active index.
vendorInvoiceSchema.index(
  { vendorId: 1, invoiceNumberKey: 1 },
  {
    name: 'uniq_live_vendor_invoice_number',
    unique: true,
    partialFilterExpression: { invoiceNumberKey: { $type: 'string' } },
  },
);

const VendorInvoice = model('VendorInvoice', vendorInvoiceSchema);
export default VendorInvoice;
