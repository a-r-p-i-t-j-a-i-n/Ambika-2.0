/**
 * backfillItemType.js — one-time migration
 * ════════════════════════════════════════════════════════════════════
 * Sets `itemType` on every SKU that pre-dates the field. The value is
 * derived from the SKU code by `classifyByCode()` (see item-classifier.js).
 *
 * SAFETY
 *   • Dry-run by default — prints the full plan and writes NOTHING.
 *   • Pass `--commit` to actually apply the updates.
 *   • Idempotent — only writes rows whose itemType would actually change,
 *     so re-running it is a no-op once everything is classified.
 *   • Touches only the `itemType` field. Nothing else is modified.
 *
 * USAGE
 *   node src/scripts/backfillItemType.js            ← preview (no writes)
 *   node src/scripts/backfillItemType.js --commit   ← apply
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import SKU from '../modules/skus/sku.model.js';
import { classifyByCode } from '../data/item-classifier.js';
import { logger } from '../utils/logger.js';

const COMMIT = process.argv.includes('--commit');

const pad = (s, n) => String(s).padEnd(n);

const run = async () => {
  await connectDB();

  const skus = await SKU.find({})
    .select('_id code name itemType')
    .lean();

  const byTarget = {};                 // itemType -> count
  const changes  = [];                 // rows whose itemType will change
  const uncoded  = [];                 // rows with no code (cannot classify)

  for (const sku of skus) {
    const target = classifyByCode(sku.code);
    if (!target) { uncoded.push(sku); continue; }

    byTarget[target] = (byTarget[target] || 0) + 1;
    if (sku.itemType !== target) {
      changes.push({ ...sku, from: sku.itemType || '(unset)', to: target });
    }
  }

  // ── Report ─────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  BACKFILL itemType  —  ' + (COMMIT ? 'COMMIT MODE' : 'DRY RUN (no writes)'));
  console.log('══════════════════════════════════════════════════════');
  console.log(`  SKUs scanned ............ ${skus.length}`);
  console.log(`  Will be updated ......... ${changes.length}`);
  console.log(`  Already correct ......... ${skus.length - changes.length - uncoded.length}`);
  console.log(`  Un-coded (skipped) ...... ${uncoded.length}`);
  console.log('\n  Resulting classification:');
  for (const t of ['FINISHED_GOOD', 'RAW_MATERIAL', 'CONSUMABLE', 'PACKING', 'CIRCLE']) {
    console.log(`    ${pad(t, 16)} ${byTarget[t] || 0}`);
  }

  if (changes.length) {
    console.log('\n  Changes (showing up to 60):');
    console.log('  ' + pad('CODE', 18) + pad('FROM', 16) + pad('TO', 16) + 'NAME');
    console.log('  ' + '-'.repeat(78));
    for (const c of changes.slice(0, 60)) {
      console.log('  ' + pad(c.code, 18) + pad(c.from, 16) + pad(c.to, 16) + (c.name || ''));
    }
    if (changes.length > 60) console.log(`  … and ${changes.length - 60} more.`);
  }

  if (uncoded.length) {
    console.log('\n  ⚠ Un-coded SKUs (left untouched — fix the code, then re-run):');
    for (const u of uncoded) console.log(`    _id=${u._id}  name="${u.name}"`);
  }

  // ── Write ──────────────────────────────────────────────────────────
  if (!COMMIT) {
    console.log('\n  DRY RUN — nothing was written.');
    console.log('  Re-run with  --commit  to apply.\n');
    await mongoose.connection.close();
    process.exit(0);
  }

  if (!changes.length) {
    console.log('\n  Nothing to update — every SKU is already classified.\n');
    await mongoose.connection.close();
    process.exit(0);
  }

  const ops = changes.map((c) => ({
    updateOne: {
      filter: { _id: c._id },
      update: { $set: { itemType: c.to } },
    },
  }));
  const res = await SKU.bulkWrite(ops, { ordered: false });
  console.log(`\n  ✅ COMMITTED — ${res.modifiedCount} SKU(s) updated.\n`);

  logger.info(`backfillItemType: ${res.modifiedCount} SKUs classified.`);
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  logger.error(`backfillItemType failed: ${err.message}`, { stack: err.stack });
  try { await mongoose.connection.close(); } catch { /* noop */ }
  process.exit(1);
});
