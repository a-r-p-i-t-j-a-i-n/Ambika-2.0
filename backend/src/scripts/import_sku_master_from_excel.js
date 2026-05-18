/**
 * Import SKU master from Excel — idempotent, audited.
 *
 * Source file: src/sheets/sku items and codes.xlsx
 *   Sheet: "Finished Goods"
 *   Columns: "SKU Itmes "  (yes, trailing space + typo)  →  name
 *            "SKU Codes"                                  →  code
 *
 * Behaviour:
 *   - Trims whitespace, uppercases codes.
 *   - Detects duplicate codes within the file (keeps first, skips rest).
 *   - Detects duplicate names within the file (warns; still imports because
 *     the same name with different codes is a real-world case, e.g.
 *     "MG 1.1 Wet Jar" vs "MG 1.1 Wet Jar Celum").
 *   - Soft-deletes the two scrap SKUs the client flagged:
 *       SMPL-HYDRAULIC-PRESS-MACHINE
 *       MYEW-MAPLE-JAR-INSPECTION-GAUGES
 *   - Reports a per-row outcome and a final summary table.
 *   - Saves a full JSON audit log next to the script for traceability.
 *
 * Flags:
 *   --dry-run       Parse + validate + report, but make no DB changes.
 *   --no-delete     Skip the scrap deletion step.
 *
 * Usage:
 *   node src/scripts/import_sku_master_from_excel.js
 *   node src/scripts/import_sku_master_from_excel.js --dry-run
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import SKU from '../modules/skus/sku.model.js';
import { logger } from '../utils/logger.js';

// ── Config ──────────────────────────────────────────────────────────
const SHEET_PATH = path.resolve('src/sheets/sku items and codes.xlsx');
const SHEET_NAME = 'Finished Goods';
const NAME_COL   = 'SKU Itmes '; // trailing space matches the source file
const CODE_COL   = 'SKU Codes';

const SCRAP_CODES = [
  'SMPL-HYDRAULIC-PRESS-MACHINE',
  'MYEW-MAPLE-JAR-INSPECTION-GAUGES',
];

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN     = ARGS.has('--dry-run');
const SKIP_DELETE = ARGS.has('--no-delete');

// ── Helpers ─────────────────────────────────────────────────────────
const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const code = (v) => norm(v).toUpperCase();

// Derive a reasonable category from the code prefix (purely cosmetic;
// the upsert never *overwrites* an existing category, only fills if blank).
const CATEGORY_BY_PREFIX = {
  PP: 'PP Jar',
  PF: 'PP Flat',
  VA: 'VA Jar',
  VF: 'Value Flat',
  ST: 'Mixer Jar',
  GX: 'Mixer Jar',
  TB: 'Mixer Jar',
  TP: 'Mixer Jar',
  CK: 'Katori',
  GJ: 'Jar',
  DJ: 'Jar',
  FJ: 'Jar',
  ND: 'Nano Jar',
  NF: 'Nano Jar',
  NC: 'Nano Jar',
  MA: 'MA Jar',
  MG: 'MG Jar',
  BO: 'Bowl',
};
const guessCategory = (skuCode) => CATEGORY_BY_PREFIX[skuCode.slice(0, 2)] || 'General';

// Pretty console table with row numbers
const printTable = (rows, columns) => {
  if (rows.length === 0) return;
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const header = columns.map((c, i) => c.padEnd(widths[i])).join('  ');
  const sep = widths.map((w) => '─'.repeat(w)).join('  ');
  console.log(header);
  console.log(sep);
  for (const r of rows) {
    console.log(columns.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  '));
  }
};

// ── Main ────────────────────────────────────────────────────────────
const run = async () => {
  const startedAt = new Date();
  console.log('━'.repeat(72));
  console.log('  SKU Master Import — Excel → MongoDB');
  console.log('  File   :', SHEET_PATH);
  console.log('  Sheet  :', SHEET_NAME);
  console.log('  Mode   :', DRY_RUN ? 'DRY-RUN (no writes)' : 'WRITE');
  console.log('  Delete :', SKIP_DELETE ? 'skipped (--no-delete)' : 'scrap codes will be soft-deleted');
  console.log('━'.repeat(72));

  // 1) Sanity: file exists
  if (!fs.existsSync(SHEET_PATH)) {
    console.error('✗ Excel file not found at:', SHEET_PATH);
    process.exit(1);
  }

  // 2) Read sheet
  const wb = XLSX.readFile(SHEET_PATH);
  if (!wb.SheetNames.includes(SHEET_NAME)) {
    console.error(`✗ Sheet "${SHEET_NAME}" not found. Available sheets:`, wb.SheetNames);
    process.exit(1);
  }
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[SHEET_NAME], { defval: null, raw: false });
  console.log(`✓ Parsed ${raw.length} raw rows from sheet "${SHEET_NAME}"\n`);

  // 3) Parse + validate (in-memory, no DB calls yet)
  const codeSeenInFile = new Map(); // code → first rowIndex
  const nameSeenInFile = new Map();
  const parsed = [];
  const skippedInvalid = [];
  const skippedDuplicateInFile = [];
  const nameDuplicateWarnings = [];

  raw.forEach((row, idx) => {
    const rowNo = idx + 2; // +2 because header is row 1 and array is 0-indexed
    const rawName = row[NAME_COL];
    const rawCode = row[CODE_COL];
    const name = norm(rawName);
    const skuCode = code(rawCode);

    if (!name && !skuCode) {
      // empty row — silently skip
      return;
    }
    if (!name || !skuCode) {
      skippedInvalid.push({ rowNo, name: name || '(blank)', code: skuCode || '(blank)', reason: 'missing name or code' });
      return;
    }
    if (!/^[A-Z0-9-]{3,40}$/.test(skuCode)) {
      skippedInvalid.push({ rowNo, name, code: skuCode, reason: 'code format invalid (expected A-Z, 0-9, dashes)' });
      return;
    }

    if (codeSeenInFile.has(skuCode)) {
      skippedDuplicateInFile.push({
        rowNo,
        name,
        code: skuCode,
        firstSeenRow: codeSeenInFile.get(skuCode),
        reason: 'duplicate code in file',
      });
      return;
    }
    if (nameSeenInFile.has(name)) {
      nameDuplicateWarnings.push({
        rowNo,
        name,
        code: skuCode,
        firstSeenRow: nameSeenInFile.get(name),
      });
      // still imported (could be a real variant with a different code)
    }

    codeSeenInFile.set(skuCode, rowNo);
    nameSeenInFile.set(name, rowNo);

    parsed.push({
      rowNo,
      name,
      code: skuCode,
      category: guessCategory(skuCode),
    });
  });

  console.log(`✓ Valid rows ready to upsert : ${parsed.length}`);
  console.log(`  Invalid rows skipped       : ${skippedInvalid.length}`);
  console.log(`  Duplicate codes in file    : ${skippedDuplicateInFile.length}`);
  console.log(`  Duplicate name warnings    : ${nameDuplicateWarnings.length}\n`);

  if (skippedInvalid.length) {
    console.log('  Invalid rows:');
    printTable(skippedInvalid, ['rowNo', 'code', 'name', 'reason']);
    console.log();
  }
  if (skippedDuplicateInFile.length) {
    console.log('  In-file duplicates skipped:');
    printTable(skippedDuplicateInFile, ['rowNo', 'code', 'name', 'firstSeenRow']);
    console.log();
  }
  if (nameDuplicateWarnings.length) {
    console.log('  Name reused with a different code (kept, since codes are unique):');
    printTable(nameDuplicateWarnings, ['rowNo', 'code', 'name', 'firstSeenRow']);
    console.log();
  }

  // 4) Connect to DB and upsert
  await connectDB();

  const outcomes = []; // per-row outcomes
  let nCreated = 0;
  let nUpdatedChanged = 0;
  let nUpdatedNoChange = 0;

  if (DRY_RUN) {
    // Read existing only — no writes
    for (const row of parsed) {
      const existing = await SKU.findOne({ code: row.code }).lean();
      outcomes.push({
        code: row.code,
        name: row.name,
        action: existing ? 'WOULD_UPDATE' : 'WOULD_CREATE',
        previous: existing ? { name: existing.name, category: existing.category } : null,
      });
    }
  } else {
    for (const row of parsed) {
      const existing = await SKU.findOne({ code: row.code }).lean();

      // We never overwrite category or other live fields on an existing row;
      // only `name` is authoritative from the sheet (so renames work), and
      // we make sure the row is un-deleted / active.
      const setOnInsert = {
        code: row.code,
        category: row.category,
        unit: 'PCS',
        pcsPerBox: 1,
        weightPerBox: 0,
        weightPerPc: 0,
        leadDays: 7,
        sellingPrice: 0,
        rmCost: 0,
        gstRate: 18,
      };
      const setAlways = {
        name: row.name,
        isActive: true,
        isDeleted: false,
        deletedAt: null,
      };

      const result = await SKU.findOneAndUpdate(
        { code: row.code },
        { $set: setAlways, $setOnInsert: setOnInsert },
        { new: true, upsert: true, runValidators: true, rawResult: true },
      );

      const updatedExisting = result.lastErrorObject?.updatedExisting;
      let action;
      if (!updatedExisting) {
        action = 'CREATED'; nCreated += 1;
      } else if (existing && existing.name !== row.name) {
        action = 'UPDATED_NAME_CHANGED'; nUpdatedChanged += 1;
      } else {
        action = 'UPDATED_NO_CHANGE'; nUpdatedNoChange += 1;
      }
      outcomes.push({
        code: row.code,
        name: row.name,
        action,
        previousName: existing?.name || null,
      });
    }
  }

  // 5) Soft-delete scrap codes
  const scrapResults = [];
  if (!SKIP_DELETE) {
    for (const sc of SCRAP_CODES) {
      const existing = await SKU.findOne({ code: sc });
      if (!existing) {
        scrapResults.push({ code: sc, action: 'NOT_FOUND' });
        continue;
      }
      if (existing.isDeleted) {
        scrapResults.push({ code: sc, action: 'ALREADY_DELETED', name: existing.name });
        continue;
      }
      if (DRY_RUN) {
        scrapResults.push({ code: sc, action: 'WOULD_SOFT_DELETE', name: existing.name });
        continue;
      }
      existing.isDeleted = true;
      existing.isActive = false;
      existing.deletedAt = new Date();
      await existing.save();
      scrapResults.push({ code: sc, action: 'SOFT_DELETED', name: existing.name });
    }
  }

  // 6) DB-side duplicate audit (codes that exist multiple times for any reason)
  const dbDupes = await SKU.aggregate([
    { $group: { _id: '$code', count: { $sum: 1 }, ids: { $push: '$_id' }, names: { $push: '$name' } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  // 7) Final report
  console.log('━'.repeat(72));
  console.log('  IMPORT SUMMARY');
  console.log('━'.repeat(72));
  if (DRY_RUN) {
    const wouldCreate = outcomes.filter((o) => o.action === 'WOULD_CREATE').length;
    const wouldUpdate = outcomes.filter((o) => o.action === 'WOULD_UPDATE').length;
    console.log(`  Would create               : ${wouldCreate}`);
    console.log(`  Would update               : ${wouldUpdate}`);
  } else {
    console.log(`  Created                    : ${nCreated}`);
    console.log(`  Updated (name changed)     : ${nUpdatedChanged}`);
    console.log(`  Updated (no change)        : ${nUpdatedNoChange}`);
  }
  console.log(`  Skipped (invalid)          : ${skippedInvalid.length}`);
  console.log(`  Skipped (file duplicates)  : ${skippedDuplicateInFile.length}`);
  console.log(`  Name reused (kept)         : ${nameDuplicateWarnings.length}`);

  if (!SKIP_DELETE) {
    console.log('\n  Scrap SKU cleanup:');
    printTable(scrapResults, ['code', 'action', 'name']);
  }

  if (nUpdatedChanged > 0) {
    console.log('\n  Names changed during this run:');
    printTable(
      outcomes.filter((o) => o.action === 'UPDATED_NAME_CHANGED').map((o) => ({
        code: o.code, previous: o.previousName, now: o.name,
      })),
      ['code', 'previous', 'now'],
    );
  }

  if (dbDupes.length) {
    console.log('\n  ⚠ Database contains duplicate `code` values (investigate):');
    printTable(
      dbDupes.map((d) => ({ code: d._id, count: d.count, names: d.names.join(' | ') })),
      ['code', 'count', 'names'],
    );
  } else {
    console.log('\n  ✓ No duplicate codes in the database.');
  }

  // 8) Write JSON audit
  const auditDir = path.resolve('src/scripts');
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const auditPath = path.join(auditDir, `_audit_sku_import_${stamp}.json`);
  const audit = {
    startedAt,
    finishedAt: new Date(),
    mode: DRY_RUN ? 'dry-run' : 'write',
    source: { path: SHEET_PATH, sheet: SHEET_NAME, rawRowsRead: raw.length },
    summary: {
      created: nCreated,
      updatedNameChanged: nUpdatedChanged,
      updatedNoChange: nUpdatedNoChange,
      skippedInvalid: skippedInvalid.length,
      skippedDuplicateInFile: skippedDuplicateInFile.length,
      nameReuseWarnings: nameDuplicateWarnings.length,
    },
    outcomes,
    skippedInvalid,
    skippedDuplicateInFile,
    nameDuplicateWarnings,
    scrapResults,
    dbDuplicates: dbDupes,
  };
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2));
  console.log(`\n  📝 Audit log saved to: ${auditPath}`);
  console.log('━'.repeat(72));

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((err) => {
  logger.error(`SKU import failed: ${err.message}`, { stack: err.stack });
  console.error(err);
  mongoose.connection.close().finally(() => process.exit(1));
});
