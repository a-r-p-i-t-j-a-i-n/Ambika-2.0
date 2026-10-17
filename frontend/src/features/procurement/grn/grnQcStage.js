/**
 * Which state the Incoming QC of a GRN is in, why, and what to call it. Pure —
 * the GRN form, the GRN page and the GRN list all render from this, and it is
 * tested on its own. Derived only from persisted data (the GRN + its QC record);
 * the absence of a QC record is never read as "QC done".
 *
 * Mirrors the server's gates (incomingQc.service create): QC needs a completed
 * GRN (stock posted) that the MD has digitally signed. Nothing here relaxes them.
 *
 *   NOT_SAVED      GRN not saved yet (Create GRN form) — no QC possible
 *   CANCELLED      GRN cancelled — no QC
 *   GRN_DRAFT      GRN saved but not completed — complete & post stock first
 *   AWAITING_MD    completed, waiting for the MD signature
 *   QC_READY       signed, no QC yet — the form is open
 *   QC_DRAFT       signed, a draft / in-progress QC exists — resume it
 *   QC_DONE        QC completed (PASSED / PARTIAL / FAILED)
 *   QC_DONE_LEGACY GRN says QC is done but the QC record isn't loaded (e.g. in a list)
 *
 * Each stage carries `label` + `tone` for a StatusChip.
 */
const COMPLETED_GRN = ['RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED'];
const QC_ACTIVE = ['DRAFT', 'IN_PROGRESS'];
const QC_COMPLETED = ['PASSED', 'FAILED', 'PARTIAL'];

const DONE_LABEL = {
  PASSED: { label: 'QC Completed · Passed', tone: 'green' },
  PARTIAL: { label: 'QC Completed · Partial', tone: 'orange' },
  FAILED: { label: 'QC Completed · Failed', tone: 'red' },
};

export const resolveGrnQcStage = (grn, qc = null) => {
  if (!grn?._id && !grn?.grnStatus) {
    return {
      key: 'NOT_SAVED', editable: false, label: 'QC Not Started', tone: 'neutral',
      title: 'Incoming QC has not started',
      desc: 'Save this GRN first. Incoming QC is recorded on the GRN page once the GRN is completed (stock posted) and signed by the MD.',
    };
  }
  if (grn.grnStatus === 'CANCELLED') {
    return { key: 'CANCELLED', editable: false, label: 'No QC', tone: 'neutral', title: 'GRN cancelled', desc: 'A cancelled GRN has no Incoming QC.' };
  }
  if (!COMPLETED_GRN.includes(grn.grnStatus)) {
    return {
      key: 'GRN_DRAFT', editable: false, label: 'QC Pending', tone: 'amber',
      title: 'Complete the GRN first',
      desc: 'Incoming QC opens once the GRN is completed (Complete & Post Stock) and digitally signed by the MD.',
    };
  }
  if (qc && QC_COMPLETED.includes(qc.qcStatus)) return { key: 'QC_DONE', editable: false, ...DONE_LABEL[qc.qcStatus] };
  if (!qc && QC_COMPLETED.includes(grn.qcStatus)) return { key: 'QC_DONE_LEGACY', editable: false, ...DONE_LABEL[grn.qcStatus] };
  if (grn.approvalStatus !== 'MD_APPROVED') {
    return {
      key: 'AWAITING_MD', editable: false, label: 'Awaiting MD Signature', tone: 'amber',
      title: 'Waiting for MD signature',
      desc: grn.approvalStatus === 'READY_FOR_MD_APPROVAL'
        ? 'Incoming QC can start only after the Managing Director digitally signs this GRN — see MD Approval above.'
        : 'Incoming QC needs this GRN to be MD-signed, but no MD approval has been raised for it. Contact the administrator.',
    };
  }
  if (qc && QC_ACTIVE.includes(qc.qcStatus)) return { key: 'QC_DRAFT', editable: true, label: 'QC Draft', tone: 'indigo' };
  return { key: 'QC_READY', editable: true, label: 'QC Pending', tone: 'amber' };
};
