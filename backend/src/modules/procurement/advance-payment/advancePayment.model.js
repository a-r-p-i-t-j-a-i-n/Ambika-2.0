import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Advance Payment — Purchase FMS Step 1.7.
 *
 * One document per payment event against a Proforma Invoice. Posting updates
 * the PI's paidAmount / balanceAmount; CANCELLED entries are recorded for the
 * audit trail but post nothing.
 *
 * NOTE: a legacy 'Payment' mongoose model exists (sell-side O2D receivables),
 * so this registers as 'AdvancePayment' (collection `advancepayments`).
 */

export const PAYMENT_STATUS = {
  PART_PAYMENT:            'PART_PAYMENT',
  FULL_PAYMENT:            'FULL_PAYMENT',
  SHORT_PAYMENT_COMPLETED: 'SHORT_PAYMENT_COMPLETED',
  CANCELLED:               'CANCELLED',
};

export const PAYMENT_MODE = {
  E_FUND_TRANSFER: 'E_FUND_TRANSFER',
  NEFT:            'NEFT',
  RTGS:            'RTGS',
  IMPS:            'IMPS',
  UPI:             'UPI',
  CHEQUE:          'CHEQUE',
  CASH:            'CASH',
  OTHER:           'OTHER',
};

const advancePaymentSchema = new Schema({
  ...baseSchemaFields,

  paymentNumber: { type: String, unique: true, trim: true, index: true }, // auto: ADV-001/26-27

  // ── Sheet step identity ──
  stepNo:   { type: String, default: 'Step 1.7' },
  stepName: { type: String, default: 'Advance Payment 1.07' },

  // ── Linkage (PI → PO → Vendor) ──
  piId:         { type: Schema.Types.ObjectId, ref: 'ProformaInvoice', required: true, index: true },
  piNumber:     { type: String, trim: true, index: true },
  poId:         { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder', index: true },
  poNumber:     { type: String, trim: true },
  indentNumber: { type: String, trim: true },
  vendorId:     { type: Schema.Types.ObjectId, ref: 'Party', index: true },
  vendorName:   { type: String, trim: true, default: '' },

  // ── Google-form fields ──
  paymentStatus:          { type: String, enum: Object.values(PAYMENT_STATUS), required: true, index: true },
  paymentDate:            { type: Date, required: [true, 'Payment date is required'] },
  paidAmount:             { type: Number, default: 0, min: 0 },
  paymentMode:            { type: String, enum: Object.values(PAYMENT_MODE), default: PAYMENT_MODE.E_FUND_TRANSFER },
  paymentReferenceNumber: { type: String, trim: true, default: '' }, // GBM-00345061714 / UTR / CHQ…

  // Snapshots at posting time (for the ledger view).
  previousBalance: { type: Number, default: 0, min: 0 },
  balanceAmount:   { type: Number, default: 0, min: 0 }, // PI balance AFTER this payment

  performedByName: { type: String, trim: true, default: '' },

}, baseSchemaOptions);

// ── Indexes ──────────────────────────────────────────────────
advancePaymentSchema.index({ paymentNumber: 'text', piNumber: 'text', poNumber: 'text', vendorName: 'text', paymentReferenceNumber: 'text' });
advancePaymentSchema.index({ piId: 1, paymentStatus: 1 });
advancePaymentSchema.index({ paymentDate: -1 });

const AdvancePayment = model('AdvancePayment', advancePaymentSchema);
export default AdvancePayment;
