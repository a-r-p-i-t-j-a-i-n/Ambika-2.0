/**
 * ONE-TIME IMPORT — "Converted Item Name (For Resale)" from the client's master
 * workbook into SKU Master.
 *
 *   SOURCE       excel/IMS - Consumable & Packing 24-25.xlsx, sheet "Item List",
 *                columns "SKU Code" and "Converted Item Name (For Resale)"
 *   DESTINATION  SKU.convertedItemNameForResale
 *
 * Rows are matched on SKU Code -> SKU.code (the stable identifier), never on
 * Item Name. A SKU is written ONLY when, after trimming:
 *   1. the sheet's resale name is non-empty, AND
 *   2. the SKU's convertedItemNameForResale is empty / null / absent.
 * An existing master value is NEVER overwritten — reported as
 * "SKIP - MASTER ALREADY HAS VALUE". That rule is enforced twice: once when the
 * plan is built, and again in the update filter, so a value written between the
 * read and the write still wins. It is also what makes the script idempotent:
 * after a successful run the destination is non-empty, so a second run skips it.
 *
 * It touches ONE field on the SKU collection and nothing else. It never creates
 * a SKU, never writes InventoryPolicy, InventoryStock or InventoryMovement, and
 * never touches ADC, lead time, safety factor, MOQ, max level, material in
 * transit, opening stock or any other SKU field. `updatedAt` does move on the
 * SKUs it writes (schema timestamps) — a deliberate audit trace.
 *
 * USAGE
 *   node src/scripts/importConvertedItemNameFromExcel.js            <- preview (no writes)
 *   DRY_RUN=true node src/scripts/importConvertedItemNameFromExcel.js  <- same, explicit
 *   node src/scripts/importConvertedItemNameFromExcel.js --commit   <- apply
 *
 *   --file=<path>    use a different workbook
 *   --sheet=<name>   use a different sheet (default "Item List")
 *
 * Preview mode performs ZERO database writes. DRY_RUN=true overrides --commit,
 * so the safer intent always wins.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import xlsx from 'xlsx';
import env from '../config/env.js';
import SKU from '../modules/skus/sku.model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));           // backend/src/scripts
const REPO_ROOT = path.resolve(HERE, '../../..');
const DEFAULT_FILE = path.join(REPO_ROOT, 'excel', 'IMS - Consumable & Packing 24-25.xlsx');

const argValue = (flag, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : fallback;
};

// Preview by default, like every other one-off script here — a bare run never
// writes. --commit applies; DRY_RUN=true overrides it.
const COMMIT = process.argv.includes('--commit');
const DRY_RUN_ENV = process.env.DRY_RUN !== undefined
  && String(process.env.DRY_RUN).toLowerCase() !== 'false';
const DRY_RUN = DRY_RUN_ENV || !COMMIT;

const FILE = argValue('--file', DEFAULT_FILE);
const SHEET = argValue('--sheet', 'Item List');

const COL_CODE = 'SKU Code';
const COL_NAME = 'Item Name';
const COL_RESALE = 'Converted Item Name (For Resale)';

/** Missing, null, non-string and whitespace-only all collapse to '' — one notion of "empty". */
const clean = (v) => (typeof v === 'string' ? v.trim() : (v === 0 ? '0' : ''));

/**
 * Matches a destination that is still empty — absent, null, '' or whitespace —
 * as one clause: "holds no non-whitespace character". Written this way because
 * the schema declares `set: (v) => (v == null ? '' : v)` on this path, and
 * Mongoose runs setters while casting query filters, so a literal `{ field: null }`
 * can be rewritten to `{ field: '' }` and quietly stop matching genuinely-null
 * rows. `$not: { $regex: /\S/ }` sidesteps casting and covers all four shapes.
 */
const STILL_EMPTY = { convertedItemNameForResale: { $not: { $regex: /\S/ } } };

const pad = (s, n) => String(s).slice(0, n).padEnd(n);

/** Read the sheet. Returns every row that carries both a code and a resale name. */
const readSheet = () => {
  if (!fs.existsSync(FILE)) throw new Error(`Workbook not found: ${FILE}`);
  const wb = xlsx.readFile(FILE);
  if (!wb.Sheets[SHEET]) {
    throw new Error(`Sheet "${SHEET}" not found. Sheets: ${wb.SheetNames.join(', ')}`);
  }
  const raw = xlsx.utils.sheet_to_json(wb.Sheets[SHEET], { defval: '' });
  if (raw.length && !(COL_RESALE in raw[0])) {
    throw new Error(`Column "${COL_RESALE}" not found. Columns: ${Object.keys(raw[0]).join(' | ')}`);
  }
  return raw.map((r, i) => ({
    row: i + 2,                                    // +2: 1-based, and row 1 is the header
    code: clean(r[COL_CODE]).toUpperCase(),
    name: clean(r[COL_NAME]),
    resale: clean(r[COL_RESALE]),
  }));
};

/** Decide everything up front, without touching the database. */
const buildPlan = async (sheetRows) => {
  // A row is only a candidate if it names a SKU and carries a resale name.
  const blankResale = sheetRows.filter((r) => r.code !== '' && r.resale === '');
  const blankCode = sheetRows.filter((r) => r.code === '');
  const candidates = sheetRows.filter((r) => r.code !== '' && r.resale !== '');

  const codes = [...new Set(candidates.map((r) => r.code))];
  // .lean() on purpose: raw documents, so a field that is genuinely ABSENT stays
  // absent instead of being filled in by the schema default on hydration.
  const skus = await SKU.find({ code: { $in: codes } })
    .select('code name convertedItemNameForResale isDeleted').lean();
  const byCode = new Map(skus.map((s) => [String(s.code).toUpperCase(), s]));

  const plan = { toWrite: [], skipAlreadySet: [], skipDeleted: [], missingSku: [], blankResale, blankCode };
  for (const r of candidates) {
    const sku = byCode.get(r.code);
    if (!sku) { plan.missingSku.push(r); continue; }
    if (sku.isDeleted === true) { plan.skipDeleted.push({ ...r, sku }); continue; }
    if (clean(sku.convertedItemNameForResale) !== '') { plan.skipAlreadySet.push({ ...r, sku }); continue; }
    plan.toWrite.push({ ...r, sku });
  }

  // The same code appearing twice with different resale names would make the
  // outcome order-dependent. Surface it instead of letting the last row win.
  const bySku = new Map();
  for (const it of plan.toWrite) bySku.set(it.code, [...(bySku.get(it.code) || []), it.resale]);
  plan.conflicts = [...bySku.entries()]
    .filter(([, v]) => new Set(v).size > 1)
    .map(([code, values]) => ({ code, values: [...new Set(values)] }));

  return { plan, candidates };
};

const printPlan = ({ plan, candidates }, sheetRows) => {
  console.log('── Source ──────────────────────────────────────────────');
  console.log(`  file  : ${FILE}`);
  console.log(`  sheet : ${SHEET}`);
  console.log('\n── Counts ──────────────────────────────────────────────');
  console.log(`  Excel rows read                                : ${sheetRows.length}`);
  console.log(`  ...with a blank SKU Code (ignored)             : ${plan.blankCode.length}`);
  console.log(`  ...with a SKU Code but blank resale name       : ${plan.blankResale.length}`);
  console.log(`  Rows carrying both code and resale name        : ${candidates.length}`);
  console.log(`  ...matched to a live SKU                       : ${plan.toWrite.length + plan.skipAlreadySet.length}`);
  console.log(`  ...with no matching SKU                        : ${plan.missingSku.length}`);
  console.log(`  ...whose SKU is soft-deleted                   : ${plan.skipDeleted.length}`);
  console.log(`  ...skipped, master already has a value         : ${plan.skipAlreadySet.length}`);
  console.log(`  ROWS THAT WILL BE UPDATED                      : ${plan.toWrite.length}`);

  const rows = [
    ...plan.toWrite.map((i) => [i.code, i.resale, '—', 'IMPORT']),
    ...plan.skipAlreadySet.map((i) => [i.code, i.resale, clean(i.sku.convertedItemNameForResale), 'SKIP - MASTER ALREADY HAS VALUE']),
    ...plan.skipDeleted.map((i) => [i.code, i.resale, clean(i.sku.convertedItemNameForResale) || '—', 'SKIP - SKU SOFT-DELETED']),
    ...plan.missingSku.map((i) => [i.code, i.resale, '(no SKU)', 'SKIP - NO MATCHING SKU']),
  ];
  console.log('\n── Plan ────────────────────────────────────────────────');
  if (!rows.length) {
    console.log('  Nothing to do — no sheet row carries a resale name.');
  } else {
    console.log(`| ${pad('SKU Code', 14)} | ${pad('Excel Resale Name', 40)} | ${pad('Current Master Value', 24)} | Action`);
    console.log(`|${'-'.repeat(16)}|${'-'.repeat(42)}|${'-'.repeat(26)}|--------`);
    for (const [a, b, c, d] of rows) console.log(`| ${pad(a, 14)} | ${pad(b, 40)} | ${pad(c, 24)} | ${d}`);
  }

  if (plan.missingSku.length) {
    console.log('\n── Sheet rows with no matching SKU (left untouched) ────');
    for (const r of plan.missingSku) console.log(`  row ${r.row}  code=${r.code}  name="${r.name}"  resale="${r.resale}"`);
  }
  if (plan.conflicts.length) {
    console.log('\n── WARNING: one SKU Code with conflicting resale names ─');
    for (const c of plan.conflicts) console.log(`  ${c.code}: ${JSON.stringify(c.values)}`);
    console.log('  Resolve in the sheet first — the import would apply whichever row it reached last.');
  }
};

/** One guarded update. Returns 'written' | 'skipped'. */
const applyOne = async ({ sku, resale }, session) => {
  const res = await SKU.updateOne(
    { _id: sku._id, isDeleted: { $ne: true }, ...STILL_EMPTY },
    { $set: { convertedItemNameForResale: resale } },
    session ? { session } : {},
  );
  return res.modifiedCount === 1 ? 'written' : 'skipped';
};

const run = async () => {
  const sheetRows = readSheet();

  // autoIndex:false — importing the SKU model would otherwise have Mongoose
  // build its unique `code` index and a 4-field text index on connect. An
  // import has no business touching indexes on a live collection.
  await mongoose.connect(env.MONGO_URI, { autoIndex: false });
  console.log(`Database : ${mongoose.connection.name} @ ${mongoose.connection.host}`);
  console.log(`Mode     : ${DRY_RUN ? 'PREVIEW — no writes will be performed' : 'COMMIT — writes will be performed'}\n`);

  const built = await buildPlan(sheetRows);
  const { plan } = built;
  printPlan(built, sheetRows);

  const summary = {
    excelRows: sheetRows.length,
    imported: 0,
    skipped: plan.skipAlreadySet.length + plan.skipDeleted.length,
    missingSku: plan.missingSku.length,
    blankResale: plan.blankResale.length,
    failed: 0,
  };

  if (DRY_RUN) {
    console.log(`\nPREVIEW — would update ${plan.toWrite.length} SKU(s). NO DATABASE WRITES WERE PERFORMED.`);
    console.log('Re-run with --commit once this plan looks right.');
    await mongoose.connection.close();
    return;
  }
  if (!plan.toWrite.length) {
    console.log('\nNothing to write. Database unchanged.');
    await mongoose.connection.close();
    return;
  }

  console.log(`\n── Writing ${plan.toWrite.length} SKU(s) ─────────────────────────────`);
  const failures = [];
  let usedTransaction = false;

  // Inside a transaction, errors MUST propagate untouched: the driver inspects
  // them for the TransientTransactionError label and retries the whole callback.
  // Catching them here would turn a retryable blip into a hard failure. The
  // callback can run more than once, so it owns its own accumulator.
  const writeAllInTransaction = async (session) => {
    const applied = [];
    for (const item of plan.toWrite) applied.push({ item, outcome: await applyOne(item, session) });
    return applied;
  };
  /** Only a server that cannot do transactions at all — not a transaction that failed. */
  const transactionsUnsupported = (err) => err?.code === 20
    || err?.codeName === 'IllegalOperation'
    || /Transaction numbers are only allowed on a replica set member or mongos/i.test(err?.message || '')
    || /Transactions are not supported/i.test(err?.message || '');

  const session = await mongoose.startSession();
  let applied = null;
  try {
    applied = await session.withTransaction((s) => writeAllInTransaction(s));
    usedTransaction = true;
  } catch (err) {
    if (!transactionsUnsupported(err)) {
      console.log(`\nTransaction rolled back — NOTHING was written: ${err.message.split('\n')[0]}`);
      console.log('Nothing is half-applied. Re-run to try again.');
      await session.endSession();
      await mongoose.connection.close();
      process.exit(1);
    }
    console.log(`\nTransactions unavailable on this server (${err.message.split('\n')[0]}).`);
    console.log('Falling back to guarded per-document updates.\n');
    applied = [];
    for (const item of plan.toWrite) {
      try {
        applied.push({ item, outcome: await applyOne(item, null) });
      } catch (e) {
        failures.push({ code: item.code, message: e.message });
        console.log(`  FAIL   ${item.code}  ${e.message}`);
      }
    }
  } finally {
    await session.endSession();
  }

  for (const { item, outcome } of applied) {
    if (outcome === 'written') {
      summary.imported += 1;
      console.log(`  IMPORTED  ${pad(item.code, 14)} "${item.resale}"`);
    } else {
      summary.skipped += 1;
      console.log(`  SKIP      ${pad(item.code, 14)} (filled in between the read and the write)`);
    }
  }
  summary.failed = failures.length;

  // ── Verification: re-read from the database, do not trust the counters ──
  console.log('\n── Verification (fresh read) ───────────────────────────');
  const after = await buildPlan(sheetRows);
  const overwritten = plan.skipAlreadySet.filter((b) => {
    const now = after.plan.skipAlreadySet.find((a) => a.code === b.code);
    return now && clean(now.sku.convertedItemNameForResale) !== clean(b.sku.convertedItemNameForResale);
  });
  const populated = await SKU.countDocuments({ isDeleted: { $ne: true }, $nor: [STILL_EMPTY] });
  console.log(`  Sheet rows still un-imported                 : ${after.plan.toWrite.length}  (expected 0${failures.length ? ` + ${failures.length} failed` : ''})`);
  console.log(`  Pre-existing master values overwritten       : ${overwritten.length}  (MUST be 0)`);
  console.log(`  SKUs now carrying convertedItemNameForResale : ${populated}`);
  console.log(`  Sheet rows with no matching SKU (reported)   : ${after.plan.missingSku.length}`);

  for (const item of plan.toWrite) {
    const fresh = await SKU.findById(item.sku._id).select('code convertedItemNameForResale').lean();
    const ok = clean(fresh?.convertedItemNameForResale) === item.resale;
    console.log(`  ${ok ? 'OK  ' : 'BAD '} ${pad(item.code, 14)} -> ${JSON.stringify(fresh?.convertedItemNameForResale)}`);
    if (!ok) summary.failed += 1;
  }

  console.log('\n── Summary ─────────────────────────────────────────────');
  console.log(`Excel rows:        ${summary.excelRows}`);
  console.log(`Imported:          ${summary.imported}`);
  console.log(`Skipped:           ${summary.skipped}`);
  console.log(`Missing SKU:       ${summary.missingSku}`);
  console.log(`Blank resale name: ${summary.blankResale}`);
  console.log(`Failed:            ${summary.failed}`);
  console.log(`Applied ${usedTransaction ? 'in a transaction' : 'as guarded per-document updates'}.`);
  console.log('Only SKU.convertedItemNameForResale was written. InventoryPolicy, stock and movements untouched.');

  await mongoose.connection.close();
  if (summary.failed > 0 || overwritten.length > 0 || after.plan.toWrite.length > 0) process.exit(1);
  process.exit(0);
};

run().catch(async (err) => {
  console.error('\nImport failed:', err.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
