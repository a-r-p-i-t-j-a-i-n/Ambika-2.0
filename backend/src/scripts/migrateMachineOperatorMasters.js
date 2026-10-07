/**
 * One-shot migration: move the pre-existing PPC Machine / Operator collections
 * onto the Master Data shape.
 *
 * Those two collections were seeded from the old two-column CSV and carry an
 * ad-hoc `active` flag, no `isActive`, no `machineStatus`, no `uid`, no
 * `nameKey`, and record the machine↔operator link as a `machineCodes` array on
 * the operator. This script:
 *
 *   1. copies  active → isActive  on both collections
 *   2. seeds   machineStatus + uid on machines
 *   3. backfills nameKey on operators, MERGING any that collide once normalized
 *   4. materialises MachineOperatorAssignment rows from the existing
 *      machineCodes, so nothing recorded on the old shape is lost
 *   5. syncs the indexes (the unique nameKey index cannot build until step 3 has
 *      run, which is why the backfill uses the raw collection)
 *
 * Non-destructive: it never deletes a machine or an operator. Merged duplicate
 * operators are soft-deleted, not removed, and are reported.
 *
 * Idempotent — safe to re-run. Run it BEFORE importMachineOperatorMaster.js.
 *
 * USAGE
 *   node src/scripts/migrateMachineOperatorMasters.js            # preview
 *   node src/scripts/migrateMachineOperatorMasters.js --commit
 */
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import env from '../config/env.js';
import Machine, { buildMachineUid } from '../modules/masters/machines/machine.model.js';
import Operator, { operatorNameKey } from '../modules/masters/machine-operators/machineOperator.model.js';
import MachineOperatorAssignment from '../modules/masters/machine-operators/machineOperatorAssignment.model.js';

const line = (ch = '─') => console.log(ch.repeat(78));
const head = (t) => { line('═'); console.log(t); line('═'); };

const run = async () => {
  const doCommit = process.argv.slice(2).includes('--commit');

  head('MACHINE / OPERATOR MASTER MIGRATION');
  console.log(`  Mode : ${doCommit ? 'COMMIT' : 'PREVIEW (pass --commit to write)'}`);

  await mongoose.connect(env.MONGO_URI);
  const db = mongoose.connection.db;
  // Raw collections on purpose: the documents are not yet valid against the new
  // schemas, so they must be repaired before any model-level write touches them.
  const machinesRaw = db.collection('machines');
  const operatorsRaw = db.collection('operators');

  try {
    // ── 1/2. Machines ───────────────────────────────────────────
    const machines = await machinesRaw.find({}).toArray();
    const machineOps = [];
    let namelessMachines = 0;

    for (const m of machines) {
      const set = {};
      if (m.isActive === undefined) set.isActive = m.active !== false;
      if (!m.machineStatus) set.machineStatus = (m.active === false) ? 'NOT_IN_USE' : 'IN_USE';
      if (!m.uid) set.uid = buildMachineUid(m.code, m.name);
      if (m.capacity === undefined) set.capacity = '';
      if (m.make === undefined) set.make = '';
      if (m.installationYear === undefined) set.installationYear = null;
      if (!m.name) namelessMachines += 1;
      if (Object.keys(set).length) {
        machineOps.push({ updateOne: { filter: { _id: m._id }, update: { $set: set, $unset: { active: '' } } } });
      }
    }
    console.log(`\n  Machines: ${machines.length} total, ${machineOps.length} need migrating`);
    if (namelessMachines) {
      console.log(`    ${namelessMachines} have no name — the old CSV seeder never set one.`);
      console.log('    importMachineOperatorMaster.js fills these from the Excel sheet.');
    }

    // ── 3. Operators: backfill nameKey, merging normalized collisions ──
    const operators = await operatorsRaw.find({}).toArray();
    const byKey = new Map();
    const merges = [];
    for (const o of operators) {
      const key = operatorNameKey(o.name);
      if (!byKey.has(key)) { byKey.set(key, o); continue; }
      merges.push({ keep: byKey.get(key), drop: o, key });
    }
    console.log(`\n  Operators: ${operators.length} total, ${byKey.size} distinct once normalized`);
    if (merges.length) {
      console.log(`    ${merges.length} collide and will be merged (the duplicate is soft-deleted, never removed):`);
      merges.forEach((m) => console.log(`      "${m.drop.name}" → "${m.keep.name}"`));
    }

    const operatorOps = [];
    for (const [key, o] of byKey) {
      const set = { nameKey: key };
      if (o.isActive === undefined) set.isActive = o.active !== false;
      if (!o.departments?.length) set.departments = o.department ? [o.department] : [];
      // Fold any merged twin's machineCodes into the survivor.
      const twins = merges.filter((m) => m.key === key);
      if (twins.length) {
        const codes = new Set([...(o.machineCodes || [])]);
        twins.forEach((t) => (t.drop.machineCodes || []).forEach((c) => codes.add(c)));
        set.machineCodes = [...codes];
      }
      operatorOps.push({ updateOne: { filter: { _id: o._id }, update: { $set: set, $unset: { active: '' } } } });
    }
    for (const m of merges) {
      operatorOps.push({
        updateOne: {
          filter: { _id: m.drop._id },
          update: {
            $set: {
              isDeleted: true, isActive: false, deletedAt: new Date(),
              nameKey: `${m.key}#merged-${String(m.drop._id).slice(-6)}`,
              remarks: `Merged into "${m.keep.name}" during the Master Data migration.`,
            },
            $unset: { active: '' },
          },
        },
      });
    }

    // ── 4. Assignments from the old machineCodes arrays ──────────
    const codeToId = new Map(machines.map((m) => [String(m.code).toUpperCase(), m._id]));
    const planned = [];
    const unmatched = [];
    for (const [, o] of byKey) {
      const codes = new Set(o.machineCodes || []);
      merges.filter((m) => operatorNameKey(m.keep.name) === operatorNameKey(o.name))
        .forEach((t) => (t.drop.machineCodes || []).forEach((c) => codes.add(c)));
      for (const rawCode of codes) {
        const code = String(rawCode).toUpperCase();
        const machineId = codeToId.get(code);
        if (!machineId) { unmatched.push({ operator: o.name, code }); continue; }
        planned.push({ machineId, operatorId: o._id, machineCode: code });
      }
    }
    console.log(`\n  Assignments derivable from the existing machineCodes: ${planned.length}`);
    if (unmatched.length) {
      console.log(`    ${unmatched.length} reference a machine code that does not exist — left alone, not invented:`);
      unmatched.forEach((u) => console.log(`      ${u.operator} → ${u.code}`));
    }

    if (!doCommit) {
      head('PREVIEW ONLY — nothing was written. Re-run with --commit to apply.');
      return;
    }

    // ── Apply ───────────────────────────────────────────────────
    if (machineOps.length) await machinesRaw.bulkWrite(machineOps, { ordered: false });
    if (operatorOps.length) await operatorsRaw.bulkWrite(operatorOps, { ordered: false });

    let created = 0;
    for (const p of planned) {
      const res = await MachineOperatorAssignment.updateOne(
        { machineId: p.machineId, operatorId: p.operatorId },
        { $setOnInsert: { ...p, isDeleted: false, isActive: true, assignedAt: new Date() } },
        { upsert: true },
      );
      if (res.upsertedCount) created += 1;
    }

    // ── 5. Indexes (safe only now that nameKey is populated) ─────
    await Machine.syncIndexes();
    await Operator.syncIndexes();
    await MachineOperatorAssignment.syncIndexes();

    head('WRITE RESULT');
    console.log(`  Machines migrated   : ${machineOps.length}`);
    console.log(`  Operators migrated  : ${operatorOps.length} (including ${merges.length} soft-deleted duplicates)`);
    console.log(`  Assignments created : ${created} (of ${planned.length} derived; the rest already existed)`);
    console.log('  Indexes synced on machines, operators, machineoperatorassignments');
  } finally {
    await mongoose.disconnect();
  }
  head('DONE');
};

run().catch((e) => { console.error(e); process.exit(1); });
