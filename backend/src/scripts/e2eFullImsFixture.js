/**
 * FULL IMS end-to-end — fixture, API matrix and database oracle.
 *
 *   node src/scripts/e2eFullImsFixture.js --seed      scratch DB, masters, the REAL purchase chain
 *   node src/scripts/e2eFullImsFixture.js --api       GRN / cut / scrap-out API + negative matrix
 *   node src/scripts/e2eFullImsFixture.js --rollback  a forced mid-transaction failure (fresh process)
 *   node src/scripts/e2eFullImsFixture.js --behind    one round on coil 3 behind the browser's back
 *   node src/scripts/e2eFullImsFixture.js --verify    the final database oracle + reconciliation
 *
 * Pairs with frontend/e2e/fullIms.e2e.mjs, which drives GRN → RM → Cut Coils →
 * Scrap → Scrap Out through the real UI. Order: --seed, --api, --rollback,
 * browser, --verify.
 *
 * ── WHAT IS REAL ───────────────────────────────────────────────────────────
 * Unlike e2eFullFlowFixture.js, NO purchase order is seeded at READY_FOR_GRN.
 * Every PO goes through the actual services: indent → approve → quotation
 * (QUOTE_NOT_REQUIRED) → PO → approve → release → PI not required → follow-up
 * → ready for GRN. GRNs, cuts and scrap outs go through their real services
 * (here) or the real UI (the browser half).
 *
 * ── SAFETY ─────────────────────────────────────────────────────────────────
 * Pinned to a THROWAWAY single-node replica set on 127.0.0.1:27018 (started
 * for this run, data in the session scratchpad) so transactions are real and
 * the rollback / concurrency tests mean something. It never reads MONGO_URI
 * and refuses any non-localhost target. --seed drops the scratch database.
 * PO release writes its PDF to backend/uploads/ (gitignored, local only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import Vendor from '../modules/vendors/vendor.model.js';
import PurchaseIndent from '../modules/procurement/indent/indent.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote from '../modules/procurement/grn/grn.model.js';
import InventoryMovement, { TXN_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import ScrapRecord from '../modules/inventory/scrapRecord.model.js';
import ScrapBuyer from '../modules/inventory/scrapBuyer.model.js';
import { indentService } from '../modules/procurement/indent/indent.service.js';
import { purchaseOrderService } from '../modules/procurement/purchase-order/purchaseOrder.service.js';
import { followUpService } from '../modules/procurement/follow-up/followUp.service.js';
import { grnService } from '../modules/procurement/grn/grn.service.js';
import { rmImsService } from '../modules/inventory/rmIms.service.js';
import { scrapImsService } from '../modules/inventory/scrapIms.service.js';
import { scrapBuyerService } from '../modules/inventory/scrapBuyer.service.js';
import { rmConvertSchema } from '../modules/inventory/rmIms.validation.js';
import { scrapOutSchema } from '../modules/inventory/scrapIms.validation.js';
import { SCRAP_SKU_CODE, SCRAP_SKU_DEFAULTS } from '../modules/inventory/scrapSku.js';
import { COIL_CIRCLE_MAP } from '../data/coil-circle-map.js';
import { s3Enabled } from '../common/uploads/s3.service.js';

export const E2E_URI = 'mongodb://127.0.0.1:27018/ambika_e2e_full_ims?replicaSet=rsE2E&directConnection=true';
// Local scratch DB, S3 off, email off — or stop before anything connects.
// Only when RUN as a script: unit tests import pure data from some fixtures.
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eFullImsFixture.js');
export const DB_NAME = 'ambika_e2e_full_ims';
export const E2E_USER = { email: 'fullims-e2e@test.local', password: 'E2e@12345', name: 'Full IMS E2E', role: 'MD' };

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(E2E_URI)) {
  console.error('Refusing to run: fixture must target localhost.');
  process.exit(1);
}
/**
 * PO release and GRN completion write PDFs. With backend/.env's AWS keys
 * loaded those go to the REAL S3 bucket — production storage — even though
 * every database write stays local. So this fixture refuses to run with S3
 * on. Run it (and the e2e backend) with the AWS variables blanked:
 *   AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= node …
 * dotenv never overrides a variable that is already set, even to empty.
 */
if (isEntry(import.meta.url) && s3Enabled) {
  console.error('Refusing to run: S3 is enabled, so PO/GRN PDFs would be uploaded to the real bucket. Blank the AWS_* variables.');
  process.exit(1);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MANIFEST = path.resolve(HERE, '../../../frontend/e2e/shots/full-ims-manifest.json');

/* ══ The plan, stated up front ══════════════════════════════════════════ */

const COILS = [
  { code: 'JSL204-07', name: 'Cu 0.70 mm' },
  { code: 'JSL204-08', name: 'Cu 0.80 mm' },
  { code: 'JSL202-06', name: 'DD 0.60 mm' },
];

/**
 * Purchases. C1–C3 are received in the BROWSER; A4–A7 are received here, by
 * the API half, to exercise the GRN rules without disturbing C1–C3's figures.
 */
export const PURCHASES = [
  { key: 'C1', vendor: 'E2E Full Supplier 1', lines: [{ sku: 'JSL204-07', qty: 2000, rate: 185 }], batch: 'E2E-FULL-COIL-001', at: 'PLG01', ui: true },
  { key: 'C2', vendor: 'E2E Full Supplier 2', lines: [{ sku: 'JSL204-08', qty: 2500, rate: 192 }], batch: 'E2E-FULL-COIL-002', at: 'JW001', ui: true },
  { key: 'C3', vendor: 'E2E Full Supplier 3', lines: [{ sku: 'JSL202-06', qty: 1500, rate: 170 }], batch: 'E2E-FULL-COIL-003', at: 'PLG01', ui: true },
  { key: 'A4', vendor: 'E2E Full Supplier 4', lines: [{ sku: 'JSL204-07', qty: 1000, rate: 185 }], batch: 'E2E-FULL-COIL-004', at: 'PLG01' },
  { key: 'A5', vendor: 'E2E Full Supplier 4', lines: [{ sku: 'JSL204-08', qty: 200, rate: 192 }], batch: 'E2E-FULL-COIL-005', at: 'PLG01' },
  { key: 'A6', vendor: 'E2E Full Supplier 4', lines: [{ sku: 'JSL204-07-700', qty: 500, rate: 3 }, { sku: 'E2E-FULL-CONS', qty: 40, rate: 25 }], batch: 'E2E-FULL-CIR-006', at: 'PLG01' },
  { key: 'A7', vendor: 'E2E Full Supplier 4', lines: [{ sku: 'JSL202-06', qty: 100, rate: 170 }], batch: 'E2E-FULL-COIL-007', at: 'PLG01' },
];

const OPENING_SCRAP_KG = 3000;

/** Every cutting round, and where it happens. Scrap is never supplied — derived. */
export const ROUNDS = {
  // browser
  C1: [
    { type: 'PARTIAL', cut: 1000, circles: [['JSL204-07-700', 600, 500], ['JSL204-07-750', 380, 350]] },
    { type: 'FULL', cut: 1000, circles: [['JSL204-07-840', 700, 520], ['JSL204-07-700', 420, 350]] },
  ],
  C2: [
    { type: 'PARTIAL', cut: 1000, circles: [['JSL204-08-850', 1100, 820]] },
    { type: 'PARTIAL', cut: 500, circles: [['JSL204-08-700', 500, 410]] },
  ],
  C3: [
    { type: 'PARTIAL', cut: 1000, circles: [['JSL202-06-700', 1000, 850]] },
    { type: 'PARTIAL', cut: 100, circles: [['JSL202-06-700', 100, 85]], behind: true },
    { type: 'FULL', cut: 400, circles: [['JSL202-06-725', 400, 340]] },
  ],
  // api
  C4: [
    { type: 'PARTIAL', cut: 500, circles: [['JSL204-07-700', 300, 250], ['JSL204-07-750', 200, 175]] },
    { type: 'FULL', cut: 500, circles: [['JSL204-07-840', 500, 430]] },
  ],
  C5: [
    { type: 'PARTIAL', cut: 250, circles: [['JSL204-08-850', 220, 200]], allowNegative: true },
  ],
};

/** UI scrap sales, as typed. */
export const SALES = [
  { buyer: 'E2E Existing Buyer', qty: 500, uom: 'KG', kg: 500, ref: 'INV-E2E-FULL-1' },
  { buyer: 'E2E New Buyer Traders', qty: 5, uom: 'QUINTAL', kg: 500, ref: 'INV-E2E-FULL-2', create: true },
  { buyer: 'E2E Existing Buyer', qty: 2, uom: 'TON', kg: 2000, ref: 'INV-E2E-FULL-3' },
];
const API_DISPOSAL_KG = 10;

/* ══ helpers ═════════════════════════════════════════════════════════════ */

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 8000 });
  if (mongoose.connection.name !== DB_NAME) {
    throw new Error(`Connected to an unexpected database (${mongoose.connection.name}) — aborting.`);
  }
};
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const idOf = (r) => r?._id || r?.doc?._id || r?.data?._id || r?.po?._id || r?.indent?._id || r?.grn?._id || r?.followUp?._id || null;
const meta = () => mongoose.connection.db.collection('e2e_meta');
/**
 * Today as a DATE, exactly as the screens send it ("YYYY-MM-DD" → UTC
 * midnight). Rounds and Scrap Outs sort by their date and then by when they
 * were keyed in; a fixture that sent a full timestamp would sort its own
 * same-day entries after the UI's, which no operator can produce.
 */
const today = () => {
  const d = new Date();
  return new Date(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
};

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
const finish = async () => {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) { console.log('\nFailures:'); failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`)); }
  await mongoose.disconnect();
  return failed.length === 0;
};

const counts = async () => ({
  indents: await PurchaseIndent.countDocuments({}),
  pos: await VendorPurchaseOrder.countDocuments({}),
  grns: await GoodsReceiptNote.countDocuments({}),
  movements: await InventoryMovement.countDocuments({}),
  stockRows: await InventoryStock.countDocuments({}),
  conversions: await CoilConversion.countDocuments({}),
  scrapRecords: await ScrapRecord.countDocuments({}),
  scrapIn: await InventoryMovement.countDocuments({ txnType: TXN_TYPE.SCRAP_IN }),
  scrapOut: await InventoryMovement.countDocuments({ txnType: TXN_TYPE.SCRAP_OUT }),
  buyers: await ScrapBuyer.countDocuments({}),
  users: await User.countDocuments({}),
});

/** Stock fingerprint: every stock row's on-hand, so "nothing moved" is exact. */
const stockPrint = async () => (await InventoryStock.find({}).sort({ skuCode: 1, warehouse: 1 }).lean())
  .map((r) => `${r.skuCode}@${r.warehouse}=${round2(r.qtyOnHand)}/${round2(r.qtyOnHandKg)}`).join('|');

const refused = async (label, fn, rx) => {
  const before = { c: await counts(), s: await stockPrint() };
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  const after = { c: await counts(), s: await stockPrint() };
  check(`${label} → refused`, !!err && (!rx || rx.test(err.message)), err ? err.message.slice(0, 160) : 'it was ACCEPTED');
  check('   …stock, ledger and documents unchanged', JSON.stringify(before) === JSON.stringify(after));
  return err;
};

/** The real procurement chain, end to end, for one purchase. */
const buyThrough = async ({ vendor, lines }, skus, vendors, user) => {
  const items = lines.map((l) => ({ skuId: String(skus[l.sku]._id), skuCode: l.sku, itemName: skus[l.sku].name, quantity: l.qty, unit: skus[l.sku].unit }));
  const indent = await indentService.create({ items, raisedBy: 'E2E Full IMS', department: 'Production', remarks: 'E2E-FULL' }, user);
  const indentId = idOf(indent);
  const ind = await PurchaseIndent.findById(indentId).lean();
  await indentService.approve(indentId, { items: ind.items.map((it) => ({ _id: String(it._id), revisedQuantity: it.quantity })) }, user);
  await indentService.quoteComparative(indentId, { statusDone: 'QUOTE_NOT_REQUIRED' }, user);
  const ind2 = await PurchaseIndent.findById(indentId).lean();
  const po = await purchaseOrderService.create({
    indentId: String(indentId),
    vendorId: String(vendors[vendor]._id),
    poFormatType: 'OTHER',
    items: ind2.items.map((it, i) => ({
      indentItemId: String(it._id), skuId: String(skus[lines[i].sku]._id), skuCode: lines[i].sku,
      itemName: skus[lines[i].sku].name, unit: skus[lines[i].sku].unit,
      quantity: lines[i].qty, rate: lines[i].rate, gstRate: 18,
    })),
  }, user);
  const poId = idOf(po);
  const movesAfterDraft = await InventoryMovement.countDocuments({});
  await purchaseOrderService.approve(poId, { decision: 'APPROVED' }, user);
  await purchaseOrderService.release(poId, { sendEmail: false }, user);
  await purchaseOrderService.markPiNotRequired(poId, { reason: 'E2E: no PI for this test purchase' }, user);
  const fu = await followUpService.create({ poId: String(poId) }, user);
  await followUpService.markDone(idOf(fu), { finalMaterialDate: new Date() }, user);
  const fresh = await VendorPurchaseOrder.findById(poId).lean();
  return { po: fresh, indentId, movesAfterDraft };
};

const grnItems = (po, skus, qtyOf, batch) => po.items.map((it) => {
  const code = it.skuCode;
  const isRm = ['RAW_MATERIAL', 'CIRCLE'].includes(skus[code].itemType);
  const qty = qtyOf ? qtyOf(it) : it.quantity;
  return {
    poItemId: String(it._id), skuId: String(it.skuId), skuCode: code, itemName: it.itemName, unit: it.unit,
    orderedQty: it.quantity, previouslyReceivedQty: 0, invoiceQty: qty, receivedQty: qty, rate: it.rate,
    batchNo: isRm ? (batch ?? '') : '',
  };
});

/* ══ --seed ══════════════════════════════════════════════════════════════ */

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();
  console.log(`\nSEED — ${mongoose.connection.name} @ ${mongoose.connection.host}:${mongoose.connection.port}\n`);

  const user = await User.create({ ...E2E_USER, mobile: '9000000021', isActive: true, roles: ['MD'] });

  const skus = {};
  for (const c of COILS) skus[c.code] = await SKU.create({ code: c.code, name: c.name, category: 'Coil', unit: 'KGS', itemType: 'RAW_MATERIAL', isActive: true });
  for (const c of COILS) {
    for (const circle of COIL_CIRCLE_MAP[c.code] || []) {
      if (!skus[circle.code]) skus[circle.code] = await SKU.create({ code: circle.code, name: circle.clientLabel, category: 'Circles', unit: 'PCS', itemType: 'CIRCLE', isActive: true });
    }
  }
  skus['E2E-FULL-CONS'] = await SKU.create({ code: 'E2E-FULL-CONS', name: 'E2E Cutting Oil', category: 'Consumable', unit: 'NOS', itemType: 'CONSUMABLE', isActive: true });
  // A real-looking RM item with NO approved circle mapping — must never be cuttable.
  skus['QA-E2E-UNMAPPED'] = await SKU.create({ code: 'QA-E2E-UNMAPPED', name: 'QA Unmapped Coil', category: 'Coil', unit: 'KGS', itemType: 'RAW_MATERIAL', isActive: true });
  await SKU.create({ code: SCRAP_SKU_CODE, ...SCRAP_SKU_DEFAULTS, isActive: true });

  const vendors = {};
  for (const v of [...new Set(PURCHASES.map((p) => p.vendor))]) vendors[v] = await Vendor.create({ name: v, isActive: true });

  // Opening scrap at PLG01, through the real Scrap In service.
  await scrapImsService.scrapIn({ date: today(), warehouse: 'PLG01', quantityKg: OPENING_SCRAP_KG, reason: 'OPENING_STOCK', clientRequestId: 'e2e-full-opening-scrap', remarks: 'E2E opening scrap' }, user);
  // An existing buyer in the master.
  await scrapBuyerService.create({ name: 'E2E Existing Buyer', contactPerson: 'Suresh Shah', phone: '9825099999', gstNo: '24AAAEE1234E1Z5', address: 'Naroda' }, user);

  const baselineBeforePurchase = await counts();

  console.log('— Purchase chain (indent → approve → quote not required → PO → approve → release → PI not required → follow-up → ready for GRN)');
  const pos = {};
  for (const p of PURCHASES) {
    const { po, indentId, movesAfterDraft } = await buyThrough(p, skus, vendors, user);
    const ind = await PurchaseIndent.findById(indentId).lean();
    pos[p.key] = { poId: String(po._id), poNumber: po.poNumber, indentNumber: ind.indentNumber, vendor: p.vendor };
    check(`${p.key}: PO ${po.poNumber} approved + released`, po.approvalStatus === 'APPROVED' && po.releaseStatus === 'RELEASED' && po.poStatus === 'RELEASED_TO_VENDOR',
      `${po.approvalStatus}/${po.releaseStatus}/${po.poStatus}`);
    check(`${p.key}: GRN-eligible (READY_FOR_GRN, PI not required, ready date set)`,
      po.followUpStatus === 'READY_FOR_GRN' && po.piStatus === 'PI_NOT_REQUIRED' && !!po.readyForGrnAt && !!po.finalMaterialDate,
      `${po.followUpStatus}/${po.piStatus}`);
    check(`${p.key}: PO carries supplier, SKU and qty`, po.vendorName === p.vendor
      && JSON.stringify(po.items.map((i) => [i.skuCode, i.quantity])) === JSON.stringify(p.lines.map((l) => [l.sku, l.qty])),
    JSON.stringify(po.items.map((i) => [i.skuCode, i.quantity])));
    check(`${p.key}: linked to its indent ${ind.indentNumber}`, String(po.indentId) === String(indentId) && !!ind.indentNumber);
    check(`${p.key}: no stock was created by the purchase itself`, movesAfterDraft === baselineBeforePurchase.movements
      && (await InventoryMovement.countDocuments({ txnType: TXN_TYPE.GRN_IN })) === 0);
  }

  const baseline = await counts();
  await meta().insertOne({ _id: 'baseline', counts: baseline, at: new Date() });
  await meta().insertOne({ _id: 'pos', pos });

  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify({
    user: E2E_USER, db: DB_NAME, pos, purchases: PURCHASES, rounds: ROUNDS, sales: SALES,
    openingScrapKg: OPENING_SCRAP_KG, apiDisposalKg: API_DISPOSAL_KG,
  }, null, 2));
  console.log(`\nbaseline after seed: ${JSON.stringify(baseline)}`);
  console.log(`manifest: ${MANIFEST}`);
  return finish();
};

/* ══ shared context ══════════════════════════════════════════════════════ */

const context = async () => {
  const user = await User.findOne({ email: E2E_USER.email }).lean();
  const skus = {};
  for (const s of await SKU.find({}).lean()) skus[s.code] = s;
  const { pos } = await meta().findOne({ _id: 'pos' });
  const receiptOf = (batch) => InventoryMovement.findOne({ batchNo: batch, txnType: TXN_TYPE.GRN_IN }).lean();
  const circle = (code, pcs, kg) => ({ circleSkuId: String(skus[code]._id), pcs, weightKg: kg });
  return { user, skus, pos, receiptOf, circle };
};

const cutRound = async (ctx, batch, r, idx, extra = {}) => {
  const rc = await ctx.receiptOf(batch);
  return rmImsService.convert({
    conversionDate: today(),
    clientRequestId: extra.clientRequestId || `e2e-full-${batch}-r${idx}`,
    batchNo: batch, coilReceiptId: String(rc._id), coilSkuId: String(rc.skuId),
    coilWeightKg: r.cut, warehouse: rc.warehouse, scrapVerified: 'PENDING',
    cuttingType: r.type, allowNegative: !!r.allowNegative,
    circles: r.circles.map(([code, pcs, kg]) => ctx.circle(code, pcs, kg)),
    ...extra.payload,
  }, ctx.user);
};

/* ══ --api ═══════════════════════════════════════════════════════════════ */

const api = async () => {
  await connect();
  const ctx = await context();
  const { user, skus, pos } = ctx;
  const po = async (k) => VendorPurchaseOrder.findById(pos[k].poId).lean();

  console.log('\nGRN — batch rules, Add to RM Stock OFF/ON, duplicate + concurrent completion, failure');

  // Coil without batch → reject.
  const a4 = await po('A4');
  await refused('[G1] coil GRN line without a batch number',
    () => grnService.create({ poId: pos.A4.poId, addToRmStock: true, rmReceivedAtLocation: 'PLG01', items: grnItems(a4, skus, null, '') }, user),
    /batch/i);
  const g4 = await grnService.create({ poId: pos.A4.poId, addToRmStock: true, rmReceivedAtLocation: 'PLG01', items: grnItems(a4, skus, null, 'E2E-FULL-COIL-004') }, user);
  const g4id = idOf(g4);
  check('[G2] coil GRN with a batch is created as DRAFT', !!g4id);
  await grnService.complete(g4id, {}, user);
  let mv = await InventoryMovement.find({ refId: g4id, txnType: TXN_TYPE.GRN_IN }).lean();
  check('[G2] completion inherits Add to RM Stock + PLG01 and posts exactly one GRN_IN',
    mv.length === 1 && mv[0].warehouse === 'PLG01' && mv[0].batchNo === 'E2E-FULL-COIL-004' && mv[0].quantity === 1000 && mv[0].refType === 'GRN',
    JSON.stringify(mv.map((m) => [m.warehouse, m.batchNo, m.quantity, m.refType])));
  await refused('[G3] completing the same GRN a second time', () => grnService.complete(g4id, {}, user), /already posted|only draft/i);
  eq('[G3] still exactly one GRN_IN for it', await InventoryMovement.countDocuments({ refId: g4id, txnType: TXN_TYPE.GRN_IN }), 1);

  // Concurrent completion.
  const a5 = await po('A5');
  const g5 = await grnService.create({ poId: pos.A5.poId, addToRmStock: true, rmReceivedAtLocation: 'PLG01', items: grnItems(a5, skus, null, 'E2E-FULL-COIL-005') }, user);
  const g5id = idOf(g5);
  const settled = await Promise.allSettled([grnService.complete(g5id, {}, user), grnService.complete(g5id, {}, user)]);
  const ok = settled.filter((s) => s.status === 'fulfilled').length;
  check('[G4] two simultaneous completions: exactly ONE succeeds', ok === 1,
    settled.map((s) => (s.status === 'fulfilled' ? 'ok' : s.reason?.message?.slice(0, 60))).join(' | '));
  eq('[G4] exactly one GRN_IN posted', await InventoryMovement.countDocuments({ refId: g5id, txnType: TXN_TYPE.GRN_IN }), 1);

  // Circle without batch → reject; consumable without batch fine; Add to RM Stock OFF.
  const a6 = await po('A6');
  await refused('[G5] circle GRN line without a batch number',
    () => grnService.create({ poId: pos.A6.poId, addToRmStock: false, items: grnItems(a6, skus, null, '') }, user), /batch/i);
  const g6 = await grnService.create({ poId: pos.A6.poId, addToRmStock: false, warehouse: 'MAIN', items: grnItems(a6, skus, null, 'E2E-FULL-CIR-006') }, user);
  const g6id = idOf(g6);
  check('[G5] circle WITH batch + consumable WITHOUT batch: GRN created (other products keep their rule)', !!g6id);
  const c6 = await grnService.complete(g6id, {}, user);
  mv = await InventoryMovement.find({ refId: g6id, txnType: TXN_TYPE.GRN_IN }).lean();
  check('[G6] Add to RM Stock OFF: the GRN completes', (await GoodsReceiptNote.findById(g6id).lean()).stockPosted === true, c6?.grnStatus || '');
  check('[G6] …the CIRCLE (RM) line posts NO GRN_IN', !mv.some((m) => m.skuCode === 'JSL204-07-700'), JSON.stringify(mv.map((m) => m.skuCode)));
  check('[G6] …the consumable still posts its GRN_IN to the GRN warehouse (MAIN), unbatched',
    mv.length === 1 && mv[0].skuCode === 'E2E-FULL-CONS' && mv[0].warehouse === 'MAIN' && mv[0].quantity === 40 && mv[0].batchNo === '',
    JSON.stringify(mv.map((m) => [m.skuCode, m.warehouse, m.quantity, m.batchNo])));
  const poA6 = await po('A6');
  check('[G6] …and the PO still records both lines as received', poA6.items.every((i) => round2(i.receivedQty) === i.quantity));

  // Failure after the completion claim: over-receipt with no remarks.
  const a7 = await po('A7');
  const g7 = await grnService.create({ poId: pos.A7.poId, addToRmStock: true, rmReceivedAtLocation: 'PLG01', items: grnItems(a7, skus, () => 150, 'E2E-FULL-COIL-007') }, user)
    .catch((e) => ({ error: e }));
  if (g7.error) {
    check('[G7] over-receipt GRN', false, `create refused: ${g7.error.message}`);
  } else {
    const g7id = idOf(g7);
    await refused('[G7] completing an over-receipt with NO remarks (fails after the completion claim)', () => grnService.complete(g7id, {}, user), /remarks/i);
    const g7doc = await GoodsReceiptNote.findById(g7id).lean();
    check('[G7] …the claim is released: stockPosted back to false, still DRAFT', g7doc.stockPosted === false && g7doc.grnStatus === 'DRAFT', `${g7doc.stockPosted}/${g7doc.grnStatus}`);
    await grnService.complete(g7id, { remarks: 'E2E: extra 50 kg delivered and accepted' }, user);
    eq('[G7] …and the corrected completion then posts once (150 kg)',
      (await InventoryMovement.find({ refId: g7id, txnType: TXN_TYPE.GRN_IN }).lean()).map((m) => m.quantity), [150]);
  }

  console.log('\nCUT COILS — validation, mapping, Full/Partial, stale Full, duplicates (coil 4, 1,000 kg PLG01)');
  const c4 = await ctx.receiptOf('E2E-FULL-COIL-004');
  const base4 = { batchNo: c4.batchNo, coilReceiptId: String(c4._id), coilSkuId: String(c4.skuId), warehouse: 'PLG01', scrapVerified: 'PENDING' };
  const one = [ctx.circle('JSL204-07-700', 10, 8)];
  await refused('[N3] a circle from another coil family (JSL202-06-700 on JSL204-07)',
    () => rmImsService.convert({ ...base4, clientRequestId: 'n3', coilWeightKg: 10, cuttingType: 'PARTIAL', circles: [ctx.circle('JSL202-06-700', 10, 8)] }, user), /cannot be produced/);
  await refused('[N4] an unmapped coil (QA-E2E-UNMAPPED)',
    () => rmImsService.convert({ clientRequestId: 'n4', manualFallback: true, coilSkuId: String(skus['QA-E2E-UNMAPPED']._id), coilWeightKg: 10, warehouse: 'PLG01', cuttingType: 'PARTIAL', circles: one }, user), /approved|mapping|mapped/i);
  await refused('[N5] coil 4\'s batch/receipt submitted with the WRONG coil SKU (JSL204-08)',
    () => rmImsService.convert({ ...base4, clientRequestId: 'n5', coilSkuId: String(skus['JSL204-08']._id), coilWeightKg: 10, cuttingType: 'PARTIAL', circles: [ctx.circle('JSL204-08-850', 10, 8)] }, user), /is JSL204-07, not JSL204-08/);
  check('[N6] 0 kg refused at the API boundary', !!rmConvertSchema.validate({ ...base4, coilWeightKg: 0, circles: one }).error);
  check('[N7] negative kg refused at the API boundary', !!rmConvertSchema.validate({ ...base4, coilWeightKg: -5, circles: one }).error);
  await refused('[N6] 0 kg reaching the service', () => rmImsService.convert({ ...base4, clientRequestId: 'n6', coilWeightKg: 0, cuttingType: 'PARTIAL', circles: one }, user));
  await refused('[N7] negative kg reaching the service', () => rmImsService.convert({ ...base4, clientRequestId: 'n7', coilWeightKg: -5, cuttingType: 'PARTIAL', circles: one }, user));
  await refused('[N8] Partial 1,001 kg with 1,000 remaining (override OFF)',
    () => rmImsService.convert({ ...base4, clientRequestId: 'n8', coilWeightKg: 1001, cuttingType: 'PARTIAL', circles: one }, user), /Only 1,000 KG is available from this physical coil/);
  await refused('[N15] an invalid cuttingType (HALF)',
    () => rmImsService.convert({ ...base4, clientRequestId: 'n15', coilWeightKg: 10, cuttingType: 'HALF', circles: one }, user), /Cutting type must be FULL or PARTIAL/);
  check('[N15] …and at the API boundary', !!rmConvertSchema.validate({ ...base4, coilWeightKg: 10, cuttingType: 'HALF', circles: one }).error);
  await refused('[N10] Full cutting without a physical coil (No receipt available)',
    () => rmImsService.convert({ clientRequestId: 'n10', manualFallback: true, coilSkuId: String(c4.skuId), coilWeightKg: 10, warehouse: 'PLG01', cuttingType: 'FULL', circles: one }, user), /Full cutting needs the physical coil/);

  const r1 = await cutRound(ctx, 'E2E-FULL-COIL-004', ROUNDS.C4[0], 1);
  check('[C4-R1] Partial 500 kg with two circle sizes saves: 425 out, 75 scrap, 85%',
    r1.coilWeightKg === 500 && r1.circlesWeightKg === 425 && r1.scrapKg === 75 && r1.yieldRatioPct === 85 && r1.cuttingType === 'PARTIAL' && r1.circles.length === 2);
  const before30 = { c: await counts(), s: await stockPrint() };
  const r1again = await cutRound(ctx, 'E2E-FULL-COIL-004', ROUNDS.C4[0], 1);
  check('[N14] the same submission (same clientRequestId) again is the SAME round', String(r1again._id) === String(r1._id));
  check('[N14] …no new conversion, movement, circle stock or scrap', JSON.stringify(before30) === JSON.stringify({ c: await counts(), s: await stockPrint() }));
  await refused('[N11] a STALE Full submission (form says 400 kg, coil has 500 kg left)',
    () => cutRound(ctx, 'E2E-FULL-COIL-004', { ...ROUNDS.C4[1], cut: 400 }, 9), /now has 500 KG remaining, not 400 KG/);
  const r2 = await cutRound(ctx, 'E2E-FULL-COIL-004', ROUNDS.C4[1], 2);
  check('[C4-R2] Full takes exactly the remaining 500 kg', r2.coilWeightKg === 500 && r2.cuttingType === 'FULL');
  const lin4 = await rmImsService.getCoilLineage(c4._id);
  eq('[C4] two rounds Partial then Full, remaining 1,000 → 500 → 0, coil FULLY_CUT',
    { r: lin4.rounds.map((x) => [x.cuttingType, x.remainingAfterKg, x.status]), s: lin4.totals.coil.status },
    { r: [['PARTIAL', 500, 'PARTIAL'], ['FULL', 0, 'FULLY_CUT']], s: 'FULLY_CUT' });
  await refused('[N9] Full cutting on the fully cut coil', () => cutRound(ctx, 'E2E-FULL-COIL-004', { ...ROUNDS.C4[1], cut: 1 }, 10), /already fully cut/);
  await refused('[N9b] Partial on the fully cut coil (override OFF)', () => cutRound(ctx, 'E2E-FULL-COIL-004', { ...ROUNDS.C4[0], cut: 1, circles: [['JSL204-07-700', 1, 1]] }, 11), /fully cut — 0 KG is available/);

  console.log('\nALLOW CUTTING MORE THAN WE HOLD (coil 5, 200 kg PLG01)');
  await refused('[O1] Partial 250 kg of 200 with the override OFF', () => cutRound(ctx, 'E2E-FULL-COIL-005', { ...ROUNDS.C5[0], allowNegative: false }, 1), /Only 200 KG is available/);
  const o2 = await cutRound(ctx, 'E2E-FULL-COIL-005', ROUNDS.C5[0], 2);
  const lin5 = await rmImsService.getCoilLineage((await ctx.receiptOf('E2E-FULL-COIL-005'))._id);
  check('[O2] with the override ON the existing behaviour stands: saved, coil at −50 kg and flagged over-cut',
    !!o2?._id && lin5.totals.remainingKg === -50 && lin5.totals.coil.overCut === true && lin5.totals.coil.status === 'FULLY_CUT',
    `${lin5.totals.remainingKg} / overCut ${lin5.totals.coil.overCut}`);

  console.log('\nSCRAP OUT — negatives and replay');
  const existing = await ScrapBuyer.findOne({ name: 'E2E Existing Buyer' }).lean();
  await refused('[N17] Scrap Out of more than PLG01 holds', () => scrapImsService.scrapOut({ warehouse: 'PLG01', reason: 'SALE', buyerId: String(existing._id), quantity: 1000, uom: 'TON', clientRequestId: 'n17' }, user), /Not enough scrap/i);
  await refused('[N18] Scrap Out to a buyer id that does not exist', () => scrapImsService.scrapOut({ warehouse: 'PLG01', reason: 'SALE', buyerId: String(new mongoose.Types.ObjectId()), quantityKg: 5, clientRequestId: 'n18' }, user));
  check('[N19] an invalid unit (LB) is refused at the API boundary', !!scrapOutSchema.validate({ warehouse: 'PLG01', reason: 'SALE', buyerId: String(existing._id), quantity: 5, uom: 'LB' }).error);
  check('[N20] a SALE with no buyer is refused at the API boundary', !!scrapOutSchema.validate({ warehouse: 'PLG01', reason: 'SALE', quantityKg: 5 }).error);
  check('[N20] a SALE with no quantity is refused at the API boundary', !!scrapOutSchema.validate({ warehouse: 'PLG01', reason: 'SALE', buyerId: String(existing._id) }).error);
  check('[N18] an invalid buyer (1-char name) is refused by the buyer master', !!(await scrapBuyerService.create({ name: 'x' }, user).then(() => null).catch((e) => e)));
  const d1 = await scrapImsService.scrapOut({ date: today(), warehouse: 'PLG01', reason: 'DISPOSAL', quantityKg: API_DISPOSAL_KG, partyName: 'E2E municipal yard', clientRequestId: 'e2e-full-disposal' }, user);
  const before31 = { c: await counts(), s: await stockPrint() };
  const d2 = await scrapImsService.scrapOut({ date: today(), warehouse: 'PLG01', reason: 'DISPOSAL', quantityKg: API_DISPOSAL_KG, partyName: 'E2E municipal yard', clientRequestId: 'e2e-full-disposal' }, user);
  check('[I3] a replayed Scrap Out (same clientRequestId) writes nothing the second time',
    d1?.count === 1 && (d2?.duplicate === true || d2?.count === 0) && JSON.stringify(before31) === JSON.stringify({ c: await counts(), s: await stockPrint() }),
    JSON.stringify({ first: d1?.count, second: d2 }));

  return finish();
};

/* ══ --rollback (must run in a FRESH process — resolveScrapSku caches) ══ */

const rollback = async () => {
  await connect();
  const ctx = await context();
  console.log('\nROLLBACK — a PLG01 cut that fails AFTER the coil and circles were written, inside the transaction');
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  check('transactions are available (replica set)', !!hello.setName, hello.setName || 'standalone');
  const before = { c: await counts(), s: await stockPrint(), led: await InventoryMovement.countDocuments({ batchNo: 'E2E-FULL-COIL-007' }) };
  await SKU.updateOne({ code: SCRAP_SKU_CODE }, { $set: { isDeleted: true } });
  let err = null;
  try {
    await cutRound(ctx, 'E2E-FULL-COIL-007', { type: 'PARTIAL', cut: 100, circles: [['JSL202-06-700', 100, 80]] }, 1);
  } catch (e) { err = e; }
  await SKU.updateOne({ code: SCRAP_SKU_CODE }, { $set: { isDeleted: false } });
  const after = { c: await counts(), s: await stockPrint(), led: await InventoryMovement.countDocuments({ batchNo: 'E2E-FULL-COIL-007' }) };
  check('the cut fails (scrap item unavailable mid-transaction)', !!err && err.statusCode === 503, err?.message?.slice(0, 90));
  check('NO coil deduction, NO circle stock, NO scrap, NO conversion survived the failure', JSON.stringify(before) === JSON.stringify(after),
    `${JSON.stringify(before.c)} → ${JSON.stringify(after.c)}`);
  check('no conversion pretends to have succeeded', (await CoilConversion.countDocuments({ batchNo: 'E2E-FULL-COIL-007' })) === 0);
  return finish();
};

/* ══ --retryproof: a GRN completion whose transaction is retried ═════════
 * withTransaction re-runs its callback after a TransientTransactionError. Here
 * exactly ONE such abort is injected right after the PO has been saved inside
 * the transaction — the point where the old code had already mutated the
 * in-memory PO — and the completion must still land exactly once.          */

const retryproof = async () => {
  await connect();
  const ctx = await context();
  const { user, skus } = ctx;
  console.log('\nGRN COMPLETION UNDER A TRANSACTION RETRY');
  const vendors = { 'E2E Full Supplier 4': await Vendor.findOne({ name: 'E2E Full Supplier 4' }) };
  const { po } = await buyThrough({ vendor: 'E2E Full Supplier 4', lines: [{ sku: 'JSL202-06', qty: 50, rate: 170 }] }, skus, vendors, user);
  const g = await grnService.create({ poId: String(po._id), addToRmStock: true, rmReceivedAtLocation: 'PLG01', items: grnItems(po, skus, null, 'E2E-FULL-COIL-008') }, user);
  const gid = idOf(g);

  const origSave = VendorPurchaseOrder.prototype.save;
  let injected = 0;
  VendorPurchaseOrder.prototype.save = async function patched(...args) {
    const out = await origSave.apply(this, args);
    const s = args[0]?.session;
    if (s && s.inTransaction() && injected === 0) {
      injected += 1;
      const e = new mongoose.mongo.MongoServerError({ message: 'E2E injected transient abort', code: 112, errorLabels: ['TransientTransactionError'] });
      throw e;
    }
    return out;
  };
  let err = null;
  try { await grnService.complete(gid, {}, user); } catch (e) { err = e; }
  VendorPurchaseOrder.prototype.save = origSave;

  check('one transient abort was injected after the PO save', injected === 1, `${injected}`);
  check('the completion still succeeds on the retry', !err, err?.message?.slice(0, 120));
  const fresh = await VendorPurchaseOrder.findById(po._id).lean();
  eq('PO received qty counted ONCE (50, not 100)', fresh.items[0].receivedQty, 50);
  eq('PO timeline has ONE GRN_RECEIVED entry', fresh.activityTimeline.filter((t) => t.action === 'GRN_RECEIVED').length, 1);
  eq('exactly one GRN_IN (50 kg)', (await InventoryMovement.find({ refId: gid, txnType: TXN_TYPE.GRN_IN }).lean()).map((m) => m.quantity), [50]);
  const gd = await GoodsReceiptNote.findById(gid).lean();
  check('GRN completed once (stockPosted, one COMPLETE entry)', gd.stockPosted === true && gd.activityTimeline.filter((t) => t.action === 'COMPLETE').length === 1);
  return finish();
};

/* ══ --pi: the PI / advance-payment path, and a GRN retry that touches the PI ══
 * PO → PI (with document) → PI approved → full advance payment → PAYMENT_COMPLETED
 * → follow-up ready for GRN → GRN. The GRN completion's transaction is aborted
 * ONCE right after the PI was saved inside it; the PI's received quantity has
 * no version check, so a non-retry-safe completion would count it twice.  */

const piPath = async () => {
  await connect();
  const ctx = await context();
  const { user, skus } = ctx;
  const { proformaInvoiceService } = await import('../modules/procurement/proforma-invoice/proformaInvoice.service.js');
  const { advancePaymentService } = await import('../modules/procurement/advance-payment/advancePayment.service.js');
  const { default: ProformaInvoice } = await import('../modules/procurement/proforma-invoice/proformaInvoice.model.js');
  console.log('\nPI / ADVANCE PAYMENT PATH → GRN (with a transaction retry after the PI save)');

  const vendor = await Vendor.create({ name: 'E2E PI Supplier', isActive: true });
  const line = { sku: 'JSL204-07', qty: 300, rate: 185 };
  const indent = await indentService.create({ items: [{ skuId: String(skus[line.sku]._id), skuCode: line.sku, itemName: skus[line.sku].name, quantity: line.qty, unit: 'KGS' }], raisedBy: 'E2E', department: 'Stores' }, user);
  const indentId = idOf(indent);
  const ind = await PurchaseIndent.findById(indentId).lean();
  await indentService.approve(indentId, { items: ind.items.map((it) => ({ _id: String(it._id), revisedQuantity: it.quantity })) }, user);
  await indentService.quoteComparative(indentId, { statusDone: 'QUOTE_NOT_REQUIRED' }, user);
  const ind2 = await PurchaseIndent.findById(indentId).lean();
  const po0 = await purchaseOrderService.create({ indentId: String(indentId), vendorId: String(vendor._id), poFormatType: 'OTHER', items: [{ indentItemId: String(ind2.items[0]._id), skuId: String(skus[line.sku]._id), skuCode: line.sku, itemName: skus[line.sku].name, unit: 'KGS', quantity: line.qty, rate: line.rate, gstRate: 18 }] }, user);
  const poId = idOf(po0);
  await purchaseOrderService.approve(poId, { decision: 'APPROVED' }, user);
  await purchaseOrderService.release(poId, { sendEmail: false }, user);

  const pi = await proformaInvoiceService.create({ poId: String(poId), piDocument: { fileUrl: '/uploads/e2e/e2e-pi.pdf', fileName: 'e2e-pi.pdf', fileType: 'application/pdf' } }, user);
  check('PI created from the released PO (document attached → RECEIVED)', pi.piStatus === 'RECEIVED', pi.piStatus);
  eq('PO mirror: PI Received', (await VendorPurchaseOrder.findById(poId).lean()).piStatus, 'PI_RECEIVED');
  await refused('[P1] a GRN before the PI is paid', async () => {
    const poX = await VendorPurchaseOrder.findById(poId).lean();
    return grnService.create({ poId: String(poId), addToRmStock: true, rmReceivedAtLocation: 'PLG01', items: grnItems(poX, skus, null, 'E2E-FULL-COIL-PI') }, user);
  });
  await proformaInvoiceService.approve(pi._id, {}, user);
  eq('PI approved → ready for advance payment (PO mirror)', (await VendorPurchaseOrder.findById(poId).lean()).piStatus, 'READY_FOR_ADVANCE_PAYMENT');
  const piDoc = await ProformaInvoice.findById(pi._id).lean();
  await refused('[P2] a "Full Payment" that does not clear the balance', () => advancePaymentService.create({ piId: String(pi._id), paymentStatus: 'FULL_PAYMENT', paidAmount: round2(piDoc.balanceAmount - 1), paymentDate: new Date() }, user), /Full payment must clear/);
  const pay = await advancePaymentService.create({ piId: String(pi._id), paymentStatus: 'FULL_PAYMENT', paidAmount: piDoc.balanceAmount, paymentDate: new Date(), paymentReferenceNumber: 'E2E-UTR-001' }, user);
  check('advance payment recorded for the full balance', !!pay?.paymentNumber, pay?.paymentNumber);
  eq('PI and PO → PAYMENT_COMPLETED', [(await ProformaInvoice.findById(pi._id).lean()).piStatus, (await VendorPurchaseOrder.findById(poId).lean()).piStatus], ['PAYMENT_COMPLETED', 'PAYMENT_COMPLETED']);
  const fu = await followUpService.create({ poId: String(poId) }, user);
  await followUpService.markDone(idOf(fu), { finalMaterialDate: new Date() }, user);
  const po = await VendorPurchaseOrder.findById(poId).lean();
  check('PO is GRN-eligible (READY_FOR_GRN + PAYMENT_COMPLETED)', po.followUpStatus === 'READY_FOR_GRN' && po.piStatus === 'PAYMENT_COMPLETED');
  const g = await grnService.create({ poId: String(poId), addToRmStock: true, rmReceivedAtLocation: 'PLG01', items: grnItems(po, skus, null, 'E2E-FULL-COIL-PI') }, user);
  const gid = idOf(g);
  check('the GRN carries the PI link', String((await GoodsReceiptNote.findById(gid).lean()).piId) === String(pi._id));

  const origSave = ProformaInvoice.prototype.save;
  let injected = 0;
  ProformaInvoice.prototype.save = async function patched(...args) {
    const out = await origSave.apply(this, args);
    const s = args[0]?.session;
    if (s && s.inTransaction() && injected === 0) {
      injected += 1;
      throw new mongoose.mongo.MongoServerError({ message: 'E2E injected transient abort after PI save', code: 112, errorLabels: ['TransientTransactionError'] });
    }
    return out;
  };
  let err = null;
  try { await grnService.complete(gid, {}, user); } catch (e) { err = e; }
  ProformaInvoice.prototype.save = origSave;
  check('one transient abort was injected right after the PI save', injected === 1);
  check('the GRN completion succeeds on the retry', !err, err?.message?.slice(0, 120));
  const piAfter = await ProformaInvoice.findById(pi._id).lean();
  eq('PI received qty counted ONCE (300, not 600) and balance 0', [piAfter.items[0].receivedQty, piAfter.items[0].balanceQty], [300, 0]);
  eq('PO received qty counted once', (await VendorPurchaseOrder.findById(poId).lean()).items[0].receivedQty, 300);
  eq('exactly one GRN_IN of 300 kg', (await InventoryMovement.find({ refId: gid, txnType: TXN_TYPE.GRN_IN }).lean()).map((m) => m.quantity), [300]);
  return finish();
};

/* ══ --behind: the round the browser does not know about ════════════════ */

const behind = async () => {
  await connect();
  const ctx = await context();
  const r = ROUNDS.C3.find((x) => x.behind);
  const d = await cutRound(ctx, 'E2E-FULL-COIL-003', r, 'behind');
  console.log(JSON.stringify({ ok: true, conversionNumber: d.conversionNumber, cut: d.coilWeightKg }));
  await mongoose.disconnect();
  return true;
};

/* ══ --verify: the final oracle ═════════════════════════════════════════ */

const verify = async () => {
  await connect();
  const ctx = await context();
  const { pos } = ctx;
  const { counts: baseline } = await meta().findOne({ _id: 'baseline' });
  const final = await counts();
  console.log('\nFINAL DATABASE ORACLE\n');

  /* Purchase / GRN */
  console.log('— purchase + GRN');
  for (const p of PURCHASES) {
    const po = await VendorPurchaseOrder.findById(pos[p.key].poId).lean();
    const grns = await GoodsReceiptNote.find({ poId: po._id, isDeleted: { $ne: true } }).lean();
    const posted = grns.filter((g) => g.stockPosted);
    check(`${p.key} ${po.poNumber}: one completed GRN`, posted.length === 1, `${posted.length}`);
    const g = posted[0];
    if (!g) continue;
    const want = p.key === 'A7' ? 150 : p.lines[0].qty;
    check(`${p.key}: PO received qty booked back = GRN qty`, round2(po.items[0].receivedQty) === want, `${po.items[0].receivedQty}`);
    const mv = await InventoryMovement.find({ refId: g._id, txnType: TXN_TYPE.GRN_IN }).lean();
    if (p.key === 'A6') continue; // asserted in --api (RM line OFF, consumable ON)
    check(`${p.key} ${g.grnNumber}: exactly one GRN_IN = ${want} kg, batch ${p.batch}, at ${p.at}`,
      mv.length === 1 && round2(mv[0].quantity) === want && mv[0].batchNo === p.batch && mv[0].warehouse === p.at && g.rmReceivedAtLocation === p.at,
      JSON.stringify(mv.map((m) => [m.quantity, m.batchNo, m.warehouse])));
  }

  /* Coils */
  console.log('\n— physical coils');
  const COIL_EXPECT = {
    'E2E-FULL-COIL-001': { received: 2000, cut: 2000, remaining: 0, types: ['PARTIAL', 'FULL'], circles: 1720, scrap: 280, yieldPct: 86, at: 'PLG01' },
    'E2E-FULL-COIL-002': { received: 2500, cut: 1500, remaining: 1000, types: ['PARTIAL', 'PARTIAL'], circles: 1230, scrap: 270, yieldPct: 82, at: 'JW001' },
    'E2E-FULL-COIL-003': { received: 1500, cut: 1500, remaining: 0, types: ['PARTIAL', 'PARTIAL', 'FULL'], circles: 1275, scrap: 225, yieldPct: 85, at: 'PLG01' },
    'E2E-FULL-COIL-004': { received: 1000, cut: 1000, remaining: 0, types: ['PARTIAL', 'FULL'], circles: 855, scrap: 145, yieldPct: 85.5, at: 'PLG01' },
    'E2E-FULL-COIL-005': { received: 200, cut: 250, remaining: -50, types: ['PARTIAL'], circles: 200, scrap: 50, yieldPct: 80, at: 'PLG01' },
    'E2E-FULL-COIL-007': { received: 150, cut: 0, remaining: 150, types: [], circles: 0, scrap: 0, yieldPct: null, at: 'PLG01' },
  };
  const recon = [];
  for (const [batch, e] of Object.entries(COIL_EXPECT)) {
    const rc = await ctx.receiptOf(batch);
    const lin = await rmImsService.getCoilLineage(rc._id);
    const led = await InventoryMovement.find({ batchNo: batch, skuId: rc.skuId }).lean();
    const ledgerRemaining = round2(led.reduce((s, m) => s + (m.movementType === 'IN' ? m.quantity : -m.quantity), 0));
    recon.push({ batch, sku: rc.skuCode, original: e.received, totalCut: lin.totals.cutKg, remaining: ledgerRemaining, rounds: lin.rounds.length });
    eq(`${batch}: received / cut / remaining (ledger) / rounds`,
      [round2(rc.quantity), lin.totals.cutKg, ledgerRemaining, lin.totals.remainingKg, lin.rounds.length],
      [e.received, e.cut, e.remaining, e.remaining, e.types.length]);
    eq(`${batch}: cutting types in order`, lin.rounds.map((r) => r.cuttingType), e.types);
    eq(`${batch}: circles / scrap / WEIGHTED yield`, [lin.totals.circlesKg, lin.totals.scrapKg, lin.totals.avgYieldPct], [e.circles, e.scrap, e.yieldPct]);
    for (const r of lin.rounds) {
      const okR = round2(r.scrapKg) === round2(r.cutKg - r.circlesKg) && round2(r.yieldPct) === round2((r.circlesKg / r.cutKg) * 100);
      if (!okR) check(`${batch} round ${r.roundNo}: scrap = cut − circles, yield = circles ÷ cut`, false, JSON.stringify(r));
    }
    const convs = await CoilConversion.find({ batchNo: batch }).lean();
    check(`${batch}: every conversion links to this physical coil`, convs.every((c) => String(c.coilReceiptId) === String(rc._id)));
    const scrapIns = await InventoryMovement.countDocuments({ txnType: TXN_TYPE.SCRAP_IN, refId: { $in: convs.map((c) => c._id) } });
    eq(`${batch}: SCRAP_IN movements (${e.at === 'JW001' ? 'job work → none' : 'plant → one per round with scrap'})`, scrapIns, e.at === 'JW001' ? 0 : convs.filter((c) => c.scrapKg > 0).length);
    const srs = await ScrapRecord.find({ conversionId: { $in: convs.map((c) => c._id) } }).lean();
    check(`${batch}: one ScrapRecord per round, location ${e.at}, linked to the coil`,
      srs.length === convs.length && srs.every((s) => s.location === e.at && String(s.coilReceiptId) === String(rc._id)));
  }
  check('every conversion in this DB names its physical coil (coilReceiptId)', (await CoilConversion.countDocuments({ coilReceiptId: null })) === 0);

  /* Circles */
  console.log('\n— circle stock');
  const circleRows = [];
  const circleSkus = await SKU.find({ itemType: 'CIRCLE' }).lean();
  for (const s of circleSkus) {
    const ins = await InventoryMovement.find({ skuId: s._id, txnType: TXN_TYPE.CONVERT_IN }).lean();
    const grnIns = await InventoryMovement.find({ skuId: s._id, txnType: TXN_TYPE.GRN_IN }).lean();
    const stock = await InventoryStock.find({ skuId: s._id }).lean();
    const pcs = round2(stock.reduce((t, r) => t + (r.qtyOnHand || 0), 0));
    const kg = round2(stock.reduce((t, r) => t + (r.qtyOnHandKg || 0), 0));
    const expPcs = round2(ins.reduce((t, m) => t + m.quantity, 0) + grnIns.reduce((t, m) => t + m.quantity, 0));
    const expKg = round2(ins.reduce((t, m) => t + (m.quantityKg || 0), 0));
    if (!ins.length && !grnIns.length && !stock.length) continue;
    circleRows.push({ sku: s.code, producedPcs: round2(ins.reduce((t, m) => t + m.quantity, 0)), producedKg: expKg, stockPcs: pcs, stockKg: kg });
    eq(`${s.code}: stock pcs = Σ CONVERT_IN pcs, stock kg = Σ CONVERT_IN kg`, [pcs, kg], [expPcs, expKg]);
  }
  check('Add to RM Stock OFF: the circle received on A6 never entered stock',
    (await InventoryMovement.countDocuments({ skuCode: 'JSL204-07-700', txnType: TXN_TYPE.GRN_IN })) === 0);

  /* Scrap */
  console.log('\n— scrap');
  const scrapSku = await SKU.findOne({ code: SCRAP_SKU_CODE }).lean();
  const sm = await InventoryMovement.find({ skuId: scrapSku._id }).lean();
  const sum = (arr) => round2(arr.reduce((t, m) => t + m.quantity, 0));
  const scrapRecon = {};
  for (const wh of ['PLG01', 'JW001']) {
    const ins = sm.filter((m) => m.warehouse === wh && m.txnType === TXN_TYPE.SCRAP_IN);
    const outs = sm.filter((m) => m.warehouse === wh && m.txnType === TXN_TYPE.SCRAP_OUT);
    const opening = sum(ins.filter((m) => m.reason === 'OPENING_STOCK'));
    const fromCuts = sum(ins.filter((m) => m.reason === 'CUTTING_OFFCUT'));
    const stockRow = await InventoryStock.findOne({ skuId: scrapSku._id, warehouse: wh }).lean();
    scrapRecon[wh] = { opening, scrapInFromCutting: fromCuts, scrapIn: sum(ins), scrapOut: sum(outs), closingLedger: round2(sum(ins) - sum(outs)), closingStock: round2(stockRow?.qtyOnHand || 0) };
  }
  const plgCutScrap = round2(['E2E-FULL-COIL-001', 'E2E-FULL-COIL-003', 'E2E-FULL-COIL-004', 'E2E-FULL-COIL-005'].reduce((t, b) => t + COIL_EXPECT[b].scrap, 0));
  eq('PLG01: SCRAP_IN from cutting = Σ PLG01 round scrap', scrapRecon.PLG01.scrapInFromCutting, plgCutScrap);
  eq('PLG01: opening scrap', scrapRecon.PLG01.opening, OPENING_SCRAP_KG);
  eq('PLG01: SCRAP_OUT = UI sales (500 KG + 5 Quintal + 2 Ton) + API disposal', scrapRecon.PLG01.scrapOut, round2(SALES.reduce((t, s) => t + s.kg, 0) + API_DISPOSAL_KG));
  eq('PLG01: opening + IN − OUT = closing = InventoryStock', [scrapRecon.PLG01.closingLedger, scrapRecon.PLG01.closingStock], [round2(OPENING_SCRAP_KG + plgCutScrap - 3010), round2(OPENING_SCRAP_KG + plgCutScrap - 3010)]);
  eq('JW001: no Ambika SCRAP_IN, no stock', [scrapRecon.JW001.scrapIn, scrapRecon.JW001.closingStock], [0, 0]);
  const outs = sm.filter((m) => m.txnType === TXN_TYPE.SCRAP_OUT && m.reason === 'SALE').sort((a, b) => a.createdAt - b.createdAt);
  eq('the three UI sales kept the unit AS ENTERED', outs.map((m) => [m.enteredQty, m.enteredUom, m.quantity]), SALES.map((s) => [s.qty, s.uom, s.kg]));
  eq('…sold to the right buyers', outs.map((m) => m.buyer?.name || m.partyName), SALES.map((s) => s.buyer));
  const newBuyer = await ScrapBuyer.find({ name: 'E2E New Buyer Traders' }).lean();
  check('the new buyer was created once in the master, with an SB- code', newBuyer.length === 1 && /^SB-\d+/.test(newBuyer[0].code || ''), JSON.stringify(newBuyer.map((b) => b.code)));

  /* Ledger: every stock row = its movements */
  console.log('\n— ledger');
  const rows = await InventoryStock.find({}).lean();
  let bad = [];
  for (const r of rows) {
    const mvs = await InventoryMovement.find({ skuId: r.skuId, warehouse: r.warehouse, isDeleted: { $ne: true } }).lean();
    const led = round2(mvs.reduce((t, m) => t + (m.movementType === 'IN' ? m.quantity : -m.quantity), 0));
    if (led !== round2(r.qtyOnHand)) bad.push(`${r.skuCode}@${r.warehouse}: stock ${r.qtyOnHand} vs ledger ${led}`);
  }
  check(`every InventoryStock row (${rows.length}) equals Σ its movements`, bad.length === 0, bad.join('; '));

  /* Idempotency */
  console.log('\n— duplicates');
  const dupConv = await CoilConversion.aggregate([{ $match: { clientRequestId: { $type: 'string' } } }, { $group: { _id: '$clientRequestId', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  check('no clientRequestId on two conversions', dupConv.length === 0, JSON.stringify(dupConv));
  const dupOut = await InventoryMovement.aggregate([{ $match: { txnType: TXN_TYPE.SCRAP_OUT, clientRequestId: { $type: 'string', $ne: '' } } }, { $group: { _id: '$clientRequestId', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  check('no clientRequestId on two Scrap Outs', dupOut.length === 0, JSON.stringify(dupOut));
  const dupGrn = await InventoryMovement.aggregate([{ $match: { txnType: TXN_TYPE.GRN_IN } }, { $group: { _id: { r: '$refId', s: '$skuId', b: '$batchNo' }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
  check('no GRN line posted twice', dupGrn.length === 0, JSON.stringify(dupGrn));
  const allConvs = await CoilConversion.find({}).lean();
  bad = [];
  for (const c of allConvs) {
    const o = await InventoryMovement.countDocuments({ refNumber: c.conversionNumber, txnType: TXN_TYPE.CONVERT_OUT });
    const i = await InventoryMovement.countDocuments({ refNumber: c.conversionNumber, txnType: TXN_TYPE.CONVERT_IN });
    if (o !== 1 || i !== c.circles.length) bad.push(`${c.conversionNumber}: OUT ${o}, IN ${i}/${c.circles.length}`);
  }
  check(`each of the ${allConvs.length} conversions has exactly 1 CONVERT_OUT and 1 CONVERT_IN per circle`, bad.length === 0, bad.join('; '));

  /* Records */
  const records = {
    indents: (await PurchaseIndent.find({}).lean()).map((i) => i.indentNumber),
    pos: Object.fromEntries(Object.entries(pos).map(([k, v]) => [k, v.poNumber])),
    grns: (await GoodsReceiptNote.find({ stockPosted: true }).sort({ createdAt: 1 }).lean()).map((g) => `${g.grnNumber} (${g.poNumber})`),
    conversions: allConvs.sort((a, b) => a.createdAt - b.createdAt).map((c) => `${c.conversionNumber} ${c.batchNo} ${c.cuttingType || '-'} ${c.coilWeightKg}kg`),
    scrapIn: sm.filter((m) => m.txnType === TXN_TYPE.SCRAP_IN).map((m) => `${m.movementNumber} ${m.warehouse} ${m.quantity}kg ${m.refNumber || m.reason}`),
    scrapOut: sm.filter((m) => m.txnType === TXN_TYPE.SCRAP_OUT).map((m) => `${m.movementNumber} ${m.quantity}kg (${m.enteredQty ?? m.quantity} ${m.enteredUom || 'KG'}) ${m.buyer?.name || m.partyName || ''} ref ${m.refNumber || m.reference || ''}`),
  };
  console.log(`\nBASELINE: ${JSON.stringify(baseline)}\nFINAL:    ${JSON.stringify(final)}`);
  console.log('\nRECONCILIATION');
  console.log(JSON.stringify({ coils: recon, circles: circleRows, scrap: scrapRecon }, null, 2));
  console.log('\nRECORDS');
  console.log(JSON.stringify(records, null, 2));
  return finish();
};

const mode = process.argv[2];
const main = async () => {
  if (mode === '--seed') return seed().then((p) => process.exit(p ? 0 : 1));
  if (mode === '--api') return api().then((p) => process.exit(p ? 0 : 1));
  if (mode === '--rollback') return rollback().then((p) => process.exit(p ? 0 : 1));
  if (mode === '--behind') return behind().then(() => process.exit(0));
  if (mode === '--retryproof') return retryproof().then((p) => process.exit(p ? 0 : 1));
  if (mode === '--pi') return piPath().then((p) => process.exit(p ? 0 : 1));
  if (mode === '--verify') return verify().then((p) => process.exit(p ? 0 : 1));
  console.error('Usage: --seed | --api | --rollback | --behind | --verify');
  process.exit(1);
};

main().catch(async (e) => {
  console.error('\nFixture failed:', e.stack || e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
