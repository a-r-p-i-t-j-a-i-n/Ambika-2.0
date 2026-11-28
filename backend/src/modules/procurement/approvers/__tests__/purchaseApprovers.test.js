import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approverEmails, isDesignatedApprover, DEFAULT_APPROVER_EMAILS } from '../purchaseApprovers.js';
import { newVendorVerdict, newVendorStamp, NEW_VENDOR_REASON } from '../newVendorRule.js';
import {
  poApprovalBlock, PO_APPROVE_FORBIDDEN, NEW_VENDOR_APPROVE_FORBIDDEN, PO_MAKER_CHECKER_MESSAGE,
} from '../../purchase-order/poApproval.js';
import { viewStatusOf } from '../newVendorPoApproval.js';

const MD = { _id: 'm1', name: 'MD', email: 'gaurav@example.test', role: 'MD', roles: ['MD'] };
const EX_MD = { _id: 'x1', name: 'Ex MD', email: 'ex@example.test', role: 'MD', roles: ['PLANNER'] }; // role removed, legacy field left
const IMP = { _id: 'i1', name: 'Aarti', email: 'IMP@msambikaglobal.in ', role: 'Process Coordinator', roles: ['DISPATCH_SUPERVISOR'] };
const OTHER = { _id: 'o1', name: 'Other', email: 'other@example.test', roles: ['PLANNER'] };
const PERM = new Set(['procurement.approve']);
const NONE = new Set(['procurement.createPo']);

test('approver e-mails: default is the purchase approver, env list is normalised', () => {
  assert.deepEqual(approverEmails(''), DEFAULT_APPROVER_EMAILS);
  assert.deepEqual(approverEmails(undefined), ['imp@msambikaglobal.in']);
  assert.deepEqual(approverEmails(' A@X.com ; b@x.com,a@x.com '), ['a@x.com', 'b@x.com']);
});

test('designated approver = the MD or the configured e-mail (case / space-insensitive) — nobody else', () => {
  assert.equal(isDesignatedApprover(MD), true);
  assert.equal(isDesignatedApprover(IMP), true);
  assert.equal(isDesignatedApprover(OTHER), false);
  // MD role removed → no longer an approver by the leftover legacy field (same strict identity as "Save PO Directly").
  assert.equal(isDesignatedApprover(EX_MD), false);
  // Holding the approval permission never makes a user designated.
  assert.equal(isDesignatedApprover({ ...OTHER, permissionGrants: ['procurement.approve'] }), false);
  assert.equal(isDesignatedApprover(null), false);
  // A deactivated account never is, even with the right e-mail.
  assert.equal(isDesignatedApprover({ ...IMP, isActive: false }), false);
  assert.equal(isDesignatedApprover({ ...MD, isActive: false }), false);
  // The list is configurable per environment.
  assert.equal(isDesignatedApprover(OTHER, ['other@example.test']), true);
  assert.equal(isDesignatedApprover(IMP, ['someone@else.test']), false);
});

test('new vendor: created after the rule went live AND no approved PO yet — never merely "no purchase history"', () => {
  const ruleFrom = new Date('2026-11-28T00:00:00Z');
  const created = (d) => ({ createdAt: new Date(d) });
  const v = (o) => newVendorVerdict({ ruleFrom, ...o });
  assert.deepEqual(v({ vendor: created('2026-11-28T09:00:00Z'), approvedPoCount: 0 }), { isNew: true, reason: NEW_VENDOR_REASON.NEW_VENDOR });
  // An old vendor with no purchase history at all is NOT new.
  assert.deepEqual(v({ vendor: created('2025-01-05T09:00:00Z'), approvedPoCount: 0 }), { isNew: false, reason: NEW_VENDOR_REASON.CREATED_BEFORE_RULE });
  // A new vendor is vetted by its first approved PO.
  assert.deepEqual(v({ vendor: created('2026-11-29T09:00:00Z'), approvedPoCount: 1 }), { isNew: false, reason: NEW_VENDOR_REASON.ALREADY_APPROVED_PO });
  // Not in the Vendor Master (a legacy Party) / no creation record / rule never stamped.
  assert.equal(v({ vendor: null }).reason, NEW_VENDOR_REASON.NOT_IN_VENDOR_MASTER);
  assert.equal(v({ vendor: {} }).reason, NEW_VENDOR_REASON.NO_CREATION_RECORD);
  assert.equal(newVendorVerdict({ vendor: created('2026-12-01'), ruleFrom: null }).isNew, false);
  // The creation instant itself counts as new (>=).
  assert.equal(v({ vendor: created('2026-11-28T00:00:00Z') }).isNew, true);
});

test('the PO carries the verdict as a stamp', () => {
  const at = new Date('2026-12-01T10:00:00Z');
  const s = newVendorStamp({ isNew: true, reason: 'NEW_VENDOR', vendorCreatedAt: new Date('2026-11-30T00:00:00Z') }, at);
  assert.deepEqual(s, { isRequired: true, reason: 'NEW_VENDOR', vendorCreatedAt: new Date('2026-11-30T00:00:00Z'), evaluatedAt: at });
  assert.equal(newVendorStamp({ isNew: false, reason: 'CREATED_BEFORE_RULE' }, at).isRequired, false);
  assert.equal(newVendorStamp(undefined, at).isRequired, false);
});

const po = { createdBy: 'b1', submittedById: 'b1', activityTimeline: [{ action: 'CREATE', actorId: 'b1' }] };

test('new-vendor PO: only the MD / purchase approver decide it — procurement.approve does not reach it', () => {
  const ctx = (designated) => ({ newVendor: true, designated });
  // A permission holder who is not designated is refused…
  assert.deepEqual(poApprovalBlock(OTHER, po, PERM, ctx(false)), { status: 403, message: NEW_VENDOR_APPROVE_FORBIDDEN });
  // …either designated approver passes with no permission at all (one is enough — neither needs the other).
  assert.equal(poApprovalBlock(IMP, po, NONE, ctx(true)), null);
  assert.equal(poApprovalBlock(MD, po, NONE, ctx(true)), null);
});

test('ordinary PO: unchanged — procurement.approve decides, being designated alone is not enough', () => {
  assert.equal(poApprovalBlock(OTHER, po, PERM), null);
  assert.deepEqual(poApprovalBlock(IMP, po, NONE, { newVendor: false, designated: true }), { status: 403, message: PO_APPROVE_FORBIDDEN });
});

test('maker-checker still applies to a new-vendor PO — the purchase approver cannot approve what they prepared; the MD may', () => {
  const impMade = { createdBy: 'i1', submittedById: 'i1', activityTimeline: [{ action: 'CREATE', actorId: 'i1' }] };
  assert.deepEqual(poApprovalBlock(IMP, impMade, NONE, { newVendor: true, designated: true }), { status: 403, message: PO_MAKER_CHECKER_MESSAGE });
  const mdMade = { createdBy: 'm1', submittedById: 'm1', activityTimeline: [{ action: 'SUBMIT', actorId: 'm1' }] };
  assert.equal(poApprovalBlock(MD, mdMade, NONE, { newVendor: true, designated: true }), null);
});

test('Purchase Approval status of a new-vendor PO follows its approval status', () => {
  assert.equal(viewStatusOf({ approvalStatus: 'DRAFT' }), 'PENDING');
  assert.equal(viewStatusOf({ approvalStatus: 'APPROVED' }), 'APPROVED');
  assert.equal(viewStatusOf({ approvalStatus: 'REJECTED' }), 'REJECTED');
});
