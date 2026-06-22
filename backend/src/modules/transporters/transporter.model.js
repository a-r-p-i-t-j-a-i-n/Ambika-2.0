import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

// ── Transporter (logistics partner) master — used on dispatch / challan / e-way ──
const transporterSchema = new Schema({
  ...baseSchemaFields,

  code:    { type: String, unique: true, sparse: true, trim: true, uppercase: true },
  name:    { type: String, required: [true, 'Transporter name is required'], trim: true, index: true },

  contactPerson: { type: String, trim: true },
  phone:         { type: String, trim: true }, // primary mobile
  altPhone:      { type: String, trim: true }, // alternate / office
  email:         { type: String, trim: true, lowercase: true },

  address: { type: String, trim: true },
  city:    { type: String, trim: true },
  state:   { type: String, trim: true },
  pin:     { type: String, trim: true },

  // Tax (handy for transport-bill / RCM handling — optional).
  gstNo:   { type: String, trim: true, uppercase: true },
  panNo:   { type: String, trim: true, uppercase: true, default: '' },

  // What the transporter offers — Road / Rail / Air / Courier / Parcel, etc.
  modes:        [{ type: String, trim: true }],
  vehicleTypes: [{ type: String, trim: true }], // e.g. Tempo, 32ft, Container
  serviceArea:  { type: String, trim: true },    // regions served (free text)

  remarks: { type: String, trim: true },
}, baseSchemaOptions);

transporterSchema.index({ name: 'text', code: 'text', phone: 'text', gstNo: 'text' });
transporterSchema.index({ isActive: 1, name: 1 });

const Transporter = model('Transporter', transporterSchema);
export default Transporter;
