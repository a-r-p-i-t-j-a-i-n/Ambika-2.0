/**
 * Post-import health check for the Machine / Machine Operator masters.
 *
 * Asserts the counts, the integrity of the derived Operator.machineCodes mirror
 * against the authoritative MachineOperatorAssignment collection, the presence
 * of every index the models declare, and the business cases the requirement
 * called out by name (a machine with many operators, an operator on many
 * machines).
 *
 * Read-only. Exits non-zero if any check fails.
 *
 * USAGE  node src/scripts/verifyMachineOperatorImport.js
 */
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import env from '../config/env.js';
import Machine from '../modules/masters/machines/machine.model.js';
import Operator from '../modules/masters/machine-operators/machineOperator.model.js';
import MachineOperatorAssignment from '../modules/masters/machine-operators/machineOperatorAssignment.model.js';

const live = { isDeleted: { $ne: true } };
let failures = 0;

const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const line = (ch = '─') => console.log(ch.repeat(78));
const head = (t) => { line('═'); console.log(t); line('═'); };

const run = async () => {
  await mongoose.connect(env.MONGO_URI);
  try {
    head('MACHINE / OPERATOR MASTER VERIFICATION');

    // ── Counts ────────────────────────────────────────────────
    const [machines, operators, assignments] = await Promise.all([
      Machine.countDocuments(live),
      Operator.countDocuments(live),
      MachineOperatorAssignment.countDocuments(live),
    ]);
    console.log('\nCounts');
    check('68 machines', machines === 68, `found ${machines}`);
    check('99 operators from the sheet (plus any pre-existing)', operators >= 99, `found ${operators}`);
    // The sheet contributes 94. Anything above that is legacy data the old CSV
    // seeder created and the import deliberately preserved rather than deleted
    // (e.g. "Kanhayalal", superseded by the sheet's "Kanhaya Lal").
    check('at least the sheet\'s 94 assignments', assignments >= 94, `found ${assignments}`);
    if (assignments > 94) {
      console.log(`        ${assignments - 94} legacy assignment(s) preserved from before the import — listed below.`);
    }

    // ── Derived fields ────────────────────────────────────────
    console.log('\nDerived fields');
    const badUid = await Machine.find(live).select('code name uid').lean()
      .then((rows) => rows.filter((m) => m.uid !== `${m.code} - ${m.name}`));
    check('every machine uid is "<code> - <name>"', badUid.length === 0,
      badUid.length ? badUid.slice(0, 3).map((m) => `${m.code}:"${m.uid}"`).join(', ') : '');

    const noName = await Machine.countDocuments({ ...live, $or: [{ name: '' }, { name: null }] });
    check('no machine is left without a name', noName === 0, `${noName} nameless`);

    const statusMismatch = await Machine.find(live).select('code machineStatus isActive').lean()
      .then((rows) => rows.filter((m) => m.isActive !== (m.machineStatus === 'IN_USE')));
    check('isActive tracks machineStatus', statusMismatch.length === 0,
      statusMismatch.map((m) => m.code).join(', '));

    // ── The mirror vs the authority ───────────────────────────
    console.log('\nOperator.machineCodes mirror vs the assignment collection');
    const ops = await Operator.find(live).select('name machineCodes').lean();
    const drift = [];
    for (const o of ops) {
      const rows = await MachineOperatorAssignment
        .find({ operatorId: o._id, isDeleted: { $ne: true } }).select('machineCode').lean();
      const truth = [...new Set(rows.map((r) => r.machineCode))].sort();
      const mirror = [...(o.machineCodes || [])].sort();
      if (JSON.stringify(truth) !== JSON.stringify(mirror)) {
        drift.push(`${o.name}: mirror[${mirror}] vs assignments[${truth}]`);
      }
    }
    check('no operator mirror disagrees with its assignments', drift.length === 0,
      drift.slice(0, 5).join(' | '));

    const orphanAssign = await MachineOperatorAssignment.find(live).lean()
      .then(async (rows) => {
        const bad = [];
        for (const r of rows) {
          const [m, o] = await Promise.all([
            Machine.exists({ _id: r.machineId }), Operator.exists({ _id: r.operatorId }),
          ]);
          if (!m || !o) bad.push(String(r._id));
        }
        return bad;
      });
    check('no assignment points at a missing master', orphanAssign.length === 0, orphanAssign.join(', '));

    const codeDrift = await MachineOperatorAssignment.find(live).populate('machineId', 'code').lean()
      .then((rows) => rows.filter((r) => r.machineId && r.machineId.code !== r.machineCode));
    check('denormalised machineCode matches its machine', codeDrift.length === 0, `${codeDrift.length} stale`);

    // ── Indexes ───────────────────────────────────────────────
    console.log('\nIndexes');
    const idxNames = async (Model) => (await Model.collection.indexes()).map((i) => i.name);
    const mIdx = await idxNames(Machine);
    const oIdx = await idxNames(Operator);
    const aIdx = await idxNames(MachineOperatorAssignment);
    check('machines.code unique', mIdx.includes('code_1'), mIdx.join(', '));
    check('operators.nameKey unique', oIdx.includes('nameKey_1'), oIdx.join(', '));
    check('assignment (machineId, operatorId) unique', aIdx.includes('machineId_1_operatorId_1'), aIdx.join(', '));

    const uniqueOnCode = (await Machine.collection.indexes()).find((i) => i.name === 'code_1')?.unique;
    check('machines.code index is actually unique', uniqueOnCode === true);
    const assignIdx = (await MachineOperatorAssignment.collection.indexes())
      .find((i) => i.name === 'machineId_1_operatorId_1');
    check('assignment index is unique and partial on isDeleted:false',
      assignIdx?.unique === true && !!assignIdx?.partialFilterExpression);

    // ── Business cases from the requirement ───────────────────
    console.log('\nBusiness cases');
    const opsOf = async (code) => {
      const m = await Machine.findOne({ code, ...live }).lean();
      if (!m) return null;
      const rows = await MachineOperatorAssignment
        .find({ machineId: m._id, isDeleted: { $ne: true } }).populate('operatorId', 'name').lean();
      return rows.map((r) => r.operatorId?.name).filter(Boolean).sort();
    };
    const machinesOf = async (name) => {
      const o = await Operator.findOne({ name, ...live }).lean();
      if (!o) return null;
      const rows = await MachineOperatorAssignment
        .find({ operatorId: o._id, isDeleted: { $ne: true } }).lean();
      return rows.map((r) => r.machineCode).sort();
    };

    const dap01 = await opsOf('DAP01');
    check('DAP01 has exactly Appoo + Bal Govind',
      JSON.stringify(dap01) === JSON.stringify(['Appoo', 'Bal Govind']), JSON.stringify(dap01));

    const appoo = await machinesOf('Appoo');
    check('Appoo runs DAP01 and HYP04',
      JSON.stringify(appoo) === JSON.stringify(['DAP01', 'HYP04']), JSON.stringify(appoo));

    check('HYP02 has 7 operators', (await opsOf('HYP02'))?.length === 7);
    check('C05 has 8 operators', (await opsOf('C05'))?.length === 8);
    check('HYP01 is NOT_IN_USE and unmanned',
      (await Machine.findOne({ code: 'HYP01' }).lean())?.machineStatus === 'NOT_IN_USE'
      && (await opsOf('HYP01'))?.length === 0);

    const packing = await Operator.countDocuments({ ...live, department: 'Packing', machineCodes: { $size: 0 } });
    check('9 Packing operators carry no machine', packing === 9, `found ${packing}`);

    // ── Legacy rows the sheet does not mention ────────────────
    const { parseMachineOperatorWorkbook } = await import('./importMachineOperatorMaster.js');
    const sheetPath = new URL('../../../excel/machine and operator.xlsx', import.meta.url);
    let parsed = null;
    try { parsed = parseMachineOperatorWorkbook(decodeURIComponent(sheetPath.pathname).replace(/^\//, '')); } catch { /* sheet not reachable from here */ }
    if (parsed) {
      const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const sheetPairs = new Set(parsed.assignments.map((a) => `${a.code}|${a.nameKey}`));
      const sheetOps = new Set(parsed.operators.map((o) => o.nameKey));
      const rows = await MachineOperatorAssignment.find(live).populate('operatorId', 'name').lean();
      const legacyLinks = rows.filter((r) => !sheetPairs.has(`${r.machineCode}|${norm(r.operatorId?.name)}`));
      const legacyOps = (await Operator.find(live).select('name').lean()).filter((o) => !sheetOps.has(norm(o.name)));

      console.log('\nLegacy data preserved (present in the database, absent from the sheet)');
      console.log(`  operators   : ${legacyOps.length ? legacyOps.map((o) => o.name).join(', ') : 'none'}`);
      console.log(`  assignments : ${legacyLinks.length ? legacyLinks.map((r) => `${r.machineCode} -> ${r.operatorId?.name}`).join(', ') : 'none'}`);
      console.log('  These are kept on purpose — the import never deletes. Retire them from the UI if they are superseded.');
    }

    head(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  } finally {
    await mongoose.disconnect();
  }
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((e) => { console.error(e); process.exit(1); });
