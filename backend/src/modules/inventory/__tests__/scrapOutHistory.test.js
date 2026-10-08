/**
 * SCRAP OUT HISTORY — one stored SCRAP_OUT movement, reshaped for the table.
 *
 * The rows below are shaped exactly as Scrap Out stores them (see `_entry` in
 * scrapIms.service.js): KG in `quantity`, the buyer snapshot, and the one
 * composed `remarks` sentence. Expected figures are worked by hand.
 *
 * NOT COVERED HERE: that the endpoint returns only SCRAP_OUT rows, newest
 * first, paged — that needs a database and is exercised by
 * src/scripts/e2eScrapOutFixture.js --api.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { operatorRemarks, toScrapOutHistoryRow } from '../scrapOutHistory.js';

const sale = {
  _id: 'm1', movementNumber: 'MOV-001/26-27', movementDate: new Date('2026-10-07'),
  quantity: 500, warehouse: 'PLG01', reason: 'SALE', customReason: '',
  partyName: 'ABC Scrap Traders', refNumber: 'INV-9',
  buyer: { buyerId: 'b1', code: 'SB-0001', name: 'ABC Scrap Traders' },
  status: 'ACTIVE', remarks: 'Sold · Sold to: ABC Scrap Traders · INV-9 · Loaded on truck GJ01',
};

/* ── Quantity: KG as stored, Quintal and Ton derived ─────────────────────── */

test('500 kg is 5 Quintal and 0.5 Ton', () => {
  const r = toScrapOutHistoryRow(sale);
  assert.equal(r.quantityKg, 500);
  assert.equal(r.quintal, 5);
  assert.equal(r.ton, 0.5);
});

test('1,000 kg is 10 Quintal and 1 Ton', () => {
  const r = toScrapOutHistoryRow({ ...sale, quantity: 1000 });
  assert.equal(r.quintal, 10);
  assert.equal(r.ton, 1);
});

test('a part load keeps its decimals without float noise — 125.55 kg', () => {
  const r = toScrapOutHistoryRow({ ...sale, quantity: 125.55 });
  assert.equal(r.quintal, 1.2555);
  assert.equal(r.ton, 0.12555);
});

/* ── Sold to ─────────────────────────────────────────────────────────────── */

test('a sale shows the buyer from the snapshot', () => {
  const r = toScrapOutHistoryRow(sale);
  assert.equal(r.soldTo, 'ABC Scrap Traders');
  assert.equal(r.buyer.code, 'SB-0001');
  assert.equal(r.issuedTo, null);
});

test('a sale recorded before the buyer master shows its stored free-text party', () => {
  const r = toScrapOutHistoryRow({ ...sale, buyer: undefined, partyName: 'Old Buyer' });
  assert.equal(r.soldTo, 'Old Buyer');
  assert.equal(r.buyer, null);
});

test('a disposal is not "sold to" anyone — its party comes back as issuedTo', () => {
  const r = toScrapOutHistoryRow({
    ...sale, reason: 'DISPOSAL', buyer: undefined, partyName: 'Municipal yard', refNumber: '',
    remarks: 'Disposed of · Issued to: Municipal yard',
  });
  assert.equal(r.soldTo, null);
  assert.equal(r.issuedTo, 'Municipal yard');
  assert.equal(r.reasonLabel, 'Disposed of');
});

/* ── Status, reference, reason ───────────────────────────────────────────── */

test('status is the stored value, unaltered', () => {
  assert.equal(toScrapOutHistoryRow(sale).status, 'ACTIVE');
});

test('reference and location are passed through', () => {
  const r = toScrapOutHistoryRow(sale);
  assert.equal(r.reference, 'INV-9');
  assert.equal(r.warehouse, 'PLG01');
});

test('an Other reason carries its custom wording', () => {
  const r = toScrapOutHistoryRow({ ...sale, reason: 'OTHER', customReason: 'Given to a school', buyer: undefined, partyName: '' });
  assert.equal(r.reasonLabel, 'Other');
  assert.equal(r.customReason, 'Given to a school');
});

/* ── Remarks: the operator's own words, recovered from the stored sentence ─ */

test('remarks are only what the operator typed', () => {
  assert.equal(operatorRemarks(sale), 'Loaded on truck GJ01');
});

test('no operator remarks → empty, not the composed sentence', () => {
  assert.equal(operatorRemarks({ ...sale, remarks: 'Sold · Sold to: ABC Scrap Traders · INV-9' }), '');
});

test('no reference and no remarks → empty', () => {
  assert.equal(operatorRemarks({ ...sale, refNumber: '', remarks: 'Sold · Sold to: ABC Scrap Traders' }), '');
});

test('a remark containing the separator is kept whole', () => {
  assert.equal(operatorRemarks({ ...sale, remarks: 'Sold · Sold to: ABC Scrap Traders · INV-9 · part A · part B' }), 'part A · part B');
});

test('Other reason: "Other — <custom>" is stripped too', () => {
  const m = { reason: 'OTHER', customReason: 'Given to a school', partyName: '', refNumber: '', remarks: 'Other — Given to a school · Thank-you letter filed' };
  assert.equal(operatorRemarks(m), 'Thank-you letter filed');
});

test('an older sale that read "Issued to" is still split', () => {
  const m = { ...sale, buyer: undefined, partyName: 'Old Buyer', refNumber: '', remarks: 'Sold · Issued to: Old Buyer · cash' };
  assert.equal(operatorRemarks(m), 'cash');
});

test('a line in some other format is returned whole, never guessed at', () => {
  assert.equal(operatorRemarks({ ...sale, remarks: 'Imported from Excel row 42' }), 'Imported from Excel row 42');
});

test('blank remarks stay blank', () => {
  assert.equal(operatorRemarks({ ...sale, remarks: '' }), '');
});
