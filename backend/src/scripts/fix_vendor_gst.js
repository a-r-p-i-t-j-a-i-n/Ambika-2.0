/**
 * Fix vendor GST rates that were imported as FRACTIONS instead of whole percent.
 *
 * The vendor sheet is an .xlsx where percentage cells are stored as fractions
 * (5% → 0.05), so the import saved gstRate as 0.05 / 0.12 / 0.18 instead of
 * 5 / 12 / 18. This rescales every gstRate strictly between 0 and 1 by ×100.
 *
 * SAFE & idempotent: leaves 0 untouched and never re-scales already-correct
 * values (>= 1), so a second run is a no-op. Only touches gstRate (NOT tdsRate,
 * whose valid values can legitimately be < 1, e.g. 0.1%).
 *
 * Usage:  node src/scripts/fix_vendor_gst.js [--dry-run]
 */

import mongoose from 'mongoose';
import env from '../config/env.js';
import Vendor from '../modules/vendors/vendor.model.js';

const DRY = process.argv.includes('--dry-run');
const rescale = (v) => (typeof v === 'number' && v > 0 && v < 1 ? Math.round(v * 100) : v);

const run = async () => {
  await mongoose.connect(env.MONGO_URI);
  const vendors = await Vendor.find({});
  let vendorsFixed = 0; let vendorLevel = 0; let productLevel = 0;

  for (const ven of vendors) {
    let changed = false;
    const ng = rescale(ven.gstRate);
    if (ng !== ven.gstRate) { ven.gstRate = ng; vendorLevel += 1; changed = true; }
    (ven.products || []).forEach((p) => {
      const np = rescale(p.gstRate);
      if (np !== p.gstRate) { p.gstRate = np; productLevel += 1; changed = true; }
    });
    if (changed) { vendorsFixed += 1; if (!DRY) await ven.save(); }
  }

  console.log(`${DRY ? '(DRY RUN) ' : ''}✅ Vendors touched ${vendorsFixed} · vendor-level gst fixed ${vendorLevel} · product-level gst fixed ${productLevel}.`);
  await mongoose.connection.close();
  process.exit(0);
};
run().catch(async (e) => { console.error('❌ Fix failed:', e); await mongoose.connection.close().catch(() => {}); process.exit(1); });
