/**
 * Purge O2D TRAIL data — order intake → sales order → the full FMS pipeline
 * (steps 1.01 … 2.13): dispatch plan, delivery challans, sales invoices, client
 * payments, transport bills and shipments.
 *
 * KEEPS all master / config / other-module data: parties, SKUs, transporters,
 * FMS step definitions & task templates, PPC, IMS, procurement, pricing, users,
 * quotes, notifications, audit logs and the numbering counters.
 *
 * Every targeted collection is first exported to a timestamped JSON backup so the
 * delete is recoverable, then emptied with deleteMany({}).
 *
 * Dry run (counts only):   node src/scripts/purge_o2d_trial_data.js
 * Execute (backup+delete): node src/scripts/purge_o2d_trial_data.js --confirm
 */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import env from '../config/env.js';

// Only these collections are touched. Anything not listed here is left alone.
const TARGETS = [
  'orderintakes',
  'salesorders',
  'o2dprocesses',
  'dispatchschedules',
  'deliverychallans',
  'invoices',
  'payments',
  'transportbills',
  'shipments',
];

const BACKUP_DIR = process.env.O2D_PURGE_BACKUP_DIR
  || path.resolve(process.cwd(), 'o2d-purge-backup');

const run = async () => {
  const confirm = process.argv.includes('--confirm');
  await mongoose.connect(env.MONGO_URI);
  const db = mongoose.connection.db;
  console.log(`DB: ${mongoose.connection.name}`);
  console.log(confirm ? '── MODE: EXECUTE (backup + delete) ──\n' : '── MODE: DRY RUN (no changes) ──\n');

  let stamp = 'backup';
  if (confirm) {
    // Date.now()/new Date() are fine in a plain script (not a workflow).
    stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  let grandTotal = 0;
  for (const name of TARGETS) {
    const exists = await db.listCollections({ name }).hasNext();
    if (!exists) { console.log(`${' '.repeat(7)}—  ${name} (no such collection)`); continue; }
    const col = db.collection(name);
    const count = await col.countDocuments();
    grandTotal += count;

    if (!confirm) {
      console.log(`${String(count).padStart(7)}  ${name}  → would delete`);
      continue;
    }

    if (count > 0) {
      const docs = await col.find({}).toArray();
      const file = path.join(BACKUP_DIR, `${name}.${stamp}.json`);
      fs.writeFileSync(file, JSON.stringify(docs, null, 2));
    }
    const res = await col.deleteMany({});
    console.log(`${String(res.deletedCount).padStart(7)}  ${name}  → deleted (backed up ${count})`);
  }

  console.log(`\nTotal ${confirm ? 'deleted' : 'to delete'}: ${grandTotal} document(s) across ${TARGETS.length} collections.`);
  if (confirm) console.log(`Backups written to: ${BACKUP_DIR}`);
  else console.log('Re-run with --confirm to back up and delete.');

  await mongoose.connection.close();
  process.exit(0);
};
run().catch((e) => { console.error(e); process.exit(1); });
