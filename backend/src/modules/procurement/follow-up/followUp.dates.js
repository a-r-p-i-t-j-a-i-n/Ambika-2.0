/**
 * Date rules for recording a follow-up cycle (mark-done), compared as IST
 * calendar days — the same day convention as the inventory reports
 * (istDayKey in ims.service.js). A date-only input ('YYYY-MM-DD') parses as
 * UTC midnight, which is the same calendar day in IST.
 *
 *  - Actual Date may be backdated, but not later than today.
 *  - Next Date to Follow-up must be on or after the Actual Date.
 */
const IST_TZ = 'Asia/Kolkata';

export const istDayKey = (date) => new Date(date).toLocaleDateString('en-CA', { timeZone: IST_TZ });

export const NEXT_BEFORE_ACTUAL = 'Next Date to Follow-up cannot be before the Actual Date';
export const isNextBeforeActual = (actualAt, nextFollowUpDate) => Boolean(actualAt && nextFollowUpDate)
  && istDayKey(nextFollowUpDate) < istDayKey(actualAt);

// Legacy /reschedule has no Actual Date, so its next date is checked against today.
export const NEXT_BEFORE_TODAY = 'Next Follow-up Date cannot be earlier than today';
export const isBeforeToday = (date, now = new Date()) => Boolean(date) && istDayKey(date) < istDayKey(now);

/** The first broken rule's message, or null when the dates are acceptable. */
export const followUpDateError = ({ actualAt, nextFollowUpDate }, now = new Date()) => {
  if (actualAt && istDayKey(actualAt) > istDayKey(now)) {
    return 'Actual Date cannot be later than today';
  }
  if (isNextBeforeActual(actualAt, nextFollowUpDate)) return NEXT_BEFORE_ACTUAL;
  return null;
};

/**
 * True when the follow-up's current cycle came from "Next Date to Follow Up"
 * (mark-done with a next date: RESCHEDULED, latest log outcome FOLLOWED_UP).
 * That outcome stores one date as both plannedAt and nextFollowUpDate, so an
 * Edit Pending move of the planned date must move the next date with it. A
 * legacy /reschedule (log outcome RESCHEDULED) never tied the two together.
 */
export const isNextDateCycle = (fu) => {
  const log = fu?.communicationLog || [];
  return fu?.followUpStatus === 'RESCHEDULED'
    && Boolean(fu.nextFollowUpDate)
    && log[log.length - 1]?.outcome === 'FOLLOWED_UP';
};
