/**
 * Create the Scrap Records for cuts already recorded in the RM ledger.
 *
 *   node src/scripts/importRmScrapRecords.js --preview   # report only
 *   node src/scripts/importRmScrapRecords.js --commit    # writes
 *
 * PREVIEW IS THE DEFAULT.
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 * One ScrapRecord per row of the client's "Summary Scrap" sheet. It creates NO
 * stock, NO movements and NO SKU: the coil deduction that scrap causes was
 * already posted by the RM import as ADJUST_OUT, and nothing here touches it.
 * This is the record layer that the Conversion history cannot serve — the
 * verification state, the yield, and the in-house vs job-work split.
 *
 * The sheet is read through `parseWorkbook`'s existing scrap parser, so there
 * is exactly ONE interpretation of it across all three importers.
 *
 * ── CUT vs UNCUT ────────────────────────────────────────────────────────────
 * Fifteen rows describe coils that were never cut. Their circle weight is
 * blank, so the sheet's own `coil − circles` formula reports the WHOLE coil as
 * scrap — 2,890 kg of "scrap" from an intact 2,890 kg coil. They are imported
 * faithfully and marked UNCUT; every scrap total excludes them. Counting them
 * would report 287,489 kg of scrap instead of the true 246,674 kg.
 *
 * ── IDEMPOTENCY ────────────────────────────────────────────────────────────
 * `sourceRef = EXCEL_RM_24_25|SCRAP|<batch no>`, on a unique sparse index. The
 * batch number is the client's own identifier for a cut, derived from the row —
 * never from a timestamp — so a second --commit writes nothing.
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import env from '../config/env.js';
import SKU from '../modules/skus/sku.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import ScrapRecord from '../modules/inventory/scrapRecord.model.js';
import { parseWorkbook, IMPORT_SOURCE } from './importRmExcelHistory.js';

const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const fileArg = argv.indexOf('--file');
const DEFAULT_FILES = [
  path.resolve(process.cwd(), '..', 'excel', 'IMS - Raw Material 24-25(2).xlsx'),
  path.resolve(process.cwd(), '..', 'excel', 'IMS - Raw Material 24-25.xlsx'),
  'C:/Users/Admin/Downloads/IMS - Raw Material 24-25.xlsx',
];
const WORKBOOK = fileArg >= 0 ? argv[fileArg + 1] : DEFAULT_FILES.find((f) => fs.existsSync(f));

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const up = (v) => String(v ?? '').trim().toUpperCase();
const isDate = (v) => v instanceof Date && !Number.isNaN(v.getTime());
export const scrapRef = (batchNo) => `${IMPORT_SOURCE}|SCRAP|${batchNo}`;

/** The sheet's words for what was decided → the model's enum. */
export const DISPOSITION = (v) => {
  const s = up(v);
  if (s === 'JOB WORK' || s === 'JOB_WORK') return 'JOB_WORK';
  if (s === 'DONE') return 'DONE';
  if (s === 'REJECTED') return 'REJECTED';
  return 'PENDING'; // the sheet's blank — not yet checked
};

/**
 * Normalise the parsed scrap rows into ScrapRecord shape. Pure — no database,
 * so it can be tested on its own.
 */
export const buildScrapRecords = (scrapRows = []) => scrapRows.map((s) => {
  // A coil with no circle weight was never cut, so its "scrap" is the coil.
  const cut = Number(s.circlesKg) > 0;
  return {
    row: s.row,
    sourceRef: scrapRef(s.batchNo),
    batchNo: s.batchNo,
    scrapDate: isDate(s.date) ? s.date : null,
    location: up(s.location),
    coilCode: s.coilCode,
    coilName: s.coilName,
    coilWeightKg: r2(s.coilKg),
    circlesWeightKg: r2(s.circlesKg),
    scrapKg: r2(s.scrapKg),
    // The sheet stores yield as a ratio (0.8126); the model stores a percent,
    // exactly as CoilConversion does. An uncut batch has no meaningful yield.
    yieldRatioPct: cut && s.yieldRatio ? r2(s.yieldRatio * 100) : null,
    disposition: DISPOSITION(s.verified),
    verifiedAt: isDate(s.verifiedAt) ? s.verifiedAt : null,
    coilRate: r2(s.rate),
    batchStatus: cut ? 'CUT' : 'UNCUT',
  };
});

const run = async () => {
  if (!WORKBOOK || !fs.existsSync(WORKBOOK)) {
    console.error(`Workbook not found. Looked in:\n  ${DEFAULT_FILES.join('\n  ')}\nPass --file "<path>".`);
    process.exit(1);
  }
  const parsed = parseWorkbook(WORKBOOK);
  const records = buildScrapRecords(parsed.scrap);

  await mongoose.connect(env.MONGO_URI);
  console.log('═'.repeat(76));
  console.log(`  RM SCRAP RECORDS — ${COMMIT ? 'COMMIT (WILL WRITE)' : 'PREVIEW (writes nothing)'}`);
  console.log(`  workbook : ${path.basename(WORKBOOK)}`);
  console.log(`  database : ${mongoose.connection.name}`);
  console.log('═'.repeat(76));

  // ── Resolve the coil SKU and the originating conversion ──
  const skus = await SKU.find({ itemType: 'RAW_MATERIAL', isDeleted: { $ne: true } }).select('code name').lean();
  const skuByCode = new Map(skus.map((s) => [up(s.code), s]));
  const skuByName = new Map(skus.map((s) => [up(s.name), s]));

  const convs = await CoilConversion.find({ isDeleted: { $ne: true } }).select('batchNo conversionNumber').lean();
  const convByBatch = new Map(convs.filter((c) => c.batchNo).map((c) => [up(c.batchNo), c]));

  const existing = await ScrapRecord.find({ sourceRef: { $regex: `^${IMPORT_SOURCE}\\|SCRAP\\|` } })
    .select('sourceRef').lean();
  const already = new Set(existing.map((d) => d.sourceRef));

  const valid = []; const invalid = []; const skipped = [];
  const seen = new Set();
  for (const r of records) {
    const problems = [];
    if (!r.batchNo) problems.push('no batch number — cannot form a stable identity');
    if (seen.has(r.sourceRef)) problems.push('duplicate batch number in the sheet');
    if (!r.location) problems.push('no location');
    else if (!['PLG01', 'JW001'].includes(r.location)) problems.push(`unknown location "${r.location}"`);
    if (!r.scrapDate) problems.push('no date');
    const coil = skuByCode.get(up(r.coilCode)) || skuByName.get(up(r.coilName)) || null;
    if (!coil) problems.push(`no coil SKU for "${r.coilCode || r.coilName}"`);
    seen.add(r.sourceRef);

    if (already.has(r.sourceRef)) { skipped.push(r); continue; }
    if (problems.length) { invalid.push({ r, problems }); continue; }
    valid.push({ ...r, coil, conv: convByBatch.get(up(r.batchNo)) || null });
  }

  const cut = records.filter((r) => r.batchStatus === 'CUT');
  const uncut = records.filter((r) => r.batchStatus === 'UNCUT');
  const sum = (rows, f) => r2(rows.reduce((a, x) => a + (Number(x[f]) || 0), 0));

  console.log(`\n── SOURCE ──────────────────────────────────────────────────`);
  console.log(`  Summary Scrap rows            : ${records.length}`);
  console.log(`  CUT   (real scrap)            : ${cut.length}  → ${sum(cut, 'scrapKg')} kg`);
  console.log(`  UNCUT (coil never cut)        : ${uncut.length}  → ${sum(uncut, 'scrapKg')} kg — NOT scrap, excluded from every total`);
  for (const u of uncut) {
    console.log(`      ${u.batchNo.padEnd(13)} ${u.location} ${String(u.disposition).padEnd(9)} coil ${u.coilWeightKg} kg, circles 0 → sheet calls the whole coil scrap`);
  }

  console.log(`\n── LOCATION × DISPOSITION (CUT batches only) ───────────────`);
  const grid = {};
  for (const r of cut) {
    const k = `${r.location} / ${r.disposition}`;
    grid[k] = grid[k] || { n: 0, kg: 0 };
    grid[k].n += 1; grid[k].kg = r2(grid[k].kg + r.scrapKg);
  }
  for (const [k, v] of Object.entries(grid)) console.log(`  ${k.padEnd(22)} ${String(v.n).padStart(4)} batches   ${String(v.kg).padStart(12)} kg`);
  console.log(`  PLG01 = in-house, the only scrap Ambika physically holds`);
  console.log(`  JW001 = job work, offcuts stay with the job worker — a yield measure, not an asset`);

  console.log(`\n── PLAN ────────────────────────────────────────────────────`);
  console.log(`  already imported (skip)       : ${skipped.length}`);
  console.log(`  TO CREATE                     : ${valid.length}`);
  console.log(`  INVALID (not created)         : ${invalid.length}`);
  for (const iv of invalid) console.log(`      batch ${iv.r.batchNo || '(blank)'} — ${iv.problems.join('; ')}`);
  const linked = valid.filter((v) => v.conv).length;
  console.log(`  linked to a CoilConversion    : ${linked} of ${valid.length}  (uncut batches have none)`);

  console.log(`\n── RECONCILIATION vs the sheet ─────────────────────────────`);
  console.log(`  scrap on CUT batches  : ${sum(cut, 'scrapKg')} kg`);
  console.log(`  coil weight in        : ${sum(cut, 'coilWeightKg')} kg`);
  console.log(`  circles out           : ${sum(cut, 'circlesWeightKg')} kg`);
  const derived = r2(sum(cut, 'coilWeightKg') - sum(cut, 'circlesWeightKg'));
  console.log(`  coil − circles        : ${derived} kg  ${Math.abs(derived - sum(cut, 'scrapKg')) < 1 ? '✓ matches the sheet' : '✗ MISMATCH'}`);
  const yields = cut.map((r) => r.yieldRatioPct).filter((y) => y != null);
  console.log(`  yield: ${yields.length} batches · avg ${r2(yields.reduce((a, y) => a + y, 0) / (yields.length || 1))}%`);
  console.log(`  NOTE: no stock, no movement and no SKU is created by this importer.`);

  if (!COMMIT) {
    console.log(`\n${'═'.repeat(76)}`);
    console.log('  PREVIEW ONLY — nothing was written. Re-run with --commit to apply.');
    console.log('═'.repeat(76));
    await mongoose.disconnect();
    return;
  }

  console.log(`\n── WRITING ─────────────────────────────────────────────────`);
  let created = 0; let failed = 0;
  for (const v of valid) {
    try {
      await ScrapRecord.updateOne(
        { sourceRef: v.sourceRef },
        {
          $setOnInsert: {
            sourceRef: v.sourceRef,
            batchNo: v.batchNo,
            scrapDate: v.scrapDate,
            location: v.location,
            coilSkuId: v.coil._id, coilSkuCode: v.coil.code, coilSkuName: v.coil.name,
            coilWeightKg: v.coilWeightKg,
            circlesWeightKg: v.circlesWeightKg,
            scrapKg: v.scrapKg,
            yieldRatioPct: v.yieldRatioPct,
            disposition: v.disposition,
            verifiedAt: v.verifiedAt,
            coilRate: v.coilRate,
            batchStatus: v.batchStatus,
            conversionId: v.conv ? v.conv._id : null,
            conversionNumber: v.conv ? v.conv.conversionNumber : '',
            remarks: `Imported from ${IMPORT_SOURCE} · batch ${v.batchNo}`,
          },
        },
        { upsert: true },
      );
      created += 1;
      if (created % 100 === 0) console.log(`    … ${created}/${valid.length}`);
    } catch (e) {
      failed += 1;
      console.error(`    FAILED batch ${v.batchNo}: ${e.message}`);
    }
  }
  console.log(`  records created : ${created}   failed : ${failed}`);

  const total = await ScrapRecord.countDocuments({ isDeleted: { $ne: true } });
  const cutN = await ScrapRecord.countDocuments({ batchStatus: 'CUT', isDeleted: { $ne: true } });
  console.log(`\n── AFTER ───────────────────────────────────────────────────`);
  console.log(`  scrap records : ${total}   CUT ${cutN}   UNCUT ${total - cutN}`);
  console.log('═'.repeat(76));
  await mongoose.disconnect();
};

if (process.argv[1] && process.argv[1].endsWith('importRmScrapRecords.js')) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
