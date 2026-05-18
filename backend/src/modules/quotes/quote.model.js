/**
 * Quote — a saved snapshot of a Turnover Calculator run.
 *
 * Quotes are FROZEN: once saved, the unit prices, gst rates, totals and
 * as-of date are immutable. Reopening a quote a year later shows the
 * exact same numbers. This is the difference between a calculator and
 * a quote.
 *
 * Status lifecycle:
 *   DRAFT  → SENT → ACCEPTED → CONVERTED_TO_SO
 *                 → EXPIRED (when validUntil passes)
 *                 → REJECTED
 */

import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

const QuoteLineSchema = new Schema({
  skuId:        { type: Schema.Types.ObjectId, ref: 'SKU', required: true },
  skuCode:      { type: String, required: true },
  skuName:      { type: String, required: true },
  qty:          { type: Number, required: true, min: 0 },
  unitPrice:    { type: Number, required: true, min: 0 },
  gstRate:      { type: Number, required: true, default: 18 },
  source:       { type: String, enum: ['MASTER', 'MANUAL', 'NONE'], default: 'MASTER' },
  revisionId:   { type: Schema.Types.ObjectId, ref: 'PriceRevision', default: null },
  lineSubtotal: { type: Number, required: true, default: 0 },
  lineGst:      { type: Number, required: true, default: 0 },
  lineTotal:    { type: Number, required: true, default: 0 },
}, { _id: false });

const QuoteSchema = new Schema({
  ...baseSchemaFields,

  quoteNumber:    { type: String, required: true, unique: true, index: true },
  asOfDate:       { type: Date, required: true },
  validUntil:     { type: Date, required: true },
  priceType:      { type: String, enum: ['SELLING', 'RM_COST'], default: 'SELLING' },

  partyId:        { type: Schema.Types.ObjectId, ref: 'Party', default: null },
  partyName:      { type: String, default: '' },
  poReference:    { type: String, default: '' },

  lines: [QuoteLineSchema],

  totals: {
    subtotal:   { type: Number, default: 0 },
    gstTotal:   { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
  },
  gstBreakdown: { type: Map, of: Number, default: {} },

  status: {
    type: String,
    enum: ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED_TO_SO'],
    default: 'DRAFT',
    index: true,
  },

  sentAt:         { type: Date, default: null },
  acceptedAt:     { type: Date, default: null },
  convertedToSo:  { type: Schema.Types.ObjectId, ref: 'SalesOrder', default: null },
  convertedAt:    { type: Date, default: null },

  notes:          { type: String, default: '' },

  createdByName:  { type: String, default: '' },
}, baseSchemaOptions);

QuoteSchema.index({ status: 1, validUntil: 1 });
QuoteSchema.index({ partyId: 1, createdAt: -1 });

const Quote = model('Quote', QuoteSchema);
export default Quote;
