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
  // Vendor-side person spoken to on this contact (optional).
  contactPerson: { type: String, trim: true, default: '' },
  // Snapshot of what this cycle recorded, so the history reads as a full
  // timeline (CREATED / FOLLOWED_UP / RESCHEDULED / READY_FOR_GRN / DONE).
  outcome:           { type: String, trim: true, default: '' },
  actualAt:          { type: Date, default: null },
  nextFollowUpDate:  { type: Date, default: null },
  finalMaterialDate: { type: Date, default: null },
  remarks:           { type: String, trim: true, default: '' },
}, { _id: false });

const followUpSchema = new Schema({
  ...baseSchemaFields,

  followUpNumber: { type: String, unique: true, trim: true, index: true }, // auto: FU-001/26-27

  // ── Linkage (PO → Indent → Vendor) ──
  // poId has no inline `index: true` — the compound { poId, followUpStatus }
  // index below already covers plain poId lookups via prefix matching, and
  // the new partial unique index below is also keyed on poId alone; declaring
  // a third, plain, redundant index here previously clashed with that unique
  // one (same key pattern, different options) and produced a Mongoose
  // "Duplicate schema index" warning at startup.
  poId:         { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder', required: true },
  poNumber:     { type: String, trim: true, index: true },
  indentId:     { type: Schema.Types.ObjectId, ref: 'PurchaseIndent' },
  indentNumber: { type: String, trim: true },
  vendorId:     { type: Schema.Types.ObjectId, ref: 'Party', index: true },
  vendorName:   { type: String, trim: true, default: '' },
  vendorEmail:  { type: String, trim: true, lowercase: true, default: '' },
  vendorPhone:  { type: String, trim: true, default: '' },
  // Vendor-side contact person currently being chased for this delivery.
  contactPerson: { type: String, trim: true, default: '' },

  // ── Sheet step identity ──
  stepNo:   { type: String, default: 'Step 1.5' },
  stepName: { type: String, default: 'Follow up on Material Delivery 1.05' },

  // ── Plan vs actual ──
  plannedAt:  { type: Date, required: [true, 'Planned date is required'] },
  actualAt:   { type: Date, default: null },
  statusDone: { type: String, enum: ['YES', 'NO'], default: 'NO' },

  followUpStatus: { type: String, enum: Object.values(FOLLOWUP_STATUS), default: FOLLOWUP_STATUS.PENDING, index: true },
  followUpType:   { type: String, enum: Object.values(FOLLOWUP_TYPE), default: FOLLOWUP_TYPE.CALL },

  // True exactly while followUpStatus is PENDING or RESCHEDULED (the "active"
  // definition — see FOLLOWUP_STATUS), false once the cycle concludes
  // (DONE/READY_FOR_GRN/CLOSED) or the record is soft-deleted. Kept in sync by
  // the service on every transition. Exists ONLY so the partial unique index
  // below can enforce "at most one active follow-up per PO" atomically —
  // Mongo partial-index filters only support equality (not $in/$ne), so this
  // denormalized boolean is what makes a one-field equality filter possible.
  isActiveFollowUp: { type: Boolean, default: true },

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
// Atomic "at most one active follow-up per PO" guarantee — enforced by MongoDB
// itself on every insert, so a race between two concurrent creates can never
// leave two active records for the same PO (one write always loses with a
// duplicate-key error, independent of the service's own pre-check). A partial
// index only applies to documents matching the filter, so concluded/deleted
// follow-ups (isActiveFollowUp: false) are invisible to it and never collide —
// existing data needs a one-time backfill before this can take effect for
// records created before this change (see scripts/backfillFollowUpActiveFlag.js).
followUpSchema.index({ poId: 1 }, { unique: true, partialFilterExpression: { isActiveFollowUp: true } });

const PurchaseFollowUp = model('PurchaseFollowUp', followUpSchema);
export default PurchaseFollowUp;
