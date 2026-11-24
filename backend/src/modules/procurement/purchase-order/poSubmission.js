/**
 * PO submission — the step between preparing a PO and approving it.
 *
 *   Save as Draft        → approvalStatus DRAFT, submissionStatus NOT_SUBMITTED.
 *                          The buyer's working copy: editable, NOT in the
 *                          approver's queue, cannot be approved yet.
 *   Submit for Approval  → approvalStatus DRAFT, submissionStatus SUBMITTED.
 *                          Waits in PO Approval (doer step 1.4A); still editable
 *                          until it is decided.
 *   Approve / Reject     → unchanged (purchaseOrder.service approve()), and only
 *                          for a SUBMITTED draft. Submitting never approves.
 *   Save PO Directly     → MD only (poDirectSave.js): submitted + approved in one go.
 *
 * A PO saved before this field existed has no submissionStatus and was already
 * in the approval queue, so "missing" reads as SUBMITTED. For the same reason a
 * create request that names no saveMode (API clients, scripts) is submitted,
 * exactly as before; only an explicit saveMode DRAFT keeps the PO back.
 *
 * Pure: no DB access.
 */

export const PO_SUBMISSION_STATUS = {
  NOT_SUBMITTED: 'NOT_SUBMITTED',
  SUBMITTED:     'SUBMITTED',
};

export const PO_SAVE_MODE = {
  DRAFT:  'DRAFT',  // keep as a working draft
  SUBMIT: 'SUBMIT', // send to PO Approval
  DIRECT: 'DIRECT', // MD: create + approve
};

/** Whether the PO is (or was) submitted for approval — missing = submitted. */
export const isPoSubmitted = (po) => po?.submissionStatus !== PO_SUBMISSION_STATUS.NOT_SUBMITTED;

/** A draft the buyer has saved but not yet submitted. */
export const awaitsSubmission = (po) => po?.approvalStatus === 'DRAFT'
  && po?.poStatus !== 'CANCELLED'
  && !isPoSubmitted(po);

/** Mongo filter part: drafts that are in the approval queue. */
export const SUBMITTED_FILTER = { submissionStatus: { $ne: PO_SUBMISSION_STATUS.NOT_SUBMITTED } };
/** Mongo filter part: drafts saved but not submitted. */
export const NOT_SUBMITTED_FILTER = { submissionStatus: PO_SUBMISSION_STATUS.NOT_SUBMITTED };

/** Fields a new PO starts with for the requested save mode. */
export const submissionFieldsFor = (saveMode, user, at = new Date()) => (saveMode === PO_SAVE_MODE.DRAFT
  ? { submissionStatus: PO_SUBMISSION_STATUS.NOT_SUBMITTED, submittedAt: null, submittedById: null, submittedBy: '' }
  : { submissionStatus: PO_SUBMISSION_STATUS.SUBMITTED, submittedAt: at, submittedById: user?._id || null, submittedBy: user?.name || '' });

/** Activity-log wording for a new PO. */
export const createdNote = (saveMode) => (saveMode === PO_SAVE_MODE.DRAFT
  ? 'saved as draft — not yet submitted for approval'
  : 'submitted for approval');

export const NOT_SUBMITTED_APPROVE_MESSAGE = 'This PO is a draft that has not been submitted yet — submit it for approval first';
