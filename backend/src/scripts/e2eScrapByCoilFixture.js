/**
 * Fixture + database oracle for the "Scrap by physical coil" screen.
 *
 *   node src/scripts/e2eScrapByCoilFixture.js --seed     fresh scratch DB + masters + 2 demo coils
 *   node src/scripts/e2eScrapByCoilFixture.js --cut      drive rmImsService.convert() for each round
 *   node src/scripts/e2eScrapByCoilFixture.js --verify   assert what the screen's own services return
 *   node src/scripts/e2eScrapByCoilFixture.js --dump     print the screen's payload as JSON
 *   node src/scripts/e2eScrapByCoilFixture.js --drop     delete the scratch database
 *
 * Modelled on e2eCutCoilsFixture.js, which is the established pattern in this
 * repo for exercising a stock-moving flow without going near the client's data.
 *
 * SAFETY: pinned to a localhost scratch database, which --seed drops and
 * recreates. It never reads the configured MONGO_URI, so it cannot reach the
 * client's Atlas cluster — which matters here because a conversion MOVES STOCK.
 *
 * NOTHING in this file hand-builds a CoilConversion or a ScrapRecord for a demo
 * coil. Every demo coil is received through inventoryService.increaseStock as a
 * GRN_IN, and every cutting round goes through rmImsService.convert(), which is
 * the same call POST /rm-ims/convert makes. That is the point: if the demo rows
 * appear on the screen, they appear for the same reason production rows would.
 */
import mongoose from 'mongoose';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryMovement, { TXN_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import ScrapRecord from '../modules/inventory/scrapRecord.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import { inventoryService } from '../modules/inventory/inventory.service.js';
import { rmImsService } from '../modules/inventory/rmIms.service.js';
import { scrapImsService } from '../modules/inventory/scrapIms.service.js';
import { SCRAP_SKU_CODE, SCRAP_SKU_DEFAULTS } from '../modules/inventory/scrapSku.js';
import { COIL_CIRCLE_MAP } from '../data/coil-circle-map.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_scrapcoil';
export const E2E_USER = {
  email: 'scrap-coil-e2e@test.local', password: 'E2e@12345', name: 'Scrap By Coil E2E', role: 'MD',
};

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(E2E_URI)) {
  console.error('Refusing to run: fixture must target localhost.');
  process.exit(1);
}

/** The two coil grades the demo uses. Real client codes — the map is keyed by code. */
const COILS = [
  { code: 'JSL204-07', name: 'Cu 0.70 mm', category: 'Copper' },
  { code: 'JSL204-08', name: 'Cu 0.80 mm', category: 'Copper' },
];

/**
 * The two PHYSICAL coils. Each one is a GRN_IN movement — that movement IS the
 * physical coil, and its _id is what `coilReceiptId` points at and what the
 * by-coil aggregation groups on.
 */
const RECEIPTS = [
  {
    key: 'C1',
    coil: 'JSL204-07',
    batchNo: 'DEMO-COIL-001',
    grnNo: 'GRN-DEMO-001',
    weight: 2000,
    rate: 185,
    warehouse: 'PLG01',
    supplier: 'Demo Supplier',
  },
  {
    key: 'C2',
    coil: 'JSL204-08',
    batchNo: 'DEMO-COIL-002',
    grnNo: 'GRN-DEMO-002',
    weight: 2500,
    rate: 192,
    warehouse: 'JW001',
    supplier: 'Demo Supplier',
  },
];

/**
 * The cutting rounds. Circle codes are taken from the client's approved
 * coil to circle mapping, because convert() enforces it before it moves any
 * stock — an invented circle code would be refused, not displayed.
 *
 * scrapKg is NOT supplied: convert() derives it as coilWeight minus the sum of
 * the circle weights. The piece counts are what the circles are stocked in; the
 * weights are what yield and scrap are worked out from.
 */
const ROUNDS = [
  {
    receipt: 'C1', day: '2026-09-14', coilWeightKg: 800,
    circles: [
      { code: 'JSL204-07-700', pcs: 900, weightKg: 400 },
      { code: 'JSL204-07-750', pcs: 560, weightKg: 280 },
    ],
  },
  {
    receipt: 'C1', day: '2026-09-21', coilWeightKg: 500,
    circles: [
      { code: 'JSL204-07-840', pcs: 620, weightKg: 425 },
    ],
  },
  {
    receipt: 'C2', day: '2026-09-18', coilWeightKg: 1000,
    circles: [
      { code: 'JSL204-08-850', pcs: 1100, weightKg: 500 },
      { code: 'JSL204-08-900', pcs: 640, weightKg: 320 },
    ],
  },
];

/** What the screen must show, stated up front so --verify is a real assertion. */
const EXPECTED = {
  'DEMO-COIL-001': {
    receivedKg: 2000, cutKg: 1300, circlesKg: 1105, scrapKg: 195,
    scrapPct: 15, avgYieldPct: 85, remainingKg: 700, rounds: 2,
    skuCode: 'JSL204-07', grnNo: 'GRN-DEMO-001', supplier: 'Demo Supplier', locations: ['PLG01'],
  },
  'DEMO-COIL-002': {
    receivedKg: 2500, cutKg: 1000, circlesKg: 820, scrapKg: 180,
    scrapPct: 18, avgYieldPct: 82, remainingKg: 1500, rounds: 1,
    skuCode: 'JSL204-08', grnNo: 'GRN-DEMO-002', supplier: 'Demo Supplier', locations: ['JW001'],
  },
};

/**
 * A stand-in for the untraceable bucket.
 *
 * The client's screen reports 246,779.3 kg of scrap that names a batch number
 * and no goods receipt. None of that history exists in a scratch database, and
 * without it this fixture could not show the thing worth seeing: the demo coils
 * appearing BESIDE a large untraceable figure rather than instead of it.
 *
 * So the bucket is reproduced to the same total, as records with
 * `coilReceiptId: null` — which is precisely what makes real history
 * untraceable. These are synthetic, and they are the only documents in this
 * file not written through a service. They are inserted directly BECAUSE they
 * must have no receipt behind them: there is no app path that produces an
 * orphan cut any more, which is the whole point of the feature being verified.
 */
const UNTRACEABLE_TOTAL_KG = 246779.3;
const UNTRACEABLE_ROWS = 481;        // the client's historical conversion count
const UNTRACEABLE_JW_SHARE = 0.9314; // mirrors the real 229,774 / 246,679 split

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (!/ambika_e2e_scrapcoil$/.test(mongoose.connection.name || '')) {
    throw new Error(`Connected to an unexpected database (${mongoose.connection.name}) — aborting.`);
  }
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : (detail ? ` — ${detail}` : '')}`);
};
const eq = (name, actual, expected) => check(
  name, actual === expected, `expected ${expected}, got ${actual}`,
);

/* ══ --seed ════════════════════════════════════════════════════════════════ */

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();

  const user = await User.create({
    ...E2E_USER, password: E2E_USER.password, mobile: '9000000007', isActive: true, roles: ['MD'],
  });

  const skus = {};
  for (const c of COILS) {
    skus[c.code] = await SKU.create({ ...c, unit: 'KGS', itemType: 'RAW_MATERIAL', isActive: true });
  }
  // Every circle the two demo coils are approved to produce, from the client's
  // own mapping — so convert() finds them and the mapping guard is exercised.
  for (const coilCode of COILS.map((c) => c.code)) {
    for (const circle of COIL_CIRCLE_MAP[coilCode] || []) {
      if (skus[circle.code]) continue;
      skus[circle.code] = await SKU.create({
        code: circle.code, name: circle.clientLabel, category: 'Circles',
        unit: 'PCS', itemType: 'CIRCLE', isActive: true,
      });
    }
  }
  // An in-house (PLG01) cut posts its offcut into scrap stock, so the scrap
  // item must exist or the cut fails for an unrelated reason.
  await SKU.create({ code: SCRAP_SKU_CODE, ...SCRAP_SKU_DEFAULTS, isActive: true });

  // The physical coils, posted through the real stock engine as GRN_IN — the
  // same movements getScrapByCoil joins back to for "Received".
  const receipts = {};
  for (const r of RECEIPTS) {
    const sku = skus[r.coil];
    const { movement } = await inventoryService.increaseStock({
      skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: 'KGS',
      quantity: r.weight, unitCost: r.rate, warehouse: r.warehouse,
      txnType: TXN_TYPE.GRN_IN, sourceModule: 'GRN',
      refType: 'GRN', refNumber: r.grnNo,
      vendorName: r.supplier, poNumber: `PO-${r.grnNo}`,
      batchNo: r.batchNo,
      remarks: 'Scrap-by-coil demo receipt',
      performedBy: user, movementDate: new Date('2026-09-10T06:00:00.000Z'),
    });
    receipts[r.key] = { id: String(movement._id), movementNumber: movement.movementNumber, ...r };
  }

  await seedUntraceable(user, skus);

  console.log(JSON.stringify({
    ok: true, db: mongoose.connection.name, user: E2E_USER,
    receipts: Object.values(receipts).map((r) => ({
      key: r.key, batchNo: r.batchNo, grnNo: r.grnNo, coil: r.coil,
      receivedKg: r.weight, warehouse: r.warehouse, coilReceiptId: r.id,
      movementNumber: r.movementNumber,
    })),
  }, null, 2));
  await mongoose.disconnect();
};

const seedUntraceable = async (user, skus) => {
  const coilSku = skus['JSL204-08'];
  const perRow = UNTRACEABLE_TOTAL_KG / UNTRACEABLE_ROWS;
  const rows = [];
  let running = 0;
  for (let i = 0; i < UNTRACEABLE_ROWS; i += 1) {
    const last = i === UNTRACEABLE_ROWS - 1;
    // The last row absorbs the rounding so the bucket totals exactly.
    const scrapKg = last ? round2(UNTRACEABLE_TOTAL_KG - running) : round2(perRow);
    running = round2(running + scrapKg);
    const coilWeightKg = round2(scrapKg / 0.15);           // ~85% yield
    const circlesWeightKg = round2(coilWeightKg - scrapKg);
    rows.push({
      sourceRef: `E2E_DEMO_UNTRACEABLE|SCRAP|${i + 1}`,
      batchNo: `HIST-${String(i + 1).padStart(4, '0')}`,
      scrapDate: new Date(2025, i % 12, (i % 27) + 1),
      location: (i / UNTRACEABLE_ROWS) < UNTRACEABLE_JW_SHARE ? 'JW001' : 'PLG01',
      coilSkuId: coilSku._id, coilSkuCode: coilSku.code, coilSkuName: coilSku.name,
      coilWeightKg, circlesWeightKg, scrapKg,
      yieldRatioPct: round2((circlesWeightKg / coilWeightKg) * 100),
      disposition: 'JOB_WORK', coilRate: 180, batchStatus: 'CUT',
      conversionId: null, conversionNumber: '',
      // The whole reason these are untraceable.
      coilReceiptId: null, stockMovementId: null,
      remarks: 'E2E DEMO stand-in for imported history — names a batch, no goods receipt.',
      createdBy: user?._id,
    });
  }
  await ScrapRecord.insertMany(rows, { ordered: false });
};

/* ══ --cut ════════════════════════════════════════════════════════════════ */

const cut = async () => {
  await connect();
  const user = await User.findOne({ email: E2E_USER.email }).lean();
  if (!user) throw new Error('Run --seed first.');

  const receipts = {};
  for (const r of RECEIPTS) {
    const m = await InventoryMovement.findOne({
      batchNo: r.batchNo, txnType: TXN_TYPE.GRN_IN, isDeleted: { $ne: true },
    }).lean();
    if (!m) throw new Error(`Receipt for ${r.batchNo} not found. Run --seed first.`);
    receipts[r.key] = m;
  }

  const out = [];
  for (const [i, rd] of ROUNDS.entries()) {
    const receipt = receipts[rd.receipt];
    const spec = RECEIPTS.find((r) => r.key === rd.receipt);
    const circleSkus = await SKU.find({ code: { $in: rd.circles.map((c) => c.code) } })
      .select('code name').lean();
    const byCode = new Map(circleSkus.map((s) => [s.code, s]));

    // The same payload POST /rm-ims/convert validates and hands to the service.
    const saved = await rmImsService.convert({
      conversionDate: new Date(`${rd.day}T06:00:00.000Z`),
      clientRequestId: `e2e-scrap-coil-round-${i + 1}`,
      batchNo: receipt.batchNo,
      coilSkuId: String(receipt.skuId),
      // THE link that makes this coil traceable.
      coilReceiptId: String(receipt._id),
      coilWeightKg: rd.coilWeightKg,
      warehouse: spec.warehouse,
      circles: rd.circles.map((c) => {
        const sku = byCode.get(c.code);
        if (!sku) throw new Error(`Circle SKU ${c.code} missing. Run --seed first.`);
        return {
          circleSkuId: String(sku._id), sizeLabel: sku.name,
          pcs: c.pcs, weightKg: c.weightKg,
        };
      }),
      remarks: 'Scrap-by-coil demo cutting round',
    }, user);

    out.push({
      round: i + 1, batchNo: receipt.batchNo,
      conversionNumber: saved.conversionNumber,
      cutKg: saved.coilWeightKg, circlesKg: saved.circlesWeightKg,
      scrapKg: saved.scrapKg, yieldPct: saved.yieldRatioPct,
      coilReceiptId: String(saved.coilReceiptId || ''),
      receiptBinding: saved.receiptBinding,
    });
  }

  console.log(JSON.stringify({ ok: true, rounds: out }, null, 2));
  await mongoose.disconnect();
};

/* ══ --verify ═════════════════════════════════════════════════════════════ */

const verify = async () => {
  await connect();
  console.log('\nScrap by physical coil — database oracle\n');

  /* ── The screen's own service call, unfiltered ── */
  const { docs, summary } = await scrapImsService.getScrapByCoil({ page: 1, limit: 50 });
  console.log('— list —');
  eq('two physical coils are traced', summary.traced.coils, 2);
  eq('untraceable bucket is intact', round2(summary.untraceable.scrapKg), UNTRACEABLE_TOTAL_KG);
  eq('untraceable record count', summary.untraceable.records, UNTRACEABLE_ROWS);

  const byBatch = new Map(docs.map((d) => [d.batchNo, d]));
  for (const [batchNo, e] of Object.entries(EXPECTED)) {
    const row = byBatch.get(batchNo);
    console.log(`\n— ${batchNo} —`);
    if (!row) { check(`${batchNo} appears in the table`, false, 'row missing'); continue; }
    check(`${batchNo} appears in the table`, true);
    eq(`${batchNo} item code`, row.skuCode, e.skuCode);
    eq(`${batchNo} received`, row.receivedKg, e.receivedKg);
    eq(`${batchNo} cut`, row.cutKg, e.cutKg);
    eq(`${batchNo} output`, row.circlesKg, e.circlesKg);
    eq(`${batchNo} scrap`, row.scrapKg, e.scrapKg);
    eq(`${batchNo} scrap %`, row.scrapPct, e.scrapPct);
    eq(`${batchNo} yield %`, row.avgYieldPct, e.avgYieldPct);
    eq(`${batchNo} remaining`, row.remainingKg, e.remainingKg);
    eq(`${batchNo} rounds`, row.rounds, e.rounds);
    eq(`${batchNo} supplier`, row.supplier, e.supplier);
    eq(`${batchNo} GRN`, row.grnNo, e.grnNo);
    eq(`${batchNo} cut location`, row.locations.join(','), e.locations.join(','));
    check(`${batchNo} has a receipt behind it`, row.receiptMissing === false);
  }

  /* ── Drill-down: click the row ── */
  const c1 = byBatch.get('DEMO-COIL-001');
  const c2 = byBatch.get('DEMO-COIL-002');
  console.log('\n— drill-down /rm-ims/coil/:receiptId/lineage —');
  if (c1) {
    const lin = await rmImsService.getCoilLineage(String(c1.coilReceiptId));
    eq('DEMO-COIL-001 lineage: round count', lin.rounds.length, 2);
    eq('DEMO-COIL-001 lineage: batch', lin.receipt.batchNo, 'DEMO-COIL-001');
    eq('DEMO-COIL-001 lineage: received', lin.receipt.receivedWeightKg, 2000);
    eq('DEMO-COIL-001 lineage: totals scrap', lin.totals.scrapKg, 195);
    eq('DEMO-COIL-001 lineage: totals remaining', lin.totals.remainingKg, 700);
    eq('DEMO-COIL-001 lineage: weighted yield', lin.totals.avgYieldPct, 85);
    // Chronological, and numbered by position in that order.
    const r1 = lin.rounds[0]; const r2 = lin.rounds[1];
    eq('round 1 is numbered 1', r1?.roundNo, 1);
    eq('round 1 cut', r1?.cutKg, 800);
    eq('round 1 scrap', r1?.scrapKg, 120);
    eq('round 1 yield', r1?.yieldPct, 85);
    eq('round 1 remaining after', r1?.remainingAfterKg, 1200);
    eq('round 2 is numbered 2', r2?.roundNo, 2);
    eq('round 2 cut', r2?.cutKg, 500);
    eq('round 2 scrap', r2?.scrapKg, 75);
    eq('round 2 remaining after', r2?.remainingAfterKg, 700);
    check('rounds are in date order',
      new Date(r1?.date).getTime() <= new Date(r2?.date).getTime());
    // Isolation: nothing from the other coil leaked in.
    const convs = await CoilConversion.find({ coilReceiptId: c1.coilReceiptId })
      .select('batchNo').lean();
    check('every round belongs to DEMO-COIL-001 only',
      convs.length === 2 && convs.every((x) => x.batchNo === 'DEMO-COIL-001'),
      convs.map((x) => x.batchNo).join(','));
  }
  if (c2) {
    const lin2 = await rmImsService.getCoilLineage(String(c2.coilReceiptId));
    eq('DEMO-COIL-002 lineage: round count', lin2.rounds.length, 1);
    eq('DEMO-COIL-002 lineage: remaining', lin2.totals.remainingKg, 1500);
    eq('DEMO-COIL-002 lineage: yield', lin2.totals.avgYieldPct, 82);
    check('DEMO-COIL-002 is a different receipt from DEMO-COIL-001',
      String(c1?.coilReceiptId) !== String(c2.coilReceiptId));
  }

  /* ── Search and filter, through the same service the screen calls ── */
  console.log('\n— search & filter —');
  const sBatch = await scrapImsService.getScrapByCoil({ search: 'DEMO-COIL-001' });
  eq('search by batch number returns 1 coil', sBatch.docs.length, 1);
  eq('search by batch number returns the right coil', sBatch.docs[0]?.batchNo, 'DEMO-COIL-001');
  eq('search by batch number drops the untraceable bucket', sBatch.summary.untraceable.records, 0);

  const sCode = await scrapImsService.getScrapByCoil({ search: 'JSL204-07' });
  eq('search by coil code returns 1 coil', sCode.docs.length, 1);
  eq('search by coil code returns the right coil', sCode.docs[0]?.batchNo, 'DEMO-COIL-001');

  const sPrefix = await scrapImsService.getScrapByCoil({ search: 'DEMO-COIL' });
  eq('search "DEMO-COIL" returns both coils', sPrefix.docs.length, 2);

  const fPlg = await scrapImsService.getScrapByCoil({ location: 'PLG01' });
  eq('PLG01 filter shows only the in-house coil',
    fPlg.docs.map((d) => d.batchNo).join(','), 'DEMO-COIL-001');
  const fJw = await scrapImsService.getScrapByCoil({ location: 'JW001' });
  eq('JW001 filter shows only the job-work coil',
    fJw.docs.map((d) => d.batchNo).join(','), 'DEMO-COIL-002');

  /* ── Nothing outside the demo was disturbed ── */
  console.log('\n— data integrity —');
  const orphanConversions = await CoilConversion.countDocuments({ coilReceiptId: null });
  eq('no orphan conversions were created', orphanConversions, 0);
  const totalScrapRecords = await ScrapRecord.countDocuments({});
  eq('scrap record count = untraceable + 3 rounds', totalScrapRecords, UNTRACEABLE_ROWS + 3);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  await mongoose.disconnect();
  if (failed.length) process.exit(1);
};

/* ══ --dump / --drop ══════════════════════════════════════════════════════ */

const dump = async () => {
  await connect();
  const out = await scrapImsService.getScrapByCoil({ page: 1, limit: 50 });
  console.log(JSON.stringify(out, null, 2));
  await mongoose.disconnect();
};

const drop = async () => {
  await connect();
  const name = mongoose.connection.name;
  await mongoose.connection.dropDatabase();
  console.log(JSON.stringify({ ok: true, dropped: name }, null, 2));
  await mongoose.disconnect();
};

const MODES = {
  '--seed': seed, '--cut': cut, '--verify': verify, '--dump': dump, '--drop': drop,
};
const mode = process.argv.find((a) => MODES[a]);
if (!mode) {
  console.error(`Usage: node src/scripts/e2eScrapByCoilFixture.js [${Object.keys(MODES).join(' | ')}]`);
  process.exit(1);
}
MODES[mode]().catch((e) => { console.error(e); process.exit(1); });
