/**
 * ONE-TIME BACKFILL — kilograms spelled KGS in SKU Master and in the stock it feeds.
 *
 * The master's unit was free text, so a few SKUs were saved as "KG" beside the
 * KGS every RM coil, scrap and policy row uses. The schema now normalises it on
 * write (sku.model.js normalizeSkuUnit); this fixes what was written before.
 *
 *   1. skus                 unit KG / Kg / Kgs / kilogram… → KGS
 *   2. inventorystocks,     the same spellings → KGS. GRN/QC postings copied the
 *      inventorymovements,  purchase document's "Kg"; the ledger now normalises
 *      inventorypolicies,   it on write (inventory.service.js).
 *      manualcoils
 *
 * A label only. No quantity, weight, balance or cost is read or written, and a
 * row keeps its unit's meaning — a "Kg" row was a kilogram figure and stays one.
 *
 * Procurement documents (indents, POs, PIs, GRNs, QC, vendor invoices, pricing
 * history) are NOT touched: they speak procurement's own unit list ("Kg"), which
 * indentMeta maps to and from the master.
 *
 * Raw collection access on purpose — Mongoose runs the unit setter while
 * casting query filters, so a model query for { unit: 'KG' } would look for KGS.
 *
 * USAGE
 *   node src/scripts/normalizeKgsUnit.js            ← preview (no writes)
 *   node src/scripts/normalizeKgsUnit.js --commit   ← apply
 * DRY_RUN=true overrides --commit. Idempotent: a second run finds nothing.
 */
import mongoose from 'mongoose';
import env from '../config/env.js';

const COMMIT = process.argv.includes('--commit');
const DRY_RUN_ENV = process.env.DRY_RUN !== undefined
  && String(process.env.DRY_RUN).toLowerCase() !== 'false';
const DRY_RUN = DRY_RUN_ENV || !COMMIT;

const KG_FAMILY = /^\s*(kg|kgs|kilo|kilos|kilogram|kilograms)\s*$/i;
const NOT_KGS = { $regex: KG_FAMILY, $ne: 'KGS' };

const run = async () => {
  await mongoose.connect(env.MONGO_URI);
  const db = mongoose.connection.db;
  console.log(`DB: ${mongoose.connection.name}  mode: ${DRY_RUN ? 'PREVIEW (no writes)' : 'COMMIT'}`);

  const skus = await db.collection('skus').find({ unit: NOT_KGS }, { projection: { code: 1, unit: 1 } }).toArray();
  console.log(`\nskus to fix: ${skus.length}`);
  skus.forEach((s) => console.log(`  ${s._id}  ${s.code}  ${JSON.stringify(s.unit)} → "KGS"`));

  const plan = {};
  for (const coll of ['inventorystocks', 'inventorymovements', 'inventorypolicies', 'manualcoils']) {
    plan[coll] = await db.collection(coll)
      .find({ unit: NOT_KGS }, { projection: { skuCode: 1, unit: 1, movementNumber: 1, warehouse: 1 } })
      .toArray();
    console.log(`\n${coll} to fix: ${plan[coll].length}`);
    plan[coll].forEach((r) => console.log(`  ${r._id}  ${r.movementNumber || r.warehouse || ''}  ${r.skuCode || ''}  ${JSON.stringify(r.unit)} → "KGS"`));
  }

  if (DRY_RUN) {
    console.log('\nPreview only. Re-run with --commit to apply.');
  } else {
    const s = await db.collection('skus').updateMany(
      { _id: { $in: skus.map((x) => x._id) }, unit: NOT_KGS },
      { $set: { unit: 'KGS', updatedAt: new Date() } },
    );
    console.log(`\nskus updated: ${s.modifiedCount}`);
    for (const coll of Object.keys(plan)) {
      const r = await db.collection(coll).updateMany(
        { _id: { $in: plan[coll].map((x) => x._id) }, unit: NOT_KGS },
        { $set: { unit: 'KGS' } },
      );
      console.log(`${coll} updated: ${r.modifiedCount}`);
    }
  }
  await mongoose.disconnect();
};

run().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
