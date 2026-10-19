/**
 * Fixture + database oracle for ALL CONVERSIONS — its filters, pagination,
 * sorting and totals (GET /rm-ims/conversions → rmImsService.listConversions).
 *
 *   node src/scripts/e2eAllConversionsFixture.js --seed     fresh scratch DB + 104 cuts of every kind
 *   node src/scripts/e2eAllConversionsFixture.js --api      every filter / page / total, checked against the raw documents
 *   node src/scripts/e2eAllConversionsFixture.js --verify   the browser test saved its one cut, nothing else
 *
 * Pairs with frontend/e2e/allConversions.e2e.mjs.
 *
 * The cuts (newest first is the table's order):
 *   AC-PLG-1   JSL204-07, GRN AC-GRN-1 (Alpha Metals), PLG01 — 30 rounds of 50 kg,
 *              two per day from 05 Jan 2026 (pairs share a cutting date)
 *   AC-JW-1    JSL204-08, GRN AC-GRN-2 (Jobwork Steel Co), cut at JW001 — 25 rounds
 *              of 60 kg, one a day from 01 Feb 2026
 *   AC-PLG-2   JSL202-06, GRN AC-GRN-3 — 1,000 kg Partial then the rest Full:
 *              the one FULLY CUT coil
 *   AC-MAN-1   a manual coil (no GRN), JSL204-10 — 4 rounds of 100 kg
 *   (none)     3 "No receipt available" cuts, JSL204-10 — PLG01, JW001, PLG01
 *   L-001…040  40 cuts imported from the workbook, shaped exactly as
 *              importRmConversionDocs.js / importRmScrapRecords.js write them:
 *              no coil, `EXL/<batch>`, sourceRef …|CONVERSION|<batch>, and a
 *              Summary Scrap row …|SCRAP|<batch> carrying the location — none
 *              for every third (no recorded location). Four share each date and
 *              all share one createdAt, so only the id tells them apart. Every
 *              fifth produced JSL204-08-978, a size no app-era cut produced.
 *
 * Every app-era cut goes through rmConvertSchema + rmImsService.convert(), so
 * stock, scrap records and locations are the real thing.
 *
 * SAFETY: pinned to a localhost scratch database, which --seed drops. It never
 * reads the configured MONGO_URI, so it cannot touch the client's Atlas data.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryMovement, { TXN_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import ScrapRecord from '../modules/inventory/scrapRecord.model.js';
import { inventoryService } from '../modules/inventory/inventory.service.js';
import { rmImsService } from '../modules/inventory/rmIms.service.js';
import {
  rmConvertSchema, rmConversionsQuerySchema, rmCuttingCirclesQuerySchema,
} from '../modules/inventory/rmIms.validation.js';
import { SCRAP_SKU_CODE, SCRAP_SKU_DEFAULTS } from '../modules/inventory/scrapSku.js';
import { COIL_CIRCLE_MAP } from '../data/coil-circle-map.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_allconv';
// Local scratch DB, S3 off, email off — or stop before anything connects.
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eAllConversionsFixture.js');
export const E2E_USER = { email: 'allconv-e2e@test.local', password: 'E2e@12345', name: 'All conversions E2E', role: 'MD' };
export const TOTAL_CUTS = 30 + 25 + 2 + 4 + 3 + 40;
export const LEGACY_ONLY_CIRCLE = 'JSL204-08-978';

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(E2E_URI)) {
  console.error('Refusing to run: fixture must target localhost.');
  process.exit(1);
}

const COILS = [
  { code: 'JSL202-06', name: 'DD 0.60 mm', category: 'DD Steel' },
  { code: 'JSL204-07', name: 'Cu 0.70 mm', category: 'Copper' },
  { code: 'JSL204-08', name: 'Cu 0.80 mm', category: 'Copper' },
  { code: 'JSL204-10', name: 'Cu 1.00 mm', category: 'Copper' },
];
const RECEIPTS = [
  { key: 'PLG1', coil: 'JSL204-07', batchNo: 'AC-PLG-1', weight: 5000, rate: 180, warehouse: 'PLG01', grn: 'AC-GRN-1', vendor: 'Alpha Metals', date: '2026-01-02' },
  { key: 'JW1', coil: 'JSL204-08', batchNo: 'AC-JW-1', weight: 5000, rate: 195, warehouse: 'JW001', grn: 'AC-GRN-2', vendor: 'Jobwork Steel Co', date: '2026-01-25' },
  { key: 'PLG2', coil: 'JSL202-06', batchNo: 'AC-PLG-2', weight: 3000, rate: 170, warehouse: 'PLG01', grn: 'AC-GRN-3', vendor: 'Gamma Steel', date: '2026-03-01' },
  // Grade stock for the manual coil and the "No receipt available" cuts.
  { key: 'STOCK10', coil: 'JSL204-10', batchNo: 'AC-STOCK-10', weight: 10000, rate: 200, warehouse: 'PLG01', grn: 'AC-GRN-4', vendor: 'Delta Metals', date: '2026-01-01' },
  // …and at the job worker, for the "No receipt available" cut made there.
  { key: 'STOCK10J', coil: 'JSL204-10', batchNo: 'AC-STOCK-10J', weight: 1000, rate: 200, warehouse: 'JW001', grn: 'AC-GRN-5', vendor: 'Delta Metals', date: '2026-01-01' },
];
const plusDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00.000Z`) + n * 86400000).toISOString().slice(0, 10);

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (!/ambika_e2e_allconv$/.test(mongoose.connection.name || '')) {
    throw new Error(`Connected to an unexpected database (${mongoose.connection.name}) — aborting.`);
  }
};

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  const user = await User.create({
    ...E2E_USER, password: E2E_USER.password, mobile: '9000000041', isActive: true, roles: ['MD'],
  });
  const skus = {};
  for (const c of COILS) skus[c.code] = await SKU.create({ ...c, unit: 'KGS', itemType: 'RAW_MATERIAL', isActive: true });
  for (const c of Object.values(COIL_CIRCLE_MAP).flat()) {
    if (skus[c.code]) continue;
    skus[c.code] = await SKU.create({ code: c.code, name: c.clientLabel, unit: 'PCS', itemType: 'CIRCLE', isActive: true });
  }
  await SKU.create({ code: SCRAP_SKU_CODE, ...SCRAP_SKU_DEFAULTS, isActive: true });

  const receipt = {};
  for (const r of RECEIPTS) {
    const sku = skus[r.coil];
    await inventoryService.increaseStock({
      skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: 'KGS',
      quantity: r.weight, unitCost: r.rate, warehouse: r.warehouse,
      txnType: TXN_TYPE.GRN_IN, sourceModule: 'GRN', refType: 'GRN', refNumber: r.grn,
      batchNo: r.batchNo, vendorName: r.vendor, remarks: 'All-conversions e2e fixture receipt',
      performedBy: user, movementDate: new Date(`${r.date}T10:00:00+05:30`),
    });
    receipt[r.key] = await InventoryMovement.findOne({ txnType: TXN_TYPE.GRN_IN, batchNo: r.batchNo }).lean();
  }

  let n = 0;
  const cut = async (body) => {
    n += 1;
    const v = await rmConvertSchema.validateAsync({ clientRequestId: `ac-cut-${n}`, scrapVerified: n % 2 ? 'PENDING' : 'DONE', ...body });
    return rmImsService.convert(v, user);
  };
  const circle = (code, pcs, kg) => ({ circleSkuId: String(skus[code]._id), pcs, weightKg: kg });

  // AC-PLG-1: 30 rounds at the plant, two per cutting date.
  for (let i = 0; i < 30; i += 1) {
    await cut({
      conversionDate: plusDays('2026-01-05', Math.floor(i / 2)), coilReceiptId: String(receipt.PLG1._id),
      coilSkuId: String(skus['JSL204-07']._id), coilWeightKg: 50, rate: 180, warehouse: 'PLG01', cuttingType: 'PARTIAL',
      circles: [circle(i % 2 ? 'JSL204-07-750' : 'JSL204-07-700', 9, 42)],
    });
  }
  // AC-JW-1: 25 rounds at the job worker.
  for (let i = 0; i < 25; i += 1) {
    await cut({
      conversionDate: plusDays('2026-02-01', i), coilReceiptId: String(receipt.JW1._id),
      coilSkuId: String(skus['JSL204-08']._id), coilWeightKg: 60, rate: 195, warehouse: 'JW001', cuttingType: 'PARTIAL',
      circles: [circle(i % 2 ? 'JSL204-08-825' : 'JSL204-08-700', 10, 51)],
    });
  }
  // AC-PLG-2: cut away to nothing in two rounds — Fully cut.
  await cut({
    conversionDate: '2026-03-10', coilReceiptId: String(receipt.PLG2._id), coilSkuId: String(skus['JSL202-06']._id),
    coilWeightKg: 1000, rate: 170, warehouse: 'PLG01', cuttingType: 'PARTIAL', circles: [circle('JSL202-06-700', 180, 870)],
  });
  await cut({
    conversionDate: '2026-03-12', coilReceiptId: String(receipt.PLG2._id), coilSkuId: String(skus['JSL202-06']._id),
    coilWeightKg: 2000, rate: 170, warehouse: 'PLG01', cuttingType: 'FULL', circles: [circle('JSL202-06-700', 360, 1720)],
  });
  // AC-MAN-1: a manual coil (no GRN), four rounds.
  const first = await cut({
    conversionDate: '2026-03-01', manualCoil: { batchNo: 'AC-MAN-1', totalWeightKg: 2000 },
    coilSkuId: String(skus['JSL204-10']._id), coilWeightKg: 100, rate: 200, warehouse: 'PLG01', cuttingType: 'PARTIAL',
    circles: [circle('JSL204-10-850', 15, 88)],
  });
  const manualCoilId = String(first.manualCoilId || first.manualCoil?.id || first.manualCoil?._id || '');
  for (let i = 1; i < 4; i += 1) {
    await cut({
      conversionDate: plusDays('2026-03-01', i), manualCoilId,
      coilSkuId: String(skus['JSL204-10']._id), coilWeightKg: 100, rate: 200, warehouse: 'PLG01', cuttingType: 'PARTIAL',
      circles: [circle('JSL204-10-850', 15, 88)],
    });
  }
  // "No receipt available": no coil at all — but a cutting location each.
  for (const [date, warehouse] of [['2026-03-15', 'PLG01'], ['2026-03-16', 'JW001'], ['2026-03-16', 'PLG01']]) {
    await cut({
      conversionDate: date, manualFallback: true, coilSkuId: String(skus['JSL204-10']._id),
      coilWeightKg: 50, rate: 0, warehouse, cuttingType: 'PARTIAL', circles: [circle('JSL204-10-850', 8, 44)],
    });
  }

  // The workbook's cuts — exactly as the two importers write them. Written
  // straight to the collections (as the importers' own upserts do) so four can
  // share a date AND one createdAt: only the id then decides their order.
  const legacyAt = new Date('2025-06-01T00:00:00.000Z');
  const cu8 = skus['JSL204-08'];
  const conv = [];
  const scrap = [];
  for (let i = 0; i < 40; i += 1) {
    const batchNo = `L-${String(i + 1).padStart(3, '0')}`;
    const date = new Date(`${plusDays('2025-01-10', Math.floor(i / 4))}T00:00:00.000Z`);
    const code = i % 5 === 0 ? LEGACY_ONLY_CIRCLE : 'JSL204-08-700';
    const coilKg = 100 + i;
    const circlesKg = Math.round(coilKg * 0.85 * 100) / 100;
    const _id = new mongoose.Types.ObjectId();
    conv.push({
      _id, conversionNumber: `EXL/${batchNo}`, conversionDate: date, batchNo,
      coilSkuId: cu8._id, coilSkuCode: cu8.code, coilSkuName: cu8.name,
      coilWeightKg: coilKg, rate: 190,
      circles: [{ circleSkuId: skus[code]._id, circleSkuCode: code, circleSkuName: skus[code].name, sizeLabel: skus[code].name, pcs: 20, weightKg: circlesKg }],
      circlesWeightKg: circlesKg, circlesPcs: 20, scrapKg: Math.round((coilKg - circlesKg) * 100) / 100,
      yieldRatioPct: 85, scrapVerified: i % 2 ? 'DONE' : 'PENDING',
      sourceRef: `EXCEL_RM_24_25|CONVERSION|${batchNo}`, remarks: `Imported from EXCEL_RM_24_25 · batch ${batchNo}`,
      isDeleted: false, createdAt: legacyAt, updatedAt: legacyAt,
    });
    // Every third imported cut has no Summary Scrap row: no recorded location.
    // The scrap importer links its row to the cut when the cut was imported
    // first (conversionId) and cannot when it was not — both shapes exist.
    if (i % 3 !== 0) {
      const linked = i % 2 === 0;
      scrap.push({
        sourceRef: `EXCEL_RM_24_25|SCRAP|${batchNo}`, batchNo, scrapDate: date, location: i % 3 === 1 ? 'PLG01' : 'JW001',
        conversionId: linked ? _id : null, conversionNumber: linked ? `EXL/${batchNo}` : '',
        coilSkuId: cu8._id, coilSkuCode: cu8.code, coilSkuName: cu8.name,
        coilWeightKg: coilKg, circlesWeightKg: circlesKg, scrapKg: Math.round((coilKg - circlesKg) * 100) / 100,
        yieldRatioPct: 85, disposition: 'PENDING', coilRate: 190, batchStatus: 'CUT',
        isDeleted: false, createdAt: legacyAt, updatedAt: legacyAt,
      });
    }
  }
  await CoilConversion.collection.insertMany(conv);
  await ScrapRecord.collection.insertMany(scrap);

  const count = await CoilConversion.countDocuments({ isDeleted: { $ne: true } });
  console.log(JSON.stringify({ ok: count === TOTAL_CUTS, user: E2E_USER, cuts: count, expected: TOTAL_CUTS }, null, 2));
  await mongoose.disconnect();
  if (count !== TOTAL_CUTS) process.exit(1);
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const idDesc = (a, b) => (String(a._id) < String(b._id) ? 1 : String(a._id) > String(b._id) ? -1 : 0);
const newestFirst = (a, b) => (b.conversionDate - a.conversionDate) || (b.createdAt - a.createdAt) || idDesc(a, b);

/** Every cut, straight from the collections, with what the filters ask of it. */
const rawCuts = async () => {
  const convs = await CoilConversion.find({ isDeleted: { $ne: true } }).lean();
  const srs = await ScrapRecord.find({ isDeleted: { $ne: true } }).lean();
  const own = new Map(srs.filter((s) => s.conversionId).map((s) => [String(s.conversionId), s.location]));
  const byRef = new Map(srs.filter((s) => s.sourceRef).map((s) => [s.sourceRef, s.location]));
  const rc = new Map((await InventoryMovement.find({ txnType: TXN_TYPE.GRN_IN }).lean()).map((m) => [String(m._id), m]));
  return convs.map((c) => ({
    ...c,
    location: own.get(String(c._id))
      || (c.sourceRef && c.sourceRef.includes('|CONVERSION|') ? byRef.get(c.sourceRef.replace('|CONVERSION|', '|SCRAP|')) : null) || null,
    entry: c.coilReceiptId ? 'GRN' : c.manualCoilId ? 'MANUAL' : 'NONE',
    rcpt: c.coilReceiptId ? rc.get(String(c.coilReceiptId)) : null,
    coilKey: String(c.coilReceiptId || c.manualCoilId || ''),
  })).sort(newestFirst);
};
const totalsOf = (rows) => {
  const yields = rows.map((c) => c.yieldRatioPct).filter((y) => typeof y === 'number');
  return {
    coilKg: r2(rows.reduce((s, c) => s + c.coilWeightKg, 0)),
    circlesKg: r2(rows.reduce((s, c) => s + c.circlesWeightKg, 0)),
    scrapKg: r2(rows.reduce((s, c) => s + c.scrapKg, 0)),
    avgYield: r2(yields.length ? yields.reduce((s, y) => s + y, 0) / yields.length : 0),
    count: rows.length,
    untraceable: rows.filter((c) => c.entry === 'NONE').length,
  };
};
const ist = (day, end) => new Date(`${day}T${end ? '23:59:59.999' : '00:00:00.000'}+05:30`);

/** The service, through the route's own schema, page by page. */
const api = async () => {
  await connect();
  const list = async (q) => rmImsService.listConversions(await rmConversionsQuerySchema.validateAsync(q));
  const allPages = async (q, limit = 25) => {
    const out = [];
    let first = null;
    for (let page = 1; page < 100; page += 1) {
      const r = await list({ ...q, page, limit });
      if (!first) first = r;
      out.push(...r.docs);
      if (r.docs.length < limit) break;
    }
    return { rows: out, first };
  };
  const raw = await rawCuts();
  const ids = (rows) => rows.map((c) => String(c._id));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** One filter (or several): the pages, in order, and the totals — against the raw cuts. */
  const filterCase = async (label, q, keep) => {
    const want = raw.filter(keep);
    const { rows, first } = await allPages(q, 25);
    const t = first.totals;
    const wt = totalsOf(want);
    check(`${label}: the pages list exactly the ${want.length} matching cuts, newest first, none twice`,
      same(ids(rows), ids(want)) && new Set(ids(rows)).size === rows.length, `${rows.length} listed / ${want.length} expected`);
    check(`${label}: the totals cover all ${want.length} matching cuts (not one page)`,
      t.conversionCount === wt.count && t.coilKg === wt.coilKg && t.circlesKg === wt.circlesKg && t.scrapKg === wt.scrapKg
        && t.avgYield === wt.avgYield && t.untraceable === wt.untraceable && t.pagination.total === wt.count,
      `count ${t.conversionCount}/${wt.count} · coil ${t.coilKg}/${wt.coilKg} · scrap ${t.scrapKg}/${wt.scrapKg} · yield ${t.avgYield}/${wt.avgYield} · untraceable ${t.untraceable}/${wt.untraceable}`);
    return { want, rows, totals: t };
  };

  console.log('\nAPI — the whole history, page by page');
  const all = await filterCase('no filter', {}, () => true);
  check(`there are ${TOTAL_CUTS} cuts, and the unfiltered totals say "all of them" (filtered: false)`,
    all.rows.length === TOTAL_CUTS && all.totals.filtered === false && all.totals.allCount === TOTAL_CUTS);
  const p1 = await list({ page: 1, limit: 10 });
  const p6 = await list({ page: 6, limit: 10 });
  const p12 = await list({ page: 12, limit: 10 });
  check('page 6 of 10 is cuts 51–60 — beyond the old 50-row limit', same(ids(p6.docs), ids(raw.slice(50, 60))) && p6.totals.pagination.page === 6);
  check('the last page (11 of 10) holds the remaining cuts; a page past the end is empty',
    same(ids((await list({ page: 11, limit: 10 })).docs), ids(raw.slice(100))) && p12.docs.length === 0 && p12.totals.pagination.total === TOTAL_CUTS);
  check('page totals never change with the page: page 1 and page 6 report the same totals',
    same({ ...p1.totals, shown: 0, traceable: 0, pagination: 0 }, { ...p6.totals, shown: 0, traceable: 0, pagination: 0 }));
  const pageSum = r2(p1.docs.reduce((s, c) => s + c.coilWeightKg, 0));
  check('…and they are NOT the sum of the page shown', pageSum !== p1.totals.coilKg, `page 1 sums ${pageSum} kg, totals ${p1.totals.coilKg} kg`);
  const big = await allPages({}, 100);
  check('100 per page: two pages, the same 104 cuts in the same order', same(ids(big.rows), ids(raw)));
  // Ties: the imported cuts share a date per four and one createdAt.
  const legacy = raw.filter((c) => c.sourceRef);
  const tie = legacy.filter((c) => +c.conversionDate === +legacy[0].conversionDate);
  check('cuts sharing BOTH a date and a save time keep one fixed order (by id, newest first) across every page size',
    tie.length === 4 && same(ids(raw), ids(all.rows)) && same(ids(raw), ids(big.rows))
      && same(ids((await allPages({}, 10)).rows), ids(raw)), tie.map((c) => c.batchNo).join(','));

  console.log('\nAPI — each History filter, on its own');
  await filterCase('batch number "l-00" (part of it, any case)', { batchNo: 'l-00' }, (c) => /l-00/i.test(c.batchNo || ''));
  await filterCase('cut from 2026-02-10 to 2026-02-20 (IST days)', { from: '2026-02-10', to: '2026-02-20' },
    (c) => c.conversionDate >= ist('2026-02-10') && c.conversionDate <= ist('2026-02-20', true));
  const legacyCircle = await SKU.findOne({ code: LEGACY_ONLY_CIRCLE }).lean();
  await filterCase(`circle ${LEGACY_ONLY_CIRCLE} (made only by imported cuts)`, { circleSkuId: String(legacyCircle._id) },
    (c) => (c.circles || []).some((x) => String(x.circleSkuId) === String(legacyCircle._id)));
  const plg = await filterCase('location PLG01', { location: 'PLG01' }, (c) => c.location === 'PLG01');
  const jw = await filterCase('location JW001', { location: 'JW001' }, (c) => c.location === 'JW001');
  check('…the imported cuts are filed by their own Summary Scrap row (PLG01 / JW001), not dropped',
    plg.rows.some((c) => c.sourceRef) && jw.rows.some((c) => c.sourceRef));
  const importRows = await ScrapRecord.find({ sourceRef: /\|SCRAP\|/ }).lean();
  const linkedBatches = new Set(importRows.filter((s) => s.conversionId).map((s) => s.batchNo));
  const filed = [...plg.rows, ...jw.rows].filter((c) => c.sourceRef);
  check('…all 26 of them, whether or not the importer linked the row to the cut',
    filed.length === 26 && filed.some((c) => linkedBatches.has(c.batchNo)) && filed.some((c) => !linkedBatches.has(c.batchNo)),
    `${filed.length} filed · ${filed.filter((c) => linkedBatches.has(c.batchNo)).length} linked`);
  const rawLoc = new Map(raw.map((c) => [String(c._id), c.location]));
  check('every row\'s "Cut at" is its own scrap record\'s location (or none)',
    all.rows.every((r) => (r.location || null) === rawLoc.get(String(r._id))));
  check('…"No receipt available" cuts are filed by their own scrap record',
    plg.rows.some((c) => !c.coilReceiptId && !c.manualCoilId && !c.sourceRef) && jw.rows.some((c) => !c.coilReceiptId && !c.manualCoilId && !c.sourceRef));
  const noLoc = raw.filter((c) => !c.location);
  check(`${noLoc.length} imported cuts have no recorded location: listed with no location filter, under neither location`,
    noLoc.length === 14 && noLoc.every((c) => all.rows.some((r) => String(r._id) === String(c._id)))
      && !noLoc.some((c) => [...plg.rows, ...jw.rows].some((r) => String(r._id) === String(c._id))));
  await filterCase('entry type GRN', { entryType: 'GRN' }, (c) => c.entry === 'GRN');
  await filterCase('entry type MANUAL', { entryType: 'MANUAL' }, (c) => c.entry === 'MANUAL');
  const none = await filterCase('entry type NONE (no physical coil)', { entryType: 'NONE' }, (c) => c.entry === 'NONE');
  check('…NONE is the 40 imported cuts + the 3 "No receipt available" cuts', none.rows.length === 43);
  for (const status of ['FULLY_CUT', 'PARTIALLY_CUT']) {
    const hist = await rmImsService.listCuttingHistory({ status, limit: 200 });
    const keys = new Set(hist.docs.map((d) => String(d.coilId)));
    await filterCase(`cutting status ${status} — the coils the history itself shows as ${status}`, { status }, (c) => keys.has(c.coilKey));
  }
  await filterCase('search the GRN supplier "jobwork steel"', { search: 'jobwork steel' }, (c) => /jobwork steel/i.test(c.rcpt?.vendorName || ''));
  await filterCase('search a GRN number "AC-GRN-3"', { search: 'AC-GRN-3' }, (c) => /AC-GRN-3/i.test(c.rcpt?.refNumber || ''));
  await filterCase('search a conversion number "EXL/L-040"', { search: 'EXL/L-040' }, (c) => /EXL\/L-040/i.test(c.conversionNumber || ''));

  console.log('\nAPI — filters together');
  const cu8a = await SKU.findOne({ code: 'JSL204-08-700' }).lean();
  await filterCase('JW001 + cut 2026-02-05…2026-02-15 + circle JSL204-08-700',
    { location: 'JW001', from: '2026-02-05', to: '2026-02-15', circleSkuId: String(cu8a._id) },
    (c) => c.location === 'JW001' && c.conversionDate >= ist('2026-02-05') && c.conversionDate <= ist('2026-02-15', true)
      && (c.circles || []).some((x) => String(x.circleSkuId) === String(cu8a._id)));
  await filterCase('PLG01 + entry type NONE (imported or no receipt, cut at the plant)', { location: 'PLG01', entryType: 'NONE' },
    (c) => c.location === 'PLG01' && c.entry === 'NONE');
  await filterCase('batch "AC-" + status PARTIALLY_CUT', { batchNo: 'AC-', status: 'PARTIALLY_CUT' },
    (c) => /AC-/i.test(c.batchNo || '') && ['AC-PLG-1', 'AC-JW-1', 'AC-MAN-1'].includes(c.batchNo));
  const nothing = await list({ batchNo: 'NO-SUCH', page: 1, limit: 25 });
  check('a filter nothing matches: no rows, zero totals, total 0 — and allCount still says how many cuts exist',
    nothing.docs.length === 0 && nothing.totals.conversionCount === 0 && nothing.totals.coilKg === 0 && nothing.totals.filtered === true
      && nothing.totals.allCount === TOTAL_CUTS);

  console.log('\nAPI — options, validation, older callers');
  const circlesAll = await rmImsService.listCuttingHistoryCircles(await rmCuttingCirclesQuerySchema.validateAsync({ scope: 'all' }));
  const circlesHist = await rmImsService.listCuttingHistoryCircles({});
  check(`the All conversions circle list includes ${LEGACY_ONLY_CIRCLE}; the history's own list (traceable rounds only) does not`,
    circlesAll.some((c) => c.skuCode === LEGACY_ONLY_CIRCLE) && !circlesHist.some((c) => c.skuCode === LEGACY_ONLY_CIRCLE),
    `${circlesAll.length} vs ${circlesHist.length} sizes`);
  const bad = rmConversionsQuerySchema.validate({ from: '2026-03-01', to: '2026-02-01' });
  check('"Cut from" after "Cut to" is refused by the route\'s schema', /From date cannot be after To date/.test(bad.error?.message || ''));
  check('an unknown entry type is refused', !!rmConversionsQuerySchema.validate({ entryType: 'OTHER' }).error);
  const legacyCaller = await rmImsService.listConversions({ limit: 50 });
  check('an older caller sending only limit=50 still gets the newest 50 and the all-cuts totals',
    same(ids(legacyCaller.docs), ids(raw.slice(0, 50))) && legacyCaller.totals.conversionCount === TOTAL_CUTS);
  const searchCaller = await rmImsService.listConversions({ search: 'AC-MAN-1' });
  check('…and one sending only search still gets every match (the manual coil\'s 4 rounds)',
    searchCaller.docs.length === 4 && searchCaller.docs.every((c) => c.manualCoil?.batchNo === 'AC-MAN-1'));
  check('each row carries the cut\'s location for the table', all.rows.every((r) => 'location' in r));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await mongoose.disconnect();
  return failed.length === 0;
};

/** The browser test saves exactly one round, through the form; nothing else. */
const verify = async () => {
  await connect();
  const count = await CoilConversion.countDocuments({});
  const scraps = await ScrapRecord.countDocuments({});
  check(`exactly one cut added by the browser test (${TOTAL_CUTS} → ${TOTAL_CUTS + 1})`, count === TOTAL_CUTS + 1, `${count}`);
  const plg1 = await InventoryMovement.findOne({ txnType: TXN_TYPE.GRN_IN, batchNo: 'AC-PLG-1' }).lean();
  const added = await CoilConversion.findOne({ coilReceiptId: plg1._id }).sort({ createdAt: -1, _id: -1 }).lean();
  check('…the round cut through the form: AC-PLG-1, 50 kg, bound to its GRN',
    added?.batchNo === 'AC-PLG-1' && added?.coilWeightKg === 50, `${added?.conversionNumber} · ${added?.coilWeightKg} kg`);
  const sr = added ? await ScrapRecord.findOne({ conversionId: added._id }).lean() : null;
  check('…with its own scrap record, cut at PLG01', sr?.location === 'PLG01', sr?.location);
  check('AC-PLG-1 now has 31 rounds', (await CoilConversion.countDocuments({ coilReceiptId: plg1._id })) === 31);
  check('scrap records: the 90 seeded (64 app-era + 26 imported) + that one', scraps === 64 + 26 + 1, `${scraps}`);
  check('the 40 imported cuts are untouched', (await CoilConversion.countDocuments({ sourceRef: /\|CONVERSION\|/ })) === 40);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await mongoose.disconnect();
  return failed.length === 0;
};

const mode = process.argv[2];
const main = async () => {
  if (mode === '--seed') return seed();
  if (mode === '--api') return api().then((p) => process.exit(p ? 0 : 1));
  if (mode === '--verify') return verify().then((p) => process.exit(p ? 0 : 1));
  console.error('Usage: --seed | --api | --verify');
  process.exit(1);
};

main().catch(async (e) => {
  console.error('\nFixture failed:', e.stack || e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
