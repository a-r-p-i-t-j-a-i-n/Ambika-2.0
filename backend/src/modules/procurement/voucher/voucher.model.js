import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Vendor Payment Voucher — Purchase FMS Step 1.11.
 *
 * Created only from an APPROVED (payment-pending) Vendor Invoice. Pulls the
 * net payable (after advance + debit-note adjustment) and records payment.
 * Posting marks the invoice PAYMENT_COMPLETED once fully paid — Accounts Ready.
 */

export const VOUCHER_STATUS = {
  DRAFT:          'DRAFT',
  POSTED:         'POSTED',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  FULLY_PAID:     'FULLY_PAID',
  SHORT_CLOSED:   'SHORT_CLOSED',
  CANCELLED:      'CANCELLED',
};

export const PAYMENT_MODE = {
  NEFT:   'NEFT',
  RTGS:   'RTGS',
  IMPS:   'IMPS',
  UPI:    'UPI',
  CHEQUE: 'CHEQUE',
  CASH:   'CASH',
  OTHER:  'OTHER',
};

const voucherSchema = new Schema({
  ...baseSchemaFields,

  voucherNumber: { type: String, unique: true, trim: true, index: true }, // PV-001/26-27
  voucherDate:   { type: Date, default: Date.now },

  // ── Linkage (Invoice → QC/GRN/PO → Vendor) ──
  invoiceId:     { type: Schema.Types.ObjectId, ref: 'VendorInvoice', required: true, index: true },
  invoiceNumber: { type: String, trim: true, index: true },
  vendorId:      { type: Schema.Types.ObjectId, ref: 'Party', index: true },
  vendorName:    { type: String, trim: true, default: '' },
  poId:          { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder' },
  poNumber:      { type: String, trim: true, default: '' },
  grnId:         { type: Schema.Types.ObjectId, ref: 'GoodsReceiptNote' },
  qcId:          { type: Schema.Types.ObjectId, ref: 'IncomingQC' },

  // ── Financials (snapshot from the invoice) ──
  invoiceAmount:    { type: Number, default: 0 },
  advancePaid:      { type: Number, default: 0, min: 0 },
  debitNoteAmount:  { type: Number, default: 0, min: 0 },
  netPayableAmount: { type: Number, default: 0 },
  paidAmount:       { type: Number, default: 0, min: 0 },
  balanceAmount:    { type: Number, default: 0 }, // netPayable − paidAmount

  // ── Payment ──
  paymentMode:     { type: String, enum: Object.values(PAYMENT_MODE), default: PAYMENT_MODE.NEFT },
  referenceNumber: { type: String, trim: true, default: '' },
  bankName:        { type: String, trim: true, default: '' },
  utrNumber:       { type: String, trim: true, default: '' },
  chequeNumber:    { type: String, trim: true, default: '' },
  paymentProof:    {
    fileUrl:  { type: String, trim: true, default: '' },
    fileName: { type: String, trim: true, default: '' },
  },
  paymentDate:     { type: Date, default: null },

  // ── Status ──
  voucherStatus: { type: String, enum: Object.values(VOUCHER_STATUS), default: VOUCHER_STATUS.DRAFT, index: true },
  postedAt:      { type: Date, default: null },
  cancelledAt:   { type: Date, default: null },

  // ── Step 1.12 — Purchase Entry in Tally ──
  tallyEntryStatus: { type: String, enum: ['PENDING', 'COMPLETED', 'CANCELLED'], default: 'PENDING', index: true },
  tallyEntryId:     { type: Schema.Types.ObjectId, ref: 'PurchaseTallyEntry', default: null },
  tallyEntryNumber: { type: String, trim: true, default: '' },

  // ── Step 1.13 — Make Payment (final) ──
  finalPaymentStatus: { type: String, enum: ['PENDING', 'PART_PAYMENT', 'FULL_PAYMENT', 'SHORT_PAYMENT_COMPLETED'], default: 'PENDING', index: true },
  lastPaymentDate:    { type: Date, default: null },

  remarks: { type: String, trim: true, default: '' },
}, baseSchemaOptions);

voucherSchema.index({ voucherNumber: 'text', invoiceNumber: 'text', vendorName: 'text', referenceNumber: 'text' });
voucherSchema.index({ vendorId: 1, voucherStatus: 1 });
voucherSchema.index({ voucherDate: -1 });

const VendorVoucher = model('VendorVoucher', voucherSchema);
export default VendorVoucher;
