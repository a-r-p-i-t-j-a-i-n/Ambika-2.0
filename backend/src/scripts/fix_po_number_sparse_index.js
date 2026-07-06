/**
 * Migration — make vendorpurchaseorders.poNumber a SPARSE unique index.
 *
 * Draft POs no longer get a poNumber at creation (Purchase FMS — assign PO
 * number only on approval); the number is minted at approve() time so the
 * sequence follows approval order, not draft-creation order. Until then
 * poNumber is left unset. The old index was `unique: true` WITHOUT `sparse`,
 * which only tolerates a single document with a missing poNumber — every
 * draft beyond the first would fail with a duplicate-key error on save.
 *
 * This drops the old poNumber_1 index (if present) so Mongoose recreates it
 * with `sparse: true` from the schema on next connect. Safe to run repeatedly.
 *
 * Usage:  node src/scripts/fix_po_number_sparse_index.js
 */

import mongoose from 'mongoose';
import env from '../config/env.js';

const run = async () => {
  await mongoose.connect(env.MONGO_URI);
  const coll = mongoose.connection.collection('vendorpurchaseorders');

  const indexes = await coll.indexes();
  const poNumberIndex = indexes.find((ix) => ix.key && Object.keys(ix.key).length === 1 && ix.key.poNumber === 1);

  if (!poNumberIndex) {
    console.log('No poNumber index found — nothing to do (it will be created sparse on next app start).');
  } else if (poNumberIndex.sparse) {
    console.log('poNumber index is already sparse — nothing to do.');
  } else {
    await coll.dropIndex(poNumberIndex.name);
    console.log(`Dropped non-sparse index "${poNumberIndex.name}". Restart the app (or call ensureIndexes) to recreate it as unique+sparse.`);
  }

  await coll.createIndex({ poNumber: 1 }, { unique: true, sparse: true });
  console.log('✅ Ensured unique+sparse index on poNumber.');

  await mongoose.connection.close();
  process.exit(0);
};
run().catch(async (e) => { console.error('❌ Migration failed:', e); await mongoose.connection.close().catch(() => {}); process.exit(1); });
