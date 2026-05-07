import mongoose from 'mongoose';
import { getFiscalYear } from './fiscalYear.js';
import { DOC_PREFIX } from '../config/constants.js';

/**
 * Counter collection to track auto-increment sequences per document type + fiscal year.
 */
const counterSchema = new mongoose.Schema({
  _id:   { type: String, required: true }, // e.g. "AGL/SO_25-26"
  seq:   { type: Number, default: 0 },
});

const Counter = mongoose.model('Counter', counterSchema);

/**
 * Generate next document number.
 * @param {'SALES_ORDER'|'DELIVERY_CHALLAN'|'TAX_INVOICE'|'O2D_TRACKER'} docType
 * @param {Date} date — date to determine fiscal year
 * @returns {string} e.g. "AGL/SO-003/25-26", "AGL/DC-015/24-25"
 */
export async function generateDocNumber(docType, date = new Date()) {
  const fy = getFiscalYear(date);
  const prefix = DOC_PREFIX[docType];
  const counterId = `${prefix}_${fy}`;

  const counter = await Counter.findByIdAndUpdate(
    counterId,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const paddedSeq = String(counter.seq).padStart(3, '0');

  // AGL/SO-003/25-26
  return `${prefix}-${paddedSeq}/${fy}`;
}

/**
 * Generate O2D tracker unique ID.
 * @param {Date} date
 * @returns {string} e.g. "AGL-O2D-42"
 */
export async function generateO2DId(date = new Date()) {
  const counter = await Counter.findByIdAndUpdate(
    'AGL-O2D',
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `AGL-O2D-${counter.seq}`;
}

/**
 * Set a counter to a specific value (for seeding).
 */
export async function setCounter(counterId, value) {
  await Counter.findByIdAndUpdate(
    counterId,
    { seq: value },
    { upsert: true },
  );
}
