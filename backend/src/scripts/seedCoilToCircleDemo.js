/**
 * DEMO DATA for Cut Coils → "Select GRN / Received Coil" — 8 completed coil GRNs.
 *
 *   node src/scripts/seedCoilToCircleDemo.js --seed     create (or top up) the demo records
 *   node src/scripts/seedCoilToCircleDemo.js --verify   reconcile every demo record from the DB
 *   node src/scripts/seedCoilToCircleDemo.js --dump     print the demo GRNs / batches as JSON
 *   node src/scripts/seedCoilToCircleDemo.js --reset    delete ONLY what this seed (and cuts
 *                                                       made on its coils) created
 *   add --db=ambika_e2e_ctc_test to target the automated-test copy instead of the demo DB
 *
 * HOW THE RECORDS ARE MADE
 * Nothing transactional is written by hand. Each GRN is raised as a DRAFT on a
 * PO, completed through grnService.complete() — the same call the GRN Complete
 * dialog makes — then MD-signed and QC-accepted through incomingQcService (see
 * e2eGrnLifecycle.js; stock posts at QC since QC-gated posting), so the GRN_IN movement, the stock balance, the
 * stockPosted flag and the Received At location are exactly what the app
 * itself writes. The cutting history on four of the coils is saved through
 * rmImsService.convert(), the Cut Coils save, so conversions, circle stock,
 * scrap records, PLG01 scrap stock and lineage all reconcile by construction.
 *
 * IDEMPOTENT
 * Every record has a deterministic identity (GRN DEMO-CTC-GRN-00n, PO
 * DEMO-CTC-PO-00n, batch DEMO-CTC-00n, cut request id demo-ctc-…). A rerun
 * finds what exists and only creates what is missing, so it never posts a
 * second GRN_IN or a second cut.
 *
 * SAFETY
 * Pinned to a localhost database whose name contains "e2e", with S3 and email
 * off (assertE2ESafe stops the process otherwise, before anything connects).
 * It never reads MONGO_URI from .env and cannot reach Atlas. GRN PDFs land in
 * backend/uploads (git-ignored), never S3, and --reset deletes them.
 *
 *   AWS_ACCESS_KEY_ID= AWS_SECRET_ACCESS_KEY= AWS_S3_BUCKET_NAME= AWS_REGION= \
 *   BREVO_API_KEY= SMTP_HOST= SMTP_USER= SMTP_PASS= node src/scripts/seedCoilToCircleDemo.js --seed
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote, { GRN_STATUS } from '../modules/procurement/grn/grn.model.js';
import { completeGrnThroughQc } from './e2eGrnLifecycle.js';
import InventoryMovement, { TXN_TYPE } from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import InventoryRequestKey from '../modules/inventory/inventoryRequestKey.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import ScrapRecord from '../modules/inventory/scrapRecord.model.js';
import ManualCoil from '../modules/inventory/manualCoil.model.js';
import DocumentApproval from '../modules/approvals/approval.model.js';
import { rmImsService } from '../modules/inventory/rmIms.service.js';
import { rmConvertSchema } from '../modules/inventory/rmIms.validation.js';
import { SCRAP_SKU_CODE, SCRAP_SKU_DEFAULTS } from '../modules/inventory/scrapSku.js';
import { COIL_CIRCLE_MAP } from '../data/coil-circle-map.js';
import { MATERIAL_MASTER } from '../data/material-master.js';

const ALLOWED_DBS = ['ambika_e2e_ctc_demo', 'ambika_e2e_ctc_test'];
const dbArg = (process.argv.find((a) => a.startsWith('--db=')) || '').slice(5) || ALLOWED_DBS[0];
export const DB_NAME = ALLOWED_DBS.includes(dbArg) ? dbArg : null;
if (isEntry(import.meta.url) && !DB_NAME) {
  console.error(`Refusing to run: --db must be one of ${ALLOWED_DBS.join(', ')}.`);
  process.exit(1);
}
export const DEMO_URI = `mongodb://127.0.0.1:27017/${DB_NAME || ALLOWED_DBS[0]}`;
// Local scratch DB, S3 off, email off — or stop before anything connects.
if (isEntry(import.meta.url)) assertE2ESafe(DEMO_URI, `seedCoilToCircleDemo.js (${DB_NAME})`);

export const DEMO_USER = { email: 'ctc-demo@test.local', password: 'Demo@12345', name: 'Coil Demo Operator', role: 'MD' };
const MARK = 'DEMO-CTC';
const BATCH_RX = /^DEMO-CTC-/i;
const REQ_PREFIX = 'demo-ctc-';
const REGISTRY = 'demo_seed_registry';
const UPLOADS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads');

const nameOf = (code) => MATERIAL_MASTER.find((m) => m.code === code)?.name || code;

/**
 * The eight coils. Real coil grades from the SKU master (material-master.js)
 * and only circles the client's Coil → Circle sheet approves for them.
 *
 *   cuts: [kg, …] — rounds saved through Cut Coils; 'FULL' takes what is left.
 */
export const DEMO_GRNS = [
  { n: 1, coil: 'JSL204-07', kg: 2000, rate: 185, at: 'PLG01', daysAgo: 21, supplier: 'Demo Steel Traders', cuts: [],
    // A consumable on the same GRN — must NOT appear in the coil dropdown.
    extra: { code: 'CO-BF-40-00', qty: 50, rate: 42 } },
  { n: 2, coil: 'JSL204-08', kg: 2500, rate: 192, at: 'JW001', daysAgo: 19, supplier: 'Demo Coil Suppliers', cuts: [] },
  { n: 3, coil: 'JSL202-06', kg: 1500, rate: 170, at: 'PLG01', daysAgo: 17, supplier: 'Demo Metals Co', cuts: [500] },
  { n: 4, coil: 'JSL202-08', kg: 1800, rate: 175, at: 'JW001', daysAgo: 15, supplier: 'Demo Steel Traders', cuts: [400, 300] },
  { n: 5, coil: 'JSL204-10', kg: 2200, rate: 200, at: 'PLG01', daysAgo: 12, supplier: 'Demo Coil Suppliers', cuts: [] },
  { n: 6, coil: 'JSL202-07', kg: 1200, rate: 172, at: 'JW001', daysAgo: 10, supplier: 'Demo Metals Co', cuts: [] },
  // Cut away to nothing — absent from the dropdown, "fully cut" by batch number.
  { n: 7, coil: 'JSL204-07', kg: 1000, rate: 186, at: 'PLG01', daysAgo: 8, supplier: 'Demo Steel Traders', cuts: [600, 'FULL'] },
  { n: 8, coil: 'JSL204-08', kg: 1600, rate: 190, at: 'PLG01', daysAgo: 6, supplier: 'Demo Coil Suppliers', cuts: [700] },
].map((g) => ({
  ...g,
  pad: String(g.n).padStart(3, '0'),
  batchNo: `${MARK}-${String(g.n).padStart(3, '0')}`,
  grnNumber: `${MARK}-GRN-${String(g.n).padStart(3, '0')}`,
  poNumber: `${MARK}-PO-${String(g.n).padStart(3, '0')}`,
}));

/**
 * Opening stock with NO batch — coil weight that is in RM stock without a GRN.
 *
 * Manual Entry exists for exactly such coils, and a manual cut still comes out
 * of RM stock by grade and location (the same check every cut has), so without
 * this a manual round could only draw on the demo GRN coils' weight or needs
 * "Allow cutting more coil than we hold". Posted through RM Stock In (reason
 * Opening stock), so it is an ordinary, visible OPENING movement.
 */
export const DEMO_OPENING = [
  ...['JSL204-07', 'JSL204-08', 'JSL204-10', 'JSL202-06', 'JSL202-07', 'JSL202-08']
    .flatMap((code) => [{ code, at: 'PLG01', kg: 2000 }, { code, at: 'JW001', kg: 2000 }]),
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const daysAgo = (d, hour = 10) => { const t = new Date(); t.setDate(t.getDate() - d); t.setHours(hour, 0, 0, 0); return t; };
// One deterministic vendor id per supplier name, so reruns agree.
const vendorIdFor = (name) => new mongoose.Types.ObjectId(
  crypto.createHash('sha1').update(`${MARK}:${name}`).digest('hex').slice(0, 24),
);

const connect = async () => {
  await mongoose.connect(DEMO_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.name !== DB_NAME) {
    throw new Error(`Connected to an unexpected database (${mongoose.connection.name}) — aborting.`);
  }
};

const registry = () => mongoose.connection.db.collection(REGISTRY);
const register = async (model, id) => registry().updateOne(
  { seed: MARK, model, id: String(id) }, { $setOnInsert: { seed: MARK, model, id: String(id), at: new Date() } }, { upsert: true },
);

/* ══ --seed ════════════════════════════════════════════════════════════════ */

const ensureMasters = async () => {
  let user = await User.findOne({ email: DEMO_USER.email });
  if (!user) {
    user = await User.create({ ...DEMO_USER, mobile: '9000000071', isActive: true, roles: ['MD'] });
    await register('User', user._id);
  }
  const skus = {};
  const want = new Map();
  for (const g of DEMO_GRNS) {
    want.set(g.coil, { code: g.coil, name: nameOf(g.coil), category: 'Coil', unit: 'KGS', itemType: 'RAW_MATERIAL' });
    for (const c of COIL_CIRCLE_MAP[g.coil] || []) {
      want.set(c.code, { code: c.code, name: c.clientLabel, category: 'Circles', unit: 'PCS', itemType: 'CIRCLE' });
    }
    if (g.extra) want.set(g.extra.code, { code: g.extra.code, name: nameOf(g.extra.code), category: 'Consumable', unit: 'PCS', itemType: 'CONSUMABLE' });
  }
  want.set(SCRAP_SKU_CODE, { code: SCRAP_SKU_CODE, ...SCRAP_SKU_DEFAULTS });
  for (const [code, def] of want) {
    let s = await SKU.findOne({ code });
    if (!s) {
      s = await SKU.create({ ...def, isActive: true });
      await register('SKU', s._id);
    }
    skus[code] = s;
  }
  return { user, skus };
};

/** Raise the DRAFT, then complete it through the real GRN service. */
const ensureGrn = async (g, { user, skus }) => {
  let grn = await GoodsReceiptNote.findOne({ grnNumber: g.grnNumber, isDeleted: { $ne: true } });
  if (grn && grn.grnStatus !== GRN_STATUS.DRAFT && grn.stockPosted) return { grn, created: false };

  if (!grn) {
    const vendorId = vendorIdFor(g.supplier);
    const lines = [{ code: g.coil, qty: g.kg, rate: g.rate, batchNo: g.batchNo, unit: 'KGS' }];
    if (g.extra) lines.push({ code: g.extra.code, qty: g.extra.qty, rate: g.extra.rate, batchNo: '', unit: 'PCS' });
    let po = await VendorPurchaseOrder.findOne({ poNumber: g.poNumber });
    if (!po) {
      po = await VendorPurchaseOrder.create({
        poNumber: g.poNumber, vendorId, vendorName: `${g.supplier} (demo)`,
        indentId: new mongoose.Types.ObjectId(), poStatus: 'APPROVED',
        items: lines.map((l) => ({
          skuId: skus[l.code]._id, skuCode: l.code, itemName: skus[l.code].name, unit: l.unit,
          quantity: l.qty, receivedQty: 0, pendingQty: l.qty, rate: l.rate,
        })),
        remarks: `${MARK} demo purchase order`,
      });
      await register('VendorPurchaseOrder', po._id);
    }
    grn = await GoodsReceiptNote.create({
      grnNumber: g.grnNumber, grnDate: daysAgo(g.daysAgo), poId: po._id, poNumber: po.poNumber,
      vendorId, vendorName: po.vendorName, warehouse: 'MAIN',
      addToRmStock: true, rmReceivedAtLocation: g.at,
      grnStatus: GRN_STATUS.DRAFT, stockPosted: false,
      items: po.items.map((p, i) => ({
        poItemId: p._id, skuId: p.skuId, skuCode: p.skuCode, itemName: p.itemName, unit: p.unit,
        orderedQty: p.quantity, receivedQty: p.quantity, rate: p.rate, batchNo: lines[i].batchNo,
      })),
      totalReceivedQty: lines.reduce((t, l) => t + l.qty, 0),
      remarks: `${MARK} demo GRN for Cut Coils testing`,
    });
    await register('GoodsReceiptNote', grn._id);
  }
  // A DRAFT left by an interrupted run is completed now; complete() itself
  // refuses a second completion, so this cannot double the stock. Since
  // QC-gated posting the coil reaches stock when its Incoming QC completes.
  const done = await completeGrnThroughQc(grn._id, user, { rmReceivedAtLocation: g.at });
  return { grn: done, created: true };
};

/** Two approved circle sizes, ~91% yield, realistic piece counts. */
const circlesFor = (g, cutKg, skus) => {
  const map = COIL_CIRCLE_MAP[g.coil];
  const [a, b] = [map[0], map[Math.min(1, map.length - 1)]];
  const outKg = round2(cutKg * 0.91);
  const aKg = round2(outKg * 0.6);
  const bKg = round2(outKg - aKg);
  const rows = [{ c: a, kg: aKg }];
  if (b.code !== a.code) rows.push({ c: b, kg: bKg }); else rows[0].kg = outKg;
  return rows.map(({ c, kg }) => ({
    circleSkuId: String(skus[c.code]._id), sizeLabel: c.clientLabel, pcs: Math.max(1, Math.round(kg / 0.32)), weightKg: kg,
  }));
};

const ensureCuts = async (g, { user, skus }) => {
  if (!g.cuts.length) return [];
  const receipt = await InventoryMovement.findOne({ txnType: TXN_TYPE.GRN_IN, batchNo: g.batchNo, isDeleted: { $ne: true } }).lean();
  if (!receipt) throw new Error(`No GRN_IN for ${g.batchNo} — the GRN did not post.`);
  const out = [];
  for (let i = 0; i < g.cuts.length; i += 1) {
    const clientRequestId = `${REQ_PREFIX}${g.batchNo.toLowerCase()}-r${i + 1}`;
    // Checked first: a request key expires after seven days, and on a
    // standalone mongod a replay past that would post the cut's stock again
    // before the conversion's unique index refused it.
    const prior = await CoilConversion.findOne({ clientRequestId }).lean();
    if (prior) { out.push({ round: i + 1, conversionNumber: prior.conversionNumber, created: false }); continue; }
    const full = g.cuts[i] === 'FULL';
    let cutKg = Number(g.cuts[i]);
    if (full) cutKg = (await rmImsService.getCoilLineage(receipt._id)).totals.coil.availableKg;
    const payload = {
      clientRequestId,
      conversionDate: daysAgo(g.daysAgo - 1 - i * 2, 14),
      coilReceiptId: String(receipt._id),
      coilSkuId: String(receipt.skuId),
      coilWeightKg: cutKg,
      cuttingType: full ? 'FULL' : 'PARTIAL',
      warehouse: g.at,
      scrapVerified: i === 0 ? 'DONE' : 'PENDING',
      circles: circlesFor(g, cutKg, skus),
    };
    const { error, value } = rmConvertSchema.validate(payload, { stripUnknown: true });
    if (error) throw new Error(`Demo cut ${clientRequestId} fails the route's own validation: ${error.message}`);
    const saved = await rmImsService.convert(value, user);
    out.push({ round: i + 1, conversionNumber: saved.conversionNumber, created: true });
  }
  return out;
};

const ensureOpening = async ({ user, skus }) => {
  let created = 0;
  for (const o of DEMO_OPENING) {
    const clientRequestId = `${REQ_PREFIX}opening-${o.code.toLowerCase()}-${o.at.toLowerCase()}`;
    // Checked first, for the same reason as the cuts: request keys expire.
    if (await InventoryMovement.exists({ clientRequestId })) continue;
    await rmImsService.receive({
      clientRequestId, reason: 'OPENING_STOCK', warehouse: o.at, date: daysAgo(30),
      reference: `${MARK} opening stock — coils without a GRN (for Manual Entry testing)`,
      items: [{ skuId: skus[o.code]._id, quantity: o.kg, unitCost: 0, batchNo: '' }],
    }, user);
    created += 1;
  }
  return created;
};

const seed = async () => {
  await connect();
  const ctx = await ensureMasters();
  const openingCreated = await ensureOpening(ctx);
  const report = [];
  for (const g of DEMO_GRNS) {
    const { created } = await ensureGrn(g, ctx);
    const cuts = await ensureCuts(g, ctx);
    report.push({ grn: g.grnNumber, batch: g.batchNo, coil: g.coil, kg: g.kg, at: g.at, grnCreated: created, cuts });
  }
  console.log(JSON.stringify({
    ok: true, db: DB_NAME, user: { email: DEMO_USER.email, password: DEMO_USER.password }, openingCreated, report,
  }, null, 2));
  await mongoose.disconnect();
};

/* ══ --verify ══════════════════════════════════════════════════════════════ */

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

export const verifyDemo = async () => {
  const grns = await GoodsReceiptNote.find({ grnNumber: { $regex: '^DEMO-CTC-GRN-' } }).lean();
  check('8 demo GRNs exist', grns.length === DEMO_GRNS.length, `${grns.length}`);
  const dropdown = await rmImsService.listReceivedCoils({ grnOnly: true, circleMapped: true, limit: 100 });
  const listed = new Map(dropdown.docs.map((d) => [d.batchNo, d]));

  for (const g of DEMO_GRNS) {
    const grn = grns.find((x) => x.grnNumber === g.grnNumber);
    const line = grn?.items?.find((i) => i.batchNo === g.batchNo);
    const ins = await InventoryMovement.find({ txnType: TXN_TYPE.GRN_IN, batchNo: g.batchNo, isDeleted: { $ne: true } }).lean();
    const mov = ins[0];
    check(`${g.grnNumber}: completed & stock posted`,
      grn && grn.stockPosted === true && ['RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED'].includes(grn.grnStatus) && grn.addToRmStock === true,
      `${grn?.grnStatus} stockPosted=${grn?.stockPosted}`);
    check(`${g.grnNumber}: exactly one GRN_IN for ${g.batchNo}`, ins.length === 1, `${ins.length}`);
    check(`${g.grnNumber}: GRN line = movement (sku, batch, qty, rate, location)`,
      !!line && !!mov && mov.skuCode === g.coil && line.skuCode === g.coil && round2(mov.quantity) === g.kg && round2(line.receivedQty) === g.kg
      && round2(mov.unitCost) === g.rate && mov.warehouse === g.at && grn.rmReceivedAtLocation === g.at
      && String(mov.refId) === String(grn._id) && mov.refNumber === g.grnNumber,
      mov ? `${mov.skuCode} ${mov.quantity}kg ₹${mov.unitCost} @${mov.warehouse}` : 'no movement');
    if (!mov) continue;

    const lin = await rmImsService.getCoilLineage(mov._id);
    const cutKg = round2(lin.rounds.reduce((s, r) => s + r.cutKg, 0));
    check(`${g.batchNo}: lineage original weight = receipt (${g.kg} kg)`, lin.receipt.receivedWeightKg === g.kg, `${lin.receipt.receivedWeightKg}`);
    check(`${g.batchNo}: ${g.cuts.length} round(s), remaining = original − cut, ledger reconciles`,
      lin.rounds.length === g.cuts.length && lin.totals.coil.availableKg === round2(g.kg - cutKg) && lin.totals.reconciles === true,
      `rounds=${lin.rounds.length} cut=${cutKg} remaining=${lin.totals.coil.availableKg} status=${lin.totals.coil.status}`);
    const inList = listed.get(g.batchNo);
    if (lin.totals.coil.availableKg > 0.001) {
      check(`${g.batchNo}: offered in the GRN dropdown with the same figures`,
        !!inList && inList.receivedWeight === g.kg && inList.availableWeight === lin.totals.coil.availableKg && inList.grnNumber === g.grnNumber,
        inList ? `${inList.grnNumber} ${inList.receivedWeight}/${inList.availableWeight}` : 'missing');
    } else {
      check(`${g.batchNo}: fully cut — not offered in the GRN dropdown`, !inList, inList ? 'still listed' : 'excluded');
    }

    const convs = await CoilConversion.find({ coilReceiptId: mov._id, isDeleted: { $ne: true } }).lean();
    for (const c of convs) {
      const sr = await ScrapRecord.findOne({ conversionId: c._id }).lean();
      const out = await InventoryMovement.findOne({ _id: c.coilMovementId }).lean();
      const ins2 = await InventoryMovement.find({ refType: 'RM_CONVERSION', refNumber: c.conversionNumber, txnType: TXN_TYPE.CONVERT_IN }).lean();
      const scrapIn = await InventoryMovement.find({ refType: 'RM_CONVERSION', refNumber: c.conversionNumber, txnType: TXN_TYPE.SCRAP_IN }).lean();
      const wantScrapIn = sr?.location === 'PLG01' && c.scrapKg > 0;
      check(`${c.conversionNumber} (${g.batchNo}): CONVERT_OUT, circles, scrap record and scrap stock reconcile`,
        !!out && round2(out.quantity) === round2(c.coilWeightKg) && ins2.length === c.circles.length
        && !!sr && round2(sr.scrapKg) === round2(c.scrapKg) && String(sr.coilReceiptId) === String(mov._id)
        && round2(c.coilWeightKg - c.circlesWeightKg) === round2(c.scrapKg)
        && scrapIn.length === (wantScrapIn ? 1 : 0) && (!wantScrapIn || round2(scrapIn[0].quantity) === round2(c.scrapKg)),
        `cut ${c.coilWeightKg} circles ${c.circlesWeightKg} scrap ${c.scrapKg} @${sr?.location} scrapIn=${scrapIn.length}`);
    }
  }

  const consumableInDropdown = dropdown.docs.some((d) => !String(d.skuCode).startsWith('JSL'));
  check('No consumable receipt is offered in the GRN dropdown', !consumableInDropdown);

  // Every stock balance in this DB equals the sum of its movements.
  const sums = await InventoryMovement.aggregate([
    { $match: { isDeleted: { $ne: true } } },
    { $group: { _id: { s: '$skuId', w: '$warehouse' }, q: { $sum: '$qtyDelta' } } },
  ]);
  const stocks = await InventoryStock.find({}).lean();
  const bad = sums.filter((x) => {
    const st = stocks.find((s) => String(s.skuId) === String(x._id.s) && s.warehouse === x._id.w);
    return !st || Math.abs(round2(st.qtyOnHand) - round2(x.q)) > 0.01;
  });
  check('Every stock balance equals the sum of its movements', bad.length === 0, bad.length ? JSON.stringify(bad.slice(0, 3)) : `${sums.length} balances`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  return failed.length === 0;
};

const verify = async () => {
  await connect();
  const ok = await verifyDemo();
  await mongoose.disconnect();
  process.exit(ok ? 0 : 1);
};

/* ══ --dump ════════════════════════════════════════════════════════════════ */

const dump = async () => {
  await connect();
  const dropdown = await rmImsService.listReceivedCoils({ grnOnly: true, circleMapped: true, includeConsumed: true, limit: 100 });
  const by = new Map(dropdown.docs.map((d) => [d.batchNo, d]));
  console.log(JSON.stringify(DEMO_GRNS.map((g) => {
    const d = by.get(g.batchNo);
    return {
      grnNumber: g.grnNumber, batchNo: g.batchNo, coil: g.coil, item: nameOf(g.coil), receivedAt: g.at,
      originalKg: d?.receivedWeight ?? null, remainingKg: d?.availableWeight ?? null, rate: g.rate,
      supplier: `${g.supplier} (demo)`, rounds: g.cuts.length,
    };
  }), null, 2));
  await mongoose.disconnect();
};

/* ══ --reset ═══════════════════════════════════════════════════════════════ */

/**
 * Delete what this seed created — and anything recorded against its coils
 * (cuts made while testing them, their circles and scrap). Identified only by
 * the demo marker (GRN/PO numbers, DEMO-CTC- batch numbers, demo request ids)
 * and the seed's own registry of master records. Nothing else is touched.
 *
 * Stock balances are put back by reversing exactly the movements deleted, per
 * SKU and location — not recomputed — so a balance that also carries non-demo
 * movements keeps them.
 */
const reset = async () => {
  await connect();
  // Every GRN/PO numbered DEMO-CTC-… — the eight demo GRNs and the probe GRNs
  // the automated test raises (DEMO-CTC-T-GRN-…).
  const grns = await GoodsReceiptNote.find({ grnNumber: { $regex: '^DEMO-CTC-' } }).lean();
  const grnIds = grns.map((g) => g._id);
  const convs = await CoilConversion.find({ $or: [{ batchNo: BATCH_RX }, { clientRequestId: { $regex: `^${REQ_PREFIX}` } }] }).lean();
  const convIds = convs.map((c) => c._id);
  const movs = await InventoryMovement.find({
    $or: [
      { batchNo: BATCH_RX },
      { refType: 'GRN', refId: { $in: grnIds } },
      { clientRequestId: { $regex: `^${REQ_PREFIX}` } },
      { refType: 'RM_CONVERSION', refNumber: { $in: convs.map((c) => c.conversionNumber) } },
    ],
  }).lean();

  // Reverse the balances the deleted movements built.
  const delta = new Map();
  for (const m of movs) {
    const k = `${m.skuId}|${m.warehouse}`;
    const d = delta.get(k) || { skuId: m.skuId, warehouse: m.warehouse, q: 0, kg: 0 };
    d.q += Number(m.qtyDelta || 0);
    d.kg += Number(m.qtyKgDelta || 0);
    delta.set(k, d);
  }
  await InventoryMovement.deleteMany({ _id: { $in: movs.map((m) => m._id) } });
  let stockRowsRemoved = 0;
  for (const d of delta.values()) {
    await InventoryStock.updateOne({ skuId: d.skuId, warehouse: d.warehouse }, { $inc: { qtyOnHand: -round2(d.q), qtyOnHandKg: -round2(d.kg) } });
    const left = await InventoryMovement.exists({ skuId: d.skuId, warehouse: d.warehouse });
    if (!left) { await InventoryStock.deleteOne({ skuId: d.skuId, warehouse: d.warehouse }); stockRowsRemoved += 1; }
  }

  const scrap = await ScrapRecord.deleteMany({ $or: [{ batchNo: BATCH_RX }, { conversionId: { $in: convIds } }] });
  const conv = await CoilConversion.deleteMany({ _id: { $in: convIds } });
  const manual = await ManualCoil.deleteMany({ batchKey: BATCH_RX });
  const keys = await InventoryRequestKey.deleteMany({
    $or: [{ _id: { $regex: `^${REQ_PREFIX}` } }, { _id: { $in: convs.map((c) => c.clientRequestId).filter(Boolean) } }],
  });
  const approvals = await DocumentApproval.deleteMany({ documentType: 'GRN', documentId: { $in: grnIds } });
  let pdfs = 0;
  for (const g of grns) {
    for (const url of [g.grnPdfUrl].filter(Boolean)) {
      const m = String(url).match(/\/uploads\/(grns\/[^?#]+)$/);
      const fp = m ? path.join(UPLOADS, m[1]) : null;
      if (fp && fp.startsWith(UPLOADS) && fs.existsSync(fp)) { fs.unlinkSync(fp); pdfs += 1; }
    }
  }
  const grnDel = await GoodsReceiptNote.deleteMany({ _id: { $in: grnIds } });
  const poDel = await VendorPurchaseOrder.deleteMany({ poNumber: { $regex: '^DEMO-CTC-' } });

  // Master records the seed itself created, only where nothing else uses them.
  const reg = await registry().find({ seed: MARK }).toArray();
  let mastersRemoved = 0;
  for (const r of reg.filter((x) => x.model === 'SKU')) {
    const id = new mongoose.Types.ObjectId(r.id);
    const used = await InventoryMovement.exists({ skuId: id }) || await CoilConversion.exists({ coilSkuId: id })
      || await ManualCoil.exists({ coilSkuId: id }) || await InventoryStock.exists({ skuId: id });
    if (!used) { await SKU.deleteOne({ _id: id }); await registry().deleteOne({ _id: r._id }); mastersRemoved += 1; }
  }
  for (const r of reg.filter((x) => x.model === 'User')) {
    await User.deleteOne({ _id: new mongoose.Types.ObjectId(r.id), email: DEMO_USER.email });
    await registry().deleteOne({ _id: r._id }); mastersRemoved += 1;
  }
  await registry().deleteMany({ seed: MARK, model: { $in: ['GoodsReceiptNote', 'VendorPurchaseOrder'] } });

  console.log(JSON.stringify({
    ok: true, db: DB_NAME,
    deleted: {
      grns: grnDel.deletedCount, purchaseOrders: poDel.deletedCount, movements: movs.length, conversions: conv.deletedCount,
      scrapRecords: scrap.deletedCount, manualCoils: manual.deletedCount, requestKeys: keys.deletedCount,
      approvals: approvals.deletedCount, pdfFiles: pdfs, stockRowsRemoved, masterRecords: mastersRemoved,
    },
  }, null, 2));
  await mongoose.disconnect();
};

if (isEntry(import.meta.url)) {
  const cmd = process.argv.find((a) => ['--seed', '--verify', '--dump', '--reset'].includes(a));
  const run = { '--seed': seed, '--verify': verify, '--dump': dump, '--reset': reset }[cmd];
  if (!run) {
    console.error('Usage: node src/scripts/seedCoilToCircleDemo.js --seed | --verify | --dump | --reset [--db=ambika_e2e_ctc_test]');
    process.exit(1);
  }
  run().catch(async (e) => {
    console.error(e);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
