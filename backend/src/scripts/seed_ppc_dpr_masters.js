/**
 * Seed the PPC / DPR masters from the client's import sheets.
 *
 *   Machine & Operator sheet → Machine + Operator collections
 *   Process Master sheet     → ProcessRoute collection (routing + SPM/cavity)
 *   Die List sheet           → Die collection
 *   Product Master sheet     → light update of existing SKU attributes
 *
 * Idempotent: every record is upserted on its natural key, so re-running only
 * refreshes. Run with:  npm run seed:dpr
 */
import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

import connectDB from '../config/db.js';
import { logger } from '../utils/logger.js';
import Machine from '../modules/ppc/machine.model.js';
import Operator from '../modules/ppc/operator.model.js';
import ProcessRoute from '../modules/ppc/processRoute.model.js';
import Die from '../modules/ppc/die.model.js';
import SKU from '../modules/skus/sku.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHEET_DIR = path.resolve(__dirname, '../sheets/ppc and dpr all sheet');
const F = (name) => path.join(SHEET_DIR, name);

const FILES = {
  machineOperator: F('DPR - OEE Hourly Report - Ambika (AYT) - Import Machine & Operator.csv'),
  processMaster:   F('DPR - OEE Hourly Report - Ambika (AYT) - Import Process Master.csv'),
  dieList:         F('DPR - OEE Hourly Report - Ambika (AYT) - Import Die List.csv'),
  productMaster:   F('DPR - OEE Hourly Report - Ambika (AYT) - Import Product Master.csv'),
};

// ── helpers ────────────────────────────────────────────────────────────────────
const readRows = (file) => {
  const wb = XLSX.readFile(file, { raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
};
const s = (v) => String(v ?? '').trim();
const n = (v) => {
  const x = Number(String(v ?? '').replace(/[,"'\s]/g, ''));
  return Number.isFinite(x) ? x : 0;
};

// Infer a machine family from its code prefix (3-letter codes first so SAP≠S).
const machineTypeFromCode = (code) => {
  const c = code.toUpperCase();
  if (c.startsWith('CCP')) return 'Circle Cutting Press';
  if (c.startsWith('DAP')) return 'Double Action Press';
  if (c.startsWith('SAP')) return 'Single Action Press';
  if (c.startsWith('HYP')) return 'Hydraulic Press';
  if (c.startsWith('BF')) return 'Buffing Motor';
  if (/^S\d/.test(c)) return 'Spinning / Rolling Machine';
  if (/^C\d/.test(c)) return 'Cutting Machine';
  if (/^L\d/.test(c)) return 'Lathe';
  return 'Manual / Other';
};

// ── seeders ────────────────────────────────────────────────────────────────────
const seedMachinesAndOperators = async () => {
  const rows = readRows(FILES.machineOperator);
  const machineCodes = new Set();
  const opByName = new Map(); // name → Set(machineCodes)

  for (const r of rows) {
    const code = s(r['Machine Code']).toUpperCase();
    const opName = s(r['Machine Operator']);
    if (code) machineCodes.add(code);
    if (opName) {
      if (!opByName.has(opName)) opByName.set(opName, new Set());
      if (code) opByName.get(opName).add(code);
    }
  }

  let mUp = 0;
  for (const code of machineCodes) {
    await Machine.findOneAndUpdate(
      { code },
      { $set: { code, machineType: machineTypeFromCode(code), active: true, isDeleted: false } },
      { upsert: true, setDefaultsOnInsert: true },
    );
    mUp += 1;
  }

  let oUp = 0;
  for (const [name, codes] of opByName) {
    await Operator.findOneAndUpdate(
      { name },
      { $set: { name, machineCodes: [...codes], active: true, isDeleted: false } },
      { upsert: true, setDefaultsOnInsert: true },
    );
    oUp += 1;
  }
  logger.info(`  Machines upserted: ${mUp}, Operators upserted: ${oUp}`);
};

const seedProcessRoutes = async () => {
  const rows = readRows(FILES.processMaster);
  let up = 0;
  for (const r of rows) {
    const skuCode = s(r['SKU Code']).toUpperCase();
    const opNoRaw = s(r['Operation No.']);
    if (!skuCode || opNoRaw === '') continue;
    const operationNo = n(opNoRaw);
    const operationName = s(r['Operation Name']);
    if (!operationName) continue;

    await ProcessRoute.findOneAndUpdate(
      { skuCode, operationNo },
      {
        $set: {
          skuCode,
          skuName: s(r['SKU Name']),
          operationNo,
          operationName,
          operationLabel: `${operationNo} - ${operationName}`,
          operationDesc: s(r['Tool /  Operation Desc']) || s(r['Tool / Operation Desc']),
          machineType: s(r['Machine']),
          spm: n(r['SPM (Stroke Per Minutes)']),
          cavity: 1,
          toolLifeShots: n(r['Tool Life (No of Shots)']),
          pmFrequencyShots: n(r['Preventive Maintainance Frequency (No of Shots)']),
          pmFrequencyMonths: s(r['Preventive Maintainance Frequency (No of Months)']),
          isLastOperation: /final\s*operation/i.test(s(r['Last Operation'])),
          active: true, isDeleted: false,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
    up += 1;
  }
  logger.info(`  Process routes upserted: ${up}`);
};

const seedDies = async () => {
  const rows = readRows(FILES.dieList);
  let up = 0;
  for (const r of rows) {
    const completeDieNo = s(r['Complete Die No.']);
    if (!completeDieNo) continue; // rows with no physical die (buffing/cleaning) are skipped
    const operationDesc = s(r['Operation']);
    const skuCode = operationDesc.includes(' - ') ? operationDesc.split(' - ')[0].trim().toUpperCase() : '';

    await Die.findOneAndUpdate(
      { completeDieNo },
      {
        $set: {
          completeDieNo,
          dieName: s(r['Die Name']),
          rackNo: s(r['Rack No']),
          dieNo: s(r['Die No']),
          opCode: s(r['Op Code']),
          operationDesc,
          skuCode,
          toolLifeShots: n(r['Tool Life']),
          pmFrequencyShots: n(r['Prevent. Maint. Feq']),
          pmFrequencySecondary: s(r['PM Fre Seondary']),
          active: true, isDeleted: false,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
    up += 1;
  }
  logger.info(`  Dies upserted: ${up}`);
};

// Light-touch: only refresh product attributes on SKUs that already exist. Never
// creates a SKU (the SKU master is owned elsewhere) — the DPR stores skuCode as a
// string, so a missing SKU document does not block anything.
const updateProductAttributes = async () => {
  const rows = readRows(FILES.productMaster);
  let touched = 0;
  for (const r of rows) {
    const code = s(r['SKU Code']).toUpperCase();
    if (!code) continue;
    const set = {};
    const jarWeight = n(r['Jar Weight (Kgs)']);
    const jarPerBox = n(r['Jar per Box']);
    const grade = s(r['Material (Grade & Thick)']);
    if (jarWeight) set.weightPerPc = jarWeight;
    if (jarPerBox) set.pcsPerBox = jarPerBox;
    if (grade) set.materialGrade = grade; // extra attribute; harmless if unused
    if (!Object.keys(set).length) continue;
    const res = await SKU.updateOne({ code, isDeleted: { $ne: true } }, { $set: set });
    if (res.matchedCount) touched += 1;
  }
  logger.info(`  SKU product attributes refreshed: ${touched}`);
};

const run = async () => {
  await connectDB();
  logger.info('Seeding PPC / DPR masters…');
  await seedMachinesAndOperators();
  await seedProcessRoutes();
  await seedDies();
  await updateProductAttributes();

  const [m, o, pr, d] = await Promise.all([
    Machine.countDocuments({ isDeleted: { $ne: true } }),
    Operator.countDocuments({ isDeleted: { $ne: true } }),
    ProcessRoute.countDocuments({ isDeleted: { $ne: true } }),
    Die.countDocuments({ isDeleted: { $ne: true } }),
  ]);
  logger.info(`✅ DPR masters seeded — Machines: ${m}, Operators: ${o}, Process Routes: ${pr}, Dies: ${d}`);
  process.exit(0);
};

run().catch((err) => {
  logger.error(`❌ DPR master seed failed: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
