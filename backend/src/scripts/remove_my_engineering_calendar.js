/**
 * Remove the "M. Y. Enginnering Works" entries from the Dispatch Calendar.
 *
 * The calendar is drawn entirely from `dispatchschedules` — BOTH the scheduled
 * cards and the "Actual" cards read that one collection (actual cards come from
 * each phase's `actualDispatches`). So deleting the schedule document clears the
 * party from every calendar view at once. Orders, delivery challans and invoices
 * live in separate collections and are NOT touched.
 *
 * Safety:
 *   • Dry run by default — prints what it found and stops.
 *   • --apply writes a timestamped JSON backup of every document BEFORE deleting,
 *     so the delete can be undone with mongoimport if it turns out to be wrong.
 *
 * Usage:
 *   node src/scripts/remove_my_engineering_calendar.js                 # dry run
 *   node src/scripts/remove_my_engineering_calendar.js --apply         # delete
 *   node src/scripts/remove_my_engineering_calendar.js --apply --so "AGL/SO-089/26-27"
 */

import fs from 'fs';
import path from 'path';
import dns from 'dns';
import mongoose from 'mongoose';
import env from '../config/env.js';
import DispatchSchedule from '../modules/schedule/schedule.model.js';

// A mongodb+srv:// URI needs a DNS SRV lookup before it can connect at all. On a
// machine whose resolver is a local stub (127.0.0.1 — VPN clients and some
// corporate setups do this) that lookup dies with querySrv ECONNREFUSED and the
// connection never even starts. Fall back to public resolvers for SRV only.
const ensureSrvResolvable = async () => {
  const host = `_mongodb._tcp.${env.MONGO_URI.split('@')[1]?.split('/')[0]?.split('?')[0]}`;
  try {
    await dns.promises.resolveSrv(host);
  } catch (e) {
    console.log(`SRV lookup via system DNS (${dns.getServers().join(', ')}) failed: ${e.code}`);
    dns.setServers(['8.8.8.8', '1.1.1.1']);
    await dns.promises.resolveSrv(host);
    console.log('SRV resolved via public DNS (8.8.8.8) — continuing.\n');
  }
};

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const soIdx = args.indexOf('--so');
const SO = soIdx !== -1 ? args[soIdx + 1] : null;

// Matches "Enginnering" (the spelling in the data) and "Engineering" alike.
const PARTY = /engin+ering/i;

const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

const run = async () => {
  await ensureSrvResolvable();
  await mongoose.connect(env.MONGO_URI);
  console.log(`db: ${mongoose.connection.name}   mode: ${APPLY ? 'APPLY (deletes)' : 'DRY RUN'}\n`);

  const filter = SO ? { soNumber: SO } : { partyName: PARTY };
  const docs = await DispatchSchedule.find(filter).lean();

  if (!docs.length) {
    console.log('Nothing matched — no schedules to remove.');
    await mongoose.disconnect();
    return;
  }

  let cards = 0;
  docs.forEach((s) => {
    console.log(`schedule ${s._id}`);
    console.log(`  SO    : ${s.soNumber}`);
    console.log(`  party : ${s.partyName}`);
    (s.items || []).forEach((it) => {
      (it.phases || []).forEach((p) => {
        cards += 1;
        console.log(
          `    phase ${p.phaseNo}  ${iso(p.plannedDate)}  ${it.skuName}`
          + `  planned ${p.plannedQty}  actual ${p.totalActualQty || 0}`
          + `  ${p.status}  (${(p.actualDispatches || []).length} dispatch rows)`,
        );
      });
    });
    console.log('');
  });
  console.log(`${docs.length} schedule document(s), ${cards} phase row(s) → calendar cards.\n`);

  if (!APPLY) {
    console.log('Dry run — nothing deleted. Re-run with --apply to remove these.');
    await mongoose.disconnect();
    return;
  }

  // Backup first. A restore is: mongoimport --collection dispatchschedules --file <this>
  const dir = path.resolve('backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `dispatchschedules-my-engineering-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(docs, null, 2));
  console.log(`backup written: ${file}`);

  const res = await DispatchSchedule.deleteMany({ _id: { $in: docs.map((d) => d._id) } });
  console.log(`deleted ${res.deletedCount} schedule document(s).`);

  const left = await DispatchSchedule.countDocuments(filter);
  console.log(`remaining matches: ${left}${left === 0 ? '  ✓ calendar is clear' : '  ← check this'}`);

  await mongoose.disconnect();
};

run().catch((e) => { console.error(e); process.exit(1); });
