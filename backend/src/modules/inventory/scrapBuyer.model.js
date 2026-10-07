import mongoose from 'mongoose';
import { baseSchemaFields, baseSchemaOptions } from '../../database/BaseSchema.js';

const { Schema, model } = mongoose;

/**
 * Scrap Buyer — who Ambika sells scrap to.
 *
 * ── WHY NOT THE PARTY MASTER ────────────────────────────────────────────────
 * Party is the CUSTOMER master for orders, challans, invoices and payments, and
 * it carries no type or role field — the one attempt to add one (`isVendor`)
 * had to be undone by cleanup_party_vendor_pollution.js. The O2D and
 * procurement pickers that read it ask for small pages sorted newest-first and
 * cannot filter by role, so every scrap buyer stored there would push a real
 * customer out of the order screens. The ledger's own note on `partyName`
 * already records the decision: scrap buyers are not in the Party master. This
 * is their master, shaped like the other small masters (see Transporter).
 *
 * ── DUPLICATES ARE REFUSED BY THE DATABASE ──────────────────────────────────
 * `nameKey` is the name folded for comparison (case and whitespace ignored),
 * and it is unique among live buyers. A check in the service alone would let
 * a double-clicked "Save" create two; the index makes the second one fail and
 * the service then hands back the first. A GSTIN, when given, is unique the
 * same way — one registered business is one buyer, whatever it is called.
 * Both indexes ignore soft-deleted rows, so a removed buyer can be re-added.
 */
const scrapBuyerSchema = new Schema({
  ...baseSchemaFields,

  code:    { type: String, unique: true, sparse: true, trim: true, uppercase: true }, // SB-0001
  name:    { type: String, required: [true, 'Buyer name is required'], trim: true },
  nameKey: { type: String, required: true, trim: true },

  contactPerson: { type: String, trim: true, default: '' },
  phone:         { type: String, trim: true, default: '' },
  email:         { type: String, trim: true, lowercase: true, default: '' },
  address:       { type: String, trim: true, default: '' },
  state:         { type: String, trim: true, default: '' },
  gstNo:         { type: String, trim: true, uppercase: true, default: '' },
}, baseSchemaOptions);

scrapBuyerSchema.index(
  { nameKey: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false }, name: 'uniq_live_buyer_name' },
);
scrapBuyerSchema.index(
  { gstNo: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false, gstNo: { $gt: '' } },
    name: 'uniq_live_buyer_gst',
  },
);
scrapBuyerSchema.index({ isActive: 1, name: 1 });

const ScrapBuyer = model('ScrapBuyer', scrapBuyerSchema);
export default ScrapBuyer;
