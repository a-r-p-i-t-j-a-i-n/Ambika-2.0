/**
 * OrderIntake — the earliest touch-point: a client places an order by phone /
 * email / WhatsApp / meeting and a staff member logs it in seconds. Saving it
 * STARTS the O2D FMS (a process attaches to the intake). It is later converted
 * into a formal Sales Order, which links the two and advances the flow.
 */
import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

export const INTAKE_CHANNEL = Object.freeze({
  PHONE: 'PHONE', EMAIL: 'EMAIL', WHATSAPP: 'WHATSAPP', MEETING: 'MEETING', OTHER: 'OTHER',
});
export const INTAKE_STATUS = Object.freeze({
  NEW: 'NEW', CONVERTED: 'CONVERTED', CANCELLED: 'CANCELLED',
});

const IntakeItemSchema = new Schema({
  skuName: { type: String, required: true },
  skuCode: { type: String, default: null },
  qty:     { type: Number, default: 0 },
}, { _id: false });

const IntakeAttachmentSchema = new Schema({
  fileName: { type: String, required: true },
  fileUrl:  { type: String, required: true },
  fileKey:  { type: String, default: null },
  fileType: { type: String, default: null },
  sizeBytes:{ type: Number, default: 0 },
  kind:     { type: String, default: 'file' },
  uploadedByName: { type: String, default: null },
  uploadedAt:     { type: Date, default: Date.now },
}, { _id: true });

const OrderIntakeSchema = new Schema({
  ...baseSchemaFields,
  intakeNo:  { type: String, trim: true }, // human ref e.g. AGL-OI-12
  partyId:   { type: Schema.Types.ObjectId, ref: 'Party', required: true },
  partyName: { type: String, trim: true },
  channel:   { type: String, enum: Object.values(INTAKE_CHANNEL), required: true },
  contactName: { type: String, trim: true, default: null }, // who called / emailed
  items:     [IntakeItemSchema],   // optional rough list of what they asked for
  notes:     { type: String, default: null }, // what the client said
  attachments: [IntakeAttachmentSchema],

  intakeStatus: { type: String, enum: Object.values(INTAKE_STATUS), default: INTAKE_STATUS.NEW },
  linkedSalesOrderId: { type: Schema.Types.ObjectId, ref: 'SalesOrder', default: null },

  receivedAt: { type: Date, default: Date.now },
}, baseSchemaOptions);

OrderIntakeSchema.index({ intakeStatus: 1, createdAt: -1 });
OrderIntakeSchema.index({ partyId: 1 });

export default mongoose.models.OrderIntake || model('OrderIntake', OrderIntakeSchema);
