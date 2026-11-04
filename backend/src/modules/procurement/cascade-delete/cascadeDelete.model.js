import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * One row per Purchase FMS cascade delete (cascadeDelete.service.js) — the
 * audit of who deleted which step, when, why, and every record that went with
 * it. Append-only apart from its own status moving RUNNING → COMPLETED /
 * FAILED.
 *
 * While RUNNING it is also the lock: `lockKeys` ("TYPE:id" of every record
 * being deleted) is unique across RUNNING rows, so two deletions touching the
 * same record (a double click, two users) cannot run at once.
 */
export const CASCADE_STATUS = {
  RUNNING:   'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED:    'FAILED',
};

const recordSchema = new Schema({
  type:      { type: String, required: true },
  stepCode:  { type: String, default: '' },
  stepLabel: { type: String, default: '' },
  id:        { type: Schema.Types.ObjectId, required: true },
  number:    { type: String, default: '' },
  status:    { type: String, default: '' },
}, { _id: false });

const cascadeDeletionSchema = new Schema({
  rootType:      { type: String, required: true, index: true },
  rootId:        { type: Schema.Types.ObjectId, required: true, index: true },
  rootNumber:    { type: String, default: '' },
  rootStepLabel: { type: String, default: '' },
  reason:        { type: String, trim: true, default: '' },

  status:   { type: String, enum: Object.values(CASCADE_STATUS), default: CASCADE_STATUS.RUNNING, index: true },
  lockKeys: { type: [String], default: [] },

  deleted:   { type: [recordSchema], default: [] }, // the root first, then everything downstream
  preserved: { type: [recordSchema], default: [] }, // earlier steps left as they were
  effects:   { type: [String], default: [] },       // what changed on records that stay
  counts:    { type: Schema.Types.Mixed, default: {} },
  // For a Step 1.2 / 1.3 root: the step data as it was (the indent keeps no copy).
  rootSnapshot: { type: Schema.Types.Mixed, default: null },

  // TRANSACTION: downstream records went in one MongoDB transaction.
  // COMPENSATED: no transactions (standalone mongod) — restored from snapshots on failure.
  atomicMode: { type: String, enum: ['TRANSACTION', 'COMPENSATED', ''], default: '' },
  rolledBack: { type: Boolean, default: false },
  error:      { type: String, default: '' },

  initiatedBy:     { type: Schema.Types.ObjectId, ref: 'User', index: true },
  initiatedByName: { type: String, default: '' },
  ipAddress:       { type: String, default: '' },
  userAgent:       { type: String, default: '' },
  startedAt:       { type: Date, default: Date.now },
  finishedAt:      { type: Date, default: null },
}, { timestamps: true });

cascadeDeletionSchema.index({ lockKeys: 1 }, { unique: true, partialFilterExpression: { status: CASCADE_STATUS.RUNNING } });
cascadeDeletionSchema.index({ 'deleted.id': 1 });
cascadeDeletionSchema.index({ createdAt: -1 });

const PurchaseCascadeDeletion = mongoose.models.PurchaseCascadeDeletion || model('PurchaseCascadeDeletion', cascadeDeletionSchema);
export default PurchaseCascadeDeletion;
