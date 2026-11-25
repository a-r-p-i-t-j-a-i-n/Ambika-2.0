// ── Which list a Purchase FMS step opens on ─────────────────────────────────
// A step with an "Awaiting" tab (StepWithQueue, and the GRN & QC step) opens on
// its own records — unless something is waiting and either the step has no
// records of its own yet, or the step prefers its queue (actionable work such
// as payments to make). One rule, used by the step screens AND by the hub's step
// cards, so a card's figure is always the list that step opens on.

export const AWAITING_VIEW = 'awaiting';

/** True when the step opens on its Awaiting list (no explicit ?view= given). */
export const opensOnQueue = ({ waiting, ownTotal, preferQueue = false }) =>
  waiting > 0 && (preferQueue || ownTotal === 0);

/** "How many are waiting" from a step-queue summary response (unfiltered). */
export const waitingOf = (queueResponse) => queueResponse?.data?.unfilteredTotal;

// The steps that have an Awaiting list: their queue and whether they prefer it.
// StepWithQueue's props and the hub's step cards both read these.
export const STEP_QUEUES = {
  'follow-ups':        { queue: 'FOLLOW_UP' },
  'advance-payments':  { queue: 'ADVANCE_PAYMENT', preferQueue: true },
  grn:                 { queue: 'GRN' },
  'invoices-payments': { queue: 'VENDOR_INVOICE' },
  'tally-entries':     { queue: 'TALLY_ENTRY' },
  'final-payments':    { queue: 'FINAL_PAYMENT' },
};
