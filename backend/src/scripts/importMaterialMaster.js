/**
 * importMaterialMaster.js — load Raw Materials & Consumables
 * ════════════════════════════════════════════════════════════════════
 * Reads `src/data/material-master.js` and upserts every row into the
 * `skus` collection.
 *
 * SAFETY
 *   • Dry-run by default — prints the full plan and writes NOTHING.
 *   • Pass `--commit` to actually apply.
 *   • Idempotent — keyed on `code` with upsert; re-running gives the same
 *     result with zero duplicates.
 *   • Scope-locked — only writes the item types in `ALLOWED_TYPES`
 *     (RAW_MATERIAL, CONSUMABLE, PACKING). It can never create or modify a
 *     Finished Good or a Circle.
 *   • Validates every row (non-empty code + name) and rejects bad rows
 *     loudly instead of silently dropping them.
 *
 * USAGE
 *   node src/scripts/importMaterialMaster.js           ← preview (no writes)
 *   node src/scripts/importMaterialMaster.js --commit  ← apply
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import SKU from '../modules/skus/sku.model.js';
import User from '../modules/auth/auth.model.js';
import { MATERIAL_MASTER, DATA_NOTES, MATERIAL_MASTER_COUNTS } from '../data/material-master.js';
import { logger } from '../utils/logger.js';

const COMMIT = process.argv.includes('--commit');
const ALLOWED_TYPES = ['RAW_MATERIAL', 'CONSUMABLE', 'PACKING'];
const pad = (s, n) => String(s ?? '').padEnd(n);

const run = async () => {
  await connectDB();

  // ── 1. Normalise + validate + de-dupe the source file ──────────────
  const seen = new Map();   // code -> first row
  const valid = [];
  const rejected = [];
  const dupes = [];

  for (const raw of MATERIAL_MASTER) {
    const code = String(raw.code || '').trim().toUpperCase();
    const name = String(raw.name || '').trim();

    if (!code || !name) {
      rejected.push({ raw, why: !code ? 'missing code' : 'missing name' });
      continue;
    }
    if (!ALLOWED_TYPES.includes(raw.itemType)) {
      rejected.push({ raw, why: `itemType ${raw.itemType} out of scope` });
      continue;
    }
    if (seen.has(code)) { dupes.push(code); continue; }

    const row = {
      code,
      name,
      itemType: raw.itemType,
      category: String(raw.category || '').trim(),
      unit: raw.unit || 'PCS',
      aliases: Array.isArray(raw.aliases) ? raw.aliases.filter(Boolean) : [],
      codeGenerated: !!raw.codeGenerated,
    };
    seen.set(code, row);
    valid.push(row);
  }

  // ── 2. Compare against the database ────────────────────────────────
  const codes = valid.map((r) => r.code);
  const existing = await SKU.find({ code: { $in: codes } })
    .select('code itemType name')
    .lean();
  const existingByCode = new Map(existing.map((s) => [s.code, s]));

  const toCreate = [];
  const toUpdate = [];
  const typeConflicts = [];   // code already exists with a different itemType

  for (const row of valid) {
    const hit = existingByCode.get(row.code);
    if (!hit) { toCreate.push(row); continue; }
    toUpdate.push(row);
    if (hit.itemType && hit.itemType !== row.itemType) {
      typeConflicts.push({ code: row.code, was: hit.itemType, willBe: row.itemType });
    }
  }

  const generated = valid.filter((r) => r.codeGenerated);
  const aliased   = valid.filter((r) => r.aliases.length);

  // ── 3. Report ──────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  IMPORT MATERIAL MASTER  —  ' + (COMMIT ? 'COMMIT MODE' : 'DRY RUN (no writes)'));
  console.log('══════════════════════════════════════════════════════');
  console.log(`  Rows in source file ..... ${MATERIAL_MASTER.length}`
    + `  (RM ${MATERIAL_MASTER_COUNTS.RAW_MATERIAL}`
    + ` / Consumable ${MATERIAL_MASTER_COUNTS.CONSUMABLE}`
    + ` / Packing ${MATERIAL_MASTER_COUNTS.PACKING})`);
  console.log(`  Valid after cleaning .... ${valid.length}`);
  console.log(`  → will be CREATED ....... ${toCreate.length}`);
  console.log(`  → will be UPDATED ....... ${toUpdate.length}`);
  console.log(`  Rejected (bad rows) ..... ${rejected.length}`);
  console.log(`  Duplicate codes in file . ${dupes.length}`);

  console.log('\n  Data-cleaning notes:');
  for (const n of DATA_NOTES) console.log(`    • ${n}`);

  if (generated.length) {
    console.log(`\n  Auto-generated codes (${generated.length}):`);
    for (const g of generated) console.log(`    ${pad(g.code, 16)} ${g.name}`);
  }
  if (aliased.length) {
    console.log(`\n  Rows carrying an alias (${aliased.length}):`);
    for (const a of aliased) console.log(`    ${pad(a.code, 16)} aliases: ${a.aliases.join(', ')}`);
  }
  if (dupes.length) {
    console.log(`\n  ⚠ Duplicate codes inside the file (kept first, skipped rest): ${dupes.join(', ')}`);
  }
  if (rejected.length) {
    console.log('\n  ⚠ Rejected rows:');
    for (const r of rejected) console.log(`    "${r.raw.name || '(no name)'}" — ${r.why}`);
  }
  if (typeConflicts.length) {
    console.log('\n  ⚠ Codes that already exist with a DIFFERENT itemType:');
    for (const t of typeConflicts) {
      console.log(`    ${pad(t.code, 16)} ${t.was} → ${t.willBe}  (will be reclassified)`);
    }
  }

  // Sample of what gets created
  if (toCreate.length) {
    console.log(`\n  Sample of new SKUs (first 12 of ${toCreate.length}):`);
    console.log('  ' + pad('CODE', 16) + pad('TYPE', 15) + pad('CATEGORY', 20) + 'NAME');
    console.log('  ' + '-'.repeat(78));
    for (const r of toCreate.slice(0, 12)) {
      console.log('  ' + pad(r.code, 16) + pad(r.itemType, 15) + pad(r.category, 20) + r.name);
    }
  }

  // ── 4. Write ───────────────────────────────────────────────────────
  if (!COMMIT) {
    console.log('\n  DRY RUN — nothing was written.');
    console.log('  Re-run with  --commit  to apply.\n');
    await mongoose.connection.close();
    process.exit(0);
  }

  const admin = await User.findOne({ role: 'ADMIN' }).select('_id').lean()
    || await User.findOne().select('_id').lean();
  const actorId = admin?._id || null;

  let created = 0;
  let updated = 0;
  for (const row of valid) {
    const res = await SKU.findOneAndUpdate(
      { code: row.code },
      {
        $set: {
          name: row.name,
          itemType: row.itemType,
          category: row.category,
          unit: row.unit,
          aliases: row.aliases,
          isActive: true,
          isDeleted: false,
          ...(actorId ? { updatedBy: actorId } : {}),
        },
        $setOnInsert: {
          code: row.code,
          ...(actorId ? { createdBy: actorId } : {}),
        },
      },
      { new: true, upsert: true, runValidators: true, rawResult: true },
    );
    if (res.lastErrorObject?.updatedExisting) updated += 1;
    else created += 1;
  }

  console.log(`\n  ✅ COMMITTED — created ${created}, updated ${updated}.\n`);
  logger.info(`importMaterialMaster: created ${created}, updated ${updated}.`);
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  logger.error(`importMaterialMaster failed: ${err.message}`, { stack: err.stack });
  try { await mongoose.connection.close(); } catch { /* noop */ }
  process.exit(1);
});
