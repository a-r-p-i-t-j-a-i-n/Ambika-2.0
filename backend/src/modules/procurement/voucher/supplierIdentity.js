/**
 * Which master records are the SAME supplier?
 *
 * Purchase FMS has two supplier masters and no link between them: Vendor (new
 * POs, GRN Without PO, Direct Purchase vouchers) and the older Party master
 * (Direct Expense bills, legacy POs). A document's `vendorId` can therefore be
 * either id. Names are free text and never used to decide identity.
 *
 * The one identity both masters carry is the GSTIN. It is only trusted when it
 * is a well-formed GSTIN with a correct check digit (a typo or a placeholder
 * such as "NA" / "0" never matches anything): GST law gives each registration a
 * single GSTIN and requires its invoice numbers to be unique, so two records
 * holding the same valid GSTIN are one supplier for the purpose of "this
 * invoice number was already recorded".
 *
 * A supplier whose record has no valid GSTIN is matched on its own id only —
 * nothing is guessed. `gstNo` is free text, optional and unique-indexed nowhere,
 * so this is only as good as the master data (see the audit notes in the
 * Direct Purchase Voucher memory / final report).
 */
import mongoose from 'mongoose';
import Vendor from '../../vendors/vendor.model.js';
import Party from '../../clients/party.model.js';

const GSTIN_FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const checkDigit = (g) => {
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = CHARSET.indexOf(g[i]) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARSET[(36 - (sum % 36)) % 36];
};

/** The GSTIN upper-cased and without spaces, or '' when it is not a valid one. */
export const validGstin = (raw) => {
  const g = String(raw || '').replace(/\s+/g, '').toUpperCase();
  return GSTIN_FORMAT.test(g) && checkDigit(g) === g[14] ? g : '';
};

const asId = (id) => (mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(String(id)) : null);

/**
 * Every master id that is the same supplier as `vendorId` (a Vendor or a Party
 * id): the id itself, plus — when its record has a valid GSTIN — every Vendor /
 * Party record (deleted or inactive included: old documents may still point at
 * them) holding that same GSTIN. Always contains `vendorId` first.
 */
export const supplierIdsFor = async (vendorId) => {
  const self = asId(vendorId);
  if (!self) return [];
  const [vendor, party] = await Promise.all([
    Vendor.findById(self).select('gstNo').lean(),
    Party.findById(self).select('gstNo').lean(),
  ]);
  const gstin = validGstin((vendor || party)?.gstNo);
  if (!gstin) return [self];
  const rx = new RegExp(`^\\s*${gstin.split('').join('\\s*')}\\s*$`, 'i');
  const [vendors, parties] = await Promise.all([
    Vendor.find({ gstNo: rx }).select('_id gstNo').lean(),
    Party.find({ gstNo: rx }).select('_id gstNo').lean(),
  ]);
  const peers = [...vendors, ...parties].filter((r) => validGstin(r.gstNo) === gstin).map((r) => r._id);
  const seen = new Set([String(self)]);
  const out = [self];
  for (const id of peers) if (!seen.has(String(id))) { seen.add(String(id)); out.push(id); }
  return out;
};
