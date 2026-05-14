import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const AuditLogSchema = new Schema({
  entityName: { type: String, required: true }, // e.g., 'DispatchActual'
  entityId: { type: Schema.Types.ObjectId },
  action: { type: String, enum: ['CREATE', 'UPDATE', 'DELETE', 'SOFT_DELETE'], required: true },
  
  oldValue: { type: Schema.Types.Mixed }, // State before mutation
  newValue: { type: Schema.Types.Mixed }, // State after mutation
  
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  ipAddress: { type: String },
  userAgent: { type: String },
  module: { type: String },
  companyId: { type: Schema.Types.ObjectId, ref: 'Company' }
}, { 
  timestamps: { createdAt: true, updatedAt: false } // Audit logs are immutable, never updated
});

// Indexes for fast historical queries
AuditLogSchema.index({ entityName: 1, entityId: 1 });
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ companyId: 1 });

export default model('AuditLog', AuditLogSchema);
