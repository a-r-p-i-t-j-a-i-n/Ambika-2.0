/**
 * Database oracle for Cut Coils — GRN dropdown + Manual Entry (no GRN).
 *
 *   node src/scripts/seedCoilToCircleDemo.js --seed --db=ambika_e2e_ctc_test   (first)
 *   node src/scripts/e2eCoilToCircleFixture.js --api      drive the rules through the service
 *   node src/scripts/e2eCoilToCircleFixture.js --verify   assert what the browser test saved
 *
 * --api sends every cut through rmConvertSchema (the route's own validation)
 * and then rmImsService.convert(), exactly as POST /rm-ims/convert does, and
 * reads the result back from Mongo — never from a return value alone. Each
 * refusal is also checked to have written NOTHING (movements, conversions,
 * scrap records, manual coils).
 *
 * Batches it creates: DEMO-CTC-T-* (eligibility probes) and DEMO-CTC-M-* (manual
 * coils), so seedCoilToCircleDemo.js --reset removes them with the demo data.
 * The browser test (frontend/e2e/coilToCircle.e2e.mjs) uses DEMO-CTC-003 /
 * DEMO-CTC-005 and the manual batch DEMO-CTC-UI-M1; --api never touches those.
 *
 * SAFETY: pinned to the localhost ambika_e2e_ctc_test database, S3/email off.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote, { GRN_STATUS } from '../modules/procurement/grn/grn.model.js';
import { grnService } from '../modules/procurement/grn/grn.service.js';
import InventoryMovement, { TXN_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import ScrapRecord from '../modules/inventory/scrapRecord.model.js';
import ManualCoil from '../modules/inventory/manualCoil.model.js';
import { inventoryService, combineStockRows } from '../modules/inventory/inventory.service.js';
import { rmImsService } from '../modules/inventory/rmIms.service.js';
import { scrapImsService } from '../modules/inventory/scrapIms.service.js';
import { rmConvertSchema, rmReceivedCoilsQuerySchema } from '../modules/inventory/rmIms.validation.js';
import { COIL_CIRCLE_MAP } from '../data/coil-circle-map.js';
import { AppError } from '../utils/apiResponse.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_ctc_test';
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eCoilToCircleFixture.js');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== 'ambika_e2e_ctc_test') throw new Error(`Unexpected database ${mongoose.connection.name}`);
};

let user;
let skus;
const circleId = (coilCode, i = 0) => String(skus[COIL_CIRCLE_MAP[coilCode][i].code]._id);
const circles = (coilCode, kg, i = 0) => [{ circleSkuId: circleId(coilCode, i), pcs: Math.max(1, Math.round(kg / 0.32)), weightKg: kg }];

/** POST /rm-ims/convert, minus HTTP: the route's Joi schema, then the service. */
const convert = (payload) => {
  const { error, value } = rmConvertSchema.validate(payload, { abortEarly: false, stripUnknown: true, errors: { wrap: { label: '' } } });
  if (error) throw new AppError(error.details.map((d) => d.message).join('; '), 422);
  return rmImsService.convert(value, user);
};
const receivedCoils = (q) => {
  const { value } = rmReceivedCoilsQuerySchema.validate(q, { stripUnknown: true });
  return rmImsService.listReceivedCoils(value);
};

const snapshot = async () => ({
  movements: await InventoryMovement.countDocuments({}),
  conversions: await CoilConversion.countDocuments({}),
  scrap: await ScrapRecord.countDocuments({}),
  manualCoils: await ManualCoil.countDocuments({}),
});
let seq = 0;
const rid = (tag) => `ctc-api-${tag}-${Date.now()}-${(seq += 1)}`;

/** Expect a refusal matching `rx`, and that nothing at all was written. */
const refused = async (label, fn, rx) => {
  const before = await snapshot();
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  const after = await snapshot();
  const clean = JSON.stringify(before) === JSON.stringify(after);
  check(`refused: ${label}`, !!err && (!rx || rx.test(err.message)) && clean,
    err ? `${err.statusCode || ''} ${err.message.slice(0, 150)}${clean ? '' : ` | WROTE ${JSON.stringify(before)} → ${JSON.stringify(after)}`}` : 'NOT refused');
};

const receiptOf = (batchNo) => InventoryMovement.findOne({ txnType: TXN_TYPE.GRN_IN, batchNo, isDeleted: { $ne: true } }).lean();
const gradeOnHand = async (code) => round2(Number(combineStockRows(await InventoryStock.find({ skuId: skus[code]._id }).lean())?.qtyOnHand || 0));

/* ── eligibility probes: receipts the dropdown must NOT offer ───────────── */
const makeProbeGrn = async ({ tag, coil, kg, complete, cancel }) => {
  const grnNumber = `DEMO-CTC-T-GRN-${tag}`;
  if (await GoodsReceiptNote.exists({ grnNumber })) return;
  const vendorId = new mongoose.Types.ObjectId();
  const po = await VendorPurchaseOrder.create({
    poNumber: `DEMO-CTC-T-PO-${tag}`, vendorId, vendorName: 'Probe Vendor (demo)', indentId: new mongoose.Types.ObjectId(),
    poStatus: 'APPROVED', items: [{ skuId: skus[coil]._id, skuCode: coil, itemName: skus[coil].name, unit: 'KGS', quantity: kg, receivedQty: 0, pendingQty: kg, rate: 150 }],
  });
  const grn = await GoodsReceiptNote.create({
    grnNumber, poId: po._id, poNumber: po.poNumber, vendorId, vendorName: po.vendorName, warehouse: 'MAIN',
    addToRmStock: true, rmReceivedAtLocation: 'PLG01', grnStatus: GRN_STATUS.DRAFT, stockPosted: false,
    items: po.items.map((p) => ({ poItemId: p._id, skuId: p.skuId, skuCode: p.skuCode, itemName: p.itemName, unit: p.unit, orderedQty: kg, receivedQty: kg, rate: 150, batchNo: `DEMO-CTC-T-${tag}` })),
    totalReceivedQty: kg,
  });
  if (complete) await grnService.complete(grn._id, { addToRmStock: true, rmReceivedAtLocation: 'PLG01' }, user);
  if (cancel) await grnService.cancel(grn._id, {}, user);
};

const api = async () => {
  await connect();
  user = await User.findOne({ email: 'ctc-demo@test.local' }).lean();
  if (!user) throw new Error('Seed first: seedCoilToCircleDemo.js --seed --db=ambika_e2e_ctc_test');
  skus = Object.fromEntries((await SKU.find({}).lean()).map((s) => [s.code, s]));

  console.log('\nA. GRN dropdown — eligibility and data\n');
  await makeProbeGrn({ tag: 'DRAFT', coil: 'JSL204-10', kg: 300 });
  await makeProbeGrn({ tag: 'CANCEL', coil: 'JSL204-10', kg: 300, cancel: true });
  // A GRN_IN that no GRN document stands behind (the shape test fixtures write).
  if (!(await receiptOf('DEMO-CTC-T-NOGRN'))) {
    await inventoryService.increaseStock({
      skuId: skus['JSL204-10']._id, skuCode: 'JSL204-10', skuName: skus['JSL204-10'].name, unit: 'KGS',
      quantity: 250, unitCost: 150, warehouse: 'PLG01', txnType: TXN_TYPE.GRN_IN, sourceModule: 'GRN', refType: 'GRN',
      refNumber: 'GRN-WITH-NO-DOCUMENT', batchNo: 'DEMO-CTC-T-NOGRN', performedBy: user, movementDate: new Date(),
    });
  }

  const dd = await receivedCoils({ grnOnly: true, circleMapped: true, limit: 100 });
  const ddBatches = new Set(dd.docs.map((d) => d.batchNo));
  check('dropdown lists the 7 demo coils with weight left', ['001', '002', '003', '004', '005', '006', '008'].every((n) => ddBatches.has(`DEMO-CTC-${n}`)), [...ddBatches].join(', '));
  check('dropdown excludes the fully cut coil (DEMO-CTC-007)', !ddBatches.has('DEMO-CTC-007'));
  check('dropdown excludes a DRAFT (uncompleted) GRN', !ddBatches.has('DEMO-CTC-T-DRAFT'));
  check('dropdown excludes a CANCELLED GRN', !ddBatches.has('DEMO-CTC-T-CANCEL'));
  check('dropdown excludes a receipt with no completed GRN behind it', !ddBatches.has('DEMO-CTC-T-NOGRN'));
  check('dropdown excludes the consumable on DEMO-CTC-GRN-001', dd.docs.every((d) => d.skuCode.startsWith('JSL')));
  check('every dropdown row carries GRN, batch, SKU, item, date, location, original and remaining',
    dd.docs.every((d) => d.grnNumber && d.batchNo && d.skuCode && d.skuName && d.receivedDate && ['PLG01', 'JW001'].includes(d.warehouse) && d.receivedWeight > 0 && d.availableWeight > 0));
  const byBatchLookup = await receivedCoils({ q: 'DEMO-CTC-T-NOGRN', circleMapped: true, limit: 5 });
  check('…but the batch-number lookup still finds that receipt, exactly as before', byBatchLookup.docs.some((d) => d.batchNo === 'DEMO-CTC-T-NOGRN'));

  const s1 = await receivedCoils({ grnOnly: true, circleMapped: true, q: 'DEMO-CTC-GRN-004' });
  check('search by GRN number', s1.docs.length === 1 && s1.docs[0].batchNo === 'DEMO-CTC-004', s1.docs.map((d) => d.batchNo).join());
  const s2 = await receivedCoils({ grnOnly: true, circleMapped: true, q: 'DEMO-CTC-006' });
  check('search by batch number', s2.docs.length === 1 && s2.docs[0].grnNumber === 'DEMO-CTC-GRN-006');
  const s3 = await receivedCoils({ grnOnly: true, circleMapped: true, q: 'Cu 0.80' });
  check('search by item name', s3.docs.length >= 2 && s3.docs.every((d) => d.skuCode === 'JSL204-08'), s3.docs.map((d) => d.batchNo).join());
  const s4 = await receivedCoils({ grnOnly: true, circleMapped: true, q: 'JSL202-08' });
  check('search by coil SKU code', s4.docs.length === 1 && s4.docs[0].batchNo === 'DEMO-CTC-004');
  const s5 = await receivedCoils({ grnOnly: true, circleMapped: true, q: 'NO-SUCH-COIL-XYZ' });
  check('search with no match returns an empty list', s5.docs.length === 0);

  for (const b of ['DEMO-CTC-004', 'DEMO-CTC-001']) {
    const viaBatch = (await receivedCoils({ q: b, circleMapped: true, limit: 5 })).docs.find((d) => d.batchNo === b);
    const viaDd = dd.docs.find((d) => d.batchNo === b);
    const lin = await rmImsService.getCoilLineage(viaDd.id);
    check(`${b}: dropdown and batch lookup return the SAME receipt and figures`,
      String(viaBatch.id) === String(viaDd.id) && viaBatch.receivedWeight === viaDd.receivedWeight && viaBatch.availableWeight === viaDd.availableWeight
      && viaBatch.unitCost === viaDd.unitCost && viaBatch.warehouse === viaDd.warehouse && viaBatch.grnNumber === viaDd.grnNumber,
      `${viaDd.grnNumber} ${viaDd.receivedWeight}/${viaDd.availableWeight} ₹${viaDd.unitCost} ${viaDd.warehouse}`);
    check(`${b}: lineage agrees (total / already cut / remaining)`,
      lin.receipt.receivedWeightKg === viaDd.receivedWeight && lin.totals.coil.availableKg === viaDd.availableWeight,
      `total ${lin.receipt.receivedWeightKg}, cut ${round2(lin.receipt.receivedWeightKg - lin.totals.coil.availableKg)}, remaining ${lin.totals.coil.availableKg}`);
  }

  console.log('\nB. GRN coil — partial / full / stock deducted once / mapping\n');
  const r1 = await receiptOf('DEMO-CTC-001');
  const stockBefore = await gradeOnHand('JSL204-07');
  const before = await snapshot();
  const c1 = await convert({ clientRequestId: rid('g1'), coilReceiptId: String(r1._id), coilSkuId: String(r1.skuId), coilWeightKg: 300, cuttingType: 'PARTIAL', warehouse: 'PLG01', circles: circles('JSL204-07', 270) });
  const outs = await InventoryMovement.find({ refNumber: c1.conversionNumber, txnType: TXN_TYPE.CONVERT_OUT }).lean();
  check('partial GRN cut: exactly ONE CONVERT_OUT of 300 kg', outs.length === 1 && outs[0].quantity === 300 && outs[0].batchNo === 'DEMO-CTC-001');
  check('…grade stock down by exactly 300', round2(stockBefore - (await gradeOnHand('JSL204-07'))) === 300, `${stockBefore} → ${await gradeOnHand('JSL204-07')}`);
  check('…coil now 1,700 remaining', (await rmImsService.getCoilLineage(r1._id)).totals.coil.availableKg === 1700);
  const after = await snapshot();
  check('…wrote 1 conversion, 1 scrap record, no manual coil', after.conversions - before.conversions === 1 && after.scrap - before.scrap === 1 && after.manualCoils === before.manualCoils);
  const replay = await convert({ clientRequestId: c1.clientRequestId, coilReceiptId: String(r1._id), coilSkuId: String(r1.skuId), coilWeightKg: 300, cuttingType: 'PARTIAL', warehouse: 'PLG01', circles: circles('JSL204-07', 270) });
  check('replayed submission returns the same cut, writes nothing', replay.conversionNumber === c1.conversionNumber && (await snapshot()).movements === after.movements);
  await refused('FULL cut with a stale weight (1,600 ≠ 1,700 remaining)',
    () => convert({ clientRequestId: rid('g2'), coilReceiptId: String(r1._id), coilSkuId: String(r1.skuId), coilWeightKg: 1600, cuttingType: 'FULL', warehouse: 'PLG01', circles: circles('JSL204-07', 1400) }), /1,700 KG remaining/);
  await refused('invalid Coil–Circle pair (Cu 0.70 coil → DD 0.60 circle)',
    () => convert({ clientRequestId: rid('g3'), coilReceiptId: String(r1._id), coilSkuId: String(r1.skuId), coilWeightKg: 100, cuttingType: 'PARTIAL', warehouse: 'PLG01', circles: [{ circleSkuId: circleId('JSL202-06'), pcs: 10, weightKg: 90 }] }), /cannot be produced from coil JSL204-07/);
  await refused('GRN cut larger than the coil has left',
    () => convert({ clientRequestId: rid('g4'), coilReceiptId: String(r1._id), coilSkuId: String(r1.skuId), coilWeightKg: 1800, cuttingType: 'PARTIAL', warehouse: 'PLG01', circles: circles('JSL204-07', 1600) }), /Only 1,700 KG is available/);
  const c2 = await convert({ clientRequestId: rid('g5'), coilReceiptId: String(r1._id), coilSkuId: String(r1.skuId), coilWeightKg: 1700, cuttingType: 'FULL', warehouse: 'PLG01', circles: circles('JSL204-07', 1550) });
  const lin1 = await rmImsService.getCoilLineage(r1._id);
  check('FULL GRN cut takes exactly the remaining 1,700 → 0 left, FULLY_CUT', c2.coilWeightKg === 1700 && lin1.totals.coil.availableKg === 0 && lin1.totals.coil.status === 'FULLY_CUT' && lin1.rounds.length === 2);
  check('…and DEMO-CTC-001 has left the dropdown', !(await receivedCoils({ grnOnly: true, circleMapped: true, q: 'DEMO-CTC-001' })).docs.length);

  console.log('\nC. Manual Entry — No GRN: three rounds of one coil\n');
  const M = 'DEMO-CTC-M-001';
  const scrapStock = async () => round2(Number(combineStockRows(await InventoryStock.find({ skuId: skus.SCRAP?._id || (await SKU.findOne({ itemType: 'SCRAP' }))._id }).lean())?.qtyOnHand || 0));
  const scrap0 = await scrapStock();
  const stock08 = await gradeOnHand('JSL204-08');
  const look0 = await rmImsService.lookupManualCoil({ batchNo: M });
  check('lookup of a new manual batch: no manual coil, no GRN', !look0.manualCoil && !look0.grnReceipt);
  const m1 = await convert({
    clientRequestId: rid('m1'), batchNo: M, manualCoil: { batchNo: M, totalWeightKg: 2000 }, coilSkuId: String(skus['JSL204-08']._id),
    coilWeightKg: 500, cuttingType: 'PARTIAL', warehouse: 'PLG01', rate: 191, scrapVerified: 'PENDING', circles: circles('JSL204-08', 455),
  });
  const mc = await ManualCoil.findOne({ batchKey: M }).lean();
  check('round 1 creates ONE manual coil with original weight 2,000 kg', !!mc && mc.originalWeightKg === 2000 && mc.coilSkuCode === 'JSL204-08' && mc.warehouse === 'PLG01' && mc.rate === 191);
  check('…the conversion and its scrap record name that coil (and no receipt)',
    String(m1.manualCoilId) === String(mc._id) && !m1.coilReceiptId
    && String((await ScrapRecord.findOne({ conversionId: m1._id }).lean()).manualCoilId) === String(mc._id));
  check('…no GRN, PO, supplier or receipt movement was created for it',
    !(await InventoryMovement.exists({ batchNo: M, txnType: TXN_TYPE.GRN_IN })) && !(await GoodsReceiptNote.exists({ 'items.batchNo': M }))
    && (await InventoryMovement.find({ batchNo: M }).lean()).every((x) => !x.vendorName && !x.poNumber));
  check('…grade stock down by 500 (a manual coil still comes out of RM stock)', round2(stock08 - (await gradeOnHand('JSL204-08'))) === 500);
  check('…PLG01 scrap (45 kg) entered Ambika scrap stock', round2((await scrapStock()) - scrap0) === 45, `${scrap0} → ${await scrapStock()}`);
  const look1 = await rmImsService.lookupManualCoil({ batchNo: M.toLowerCase() });
  check('lookup (any case) finds it: 2,000 total · 500 cut · 1,500 remaining · 1 round',
    look1.manualCoil && look1.manualCoil.originalWeightKg === 2000 && look1.manualCoil.cutKg === 500 && look1.manualCoil.availableKg === 1500 && look1.manualCoil.rounds === 1);

  await refused('re-entering the same manual batch as a NEW coil (duplicate physical coil)',
    () => convert({ clientRequestId: rid('m-dup'), manualCoil: { batchNo: M.toLowerCase(), totalWeightKg: 2000 }, coilSkuId: String(skus['JSL204-08']._id), coilWeightKg: 100, cuttingType: 'PARTIAL', warehouse: 'PLG01', circles: circles('JSL204-08', 90) }), /already a manual coil/);
  check('…still exactly one manual coil for the batch', (await ManualCoil.countDocuments({ batchKey: M })) === 1);

  await convert({ clientRequestId: rid('m2'), manualCoilId: String(mc._id), coilSkuId: String(skus['JSL204-08']._id), coilWeightKg: 700, cuttingType: 'PARTIAL', warehouse: 'PLG01', circles: circles('JSL204-08', 640) });
  check('round 2 (700 kg) continues the same coil → 800 remaining', (await rmImsService.lookupManualCoil({ batchNo: M })).manualCoil.availableKg === 800);
  await refused('manual FULL with a stale weight (700 ≠ 800 remaining)',
    () => convert({ clientRequestId: rid('m-stale'), manualCoilId: String(mc._id), coilSkuId: String(skus['JSL204-08']._id), coilWeightKg: 700, cuttingType: 'FULL', warehouse: 'PLG01', circles: circles('JSL204-08', 600) }), /800 KG remaining/);
  await refused('manual partial larger than the coil has left',
    () => convert({ clientRequestId: rid('m-over'), manualCoilId: String(mc._id), coilSkuId: String(skus['JSL204-08']._id), coilWeightKg: 900, cuttingType: 'PARTIAL', warehouse: 'PLG01', circles: circles('JSL204-08', 800) }), /Only 800 KG is available/);
  await refused('later round naming a different coil grade',
    () => convert({ clientRequestId: rid('m-sku'), manualCoilId: String(mc._id), coilSkuId: String(skus['JSL204-07']._id), coilWeightKg: 100, cuttingType: 'PARTIAL', warehouse: 'PLG01', circles: circles('JSL204-07', 90) }), /is JSL204-08, not JSL204-07/);
  const m3 = await convert({ clientRequestId: rid('m3'), manualCoilId: String(mc._id), coilSkuId: String(skus['JSL204-08']._id), coilWeightKg: 800, cuttingType: 'FULL', warehouse: 'PLG01', circles: circles('JSL204-08', 730) });
  const lin = await rmImsService.getCoilLineage(mc._id);
  check('round 3 FULL takes exactly the remaining 800', m3.coilWeightKg === 800);
  check('lineage by manual id: original 2,000 · rounds 500/700/800 · remaining 1,500 → 800 → 0 · FULLY_CUT',
    lin.receipt.source === 'MANUAL' && lin.receipt.receivedWeightKg === 2000 && !lin.receipt.grnNo && !lin.receipt.supplier
    && lin.rounds.map((r) => r.cutKg).join('/') === '500/700/800' && lin.rounds.map((r) => r.remainingAfterKg).join('/') === '1500/800/0'
    && lin.totals.coil.status === 'FULLY_CUT' && lin.totals.reconciles,
    `${lin.rounds.map((r) => `${r.roundNo}:${r.cutKg}→${r.remainingAfterKg}`).join(' ')}`);
  await refused('manual FULL on a fully cut coil',
    () => convert({ clientRequestId: rid('m-done'), manualCoilId: String(mc._id), coilSkuId: String(skus['JSL204-08']._id), coilWeightKg: 1, cuttingType: 'FULL', warehouse: 'PLG01', circles: circles('JSL204-08', 0.5) }), /already fully cut/);

  const hist = await rmImsService.listCuttingHistory({ search: M });
  const hrow = hist.docs.find((d) => d.batchNo === M);
  check('Cutting History lists the manual coil: MANUAL · 3 rounds · 2,000 / 2,000 cut / 0 left',
    hrow && hrow.coilSource === 'MANUAL' && String(hrow.coilId) === String(mc._id) && hrow.rounds === 3 && hrow.receivedKg === 2000 && hrow.cutKg === 2000 && hrow.remainingKg === 0 && hrow.status === 'FULLY_CUT' && hrow.reconciles);
  const sbc = await scrapImsService.getScrapByCoil({ search: M, limit: 500 });
  const srow = sbc.docs.find((d) => d.batchNo === M);
  check('Scrap by Physical Coil identifies the manual coil and its 3 rounds',
    srow && srow.coilSource === 'MANUAL' && String(srow.coilId) === String(mc._id) && srow.rounds === 3 && srow.receivedKg === 2000 && !srow.receiptMissing,
    srow ? `rounds ${srow.rounds}, scrap ${srow.scrapKg} kg, received ${srow.receivedKg}` : 'missing');
  const convList = await rmImsService.listConversions({ search: M });
  check('Past conversions show the cuts as "manual entry" (not untraceable)', convList.docs.length === 3 && convList.docs.every((d) => d.manualCoil?.batchNo === M && !d.receipt));

  console.log('\nD. Manual coil at the job worker (JW001)\n');
  const scrapBeforeJw = await scrapStock();
  const jw = await convert({ clientRequestId: rid('jw1'), manualCoil: { batchNo: 'DEMO-CTC-M-002', totalWeightKg: 900 }, coilSkuId: String(skus['JSL204-08']._id), coilWeightKg: 300, cuttingType: 'PARTIAL', warehouse: 'JW001', circles: circles('JSL204-08', 270) });
  const jwScrap = await ScrapRecord.findOne({ conversionId: jw._id }).lean();
  check('JW001 manual cut: scrap record at JW001, NO scrap stock posted', jwScrap.location === 'JW001' && !jwScrap.stockMovementId
    && !(await InventoryMovement.exists({ refNumber: jw.conversionNumber, txnType: TXN_TYPE.SCRAP_IN })) && (await scrapStock()) === scrapBeforeJw);

  console.log('\nE. Manual Entry — rejected inputs write nothing\n');
  const base = { coilSkuId: String(skus['JSL204-08']._id), coilWeightKg: 100, cuttingType: 'PARTIAL', warehouse: 'PLG01', circles: circles('JSL204-08', 90) };
  await refused('blank manual batch number', () => convert({ ...base, clientRequestId: rid('e1'), manualCoil: { batchNo: '   ', totalWeightKg: 500 } }), /batch number/i);
  await refused('zero total coil weight', () => convert({ ...base, clientRequestId: rid('e2'), manualCoil: { batchNo: 'DEMO-CTC-M-E2', totalWeightKg: 0 } }), /Total coil weight must be greater than zero/);
  await refused('negative total coil weight', () => convert({ ...base, clientRequestId: rid('e3'), manualCoil: { batchNo: 'DEMO-CTC-M-E3', totalWeightKg: -50 } }), /Total coil weight must be greater than zero/);
  await refused('non-numeric total coil weight', () => convert({ ...base, clientRequestId: rid('e4'), manualCoil: { batchNo: 'DEMO-CTC-M-E4', totalWeightKg: 'abc' } }), /must be a number/);
  await refused('missing total coil weight', () => convert({ ...base, clientRequestId: rid('e5'), manualCoil: { batchNo: 'DEMO-CTC-M-E5' } }), /total weight of the whole coil/);
  await refused('zero cut this round', () => convert({ ...base, clientRequestId: rid('e6'), coilWeightKg: 0, manualCoil: { batchNo: 'DEMO-CTC-M-E6', totalWeightKg: 500 } }), /coilWeightKg/);
  await refused('negative cut this round', () => convert({ ...base, clientRequestId: rid('e7'), coilWeightKg: -10, manualCoil: { batchNo: 'DEMO-CTC-M-E7', totalWeightKg: 500 } }), /coilWeightKg/);
  await refused('cut this round larger than the new coil\'s total', () => convert({ ...base, clientRequestId: rid('e8'), coilWeightKg: 600, circles: circles('JSL204-08', 500), manualCoil: { batchNo: 'DEMO-CTC-M-E8', totalWeightKg: 500 } }), /Only 500 KG is available/);
  await refused('manual entry of a batch that HAS a goods receipt (switching modes to dodge the coil check)',
    () => convert({ ...base, clientRequestId: rid('e9'), manualCoil: { batchNo: 'demo-ctc-002', totalWeightKg: 9999 } }), /already has a goods receipt/);
  await refused('invalid Coil–Circle pair on a manual coil',
    () => convert({ ...base, clientRequestId: rid('e10'), circles: [{ circleSkuId: circleId('JSL202-06'), pcs: 10, weightKg: 90 }], manualCoil: { batchNo: 'DEMO-CTC-M-E10', totalWeightKg: 500 } }), /cannot be produced from coil JSL204-08/);
  const r2 = await receiptOf('DEMO-CTC-002');
  await refused('naming the coil two ways (receipt + manual coil)',
    () => convert({ ...base, clientRequestId: rid('e11'), coilReceiptId: String(r2._id), manualCoil: { batchNo: 'DEMO-CTC-M-E11', totalWeightKg: 500 } }), /one way only/);
  await refused('manual coil + "No receipt available" together',
    () => convert({ ...base, clientRequestId: rid('e12'), manualFallback: true, manualCoil: { batchNo: 'DEMO-CTC-M-E12', totalWeightKg: 500 } }), /one way only/);
  const onHand0207 = await gradeOnHand('JSL202-07');
  await refused(`manual cut beyond the grade's RM stock (${onHand0207} kg on hand, no override)`,
    () => convert({ clientRequestId: rid('e13'), coilSkuId: String(skus['JSL202-07']._id), coilWeightKg: onHand0207 + 500, cuttingType: 'PARTIAL', warehouse: 'PLG01', circles: circles('JSL202-07', onHand0207), manualCoil: { batchNo: 'DEMO-CTC-M-E13', totalWeightKg: onHand0207 + 5000 } }), /Not enough coil stock/);
  check('none of the rejected manual batches left a manual coil behind', !(await ManualCoil.exists({ batchKey: /^DEMO-CTC-M-E/ })));

  console.log('\nF. Explicit over-cut override still works for a manual coil\n');
  const ov = await convert({ clientRequestId: rid('f1'), allowNegative: true, manualCoil: { batchNo: 'DEMO-CTC-M-003', totalWeightKg: 400 }, coilSkuId: String(skus['JSL204-10']._id), coilWeightKg: 450, cuttingType: 'PARTIAL', warehouse: 'PLG01', circles: circles('JSL204-10', 400) });
  const ovLin = await rmImsService.getCoilLineage(ov.manualCoilId);
  check('with "allow" on, 450 kg off a 400 kg manual coil is recorded and reported as over-cut (−50)', ovLin.totals.coil.availableKg === -50 && ovLin.totals.coil.overCut === true);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await mongoose.disconnect();
  process.exit(failed.length ? 1 : 0);
};

/* ── --verify: what the browser test saved ──────────────────────────────── */
const verify = async () => {
  await connect();
  console.log('\nBrowser run — database verification\n');
  const M = 'DEMO-CTC-UI-M1';
  const mcs = await ManualCoil.find({ batchKey: M }).lean();
  check('exactly one manual coil for the UI batch', mcs.length === 1, `${mcs.length}`);
  const mc = mcs[0];
  if (mc) {
    const convs = await CoilConversion.find({ manualCoilId: mc._id }).sort({ createdAt: 1 }).lean();
    check('original weight stored once: 1,500 kg', mc.originalWeightKg === 1500);
    check('three rounds saved: 400 / 600 / 500 (Partial, Partial, Full)', convs.map((c) => c.coilWeightKg).join('/') === '400/600/500'
      && convs.map((c) => c.cuttingType).join('/') === 'PARTIAL/PARTIAL/FULL', convs.map((c) => `${c.coilWeightKg}:${c.cuttingType}`).join(' '));
    const lin = await rmImsService.getCoilLineage(mc._id);
    check('remaining after rounds 1,100 → 500 → 0', lin.rounds.map((r) => r.remainingAfterKg).join('/') === '1100/500/0');
    const srs = await ScrapRecord.find({ conversionId: { $in: convs.map((c) => c._id) } }).lean();
    check('every round has a scrap record naming the manual coil', srs.length === 3 && srs.every((s) => String(s.manualCoilId) === String(mc._id)));
  }
  const r3 = await receiptOf('DEMO-CTC-003');
  const c3 = await CoilConversion.find({ coilReceiptId: r3._id }).sort({ createdAt: 1 }).lean();
  check('UI cut of DEMO-CTC-003 (picked from the dropdown) is linked to its receipt', c3.length === 2 && c3[1].coilWeightKg === 250 && c3[1].cuttingType === 'PARTIAL',
    c3.map((c) => `${c.coilWeightKg}:${c.cuttingType}`).join(' '));
  const outs = await InventoryMovement.find({ refNumber: c3[1]?.conversionNumber, txnType: TXN_TYPE.CONVERT_OUT }).lean();
  check('…and deducted the coil exactly once (one CONVERT_OUT of 250)', outs.length === 1 && outs[0].quantity === 250);
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await mongoose.disconnect();
  process.exit(failed.length ? 1 : 0);
};

if (isEntry(import.meta.url)) {
  const cmd = process.argv[2];
  ({ '--api': api, '--verify': verify }[cmd] || (() => { console.error('Usage: --api | --verify'); process.exit(1); }))()
    .catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => {}); process.exit(1); });
}
