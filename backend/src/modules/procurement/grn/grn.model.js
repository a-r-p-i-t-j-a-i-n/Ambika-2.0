import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Goods Receipt Note — Purchase FMS Step 1.8 (Receive Material / GRN).
 *
 * The first inventory-impacting module. A GRN can only be raised for a PO that
 * is READY_FOR_GRN (follow-up done) AND whose advance payment is complete.
 * On COMPLETE it increases stock via `inventoryService` (never touching the
 * inventory models directly), updates PO/PI received quantities, generates the
 * Goods Receiving & Inspection Report PDF, and sets qcStatus PENDING so the
 * future Incoming QC module (Step 1.9) can pick it up.
 */

export const GRN_STATUS = {
  DRAFT:            'DRAFT',
  RECEIVED:         'RECEIVED',
  PARTIAL_RECEIVED: 'PARTIAL_RECEIVED',
  FULLY_RECEIVED:   'FULLY_RECEIVED',
  CANCELLED:        'CANCELLED',
};

export const HOW_ITEM_RECEIVED = {
  FULL_MATERIAL_RECEIVED: 'FULL_MATERIAL_RECEIVED',
  PARTIAL_RECEIVED:       'PARTIAL_RECEIVED',
  EXTRA_RECEIVED:         'EXTRA_RECEIVED',
  DAMAGED_RECEIVED:       'DAMAGED_RECEIVED',
};

export const GRN_QC_STATUS = {
  PENDING:  'PENDING',  // ready for Step 1.9 Incoming QC
  PASSED:   'PASSED',
  FAILED:   'FAILED',
  PARTIAL:  'PARTIAL',
};

const grnDocumentSchema = new Schema({
  fileName:   { type: String, default: '' },
  fileUrl:    { type: String, default: '' },
  fileType:   { type: String, default: '' },
  uploadedAt: { type: Date, default: null },
}, { _id: false });

const grnItemSchema = new Schema({
  poItemId:   { type: Schema.Types.ObjectId }, // PO line _id (match-back)
  skuId:      { type: Schema.Types.ObjectId, ref: 'SKU' },
  skuCode:    { type: String, trim: true, uppercase: true, default: '' },
  itemName:   { type: String, required: true, trim: true },
  unit:       { type: String, trim: true, default: 'Pcs' },

  orderedQty:            { type: Number, default: 0, min: 0 }, // PO line qty
  previouslyReceivedQty: { type: Number, default: 0, min: 0 }, // before this GRN
  invoiceQty:            { type: Number, default: 0, min: 0 }, // vendor invoice/challan qty
  receivedQty:           { type: Number, required: true, min: 0 }, // physically received now
  shortQty:              { type: Number, default: 0 },         // invoiceQty - receivedQty
  extraQty:              { type: Number, default: 0, min: 0 }, // received beyond pending
  pendingQty:            { type: Number, default: 0, min: 0 }, // orderedQty - total received

  rate:    { type: Number, default: 0, min: 0 }, // unit cost (PO/PI rate)
  amount:  { type: Number, default: 0, min: 0 }, // receivedQty × rate
  batchNo: { type: String, trim: true, default: '' },
  remarks: { type: String, trim: true, default: '' },

  // Set after stock posting (back-reference to the ledger row).
  movementId:     { type: Schema.Types.ObjectId, ref: 'InventoryMovement' },
  movementNumber: { type: String, trim: true, default: '' },
}, { _id: true });

const grnSchema = new Schema({
  ...baseSchemaFields,

  grnNumber: { type: String, unique: true, trim: true, index: true }, // AGL/GRN-001/26-27
  uniqueId:  { type: String, trim: true, index: true },               // UID-1 (global)
  grnDate:   { type: Date, default: Date.now },

  // ── PO / PI / Indent linkage ──
  poId:         { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder', required: true, index: true },
  poNumber:     { type: String, trim: true, index: true },
  piId:         { type: Schema.Types.ObjectId, ref: 'ProformaInvoice' },
  piNumber:     { type: String, trim: true, default: '' },
  indentId:     { type: Schema.Types.ObjectId, ref: 'PurchaseIndent' },
  indentNumber: { type: String, trim: true, default: '' },

  // ── Vendor snapshot ──
  vendorId:      { type: Schema.Types.ObjectId, ref: 'Party', index: true },
  vendorName:    { type: String, trim: true, default: '' },
  vendorGST:     { type: String, trim: true, default: '' },
  vendorAddress: { type: String, trim: true, default: '' },
  vendorPhone:   { type: String, trim: true, default: '' },

  // ── Receipt header ──
  challanNumber: { type: String, trim: true, default: '' },
  invoiceNumber: { type: String, trim: true, default: '' },
  invoiceDate:   { type: Date, default: null },
  vehicleNumber: { type: String, trim: true, default: '' },
  receivedBy:    { type: String, trim: true, default: '' },
  preparedBy:    { type: String, trim: true, default: '' },
  warehouse:     { type: String, trim: true, default: 'MAIN' }, // inventory default warehouse
  howItemReceived: { type: String, enum: Object.values(HOW_ITEM_RECEIVED), default: HOW_ITEM_RECEIVED.FULL_MATERIAL_RECEIVED },

  // ── Lines & totals ──
  items: { type: [grnItemSchema], default: [] },
  totalOrderedQty:  { type: Number, default: 0, min: 0 },
  totalInvoiceQty:  { type: Number, default: 0, min: 0 },
  totalReceivedQty: { type: Number, default: 0, min: 0 },
  totalShortQty:    { type: Number, default: 0 },
  totalValue:       { type: Number, default: 0, min: 0 },

  // ── Status & QC handoff ──
  grnStatus:   { type: String, enum: Object.values(GRN_STATUS), default: GRN_STATUS.DRAFT, index: true },
  qcStatus:    { type: String, enum: Object.values(GRN_QC_STATUS), default: GRN_QC_STATUS.PENDING, index: true },
  // Step 1.9 — Incoming QC linkage (additive)
  qcId:          { type: Schema.Types.ObjectId, ref: 'IncomingQC', default: null },
  qcNumber:      { type: String, trim: true, default: '' },
  qcCompletedAt: { type: Date, default: null },
  stockPosted: { type: Boolean, default: false }, // idempotency guard
  receivedAt:  { type: Date, default: null },
  completedAt: { type: Date, default: null },
  completedBy: { type: String, trim: true, default: '' },

  // ── Documents ──
  grnPdfUrl:        { type: String, trim: true, default: '' },
  grnPdfFileName:   { type: String, trim: true, default: '' },
  challanDocument:  { type: grnDocumentSchema, default: () => ({}) },
  invoiceDocument:  { type: grnDocumentSchema, default: () => ({}) },

  remarks: { type: String, trim: true, default: '' },
}, baseSchemaOptions);

grnSchema.index({ grnNumber: 'text', poNumber: 'text', vendorName: 'text', invoiceNumber: 'text', uniqueId: 'text' });
grnSchema.index({ vendorId: 1, grnStatus: 1 });
grnSchema.index({ grnDate: -1 });

const GoodsReceiptNote = model('GoodsReceiptNote', grnSchema);
export default GoodsReceiptNote;
