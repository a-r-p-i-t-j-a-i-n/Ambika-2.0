/**
 * Vendor Invoice against multiple GRNs — one invoice covering material
 * received through two or more GRNs of the same vendor + PO.
 *
 * Multi-GRN support: qcIds[]/grnIds[] on the model, vendor/PO consistency
 * checks in loadAndValidateQcs, the GRN-centric getInvoiceableGrns endpoint and
 * the frontend multi-select picker. Invoice lines are one per QC line, tied to
 * it by qcItemId, so the same SKU on several lines (a PO listing it twice, or
 * GRNs saved before one-line-per-PO-line) or across GRNs never merges.
 *
 * This suite covers what needs no MongoDB: Joi schema shape, the QC-level
 * invoice lock field, and the pure line builders (buildInvoiceItems,
 * resolveInvoicedByLine).
 *
 * The DB-backed flow — invoicing real GRNs/QCs, cross-vendor / cross-PO /
 * duplicate-number refusals, partial invoicing, older SKU-only invoices,
 * concurrent creates, PI advance + debit note, and voucher → Tally → Final
 * Payment — is checked against a local scratch DB by
 *   node src/scripts/e2eMultiGrnInvoiceFixture.js --api
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createInvoiceSchema } from '../vendorInvoice.validation.js';
import { buildInvoiceItems, resolveInvoicedByLine } from '../vendorInvoice.service.js';
import VendorInvoice from '../vendorInvoice.model.js';
import IncomingQC from '../../incoming-qc/incomingQc.model.js';

const QC_1 = '6ac09965f1c61c40fa206c31';
const QC_2 = '6ac09965f1c61c40fa206c32';

const baseInvoice = { invoiceNumber: 'INV-100' };

test('createInvoiceSchema accepts qcIds[] with two or more GRN/QC ids (multi-GRN)', () => {
  const { error, value } = createInvoiceSchema.validate({ ...baseInvoice, qcIds: [QC_1, QC_2] });
  assert.equal(error, undefined);
  assert.deepEqual(value.qcIds, [QC_1, QC_2]);
});

test('createInvoiceSchema still accepts a single legacy qcId (regression)', () => {
  const { error } = createInvoiceSchema.validate({ ...baseInvoice, qcId: QC_1 });
  assert.equal(error, undefined);
});

test('createInvoiceSchema rejects an empty qcIds array', () => {
  const { error } = createInvoiceSchema.validate({ ...baseInvoice, qcIds: [] });
  assert.ok(error);
});

test('createInvoiceSchema requires at least one of qcId / qcIds (regression)', () => {
  const { error } = createInvoiceSchema.validate(baseInvoice);
  assert.ok(error);
  assert.match(error.message, /qcId/);
});

test('createInvoiceSchema still requires an invoice number', () => {
  const { error } = createInvoiceSchema.validate({ qcIds: [QC_1, QC_2] });
  assert.ok(error);
  assert.match(error.message, /invoiceNumber/);
});

// ── Line builders (pure — no DB) ─────────────────────────────────────
// Invoice lines are one per QC line. The same SKU may sit on several lines of
// one GRN (coils / batches) and on lines of different GRNs; none may merge.

const oid = (n) => `6ac09965f1c61c40fa20${String(n).padStart(4, '0')}`;
const qcLine = (id, sku, accepted, extra = {}) => ({
  _id: oid(id), grnItemId: oid(id + 500), skuCode: sku, itemName: `Item ${sku}`, unit: 'KGS',
  receivedQty: accepted, acceptedQty: accepted, rejectedQty: 0, ...extra,
});
// GRN A: COIL on two lines (two batches) + NUT. GRN B: COIL again.
const qcA = { _id: QC_1, qcNumber: 'QC-A', grnId: oid(9001), grnNumber: 'GRN-A', items: [qcLine(1, 'COIL', 100, { batchNo: 'B1' }), qcLine(2, 'COIL', 60, { batchNo: 'B2' }), qcLine(3, 'NUT', 10)] };
const qcB = { _id: QC_2, qcNumber: 'QC-B', grnId: oid(9002), grnNumber: 'GRN-B', items: [qcLine(4, 'COIL', 40, { batchNo: 'B3' })] };
const PO_ITEMS = [
  { _id: oid(7001), skuCode: 'COIL', quantity: 300, rate: 50, gstRate: 18 },
  { _id: oid(7002), skuCode: 'NUT', quantity: 10, rate: 2, gstRate: 18 },
];

test('buildInvoiceItems: one line per QC line across two GRNs — repeated SKUs never merge', () => {
  const { items, totals } = buildInvoiceItems([qcA, qcB], PO_ITEMS, [], {});
  assert.equal(items.length, 4);
  assert.deepEqual(items.map((i) => [i.grnNumber, i.skuCode, i.batchNo, i.invoiceQty]),
    [['GRN-A', 'COIL', 'B1', 100], ['GRN-A', 'COIL', 'B2', 60], ['GRN-A', 'NUT', '', 10], ['GRN-B', 'COIL', 'B3', 40]]);
  assert.deepEqual(items.map((i) => String(i.qcItemId)), [oid(1), oid(2), oid(3), oid(4)]);
  // (100+60+40)×50 + 10×2 = 10,020 taxable; GST 18%.
  assert.equal(totals.taxableAmount, 10020);
  assert.equal(totals.invoiceAmount, 11823.6);
});

test('buildInvoiceItems: submitted rows match their exact QC line by qcItemId (same SKU, same GRN)', () => {
  const submitted = [
    { qcId: QC_1, qcItemId: oid(2), skuCode: 'COIL', invoiceQty: 25 }, // second COIL line only
    { qcId: QC_1, qcItemId: oid(1), skuCode: 'COIL', invoiceQty: 70 },
    { qcId: QC_2, qcItemId: oid(4), skuCode: 'COIL', invoiceQty: 0 },
    { qcId: QC_1, qcItemId: oid(3), skuCode: 'NUT', invoiceQty: 10 },
  ];
  const { items } = buildInvoiceItems([qcA, qcB], PO_ITEMS, submitted, {});
  assert.deepEqual(items.map((i) => i.invoiceQty), [70, 25, 10, 0]);
});

test('buildInvoiceItems: line-level already-invoiced qty reduces only that line\'s pending', () => {
  const invoiced = { byLine: { [`${QC_1}#${oid(1)}`]: 100 }, bySku: {} };
  const { items } = buildInvoiceItems([qcA, qcB], PO_ITEMS, [], invoiced);
  assert.deepEqual(items.map((i) => [i.alreadyInvoicedQty, i.pendingInvoiceQty, i.invoiceQty]),
    [[100, 0, 0], [0, 60, 60], [0, 10, 10], [0, 40, 40]]);
});

test('resolveInvoicedByLine: SKU-only qty from older invoices fills same-SKU lines in QC order', () => {
  assert.deepEqual(resolveInvoicedByLine(qcA, { byLine: {}, bySku: { [`${QC_1}|COIL`]: 130 } }), [100, 30, 0]);
  // Over-invoiced legacy qty stays on the last COIL line (shows fully invoiced, not lost).
  assert.deepEqual(resolveInvoicedByLine(qcA, { byLine: {}, bySku: { [`${QC_1}|COIL`]: 175 } }), [100, 75, 0]);
  // Never bleeds into another GRN's QC.
  assert.deepEqual(resolveInvoicedByLine(qcB, { byLine: {}, bySku: { [`${QC_1}|COIL`]: 130 } }), [0]);
});

test('buildInvoiceItems: older rows without qcItemId match by QC + SKU in order, each used once', () => {
  const submitted = [
    { qcId: QC_1, skuCode: 'COIL', invoiceQty: 90 },
    { qcId: QC_1, skuCode: 'COIL', invoiceQty: 55 },
  ];
  const { items } = buildInvoiceItems([qcA], PO_ITEMS, submitted, {});
  // Before: both COIL lines matched the FIRST row (90 + 90).
  assert.deepEqual(items.map((i) => i.invoiceQty), [90, 55, 10]);
});

test('buildInvoiceItems: prices each line from its own PO line when the PO repeats a SKU', () => {
  const po = [...PO_ITEMS, { _id: oid(7003), skuCode: 'COIL', quantity: 60, rate: 55, gstRate: 18 }];
  const poItemIdByGrnItem = { [oid(501)]: oid(7001), [oid(502)]: oid(7003) };
  const { items } = buildInvoiceItems([qcA], po, [], {}, poItemIdByGrnItem);
  assert.deepEqual(items.map((i) => [i.rate, i.orderedQty]), [[50, 300], [55, 60], [2, 10]]);
});

test('model: invoice lines carry qcItemId / grnItemId / batchNo (absent on older invoices)', () => {
  const inv = new VendorInvoice({ invoiceNumber: 'X', qcId: QC_1, items: [{ skuCode: 'A' }] });
  assert.equal(inv.items[0].qcItemId, null);
  assert.equal(inv.items[0].batchNo, '');
  assert.ok(VendorInvoice.schema.path('items').schema.path('grnItemId'));
});

test('createInvoiceSchema accepts per-line qcItemId / grnItemId', () => {
  const { error } = createInvoiceSchema.validate({ ...baseInvoice, qcIds: [QC_1], items: [{ qcId: QC_1, qcItemId: oid(1), grnItemId: oid(501), invoiceQty: 5 }] });
  assert.equal(error, undefined);
});

test('model: IncomingQC carries an invoiceLockAt field defaulting to null (QC-level invoice lock)', () => {
  assert.equal(IncomingQC.schema.path('invoiceLockAt').defaultValue, null);
  const doc = new IncomingQC({ qcNumber: 'QC-1' });
  assert.equal(doc.invoiceLockAt, null);
});
