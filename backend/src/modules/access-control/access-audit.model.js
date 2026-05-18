/**
 * AccessAuditLog — append-only record of every access-control change.
 *
 * What gets logged:
 *   - User invited / suspended / reactivated
 *   - Role assigned / removed on a user
 *   - Permission granted / denied directly on a user
 *   - Role created / edited / deleted
 *
 * What does NOT get logged here:
 *   - Failed permission checks (those are 403s, logged at the HTTP layer)
 *   - Login events (those belong to a separate auth log if/when added)
 */

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const AccessAuditLogSchema = new Schema({
  // Who did it
  actorId:     { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actorName:   { type: String, required: true },
  actorEmail:  { type: String, required: true },

  // What action
  action: {
    type: String,
    required: true,
    enum: [
      'USER_INVITED',
      'USER_UPDATED',
      'USER_SUSPENDED',
      'USER_REACTIVATED',
      'ROLE_ASSIGNED',
      'ROLE_REMOVED',
      'PERMISSION_GRANTED',
      'PERMISSION_DENIED',
      'PERMISSION_RESET',
      'ROLE_CREATED',
      'ROLE_UPDATED',
      'ROLE_DELETED',
    ],
    index: true,
  },

  // What it was done to
  targetType:  { type: String, enum: ['User', 'Role'], required: true },
  targetId:    { type: Schema.Types.ObjectId, required: true, index: true },
  targetLabel: { type: String, required: true }, // e.g. "Anu Sharma" or "SALES_EXEC"

  // Diff
  before:      { type: Schema.Types.Mixed }, // snapshot of the relevant fields
  after:       { type: Schema.Types.Mixed },
  reason:      { type: String, default: '' },

  // Request metadata (filled by controller)
  ipAddress:   { type: String },
  userAgent:   { type: String },

  createdAt:   { type: Date, default: Date.now, index: true },
}, { versionKey: false });

AccessAuditLogSchema.index({ createdAt: -1 });

const AccessAuditLog = model('AccessAuditLog', AccessAuditLogSchema);
export default AccessAuditLog;
