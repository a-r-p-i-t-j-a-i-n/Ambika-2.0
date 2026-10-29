/**
 * Vendor Invoices & Payments workflow chips on the server (invoiceWorkflow.js):
 * each chip's invoice status set and voucher condition.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { invoiceWorkflowFilter, INVOICE_WORKFLOW_KEYS } from '../vendor-invoice/invoiceWorkflow.js';

const vouchers = [
  { invoiceId: 'inv-md', voucherStatus: 'POSTED', approvalStatus: 'READY_FOR_MD_APPROVAL' },
  { invoiceId: 'inv-ok', voucherStatus: 'POSTED', approvalStatus: 'MD_APPROVED' },
  { invoiceId: 'inv-part', voucherStatus: 'PARTIALLY_PAID', approvalStatus: 'MD_APPROVED' },
];

test('the chips the list sends are all known', () => {
  assert.deepEqual(INVOICE_WORKFLOW_KEYS,
    ['AWAITING_INVOICE', 'AWAITING_VOUCHER', 'AWAITING_MD_APPROVAL', 'VOUCHER_POSTED', 'PARTIALLY_PAID']);
  assert.equal(invoiceWorkflowFilter('NOPE', vouchers), null);
});

test('awaiting invoice action = draft or received invoices, no voucher condition', () => {
  assert.deepEqual(invoiceWorkflowFilter('AWAITING_INVOICE', vouchers), { invoiceStatus: { $in: ['DRAFT', 'RECEIVED'] } });
});

test('awaiting voucher = payment-pending invoices WITHOUT a live voucher', () => {
  assert.deepEqual(invoiceWorkflowFilter('AWAITING_VOUCHER', vouchers), {
    invoiceStatus: { $in: ['PAYMENT_PENDING'] },
    _id: { $nin: ['inv-md', 'inv-ok', 'inv-part'] },
  });
  assert.deepEqual(invoiceWorkflowFilter('AWAITING_VOUCHER', [])._id, { $nin: [] }, 'no vouchers at all: every payment-pending invoice');
});

test('voucher sub-states select the invoices whose live voucher matches', () => {
  assert.deepEqual(invoiceWorkflowFilter('AWAITING_MD_APPROVAL', vouchers)._id, { $in: ['inv-md'] });
  assert.deepEqual(invoiceWorkflowFilter('VOUCHER_POSTED', vouchers)._id, { $in: ['inv-ok', 'inv-part'] });
  assert.deepEqual(invoiceWorkflowFilter('PARTIALLY_PAID', vouchers)._id, { $in: ['inv-part'] });
  assert.deepEqual(invoiceWorkflowFilter('PARTIALLY_PAID', [])._id, { $in: [] }, 'nothing matches → empty, never everything');
});
