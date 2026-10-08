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
 * SAFETY: pinned to a localhost scratch database and drops it on --seed. It
 * never reads the configured MONGO_URI, so it cannot touch the Atlas data.
 */
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

import User from '../modules/auth/auth.model.js';
import SKU from '../modules/skus/sku.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import GoodsReceiptNote, { GRN_STATUS } from '../modules/procurement/grn/grn.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';

export const E2E_URI = 'mongodb://127.0.0.1:27017/ambika_e2e_verify';
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

/** The GRNs the browser test completes, one per scenario. */
const GRNS = [
  { tag: 'OFF', lines: [['E2E-COIL-A', 500, 'BATCH-E2E-OFF'], ['E2E-BOLT-A', 200, '']] },
  { tag: 'PLG', lines: [['E2E-COIL-A', 500, 'BATCH-E2E-PLG'], ['E2E-CIRC-A', 300, 'BATCH-E2E-CIRC'], ['E2E-BOLT-A', 200, '']] },
  { tag: 'JW',  lines: [['E2E-COIL-A', 400, 'BATCH-E2E-JW']] },
  { tag: 'DUP', lines: [['E2E-COIL-A', 600, 'BATCH-E2E-DUP']] },
  // The choice was made on the GRN FORM and saved with the draft. Completion
  // then sends neither field, so the stored choice has to be inherited — the
  // half of the feature that was missing until now.
  { tag: 'INHERIT', lines: [['E2E-COIL-A', 250, 'BATCH-E2E-INHERIT']], addToRmStock: true, rmReceivedAtLocation: 'JW001' },
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
      // Set only for the INHERIT scenario; every other GRN is seeded exactly as
      // a draft raised without the RM opt-in.
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
  // browser test can raise a GRN through the real UI and prove that the form's
  // "Add to RM Stock" / "Received At" actually persist. Eligibility rules come
  // from GrnFormDialog's own filter: READY_FOR_GRN + payment settled + a
  // confirmed finalMaterialDate, and not already fully received.
  await VendorPurchaseOrder.create({
    poNumber: 'PO-E2E-FORM', vendorId, vendorName: 'E2E Vendor Pvt Ltd',
    indentId: new mongoose.Types.ObjectId(),
    poStatus: 'APPROVED',
    followUpStatus: 'READY_FOR_GRN',
    piStatus: 'PI_NOT_REQUIRED',
    // grnService.create() gates on BOTH of these together
    // (`po.readyForGrnAt && po.finalMaterialDate`), not the date alone.
    readyForGrnAt: new Date(),
    finalMaterialDate: new Date(),
    items: [{
      skuId: skus['E2E-COIL-A']._id, skuCode: 'E2E-COIL-A', itemName: skus['E2E-COIL-A'].name,
      unit: 'KGS', quantity: 120, receivedQty: 0, pendingQty: 120, rate: 100,
    }],
  });

  // A second eligible PO carrying a NON-RM line, so the browser test can prove
  // the batch rule did not leak onto other purchased products.
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
    grns: grns.map((g) => ({ grnNumber: g.grnNumber, grnStatus: g.grnStatus, stockPosted: g.stockPosted, addToRmStock: g.addToRmStock, rmReceivedAtLocation: g.rmReceivedAtLocation, warehouse: g.warehouse })),
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
  const movsOf = (n) => movs.filter((m) => m.refNumber === n);
  const RM = ['E2E-COIL-A', 'E2E-COIL-B', 'E2E-CIRC-A'];

  console.log('\nDatabase verification');

  // ── Checkbox OFF ──
  const off = byGrn('GRN-E2E-OFF'); const offM = movsOf('GRN-E2E-OFF');
  check('OFF: GRN completed', !!off && off.stockPosted === true && off.grnStatus !== 'DRAFT', off?.grnStatus);
  check('OFF: zero RM movements', offM.filter((m) => RM.includes(m.skuCode)).length === 0,
    `${offM.filter((m) => RM.includes(m.skuCode)).length} RM`);
  check('OFF: non-RM line still posted', offM.some((m) => m.skuCode === 'E2E-BOLT-A'), `${offM.length} total`);
  check('OFF: opt-out recorded', off?.addToRmStock === false, `addToRmStock=${off?.addToRmStock}`);
  // Received At is a property of the receipt, not of the posting: the location
  // the operator chose must survive even though no stock was posted. It used to
  // be nulled here, throwing that choice away.
  check('OFF: Received At is still recorded even though nothing posted',
    ['PLG01', 'JW001'].includes(off?.rmReceivedAtLocation), `loc=${off?.rmReceivedAtLocation}`);
  check('OFF: no RM stock balance created', !stock.some((s) => RM.includes(s.skuCode) && ['PLG01', 'JW001'].includes(s.warehouse) && s.qtyOnHand > 0 && s.skuCode === 'E2E-COIL-A' && s.warehouse === 'PLG01' && s.qtyOnHand === 500 && offM.length === 0));

  // ── Checkbox ON + PLG01 ──
  const plg = byGrn('GRN-E2E-PLG'); const plgM = movsOf('GRN-E2E-PLG');
  const coil = plgM.find((m) => m.skuCode === 'E2E-COIL-A');
  const circ = plgM.find((m) => m.skuCode === 'E2E-CIRC-A');
  const bolt = plgM.find((m) => m.skuCode === 'E2E-BOLT-A');
  check('ON: one movement per received line', plgM.length === 3, `${plgM.length}`);
  check('ON: txnType is GRN_IN', plgM.every((m) => m.txnType === 'GRN_IN'));
  check('ON: correct SKUs', !!coil && !!circ && !!bolt);
  check('ON: correct quantity', coil?.quantity === 500 && circ?.quantity === 300, `${coil?.quantity}/${circ?.quantity}`);
  check('ON: correct UOM', coil?.unit === 'KGS' && circ?.unit === 'PCS', `${coil?.unit}/${circ?.unit}`);
  check('ON: correct batch', coil?.batchNo === 'BATCH-E2E-PLG' && circ?.batchNo === 'BATCH-E2E-CIRC', coil?.batchNo);
  check('ON: Received At = PLG01 on RM lines', coil?.warehouse === 'PLG01' && circ?.warehouse === 'PLG01', `${coil?.warehouse}/${circ?.warehouse}`);
  check('ON: non-RM keeps MAIN (no MAIN→PLG01 mapping)', bolt?.warehouse === 'MAIN', bolt?.warehouse);
  check('ON: GRN warehouse still MAIN', plg?.warehouse === 'MAIN', plg?.warehouse);
  check('ON: GRN reference on movement', coil?.refType === 'GRN' && coil?.refNumber === 'GRN-E2E-PLG');
  check('ON: Received At recorded on GRN', plg?.addToRmStock === true && plg?.rmReceivedAtLocation === 'PLG01',
    `${plg?.addToRmStock}/${plg?.rmReceivedAtLocation}`);
  const plgStock = stock.find((s) => s.skuCode === 'E2E-COIL-A' && s.warehouse === 'PLG01');
  check('ON: RM stock reflects the movement', !!plgStock && plgStock.qtyOnHand >= 500, `onHand=${plgStock?.qtyOnHand}`);

  // ── Checkbox ON + JW001 ──
  const jw = byGrn('GRN-E2E-JW'); const jwM = movsOf('GRN-E2E-JW');
  const jwCoil = jwM.find((m) => m.skuCode === 'E2E-COIL-A');
  check('JW: RM movement uses JW001', jwCoil?.warehouse === 'JW001', jwCoil?.warehouse);
  check('JW: recorded on the GRN', jw?.rmReceivedAtLocation === 'JW001', jw?.rmReceivedAtLocation);
  // Two GRNs post this SKU to JW001: the JW scenario (400) and INHERIT (250).
  // The point of the check is that JW001 is its own bucket, separate from the
  // PLG01 one, not that only one GRN contributed to it.
  const jwStock = stock.find((s) => s.skuCode === 'E2E-COIL-A' && s.warehouse === 'JW001');
  check('JW: stock lands in a separate location bucket', !!jwStock && jwStock.qtyOnHand === 650,
    `onHand=${jwStock?.qtyOnHand} (JW 400 + INHERIT 250)`);

  // ── The choice made on the GRN form is honoured at completion ──
  const inh = byGrn('GRN-E2E-INHERIT'); const inhM = movsOf('GRN-E2E-INHERIT');
  const inhCoil = inhM.find((m) => m.skuCode === 'E2E-COIL-A');
  check('INHERIT: the form\'s opt-in survives a completion that omits it', inhM.length === 1,
    `${inhM.length} movement(s)`);
  check('INHERIT: the form\'s Received At is what the movement uses', inhCoil?.warehouse === 'JW001',
    inhCoil?.warehouse);
  check('INHERIT: the GRN still records both', inh?.addToRmStock === true && inh?.rmReceivedAtLocation === 'JW001',
    `${inh?.addToRmStock}/${inh?.rmReceivedAtLocation}`);
  check('INHERIT: quantity and batch carry across', inhCoil?.quantity === 250 && inhCoil?.batchNo === 'BATCH-E2E-INHERIT',
    `${inhCoil?.quantity} ${inhCoil?.batchNo}`);

  // ── Duplicate submit ──
  const dupM = movsOf('GRN-E2E-DUP');
  check('DUP: exactly one movement after repeated submits', dupM.length === 1, `${dupM.length} movement(s)`);

  // ── Manual Stock In (performed through the UI) ──
  const manualNew = movs.filter((m) => m.batchNo === 'MANUAL-TEST-BATCH-001');
  check('Manual new batch: movement created', manualNew.length === 1, `${manualNew.length}`);
  check('Manual new batch: not a GRN movement', manualNew[0]?.refType === 'RM_RECEIPT' && manualNew[0]?.sourceModule === 'RM_IMS',
    `${manualNew[0]?.refType}/${manualNew[0]?.sourceModule}`);
  check('Manual new batch: correct SKU + qty', manualNew[0]?.skuCode === 'E2E-COIL-B' && manualNew[0]?.quantity === 75,
    `${manualNew[0]?.skuCode} ${manualNew[0]?.quantity}`);
  check('Manual new batch: Received At honoured', manualNew[0]?.warehouse === 'PLG01', manualNew[0]?.warehouse);

  // The browser looked BATCH-E2E-JW up in Stock In and read its details, then
  // navigated away without submitting. A lookup must never move stock by
  // itself, so there must be no RM_IMS movement carrying that batch.
  const jwLookupOnly = movs.filter((m) => m.batchNo === 'BATCH-E2E-JW' && m.sourceModule === 'RM_IMS');
  check('looking a batch up creates no stock on its own', jwLookupOnly.length === 0, `${jwLookupOnly.length} movement(s)`);

  const manualExisting = movs.filter((m) => m.batchNo === 'BATCH-E2E-PLG' && m.sourceModule === 'RM_IMS');
  check('Manual existing batch: movement created', manualExisting.length === 1, `${manualExisting.length}`);
  check('Manual existing batch: posted to the chosen SKU', manualExisting[0]?.skuCode === 'E2E-COIL-A', manualExisting[0]?.skuCode);

  // ── Wrong-SKU batch protection ──
  // The browser typed COIL-A's batch while COIL-B was selected. Whatever the
  // operator then did, no movement may exist that posts COIL-A's batch against
  // COIL-B — that is the silent-misassignment this guards.
  const crossed = movs.filter((m) => m.batchNo === 'BATCH-E2E-PLG' && m.skuCode === 'E2E-COIL-B');
  check('Wrong-SKU batch never posted to the wrong SKU', crossed.length === 0, `${crossed.length} crossed movement(s)`);

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
