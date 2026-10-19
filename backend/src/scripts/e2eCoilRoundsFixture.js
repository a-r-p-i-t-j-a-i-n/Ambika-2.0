/**
 * Fixture + database oracle for the Coil to Circle history's ROUND DETAILS —
 * what opens under a coil, and how the history and All conversions relate.
 *
 *   node src/scripts/e2eCoilRoundsFixture.js --seed     fresh scratch DB + coils of every shape
 *   node src/scripts/e2eCoilRoundsFixture.js --api      coil totals vs their rounds, round filters, All conversions
 *   node src/scripts/e2eCoilRoundsFixture.js --verify   the browser saved its two cuts and nothing else
 *
 * Pairs with frontend/e2e/coilRounds.e2e.mjs.
 *
 *   R-ONE-FULL   JSL204-08 1,000 kg PLG01 — ONE round, Full, one circle size
 *   R-ONE-2SZ    JSL204-08 1,200 kg PLG01 — ONE round, Partial, TWO circle sizes
 *   R-MULTI-3    JSL204-07 2,000 kg PLG01 — 3 rounds (10 Jan, 20 Jan, 10 Feb), all PLG01
 *   R-MIXED      JSL204-08 1,500 kg — round 1 cut at PLG01, round 2 at JW001
 *   R-MAN-2      manual coil (no GRN), JSL204-10 1,000 kg — 2 rounds
 *   R-LONG       JSL204-07 3,000 kg PLG01 — 12 rounds of 100 kg, two per day
 *   R-BULK-01…06 JSL202-06 500 kg — one older round each, so the history runs to 2 pages
 *   UI-NEW       JSL202-06 1,000 kg — uncut; the browser cuts its first round
 *   (no coil)    3 workbook imports (…|CONVERSION|…, with Summary Scrap rows)
 *                + 1 "No receipt available" cut — only All conversions lists them
 *
 * 12 coils · 27 rounds in the history; 31 cuts in All conversions.
 * Every app-era cut goes through rmConvertSchema + rmImsService.convert().
 *
 * SAFETY: pinned to a localhost scratch database, which --seed drops. It never
 * reads the configured MONGO_URI, so it cannot touch the client's Atlas data.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryMovement, { TXN_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import ScrapRecord from '../modules/inventory/scrapRecord.model.js';
import { inventoryService } from '../modules/inventory/inventory.service.js';
import { rmImsService } from '../modules/inventory/rmIms.service.js';
import {
  rmConvertSchema, rmCuttingHistoryQuerySchema, rmConversionsQuerySchema,
} from '../modules/inventory/rmIms.validation.js';
import { SCRAP_SKU_CODE, SCRAP_SKU_DEFAULTS } from '../modules/inventory/scrapSku.js';
import { COIL_CIRCLE_MAP } from '../data/coil-circle-map.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_coilrounds';
// Local scratch DB, S3 off, email off — or stop before anything connects.
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eCoilRoundsFixture.js');
export const E2E_USER = { email: 'coilrounds-e2e@test.local', password: 'E2e@12345', name: 'Coil rounds E2E', role: 'MD' };
const COILS_LISTED = 12;
const ROUNDS = 27;
const UNTRACEABLE = 4;

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
  { key: 'ONE_FULL', coil: 'JSL204-08', batchNo: 'R-ONE-FULL', weight: 1000, rate: 190, warehouse: 'PLG01', grn: 'GRN-R-01', vendor: 'Alpha Metals', date: '2026-01-02' },
  { key: 'ONE_2SZ', coil: 'JSL204-08', batchNo: 'R-ONE-2SZ', weight: 1200, rate: 191, warehouse: 'PLG01', grn: 'GRN-R-02', vendor: 'Alpha Metals', date: '2026-01-03' },
  { key: 'MULTI', coil: 'JSL204-07', batchNo: 'R-MULTI-3', weight: 2000, rate: 180, warehouse: 'PLG01', grn: 'GRN-R-03', vendor: 'Beta Coils', date: '2026-01-04' },
  { key: 'MIXED', coil: 'JSL204-08', batchNo: 'R-MIXED', weight: 1500, rate: 192, warehouse: 'PLG01', grn: 'GRN-R-04', vendor: 'Beta Coils', date: '2026-01-05' },
  { key: 'LONG', coil: 'JSL204-07', batchNo: 'R-LONG', weight: 3000, rate: 181, warehouse: 'PLG01', grn: 'GRN-R-05', vendor: 'Gamma Steel', date: '2026-01-06' },
  { key: 'UI_NEW', coil: 'JSL202-06', batchNo: 'UI-NEW', weight: 1000, rate: 170, warehouse: 'PLG01', grn: 'GRN-R-06', vendor: 'Gamma Steel', date: '2026-01-07' },
  ...Array.from({ length: 6 }, (_, i) => ({
    key: `BULK${i + 1}`, coil: 'JSL202-06', batchNo: `R-BULK-0${i + 1}`, weight: 500, rate: 170, warehouse: 'PLG01',
    grn: `GRN-R-B${i + 1}`, vendor: 'Delta Metals', date: '2025-11-01',
  })),
  // Grade stock: JSL204-08 at the job worker (R-MIXED's second round is cut
  // there) and JSL204-10 at the plant (the manual coil, "No receipt available").
  { key: 'STOCK08J', coil: 'JSL204-08', batchNo: 'R-STOCK-08J', weight: 1000, rate: 192, warehouse: 'JW001', grn: 'GRN-R-S1', vendor: 'Delta Metals', date: '2026-01-01' },
  { key: 'STOCK10', coil: 'JSL204-10', batchNo: 'R-STOCK-10', weight: 3000, rate: 200, warehouse: 'PLG01', grn: 'GRN-R-S2', vendor: 'Delta Metals', date: '2026-01-01' },
];
const plusDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00.000Z`) + n * 86400000).toISOString().slice(0, 10);

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (!/ambika_e2e_coilrounds$/.test(mongoose.connection.name || '')) {
    throw new Error(`Connected to an unexpected database (${mongoose.connection.name}) — aborting.`);
  }
};

const stockSnapshot = async () => (await InventoryStock.find({}).lean())
  .map((s) => ({ key: `${s.skuCode || s.skuId}|${s.warehouse || ''}`, qty: Math.round(Number(s.qtyOnHand || 0) * 100) / 100 }))
  .sort((a, b) => a.key.localeCompare(b.key));

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  const user = await User.create({
    ...E2E_USER, password: E2E_USER.password, mobile: '9000000051', isActive: true, roles: ['MD'],
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
      batchNo: r.batchNo, vendorName: r.vendor, remarks: 'Coil-rounds e2e fixture receipt',
      performedBy: user, movementDate: new Date(`${r.date}T10:00:00+05:30`),
    });
    receipt[r.key] = await InventoryMovement.findOne({ txnType: TXN_TYPE.GRN_IN, batchNo: r.batchNo }).lean();
  }

  let n = 0;
  const cut = async (body) => {
    n += 1;
    const v = await rmConvertSchema.validateAsync({ clientRequestId: `cr-cut-${n}`, scrapVerified: 'PENDING', ...body });
    return rmImsService.convert(v, user);
  };
  const circle = (code, pcs, kg) => ({ circleSkuId: String(skus[code]._id), pcs, weightKg: kg });
  const grnCut = (key, coil, date, kg, circles, extra = {}) => cut({
    conversionDate: date, coilReceiptId: String(receipt[key]._id), coilSkuId: String(skus[coil]._id),
    coilWeightKg: kg, rate: 0, warehouse: 'PLG01', cuttingType: 'PARTIAL', circles, ...extra,
  });

  // Older one-round coils first, so the newer coils head the history.
  for (let i = 1; i <= 6; i += 1) {
    await grnCut(`BULK${i}`, 'JSL202-06', `2025-12-0${i}`, 100, [circle('JSL202-06-700', 18, 88)]);
  }
  // R-MULTI-3: three rounds, all at the plant.
  await grnCut('MULTI', 'JSL204-07', '2026-01-10', 400, [circle('JSL204-07-700', 70, 340)]);
  await grnCut('MULTI', 'JSL204-07', '2026-01-20', 600, [circle('JSL204-07-750', 100, 520)]);
  await grnCut('MULTI', 'JSL204-07', '2026-02-10', 500, [circle('JSL204-07-700', 85, 430)]);
  // R-MIXED: plant, then the job worker.
  await grnCut('MIXED', 'JSL204-08', '2026-01-15', 500, [circle('JSL204-08-700', 90, 425)]);
  await grnCut('MIXED', 'JSL204-08', '2026-01-25', 400, [circle('JSL204-08-825', 60, 336)], { warehouse: 'JW001' });
  // R-LONG: twelve rounds of 100 kg, two per day.
  for (let i = 0; i < 12; i += 1) {
    await grnCut('LONG', 'JSL204-07', plusDays('2026-03-01', Math.floor(i / 2)), 100,
      [circle(i % 2 ? 'JSL204-07-750' : 'JSL204-07-700', 15, 84 + (i % 3))]);
  }
  // One-round coils: a Full cut with one size, a Partial cut with two.
  await grnCut('ONE_FULL', 'JSL204-08', '2026-02-02', 1000, [circle('JSL204-08-850', 180, 860)], { cuttingType: 'FULL' });
  await grnCut('ONE_2SZ', 'JSL204-08', '2026-02-05', 500, [circle('JSL204-08-700', 40, 230), circle('JSL204-08-850', 30, 200)]);
  // R-MAN-2: a manual coil (no GRN), two rounds.
  const first = await cut({
    conversionDate: '2026-02-12', manualCoil: { batchNo: 'R-MAN-2', totalWeightKg: 1000 },
    coilSkuId: String(skus['JSL204-10']._id), coilWeightKg: 300, rate: 200, warehouse: 'PLG01', cuttingType: 'PARTIAL',
    circles: [circle('JSL204-10-850', 45, 260)],
  });
  await cut({
    conversionDate: '2026-02-14', manualCoilId: String(first.manualCoilId),
    coilSkuId: String(skus['JSL204-10']._id), coilWeightKg: 200, rate: 200, warehouse: 'PLG01', cuttingType: 'PARTIAL',
    circles: [circle('JSL204-10-925', 28, 172)],
  });
  // "No receipt available": names no coil.
  await cut({
    conversionDate: '2026-02-20', manualFallback: true, coilSkuId: String(skus['JSL204-10']._id),
    coilWeightKg: 50, rate: 0, warehouse: 'PLG01', cuttingType: 'PARTIAL', circles: [circle('JSL204-10-850', 7, 44)],
  });
  // Three workbook imports, shaped as importRmConversionDocs / importRmScrapRecords write them.
  const cu8 = skus['JSL204-08'];
  const at = new Date('2025-06-01T00:00:00.000Z');
  const conv = []; const scrap = [];
  ['LG-1', 'LG-2', 'LG-3'].forEach((batchNo, i) => {
    const date = new Date(`2025-01-1${i}T00:00:00.000Z`);
    const code = 'JSL204-08-700';
    conv.push({
      conversionNumber: `EXL/${batchNo}`, conversionDate: date, batchNo,
      coilSkuId: cu8._id, coilSkuCode: cu8.code, coilSkuName: cu8.name, coilWeightKg: 200, rate: 190,
      circles: [{ circleSkuId: skus[code]._id, circleSkuCode: code, circleSkuName: skus[code].name, sizeLabel: skus[code].name, pcs: 30, weightKg: 170 }],
      circlesWeightKg: 170, circlesPcs: 30, scrapKg: 30, yieldRatioPct: 85, scrapVerified: 'PENDING',
      sourceRef: `EXCEL_RM_24_25|CONVERSION|${batchNo}`, remarks: `Imported from EXCEL_RM_24_25 · batch ${batchNo}`,
      isDeleted: false, createdAt: at, updatedAt: at,
    });
    if (i < 2) {
      scrap.push({
        sourceRef: `EXCEL_RM_24_25|SCRAP|${batchNo}`, batchNo, scrapDate: date, location: i ? 'JW001' : 'PLG01',
        conversionId: null, conversionNumber: '',
        coilSkuId: cu8._id, coilSkuCode: cu8.code, coilSkuName: cu8.name, coilWeightKg: 200, circlesWeightKg: 170, scrapKg: 30,
        yieldRatioPct: 85, disposition: 'PENDING', coilRate: 190, batchStatus: 'CUT', isDeleted: false, createdAt: at, updatedAt: at,
      });
    }
  });
  await CoilConversion.collection.insertMany(conv);
  await ScrapRecord.collection.insertMany(scrap);

  // What the browser run must leave untouched, for --verify.
  const snapshot = {
    conversions: await CoilConversion.countDocuments({}),
    scrapRecords: await ScrapRecord.countDocuments({}),
    stock: await stockSnapshot(),
    at: new Date(),
  };
  await mongoose.connection.collection('e2e_snapshots').insertOne({ _id: 'seed', ...snapshot });
  const ok = snapshot.conversions === ROUNDS + UNTRACEABLE;
  console.log(JSON.stringify({ ok, user: E2E_USER, cuts: snapshot.conversions, expected: ROUNDS + UNTRACEABLE }, null, 2));
  await mongoose.disconnect();
  if (!ok) process.exit(1);
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const done = async () => {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await mongoose.disconnect();
  return failed.length === 0;
};
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const EPS = 0.001;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The browser's round filter (CuttingHistoryPanel.jsx → roundMatcher), written
 * out again here: --api holds it to the server's own count of matching rounds,
 * so a dimmed round on screen is exactly a round the server did not count.
 */
const roundMatcher = ({ from, to, circleSkuId, location } = {}) => {
  const lo = from ? new Date(`${from}T00:00:00.000+05:30`) : null;
  const hi = to ? new Date(`${to}T23:59:59.999+05:30`) : null;
  return (r) => {
    const d = r.date ? new Date(r.date) : null;
    if (lo && !(d && d >= lo)) return false;
    if (hi && !(d && d <= hi)) return false;
    if (circleSkuId && !(r.circles || []).some((x) => String(x.circleSkuId) === String(circleSkuId))) return false;
    if (location && r.location !== location) return false;
    return true;
  };
};

const api = async () => {
  await connect();
  const history = async (q) => rmImsService.listCuttingHistory(await rmCuttingHistoryQuerySchema.validateAsync({ limit: 50, ...q }));
  const lineage = async (id) => rmImsService.getCoilLineage(String(id));

  console.log('\nAPI — each coil row against its own rounds');
  const all = await history({});
  check(`the history lists ${COILS_LISTED} coils and ${ROUNDS} rounds`, all.summary.coils === COILS_LISTED && all.summary.rounds === ROUNDS,
    `${all.summary.coils} coils · ${all.summary.rounds} rounds`);
  const byBatch = new Map(all.docs.map((d) => [d.batchNo, d]));
  let allConvIds = [];
  for (const row of all.docs) {
    const lin = await lineage(row.coilId);
    const rs = lin.rounds;
    allConvIds = allConvIds.concat(rs.map((r) => String(r.conversionId)));
    const inDb = await CoilConversion.countDocuments({
      $or: [{ coilReceiptId: row.coilId }, { manualCoilId: row.coilId }], isDeleted: { $ne: true },
    });
    const cut = r2(rs.reduce((s, r) => s + r.cutKg, 0));
    const circles = r2(rs.reduce((s, r) => s + r.circlesKg, 0));
    const scrapKg = r2(rs.reduce((s, r) => s + r.scrapKg, 0));
    const last = rs[rs.length - 1];
    // A ROUND that left metal is PARTIAL; the COIL it leaves is PARTIALLY_CUT.
    const lastAsCoil = last.status === 'PARTIAL' ? 'PARTIALLY_CUT' : last.status;
    const ordered = rs.every((r, i) => r.roundNo === i + 1 && (i === 0 || new Date(r.date) >= new Date(rs[i - 1].date)));
    check(`${row.batchNo}: ${row.rounds} round(s) — every recorded cut once, numbered 1…n, oldest first`,
      rs.length === row.rounds && rs.length === inDb && new Set(rs.map((r) => String(r.conversionId))).size === rs.length && ordered,
      `${rs.length} rounds · ${inDb} in the database`);
    check(`${row.batchNo}: the row is the SUM of its rounds (cut ${row.cutKg} · circles ${row.circlesKg} · scrap ${row.scrapKg}) and its remaining is the last round's`,
      Math.abs(cut - row.cutKg) <= EPS && Math.abs(circles - row.circlesKg) <= EPS && Math.abs(scrapKg - row.scrapKg) <= EPS
        && Math.abs(last.remainingAfterKg - row.remainingKg) <= EPS && lastAsCoil === row.status && row.reconciles,
      `rounds: cut ${cut} · circles ${circles} · scrap ${scrapKg} · left ${last.remainingAfterKg} ${last.status}`);
  }
  check('no cut belongs to two coils', new Set(allConvIds).size === allConvIds.length && allConvIds.length === ROUNDS);
  check('R-MIXED is listed as "Mixed" — its rounds name PLG01 and JW001', byBatch.get('R-MIXED')?.location === 'MIXED'
    && same((await lineage(byBatch.get('R-MIXED').coilId)).rounds.map((r) => r.location), ['PLG01', 'JW001']));
  check('R-MULTI-3 and R-LONG name one location (PLG01) for every round', byBatch.get('R-MULTI-3')?.location === 'PLG01'
    && (await lineage(byBatch.get('R-LONG').coilId)).rounds.every((r) => r.location === 'PLG01'));
  const one = (await lineage(byBatch.get('R-ONE-FULL').coilId)).rounds;
  check('R-ONE-FULL: one round, cutting type FULL, one circle size', one.length === 1 && one[0].cuttingType === 'FULL' && one[0].circles.length === 1);
  const two = (await lineage(byBatch.get('R-ONE-2SZ').coilId)).rounds;
  check('R-ONE-2SZ: one round, PARTIAL, two sizes (40 pcs 230 kg + 30 pcs 200 kg)', two.length === 1 && two[0].cuttingType === 'PARTIAL'
    && same(two[0].circles.map((c) => [c.pcs, c.weightKg]), [[40, 230], [30, 200]]));
  const long = (await lineage(byBatch.get('R-LONG').coilId)).rounds;
  const longDb = await CoilConversion.find({ coilReceiptId: byBatch.get('R-LONG').coilId }).sort({ conversionDate: 1, createdAt: 1, _id: 1 }).lean();
  check('R-LONG: 12 rounds — two on each day kept in the order they were saved', long.length === 12
    && same(long.map((r) => r.conversionNumber), longDb.map((c) => c.conversionNumber)));

  console.log('\nAPI — the round filters: what the browser dims is what the server did not count');
  const multiId = String(byBatch.get('R-MULTI-3').coilId);
  const sizes = await SKU.find({ code: { $in: ['JSL204-07-750', 'JSL204-08-825'] } }).lean();
  const sizeId = (code) => String(sizes.find((s) => s.code === code)._id);
  const filterCases = [
    ['cut 15–31 Jan 2026', { from: '2026-01-15', to: '2026-01-31' }],
    ['cut on 10 Feb 2026 exactly (an IST day)', { from: '2026-02-10', to: '2026-02-10' }],
    ['circle JSL204-07-750', { circleSkuId: sizeId('JSL204-07-750') }],
    ['location JW001', { location: 'JW001' }],
    ['JW001 + circle JSL204-08-825 + to 31 Jan', { location: 'JW001', circleSkuId: sizeId('JSL204-08-825'), to: '2026-01-31' }],
  ];
  for (const [label, q] of filterCases) {
    const res = await history(q);
    let agree = true; const detail = [];
    for (const row of res.docs) {
      const rs = (await lineage(row.coilId)).rounds;
      const mine = rs.filter(roundMatcher(q)).length;
      if (mine !== row.matchedRounds || mine === 0) agree = false;
      detail.push(`${row.batchNo} ${row.matchedRounds}/${row.rounds}`);
    }
    check(`${label}: every listed coil's undimmed rounds = the server's "N of M match"`, agree && res.docs.length > 0, detail.join(', '));
  }
  const jan = await history({ from: '2026-01-15', to: '2026-01-31' });
  check('…e.g. 15–31 Jan: R-MULTI-3 is "1 of 3", R-MIXED "2 of 2"',
    jan.docs.find((d) => String(d.coilId) === multiId)?.matchedRounds === 1 && jan.docs.find((d) => d.batchNo === 'R-MIXED')?.matchedRounds === 2);

  console.log('\nAPI — All conversions: the same cuts once each, plus the ones naming no coil');
  const conv = await rmImsService.listConversions(await rmConversionsQuerySchema.validateAsync({ page: 1, limit: 100 }));
  const convIds = conv.docs.map((d) => String(d._id));
  check(`All conversions lists ${ROUNDS + UNTRACEABLE} cuts: the ${ROUNDS} rounds + ${UNTRACEABLE} naming no physical coil`,
    conv.totals.conversionCount === ROUNDS + UNTRACEABLE && conv.totals.untraceable === UNTRACEABLE, `${conv.totals.conversionCount} · ${conv.totals.untraceable} untraceable`);
  check('every round the history shows is in All conversions exactly once', allConvIds.every((id) => convIds.filter((x) => x === id).length === 1));
  check(`the history's own count of older cuts is the same ${UNTRACEABLE}`, all.summary.untraceable.records === UNTRACEABLE);
  const none = await rmImsService.listConversions(await rmConversionsQuerySchema.validateAsync({ page: 1, limit: 100, entryType: 'NONE' }));
  check('All conversions → "No physical coil" is exactly those 4 (3 imports + 1 "No receipt available")',
    none.docs.length === UNTRACEABLE && none.docs.filter((d) => /\|CONVERSION\|/.test(d.sourceRef || '')).length === 3);
  return done();
};

/** The browser cut UI-NEW's first round and R-MULTI-3's fourth — and nothing else. */
const verify = async () => {
  await connect();
  const snap = await mongoose.connection.collection('e2e_snapshots').findOne({ _id: 'seed' });
  const conversions = await CoilConversion.countDocuments({});
  check(`exactly two cuts added (${snap.conversions} → ${snap.conversions + 2}) — opening and closing rows wrote nothing`,
    conversions === snap.conversions + 2, `${conversions}`);
  const rc = async (batchNo) => InventoryMovement.findOne({ txnType: TXN_TYPE.GRN_IN, batchNo }).lean();
  const uiNew = await rc('UI-NEW');
  const multi = await rc('R-MULTI-3');
  const uiRounds = await CoilConversion.find({ coilReceiptId: uiNew._id }).lean();
  const multiRounds = await CoilConversion.find({ coilReceiptId: multi._id }).sort({ conversionDate: 1, createdAt: 1 }).lean();
  check('UI-NEW: its first round, 200 kg, Partial', uiRounds.length === 1 && uiRounds[0].coilWeightKg === 200 && uiRounds[0].cuttingType === 'PARTIAL');
  check('R-MULTI-3: a fourth round of 100 kg, saved last', multiRounds.length === 4 && multiRounds[3].coilWeightKg === 100);
  const lin = await rmImsService.getCoilLineage(String(multi._id));
  check('R-MULTI-3 now reads 1,600 cut · 400 left over 4 rounds, the ledger agreeing',
    lin.rounds.length === 4 && lin.totals.cutKg === 1600 && lin.totals.remainingKg === 400 && lin.totals.reconciles === true);
  check('…and its fourth round is the one just saved', String(lin.rounds[3].conversionId) === String(multiRounds[3]._id));
  const scrap = await ScrapRecord.countDocuments({});
  check('one scrap record per new cut', scrap === snap.scrapRecords + 2, `${scrap}`);
  // Stock moved only where the two cuts took metal and added circles + scrap.
  const now = await stockSnapshot();
  const before = new Map(snap.stock.map((s) => [s.key, s.qty]));
  const changed = now.filter((s) => before.get(s.key) !== s.qty).map((s) => `${s.key} ${before.get(s.key) ?? 0} → ${s.qty}`);
  const allowed = (k) => /^(JSL202-06|JSL204-07)\|PLG01$/.test(k) || /^JSL202-06-|^JSL204-07-/.test(k)
    || k.startsWith(`${String(SCRAP_SKU_CODE).toUpperCase()}|`);
  check('stock changed only for the two coils cut, their circles and scrap', changed.length > 0 && changed.every((c) => allowed(c.split(' ')[0])), changed.join(' · '));
  const coil06 = now.find((s) => s.key === 'JSL202-06|PLG01')?.qty;
  const coil07 = now.find((s) => s.key === 'JSL204-07|PLG01')?.qty;
  check('…by exactly the weights cut: JSL202-06 −200 kg, JSL204-07 −100 kg',
    r2(before.get('JSL202-06|PLG01') - coil06) === 200 && r2(before.get('JSL204-07|PLG01') - coil07) === 100,
    `${before.get('JSL202-06|PLG01')} → ${coil06} · ${before.get('JSL204-07|PLG01')} → ${coil07}`);
  return done();
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
