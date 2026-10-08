/**
 * Backfill — a ScrapRecord for every app-created conversion that has none.
 *
 * Why this exists
 * ---------------
 * `convert()` records the scrap for a cut from S1 onward. Conversions created
 * before that landed still have none, so their scrap is invisible to the Scrap
 * dashboard, register and detail. This gives them one.
 *
 * What it will NOT touch
 * ----------------------
 *   • the 480 conversions imported from the workbook — they already have a
 *     record, created by importRmScrapRecords with its own `sourceRef`
 *   • any inventory movement or stock balance. The coil already left stock as
 *     CONVERT_OUT when it was cut; scrap is part of that same weight. Posting
 *     anything here would deduct the metal twice.
 *   • any existing ScrapRecord. It only ever inserts.
 *
 * Idempotency
 * -----------
 * A conversion is skipped when a ScrapRecord already points at it, and the
 * partial unique index on `conversionId` refuses a second one regardless. Safe
 * to run repeatedly; a second run reports 0 to create.
 *
 * Run:  node src/scripts/backfillScrapFromConversions.js --preview
 *       node src/scripts/backfillScrapFromConversions.js --commit
 */
import mongoose from 'mongoose';
import env from '../config/env.js';
import CoilConversion from '../modules/inventory/coilConversion.model.js';
import ScrapRecord, { SCRAP_LOCATIONS } from '../modules/inventory/scrapRecord.model.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const COMMIT = process.argv.includes('--commit');

/**
 * Same rule the service uses: the coil's receipt first, then whatever the cut
 * was booked against. Historical conversions were posted to MAIN, which is not
 * a cutting location, so this returns null for them rather than guessing.
 */
const resolveLocation = (receipt, warehouse) => {
  const a = String(receipt?.warehouse || '').trim().toUpperCase();
  if (SCRAP_LOCATIONS.includes(a)) return a;
  const b = String(warehouse || '').trim().toUpperCase();
  if (SCRAP_LOCATIONS.includes(b)) return b;
  return null;
};

const run = async () => {
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  console.log(`\nconnected to ${mongoose.connection.name} @ ${mongoose.connection.host}`);
  console.log(COMMIT ? 'MODE: COMMIT' : 'MODE: PREVIEW — nothing will be written');

  const convs = await CoilConversion.find({ isDeleted: { $ne: true } }).lean();
  const linked = new Set(
    (await ScrapRecord.find({ conversionId: { $ne: null } }).select('conversionId').lean())
      .map((r) => String(r.conversionId)),
  );

  const imported = convs.filter((c) => c.sourceRef);
  const missing = convs.filter((c) => !linked.has(String(c._id)));

  console.log('\n── WHAT IS THERE ───────────────────────────────────────────');
  console.log(`  conversions                      : ${convs.length}`);
  console.log(`    imported from the workbook     : ${imported.length}`);
  console.log(`    created by the app             : ${convs.length - imported.length}`);
  console.log(`  scrap records already linked     : ${linked.size}`);
  console.log(`  conversions WITHOUT a record     : ${missing.length}`);

  if (!missing.length) {
    console.log('\n  Nothing to do — every conversion already has its scrap record.');
    await mongoose.disconnect();
    return;
  }

  const rows = [];
  for (const c of missing) {
    const receipt = c.coilReceiptId
      ? await InventoryMovement.findById(c.coilReceiptId).select('warehouse').lean()
      : null;
    const coilMov = c.coilMovementId
      ? await InventoryMovement.findById(c.coilMovementId).select('warehouse').lean()
      : null;
    const location = resolveLocation(receipt, coilMov?.warehouse);
    rows.push({
      conv: c,
      location,
      doc: {
        batchNo: c.batchNo || '',
        scrapDate: c.conversionDate,
        location: location || 'PLG01',
        coilSkuId: c.coilSkuId, coilSkuCode: c.coilSkuCode, coilSkuName: c.coilSkuName,
        coilWeightKg: round2(c.coilWeightKg),
        circlesWeightKg: round2(c.circlesWeightKg),
        scrapKg: round2(c.scrapKg),
        yieldRatioPct: c.coilWeightKg > 0 ? round2(c.yieldRatioPct) : null,
        disposition: c.scrapVerified || 'PENDING',
        verifiedAt: null,
        coilRate: round2(c.rate),
        batchStatus: Number(c.circlesWeightKg) > 0 ? 'CUT' : 'UNCUT',
        conversionId: c._id,
        conversionNumber: c.conversionNumber,
        coilReceiptId: c.coilReceiptId || null,
        clientRequestId: c.clientRequestId || undefined,
        remarks: location
          ? 'Backfilled from an existing conversion.'
          : 'Backfilled from an existing conversion; cutting location was not recorded, defaulted to PLG01.',
      },
    });
  }

  console.log('\n── TO CREATE ───────────────────────────────────────────────');
  console.log('  CONVERSION            BATCH        COIL        COIL kg  CIRCLES kg   SCRAP kg  YIELD  STATUS  LOCATION');
  for (const r of rows) {
    const d = r.doc;
    console.log(`  ${String(d.conversionNumber).padEnd(22)}${String(d.batchNo || '—').padEnd(13)}${String(d.coilSkuCode).padEnd(12)}`
      + `${String(d.coilWeightKg).padStart(8)}${String(d.circlesWeightKg).padStart(12)}${String(d.scrapKg).padStart(11)}`
      + `${String(d.yieldRatioPct ?? '—').padStart(7)}  ${d.batchStatus.padEnd(7)} ${d.location}${r.location ? '' : '  (defaulted)'}`);
  }
  console.log(`\n  total scrap this brings into the module: ${round2(rows.reduce((a, r) => a + r.doc.scrapKg, 0))} kg`);
  console.log('  inventory movements this will create   : 0  (the coil already left stock when it was cut)');

  if (!COMMIT) {
    console.log('\n  PREVIEW ONLY — nothing written. Re-run with --commit to apply.');
    await mongoose.disconnect();
    return;
  }

  console.log('\n── WRITING ─────────────────────────────────────────────────');
  let created = 0; let skipped = 0; let failed = 0;
  for (const r of rows) {
    try {
      // Checked again at the moment of writing, so a concurrent run or a
      // repeat of this script cannot produce a second record.
      const exists = await ScrapRecord.exists({ conversionId: r.conv._id });
      if (exists) { skipped++; console.log(`  SKIP   ${r.doc.conversionNumber} — already has a record`); continue; }
      await ScrapRecord.create(r.doc);
      created++;
      console.log(`  CREATE ${r.doc.conversionNumber} — ${r.doc.scrapKg} kg at ${r.doc.location}`);
    } catch (e) {
      // The partial unique index is the last line of defence.
      if (e?.code === 11000) { skipped++; console.log(`  SKIP   ${r.doc.conversionNumber} — refused by the unique index`); }
      else { failed++; console.log(`  FAIL   ${r.doc.conversionNumber} — ${e.message}`); }
    }
  }
  console.log(`\n  created ${created} · skipped ${skipped} · failed ${failed}`);
  console.log(`  ScrapRecord total is now: ${await ScrapRecord.countDocuments({})}`);

  await mongoose.disconnect();
};

run().catch(async (e) => {
  console.error('\nBACKFILL FAILED:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
