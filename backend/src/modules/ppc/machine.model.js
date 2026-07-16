/**
 * Machine master — every press / spinning / cutting / buffing unit on the floor,
 * keyed by the short code the operator picks in the DPR (e.g. "SAP01", "S07").
 * Seeded from the "Import Machine & Operator" sheet; the machineType is inferred
 * from the code prefix (see the seeder) and cross-checked with the Process Master.
 */
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const MachineSchema = new Schema({
  code:        { type: String, required: true, uppercase: true, trim: true, unique: true, index: true },
  name:        { type: String, trim: true, default: '' },
  machineType: { type: String, trim: true, default: 'Manual / Other', index: true },
  department:  { type: String, trim: true, default: '' },
  defaultSpm:  { type: Number, default: 0, min: 0 }, // fallback strokes-per-minute
  active:      { type: Boolean, default: true, index: true },
  isDeleted:   { type: Boolean, default: false },
  createdBy:   { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy:   { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const Machine = model('Machine', MachineSchema);
export default Machine;
