import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Vendor Final Payment — Purchase FMS Step 1.13 (Make Payment).
 *
 * The final settlement against an approved voucher, raised only after the
 * Tally Entry (Step 1.12) is completed. Distinct from Advance Payment (1.07),
 * which is paid *before* material/accounting. Each payment reduces the voucher
 * balance; full / short-closed settlements mark the invoice PAYMENT_COMPLETED.
 */

export const FINAL_PAYMENT_STATUS = {
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

const finalPaymentSchema = new Schema({
  ...baseSchemaFields,

  paymentNumber: { type: String, unique: true, trim: true, index: true }, // PAY-001/26-27

  // ── Linkage (Voucher → Invoice → PO → Vendor) ──
  voucherId:     { type: Schema.Types.ObjectId, ref: 'VendorVoucher', required: true, index: true },
  voucherNumber: { type: String, trim: true, index: true },
  invoiceId:     { type: Schema.Types.ObjectId, ref: 'VendorInvoice' },
  invoiceNumber: { type: String, trim: true, default: '' },
  vendorId:      { type: Schema.Types.ObjectId, ref: 'Party', index: true },
  vendorName:    { type: String, trim: true, default: '' },
  poId:          { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder' },
  poNumber:      { type: String, trim: true, default: '' },

  stepNo:   { type: String, default: 'Step 1.13' },
  stepName: { type: String, default: 'Make Payment 1.13' },

  paymentStatus: { type: String, enum: Object.values(FINAL_PAYMENT_STATUS), required: true, index: true },

  paymentDate: { type: Date, default: Date.now },
  paidAmount:  { type: Number, default: 0, min: 0 },

  paymentMode:            { type: String, enum: Object.values(PAYMENT_MODE), default: PAYMENT_MODE.NEFT },
  paymentReferenceNumber: { type: String, trim: true, default: '' },
  remarks:                { type: String, trim: true, default: '' },

  // ── Balance snapshot (against the voucher) ──
  previousBalance:     { type: Number, default: 0 }, // voucher balance before this payment
  balanceAfterPayment: { type: Number, default: 0 }, // voucher balance after this payment

  proofDocument: {
    fileName:   { type: String, trim: true, default: '' },
    fileUrl:    { type: String, trim: true, default: '' },
    fileType:   { type: String, trim: true, default: '' },
    uploadedAt: { type: Date, default: null },
  },

  performedBy:     { type: Schema.Types.ObjectId, ref: 'User', default: null },
  performedByName: { type: String, trim: true, default: '' },
  cancelledAt:     { type: Date, default: null },
}, baseSchemaOptions);

finalPaymentSchema.index({ paymentNumber: 'text', voucherNumber: 'text', invoiceNumber: 'text', vendorName: 'text', paymentReferenceNumber: 'text' });
finalPaymentSchema.index({ vendorId: 1, paymentStatus: 1 });
finalPaymentSchema.index({ paymentDate: -1 });

const VendorFinalPayment = model('VendorFinalPayment', finalPaymentSchema);
export default VendorFinalPayment;
