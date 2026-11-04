import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Recycle Bin — one row per user delete, so it can be put back.
 *
 * The list fields (title, from, deletedBy …) are what the Suite's Recycle Bin
 * page shows; `plan` is HOW to restore (see recycleBin.restore.js) and is never
 * sent to the browser. Rows leave on their own at `expiresAt` (TTL index) —
 * the auto-empty period MD sets.
 */
const PersonSchema = new Schema({
  id:   { type: Schema.Types.ObjectId, ref: 'User' },
  name: { type: String },
}, { _id: false });

const recycleBinItemSchema = new Schema({
  module:   { type: String, required: true },   // catalog module key (o2d, purchase …)
  type:     { type: String, required: true },   // catalog type key (salesOrder, grn …)
  recordId: { type: Schema.Types.ObjectId },
  title:    { type: String, required: true },   // e.g. "GRN-0042"
  subtitle: { type: String },                   // e.g. "Epack Durable · PO-0012"
  keywords: { type: String },                   // lower-case search text
  from:     { label: String, path: String },    // where it was deleted from
  openPath: { type: String },                   // where it lives again after restore
  reason:   { type: String },

  deletedBy: { type: PersonSchema },
  deletedAt: { type: Date, default: Date.now },

  status:      { type: String, enum: ['pending', 'restoring', 'restored'], default: 'pending' },
  restoringAt: { type: Date },
  restoredBy:  { type: PersonSchema },
  restoredAt:  { type: Date },
  lastError:   { type: String },                // why the last restore try was refused

  expiresAt: { type: Date },
  plan:      { type: Schema.Types.Mixed, select: false },
  // minimize: false — a saved copy keeps its empty objects, so a restore is exact.
}, { timestamps: true, minimize: false });

recycleBinItemSchema.index({ status: 1, deletedAt: -1 });
recycleBinItemSchema.index({ status: 1, restoredAt: -1 });
recycleBinItemSchema.index({ 'deletedBy.id': 1, status: 1, deletedAt: -1 });
recycleBinItemSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RecycleBinItem = mongoose.model('RecycleBinItem', recycleBinItemSchema);

/** One settings row (_id 'default'): how many days items stay in the bin. */
const recycleBinSettingSchema = new Schema({
  _id:           { type: String },
  retentionDays: { type: Number, min: 1, max: 365 },
  updatedBy:     { type: PersonSchema },
}, { timestamps: true });

export const RecycleBinSetting = mongoose.model('RecycleBinSetting', recycleBinSettingSchema);

export default RecycleBinItem;
