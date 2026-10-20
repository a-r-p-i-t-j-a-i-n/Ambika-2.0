/**
 * Verify GRN → RM stock end to end, against a REAL database.
 *
 *   node src/scripts/verifyGrnRmStock.js          (npm run verify:grn-rm)
 *
 * Follows the verify:scrap convention: a throwaway scratch database, seeded,
 * exercised through the real service, asserted, then dropped. It NEVER touches
 * the configured MONGO_URI — the target is pinned to localhost below and the
 * run aborts if it is pointed anywhere else, because this script drops its
 * database when it finishes.
 *
 * What it proves: completion posts nothing; after MD signature + QC the ACCEPTED
 * qty posts per line (RM at the explicit Received At, non-RM at the GRN store);
 * rejected qty never enters stock; the duplicate-prevention claims (replay,
 * double submit, concurrent submit); the batch rule; legacy GRNs not reposted.
 *
 * What it CANNOT prove on a standalone mongod: rollback. Posting QC-accepted
 * stock is written as one unit, which needs a replica set; without one a real
 * deployment refuses to post at all. This script runs against a throwaway
 * standalone database, so it opts into the non-atomic fallback for itself
 * (below) exactly as the e2e harness does — the all-or-nothing guarantee is
 * proven separately, on a replica set, by e2eQcGatedPostingFixture.js --api.
 */
import mongoose from 'mongoose';

import GoodsReceiptNote, { GRN_STATUS } from '../modules/procurement/grn/grn.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import { grnService } from '../modules/procurement/grn/grn.service.js';
import { incomingQcService } from '../modules/procurement/incoming-qc/incomingQc.service.js';

const URI = 'mongodb://127.0.0.1:27017/ambika_grn_rm_verify';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(URI)) {
  console.error('Refusing to run: this script drops its database and must target localhost.');
  process.exit(1);
}
// Pinned to a throwaway localhost database that this script drops when it is
// done (checked immediately above), so the standalone fallback is allowed here.
// A server holding real stock never sets this and refuses to post instead.
process.env.INVENTORY_ALLOW_NON_ATOMIC = 'true';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const USER = { _id: new mongoose.Types.ObjectId(), name: 'Verifier' };

/** A PO + GRN pair: one coil, one circle (both RM) and one consumable. */
const seed = async (tag, skus) => {
  const items = [
    { skuId: skus.coil._id,     skuCode: 'COIL-1',   itemName: 'Coil 1250mm',  unit: 'KGS', quantity: 500, receivedQty: 0, pendingQty: 500, rate: 100 },
    { skuId: skus.circle._id,   skuCode: 'CIRC-1',   itemName: 'Circle 180mm', unit: 'PCS', quantity: 300, receivedQty: 0, pendingQty: 300, rate: 20 },
    { skuId: skus.bolt._id,     skuCode: 'BOLT-1',   itemName: 'Bolt M8',      unit: 'PCS', quantity: 200, receivedQty: 0, pendingQty: 200, rate: 5 },
  ];
  const vendorId = new mongoose.Types.ObjectId();
  const po = await VendorPurchaseOrder.create({
    poNumber: `PO-${tag}`, vendorId, vendorName: 'Test Vendor',
    indentId: new mongoose.Types.ObjectId(),
    items, poStatus: 'APPROVED',
  });
  const grn = await GoodsReceiptNote.create({
    grnNumber: `GRN-${tag}`, poId: po._id, poNumber: po.poNumber,
    vendorId, vendorName: 'Test Vendor', warehouse: 'MAIN', grnStatus: GRN_STATUS.DRAFT, stockPosted: false,
    items: po.items.map((p, i) => ({
      poItemId: p._id, skuId: p.skuId, skuCode: p.skuCode, itemName: p.itemName, unit: p.unit,
      orderedQty: p.quantity, receivedQty: p.quantity, rate: p.rate,
      batchNo: `BATCH-${tag}-${i + 1}`,
    })),
    totalReceivedQty: 1000,
  });
  return { po, grn };
};

const movementsFor = (grnId) => InventoryMovement.find({ refType: 'GRN', refId: grnId }).lean();

const run = async () => {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.dropDatabase();
  console.log(`Connected to ${URI} (scratch)\n`);

  const skus = {
    coil:   await SKU.create({ code: 'COIL-1', name: 'Coil 1250mm',  unit: 'KGS', itemType: 'RAW_MATERIAL' }),
    circle: await SKU.create({ code: 'CIRC-1', name: 'Circle 180mm', unit: 'PCS', itemType: 'CIRCLE' }),
    bolt:   await SKU.create({ code: 'BOLT-1', name: 'Bolt M8',      unit: 'PCS', itemType: 'CONSUMABLE' }),
  };

  /** Stand in for the MD signature (the mirror field the QC gate reads), then complete one QC. */
  const signAndQc = async (grnId, split = {}) => {
    await GoodsReceiptNote.updateOne({ _id: grnId }, { $set: { approvalStatus: 'MD_APPROVED' } });
    const qc = await incomingQcService.create({ grnId: String(grnId) }, USER);
    const items = qc.items.map((it) => {
      const rej = split[it.skuCode] || 0;
      return { grnItemId: String(it.grnItemId), itemName: it.itemName, receivedQty: it.receivedQty, acceptedQty: it.receivedQty - rej, rejectedQty: rej, reworkQty: 0 };
    });
    await incomingQcService.update(String(qc._id), { items }, USER);
    return incomingQcService.complete(String(qc._id), {}, USER);
  };

  // ── Test 1 — completion stocks nothing ─────────────────────────────────────
  console.log('Test 1 — GRN completed: receipt final, NO stock yet');
  {
    const { po, grn } = await seed('T1', skus);
    await grnService.complete(grn._id, { rmReceivedAtLocation: 'PLG01' }, USER);
    const movs = await movementsFor(grn._id);
    check('no movement at all is created at completion', movs.length === 0, `${movs.length} movement(s)`);
    const after = await GoodsReceiptNote.findById(grn._id).lean();
    check('the GRN completes, QC-gated', after.grnStatus !== GRN_STATUS.DRAFT && after.stockPosted === true && after.stockPostingStage === 'QC_COMPLETION', after.grnStatus);
    check('every received line is AWAITING_QC with its destination fixed',
      after.items.every((l) => l.stockStatus === 'AWAITING_QC') && after.items[0].stockWarehouse === 'PLG01' && after.items[2].stockWarehouse === 'MAIN',
      after.items.map((l) => `${l.skuCode}:${l.stockStatus}@${l.stockWarehouse}`).join(','));
    const poAfter = await VendorPurchaseOrder.findById(po._id).lean();
    check('the PO receipt quantities are updated', poAfter.items.every((i) => i.receivedQty === i.quantity), poAfter.poStatus);
    const stock = await InventoryStock.findOne({ skuId: skus.coil._id }).lean();
    check('no RM stock balance exists yet', !stock || stock.qtyOnHand === 0, `qtyOnHand=${stock?.qtyOnHand ?? 'none'}`);
  }

  // ── Test 1b — Received At is required, never assumed ───────────────────────
  console.log('\nTest 1b — Raw Material without Received At');
  {
    const { grn } = await seed('T1B', skus);
    let msg = '';
    try { await grnService.complete(grn._id, { addToRmStock: true }, USER); } catch (e) { msg = e.message; }
    check('completion is refused — the retired opt-in does not stand in for a location', /Received At is required/.test(msg), msg);
    const after = await GoodsReceiptNote.findById(grn._id).lean();
    check('…the claim is released (still an editable draft)', after.stockPosted === false && after.grnStatus === GRN_STATUS.DRAFT);
  }

  // ── Tests 2, 6, 7, 13 — after MD signature + QC ────────────────────────────
  console.log('\nTest 2 / 6 / 7 / 13 — MD signs, QC accepts everything (multi-item)');
  {
    const { grn } = await seed('T2', skus);
    await grnService.complete(grn._id, { rmReceivedAtLocation: 'PLG01' }, USER);
    const qc = await signAndQc(grn._id);
    const movs = await movementsFor(grn._id);
    check('one movement per received line', movs.length === 3, `${movs.length} movement(s)`);
    const coil = movs.find((m) => m.skuCode === 'COIL-1');
    const circle = movs.find((m) => m.skuCode === 'CIRC-1');
    const bolt = movs.find((m) => m.skuCode === 'BOLT-1');
    check('each RM line posts its own movement', !!coil && !!circle);
    check('RM lands at the chosen Received At', coil.warehouse === 'PLG01' && circle.warehouse === 'PLG01', `${coil.warehouse}/${circle.warehouse}`);
    check('non-RM keeps the GRN store, not a Received At', bolt.warehouse === 'MAIN', bolt.warehouse);
    check('quantity, unit and batch carry across', coil.quantity === 500 && coil.unit === 'KGS' && coil.batchNo === 'BATCH-T2-1',
      `${coil.quantity} ${coil.unit} ${coil.batchNo}`);
    check('txnType is the existing GRN_IN', coil.txnType === 'GRN_IN', coil.txnType);
    check('the movement traces back to the GRN', String(coil.refId) === String(grn._id) && coil.refNumber === 'GRN-T2');
    check('the PO number is carried for the ledger', coil.poNumber === 'PO-T2', coil.poNumber);
    check('the movement is dated at QC completion', Math.abs(new Date(coil.movementDate) - new Date(qc.completedAt)) < 5);
    const after = await GoodsReceiptNote.findById(grn._id).lean();
    check('the GRN line back-references its movement', !!after.items[0].movementId && !!after.items[0].movementNumber && after.items[0].stockStatus === 'POSTED');
    check('Received At is recorded on the GRN', after.rmReceivedAtLocation === 'PLG01', after.rmReceivedAtLocation);
    const stock = await InventoryStock.findOne({ skuId: skus.coil._id, warehouse: 'PLG01' }).lean();
    check('RM stock balance is derived', stock?.qtyOnHand === 500, `qtyOnHand=${stock?.qtyOnHand}`);
  }

  // ── Test 2b — rejected qty never becomes stock ─────────────────────────────
  console.log('\nTest 2b — QC rejects part of the coil');
  {
    const { grn } = await seed('T2B', skus);
    await grnService.complete(grn._id, { rmReceivedAtLocation: 'PLG01' }, USER);
    await signAndQc(grn._id, { 'COIL-1': 50, 'BOLT-1': 200 });
    const movs = await movementsFor(grn._id);
    const coil = movs.find((m) => m.skuCode === 'COIL-1');
    check('only the accepted 450 kg is posted', coil?.quantity === 450, `${coil?.quantity}`);
    check('the fully rejected bolt posts nothing', !movs.some((m) => m.skuCode === 'BOLT-1'));
    check('no QC_REJECT_OUT exists — rejected stock never entered', (await InventoryMovement.countDocuments({ txnType: 'QC_REJECT_OUT' })) === 0);
  }

  // ── Test 13b — JW001 routes elsewhere ──────────────────────────────────────
  console.log('\nTest 13b — Received At = JW001');
  {
    const { grn } = await seed('T3', skus);
    await grnService.complete(grn._id, { rmReceivedAtLocation: 'JW001' }, USER);
    await signAndQc(grn._id);
    const movs = await movementsFor(grn._id);
    const coil = movs.find((m) => m.skuCode === 'COIL-1');
    const bolt = movs.find((m) => m.skuCode === 'BOLT-1');
    check('RM follows the selection', coil?.warehouse === 'JW001', coil?.warehouse);
    check('non-RM is unaffected by it', bolt?.warehouse === 'MAIN', bolt?.warehouse);
  }

  // ── Tests 3, 4, 5, 19 — replay ─────────────────────────────────────────────
  console.log('\nTest 3 / 4 / 5 / 19 — the same completion sent again');
  {
    const { grn } = await seed('T4', skus);
    await grnService.complete(grn._id, { rmReceivedAtLocation: 'PLG01' }, USER);
    let rejected = false;
    try { await grnService.complete(grn._id, { rmReceivedAtLocation: 'PLG01' }, USER); }
    catch (e) { rejected = true; check('a second GRN completion is refused', true, e.message); }
    if (!rejected) check('a second GRN completion is refused', false, 'it was accepted');
    const qc = await signAndQc(grn._id);
    const first = (await movementsFor(grn._id)).length;
    let again = '';
    try { await incomingQcService.complete(String(qc._id), {}, USER); } catch (e) { again = e.message; }
    check('a second QC completion is refused', /already completed/.test(again), again);
    const second = (await movementsFor(grn._id)).length;
    check('no extra movement is written', first === 3 && first === second, `${first} then ${second}`);
  }

  // ── Test 18 — two at once ──────────────────────────────────────────────────
  console.log('\nTest 18 — two completions racing each other');
  {
    const { grn } = await seed('T5', skus);
    const outcomes = await Promise.allSettled([
      grnService.complete(grn._id, { rmReceivedAtLocation: 'PLG01' }, USER),
      grnService.complete(grn._id, { rmReceivedAtLocation: 'PLG01' }, USER),
    ]);
    const ok = outcomes.filter((o) => o.status === 'fulfilled').length;
    check('exactly one completion wins', ok === 1, `${ok} succeeded`);
    await signAndQc(grn._id);
    const movs = await movementsFor(grn._id);
    check('exactly one movement per line after QC', movs.length === 3, `${movs.length} movement(s)`);
  }

  // ── Test 15 — a failure must not leave a claimed GRN ───────────────────────
  console.log('\nTest 15 — the completion fails');
  {
    const { po, grn } = await seed('T6', skus);
    // An item with no SKU cannot be routed — the service rejects the whole GRN.
    // Completion re-reads each line's SKU from its PO line, so blanking only the
    // GRN line proved nothing (the PO supplied the SKU back and the GRN
    // completed — this test failed at HEAD 3310fe7 for exactly that reason). A
    // genuinely unlinked line has no SKU on the PO either (a free-typed line).
    await VendorPurchaseOrder.updateOne({ _id: po._id }, { $set: { 'items.0.skuId': null, 'items.0.skuCode': '' } });
    await GoodsReceiptNote.updateOne({ _id: grn._id }, { $set: { 'items.0.skuId': null, 'items.0.skuCode': '' } });
    let failed = false;
    try { await grnService.complete(grn._id, { rmReceivedAtLocation: 'PLG01' }, USER); } catch { failed = true; }
    check('the completion is rejected', failed);
    const after = await GoodsReceiptNote.findById(grn._id).lean();
    check('the claim is released so a fix can be retried', after.stockPosted === false && after.grnStatus === GRN_STATUS.DRAFT,
      `stockPosted=${after.stockPosted} status=${after.grnStatus}`);
  }

  // ── Batch Number is mandatory for Coil and Circle only ────────────────────
  // Exercised through grnService.create() so it is the SERVER rule being tested.
  console.log('\nBatch Number matrix — Coil/Circle required, everything else untouched');
  {
    const vendorId = new mongoose.Types.ObjectId();
    let n = 0;
    /** Build a PO with one line of the given SKU, then try to create a GRN. */
    const tryCreate = async (sku, code, name, unit, batchNo) => {
      n += 1;
      const po = await VendorPurchaseOrder.create({
        poNumber: `PO-BATCH-${n}`, vendorId, vendorName: 'Test Vendor',
        indentId: new mongoose.Types.ObjectId(), poStatus: 'APPROVED',
        // create() gates on these before it ever reaches the batch rule.
        followUpStatus: 'READY_FOR_GRN', piStatus: 'PI_NOT_REQUIRED',
        readyForGrnAt: new Date(), finalMaterialDate: new Date(),
        items: [{ skuId: sku._id, skuCode: code, itemName: name, unit, quantity: 10, receivedQty: 0, pendingQty: 10, rate: 1 }],
      });
      try {
        await grnService.create({
          poId: po._id,
          // Raw Material needs a Received At; it is ignored for other products.
          rmReceivedAtLocation: 'PLG01',
          items: [{
            skuId: sku._id, skuCode: code, itemName: name, unit,
            orderedQty: 10, previouslyReceivedQty: 0, invoiceQty: 10, receivedQty: 10, rate: 1,
            batchNo,
          }],
        }, USER);
        return { ok: true };
      } catch (e) { return { ok: false, msg: e.message }; }
    };

    const coilNo = await tryCreate(skus.coil, 'COIL-1', 'Coil 1250mm', 'KGS', '');
    check('Coil + no batch  → REJECTED', coilNo.ok === false, coilNo.msg || 'it was accepted');
    check('…and the message names Coil', /required for Coil/i.test(coilNo.msg || ''), coilNo.msg);
    const coilYes = await tryCreate(skus.coil, 'COIL-1', 'Coil 1250mm', 'KGS', 'B-COIL-1');
    check('Coil + batch     → ALLOWED', coilYes.ok === true, coilYes.msg);
    const circNo = await tryCreate(skus.circle, 'CIRC-1', 'Circle 180mm', 'PCS', '');
    check('Circle + no batch → REJECTED', circNo.ok === false, circNo.msg || 'it was accepted');
    check('…and the message names Circle', /required for Circle/i.test(circNo.msg || ''), circNo.msg);
    const circYes = await tryCreate(skus.circle, 'CIRC-1', 'Circle 180mm', 'PCS', 'B-CIRC-1');
    check('Circle + batch   → ALLOWED', circYes.ok === true, circYes.msg);
    const boltNo = await tryCreate(skus.bolt, 'BOLT-1', 'Bolt M8', 'PCS', '');
    check('Other product + no batch → ALLOWED (unchanged)', boltNo.ok === true, boltNo.msg);
    const boltYes = await tryCreate(skus.bolt, 'BOLT-1', 'Bolt M8', 'PCS', 'B-BOLT-1');
    check('Other product + batch    → ALLOWED (unchanged)', boltYes.ok === true, boltYes.msg);

    // A GRN saved before the rule existed must not be able to reach stock.
    const { grn: legacy } = await seed('BATCHLEGACY', skus);
    await GoodsReceiptNote.collection.updateOne({ _id: legacy._id }, { $set: { 'items.0.batchNo': '' } });
    let completeBlocked = false; let completeMsg = '';
    try { await grnService.complete(legacy._id, { rmReceivedAtLocation: 'PLG01' }, USER); }
    catch (e) { completeBlocked = true; completeMsg = e.message; }
    check('completion is blocked when a Coil line lost its batch', completeBlocked, completeMsg);
    const legacyAfter = await GoodsReceiptNote.findById(legacy._id).select('stockPosted grnStatus').lean();
    check('…and the blocked GRN is left editable (claim released)',
      legacyAfter.stockPosted === false && legacyAfter.grnStatus === GRN_STATUS.DRAFT,
      `stockPosted=${legacyAfter.stockPosted} status=${legacyAfter.grnStatus}`);

    // Batch must reach the ledger, so RM lookup can find the coil later.
    const { grn: carried } = await seed('BATCHCARRY', skus);
    await grnService.complete(carried._id, { rmReceivedAtLocation: 'PLG01' }, USER);
    await signAndQc(carried._id);
    const coilMov = (await movementsFor(carried._id)).find((m) => m.skuCode === 'COIL-1');
    check('the GRN batch reaches the RM movement', coilMov?.batchNo === 'BATCH-BATCHCARRY-1', coilMov?.batchNo);
    check('…against the right SKU', String(coilMov?.skuId) === String(skus.coil._id));
  }

  // ── Test 20 — a historical GRN ─────────────────────────────────────────────
  console.log('\nTest 20 — a GRN completed before this change (legacy, opt-in OFF)');
  {
    const { grn } = await seed('T7', skus);
    // As the previous code left it: completed, stockPosted, no posting stage,
    // the coil + circle never stocked (opt-in OFF), the bolt posted at completion.
    await GoodsReceiptNote.collection.updateOne({ _id: grn._id }, {
      $set: { grnStatus: GRN_STATUS.FULLY_RECEIVED, stockPosted: true, approvalStatus: 'MD_APPROVED', qcStatus: 'PENDING', addToRmStock: false },
      $unset: { stockPostingStage: '', rmReceivedAtLocation: '' },
    });
    const { inventoryService } = await import('../modules/inventory/inventory.service.js');
    const bolt = grn.items[2];
    await inventoryService.increaseStock({ skuId: bolt.skuId, skuCode: bolt.skuCode, warehouse: 'MAIN', quantity: 200, txnType: 'GRN_IN', refType: 'GRN', refId: grn._id, refNumber: grn.grnNumber });
    let msg = '';
    try { await grnService.complete(grn._id, { rmReceivedAtLocation: 'PLG01' }, USER); } catch (e) { msg = e.message; }
    check('a legacy GRN cannot be completed (or reposted) again', /Only draft GRNs|already been completed/.test(msg), msg);
    const qc = await incomingQcService.create({ grnId: String(grn._id) }, USER);
    await incomingQcService.complete(String(qc._id), {}, USER);
    const movs = await movementsFor(grn._id);
    check('its QC follows the legacy path — no GRN_IN added, RM never stocked', movs.length === 1 && movs[0].skuCode === 'BOLT-1',
      movs.map((m) => m.skuCode).join(','));
  }

  console.log('\n────────────────────────────────────────');
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) failed.forEach((f) => console.log(`  FAILED: ${f.name} — ${f.detail}`));

  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  process.exit(failed.length ? 1 : 0);
};

run().catch(async (e) => {
  console.error('\nVerification aborted:', e.message);
  console.error(e.stack);
  try { await mongoose.disconnect(); } catch { /* already down */ }
  process.exit(1);
});
