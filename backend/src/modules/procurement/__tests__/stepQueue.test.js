/**
 * Purchase FMS "Awaiting this step" queues (stepQueue.rules.js): real status per
 * row, actions only where the step's dialog would accept the record, and the
 * list behaviour (search / vendor / dates / state, counts, pagination).
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { STEP_QUEUES, QUEUE_KEYS, toQueueRow, filterQueueRows } from '../stepQueue.rules.js';

const ID = (n) => `64b000000000000000000${String(n).padStart(3, '0')}`;

test('every queue maps a document to a row with a known state and a link', () => {
  const docs = {
    FOLLOW_UP: { _id: ID(1), poNumber: 'PO-1', vendorName: 'V' },
    ADVANCE_PAYMENT: { _id: ID(2), piNumber: 'PI-1', mdApprovalStatus: 'MD_APPROVED' },
    GRN: { _id: ID(3), poNumber: 'PO-3', poStatus: 'RELEASED_TO_VENDOR' },
    INCOMING_QC: { _id: ID(4), grnNumber: 'GRN-4' },
    VENDOR_INVOICE: { _id: ID(5), grnNumber: 'GRN-5', totalAccepted: 10, totalPendingInvoiceQty: 10 },
    TALLY_ENTRY: { _id: ID(6), voucherNumber: 'VOU-6' },
    FINAL_PAYMENT: { _id: ID(7), voucherNumber: 'VOU-7', approvalStatus: 'MD_APPROVED', balanceAmount: 50 },
  };
  assert.deepEqual(QUEUE_KEYS.sort(), Object.keys(docs).sort());
  for (const key of QUEUE_KEYS) {
    const row = toQueueRow(key, docs[key]);
    assert.ok(['READY', 'IN_PROGRESS', 'WAITING'].includes(row.state), key);
    assert.ok(row.link.endsWith(docs[key]._id), key);
    assert.ok(row.statusLabel, key);
    assert.equal(row.record, docs[key], `${key} keeps the raw document for the dialog preset`);
    assert.equal(row.entityType, STEP_QUEUES[key].entityType);
  }
});

test('advance payment: a PI sent to the MD waits, any other ready PI can be paid', () => {
  const waiting = toQueueRow('ADVANCE_PAYMENT', { _id: ID(1), mdApprovalStatus: 'READY_FOR_MD_APPROVAL', balanceAmount: 100 });
  assert.equal(waiting.state, 'WAITING');
  assert.equal(waiting.action, null);
  assert.equal(waiting.statusLabel, 'Waiting for MD approval');

  const approved = toQueueRow('ADVANCE_PAYMENT', { _id: ID(2), mdApprovalStatus: 'MD_APPROVED', balanceAmount: 100 });
  assert.equal(approved.state, 'READY');
  assert.equal(approved.action, 'RECORD_ADVANCE');
  assert.equal(approved.amount, 100);

  // Not sent yet: the PI page offers the payment (its first attempt sends it to the MD).
  const notSent = toQueueRow('ADVANCE_PAYMENT', { _id: ID(3), mdApprovalStatus: 'NOT_REQUIRED', paidAmount: 40, balanceAmount: 60 });
  assert.equal(notSent.action, 'RECORD_ADVANCE');
  assert.equal(notSent.statusLabel, 'Part paid — balance due');
});

test('final payment: only an MD-approved voucher offers the payment', () => {
  const pending = toQueueRow('FINAL_PAYMENT', { _id: ID(1), approvalStatus: 'READY_FOR_MD_APPROVAL', balanceAmount: 10 });
  assert.equal(pending.state, 'WAITING');
  assert.equal(pending.action, null);
  const ok = toQueueRow('FINAL_PAYMENT', { _id: ID(2), approvalStatus: 'MD_APPROVED', balanceAmount: 10 });
  assert.equal(ok.state, 'READY');
  assert.equal(ok.action, 'RECORD_FINAL_PAYMENT');
});

test('incoming QC: a GRN with a started QC is IN_PROGRESS; service indents link to the indent', () => {
  const fresh = toQueueRow('INCOMING_QC', { _id: ID(1), grnNumber: 'G1', qcIds: [] });
  assert.equal(fresh.state, 'READY');
  assert.equal(fresh.statusLabel, 'Ready for QC');
  const started = toQueueRow('INCOMING_QC', { _id: ID(2), grnNumber: 'G2', qcIds: [ID(9)], qcNumber: 'QC-9' });
  assert.equal(started.state, 'IN_PROGRESS');
  assert.equal(started.statusLabel, 'QC started (QC-9)');
  const svc = toQueueRow('INCOMING_QC', { _id: ID(3), indentNumber: 'Ind-3', overallStatus: 'SERVICE_PENDING' }, 'INDENT');
  assert.equal(svc.entityType, 'INDENT');
  assert.equal(svc.link, `/procurement/indents/${ID(3)}`);
});

test('GRN and invoice labels follow the record (partly received / part invoiced)', () => {
  assert.equal(toQueueRow('GRN', { _id: ID(1), poStatus: 'PARTIAL_RECEIVED' }).statusLabel, 'Partly received — next GRN');
  assert.equal(toQueueRow('GRN', { _id: ID(2), poStatus: 'RELEASED_TO_VENDOR' }).statusLabel, 'Ready for GRN');
  // grn.service refuses a first GRN without a Final Material Date — no action offered.
  const noDate = toQueueRow('GRN', { _id: ID(5), poStatus: 'RELEASED_TO_VENDOR', hasFinalMaterialDate: false });
  assert.equal(noDate.state, 'WAITING');
  assert.equal(noDate.action, null);
  assert.equal(noDate.statusLabel, 'Final Material Date missing');
  // A next GRN on a partly received PO needs no new date.
  assert.equal(toQueueRow('GRN', { _id: ID(6), poStatus: 'PARTIAL_RECEIVED', hasFinalMaterialDate: false }).action, 'CREATE_GRN');
  assert.equal(toQueueRow('GRN', { _id: ID(7), poStatus: 'RELEASED_TO_VENDOR', hasFinalMaterialDate: true }).action, 'CREATE_GRN');
  assert.equal(toQueueRow('VENDOR_INVOICE', { _id: ID(3), totalAccepted: 10, totalPendingInvoiceQty: 4 }).statusLabel, 'Part invoiced');
  assert.equal(toQueueRow('VENDOR_INVOICE', { _id: ID(4), totalAccepted: 10, totalPendingInvoiceQty: 10 }).statusLabel, 'Invoice pending');
});

const rowsOf = () => [
  { _id: '1', number: 'PO-001', vendorName: 'Alpha Steel', refs: ['Indent Ind-1'], date: '2026-10-01T10:00:00Z', state: 'READY' },
  { _id: '2', number: 'PO-002', vendorName: 'Beta (Pvt) Ltd', refs: [], date: '2026-10-05T10:00:00Z', state: 'WAITING' },
  { _id: '3', number: 'PO-003', vendorName: 'Alpha Steel', refs: [], date: '2026-10-10T10:00:00Z', state: 'READY' },
  { _id: '4', number: 'PO-004', vendorName: 'Gamma', refs: [], date: null, state: 'IN_PROGRESS' },
];

test('no filters: every row, newest first, counts per state, vendor options', () => {
  const r = filterQueueRows(rowsOf());
  assert.deepEqual(r.docs.map((d) => d._id), ['3', '2', '1', '4']);
  assert.equal(r.pagination.total, 4);
  assert.equal(r.unfilteredTotal, 4);
  assert.deepEqual(r.stateCounts, { READY: 2, IN_PROGRESS: 1, WAITING: 1 });
  assert.deepEqual(r.vendors, ['Alpha Steel', 'Beta (Pvt) Ltd', 'Gamma']);
});

test('search matches number, refs and vendor, and treats regex characters literally', () => {
  assert.deepEqual(filterQueueRows(rowsOf(), { search: 'ind-1' }).docs.map((d) => d._id), ['1']);
  assert.deepEqual(filterQueueRows(rowsOf(), { search: '(Pvt)' }).docs.map((d) => d._id), ['2']);
  assert.equal(filterQueueRows(rowsOf(), { search: '.*' }).pagination.total, 0);
});

test('vendor, date range and state narrow; state counts ignore the state filter', () => {
  const byVendor = filterQueueRows(rowsOf(), { vendor: 'Alpha Steel' });
  assert.deepEqual(byVendor.docs.map((d) => d._id), ['3', '1']);
  assert.equal(byVendor.unfilteredTotal, 4);

  const byDate = filterQueueRows(rowsOf(), { from: '2026-10-02', to: '2026-10-10' });
  assert.deepEqual(byDate.docs.map((d) => d._id), ['3', '2'], 'undated rows drop out of a date range');

  const ready = filterQueueRows(rowsOf(), { state: 'READY' });
  assert.equal(ready.pagination.total, 2);
  assert.deepEqual(ready.stateCounts, { READY: 2, IN_PROGRESS: 1, WAITING: 1 });
});

test('pagination pages the filtered rows and reports the filtered total', () => {
  const p2 = filterQueueRows(rowsOf(), { page: 2, limit: 3 });
  assert.deepEqual(p2.docs.map((d) => d._id), ['4']);
  assert.deepEqual(p2.pagination, { total: 4, page: 2, limit: 3, totalPages: 2, hasNext: false, hasPrev: true });
  const empty = filterQueueRows([], {});
  assert.equal(empty.pagination.total, 0);
  assert.deepEqual(empty.docs, []);
});
