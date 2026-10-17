/**
 * Fixture + database oracle for the Coil to Circle HISTORY page — its table,
 * filters and summary cards.
 *
 *   node src/scripts/e2eCoilHistoryFixture.js --seed     fresh scratch DB, coils cut through convert()
 *   node src/scripts/e2eCoilHistoryFixture.js --api      every filter, checked against the raw documents
 *   node src/scripts/e2eCoilHistoryFixture.js --bulk     8 more one-round coils, so the list runs past a page
 *   node src/scripts/e2eCoilHistoryFixture.js --verify   assert what the browser test saved, and reconcile
 *
 * Pairs with frontend/e2e/coilToCircleHistory.e2e.mjs.
 *
 * Every round is cut through rmConvertSchema + rmImsService.convert(), the same
 * path POST /rm-ims/convert takes, so stock, scrap records and SCRAP_IN are the
 * real thing. The filter checks never trust the history endpoint's own sums:
 * each expected figure is recomputed here from CoilConversion + ScrapRecord.
 *
 *   H-PLG-A   JSL204-07  2,000 kg GRN  r1 05-Mar PLG01 500 → 07-700, r2 10-Apr PLG01 700 → 07-750
 *   H-JW-B    JSL204-08  1,500 kg GRN  r1 20-Mar JW001 FULL 1,500 → 08-850
 *   H-PLG-C   JSL204-08  1,000 kg GRN  r1 02-May PLG01 400 → 08-700 + 08-850
 *   H-MAN-D   JSL204-10  1,200 kg MANUAL (no GRN)  r1 25-Mar PLG01 300 → 10-850, r2 15-Apr PLG01 300 → 10-925
 *   (one spreadsheet-era cut naming no coil — untraceable, never a row)
 *   UI-E01 / UI-F01  JSL202-06, uncut — the browser test's own coils.
 *
 * SAFETY: pinned to a localhost scratch database, which --seed drops. It never
 * reads the configured MONGO_URI, so it cannot touch the client's Atlas data.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryMovement, { TXN_TYPE, MOVEMENT_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import ScrapRecord from '../modules/inventory/scrapRecord.model.js';
import ManualCoil from '../modules/inventory/manualCoil.model.js';
import { inventoryService, combineStockRows } from '../modules/inventory/inventory.service.js';
import { rmImsService } from '../modules/inventory/rmIms.service.js';
import { rmConvertSchema, rmCuttingHistoryQuerySchema } from '../modules/inventory/rmIms.validation.js';
import { SCRAP_SKU_CODE, SCRAP_SKU_DEFAULTS } from '../modules/inventory/scrapSku.js';
import { COIL_CIRCLE_MAP } from '../data/coil-circle-map.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_coilhistory';
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eCoilHistoryFixture.js');
export const E2E_USER = { email: 'coilhistory-e2e@test.local', password: 'E2e@12345', name: 'Coil History E2E', role: 'MD' };

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
  { key: 'A', coil: 'JSL204-07', batchNo: 'H-PLG-A', weight: 2000, rate: 180, warehouse: 'PLG01' },
  { key: 'B', coil: 'JSL204-08', batchNo: 'H-JW-B', weight: 1500, rate: 190, warehouse: 'JW001' },
  { key: 'C', coil: 'JSL204-08', batchNo: 'H-PLG-C', weight: 1000, rate: 190, warehouse: 'PLG01' },
  // Grade stock for the manual coil: a manual coil still comes out of RM stock.
  { key: 'S10', coil: 'JSL204-10', batchNo: 'H-STOCK-10', weight: 3000, rate: 200, warehouse: 'PLG01' },
  // Browser only.
  { key: 'UIE', coil: 'JSL202-06', batchNo: 'UI-E01', weight: 2000, rate: 170, warehouse: 'PLG01' },
  { key: 'UIF', coil: 'JSL202-06', batchNo: 'UI-F01', weight: 1000, rate: 170, warehouse: 'JW001' },
];
export const MANUAL_BATCH = 'H-MAN-D';
export const UI_BATCH = 'UI-E01';
export const UI_FAIL_BATCH = 'UI-F01';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (!/ambika_e2e_coilhistory$/.test(mongoose.connection.name || '')) {
    throw new Error(`Connected to an unexpected database (${mongoose.connection.name}) — aborting.`);
  }
};

/** A cut, through the route's own validation and then convert(). */
const cut = async (user, payload) => {
  const { error, value } = rmConvertSchema.validate(payload, { abortEarly: false, stripUnknown: true });
  if (error) throw new Error(`fixture cut refused by validation: ${error.message}`);
  return rmImsService.convert(value, user);
};

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();

  const user = await User.create({
    ...E2E_USER, password: E2E_USER.password, mobile: '9000000031', isActive: true, roles: ['MD'],
  });
  const skus = {};
  for (const c of COILS) skus[c.code] = await SKU.create({ ...c, unit: 'KGS', itemType: 'RAW_MATERIAL', isActive: true });
  for (const c of Object.values(COIL_CIRCLE_MAP).flat()) {
    if (skus[c.code]) continue;
    skus[c.code] = await SKU.create({ code: c.code, name: c.clientLabel, unit: 'PCS', itemType: 'CIRCLE', isActive: true });
  }
  await SKU.create({ code: SCRAP_SKU_CODE, ...SCRAP_SKU_DEFAULTS, isActive: true });

  const receipts = {};
  for (const r of RECEIPTS) {
    const sku = skus[r.coil];
    await inventoryService.increaseStock({
      skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: 'KGS',
      quantity: r.weight, unitCost: r.rate, warehouse: r.warehouse,
      txnType: TXN_TYPE.GRN_IN, sourceModule: 'GRN', refType: 'GRN', refNumber: `GRN-H-${r.batchNo}`,
      batchNo: r.batchNo, vendorName: 'E2E Metals', remarks: 'Coil history e2e fixture receipt',
      performedBy: user, movementDate: new Date('2026-02-20'),
    });
    receipts[r.key] = await InventoryMovement.findOne({ batchNo: r.batchNo, txnType: TXN_TYPE.GRN_IN }).lean();
  }

  const circle = (code, pcs, weightKg) => ({ circleSkuId: String(skus[code]._id), pcs, weightKg });
  let seq = 0;
  const grnRound = (key, date, warehouse, coilWeightKg, circles, cuttingType = 'PARTIAL') => {
    const r = receipts[key];
    return cut(user, {
      // The form sends the bare calendar day, exactly like this.
      conversionDate: date, clientRequestId: `hist-${key}-${++seq}`,
      batchNo: r.batchNo, coilReceiptId: String(r._id), coilSkuId: String(r.skuId),
      coilWeightKg, rate: r.unitCost, warehouse, scrapVerified: 'PENDING', cuttingType, circles,
    });
  };

  await grnRound('A', '2026-03-05', 'PLG01', 500, [circle('JSL204-07-700', 120, 460)]);
  // Stock is held per location, so a coil is cut where it is held.
  await grnRound('A', '2026-04-10', 'PLG01', 700, [circle('JSL204-07-750', 150, 630)]);
  await grnRound('B', '2026-03-20', 'JW001', 1500, [circle('JSL204-08-850', 300, 1380)], 'FULL');
  await grnRound('C', '2026-05-02', 'PLG01', 400, [circle('JSL204-08-700', 50, 180), circle('JSL204-08-850', 40, 190)]);

  // Manual Entry — No GRN: entered with its whole weight on its first round.
  const coil10 = skus['JSL204-10'];
  await cut(user, {
    conversionDate: '2026-03-25', clientRequestId: `hist-D-${++seq}`, batchNo: MANUAL_BATCH,
    manualCoil: { batchNo: MANUAL_BATCH, totalWeightKg: 1200 }, coilSkuId: String(coil10._id),
    coilWeightKg: 300, rate: 200, warehouse: 'PLG01', scrapVerified: 'PENDING', cuttingType: 'PARTIAL',
    circles: [circle('JSL204-10-850', 60, 280)],
  });
  const mc = await ManualCoil.findOne({ batchNo: MANUAL_BATCH }).lean();
  await cut(user, {
    conversionDate: '2026-04-15', clientRequestId: `hist-D-${++seq}`, batchNo: MANUAL_BATCH,
    manualCoilId: String(mc._id), coilSkuId: String(coil10._id),
    coilWeightKg: 300, rate: 200, warehouse: 'PLG01', scrapVerified: 'PENDING', cuttingType: 'PARTIAL',
    circles: [circle('JSL204-10-925', 55, 270)],
  });

  // A spreadsheet-era cut: names no coil, so it is untraceable and never a row.
  const c08 = skus['JSL204-08'];
  await CoilConversion.create({
    conversionNumber: 'EXL/H-OLD', conversionDate: new Date('2025-01-15'), batchNo: 'H-OLD',
    coilSkuId: c08._id, coilSkuCode: c08.code, coilSkuName: c08.name,
    coilWeightKg: 600, rate: 190, circles: [], circlesWeightKg: 510, scrapKg: 90, yieldRatioPct: 85,
    scrapVerified: 'DONE', sourceRef: 'EXCEL_RM_24_25|CONVERSION|H-OLD', remarks: 'Imported history',
  });

  console.log(JSON.stringify({ ok: true, user: E2E_USER, conversions: await CoilConversion.countDocuments({}) }, null, 2));
  await mongoose.disconnect();
};

/**
 * --bulk (after --api, before the browser test): eight more coils, each cut
 * once in January, so the history runs past one page of ten. Older than every
 * seeded round, so they sort after them.
 */
export const BULK_COUNT = 8;
const bulk = async () => {
  await connect();
  const user = await User.findOne({ email: E2E_USER.email });
  const coil = await SKU.findOne({ code: 'JSL202-06' }).lean();
  const circleSku = await SKU.findOne({ code: 'JSL202-06-700' }).lean();
  for (let i = 1; i <= BULK_COUNT; i += 1) {
    const batchNo = `H-BULK-${String(i).padStart(2, '0')}`;
    await inventoryService.increaseStock({
      skuId: coil._id, skuCode: coil.code, skuName: coil.name, unit: 'KGS',
      quantity: 500, unitCost: 170, warehouse: 'PLG01',
      txnType: TXN_TYPE.GRN_IN, sourceModule: 'GRN', refType: 'GRN', refNumber: `GRN-H-${batchNo}`,
      batchNo, vendorName: 'E2E Metals', remarks: 'Coil history e2e bulk receipt',
      performedBy: user, movementDate: new Date('2025-12-20'),
    });
    const r = await InventoryMovement.findOne({ batchNo, txnType: TXN_TYPE.GRN_IN }).lean();
    await cut(user, {
      conversionDate: `2026-01-${String(10 + i).padStart(2, '0')}`, clientRequestId: `hist-bulk-${i}`,
      batchNo, coilReceiptId: String(r._id), coilSkuId: String(coil._id),
      coilWeightKg: 200, rate: 170, warehouse: 'PLG01', scrapVerified: 'PENDING', cuttingType: 'PARTIAL',
      circles: [{ circleSkuId: String(circleSku._id), pcs: 40, weightKg: 180 }],
    });
  }
  console.log(JSON.stringify({ ok: true, bulkCoils: BULK_COUNT, conversions: await CoilConversion.countDocuments({}) }));
  await mongoose.disconnect();
};

// ── Checks ──────────────────────────────────────────────────────────────────
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const batches = (h) => h.docs.map((d) => d.batchNo).sort();

/**
 * THE INDEPENDENT ORACLE: the traceable rounds, read raw, with their location
 * from their own ScrapRecord and their coil's batch from its receipt/entry.
 */
const rawRounds = async () => {
  const convs = await CoilConversion.find({
    isDeleted: { $ne: true },
    $or: [{ coilReceiptId: { $ne: null } }, { manualCoilId: { $ne: null } }],
  }).lean();
  const scraps = new Map((await ScrapRecord.find({ conversionId: { $in: convs.map((c) => c._id) } }).lean())
    .map((s) => [String(s.conversionId), s]));
  const receipts = new Map((await InventoryMovement.find({ _id: { $in: convs.map((c) => c.coilReceiptId).filter(Boolean) } }).lean())
    .map((r) => [String(r._id), r]));
  const manuals = new Map((await ManualCoil.find({ _id: { $in: convs.map((c) => c.manualCoilId).filter(Boolean) } }).lean())
    .map((m) => [String(m._id), m]));
  return convs.map((c) => {
    const coil = c.coilReceiptId ? receipts.get(String(c.coilReceiptId)) : manuals.get(String(c.manualCoilId));
    return {
      coilKey: String(c.coilReceiptId || c.manualCoilId),
      batchNo: coil?.batchNo || '',
      manual: !c.coilReceiptId,
      day: new Date(c.conversionDate.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10), // IST calendar day
      location: scraps.get(String(c._id))?.location || null,
      circleIds: (c.circles || []).map((x) => String(x.circleSkuId)),
      cutKg: c.coilWeightKg,
      circlesKg: c.circlesWeightKg,
      pcs: (c.circles || []).reduce((s, x) => s + (x.pcs || 0), 0),
      scrapKg: c.scrapKg,
    };
  });
};

/** What a filter SHOULD return, from the raw rounds. */
const expectFor = (rounds, f = {}) => {
  const hit = (r) => (!f.from || r.day >= f.from) && (!f.to || r.day <= f.to)
    && (!f.location || r.location === f.location) && (!f.circleSkuId || r.circleIds.includes(f.circleSkuId));
  const matched = rounds.filter(hit);
  const coils = new Set(matched.map((r) => r.coilKey));
  const sum = (k) => round2(matched.reduce((s, r) => s + r[k], 0));
  return {
    batches: [...new Set(rounds.filter((r) => coils.has(r.coilKey)).map((r) => r.batchNo))].sort(),
    rounds: matched.length, cutKg: sum('cutKg'), circlesKg: sum('circlesKg'), pcs: sum('pcs'), scrapKg: sum('scrapKg'),
  };
};

const filterChecks = async (label, skus) => {
  const rounds = await rawRounds();
  const hist = (q) => rmImsService.listCuttingHistory({ limit: 200, ...q });
  const circleId = (code) => String(skus[code]._id);

  const cases = [
    ['no filter', {}],
    ['date 01-Mar → 31-Mar', { from: '2026-03-01', to: '2026-03-31' }],
    ['one day, 05-Mar (IST day boundary)', { from: '2026-03-05', to: '2026-03-05' }],
    ['from 11-Apr onwards', { from: '2026-04-11' }],
    ['up to 04-Mar (before every round)', { to: '2026-03-04' }],
    ['location JW001', { location: 'JW001' }],
    ['location PLG01', { location: 'PLG01' }],
    ['circle JSL204-08-850', { circleSkuId: circleId('JSL204-08-850') }],
    ['circle JSL204-07-750', { circleSkuId: circleId('JSL204-07-750') }],
    ['JW001 + March (same round)', { location: 'JW001', from: '2026-03-01', to: '2026-03-31' }],
    ['circle 07-750 + March (A made 750s in April, 700s in March → none)', { circleSkuId: circleId('JSL204-07-750'), from: '2026-03-01', to: '2026-03-31' }],
    ['JW001 + circle 08-850 → B, not C', { location: 'JW001', circleSkuId: circleId('JSL204-08-850') }],
    ['PLG01 + circle 08-850 + May', { location: 'PLG01', circleSkuId: circleId('JSL204-08-850'), from: '2026-05-01', to: '2026-05-31' }],
  ];
  console.log(`\n${label} — round-level filters vs the raw documents`);
  for (const [name, f] of cases) {
    const h = await hist(f);
    const e = expectFor(rounds, f);
    const m = h.summary.matching;
    check(`${name}: coils`, same(batches(h), e.batches), `${batches(h).join(',') || '∅'} vs ${e.batches.join(',') || '∅'}`);
    check(`${name}: matching rounds / cut / circles / pcs / scrap`,
      m.rounds === e.rounds && m.cutKg === e.cutKg && m.circlesKg === e.circlesKg && m.circlesPcs === e.pcs && m.scrapKg === e.scrapKg,
      `${m.rounds}/${m.cutKg}/${m.circlesKg}/${m.circlesPcs}/${m.scrapKg} vs ${e.rounds}/${e.cutKg}/${e.circlesKg}/${e.pcs}/${e.scrapKg}`);
    check(`${name}: per-row matchedRounds add up to the summary`, h.docs.reduce((s, d) => s + d.matchedRounds, 0) === m.rounds);
    check(`${name}: count = rows`, h.summary.pagination.total === h.docs.length && h.summary.coils === h.docs.length);
    // Rows always carry the WHOLE coil — never only its matching rounds.
    const whole = h.docs.every((d) => {
      const all = rounds.filter((r) => r.batchNo === d.batchNo);
      return d.rounds === all.length && d.cutKg === round2(all.reduce((s, r) => s + r.cutKg, 0));
    });
    check(`${name}: each row still shows the whole coil`, whole);
  }
  // JW001 matching scrap is all job-work scrap, PLG01 all plant scrap.
  const jw = await hist({ location: 'JW001' });
  check('JW001 filter: matching scrap is all with the job worker', jw.summary.matching.jobWorkScrapKg === jw.summary.matching.scrapKg && jw.summary.matching.plantScrapKg === 0);
  const plg = await hist({ location: 'PLG01' });
  check('PLG01 filter: matching scrap is all plant scrap', plg.summary.matching.plantScrapKg === plg.summary.matching.scrapKg && plg.summary.matching.jobWorkScrapKg === 0);
  return rounds;
};

const loadSkus = async () => {
  const skus = {};
  for (const s of await SKU.find({}).lean()) skus[s.code] = s;
  return skus;
};

const api = async () => {
  await connect();
  const skus = await loadSkus();
  const rounds = await filterChecks('SEEDED DATA', skus);
  const hist = (q) => rmImsService.listCuttingHistory({ limit: 200, ...q });

  console.log('\nCoil-level filters, rows and totals');
  const all = await hist({});
  check('4 physical coils, 6 rounds (the untraceable cut is not a row)', all.summary.coils === 4 && all.summary.rounds === 6, `${all.summary.coils}/${all.summary.rounds}`);
  check('untraceable cut counted, not shown', all.summary.untraceable.records === 1 && all.summary.untraceable.cutKg === 600);
  check('no filter: matching totals = coil totals', all.summary.roundFiltered === false
    && all.summary.matching.cutKg === all.summary.cutKg && all.summary.matching.scrapKg === all.summary.scrapKg);
  check('total cut = Σ every traceable round (no coil weight double-counted)',
    all.summary.cutKg === round2(rounds.reduce((s, r) => s + r.cutKg, 0)), String(all.summary.cutKg));
  check('scrap split adds up', round2(all.summary.plantScrapKg + all.summary.jobWorkScrapKg) === all.summary.scrapKg);

  const a = all.docs.find((d) => d.batchNo === 'H-PLG-A');
  check('H-PLG-A: 2,000 total · 1,200 cut · 800 remaining · 2 rounds · PLG01',
    a && a.receivedKg === 2000 && a.cutKg === 1200 && a.remainingKg === 800 && a.rounds === 2 && a.location === 'PLG01' && a.status === 'PARTIALLY_CUT',
    a && `${a.receivedKg}/${a.cutKg}/${a.remainingKg}/${a.rounds}/${a.location}/${a.status}`);
  check('H-PLG-A: circles 270 pcs, sizes 07-700 + 07-750', a && a.circlesPcs === 270 && same(a.circleSkuCodes, ['JSL204-07-700', 'JSL204-07-750']));
  check('H-PLG-A: GRN number carried', a && a.grnNo === 'GRN-H-H-PLG-A' && a.coilSource === 'GRN');
  const b = all.docs.find((d) => d.batchNo === 'H-JW-B');
  check('H-JW-B: fully cut, 0 remaining, JW001', b && b.status === 'FULLY_CUT' && b.remainingKg === 0 && b.location === 'JW001');
  const d = all.docs.find((x) => x.batchNo === MANUAL_BATCH);
  check('H-MAN-D: manual, 1,200 total, 600 remaining, no GRN', d && d.coilSource === 'MANUAL' && d.receivedKg === 1200 && d.remainingKg === 600 && d.grnNo === '');

  check('batch "plg" (partial, any case) → A and C', same(batches(await hist({ batchNo: 'plg' })), ['H-PLG-A', 'H-PLG-C']));
  check('batch "H-JW-B" (exact) → B', same(batches(await hist({ batchNo: 'H-JW-B' })), ['H-JW-B']));
  check('batch "nope" → nothing, and says 0', (await hist({ batchNo: 'nope' })).summary.pagination.total === 0);
  check('entry type MANUAL → D only', same(batches(await hist({ entryType: 'MANUAL' })), [MANUAL_BATCH]));
  check('entry type GRN → A, B, C', same(batches(await hist({ entryType: 'GRN' })), ['H-JW-B', 'H-PLG-A', 'H-PLG-C']));
  check('status FULLY_CUT → B', same(batches(await hist({ status: 'FULLY_CUT' })), ['H-JW-B']));
  check('status PARTIALLY_CUT → A, C, D', same(batches(await hist({ status: 'PARTIALLY_CUT' })), [MANUAL_BATCH, 'H-PLG-A', 'H-PLG-C']));
  check('batch + location + date combine (plg + PLG01 + April → A)',
    same(batches(await hist({ batchNo: 'plg', location: 'PLG01', from: '2026-04-01', to: '2026-04-30' })), ['H-PLG-A']));
  check('batch + location combine to nothing (plg + JW001)', (await hist({ batchNo: 'plg', location: 'JW001' })).docs.length === 0);
  check('search by coil SKU still works (JSL204-08 → B, C)', same(batches(await hist({ search: 'JSL204-08' })), ['H-JW-B', 'H-PLG-C']));

  // Order (latest cut first) and pagination.
  check('newest cut first: C, D, A, B', same(all.docs.map((x) => x.batchNo), ['H-PLG-C', MANUAL_BATCH, 'H-PLG-A', 'H-JW-B']), all.docs.map((x) => x.batchNo).join(','));
  const p2 = await rmImsService.listCuttingHistory({ page: 2, limit: 2 });
  check('page 2 of 2 per page → A, B; total still 4', same(p2.docs.map((x) => x.batchNo), ['H-PLG-A', 'H-JW-B']) && p2.summary.pagination.total === 4);
  const p2f = await rmImsService.listCuttingHistory({ page: 2, limit: 1, location: 'PLG01' });
  check('pagination respects filters (PLG01, 1 per page, page 2)', p2f.docs.length === 1 && p2f.summary.pagination.total === 3);

  console.log('\nCircle SKU filter options');
  const circles = await rmImsService.listCuttingHistoryCircles();
  check('exactly the 6 circle SKUs traceable rounds produced', same(circles.map((c) => c.skuCode),
    ['JSL204-07-700', 'JSL204-07-750', 'JSL204-08-700', 'JSL204-08-850', 'JSL204-10-850', 'JSL204-10-925']), circles.map((c) => c.skuCode).join(','));
  check('08-850 came from 2 rounds', circles.find((c) => c.skuCode === 'JSL204-08-850')?.rounds === 2);
  check('every option is a CIRCLE SKU, never a coil', circles.every((c) => skus[c.skuCode]?.itemType === 'CIRCLE'));

  console.log('\nValidation (the route\'s own schema)');
  const v = (q) => rmCuttingHistoryQuerySchema.validate(q);
  check('From after To is refused', /From date cannot be after To date/.test(v({ from: '2026-04-01', to: '2026-03-01' }).error?.message || ''));
  check('bad date is refused', !!v({ from: '2026/03/01' }).error);
  check('bad circle id is refused', !!v({ circleSkuId: 'abc' }).error);

  await reconcile();
  await finish();
};

/** Coil, circle and scrap stock all reconcile with the rounds. */
const reconcile = async () => {
  console.log('\nStock reconciliation');
  const stockOf = async (skuId, warehouse) => {
    const rows = await InventoryStock.find(warehouse ? { skuId, warehouse } : { skuId }).lean();
    return round2(combineStockRows(rows)?.qtyOnHand || 0);
  };
  const ledger = async (skuId) => {
    const [g] = await InventoryMovement.aggregate([
      { $match: { skuId, isDeleted: { $ne: true } } },
      { $group: { _id: null, i: { $sum: { $cond: [{ $eq: ['$movementType', MOVEMENT_TYPE.IN] }, '$quantity', 0] } }, o: { $sum: { $cond: [{ $eq: ['$movementType', MOVEMENT_TYPE.OUT] }, '$quantity', 0] } } } },
    ]);
    return round2((g?.i || 0) - (g?.o || 0));
  };
  const convs = await CoilConversion.find({ isDeleted: { $ne: true }, sourceRef: { $exists: false } }).lean();
  for (const c of COILS) {
    const sku = await SKU.findOne({ code: c.code }).lean();
    const received = round2((await InventoryMovement.find({ skuId: sku._id, txnType: TXN_TYPE.GRN_IN }).lean())
      .reduce((s, r) => s + r.quantity, 0));
    const cutKg = round2(convs.filter((x) => String(x.coilSkuId) === String(sku._id)).reduce((s, x) => s + x.coilWeightKg, 0));
    const stock = await stockOf(sku._id);
    check(`${c.code}: stock = received − cut = ledger`, stock === round2(received - cutKg) && stock === await ledger(sku._id), `${stock} = ${received} − ${cutKg}`);
  }
  const pcsBySku = new Map();
  for (const x of convs) for (const ci of x.circles) pcsBySku.set(String(ci.circleSkuId), (pcsBySku.get(String(ci.circleSkuId)) || 0) + ci.pcs);
  let circlesOk = true;
  for (const [id, pcs] of pcsBySku) if (await stockOf(new mongoose.Types.ObjectId(id)) !== pcs) circlesOk = false;
  check('every circle SKU\'s stock = pieces produced', circlesOk, `${pcsBySku.size} circle SKUs`);

  const scraps = await ScrapRecord.find({ conversionId: { $in: convs.map((x) => x._id) } }).lean();
  check('one scrap record per cut', scraps.length === convs.length, `${scraps.length}/${convs.length}`);
  const plgScrap = round2(scraps.filter((s) => s.location === 'PLG01').reduce((s, r) => s + r.scrapKg, 0));
  const scrapSku = await SKU.findOne({ code: SCRAP_SKU_CODE }).lean();
  const scrapIn = await InventoryMovement.find({ skuId: scrapSku._id, txnType: TXN_TYPE.SCRAP_IN, isDeleted: { $ne: true } }).lean();
  check('PLG01 scrap → SCRAP_IN, JW001 scrap → none', round2(scrapIn.reduce((s, m) => s + m.quantity, 0)) === plgScrap
    && scrapIn.length === scraps.filter((s) => s.location === 'PLG01').length,
  `${scrapIn.length} SCRAP_IN = ${plgScrap} kg`);
  check('scrap stock = PLG01 scrap only', await stockOf(scrapSku._id) === plgScrap);
};

/** After the browser test: what it saved, and what it must NOT have saved. */
const verify = async () => {
  await connect();
  const skus = await loadSkus();
  console.log('\nWHAT THE BROWSER TEST SAVED');
  const ui = await CoilConversion.find({ batchNo: UI_BATCH, isDeleted: { $ne: true } }).lean();
  check(`${UI_BATCH}: exactly ONE round (double-click did not duplicate)`, ui.length === 1, String(ui.length));
  const r = ui[0];
  const rc = await InventoryMovement.findOne({ batchNo: UI_BATCH, txnType: TXN_TYPE.GRN_IN }).lean();
  check(`${UI_BATCH}: linked to its receipt, 600 kg partial, 1 circle line`, r && String(r.coilReceiptId) === String(rc._id)
    && r.coilWeightKg === 600 && r.cuttingType === 'PARTIAL' && r.circles.length === 1 && r.circles[0].pcs === 100 && r.circles[0].weightKg === 550,
  r && `${r.coilWeightKg}/${r.cuttingType}/${r.circles.length}`);
  const sr = r && await ScrapRecord.findOne({ conversionId: r._id }).lean();
  check(`${UI_BATCH}: scrap 50 kg recorded at PLG01 (its GRN location)`, sr && sr.location === 'PLG01' && sr.scrapKg === 50);
  check(`${UI_FAIL_BATCH}: the failed save wrote nothing`, (await CoilConversion.countDocuments({ batchNo: UI_FAIL_BATCH })) === 0
    && (await InventoryMovement.countDocuments({ batchNo: UI_FAIL_BATCH, txnType: TXN_TYPE.CONVERT_OUT })) === 0);
  const h = await rmImsService.listCuttingHistory({ batchNo: UI_BATCH });
  check(`${UI_BATCH}: in the history — 2,000 total, 600 cut, 1,400 remaining, partially cut`,
    h.docs.length === 1 && h.docs[0].receivedKg === 2000 && h.docs[0].cutKg === 600 && h.docs[0].remainingKg === 1400 && h.docs[0].status === 'PARTIALLY_CUT');
  await filterChecks('AFTER THE BROWSER TEST', skus);
  await reconcile();
  await finish();
};

const finish = async () => {
  const failed = results.filter((x) => !x.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await mongoose.disconnect();
  process.exit(failed.length ? 1 : 0);
};

if (isEntry(import.meta.url)) {
  const mode = process.argv[2];
  const run = { '--seed': seed, '--api': api, '--bulk': bulk, '--verify': verify }[mode];
  if (!run) { console.error('Usage: --seed | --api | --bulk | --verify'); process.exit(2); }
  run().catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => {}); process.exit(1); });
}
