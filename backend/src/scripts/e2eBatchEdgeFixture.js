/**
 * Fixture + database oracle for the Batch Number EDGE CASES of Cut Coils:
 * duplicate exact batch numbers and short batch numbers.
 *
 *   node src/scripts/e2eBatchEdgeFixture.js --seed     fresh scratch DB + the edge-case coils
 *   node src/scripts/e2eBatchEdgeFixture.js --api      the lookups and refusals, through the service
 *   node src/scripts/e2eBatchEdgeFixture.js --verify   assert what the browser test saved
 *
 * Pairs with frontend/e2e/batchEdgeCases.e2e.mjs.
 *
 *   DUP-0420   two GRNs, two different coils (JSL204-07 PLG01 ₹180 · JSL204-08
 *              JW001 ₹195), different suppliers and dates — one batch number.
 *   DUP-SAME   two GRNs of the SAME coil grade with one batch number.
 *   MIX-0777   a manual coil (no GRN, JSL202-06, 900 kg, one round of 200)
 *              entered first, then a GRN of a JSL204-07 coil with the same batch.
 *   A1         an old short batch (JSL204-08, 500 kg) behind 30 NEWER coils
 *              whose batches merely contain it (A100…A129) — more than the 25
 *              the broad received-coils search returns.
 *   B7xx       30 coils B700…B729 and no coil "B7": many partial matches, no
 *              exact one.
 *   NEG-55     a GRN coil over-cut on its ledger (100 in, 150 out): it cannot be
 *              cut, and its batch can never be entered as a new manual coil.
 *
 * Every write goes through the real services (increaseStock / convert), so
 * stock, ledgers and scrap are the real thing.
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
import ManualCoil from '../modules/inventory/manualCoil.model.js';
import { inventoryService, combineStockRows } from '../modules/inventory/inventory.service.js';
import { rmImsService } from '../modules/inventory/rmIms.service.js';
import { rmConvertSchema, rmReceivedCoilsQuerySchema } from '../modules/inventory/rmIms.validation.js';
import { SCRAP_SKU_CODE, SCRAP_SKU_DEFAULTS } from '../modules/inventory/scrapSku.js';
import { COIL_CIRCLE_MAP } from '../data/coil-circle-map.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_batchedge';
// Local scratch DB, S3 off, email off — or stop before anything connects.
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eBatchEdgeFixture.js');
export const E2E_USER = { email: 'batchedge-e2e@test.local', password: 'E2e@12345', name: 'Batch edge E2E', role: 'MD' };

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

const day = (s) => new Date(`${s}T10:00:00+05:30`);
/** Physical coils received on a GRN. `key` names the ones the checks read. */
const RECEIPTS = [
  { key: 'DUP_A', coil: 'JSL204-07', batchNo: 'DUP-0420', weight: 1000, rate: 180, warehouse: 'PLG01', grn: 'GRN-BE-A', vendor: 'Alpha Metals', date: '2026-09-01' },
  { key: 'DUP_B', coil: 'JSL204-08', batchNo: 'DUP-0420', weight: 1200, rate: 195, warehouse: 'JW001', grn: 'GRN-BE-B', vendor: 'Beta Coils', date: '2026-09-10' },
  { key: 'SAME_1', coil: 'JSL204-10', batchNo: 'DUP-SAME', weight: 600, rate: 200, warehouse: 'PLG01', grn: 'GRN-BE-S1', vendor: 'Alpha Metals', date: '2026-09-02' },
  { key: 'SAME_2', coil: 'JSL204-10', batchNo: 'DUP-SAME', weight: 400, rate: 205, warehouse: 'PLG01', grn: 'GRN-BE-S2', vendor: 'Beta Coils', date: '2026-09-12' },
  { key: 'A1', coil: 'JSL204-08', batchNo: 'A1', weight: 500, rate: 190, warehouse: 'PLG01', grn: 'GRN-BE-D', vendor: 'Delta Steel', date: '2026-08-01' },
  // Grade stock for the manual coil (a manual coil still comes out of RM stock).
  { key: 'STOCK_06', coil: 'JSL202-06', batchNo: 'BE-STOCK-06', weight: 3000, rate: 170, warehouse: 'PLG01', grn: 'GRN-BE-G', vendor: 'Gamma Steel', date: '2026-08-15' },
  { key: 'NEG', coil: 'JSL204-10', batchNo: 'NEG-55', weight: 100, rate: 200, warehouse: 'PLG01', grn: 'GRN-BE-E', vendor: 'Epsilon Metals', date: '2026-08-20' },
  // 30 newer coils whose batch CONTAINS "A1" — more than the broad search's 25.
  ...Array.from({ length: 30 }, (_, i) => ({
    key: `A1${String(i).padStart(2, '0')}`, coil: 'JSL204-07', batchNo: `A1${String(i).padStart(2, '0')}`, weight: 100, rate: 181,
    warehouse: 'PLG01', grn: 'GRN-BE-A1X', vendor: 'Alpha Metals', date: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`,
  })),
  // 30 coils B700…B729 and NO coil "B7".
  ...Array.from({ length: 30 }, (_, i) => ({
    key: `B7${String(i).padStart(2, '0')}`, coil: 'JSL204-07', batchNo: `B7${String(i).padStart(2, '0')}`, weight: 100, rate: 181,
    warehouse: 'PLG01', grn: 'GRN-BE-B7X', vendor: 'Beta Coils', date: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`,
  })),
];
// Received AFTER the manual coil of the same batch was entered (see seed).
const MIX_RECEIPT = { key: 'MIX', coil: 'JSL204-07', batchNo: 'MIX-0777', weight: 800, rate: 182, warehouse: 'PLG01', grn: 'GRN-BE-C', vendor: 'Gamma Steel', date: '2026-09-20' };

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (!/ambika_e2e_batchedge$/.test(mongoose.connection.name || '')) {
    throw new Error(`Connected to an unexpected database (${mongoose.connection.name}) — aborting.`);
  }
};

const receive = (user, sku, r) => inventoryService.increaseStock({
  skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: 'KGS',
  quantity: r.weight, unitCost: r.rate, warehouse: r.warehouse,
  txnType: TXN_TYPE.GRN_IN, sourceModule: 'GRN', refType: 'GRN', refNumber: r.grn,
  batchNo: r.batchNo, vendorName: r.vendor, remarks: 'Batch-edge e2e fixture receipt',
  performedBy: user, movementDate: day(r.date),
});

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

  for (const r of RECEIPTS) await receive(user, skus[r.coil], r);

  // NEG-55: more left the batch than ever arrived — a ledger anomaly, the kind
  // the cutting lookup withholds (nothing real to cut).
  const neg = skus['JSL204-10'];
  await inventoryService.decreaseStock({
    skuId: neg._id, skuCode: neg.code, skuName: neg.name, unit: 'KGS',
    quantity: 150, txnType: TXN_TYPE.CONVERT_OUT, sourceModule: 'RM_IMS',
    refType: 'EXCEL_CONVERSION', refNumber: 'NEG-55', batchNo: 'NEG-55',
    clientRequestId: 'BE|NEG-55|row-1', remarks: 'Batch-edge e2e: over-cut ledger',
    performedBy: user, movementDate: day('2026-08-25'),
  }, { allowNegative: true });

  // MIX-0777: the manual coil first (its first round records it), through the
  // real convert — exactly as the form would save it…
  const dd = skus['JSL202-06'];
  const firstRound = await rmConvertSchema.validateAsync({
    conversionDate: '2026-09-05', clientRequestId: 'be-mix-0777-r1',
    manualCoil: { batchNo: 'MIX-0777', totalWeightKg: 900 },
    coilSkuId: String(dd._id), coilWeightKg: 200, rate: 170, warehouse: 'PLG01', cuttingType: 'PARTIAL',
    scrapVerified: 'PENDING',
    circles: [{ circleSkuId: String(skus[COIL_CIRCLE_MAP['JSL202-06'][0].code]._id), pcs: 30, weightKg: 170 }],
  });
  await rmImsService.convert(firstRound, user);
  // …then a GRN arrives carrying the same batch number on another coil.
  await receive(user, skus[MIX_RECEIPT.coil], MIX_RECEIPT);

  console.log(JSON.stringify({ ok: true, user: E2E_USER, receipts: RECEIPTS.length + 1 }, null, 2));
  await mongoose.disconnect();
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
const receiptOf = (grn, batchNo) => InventoryMovement.findOne({ txnType: TXN_TYPE.GRN_IN, refNumber: grn, batchNo }).lean();
const counts = async () => ({
  movements: await InventoryMovement.countDocuments({}),
  conversions: await CoilConversion.countDocuments({}),
  scrap: await ScrapRecord.countDocuments({}),
  manualCoils: await ManualCoil.countDocuments({}),
});

/** The lookups and refusals, through the service and the route's schemas. */
const api = async () => {
  await connect();
  const user = await User.findOne({ email: E2E_USER.email }).lean();
  const list = async (query) => rmImsService.listReceivedCoils(await rmReceivedCoilsQuerySchema.validateAsync(query));
  console.log('\nAPI — short batch numbers');

  // The root cause, shown: the broad search is cut to 25 newest-first, and
  // the 30 newer "A1xx" coils push the exact coil "A1" out of it.
  const broad = await list({ q: 'A1', limit: 25, circleMapped: true });
  check('ROOT CAUSE — the broad search for "A1" (25 newest) does not contain the exact coil A1',
    broad.docs.length === 25 && !broad.docs.some((d) => d.batchNo === 'A1'), `${broad.docs.length} rows · matched ${broad.summary.matched}`);
  const exactA1 = await list({ batchNo: 'A1', limit: 25, circleMapped: true, includeConsumed: true });
  check('the exact lookup finds A1 — and only A1 — despite 30 partial matches',
    exactA1.docs.length === 1 && exactA1.docs[0].batchNo === 'A1' && exactA1.docs[0].availableWeight === 500 && exactA1.docs[0].grnNumber === 'GRN-BE-D',
    exactA1.docs.map((d) => `${d.batchNo}/${d.availableWeight}`).join(','));
  const lowerA1 = await list({ batchNo: 'a1', limit: 25, circleMapped: true, includeConsumed: true });
  check('…in any case ("a1")', lowerA1.docs.length === 1 && lowerA1.docs[0].batchNo === 'A1');
  const exactB7 = await list({ batchNo: 'B7', limit: 25, circleMapped: true, includeConsumed: true });
  const broadB7 = await list({ q: 'B7', limit: 25, circleMapped: true });
  check('no exact coil "B7": the exact lookup is empty while the broad search still lists partial matches',
    exactB7.docs.length === 0 && broadB7.docs.length === 25 && broadB7.summary.truncated === true, `exact ${exactB7.docs.length} · broad ${broadB7.docs.length}/${broadB7.summary.matched}`);
  const special = await list({ batchNo: 'A1.*', limit: 25, circleMapped: true, includeConsumed: true });
  check('the exact lookup treats the text literally (no regex: "A1.*" finds nothing)', special.docs.length === 0);
  check('…and an exact lookup does not run the whole-collection counts the browse list needs',
    exactA1.summary.unbatchedReceipts === null && exactA1.summary.batchesWithoutReceipt === null);

  console.log('\nAPI — duplicate exact batch numbers');
  const dup = await list({ batchNo: 'DUP-0420', limit: 25, circleMapped: true, includeConsumed: true });
  const ids = new Set(dup.docs.map((d) => String(d.id)));
  check('DUP-0420: two physical coils, one per GRN, each with its own coil, supplier, location and rate',
    dup.docs.length === 2 && ids.size === 2
      && dup.docs.some((d) => d.grnNumber === 'GRN-BE-A' && d.skuCode === 'JSL204-07' && d.supplier === 'Alpha Metals' && d.warehouse === 'PLG01' && d.unitCost === 180 && d.availableWeight === 1000)
      && dup.docs.some((d) => d.grnNumber === 'GRN-BE-B' && d.skuCode === 'JSL204-08' && d.supplier === 'Beta Coils' && d.warehouse === 'JW001' && d.unitCost === 195 && d.availableWeight === 1200),
    dup.docs.map((d) => `${d.grnNumber}:${d.skuCode}:${d.availableWeight}`).join(' | '));
  const same = await list({ batchNo: 'DUP-SAME', limit: 25, circleMapped: true, includeConsumed: true });
  check('DUP-SAME: two receipts of the same coil grade are two rows (two GRNs, two ids)',
    same.docs.length === 2 && new Set(same.docs.map((d) => String(d.id))).size === 2,
    same.docs.map((d) => `${d.grnNumber}: received ${d.receivedWeight}, available ${d.availableWeight}`).join(' | '));
  const mixR = await list({ batchNo: 'MIX-0777', limit: 25, circleMapped: true, includeConsumed: true });
  const mixM = await rmImsService.lookupManualCoil({ batchNo: 'MIX-0777' });
  check('MIX-0777: one received coil AND one manual coil carry it',
    mixR.docs.length === 1 && mixR.docs[0].grnNumber === 'GRN-BE-C' && mixM.manualCoil?.batchNo === 'MIX-0777'
      && mixM.manualCoil.availableKg === 700 && mixM.manualCoil.skuCode === 'JSL202-06',
    `receipt ${mixR.docs[0]?.grnNumber} · manual ${mixM.manualCoil?.skuCode} ${mixM.manualCoil?.availableKg} kg left`);

  console.log('\nAPI — a GRN batch is never a new manual coil');
  const negR = await list({ batchNo: 'NEG-55', limit: 25, circleMapped: true, includeConsumed: true });
  const negM = await rmImsService.lookupManualCoil({ batchNo: 'NEG-55' });
  check('NEG-55 (over-cut ledger) is not offered for cutting, but the manual lookup reports its goods receipt',
    negR.docs.length === 0 && negM.manualCoil === null && negM.grnReceipt?.grnNumber === 'GRN-BE-E');
  const cu10 = await SKU.findOne({ code: 'JSL204-10' }).lean();
  const circle10 = await SKU.findOne({ code: COIL_CIRCLE_MAP['JSL204-10'][0].code }).lean();
  for (const batchNo of ['NEG-55', 'A1', 'dup-0420']) {
    const before = await counts();
    let err = null;
    try {
      const body = await rmConvertSchema.validateAsync({
        clientRequestId: `be-refuse-${batchNo}`, manualCoil: { batchNo, totalWeightKg: 500 },
        coilSkuId: String(cu10._id), coilWeightKg: 10, rate: 0, warehouse: 'PLG01', cuttingType: 'PARTIAL',
        circles: [{ circleSkuId: String(circle10._id), pcs: 1, weightKg: 8 }],
      });
      await rmImsService.convert(body, user);
    } catch (e) { err = e; }
    const after = await counts();
    check(`a new manual coil for GRN batch "${batchNo}" is refused (409), pointing at its goods receipt`,
      err?.statusCode === 409 && /already has a goods receipt/.test(err.message) && /pick its goods receipt/.test(err.message), err?.message?.slice(0, 120));
    check(`…and the refusal wrote nothing (${batchNo})`, JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  }
  return done();
};

/** What the browser test saved — against the database, never a toast. */
const verify = async () => {
  await connect();
  console.log('\nVERIFY — what the browser saved');
  const dupA = await receiptOf('GRN-BE-A', 'DUP-0420');
  const dupB = await receiptOf('GRN-BE-B', 'DUP-0420');
  const a1 = await receiptOf('GRN-BE-D', 'A1');
  const mixR = await receiptOf('GRN-BE-C', 'MIX-0777');
  const mc = await ManualCoil.findOne({ batchKey: 'MIX-0777' }).lean();
  const convs = await CoilConversion.find({}).sort({ createdAt: 1 }).lean();
  const ui = convs.filter((c) => c.clientRequestId !== 'be-mix-0777-r1');
  const byReceipt = (r) => ui.filter((c) => String(c.coilReceiptId) === String(r._id));

  check('the DUP-0420 round is linked to the coil that was PICKED (GRN-BE-B, JSL204-08) — 300 kg, Partial',
    byReceipt(dupB).length === 1 && byReceipt(dupB)[0].coilWeightKg === 300 && byReceipt(dupB)[0].cuttingType === 'PARTIAL'
      && byReceipt(dupB)[0].coilSkuCode === 'JSL204-08', JSON.stringify(byReceipt(dupB).map((c) => [c.coilSkuCode, c.coilWeightKg])));
  check('…and NOT to the other coil with the same batch (GRN-BE-A has no round)', byReceipt(dupA).length === 0);
  const ledger = async (r) => {
    const rows = await InventoryMovement.find({ batchNo: r.batchNo, skuId: r.skuId, isDeleted: { $ne: true } }).lean();
    return rows.reduce((s, m) => s + (m.movementType === 'IN' ? m.quantity : -m.quantity), 0);
  };
  check('…GRN-BE-B\'s ledger is 1,200 − 300 = 900; GRN-BE-A\'s is untouched at 1,000',
    (await ledger(dupB)) === 900 && (await ledger(dupA)) === 1000, `${await ledger(dupB)} / ${await ledger(dupA)}`);

  const mcRounds = ui.filter((c) => String(c.manualCoilId) === String(mc?._id));
  check('the MIX-0777 round picked as the MANUAL coil continues that manual coil (100 kg) — not its GRN namesake',
    mcRounds.length === 1 && mcRounds[0].coilWeightKg === 100 && !mcRounds[0].coilReceiptId && mcRounds[0].coilSkuCode === 'JSL202-06',
    JSON.stringify(mcRounds.map((c) => [c.coilSkuCode, c.coilWeightKg, String(c.coilReceiptId)])));
  check('…GRN-BE-C (MIX-0777 receipt) has no round and its ledger is untouched at 800',
    byReceipt(mixR).length === 0 && (await ledger(mixR)) === 800);
  const mcFacts = await rmImsService.lookupManualCoil({ batchNo: 'MIX-0777' });
  check('…the manual coil now shows 900 total · 300 cut · 600 remaining over 2 rounds',
    mcFacts.manualCoil.originalWeightKg === 900 && mcFacts.manualCoil.cutKg === 300 && mcFacts.manualCoil.availableKg === 600 && mcFacts.manualCoil.rounds === 2);

  check('the short batch A1 round (100 kg) is linked to A1 itself, not to an A1xx coil',
    byReceipt(a1).length === 1 && byReceipt(a1)[0].coilWeightKg === 100 && (await ledger(a1)) === 400);
  const a1x = await InventoryMovement.find({ txnType: TXN_TYPE.CONVERT_OUT, batchNo: /^A1\d\d$/ }).countDocuments();
  check('…no A1xx coil was cut', a1x === 0, `${a1x}`);
  check('nothing was ever saved for "B7" or "NEG-55" (no conversion, no manual coil)',
    !ui.some((c) => /^(B7|NEG-55)$/i.test(c.batchNo || '')) && (await ManualCoil.countDocuments({ batchKey: { $in: ['B7', 'NEG-55'] } })) === 0);
  check('exactly the three rounds the browser saved, and no untraceable cut among them',
    ui.length === 3 && ui.every((c) => c.coilReceiptId || c.manualCoilId), `${ui.length}`);

  console.log('\nVERIFY — scrap traceability and stock');
  for (const c of ui) {
    const srs = await ScrapRecord.find({ conversionId: c._id }).lean();
    const sr = srs[0];
    const sameCoil = sr && String(sr.coilReceiptId || '') === String(c.coilReceiptId || '') && String(sr.manualCoilId || '') === String(c.manualCoilId || '');
    const jw = sr?.location === 'JW001';
    check(`${c.conversionNumber} (${c.batchNo}, ${c.coilSkuCode}): one scrap record naming the same coil, ${jw ? 'JW001 — no SCRAP_IN' : 'PLG01 — with SCRAP_IN'}`,
      srs.length === 1 && sameCoil && (jw ? !sr.stockMovementId : !!sr.stockMovementId), sr ? `${sr.location} · scrap ${sr.scrapKg ?? ''}` : 'none');
  }
  for (const code of ['JSL204-07', 'JSL204-08', 'JSL202-06', 'JSL204-10']) {
    const sku = await SKU.findOne({ code }).lean();
    const moves = await InventoryMovement.find({ skuId: sku._id, isDeleted: { $ne: true } }).lean();
    const net = moves.reduce((s, m) => s + (m.movementType === 'IN' ? m.quantity : -m.quantity), 0);
    const stock = Number(combineStockRows(await InventoryStock.find({ skuId: sku._id }).lean())?.qtyOnHand || 0);
    check(`${code}: stock on hand (${stock}) = Σ IN − Σ OUT of its movements (${net})`, Math.abs(stock - net) < 0.001);
  }
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
