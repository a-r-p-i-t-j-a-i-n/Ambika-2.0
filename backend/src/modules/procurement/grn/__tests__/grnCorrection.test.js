/**
 * Correcting / deleting a COMPLETED GRN — the pure rules behind it.
 *
 * DB-less: how a PO's lines and receipt status are put back in line (correct
 * and delete), which request changes count as an item change, which header
 * values a request changes, and the request schemas.
 *
 * NOT covered here (needs a live DB, which this runner never sets up): the
 * later-step lookups (QC / invoice / stock), the PO lock, the unit of work, PI
 * shifts and the signature refresh.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { applyReceiptsToPo, linesDiffer, headerPatchOf, describeLaterSteps } from '../grn.service.js';
import { correctGrnSchema, deleteGrnSchema } from '../grn.validation.js';
import { PO_STATUS } from '../../purchase-order/purchaseOrder.model.js';

const po = (status, lines) => ({
  _id: 'po1', poStatus: status, activityTimeline: [],
  items: lines.map(([id, quantity]) => ({ _id: id, quantity, receivedQty: 0, pendingQty: quantity })),
});
const map = (entries) => new Map(entries);

test('applyReceiptsToPo: other GRNs + this GRN make the received qty; partial when a line is short', () => {
  const doc = po(PO_STATUS.FULLY_RECEIVED, [['a', 30], ['b', 20]]);
  const fully = applyReceiptsToPo(doc, map([['po1|a', 10]]), map([['po1|a', 15]]), 'GRN-1 corrected', null);
  assert.equal(doc.items[0].receivedQty, 25);
  assert.equal(doc.items[0].pendingQty, 5);
  assert.equal(doc.items[1].receivedQty, 0);
  assert.equal(fully, false);
  assert.equal(doc.poStatus, PO_STATUS.PARTIAL_RECEIVED);
  assert.equal(doc.activityTimeline.at(-1).description, 'GRN-1 corrected');
});

test('applyReceiptsToPo: everything received → fully received', () => {
  const doc = po(PO_STATUS.PARTIAL_RECEIVED, [['a', 30], ['b', 20]]);
  assert.equal(applyReceiptsToPo(doc, map([['po1|b', 20]]), map([['po1|a', 30]]), 'x', null), true);
  assert.equal(doc.poStatus, PO_STATUS.FULLY_RECEIVED);
});

test('applyReceiptsToPo: deleting the only GRN puts the PO back to Released, nothing received', () => {
  const doc = po(PO_STATUS.FULLY_RECEIVED, [['a', 30]]);
  doc.items[0].receivedQty = 30;
  applyReceiptsToPo(doc, map([]), map([]), 'GRN-1 deleted', null);
  assert.equal(doc.items[0].receivedQty, 0);
  assert.equal(doc.items[0].pendingQty, 30);
  assert.equal(doc.poStatus, PO_STATUS.RELEASED_TO_VENDOR);
});

test('applyReceiptsToPo: a closed or cancelled PO keeps its status', () => {
  for (const status of [PO_STATUS.CLOSED, PO_STATUS.CANCELLED]) {
    const doc = po(status, [['a', 30]]);
    applyReceiptsToPo(doc, map([]), map([['po1|a', 10]]), 'x', null);
    assert.equal(doc.poStatus, status);
    assert.equal(doc.items[0].receivedQty, 10);
  }
});

test('applyReceiptsToPo: over-received never shows negative pending', () => {
  const doc = po(PO_STATUS.PARTIAL_RECEIVED, [['a', 30]]);
  applyReceiptsToPo(doc, map([['po1|a', 20]]), map([['po1|a', 15]]), 'x', null);
  assert.equal(doc.items[0].receivedQty, 35);
  assert.equal(doc.items[0].pendingQty, 0);
  assert.equal(doc.poStatus, PO_STATUS.FULLY_RECEIVED);
});

const stored = [
  { _id: { toString: () => 'l1' }, receivedQty: 30, invoiceQty: 30, rate: 52, batchNo: 'B1', remarks: '', howItemReceived: 'FULL MATERIAL RECEIVED', itemName: 'Jar', skuId: { toString: () => 's1' } },
];
const same = { _id: 'l1', receivedQty: 30, invoiceQty: 30, rate: 52, batchNo: 'B1', remarks: '', howItemReceived: 'FULL MATERIAL RECEIVED', itemName: 'Jar', skuId: 's1' };

test('linesDiffer: the same lines sent back (ids as strings) are no change', () => {
  assert.equal(linesDiffer(stored, [same]), false);
});

test('linesDiffer: qty, batch, a missing line or a new line is a change', () => {
  assert.equal(linesDiffer(stored, [{ ...same, receivedQty: 28 }]), true);
  assert.equal(linesDiffer(stored, [{ ...same, batchNo: 'B2' }]), true);
  assert.equal(linesDiffer(stored, []), true);
  assert.equal(linesDiffer(stored, [{ ...same, _id: 'other' }]), true);
});

const grn = {
  challanNumber: 'CH-1', invoiceNumber: '', vehicleNumber: 'MH04', receivedBy: 'Ravi', preparedBy: '', remarks: '',
  grnDate: new Date('2026-11-02T00:00:00Z'), invoiceDate: new Date('2026-11-01T00:00:00Z'),
  challanDocument: { fileUrl: 'https://x/a.pdf' },
};

test('headerPatchOf: unchanged values (dates at another time of day, same file) are no change', () => {
  assert.deepEqual(headerPatchOf({
    challanNumber: 'CH-1', vehicleNumber: 'MH04', grnDate: '2026-11-02T10:30:00Z', invoiceDate: '2026-11-01',
    challanDocument: { fileUrl: 'https://x/a.pdf' },
  }, grn), {});
});

test('headerPatchOf: only what changed, a cleared invoice date stored as null', () => {
  const patch = headerPatchOf({ challanNumber: 'CH-2', vehicleNumber: 'MH04', invoiceDate: '' }, grn);
  assert.deepEqual(Object.keys(patch).sort(), ['challanNumber', 'invoiceDate']);
  assert.equal(patch.challanNumber, 'CH-2');
  assert.equal(patch.invoiceDate, null);
});

test('describeLaterSteps names each later record, stock with its count', () => {
  assert.equal(
    describeLaterSteps([{ type: 'QC', number: 'AGL/QC-010/26-27' }, { type: 'INVOICE', number: '252636636' }, { type: 'STOCK', count: 1 }]),
    'Incoming QC AGL/QC-010/26-27, Vendor Invoice 252636636, stock already posted (1 entry)',
  );
});

test('correctGrnSchema: a reason is required', () => {
  const { error } = correctGrnSchema.validate({ challanNumber: 'CH-2' });
  assert.ok(error);
  assert.match(error.message, /reason/i);
});

test('correctGrnSchema: keeps line ids and drops nothing it needs', () => {
  const { error, value } = correctGrnSchema.validate({ reason: 'Wrong challan', items: [{ _id: 'l1', itemName: 'Jar', receivedQty: 28 }] });
  assert.equal(error, undefined);
  assert.equal(value.items[0]._id, 'l1');
  assert.equal(value.allowOverReceipt, false);
});

test('deleteGrnSchema: no body (a draft delete) and a reason both pass', () => {
  assert.equal(deleteGrnSchema.validate(undefined).error, undefined);
  assert.equal(deleteGrnSchema.validate({ reason: 'Entered twice' }).error, undefined);
});
