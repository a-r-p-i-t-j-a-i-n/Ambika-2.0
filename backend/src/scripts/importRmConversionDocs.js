/**
 * Create the historical CoilConversion documents for cuts already in the ledger.
 *
 *   node src/scripts/importRmConversionDocs.js --preview   # report only
 *   node src/scripts/importRmConversionDocs.js --commit    # writes
 *
 * PREVIEW IS THE DEFAULT.
 *
 * ── WHAT THIS IS, AND IS NOT ────────────────────────────────────────────────
 * The 718 historical conversions are ALREADY correct in the inventory ledger as
 * CONVERT_OUT / CONVERT_IN movements, and stock reconciles. This script writes
 * nothing to stock. It only builds the CoilConversion documents that the
 * Conversion screen and the dashboard's yield panel read from — a reporting
 * layer over cuts that already happened.
 *
 * It creates NO movements, touches NO stock, NO policy and NO SKU.
 *
 * ── WHY 481 DOCUMENTS AND NOT 718 ──────────────────────────────────────────
 * The workbook records a cut across two sheets:
 *
 *   Summary Scrap        one row per BATCH — coil weight in, total circle
 *                        weight out, scrap, yield, verification status, rate
 *   Coil Out & Circle In one row per CIRCLE SIZE produced from that batch
 *
 * The 718 circle rows group into 481 batches, and the join is exact: for all
 * 480 batches that have a Summary Scrap header, the summed circle weight AND
 * the summed piece count both match the header to the unit. That is precisely
 * the CoilConversion model's own shape — one coil, a `circles[]` array — and
 * the shape of the conversion the app itself created.
 *
 * Writing 718 documents instead would mean inventing a coil input weight per
 * line (the source has none below batch level) and repeating each batch's scrap
 * and yield on every one of its lines, inflating total recorded scrap by 49.27%
 * and skewing the dashboard's average yield toward multi-line batches. So one
 * document per batch it is.
 *
 * ── IDEMPOTENCY ────────────────────────────────────────────────────────────
 * Each document carries `sourceRef = EXCEL_RM_24_25|CONVERSION|<batch no>`,
 * backed by a unique sparse index. The batch number is the client's own
 * identifier for a cut, so the same batch can never produce a second document.
 * The index is sparse, so the app-era conversion — which sets no sourceRef —
 * is outside it entirely and cannot be touched.
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import env from '../config/env.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
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
export const srcRef = (batchNo) => `${IMPORT_SOURCE}|CONVERSION|${batchNo}`;

/** The sheet's words for scrap verification → the model's enum. */
export const SCRAP_STATE = (v) => {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'JOB WORK' || s === 'JOB_WORK') return 'JOB_WORK';
  if (s === 'DONE') return 'DONE';
  if (s === 'REJECTED') return 'REJECTED';
  return 'PENDING'; // blank — not yet checked
};

/**
 * Group the parsed conversion rows into one record per batch, joined to its
 * Summary Scrap header. Pure — no database, so it is testable on its own.
 */
export const buildBatches = ({ conversions, scrap }) => {
  const scrapByBatch = new Map();
  for (const s of scrap) {
    const k = up(s.batchNo);
    if (k && !scrapByBatch.has(k)) scrapByBatch.set(k, s);
  }

  const byBatch = new Map();
  for (const c of conversions) {
    const k = up(c.batchNo);
    if (!byBatch.has(k)) byBatch.set(k, []);
    byBatch.get(k).push(c);
  }

  const out = [];
  for (const [batchKey, lines] of byBatch) {
    const header = scrapByBatch.get(batchKey) || null;
    // Earliest line date is the cut date when the header has none.
    const dates = lines.map((l) => l.date).filter(isDate).map((d) => d.getTime());
    const conversionDate = header && isDate(header.date)
      ? header.date
      : (dates.length ? new Date(Math.min(...dates)) : null);

    out.push({
      batchNo: lines[0].batchNo,
      batchKey,
      header,
      lines,
      conversionDate,
      coilName: header ? header.coilName : lines[0].coilName,
      coilCode: header ? header.coilCode : '',
      // Every one of these comes from the batch header. When there is no header
      // they stay null — nothing is derived from the circle lines, because the
      // lines do not record coil input or scrap at all.
      coilWeightKg: header ? r2(header.coilKg) : null,
      scrapKg: header ? r2(header.scrapKg) : null,
      // The sheet stores yield as a ratio (0.8126); the model stores a percent,
      // as the app's own conversion does (75).
      yieldRatioPct: header && header.yieldRatio ? r2(header.yieldRatio * 100) : null,
      scrapVerified: header ? SCRAP_STATE(header.verified) : 'PENDING',
      rate: header ? r2(header.rate) : 0,
      circlesWeightKg: r2(lines.reduce((a, l) => a + (l.circleKg || 0), 0)),
      circlesPcs: r2(lines.reduce((a, l) => a + (l.circlePcs || 0), 0)),
    });
  }
  return out;
};

const run = async () => {
  if (!WORKBOOK || !fs.existsSync(WORKBOOK)) {
    console.error(`Workbook not found. Looked in:\n  ${DEFAULT_FILES.join('\n  ')}\nPass --file "<path>".`);
    process.exit(1);
  }
  const parsed = parseWorkbook(WORKBOOK);
  const batches = buildBatches(parsed);

  await mongoose.connect(env.MONGO_URI);
  console.log('═'.repeat(76));
  console.log(`  RM CONVERSION DOCUMENTS — ${COMMIT ? 'COMMIT (WILL WRITE)' : 'PREVIEW (writes nothing)'}`);
  console.log(`  workbook : ${path.basename(WORKBOOK)}`);
  console.log(`  database : ${mongoose.connection.name}`);
  console.log('═'.repeat(76));

  // ── Resolve SKUs ──
  const skus = await SKU.find({ itemType: { $in: ['RAW_MATERIAL', 'CIRCLE'] }, isDeleted: { $ne: true } })
    .select('code name unit itemType').lean();
  const byCode = new Map(skus.map((s) => [up(s.code), s]));
  const byName = new Map(skus.filter((s) => s.itemType === 'RAW_MATERIAL').map((s) => [up(s.name), s]));

  // ── Existing documents ──
  const existing = await CoilConversion.find({ isDeleted: { $ne: true } })
    .select('sourceRef conversionNumber batchNo').lean();
  const haveRef = new Set(existing.filter((d) => d.sourceRef).map((d) => d.sourceRef));
  const appEra = existing.filter((d) => !d.sourceRef);

  // ── Movement links (read-only) ──
  const convInMovs = await InventoryMovement.find({
    clientRequestId: { $regex: `^${IMPORT_SOURCE}\\|CONV_IN\\|` }, isDeleted: { $ne: true },
  }).select('clientRequestId movementNumber').lean();
  const movByReq = new Map(convInMovs.map((m) => [m.clientRequestId, m]));

  // ── Validate ──
  const valid = []; const invalid = []; const already = [];
  const seenRefs = new Set();
  for (const b of batches) {
    const ref = srcRef(b.batchNo);
    const problems = [];
    if (!b.batchNo) problems.push('no batch number — cannot form a stable identity');
    if (seenRefs.has(ref)) problems.push('duplicate source identity');
    if (!b.header) problems.push('no Summary Scrap header — coil input KG, scrap and yield are unknown');
    const coil = (b.coilCode && byCode.get(up(b.coilCode))) || byName.get(up(b.coilName)) || null;
    if (!coil) problems.push(`no coil SKU for "${b.coilCode || b.coilName}"`);
    if (!isDate(b.conversionDate)) problems.push('no usable date');
    const circles = b.lines.map((l) => ({ line: l, sku: byCode.get(up(l.circleCode)) || null }));
    const missingCircles = circles.filter((c) => !c.sku);
    if (missingCircles.length) problems.push(`${missingCircles.length} circle line(s) with no SKU`);

    seenRefs.add(ref);
    if (haveRef.has(ref)) { already.push({ b, ref }); continue; }
    if (problems.length) { invalid.push({ b, ref, problems }); continue; }
    valid.push({ b, ref, coil, circles });
  }

  console.log(`\n── SOURCE ──────────────────────────────────────────────────`);
  console.log(`  Excel conversion rows (circle lines) : ${parsed.conversions.length}`);
  console.log(`  grouped into batches                 : ${batches.length}`);
  console.log(`  batches WITH a Summary Scrap header  : ${batches.filter((b) => b.header).length}`);
  console.log(`  batches WITHOUT a header             : ${batches.filter((b) => !b.header).length}`);
  console.log(`  circle lines accounted for           : ${batches.reduce((a, b) => a + b.lines.length, 0)}`);

  console.log(`\n── EXISTING DOCUMENTS ──────────────────────────────────────`);
  console.log(`  app-era (no sourceRef, untouched)    : ${appEra.length}  ${appEra.map((d) => d.conversionNumber).join(', ') || '—'}`);
  console.log(`  already imported (sourceRef present) : ${haveRef.size}`);

  console.log(`\n── PLAN ────────────────────────────────────────────────────`);
  console.log(`  already imported (skip)              : ${already.length}`);
  console.log(`  TO CREATE                            : ${valid.length}`);
  console.log(`  INVALID (not created)                : ${invalid.length}`);
  for (const iv of invalid) console.log(`      batch ${iv.b.batchNo || '(blank)'} — ${iv.problems.join('; ')}`);

  // ── Reconciliation against the ledger ──
  console.log(`\n── RECONCILIATION: Excel ↔ ledger movements ────────────────`);
  let linked = 0; let unlinked = 0;
  for (const v of valid) {
    for (const c of v.circles) if (movByReq.has(`${IMPORT_SOURCE}|CONV_IN|${c.line.row}`)) linked += 1; else unlinked += 1;
  }
  console.log(`  circle lines linked to a CONVERT_IN movement : ${linked}`);
  console.log(`  circle lines with no matching movement       : ${unlinked}`);
  const xlKg = r2(valid.reduce((a, v) => a + v.b.circlesWeightKg, 0));
  const xlPcs = r2(valid.reduce((a, v) => a + v.b.circlesPcs, 0));
  console.log(`  circle weight to be recorded : ${xlKg} kg`);
  console.log(`  circle pieces to be recorded : ${xlPcs} pcs`);
  const totalScrap = r2(valid.reduce((a, v) => a + (v.b.scrapKg || 0), 0));
  console.log(`  scrap recorded on these docs : ${totalScrap} kg  (batch-level, counted ONCE per cut)`);
  const yields = valid.map((v) => v.b.yieldRatioPct).filter((y) => y != null);
  console.log(`  yield: ${yields.length} batches carry one · avg ${r2(yields.reduce((a, y) => a + y, 0) / (yields.length || 1))}%`);
  console.log(`  NOTE: scrap here is a RECORD on the conversion. It posts no movement and`);
  console.log(`        changes no stock — the verified-scrap ADJUST_OUT rows already did that.`);

  if (!COMMIT) {
    console.log(`\n${'═'.repeat(76)}`);
    console.log('  PREVIEW ONLY — nothing was written. Re-run with --commit to apply.');
    console.log('═'.repeat(76));
    await mongoose.disconnect();
    return;
  }

  if (invalid.length && !valid.length) {
    console.log('\n  Nothing valid to write. Stopping.');
    await mongoose.disconnect();
    return;
  }

  // ── Commit ──
  console.log(`\n── WRITING ─────────────────────────────────────────────────`);
  let created = 0; let failed = 0;
  for (const v of valid) {
    const { b, ref, coil, circles } = v;
    try {
      await CoilConversion.updateOne(
        { sourceRef: ref },
        {
          $setOnInsert: {
            sourceRef: ref,
            // Readable and unique per batch; the screens show batchNo anyway.
            conversionNumber: `EXL/${b.batchNo}`,
            conversionDate: b.conversionDate,
            batchNo: b.batchNo,
            coilSkuId: coil._id, coilSkuCode: coil.code, coilSkuName: coil.name,
            coilWeightKg: b.coilWeightKg,
            rate: b.rate,
            circles: circles.map((c) => {
              const mov = movByReq.get(`${IMPORT_SOURCE}|CONV_IN|${c.line.row}`);
              return {
                circleSkuId: c.sku._id, circleSkuCode: c.sku.code, circleSkuName: c.sku.name,
                sizeLabel: c.line.circleName || '',
                // Straight from the sheet. Neither is derived from the other,
                // and no conversion factor exists or is applied.
                pcs: c.line.circlePcs == null ? 0 : r2(c.line.circlePcs),
                weightKg: c.line.circleKg == null ? 0 : r2(c.line.circleKg),
                ...(mov ? { movementId: mov._id, movementNumber: mov.movementNumber } : {}),
              };
            }),
            circlesWeightKg: b.circlesWeightKg,
            scrapKg: b.scrapKg,
            yieldRatioPct: b.yieldRatioPct,
            scrapVerified: b.scrapVerified,
            remarks: `Imported from ${IMPORT_SOURCE} · batch ${b.batchNo}`,
          },
        },
        { upsert: true },
      );
      created += 1;
      if (created % 100 === 0) console.log(`    … ${created}/${valid.length}`);
    } catch (e) {
      failed += 1;
      console.error(`    FAILED batch ${b.batchNo}: ${e.message}`);
    }
  }
  console.log(`  documents created : ${created}   failed : ${failed}`);

  const after = await CoilConversion.countDocuments({ isDeleted: { $ne: true } });
  const afterImported = await CoilConversion.countDocuments({ sourceRef: { $exists: true }, isDeleted: { $ne: true } });
  console.log(`\n── AFTER ───────────────────────────────────────────────────`);
  console.log(`  total conversion documents : ${after}`);
  console.log(`  imported (sourceRef)       : ${afterImported}`);
  console.log(`  app-era (untouched)        : ${after - afterImported}`);
  console.log('═'.repeat(76));
  await mongoose.disconnect();
};

if (process.argv[1] && process.argv[1].endsWith('importRmConversionDocs.js')) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
