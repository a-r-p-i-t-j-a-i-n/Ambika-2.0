import mongoose from 'mongoose';

const { Schema } = mongoose;

export const AttachmentSchema = new Schema({
  fileName: { type: String, required: true },
  fileUrl: { type: String, required: true },
  fileType: { type: String },
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false });

export const ActivityLogSchema = new Schema({
  action: { type: String, required: true },
  description: { type: String },
  actorId: { type: Schema.Types.ObjectId, ref: 'User' },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

export const baseSchemaFields = {
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  deletedAt: { type: Date, default: null },
  isDeleted: { type: Boolean, default: false },
  isActive:  { type: Boolean, default: true },
  companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
  branchId:  { type: Schema.Types.ObjectId, ref: 'Branch' },
  status:    { type: String, default: 'ACTIVE' },
  remarks:   { type: String },
  notes:     { type: String },
  attachments: [AttachmentSchema],
  activityTimeline: [ActivityLogSchema]
};

export const baseSchemaOptions = {
  timestamps: true,
  optimisticConcurrency: true,
};
