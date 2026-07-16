/**
 * Operator master — the shop-floor workers who run the DPR entries. Seeded from
 * the "Import Machine & Operator" sheet. `machineCodes` records which machines a
 * worker is normally assigned to, so the DPR form can pre-filter operators once a
 * machine is chosen (they're not hard-locked — a worker can be logged elsewhere).
 */
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const OperatorSchema = new Schema({
  name:         { type: String, required: true, trim: true, index: true },
  code:         { type: String, trim: true, default: '', uppercase: true },
  machineCodes: [{ type: String, uppercase: true, trim: true }],
  department:   { type: String, trim: true, default: '' },
  shift:        { type: String, trim: true, default: '' },
  active:       { type: Boolean, default: true, index: true },
  isDeleted:    { type: Boolean, default: false },
  createdBy:    { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy:    { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

// A worker's name is unique per department (some names repeat across the floor).
OperatorSchema.index({ name: 1, department: 1 }, { unique: false });

const Operator = model('Operator', OperatorSchema);
export default Operator;
