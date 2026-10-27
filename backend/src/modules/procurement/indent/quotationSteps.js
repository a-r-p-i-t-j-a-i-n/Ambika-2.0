/**
 * Step 1.2 (Receive Quote & Make Comparative) and Step 1.3 (Approved Quotation)
 * as first-class Purchase FMS workflow steps.
 *
 * Both steps live on the indent document (quoteComparativeStep /
 * quotationApprovalStep) and progress through its overallStatus — there is no
 * separate quotation record. This module is the one place that says which
 * indents sit at each step and in which state, so the main-workflow step lists,
 * their counts and the doer tasks (fms-doers/fmsCatalog.js) all agree. Pure: no
 * DB access, filters only.
 *
 * States per step:
 *   PENDING       waiting for this step's doer
 *   DONE          1.2: quotation received (Yes) · 1.3: quotation approved
 *   NOT_REQUIRED  1.2: "Quote Not Required" · 1.3: skipped because of that
 * The three states partition every approved indent (1.2) / every indent past
 * Step 1.2 (1.3), so the state counts always add up to the step's total.
 */

export const QUOTATION_FMS_STEPS = ['QUOTE_COMPARATIVE', 'QUOTATION_APPROVAL'];
export const QUOTATION_STEP_STATES = ['PENDING', 'DONE', 'NOT_REQUIRED'];

// Doer-task sources (fmsCatalog) — unchanged values, now shared with the lists.
export const QUOTE_COMPARATIVE_PENDING = { overallStatus: 'QUOTE_PENDING' };
export const QUOTATION_APPROVAL_PENDING = { overallStatus: { $in: ['QUOTE_RECEIVED', 'QUOTE_NOT_REQUIRED'] } };

// Step 1.2 answered "Quote Not Required" — the current item-wise field, the
// Step 1.3 skip it causes, or the older quoteStep / receive-quote shapes.
const QUOTE_NOT_REQUIRED = {
  $or: [
    { 'quoteComparativeStep.statusDone': 'QUOTE_NOT_REQUIRED' },
    { 'quotationApprovalStep.skipped': true },
    { 'quoteComparativeStep.statusDone': { $in: [null, ''] }, 'quoteStep.status': 'NOT_REQUIRED' },
  ],
};
const NOT_QUOTE_NOT_REQUIRED = { $nor: QUOTE_NOT_REQUIRED.$or };

const APPROVED = { approvalStatus: 'APPROVED' };
const PAST_STEP_12 = { overallStatus: { $ne: 'QUOTE_PENDING' } };

/**
 * Mongo filter for the indents shown at `fmsStep` in `stepState` (no state =
 * every indent that reaches the step). Returns null for an unknown step.
 */
export const quotationStepFilter = (fmsStep, stepState) => {
  if (fmsStep === 'QUOTE_COMPARATIVE') {
    switch (stepState) {
      case 'PENDING':      return { $and: [APPROVED, QUOTE_COMPARATIVE_PENDING] };
      case 'NOT_REQUIRED': return { $and: [APPROVED, PAST_STEP_12, QUOTE_NOT_REQUIRED] };
      case 'DONE':         return { $and: [APPROVED, PAST_STEP_12, NOT_QUOTE_NOT_REQUIRED] };
      default:             return { $and: [APPROVED] };
    }
  }
  if (fmsStep === 'QUOTATION_APPROVAL') {
    const pending = { 'quotationApprovalStep.skipped': { $ne: true }, ...QUOTATION_APPROVAL_PENDING };
    switch (stepState) {
      case 'PENDING':      return { $and: [APPROVED, pending] };
      case 'NOT_REQUIRED': return { $and: [APPROVED, PAST_STEP_12, { 'quotationApprovalStep.skipped': true }] };
      case 'DONE':         return {
        $and: [APPROVED, PAST_STEP_12, { 'quotationApprovalStep.skipped': { $ne: true } }, { $nor: [pending] }],
      };
      default:             return { $and: [APPROVED, PAST_STEP_12] };
    }
  }
  return null;
};

// Indent statuses that mean a PO was raised or the service moved on — the
// quotation steps can no longer move the indent's status.
export const DOWNSTREAM_OF_QUOTATION = [
  'PARTIAL_PO_CREATED', 'PO_READY',
  'SERVICE_COMPLETED', 'SERVICE_QC_PASSED', 'SERVICE_QC_FAILED', 'SERVICE_QC_PARTIAL',
  'CLOSED',
];

export const isDownstreamOfQuotation = (indent) => DOWNSTREAM_OF_QUOTATION.includes(indent?.overallStatus);

// ── Planned dates (Purchase FMS 1.0 sheet) ─────────────────────────────────
// The sheet counts WORKING days with Friday as the weekly off (every 1.02 /
// 1.03 planned date in it matches; plain calendar days do not), keeps the time
// of day, and has no holidays. Weekdays are read in IST, the app's day
// convention (followUp.dates.js) — a date-only value (UTC midnight) is the same
// day in IST. The day the count starts from never counts, as in WORKDAY().
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEKLY_OFF_DAY = 5; // Friday (0 = Sunday)
export const QUOTE_COMPARATIVE_TAT_DAYS = 3;
export const QUOTATION_APPROVAL_TAT_DAYS = 1;

const istWeekday = (ms) => new Date(ms + IST_OFFSET_MS).getUTCDay();

/** `date` plus `days` working days (Fridays skipped), same time of day; null for a missing / invalid date. */
export const addWorkingDays = (date, days) => {
  if (!date) return null;
  let ms = new Date(date).getTime();
  if (Number.isNaN(ms)) return null;
  for (let added = 0; added < days;) {
    ms += DAY_MS;
    if (istWeekday(ms) !== WEEKLY_OFF_DAY) added += 1;
  }
  return new Date(ms);
};

/** Step 1.2 planned date — stamped into quoteStep.plannedAt when the indent is approved. */
export const quoteComparativePlannedAt = (approvedAt) => addWorkingDays(approvedAt, QUOTE_COMPARATIVE_TAT_DAYS);

/**
 * Step 1.3 planned date — derived from Step 1.2's actual date, so it exists only
 * once a quotation was actually received at Step 1.2 (never for a pending 1.2,
 * a "Quote Not Required" 1.2 or a skipped 1.3). Older records that only have
 * the quoteStep shape use its actual date.
 */
export const quotationApprovalPlannedAt = (indent) => {
  if (indent?.quotationApprovalStep?.skipped) return null;
  const step12 = indent?.quoteComparativeStep;
  const quoted = step12?.statusDone === 'YES'
    || (!step12?.statusDone && indent?.quoteStep?.status === 'RECEIVED');
  if (!quoted) return null;
  return addWorkingDays(step12?.actualAt || indent?.quoteStep?.actualAt, QUOTATION_APPROVAL_TAT_DAYS);
};
