import mongoose from 'mongoose';
import { baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

// A lightweight in-app notification. Delivery is via the bell (polling now);
// the same records can later fan out to WhatsApp/email without schema change.
const NotificationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type:   { type: String, default: 'INFO' }, // TASK_ASSIGNED | SLA_BREACH | INFO …
  title:  { type: String, required: true },
  body:   { type: String, default: '' },
  link:   { type: String, default: null }, // in-app route, e.g. /o2d-fms/process/:id
  // What the notification is about (e.g. "rate-change:<id>", "po-approval:<id>").
  // Lets a decision settle every approver's copy at once (settleByRef).
  refKey: { type: String, default: null, index: true },
  read:   { type: Boolean, default: false },
  readAt: { type: Date, default: null },
}, baseSchemaOptions);

NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

export default mongoose.models.Notification || model('Notification', NotificationSchema);
