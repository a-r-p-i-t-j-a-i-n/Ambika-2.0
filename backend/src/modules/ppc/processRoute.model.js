/**
 * Process Route master — the operation sequence (routing) for every SKU. One doc
 * per (skuCode, operationNo). Seeded from the "Import Process Master" sheet.
 *
 * This is the backbone of the OEE maths: the DPR form reads `spm` and `cavity`
 * from here to auto-fill the standard cycle time, so the operator never has to
 * know it. `isLastOperation` marks the routing's final step (Packaging) — the
 * step whose good output becomes finished-goods stock.
 */
import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const ProcessRouteSchema = new Schema({
  skuCode:       { type: String, required: true, uppercase: true, trim: true, index: true },
  skuName:       { type: String, trim: true, default: '' },
  operationNo:   { type: Number, required: true, min: 0 },
  operationName: { type: String, required: true, trim: true },
  // "<opNo> - <opName>" — the combined label the DPR/Excel uses on a row.
  operationLabel: { type: String, trim: true, default: '' },
  // Full tool/operation description, e.g. "GJ1000-204 - Circle Cutting".
  operationDesc: { type: String, trim: true, default: '' },
  machineType:   { type: String, trim: true, default: '' },

  spm:    { type: Number, default: 0, min: 0 },  // strokes per minute
  cavity: { type: Number, default: 1, min: 1 },  // pieces produced per stroke

  toolLifeShots:        { type: Number, default: 0, min: 0 },
  pmFrequencyShots:     { type: Number, default: 0, min: 0 },
  pmFrequencyMonths:    { type: String, trim: true, default: '' },
  isLastOperation:      { type: Boolean, default: false },

  // Optional per-piece rate for this operation (drives Production Value). Falls
  // back to the SKU selling price when absent.
  partRate: { type: Number, default: 0, min: 0 },

  active:    { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

ProcessRouteSchema.index({ skuCode: 1, operationNo: 1 }, { unique: true });

const ProcessRoute = model('ProcessRoute', ProcessRouteSchema);
export default ProcessRoute;
