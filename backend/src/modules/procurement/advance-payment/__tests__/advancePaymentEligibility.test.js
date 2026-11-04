import test from 'node:test';
import assert from 'node:assert/strict';
import { poPaymentBlock, isPoPayable, advancePaymentStatusOf } from '../advancePayment.eligibility.js';

const po = (extra = {}) => ({ poNumber: 'PO-1', approvalStatus: 'APPROVED', poStatus: 'RELEASED_TO_VENDOR', ...extra });

test('an approved, live PO is payable', () => {
  assert.equal(poPaymentBlock(po()), null);
  assert.equal(poPaymentBlock(po({ poStatus: 'APPROVED' })), null);
  assert.equal(poPaymentBlock(po({ poStatus: 'PARTIAL_RECEIVED' })), null);
  assert.equal(isPoPayable(po()), true);
});

test('draft / rejected POs are not payable', () => {
  assert.match(poPaymentBlock(po({ approvalStatus: 'DRAFT' })), /not approved/);
  assert.match(poPaymentBlock(po({ approvalStatus: 'REJECTED' })), /not approved/);
});

test('cancelled / closed / deleted / missing POs are not payable', () => {
  assert.match(poPaymentBlock(po({ poStatus: 'CANCELLED' })), /cancelled/);
  assert.match(poPaymentBlock(po({ poStatus: 'CLOSED' })), /closed/);
  assert.match(poPaymentBlock(po({ isDeleted: true })), /no longer exists/);
  assert.match(poPaymentBlock(null), /no longer exists/);
  assert.equal(isPoPayable(undefined), false);
});

test('payment status: nothing paid is pending, anything paid is a part payment', () => {
  assert.equal(advancePaymentStatusOf({ paidAmount: 0 }), 'PENDING');
  assert.equal(advancePaymentStatusOf({ paidAmount: 500 }), 'PART_PAYMENT');
  assert.equal(advancePaymentStatusOf(undefined), 'PENDING');
});

// ── PI payment state + advance state ──
import { piPaymentStateOf, advanceStateOf, piPaymentBlock } from '../advancePayment.eligibility.js';

const pi = (extra = {}) => ({ piStatus: 'READY_FOR_ADVANCE_PAYMENT', approvalStatus: 'APPROVED', mdApprovalStatus: 'MD_APPROVED', totalValue: 100, paidAmount: 0, balanceAmount: 100, ...extra });

test('PI payment state: pending, partial, fully paid, short closed', () => {
  assert.equal(piPaymentStateOf(pi()), 'PENDING');
  assert.equal(piPaymentStateOf(pi({ paidAmount: 30, balanceAmount: 70 })), 'PARTIALLY_PAID');
  assert.equal(piPaymentStateOf(pi({ piStatus: 'PAYMENT_COMPLETED', paidAmount: 100, balanceAmount: 0 })), 'FULLY_PAID');
  assert.equal(piPaymentStateOf(pi({ piStatus: 'PAYMENT_COMPLETED', paidAmount: 60, balanceAmount: 40 })), 'SHORT_CLOSED');
});

test('piPaymentBlock only lets a READY PI be paid', () => {
  assert.equal(piPaymentBlock(pi()), null);
  assert.match(piPaymentBlock(pi({ piStatus: 'DRAFT' })), /ready for advance payment/);
});

test('advance state of a PO, one code per business situation', () => {
  const p = po();
  assert.equal(advanceStateOf({ po: p, pi: pi() }).code, 'PAYABLE');
  assert.equal(advanceStateOf({ po: p, pi: pi() }).payable, true);
  assert.equal(advanceStateOf({ po: p, pi: pi({ paidAmount: 40, balanceAmount: 60 }) }).code, 'PAYABLE');
  const md = advanceStateOf({ po: p, pi: pi({ mdApprovalStatus: 'READY_FOR_MD_APPROVAL' }) });
  assert.equal(md.code, 'AWAITING_MD'); assert.equal(md.payable, true);
  assert.equal(advanceStateOf({ po: p, pi: pi({ piStatus: 'DRAFT', approvalStatus: 'PENDING' }) }).code, 'PI_PENDING');
  assert.equal(advanceStateOf({ po: p, pi: pi({ piStatus: 'RECEIVED', approvalStatus: 'REJECTED' }) }).code, 'PI_REJECTED');
  assert.equal(advanceStateOf({ po: p, pi: pi({ piStatus: 'PAYMENT_COMPLETED', paidAmount: 100, balanceAmount: 0 }) }).code, 'FULLY_PAID');
  assert.equal(advanceStateOf({ po: p, pi: pi({ piStatus: 'PAYMENT_COMPLETED', paidAmount: 60, balanceAmount: 40 }) }).code, 'SHORT_CLOSED');
  assert.equal(advanceStateOf({ po: p, pi: pi({ balanceAmount: 0 }) }).code, 'FULLY_PAID');
  assert.equal(advanceStateOf({ po: p, pi: pi({ piStatus: 'CANCELLED' }) }).code, 'NO_PI');
});

test('advance state without a PI', () => {
  assert.equal(advanceStateOf({ po: po(), pi: null }).code, 'NO_PI');
  assert.equal(advanceStateOf({ po: po({ poStatus: 'APPROVED', releaseStatus: 'NOT_RELEASED' }), pi: null }).code, 'PO_NOT_RELEASED');
  assert.equal(advanceStateOf({ po: po({ piStatus: 'PI_NOT_REQUIRED' }), pi: null }).code, 'PI_NOT_REQUIRED');
  assert.equal(advanceStateOf({ po: po({ poStatus: 'CANCELLED' }), pi: pi() }).payable, false);
});
