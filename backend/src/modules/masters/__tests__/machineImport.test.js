/**
 * Tests for the Machine / Operator master import parser and the machine model's
 * derivation helpers. No database: the parser is pure, so it runs against the
 * real workbook directly.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMachineOperatorWorkbook } from '../../../scripts/importMachineOperatorMaster.js';
import {
  buildMachineUid, parseCapacity, normalizeMachineStatus, deriveMachineFields,
} from '../machines/machine.model.js';
import { machineTypeFromCode } from '../machines/machineType.js';
import { operatorNameKey } from '../machine-operators/machineOperator.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHEET = path.resolve(__dirname, '../../../../../excel/machine and operator.xlsx');
const haveSheet = fs.existsSync(SHEET);

// ── Pure helpers ───────────────────────────────────────────────────────────────

test('machine uid is always "<code> - <name>"', () => {
  assert.equal(buildMachineUid('dap01', 'Double Action Press'), 'DAP01 - Double Action Press');
  assert.equal(buildMachineUid(' s07 ', ' Spinning / Rolling Machine '), 'S07 - Spinning / Rolling Machine');
  assert.equal(buildMachineUid('L03', ''), 'L03');
  assert.equal(buildMachineUid('', 'Nameless'), '');
});

test('capacity keeps the raw text and parses only what it can', () => {
  assert.deepEqual(parseCapacity('5 HP'), { capacityValue: 5, capacityUnit: 'HP' });
  assert.deepEqual(parseCapacity('100 Ton'), { capacityValue: 100, capacityUnit: 'TON' });
  // The DAP presses carry no unit in the sheet — a unit is never guessed.
  assert.deepEqual(parseCapacity('4.5'), { capacityValue: 4.5, capacityUnit: '' });
  assert.deepEqual(parseCapacity(''), { capacityValue: null, capacityUnit: '' });
  assert.deepEqual(parseCapacity('big'), { capacityValue: null, capacityUnit: '' });
});

test('status maps the sheet vocabulary onto the enum', () => {
  assert.equal(normalizeMachineStatus('In use'), 'IN_USE');
  assert.equal(normalizeMachineStatus('Not in Use'), 'NOT_IN_USE');
  assert.equal(normalizeMachineStatus('Scrap(Dead)'), 'SCRAP');
  assert.equal(normalizeMachineStatus('Dead'), 'SCRAP');
  assert.equal(normalizeMachineStatus(''), 'IN_USE');
});

test('isActive follows machineStatus', () => {
  assert.equal(deriveMachineFields({ code: 'X1', name: 'x', machineStatus: 'IN_USE' }).isActive, true);
  assert.equal(deriveMachineFields({ code: 'X1', name: 'x', machineStatus: 'NOT_IN_USE' }).isActive, false);
  assert.equal(deriveMachineFields({ code: 'X1', name: 'x', machineStatus: 'SCRAP' }).isActive, false);
});

test('machine family comes from the code prefix, 3-letter codes first', () => {
  assert.equal(machineTypeFromCode('SAP04'), 'Single Action Press');
  assert.equal(machineTypeFromCode('S07'), 'Spinning / Rolling Machine');   // not Single Action Press
  assert.equal(machineTypeFromCode('CCP01'), 'Circle Cutting Press');
  assert.equal(machineTypeFromCode('C03'), 'Cutting Machine');
  assert.equal(machineTypeFromCode('ZZ99'), 'Manual / Other');
});

test('operator identity normalizes whitespace and case', () => {
  assert.equal(operatorNameKey('  Chotu   Balak '), 'chotu balak');
  assert.equal(operatorNameKey('Kanhaya Lal'), operatorNameKey('kanhaya  lal'));
  assert.notEqual(operatorNameKey('Kanhaya Lal'), operatorNameKey('Kanhayalal'));
});

// ── The parser, against the real sheet ─────────────────────────────────────────

test('parses the workbook into 68 machines, 99 operators, 94 assignments',
  { skip: haveSheet ? false : 'excel/machine and operator.xlsx not present' }, () => {
    const r = parseMachineOperatorWorkbook(SHEET);
    assert.equal(r.machines.length, 68);
    assert.equal(r.operators.length, 99);
    assert.equal(r.assignments.length, 94);
  });

test('a repeated machine code is one machine with many operators',
  { skip: haveSheet ? false : 'sheet not present' }, () => {
    const r = parseMachineOperatorWorkbook(SHEET);
    const codes = r.machines.map((m) => m.code);
    assert.equal(new Set(codes).size, codes.length, 'machine codes must be unique');

    const opsOf = (code) => r.assignments.filter((a) => a.code === code).map((a) => a.nameKey).sort();
    assert.deepEqual(opsOf('DAP01'), ['appoo', 'bal govind']);
    assert.equal(opsOf('HYP02').length, 7);
    assert.equal(opsOf('C05').length, 8);

    // ...and one operator spans many machines.
    const machinesOf = (key) => r.assignments.filter((a) => a.nameKey === key).map((a) => a.code).sort();
    assert.deepEqual(machinesOf('appoo'), ['DAP01', 'HYP04']);
  });

test('every parsed machine derives a uid of "<code> - <name>" matching the sheet',
  { skip: haveSheet ? false : 'sheet not present' }, () => {
    const r = parseMachineOperatorWorkbook(SHEET);
    for (const m of r.machines) {
      assert.equal(buildMachineUid(m.code, m.name), m.sheetUid,
        `${m.code}: derived uid must equal the sheet's Machine UID column`);
    }
  });

test('ghost rows are skipped and reported',
  { skip: haveSheet ? false : 'sheet not present' }, () => {
    const r = parseMachineOperatorWorkbook(SHEET);
    assert.equal(r.issues.ghostRows.length, 4);
    assert.ok(r.issues.ghostRows.every((g) => g.department === 'Packing'));
  });

test('the S17 installation-year conflict is reported, not silently resolved',
  { skip: haveSheet ? false : 'sheet not present' }, () => {
    const r = parseMachineOperatorWorkbook(SHEET);
    const s17 = r.issues.fieldConflicts.filter((c) => c.code === 'S17');
    assert.equal(s17.length, 1);
    assert.equal(s17[0].field, 'installationYear');
    assert.equal(String(s17[0].kept), '2018');
    assert.equal(String(s17[0].ignored), '2025');
    // It is the only field conflict anywhere in the sheet.
    assert.equal(r.issues.fieldConflicts.length, 1);
  });

test('the superseded side blocks are reported and never become data',
  { skip: haveSheet ? false : 'sheet not present' }, () => {
    const r = parseMachineOperatorWorkbook(SHEET);
    assert.equal(r.issues.sideBlockConflicts.length, 24);
    assert.equal(r.issues.sideBlockOnlyOperators.length, 14);
    // None of the side-block-only names leaked into the operator master.
    const names = new Set(r.operators.map((o) => o.nameKey));
    for (const stray of r.issues.sideBlockOnlyOperators) {
      assert.ok(!names.has(operatorNameKey(stray)), `${stray} must not be imported`);
    }
  });

test('machine-less and operator-less rows are surfaced',
  { skip: haveSheet ? false : 'sheet not present' }, () => {
    const r = parseMachineOperatorWorkbook(SHEET);
    assert.equal(r.issues.operatorsWithoutMachine.length, 9);
    assert.equal(r.issues.machinesWithoutOperator.length, 14);
    assert.ok(r.issues.machinesWithoutOperator.includes('HYP01'));
    assert.equal(r.issues.duplicateOperatorRows.length, 1);      // Pallavi, twice
    assert.equal(r.issues.trailingWhitespaceNames.length, 3);
    assert.equal(r.issues.crossDepartmentOperators.length, 3);   // Appoo, Bhola, Rambabu
  });

test('only In use / Not in Use appear — Scrap is supported but unused in the source',
  { skip: haveSheet ? false : 'sheet not present' }, () => {
    const r = parseMachineOperatorWorkbook(SHEET);
    const seen = new Set(r.machines.map((m) => m.machineStatus));
    assert.deepEqual([...seen].sort(), ['IN_USE', 'NOT_IN_USE']);
    assert.equal(r.machines.filter((m) => m.machineStatus === 'NOT_IN_USE').map((m) => m.code).sort().join(','),
      'HYP01,S05,S10');
  });

test('parsing is deterministic — two runs produce identical output',
  { skip: haveSheet ? false : 'sheet not present' }, () => {
    const a = parseMachineOperatorWorkbook(SHEET);
    const b = parseMachineOperatorWorkbook(SHEET);
    assert.deepEqual(a.machines, b.machines);
    assert.deepEqual(a.operators, b.operators);
    assert.deepEqual(a.assignments, b.assignments);
  });
