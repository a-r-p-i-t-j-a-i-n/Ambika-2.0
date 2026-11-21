import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  poMakerIds, canApprovePos, poApprovalBlock, PO_APPROVE_FORBIDDEN, PO_MAKER_CHECKER_MESSAGE,
} from '../poApproval.js';

const BUYER = { _id: 'b1', name: 'Buyer', role: 'EA', roles: ['PLANNER'] };
const EDITOR = { _id: 'e1', name: 'Editor', roles: ['PLANNER'] };
const APPROVER = { _id: 'a1', name: 'Approver', roles: ['PLANNER'] };
const MD = { _id: 'm1', name: 'MD', role: 'MD', roles: ['MD'] };
const EX_MD = { _id: 'x1', name: 'Ex MD', role: 'MD', roles: ['PLANNER'] }; // MD role removed, legacy field left behind
const PERM = new Set(['procurement.approve']);
const ROOT = new Set(['*']);
const NONE = new Set(['procurement.createPo']);

const po = {
  createdBy: { _id: 'b1', name: 'Buyer' }, // populated on list reads
  submittedById: 's1',
  activityTimeline: [
    { action: 'CREATE', actorId: 'b1' },
    { action: 'UPDATE', actorId: 'e1' },
    { action: 'SUBMIT', actorId: 's1' },
    { action: 'EMAIL_SENT', actorId: 'z1' }, // not preparing the PO
  ],
};

test('makers = creator, submitter and anyone who edited the draft', () => {
  assert.deepEqual([...poMakerIds(po)].sort(), ['b1', 'e1', 's1']);
  assert.deepEqual([...poMakerIds({ activityTimeline: [{ action: 'UPDATE_TERMS', actorId: 't1' }, { action: 'REVISE', actorId: 'r1' }] })].sort(), ['r1', 't1']);
  assert.equal(poMakerIds({}).size, 0); // legacy PO with no creator recorded
});

test('procurement.approve or root is needed to decide a PO', () => {
  assert.equal(canApprovePos(PERM), true);
  assert.equal(canApprovePos(ROOT), true);
  assert.equal(canApprovePos(NONE), false);
  assert.equal(canApprovePos(undefined), false);
  assert.deepEqual(poApprovalBlock(APPROVER, po, NONE), { status: 403, message: PO_APPROVE_FORBIDDEN });
});

test('maker-checker: the creator, an editor or the submitter cannot decide it', () => {
  for (const u of [BUYER, EDITOR, { _id: 's1', roles: ['PLANNER'] }]) {
    assert.deepEqual(poApprovalBlock(u, po, PERM), { status: 403, message: PO_MAKER_CHECKER_MESSAGE }, u._id);
  }
  assert.equal(poApprovalBlock(APPROVER, po, PERM), null);
});

test('the MD may decide a PO they prepared (as with Save PO Directly); a removed MD may not', () => {
  const mdPo = { ...po, createdBy: 'm1', activityTimeline: [{ action: 'CREATE', actorId: 'm1' }] };
  assert.equal(poApprovalBlock(MD, mdPo, ROOT), null);
  const exPo = { createdBy: 'x1', activityTimeline: [] };
  assert.deepEqual(poApprovalBlock(EX_MD, exPo, PERM), { status: 403, message: PO_MAKER_CHECKER_MESSAGE });
});
