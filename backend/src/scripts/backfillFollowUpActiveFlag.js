/**
 * Migration — backfill purchasefollowups.isActiveFollowUp and build the new
 * partial unique index that enforces "at most one active follow-up per PO".
 *
 * Context: `isActiveFollowUp` is a new field (default `true` for documents
 * created from now on) that mirrors followUpStatus PENDING/RESCHEDULED =
 * true, anything else (DONE/READY_FOR_GRN/CLOSED) or soft-deleted = false.
 * Existing documents in the database were written before this field existed,
 * so they don't have it set — this script sets it correctly on every one of
 * them, then creates the partial unique index on { poId: 1 } (filtered to
 * isActiveFollowUp: true) so MongoDB itself rejects a second concurrent
 * active follow-up for the same PO.
 *
 * Duplicate handling (required before a UNIQUE index can be built): if a PO
 * somehow already has more than one PENDING/RESCHEDULED follow-up (possible
 * only from before the service-level guard existed), this script keeps the
 * most-recently-created one active and demotes the older one(s) to
 * isActiveFollowUp=false — NOTHING IS DELETED, every record stays in the
 * database exactly as it was, just no longer flagged "active". Every demoted
 * record is printed so it can be reviewed manually afterwards.
 *
 * Safe to run repeatedly (idempotent). Must be run once against the live
 * database before the new index can take effect for pre-existing data —
 * this repository has no local mongod to run it against in CI/dev sandboxes.
 *
 * Usage:  node src/scripts/backfillFollowUpActiveFlag.js
 */

import mongoose from 'mongoose';
import env from '../config/env.js';

const ACTIVE_STATUSES = ['PENDING', 'RESCHEDULED'];

const run = async () => {
  await mongoose.connect(env.MONGO_URI);
  const coll = mongoose.connection.collection('purchasefollowups');

  // 1) Every non-deleted document with an active status → isActiveFollowUp: true;
  //    everything else (concluded cycles, legacy docs with no status at all,
  //    and soft-deleted rows) → isActiveFollowUp: false.
  const toActive = await coll.updateMany(
    { isDeleted: { $ne: true }, followUpStatus: { $in: ACTIVE_STATUSES } },
    { $set: { isActiveFollowUp: true } },
  );
  const toInactive = await coll.updateMany(
    { $or: [{ isDeleted: true }, { followUpStatus: { $nin: ACTIVE_STATUSES } }] },
    { $set: { isActiveFollowUp: false } },
  );
  console.log(`Flagged ${toActive.modifiedCount} active, ${toInactive.modifiedCount} inactive follow-up(s).`);

  // 2) Find POs with more than one record now flagged active — the unique
  //    index cannot be built while these exist. Demote every one except the
  //    most-recently-created to isActiveFollowUp=false (history preserved).
  const dupeGroups = await coll.aggregate([
    { $match: { isActiveFollowUp: true } },
    { $group: { _id: '$poId', ids: { $push: '$_id' }, numbers: { $push: '$followUpNumber' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  if (dupeGroups.length) {
    console.warn(`⚠ Found ${dupeGroups.length} PO(s) with more than one active follow-up — resolving by keeping the latest:`);
    for (const g of dupeGroups) {
      // ids are in collection (insertion) order for an unindexed $push, but to
      // be explicit and not rely on that, re-fetch sorted by createdAt.
      const docs = await coll.find({ _id: { $in: g.ids } }).sort({ createdAt: -1 }).toArray();
      const [keep, ...demote] = docs;
      console.warn(`  PO ${g._id}: keeping ${keep.followUpNumber}, demoting ${demote.map((d) => d.followUpNumber).join(', ')}`);
      await coll.updateMany(
        { _id: { $in: demote.map((d) => d._id) } },
        { $set: { isActiveFollowUp: false } },
      );
    }
  } else {
    console.log('No PO had more than one active follow-up — no demotions needed.');
  }

  // 3) Build the partial unique index (safe/no-op if it already exists).
  await coll.createIndex(
    { poId: 1 },
    { unique: true, partialFilterExpression: { isActiveFollowUp: true }, name: 'poId_1_active_unique' },
  );
  console.log('✅ Ensured partial unique index poId_1_active_unique.');

  await mongoose.connection.close();
  process.exit(0);
};
run().catch(async (e) => { console.error('❌ Migration failed:', e); await mongoose.connection.close().catch(() => {}); process.exit(1); });
