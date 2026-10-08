/**
 * Seed — the one SKU scrap stock is held against.
 *
 * Why this exists
 * ---------------
 * Scrap could not be stocked before, so it never needed an item. It does now:
 * InventoryStock and InventoryMovement are both keyed by `skuId`, so a balance
 * cannot exist without one.
 *
 * Why it REVIVES rather than creates
 * ----------------------------------
 * `SSMC-SCRAP` already exists in the database. It was created as a Finished
 * Good and soft-deleted by the SKU-master cleanup, and `SKU.code` carries a
 * GLOBAL unique index with no soft-delete filter — so inserting a second
 * `SSMC-SCRAP` is impossible, and picking a different code would leave a
 * confusing dead twin behind. This un-deletes the row and reclassifies it:
 *
 *     itemType  FINISHED_GOOD → SCRAP    (keeps it out of every FG screen,
 *                                         which filter on FINISHED_GOOD)
 *     unit      Kgs           → KGS      (the spelling RM coils already use)
 *     isDeleted true          → false
 *
 * Only if the code is absent entirely — a fresh database — does it insert one.
 *
 * What it will NOT touch
 * ----------------------
 *   • any stock, movement or ScrapRecord. It creates NO opening balance:
 *     scrap stock deliberately starts at zero, and the 496 historical scrap
 *     records stay exactly as they are.
 *   • any other SKU.
 *
 * Idempotency
 * -----------
 * Re-running reports "already correct" and writes nothing.
 *
 * Run:  node src/scripts/ensureScrapSku.js            (preview — the default)
 *       node src/scripts/ensureScrapSku.js --commit
 */
import mongoose from 'mongoose';
import env from '../config/env.js';
import SKU from '../modules/skus/sku.model.js';
import InventoryStock from '../modules/inventory/inventoryStock.model.js';
import { SCRAP_SKU_CODE, SCRAP_SKU_DEFAULTS } from '../modules/inventory/scrapSku.js';

const COMMIT = process.argv.includes('--commit');

const run = async () => {
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  console.log(`\nconnected to ${mongoose.connection.name} @ ${mongoose.connection.host}`);
  console.log(COMMIT ? 'mode: COMMIT\n' : 'mode: PREVIEW (pass --commit to write)\n');

  // Deliberately unfiltered by isDeleted — the whole point is to find the
  // soft-deleted row that is holding the unique code.
  const existing = await SKU.findOne({ code: SCRAP_SKU_CODE });

  console.log('── CURRENT ─────────────────────────────────────────────────');
  if (!existing) {
    console.log(`  ${SCRAP_SKU_CODE} does not exist — it will be created.`);
  } else {
    console.log(`  _id       ${existing._id}`);
    console.log(`  code      ${existing.code}`);
    console.log(`  name      ${existing.name}`);
    console.log(`  itemType  ${existing.itemType}`);
    console.log(`  unit      ${existing.unit}`);
    console.log(`  isDeleted ${existing.isDeleted}   isActive ${existing.isActive}`);
  }

  // Exactly what would change, field by field, so a preview is worth reading.
  const target = {
    name: SCRAP_SKU_DEFAULTS.name,
    itemType: SCRAP_SKU_DEFAULTS.itemType,
    unit: SCRAP_SKU_DEFAULTS.unit,
    category: SCRAP_SKU_DEFAULTS.category,
    isDeleted: false,
    isActive: true,
    deletedAt: null,
    deletedBy: null,
    status: 'ACTIVE',
  };

  const changes = [];
  if (existing) {
    for (const [k, v] of Object.entries(target)) {
      const now = existing[k];
      const same = (now == null && v == null) || String(now) === String(v);
      if (!same) changes.push(`${k}: ${JSON.stringify(now)} → ${JSON.stringify(v)}`);
    }
  }

  console.log('\n── PLANNED ─────────────────────────────────────────────────');
  if (!existing) {
    console.log(`  CREATE ${SCRAP_SKU_CODE} · ${target.name} · ${target.itemType} · ${target.unit}`);
  } else if (!changes.length) {
    console.log('  nothing to do — already correct.');
  } else {
    for (const c of changes) console.log(`  ${c}`);
  }
  console.log('\n  opening stock this will create : 0   (scrap stock starts at zero, by design)');

  if (!COMMIT) {
    console.log('\nPreview only — nothing was written. Re-run with --commit to apply.\n');
    await mongoose.disconnect();
    return;
  }

  console.log('\n── WRITING ─────────────────────────────────────────────────');
  let doc;
  if (!existing) {
    doc = await SKU.create({ code: SCRAP_SKU_CODE, ...target });
    console.log(`  CREATED ${doc.code} (${doc._id})`);
  } else if (!changes.length) {
    doc = existing;
    console.log('  SKIP — already correct.');
  } else {
    Object.assign(existing, target);
    doc = await existing.save();
    console.log(`  UPDATED ${doc.code} (${doc._id})`);
  }

  // Report, never create. A stock row appears on the first real scrap movement.
  const rows = await InventoryStock.find({ skuId: doc._id }).select('warehouse qtyOnHand').lean();
  console.log(`\n  scrap stock rows: ${rows.length || 'none yet'}`);
  for (const r of rows) console.log(`    ${r.warehouse}: ${r.qtyOnHand}`);

  console.log('\nDone.\n');
  await mongoose.disconnect();
};

run().catch(async (e) => {
  console.error('\nENSURE SCRAP SKU FAILED:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
