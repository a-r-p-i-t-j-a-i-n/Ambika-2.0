import mongoose from 'mongoose';
import { AttachmentSchema, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

// Represents an individual stage in the O2D lifecycle (e.g., '2.04 Dispatch Schedule')
const WorkflowStepSchema = new Schema({
  stepCode: { type: String, required: true }, // e.g., '2.01'
  stepName: { type: String, required: true }, // e.g., 'PO Entry'
  
  plannedTime: { type: Date },
  actualTime:  { type: Date },
  delayDays:   { type: Number, default: 0 }, // Auto-calculated when step is completed
  
  status: { 
    type: String, 
    enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'DELAYED'],
    default: 'PENDING'
  },
  
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
  completedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  
  remarks: { type: String },
  attachments: [AttachmentSchema]
}, { _id: true }); // Enable _id so we can easily patch a specific step

// Represents the overarching lifecycle tracker for a single Sales Order
const WorkflowTrackingSchema = new Schema({
  salesOrderId: { type: Schema.Types.ObjectId, ref: 'SalesOrder', required: true, unique: true },
  clientId:     { type: Schema.Types.ObjectId, ref: 'Client' },
  
  currentStepCode: { type: String, default: '2.01' },
  isCompleted:     { type: Boolean, default: false },
  
  steps: [WorkflowStepSchema]
}, baseSchemaOptions);

// Indexes to quickly find orders stuck at a certain step
WorkflowTrackingSchema.index({ salesOrderId: 1 });
WorkflowTrackingSchema.index({ currentStepCode: 1, isCompleted: 1 });
WorkflowTrackingSchema.index({ companyId: 1 });

export default model('WorkflowTracking', WorkflowTrackingSchema);
