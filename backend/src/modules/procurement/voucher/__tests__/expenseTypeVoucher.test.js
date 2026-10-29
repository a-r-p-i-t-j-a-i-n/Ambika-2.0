/**
 * Expense Type on the EXPENSE voucher — Direct (no PO/GRN), Against PO (no GRN),
 * Against GRN (W/O-PO GRN, no PO). Pure / DB-less: the Joi create/update
 * schemas, the model shape (old expense vouchers read as DIRECT) and the
 * gross-bill helper used for the PO-value cap. The DB rules (PO/GRN state,
 * vendor match, one payment path per PO) are covered by the API oracle
 * src/scripts/e2eExpenseTypeFixture.js.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createVoucherSchema, updateVoucherSchema, expenseLinkQuerySchema } from '../voucher.validation.js';
import VendorVoucher, { EXPENSE_TYPE, expenseTypeOf } from '../voucher.model.js';
import { grossBillAmount } from '../expenseLink.js';

const PO_ID = '6ac09965f1c61c40fa206c24';
const GRN_ID = '6ac09965f1c61c40fa206c25';
const opts = { abortEarly: false, stripUnknown: true };
const base = { voucherType: 'EXPENSE', expenseCategory: 'AMC', partyName: 'Acme Repairs' };

test('no expenseType on an EXPENSE create defaults to DIRECT (old clients unchanged)', () => {
  const { error, value } = createVoucherSchema.validate(base, opts);
  assert.equal(error, undefined);
  assert.equal(value.expenseType, 'DIRECT');
});

test('DIRECT refuses a PO or GRN reference', () => {
  assert.match(createVoucherSchema.validate({ ...base, expenseType: 'DIRECT', poId: PO_ID }, opts).error?.message || '', /poId/);
  assert.match(createVoucherSchema.validate({ ...base, expenseType: 'DIRECT', grnId: GRN_ID }, opts).error?.message || '', /grnId/);
});

test('AGAINST_PO needs poId + bill no, refuses grnId, needs no party name', () => {
  const ok = createVoucherSchema.validate({ voucherType: 'EXPENSE', expenseCategory: 'AMC', expenseType: 'AGAINST_PO', poId: PO_ID, expenseInvoiceNo: 'B-1' }, opts);
  assert.equal(ok.error, undefined);

  const noPo = createVoucherSchema.validate({ ...base, expenseType: 'AGAINST_PO', expenseInvoiceNo: 'B-1' }, opts);
  assert.match(noPo.error?.message || '', /Purchase Order/);

  const noBill = createVoucherSchema.validate({ ...base, expenseType: 'AGAINST_PO', poId: PO_ID }, opts);
  assert.match(noBill.error?.message || '', /expenseInvoiceNo/);

  const blankBill = createVoucherSchema.validate({ ...base, expenseType: 'AGAINST_PO', poId: PO_ID, expenseInvoiceNo: '' }, opts);
  assert.match(blankBill.error?.message || '', /expenseInvoiceNo/);

  const withGrn = createVoucherSchema.validate({ ...base, expenseType: 'AGAINST_PO', poId: PO_ID, grnId: GRN_ID, expenseInvoiceNo: 'B-1' }, opts);
  assert.match(withGrn.error?.message || '', /grnId/);
});

test('AGAINST_GRN needs grnId + bill no, refuses poId', () => {
  const ok = createVoucherSchema.validate({ voucherType: 'EXPENSE', expenseCategory: 'Other', expenseType: 'AGAINST_GRN', grnId: GRN_ID, expenseInvoiceNo: 'B-2' }, opts);
  assert.equal(ok.error, undefined);

  const noGrn = createVoucherSchema.validate({ ...base, expenseType: 'AGAINST_GRN', expenseInvoiceNo: 'B-2' }, opts);
  assert.match(noGrn.error?.message || '', /GRN/);

  const withPo = createVoucherSchema.validate({ ...base, expenseType: 'AGAINST_GRN', grnId: GRN_ID, poId: PO_ID, expenseInvoiceNo: 'B-2' }, opts);
  assert.match(withPo.error?.message || '', /poId/);
});

test('an unknown expenseType is refused', () => {
  assert.ok(createVoucherSchema.validate({ ...base, expenseType: 'AGAINST_INVOICE' }, opts).error);
});

test('PURCHASE vouchers accept none of the expense link fields', () => {
  const r = createVoucherSchema.validate({ voucherType: 'PURCHASE', invoiceId: PO_ID, expenseType: 'AGAINST_PO', poId: PO_ID }, opts);
  assert.ok(r.error);
  assert.match(r.error.message, /expenseType/);
});

test('the existing rules still hold: vendor-linked DIRECT bill needs a bill no; party needed for DIRECT', () => {
  assert.match(createVoucherSchema.validate({ ...base, vendorId: PO_ID }, opts).error?.message || '', /expenseInvoiceNo/);
  const { partyName, ...noParty } = base;
  assert.ok(createVoucherSchema.validate(noParty, opts).error);
});

test('update accepts an expense-type switch and the PO / GRN refs (the service checks the merged state)', () => {
  assert.equal(updateVoucherSchema.validate({ expenseType: 'AGAINST_GRN', grnId: GRN_ID }, opts).error, undefined);
  assert.equal(updateVoucherSchema.validate({ expenseType: 'DIRECT', poId: null, grnId: null, vendorId: null }, opts).error, undefined);
  assert.ok(updateVoucherSchema.validate({ expenseType: 'BOGUS' }, opts).error);
});

test('picker query: type PO | GRN required', () => {
  assert.equal(expenseLinkQuerySchema.validate({ type: 'PO' }).error, undefined);
  assert.equal(expenseLinkQuerySchema.validate({ type: 'GRN', search: 'x', excludeVoucherId: PO_ID }).error, undefined);
  assert.ok(expenseLinkQuerySchema.validate({}).error);
  assert.ok(expenseLinkQuerySchema.validate({ type: 'INVOICE' }).error);
});

test('model: expenseType defaults to null; an old expense voucher reads as DIRECT, a purchase voucher as none', () => {
  assert.equal(VendorVoucher.schema.path('expenseType').defaultValue, null);
  const oldExpense = new VendorVoucher({ voucherType: 'EXPENSE', expenseCategory: 'AMC', partyName: 'X' });
  assert.equal(oldExpense.expenseType, null);
  assert.equal(expenseTypeOf(oldExpense), EXPENSE_TYPE.DIRECT);
  assert.equal(expenseTypeOf({ voucherType: 'EXPENSE', expenseType: 'AGAINST_PO' }), 'AGAINST_PO');
  assert.equal(expenseTypeOf({ voucherType: 'PURCHASE' }), null);
});

test('gross bill = basic + freight + P&F + other + tax + TCS (TDS / advance not deducted)', () => {
  assert.equal(grossBillAmount({
    basicValue: 1000, freightCharges: 50, packingForwardingCharges: 25.5, otherCharges: 10,
    taxAmount: 180, tcsAmount: 1.25, tdsAmount: 20, advanceAmount: 500,
  }), 1266.75);
  assert.equal(grossBillAmount({}), 0);
});
