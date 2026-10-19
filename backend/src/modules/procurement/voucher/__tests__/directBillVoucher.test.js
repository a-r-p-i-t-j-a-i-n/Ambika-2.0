/**
 * Direct Bill Passing Voucher — a vendor bill passed without a PO, GRN, or
 * Vendor Invoice. Reuses the existing EXPENSE voucher type (its categories —
 * repair, maintenance, AMC, office, consultancy, etc. — already cover direct
 * vendor bills); this just adds an optional vendor-master link, a required
 * bill number once that link is made, a duplicate-bill guard, and an explicit
 * GST rate / taxable amount breakout.
 *
 * Pure / DB-less tests: the Joi schemas (what flips from optional to required
 * when vendorId is set) and the model shape (new fields, safe defaults so
 * every historical voucher reads exactly as it always has).
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createVoucherSchema } from '../voucher.validation.js';
import VendorVoucher from '../voucher.model.js';
import { computeGstAmount } from '../voucher.service.js';

const VENDOR_ID = '6ac09965f1c61c40fa206c24';

const baseExpense = {
  voucherType: 'EXPENSE',
  expenseCategory: 'AMC',
  partyName: 'Acme Repairs',
};

test('EXPENSE create still needs no invoiceId/PO/GRN — unchanged default behaviour', () => {
  const { error } = createVoucherSchema.validate(baseExpense);
  assert.equal(error, undefined);
});

test('invoiceId is still forbidden on an EXPENSE / direct-bill voucher', () => {
  const { error } = createVoucherSchema.validate({ ...baseExpense, invoiceId: VENDOR_ID });
  assert.ok(error);
  assert.match(error.message, /invoiceId/);
});

test('expenseCategory and partyName are still required for EXPENSE', () => {
  const { partyName, ...rest } = baseExpense;
  const { error: noParty } = createVoucherSchema.validate(rest);
  assert.ok(noParty);

  const { expenseCategory, ...rest2 } = baseExpense;
  const { error: noCategory } = createVoucherSchema.validate(rest2);
  assert.ok(noCategory);
});

test('vendorId is accepted as an optional ObjectId on EXPENSE (Direct Bill Passing link)', () => {
  const { error } = createVoucherSchema.validate({ ...baseExpense, vendorId: VENDOR_ID, expenseInvoiceNo: 'INV-1' });
  assert.equal(error, undefined);
});

test('a vendor-linked bill requires a bill/invoice number', () => {
  const { error } = createVoucherSchema.validate({ ...baseExpense, vendorId: VENDOR_ID });
  assert.ok(error);
  assert.match(error.message, /expenseInvoiceNo/);
});

test('a non-vendor-linked (pure ad-hoc) expense still needs no bill number', () => {
  const { error } = createVoucherSchema.validate(baseExpense);
  assert.equal(error, undefined);
});

test('gstRatePercent is bounded 0-100', () => {
  const { error } = createVoucherSchema.validate({ ...baseExpense, gstRatePercent: 150 });
  assert.ok(error);
  assert.match(error.message, /gstRatePercent/);
});

test('taxableAmount rejects a negative value', () => {
  const { error } = createVoucherSchema.validate({ ...baseExpense, taxableAmount: -500 });
  assert.ok(error);
  assert.match(error.message, /taxableAmount/);
});

test('model: taxableAmount and gstRatePercent default to 0 — every historical voucher reads unchanged', () => {
  assert.equal(VendorVoucher.schema.path('taxableAmount').defaultValue, 0);
  assert.equal(VendorVoucher.schema.path('gstRatePercent').defaultValue, 0);
  const doc = new VendorVoucher({ voucherType: 'EXPENSE', expenseCategory: 'AMC', partyName: 'Acme Repairs' });
  assert.equal(doc.taxableAmount, 0);
  assert.equal(doc.gstRatePercent, 0);
});

test('model: vendorId refs the Party master', () => {
  assert.equal(VendorVoucher.schema.path('vendorId').options.ref, 'Party');
});

test('computeGstAmount derives an authoritative GST amount, rounded to 2 decimals', () => {
  assert.equal(computeGstAmount(1000, 18), 180);
  assert.equal(computeGstAmount(0, 18), 0);
  assert.equal(computeGstAmount(333.333, 18), 60);
});
