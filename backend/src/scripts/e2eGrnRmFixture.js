/**
 * Fixture + database oracle for the GRN → RM Stock browser test.
 *
 *   node src/scripts/e2eGrnRmFixture.js --seed     fresh scratch DB + test data
 *   node src/scripts/e2eGrnRmFixture.js --verify   assert the final DB state
 *   node src/scripts/e2eGrnRmFixture.js --dump     print current state as JSON
 *
 * Pairs with frontend/e2e/grnRm.e2e.mjs, which drives the real UI in Chromium.
 * The browser performs every action; this file is the independent check on what
 * actually landed in the database, so no result rests on a success toast.
 *
 * Raw Material lines route to RM IMS automatically (from the SKU's Item Type)
 * at the GRN's "Received At", which has to be chosen — there is no default and
 * no manual Inventory Type. Nothing is stocked when the GRN is completed: the
 * ACCEPTED qty posts when the GRN's Incoming QC completes (no MD signature needed first).
 *
 * SAFETY: pinned to a localhost scratch database and drops it on --seed. It
 * never reads the configured MONGO_URI, so it cannot touch the Atlas data.
 */
import mongoose from 'mongoose';
import { assertE2ESafe, isEntry } from './e2eSafety.js';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote, { GRN_STATUS } from '../modules/procurement/grn/grn.model.js';
import IncomingQC from '../modules/procurement/incoming-qc/incomingQc.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import ManualCoil from '../modules/inventory/manualCoil.model.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_verify';
// Local scratch DB, S3 off, email off — or stop before anything connects.
// Only when RUN as a script: unit tests import pure data from some fixtures.
if (isEntry(import.meta.url)) assertE2ESafe(E2E_URI, 'e2eGrnRmFixture.js');
export const E2E_USER = { email: 'e2e@test.local', password: 'E2e@12345', name: 'E2E Runner', role: 'MD' };

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(E2E_URI)) {
  console.error('Refusing to run: fixture must target localhost.');
  process.exit(1);
}

const SKUS = [
  { code: 'E2E-COIL-A', name: 'E2E Coil A 1250mm', unit: 'KGS', itemType: 'RAW_MATERIAL' },
  { code: 'E2E-COIL-B', name: 'E2E Coil B 1000mm', unit: 'KGS', itemType: 'RAW_MATERIAL' },
  { code: 'E2E-CIRC-A', name: 'E2E Circle A 180mm', unit: 'PCS', itemType: 'CIRCLE' },
  { code: 'E2E-BOLT-A', name: 'E2E Bolt M8', unit: 'PCS', itemType: 'CONSUMABLE' },
];

/** The draft GRNs the browser test completes, one per scenario. */
const GRNS = [
  // A draft from before automatic routing: a coil and a bolt together, no
  // Received At. Mixed GRNs are now routed line by line; Received At must be
  // chosen at completion (never defaulted).
  { tag: 'MIXED', lines: [['E2E-COIL-A', 500, 'BATCH-E2E-MIX'], ['E2E-BOLT-A', 200, '']] },
  // Raw Material only (coil + circle), Received At PLG01 saved on the draft.
  { tag: 'PLG', lines: [['E2E-COIL-A', 500, 'BATCH-E2E-PLG'], ['E2E-CIRC-A', 300, 'BATCH-E2E-CIRC']], rmReceivedAtLocation: 'PLG01' },
  { tag: 'JW',  lines: [['E2E-COIL-A', 400, 'BATCH-E2E-JW']], rmReceivedAtLocation: 'JW001' },
  { tag: 'DUP', lines: [['E2E-COIL-A', 600, 'BATCH-E2E-DUP']], rmReceivedAtLocation: 'PLG01' },
  // Saved with the old manual Inventory Type + Received At JW001: completion
  // inherits the location, ignores the retired type — and its QC is left OPEN,
  // so its coil is Awaiting QC for the rest of the run.
  { tag: 'INHERIT', lines: [['E2E-COIL-A', 250, 'BATCH-E2E-INHERIT']], inventoryType: 'RM', addToRmStock: true, rmReceivedAtLocation: 'JW001' },
];

const connect = async () => {
  await mongoose.connect(E2E_URI, { serverSelectionTimeoutMS: 5000 });
  if (!/ambika_e2e_verify$/.test(mongoose.connection.name ? `x/${mongoose.connection.name}` : E2E_URI)) {
    throw new Error('Connected to an unexpected database — aborting.');
  }
};

const seed = async () => {
  await connect();
  await mongoose.connection.dropDatabase();

  await User.create({
    ...E2E_USER,
    password: E2E_USER.password, // hashed by the model's pre-save hook
    mobile: '9000000001',
    isActive: true,
    roles: ['MD'],
  });

  const skus = {};
  for (const s of SKUS) skus[s.code] = await SKU.create(s);

  const vendorId = new mongoose.Types.ObjectId();
  const out = {};
  for (const g of GRNS) {
    const items = g.lines.map(([code, qty]) => ({
      skuId: skus[code]._id, skuCode: code, itemName: skus[code].name, unit: skus[code].unit,
      quantity: qty, receivedQty: 0, pendingQty: qty, rate: 100,
    }));
    const po = await VendorPurchaseOrder.create({
      poNumber: `PO-E2E-${g.tag}`, vendorId, vendorName: 'E2E Vendor Pvt Ltd',
      indentId: new mongoose.Types.ObjectId(), items, poStatus: 'APPROVED',
    });
    const grn = await GoodsReceiptNote.create({
      grnNumber: `GRN-E2E-${g.tag}`, poId: po._id, poNumber: po.poNumber,
      vendorId, vendorName: 'E2E Vendor Pvt Ltd',
      warehouse: 'MAIN', // the GRN's own store — must never become a Received At
      inventoryType: g.inventoryType || null,
      addToRmStock: !!g.addToRmStock,
      rmReceivedAtLocation: g.rmReceivedAtLocation || null,
      grnStatus: GRN_STATUS.DRAFT, stockPosted: false,
      items: po.items.map((p, i) => ({
        poItemId: p._id, skuId: p.skuId, skuCode: p.skuCode, itemName: p.itemName, unit: p.unit,
        orderedQty: p.quantity, receivedQty: p.quantity, rate: p.rate,
        batchNo: g.lines[i][2],
      })),
      totalReceivedQty: g.lines.reduce((t, l) => t + l[1], 0),
    });
    out[g.tag] = String(grn._id);
  }

  // A PO with NO GRN against it, eligible for the GRN form's picker, so the
  // browser raises a GRN through the real UI. Eligibility: READY_FOR_GRN + PI
  // settled + a confirmed finalMaterialDate, and not already fully received.
  await VendorPurchaseOrder.create({
    poNumber: 'PO-E2E-FORM', vendorId, vendorName: 'E2E Vendor Pvt Ltd',
    indentId: new mongoose.Types.ObjectId(),
    poStatus: 'APPROVED',
    followUpStatus: 'READY_FOR_GRN',
    piStatus: 'PI_NOT_REQUIRED',
    // grnService.create() gates on BOTH of these together.
    readyForGrnAt: new Date(),
    finalMaterialDate: new Date(),
    items: [{
      skuId: skus['E2E-COIL-A']._id, skuCode: 'E2E-COIL-A', itemName: skus['E2E-COIL-A'].name,
      unit: 'KGS', quantity: 120, receivedQty: 0, pendingQty: 120, rate: 100,
    }],
  });

  // A second eligible PO carrying a NON-RM line, so the browser test can prove
  // the batch rule and Received At did not leak onto other purchased products.
  await VendorPurchaseOrder.create({
    poNumber: 'PO-E2E-OTHER', vendorId, vendorName: 'E2E Vendor Pvt Ltd',
    indentId: new mongoose.Types.ObjectId(),
    poStatus: 'APPROVED',
    followUpStatus: 'READY_FOR_GRN',
    piStatus: 'PI_NOT_REQUIRED',
    readyForGrnAt: new Date(),
    finalMaterialDate: new Date(),
    items: [{
      skuId: skus['E2E-BOLT-A']._id, skuCode: 'E2E-BOLT-A', itemName: skus['E2E-BOLT-A'].name,
      unit: 'PCS', quantity: 40, receivedQty: 0, pendingQty: 40, rate: 5,
    }],
  });

  console.log(JSON.stringify({ ok: true, grnIds: out, user: E2E_USER }, null, 2));
  await mongoose.disconnect();
};

const state = async () => {
  const grns = await GoodsReceiptNote.find({}).lean();
  const movs = await InventoryMovement.find({}).lean();
  const stock = await InventoryStock.find({}).lean();
  return { grns, movs, stock };
};

const dump = async () => {
  await connect();
  const { grns, movs, stock } = await state();
  console.log(JSON.stringify({
    grns: grns.map((g) => ({ grnNumber: g.grnNumber, grnStatus: g.grnStatus, stage: g.stockPostingStage, approval: g.approvalStatus, qc: g.qcStatus, rmReceivedAtLocation: g.rmReceivedAtLocation, lines: g.items.map((l) => `${l.skuCode}:${l.stockStatus}`) })),
    movs: movs.map((m) => ({ skuCode: m.skuCode, txnType: m.txnType, qty: m.quantity, unit: m.unit, wh: m.warehouse, batch: m.batchNo, ref: m.refNumber, refType: m.refType, src: m.sourceModule })),
    stock: stock.map((s) => ({ skuCode: s.skuCode, wh: s.warehouse, onHand: s.qtyOnHand })),
  }, null, 2));
  await mongoose.disconnect();
};

// ── The oracle ───────────────────────────────────────────────────────────────
const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const verify = async () => {
  await connect();
  const { grns, movs, stock } = await state();
  const byGrn = (n) => grns.find((g) => g.grnNumber === n);
  const movsOf = (n) => movs.filter((m) => m.refNumber === n && m.refType === 'GRN');
  const qcOf = async (g) => (g ? IncomingQC.findOne({ grnId: g._id, qcStatus: { $ne: 'CANCELLED' } }).lean() : null);
  const datedAtQc = (list, qc) => !!qc && list.every((m) => Math.abs(new Date(m.movementDate) - new Date(qc.completedAt)) < 5);

  console.log('\nDatabase verification');

  // ── Mixed coil + bolt: routed line by line, Received At chosen at completion ──
  const mix = byGrn('GRN-E2E-MIXED'); const mixM = movsOf('GRN-E2E-MIXED');
  const mixCoil = mixM.find((m) => m.skuCode === 'E2E-COIL-A');
  const mixBolt = mixM.find((m) => m.skuCode === 'E2E-BOLT-A');
  check('MIXED: one GRN, completed, QC-gated — no separate GRN per type', mix?.stockPostingStage === 'QC_COMPLETION' && mix?.grnStatus !== 'DRAFT', mix?.grnStatus);
  check('MIXED: Received At recorded as chosen at completion (PLG01)', mix?.rmReceivedAtLocation === 'PLG01', mix?.rmReceivedAtLocation);
  check('MIXED: coil → RM IMS at PLG01 with its batch; bolt → MAIN', mixM.length === 2 && mixCoil?.warehouse === 'PLG01' && mixCoil?.batchNo === 'BATCH-E2E-MIX'
    && mixCoil?.quantity === 500 && mixBolt?.warehouse === 'MAIN' && mixBolt?.quantity === 200,
  mixM.map((m) => `${m.skuCode}:${m.quantity}@${m.warehouse}`).join(','));

  // ── RM coil + circle at PLG01 ──
  const plg = byGrn('GRN-E2E-PLG'); const plgM = movsOf('GRN-E2E-PLG'); const plgQc = await qcOf(plg);
  const coil = plgM.find((m) => m.skuCode === 'E2E-COIL-A');
  const circ = plgM.find((m) => m.skuCode === 'E2E-CIRC-A');
  check('PLG: one movement per received line, both GRN_IN', plgM.length === 2 && plgM.every((m) => m.txnType === 'GRN_IN'), `${plgM.length}`);
  check('PLG: only the accepted qty — coil 500, circle 280 (20 rejected never stocked)', coil?.quantity === 500 && circ?.quantity === 280, `${coil?.quantity}/${circ?.quantity}`);
  check('PLG: correct UOM', coil?.unit === 'KGS' && circ?.unit === 'PCS', `${coil?.unit}/${circ?.unit}`);
  check('PLG: correct batch', coil?.batchNo === 'BATCH-E2E-PLG' && circ?.batchNo === 'BATCH-E2E-CIRC', coil?.batchNo);
  check('PLG: Received At = PLG01 on RM lines', coil?.warehouse === 'PLG01' && circ?.warehouse === 'PLG01', `${coil?.warehouse}/${circ?.warehouse}`);
  check('PLG: GRN warehouse still MAIN', plg?.warehouse === 'MAIN', plg?.warehouse);
  check('PLG: GRN reference on movement', coil?.refType === 'GRN' && coil?.refNumber === 'GRN-E2E-PLG');
  check('PLG: dated at QC completion (QC PARTIAL)', plgQc?.qcStatus === 'PARTIAL' && datedAtQc(plgM, plgQc));
  check('PLG: no rejected-qty stock-out (rejected never entered stock)', !movs.some((m) => m.txnType === 'QC_REJECT_OUT'));
  check('PLG: no manual Inventory Type stored', plg?.inventoryType === null && plg?.addToRmStock === true);

  // ── JW001 ──
  const jw = byGrn('GRN-E2E-JW'); const jwM = movsOf('GRN-E2E-JW');
  check('JW: RM movement uses JW001 (400)', jwM.length === 1 && jwM[0].warehouse === 'JW001' && jwM[0].quantity === 400, jwM.map((m) => `${m.quantity}@${m.warehouse}`).join(','));
  check('JW: recorded on the GRN', jw?.rmReceivedAtLocation === 'JW001', jw?.rmReceivedAtLocation);
  // INHERIT is also at JW001, but its QC is still open — nothing of it is stock.
  const jwStock = stock.find((s) => s.skuCode === 'E2E-COIL-A' && s.warehouse === 'JW001');
  check('JW001 bucket holds JW only (400) — the INHERIT coil awaiting QC is not stock', !!jwStock && jwStock.qtyOnHand === 400, `onHand=${jwStock?.qtyOnHand}`);

  // ── INHERIT: completion inherits Received At; QC left open → Awaiting QC ──
  const inh = byGrn('GRN-E2E-INHERIT'); const inhM = movsOf('GRN-E2E-INHERIT');
  check('INHERIT: completed with the draft\'s Received At JW001, retired type cleared', inh?.grnStatus !== 'DRAFT' && inh?.rmReceivedAtLocation === 'JW001' && inh?.inventoryType === null,
    `${inh?.grnStatus}/${inh?.rmReceivedAtLocation}/${inh?.inventoryType}`);
  check('INHERIT: no stock — its line is AWAITING_QC', inhM.length === 0 && inh?.items?.[0]?.stockStatus === 'AWAITING_QC'
    && inh?.items?.[0]?.stockWarehouse === 'JW001', `${inhM.length} mov · ${inh?.items?.[0]?.stockStatus}`);
  const { awaitingQcBySku } = await import('../modules/inventory/awaitingQc.service.js');
  const coilSku = await SKU.findOne({ code: 'E2E-COIL-A' }).lean();
  const aw = (await awaitingQcBySku([coilSku._id])).get(String(coilSku._id));
  check('INHERIT: reported as Awaiting QC (250, GRN-E2E-INHERIT)', aw?.qty === 250 && aw?.grnNumbers?.includes('GRN-E2E-INHERIT'), JSON.stringify(aw));
  const inhRmIms = movs.filter((m) => m.batchNo === 'BATCH-E2E-INHERIT');
  check('INHERIT: the Stock In attempt with its batch was refused — no movement carries it', inhRmIms.length === 0, `${inhRmIms.length}`);
  check('INHERIT: no manual coil was created for it in Cut Coils', !(await ManualCoil.exists({ batchNo: 'BATCH-E2E-INHERIT' })));

  // ── Duplicate submits ──
  const dupM = movsOf('GRN-E2E-DUP');
  const dup = byGrn('GRN-E2E-DUP');
  const dupPo = await VendorPurchaseOrder.findOne({ poNumber: 'PO-E2E-DUP' }).lean();
  check('DUP: exactly one movement after double-clicked Complete GRN and Complete QC', dupM.length === 1 && dupM[0].quantity === 600, `${dupM.length} movement(s)`);
  check('DUP: one COMPLETE on the GRN, PO received once (600)', dup?.activityTimeline?.filter((t) => t.action === 'COMPLETE').length === 1 && dupPo?.items?.[0]?.receivedQty === 600);

  // ── GRNs raised through the form ──
  const formGrns = grns.filter((g) => g.poNumber === 'PO-E2E-FORM');
  check('FORM: one coil GRN saved with Received At JW001, no manual Inventory Type',
    formGrns.length === 1 && formGrns[0].rmReceivedAtLocation === 'JW001' && formGrns[0].inventoryType === null && formGrns[0].items?.[0]?.inventoryDestination === 'RM_IMS',
    JSON.stringify(formGrns.map((g) => [g.rmReceivedAtLocation, g.inventoryType, g.items?.[0]?.inventoryDestination])));
  const otherGrn = grns.find((g) => g.poNumber === 'PO-E2E-OTHER');
  check('OTHER: bolt GRN saved, routed to C&P IMS, no RM location', otherGrn?.rmReceivedAtLocation === null && otherGrn?.items?.[0]?.inventoryDestination === 'CP_IMS',
    `${otherGrn?.rmReceivedAtLocation}/${otherGrn?.items?.[0]?.inventoryDestination}`);

  // ── Manual Stock In (performed through the UI) ──
  const manualNew = movs.filter((m) => m.batchNo === 'MANUAL-TEST-BATCH-001');
  check('Manual new batch: movement created', manualNew.length === 1, `${manualNew.length}`);
  check('Manual new batch: not a GRN movement', manualNew[0]?.refType === 'RM_RECEIPT' && manualNew[0]?.sourceModule === 'RM_IMS',
    `${manualNew[0]?.refType}/${manualNew[0]?.sourceModule}`);
  check('Manual new batch: correct SKU + qty', manualNew[0]?.skuCode === 'E2E-COIL-B' && manualNew[0]?.quantity === 75,
    `${manualNew[0]?.skuCode} ${manualNew[0]?.quantity}`);
  check('Manual new batch: Received At honoured', manualNew[0]?.warehouse === 'PLG01', manualNew[0]?.warehouse);

  // The browser looked BATCH-E2E-JW up in Stock In and read its details, then
  // navigated away without submitting. A lookup must never move stock by itself.
  const jwLookupOnly = movs.filter((m) => m.batchNo === 'BATCH-E2E-JW' && m.sourceModule === 'RM_IMS');
  check('looking a batch up creates no stock on its own', jwLookupOnly.length === 0, `${jwLookupOnly.length} movement(s)`);

  const manualExisting = movs.filter((m) => m.batchNo === 'BATCH-E2E-PLG' && m.sourceModule === 'RM_IMS');
  check('Manual existing (QC-posted) batch: movement created', manualExisting.length === 1, `${manualExisting.length}`);
  check('Manual existing batch: posted to the chosen SKU', manualExisting[0]?.skuCode === 'E2E-COIL-A', manualExisting[0]?.skuCode);

  // ── Wrong-SKU batch protection ──
  const crossed = movs.filter((m) => m.batchNo === 'BATCH-E2E-PLG' && m.skuCode === 'E2E-COIL-B');
  check('Wrong-SKU batch never posted to the wrong SKU', crossed.length === 0, `${crossed.length} crossed movement(s)`);

  // ── Ledger ──
  const sums = new Map();
  for (const m of movs) sums.set(`${m.skuId}|${m.warehouse}`, Math.round(((sums.get(`${m.skuId}|${m.warehouse}`) || 0) + m.qtyDelta) * 100) / 100);
  const bad = stock.filter((s) => Math.round(s.qtyOnHand * 100) / 100 !== (sums.get(`${s.skuId}|${s.warehouse}`) || 0));
  check('every stock balance equals the sum of its movements', bad.length === 0, bad.map((s) => `${s.skuCode}@${s.warehouse}`).join(','));

  console.log('\n────────────────────────────────────────');
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} database checks passed`);
  failed.forEach((f) => console.log(`  FAILED: ${f.name} — ${f.detail}`));
  await mongoose.disconnect();
  process.exit(failed.length ? 1 : 0);
};

const mode = process.argv[2];
const run = mode === '--seed' ? seed : mode === '--verify' ? verify : mode === '--dump' ? dump : null;
if (!run) { console.error('Usage: --seed | --verify | --dump'); process.exit(1); }
run().catch(async (e) => {
  console.error('Fixture failed:', e.message);
  console.error(e.stack);
  try { await mongoose.disconnect(); } catch { /* already down */ }
  process.exit(1);
});
