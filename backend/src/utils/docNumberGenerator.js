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
 * PREVIEW the next document number WITHOUT consuming the sequence — read-only.
 * Used to show "the DC number that will be created on submit" on entry forms.
 * The real number is still assigned by generateDocNumber() at save time, so if
 * another document is created in between, the actual number may differ by one.
 * @param {'SALES_ORDER'|'DELIVERY_CHALLAN'|'TAX_INVOICE'|'O2D_TRACKER'} docType
 * @param {Date} date — date to determine fiscal year
 * @returns {string} e.g. "AGL/DC-016/26-27"
 */
export async function peekDocNumber(docType, date = new Date()) {
  const fy = getFiscalYear(date);
  const prefix = DOC_PREFIX[docType];
  const counterId = `${prefix}_${fy}`;
  const counter = await Counter.findById(counterId).lean();
  const next = (counter?.seq || 0) + 1;
  return `${prefix}-${String(next).padStart(3, '0')}/${fy}`;
}

/**
 * Generate the next Scrap Buyer master code.
 * NOT reset per fiscal year — it names a buyer, not a document, and a buyer's
 * code must not be reused by someone else on 1 April.
 * @returns {string} e.g. "SB-0001"
 */
export async function generateScrapBuyerCode() {
  const counter = await Counter.findByIdAndUpdate(
    'SCRAP_BUYER',
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `SB-${String(counter.seq).padStart(4, '0')}`;
}

/**
 * Generate next Purchase Indent number (Purchase FMS).
 * Unpadded sequence, reset per fiscal year.
 * @param {Date} date — date to determine fiscal year
 * @returns {string} e.g. "Ind-1/24-25"
 */
export async function generateIndentNumber(date = new Date()) {
  const fy = getFiscalYear(date);
  const counter = await Counter.findByIdAndUpdate(
    `IND_${fy}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `Ind-${counter.seq}/${fy}`;
}

/**
 * Generate next Vendor Purchase Order number (Purchase FMS — Step 1.4).
 * Zero-padded sequence, reset per fiscal year.
 * @param {Date} date — date to determine fiscal year
 * @returns {string} e.g. "AGL/PO-001/26-27"
 */
export async function generateVendorPoNumber(date = new Date()) {
  const fy = getFiscalYear(date);
  const counter = await Counter.findByIdAndUpdate(
    `AGL/PO_${fy}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `AGL/PO-${String(counter.seq).padStart(3, '0')}/${fy}`;
}

/**
 * Generate a temporary Vendor PO draft number (Purchase FMS — Step 1.4).
 * Assigned at draft creation so the PO has a stable reference before approval,
 * WITHOUT consuming the final poNumber sequence — that sequence only advances
 * via generateVendorPoNumber(), called on approval, so numbering follows
 * approval order rather than draft-creation order.
 * @param {Date} date — date to determine fiscal year
 * @returns {string} e.g. "DRAFT-001/26-27"
 */
export async function generateVendorPoDraftNumber(date = new Date()) {
  const fy = getFiscalYear(date);
  const counter = await Counter.findByIdAndUpdate(
    `AGL/PO_DRAFT_${fy}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `DRAFT-${String(counter.seq).padStart(3, '0')}/${fy}`;
}

/**
 * Generate next Material Follow-up number (Purchase FMS — Step 1.5).
 * Zero-padded sequence, reset per fiscal year.
 * @param {Date} date — date to determine fiscal year
 * @returns {string} e.g. "FU-001/26-27"
 */
export async function generateFollowUpNumber(date = new Date()) {
  const fy = getFiscalYear(date);
  const counter = await Counter.findByIdAndUpdate(
    `FU_${fy}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `FU-${String(counter.seq).padStart(3, '0')}/${fy}`;
}

/**
 * Generate next Proforma Invoice number (Purchase FMS — Step 1.6).
 * Zero-padded sequence, reset per fiscal year.
 * @param {Date} date — date to determine fiscal year
 * @returns {string} e.g. "PI-001/26-27"
 */
export async function generatePiNumber(date = new Date()) {
  const fy = getFiscalYear(date);
  const counter = await Counter.findByIdAndUpdate(
    `PI_${fy}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `PI-${String(counter.seq).padStart(3, '0')}/${fy}`;
}

/**
 * Generate the short PI unique code (global, never resets).
 * @returns {string} e.g. "PI-7"
 */
export async function generatePiUniqueCode() {
  const counter = await Counter.findByIdAndUpdate(
    'PI_UNIQUE',
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `PI-${counter.seq}`;
}

/**
 * Generate next Advance Payment number (Purchase FMS — Step 1.7).
 * Zero-padded sequence, reset per fiscal year.
 * @param {Date} date — date to determine fiscal year
 * @returns {string} e.g. "ADV-001/26-27"
 */
export async function generateAdvancePaymentNumber(date = new Date()) {
  const fy = getFiscalYear(date);
  const counter = await Counter.findByIdAndUpdate(
    `ADV_${fy}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `ADV-${String(counter.seq).padStart(3, '0')}/${fy}`;
}

/**

 * Generate next Vendor Voucher number (Purchase FMS — Step 1.11).
 * Zero-padded sequence, reset per fiscal year.
 * @param {Date} date — date to determine fiscal year
 * @returns {string} e.g. "PV-001/26-27"
 */
export async function generateVoucherNumber(date = new Date()) {
  const fy = getFiscalYear(date);
  const counter = await Counter.findByIdAndUpdate(
    `PV_${fy}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `PV-${String(counter.seq).padStart(3, '0')}/${fy}`;
}

/**
 * Generate next Purchase Voucher number (Step 1.11 — voucherType PURCHASE).
 * @returns {string} e.g. "AGL/PUR-001/26-27"
 */
export async function generatePurchaseVoucherNumber(date = new Date()) {
  const fy = getFiscalYear(date);
  const counter = await Counter.findByIdAndUpdate(
    `PUR_${fy}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `AGL/PUR-${String(counter.seq).padStart(3, '0')}/${fy}`;
}

/**
 * Generate next Expense Voucher number (Step 1.11 — voucherType EXPENSE).
 * @returns {string} e.g. "AGL/EXP-001/26-27"
 */
export async function generateExpenseVoucherNumber(date = new Date()) {
  const fy = getFiscalYear(date);
  const counter = await Counter.findByIdAndUpdate(
    `EXP_${fy}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `AGL/EXP-${String(counter.seq).padStart(3, '0')}/${fy}`;
}

/**
 * Generate next Purchase Tally Entry number (Purchase FMS — Step 1.12).
 * Zero-padded sequence, reset per fiscal year.
 * @param {Date} date — date to determine fiscal year
 * @returns {string} e.g. "TLY-001/26-27"
 */
export async function generateTallyEntryNumber(date = new Date()) {
  const fy = getFiscalYear(date);
  const counter = await Counter.findByIdAndUpdate(
    `TLY_${fy}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `TLY-${String(counter.seq).padStart(3, '0')}/${fy}`;
}

/**
 * Generate next Vendor Final Payment number (Purchase FMS — Step 1.13).
 * Zero-padded sequence, reset per fiscal year.
 * @param {Date} date — date to determine fiscal year
 * @returns {string} e.g. "PAY-001/26-27"
 */
export async function generateFinalPaymentNumber(date = new Date()) {
  const fy = getFiscalYear(date);
  const counter = await Counter.findByIdAndUpdate(
    `PAY_${fy}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `PAY-${String(counter.seq).padStart(3, '0')}/${fy}`;
}

/**
 * Generate next Incoming QC number (Purchase FMS — Step 1.9).
 * Zero-padded sequence, reset per fiscal year.
 * @param {Date} date — date to determine fiscal year
 * @returns {string} e.g. "AGL/QC-001/26-27"
 */
export async function generateQcNumber(date = new Date()) {
  const fy = getFiscalYear(date);
  const counter = await Counter.findByIdAndUpdate(
    `QC_${fy}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `AGL/QC-${String(counter.seq).padStart(3, '0')}/${fy}`;
}

/**
 * Generate next Service Completion number (Purchase FMS — Step 1.8A).
 * Zero-padded sequence, reset per fiscal year.
 * @param {Date} date — date to determine fiscal year
 * @returns {string} e.g. "AGL/SC-001/26-27"
 */
export async function generateServiceCompletionNumber(date = new Date()) {
  const fy = getFiscalYear(date);
  const counter = await Counter.findByIdAndUpdate(
    `SC_${fy}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `AGL/SC-${String(counter.seq).padStart(3, '0')}/${fy}`;
}

/**
 * Generate next Goods Receipt Note number (Purchase FMS — Step 1.8).
 * Zero-padded sequence, reset per fiscal year.
 * @param {Date} date — date to determine fiscal year
 * @returns {string} e.g. "GRN-001/26-27"
 */
export async function generateGrnNumber(date = new Date()) {
  const fy = getFiscalYear(date);
  const counter = await Counter.findByIdAndUpdate(
    `GRN_${fy}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `AGL/GRN-${String(counter.seq).padStart(3, '0')}/${fy}`;
}

/**
 * Generate the short GRN unique id (global, never resets).
 * @returns {string} e.g. "UID-1"
 */
export async function generateGrnUniqueId() {
  const counter = await Counter.findByIdAndUpdate(
    'GRN_UNIQUE',
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `UID-${counter.seq}`;
}

/**
 * Generate next Inventory Stock Movement number.
 * Zero-padded sequence, reset per fiscal year.
 * @param {Date} date — date to determine fiscal year
 * @returns {string} e.g. "MOV-001/26-27"
 */
export async function generateMovementNumber(date = new Date()) {
  const fy = getFiscalYear(date);
  const counter = await Counter.findByIdAndUpdate(
    `MOV_${fy}`,
    { $inc: { seq: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return `MOV-${String(counter.seq).padStart(3, '0')}/${fy}`;
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
