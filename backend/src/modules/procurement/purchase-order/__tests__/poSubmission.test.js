import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PO_SUBMISSION_STATUS, PO_SAVE_MODE, isPoSubmitted, awaitsSubmission,
  submissionFieldsFor, createdNote, SUBMITTED_FILTER, NOT_SUBMITTED_FILTER,
} from '../poSubmission.js';

const USER = { _id: 'u1', name: 'Buyer One' };
const AT = new Date('2026-11-19T10:00:00Z');

test('a PO with no submissionStatus (saved before submission existed) reads as submitted', () => {
  assert.equal(isPoSubmitted({ approvalStatus: 'DRAFT' }), true);
  assert.equal(isPoSubmitted({ approvalStatus: 'DRAFT', submissionStatus: 'SUBMITTED' }), true);
  assert.equal(isPoSubmitted({ approvalStatus: 'DRAFT', submissionStatus: 'NOT_SUBMITTED' }), false);
});

test('only a live, unsubmitted draft awaits submission', () => {
  assert.equal(awaitsSubmission({ approvalStatus: 'DRAFT', poStatus: 'DRAFT', submissionStatus: 'NOT_SUBMITTED' }), true);
  assert.equal(awaitsSubmission({ approvalStatus: 'DRAFT', poStatus: 'CANCELLED', submissionStatus: 'NOT_SUBMITTED' }), false);
  assert.equal(awaitsSubmission({ approvalStatus: 'APPROVED', poStatus: 'APPROVED', submissionStatus: 'NOT_SUBMITTED' }), false);
  assert.equal(awaitsSubmission({ approvalStatus: 'DRAFT', poStatus: 'DRAFT' }), false);
});

test('Save as Draft keeps the PO back; Submit, Direct and no save mode submit it', () => {
  assert.deepEqual(submissionFieldsFor(PO_SAVE_MODE.DRAFT, USER, AT), {
    submissionStatus: 'NOT_SUBMITTED', submittedAt: null, submittedById: null, submittedBy: '',
  });
  for (const mode of [PO_SAVE_MODE.SUBMIT, PO_SAVE_MODE.DIRECT, undefined]) {
    assert.deepEqual(submissionFieldsFor(mode, USER, AT), {
      submissionStatus: 'SUBMITTED', submittedAt: AT, submittedById: 'u1', submittedBy: 'Buyer One',
    }, String(mode));
  }
  assert.match(createdNote('DRAFT'), /not yet submitted/);
  assert.match(createdNote(undefined), /submitted for approval/);
});

test('queue filters: submitted = not NOT_SUBMITTED (so a missing value counts)', () => {
  assert.deepEqual(SUBMITTED_FILTER, { submissionStatus: { $ne: PO_SUBMISSION_STATUS.NOT_SUBMITTED } });
  assert.deepEqual(NOT_SUBMITTED_FILTER, { submissionStatus: 'NOT_SUBMITTED' });
});
