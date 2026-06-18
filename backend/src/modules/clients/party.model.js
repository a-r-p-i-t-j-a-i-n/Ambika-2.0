import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

const addressSchema = new Schema({
  label:  { type: String, default: 'Primary' },
  line1:  { type: String },
  line2:  { type: String },
  city:   { type: String },
  state:  { type: String },
  pin:    { type: String },
}, { _id: false });

// ── Vendor / Procurement: a product this party (vendor) can supply ──
// Used by Purchase FMS (RFQ, Vendor Quotation, Vendor PO, GRN) to pre-load
// the items a vendor offers. `skuId` is optional — products can be free-typed
// or linked to the SKU master for auto-fill.
const suppliedProductSchema = new Schema({
  skuId:       { type: Schema.Types.ObjectId, ref: 'SKU' },
  productName: { type: String, trim: true },
  skuCode:     { type: String, trim: true, uppercase: true },
  rate:        { type: Number, min: 0, default: 0 },
  unit:        { type: String, trim: true, default: 'Pcs' },
}, { _id: true });

// ── Customer: a SKU this client (party) regularly ORDERS from us ──
// Built from the Party Details sheet (one row per SKU). When the party is
// chosen on a Sales Order, these auto-fill the line items. skuId links to the
// SKU master when a name/code match is found.
const orderedSkuSchema = new Schema({
  skuId:        { type: Schema.Types.ObjectId, ref: 'SKU', default: null },
  skuName:      { type: String, trim: true },
  skuCode:      { type: String, trim: true, uppercase: true },
  unit:         { type: String, trim: true, default: 'Pcs' },
  pcsPerBox:    { type: Number, default: 0 },
  weightPerBox: { type: Number, default: 0 },
  sellingPrice: { type: Number, default: 0 }, // "SP" from the sheet
}, { _id: true });

const partySchema = new Schema({
  ...baseSchemaFields,

  code: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    uppercase: true,
  },
  name: {
    type: String,
    required: [true, 'Party name is required'],
    trim: true,
    index: true,
  },
  location: { type: String, trim: true }, // "Place" from the sheet (city/region)
  address:  { type: String, trim: true }, // full postal address (from sheet)
  state:    { type: String, trim: true },
  gstNo:    { type: String, trim: true, uppercase: true },

  contactPerson: { type: String, trim: true },
  email:         { type: String, trim: true, lowercase: true },
  phone:         { type: String, trim: true },

  // NOTE: the vendor form's "Address" reuses the existing `location` field
  // (same concept). No separate `address` field — see PARTY_VENDOR_EXTENSION.md.

  // ── Tax & Financial (used as Vendor in Purchase FMS) ──
  panNo:     { type: String, trim: true, uppercase: true, default: '' },
  gstRate:   { type: Number, min: 0, max: 100, default: 0 }, // applicable GST %
  tdsRate:   { type: Number, min: 0, max: 100, default: 0 }, // applicable TDS %

  // Specialized Email Routing for Dispatch/Communication
  toEmails:       [{ type: String, trim: true, lowercase: true }],
  ccEmails:       [{ type: String, trim: true, lowercase: true }],
  bccEmails:      [{ type: String, trim: true, lowercase: true }],
  accountsEmails: [{ type: String, trim: true, lowercase: true }], // payment/accounts routing

  creditPeriodDays: { type: Number, default: 30 }, // "Credit Period" from the sheet
  leadTimeDays:     { type: Number, default: 7 },
  approxDays:       { type: Number, default: 0 },  // "Approx Days" from the sheet

  addresses: [addressSchema],

  // ── Procurement: products this party can supply (Party = Vendor in FMS) ──
  suppliedProducts: { type: [suppliedProductSchema], default: [] },

  // ── Sales: SKUs this client regularly orders (auto-fill on Sales Order) ──
  orderedSkus: { type: [orderedSkuSchema], default: [] },

}, baseSchemaOptions);

// ── Indexes ──────────────────────────────────────────────────
partySchema.index({ name: 'text', code: 'text', location: 'text' });
partySchema.index({ isActive: 1, name: 1 });
partySchema.index({ companyId: 1 });

const Party = model('Party', partySchema);
export default Party;

