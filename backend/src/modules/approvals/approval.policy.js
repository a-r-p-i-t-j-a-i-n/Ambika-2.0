/**
 * MD approval policy — pure rules, no database (unit-tested on their own).
 *
 * Business rule: MD approval is RECORDED for every document the approval engine
 * tracks (GRN, Voucher, …), but it never pauses the workflow those documents
 * belong to — QC, Tally Entry, invoicing and so on proceed while it is pending.
 * The ONE mandatory gate is payment execution: no vendor payment is recorded
 * until the MD has approved the document it is paid against — the voucher for
 * a Final Payment, the Proforma Invoice for an Advance Payment.
 *
 * Also shapes the rows of the MD Approval screen (GET /approvals): the engine's
 * own status (READY_FOR_APPROVAL | APPROVED) plus the document's workflow state
 * give the three buckets the MD tracks independently of each other:
 *   PENDING    not yet approved by the MD (the workflow may already be moving)
 *   APPROVED   approved, the document's workflow is still in progress
 *   COMPLETED  approved, and the document's workflow is closed
 */

export const MD_APPROVED = 'MD_APPROVED';

export const isMdApproved = (doc) => doc?.approvalStatus === MD_APPROVED;

/**
 * The reason a payment must be refused, or null when it may proceed.
 * `mdStatus` is the paid-against document's MD approval mirror field
 * (voucher.approvalStatus / pi.mdApprovalStatus); `noun` names that document.
 */
export const paymentApprovalBlock = (mdStatus, noun = 'voucher') => {
  if (mdStatus === MD_APPROVED) return null;
  return mdStatus === 'READY_FOR_MD_APPROVAL'
    ? `Payment cannot be processed until the MD approves this ${noun}`
    : `Payment cannot be processed — this ${noun} has no MD approval yet`;
};

export const APPROVAL_VIEW_STATUS = {
  PENDING:   'PENDING',
  APPROVED:  'APPROVED',
  COMPLETED: 'COMPLETED',
};

export const approvalViewStatus = (engineStatus, workflowCompleted) => {
  if (engineStatus !== 'APPROVED') return APPROVAL_VIEW_STATUS.PENDING;
  return workflowCompleted ? APPROVAL_VIEW_STATUS.COMPLETED : APPROVAL_VIEW_STATUS.APPROVED;
};

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

/**
 * Filters every MD Approval row except by status — the summary cards count
 * this set, so they follow the module / vendor / date / search scope while
 * each card still offers its own status.
 */
export const scopeApprovalRows = (rows, { documentType, vendor, from, to, search } = {}) => {
  const q = String(search || '').trim().toLowerCase();
  const fromAt = from ? startOfDay(from) : null;
  const toAt = to ? endOfDay(to) : null;
  return rows.filter((r) => {
    if (documentType && r.documentType !== documentType) return false;
    if (vendor && r.vendorName !== vendor) return false;
    const at = r.requestedAt ? new Date(r.requestedAt) : null;
    if (fromAt && (!at || at < fromAt)) return false;
    if (toAt && (!at || at > toAt)) return false;
    if (q) {
      const hay = [r.documentNumber, r.vendorName, r.requestedByName, r.module, r.documentLabel]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
};

export const summarizeApprovalRows = (rows) => {
  const out = { total: rows.length, pending: 0, approved: 0, completed: 0, paymentBlocked: 0 };
  for (const r of rows) {
    if (r.approvalStatus === APPROVAL_VIEW_STATUS.PENDING) {
      out.pending += 1;
      if (r.gatesPayment) out.paymentBlocked += 1;
    } else if (r.approvalStatus === APPROVAL_VIEW_STATUS.APPROVED) out.approved += 1;
    else if (r.approvalStatus === APPROVAL_VIEW_STATUS.COMPLETED) out.completed += 1;
  }
  return out;
};

/** Pending first (oldest request waits longest at the top), then the rest newest first. */
export const sortApprovalRows = (rows) => [...rows].sort((a, b) => {
  const ap = a.approvalStatus === APPROVAL_VIEW_STATUS.PENDING;
  const bp = b.approvalStatus === APPROVAL_VIEW_STATUS.PENDING;
  if (ap !== bp) return ap ? -1 : 1;
  const at = new Date(a.requestedAt || 0).getTime();
  const bt = new Date(b.requestedAt || 0).getTime();
  return ap ? at - bt : bt - at;
});
