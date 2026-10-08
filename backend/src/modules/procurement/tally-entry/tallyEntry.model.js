import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Purchase Tally Entry — Purchase FMS Step 1.12.
 *
 * After a voucher is posted, the accounts team records the purchase
 * invoice/voucher in Tally. This step tracks whether the accounting entry is
 * done and whether the invoice checklist has been verified. No money is moved
 * here — payment happens in Step 1.13 (Make Payment).
 */

export const TALLY_ENTRY_STATUS = {
  PENDING:   'PENDING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

export const STATUS_DONE = {
  YES: 'YES',
  NO:  'NO',
};

// Checklist keys — every one must be true before a Tally Entry can be completed.
export const CHECKLIST_KEYS = [
  'companyGstDetails',
  'invoiceQtyMatchesPoAndGrn',
  'invoiceRateMatchesPo',
  'gstRateApplicable',
  'tdsDeductedIfApplicable',
  'totalCalculationVerified',
];

const checklistSchema = new Schema({
  companyGstDetails:         { type: Boolean, default: false }, // Our company name, address & GST
  invoiceQtyMatchesPoAndGrn: { type: Boolean, default: false }, // Invoice qty = PO qty = GRN qty
  invoiceRateMatchesPo:      { type: Boolean, default: false }, // Invoice rate = PO rate
  gstRateApplicable:         { type: Boolean, default: false }, // GST rate applicable
  tdsDeductedIfApplicable:   { type: Boolean, default: false }, // TDS deducted if applicable
  totalCalculationVerified:  { type: Boolean, default: false }, // Total calculation
}, { _id: false });

const tallyEntrySchema = new Schema({
  ...baseSchemaFields,

  entryNumber: { type: String, unique: true, trim: true, index: true }, // TLY-001/26-27

  // ── Linkage (Voucher → Invoice → PO/GRN → Vendor) ──
  voucherId:     { type: Schema.Types.ObjectId, ref: 'VendorVoucher', required: true, index: true },
  voucherNumber: { type: String, trim: true, default: '' },
  invoiceId:     { type: Schema.Types.ObjectId, ref: 'VendorInvoice' },
  invoiceNumber: { type: String, trim: true, default: '' },
  poId:          { type: Schema.Types.ObjectId, ref: 'VendorPurchaseOrder' },
  poNumber:      { type: String, trim: true, default: '' },
  grnId:         { type: Schema.Types.ObjectId, ref: 'GoodsReceiptNote' },
  grnNumber:     { type: String, trim: true, default: '' },
  // Multi-GRN invoices — every GRN covered by the source voucher.
  grnIds:        { type: [{ type: Schema.Types.ObjectId, ref: 'GoodsReceiptNote' }], default: [] },
  grnNumbers:    { type: [String], default: [] },
  vendorId:      { type: Schema.Types.ObjectId, ref: 'Party', index: true },
  vendorName:    { type: String, trim: true, default: '' },

  // ── Step meta ──
  stepNo:   { type: String, default: 'Step 1.12' },
  stepName: { type: String, default: 'Purchase Entry in Tally 1.12' },

  plannedAt: { type: Date, default: null },
  actualAt:  { type: Date, default: null },

  // ── Accounting ──
  statusDone:       { type: String, enum: Object.values(STATUS_DONE), default: STATUS_DONE.NO },
  checklist:        { type: checklistSchema, default: () => ({}) },
  tallyVoucherNumber: { type: String, trim: true, default: '' },
  tallyLedgerName:    { type: String, trim: true, default: '' },
  remarks:            { type: String, trim: true, default: '' },

  // ── Status ──
  tallyEntryStatus: { type: String, enum: Object.values(TALLY_ENTRY_STATUS), default: TALLY_ENTRY_STATUS.PENDING, index: true },
  completedAt:      { type: Date, default: null },
  cancelledAt:      { type: Date, default: null },

  performedBy:     { type: Schema.Types.ObjectId, ref: 'User', default: null },
  performedByName: { type: String, trim: true, default: '' },
}, baseSchemaOptions);

tallyEntrySchema.index({ entryNumber: 'text', voucherNumber: 'text', invoiceNumber: 'text', vendorName: 'text' });
tallyEntrySchema.index({ vendorId: 1, tallyEntryStatus: 1 });

// Convenience virtual: how many checklist items are ticked.
tallyEntrySchema.virtual('checklistDone').get(function checklistDone() {
  const cl = this.checklist || {};
  return CHECKLIST_KEYS.filter((k) => cl[k]).length;
});
tallyEntrySchema.virtual('checklistTotal').get(() => CHECKLIST_KEYS.length);

const PurchaseTallyEntry = model('PurchaseTallyEntry', tallyEntrySchema);
export default PurchaseTallyEntry;
