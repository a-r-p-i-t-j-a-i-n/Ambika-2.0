/**
 * Clean the literal string "undefined" out of InventoryMovement.reason /
 * customReason.
 *
 * A handful of legacy rows carry the word "undefined" where a reason should be —
 * a JavaScript `undefined` that was stringified on its way into the database.
 * Nothing reading the ledger can tell those apart from a reason somebody typed.
 *
 * The write path that produced them is already fixed (inventory.service →
 * ledgerText), so this is a one-off tidy of the rows that exist, not a recurring
 * job. It only ever blanks a field whose entire value is that one word; it never
 * deletes a movement, never touches a quantity, and never changes stock — so it
 * cannot move a balance or break the ledger reconciliation.
 *
 * DRY RUN BY DEFAULT. It reports what it would change and exits. Pass --apply to
 * write, and only against a database you are meant to write to.
 *
 *   node src/scripts/cleanup_undefined_movement_reasons.js            # report
 *   node src/scripts/cleanup_undefined_movement_reasons.js --apply    # write
 */
import mongoose from 'mongoose';
import env from '../config/env.js';
import InventoryMovement from '../modules/inventory/inventoryMovement.model.js';

const BAD = ['undefined', 'null'];
const apply = process.argv.includes('--apply');

const run = async () => {
  await mongoose.connect(env.MONGO_URI);
  console.log(`database: ${mongoose.connection.name}`);
  console.log(apply ? 'mode: APPLY (rows will be written)' : 'mode: DRY RUN (nothing will be written)');

  const filter = { $or: [{ reason: { $in: BAD } }, { customReason: { $in: BAD } }] };
  const rows = await InventoryMovement.find(filter)
    .select('movementNumber movementDate skuCode txnType sourceModule reason customReason remarks')
    .sort({ movementDate: 1 }).lean();

  if (!rows.length) { console.log('nothing to clean.'); await mongoose.disconnect(); return; }

  console.log(`\n${rows.length} movement(s) affected:`);
  for (const r of rows) {
    console.log(`  ${r.movementNumber}  ${r.skuCode}  ${r.txnType}  ${r.sourceModule || '-'}  `
      + `reason=${JSON.stringify(r.reason)} customReason=${JSON.stringify(r.customReason)}  `
      + `date=${r.movementDate?.toISOString().slice(0, 10)}`);
  }

  if (!apply) {
    console.log('\nDry run — re-run with --apply to blank these two fields on the rows above.');
    await mongoose.disconnect();
    return;
  }

  // Two targeted updates, so a row whose reason is real but whose customReason
  // is the stray word keeps its reason.
  const a = await InventoryMovement.updateMany({ reason: { $in: BAD } }, { $set: { reason: '' } });
  const b = await InventoryMovement.updateMany({ customReason: { $in: BAD } }, { $set: { customReason: '' } });
  console.log(`\nreason cleared on ${a.modifiedCount} row(s); customReason cleared on ${b.modifiedCount} row(s).`);
  await mongoose.disconnect();
};

run().catch(async (e) => { console.error(e); await mongoose.disconnect(); process.exit(1); });
