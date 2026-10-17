import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Service Completion — former Purchase FMS Step 1.8A (retired; history only).
 *
 * For INTERNAL_SERVICE indents (servicing/repair/maintenance/AMC/licenses) that
 * skip the PO/PI/Advance/Follow-up/GRN chain. Recording a Service Completion used
 * to confirm the work was done and make the indent eligible for Incoming QC.
 * The step was removed: a SERVICE_PENDING indent now goes straight to Incoming QC
 * (source = SERVICE), which records the completion evidence and verdict. Existing
 * records are kept and stay linked to their QC; no new ones are created.
 */
export const SERVICE_COMPLETION_STATUS = {
  PENDING:   'PENDING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

// QC eligibility mirror (set on the completed service, like GRN.qcStatus).
export const SERVICE_QC_STATUS = {
  PENDING: 'PENDING',
  PASSED:  'PASSED',
  FAILED:  'FAILED',
  PARTIAL: 'PARTIAL',
};

const fileSchema = new Schema({
  fileName:   { type: String, default: '' },
  fileUrl:    { type: String, default: '' },
  fileType:   { type: String, default: '' },
  uploadedAt: { type: Date, default: null },
}, { _id: false });

const serviceCompletionSchema = new Schema({
  ...baseSchemaFields,

  scNumber: { type: String, unique: true, trim: true, index: true }, // auto: AGL/SC-001/26-27

  // ── Indent linkage (internal-service indent) ──
  indentId:     { type: Schema.Types.ObjectId, ref: 'PurchaseIndent', required: true, index: true },
  indentNumber: { type: String, trim: true, index: true },
  department:   { type: String, trim: true, default: '' },

  // ── Service provider (Party = Vendor) ──
  vendorId:   { type: Schema.Types.ObjectId, ref: 'Party' },
  vendorName: { type: String, trim: true, default: '' },

  // ── Completion details ──
  serviceCompletionDate: { type: Date, default: null },
  completionRemarks:     { type: String, trim: true, default: '' },
  completionDocuments:   { type: [fileSchema], default: [] },
  serviceReportDocument: { type: fileSchema, default: () => ({}) },
  invoiceDocument:       { type: fileSchema, default: () => ({}) }, // optional

  // ── Workflow ──
  status:      { type: String, enum: Object.values(SERVICE_COMPLETION_STATUS), default: SERVICE_COMPLETION_STATUS.PENDING, index: true },
  completedAt: { type: Date, default: null },

  // QC linkage (set once COMPLETED → eligible for Incoming QC; source = SERVICE).
  qcStatus:      { type: String, enum: Object.values(SERVICE_QC_STATUS), default: SERVICE_QC_STATUS.PENDING, index: true },
  qcId:          { type: Schema.Types.ObjectId, ref: 'IncomingQc', default: null },
  qcNumber:      { type: String, trim: true, default: '' },
  qcCompletedAt: { type: Date, default: null },
}, baseSchemaOptions);

serviceCompletionSchema.index({ scNumber: 'text', indentNumber: 'text', vendorName: 'text' });

const ServiceCompletion = model('ServiceCompletion', serviceCompletionSchema);
export default ServiceCompletion;
