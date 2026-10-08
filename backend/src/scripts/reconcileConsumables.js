/**
 * Consumables & Packing — Excel ⇄ database ⇄ computed reconciliation.
 *
 *   node src/scripts/reconcileConsumables.js            summary
 *   node src/scripts/reconcileConsumables.js --full     every differing SKU
 *   node src/scripts/reconcileConsumables.js --sku CODE one SKU, every field
 *
 * STRICTLY READ-ONLY. It issues finds and aggregations only, and runs the real
 * imsService.getOverview() so the "computed" column is what the API actually
 * serves — not a second implementation of the formulas that could agree with
 * itself while disagreeing with the app.
 *
 * The three columns it compares:
 *   EXCEL     "Item List" (ADC, Lead Time, Safety Factor, MOQ, Max Level,
 *             In Transit, Opening) and "IMS" (Closing Stock)
 *   DB        InventoryPolicy + InventoryStock as stored
 *   COMPUTED  what imsService.getOverview() returns for the same SKU
 */
import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import XLSX from 'xlsx';

import env from '../config/env.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryPolicy from '../modules/inventory/inventoryPolicy.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import InventoryMovement, { TXN_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import { imsService } from '../modules/inventory/ims.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '../../../excel/IMS - Consumable & Packing 24-25.xlsx');

const argv = process.argv.slice(2);
const FULL = argv.includes('--full');
const ONE = argv.includes('--sku') ? String(argv[argv.indexOf('--sku') + 1] || '').toUpperCase() : '';

const s = (v) => (v === null || v === undefined ? '' : String(v).trim());
const up = (v) => s(v).toUpperCase();
/** "1.00 Pcs" / "11 Pcs" / "2.5" → number. The sheet mixes units into values. */
/**
 * "1.00 Pcs" / "11 Pcs" / "2.5" → number; a BLANK cell → null.
 *
 * The null matters more than the parse. Most Item List rows carry no planning
 * values at all, and reading those as 0 made "the sheet says 0" and "the sheet
 * says nothing" indistinguishable — which is exactly what made a backfill of
 * zeros look reasonable. Blank is absence, never a value.
 */
const num = (v) => {
  const t = s(v);
  if (t === '') return null;
  const n = Number(t.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const near = (a, b, tol = 0.01) => a === null || b === null ? a === b : Math.abs(a - b) <= tol;
const fmt = (v) => (v === null || v === undefined ? '—' : typeof v === 'number' ? String(r2(v)) : String(v));
const head = (t) => console.log(`\n${'═'.repeat(110)}\n${t}\n${'═'.repeat(110)}`);

const run = async () => {
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  const host = mongoose.connection.host;
  console.log(`Connected: ${host}/${mongoose.connection.name}  (READ-ONLY)`);
  console.log(`Workbook : ${FILE}`);

  // ── Excel ────────────────────────────────────────────────────────────────
  const wb = XLSX.readFile(FILE, { raw: false });
  const J = (n) => (wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null, raw: false }) : []);

  const xl = new Map();
  for (const r of J('Item List')) {
    const code = up(r['SKU Code']); if (!code || xl.has(code)) continue;
    xl.set(code, {
      code,
      name: s(r['Item Name']),
      category: s(r.Category),
      adc: num(r['Average Daily Consumption']),
      leadDays: num(r['Lead Time (From Indent to Receipt)']),
      safetyFactor: num(r['Safety Factor']),
      moq: num(r.MOQ),
      maxLevel: num(r['Max Level']),
      inTransit: num(r['Material In Transit']),
      opening: num(r['Opening Stock']),
      closing: null,
    });
  }
  for (const r of J('IMS')) {
    const code = up(r['SKU Code']); const e = xl.get(code);
    if (e && e.closing === null) e.closing = num(r['Closing Stock']);
  }
  // The Reorder Sheet carries the client's own suggested order quantity.
  const reorderXl = new Map();
  for (const r of J('Reorder Sheet')) {
    const code = up(r['SKU Code']); if (!code || reorderXl.has(code)) continue;
    reorderXl.set(code, { reorderQty: num(r['Reorder Quantity']), closing: num(r['Closing Stock']), maxLevel: num(r['Max Level']) });
  }

  // ── App (real service) ───────────────────────────────────────────────────
  const { docs } = await imsService.getOverview({ limit: 5000 });
  const app = new Map(docs.map((d) => [up(d.skuCode), d]));

  // ── Raw DB ───────────────────────────────────────────────────────────────
  const skus = await SKU.find({ itemType: { $in: imsService.IMS_ITEM_TYPES }, isDeleted: { $ne: true } })
    .select('_id code name itemType').lean();
  const idByCode = new Map(skus.map((k) => [up(k.code), String(k._id)]));
  const ids = skus.map((k) => k._id);
  const pols = await InventoryPolicy.find({ skuId: { $in: ids }, isDeleted: { $ne: true } }).lean();
  const polBy = new Map(pols.map((p) => [String(p.skuId), p]));
  const stocks = await InventoryStock.find({ skuId: { $in: ids }, isDeleted: { $ne: true } }).lean();
  const stockBy = new Map();
  stocks.forEach((st) => stockBy.set(String(st.skuId), r2((stockBy.get(String(st.skuId)) || 0) + (st.qtyOnHand || 0))));

  // Ledger composition, to evidence the movement-type reconstruction.
  const ledger = await InventoryMovement.aggregate([
    { $match: { skuId: { $in: ids }, isDeleted: { $ne: true } } },
    { $group: { _id: '$txnType', n: { $sum: 1 }, qty: { $sum: '$quantity' } } },
    { $sort: { n: -1 } },
  ]);

  head('1. LEDGER COMPOSITION (InventoryMovement, Consumables & Packing SKUs)');
  console.log('  txnType          entries          qty');
  ledger.forEach((l) => console.log(`  ${String(l._id).padEnd(14)}${String(l.n).padStart(8)}${String(r2(l.qty).toLocaleString('en-IN')).padStart(16)}`));
  const totalMoves = ledger.reduce((a, l) => a + l.n, 0);
  console.log(`  ${'TOTAL'.padEnd(14)}${String(totalMoves).padStart(8)}`);

  // ── Per-SKU comparison ───────────────────────────────────────────────────
  const FIELDS = [
    ['opening', 'Opening Stock', (e) => e.opening, (p) => (p ? p.openingStock : null), () => null],
    ['closing', 'Closing Stock', (e) => e.closing, (p, st) => st, (a) => (a ? a.onHand : null)],
    ['adc', 'ADC', (e) => e.adc, (p) => (p ? p.averageDailyConsumption : null), (a) => (a ? a.adc : null)],
    ['leadDays', 'Lead Time', (e) => e.leadDays, (p) => (p ? p.leadDays : null), (a) => (a ? a.leadDays : null)],
    ['safetyFactor', 'Safety Factor', (e) => e.safetyFactor, (p) => (p ? p.safetyFactor : null), (a) => (a ? a.safetyFactor : null)],
    ['moq', 'MOQ', (e) => e.moq, (p) => (p ? p.moq : null), () => null],
    ['maxLevel', 'Max Level', (e) => e.maxLevel, (p) => (p ? p.maxLevel : null), (a) => (a ? a.maxLevel : null)],
    ['inTransit', 'In Transit', (e) => e.inTransit, (p) => (p ? p.materialInTransit : null), (a) => (a ? a.inTransit : null)],
  ];

  const rows = [];
  for (const [code, e] of xl) {
    const id = idByCode.get(code);
    const pol = id ? polBy.get(id) : null;
    const st = id ? (stockBy.get(id) ?? 0) : null;
    const a = app.get(code) || null;
    rows.push({ code, e, pol, st, a, inMaster: !!id });
  }

  if (ONE) {
    const r = rows.find((x) => x.code === ONE);
    if (!r) { console.log(`\n${ONE} is not in the workbook.`); await mongoose.disconnect(); return; }
    head(`SKU ${ONE} — ${r.e.name}`);
    console.log(`  in SKU master: ${r.inMaster}   policy row: ${!!r.pol}   served by API: ${!!r.a}`);
    console.log(`\n  ${'Field'.padEnd(16)}${'EXCEL'.padStart(12)}${'DB'.padStart(14)}${'COMPUTED'.padStart(14)}`);
    for (const [, label, fe, fd, fa] of FIELDS) {
      console.log(`  ${label.padEnd(16)}${fmt(fe(r.e)).padStart(12)}${fmt(fd(r.pol, r.st)).padStart(14)}${fmt(fa(r.a)).padStart(14)}`);
    }
    if (r.a) {
      console.log(`\n  derived: reorderPoint=${fmt(r.a.reorderPoint)}  safetyStock=${fmt(r.a.safetyStock)}  projectedAvailable=${fmt(r.a.projectedAvailable)}`);
      console.log(`           daysCover=${fmt(r.a.daysCover)}  status=${r.a.status}  suggestedOrderQty=${fmt(r.a.suggestedOrderQty)}`);
      console.log(`           maxLevelMode=${r.a.maxLevelMode}  formulaMaxLevel=${fmt(r.a.formulaMaxLevel)}  storedMaxLevel=${fmt(r.a.storedMaxLevel)}`);
      const rx = reorderXl.get(ONE);
      if (rx) console.log(`  excel reorder sheet: reorderQty=${fmt(rx.reorderQty)}  closing=${fmt(rx.closing)}  maxLevel=${fmt(rx.maxLevel)}`);
    }
    await mongoose.disconnect();
    return;
  }

  head('2. FIELD-BY-FIELD AGREEMENT  (only SKUs present in the master and served by the API)');
  const live = rows.filter((r) => r.inMaster && r.a);
  console.log(`  Workbook SKUs: ${xl.size}   in SKU master: ${rows.filter((r) => r.inMaster).length}   served by the API: ${live.length}\n`);
  // Agreement is counted ONLY over the SKUs where the workbook actually states
  // a value for that field. Most Item List rows plan nothing, and scoring a
  // blank cell as a disagreement says the app is wrong where the source is
  // simply silent.
  console.log(`  ${'Field'.padEnd(16)}${'sheet has'.padStart(11)}${'EXCEL=DB'.padStart(12)}${'EXCEL=COMP'.padStart(13)}${'DB=COMP'.padStart(10)}`);
  const summary = [];
  for (const [key, label, fe, fd, fa] of FIELDS) {
    let n = 0; let ed = 0; let ec = 0; let dc = 0; let ecN = 0; let dcN = 0;
    for (const r of live) {
      const E = fe(r.e); const D = fd(r.pol, r.st); const C = fa(r.a);
      if (E === null) continue;          // the sheet is silent — nothing to reconcile
      n += 1;
      if (near(E, D)) ed += 1;
      if (C !== null) { ecN += 1; if (near(E, C)) ec += 1; }
      if (C !== null && D !== null) { dcN += 1; if (near(D, C)) dc += 1; }
    }
    summary.push({ key, label, n, ed, ec, ecN, dc, dcN });
    console.log(`  ${label.padEnd(16)}${String(n).padStart(11)}${`${ed}/${n}`.padStart(12)}`
      + `${(ecN ? `${ec}/${ecN}` : 'n/a').padStart(13)}${(dcN ? `${dc}/${dcN}` : 'n/a').padStart(10)}`);
  }

  // ── Where EXCEL and COMPUTED disagree, and why ───────────────────────────
  head('3. MAX LEVEL — the formula the workbook itself uses');
  let formulaHolds = 0; let formulaTested = 0; const formulaOff = [];
  for (const r of live) {
    const { adc, leadDays, safetyFactor, maxLevel } = r.e;
    if ([adc, leadDays, safetyFactor, maxLevel].some((v) => v === null)) continue;
    formulaTested += 1;
    const expect = r2(adc * leadDays * safetyFactor);
    if (near(expect, maxLevel, 1)) formulaHolds += 1;
    else if (formulaOff.length < 12) formulaOff.push({ code: r.code, adc, leadDays, safetyFactor, expect, maxLevel });
  }
  console.log(`  Excel Max Level == Excel ADC × Lead × Safety Factor : ${formulaHolds}/${formulaTested}`);
  if (formulaOff.length) {
    console.log('\n  Rows where the workbook\'s own Max Level does not equal its own formula:');
    console.log('  SKU               ADC    lead     SF    formula    sheet');
    formulaOff.forEach((f) => console.log(`  ${f.code.padEnd(16)}${fmt(f.adc).padStart(6)}${fmt(f.leadDays).padStart(8)}${fmt(f.safetyFactor).padStart(7)}${fmt(f.expect).padStart(11)}${fmt(f.maxLevel).padStart(9)}`));
  }

  head('4. ADC — measured (what the app uses) vs the workbook\'s stored figure');
  let adcSame = 0; let adcZeroMeasured = 0; let adcBothZero = 0; const adcDiff = [];
  for (const r of live) {
    const E = r.e.adc; const C = r.a.adc;
    if (E === null) continue;
    if (near(E, C, 0.01)) { adcSame += 1; continue; }
    if (r2(C) === 0 && r2(E) === 0) { adcBothZero += 1; continue; }
    if (r2(C) === 0 && E > 0) adcZeroMeasured += 1;
    adcDiff.push({ code: r.code, excel: E, measured: C, stored: r.pol?.averageDailyConsumption ?? null });
  }
  console.log(`  measured ADC equals the workbook's ADC            : ${adcSame}/${live.length}`);
  console.log(`  measured ADC is 0 while the workbook has a rate   : ${adcZeroMeasured}`);
  console.log(`  differ for another reason                        : ${adcDiff.length - adcZeroMeasured}`);
  console.log(`\n  The workbook's ADC IS stored (policy.averageDailyConsumption) but deriveMetrics`);
  console.log('  reads the measured 90-day rate only. Where the two differ, every figure built on');
  console.log('  ADC — Max Level (AUTO), Reorder At, Days Cover, Status, Suggested Qty — differs too.');
  if (FULL && adcDiff.length) {
    console.log('\n  SKU               excel ADC   measured   stored');
    adcDiff.slice(0, 60).forEach((d) => console.log(`  ${d.code.padEnd(16)}${fmt(d.excel).padStart(11)}${fmt(d.measured).padStart(11)}${fmt(d.stored).padStart(9)}`));
    if (adcDiff.length > 60) console.log(`  … ${adcDiff.length - 60} more`);
  }

  head('5. KNOCK-ON: what an ADC of 0 does to the planning columns');
  const zeroAdc = live.filter((r) => r2(r.a.adc) === 0);
  const zeroAdcWithExcelRate = zeroAdc.filter((r) => (r.e.adc ?? 0) > 0);
  console.log(`  SKUs served with measured ADC = 0                 : ${zeroAdc.length}/${live.length}`);
  console.log(`  …of which the workbook states a non-zero ADC      : ${zeroAdcWithExcelRate.length}`);
  console.log(`  Of those: Max Level 0 : ${zeroAdcWithExcelRate.filter((r) => r2(r.a.maxLevel) === 0).length}`
    + `   Reorder At 0 : ${zeroAdcWithExcelRate.filter((r) => r2(r.a.reorderPoint) === 0).length}`
    + `   Days Cover null : ${zeroAdcWithExcelRate.filter((r) => r.a.daysCover === null).length}`);
  const st = {};
  live.forEach((r) => { st[r.a.status] = (st[r.a.status] || 0) + 1; });
  console.log(`  Status spread served today: ${Object.entries(st).map(([k, v]) => `${k}=${v}`).join('  ')}`);

  head('6. CLOSING STOCK — workbook vs the derived balance');
  let cOk = 0; const cOff = [];
  for (const r of live) {
    if (r.e.closing === null) continue;
    if (near(r.e.closing, r.st, 1)) cOk += 1;
    else cOff.push({ code: r.code, excel: r.e.closing, db: r.st, diff: r2(r.st - r.e.closing) });
  }
  console.log(`  InventoryStock on hand == workbook Closing Stock  : ${cOk}/${live.filter((r) => r.e.closing !== null).length}  (±1)`);
  if (cOff.length) {
    console.log('\n  SKU               excel      db      diff');
    cOff.slice(0, FULL ? 200 : 20).forEach((c) => console.log(`  ${c.code.padEnd(16)}${fmt(c.excel).padStart(9)}${fmt(c.db).padStart(9)}${fmt(c.diff).padStart(10)}`));
    if (!FULL && cOff.length > 20) console.log(`  … ${cOff.length - 20} more — pass --full`);
  }

  head('7. SUGGESTED ORDER QTY — workbook Reorder Sheet vs computed');
  let rOk = 0; let rTested = 0; const rOff = [];
  for (const r of live) {
    const rx = reorderXl.get(r.code);
    if (!rx || rx.reorderQty === null) continue;
    rTested += 1;
    if (near(rx.reorderQty, r.a.suggestedOrderQty, 1)) rOk += 1;
    else if (rOff.length < (FULL ? 200 : 15)) rOff.push({ code: r.code, excel: rx.reorderQty, app: r.a.suggestedOrderQty, xlMax: rx.maxLevel, appMax: r.a.maxLevel });
  }
  console.log(`  computed Suggested Qty == sheet Reorder Quantity  : ${rOk}/${rTested}  (±1)`);
  if (rOff.length) {
    console.log('\n  SKU              sheet qty   app qty   sheet max   app max');
    rOff.forEach((c) => console.log(`  ${c.code.padEnd(16)}${fmt(c.excel).padStart(9)}${fmt(c.app).padStart(10)}${fmt(c.xlMax).padStart(12)}${fmt(c.appMax).padStart(10)}`));
  }

  head('8. COVERAGE GAPS');
  const notInMaster = rows.filter((r) => !r.inMaster).map((r) => r.code);
  const noPolicy = live.filter((r) => !r.pol).map((r) => r.code);
  console.log(`  Workbook SKUs with no SKU master record : ${notInMaster.length}${notInMaster.length ? ` → ${notInMaster.join(', ')}` : ''}`);
  console.log(`  Served SKUs with no InventoryPolicy row : ${noPolicy.length}${noPolicy.length && noPolicy.length <= 20 ? ` → ${noPolicy.join(', ')}` : ''}`);

  head('READ-ONLY — nothing was written.');
  await mongoose.disconnect();
};

run().catch(async (e) => {
  console.error('Reconciliation failed:', e.message);
  console.error(e.stack);
  try { await mongoose.disconnect(); } catch { /* already down */ }
  process.exit(1);
});
