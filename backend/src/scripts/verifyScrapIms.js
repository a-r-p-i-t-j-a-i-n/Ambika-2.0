/**
 * Verify — scrap stock reconciles, and the scrap register was not disturbed.
 *
 * Read-only. It has no --commit and writes nothing, ever.
 *
 * This repo has no test runner, so this script is the reconciliation harness:
 * it re-derives every claim the Scrap IMS makes from the raw collections and
 * reports which ones hold. Run it after any scrap work, and after a release.
 *
 * Run:  node src/scripts/verifyScrapIms.js
 */
import mongoose from 'mongoose';
import env from '../config/env.js';
import SKU from '../modules/skus/sku.model.js';
import ScrapRecord from '../modules/inventory/scrapRecord.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';
import { SCRAP_SKU_CODE } from '../modules/inventory/scrapSku.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const RULE = '------------------------------------------------------------';

let passed = 0;
let failed = 0;
const check = (ok, label, detail = '') => {
  if (ok) { passed += 1; console.log(`  PASS  ${label}${detail ? ` - ${detail}` : ''}`); }
  else { failed += 1; console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`); }
};

const run = async () => {
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  console.log(`\nconnected to ${mongoose.connection.name} @ ${mongoose.connection.host}`);
  console.log('read-only - this script never writes\n');

  /* 1) The scrap item ------------------------------------------------- */
  console.log('-- SCRAP ITEM ---------------------------------------------');
  const sku = await SKU.findOne({ code: SCRAP_SKU_CODE }).lean();
  check(!!sku, 'scrap SKU exists', sku ? `${sku.code} (${sku._id})` : 'run: npm run seed:scrap-sku -- --commit');
  if (!sku) {
    console.log('\nCannot continue without the scrap SKU.\n');
    await mongoose.disconnect();
    process.exit(1);
  }
  check(sku.isDeleted !== true, 'scrap SKU is not soft-deleted');
  check(sku.itemType === 'SCRAP', 'scrap SKU itemType is SCRAP', sku.itemType);
  check(String(sku.unit).toUpperCase() === 'KGS', 'scrap SKU is stocked in KGS', sku.unit);

  /* 2) The production register is untouched ---------------------------- */
  console.log('\n-- PRODUCTION SCRAP REGISTER (must be unchanged) -----------');
  const total = await ScrapRecord.countDocuments({});
  const byStatus = await ScrapRecord.aggregate([
    { $group: { _id: '$batchStatus', n: { $sum: 1 }, kg: { $sum: '$scrapKg' } } },
  ]);
  const cut = byStatus.find((b) => b._id === 'CUT') || { n: 0, kg: 0 };
  const uncut = byStatus.find((b) => b._id === 'UNCUT') || { n: 0, kg: 0 };

  // The 496 baseline is the imported history plus the app-created cuts that
  // existed when scrap stock went live. It only ever goes UP, one per new cut.
  // If it drops, something deleted history.
  check(total >= 496, 'scrap records at or above the 496 baseline', `${total} records`);
  check(uncut.n === 15, 'the 15 uncut batches are intact',
    `${uncut.n} uncut / ${round2(uncut.kg)} kg (excluded from every total)`);
  console.log(`        cut: ${cut.n} records / ${round2(cut.kg)} kg`);

  /* 3) Ledger equals stock -------------------------------------------- */
  console.log('\n-- SCRAP STOCK RECONCILIATION -----------------------------');
  const stockRows = await InventoryStock.find({ skuId: sku._id }).lean();
  const ledger = await InventoryMovement.aggregate([
    { $match: { skuId: sku._id, isDeleted: { $ne: true } } },
    { $group: { _id: '$warehouse', delta: { $sum: '$qtyDelta' }, n: { $sum: 1 } } },
  ]);

  const warehouses = [...new Set([
    ...stockRows.map((r) => r.warehouse),
    ...ledger.map((l) => l._id),
  ])].sort();
  if (!warehouses.length) console.log('        no scrap stock yet - nothing to reconcile');

  for (const w of warehouses) {
    const onHand = round2(stockRows.find((r) => r.warehouse === w)?.qtyOnHand || 0);
    const sum = round2(ledger.find((l) => l._id === w)?.delta || 0);
    check(onHand === sum, `ledger = stock at ${w}`, `on-hand ${onHand} vs ledger ${sum}`);
    check(onHand >= 0, `no negative scrap stock at ${w}`, `${onHand}`);
  }

  /* 4) One movement per in-house cut, none for job work ---------------- */
  console.log('\n-- AUTOMATIC SCRAP (cut -> stock) -------------------------');
  const plg = await ScrapRecord.countDocuments({
    location: 'PLG01', batchStatus: 'CUT', stockMovementId: { $ne: null },
  });
  const jw = await ScrapRecord.countDocuments({ location: 'JW001', stockMovementId: { $ne: null } });
  check(jw === 0, 'no job-work cut created scrap stock', `${jw} JW001 records carry a movement`);
  console.log(`        ${plg} in-house cuts have posted scrap into stock`);

  // Every link must point at a movement that really exists, and really is a
  // SCRAP_IN for the amount and place the record claims.
  const linked = await ScrapRecord.find({ stockMovementId: { $ne: null } })
    .select('conversionNumber scrapKg location stockMovementId').lean();
  let broken = 0;
  let mismatched = 0;
  for (const r of linked) {
    // eslint-disable-next-line no-await-in-loop
    const mov = await InventoryMovement.findById(r.stockMovementId)
      .select('txnType quantity warehouse').lean();
    if (!mov) { broken += 1; continue; }
    if (mov.txnType !== 'SCRAP_IN'
      || round2(mov.quantity) !== round2(r.scrapKg)
      || mov.warehouse !== r.location) mismatched += 1;
  }
  check(broken === 0, 'every stockMovementId points at a real movement', `${broken} dangling`);
  check(mismatched === 0, 'every linked movement matches its record', `${mismatched} mismatched`);

  /* 5) No cut posted stock twice -------------------------------------- */
  const dupeByRef = await InventoryMovement.aggregate([
    { $match: { skuId: sku._id, txnType: 'SCRAP_IN', refType: 'RM_CONVERSION' } },
    { $group: { _id: '$refId', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
  ]);
  check(dupeByRef.length === 0, 'no conversion posted scrap stock twice', `${dupeByRef.length} duplicated`);

  /* 6) Manual entries are traceable and not replayed ------------------- */
  console.log('\n-- MANUAL SCRAP IN / OUT ----------------------------------');
  const manual = await InventoryMovement.find({ skuId: sku._id, sourceModule: 'SCRAP_IMS' })
    .select('movementNumber txnType quantity warehouse reason refType clientRequestId').lean();
  console.log(`        ${manual.length} manual movements`);

  const noReason = manual.filter((m) => !m.reason);
  check(noReason.length === 0, 'every manual movement records a reason', `${noReason.length} without one`);
  const noRef = manual.filter((m) => !m.refType);
  check(noRef.length === 0, 'every manual movement records a refType', `${noRef.length} without one`);

  const keys = manual.map((m) => m.clientRequestId).filter(Boolean);
  const dupKeys = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  check(dupKeys.length === 0, 'no submission id moved stock twice', dupKeys.join(', ') || 'none');

  /* 7) Scrap never leaked into another item's ledger ------------------- */
  const strayType = await InventoryMovement.countDocuments({
    txnType: { $in: ['SCRAP_IN', 'SCRAP_OUT'] }, skuId: { $ne: sku._id },
  });
  check(strayType === 0, 'SCRAP_IN/OUT only ever touch the scrap item', `${strayType} against other items`);

  console.log(`\n${RULE}`);
  console.log(`  ${passed} passed / ${failed} failed`);
  console.log(`${RULE}\n`);

  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
};

run().catch(async (e) => {
  console.error('\nVERIFY FAILED TO RUN:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
