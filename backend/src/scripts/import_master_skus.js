/**
 * Import MISSING SKUs from the client's master sheet — additive & safe.
 *
 * Source: src/sheets/master of skus.xlsx · sheet "Master Codes"
 *   Columns: Material (name) · SKU Codes (code) · Description (the "core" group)
 *
 * Maps the sheet's Description → our itemType:
 *   Raw Material → RAW_MATERIAL · Consumables → CONSUMABLE · Packing → PACKING
 *   Finished Goods → FINISHED_GOOD · Circles → CIRCLE
 *
 * IMPORTANT: it NEVER overwrites or duplicates an existing SKU. An item is
 * created only when its code AND its name are both absent from the DB. Existing
 * SKUs (and their richer categories) are left exactly as they are.
 *
 * Flags:  --dry-run   parse + report only, no writes.
 * Usage:  node src/scripts/import_master_skus.js [--dry-run]
 */

import path from 'path';
import xlsx from 'xlsx';
import mongoose from 'mongoose';
import env from '../config/env.js';
import SKU from '../modules/skus/sku.model.js';

const DRY = process.argv.includes('--dry-run');
const FILE = path.resolve(process.cwd(), 'src/sheets/master of skus.xlsx');
const U = (s) => String(s ?? '').trim().toUpperCase();
const N = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const DESC_TO_TYPE = {
  'raw material': 'RAW_MATERIAL',
  consumables: 'CONSUMABLE',
  consumable: 'CONSUMABLE',
  packing: 'PACKING',
  packaging: 'PACKING',
  'finished goods': 'FINISHED_GOOD',
  'finished good': 'FINISHED_GOOD',
  circles: 'CIRCLE',
  circle: 'CIRCLE',
};

const deriveCategory = (itemType, name) => {
  const n = name.toLowerCase();
  if (itemType === 'CIRCLE') {
    if (/\bcu\b/.test(n) || n.startsWith('cu')) return 'Copper Circle';
    if (/\bdd\b/.test(n) || n.startsWith('dd')) return 'DD Circle';
    return 'Circle';
  }
  if (itemType === 'FINISHED_GOOD') {
    if (n.includes('mg ')) return 'MG Jar';
    if (n.includes('jar')) return 'Jar';
    if (n.includes('bowl')) return 'Bowl';
    return 'Finished Good';
  }
  return 'Other';
};

const slugCode = (name) => U(name).replace(/[^A-Z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 24) || 'ITEM';

const run = async () => {
  const wb = xlsx.readFile(FILE, { codepage: 65001 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

  await mongoose.connect(env.MONGO_URI);
  const existing = await SKU.find({}).select('name code isDeleted').lean(); // include soft-deleted to avoid code clash
  const codeSet = new Set(existing.map((s) => U(s.code)));
  const nameSet = new Set(existing.filter((s) => !s.isDeleted).map((s) => N(s.name)));

  // Sheet keys, for restoring master items that were soft-deleted (hidden).
  const sheetCodes = new Set(rows.map((r) => U(r['SKU Codes'])).filter(Boolean));
  const sheetNames = new Set(rows.map((r) => N(r.Material)).filter(Boolean));
  const toRestore = existing.filter((s) => s.isDeleted && (sheetCodes.has(U(s.code)) || sheetNames.has(N(s.name))));

  const toCreate = [];
  const skippedExisting = [];
  const skippedUnknownType = [];

  for (const r of rows) {
    const name = String(r.Material || '').trim();
    let code = String(r['SKU Codes'] || '').trim();
    const desc = String(r.Description || '').trim();
    if (!name && !code) continue;
    if (!name) continue; // a code with no name is not a usable SKU

    const itemType = DESC_TO_TYPE[desc.toLowerCase()];
    if (!itemType) { skippedUnknownType.push(`${code || '(no code)'} · ${name} · "${desc}"`); continue; }

    const hasCode = code && codeSet.has(U(code));
    const hasName = nameSet.has(N(name));
    if (hasCode || hasName) { skippedExisting.push(`${U(code) || '—'} · ${name}`); continue; }

    // Generate a unique code for items the sheet left blank.
    if (!code) {
      let base = slugCode(name); let candidate = base; let i = 2;
      while (codeSet.has(U(candidate))) { candidate = `${base}-${i}`; i += 1; }
      code = candidate;
    }
    codeSet.add(U(code));
    nameSet.add(N(name));

    toCreate.push({
      name,
      code: U(code),
      itemType,
      category: deriveCategory(itemType, name),
      unit: itemType === 'RAW_MATERIAL' ? 'KGS' : 'PCS',
    });
  }

  console.log(`\n── Master SKU Import ${DRY ? '(DRY RUN) ' : ''}──`);
  console.log(`Sheet rows: ${rows.length} · already active in DB: ${skippedExisting.length} · unknown-type skipped: ${skippedUnknownType.length}`);
  console.log(`\nTO CREATE (${toCreate.length}):`);
  toCreate.forEach((s) => console.log(`  ${s.code.padEnd(16)} | ${s.itemType.padEnd(14)} | ${s.category.padEnd(14)} | ${s.name}`));
  if (toRestore.length) {
    console.log(`\nTO RESTORE (soft-deleted but present in the master sheet) (${toRestore.length}):`);
    toRestore.forEach((s) => console.log(`  ${U(s.code).padEnd(16)} | ${s.name}`));
  }
  if (skippedUnknownType.length) {
    console.log(`\n⚠️ Skipped (Description not a known core group):`);
    skippedUnknownType.forEach((l) => console.log(`  ${l}`));
  }

  if (DRY) {
    console.log('\n(DRY RUN — nothing written.)');
  } else {
    if (toCreate.length) { await SKU.insertMany(toCreate, { ordered: false }); }
    if (toRestore.length) { await SKU.updateMany({ _id: { $in: toRestore.map((s) => s._id) } }, { $set: { isDeleted: false } }); }
    console.log(`\n✅ Created ${toCreate.length} new SKUs · restored ${toRestore.length} hidden SKUs.`);
  }

  await mongoose.connection.close();
  process.exit(0);
};
run().catch(async (e) => { console.error('❌ Import failed:', e); await mongoose.connection.close().catch(() => {}); process.exit(1); });
