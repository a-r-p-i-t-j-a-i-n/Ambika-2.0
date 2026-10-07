/**
 * Fixture + database oracle for MULTI-ROUND physical coil cutting.
 *
 *   node src/scripts/e2eMultiRoundFixture.js --seed     fresh scratch DB + test data
 *   node src/scripts/e2eMultiRoundFixture.js --api      drive convert() + the history directly
 *   node src/scripts/e2eMultiRoundFixture.js --verify   assert what the browser test saved
 *   node src/scripts/e2eMultiRoundFixture.js --dump     print the cutting history as JSON
 *
 * Pairs with frontend/e2e/multiRoundCut.e2e.mjs, which cuts coil MR-UI-B001 in
 * two rounds through the real UI. `--api` never touches that coil, so the two
 * halves never compete for the same coil's weight.
 *
 * What is proved here, against a real mongod rather than a toast:
 *   • every round of one physical coil links to the SAME coilReceiptId;
 *   • remaining weight, round number and status are derived, round after round;
 *   • a round larger than the coil's remaining weight is refused — and refusing
 *     it moved NO stock — unless "allow negative" is on, when it is recorded
 *     and the negative balance is reported, not hidden;
 *   • each round's scrap and yield are its own, the coil's yield is weighted;
 *   • PLG01 rounds post SCRAP_IN, JW001 rounds post none, round by round;
 *   • a replayed submission is not a second round;
 *   • a historical cut that names no coil is left exactly as it was, counted as
 *     untraceable, and never turned into a round.
 *
 * SAFETY: pinned to a localhost scratch database, which --seed drops. It never
 * reads the configured MONGO_URI, so it cannot touch the client's Atlas data.
 */
import mongoose from 'mongoose';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryMovement, { TXN_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import ScrapRecord from '../modules/inventory/scrapRecord.model.js';
import { inventoryService, combineStockRows } from '../modules/inventory/inventory.service.js';
import { rmImsService } from '../modules/inventory/rmIms.service.js';
import { scrapImsService } from '../modules/inventory/scrapIms.service.js';
import { rmConvertSchema } from '../modules/inventory/rmIms.validation.js';
import { SCRAP_SKU_CODE, SCRAP_SKU_DEFAULTS } from '../modules/inventory/scrapSku.js';
import { COIL_CIRCLE_MAP } from '../data/coil-circle-map.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_multiround';
export const E2E_USER = { email: 'multiround-e2e@test.local', password: 'E2e@12345', name: 'Multi-round E2E', role: 'MD' };

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(E2E_URI)) {
  console.error('Refusing to run: fixture must target localhost.');
  process.exit(1);
}

const COILS = [
  { code: 'JSL202-06', name: 'DD 0.60 mm', category: 'DD Steel' },
  { code: 'JSL204-07', name: 'Cu 0.70 mm', category: 'Copper' },
  { code: 'JSL204-08', name: 'Cu 0.80 mm', category: 'Copper' },
];

/** Physical coils. Each is a GRN_IN — the identity every round links to. */
const RECEIPTS = [
  // --api: four rounds 500 / 700 / 300 / 500 at the plant.
  { key: 'PLG4', coil: 'JSL204-07', batchNo: 'MR-PLG-4R', weight: 2000, rate: 180, warehouse: 'PLG01' },
  // --api: two rounds at the job worker.
  { key: 'JW2', coil: 'JSL204-08', batchNo: 'MR-JW-2R', weight: 2000, rate: 190, warehouse: 'JW001' },
  // --api: the over-cut / zero / negative / allow-negative checks.
  { key: 'OVER', coil: 'JSL204-07', batchNo: 'MR-OVER', weight: 1000, rate: 180, warehouse: 'PLG01' },
  // --api: a spreadsheet-era coil, partly consumed by an UNLINKED historical cut.
  { key: 'HIST', coil: 'JSL204-08', batchNo: 'MR-HIST', weight: 1500, rate: 190, warehouse: 'PLG01' },
  // Browser only — never touched by --api.
  // Its own coil GRADE, so nothing --api does to JSL204-07 stock (the allow-
  // negative over-cut draws the grade's item total down) can reach it.
  { key: 'UI', coil: 'JSL202-06', batchNo: 'MR-UI-B001', weight: 2000, rate: 170, warehouse: 'PLG01' },
];

const HIST_SOURCE_REF = 'EXCEL_RM_24_25|CONVERSION|MR-HIST';

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (!/ambika_e2e_multiround$/.test(mongoose.connection.name || '')) {
    throw new Error(`Connected to an unexpected database (${mongoose.connection.name}) — aborting.`);
  }
};

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();

  const user = await User.create({
    ...E2E_USER, password: E2E_USER.password, mobile: '9000000011', isActive: true, roles: ['MD'],
  });

  const skus = {};
  for (const c of COILS) skus[c.code] = await SKU.create({ ...c, unit: 'KGS', itemType: 'RAW_MATERIAL', isActive: true });
  for (const c of Object.values(COIL_CIRCLE_MAP).flat()) {
    if (skus[c.code]) continue;
    skus[c.code] = await SKU.create({ code: c.code, name: c.clientLabel, unit: 'PCS', itemType: 'CIRCLE', isActive: true });
  }
  await SKU.create({ code: SCRAP_SKU_CODE, ...SCRAP_SKU_DEFAULTS, isActive: true });

  for (const r of RECEIPTS) {
    const sku = skus[r.coil];
    await inventoryService.increaseStock({
      skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: 'KGS',
      quantity: r.weight, unitCost: r.rate, warehouse: r.warehouse,
      txnType: TXN_TYPE.GRN_IN, sourceModule: 'GRN', refType: 'GRN', refNumber: `GRN-MR-${r.batchNo}`,
      batchNo: r.batchNo, vendorName: 'E2E Metals', remarks: 'Multi-round e2e fixture receipt',
      performedBy: user, movementDate: new Date(),
    });
  }

  /*
   * The historical case, shaped the way importRmExcelHistory.js +
   * importRmConversionDocs.js write it: a CONVERT_OUT carrying the batch but
   * naming no receipt (warehouse MAIN, allowNegative), and a CoilConversion
   * with a sourceRef and NO coilReceiptId. 600 kg of MR-HIST's 1,500 is gone.
   */
  const hist = skus['JSL204-08'];
  await inventoryService.decreaseStock({
    skuId: hist._id, skuCode: hist.code, skuName: hist.name, unit: 'KGS',
    quantity: 600, txnType: TXN_TYPE.CONVERT_OUT, sourceModule: 'RM_IMS',
    refType: 'EXCEL_CONVERSION', refNumber: 'MR-HIST', batchNo: 'MR-HIST',
    clientRequestId: 'EXCEL_RM_24_25|CONVERSION|row-1', remarks: 'Imported from EXCEL_RM_24_25 · batch MR-HIST',
    performedBy: user, movementDate: new Date('2025-01-15'),
  }, { allowNegative: true });
  await CoilConversion.create({
    conversionNumber: 'EXL/MR-HIST', conversionDate: new Date('2025-01-15'), batchNo: 'MR-HIST',
    coilSkuId: hist._id, coilSkuCode: hist.code, coilSkuName: hist.name,
    coilWeightKg: 600, rate: 190, circles: [], circlesWeightKg: 510, scrapKg: 90, yieldRatioPct: 85,
    scrapVerified: 'DONE', sourceRef: HIST_SOURCE_REF, remarks: 'Imported from EXCEL_RM_24_25 · batch MR-HIST',
  });

  console.log(JSON.stringify({
    ok: true, user: E2E_USER,
    receipts: RECEIPTS.map(({ key, ...r }) => r),
  }, null, 2));
  await mongoose.disconnect();
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const loadContext = async () => {
  const user = await User.findOne({ email: E2E_USER.email }).lean();
  const byCode = {};
  for (const s of await SKU.find({}).lean()) byCode[s.code] = s;
  const receipts = {};
  for (const r of RECEIPTS) {
    receipts[r.key] = await InventoryMovement.findOne({ batchNo: r.batchNo, txnType: TXN_TYPE.GRN_IN }).lean();
  }
  return { user, byCode, receipts };
};

const stockOf = async (skuId, warehouse) => {
  const rows = await InventoryStock.find(warehouse ? { skuId, warehouse } : { skuId }).lean();
  return Number(combineStockRows(rows)?.qtyOnHand || 0);
};

const historyRow = async (batchNo) => {
  const h = await rmImsService.listCuttingHistory({ search: batchNo, limit: 200 });
  return h.docs.find((d) => d.batchNo === batchNo) || null;
};

const api = async () => {
  await connect();
  const { user, byCode, receipts } = await loadContext();
  const scrapSku = byCode[SCRAP_SKU_CODE];
  let seq = 0;
  const round = (key, coilKg, circles, extra = {}) => {
    const r = receipts[key];
    return rmImsService.convert({
      conversionDate: new Date(Date.UTC(2026, 9, 1 + seq)),
      clientRequestId: `mr-${key}-${++seq}`,
      batchNo: r.batchNo, coilReceiptId: r._id, coilSkuId: r.skuId,
      coilWeightKg: coilKg, rate: r.unitCost, warehouse: r.warehouse, scrapVerified: 'PENDING',
      circles, ...extra,
    }, user);
  };
  const circle = (code, pcs, weightKg) => ({ circleSkuId: byCode[code]._id, pcs, weightKg });
  const counts = async () => ({
    movs: await InventoryMovement.countDocuments({}),
    convs: await CoilConversion.countDocuments({}),
    scraps: await ScrapRecord.countDocuments({}),
  });
  const refused = async (label, fn, msgRx) => {
    const before = await counts();
    let err = null;
    try { await fn(); } catch (e) { err = e; }
    const after = await counts();
    check(`${label} is refused`, !!err && (!msgRx || msgRx.test(err.message)), err ? err.message : 'it was ACCEPTED');
    check('   …and moved NO stock, wrote NO conversion or scrap record', eq(before, after), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  };

  /* ── A. One coil, four rounds, at the plant ── */
  console.log('\nA. PLG01 coil MR-PLG-4R (2,000 kg): rounds 500 / 700 / 300 / 500');
  const plg = receipts.PLG4;
  const coilPlgBefore = await stockOf(plg.skuId, 'PLG01');
  const scrapPlgBefore = await stockOf(scrapSku._id, 'PLG01');
  let lin = await rmImsService.getCoilLineage(plg._id);
  check('before any round: status NOT_CUT, available 2,000', lin.totals.coil.status === 'NOT_CUT' && lin.totals.coil.availableKg === 2000,
    `${lin.totals.coil.status} / ${lin.totals.coil.availableKg}`);
  check('before any round: the coil is not in Cutting History', !(await historyRow('MR-PLG-4R')));

  const plan = [[500, 450], [700, 600], [300, 250], [500, 430]];
  const expectRemaining = [1500, 800, 500, 0];
  const expectStatus = ['PARTIALLY_CUT', 'PARTIALLY_CUT', 'PARTIALLY_CUT', 'FULLY_CUT'];
  const saved = [];
  for (let i = 0; i < plan.length; i += 1) {
    const [cut, out] = plan[i];
    const doc = await round('PLG4', cut, [circle('JSL204-07-700', Math.round(out / 5), out)]);
    saved.push(doc);
    lin = await rmImsService.getCoilLineage(plg._id);
    const row = await historyRow('MR-PLG-4R');
    check(`round ${i + 1}: ${cut} kg cut → remaining ${expectRemaining[i]}, ${expectStatus[i]}, ${i + 1} round(s)`,
      lin.totals.remainingKg === expectRemaining[i] && lin.totals.coil.status === expectStatus[i] && lin.totals.rounds === i + 1
        && row?.remainingKg === expectRemaining[i] && row?.status === expectStatus[i] && row?.rounds === i + 1,
      `lineage ${lin.totals.remainingKg}/${lin.totals.coil.status}/${lin.totals.rounds} · history ${row?.remainingKg}/${row?.status}/${row?.rounds}`);
    check(`round ${i + 1}: scrap = cut − circles = ${cut - out}, yield = circles ÷ cut`,
      doc.scrapKg === cut - out && doc.yieldRatioPct === Math.round((out / cut) * 10000) / 100,
      `scrap ${doc.scrapKg}, yield ${doc.yieldRatioPct}`);
  }
  check('all four rounds link to the SAME physical coil (coilReceiptId) and batch',
    saved.every((d) => String(d.coilReceiptId) === String(plg._id) && d.batchNo === 'MR-PLG-4R'));
  check('four SEPARATE conversion documents, one per round',
    new Set(saved.map((d) => String(d._id))).size === 4 && new Set(saved.map((d) => d.conversionNumber)).size === 4);
  check('rounds listed in order 1–4 with remaining 1,500 / 800 / 500 / 0',
    eq(lin.rounds.map((r) => r.roundNo), [1, 2, 3, 4]) && eq(lin.rounds.map((r) => r.remainingAfterKg), [1500, 800, 500, 0]),
    lin.rounds.map((r) => `${r.roundNo}:${r.remainingAfterKg}`).join(' '));
  check('round statuses Partial, Partial, Partial, Fully cut',
    eq(lin.rounds.map((r) => r.status), ['PARTIAL', 'PARTIAL', 'PARTIAL', 'FULLY_CUT']));
  const plgRow = await historyRow('MR-PLG-4R');
  check('history row: original 2,000, total cut 2,000, circles 1,730, scrap 270, remaining 0',
    plgRow.receivedKg === 2000 && plgRow.cutKg === 2000 && plgRow.circlesKg === 1730 && plgRow.scrapKg === 270 && plgRow.remainingKg === 0,
    JSON.stringify({ r: plgRow.receivedKg, c: plgRow.cutKg, o: plgRow.circlesKg, s: plgRow.scrapKg, rem: plgRow.remainingKg }));
  check('history row: yield is WEIGHTED 1,730 ÷ 2,000 = 86.5% (not the mean of the round yields)',
    plgRow.yieldPct === 86.5, `${plgRow.yieldPct} (round mean would be ${Math.round(saved.reduce((s, d) => s + d.yieldRatioPct, 0) / 4 * 100) / 100})`);
  check('history row: location PLG01, all 270 kg is Ambika scrap, reconciles with the ledger',
    plgRow.location === 'PLG01' && plgRow.plantScrapKg === 270 && plgRow.jobWorkScrapKg === 0 && plgRow.reconciles === true);
  const scrapIns = await InventoryMovement.find({ txnType: TXN_TYPE.SCRAP_IN, refId: { $in: saved.map((d) => d._id) } }).lean();
  check('PLG01: one SCRAP_IN per round, for that round\'s own scrap (50 / 100 / 50 / 70)',
    scrapIns.length === 4 && eq(saved.map((d) => scrapIns.find((m) => String(m.refId) === String(d._id))?.quantity), [50, 100, 50, 70]));
  check('PLG01 scrap stock rose by exactly 270 kg', (await stockOf(scrapSku._id, 'PLG01')) - scrapPlgBefore === 270,
    `${scrapPlgBefore} → ${await stockOf(scrapSku._id, 'PLG01')}`);
  check('coil stock (JSL204-07 @ PLG01) fell by exactly 2,000 kg', coilPlgBefore - (await stockOf(plg.skuId, 'PLG01')) === 2000);
  check('circle stock JSL204-07-700 holds the pieces of all four rounds', (await stockOf(byCode['JSL204-07-700']._id)) === 346,
    `${await stockOf(byCode['JSL204-07-700']._id)} pcs`);
  await refused('a fifth round on the fully cut coil (no override)',
    () => round('PLG4', 1, [circle('JSL204-07-700', 1, 1)]), /fully cut — 0 KG is available/);

  /* ── B. Validation ── */
  console.log('\nB. Validation on MR-OVER (1,000 kg)');
  await refused('1,001 kg from a coil with 1,000 available',
    () => round('OVER', 1001, [circle('JSL204-07-700', 10, 900)]), /Only 1,000 KG is available from this physical coil/);
  const schemaBase = {
    coilSkuId: String(receipts.OVER.skuId), coilReceiptId: String(receipts.OVER._id),
    circles: [{ circleSkuId: String(byCode['JSL204-07-700']._id), pcs: 1, weightKg: 1 }],
  };
  check('0 kg is refused at the API boundary', !!rmConvertSchema.validate({ ...schemaBase, coilWeightKg: 0 }).error);
  check('negative kg is refused at the API boundary', !!rmConvertSchema.validate({ ...schemaBase, coilWeightKg: -5 }).error);
  await refused('0 kg reaching the service directly', () => round('OVER', 0, [circle('JSL204-07-700', 1, 1)]));
  await refused('a negative weight reaching the service directly', () => round('OVER', -5, [circle('JSL204-07-700', 1, 1)]));
  const overRound1 = await round('OVER', 400, [circle('JSL204-07-700', 70, 350)]);
  check('a valid first round on MR-OVER saves (400 kg → 600 left)', !!overRound1?._id);
  await refused('601 kg once only 600 is left', () => round('OVER', 601, [circle('JSL204-07-700', 10, 500)]),
    /Only 600 KG is available from this physical coil/);
  const overDoc = await round('OVER', 700, [circle('JSL204-07-700', 120, 600)], { allowNegative: true });
  check('with "Allow cutting more coil than we hold" ON, 700 kg of 600 is accepted (existing behaviour)', !!overDoc?._id);
  lin = await rmImsService.getCoilLineage(receipts.OVER._id);
  const overRow = await historyRow('MR-OVER');
  check('…and the resulting −100 kg is SHOWN, not hidden: FULLY_CUT with overCut',
    lin.totals.remainingKg === -100 && lin.totals.coil.status === 'FULLY_CUT' && lin.totals.coil.overCut === true
      && overRow.remainingKg === -100 && overRow.overCut === true && overRow.status === 'FULLY_CUT',
    `${lin.totals.remainingKg} / ${lin.totals.coil.status} / overCut ${lin.totals.coil.overCut}`);

  /* ── C. Job work ── */
  console.log('\nC. JW001 coil MR-JW-2R (2,000 kg): rounds 1,000 / 1,000');
  const jw = receipts.JW2;
  const scrapAllBefore = await stockOf(scrapSku._id);
  const scrapPlgBeforeJw = await stockOf(scrapSku._id, 'PLG01');
  const jw1 = await round('JW2', 1000, [circle('JSL204-08-850', 170, 850)]);
  const jw2 = await round('JW2', 1000, [circle('JSL204-08-850', 164, 820)]);
  check('both job-work rounds save', !!jw1?._id && !!jw2?._id);
  check('circles are recorded (CONVERT_IN per round)',
    (await InventoryMovement.countDocuments({ txnType: TXN_TYPE.CONVERT_IN, refNumber: { $in: [jw1.conversionNumber, jw2.conversionNumber] } })) === 2);
  check('NO SCRAP_IN for either job-work round',
    (await InventoryMovement.countDocuments({ txnType: TXN_TYPE.SCRAP_IN, refId: { $in: [jw1._id, jw2._id] } })) === 0);
  check('PLG01 scrap stock did not move', (await stockOf(scrapSku._id, 'PLG01')) === scrapPlgBeforeJw);
  check('no scrap stock anywhere moved', (await stockOf(scrapSku._id)) === scrapAllBefore);
  const jwScrapRecs = await ScrapRecord.find({ conversionId: { $in: [jw1._id, jw2._id] } }).lean();
  check('each round keeps a JW001 ScrapRecord (traceability) with no stock movement',
    jwScrapRecs.length === 2 && jwScrapRecs.every((s) => s.location === 'JW001' && !s.stockMovementId));
  check('both rounds link to the same physical coil', [jw1, jw2].every((d) => String(d.coilReceiptId) === String(jw._id)));
  const jwRow = await historyRow('MR-JW-2R');
  check('history row: JW001, 2 rounds, fully cut, 330 kg calculated scrap all with the job worker, yield 83.5%',
    jwRow.location === 'JW001' && jwRow.rounds === 2 && jwRow.status === 'FULLY_CUT' && jwRow.scrapKg === 330
      && jwRow.jobWorkScrapKg === 330 && jwRow.plantScrapKg === 0 && jwRow.yieldPct === 83.5,
    JSON.stringify({ loc: jwRow.location, rounds: jwRow.rounds, st: jwRow.status, s: jwRow.scrapKg, jw: jwRow.jobWorkScrapKg, y: jwRow.yieldPct }));

  /* ── D. Coil → circle mapping ── */
  console.log('\nD. Coil → Circle mapping');
  await refused('a DD circle (JSL202-06-700) from a copper coil', () => round('HIST', 100, [circle('JSL202-06-700', 10, 80)]),
    /cannot be produced from coil JSL204-08/);

  /* ── E. Replay ── */
  console.log('\nE. Idempotency + F. historical data on MR-HIST');
  const histBefore = await CoilConversion.findOne({ sourceRef: HIST_SOURCE_REF }).lean();
  const replayPayload = {
    conversionDate: new Date(Date.UTC(2026, 9, 20)), clientRequestId: 'mr-hist-replay',
    batchNo: 'MR-HIST', coilReceiptId: receipts.HIST._id, coilSkuId: receipts.HIST.skuId,
    coilWeightKg: 400, rate: 190, warehouse: 'PLG01', scrapVerified: 'PENDING',
    circles: [circle('JSL204-08-850', 68, 340)],
  };
  const c1 = await rmImsService.convert(replayPayload, user);
  const before = await counts();
  const c2 = await rmImsService.convert(replayPayload, user);
  const after = await counts();
  check('the same submission sent twice is ONE round', String(c1._id) === String(c2._id) && eq(before, after),
    `${c1.conversionNumber} / ${c2.conversionNumber}`);

  /* ── F. Historical ── */
  const histRow = await historyRow('MR-HIST');
  check('a coil partly consumed by an unlinked historical cut: rounds show 400 cut, 1 round',
    histRow.cutKg === 400 && histRow.rounds === 1, `${histRow.cutKg} / ${histRow.rounds}`);
  check('…remaining from rounds 1,100, but the ledger says 500 — reported as NOT reconciled, 600 kg outside the rounds',
    histRow.remainingKg === 1100 && histRow.ledgerAvailableKg === 500 && histRow.otherOutKg === 600 && histRow.reconciles === false,
    JSON.stringify({ rem: histRow.remainingKg, led: histRow.ledgerAvailableKg, other: histRow.otherOutKg }));
  check('…status follows the ledger: PARTIALLY_CUT', histRow.status === 'PARTIALLY_CUT');
  const histAfter = await CoilConversion.findOne({ sourceRef: HIST_SOURCE_REF }).lean();
  check('the historical conversion is untouched — still no coilReceiptId, not rewritten',
    !histAfter.coilReceiptId && String(histAfter.updatedAt) === String(histBefore.updatedAt));
  const hist = await rmImsService.listCuttingHistory({ limit: 200 });
  check('it is counted as untraceable, not attached to the coil', hist.summary.untraceable.records === 1,
    JSON.stringify(hist.summary.untraceable));
  await refused('600 kg from MR-HIST, whose LEDGER has only 500 left', () => round('HIST', 600, [circle('JSL204-08-850', 10, 500)]),
    /Only 500 KG is available from this physical coil/);

  /* ── G. History list shape ── */
  console.log('\nG. Cutting History list');
  check('one row per physical coil — 4 coils cut, however many rounds',
    hist.docs.length === 4 && hist.summary.coils === 4 && new Set(hist.docs.map((d) => String(d.coilReceiptId))).size === 4,
    hist.docs.map((d) => `${d.batchNo}×${d.rounds}`).join(', '));
  check('an uncut coil (MR-UI-B001) is not listed', !hist.docs.some((d) => d.batchNo === 'MR-UI-B001'));
  check('rounds counted across the list: 4 + 2 + 2 + 1 = 9', hist.summary.rounds === 9, String(hist.summary.rounds));
  const onlyJw = await rmImsService.listCuttingHistory({ location: 'JW001' });
  check('location filter JW001 → only the job-work coil', onlyJw.docs.length === 1 && onlyJw.docs[0].batchNo === 'MR-JW-2R');
  const partial = await rmImsService.listCuttingHistory({ status: 'PARTIALLY_CUT' });
  check('status filter PARTIALLY_CUT → only MR-HIST', partial.docs.length === 1 && partial.docs[0].batchNo === 'MR-HIST',
    partial.docs.map((d) => d.batchNo).join(','));

  /* ── H. Regression: Scrap by Physical Coil groups the same rounds ── */
  console.log('\nH. Scrap by Physical Coil');
  const byCoil = await scrapImsService.getScrapByCoil({ limit: 50 });
  const byCoilRows = byCoil.docs || byCoil.data || byCoil.rows || [];
  const sp = byCoilRows.find((r) => r.batchNo === 'MR-PLG-4R');
  check('Scrap by Physical Coil still shows MR-PLG-4R as ONE coil with 4 rounds and 270 kg scrap',
    sp?.rounds === 4 && sp?.scrapKg === 270 && sp?.remainingKg === 0, JSON.stringify(sp && { rounds: sp.rounds, s: sp.scrapKg, rem: sp.remainingKg }));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  await mongoose.disconnect();
  return failed.length === 0;
};

/** After the browser test: MR-UI-B001 was cut in two rounds of 1,000 kg. */
const verify = async () => {
  await connect();
  const { byCode, receipts } = await loadContext();
  const ui = receipts.UI;
  console.log('\nVERIFY — what the browser saved for MR-UI-B001');
  const convs = await CoilConversion.find({ batchNo: 'MR-UI-B001' }).sort({ createdAt: 1 }).lean();
  check('exactly two conversions — no duplicate from a retry', convs.length === 2, String(convs.length));
  check('both link to the same physical coil', convs.every((c) => String(c.coilReceiptId) === String(ui._id)));
  check('each round cut 1,000 kg', eq(convs.map((c) => c.coilWeightKg), [1000, 1000]));
  check('round 1: 850 kg circles, 150 scrap, 85%; round 2: 820, 180, 82%',
    eq(convs.map((c) => [c.circlesWeightKg, c.scrapKg, c.yieldRatioPct]), [[850, 150, 85], [820, 180, 82]]),
    JSON.stringify(convs.map((c) => [c.circlesWeightKg, c.scrapKg, c.yieldRatioPct])));
  const lin = await rmImsService.getCoilLineage(ui._id);
  check('lineage: 2 rounds, remaining 1,000 then 0, Partial then Fully cut',
    eq(lin.rounds.map((r) => [r.roundNo, r.remainingAfterKg, r.status]), [[1, 1000, 'PARTIAL'], [2, 0, 'FULLY_CUT']]));
  check('coil status FULLY_CUT, ledger reconciles', lin.totals.coil.status === 'FULLY_CUT' && lin.totals.reconciles === true);
  const scrapIns = await InventoryMovement.find({ txnType: TXN_TYPE.SCRAP_IN, refId: { $in: convs.map((c) => c._id) } }).lean();
  check('PLG01: SCRAP_IN 150 + 180', eq(scrapIns.map((m) => m.quantity).sort((a, b) => a - b), [150, 180]));
  const ledger = await InventoryMovement.find({ batchNo: 'MR-UI-B001', skuId: byCode['JSL202-06']._id }).lean();
  const avail = ledger.reduce((s, m) => s + (m.movementType === 'IN' ? m.quantity : -m.quantity), 0);
  check('batch ledger: nothing left', avail === 0, String(avail));
  const row = await historyRow('MR-UI-B001');
  check('history row: cut 2,000, circles 1,670, scrap 330, yield 83.5, 2 rounds, fully cut',
    row?.cutKg === 2000 && row?.circlesKg === 1670 && row?.scrapKg === 330 && row?.yieldPct === 83.5 && row?.rounds === 2 && row?.status === 'FULLY_CUT',
    JSON.stringify(row && { c: row.cutKg, o: row.circlesKg, s: row.scrapKg, y: row.yieldPct, n: row.rounds, st: row.status }));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  await mongoose.disconnect();
  return failed.length === 0;
};

const dump = async () => {
  await connect();
  const h = await rmImsService.listCuttingHistory({ limit: 200 });
  console.log(JSON.stringify(h, null, 2));
  await mongoose.disconnect();
};

const mode = process.argv[2];
const main = async () => {
  if (mode === '--seed') return seed();
  if (mode === '--api') return api().then((p) => process.exit(p ? 0 : 1));
  if (mode === '--verify') return verify().then((p) => process.exit(p ? 0 : 1));
  if (mode === '--dump') return dump();
  console.error('Usage: --seed | --api | --verify | --dump');
  process.exit(1);
};

main().catch(async (e) => {
  console.error('\nFixture failed:', e.stack || e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
