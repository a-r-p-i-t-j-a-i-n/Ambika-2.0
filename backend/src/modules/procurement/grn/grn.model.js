import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';
import { RM_RECEIVED_AT_LOCATIONS } from '../../inventory/inventoryStock.model.js';

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

/**
 * Which inventory module a GRN receives into — one per GRN.
 *   RM                    Raw Material IMS (coils / circles) — posts at "Received At"
 *   CONSUMABLE_PACKAGING  Consumable & Packaging IMS (and every other purchasable
 *                         non-RM type) — posts at the GRN's own store, as before
 * Finished Goods are produced in-house and never purchased (purchase-item-guard),
 * so they are not an option here.
 */
export const GRN_INVENTORY_TYPE = {
  RM: 'RM',
  CONSUMABLE_PACKAGING: 'CONSUMABLE_PACKAGING',
};
export const GRN_INVENTORY_TYPE_LABEL = {
  RM: 'Raw Material (RM)',
  CONSUMABLE_PACKAGING: 'Consumable & Packaging',
};

const grnDocumentSchema = new Schema({
  fileName:   { type: String, default: '' },
  fileUrl:    { type: String, default: '' },
  fileType:   { type: String, default: '' },
  uploadedAt: { type: Date, default: null },
}, { _id: false });

const grnItemSchema = new Schema({
  poItemId:   { type: Schema.Types.ObjectId }, // PO line _id (match-back)
  // Which PO this line belongs to (multi-PO GRN) — resolved server-side from
  // poItemId/skuCode against the selected POs, never trusted from the client.
  // Single-PO GRNs carry the one poId here too, same as the header's.
  poId:       { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder', default: null },
  poNumber:   { type: String, trim: true, default: '' },
  skuId:      { type: Schema.Types.ObjectId, ref: 'SKU' },
  skuCode:    { type: String, trim: true, uppercase: true, default: '' },
  itemName:   { type: String, required: true, trim: true },
  unit:       { type: String, trim: true, default: 'Pcs' },

  orderedQty:            { type: Number, default: 0, min: 0 }, // PO line qty
  previouslyReceivedQty: { type: Number, default: 0, min: 0 }, // before this GRN
  pendingBeforeGrn:      { type: Number, default: 0, min: 0 }, // orderedQty - previouslyReceivedQty (read-only, PO-derived)
  invoiceQty:            { type: Number, default: 0, min: 0 }, // vendor invoice/challan qty
  receivedQty:           { type: Number, required: true, min: 0 }, // physically received now
  shortQty:              { type: Number, default: 0 },         // invoiceQty - receivedQty
  extraQty:              { type: Number, default: 0, min: 0 }, // received beyond pendingBeforeGrn
  pendingQty:            { type: Number, default: 0, min: 0 }, // orderedQty - total received (pending AFTER this GRN)

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
  // poId is required UNLESS isWithoutPo is true — a GRN raised with no Purchase
  // Order at all (e.g. an emergency / walk-in receipt). See isWithoutPo below.
  // Multi-PO GRN: poId/poNumber are the PRIMARY (first selected) PO, kept for
  // every reader that only knows about one PO; poIds/poNumbers carry the full
  // set. Same pattern as indentId+indentIds on the PO model, or qcId+qcIds on
  // the Vendor Invoice. piId/indentId likewise mirror the primary PO only —
  // display/snapshot fields, not something GRN itself gates on.
  poId:         { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder', default: null, index: true },
  poNumber:     { type: String, trim: true, index: true },
  poIds:        { type: [{ type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder' }], default: [] },
  poNumbers:    { type: [String], default: [] },
  piId:         { type: Schema.Types.ObjectId, ref: 'ProformaInvoice' },
  piNumber:     { type: String, trim: true, default: '' },
  indentId:     { type: Schema.Types.ObjectId, ref: 'PurchaseIndent' },
  indentNumber: { type: String, trim: true, default: '' },

  /**
   * A GRN raised with no Purchase Order behind it at all — vendor and items are
   * entered by hand instead of sourced from a PO. Every PO-derived figure
   * (orderedQty, previouslyReceivedQty, pendingQty, extraQty) is fixed at 0 for
   * such a GRN's lines, since there is nothing to compare the receipt against.
   * Kept as an explicit flag (rather than inferred from `!poId`) so intent is
   * never guessed from a null — the same pattern as the Follow-up module's
   * isActiveFollowUp.
   */
  isWithoutPo:  { type: Boolean, default: false, index: true },

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
  // Step 1.9 — Incoming QC linkage (additive). A multi-PO GRN gets one QC per
  // PO (see incomingQc.service.js) — qcId/qcNumber are the PRIMARY (earliest)
  // QC for back-compat; qcIds/qcNumbers carry every QC. A single-PO GRN has
  // exactly one, so these always stay in lockstep with qcId/qcNumber.
  qcId:          { type: Schema.Types.ObjectId, ref: 'IncomingQC', default: null },
  qcNumber:      { type: String, trim: true, default: '' },
  qcIds:         { type: [{ type: Schema.Types.ObjectId, ref: 'IncomingQC' }], default: [] },
  qcNumbers:     { type: [String], default: [] },
  qcCompletedAt: { type: Date, default: null },
  // Short-lived lock held while a QC for this GRN is being created or completed,
  // so two requests can never both create (or both complete) a QC for one GRN
  // (see incomingQc.service). Expires on its own, so a crash cannot strand it.
  qcLockAt:      { type: Date, default: null },
  stockPosted: { type: Boolean, default: false }, // idempotency guard

  /**
   * "Add to RM Stock" — the operator's opt-in on the Complete dialog.
   *
   * Raw Material / Circle lines post to inventory ONLY when this is true. Every
   * other item type (consumables, packaging, spares …) posts exactly as it
   * always has, so this gates RM and nothing else.
   *
   * Defaults to false: the choice has to be made, never assumed. Recorded on
   * the GRN so the ledger can be explained later — a GRN with no RM movements
   * is then plainly "not opted in" rather than "something went wrong".
   */
  addToRmStock: { type: Boolean, default: false },

  /**
   * The Inventory Type chosen on the GRN (replaces the "Add to RM Stock"
   * checkbox in the UI). null on GRNs raised before it existed — those keep
   * their recorded addToRmStock and are never reinterpreted. When set,
   * addToRmStock is derived from it (RM ⇒ true) so existing readers still work.
   */
  inventoryType: { type: String, enum: [...Object.values(GRN_INVENTORY_TYPE), null], default: null },

  /**
   * "Received At" for the RM lines — where the material physically landed.
   *
   * The same two-value list and the same default the RM Stock In screen uses,
   * so there is ONE definition of this field (see RM_RECEIVED_AT_LOCATIONS).
   * It becomes the `warehouse` of the RM movements this GRN posts.
   *
   * Separate from `warehouse` above on purpose: that one is the GRN's own
   * store (MAIN) and still carries every non-RM line. Nothing maps one onto the
   * other. null until an RM-posting completion sets it, so no historical GRN
   * gains a location it never had.
   */
  rmReceivedAtLocation: { type: String, enum: [...RM_RECEIVED_AT_LOCATIONS, null], default: null },
  receivedAt:  { type: Date, default: null },
  completedAt: { type: Date, default: null },
  completedBy: { type: String, trim: true, default: '' },

  // ── Documents ──
  grnPdfUrl:        { type: String, trim: true, default: '' },
  grnPdfFileName:   { type: String, trim: true, default: '' },

  // ── MD Digital Approval (mirror of DocumentApproval — see modules/approvals) ──
  approvalStatus: {
    type: String,
    enum: ['NOT_REQUIRED', 'READY_FOR_MD_APPROVAL', 'MD_APPROVED'],
    default: 'NOT_REQUIRED',
    index: true,
  },
  challanDocument:  { type: grnDocumentSchema, default: () => ({}) },
  invoiceDocument:  { type: grnDocumentSchema, default: () => ({}) },

  remarks: { type: String, trim: true, default: '' },
}, baseSchemaOptions);

grnSchema.index({ grnNumber: 'text', poNumber: 'text', vendorName: 'text', invoiceNumber: 'text', uniqueId: 'text' });
grnSchema.index({ vendorId: 1, grnStatus: 1 });
grnSchema.index({ grnDate: -1 });

const GoodsReceiptNote = model('GoodsReceiptNote', grnSchema);
export default GoodsReceiptNote;
