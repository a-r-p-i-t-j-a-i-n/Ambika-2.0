/**
 * Import the client's historical Raw Material workbook into the RM IMS ledger.
 *
 *   node src/scripts/importRmExcelHistory.js --preview            # report only, writes nothing
 *   node src/scripts/importRmExcelHistory.js --commit             # writes
 *   node src/scripts/importRmExcelHistory.js --preview --file "…" # different workbook
 *
 * PREVIEW IS THE DEFAULT. --commit must be passed explicitly.
 *
 * ── WHAT IT IMPORTS, AND WHY EXACTLY THESE STREAMS ──────────────────────────
 * The client's own closing balances reconstruct EXACTLY from their transaction
 * sheets with opening stock = 0 (their "Opening Stock Quantity" column is blank
 * for all 30 items, in both the Inventory and the IMS tab). The sheet's rules,
 * read off its own formulas:
 *
 *   Coil   = Σ Purchase.Recvd − Σ VERIFIED Scrap − Σ CoilOut.circleWeight
 *   Circle = Σ CoilOut.pcs + Σ CircleInward.pcs − Σ CircleOut.pcs
 *
 * So five streams are imported and no others:
 *   1. coil purchases      → GRN_IN      (495 rows; Circle-tagged purchases are
 *                                         NOT imported — the client's own circle
 *                                         formula ignores them, because circles
 *                                         come back through Coil Out, and taking
 *                                         both would double count)
 *   2. conversions         → CONVERT_OUT on the coil + CONVERT_IN on the circle
 *   3. verified scrap      → ADJUST_OUT on the coil (see the scrap rule below)
 *   4. circle inward       → ADJUST_IN on the circle
 *   5. circle issues       → CONSUME_OUT on the circle   ← the only consumption
 *
 * Conversion output is not consumption. Scrap is not consumption. Circle inward
 * is not consumption. Purchases are not consumption. The IMS tab and every pivot
 * sheet are derived views and are never read as transactions.
 *
 * ── THE SCRAP RULE ─────────────────────────────────────────────────────────
 * Scrap only leaves coil stock once it has been VERIFIED. The client's coil
 * formula carries a `"*"` filter on the Scrap Verified column, which excludes
 * rows where that column is blank — 13 of 495. Deducting all scrap puts every
 * coil out by exactly those 13 rows, so unverified scrap is imported as a
 * recorded-but-not-posted row and stated in the report.
 *
 * ── JW001 vs PLG01 ─────────────────────────────────────────────────────────
 * Both locations' verified scrap reduces the coil, because the coil metal has
 * genuinely left either way — that is what reconciles. The difference is that
 * JW001 scrap never becomes physical stock Ambika holds, so NO scrap inventory
 * item is created for it. None is created for PLG01 either: this importer only
 * reproduces what the workbook records, and the workbook holds no scrap SKU.
 * Location is carried onto every movement it is known for.
 *
 * ── WHAT IT NEVER DOES ─────────────────────────────────────────────────────
 * No opening balances are invented. No PCS↔KG factor is invented — where the
 * source gives both they are both stored, where it gives one the other stays
 * null. Nothing is deleted. QA/test SKUs are left untouched and kept out of the
 * 30-SKU reconciliation. Negative closing balances the client's own sheet
 * contains are reproduced faithfully and reported, never "corrected".
 *
 * ── IDEMPOTENCY ────────────────────────────────────────────────────────────
 * Every posted movement carries a deterministic clientRequestId of the form
 *   EXCEL_RM_24_25|<stream>|<sheet row>
 * which is read back before writing, so a second --commit writes nothing. The
 * id is derived from the source row, never from a timestamp.
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import env from '../config/env.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import InventoryMovement, { TXN_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import InventoryPolicy from '../modules/inventory/inventoryPolicy.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import { inventoryService } from '../modules/inventory/inventory.service.js';

// ── CLI ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const fileArg = argv.indexOf('--file');
const DEFAULT_FILES = [
  path.resolve(process.cwd(), '..', 'excel', 'IMS - Raw Material 24-25(2).xlsx'),
  path.resolve(process.cwd(), '..', 'excel', 'IMS - Raw Material 24-25.xlsx'),
  'C:/Users/Admin/Downloads/IMS - Raw Material 24-25.xlsx',
];
const WORKBOOK = fileArg >= 0 ? argv[fileArg + 1] : DEFAULT_FILES.find((f) => fs.existsSync(f));

export const IMPORT_SOURCE = 'EXCEL_RM_24_25';
const reqId = (stream, row) => `${IMPORT_SOURCE}|${stream}|${row}`;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const up = (v) => String(v ?? '').trim().toUpperCase();
const isDate = (v) => v instanceof Date && !Number.isNaN(v.getTime());

// ── Parse ───────────────────────────────────────────────────────────────────
/**
 * Read every stream out of the workbook. Row numbers are 1-based SHEET rows, so
 * a record can always be traced back to the cell a human can open.
 */
export const parseWorkbook = (file) => {
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true });
  const grid = (n) => (wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, blankrows: false, defval: null }) : []);

  // ── Inventory: the 30-item master + planning row ──
  const invGrid = grid('Inventory');
  const master = invGrid.slice(2)
    .map((r, i) => ({ row: i + 3, r }))
    .filter(({ r }) => r[0])
    .map(({ row, r }) => ({
      row,
      code: String(r[0]).trim(),
      name: String(r[1]).trim(),
      category: String(r[2]).trim(),            // the sheet's Category IS Coil/Circle
      kind: String(r[2]).trim() === 'Circle' ? 'CIRCLE' : 'COIL',
      moq: r[4] == null ? null : Number(r[4]),
      adcLow: r[5] == null ? null : Number(r[5]),
      adcNormal: r[6] == null ? null : Number(r[6]),
      adcPeak: r[7] == null ? null : Number(r[7]),
      consumptionMode: up(r[8]) || null,
      leadDays: r[9] == null ? null : Number(r[9]),
      safetyFactor: r[10] == null ? null : Number(r[10]),
      maxLevel: r[11] == null ? null : Number(r[11]),
      openingStock: r[12] == null ? null : Number(r[12]),   // blank for all 30
      totalAvailable: r[13] == null ? null : Number(r[13]), // the reconciliation target
      rate: r[20] == null ? null : Number(r[20]),
      vendorName: r[22] == null ? '' : String(r[22]).trim(),
    }));

  // ── Purchase: coil receipts only ──
  const purGrid = grid('Purchase');
  const ph = purGrid[0] || [];
  const ix = (n) => ph.findIndex((h) => String(h).trim() === n);
  const cName = ix('Item Name'); const cQty = ix('Recvd Quantity'); const cInvQty = ix('Invoice Qty');
  const cCC = ix('Coil/Circle'); const cDate = ix('Date'); const cBatch = ix('Batch No.');
  const cSup = ix('Supplier'); const cRate = ix('Rate'); const cGrn = ix('GRN No.');
  const cLoc = ix('Received At'); const cPo = ix('PO No.');
  const purchases = purGrid.slice(2)
    .map((r, i) => ({ row: i + 3, r }))
    .filter(({ r }) => String(r[cCC] || '').trim() === 'Coil')
    .map(({ row, r }) => ({
      row,
      itemName: String(r[cName] || '').trim(),
      qtyKg: Number(r[cQty]) || 0,
      invoiceQty: Number(r[cInvQty]) || 0,
      date: r[cDate], batchNo: String(r[cBatch] || '').trim(),
      supplier: String(r[cSup] || '').trim(), rate: Number(r[cRate]) || 0,
      grnNo: String(r[cGrn] || '').trim(), poNo: String(r[cPo] || '').trim(),
      location: String(r[cLoc] || '').trim(),
    }));

  // ── Coil Out & Circle In: conversions + circle issues ──
  const coGrid = grid('Coil Out & Circle In');
  const coRows = coGrid.slice(2).map((r, i) => ({ row: i + 3, r })).filter(({ r }) => r.some((v) => v !== null && v !== ''));
  const conversions = coRows.filter(({ r }) => String(r[4] || '').trim() === 'Coil').map(({ row, r }) => ({
    row,
    coilCode: String(r[1] || '').trim(),
    coilName: String(r[2] || '').trim(),
    batchNo: String(r[3] || '').trim(),
    circleCode: String(r[5] || '').trim(),
    circleName: String(r[6] || '').trim(),
    // The sheet records BOTH for every conversion row: pieces produced, and the
    // weight of those pieces. Neither is derived from the other.
    circlePcs: r[7] == null ? null : Number(r[7]),
    circleKg: r[8] == null ? null : Number(r[8]),
    date: r[11],
  }));
  const issues = coRows.filter(({ r }) => String(r[4] || '').trim() === 'Circle').map(({ row, r }) => ({
    row,
    circleCode: String(r[1] || '').trim(),
    circleName: String(r[2] || '').trim(),
    batchNo: String(r[3] || '').trim(),
    // Circles are issued by PIECE COUNT only — the sheet records no weight here,
    // and none is invented.
    pcs: Number(r[9]) || 0,
    kg: null,
    date: r[11],
  }));

  // ── Summary Scrap ──
  const scGrid = grid('Summary Scrap');
  const scrap = scGrid.slice(2).map((r, i) => ({ row: i + 3, r })).filter(({ r }) => r.some((v) => v !== null && v !== ''))
    .map(({ row, r }) => ({
      row,
      location: String(r[0] || '').trim(),
      date: r[1],
      batchNo: String(r[2] || '').trim(),
      coilCode: String(r[3] || '').trim(),
      coilName: String(r[4] || '').trim(),
      coilKg: Number(r[5]) || 0,
      // Parsed but unused by this importer — the conversion-document importer
      // reads it. Adding it here keeps ONE interpretation of the sheet.
      rate: Number(r[6]) || 0,
      circlesKg: Number(r[11]) || 0,
      scrapKg: Number(r[12]) || 0,
      yieldRatio: Number(r[13]) || 0,
      // The column the client's own coil formula filters on. Blank = not
      // verified = does NOT leave coil stock.
      verified: String(r[14] || '').trim(),
      // The sheet's 'Actual' column — the date the scrap was checked. Derived
      // there from the verification column; read here so the Scrap module can
      // show WHEN a batch was verified, not just that it was.
      verifiedAt: r[15] instanceof Date ? r[15] : null,
    }));

  // ── Circle Inward ──
  const ciGrid = grid('Circle Inward');
  const circleInward = ciGrid.slice(1).map((r, i) => ({ row: i + 2, r })).filter(({ r }) => r[0])
    .map(({ row, r }) => ({
      row,
      // NOTE: this sheet's headers are inverted — col B is labelled "SKU Code"
      // but holds an item NAME, and col C labelled "Item Name" holds the COIL
      // name. Read positionally, matched by name.
      circleLabel: String(r[1] || '').trim(),
      coilName: String(r[2] || '').trim(),
      pcs: r[3] == null ? null : Number(r[3]),
      kg: r[5] == null ? null : Number(r[5]),
      batchNo: String(r[6] || '').trim(),
      date: r[7],
    }));

  return { master, purchases, conversions, issues, scrap, circleInward };
};

/** Excel's own closing balance per SKU, recomputed from the transaction sheets. */
export const expectedClosing = ({ master, purchases, conversions, issues, scrap, circleInward }) => {
  const byName = (rows, key, val) => rows.reduce((m, x) => {
    const k = up(x[key]); if (!k) return m; m.set(k, r2((m.get(k) || 0) + (Number(x[val]) || 0))); return m;
  }, new Map());

  const purByName = byName(purchases, 'itemName', 'qtyKg');
  const verifiedScrapByName = byName(scrap.filter((s) => s.verified !== ''), 'coilName', 'scrapKg');
  const convOutByName = byName(conversions, 'coilName', 'circleKg');
  const convInByCode = byName(conversions, 'circleCode', 'circlePcs');
  const convInKgByCode = byName(conversions, 'circleCode', 'circleKg');
  const issuesByCode = byName(issues, 'circleCode', 'pcs');

  const out = new Map();
  for (const m of master) {
    if (m.kind === 'COIL') {
      out.set(up(m.code), {
        ...m,
        expected: r2((purByName.get(up(m.name)) || 0) - (verifiedScrapByName.get(up(m.name)) || 0) - (convOutByName.get(up(m.name)) || 0)),
        expectedKg: null,
      });
    } else {
      const inward = circleInward.filter((c) => up(c.circleLabel) === up(m.name) || up(c.circleLabel) === up(m.code));
      const inwardPcs = r2(inward.reduce((s, c) => s + (c.pcs || 0), 0));
      const inwardKg = r2(inward.reduce((s, c) => s + (c.kg || 0), 0));
      out.set(up(m.code), {
        ...m,
        expected: r2((convInByCode.get(up(m.code)) || 0) + inwardPcs - (issuesByCode.get(up(m.code)) || 0)),
        // Recorded weight only — it drifts low because issues carry no weight.
        expectedKg: r2((convInKgByCode.get(up(m.code)) || 0) + inwardKg),
      });
    }
  }
  return out;
};

// ── Main ────────────────────────────────────────────────────────────────────
const run = async () => {
  if (!WORKBOOK || !fs.existsSync(WORKBOOK)) {
    console.error(`Workbook not found. Looked in:\n  ${DEFAULT_FILES.join('\n  ')}\nPass --file "<path>".`);
    process.exit(1);
  }
  const parsed = parseWorkbook(WORKBOOK);
  const { master, purchases, conversions, issues, scrap, circleInward } = parsed;

  await mongoose.connect(env.MONGO_URI);
  console.log('═'.repeat(78));
  console.log(`  RM HISTORICAL IMPORT — ${COMMIT ? 'COMMIT (WILL WRITE)' : 'PREVIEW (writes nothing)'}`);
  console.log(`  workbook : ${path.basename(WORKBOOK)}`);
  console.log(`  database : ${mongoose.connection.name}`);
  console.log('═'.repeat(78));

  // ── 1. SKU master ──
  const dbSkus = await SKU.find({ itemType: { $in: ['RAW_MATERIAL', 'CIRCLE'] }, isDeleted: { $ne: true } })
    .select('code name unit itemType category').lean();
  const dbByCode = new Map(dbSkus.map((s) => [up(s.code), s]));
  const excelCodes = new Set(master.map((m) => up(m.code)));

  const missing = master.filter((m) => !dbByCode.has(up(m.code)));
  const present = master.filter((m) => dbByCode.has(up(m.code)));
  const dbOnly = dbSkus.filter((s) => !excelCodes.has(up(s.code)));

  console.log(`\n── RM MASTER ────────────────────────────────────────────────`);
  console.log(`  Excel SKUs            : ${master.length} (${master.filter((m) => m.kind === 'COIL').length} coil, ${master.filter((m) => m.kind === 'CIRCLE').length} circle)`);
  console.log(`  already in DB         : ${present.length}`);
  console.log(`  MISSING -> to create  : ${missing.length}  ${missing.map((m) => m.code).join(', ') || '—'}`);
  console.log(`  DB-only (QA / out of Excel scope, PRESERVED): ${dbOnly.length}  ${dbOnly.map((s) => s.code).join(', ') || '—'}`);

  if (COMMIT && missing.length) {
    for (const m of missing) {
      await SKU.updateOne(
        { code: m.code },
        {
          $setOnInsert: {
            code: m.code, name: m.name,
            itemType: m.kind === 'CIRCLE' ? 'CIRCLE' : 'RAW_MATERIAL',
            unit: m.kind === 'CIRCLE' ? 'PCS' : 'KGS',
            category: m.category,
          },
        },
        { upsert: true },
      );
    }
    console.log(`  created ${missing.length} SKU master rows.`);
    const refreshed = await SKU.find({ code: { $in: missing.map((m) => m.code) } }).select('code name unit itemType').lean();
    for (const s of refreshed) dbByCode.set(up(s.code), s);
  } else if (missing.length) {
    // PREVIEW must forecast the same outcome a commit would produce. Commit
    // creates these four first, so preview stands in placeholder rows for them
    // — otherwise every movement that references one is reported as unmappable
    // and the reconciliation forecast understates by exactly those rows.
    for (const m of missing) {
      dbByCode.set(up(m.code), {
        _id: `PREVIEW-${m.code}`, code: m.code, name: m.name,
        itemType: m.kind === 'CIRCLE' ? 'CIRCLE' : 'RAW_MATERIAL',
        unit: m.kind === 'CIRCLE' ? 'PCS' : 'KGS',
        __preview: true,
      });
    }
    console.log(`  (preview) treating those ${missing.length} as created, so the forecast matches a commit.`);
  }

  const skuFor = (code) => dbByCode.get(up(code)) || null;

  // ── 2. Build the movement plan ──────────────────────────────────────────
  const plan = [];
  const skipped = [];

  for (const p of purchases) {
    const m = master.find((x) => up(x.name) === up(p.itemName) && x.kind === 'COIL');
    const sku = m && skuFor(m.code);
    if (!sku) { skipped.push({ stream: 'PURCHASE', row: p.row, why: `no RM coil SKU for item name "${p.itemName}"` }); continue; }
    if (!(p.qtyKg > 0)) { skipped.push({ stream: 'PURCHASE', row: p.row, why: 'received quantity is zero' }); continue; }
    plan.push({
      stream: 'PURCHASE', row: p.row, date: p.date, dir: 'IN', sku,
      qty: r2(p.qtyKg), qtyKg: null, txnType: TXN_TYPE.GRN_IN,
      warehouse: p.location || undefined, batchNo: p.batchNo, unitCost: p.rate,
      refType: 'EXCEL_GRN', refNumber: p.grnNo,
      remarks: `Excel import · GRN ${p.grnNo || '—'} · ${p.supplier || 'no supplier'}${p.invoiceQty && p.invoiceQty !== p.qtyKg ? ` · invoice ${p.invoiceQty}` : ''}`,
    });
  }

  for (const c of conversions) {
    const coilM = master.find((x) => up(x.name) === up(c.coilName) && x.kind === 'COIL');
    const coil = coilM && skuFor(coilM.code);
    const circle = skuFor(c.circleCode);
    // The two halves are decided INDEPENDENTLY, because the workbook contains
    // rows where one side cannot be resolved and the other can.
    //
    // Three conversion rows carry a CIRCLE description in the coil-name column
    // ("Cu - 0.8mm - 9.00""), so no coil can be identified. The client's own
    // coil formula matches on that same column and therefore also deducts
    // nothing for them — but their circle output IS counted in the client's
    // circle balance. Dropping the pair would lose real circle stock and leave
    // the circle short by exactly those pieces. So: post whichever half
    // resolves, and report the half that does not.
    if (coil && c.circleKg > 0) {
      // Coil leaves by the WEIGHT of the circles made from it; verified scrap is
      // a separate deduction below. That is precisely the client's arithmetic.
      plan.push({
        stream: 'CONV_OUT', row: c.row, date: c.date, dir: 'OUT', sku: coil,
        qty: r2(c.circleKg), qtyKg: null, txnType: TXN_TYPE.CONVERT_OUT,
        batchNo: c.batchNo, refType: 'EXCEL_CONVERSION', refNumber: c.batchNo,
        remarks: `Excel import · coil cut into ${c.circleCode}`,
      });
    } else if (!coil) {
      skipped.push({ stream: 'CONV_OUT', row: c.row, why: `no coil SKU for "${c.coilName}" — client's sheet deducts nothing for this row either` });
    } else {
      skipped.push({ stream: 'CONV_OUT', row: c.row, why: 'no circle weight recorded, so no coil weight to deduct' });
    }

    if (circle && c.circlePcs > 0) {
      plan.push({
        stream: 'CONV_IN', row: c.row, date: c.date, dir: 'IN', sku: circle,
        // PIECES is the stock quantity; the weight rides alongside. Both come
        // straight from the sheet — neither is derived from the other.
        qty: r2(c.circlePcs), qtyKg: c.circleKg == null ? null : r2(c.circleKg),
        txnType: TXN_TYPE.CONVERT_IN, batchNo: c.batchNo,
        refType: 'EXCEL_CONVERSION', refNumber: c.batchNo,
        remarks: `Excel import · circles cut from ${coilM ? coilM.code : c.coilName}`,
      });
    } else if (!circle) {
      skipped.push({ stream: 'CONV_IN', row: c.row, why: `no circle SKU for "${c.circleCode}"` });
    } else {
      skipped.push({ stream: 'CONV_IN', row: c.row, why: 'no piece count recorded' });
    }
  }

  const verifiedScrap = scrap.filter((s) => s.verified !== '');
  const unverifiedScrap = scrap.filter((s) => s.verified === '');
  for (const s of verifiedScrap) {
    const coilM = master.find((x) => up(x.name) === up(s.coilName) && x.kind === 'COIL');
    const coil = coilM && skuFor(coilM.code);
    if (!coil) { skipped.push({ stream: 'SCRAP', row: s.row, why: `no coil SKU for "${s.coilName}"` }); continue; }
    if (!(s.scrapKg > 0)) { skipped.push({ stream: 'SCRAP', row: s.row, why: 'scrap weight is zero' }); continue; }
    plan.push({
      stream: 'SCRAP', row: s.row, date: s.date, dir: 'OUT', sku: coil,
      qty: r2(s.scrapKg), qtyKg: null, txnType: TXN_TYPE.ADJUST_OUT,
      warehouse: s.location || undefined, batchNo: s.batchNo,
      refType: 'EXCEL_SCRAP', refNumber: s.batchNo,
      remarks: `Excel import · scrap from cutting at ${s.location || 'unknown location'} · verified "${s.verified}"`
        + (s.location === 'JW001' ? ' · job work, scrap not returned as stock' : ''),
    });
  }

  for (const c of circleInward) {
    const m = master.find((x) => (up(x.name) === up(c.circleLabel) || up(x.code) === up(c.circleLabel)) && x.kind === 'CIRCLE');
    const sku = m && skuFor(m.code);
    if (!sku) { skipped.push({ stream: 'CIRCLE_INWARD', row: c.row, why: `no circle SKU for "${c.circleLabel}"` }); continue; }
    if (!(c.pcs > 0)) { skipped.push({ stream: 'CIRCLE_INWARD', row: c.row, why: 'no piece count' }); continue; }
    plan.push({
      stream: 'CIRCLE_INWARD', row: c.row, date: c.date, dir: 'IN', sku,
      qty: r2(c.pcs), qtyKg: c.kg == null ? null : r2(c.kg),
      txnType: TXN_TYPE.ADJUST_IN, batchNo: c.batchNo,
      refType: 'EXCEL_CIRCLE_INWARD', refNumber: c.batchNo,
      remarks: 'Excel import · circles received directly',
    });
  }

  for (const i of issues) {
    const sku = skuFor(i.circleCode);
    if (!sku) { skipped.push({ stream: 'CONSUMPTION', row: i.row, why: `no circle SKU for "${i.circleCode}"` }); continue; }
    if (!(i.pcs > 0)) { skipped.push({ stream: 'CONSUMPTION', row: i.row, why: 'issued quantity is zero' }); continue; }
    plan.push({
      stream: 'CONSUMPTION', row: i.row, date: i.date, dir: 'OUT', sku,
      // Pieces only. The sheet records no weight for an issue and none is made up.
      qty: r2(i.pcs), qtyKg: null, txnType: TXN_TYPE.CONSUME_OUT,
      batchNo: i.batchNo, refType: 'EXCEL_CIRCLE_OUT', refNumber: i.batchNo,
      reason: 'PRODUCTION_ISSUE',
      remarks: 'Excel import · circles issued to production',
    });
  }

  // Chronological, so every balanceAfter on the ledger reads as it happened.
  plan.sort((a, b) => {
    const da = isDate(a.date) ? a.date.getTime() : 0;
    const db = isDate(b.date) ? b.date.getTime() : 0;
    return da - db || a.row - b.row || (a.dir === 'IN' ? -1 : 1);
  });
  for (const p of plan) p.clientRequestId = reqId(p.stream, p.row);

  // ── 3. Duplicate detection ──────────────────────────────────────────────
  const existing = await InventoryMovement.find({ clientRequestId: { $regex: `^${IMPORT_SOURCE}\\|` } })
    .select('clientRequestId').lean();
  const already = new Set(existing.map((m) => m.clientRequestId));
  // CONV_OUT and CONV_IN share a source row, so their ids differ by stream.
  const toWrite = plan.filter((p) => !already.has(p.clientRequestId));
  const duplicates = plan.length - toWrite.length;

  const byStream = (rows) => rows.reduce((m, p) => { m[p.stream] = (m[p.stream] || 0) + 1; return m; }, {});
  console.log(`\n── STREAMS ──────────────────────────────────────────────────`);
  console.log(`  Excel rows read        : purchase(coil) ${purchases.length} · conversions ${conversions.length} · circle issues ${issues.length} · scrap ${scrap.length} · circle inward ${circleInward.length}`);
  console.log(`  planned movements      : ${plan.length}  ${JSON.stringify(byStream(plan))}`);
  console.log(`  already imported (skip): ${duplicates}`);
  console.log(`  TO WRITE               : ${toWrite.length}  ${JSON.stringify(byStream(toWrite))}`);
  console.log(`  unmappable / skipped   : ${skipped.length}`);
  for (const [why, n] of Object.entries(skipped.reduce((m, s) => { m[`${s.stream}: ${s.why}`] = (m[`${s.stream}: ${s.why}`] || 0) + 1; return m; }, {}))) {
    console.log(`      ${n.toString().padStart(4)} × ${why}`);
  }

  console.log(`\n── SCRAP ────────────────────────────────────────────────────`);
  console.log(`  total scrap rows       : ${scrap.length}`);
  console.log(`  VERIFIED (reduces coil): ${verifiedScrap.length}`);
  console.log(`  UNVERIFIED (NOT posted): ${unverifiedScrap.length}  → ${r2(unverifiedScrap.reduce((s, x) => s + x.scrapKg, 0))} kg left in coil stock, exactly as the client's sheet does`);
  const scrapLoc = scrap.reduce((m, s) => { const k = s.location || 'BLANK'; m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log(`  by location            : ${JSON.stringify(scrapLoc)}`);
  console.log(`  JW001                  : job work — coil metal leaves, no scrap inventory item is created`);
  console.log(`  PLG01                  : in-house — same coil deduction; no scrap SKU exists in the workbook to stock`);

  // ── 4. Reconciliation forecast ──────────────────────────────────────────
  const expected = expectedClosing(parsed);
  const stocks = await InventoryStock.find({ skuId: { $in: dbSkus.map((s) => s._id) } }).lean();
  const preBy = new Map();
  for (const s of stocks) {
    const k = String(s.skuId);
    const c = preBy.get(k) || { pcs: 0, kg: 0 };
    c.pcs = r2(c.pcs + (s.qtyOnHand || 0)); c.kg = r2(c.kg + (s.qtyOnHandKg || 0)); preBy.set(k, c);
  }
  // What this import alone contributes per SKU.
  const delta = new Map();
  for (const p of plan) {
    const k = String(p.sku._id);
    const c = delta.get(k) || { pcs: 0, kg: 0 };
    c.pcs = r2(c.pcs + (p.dir === 'IN' ? p.qty : -p.qty));
    if (p.qtyKg != null) c.kg = r2(c.kg + (p.dir === 'IN' ? p.qtyKg : -p.qtyKg));
    delta.set(k, c);
  }

  console.log(`\n── RECONCILIATION FORECAST (Excel closing vs what the import produces) ──`);
  console.log('  SKU                 kind    Excel close   import gives   pre-existing      app total   diff   status');
  let exact = 0; let off = 0;
  const offRows = [];
  for (const m of master) {
    const sku = skuFor(m.code);
    const e = expected.get(up(m.code));
    const d = sku ? (delta.get(String(sku._id)) || { pcs: 0, kg: 0 }) : { pcs: 0, kg: 0 };
    const pre = sku ? (preBy.get(String(sku._id)) || { pcs: 0, kg: 0 }) : { pcs: 0, kg: 0 };
    const appTotal = r2(pre.pcs + d.pcs);
    const diff = r2(d.pcs - e.expected);            // import vs Excel, excluding pre-existing
    if (Math.abs(diff) < 0.01) exact += 1; else { off += 1; offRows.push({ m, e, d, pre, diff }); }
    const flag = Math.abs(diff) < 0.01 ? (pre.pcs ? 'EXACT (+pre-existing)' : 'EXACT') : 'MISMATCH';
    console.log(`  ${m.code.padEnd(18)} ${m.kind.padEnd(7)} ${String(e.expected).padStart(11)} ${String(d.pcs).padStart(14)} ${String(pre.pcs).padStart(14)} ${String(appTotal).padStart(14)} ${String(diff).padStart(6)}   ${flag}`);
  }
  console.log(`\n  EXACT: ${exact} / ${master.length}     MISMATCH: ${off}`);
  if (offRows.length) {
    console.log('  mismatches needing explanation:');
    for (const x of offRows) console.log(`    ${x.m.code}  excel=${x.e.expected}  import=${x.d.pcs}  diff=${x.diff}`);
  }
  const preNonExcel = master.map((m) => ({ m, pre: skuFor(m.code) ? (preBy.get(String(skuFor(m.code)._id)) || { pcs: 0 }) : { pcs: 0 } })).filter((x) => x.pre.pcs);
  if (preNonExcel.length) {
    console.log(`\n  NOTE — ${preNonExcel.length} Excel SKU(s) already hold stock the workbook does not account for:`);
    for (const x of preNonExcel) console.log(`    ${x.m.code}: ${x.pre.pcs} pre-existing (app-era GRN, not in the workbook — left untouched)`);
  }
  const negatives = master.filter((m) => expected.get(up(m.code)).expected < 0);
  if (negatives.length) {
    console.log(`\n  NEGATIVE closing balances present in the client's own sheet (reproduced, NOT corrected):`);
    for (const m of negatives) console.log(`    ${m.code}: ${expected.get(up(m.code)).expected}`);
  }

  // ── 5. Policies ─────────────────────────────────────────────────────────
  const existingPolicies = await InventoryPolicy.find({ isDeleted: { $ne: true } }).select('skuId skuCode').lean();
  const polBy = new Set(existingPolicies.map((p) => up(p.skuCode)));
  const polToCreate = master.filter((m) => skuFor(m.code) && !polBy.has(up(m.code)));
  const polNoSF = master.filter((m) => m.safetyFactor == null || m.leadDays == null);
  console.log(`\n── INVENTORY POLICY ─────────────────────────────────────────`);
  console.log(`  Excel rows with planning data : ${master.length}`);
  console.log(`  policies already in DB        : ${master.filter((m) => polBy.has(up(m.code))).length}`);
  console.log(`  TO CREATE                     : ${polToCreate.length}`);
  console.log(`  rows missing lead time or SF  : ${polNoSF.length}  ${polNoSF.map((m) => m.code).join(', ') || '—'}`);
  const sfVals = [...new Set(master.map((m) => m.safetyFactor).filter((v) => v != null))];
  const leadVals = [...new Set(master.map((m) => m.leadDays).filter((v) => v != null))];
  console.log(`  Safety Factor values in Excel : ${sfVals.join(', ')}   (app rule 1.0–5.0 step 0.1)`);
  console.log(`  Lead Time values in Excel     : ${leadVals.join(', ')}`);
  const sfBad = sfVals.filter((v) => v < 1 || v > 5 || Math.abs(v / 0.1 - Math.round(v / 0.1)) > 1e-6);
  console.log(`  Safety Factors OUTSIDE the app rule: ${sfBad.length ? sfBad.join(', ') : 'none'}`);

  if (!COMMIT) {
    console.log(`\n${'═'.repeat(78)}`);
    console.log('  PREVIEW ONLY — nothing was written. Re-run with --commit to apply.');
    console.log('═'.repeat(78));
    await mongoose.disconnect();
    return;
  }

  // ── 6. COMMIT ───────────────────────────────────────────────────────────
  console.log(`\n── WRITING ──────────────────────────────────────────────────`);
  if (polToCreate.length) {
    for (const m of polToCreate) {
      const sku = skuFor(m.code);
      await InventoryPolicy.updateOne(
        { skuId: sku._id },
        {
          $setOnInsert: {
            skuId: sku._id, skuCode: sku.code, skuName: sku.name,
            itemType: sku.itemType, unit: sku.unit,
            category: m.category,
            // Only what the sheet actually states. A blank stays a schema
            // default — nothing is invented to fill a gap.
            ...(m.adcLow != null ? { adcLow: m.adcLow } : {}),
            ...(m.adcNormal != null ? { adcNormal: m.adcNormal } : {}),
            ...(m.adcPeak != null ? { adcPeak: m.adcPeak } : {}),
            ...(m.consumptionMode ? { consumptionMode: m.consumptionMode } : {}),
            ...(m.leadDays != null ? { leadDays: m.leadDays } : {}),
            ...(m.safetyFactor != null ? { safetyFactor: m.safetyFactor } : {}),
            ...(m.moq != null ? { moq: m.moq } : {}),
            ...(m.rate != null ? { rate: m.rate } : {}),
            ...(m.vendorName ? { vendorName: m.vendorName } : {}),
            // Max Level follows ADC × Lead × SF; the sheet's own value matches
            // that formula, so the row stays AUTO rather than freezing a number.
            maxLevelMode: 'AUTO',
            remarks: `Imported from ${IMPORT_SOURCE}`,
          },
        },
        { upsert: true },
      );
    }
    console.log(`  policies created : ${polToCreate.length}`);
  }

  let written = 0; let failed = 0;
  const conversionDocs = new Map();
  for (const p of toWrite) {
    const base = {
      skuId: p.sku._id, skuCode: p.sku.code, skuName: p.sku.name, unit: p.sku.unit,
      quantity: p.qty, quantityKg: p.qtyKg ?? undefined,
      warehouse: p.warehouse, batchNo: p.batchNo || '',
      txnType: p.txnType, sourceModule: IMPORT_SOURCE,
      refType: p.refType, refNumber: p.refNumber || '',
      reason: p.reason, remarks: p.remarks,
      movementDate: isDate(p.date) ? p.date : new Date(),
      clientRequestId: p.clientRequestId,
      unitCost: p.unitCost || 0,
    };
    try {
      // allowNegative: the client's own history dips below zero for three
      // circles. Reproducing it faithfully is the requirement; blocking it
      // would silently drop their data.
      if (p.dir === 'IN') await inventoryService.increaseStock(base);
      else await inventoryService.decreaseStock(base, { allowNegative: true });
      written += 1;
      if (written % 250 === 0) console.log(`    … ${written}/${toWrite.length}`);
    } catch (e) {
      failed += 1;
      console.error(`    FAILED ${p.stream} row ${p.row} (${p.sku.code}): ${e.message}`);
    }
  }
  console.log(`  movements written : ${written}   failed : ${failed}`);

  // ── 7. Post-commit reconciliation ───────────────────────────────────────
  const after = await InventoryStock.find({ skuId: { $in: [...dbByCode.values()].map((s) => s._id) } }).lean();
  const afterBy = new Map();
  for (const s of after) {
    const k = String(s.skuId);
    const c = afterBy.get(k) || { pcs: 0, kg: 0 };
    c.pcs = r2(c.pcs + (s.qtyOnHand || 0)); c.kg = r2(c.kg + (s.qtyOnHandKg || 0)); afterBy.set(k, c);
  }
  // The AUTHORITATIVE target is the client's own "Total Available Quantity"
  // column — not this script's reconstruction of it. Both are shown, because
  // where they disagree the disagreement is itself the finding.
  console.log(`\n── FINAL RECONCILIATION (app stock vs the client's Total Available column) ──`);
  console.log('  SKU                 kind   sheet col   rebuilt    app stock   pre-exist       diff   status');
  let fExact = 0; let fOff = 0;
  const notes = [];
  for (const m of master) {
    const sku = skuFor(m.code);
    const e = expected.get(up(m.code));
    const a = sku ? (afterBy.get(String(sku._id)) || { pcs: 0, kg: 0 }) : { pcs: 0, kg: 0 };
    const pre = sku ? (preBy.get(String(sku._id)) || { pcs: 0 }) : { pcs: 0 };
    const sheet = r2(m.totalAvailable || 0);
    const diff = r2(a.pcs - pre.pcs - sheet);
    if (Math.abs(diff) < 0.01) fExact += 1; else fOff += 1;
    if (Math.abs(r2(e.expected - sheet)) >= 0.01) {
      notes.push(`    ${m.code}: sheet column ${sheet}, rebuilt from its transaction sheets ${e.expected} (difference ${r2(e.expected - sheet)})`);
    }
    console.log(`  ${m.code.padEnd(18)} ${m.kind.padEnd(6)} ${String(sheet).padStart(9)} ${String(e.expected).padStart(9)} ${String(a.pcs).padStart(12)} ${String(pre.pcs).padStart(11)} ${String(diff).padStart(10)}   ${Math.abs(diff) < 0.01 ? 'EXACT' : 'MISMATCH'}`);
  }
  console.log(`\n  EXACT: ${fExact} / ${master.length}   MISMATCH: ${fOff}`);
  if (notes.length) {
    console.log(`\n  WHERE THE CLIENT'S OWN SHEET DISAGREES WITH ITS OWN TRANSACTIONS:`);
    notes.forEach((n) => console.log(n));
    console.log(`    Cause: the Circle Inward sheet's headers are inverted — column B is`);
    console.log(`    labelled "SKU Code" but holds an item NAME, and column C labelled`);
    console.log(`    "Item Name" holds the COIL name. The sheet's circle formula matches on`);
    console.log(`    column C, so it attributes that inward to no circle at all and drops it.`);
    console.log(`    The receipt is real, so it IS imported. CLIENT CONFIRMATION REQUIRED.`);
  }
  console.log('═'.repeat(78));
  await mongoose.disconnect();
};

// Only run when invoked directly, so the parser can be imported by tests.
if (process.argv[1] && process.argv[1].endsWith('importRmExcelHistory.js')) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
