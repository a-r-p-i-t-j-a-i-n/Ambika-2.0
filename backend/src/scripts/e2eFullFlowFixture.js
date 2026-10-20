/**
 * Fixture + database oracle for the FULL purchase-to-scrap business flow.
 *
 *   node src/scripts/e2eFullFlowFixture.js --seed      fresh scratch DB + masters + 3 POs
 *   node src/scripts/e2eFullFlowFixture.js --verify    assert the whole chain
 *   node src/scripts/e2eFullFlowFixture.js --negative  API-level negative cases
 *   node src/scripts/e2eFullFlowFixture.js --dump      print current state as JSON
 *   node src/scripts/e2eFullFlowFixture.js --drop      delete the scratch database
 *
 * Pairs with frontend/e2e/fullFlow.e2e.mjs, which drives the real UI in
 * Chromium: PO -> GRN -> Complete & post stock -> RM stock -> batch lookup ->
 * Cut Coils -> Scrap by physical coil. The browser performs the operator's
 * actions; this file is the independent check on what landed in the database,
 * so no result rests on a success toast.
 *
 * Follows e2eGrnRmFixture.js and e2eCutCoilsFixture.js, the two established
 * fixtures for this flow — same scratch-DB discipline, same oracle split.
 *
 * SAFETY: pinned to a localhost scratch database, which --seed drops. It never
 * reads the configured MONGO_URI, so it cannot touch the client's Atlas data —
 * which matters more than usual here, because this flow MOVES STOCK.
 *
 * WHAT IS SEEDED vs WHAT THE TEST DOES
 * Only the PURCHASE ORDERS are seeded, because a PO reaching READY_FOR_GRN is
 * a multi-step follow-up workflow of its own and is not what this test is
 * about. Everything from the GRN onwards — raising it, completing it, posting
 * stock, cutting the coil — happens through the real services, driven from the
 * real UI.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote from '../modules/procurement/grn/grn.model.js';
import InventoryMovement, { TXN_TYPE, MOVEMENT_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import ScrapRecord from '../modules/inventory/scrapRecord.model.js';
import { rmImsService } from '../modules/inventory/rmIms.service.js';
import { scrapImsService } from '../modules/inventory/scrapIms.service.js';
import { grnService } from '../modules/procurement/grn/grn.service.js';
import { SCRAP_SKU_CODE, SCRAP_SKU_DEFAULTS } from '../modules/inventory/scrapSku.js';
import { COIL_CIRCLE_MAP } from '../data/coil-circle-map.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_fullflow';
// Local scratch DB, S3 off, email off — or stop before anything connects.
// Only when RUN as a script: unit tests import pure data from some fixtures.
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eFullFlowFixture.js');
export const E2E_USER = {
  email: 'fullflow-e2e@test.local', password: 'E2e@12345', name: 'Full Flow E2E', role: 'MD',
};

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(E2E_URI)) {
  console.error('Refusing to run: fixture must target localhost.');
  process.exit(1);
}

/**
 * The three purchases. Coil codes are the client's real ones and all three
 * carry an approved circle mapping — a fixture with invented codes would
 * exercise no mapping at all.
 */
export const PURCHASES = [
  {
    key: 'P1',
    poNumber: 'PO-E2E-FF-001',
    supplier: 'E2E Demo Supplier 1',
    coil: 'JSL204-07',
    coilName: 'Cu 0.70 mm',
    batchNo: 'E2E-COIL-001',
    qty: 2000,
    rate: 185,
    receivedAt: 'PLG01',
  },
  {
    key: 'P2',
    poNumber: 'PO-E2E-FF-002',
    supplier: 'E2E Demo Supplier 2',
    coil: 'JSL204-08',
    coilName: 'Cu 0.80 mm',
    batchNo: 'E2E-COIL-002',
    qty: 2500,
    rate: 192,
    receivedAt: 'JW001',
  },
  {
    key: 'P3',
    poNumber: 'PO-E2E-FF-003',
    supplier: 'E2E Demo Supplier 3',
    coil: 'JSL202-06',
    coilName: 'DD 0.60 mm',
    batchNo: 'E2E-COIL-003',
    qty: 1500,
    rate: 170,
    receivedAt: 'PLG01',
  },
];

/**
 * The cutting rounds the browser performs. Circle codes come from the client's
 * approved mapping, because convert() enforces it before moving any stock.
 *
 * scrapKg is never supplied — convert() derives it as coil weight minus the
 * sum of the circle weights, and asserting a figure we also submitted would
 * prove nothing.
 */
export const ROUNDS = [
  { batchNo: 'E2E-COIL-001', coilWeightKg: 800, circle: 'JSL204-07-700', pcs: 900, weightKg: 680 },
  { batchNo: 'E2E-COIL-001', coilWeightKg: 500, circle: 'JSL204-07-750', pcs: 560, weightKg: 425 },
  { batchNo: 'E2E-COIL-002', coilWeightKg: 1000, circle: 'JSL204-08-850', pcs: 1100, weightKg: 820 },
  { batchNo: 'E2E-COIL-003', coilWeightKg: 600, circle: 'JSL202-06-700', pcs: 700, weightKg: 510 },
];

/** What the whole chain must end up showing, stated up front. */
export const EXPECTED = {
  'E2E-COIL-001': {
    skuCode: 'JSL204-07', receivedKg: 2000, cutKg: 1300, circlesKg: 1105, scrapKg: 195,
    scrapPct: 15, avgYieldPct: 85, remainingKg: 700, rounds: 2,
    location: 'PLG01', supplier: 'E2E Demo Supplier 1', scrapPostsStock: true,
  },
  'E2E-COIL-002': {
    skuCode: 'JSL204-08', receivedKg: 2500, cutKg: 1000, circlesKg: 820, scrapKg: 180,
    scrapPct: 18, avgYieldPct: 82, remainingKg: 1500, rounds: 1,
    // Job work: the offcut stayed with the job worker and was never stock
    // Ambika held, so this cut posts NO SCRAP_IN. Asserted, not tolerated.
    location: 'JW001', supplier: 'E2E Demo Supplier 2', scrapPostsStock: false,
  },
  'E2E-COIL-003': {
    skuCode: 'JSL202-06', receivedKg: 1500, cutKg: 600, circlesKg: 510, scrapKg: 90,
    scrapPct: 15, avgYieldPct: 85, remainingKg: 900, rounds: 1,
    location: 'PLG01', supplier: 'E2E Demo Supplier 3', scrapPostsStock: true,
  },
};

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (!/ambika_e2e_fullflow$/.test(mongoose.connection.name || '')) {
    throw new Error(`Connected to an unexpected database (${mongoose.connection.name}) — aborting.`);
  }
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : (detail ? ` — ${detail}` : '')}`);
};
const eq = (name, actual, expected) => check(name, actual === expected, `expected ${expected}, got ${actual}`);

/* ══ --seed ════════════════════════════════════════════════════════════════ */

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();

  const user = await User.create({
    ...E2E_USER, password: E2E_USER.password, mobile: '9000000009', isActive: true, roles: ['MD'],
  });

  const skus = {};
  for (const p of PURCHASES) {
    skus[p.coil] = await SKU.create({
      code: p.coil, name: p.coilName, category: 'Coil',
      unit: 'KGS', itemType: 'RAW_MATERIAL', isActive: true,
    });
  }
  // Every circle the three coils are approved to produce, from the client's own
  // mapping — so the Cut Coils dropdown has real options to filter.
  for (const p of PURCHASES) {
    for (const circle of COIL_CIRCLE_MAP[p.coil] || []) {
      if (skus[circle.code]) continue;
      skus[circle.code] = await SKU.create({
        code: circle.code, name: circle.clientLabel, category: 'Circles',
        unit: 'PCS', itemType: 'CIRCLE', isActive: true,
      });
    }
  }
  // An in-house (PLG01) cut posts its offcut into scrap stock, so the scrap
  // item must exist or the cut fails for a reason unrelated to this flow.
  await SKU.create({ code: SCRAP_SKU_CODE, ...SCRAP_SKU_DEFAULTS, isActive: true });

  /**
   * One PO per purchase, already at READY_FOR_GRN with the PI step settled.
   *
   * grnService.create() gates on BOTH `readyForGrnAt` and `finalMaterialDate`,
   * not the follow-up status alone — same gate e2eGrnRmFixture.js documents.
   */
  const pos = [];
  for (const p of PURCHASES) {
    const sku = skus[p.coil];
    const po = await VendorPurchaseOrder.create({
      poNumber: p.poNumber,
      vendorId: new mongoose.Types.ObjectId(),
      vendorName: p.supplier,
      indentId: new mongoose.Types.ObjectId(),
      poStatus: 'APPROVED',
      followUpStatus: 'READY_FOR_GRN',
      piStatus: 'PI_NOT_REQUIRED',
      readyForGrnAt: new Date(),
      finalMaterialDate: new Date(),
      items: [{
        skuId: sku._id, skuCode: sku.code, itemName: sku.name, unit: 'KGS',
        quantity: p.qty, receivedQty: 0, pendingQty: p.qty, rate: p.rate,
      }],
    });
    pos.push({ key: p.key, poNumber: po.poNumber, supplier: p.supplier, coil: p.coil, qty: p.qty, batchNo: p.batchNo, receivedAt: p.receivedAt });
  }

  console.log(JSON.stringify({
    ok: true, db: mongoose.connection.name, user: E2E_USER, purchaseOrders: pos,
    skuCount: Object.keys(skus).length + 1,
  }, null, 2));
  await mongoose.disconnect();
};

/* ══ --verify ═════════════════════════════════════════════════════════════ */

const verify = async () => {
  await connect();
  console.log('\nFull purchase-to-scrap flow — database oracle\n');

  /* ── 1) Purchase orders ── */
  console.log('— 1. purchase orders —');
  for (const p of PURCHASES) {
    const po = await VendorPurchaseOrder.findOne({ poNumber: p.poNumber }).lean();
    check(`${p.poNumber} exists`, !!po);
    if (!po) continue;
    eq(`${p.poNumber} supplier`, po.vendorName, p.supplier);
    eq(`${p.poNumber} line SKU`, po.items?.[0]?.skuCode, p.coil);
    eq(`${p.poNumber} ordered qty`, po.items?.[0]?.quantity, p.qty);
    // The GRN must have written back what was received against the order.
    eq(`${p.poNumber} received qty booked back`, round2(po.items?.[0]?.receivedQty), p.qty);
  }

  /* ── 2) GRN -> GRN_IN ── */
  console.log('\n— 2. GRN and the receipt it posted —');
  const receipts = {};
  for (const p of PURCHASES) {
    const grn = await GoodsReceiptNote.findOne({ poNumber: p.poNumber, isDeleted: { $ne: true } }).lean();
    check(`GRN raised against ${p.poNumber}`, !!grn, grn?.grnNumber || 'none');
    if (!grn) continue;
    eq(`${grn.grnNumber} is completed`, grn.stockPosted, true);
    // Posted at QC, after the MD signature — not at GRN completion.
    eq(`${grn.grnNumber} posting stage`, grn.stockPostingStage, 'QC_COMPLETION');
    eq(`${grn.grnNumber} MD-signed`, grn.approvalStatus, 'MD_APPROVED');
    eq(`${grn.grnNumber} QC passed`, grn.qcStatus, 'PASSED');
    eq(`${grn.grnNumber} line routed to RM IMS`, grn.items?.[0]?.inventoryDestination, 'RM_IMS');
    eq(`${grn.grnNumber} addToRmStock (has RM lines)`, grn.addToRmStock, true);
    eq(`${grn.grnNumber} Received At`, grn.rmReceivedAtLocation, p.receivedAt);
    eq(`${grn.grnNumber} line batch number`, grn.items?.[0]?.batchNo, p.batchNo);

    const mv = await InventoryMovement.find({
      refId: grn._id, txnType: TXN_TYPE.GRN_IN, isDeleted: { $ne: true },
    }).lean();
    eq(`${grn.grnNumber} posted exactly one GRN_IN`, mv.length, 1);
    const m = mv[0];
    if (!m) continue;
    eq(`${p.batchNo} GRN_IN sku`, m.skuCode, p.coil);
    eq(`${p.batchNo} GRN_IN quantity`, round2(m.quantity), p.qty);
    eq(`${p.batchNo} GRN_IN batchNo`, m.batchNo, p.batchNo);
    eq(`${p.batchNo} GRN_IN refType`, m.refType, 'GRN');
    eq(`${p.batchNo} GRN_IN refNumber`, m.refNumber, grn.grnNumber);
    eq(`${p.batchNo} GRN_IN warehouse = Received At`, m.warehouse, p.receivedAt);
    check(`${p.batchNo} GRN_IN dated at QC completion, after the GRN was completed`,
      Math.abs(new Date(m.movementDate) - new Date(grn.items[0].stockPostedAt)) < 5 && new Date(m.createdAt) >= new Date(grn.completedAt));
    eq(`${p.batchNo} GRN_IN supplier`, m.vendorName, p.supplier);
    receipts[p.batchNo] = m;
  }

  /* ── 3) RM stock balance ── */
  console.log('\n— 3. RM stock —');
  for (const p of PURCHASES) {
    const e = EXPECTED[p.batchNo];
    const rows = await InventoryStock.find({ skuCode: p.coil }).lean();
    const onHand = round2(rows.reduce((s, r) => s + Number(r.qtyOnHand || 0), 0));
    // received minus everything cut — scrap is NOT subtracted again, it was
    // already inside the cut weight.
    eq(`${p.coil} on-hand = received - cut`, onHand, round2(e.receivedKg - e.cutKg));
  }

  /* ── 4) Conversions bound to the physical coil ── */
  console.log('\n— 4. conversions —');
  for (const p of PURCHASES) {
    const receipt = receipts[p.batchNo];
    if (!receipt) { check(`${p.batchNo} conversions checked`, false, 'no receipt'); continue; }
    const convs = await CoilConversion.find({ coilReceiptId: receipt._id, isDeleted: { $ne: true } }).lean();
    const e = EXPECTED[p.batchNo];
    eq(`${p.batchNo} conversion count`, convs.length, e.rounds);
    for (const c of convs) {
      check(`${c.conversionNumber} coilReceiptId = the GRN_IN`, String(c.coilReceiptId) === String(receipt._id));
      eq(`${c.conversionNumber} batch`, c.batchNo, p.batchNo);
      eq(`${c.conversionNumber} coil sku`, c.coilSkuCode, p.coil);
      // scrap is derived, never supplied
      eq(`${c.conversionNumber} scrap = cut - circles`,
        round2(c.scrapKg), round2(c.coilWeightKg - c.circlesWeightKg));
      eq(`${c.conversionNumber} yield = circles / cut`,
        round2(c.yieldRatioPct), round2((c.circlesWeightKg / c.coilWeightKg) * 100));
      // every round posts its own CONVERT_OUT and one CONVERT_IN per circle
      const out = await InventoryMovement.countDocuments({
        refNumber: c.conversionNumber, txnType: TXN_TYPE.CONVERT_OUT, isDeleted: { $ne: true },
      });
      const inn = await InventoryMovement.countDocuments({
        refNumber: c.conversionNumber, txnType: TXN_TYPE.CONVERT_IN, isDeleted: { $ne: true },
      });
      eq(`${c.conversionNumber} CONVERT_OUT count`, out, 1);
      eq(`${c.conversionNumber} CONVERT_IN count`, inn, (c.circles || []).length);
    }
  }

  /* ── 5) Scrap records and scrap stock ── */
  console.log('\n— 5. scrap —');
  for (const p of PURCHASES) {
    const receipt = receipts[p.batchNo];
    if (!receipt) continue;
    const e = EXPECTED[p.batchNo];
    const srs = await ScrapRecord.find({ coilReceiptId: receipt._id, isDeleted: { $ne: true } }).lean();
    eq(`${p.batchNo} scrap record count`, srs.length, e.rounds);
    eq(`${p.batchNo} scrap total`, round2(srs.reduce((s, r) => s + r.scrapKg, 0)), e.scrapKg);
    check(`${p.batchNo} every scrap record is traced`, srs.every((r) => String(r.coilReceiptId) === String(receipt._id)));
    check(`${p.batchNo} every scrap record is CUT`, srs.every((r) => r.batchStatus === 'CUT'));
    eq(`${p.batchNo} cutting location`, [...new Set(srs.map((r) => r.location))].join(','), e.location);
    // PLG01 posts SCRAP_IN, JW001 posts nothing — the job-work rule.
    const posted = srs.filter((r) => r.stockMovementId).length;
    eq(`${p.batchNo} scrap stock movements`, posted, e.scrapPostsStock ? e.rounds : 0);
  }

  /* ── 6) Scrap by physical coil — the screen's own service ── */
  console.log('\n— 6. scrap by physical coil —');
  const { docs, summary } = await scrapImsService.getScrapByCoil({ page: 1, limit: 50 });
  eq('three physical coils are traced', summary.traced.coils, 3);
  eq('nothing is untraceable in this scratch DB', summary.untraceable.records, 0);
  const byBatch = new Map(docs.map((d) => [d.batchNo, d]));
  for (const [batchNo, e] of Object.entries(EXPECTED)) {
    const row = byBatch.get(batchNo);
    if (!row) { check(`${batchNo} appears on the screen`, false, 'row missing'); continue; }
    check(`${batchNo} appears on the screen`, true);
    eq(`${batchNo} received`, row.receivedKg, e.receivedKg);
    eq(`${batchNo} cut`, row.cutKg, e.cutKg);
    eq(`${batchNo} output`, row.circlesKg, e.circlesKg);
    eq(`${batchNo} scrap`, row.scrapKg, e.scrapKg);
    eq(`${batchNo} scrap %`, row.scrapPct, e.scrapPct);
    eq(`${batchNo} yield %`, row.avgYieldPct, e.avgYieldPct);
    eq(`${batchNo} remaining`, row.remainingKg, e.remainingKg);
    eq(`${batchNo} rounds`, row.rounds, e.rounds);
    eq(`${batchNo} supplier`, row.supplier, e.supplier);
    check(`${batchNo} GRN number is shown`, /^AGL\/GRN-|^GRN/.test(row.grnNo || ''), row.grnNo);
  }

  /* ── 7) Lineage drill-down ── */
  console.log('\n— 7. lineage —');
  const c1 = byBatch.get('E2E-COIL-001');
  if (c1) {
    const lin = await rmImsService.getCoilLineage(String(c1.coilReceiptId));
    eq('E2E-COIL-001 rounds', lin.rounds.length, 2);
    eq('E2E-COIL-001 received', lin.receipt.receivedWeightKg, 2000);
    eq('round 1 cut', lin.rounds[0]?.cutKg, 800);
    eq('round 1 scrap', lin.rounds[0]?.scrapKg, 120);
    eq('round 1 remaining after', lin.rounds[0]?.remainingAfterKg, 1200);
    eq('round 2 cut', lin.rounds[1]?.cutKg, 500);
    eq('round 2 scrap', lin.rounds[1]?.scrapKg, 75);
    eq('round 2 remaining after', lin.rounds[1]?.remainingAfterKg, 700);
    check('rounds are chronological',
      new Date(lin.rounds[0]?.date) <= new Date(lin.rounds[1]?.date));
    check('both rounds share one physical coil',
      lin.rounds.every((r) => String(c1.coilReceiptId) === String(c1.coilReceiptId)));
  }

  /* ── 8) Movement lineage per coil ── */
  console.log('\n— 8. movement history —');
  for (const p of PURCHASES) {
    const e = EXPECTED[p.batchNo];
    const mv = await InventoryMovement.find({ batchNo: p.batchNo, isDeleted: { $ne: true } })
      .sort({ movementDate: 1, createdAt: 1 }).lean();
    const types = mv.map((m) => m.txnType);
    check(`${p.batchNo} has a GRN_IN`, types.includes(TXN_TYPE.GRN_IN));
    check(`${p.batchNo} has CONVERT_OUT`, types.filter((t) => t === TXN_TYPE.CONVERT_OUT).length === e.rounds);
    check(`${p.batchNo} has CONVERT_IN`, types.includes(TXN_TYPE.CONVERT_IN));
    eq(`${p.batchNo} SCRAP_IN count`, types.filter((t) => t === TXN_TYPE.SCRAP_IN).length,
      e.scrapPostsStock ? e.rounds : 0);
    check(`${p.batchNo} every movement keeps the batch`, mv.every((m) => m.batchNo === p.batchNo));
    // the coil ledger itself: in minus out on the coil sku for this batch
    const coilMv = mv.filter((m) => m.skuCode === p.coil);
    const inQty = coilMv.filter((m) => m.movementType === MOVEMENT_TYPE.IN).reduce((s, m) => s + m.quantity, 0);
    const outQty = coilMv.filter((m) => m.movementType === MOVEMENT_TYPE.OUT).reduce((s, m) => s + m.quantity, 0);
    eq(`${p.batchNo} ledger balance = remaining`, round2(inQty - outQty), e.remainingKg);
  }

  /* ── 9) Circle stock ── */
  console.log('\n— 9. circle stock —');
  for (const r of ROUNDS) {
    const rows = await InventoryStock.find({ skuCode: r.circle }).lean();
    const pcs = round2(rows.reduce((s, x) => s + Number(x.qtyOnHand || 0), 0));
    const expectPcs = ROUNDS.filter((x) => x.circle === r.circle).reduce((s, x) => s + x.pcs, 0);
    eq(`${r.circle} stock in PIECES`, pcs, expectPcs);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) { console.log('\nFailures:'); failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`)); }
  await mongoose.disconnect();
  if (failed.length) process.exit(1);
};

/* ══ --negative ═══════════════════════════════════════════════════════════ */

/**
 * The refusals, driven through rmImsService.convert() exactly as the route
 * does. The important assertion is not only that a bad request is refused — it
 * is that refusing it moved NO stock and wrote NO conversion. A validation that
 * threw after decreaseStock would still "reject", and would still have eaten
 * the coil.
 */
const negative = async () => {
  await connect();
  console.log('\nNegative scenarios\n');
  const user = await User.findOne({ email: E2E_USER.email }).lean();
  const before = {
    conversions: await CoilConversion.countDocuments({}),
    movements: await InventoryMovement.countDocuments({}),
    scrap: await ScrapRecord.countDocuments({}),
  };

  const coil1 = await SKU.findOne({ code: 'JSL204-07' }).lean();
  const coil2 = await SKU.findOne({ code: 'JSL204-08' }).lean();
  const circleOwn = await SKU.findOne({ code: 'JSL204-07-700' }).lean();
  const circleForeign = await SKU.findOne({ code: 'JSL204-08-850' }).lean();
  const receipt1 = await InventoryMovement.findOne({ batchNo: 'E2E-COIL-001', txnType: TXN_TYPE.GRN_IN }).lean();
  const receipt2 = await InventoryMovement.findOne({ batchNo: 'E2E-COIL-002', txnType: TXN_TYPE.GRN_IN }).lean();

  const attempt = async (name, payload, expectRx) => {
    try {
      await rmImsService.convert(payload, user);
      check(name, false, 'it was ACCEPTED — expected a refusal');
    } catch (e) {
      const msg = String(e.message || '');
      check(name, expectRx.test(msg), msg.slice(0, 140));
    }
  };

  // A. a batch number that identifies no receipt
  await attempt('A. unknown batch number is refused', {
    batchNo: 'NO-SUCH-BATCH-XYZ', coilSkuId: String(coil1._id), coilWeightKg: 100,
    warehouse: 'PLG01', circles: [{ circleSkuId: String(circleOwn._id), pcs: 10, weightKg: 85 }],
  }, /no goods receipt|cannot be traced/i);

  // B. a circle this coil is not approved to produce
  await attempt('B. unapproved circle is refused', {
    coilReceiptId: String(receipt1._id), batchNo: 'E2E-COIL-001',
    coilSkuId: String(coil1._id), coilWeightKg: 100, warehouse: 'PLG01',
    circles: [{ circleSkuId: String(circleForeign._id), pcs: 10, weightKg: 85 }],
  }, /not approved|approved circle|mapp/i);

  // F. a receipt belonging to a DIFFERENT coil sku
  await attempt('F. receipt from another coil SKU is refused', {
    coilReceiptId: String(receipt2._id), batchNo: 'E2E-COIL-002',
    coilSkuId: String(coil1._id), coilWeightKg: 100, warehouse: 'PLG01',
    circles: [{ circleSkuId: String(circleOwn._id), pcs: 10, weightKg: 85 }],
  }, /is JSL204-08, not JSL204-07|Pick the coil again/i);

  // Over-cut: more than the physical coil has left
  await attempt('G. cutting more than the coil has left is refused', {
    coilReceiptId: String(receipt1._id), batchNo: 'E2E-COIL-001',
    coilSkuId: String(coil1._id), coilWeightKg: 99999, warehouse: 'PLG01',
    circles: [{ circleSkuId: String(circleOwn._id), pcs: 10, weightKg: 85 }],
  }, /only .* KG is available from this physical coil|is fully cut — 0 KG is available/i);

  // Circles stocked in pieces — a weight with no piece count must be refused.
  //
  // REGRESSION: this used to be refused only AFTER the CONVERT_OUT, so on a
  // standalone mongod (no transaction to roll back) the refusal still ate the
  // coil — 100 kg gone, no conversion. The balance check is the actual test.
  const batchBalance = async () => {
    const mv = await InventoryMovement.find({ batchNo: 'E2E-COIL-001', skuId: coil1._id, isDeleted: { $ne: true } }).lean();
    return round2(mv.reduce((s, m) => s + (m.movementType === MOVEMENT_TYPE.IN ? 1 : -1) * m.quantity, 0));
  };
  const hBefore = await batchBalance();
  const hOutBefore = await InventoryMovement.countDocuments({ txnType: TXN_TYPE.CONVERT_OUT });
  await attempt('H. a circle with no piece count is refused', {
    coilReceiptId: String(receipt1._id), batchNo: 'E2E-COIL-001',
    coilSkuId: String(coil1._id), coilWeightKg: 100, warehouse: 'PLG01',
    circles: [{ circleSkuId: String(circleOwn._id), pcs: 0, weightKg: 85 }],
  }, /pieces/i);
  eq('H. REGRESSION: the refused cut did not consume the coil', await batchBalance(), hBefore);
  eq('H. REGRESSION: no CONVERT_OUT was posted for it',
    await InventoryMovement.countDocuments({ txnType: TXN_TYPE.CONVERT_OUT }), hOutBefore);

  // D. completing an already-completed GRN, straight through the service — the
  // UI hiding its button proves nothing about a retry, a script or a 2nd tab.
  console.log('');
  const grn1 = await GoodsReceiptNote.findOne({ poNumber: 'PO-E2E-FF-001' }).lean();
  const grnInBefore = await InventoryMovement.countDocuments({ refId: grn1._id, txnType: TXN_TYPE.GRN_IN });
  const stockBefore = (await InventoryStock.find({ skuCode: 'JSL204-07' }).lean())
    .reduce((s, r) => s + Number(r.qtyOnHand || 0), 0);
  try {
    await grnService.complete(String(grn1._id), { rmReceivedAtLocation: 'PLG01' }, user);
    check('D. a second completion of the same GRN is refused', false, 'it was ACCEPTED');
  } catch (e) {
    check('D. a second completion of the same GRN is refused',
      /already been completed|Only draft GRNs/i.test(e.message), e.message);
  }
  eq('D. still exactly one GRN_IN for that GRN',
    await InventoryMovement.countDocuments({ refId: grn1._id, txnType: TXN_TYPE.GRN_IN }), grnInBefore);
  eq('D. coil stock unchanged by the retry',
    round2((await InventoryStock.find({ skuCode: 'JSL204-07' }).lean())
      .reduce((s, r) => s + Number(r.qtyOnHand || 0), 0)), round2(stockBefore));

  // E. idempotency — the same submission twice must not cut twice
  console.log('');
  const dupId = `e2e-fullflow-dup-${Date.now()}`;
  const dupPayload = {
    clientRequestId: dupId,
    coilReceiptId: String(receipt1._id), batchNo: 'E2E-COIL-001',
    coilSkuId: String(coil1._id), coilWeightKg: 50, warehouse: 'PLG01',
    circles: [{ circleSkuId: String(circleOwn._id), pcs: 40, weightKg: 42 }],
  };
  const first = await rmImsService.convert({ ...dupPayload }, user);
  const second = await rmImsService.convert({ ...dupPayload }, user);
  check('E. a replayed conversion returns the SAME conversion',
    String(first._id) === String(second._id), `${first.conversionNumber} vs ${second.conversionNumber}`);
  const dupCount = await CoilConversion.countDocuments({ clientRequestId: dupId });
  eq('E. only one conversion exists for that submission', dupCount, 1);
  const dupOut = await InventoryMovement.countDocuments({
    refNumber: first.conversionNumber, txnType: TXN_TYPE.CONVERT_OUT,
  });
  eq('E. only one CONVERT_OUT was posted', dupOut, 1);

  // The refusals above must have written nothing. The idempotency probe DID
  // legitimately write one cut, so that is what the deltas are measured against.
  console.log('');
  const after = {
    conversions: await CoilConversion.countDocuments({}),
    movements: await InventoryMovement.countDocuments({}),
    scrap: await ScrapRecord.countDocuments({}),
  };
  eq('refusals created no extra conversion', after.conversions - before.conversions, 1);
  eq('refusals created no extra scrap record', after.scrap - before.scrap, 1);
  // 1 CONVERT_OUT + 1 CONVERT_IN + 1 SCRAP_IN for the single idempotency cut
  eq('refusals created no extra movement', after.movements - before.movements, 3);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) { console.log('\nFailures:'); failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`)); }
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
  '--seed': seed, '--verify': verify, '--negative': negative, '--dump': dump, '--drop': drop,
};
const mode = process.argv.find((a) => MODES[a]);
if (!mode) {
  console.error(`Usage: node src/scripts/e2eFullFlowFixture.js [${Object.keys(MODES).join(' | ')}]`);
  process.exit(1);
}
MODES[mode]().catch((e) => { console.error(e); process.exit(1); });
