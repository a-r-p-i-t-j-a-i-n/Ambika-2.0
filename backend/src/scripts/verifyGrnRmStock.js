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
 * What it proves: the opt-in gate, per-line movements, Received At routing,
 * non-RM lines being untouched, and the duplicate-prevention claim (replay,
 * double submit, concurrent submit).
 *
 * What it CANNOT prove on a standalone mongod: rollback. runAtomically needs a
 * replica set and degrades to non-atomic without one, so the all-or-nothing
 * guarantee has to be verified on a replica-set deployment.
 */
import mongoose from 'mongoose';

import GoodsReceiptNote, { GRN_STATUS } from '../modules/procurement/grn/grn.model.js';
import VendorPurchaseOrder from '../modules/procurement/purchase-order/purchaseOrder.model.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import { grnService } from '../modules/procurement/grn/grn.service.js';

const URI = 'mongodb://127.0.0.1:27017/ambika_grn_rm_verify';
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)/.test(URI)) {
  console.error('Refusing to run: this script drops its database and must target localhost.');
  process.exit(1);
}

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

  // ── Test 1 — unticked ──────────────────────────────────────────────────────
  console.log('Test 1 — GRN completed with the box UNTICKED');
  {
    const { grn } = await seed('T1', skus);
    await grnService.complete(grn._id, { addToRmStock: false }, USER);
    const movs = await movementsFor(grn._id);
    const rm = movs.filter((m) => ['COIL-1', 'CIRC-1'].includes(m.skuCode));
    check('no RM movement is created', rm.length === 0, `${rm.length} RM movement(s)`);
    check('the non-RM line still posts', movs.some((m) => m.skuCode === 'BOLT-1'), `${movs.length} movement(s) total`);
    const after = await GoodsReceiptNote.findById(grn._id).lean();
    check('the GRN still completes', after.grnStatus !== GRN_STATUS.DRAFT && after.stockPosted === true, after.grnStatus);
    check('the opt-out is recorded', after.addToRmStock === false && after.rmReceivedAtLocation === null);
    const stock = await InventoryStock.findOne({ skuId: skus.coil._id }).lean();
    check('no RM stock balance exists', !stock || stock.qtyOnHand === 0, `qtyOnHand=${stock?.qtyOnHand ?? 'none'}`);
  }

  // ── Tests 2, 6, 7, 13 — ticked ─────────────────────────────────────────────
  console.log('\nTest 2 / 6 / 7 / 13 — GRN completed with the box TICKED (multi-item)');
  {
    const { grn } = await seed('T2', skus);
    await grnService.complete(grn._id, { addToRmStock: true, rmReceivedAtLocation: 'PLG01' }, USER);
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
    const after = await GoodsReceiptNote.findById(grn._id).lean();
    check('the GRN line back-references its movement', !!after.items[0].movementId && !!after.items[0].movementNumber);
    check('Received At is recorded on the GRN', after.rmReceivedAtLocation === 'PLG01', after.rmReceivedAtLocation);
    const stock = await InventoryStock.findOne({ skuId: skus.coil._id, warehouse: 'PLG01' }).lean();
    check('RM stock balance is derived', stock?.qtyOnHand === 500, `qtyOnHand=${stock?.qtyOnHand}`);
  }

  // ── Test 13b — JW001 routes elsewhere ──────────────────────────────────────
  console.log('\nTest 13b — Received At = JW001');
  {
    const { grn } = await seed('T3', skus);
    await grnService.complete(grn._id, { addToRmStock: true, rmReceivedAtLocation: 'JW001' }, USER);
    const movs = await movementsFor(grn._id);
    const coil = movs.find((m) => m.skuCode === 'COIL-1');
    const bolt = movs.find((m) => m.skuCode === 'BOLT-1');
    check('RM follows the selection', coil.warehouse === 'JW001', coil.warehouse);
    check('non-RM is unaffected by it', bolt.warehouse === 'MAIN', bolt.warehouse);
  }

  // ── Tests 3, 4, 5, 19 — replay ─────────────────────────────────────────────
  console.log('\nTest 3 / 4 / 5 / 19 — the same completion sent again');
  {
    const { grn } = await seed('T4', skus);
    await grnService.complete(grn._id, { addToRmStock: true }, USER);
    const first = (await movementsFor(grn._id)).length;
    let rejected = false;
    try { await grnService.complete(grn._id, { addToRmStock: true }, USER); }
    catch (e) { rejected = true; check('a second completion is refused', true, e.message); }
    if (!rejected) check('a second completion is refused', false, 'it was accepted');
    const second = (await movementsFor(grn._id)).length;
    check('no extra movement is written', first === second, `${first} then ${second}`);
  }

  // ── Test 18 — two at once ──────────────────────────────────────────────────
  console.log('\nTest 18 — two completions racing each other');
  {
    const { grn } = await seed('T5', skus);
    const outcomes = await Promise.allSettled([
      grnService.complete(grn._id, { addToRmStock: true }, USER),
      grnService.complete(grn._id, { addToRmStock: true }, USER),
    ]);
    const ok = outcomes.filter((o) => o.status === 'fulfilled').length;
    const movs = await movementsFor(grn._id);
    check('exactly one completion wins', ok === 1, `${ok} succeeded`);
    check('exactly one movement per line', movs.length === 3, `${movs.length} movement(s)`);
  }

  // ── Test 15 — a failure must not leave a claimed GRN ───────────────────────
  console.log('\nTest 15 — the completion fails');
  {
    const { grn } = await seed('T6', skus);
    // An item with no SKU cannot be posted — the service rejects the whole GRN.
    await GoodsReceiptNote.updateOne({ _id: grn._id }, { $set: { 'items.0.skuId': null, 'items.0.skuCode': '' } });
    let failed = false;
    try { await grnService.complete(grn._id, { addToRmStock: true }, USER); } catch { failed = true; }
    check('the completion is rejected', failed);
    const after = await GoodsReceiptNote.findById(grn._id).lean();
    check('the claim is released so a fix can be retried', after.stockPosted === false && after.grnStatus === GRN_STATUS.DRAFT,
      `stockPosted=${after.stockPosted} status=${after.grnStatus}`);
  }

  // ── Batch Number is mandatory for Coil and Circle only ────────────────────
  // The full matrix from the requirement, exercised through grnService.create()
  // so it is the SERVER rule being tested, not a UI convenience.
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
        // create() gates on these before it ever reaches the batch rule, so
        // without them every case would "reject" for the wrong reason.
        followUpStatus: 'READY_FOR_GRN', piStatus: 'PI_NOT_REQUIRED',
        readyForGrnAt: new Date(), finalMaterialDate: new Date(),
        items: [{ skuId: sku._id, skuCode: code, itemName: name, unit, quantity: 10, receivedQty: 0, pendingQty: 10, rate: 1 }],
      });
      try {
        await grnService.create({
          poId: po._id,
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

    // The whole point of the scoping: everything else is untouched.
    const boltNo = await tryCreate(skus.bolt, 'BOLT-1', 'Bolt M8', 'PCS', '');
    check('Other product + no batch → ALLOWED (unchanged)', boltNo.ok === true, boltNo.msg);
    const boltYes = await tryCreate(skus.bolt, 'BOLT-1', 'Bolt M8', 'PCS', 'B-BOLT-1');
    check('Other product + batch    → ALLOWED (unchanged)', boltYes.ok === true, boltYes.msg);

    // A GRN saved before the rule existed must not be able to post stock.
    const { grn: legacy } = await seed('BATCHLEGACY', skus);
    await GoodsReceiptNote.collection.updateOne(
      { _id: legacy._id }, { $set: { 'items.0.batchNo': '' } },
    );
    let completeBlocked = false; let completeMsg = '';
    try { await grnService.complete(legacy._id, { addToRmStock: true, rmReceivedAtLocation: 'PLG01' }, USER); }
    catch (e) { completeBlocked = true; completeMsg = e.message; }
    check('completion is blocked when a Coil line lost its batch', completeBlocked, completeMsg);
    const legacyAfter = await GoodsReceiptNote.findById(legacy._id).select('stockPosted grnStatus').lean();
    check('…and the blocked GRN is left editable (claim released)',
      legacyAfter.stockPosted === false && legacyAfter.grnStatus === GRN_STATUS.DRAFT,
      `stockPosted=${legacyAfter.stockPosted} status=${legacyAfter.grnStatus}`);

    // Batch must reach the ledger, so RM lookup can find the coil later.
    const { grn: carried } = await seed('BATCHCARRY', skus);
    await grnService.complete(carried._id, { addToRmStock: true, rmReceivedAtLocation: 'PLG01' }, USER);
    const carriedMovs = await movementsFor(carried._id);
    const coilMov = carriedMovs.find((m) => m.skuCode === 'COIL-1');
    check('the GRN batch reaches the RM movement', coilMov?.batchNo === 'BATCH-BATCHCARRY-1', coilMov?.batchNo);
    check('…against the right SKU', String(coilMov?.skuId) === String(skus.coil._id));
  }

  // ── Test 20 — a historical GRN ─────────────────────────────────────────────
  console.log('\nTest 20 — a GRN written before this change (no opt-in field)');
  {
    const { grn } = await seed('T7', skus);
    await GoodsReceiptNote.collection.updateOne({ _id: grn._id }, { $unset: { addToRmStock: '', rmReceivedAtLocation: '' } });
    await grnService.complete(grn._id, {}, USER); // no flag sent at all
    const movs = await movementsFor(grn._id);
    const rm = movs.filter((m) => ['COIL-1', 'CIRC-1'].includes(m.skuCode));
    check('opening/completing it posts no RM stock', rm.length === 0, `${rm.length} RM movement(s)`);
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
