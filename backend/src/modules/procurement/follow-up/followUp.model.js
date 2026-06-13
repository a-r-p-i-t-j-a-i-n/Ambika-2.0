import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Material Delivery Follow-up — Purchase FMS Step 1.5
 * "Follow up on Material Delivery 1.05".
 *
 * Starts only after a Vendor PO is RELEASED_TO_VENDOR and tracks vendor
 * chase-ups until the material is READY_FOR_GRN. No stock is received here —
 * the GRN module (built later) owns receivedQty/pendingQty.
 */

export const FOLLOWUP_STATUS = {
  PENDING:       'PENDING',
  DONE:          'DONE',
  RESCHEDULED:   'RESCHEDULED',
  READY_FOR_GRN: 'READY_FOR_GRN',
  CLOSED:        'CLOSED',
};

export const FOLLOWUP_TYPE = {
  CALL:     'CALL',
  EMAIL:    'EMAIL',
  WHATSAPP: 'WHATSAPP',
  VISIT:    'VISIT',
  OTHER:    'OTHER',
};

const communicationLogSchema = new Schema({
  type:      { type: String, enum: Object.values(FOLLOWUP_TYPE), default: FOLLOWUP_TYPE.CALL },
  message:   { type: String, trim: true, default: '' },
  timestamp: { type: Date, default: Date.now },
  by:        { type: Schema.Types.ObjectId, ref: 'User' },
  byName:    { type: String, trim: true, default: '' },
}, { _id: false });

const followUpSchema = new Schema({
  ...baseSchemaFields,

  followUpNumber: { type: String, unique: true, trim: true, index: true }, // auto: FU-001/26-27

  // ── Linkage (PO → Indent → Vendor) ──
  poId:         { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder', required: true, index: true },
  poNumber:     { type: String, trim: true, index: true },
  indentId:     { type: Schema.Types.ObjectId, ref: 'PurchaseIndent' },
  indentNumber: { type: String, trim: true },
  vendorId:     { type: Schema.Types.ObjectId, ref: 'Party', index: true },
  vendorName:   { type: String, trim: true, default: '' },
  vendorEmail:  { type: String, trim: true, lowercase: true, default: '' },
  vendorPhone:  { type: String, trim: true, default: '' },

  // ── Sheet step identity ──
  stepNo:   { type: String, default: 'Step 1.5' },
  stepName: { type: String, default: 'Follow up on Material Delivery 1.05' },

  // ── Plan vs actual ──
  plannedAt:  { type: Date, required: [true, 'Planned date is required'] },
  actualAt:   { type: Date, default: null },
  statusDone: { type: String, enum: ['YES', 'NO'], default: 'NO' },

  followUpStatus: { type: String, enum: Object.values(FOLLOWUP_STATUS), default: FOLLOWUP_STATUS.PENDING, index: true },
  followUpType:   { type: String, enum: Object.values(FOLLOWUP_TYPE), default: FOLLOWUP_TYPE.CALL },

  nextFollowUpDate:  { type: Date, default: null },
  finalMaterialDate: { type: Date, default: null },
  formLink:          { type: String, trim: true, default: '' },

  // Auto: minutes late (actualAt − plannedAt, 0 when on time / early).
  timeDelayMinutes: { type: Number, default: 0 },

  performedBy:     { type: Schema.Types.ObjectId, ref: 'User' },
  performedByName: { type: String, trim: true, default: '' },

  communicationLog: { type: [communicationLogSchema], default: [] },

}, baseSchemaOptions);

// ── Indexes ──────────────────────────────────────────────────
followUpSchema.index({ followUpNumber: 'text', poNumber: 'text', indentNumber: 'text', vendorName: 'text' });
followUpSchema.index({ poId: 1, followUpStatus: 1 });
followUpSchema.index({ plannedAt: 1 });
followUpSchema.index({ vendorId: 1, followUpStatus: 1 });

const PurchaseFollowUp = model('PurchaseFollowUp', followUpSchema);
export default PurchaseFollowUp;
