/**
 * Undo the bad vendor-into-Party migration.
 *   1. DELETE pure vendor parties (isVendor:true, no customer orderedSkus) — these
 *      were created in error and now live in the separate `vendors` collection.
 *   2. SCRUB the few customer parties that got vendor fields overwritten: drop the
 *      vendor-injected scalars + suppliedProducts + isVendor. Customer fields
 *      (orderedSkus/emails/address/credit) are then restored by re-running
 *      import_party_details.js.
 *
 * Usage: node src/scripts/cleanup_party_vendor_pollution.js
 */

import mongoose from 'mongoose';
import env from '../config/env.js';
import Party from '../modules/clients/party.model.js';

const run = async () => {
  await mongoose.connect(env.MONGO_URI);

  // 1) Pure vendors → delete.
  const del = await Party.deleteMany({
    isVendor: true,
    $or: [{ orderedSkus: { $exists: false } }, { orderedSkus: { $size: 0 } }],
  });

  // 2) Customers that were polluted → scrub vendor data, keep orderedSkus.
  const scrub = await Party.updateMany(
    { isVendor: true },
    {
      $set: { suppliedProducts: [], contactPerson: '', phone: '', gstNo: '', panNo: '', gstRate: 0, tdsRate: 0 },
      $unset: { isVendor: '' },
    },
  );

  // Clear stray isVendor on anything else.
  await Party.updateMany({ isVendor: { $exists: true } }, { $unset: { isVendor: '' } });

  console.log(`🧹 Deleted ${del.deletedCount} pure-vendor parties · scrubbed ${scrub.modifiedCount} polluted customer parties.`);
  console.log('   ➜ Now re-run: node src/scripts/import_party_details.js  (restores customer emails/address/orderedSkus)');
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (e) => { console.error('❌ Cleanup failed:', e); await mongoose.connection.close().catch(() => {}); process.exit(1); });
