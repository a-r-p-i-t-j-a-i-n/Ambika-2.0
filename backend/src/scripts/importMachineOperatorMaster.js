/**
 * Import the Machine and Machine Operator masters from the client's sheet.
 *
 *   Source:  excel/"machine and operator.xlsx"
 *   Sheet:   "Machine Name with Code & Operat"
 *   Writes:  Machine, Operator, MachineOperatorAssignment
 *
 * WHAT IS IMPORTED
 * ────────────────
 * Columns A–N only — the machine grid. Every machine field maps to a real
 * column; nothing is invented. One machine per distinct Machine Code, however
 * many times the code repeats (a repeat means another operator, not another
 * machine: DAP01 appears twice because Appoo and Bal Govind both run it).
 *
 * WHAT IS DELIBERATELY NOT IMPORTED
 * ─────────────────────────────────
 * Columns R–S ("Machine Operator Name" / "Department") and U–V ("Machine Code" /
 * "Operator") are a superseded working area, not a second master. Reconciled
 * against the grid they agree on only 4 of 28 populated pairs, cover 42 of the
 * 68 machines, stop at row 81, and use a different department vocabulary
 * ("Circle Press", "Gutlee", "Rib") than column E. They are read only so the
 * disagreements can be reported, and are never written to the database.
 *
 * IDEMPOTENCY
 * ───────────
 * Natural keys: machine → code, operator → normalized name, assignment →
 * (machineId, operatorId). Re-running changes nothing. Where a value already in
 * the database differs from the sheet — i.e. somebody edited it in the UI — the
 * difference is REPORTED and left alone; pass --overwrite to take the sheet's
 * value instead. Nothing is ever deleted.
 *
 * USAGE
 *   node src/scripts/importMachineOperatorMaster.js               # preview (default)
 *   node src/scripts/importMachineOperatorMaster.js --commit
 *   node src/scripts/importMachineOperatorMaster.js --commit --overwrite
 *   node src/scripts/importMachineOperatorMaster.js --file "path/to/sheet.xlsx"
 */
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import XLSX from 'xlsx';

import env from '../config/env.js';
import Machine, { deriveMachineFields, normalizeMachineStatus } from '../modules/masters/machines/machine.model.js';
import { machineTypeFromCode } from '../modules/masters/machines/machineType.js';
import Operator, { operatorNameKey } from '../modules/masters/machine-operators/machineOperator.model.js';
import MachineOperatorAssignment from '../modules/masters/machine-operators/machineOperatorAssignment.model.js';
import { syncOperatorMachineCodes } from '../modules/masters/machine-operators/assignment.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const IMPORT_SOURCE = 'machine-and-operator-xlsx';

const DEFAULT_FILES = [
  path.resolve(__dirname, '../../../excel/machine and operator.xlsx'),
  path.resolve(__dirname, '../../excel/machine and operator.xlsx'),
];

// Fixed column positions on the machine grid (block A).
const COL = {
  name: 0, code: 1, operator: 2, uid: 3, department: 4, make: 5,
  capacity: 6, installationYear: 7, status: 8, amc: 9,
  maintenanceManual: 10, maintenanceManualType: 11,
  dailyClit: 12, halfYearlyPm: 13,
};
// The superseded side blocks, read for reporting only.
const SIDE = { operatorName: 17, operatorDept: 18, machineCode: 20, operator: 21 };

const s = (v) => (v === null || v === undefined ? '' : String(v).trim());
const yn = (v) => {
  const t = s(v).toLowerCase();
  if (!t) return '';
  if (t === 'y' || t === 'yes') return 'YES';
  if (t === 'n' || t === 'no') return 'NO';
  return '';
};
const isLink = (v) => /^https?:\/\//i.test(s(v));

/**
 * Column M is headed "Daily CLIT Sheet (Y/N) Attach Link" and column N
 * "Half Yearly PM(Y/N) Check sheet link", but in practice M holds only URLs and
 * N holds only "No" — so each is read as flag + optional link rather than
 * trusting the header.
 */
const flagAndLink = (raw) => {
  const v = s(raw);
  if (!v) return { flag: false, link: '' };
  if (isLink(v)) return { flag: true, link: v };
  return { flag: yn(v) === 'YES', link: '' };
};

/**
 * Parse the workbook into machines / operators / assignments plus everything
 * worth reporting. Pure: no database, no logging — so it is testable.
 */
export const parseMachineOperatorWorkbook = (filePath) => {
  const wb = XLSX.readFile(filePath, { raw: false });
  const sheetName = wb.SheetNames.find((n) => /machine/i.test(n)) || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1, raw: false, defval: null, blankrows: true,
  });
  const body = rows.slice(1);

  const machines = new Map();    // code -> machine record
  const operators = new Map();   // nameKey -> operator record
  const assignments = new Map(); // `${code}|${nameKey}` -> { code, nameKey }

  const issues = {
    fieldConflicts: [],
    ghostRows: [],
    trailingWhitespaceNames: new Set(),
    duplicateOperatorRows: [],
    unparsedCapacity: [],
    sideBlockConflicts: [],
    sideBlockOnlyOperators: new Set(),
  };

  body.forEach((rowRaw, i) => {
    const row = rowRaw || [];
    const excelRow = i + 2;           // 1-based, and +1 for the header
    const code = s(row[COL.code]).toUpperCase();
    const operatorRaw = row[COL.operator];
    const operatorName = s(operatorRaw);

    // ── Ghost rows: department/status only, no machine and no operator ──
    if (!code && !operatorName) {
      if (row.slice(0, 14).some((c) => s(c) !== '')) {
        issues.ghostRows.push({ excelRow, department: s(row[COL.department]) });
      }
      return;
    }

    if (operatorRaw !== null && String(operatorRaw) !== operatorName) {
      issues.trailingWhitespaceNames.add(String(operatorRaw));
    }

    // ── Operator ────────────────────────────────────────────────
    let nameKey = '';
    if (operatorName) {
      nameKey = operatorNameKey(operatorName);
      const dept = s(row[COL.department]);
      if (!operators.has(nameKey)) {
        operators.set(nameKey, {
          nameKey, name: operatorName, departments: new Set(), rows: [],
        });
      }
      const op = operators.get(nameKey);
      if (dept) op.departments.add(dept);
      op.rows.push(excelRow);
      if (!code) {
        // An operator row with no machine. A second such row for the same
        // person is a duplicate entry in the sheet, not a second worker.
        const priorMachineless = op.rows.length > 1;
        if (priorMachineless) issues.duplicateOperatorRows.push({ excelRow, name: operatorName });
      }
    }

    if (!code) return;

    // ── Machine ─────────────────────────────────────────────────
    const clit = flagAndLink(row[COL.dailyClit]);
    const pm = flagAndLink(row[COL.halfYearlyPm]);
    const yearRaw = s(row[COL.installationYear]);
    const year = yearRaw ? Number(yearRaw) : null;

    const candidate = {
      code,
      name: s(row[COL.name]),
      department: s(row[COL.department]),
      make: s(row[COL.make]),
      capacity: s(row[COL.capacity]),
      installationYear: Number.isFinite(year) ? year : null,
      machineStatus: normalizeMachineStatus(row[COL.status]),
      amc: yn(row[COL.amc]),
      maintenanceManual: yn(row[COL.maintenanceManual]),
      maintenanceManualType: s(row[COL.maintenanceManualType]),
      dailyClitSheet: clit.flag,
      dailyClitLink: clit.link,
      halfYearlyPm: pm.flag,
      halfYearlyPmLink: pm.link,
      sheetUid: s(row[COL.uid]),
    };

    if (!machines.has(code)) {
      machines.set(code, { ...candidate, firstRow: excelRow, rows: [excelRow] });
    } else {
      // Repeated code = another operator. Flag any scalar that disagrees; the
      // first occurrence wins so the import stays deterministic.
      const existing = machines.get(code);
      existing.rows.push(excelRow);
      for (const field of [
        'name', 'department', 'make', 'capacity', 'installationYear',
        'machineStatus', 'amc', 'maintenanceManual', 'maintenanceManualType',
      ]) {
        if (String(existing[field] ?? '') !== String(candidate[field] ?? '')) {
          issues.fieldConflicts.push({
            code, field,
            kept: existing[field], keptRow: existing.firstRow,
            ignored: candidate[field], ignoredRow: excelRow,
          });
        }
      }
    }

    if (nameKey) assignments.set(`${code}|${nameKey}`, { code, nameKey });
  });

  // Capacities with no clean numeric+unit parse (e.g. the unit-less "4.5"/"3.5").
  for (const m of machines.values()) {
    const { capacityValue, capacityUnit } = deriveMachineFields(m);
    if (m.capacity && (capacityValue === null || !capacityUnit)) {
      issues.unparsedCapacity.push({ code: m.code, capacity: m.capacity, parsedValue: capacityValue, parsedUnit: capacityUnit || '(none)' });
    }
  }

  // ── Reconcile the superseded side blocks, for reporting only ──
  const gridByCode = new Map();
  for (const { code, nameKey } of assignments.values()) {
    if (!gridByCode.has(code)) gridByCode.set(code, new Set());
    gridByCode.get(code).add(nameKey);
  }
  const allNameKeys = new Set(operators.keys());
  const displayName = (key) => operators.get(key)?.name || key;
  body.forEach((rowRaw, i) => {
    const row = rowRaw || [];
    const excelRow = i + 2;
    const sideName = s(row[SIDE.operatorName]);
    if (sideName && !allNameKeys.has(operatorNameKey(sideName))) {
      issues.sideBlockOnlyOperators.add(sideName);
    }
    const code = s(row[SIDE.machineCode]).toUpperCase();
    const op = s(row[SIDE.operator]);
    if (!code || !op) return;
    const gridOps = gridByCode.get(code);
    if (!gridOps) return;
    if (!gridOps.has(operatorNameKey(op))) {
      issues.sideBlockConflicts.push({
        excelRow, code, sideOperator: op,
        gridOperators: [...gridOps].map(displayName).join(', '),
      });
    }
  });

  const machineList = [...machines.values()].map((m) => {
    const { rows, firstRow, sheetUid, ...rest } = m;
    return { ...rest, machineType: machineTypeFromCode(m.code), sourceRows: rows, sheetUid };
  });
  const operatorList = [...operators.values()].map((o) => ({
    nameKey: o.nameKey,
    name: o.name,
    department: [...o.departments][0] || '',
    departments: [...o.departments],
    sourceRows: o.rows,
  }));

  return {
    sheetName,
    machines: machineList,
    operators: operatorList,
    assignments: [...assignments.values()],
    issues: {
      ...issues,
      trailingWhitespaceNames: [...issues.trailingWhitespaceNames],
      sideBlockOnlyOperators: [...issues.sideBlockOnlyOperators],
      machinesWithoutOperator: machineList
        .filter((m) => ![...assignments.values()].some((a) => a.code === m.code))
        .map((m) => m.code),
      operatorsWithoutMachine: operatorList
        .filter((o) => ![...assignments.values()].some((a) => a.nameKey === o.nameKey))
        .map((o) => o.name),
      crossDepartmentOperators: operatorList
        .filter((o) => o.departments.length > 1)
        .map((o) => ({ name: o.name, departments: o.departments })),
    },
  };
};

// ── Reporting ──────────────────────────────────────────────────────────────────
const line = (ch = '─') => console.log(ch.repeat(78));
const head = (title) => { line('═'); console.log(title); line('═'); };

const printReport = (parsed) => {
  const { machines, operators, assignments, issues } = parsed;
  head('PARSED FROM SHEET');
  console.log(`  Sheet                : ${parsed.sheetName}`);
  console.log(`  Machines             : ${machines.length}`);
  console.log(`  Operators            : ${operators.length}`);
  console.log(`  Assignments          : ${assignments.length}`);

  head('DATA ISSUES (reported, not silently resolved)');

  if (issues.fieldConflicts.length) {
    console.log(`\n  Conflicting values across repeated machine codes (${issues.fieldConflicts.length}):`);
    issues.fieldConflicts.forEach((c) => console.log(
      `    ${c.code.padEnd(8)} ${c.field.padEnd(18)} kept "${c.kept}" (row ${c.keptRow})  ignored "${c.ignored}" (row ${c.ignoredRow})`,
    ));
  } else {
    console.log('\n  Conflicting values across repeated machine codes: none');
  }

  console.log(`\n  Ghost rows skipped (no machine, no operator): ${issues.ghostRows.length}`);
  issues.ghostRows.forEach((g) => console.log(`    row ${g.excelRow} — department "${g.department}" only`));

  console.log(`\n  Operator names with stray whitespace (trimmed): ${issues.trailingWhitespaceNames.length}`);
  issues.trailingWhitespaceNames.forEach((n) => console.log(`    "${n}"`));

  console.log(`\n  Duplicate operator rows collapsed: ${issues.duplicateOperatorRows.length}`);
  issues.duplicateOperatorRows.forEach((d) => console.log(`    row ${d.excelRow} — ${d.name}`));

  console.log(`\n  Operators with no machine: ${issues.operatorsWithoutMachine.length}`);
  if (issues.operatorsWithoutMachine.length) console.log(`    ${issues.operatorsWithoutMachine.join(', ')}`);

  console.log(`\n  Machines with no operator: ${issues.machinesWithoutOperator.length}`);
  if (issues.machinesWithoutOperator.length) console.log(`    ${issues.machinesWithoutOperator.join(', ')}`);

  console.log(`\n  Operators spanning more than one department: ${issues.crossDepartmentOperators.length}`);
  issues.crossDepartmentOperators.forEach((o) => console.log(`    ${o.name}: ${o.departments.join(' | ')}`));

  console.log(`\n  Capacities without a clean value+unit: ${issues.unparsedCapacity.length}`);
  issues.unparsedCapacity.forEach((c) => console.log(`    ${c.code.padEnd(8)} "${c.capacity}" → value ${c.parsedValue}, unit ${c.parsedUnit}`));

  head('SUPERSEDED SIDE BLOCKS (columns R–S and U–V) — NOT IMPORTED');
  console.log(`  Pairs disagreeing with the machine grid: ${issues.sideBlockConflicts.length}`);
  issues.sideBlockConflicts.forEach((c) => console.log(
    `    row ${String(c.excelRow).padStart(4)}  ${c.code.padEnd(7)} side says "${c.sideOperator}"  |  grid says [${c.gridOperators}]`,
  ));
  console.log(`\n  Operator names appearing only in the side blocks: ${issues.sideBlockOnlyOperators.length}`);
  if (issues.sideBlockOnlyOperators.length) {
    console.log(`    ${issues.sideBlockOnlyOperators.map((n) => `"${n}"`).join(', ')}`);
  }
};

// ── Database write ─────────────────────────────────────────────────────────────

/** Fields the sheet owns. Anything else on the document is left alone. */
const SHEET_OWNED = [
  'name', 'department', 'make', 'capacity', 'installationYear', 'machineStatus',
  'amc', 'maintenanceManual', 'maintenanceManualType',
  'dailyClitSheet', 'dailyClitLink', 'halfYearlyPm', 'halfYearlyPmLink',
];

const commit = async (parsed, { overwrite }) => {
  const stats = {
    machinesCreated: 0, machinesUpdated: 0, machinesUnchanged: 0,
    operatorsCreated: 0, operatorsUpdated: 0, operatorsUnchanged: 0,
    assignmentsCreated: 0, assignmentsExisting: 0,
    divergences: [],
  };

  // ── Machines ──────────────────────────────────────────────────
  const machineIdByCode = new Map();
  for (const m of parsed.machines) {
    const existing = await Machine.findOne({ code: m.code });
    if (!existing) {
      const doc = await Machine.create({
        code: m.code,
        machineType: m.machineType,
        ...Object.fromEntries(SHEET_OWNED.map((f) => [f, m[f]])),
      });
      machineIdByCode.set(m.code, doc._id);
      stats.machinesCreated += 1;
      continue;
    }

    machineIdByCode.set(m.code, existing._id);
    let dirty = false;
    for (const field of SHEET_OWNED) {
      const sheetVal = m[field];
      const dbVal = existing[field];
      const same = String(dbVal ?? '') === String(sheetVal ?? '');
      if (same) continue;

      const dbIsEmpty = dbVal === null || dbVal === undefined || dbVal === '' || dbVal === false;
      if (dbIsEmpty || overwrite) {
        existing[field] = sheetVal;
        dirty = true;
      } else {
        // Somebody changed this in the UI. Report it; do not clobber.
        stats.divergences.push({ code: m.code, field, db: dbVal, sheet: sheetVal });
      }
    }
    if (!existing.machineType) { existing.machineType = m.machineType; dirty = true; }
    if (existing.isDeleted) { existing.isDeleted = false; existing.deletedAt = null; dirty = true; }
    if (dirty) { await existing.save(); stats.machinesUpdated += 1; } else { stats.machinesUnchanged += 1; }
  }

  // ── Operators ─────────────────────────────────────────────────
  const operatorIdByKey = new Map();
  for (const o of parsed.operators) {
    const existing = await Operator.findOne({ nameKey: o.nameKey });
    if (!existing) {
      const doc = await Operator.create({
        name: o.name, nameKey: o.nameKey,
        department: o.department, departments: o.departments,
        machineCodes: [],
      });
      operatorIdByKey.set(o.nameKey, doc._id);
      stats.operatorsCreated += 1;
      continue;
    }
    operatorIdByKey.set(o.nameKey, existing._id);
    let dirty = false;
    if (existing.name !== o.name) { existing.name = o.name; dirty = true; }
    if (!existing.department && o.department) { existing.department = o.department; dirty = true; }
    const deptUnion = [...new Set([...(existing.departments || []), ...o.departments])];
    if (deptUnion.length !== (existing.departments || []).length) { existing.departments = deptUnion; dirty = true; }
    if (existing.isDeleted) { existing.isDeleted = false; existing.deletedAt = null; dirty = true; }
    if (dirty) { await existing.save(); stats.operatorsUpdated += 1; } else { stats.operatorsUnchanged += 1; }
  }

  // ── Assignments ───────────────────────────────────────────────
  const touchedOperators = new Set();
  for (const a of parsed.assignments) {
    const machineId = machineIdByCode.get(a.code);
    const operatorId = operatorIdByKey.get(a.nameKey);
    if (!machineId || !operatorId) continue;

    const existing = await MachineOperatorAssignment.findOne({ machineId, operatorId });
    if (existing) {
      if (existing.isDeleted) {
        existing.isDeleted = false;
        existing.isActive = true;
        existing.deletedAt = null;
        existing.machineCode = a.code;
        await existing.save();
        stats.assignmentsCreated += 1;
      } else {
        stats.assignmentsExisting += 1;
      }
    } else {
      await MachineOperatorAssignment.create({ machineId, operatorId, machineCode: a.code });
      stats.assignmentsCreated += 1;
    }
    touchedOperators.add(String(operatorId));
  }

  for (const operatorId of touchedOperators) await syncOperatorMachineCodes(operatorId);

  // ── Anything already in the database that the sheet does not mention ──
  const sheetCodes = new Set(parsed.machines.map((m) => m.code));
  const sheetKeys = new Set(parsed.operators.map((o) => o.nameKey));
  const orphanMachines = (await Machine.find({ isDeleted: { $ne: true } }).select('code').lean())
    .filter((m) => !sheetCodes.has(m.code)).map((m) => m.code);
  const orphanOperators = (await Operator.find({ isDeleted: { $ne: true } }).select('name nameKey').lean())
    .filter((o) => !sheetKeys.has(o.nameKey)).map((o) => o.name);

  return { stats, orphanMachines, orphanOperators };
};

const printCommitResult = ({ stats, orphanMachines, orphanOperators }) => {
  head('WRITE RESULT');
  console.log(`  Machines     created ${stats.machinesCreated}, updated ${stats.machinesUpdated}, unchanged ${stats.machinesUnchanged}`);
  console.log(`  Operators    created ${stats.operatorsCreated}, updated ${stats.operatorsUpdated}, unchanged ${stats.operatorsUnchanged}`);
  console.log(`  Assignments  created ${stats.assignmentsCreated}, already present ${stats.assignmentsExisting}`);

  if (stats.divergences.length) {
    console.log(`\n  NOT OVERWRITTEN — database differs from the sheet (${stats.divergences.length}).`);
    console.log('  These look like edits made in the UI. Re-run with --overwrite to take the sheet value.');
    stats.divergences.forEach((d) => console.log(
      `    ${d.code.padEnd(8)} ${d.field.padEnd(18)} db="${d.db}"  sheet="${d.sheet}"`,
    ));
  }

  if (orphanMachines.length) {
    console.log(`\n  In the database but not in the sheet — machines (${orphanMachines.length}), left untouched:`);
    console.log(`    ${orphanMachines.join(', ')}`);
  }
  if (orphanOperators.length) {
    console.log(`\n  In the database but not in the sheet — operators (${orphanOperators.length}), left untouched:`);
    console.log(`    ${orphanOperators.join(', ')}`);
  }
};

// ── CLI ────────────────────────────────────────────────────────────────────────
const run = async () => {
  const argv = process.argv.slice(2);
  const doCommit = argv.includes('--commit');
  const overwrite = argv.includes('--overwrite');
  const fileArgIdx = argv.indexOf('--file');
  const explicit = fileArgIdx !== -1 ? argv[fileArgIdx + 1] : null;

  const filePath = explicit
    ? path.resolve(explicit)
    : DEFAULT_FILES.find((f) => fs.existsSync(f));

  if (!filePath || !fs.existsSync(filePath)) {
    console.error('Source workbook not found. Looked in:');
    DEFAULT_FILES.forEach((f) => console.error(`  ${f}`));
    process.exit(1);
  }

  head('MACHINE & OPERATOR MASTER IMPORT');
  console.log(`  File  : ${filePath}`);
  console.log(`  Mode  : ${doCommit ? (overwrite ? 'COMMIT (--overwrite)' : 'COMMIT') : 'PREVIEW (pass --commit to write)'}`);

  const parsed = parseMachineOperatorWorkbook(filePath);
  printReport(parsed);

  if (!doCommit) {
    head('PREVIEW ONLY — nothing was written. Re-run with --commit to apply.');
    process.exit(0);
  }

  await mongoose.connect(env.MONGO_URI);
  try {
    const result = await commit(parsed, { overwrite });
    printCommitResult(result);
  } finally {
    await mongoose.disconnect();
  }
  head('DONE');
  process.exit(0);
};

if (process.argv[1] && process.argv[1].endsWith('importMachineOperatorMaster.js')) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
