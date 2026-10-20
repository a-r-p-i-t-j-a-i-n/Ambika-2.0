import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Incoming QC Check — Purchase FMS Step 1.9.
 *
 * Always linked to a completed, MD-signed GRN (GRN.qcStatus PENDING). On
 * COMPLETE, by the GRN's stockPostingStage:
 *   QC_COMPLETION (every GRN completed since QC-gated posting)
 *     • Accepted qty is POSTED to stock now (GRN_IN, dated at QC completion),
 *       to the destination fixed on the GRN line — the first time it is usable.
 *     • Rejected and rework qty never enter stock; the QC record keeps them.
 *   LEGACY (GRN completed earlier — it already posted every received unit)
 *     • Accepted qty stays in stock (no movement).
 *     • Rejected qty is moved OUT via inventoryService.decreaseStock()
 *       (txnType QC_REJECT_OUT); rework stays, exactly as before.
 * Then the GRN's qcStatus is updated. Sets the stage for Invoice / Debit Note.
 */

export const QC_STATUS = {
  DRAFT:       'DRAFT',
  IN_PROGRESS: 'IN_PROGRESS',
  PASSED:      'PASSED',
  FAILED:      'FAILED',
  PARTIAL:     'PARTIAL',
  CANCELLED:   'CANCELLED',
};

// QC can validate either received goods (a GRN) or a completed internal service.
export const QC_SOURCE_TYPE = {
  GRN:     'GRN',
  SERVICE: 'SERVICE',
};

export const QC_RESULT = {
  PASS:         'PASS',
  FAIL:         'FAIL',
  PARTIAL_PASS: 'PARTIAL_PASS',
};

export const DEFECT_SEVERITY = {
  MINOR:    'MINOR',
  MAJOR:    'MAJOR',
  CRITICAL: 'CRITICAL',
};

const qcDocumentSchema = new Schema({
  fileName:   { type: String, default: '' },
  fileUrl:    { type: String, default: '' },
  fileType:   { type: String, default: '' },
  uploadedAt: { type: Date, default: null },
}, { _id: false });

const qcItemSchema = new Schema({
  grnItemId:   { type: Schema.Types.ObjectId },
  skuId:       { type: Schema.Types.ObjectId, ref: 'SKU' },
  skuCode:     { type: String, trim: true, uppercase: true, default: '' },
  itemName:    { type: String, required: true, trim: true },
  unit:        { type: String, trim: true, default: 'Pcs' },
  batchNo:     { type: String, trim: true, default: '' }, // carried from GRN (for reject movement)

  receivedQty: { type: Number, required: true, min: 0 },
  acceptedQty: { type: Number, default: 0, min: 0 },
  rejectedQty: { type: Number, default: 0, min: 0 },
  reworkQty:   { type: Number, default: 0, min: 0 },
  shortQty:    { type: Number, default: 0 },

  defectType:     { type: String, trim: true, default: '' },
  defectSeverity: { type: String, enum: ['', ...Object.values(DEFECT_SEVERITY)], default: '' },
  defectRemarks:  { type: String, trim: true, default: '' },
  qcRemarks:      { type: String, trim: true, default: '' },

  // LEGACY GRNs (stock posted at GRN completion): set after the rejected-qty
  // stock-out (back-reference to the QC_REJECT_OUT ledger row).
  inventoryMovementId:     { type: Schema.Types.ObjectId, ref: 'InventoryMovement' },
  inventoryMovementNumber: { type: String, trim: true, default: '' },

  // QC-gated GRNs (stockPostingStage QC_COMPLETION): set when this line's
  // ACCEPTED qty is posted to stock (back-reference to the GRN_IN ledger row).
  stockInMovementId:     { type: Schema.Types.ObjectId, ref: 'InventoryMovement' },
  stockInMovementNumber: { type: String, trim: true, default: '' },
}, { _id: true });

const incomingQcSchema = new Schema({
  ...baseSchemaFields,

  qcNumber: { type: String, unique: true, trim: true, index: true }, // AGL/QC-001/26-27
  qcDate:   { type: Date, default: Date.now },

  // Source of the QC — received goods (GRN) or a completed internal service.
  sourceType: { type: String, enum: Object.values(QC_SOURCE_TYPE), default: QC_SOURCE_TYPE.GRN, index: true },

  // ── Service-completion linkage (sourceType = SERVICE) ──
  serviceCompletionId:     { type: Schema.Types.ObjectId, ref: 'ServiceCompletion' },
  serviceCompletionNumber: { type: String, trim: true, default: '' },

  // ── Linkage (GRN → PO → PI → Indent → Vendor). grnId only for sourceType GRN. ──
  grnId:        { type: Schema.Types.ObjectId, ref: 'GoodsReceiptNote', index: true },
  grnNumber:    { type: String, trim: true, index: true },
  poId:         { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder' },
  poNumber:     { type: String, trim: true, default: '' },
  piId:         { type: Schema.Types.ObjectId, ref: 'ProformaInvoice' },
  piNumber:     { type: String, trim: true, default: '' },
  indentId:     { type: Schema.Types.ObjectId, ref: 'PurchaseIndent' },
  indentNumber: { type: String, trim: true, default: '' },
  vendorId:     { type: Schema.Types.ObjectId, ref: 'Party', index: true },
  vendorName:   { type: String, trim: true, default: '' },

  checkedBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  checkedByName: { type: String, trim: true, default: '' },
  preparedBy:    { type: String, trim: true, default: '' },
  warehouse:     { type: String, trim: true, default: 'MAIN' },

  // ── Status ──
  qcStatus:      { type: String, enum: Object.values(QC_STATUS), default: QC_STATUS.DRAFT, index: true },
  overallResult: { type: String, enum: ['', ...Object.values(QC_RESULT)], default: '' },

  // ── Lines & totals ──
  items: { type: [qcItemSchema], default: [] },
  totalReceived: { type: Number, default: 0, min: 0 },
  totalAccepted: { type: Number, default: 0, min: 0 },
  totalRejected: { type: Number, default: 0, min: 0 },
  totalRework:   { type: Number, default: 0, min: 0 },

  // ── Documents ──
  qcReportDocument: { type: qcDocumentSchema, default: () => ({}) },
  photos:           { type: [String], default: [] },
  qcPdfUrl:         { type: String, trim: true, default: '' },
  qcPdfFileName:    { type: String, trim: true, default: '' },

  // ── Lifecycle ──
  stockPosted: { type: Boolean, default: false }, // idempotency for reject movements
  completedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  // Short-lived advisory lock (see vendorInvoice.service.js withQcInvoiceLock) so
  // two concurrent Vendor Invoice creates can't both invoice this QC at once.
  invoiceLockAt: { type: Date, default: null },
  remarks:     { type: String, trim: true, default: '' },
}, baseSchemaOptions);

incomingQcSchema.index({ qcNumber: 'text', grnNumber: 'text', poNumber: 'text', vendorName: 'text' });
incomingQcSchema.index({ vendorId: 1, qcStatus: 1 });
incomingQcSchema.index({ qcDate: -1 });

const IncomingQC = model('IncomingQC', incomingQcSchema);
export default IncomingQC;
