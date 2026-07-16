/**
 * Die / Tool master — every physical die on the floor, keyed by its complete die
 * number (e.g. "Grinder Jar/CC/RK1-1"). Seeded from the "Import Die List" sheet.
 * The DPR form filters dies to the chosen SKU + operation so the operator picks
 * the exact tool that made the pieces (needed for tool-life / PM tracking).
 */
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const DieSchema = new Schema({
  completeDieNo: { type: String, required: true, trim: true, unique: true, index: true },
  dieName:       { type: String, trim: true, default: '' }, // usually the product family
  rackNo:        { type: String, trim: true, default: '' },
  dieNo:         { type: String, trim: true, default: '' },
  opCode:        { type: String, trim: true, default: '', index: true }, // CC, PR1, SX, GB…
  operationDesc: { type: String, trim: true, default: '' }, // "GJ1000-204 - Circle Cutting"
  // Denormalised SKU code parsed out of operationDesc, for fast filtering.
  skuCode:       { type: String, uppercase: true, trim: true, default: '', index: true },

  toolLifeShots:     { type: Number, default: 0, min: 0 },
  pmFrequencyShots:  { type: Number, default: 0, min: 0 },
  pmFrequencySecondary: { type: String, trim: true, default: '' },

  active:    { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const Die = model('Die', DieSchema);
export default Die;
