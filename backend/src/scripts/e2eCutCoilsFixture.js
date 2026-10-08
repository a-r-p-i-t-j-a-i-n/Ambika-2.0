/**
 * Fixture + database oracle for the Cut Coils → Circles browser test.
 *
 *   node src/scripts/e2eCutCoilsFixture.js --seed     fresh scratch DB + test data
 *   node src/scripts/e2eCutCoilsFixture.js --api      drive POST /convert directly
 *   node src/scripts/e2eCutCoilsFixture.js --verify   assert the final DB state
 *   node src/scripts/e2eCutCoilsFixture.js --dump     print current state as JSON
 *
 * Pairs with frontend/e2e/cutCoils.e2e.mjs, which drives the real UI in Chromium.
 * The browser performs the operator's actions; this file is the independent
 * check on what landed in the database, so no result rests on a success toast.
 *
 * SAFETY: pinned to a localhost scratch database, which --seed drops. It never
 * reads the configured MONGO_URI, so it cannot touch the client's Atlas data —
 * which matters more than usual here, because a conversion MOVES STOCK.
 *
 * The SKU codes are the client's real ones on purpose: the mapping is keyed by
 * code, so a fixture with invented codes would exercise no mapping at all.
 */
import mongoose from 'mongoose';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryMovement, { MOVEMENT_TYPE, TXN_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import ScrapRecord from '../modules/inventory/scrapRecord.model.js';
import { inventoryService } from '../modules/inventory/inventory.service.js';
import { rmImsService } from '../modules/inventory/rmIms.service.js';
import { SCRAP_SKU_CODE, SCRAP_SKU_DEFAULTS } from '../modules/inventory/scrapSku.js';
import { COIL_CIRCLE_MAP, allowedCirclesForCoil } from '../data/coil-circle-map.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_cutcoils';
export const E2E_USER = { email: 'cut-e2e@test.local', password: 'E2e@12345', name: 'Cut Coils E2E', role: 'MD' };

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(E2E_URI)) {
  console.error('Refusing to run: fixture must target localhost.');
  process.exit(1);
}

/** Coils: the six the client mapped, plus the one they did not. */
const COILS = [
  { code: 'JSL202-06', name: 'DD 0.60 mm', category: 'DD Steel' },
  { code: 'JSL202-07', name: 'DD 0.70 mm', category: 'DD Steel' },
  { code: 'JSL202-08', name: 'DD 0.80 mm', category: 'DD Steel' },
  { code: 'JSL204-07', name: 'Cu 0.70 mm', category: 'Copper' },
  { code: 'JSL204-08', name: 'Cu 0.80 mm', category: 'Copper' },
  { code: 'JSL204-10', name: 'Cu 1.00 mm', category: 'Copper' },
  // Active, real, and absent from the client's sheet — the unmapped case.
  { code: 'JSL204-06', name: 'Cu 0.60 mm', category: 'Copper' },
];

/**
 * Circles: every approved size, plus the two orphans that are active in the
 * real master and on no coil's row. The orphans are what prove the dropdown
 * filters rather than merely listing whatever happens to exist.
 */
const ORPHAN_CIRCLES = [
  { code: 'JSL202-06-825', name: 'DD - 0.6mm - 8.25"' },
  { code: 'JSL202-07-725', name: 'DD - 0.7mm - 7.25"' },
];

/**
 * One received coil per mapped coil, so any of them can be cut by batch.
 *
 * `warehouse` is the GRN's own "Received At" — PLG01 unless stated, matching
 * every receipt before this field existed. The three JW001 rows exist purely
 * to prove the PLG01/JW001 scrap-ownership rule: two dedicated to the direct
 * `--api` cuts below, one left untouched for the browser test to look up (so
 * the two halves never compete for the same coil's remaining weight).
 */
const RECEIPTS = [
  { coil: 'JSL204-07', batchNo: 'E2E-BATCH-JSL204-07', weight: 600, rate: 180 },
  { coil: 'JSL204-08', batchNo: 'E2E-BATCH-JSL204-08', weight: 800, rate: 190 },
  { coil: 'JSL202-06', batchNo: 'E2E-BATCH-JSL202-06', weight: 500, rate: 170 },
  { coil: 'JSL204-06', batchNo: 'E2E-BATCH-JSL204-06', weight: 400, rate: 165 },
  // Received At / scrap-ownership fixtures (see "PLG01 vs JW001" in --api).
  { coil: 'JSL204-10', batchNo: 'E2E-SCRAP-PLG', weight: 300, rate: 200, warehouse: 'PLG01' },
  { coil: 'JSL204-10', batchNo: 'E2E-SCRAP-JW', weight: 300, rate: 200, warehouse: 'JW001' },
  // Reserved for the browser: never touched by --api, so its full weight and
  // "Received At" are exactly as the GRN posted them when the UI looks it up.
  { coil: 'JSL202-08', batchNo: 'E2E-BATCH-JSL202-08-JW', weight: 500, rate: 175, warehouse: 'JW001' },
];

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (!/ambika_e2e_cutcoils$/.test(mongoose.connection.name || '')) {
    throw new Error(`Connected to an unexpected database (${mongoose.connection.name}) — aborting.`);
  }
};

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();

  const user = await User.create({
    ...E2E_USER, password: E2E_USER.password, mobile: '9000000003', isActive: true, roles: ['MD'],
  });

  const skus = {};
  for (const c of COILS) {
    skus[c.code] = await SKU.create({ ...c, unit: 'KGS', itemType: 'RAW_MATERIAL', isActive: true });
  }
  // QA-style RAW_MATERIAL items with no Coil → Circle mapping, shaped like the
  // ones found in the real master (one with no unit at all). They are real RM
  // items and must stay in RM stock — but Cut Coils must never offer them.
  await SKU.create({ code: 'QA-FMS-SKU-NOUNIT', name: 'QA-FMS No-Unit Item', itemType: 'RAW_MATERIAL', isActive: true, unit: '' });
  await SKU.create({ code: 'QA-TEST-COIL-01', name: 'QA Test Coil', itemType: 'RAW_MATERIAL', unit: 'KGS', isActive: true });
  const circleRows = [
    ...Object.values(COIL_CIRCLE_MAP).flat().map((c) => ({ code: c.code, name: c.clientLabel })),
    ...ORPHAN_CIRCLES,
  ];
  for (const c of circleRows) {
    if (skus[c.code]) continue;
    skus[c.code] = await SKU.create({ ...c, unit: 'PCS', itemType: 'CIRCLE', isActive: true });
  }

  // An in-house (PLG01) cut posts its offcut into scrap stock, so the scrap
  // item has to exist or the cut fails for a reason that has nothing to do with
  // the mapping. Same item the real system uses, created the way ensureScrapSku
  // creates it — this is existing behaviour the fixture has to satisfy.
  await SKU.create({ code: SCRAP_SKU_CODE, ...SCRAP_SKU_DEFAULTS, isActive: true });

  // The received coils, posted through the real stock engine as GRN_IN — the
  // same movements listReceivedCoils reads back, so the batch lookup behaves
  // exactly as it does in production rather than against hand-built rows.
  for (const r of RECEIPTS) {
    const sku = skus[r.coil];
    await inventoryService.increaseStock({
      skuId: sku._id, skuCode: sku.code, skuName: sku.name, unit: 'KGS',
      quantity: r.weight, unitCost: r.rate, warehouse: r.warehouse || 'PLG01',
      txnType: TXN_TYPE.GRN_IN, sourceModule: 'GRN', refType: 'GRN', refNumber: `GRN-E2E-${r.batchNo}`,
      batchNo: r.batchNo, remarks: 'Cut Coils e2e fixture receipt',
      performedBy: user, movementDate: new Date(),
    });
  }

  console.log(JSON.stringify({
    ok: true, user: E2E_USER,
    receipts: RECEIPTS.map((r) => ({ batchNo: r.batchNo, coil: r.coil, weight: r.weight, warehouse: r.warehouse || 'PLG01' })),
    skuCount: Object.keys(skus).length,
  }, null, 2));
  await mongoose.disconnect();
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/**
 * The API half of the proof: the mapping must hold for a caller that never saw
 * the dropdown. Goes through rmImsService.convert() exactly as the route does.
 *
 * The important assertion is not just that a bad combination is refused — it is
 * that refusing it moved NO stock and wrote NO conversion. A validation that
 * threw after decreaseStock would still "reject", and would still have eaten
 * the coil.
 */
const api = async () => {
  await connect();
  const user = await User.findOne({ email: E2E_USER.email }).lean();
  const byCode = {};
  for (const s of await SKU.find({}).lean()) byCode[s.code] = s;
  const receiptOf = async (batchNo) => InventoryMovement.findOne({ batchNo, txnType: TXN_TYPE.GRN_IN }).lean();

  const countsNow = async () => ({
    movs: await InventoryMovement.countDocuments({}),
    convs: await CoilConversion.countDocuments({}),
    coilStock: (await InventoryStock.findOne({ skuId: byCode['JSL204-07']._id }).lean())?.qtyOnHand ?? 0,
  });

  const attempt = async (payload) => {
    const before = await countsNow();
    let error = null;
    let doc = null;
    try { doc = await rmImsService.convert(payload, user); } catch (e) { error = e; }
    const after = await countsNow();
    return { before, after, error, doc };
  };

  const receipt = await receiptOf('E2E-BATCH-JSL204-07');
  const base = {
    conversionDate: new Date(), batchNo: receipt.batchNo,
    coilSkuId: byCode['JSL204-07']._id, coilReceiptId: receipt._id,
    coilWeightKg: 100, rate: 180, warehouse: 'PLG01', scrapVerified: 'PENDING',
  };

  console.log('\nAPI — backend validation (no browser involved)');

  // 1. A circle from another coil family.
  let r = await attempt({
    ...base, clientRequestId: 'e2e-api-cross-family',
    circles: [{ circleSkuId: byCode['JSL204-08-850']._id, pcs: 10, weightKg: 40 }],
  });
  check('cross-family circle is rejected', r.error?.statusCode === 400,
    r.error?.message || 'no error thrown');
  check('rejected cross-family combination moved NO stock and wrote NO conversion',
    r.before.movs === r.after.movs && r.before.convs === r.after.convs
    && r.before.coilStock === r.after.coilStock,
    `movements ${r.before.movs}→${r.after.movs}, conversions ${r.before.convs}→${r.after.convs}, coil ${r.before.coilStock}→${r.after.coilStock} kg`);

  // 2. A good row carrying a bad one — the "add another row" bypass.
  r = await attempt({
    ...base, clientRequestId: 'e2e-api-second-row',
    circles: [
      { circleSkuId: byCode['JSL204-07-700']._id, pcs: 10, weightKg: 30 },
      { circleSkuId: byCode['JSL204-10-925']._id, pcs: 5, weightKg: 20 },
    ],
  });
  check('an unapproved SECOND row is rejected even behind an approved first row',
    r.error?.statusCode === 400 && /JSL204-10-925/.test(r.error?.message || ''),
    r.error?.message || 'no error thrown');
  check('rejected multi-row attempt moved no stock',
    r.before.movs === r.after.movs && r.before.convs === r.after.convs);

  // 3. An orphan circle that no coil produces.
  r = await attempt({
    ...base, clientRequestId: 'e2e-api-orphan',
    circles: [{ circleSkuId: byCode['JSL202-06-825']._id, pcs: 10, weightKg: 40 }],
  });
  check('an active circle on no coil\'s row is rejected', r.error?.statusCode === 400,
    r.error?.message || 'no error thrown');

  // 4. The unmapped coil.
  const unmappedReceipt = await receiptOf('E2E-BATCH-JSL204-06');
  r = await attempt({
    conversionDate: new Date(), batchNo: unmappedReceipt.batchNo,
    coilSkuId: byCode['JSL204-06']._id, coilReceiptId: unmappedReceipt._id,
    coilWeightKg: 50, rate: 165, warehouse: 'PLG01', clientRequestId: 'e2e-api-unmapped',
    circles: [{ circleSkuId: byCode['JSL204-08-700']._id, pcs: 5, weightKg: 20 }],
  });
  check('an UNMAPPED coil is refused outright, not given a free pass',
    r.error?.statusCode === 400 && /No approved circle sizes are configured/.test(r.error?.message || ''),
    r.error?.message || 'no error thrown');

  // 5. The approved combination still saves, with the arithmetic untouched.
  r = await attempt({
    ...base, clientRequestId: 'e2e-api-valid',
    circles: [
      { circleSkuId: byCode['JSL204-07-700']._id, sizeLabel: 'Cu - 0.7mm - 7.00"', pcs: 40, weightKg: 50 },
      { circleSkuId: byCode['JSL204-07-750']._id, sizeLabel: 'Cu - 0.7mm - 7.50"', pcs: 25, weightKg: 35 },
    ],
  });
  check('an approved combination saves', !r.error && !!r.doc?.conversionNumber,
    r.error?.message || r.doc?.conversionNumber);
  check('scrap and yield are unchanged by this feature',
    r.doc?.scrapKg === 15 && r.doc?.yieldRatioPct === 85,
    `scrap ${r.doc?.scrapKg} kg (expect 15), yield ${r.doc?.yieldRatioPct}% (expect 85)`);
  check('the coil was deducted and both circles were created',
    r.after.coilStock === r.before.coilStock - 100 && r.after.convs === r.before.convs + 1,
    `coil ${r.before.coilStock}→${r.after.coilStock} kg`);
  check('batch number is still carried onto the conversion',
    r.doc?.batchNo === 'E2E-BATCH-JSL204-07', r.doc?.batchNo);

  // 6. The rejected idempotency keys are still usable — a corrected retry works.
  r = await attempt({
    ...base, clientRequestId: 'e2e-api-cross-family', // the SAME key as attempt 1
    circles: [{ circleSkuId: byCode['JSL204-07-840']._id, pcs: 12, weightKg: 30 }],
  });
  check('a corrected retry under the id of a REJECTED attempt is accepted',
    !r.error && !!r.doc?.conversionNumber, r.error?.message || r.doc?.conversionNumber);

  // 7. /circle-options is the dropdown's source and agrees with the sheet.
  const opts = await rmImsService.listCircleOptions({ coilSkuId: byCode['JSL204-07']._id });
  check('circle-options returns exactly the approved sizes for JSL204-07',
    opts.mapped === true
    && opts.circles.map((c) => c.skuCode).join(',') === 'JSL204-07-700,JSL204-07-750,JSL204-07-840',
    opts.circles.map((c) => c.skuCode).join(', '));
  const unmappedOpts = await rmImsService.listCircleOptions({ coilSkuId: byCode['JSL204-06']._id });
  check('circle-options reports an unmapped coil as mapped:false with an EMPTY list',
    unmappedOpts.mapped === false && unmappedOpts.circles.length === 0,
    `mapped=${unmappedOpts.mapped}, ${unmappedOpts.circles.length} circles`);

  /**
   * ── PLG01 vs JW001: "Received At" decides scrap ownership, not "Scrap checked?" ──
   *
   * Four cuts, one per corner of the matrix — {PLG01, JW001} × {Not yet
   * checked, Verified} — each against its OWN dedicated receipt (E2E-SCRAP-PLG
   * / E2E-SCRAP-JW, 300 kg, never touched above), so none of them compete for
   * remaining weight. Every cut must succeed and produce circles + a
   * ScrapRecord regardless of location or verification state; only the SCRAP
   * STOCK side is allowed to differ, and only by location.
   */
  console.log('\nReceived At → scrap ownership (PLG01 vs JW001)');
  const scrapSku = await SKU.findOne({ code: SCRAP_SKU_CODE }).lean();
  const scrapStockAt = async (wh) => (await InventoryStock.findOne({ skuId: scrapSku._id, warehouse: wh }).lean())?.qtyOnHand || 0;
  const plgReceipt = await receiptOf('E2E-SCRAP-PLG');
  const jwReceipt = await receiptOf('E2E-SCRAP-JW');

  const scrapCut = async (receipt, scrapVerified, rid) => {
    const before = scrapSku ? await scrapStockAt(receipt.warehouse) : 0;
    const doc = await rmImsService.convert({
      conversionDate: new Date(), batchNo: receipt.batchNo,
      coilSkuId: byCode['JSL204-10']._id, coilReceiptId: receipt._id,
      coilWeightKg: 100, rate: 200, warehouse: receipt.warehouse, scrapVerified,
      clientRequestId: rid,
      circles: [{ circleSkuId: byCode['JSL204-10-850']._id, pcs: 10, weightKg: 40 }],
    }, user);
    const scrapDoc = await ScrapRecord.findOne({ conversionId: doc._id }).lean();
    const after = await scrapStockAt(receipt.warehouse);
    return { doc, scrapDoc, before, after };
  };

  // [9] PLG01 + Not yet checked → scrap posted.
  let s = await scrapCut(plgReceipt, 'PENDING', 'e2e-api-scrap-plg-pending');
  check('[9] PLG01 + "Not yet checked": conversion succeeds and circles are created',
    !!s.doc?.conversionNumber && s.doc.circlesWeightKg === 40, s.doc?.conversionNumber);
  check('[9] …ScrapRecord carries location PLG01, disposition PENDING',
    s.scrapDoc?.location === 'PLG01' && s.scrapDoc?.disposition === 'PENDING', JSON.stringify(s.scrapDoc && { l: s.scrapDoc.location, d: s.scrapDoc.disposition }));
  check('[9] …a SCRAP_IN moved the scrap into PLG01 stock (stockMovementId set, balance +60 kg)',
    !!s.scrapDoc?.stockMovementId && s.after === s.before + 60, `stockMovementId=${s.scrapDoc?.stockMovementId}, ${s.before}→${s.after}`);

  // [10] PLG01 + Verified → same stock behaviour, verification status = Verified.
  s = await scrapCut(plgReceipt, 'DONE', 'e2e-api-scrap-plg-done');
  check('[10] PLG01 + "Verified": conversion succeeds', !!s.doc?.conversionNumber, s.doc?.conversionNumber);
  check('[10] …disposition is DONE (Verified), NOT a location — PLG01 still owns the scrap',
    s.scrapDoc?.location === 'PLG01' && s.scrapDoc?.disposition === 'DONE', JSON.stringify(s.scrapDoc && { l: s.scrapDoc.location, d: s.scrapDoc.disposition }));
  check('[10] …scrap stock still increases exactly the same way (+60 kg)',
    !!s.scrapDoc?.stockMovementId && s.after === s.before + 60, `${s.before}→${s.after}`);

  // [14] JW001 + Not yet checked → NO SCRAP_IN, no PLG01 stock increase.
  const plgBeforeJw1 = await scrapStockAt('PLG01');
  s = await scrapCut(jwReceipt, 'PENDING', 'e2e-api-scrap-jw-pending');
  check('[14] JW001 + "Not yet checked": conversion succeeds and circles are created',
    !!s.doc?.conversionNumber && s.doc.circlesWeightKg === 40, s.doc?.conversionNumber);
  check('[14] …ScrapRecord still carries location JW001, disposition PENDING, for traceability',
    s.scrapDoc?.location === 'JW001' && s.scrapDoc?.disposition === 'PENDING', JSON.stringify(s.scrapDoc && { l: s.scrapDoc.location, d: s.scrapDoc.disposition }));
  check('[14][16] …NO SCRAP_IN was posted (stockMovementId is null) and JW001 stock did not move',
    !s.scrapDoc?.stockMovementId && s.after === s.before, `stockMovementId=${s.scrapDoc?.stockMovementId}, JW001 ${s.before}→${s.after}`);
  check('[17] …and PLG01 scrap stock did not increase either',
    (await scrapStockAt('PLG01')) === plgBeforeJw1, `PLG01 ${plgBeforeJw1}→${await scrapStockAt('PLG01')}`);

  // [15] JW001 + Verified → same: still no stock, regardless of verification.
  const plgBeforeJw2 = await scrapStockAt('PLG01');
  s = await scrapCut(jwReceipt, 'DONE', 'e2e-api-scrap-jw-done');
  check('[15] JW001 + "Verified": conversion succeeds', !!s.doc?.conversionNumber, s.doc?.conversionNumber);
  check('[15] …disposition is DONE, but the location is still JW001 — verifying scrap never moves it to Ambika stock',
    s.scrapDoc?.location === 'JW001' && s.scrapDoc?.disposition === 'DONE', JSON.stringify(s.scrapDoc && { l: s.scrapDoc.location, d: s.scrapDoc.disposition }));
  check('[15][16] …still no SCRAP_IN and no JW001 stock movement',
    !s.scrapDoc?.stockMovementId && s.after === s.before, `stockMovementId=${s.scrapDoc?.stockMovementId}`);
  check('[17] …PLG01 scrap stock is unaffected by a JW001 cut, however it was verified',
    (await scrapStockAt('PLG01')) === plgBeforeJw2, `PLG01 ${plgBeforeJw2}→${await scrapStockAt('PLG01')}`);

  // NOTE: an unsupported "Received At" (e.g. 'MAIN') reaching this far would
  // fall back silently inside resolveScrapLocation/convert() — that fallback
  // is deliberate for a cut that names NO location at all (see the doc comment
  // on resolveScrapLocation), so it is not re-tested here. What must not
  // happen is a bad value getting this far in the first place: that is
  // enforced one layer up, at the Joi boundary this script does not go
  // through — see rmConvertValidation.test.js.

  await mongoose.disconnect();
  return results.every((x) => x.pass);
};

/** Reads back what the BROWSER did. The toast is not evidence; this is. */
const verify = async () => {
  await connect();
  console.log('\nDB — what the browser actually saved');

  const convs = await CoilConversion.find({ isDeleted: { $ne: true } }).sort({ createdAt: 1 }).lean();
  const browserConvs = convs.filter((c) => !/^e2e-api-/.test(c.clientRequestId || ''));
  check('the browser saved a conversion', browserConvs.length > 0, `${browserConvs.length} found`);

  let allMapped = true;
  for (const c of convs) {
    const allowed = allowedCirclesForCoil(c.coilSkuCode);
    const codes = allowed ? allowed.map((a) => a.code) : [];
    for (const line of c.circles || []) {
      if (!codes.includes(line.circleSkuCode)) {
        allMapped = false;
        console.log(`        ${c.conversionNumber}: ${c.coilSkuCode} → ${line.circleSkuCode}`);
      }
    }
  }
  check('EVERY saved conversion obeys the client mapping', allMapped);

  const last = browserConvs[browserConvs.length - 1];
  if (last) {
    check('the saved conversion kept its batch number', !!last.batchNo, last.batchNo);
    check('the saved conversion kept its coil SKU', !!last.coilSkuCode, last.coilSkuCode);
    check('scrap = coil weight − circles weight',
      Math.abs(last.scrapKg - (last.coilWeightKg - last.circlesWeightKg)) < 0.011,
      `${last.coilWeightKg} − ${last.circlesWeightKg} = ${last.scrapKg}`);
    check('yield = circles ÷ coil',
      Math.abs(last.yieldRatioPct - (last.circlesWeightKg / last.coilWeightKg) * 100) < 0.011,
      `${last.yieldRatioPct}%`);
    check('a CONVERT_OUT was posted for the coil', !!last.coilMovementId, last.coilMovementNumber);
    check('a CONVERT_IN was posted for every circle',
      (last.circles || []).every((l) => !!l.movementId), `${last.circles?.length} circles`);
  }

  const outs = await InventoryMovement.countDocuments({ txnType: TXN_TYPE.CONVERT_OUT });
  const ins = await InventoryMovement.countDocuments({ txnType: TXN_TYPE.CONVERT_IN });
  check('conversion movements exist on both sides', outs > 0 && ins > 0, `${outs} out, ${ins} in`);

  /**
   * ── [18][19] The operator's own JW001 cut, as actually saved by the browser ──
   *
   * Found by batch number rather than "the last one", because the browser
   * saves a JW001 cut BEFORE its final PLG01 one (see cutCoils.e2e.mjs) — this
   * is the real database proof behind the UI-level checks there: Received At,
   * chosen through the dropdown by an operator, decided scrap ownership, and
   * nothing about "Scrap checked?" (left at its default, "Not yet checked")
   * had any say in it.
   */
  const jwConv = browserConvs.find((c) => c.batchNo === 'E2E-BATCH-JSL202-08-JW');
  check('[18] the browser\'s JW001 cut is in the database', !!jwConv, jwConv?.conversionNumber);
  if (jwConv) {
    const jwScrap = await ScrapRecord.findOne({ conversionId: jwConv._id }).lean();
    check('[19] its ScrapRecord is traced to the coil, with location JW001',
      jwScrap?.location === 'JW001' && String(jwScrap?.coilReceiptId) === String(jwConv.coilReceiptId),
      JSON.stringify(jwScrap && { location: jwScrap.location, coilReceiptId: jwScrap.coilReceiptId }));
    check('[16][17] …and carries NO stock movement — a UI-driven JW001 cut posts no SCRAP_IN',
      !jwScrap?.stockMovementId, `stockMovementId=${jwScrap?.stockMovementId}`);
    const jwScrapIn = await InventoryMovement.findOne({ txnType: TXN_TYPE.SCRAP_IN, refId: jwConv._id }).lean();
    check('[16] …confirmed directly: no SCRAP_IN movement references this conversion at all', !jwScrapIn);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n  ${results.length - failed.length}/${results.length} database checks passed.`);
  await mongoose.disconnect();
  return failed.length === 0;
};

const dump = async () => {
  await connect();
  console.log(JSON.stringify({
    conversions: await CoilConversion.find({}).lean(),
    movements: await InventoryMovement.find({}).select('txnType skuCode quantity batchNo').lean(),
    stock: await InventoryStock.find({}).select('skuId warehouse qtyOnHand').lean(),
  }, null, 2));
  await mongoose.disconnect();
};

/**
 * --matrix: every Coil → Circle pair from the client's sheet, through the real
 * convert(). Run after --seed.
 *
 * Twelve approved pairs (the first and last size of each coil) must save; four
 * cross-family pairs must be refused BEFORE any stock moves. Each coil gets its
 * own fresh receipt so the pairs do not compete for one coil's weight.
 */
const matrix = async () => {
  await connect();
  console.log('\nCoil → Circle matrix (real convert, scratch DB)\n');
  const user = await User.findOne({ email: E2E_USER.email }).lean();
  const sku = async (code) => SKU.findOne({ code }).lean();
  const receiptFor = async (coilCode) => {
    const c = await sku(coilCode);
    const { movement } = await inventoryService.increaseStock({
      skuId: c._id, skuCode: c.code, skuName: c.name, unit: 'KGS', quantity: 1000, unitCost: 180,
      warehouse: 'PLG01', txnType: TXN_TYPE.GRN_IN, sourceModule: 'GRN', refType: 'GRN',
      refNumber: `GRN-MATRIX-${coilCode}`, batchNo: `MATRIX-${coilCode}`, remarks: 'matrix receipt',
      performedBy: user, movementDate: new Date(),
    });
    return movement;
  };
  const cut = async (coilCode, circleCode, receipt) => {
    const coil = await sku(coilCode);
    const circle = await sku(circleCode);
    return rmImsService.convert({
      coilSkuId: String(coil._id), coilReceiptId: String(receipt._id), batchNo: receipt.batchNo,
      coilWeightKg: 10, warehouse: 'PLG01',
      circles: [{ circleSkuId: String(circle._id), pcs: 5, weightKg: 8.5 }],
    }, user);
  };

  const POSITIVE = [
    ['JSL202-06', 'JSL202-06-700'], ['JSL202-06', 'JSL202-06-875'],
    ['JSL202-07', 'JSL202-07-600'], ['JSL202-07', 'JSL202-07-925'],
    ['JSL202-08', 'JSL202-08-850'], ['JSL202-08', 'JSL202-08-978'],
    ['JSL204-07', 'JSL204-07-700'], ['JSL204-07', 'JSL204-07-840'],
    ['JSL204-08', 'JSL204-08-700'], ['JSL204-08', 'JSL204-08-978'],
    ['JSL204-10', 'JSL204-10-850'], ['JSL204-10', 'JSL204-10-925'],
  ];
  const NEGATIVE = [
    ['JSL202-06', 'JSL204-08-850'], ['JSL202-07', 'JSL202-08-900'],
    ['JSL204-07', 'JSL202-07-600'], ['JSL204-10', 'JSL202-08-850'],
  ];
  const receipts = {};
  for (const code of new Set([...POSITIVE, ...NEGATIVE].map(([c]) => c))) receipts[code] = await receiptFor(code);

  let n = 0;
  for (const [coil, circle] of POSITIVE) {
    n += 1;
    try {
      const saved = await cut(coil, circle, receipts[coil]);
      check(`${String(n).padStart(2)}. ${coil} → ${circle} saves`,
        saved?.circles?.[0]?.circleSkuCode === circle && String(saved.coilReceiptId) === String(receipts[coil]._id)
        && saved.scrapKg === 1.5 && saved.yieldRatioPct === 85,
        `scrap ${saved?.scrapKg}, yield ${saved?.yieldRatioPct}`);
    } catch (e) { check(`${String(n).padStart(2)}. ${coil} → ${circle} saves`, false, e.message); }
  }
  for (const [coil, circle] of NEGATIVE) {
    n += 1;
    const before = await InventoryMovement.countDocuments({});
    const convBefore = await CoilConversion.countDocuments({});
    try {
      await cut(coil, circle, receipts[coil]);
      check(`${String(n).padStart(2)}. ${coil} → ${circle} refused`, false, 'it was ACCEPTED');
    } catch (e) {
      const want = new RegExp(`^${circle} cannot be produced from coil ${coil}\\.`);
      check(`${String(n).padStart(2)}. ${coil} → ${circle} refused with a clear message`, e.statusCode === 400 && want.test(e.message), e.message);
    }
    check(`    …and no stock movement or conversion was created`,
      (await InventoryMovement.countDocuments({})) === before && (await CoilConversion.countDocuments({})) === convBefore);
  }

  /* ── Which coils Cut Coils may offer — read from the mapping, server side ── */
  console.log('');
  const ov = await rmImsService.getOverview({});
  const ovRows = ov.docs || ov.items || ov.data || ov;
  const flag = (code) => (Array.isArray(ovRows) ? ovRows : []).find((r) => r.skuCode === code);
  for (const code of ['JSL202-06', 'JSL202-07', 'JSL202-08', 'JSL204-07', 'JSL204-08', 'JSL204-10']) {
    check(`overview flags ${code} as cuttable (circleMapped)`, flag(code)?.circleMapped === true, JSON.stringify(flag(code)?.circleMapped));
  }
  for (const code of ['QA-FMS-SKU-NOUNIT', 'QA-TEST-COIL-01', 'JSL204-06']) {
    check(`overview still LISTS ${code} (it stays in RM stock)…`, !!flag(code));
    check(`…but flags it not cuttable`, flag(code)?.circleMapped === false, JSON.stringify(flag(code)?.circleMapped));
  }
  // A receipt on an unmapped coil, so the lookup has something to leave out.
  const unmappedReceipt = await receiptFor('JSL204-06');
  const cutLookup = await rmImsService.listReceivedCoils({ circleMapped: true, limit: 100 });
  check('Cut Coils lookup returns only mapped coils',
    cutLookup.docs.length > 0 && cutLookup.docs.every((d) => ['JSL202-06', 'JSL202-07', 'JSL202-08', 'JSL204-07', 'JSL204-08', 'JSL204-10'].includes(d.skuCode)),
    [...new Set(cutLookup.docs.map((d) => d.skuCode))].join(','));
  const typedUnmapped = await rmImsService.listReceivedCoils({ circleMapped: true, q: unmappedReceipt.batchNo });
  check('typing an unmapped coil\'s batch returns no coil…', typedUnmapped.docs.length === 0);
  check('…and says which unmapped coil it belongs to', typedUnmapped.summary?.unmappedBatch?.skuCode === 'JSL204-06',
    JSON.stringify(typedUnmapped.summary?.unmappedBatch));
  const stockInLookup = await rmImsService.listReceivedCoils({ q: unmappedReceipt.batchNo });
  check('the default lookup (Stock In) still finds every coil, unmapped included',
    stockInLookup.docs.some((d) => d.skuCode === 'JSL204-06'));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  await mongoose.disconnect();
  return failed.length === 0;
};

const mode = process.argv[2];
const main = async () => {
  if (mode === '--seed') return seed();
  if (mode === '--matrix') return matrix().then((p) => process.exit(p ? 0 : 1));
  if (mode === '--api') return api().then((p) => process.exit(p ? 0 : 1));
  if (mode === '--verify') return verify().then((p) => process.exit(p ? 0 : 1));
  if (mode === '--dump') return dump();
  console.error('Usage: --seed | --api | --verify | --dump');
  process.exit(1);
};

main().catch(async (e) => {
  console.error('\nFixture failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
