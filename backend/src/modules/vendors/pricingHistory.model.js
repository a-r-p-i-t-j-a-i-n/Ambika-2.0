import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// Where a rate/GST change originated.
export const PRICING_SOURCE = {
  VENDOR_MASTER:  'VENDOR_MASTER',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
};

/**
 * Vendor Pricing History (Purchase FMS) — an append-only audit of every SKU
 * rate / GST change for a vendor, whether it happened in the Vendor Master or
 * while creating a Purchase Order. Records are never deleted. The Vendor Master
 * product always mirrors the latest entry's newRate / newGstRate.
 */
const pricingHistorySchema = new Schema({
  vendorId:   { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
  vendorName: { type: String, trim: true, default: '' },

  skuId:    { type: Schema.Types.ObjectId, ref: 'SKU', default: null },
  skuCode:  { type: String, trim: true, uppercase: true, default: '' },
  itemName: { type: String, trim: true, default: '' },

  oldRate:    { type: Number, default: 0 },
  newRate:    { type: Number, default: 0 },
  oldGstRate: { type: Number, default: 0 },
  newGstRate: { type: Number, default: 0 },
  hsn:        { type: String, trim: true, default: '' },
  unit:       { type: String, trim: true, default: '' },

  effectiveDate: { type: Date, default: Date.now },

  // Origin of the change.
  source:        { type: String, enum: Object.values(PRICING_SOURCE), required: true, index: true },
  referenceType: { type: String, enum: Object.values(PRICING_SOURCE), required: true },
  referenceId:   { type: Schema.Types.ObjectId, default: null }, // vendorId or PO id
  referenceNumber: { type: String, trim: true, default: '' },    // PO number when source = PURCHASE_ORDER

  updatedBy:     { type: Schema.Types.ObjectId, ref: 'User', default: null },
  updatedByName: { type: String, trim: true, default: '' },
  remarks:       { type: String, trim: true, default: '' },
}, { timestamps: true });

pricingHistorySchema.index({ vendorId: 1, createdAt: -1 });
pricingHistorySchema.index({ vendorId: 1, skuCode: 1, createdAt: -1 });

const PricingHistory = model('PricingHistory', pricingHistorySchema);
export default PricingHistory;
