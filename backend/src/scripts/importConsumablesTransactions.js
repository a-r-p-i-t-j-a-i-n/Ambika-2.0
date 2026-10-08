/**
 * Consumables & Packing — complete historical stock reconstruction.
 *
 *   Source : excel/"IMS - Consumable & Packing 24-25.xlsx"
 *   Writes : InventoryMovement (+ the InventoryStock balance it maintains)
 *
 * ── WHY ALL FIVE SOURCES ────────────────────────────────────────────────────
 * An earlier version imported only "InOut (Manual)" and its preview showed 112
 * of 139 SKUs finishing below zero — that sheet holds the manual entries, while
 * most receipts live in "Purchase". The workbook's five streams relate like so,
 * proven by exact row arithmetic rather than assumption:
 *
 *     Total In  (5,373)  = InOut "In"  (1,104) + Purchase (4,269)
 *     Total Out (27,188) = InOut "Out" (7,238) + Out Form (19,950)
 *
 * "Total In" and "Total Out" are therefore ROLL-UPS and are never read — doing
 * so would double count. The five primary streams below, plus the Opening Stock
 * column, reproduce the client's own Closing Stock for 161 of 168 SKUs.
 *
 * ── MOVEMENT TYPES — every one traced to code that already exists ───────────
 *   Opening Stock  → OPENING     ims.service.js:595 posts OPENING for reason
 *                                OPENING_STOCK; seed_ims_consumable_packaging
 *                                uses refType IMS_OPENING. Matched here.
 *   InOut "In"     → ADJUST_IN   ims.service.js:595 — any non-opening Stock In.
 *                                NOT GRN_IN: purchases are their own stream.
 *   InOut "Out"    → CONSUME_OUT ims.service.js:675 — every Stock Out.
 *     …remarked "Adjustment"
 *                  → ADJUST_OUT  ims.validation warns a correction posted as
 *                                consumption "would quietly inflate every
 *                                reorder level built on ADC".
 *   Purchase       → GRN_IN      The sheet's own column is "GRN Date", and
 *                                rmIms.service.js:1250 already posts GRN_IN for
 *                                Excel-sourced historical receipts.
 *   Out Form       → CONSUME_OUT The shop-floor issue form. Same thing the
 *                                Stock Out screen records, captured on paper.
 *
 * ── THE COMMIT GATE ─────────────────────────────────────────────────────────
 * A SKU is committed ONLY when its reconstructed balance equals the workbook's
 * own Closing Stock. Anything that does not reconcile is held back and listed.
 * No balancing entry is ever invented to force a match.
 *
 * Preview is the default. Idempotent: every movement carries a deterministic
 * clientRequestId, and rows already posted are skipped.
 *
 * USAGE
 *   npm run import:consumables                      # preview
 *   npm run import:consumables -- --commit
 *   npm run import:consumables -- --full            # untruncated tables
 */
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import XLSX from 'xlsx';

import env from '../config/env.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import InventoryMovement, { TXN_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import { inventoryService } from '../modules/inventory/inventory.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const IMPORT_SOURCE = 'EXCEL_CP_24_25';
const WAREHOUSE = 'MAIN';
const TOLERANCE = 1;            // whole units; the sheet itself rounds

const DEFAULT_FILES = [
  path.resolve(__dirname, '../../../excel/IMS - Consumable & Packing 24-25.xlsx'),
  path.resolve(__dirname, '../../excel/IMS - Consumable & Packing 24-25.xlsx'),
];

const s = (v) => (v === null || v === undefined ? '' : String(v).trim());
const up = (v) => s(v).toUpperCase();
const nm = (v) => s(v).toLowerCase().replace(/\s+/g, ' ');
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const n0 = (v) => Number(v || 0).toLocaleString('en-IN');
const qty = (v) => {
  const n = Number(s(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

/** DD/MM/YYYY — proven: 5,035 rows have a first part above 12, none a second part above 12. */
const parseDate = (v) => {
  const t = s(v);
  const m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (m) {
    let y = Number(m[3]); if (y < 100) y += 2000;
    const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[1])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Some rows carry a raw Excel serial instead of a formatted date.
  const serial = Number(t);
  if (Number.isFinite(serial) && serial > 20000 && serial < 60000) {
    return new Date(Date.UTC(1899, 11, 30).valueOf() + serial * 86400000);
  }
  return null;
};

const reqId = (stream, row) => `${IMPORT_SOURCE}|${stream}|${row}`;

// ── Parse ──────────────────────────────────────────────────────────────────────
export const parseWorkbook = (filePath) => {
  const wb = XLSX.readFile(filePath, { raw: false });
  const J = (n) => (wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null, raw: false }) : []);

  const itemList = J('Item List');
  const imsSheet = J('IMS');

  // The workbook's OWN code↔name pairing. Used to resolve the name-keyed sheets
  // instead of matching names against the SKU master, which would be guesswork.
  const nameToCode = new Map();
  const ambiguousNames = new Map();
  const meta = new Map();          // code → { name, opening }
  for (const r of itemList) {
    const code = up(r['SKU Code']); if (!code) continue;
    const name = nm(r['Item Name']);
    if (!meta.has(code)) meta.set(code, { name: s(r['Item Name']), opening: qty(r['Opening Stock']) || 0, category: s(r.Category) });
    if (!name) continue;
    if (nameToCode.has(name) && nameToCode.get(name) !== code) {
      if (!ambiguousNames.has(name)) ambiguousNames.set(name, new Set([nameToCode.get(name)]));
      ambiguousNames.get(name).add(code);
    } else nameToCode.set(name, code);
  }
  for (const n of ambiguousNames.keys()) nameToCode.delete(n);   // never guess

  const closing = new Map();
  for (const r of imsSheet) {
    const code = up(r['SKU Code']);
    if (code && !closing.has(code)) closing.set(code, qty(r['Closing Stock']) || 0);
  }

  const txns = [];
  const problems = { noDirection: 0, badQty: 0, badDate: 0, blank: 0 };
  const unresolved = new Map();    // key → { stream, name/code, rows, reason }
  const ambiguousRows = [];

  const flagUnresolved = (key, stream, label, reason) => {
    const k = `${stream}|${key}`;
    if (!unresolved.has(k)) unresolved.set(k, { stream, label, reason, rows: 0, qty: 0 });
    return unresolved.get(k);
  };

  // 1) InOut (Manual) — keyed by SKU CODE, with a codeless tail keyed by name.
  J('InOut (Manual)').forEach((r, i) => {
    const row = i + 2;
    const dir = s(r['In/Out']).toLowerCase();
    const rawQty = s(r.Quantity);
    const code = up(r.SKU);
    const name = nm(r['Item  Name'] ?? r['Item Name']);
    const remark = s(r.__EMPTY);

    if (!code && !dir && !rawQty && !s(r.Date)) { problems.blank += 1; return; }
    if (dir !== 'in' && dir !== 'out') { problems.noDirection += 1; return; }
    const q = qty(rawQty);
    if (!Number.isFinite(q) || q <= 0) { problems.badQty += 1; return; }
    const date = parseDate(r.Date);
    if (!date) { problems.badDate += 1; return; }

    // Row 7291 and friends: the source does not say what they are.
    if (/reject|return/i.test(remark)) {
      ambiguousRows.push({ row, code: code || name, dir, q, remark });
      return;
    }

    let resolved = code;
    if (!resolved) {
      // Codeless rows — resolve ONLY by an exact, unambiguous workbook name.
      resolved = nameToCode.get(name) || '';
      if (!resolved) {
        const e = flagUnresolved(name || '(blank)', 'InOut', s(r['Item  Name']) || '(blank)',
          ambiguousNames.has(name) ? `name maps to ${[...ambiguousNames.get(name)].join(' / ')}` : 'no exact name match');
        e.rows += 1; e.qty += q; return;
      }
    }

    const isIn = dir === 'in';
    const isAdj = /adjust/i.test(remark);
    txns.push({
      stream: isIn ? 'ManualIn' : 'ManualOut',
      row, code: resolved, q, date, remark, isIn,
      txnType: isIn ? TXN_TYPE.ADJUST_IN : (isAdj ? TXN_TYPE.ADJUST_OUT : TXN_TYPE.CONSUME_OUT),
      clientRequestId: reqId('inout', row),
    });
  });

  // 2) Purchase — goods receipts, keyed by item NAME.
  J('Purchase').forEach((r, i) => {
    const row = i + 2;
    const name = nm(r['Item Name']);
    const q = qty(r['Material Stored']);
    const date = parseDate(r['GRN Date']);
    if (!name && !Number.isFinite(q)) { problems.blank += 1; return; }
    if (!Number.isFinite(q) || q <= 0) { problems.badQty += 1; return; }
    if (!date) { problems.badDate += 1; return; }
    const code = nameToCode.get(name);
    if (!code) {
      const e = flagUnresolved(name || '(blank)', 'Purchase', s(r['Item Name']) || '(blank)',
        ambiguousNames.has(name) ? 'name maps to several codes' : 'no exact name match');
      e.rows += 1; e.qty += q; return;
    }
    txns.push({ stream: 'PurchaseIn', row, code, q, date, isIn: true, txnType: TXN_TYPE.GRN_IN, clientRequestId: reqId('purchase', row) });
  });

  // 3) Out Form — the shop-floor issue form, keyed by item NAME.
  J('Out Form').forEach((r, i) => {
    const row = i + 2;
    const name = nm(r.SKU);
    const q = qty(r.Quantity);
    const date = parseDate(r.Date);
    if (!name && !Number.isFinite(q)) { problems.blank += 1; return; }
    if (!Number.isFinite(q) || q <= 0) { problems.badQty += 1; return; }
    if (!date) { problems.badDate += 1; return; }
    const code = nameToCode.get(name);
    if (!code) {
      const e = flagUnresolved(name || '(blank)', 'OutForm', s(r.SKU) || '(blank)',
        ambiguousNames.has(name) ? 'name maps to several codes' : 'no exact name match');
      e.rows += 1; e.qty += q; return;
    }
    txns.push({ stream: 'OutFormOut', row, code, q, date, isIn: false, txnType: TXN_TYPE.CONSUME_OUT, clientRequestId: reqId('outform', row) });
  });

  return { meta, closing, txns, problems, unresolved, ambiguousRows, ambiguousNames, nameToCode };
};

/** Opening + ManualIn + PurchaseIn − ManualOut − OutFormOut, per SKU. */
export const reconcile = ({ meta, closing, txns }) => {
  const acc = new Map();
  const get = (code) => {
    if (!acc.has(code)) {
      acc.set(code, {
        code, name: meta.get(code)?.name || '', opening: meta.get(code)?.opening ?? null,
        ManualIn: 0, PurchaseIn: 0, ManualOut: 0, OutFormOut: 0,
      });
    }
    return acc.get(code);
  };
  for (const code of meta.keys()) get(code);
  for (const t of txns) get(t.code)[t.stream] += t.q;

  for (const e of acc.values()) {
    const open = e.opening ?? 0;
    e.expected = r2(open + e.ManualIn + e.PurchaseIn - e.ManualOut - e.OutFormOut);
    e.excelClosing = closing.has(e.code) ? closing.get(e.code) : null;
    if (e.excelClosing === null) { e.status = 'MISSING DATA'; e.diff = null; }
    else {
      e.diff = r2(e.expected - e.excelClosing);
      e.status = Math.abs(e.diff) < TOLERANCE ? 'MATCH' : 'MISMATCH';
    }
  }
  return acc;
};

// ── Report ─────────────────────────────────────────────────────────────────────
const line = (c = '─') => console.log(c.repeat(110));
const head = (t) => { line('═'); console.log(t); line('═'); };

const run = async () => {
  const argv = process.argv.slice(2);
  const doCommit = argv.includes('--commit');
  const full = argv.includes('--full');
  const fi = argv.indexOf('--file');
  const filePath = fi !== -1 ? path.resolve(argv[fi + 1]) : DEFAULT_FILES.find((f) => fs.existsSync(f));
  if (!filePath || !fs.existsSync(filePath)) { console.error('Workbook not found.'); process.exit(1); }

  head('CONSUMABLES & PACKING — HISTORICAL STOCK RECONSTRUCTION');
  console.log(`  File : ${filePath}`);
  console.log(`  Mode : ${doCommit ? 'COMMIT — reconciled SKUs will be written' : 'PREVIEW — nothing will be written'}`);

  const parsed = parseWorkbook(filePath);
  const { meta, txns, problems, unresolved, ambiguousRows } = parsed;
  const recon = reconcile(parsed);

  await mongoose.connect(env.MONGO_URI);
  try {
    const skus = await SKU.find({ isDeleted: { $ne: true } }).select('_id code name unit itemType').lean();
    const byCode = new Map(skus.map((k) => [up(k.code), k]));

    // ── Transaction totals ─────────────────────────────────────
    head('1. TRANSACTION TOTALS');
    const cnt = (st) => txns.filter((t) => t.stream === st).length;
    const sum = (st) => r2(txns.filter((t) => t.stream === st).reduce((a, t) => a + t.q, 0));
    const openingRows = [...meta.values()].filter((m) => m.opening > 0).length;
    console.log(`  Opening Stock rows (qty > 0)   : ${String(n0(openingRows)).padStart(8)}`);
    console.log(`  Manual In      → ADJUST_IN     : ${String(n0(cnt('ManualIn'))).padStart(8)}   qty ${n0(sum('ManualIn'))}`);
    console.log(`  Purchase       → GRN_IN        : ${String(n0(cnt('PurchaseIn'))).padStart(8)}   qty ${n0(sum('PurchaseIn'))}`);
    console.log(`  Manual Out     → CONSUME_OUT   : ${String(n0(txns.filter((t) => t.stream === 'ManualOut' && t.txnType === TXN_TYPE.CONSUME_OUT).length)).padStart(8)}`);
    console.log(`     of which    → ADJUST_OUT    : ${String(n0(txns.filter((t) => t.txnType === TXN_TYPE.ADJUST_OUT).length)).padStart(8)}   (remarked "Adjustment")`);
    console.log(`  Out Form       → CONSUME_OUT   : ${String(n0(cnt('OutFormOut'))).padStart(8)}   qty ${n0(sum('OutFormOut'))}`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  Resolved transactions          : ${String(n0(txns.length)).padStart(8)}`);
    const unrRows = [...unresolved.values()].reduce((a, u) => a + u.rows, 0);
    console.log(`  Unresolved (no exact SKU match): ${String(n0(unrRows)).padStart(8)}   across ${unresolved.size} name(s)`);
    console.log(`  Ambiguous purpose (excluded)   : ${String(n0(ambiguousRows.length)).padStart(8)}`);
    console.log(`  Rejected rows  blank ${problems.blank} · no direction ${problems.noDirection} · bad qty ${problems.badQty} · bad date ${problems.badDate}`);

    // ── Per-SKU reconciliation ─────────────────────────────────
    head('2. PER-SKU RECONCILIATION   (Opening + ManualIn + PurchaseIn − ManualOut − OutFormOut)');
    const all = [...recon.values()];
    for (const e of all) if (!byCode.has(e.code)) e.status = 'UNMATCHED';

    /**
     * The workbook's Closing Stock describes a store that starts empty. A SKU
     * that ALREADY holds stock — someone has used the app — would finish at
     * "closing + what is already there", which is simply wrong. Since inventing
     * a balancing entry is not allowed, such a SKU is held back instead.
     */
    const liveIds = all.filter((e) => byCode.has(e.code)).map((e) => byCode.get(e.code)._id);
    const priorStock = await InventoryStock.find({ skuId: { $in: liveIds }, isDeleted: { $ne: true } })
      .select('skuId qtyOnHand').lean();
    const priorMoves = await InventoryMovement.aggregate([
      { $match: { skuId: { $in: liveIds }, isDeleted: { $ne: true }, clientRequestId: { $not: { $regex: `^${IMPORT_SOURCE}\\|` } } } },
      { $group: { _id: '$skuId', n: { $sum: 1 } } },
    ]);
    const onHandBy = new Map();
    priorStock.forEach((r) => onHandBy.set(String(r.skuId), (onHandBy.get(String(r.skuId)) || 0) + (r.qtyOnHand || 0)));
    const movesBy = new Map(priorMoves.map((r) => [String(r._id), r.n]));
    // A SKU this importer has already posted is "imported", not "prior stock" —
    // the balance it now holds is the one this script put there. Without this,
    // a second run reclassifies its own work as somebody else's stock.
    const importedIds = new Set((await InventoryMovement
      .distinct('skuId', { clientRequestId: { $regex: `^${IMPORT_SOURCE}\\|` } })).map(String));

    for (const e of all) {
      if (e.status !== 'MATCH') continue;
      const id = String(byCode.get(e.code)._id);
      if (importedIds.has(id)) { e.status = 'ALREADY IMPORTED'; continue; }
      e.priorOnHand = r2(onHandBy.get(id) || 0);
      e.priorMoves = movesBy.get(id) || 0;
      if (e.priorOnHand !== 0 || e.priorMoves > 0) e.status = 'HAS PRIOR STOCK';
    }

    const order = { MISMATCH: 0, UNMATCHED: 1, 'HAS PRIOR STOCK': 2, 'MISSING DATA': 3, MATCH: 4, 'ALREADY IMPORTED': 5 };
    all.sort((a, b) => (order[a.status] - order[b.status]) || Math.abs(b.diff || 0) - Math.abs(a.diff || 0));

    console.log('  SKU            Opening   ManIn   PurIn  ManOut  FormOut   Expected    Excel      Diff  Status');
    line();
    const shown = full ? all : all.filter((e) => e.status !== 'MATCH' && e.status !== 'ALREADY IMPORTED').concat(all.filter((e) => e.status === 'MATCH').slice(0, 6));
    shown.forEach((e) => {
      console.log(`  ${e.code.padEnd(14)}${String(n0(e.opening ?? 0)).padStart(8)}${String(n0(e.ManualIn)).padStart(8)}${String(n0(e.PurchaseIn)).padStart(8)}${String(n0(e.ManualOut)).padStart(8)}${String(n0(e.OutFormOut)).padStart(9)}${String(n0(e.expected)).padStart(11)}${String(e.excelClosing === null ? '—' : n0(e.excelClosing)).padStart(9)}${String(e.diff === null ? '—' : n0(e.diff)).padStart(10)}  ${e.status}`);
    });
    if (!full && all.length > shown.length) console.log(`  … ${all.length - shown.length} more MATCH rows hidden — pass --full`);

    // ── SKU totals ─────────────────────────────────────────────
    head('3. SKU TOTALS');
    const by = (st) => all.filter((e) => e.status === st).length;
    console.log(`  SKUs in the workbook           : ${String(all.length).padStart(5)}`);
    console.log(`  Matched to a SKU Master record : ${String(all.filter((e) => byCode.has(e.code)).length).padStart(5)}`);
    console.log(`  UNMATCHED (no master record)   : ${String(by('UNMATCHED')).padStart(5)}`);
    console.log(`  MATCH     (reconciles exactly) : ${String(by('MATCH')).padStart(5)}   ← eligible to commit`);
    console.log(`  MISMATCH  (does not reconcile) : ${String(by('MISMATCH')).padStart(5)}   ← held back`);
    console.log(`  HAS PRIOR STOCK                : ${String(by('HAS PRIOR STOCK')).padStart(5)}   ← held back, see below`);
    console.log(`  MISSING DATA (no Closing Stock): ${String(by('MISSING DATA')).padStart(5)}   ← held back`);
    console.log(`  ALREADY IMPORTED               : ${String(by('ALREADY IMPORTED')).padStart(5)}   ← posted by a previous run`);

    const prior = all.filter((e) => e.status === 'HAS PRIOR STOCK');
    if (prior.length) {
      console.log(`\n  These ${prior.length} reconcile against the workbook, but the item already holds stock in`);
      console.log('  the app, so replaying the history would land it at "closing + what is already');
      console.log('  there". Clearing that stock first, or excluding these items, is a decision for you.\n');
      console.log('  SKU            already on hand   prior entries   would end at   should be');
      line();
      prior.forEach((e) => console.log(`  ${e.code.padEnd(14)}${String(n0(e.priorOnHand)).padStart(16)}${String(e.priorMoves).padStart(16)}${String(n0(r2(e.priorOnHand + e.excelClosing))).padStart(15)}${String(n0(e.excelClosing)).padStart(12)}`));
    }

    // ── Exceptions ─────────────────────────────────────────────
    head('4. EXCEPTIONS — reported, never guessed, never auto-created');
    if (unresolved.size) {
      console.log(`  Item names with no exact SKU match (${unresolved.size}):\n`);
      console.log('  Stream     Item name                                        Rows      Qty   Why');
      line();
      [...unresolved.values()].sort((a, b) => b.rows - a.rows).slice(0, full ? 999 : 12)
        .forEach((u) => console.log(`  ${u.stream.padEnd(10)} ${u.label.slice(0, 46).padEnd(47)} ${String(u.rows).padStart(5)} ${String(n0(u.qty)).padStart(8)}   ${u.reason}`));
    }
    if (ambiguousRows.length) {
      console.log(`\n  Rows whose purpose the source does not state (${ambiguousRows.length}) — excluded from commit:`);
      ambiguousRows.forEach((a) => console.log(`     row ${a.row}  ${a.code}  ${a.dir} ${a.q}  remark: "${a.remark}"`));
    }
    const noMaster = all.filter((e) => e.status === 'UNMATCHED');
    if (noMaster.length) {
      console.log(`\n  Workbook SKU codes with no SKU Master record (${noMaster.length}) — NOT created:`);
      noMaster.forEach((e) => console.log(`     ${e.code.padEnd(14)} ${e.name}`));
    }

    // ── Commit ─────────────────────────────────────────────────
    const committable = new Set(all.filter((e) => e.status === 'MATCH').map((e) => e.code));
    const eligible = txns.filter((t) => committable.has(t.code));
    const existing = await InventoryMovement.find({ clientRequestId: { $regex: `^${IMPORT_SOURCE}\\|` } }).select('clientRequestId').lean();
    const already = new Set(existing.map((m) => m.clientRequestId));
    const toWrite = eligible.filter((t) => !already.has(t.clientRequestId));

    head('5. COMMIT PLAN');
    console.log(`  SKUs passing the reconciliation gate : ${committable.size}`);
    console.log(`  Their transactions                   : ${n0(eligible.length)}`);
    console.log(`  Already posted (skipped)             : ${n0(eligible.length - toWrite.length)}`);
    console.log(`  Opening movements to post            : ${[...committable].filter((c) => (meta.get(c)?.opening || 0) > 0).length}`);
    console.log(`  Movements to post                    : ${n0(toWrite.length)}`);
    console.log(`\n  Transactions belonging to SKUs that did NOT reconcile : ${n0(txns.length - eligible.length)} — withheld.`);
    console.log('  No balancing entry is invented for them. They stay out until the source is fixed.');

    if (!doCommit) {
      head('PREVIEW ONLY — nothing was written. Re-run with --commit to post the reconciled SKUs.');
      return;
    }

    head('COMMITTING');
    let posted = 0; let failed = 0; const errs = [];
    // Opening first, then the rest in date order, so each balance builds as it really did.
    for (const code of committable) {
      const open = meta.get(code)?.opening || 0;
      if (open <= 0) continue;
      const sku = byCode.get(code);
      const key = reqId('opening', code);
      if (already.has(key)) continue;
      const dup = await InventoryMovement.findOne({ skuId: sku._id, txnType: TXN_TYPE.OPENING, sourceModule: 'IMS', isDeleted: { $ne: true } }).select('_id').lean();
      if (dup) continue;
      try {
        await inventoryService.increaseStock({
          skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: sku.unit || 'PCS',
          quantity: open, warehouse: WAREHOUSE,
          txnType: TXN_TYPE.OPENING, sourceModule: 'IMS', refType: 'IMS_OPENING',
          remarks: 'Opening stock (Excel history import)', clientRequestId: key,
        });
        posted += 1;
      } catch (e) { failed += 1; if (errs.length < 10) errs.push(`opening ${code}: ${e.message}`); }
    }

    const ordered = [...toWrite].sort((a, b) => a.date - b.date || a.row - b.row);
    for (const t of ordered) {
      const sku = byCode.get(t.code);
      const common = {
        skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: sku.unit || 'PCS',
        quantity: t.q, warehouse: WAREHOUSE, txnType: t.txnType, sourceModule: 'IMS',
        refType: 'EXCEL_IMPORT', refNumber: `${t.stream} row ${t.row}`,
        remarks: [t.remark, 'Excel history import'].filter(Boolean).join(' · '),
        movementDate: t.date, clientRequestId: t.clientRequestId,
      };
      try {
        if (t.isIn) await inventoryService.increaseStock(common);
        // A replay of two years of history must not stop on an interim dip.
        else await inventoryService.decreaseStock(common, { allowNegative: true });
        posted += 1;
        if (posted % 1000 === 0) console.log(`  … ${n0(posted)} posted`);
      } catch (e) { failed += 1; if (errs.length < 10) errs.push(`${t.stream} row ${t.row} ${t.code}: ${e.message}`); }
    }
    console.log(`\n  posted : ${n0(posted)}`);
    console.log(`  failed : ${n0(failed)}`);
    errs.forEach((e) => console.log('     ' + e));

    // Prove it landed where the workbook says it should.
    head('POST-COMMIT VERIFICATION');
    let ok = 0; let off = 0;
    for (const code of committable) {
      const sku = byCode.get(code);
      const st = await InventoryStock.find({ skuId: sku._id, isDeleted: { $ne: true } }).select('qtyOnHand').lean();
      const onHand = r2(st.reduce((a, r) => a + (r.qtyOnHand || 0), 0));
      const want = recon.get(code).excelClosing;
      if (Math.abs(onHand - want) < TOLERANCE) ok += 1;
      else { off += 1; if (off <= 10) console.log(`  OFF  ${code.padEnd(14)} on hand ${n0(onHand)}  expected ${n0(want)}`); }
    }
    console.log(`\n  matches the workbook's Closing Stock : ${ok} of ${committable.size}`);
    if (off) console.log(`  off (pre-existing stock can explain some of these) : ${off}`);
    head('DONE');
  } finally {
    await mongoose.disconnect();
  }
};

if (process.argv[1] && process.argv[1].endsWith('importConsumablesTransactions.js')) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
