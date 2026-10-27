/**
 * Purchase FMS list "step timing" — Planned / Actual / Done By / Assigned Doer
 * for each list row, read from fields the workflow ALREADY records. Pure (no
 * DB): stepTiming.js loads the doer tasks + user names and calls
 * resolveStepTiming() per row.
 *
 * Rules (same as O2D's board):
 *   - Native document fields decide whether a step is done and supply its
 *     planned date, actual timestamp and completing user. Nothing is derived
 *     from createdAt / updatedAt, except the two payment entries (Advance /
 *     Final Payment), where saving the entry IS performing the step.
 *   - The assigned doer comes only from fms-doers' FmsTask rows, so the doer
 *     and the person who actually completed the step are shown separately.
 *   - A row shows its CURRENT step: the first step not yet done (pending →
 *     planned + doer, no actual), or the last step once all are done. A
 *     rejected / cancelled row shows its last recorded decision, else nothing.
 */

import { quotationApprovalPlannedAt } from './indent/quotationSteps.js';

const lastTimeline = (d, action) => {
  const log = d.activityTimeline || [];
  for (let i = log.length - 1; i >= 0; i -= 1) if (log[i]?.action === action) return log[i];
  return null;
};

const ent = (entityType, id) => (id ? { entityType, entityId: id } : null);

// Indent overall statuses that are past Step 1.2 / Step 1.3 (rejections count:
// the step's decision was recorded).
const QUOTATION_APPROVAL_DONE = new Set([
  'QUOTATION_APPROVED', 'QUOTATION_NOT_APPROVED', 'PARTIAL_PO_CREATED', 'PO_READY',
  'SERVICE_PENDING', 'SERVICE_COMPLETED', 'SERVICE_QC_PASSED', 'SERVICE_QC_FAILED', 'SERVICE_QC_PARTIAL',
]);
const QUOTE_DONE = new Set(['QUOTE_RECEIVED', 'QUOTE_NOT_REQUIRED', ...QUOTATION_APPROVAL_DONE]);

const quoteActual = (d) => d.quoteComparativeStep?.actualAt || d.quoteStep?.actualAt || null;

export const STEP_TIMING = {
  INDENT: {
    entities: (d) => [ent('INDENT', d._id)],
    terminated: (d) => d.approvalStatus === 'REJECTED' || ['CLOSED', 'QUOTATION_NOT_APPROVED'].includes(d.overallStatus),
    steps: [
      {
        key: 'INDENT_CREATE',
        done: (d) => !!d.approvalStatus && d.approvalStatus !== 'DRAFT',
        actual: (d) => lastTimeline(d, 'SUBMIT')?.timestamp,
        byUserId: (d) => lastTimeline(d, 'SUBMIT')?.actorId,
      },
      {
        key: 'INDENT_APPROVAL',
        done: (d) => ['APPROVED', 'REJECTED'].includes(d.approvalStatus),
        actual: (d) => d.approval?.approvedAt,
        byName: (d) => d.approval?.approvedBy,
      },
      {
        key: 'QUOTE_COMPARATIVE',
        done: (d) => !!quoteActual(d) || QUOTE_DONE.has(d.overallStatus),
        planned: (d) => d.quoteStep?.plannedAt,
        actual: quoteActual,
        byUserId: (d) => d.quoteComparativeStep?.updatedBy,
      },
      {
        key: 'QUOTATION_APPROVAL',
        // "Quote Not Required" skips Step 1.3 but stamps actualAt / updatedBy of
        // the Step 1.2 user on it — nobody performed it, so it is never shown.
        skipped: (d) => !!d.quotationApprovalStep?.skipped,
        done: (d) => !!d.quotationApprovalStep?.actualAt || QUOTATION_APPROVAL_DONE.has(d.overallStatus),
        // 1 working day after Step 1.2's actual date — none until 1.2 is done.
        planned: quotationApprovalPlannedAt,
        actual: (d) => d.quotationApprovalStep?.actualAt,
        byUserId: (d) => d.quotationApprovalStep?.updatedBy,
      },
    ],
  },

  PO: {
    entities: (d) => [ent('PO', d._id)],
    terminated: (d) => d.approvalStatus === 'REJECTED' || d.poStatus === 'CANCELLED',
    steps: [
      {
        key: 'PO_APPROVAL',
        done: (d) => !!d.approvalStatus && d.approvalStatus !== 'DRAFT',
        actual: (d) => d.approval?.decidedAt,
        byName: (d) => d.approval?.decidedBy,
      },
      {
        key: 'PO_RELEASE',
        done: (d) => d.releaseStatus === 'RELEASED' || !!d.releasedAt,
        actual: (d) => d.releasedAt,
        byName: (d) => d.releasedBy,
      },
    ],
  },

  FOLLOW_UP: {
    entities: (d) => [ent('PO', d.poId)],
    terminated: (d) => d.followUpStatus === 'CLOSED',
    steps: [{
      key: 'MATERIAL_FOLLOWUP',
      // A rescheduled cycle is still pending: its plannedAt is the next contact
      // and performedByName holds the creator until the cycle is concluded.
      done: (d) => d.statusDone === 'YES' || ['READY_FOR_GRN', 'DONE'].includes(d.followUpStatus),
      planned: (d) => d.plannedAt,
      actual: (d) => d.actualAt,
      byName: (d) => d.performedByName,
    }],
  },

  PI: {
    entities: (d) => [ent('PI', d._id)],
    terminated: (d) => d.piStatus === 'CANCELLED',
    steps: [{
      key: 'PROFORMA_INVOICE',
      done: (d) => ['APPROVED', 'REJECTED'].includes(d.approvalStatus) || !!d.approvedAt || !!d.rejectedAt,
      actual: (d) => (d.approvalStatus === 'REJECTED' ? d.rejectedAt : d.approvedAt),
      byName: (d) => (d.approvalStatus === 'REJECTED' ? d.rejectedBy : d.approvedBy),
    }],
  },

  ADVANCE_PAYMENT: {
    entities: (d) => [ent('PI', d.piId)],
    terminated: (d) => d.paymentStatus === 'CANCELLED',
    steps: [{
      key: 'ADVANCE_PAYMENT',
      done: (d) => d.paymentStatus !== 'CANCELLED',
      actual: (d) => d.createdAt,
      byName: (d) => d.performedByName,
    }],
  },

  GRN: {
    entities: (d) => [ent('PO', d.poId)],
    terminated: (d) => d.grnStatus === 'CANCELLED',
    steps: [{
      key: 'GRN',
      done: (d) => ['RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED'].includes(d.grnStatus) || !!d.completedAt,
      actual: (d) => d.completedAt,
      byName: (d) => (typeof d.completedBy === 'string' ? d.completedBy : ''),
    }],
  },

  QC: {
    entities: (d) => (d.sourceType === 'SERVICE' ? [ent('INDENT', d.indentId)] : [ent('GRN', d.grnId)]),
    terminated: (d) => d.qcStatus === 'CANCELLED',
    steps: [{
      key: 'INCOMING_QC',
      done: (d) => ['PASSED', 'FAILED', 'PARTIAL'].includes(d.qcStatus),
      actual: (d) => d.completedAt,
      // checkedByName is set when the QC is created, not when it is completed.
      byUserId: (d) => lastTimeline(d, 'COMPLETE')?.actorId,
    }],
  },

  VENDOR_INVOICE: {
    entities: (d) => [ent('INVOICE', d._id), ent('QC', d.qcId)],
    terminated: (d) => d.invoiceStatus === 'REJECTED',
    steps: [{
      key: 'VENDOR_INVOICE',
      done: (d) => ['APPROVED', 'REJECTED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED'].includes(d.invoiceStatus) || !!d.approvedAt,
      actual: (d) => (d.invoiceStatus === 'REJECTED' ? d.rejectedAt : d.approvedAt),
      byName: (d) => (d.invoiceStatus === 'REJECTED' ? d.rejectedBy : d.approvedBy),
    }],
  },

  VOUCHER: {
    entities: (d) => [ent('VOUCHER', d._id), ent('INVOICE', d.invoiceId)],
    terminated: (d) => d.voucherStatus === 'CANCELLED',
    steps: [{
      key: 'BILL_PASSING',
      done: (d) => ['POSTED', 'PARTIALLY_PAID', 'FULLY_PAID', 'SHORT_CLOSED'].includes(d.voucherStatus) || !!d.postedAt,
      actual: (d) => d.postedAt,
      byUserId: (d) => lastTimeline(d, 'POST')?.actorId,
    }],
  },

  TALLY: {
    entities: (d) => [ent('VOUCHER', d.voucherId)],
    terminated: (d) => d.tallyEntryStatus === 'CANCELLED',
    steps: [{
      key: 'TALLY_ENTRY',
      // performedByName is the creator until the entry is completed.
      done: (d) => d.tallyEntryStatus === 'COMPLETED',
      planned: (d) => d.plannedAt,
      actual: (d) => d.actualAt || d.completedAt,
      byName: (d) => d.performedByName,
    }],
  },

  FINAL_PAYMENT: {
    entities: (d) => [ent('VOUCHER', d.voucherId)],
    terminated: (d) => d.paymentStatus === 'CANCELLED',
    steps: [{
      key: 'FINAL_PAYMENT',
      done: (d) => d.paymentStatus !== 'CANCELLED',
      actual: (d) => d.createdAt,
      byName: (d) => d.performedByName,
    }],
  },
};

const toDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const time = (v) => toDate(v)?.getTime() || 0;

/** Doer task for this row's step: the first entity (in priority order) that has one. */
// The Step 1.2 / Step 1.3 main-workflow lists show THAT step's timing on every
// row (pending, done or not required), not the indent's current step — built
// from the INDENT steps above so the rules stay in one place.
const indentStep = (key) => STEP_TIMING.INDENT.steps.find((s) => s.key === key);
STEP_TIMING.INDENT_QUOTE_COMPARATIVE = {
  entities: STEP_TIMING.INDENT.entities,
  terminated: STEP_TIMING.INDENT.terminated,
  steps: [indentStep('QUOTE_COMPARATIVE')],
};
// A skipped Step 1.3 counts as done for the row but has no actual or performer
// (the stamps on it belong to the Step 1.2 user who chose "Quote Not Required").
const approvalStep = indentStep('QUOTATION_APPROVAL');
STEP_TIMING.INDENT_QUOTATION_APPROVAL = {
  entities: STEP_TIMING.INDENT.entities,
  terminated: STEP_TIMING.INDENT.terminated,
  steps: [{
    key: approvalStep.key,
    done: (d) => approvalStep.skipped(d) || approvalStep.done(d),
    planned: approvalStep.planned,
    actual: (d) => (approvalStep.skipped(d) ? null : approvalStep.actual(d)),
    byUserId: (d) => (approvalStep.skipped(d) ? null : approvalStep.byUserId(d)),
  }],
};

export const pickTask = (tasks, entities, stepKey, done) => {
  for (const e of entities) {
    if (!e) continue;
    const mine = tasks.filter((t) => t.stepKey === stepKey && t.entityType === e.entityType
      && String(t.entityId) === String(e.entityId));
    if (!mine.length) continue;
    const latest = (list) => list.reduce((a, b) => (time(b.openedAt) > time(a.openedAt) ? b : a));
    const preferred = mine.filter((t) => t.status === (done ? 'DONE' : 'OPEN'));
    return latest(preferred.length ? preferred : mine);
  }
  return null;
};

const EMPTY = {
  stepKey: null, stepCode: '', stepLabel: '', multiStep: false,
  plannedAt: null, actualAt: null, doneByName: null, assignedDoerName: null, done: false,
};

/**
 * @param doc   lean workflow document (list row)
 * @param def   STEP_TIMING entry
 * @param ctx   { tasks: FmsTask[] (assignedDoerId populated with name),
 *                names: Map<userId, name>, meta: { [stepKey]: { code, label } } }
 */
export const resolveStepTiming = (doc, def, { tasks = [], names = new Map(), meta = {} } = {}) => {
  const multiStep = def.steps.length > 1;
  const steps = def.steps.filter((s) => !s.skipped?.(doc));
  const doneFlags = steps.map((s) => !!s.done(doc));
  let idx = doneFlags.indexOf(false);
  let done = false;
  if (idx === -1) {
    idx = steps.length - 1;
    done = true;
  } else if (def.terminated?.(doc)) {
    idx = doneFlags.lastIndexOf(true);
    if (idx === -1) return { ...EMPTY, multiStep };
    done = true;
  }

  const step = steps[idx];
  const task = pickTask(tasks, def.entities(doc), step.key, done);
  const byId = step.byUserId?.(doc);
  return {
    stepKey: step.key,
    stepCode: meta[step.key]?.code || '',
    stepLabel: meta[step.key]?.label || step.key,
    multiStep,
    plannedAt: toDate(step.planned?.(doc)),
    actualAt: done ? toDate(step.actual?.(doc)) : null,
    doneByName: done ? (str(step.byName?.(doc)) || str(byId ? names.get(String(byId)) : null)) : null,
    assignedDoerName: str(task?.assignedDoerId?.name),
    done,
  };
};
