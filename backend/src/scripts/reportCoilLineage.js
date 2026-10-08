/**
 * Report — how much of the scrap on record can actually be traced to a coil.
 *
 * READ-ONLY. There is no --commit, it writes nothing, and that is the point:
 * this is the reconciliation the coil-traceability work was specified around,
 * and the answer it gives must never be "improved" by a migration.
 *
 * ── WHY THERE IS NO BACKFILL SCRIPT BESIDE THIS ONE ─────────────────────────
 * Every historical conversion carries `coilReceiptId: null`, because the
 * client's workbook records a BATCH NUMBER and not a goods receipt. The obvious
 * repair — match the batch number to a GRN_IN row and link them — is refused,
 * deliberately, and section 4 below is the evidence for why: batch numbers are
 * free text, some match nothing, and some would match more than one receipt. A
 * link made on that basis would look exactly like a real one and be a guess.
 *
 * So the historical rows stay unlinked and report as "Untraceable" in Scrap
 * IMS. This script measures how much that is, and tells you what a backfill
 * COULD have matched, so the decision stays visible rather than implied.
 *
 * Run:  node src/scripts/reportCoilLineage.js
 */
import mongoose from 'mongoose';
import env from '../config/env.js';
import SKU from '../modules/skus/sku.model.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import ScrapRecord from '../modules/inventory/scrapRecord.model.js';
import InventoryMovement, { TXN_TYPE } from '../modules/inventory/inventoryMovement.model.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const RULE = '------------------------------------------------------------';
const pct = (a, b) => (b > 0 ? `${round2((a / b) * 100)}%` : '-');

const run = async () => {
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  console.log(`\nconnected to ${mongoose.connection.name} @ ${mongoose.connection.host}`);
  console.log('read-only - this script never writes\n');

  /* 1) Conversions ---------------------------------------------------- */
  console.log('-- CONVERSIONS --------------------------------------------');
  const live = { isDeleted: { $ne: true } };
  const convTotal = await CoilConversion.countDocuments(live);
  const convLinked = await CoilConversion.countDocuments({ ...live, coilReceiptId: { $ne: null } });
  console.log(`  total                     ${convTotal}`);
  console.log(`  with coilReceiptId        ${convLinked}  (${pct(convLinked, convTotal)})`);
  console.log(`  without (untraceable)     ${convTotal - convLinked}`);

  /* 2) Scrap records -------------------------------------------------- */
  console.log('\n-- SCRAP RECORDS ------------------------------------------');
  const cut = { ...live, batchStatus: 'CUT' };
  const [scrapAgg] = await ScrapRecord.aggregate([
    { $match: cut },
    {
      $group: {
        _id: null,
        records: { $sum: 1 },
        scrapKg: { $sum: '$scrapKg' },
        /**
         * `$ifNull` is load-bearing, not decoration.
         *
         * `coilReceiptId` is ABSENT on every historical record, not set to
         * null, and a bare `{ $ne: ['$coilReceiptId', null] }` does not treat a
         * missing field the way the query language does — the first run of this
         * script reported 480 of 482 records as traced when the true answer is
         * zero. Collapsing missing to null first makes the aggregate agree with
         * `countDocuments({ coilReceiptId: { $ne: null } })`, which is the
         * figure to trust.
         */
        linked: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$coilReceiptId', null] }, null] }, 1, 0] } },
        linkedScrapKg: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$coilReceiptId', null] }, null] }, '$scrapKg', 0] } },
      },
    },
  ]);
  const a = scrapAgg || { records: 0, scrapKg: 0, linked: 0, linkedScrapKg: 0 };
  console.log(`  cut records               ${a.records}`);
  console.log(`  traced to a coil          ${a.linked}  (${pct(a.linked, a.records)})`);
  console.log(`  untraceable               ${a.records - a.linked}`);
  console.log(`  scrap total               ${round2(a.scrapKg)} kg`);
  console.log(`  ... traceable             ${round2(a.linkedScrapKg)} kg  (${pct(a.linkedScrapKg, a.scrapKg)})`);
  console.log(`  ... UNTRACEABLE           ${round2(a.scrapKg - a.linkedScrapKg)} kg`);
  // UNCUT rows are not scrap and are excluded from every figure above, exactly
  // as the Scrap IMS excludes them. Counted so the exclusion is visible.
  console.log(`  uncut rows (not scrap)    ${await ScrapRecord.countDocuments({ ...live, batchStatus: 'UNCUT' })}`);

  /* 3) Multi-round coils ---------------------------------------------- */
  console.log('\n-- CUTTING ROUNDS PER PHYSICAL COIL -----------------------');
  const rounds = await CoilConversion.aggregate([
    { $match: { ...live, coilReceiptId: { $ne: null } } },
    { $group: { _id: '$coilReceiptId', n: { $sum: 1 }, cutKg: { $sum: '$coilWeightKg' }, scrapKg: { $sum: '$scrapKg' } } },
    { $group: { _id: '$n', coils: { $sum: 1 }, cutKg: { $sum: '$cutKg' }, scrapKg: { $sum: '$scrapKg' } } },
    { $sort: { _id: 1 } },
  ]);
  if (!rounds.length) console.log('  none - no conversion names a goods receipt yet');
  for (const r of rounds) {
    console.log(`  cut ${String(r._id).padStart(2)} time(s)            ${String(r.coils).padStart(5)} coils   ${round2(r.cutKg)} kg cut, ${round2(r.scrapKg)} kg scrap`);
  }

  /* 4) Over-cut coils — a real data fault, reported not repaired ------- */
  console.log('\n-- COILS CUT BEYOND THEIR RECEIPT -------------------------');
  const perCoil = await CoilConversion.aggregate([
    { $match: { ...live, coilReceiptId: { $ne: null } } },
    { $group: { _id: '$coilReceiptId', cutKg: { $sum: '$coilWeightKg' } } },
  ]);
  const receiptById = new Map(
    (await InventoryMovement.find({ _id: { $in: perCoil.map((p) => p._id) } })
      .select('quantity batchNo movementNumber').lean())
      .map((m) => [String(m._id), m]),
  );
  const over = perCoil
    .map((p) => ({ ...p, m: receiptById.get(String(p._id)) }))
    .filter((p) => p.m && p.cutKg - p.m.quantity > 0.001);
  console.log(`  ${over.length} coil(s) have more cut than was received`);
  for (const o of over.slice(0, 20)) {
    console.log(`    ${o.m.batchNo || o.m.movementNumber}: received ${round2(o.m.quantity)} kg, cut ${round2(o.cutKg)} kg`);
  }

  /* 5) What a backfill COULD have matched — and why it is not run ------ */
  console.log('\n-- UNLINKED CONVERSIONS: WHAT A BACKFILL WOULD FIND --------');
  console.log('  (counted only. NOTHING is written, and no link is created.)');
  const orphans = await CoilConversion.find({ ...live, coilReceiptId: null })
    .select('conversionNumber batchNo coilSkuId coilSkuCode scrapKg').lean();

  let noBatch = 0; let zero = 0; let one = 0; let many = 0;
  const examplesMany = [];
  for (const c of orphans) {
    const batchNo = String(c.batchNo || '').trim();
    if (!batchNo || !c.coilSkuId) { noBatch += 1; continue; }
    const n = await InventoryMovement.countDocuments({
      batchNo, skuId: c.coilSkuId, txnType: TXN_TYPE.GRN_IN, isDeleted: { $ne: true },
    });
    if (n === 0) zero += 1;
    else if (n === 1) one += 1;
    else { many += 1; if (examplesMany.length < 10) examplesMany.push(`${c.conversionNumber} / ${batchNo} -> ${n} receipts`); }
  }
  console.log(`  unlinked conversions      ${orphans.length}`);
  console.log(`  ... no batch number       ${noBatch}   (nothing to match on at all)`);
  console.log(`  ... batch matches 0       ${zero}   (the receipt was never recorded)`);
  console.log(`  ... batch matches 1       ${one}   (a backfill WOULD link these)`);
  console.log(`  ... batch matches 2+      ${many}   (ambiguous - a backfill would have to guess)`);
  for (const e of examplesMany) console.log(`        ${e}`);
  console.log('');
  console.log('  These are NOT linked. A batch number is free text written on a');
  console.log('  label, and matching one to a receipt years later is inference,');
  console.log('  not evidence - an inferred link is indistinguishable on screen');
  console.log('  from one the operator actually made. They stay Untraceable.');

  /* 6) Coverage from here on ------------------------------------------ */
  console.log('\n-- COILS AVAILABLE TO TRACE AGAINST ------------------------');
  const coilSkus = await SKU.find({ itemType: 'RAW_MATERIAL', isDeleted: { $ne: true } }).select('_id').lean();
  const coilIds = coilSkus.map((s) => s._id);
  const receipts = await InventoryMovement.countDocuments({
    skuId: { $in: coilIds }, txnType: TXN_TYPE.GRN_IN, isDeleted: { $ne: true },
  });
  const unbatched = await InventoryMovement.countDocuments({
    skuId: { $in: coilIds },
    txnType: TXN_TYPE.GRN_IN,
    $or: [{ batchNo: '' }, { batchNo: null }],
    isDeleted: { $ne: true },
  });
  console.log(`  coil goods receipts       ${receipts}`);
  console.log(`  ... with no batch number  ${unbatched}   (these need the manual fallback)`);

  console.log(`\n${RULE}`);
  console.log('  Every new cut booked through the app must now name its coil,');
  console.log('  or the operator must tick "No receipt available" on purpose.');
  console.log(`${RULE}\n`);

  await mongoose.disconnect();
  process.exit(0);
};

run().catch(async (e) => {
  console.error('\nREPORT FAILED TO RUN:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
