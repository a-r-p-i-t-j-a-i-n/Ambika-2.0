/**
 * Purchase FMS cascade delete — the dependency rules (DB-less).
 *
 * Covers what blocks a downstream record (money, stock, Tally, signatures),
 * what makes one "shared" with another workflow, which roots need a reason,
 * and that the service + routes load without an import cycle.
 *
 * NOT covered here (needs a live DB): collecting the records, the transaction,
 * the rollback — see backend/src/scripts/e2eCascadeDeleteFixture.js.
 *
 *   node --test "src/**\/__tests__/*.test.js"      (npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STEP_TYPES, STEP_ORDER, stepRank, isRootType, blockOf, warningsOf, sharedRefsOf, foreignRefs, reasonRequired, rootEffects,
} from '../cascadeDelete.graph.js';

const id = (n) => String(n).padStart(24, '0');

test('every step has a label, a code and an existing delete permission', async () => {
  const { PERMISSIONS } = await import('../../../../common/permissions/registry.js').catch(() => ({}));
  for (const [type, s] of Object.entries(STEP_TYPES)) {
    assert.ok(s.label && s.code, type);
    assert.match(s.permission, /^procurement\.delete/, type);
    if (PERMISSIONS) assert.ok(PERMISSIONS[s.permission], `${type}: ${s.permission} is registered`);
  }
  assert.deepEqual(STEP_ORDER.slice(0, 4), ['INDENT', 'QUOTE_COMPARATIVE', 'QUOTATION_APPROVAL', 'PO']);
  assert.equal(isRootType('SERVICE_COMPLETION'), false);
  assert.equal(isRootType('QUOTATION_APPROVAL'), true);
  assert.equal(isRootType('NOPE'), false);
});

test('the indent-document steps share one rank; later steps rank higher', () => {
  assert.equal(stepRank('QUOTE_COMPARATIVE'), stepRank('INDENT'));
  assert.equal(stepRank('QUOTATION_APPROVAL'), stepRank('INDENT'));
  assert.ok(stepRank('PO') < stepRank('PI'));
  assert.ok(stepRank('GRN') < stepRank('VENDOR_INVOICE'));
});

test('money already paid blocks; a cancelled payment entry does not', () => {
  for (const type of ['ADVANCE_PAYMENT', 'FINAL_PAYMENT']) {
    for (const s of ['PART_PAYMENT', 'FULL_PAYMENT', 'SHORT_PAYMENT_COMPLETED']) {
      const b = blockOf(type, { paymentStatus: s, paidAmount: 1500 });
      assert.ok(b, `${type} ${s} blocks`);
      assert.match(b.reason, /₹1,500 is recorded as paid/);
      assert.ok(b.action);
    }
    assert.equal(blockOf(type, { paymentStatus: 'CANCELLED', paidAmount: 0 }), null);
  }
});

test('Tally: only a completed entry blocks', () => {
  assert.ok(blockOf('TALLY_ENTRY', { tallyEntryStatus: 'COMPLETED' }));
  assert.equal(blockOf('TALLY_ENTRY', { tallyEntryStatus: 'PENDING' }), null);
  assert.equal(blockOf('TALLY_ENTRY', { tallyEntryStatus: 'CANCELLED' }), null);
});

test('voucher: MD-signed or posted blocks; draft / cancelled goes', () => {
  assert.match(blockOf('VOUCHER', { voucherStatus: 'DRAFT', approvalStatus: 'MD_APPROVED' }).reason, /Signed by the MD/);
  for (const s of ['POSTED', 'PARTIALLY_PAID', 'FULLY_PAID', 'SHORT_CLOSED']) assert.ok(blockOf('VOUCHER', { voucherStatus: s }), s);
  assert.equal(blockOf('VOUCHER', { voucherStatus: 'DRAFT', approvalStatus: 'NOT_REQUIRED' }), null);
  assert.equal(blockOf('VOUCHER', { voucherStatus: 'CANCELLED' }), null);
});

test('stock: a completed QC, a GRN with posted lines / movements / stockPosted, or a signed GRN blocks', () => {
  for (const s of ['PASSED', 'FAILED', 'PARTIAL']) assert.ok(blockOf('INCOMING_QC', { qcStatus: s }), s);
  for (const s of ['DRAFT', 'IN_PROGRESS', 'CANCELLED']) assert.equal(blockOf('INCOMING_QC', { qcStatus: s }), null, s);
  assert.ok(blockOf('GRN', { grnStatus: 'RECEIVED', items: [{ stockStatus: 'POSTED' }] }));
  assert.ok(blockOf('GRN', { grnStatus: 'RECEIVED', items: [{ stockStatus: 'AWAITING_QC', movementId: id(9) }] }));
  assert.ok(blockOf('GRN', { grnStatus: 'RECEIVED', stockPosted: true, items: [] }));
  assert.ok(blockOf('GRN', { grnStatus: 'RECEIVED', stockMovements: 2, items: [] }));
  assert.match(blockOf('GRN', { grnStatus: 'RECEIVED', approvalStatus: 'MD_APPROVED', items: [] }).reason, /MD/);
  assert.equal(blockOf('GRN', { grnStatus: 'FULLY_RECEIVED', items: [{ stockStatus: 'AWAITING_QC' }] }), null);
  assert.equal(blockOf('GRN', { grnStatus: 'DRAFT', items: [] }), null);
});

test('records that hold nothing never block (PO, PI, follow-up, unpaid invoice)', () => {
  assert.equal(blockOf('PO', { poStatus: 'RELEASED_TO_VENDOR' }), null);
  assert.equal(blockOf('PI', { piStatus: 'READY_FOR_ADVANCE_PAYMENT', mdApprovalStatus: 'MD_APPROVED' }), null);
  assert.equal(blockOf('FOLLOW_UP', { followUpStatus: 'READY_FOR_GRN' }), null);
  assert.equal(blockOf('VENDOR_INVOICE', { invoiceStatus: 'PAYMENT_PENDING' }), null);
  assert.ok(blockOf('VENDOR_INVOICE', { invoiceStatus: 'PAYMENT_COMPLETED' }));
});

test('warnings: released PO, MD-approved PI, completed GRN', () => {
  assert.match(warningsOf('PO', { releaseStatus: 'RELEASED' })[0], /released to the vendor/);
  assert.match(warningsOf('PI', { mdApprovalStatus: 'MD_APPROVED' })[0], /approval history is kept/);
  assert.match(warningsOf('GRN', { grnStatus: 'RECEIVED' })[0], /no stock was posted/);
  assert.deepEqual(warningsOf('PO', { releaseStatus: 'NOT_RELEASED', poStatus: 'APPROVED' }), []);
});

test('shared: a PO that also carries another indent blocks an indent-step delete; not a PO delete', () => {
  const po = { indentId: id(1), indentIds: [id(1), id(2)], items: [{ indentId: id(1) }, { indentId: id(2) }] };
  assert.deepEqual(sharedRefsOf('PO', po).map((r) => r.id), [id(1), id(2)]);
  const deleting = new Set([`INDENT:${id(1)}`, `PO:${id(5)}`]);
  assert.deepEqual(foreignRefs('PO', po, { rootType: 'QUOTATION_APPROVAL', deleting, rootIndentId: id(1) }).map((r) => r.id), [id(2)]);
  assert.deepEqual(foreignRefs('PO', { indentId: id(1), items: [] }, { rootType: 'QUOTATION_APPROVAL', deleting, rootIndentId: id(1) }), []);
});

test('shared: a multi-PO GRN blocks when the other PO stays; an earlier step never counts as shared', () => {
  const grn = { poId: id(5), poIds: [id(5), id(6)] };
  const deleting = new Set([`PO:${id(5)}`, `GRN:${id(7)}`]);
  assert.deepEqual(foreignRefs('GRN', grn, { rootType: 'PO', deleting }).map((r) => r.id), [id(6)]);
  assert.deepEqual(foreignRefs('GRN', grn, { rootType: 'PO', deleting: new Set([...deleting, `PO:${id(6)}`]) }), []);
  // Deleting a QC: the invoice's GRN is an earlier step — preserved, not shared.
  const inv = { grnIds: [id(7), id(8)], qcIds: [id(10)] };
  assert.deepEqual(foreignRefs('VENDOR_INVOICE', inv, { rootType: 'INCOMING_QC', deleting: new Set([`INCOMING_QC:${id(10)}`]) }), []);
  // Deleting a GRN: an invoice that also bills another GRN is shared.
  assert.deepEqual(foreignRefs('VENDOR_INVOICE', inv, { rootType: 'GRN', deleting: new Set([`GRN:${id(7)}`, `INCOMING_QC:${id(10)}`]) })
    .map((r) => `${r.type}:${r.id}`), [`GRN:${id(8)}`]);
  // A GRN without a PO belongs to no PO.
  assert.deepEqual(sharedRefsOf('GRN', { isWithoutPo: true, poId: null }), []);
});

test('reason: required for any cascade and for completed / financial roots; not for drafts', () => {
  assert.equal(reasonRequired('PO', { approvalStatus: 'DRAFT' }, 0), false);
  assert.equal(reasonRequired('PO', { approvalStatus: 'DRAFT' }, 2), true);
  assert.equal(reasonRequired('PO', { approvalStatus: 'APPROVED' }, 0), true);
  assert.equal(reasonRequired('QUOTATION_APPROVAL', {}, 0), true);
  assert.equal(reasonRequired('ADVANCE_PAYMENT', { paymentStatus: 'FULL_PAYMENT' }, 0), true);
  assert.equal(reasonRequired('ADVANCE_PAYMENT', { paymentStatus: 'CANCELLED' }, 0), false);
  assert.equal(reasonRequired('INCOMING_QC', { qcStatus: 'DRAFT' }, 0), false);
  assert.equal(reasonRequired('GRN', { grnStatus: 'DRAFT' }, 0), false);
  assert.equal(reasonRequired('GRN', { grnStatus: 'RECEIVED' }, 0), true);
});

test('effects on kept records are spelled out per step', () => {
  assert.match(rootEffects('QUOTATION_APPROVAL', {}, { number: 'Ind-5' })[0], /Ind-5 goes back to Step 1.3.*Step 1.2 quotes are kept/);
  assert.match(rootEffects('PI', {}, { poNumber: 'PO-9' })[0], /PO-9 goes back to "no PI"/);
  assert.match(rootEffects('ADVANCE_PAYMENT', { paymentStatus: 'FULL_PAYMENT', paidAmount: 100 }, { piNumber: 'PI-1' })[0], /does not refund/);
  assert.deepEqual(rootEffects('ADVANCE_PAYMENT', { paymentStatus: 'CANCELLED' }, {}), []);
  assert.match(rootEffects('TALLY_ENTRY', { tallyEntryStatus: 'COMPLETED' }, { voucherNumber: 'V-1' })[0], /Reverse the entry in Tally/);
});

test('the cascade service and routes load with every step service (no import cycle)', async () => {
  const svc = await import('../cascadeDelete.service.js');
  assert.equal(typeof svc.cascadeDeleteService.preview, 'function');
  assert.equal(typeof svc.cascadeDeleteService.execute, 'function');
  const { indentService } = await import('../../indent/indent.service.js');
  assert.equal(typeof indentService.resetQuotationStep, 'function');
  const routes = await import('../cascadeDelete.routes.js');
  assert.ok(routes.default);
});
