/**
 * Purchase FMS → Recycle Bin: the rules a restore decides with.
 *
 * DB-less: which indent slots a PO gets back (and when another PO has them),
 * the PO follow-up mirror after a follow-up returns, when an advance payment
 * can be posted back onto its PI and what that sets, the voucher snapshot
 * compare, the QC-billing compare for a vendor invoice, and that every step's
 * service still loads with its restore hooks (no import cycle).
 *
 * NOT covered here (needs a live DB, which this runner never sets up): the
 * restores themselves.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  indentLinksOf, relinkIndentToPo, followUpMirrorAfterRestore, advanceRestoreBlock, advanceRestorePatch,
  sameFields, pick, billingPairs, billedMoreSince, asUser, VOUCHER_MONEY_FIELDS,
} from '../recycleBin.js';
import { ITEM_PROCUREMENT_STATUS } from '../indent/indent.model.js';
import { FOLLOWUP_STATUS } from '../follow-up/followUp.model.js';
import { PO_FOLLOWUP_STATUS } from '../purchase-order/purchaseOrder.model.js';
import { PI_STATUS } from '../proforma-invoice/proformaInvoice.model.js';
import { PAYMENT_STATUS } from '../advance-payment/advancePayment.model.js';

const id = (n) => String(n).padStart(24, 'a');
const PO = { _id: id(1), poNumber: 'PO-007/26-27', draftNumber: 'DRAFT-003/26-27' };

test('PO ↔ indent: the slots it holds are saved, and given back when still free', () => {
  const itemIndent = {
    _id: id(9), indentNumber: 'IND-1',
    items: [
      { _id: id(21), itemName: 'Coil', poId: id(1), poNumber: 'PO-007/26-27', procurementStatus: 'PO_CREATED' },
      { _id: id(22), itemName: 'Box', poId: id(2), poNumber: 'PO-008', procurementStatus: 'PO_CREATED' },
      { _id: id(23), itemName: 'Tape', poId: null, procurementStatus: 'PENDING' },
    ],
  };
  const links = indentLinksOf(itemIndent, id(1));
  assert.deepEqual(links, { indentId: id(9), vendors: [], items: [id(21)] });

  // After the delete released it …
  itemIndent.items[0].poId = null; itemIndent.items[0].poNumber = ''; itemIndent.items[0].procurementStatus = 'PENDING';
  assert.equal(relinkIndentToPo(itemIndent, PO, links, ITEM_PROCUREMENT_STATUS), null);
  assert.equal(itemIndent.items[0].poId, id(1));
  assert.equal(itemIndent.items[0].poNumber, 'PO-007/26-27');
  assert.equal(itemIndent.items[0].procurementStatus, ITEM_PROCUREMENT_STATUS.PO_CREATED);
  assert.equal(itemIndent.items[1].poId, id(2)); // untouched

  // … but not once another PO has the item.
  itemIndent.items[0].poId = id(5); itemIndent.items[0].poNumber = 'PO-009';
  assert.match(relinkIndentToPo(itemIndent, PO, links, ITEM_PROCUREMENT_STATUS), /"Coil" is now on PO PO-009/);
});

test('PO ↔ multi-vendor indent: the approved vendor slot; a draft PO uses its draft number', () => {
  const indent = {
    _id: id(9), indentNumber: 'IND-2',
    quotationApprovalStep: { approvedVendors: [{ _id: id(31), poId: id(1), poNumber: 'x' }, { _id: id(32), poId: null }] },
    items: [{ _id: id(41), poId: id(1) }],
  };
  const links = indentLinksOf(indent, id(1));
  assert.deepEqual(links, { indentId: id(9), vendors: [id(31)], items: [] }); // vendors win over items

  indent.quotationApprovalStep.approvedVendors[0].poId = null;
  assert.equal(relinkIndentToPo(indent, { _id: id(1), draftNumber: 'DRAFT-3' }, links, ITEM_PROCUREMENT_STATUS), null);
  assert.equal(indent.quotationApprovalStep.approvedVendors[0].poNumber, 'DRAFT-3');

  indent.quotationApprovalStep.approvedVendors[0].poId = id(6);
  assert.match(relinkIndentToPo(indent, PO, links, ITEM_PROCUREMENT_STATUS), /that vendor now has PO/);
  assert.match(relinkIndentToPo({ ...indent, quotationApprovalStep: { approvedVendors: [] } }, PO, links, ITEM_PROCUREMENT_STATUS), /no longer on it/);
});

test('follow-up back: ready-for-GRN makes the PO ready again; others mean in progress; never moves a ready/closed PO', () => {
  const S = FOLLOWUP_STATUS;
  const PS = PO_FOLLOWUP_STATUS;
  const readyAt = new Date('2026-10-01');
  const fmd = new Date('2026-10-05');
  const ready = followUpMirrorAfterRestore({ followUpStatus: PS.IN_PROGRESS }, { followUpStatus: S.READY_FOR_GRN, finalMaterialDate: fmd },
    { followUpStatus: PS.READY_FOR_GRN, readyForGrnAt: readyAt, finalMaterialDate: fmd }, S, PS);
  assert.deepEqual(ready, { followUpStatus: PS.READY_FOR_GRN, readyForGrnAt: readyAt, finalMaterialDate: fmd });

  assert.deepEqual(followUpMirrorAfterRestore({ followUpStatus: PS.PENDING }, { followUpStatus: S.PENDING }, null, S, PS), { followUpStatus: PS.IN_PROGRESS });
  assert.equal(followUpMirrorAfterRestore({ followUpStatus: PS.IN_PROGRESS }, { followUpStatus: S.DONE }, null, S, PS), null);
  assert.equal(followUpMirrorAfterRestore({ followUpStatus: PS.READY_FOR_GRN }, { followUpStatus: S.PENDING }, null, S, PS), null);
  assert.equal(followUpMirrorAfterRestore({ followUpStatus: PS.CLOSED }, { followUpStatus: S.READY_FOR_GRN }, null, S, PS), null);
});

test('advance payment back: only as the newest payment on an untouched PI', () => {
  const pi = { piNumber: 'PI-4', piStatus: PI_STATUS.READY_FOR_ADVANCE_PAYMENT, totalValue: 1000, paidAmount: 300, balanceAmount: 700 };
  const pay = { paymentNumber: 'ADV-2', piNumber: 'PI-4', paymentStatus: PAYMENT_STATUS.PART_PAYMENT, paidAmount: 200, previousBalance: 700, balanceAmount: 500 };
  const opts = { newer: [], piStatus: PI_STATUS };
  assert.equal(advanceRestoreBlock(pi, pay, opts), null);
  assert.match(advanceRestoreBlock(null, pay, opts), /PI PI-4 is deleted/);
  assert.match(advanceRestoreBlock(pi, pay, { ...opts, newer: [{ paymentNumber: 'ADV-3' }] }), /newer payment \(ADV-3\)/);
  assert.match(advanceRestoreBlock({ ...pi, piStatus: PI_STATUS.PAYMENT_COMPLETED }, pay, opts), /payment completed now/);
  assert.match(advanceRestoreBlock({ ...pi, balanceAmount: 650 }, pay, opts), /balance is ₹650 now/);
  assert.match(advanceRestoreBlock({ ...pi, paidAmount: 250 }, pay, opts), /paid amount has changed/);

  const statuses = { piStatus: PI_STATUS, paymentStatus: PAYMENT_STATUS };
  assert.deepEqual(advanceRestorePatch(pi, pay, statuses), { paidAmount: 500, balanceAmount: 500, closes: false, piStatus: PI_STATUS.READY_FOR_ADVANCE_PAYMENT });
  // A full payment closes the PI; so does a short-closed one with balance left.
  assert.equal(advanceRestorePatch(pi, { ...pay, paidAmount: 700, paymentStatus: PAYMENT_STATUS.FULL_PAYMENT }, statuses).piStatus, PI_STATUS.PAYMENT_COMPLETED);
  assert.equal(advanceRestorePatch(pi, { ...pay, paymentStatus: PAYMENT_STATUS.SHORT_PAYMENT_COMPLETED }, statuses).closes, true);
});

test('final payment: the voucher must still stand exactly as the delete left it', () => {
  const after = { paidAmount: 0, balanceAmount: 5000, voucherStatus: 'POSTED', finalPaymentStatus: 'PENDING', other: 'x' };
  const saved = pick(after, VOUCHER_MONEY_FIELDS);
  assert.deepEqual(Object.keys(saved), VOUCHER_MONEY_FIELDS);
  assert.equal(sameFields({ ...after, balanceAmount: 5000.001 }, saved, VOUCHER_MONEY_FIELDS), true); // paise rounding
  assert.equal(sameFields({ ...after, paidAmount: 1000, balanceAmount: 4000 }, saved, VOUCHER_MONEY_FIELDS), false);
  assert.equal(sameFields({ ...after, voucherStatus: 'CANCELLED' }, saved, VOUCHER_MONEY_FIELDS), false);
  assert.equal(sameFields({ d: new Date('2026-01-01') }, { d: new Date('2026-01-01') }, ['d']), true);
});

test('vendor invoice: refused only when MORE was billed on its QC lines since', () => {
  const saved = billingPairs({ byLine: { 'q1#l1': 10 }, bySku: { 'q1|COIL': 5 } });
  assert.deepEqual(saved, [['L:q1#l1', 10], ['S:q1|COIL', 5]]);
  assert.equal(billedMoreSince(billingPairs({ byLine: { 'q1#l1': 10 }, bySku: { 'q1|COIL': 5 } }), saved), false);
  assert.equal(billedMoreSince(billingPairs({ byLine: { 'q1#l1': 4 } }), saved), false); // another invoice rejected meanwhile
  assert.equal(billedMoreSince(billingPairs({ byLine: { 'q1#l1': 12 }, bySku: { 'q1|COIL': 5 } }), saved), true);
  assert.equal(billedMoreSince(billingPairs({ byLine: { 'q1#l2': 1 } }), saved), true);
  assert.equal(billedMoreSince([], []), false);
});

test('the restoring person is passed on as a service user', () => {
  assert.deepEqual(asUser({ id: id(7), name: 'Arpit' }), { _id: id(7), name: 'Arpit' });
  assert.deepEqual(asUser(null), { _id: null, name: '' });
});

test('every step service loads with its Recycle Bin hooks (no import cycle)', async () => {
  const mods = await Promise.all([
    import('../indent/indent.service.js'), import('../purchase-order/purchaseOrder.service.js'),
    import('../follow-up/followUp.service.js'), import('../proforma-invoice/proformaInvoice.service.js'),
    import('../advance-payment/advancePayment.service.js'), import('../grn/grn.service.js'),
    import('../incoming-qc/incomingQc.service.js'), import('../vendor-invoice/vendorInvoice.service.js'),
    import('../voucher/voucher.service.js'), import('../tally-entry/tallyEntry.service.js'),
    import('../final-payment/finalPayment.service.js'),
  ]);
  const services = [
    mods[0].indentService, mods[1].purchaseOrderService, mods[2].followUpService, mods[3].proformaInvoiceService,
    mods[4].advancePaymentService, mods[5].grnService, mods[6].incomingQcService, mods[7].vendorInvoiceService,
    mods[8].voucherService, mods[9].tallyEntryService, mods[10].finalPaymentService,
  ];
  for (const svc of services) assert.equal(typeof svc?.remove, 'function');
});
