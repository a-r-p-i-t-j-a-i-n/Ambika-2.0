/**
 * MD approval policy — the pure rules (no database).
 *
 * MD approval is recorded for every tracked document but only payment waits
 * for it; the MD Approval screen's rows bucket into Pending / Approved /
 * Completed independently of the document's own workflow.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isMdApproved, paymentApprovalBlock, approvalViewStatus, APPROVAL_VIEW_STATUS,
  scopeApprovalRows, summarizeApprovalRows, sortApprovalRows,
} from '../approval.policy.js';

const { PENDING, APPROVED, COMPLETED } = APPROVAL_VIEW_STATUS;

test('payment is refused until the voucher is MD Approved', () => {
  assert.equal(paymentApprovalBlock('MD_APPROVED'), null);
  assert.match(paymentApprovalBlock('READY_FOR_MD_APPROVAL'), /until the MD approves this voucher/);
  // A voucher whose approval was never raised is not paid either.
  assert.match(paymentApprovalBlock('NOT_REQUIRED'), /no MD approval/);
  assert.match(paymentApprovalBlock(undefined), /no MD approval/);
});

test('advance payment: the same gate, naming the Proforma Invoice', () => {
  assert.equal(paymentApprovalBlock('MD_APPROVED', 'Proforma Invoice'), null);
  assert.match(paymentApprovalBlock('READY_FOR_MD_APPROVAL', 'Proforma Invoice'), /until the MD approves this Proforma Invoice/);
  assert.match(paymentApprovalBlock('NOT_REQUIRED', 'Proforma Invoice'), /this Proforma Invoice has no MD approval/);
  assert.equal(isMdApproved({ approvalStatus: 'MD_APPROVED' }), true);
  assert.equal(isMdApproved(null), false);
});

test('view status: pending until signed, then approved or completed by the workflow alone', () => {
  assert.equal(approvalViewStatus('READY_FOR_APPROVAL', false), PENDING);
  // Workflow finished before the MD signed: still pending — the two are tracked independently.
  assert.equal(approvalViewStatus('READY_FOR_APPROVAL', true), PENDING);
  assert.equal(approvalViewStatus('APPROVED', false), APPROVED);
  assert.equal(approvalViewStatus('APPROVED', true), COMPLETED);
});

const rows = [
  { documentType: 'GRN', documentNumber: 'GRN-1', vendorName: 'Avani', requestedByName: 'Ravi', module: 'GRN & QC',
    approvalStatus: PENDING, gatesPayment: false, requestedAt: '2026-10-20T10:00:00Z' },
  { documentType: 'VOUCHER', documentNumber: 'PV-7', vendorName: 'Sagar', requestedByName: 'Meena', module: 'Vendor Invoices & Payments',
    approvalStatus: PENDING, gatesPayment: true, requestedAt: '2026-10-18T10:00:00Z' },
  { documentType: 'VOUCHER', documentNumber: 'PV-3', vendorName: 'Avani', requestedByName: 'Meena', module: 'Vendor Invoices & Payments',
    approvalStatus: APPROVED, gatesPayment: true, requestedAt: '2026-10-10T10:00:00Z' },
  { documentType: 'GRN', documentNumber: 'GRN-0', vendorName: 'Sagar', requestedByName: 'Ravi', module: 'GRN & QC',
    approvalStatus: COMPLETED, gatesPayment: false, requestedAt: '2026-10-22T10:00:00Z' },
];

test('summary counts every bucket and the payments still waiting on the MD', () => {
  assert.deepEqual(summarizeApprovalRows(rows), { total: 4, pending: 2, approved: 1, completed: 1, paymentBlocked: 1 });
  assert.deepEqual(summarizeApprovalRows([]), { total: 0, pending: 0, approved: 0, completed: 0, paymentBlocked: 0 });
});

test('scope filters by module, vendor, requested-date range and search', () => {
  assert.deepEqual(scopeApprovalRows(rows, { documentType: 'GRN' }).map((r) => r.documentNumber), ['GRN-1', 'GRN-0']);
  assert.deepEqual(scopeApprovalRows(rows, { vendor: 'Avani' }).map((r) => r.documentNumber), ['GRN-1', 'PV-3']);
  // Inclusive whole days at both ends.
  assert.deepEqual(scopeApprovalRows(rows, { from: '2026-10-18', to: '2026-10-20' }).map((r) => r.documentNumber), ['GRN-1', 'PV-7']);
  assert.deepEqual(scopeApprovalRows(rows, { search: 'meena' }).map((r) => r.documentNumber), ['PV-7', 'PV-3']);
  assert.deepEqual(scopeApprovalRows(rows, { search: 'pv-3' }).map((r) => r.documentNumber), ['PV-3']);
  assert.equal(scopeApprovalRows(rows, {}).length, 4);
});

test('sort: pending first, oldest request on top; the rest newest first', () => {
  assert.deepEqual(sortApprovalRows(rows).map((r) => r.documentNumber), ['PV-7', 'GRN-1', 'GRN-0', 'PV-3']);
});
