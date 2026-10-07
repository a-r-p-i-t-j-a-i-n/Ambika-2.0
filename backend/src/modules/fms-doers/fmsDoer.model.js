import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * FMS step-wise Doer Assignment.
 *
 *   FmsDoerAssignment — CONFIG: who is the primary doer of a step of an FMS
 *                       (fmsKey + stepKey → User id). One active row per step.
 *   FmsTask           — RUNTIME: one row per (item × step) while an item is
 *                       waiting at that step. The doer is snapshotted from the
 *                       config when the task opens, so changing the config never
 *                       silently re-owns work that is already pending.
 *
 * Step catalogs live in code (fmsCatalog.js) — the same way permission slugs
 * do — because which document status means "waiting at step X" is application
 * logic, not data.
 */

const historyEntrySchema = new Schema({
  action:     { type: String, required: true }, // ASSIGNED | REASSIGNED | UNASSIGNED | COMPLETED | CLOSED
  fromUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  toUserId:   { type: Schema.Types.ObjectId, ref: 'User', default: null },
  byUserId:   { type: Schema.Types.ObjectId, ref: 'User', default: null },
  byName:     { type: String, trim: true, default: '' }, // snapshot for audit rendering
  reason:     { type: String, trim: true, default: '' },
  note:       { type: String, trim: true, default: '' },
  at:         { type: Date, default: Date.now },
}, { _id: false });

// ── Config ────────────────────────────────────────────────────────────────────
const fmsDoerAssignmentSchema = new Schema({
  ...baseSchemaFields,
  fmsKey:     { type: String, required: true, trim: true, uppercase: true },
  stepKey:    { type: String, required: true, trim: true, uppercase: true },
  // Primary doer. null = step intentionally left unassigned.
  doerUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  // Reserved for backup / parallel doers (not used by v1 — one primary doer).
  backupUserIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
  history: { type: [historyEntrySchema], default: [] },
}, baseSchemaOptions);

// One active assignment per FMS + step.
fmsDoerAssignmentSchema.index(
  { fmsKey: 1, stepKey: 1 },
  { unique: true, partialFilterExpression: { isActive: true, isDeleted: false } },
);

// ── Runtime ───────────────────────────────────────────────────────────────────
export const FMS_TASK_STATUS = {
  OPEN:   'OPEN',   // item is waiting at this step
  DONE:   'DONE',   // item moved past this step
  CLOSED: 'CLOSED', // item left the step without completing it (deleted / cancelled / rejected)
};

const fmsTaskSchema = new Schema({
  fmsKey:   { type: String, required: true, trim: true, index: true },
  stepKey:  { type: String, required: true, trim: true, index: true },
  stepCode: { type: String, trim: true, default: '' },
  stepLabel:{ type: String, trim: true, default: '' },
  sequence: { type: Number, default: 0 },

  // The workflow item waiting at the step (Indent / PO / GRN / …).
  entityType: { type: String, required: true, trim: true },
  entityId:   { type: Schema.Types.ObjectId, required: true },
  entityRef:  { type: String, trim: true, default: '' }, // display number, e.g. AGL/GRN-004/26-27
  entityLink: { type: String, trim: true, default: '' }, // in-app route
  summary:    { type: String, trim: true, default: '' }, // vendor / party, for lists

  status: { type: String, enum: Object.values(FMS_TASK_STATUS), default: FMS_TASK_STATUS.OPEN, index: true },

  // Responsible doer (snapshot at open; changes only via explicit reassignment).
  assignedDoerId:   { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  assignedAt:       { type: Date, default: null },
  assignmentSource: { type: String, enum: ['CONFIG', 'MANUAL', 'NONE'], default: 'NONE' },

  openedAt:  { type: Date, default: Date.now },
  openedVia: { type: String, enum: ['WORKFLOW', 'SYNC'], default: 'WORKFLOW' },

  // Actual performer — the authenticated user whose action moved the item on.
  completedAt:     { type: Date, default: null },
  completedById:   { type: Schema.Types.ObjectId, ref: 'User', default: null },
  completedByName: { type: String, trim: true, default: '' },
  closedReason:    { type: String, trim: true, default: '' },

  history: { type: [historyEntrySchema], default: [] },
}, { timestamps: true });

// Never two open tasks for the same item at the same step.
fmsTaskSchema.index(
  { fmsKey: 1, stepKey: 1, entityType: 1, entityId: 1 },
  { unique: true, partialFilterExpression: { status: 'OPEN' } },
);
fmsTaskSchema.index({ assignedDoerId: 1, status: 1 });
fmsTaskSchema.index({ entityType: 1, entityId: 1 });

export const FmsDoerAssignment = mongoose.models.FmsDoerAssignment || model('FmsDoerAssignment', fmsDoerAssignmentSchema);
export const FmsTask = mongoose.models.FmsTask || model('FmsTask', fmsTaskSchema);
