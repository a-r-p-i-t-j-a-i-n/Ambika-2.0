/**
 * Direct Purchase Voucher (voucherType DIRECT_PURCHASE) — goods bought with no
 * Indent / PO / GRN. Pure / DB-less tests: line + total arithmetic (PO-engine
 * rounding), the create schema (its own branch; PURCHASE / EXPENSE unchanged),
 * the model shape (old vouchers unaffected) and the PDF dispatch.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createVoucherSchema, updateVoucherSchema } from '../voucher.validation.js';
import VendorVoucher, { VOUCHER_TYPE, isDirectPurchase, expenseTypeOf } from '../voucher.model.js';
import { computeDirectPurchaseLines } from '../directPurchase.js';
import { buildVoucherPdfBuffer } from '../voucher.pdf.js';

const ID = '6ac09965f1c61c40fa206c24';
const SKU = '6ac09965f1c61c40fa206c25';
const opts = { abortEarly: false, stripUnknown: true };
const dp = {
  voucherType: 'DIRECT_PURCHASE', vendorId: ID, invoiceNumber: 'INV-1', invoiceDate: '2026-11-10',
  items: [{ skuId: SKU, quantity: 2, rate: 100, gstRate: 18 }],
};

test('lines: gross = qty×rate, taxable = gross − discount, tax = taxable × gst (round2)', () => {
  const { lines, totals, problems } = computeDirectPurchaseLines([
    { skuId: SKU, quantity: 3, rate: 33.33, discountAmount: 10, gstRate: 18 },
    { skuId: SKU, quantity: 1.5, rate: 200, gstRate: 5 },
  ]);
  assert.deepEqual(problems, []);
  assert.equal(lines[0].grossAmount, 99.99);
  assert.equal(lines[0].taxableAmount, 89.99);
  assert.equal(lines[0].taxAmount, 16.2); // 89.99 × 18% = 16.1982
  assert.equal(lines[0].lineTotal, 106.19);
  assert.equal(lines[1].taxAmount, 15);
  assert.deepEqual(totals, { grossAmount: 399.99, discountTotal: 10, taxableAmount: 389.99, taxAmount: 31.2, grandTotal: 421.19 });
});

test('lines: invalid quantity / rate / GST / discount are reported, never silently fixed', () => {
  const { problems } = computeDirectPurchaseLines([
    { quantity: 0, rate: 10, gstRate: 18 },
    { quantity: 1.2345, rate: 10, gstRate: 18 },
    { quantity: 1, rate: -1, gstRate: 18 },
    { quantity: 1, rate: 10, gstRate: 101 },
    { quantity: 1, rate: 10, gstRate: 18, discountAmount: 11 },
    { quantity: 1, rate: 1.23456, gstRate: 18 },
  ]);
  assert.equal(problems.length, 6, problems.join('\n'));
  assert.match(problems[0], /quantity must be greater than zero/);
  assert.match(problems[1], /at most 3 decimals/);
  assert.match(problems[2], /rate cannot be negative/);
  assert.match(problems[3], /GST rate must be between 0 and 100/);
  assert.match(problems[4], /discount .* more than the line amount/);
  assert.match(problems[5], /rate can have at most 4 decimals/);
});

test('create schema: a valid direct purchase passes; PO / GRN / invoice / expense fields are stripped', () => {
  const { error, value } = createVoucherSchema.validate({
    ...dp, poId: ID, grnId: ID, invoiceId: ID, expenseCategory: 'AMC', expenseType: 'AGAINST_PO', basicValue: 5,
  }, opts);
  assert.equal(error, undefined);
  for (const k of ['poId', 'grnId', 'invoiceId', 'expenseCategory', 'expenseType', 'basicValue']) assert.equal(value[k], undefined, k);
  assert.equal(value.items[0].discountAmount, 0);
});

test('create schema: vendor, invoice no, invoice date and ≥ 1 item with an SKU id are required', () => {
  const miss = (patch) => createVoucherSchema.validate({ ...dp, ...patch }, opts).error?.message || '';
  assert.match(miss({ vendorId: undefined }), /vendor/i);
  assert.match(miss({ invoiceNumber: '' }), /Invoice Number/);
  assert.match(miss({ invoiceDate: undefined }), /Invoice Date/);
  assert.match(miss({ items: [] }), /at least one purchase item/);
  assert.match(miss({ items: [{ quantity: 1, rate: 1, gstRate: 0 }] }), /SKU Master/);
  assert.match(miss({ items: [{ skuId: 'not-an-id', quantity: 1, rate: 1, gstRate: 0 }] }), /SKU Master/);
  assert.match(miss({ items: [{ skuId: SKU, quantity: 0, rate: 1, gstRate: 0 }] }), /quantity/);
});

test('create schema: PURCHASE and EXPENSE requests validate exactly as before', () => {
  assert.equal(createVoucherSchema.validate({ voucherType: 'PURCHASE', invoiceId: ID }, opts).error, undefined);
  assert.match(createVoucherSchema.validate({ voucherType: 'PURCHASE' }, opts).error?.message || '', /invoiceId/);
  assert.equal(createVoucherSchema.validate({ invoiceId: ID }, opts).value.voucherType, 'PURCHASE');
  assert.equal(createVoucherSchema.validate({ voucherType: 'EXPENSE', expenseCategory: 'AMC', partyName: 'X' }, opts).error, undefined);
  // An expense request cannot smuggle direct-purchase items in.
  assert.equal(createVoucherSchema.validate({ voucherType: 'EXPENSE', expenseCategory: 'AMC', partyName: 'X', items: dp.items }, opts).value.items, undefined);
  assert.ok(createVoucherSchema.validate({ voucherType: 'BOGUS' }, opts).error);
});

test('update schema: a direct purchase edit has its own branch (vendorId needs no expense bill no)', () => {
  const { error, value } = updateVoucherSchema.validate({ voucherType: 'DIRECT_PURCHASE', vendorId: ID, invoiceNumber: 'INV-2', items: dp.items, expenseCategory: 'AMC' }, opts);
  assert.equal(error, undefined);
  assert.equal(value.items.length, 1);
  assert.equal(value.expenseCategory, undefined);
});

test('update schema: purchase / expense edits unchanged — no direct purchase fields, expense rules intact', () => {
  const { error, value } = updateVoucherSchema.validate({ remarks: 'x', invoiceNumber: 'INV-2', items: dp.items }, opts);
  assert.equal(error, undefined);
  assert.equal(value.items, undefined);
  assert.equal(value.invoiceNumber, undefined);
  // The expense rule still holds: a vendor-linked bill edit needs its bill number.
  assert.match(updateVoucherSchema.validate({ vendorId: ID }, opts).error?.message || '', /expenseInvoiceNo/);
});

test('model: DIRECT_PURCHASE is its own type, not an expense; old vouchers get no items', () => {
  assert.equal(VOUCHER_TYPE.DIRECT_PURCHASE, 'DIRECT_PURCHASE');
  const old = new VendorVoucher({ voucherType: 'PURCHASE' });
  assert.equal(old.items, undefined);
  assert.equal(isDirectPurchase(old), false);
  const exp = new VendorVoucher({ voucherType: 'EXPENSE', expenseCategory: 'AMC' });
  assert.equal(isDirectPurchase(exp), false);
  const d = new VendorVoucher({ voucherType: 'DIRECT_PURCHASE', items: [{ skuId: SKU, quantity: 1 }] });
  assert.equal(d.validateSync(), undefined);
  assert.equal(isDirectPurchase(d), true);
  assert.equal(expenseTypeOf(d), null);
  assert.ok(new VendorVoucher({ voucherType: 'DIRECT_PURCHASE', items: [{ quantity: 1 }] }).validateSync()?.errors['items.0.skuId']);
});

test('PDF: direct purchase renders its own layout (and many items paginate)', async () => {
  const items = Array.from({ length: 40 }, (_, i) => ({
    itemName: `Item ${i + 1}`, skuCode: `SKU-${i + 1}`, description: i % 3 ? '' : 'Long description of the bought item',
    quantity: 2, unit: 'PCS', rate: 10, discountAmount: 0, gstRate: 18, taxAmount: 3.6, lineTotal: 23.6,
  }));
  const buf = await buildVoucherPdfBuffer({
    voucherType: 'DIRECT_PURCHASE', voucherNumber: 'AGL/DPV-001/26-27', vendorName: 'V', invoiceNumber: 'INV-1',
    items, grossAmount: 800, discountTotal: 0, taxableAmount: 800, taxAmount: 144, netPayableAmount: 944, remarks: 'r',
  }, {});
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  const pages = (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
  assert.ok(pages >= 2, `expected pagination, got ${pages} page(s)`);
});

test('supplier identity: only a well-formed GSTIN with a correct check digit counts', async () => {
  const { validGstin } = await import('../supplierIdentity.js');
  assert.equal(validGstin('27AAPFU0939F1ZV'), '27AAPFU0939F1ZV');
  assert.equal(validGstin(' 07aagff2194n1z1 '), '07AAGFF2194N1Z1');
  assert.equal(validGstin('27AAPFU0939F1ZX'), '', 'wrong check digit');
  assert.equal(validGstin('27AAPFU0939F1Z'), '', 'too short');
  for (const junk of ['NA', '0', 'N/A', '', null, undefined, 'GSTIN PENDING']) assert.equal(validGstin(junk), '', String(junk));
});
