/**
 * PO submission — mirrors backend purchase-order/poSubmission.js.
 *
 *   Save as Draft        → DRAFT + NOT_SUBMITTED: the buyer's working copy, not in
 *                          PO Approval, cannot be approved yet.
 *   Submit for Approval  → DRAFT + SUBMITTED: waits in PO Approval.
 *   Approve / Reject     → only a submitted draft (unchanged approval step).
 *
 * A PO saved before submission existed has no submissionStatus and was already
 * waiting for approval, so a missing value reads as submitted.
 */
export const isPoSubmitted = (po) => po?.submissionStatus !== 'NOT_SUBMITTED';

/** A live draft the buyer saved but has not submitted. */
export const awaitsSubmission = (po) => po?.approvalStatus === 'DRAFT'
  && po?.poStatus !== 'CANCELLED'
  && !isPoSubmitted(po);

/** A submitted draft — the approver's turn. */
export const awaitsApproval = (po) => po?.approvalStatus === 'DRAFT'
  && po?.poStatus !== 'CANCELLED'
  && isPoSubmitted(po);

