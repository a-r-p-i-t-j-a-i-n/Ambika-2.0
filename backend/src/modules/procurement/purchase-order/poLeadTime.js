import { AppError } from '../../../utils/apiResponse.js';

/**
 * PO Date ↔ Expected Delivery Date ↔ Lead Time (Purchase FMS Step 1.4).
 *
 * Lead Time is the number of calendar days from the PO Date to the Expected
 * Delivery Date, so the two describe one fact. The New PO form keeps them in
 * step; the server re-derives the pair here and never trusts the form's sum.
 *
 * Calendar days are counted on each date's UTC day — the form sends plain
 * 'YYYY-MM-DD' dates (stored at UTC midnight) and shows a stored date by its
 * first 10 characters, so the server and the form agree on every boundary
 * (month end, year end, 29 Feb) with no timezone off-by-one.
 */
const DAY_MS = 86400000;

// Longest delivery a PO may promise — guards against a mistyped year.
export const MAX_LEAD_DAYS = 365;

/** A date's UTC calendar day as a day number, or null when it isn't a date. */
export const utcDay = (d) => {
  if (d == null || d === '') return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  return Math.round(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) / DAY_MS);
};

/** "1 day" / "7 days" — the Lead Time text printed on the PO. */
export const leadTimeLabel = (days) => (days === 1 ? '1 day' : `${days} days`);

const hasValue = (v) => v !== undefined && v !== null && v !== '';

/**
 * Resolve the delivery pair from what the client sent.
 *  - Expected Delivery Date sent → Lead Time = its distance from the PO Date
 *    (a Lead Time sent alongside must match it).
 *  - Only Lead Time sent → Expected Delivery Date = PO Date + Lead Time.
 *  - Neither → {} (nothing to store).
 * Returns { expectedDeliveryDate (UTC midnight), leadTimeDays, leadTime } or
 * throws a 400 when the date is before the PO Date, too far out, or the two
 * disagree. The free-text `leadTime` a client may send is never trusted.
 */
export const resolvePoDelivery = ({ poDate, expectedDeliveryDate, leadTimeDays } = {}) => {
  const lead = hasValue(leadTimeDays) ? Number(leadTimeDays) : null;
  if (!hasValue(expectedDeliveryDate) && lead == null) return {};
  if (lead != null && (!Number.isInteger(lead) || lead < 0)) {
    throw new AppError('Lead Time must be a whole number of days (0 or more)', 400);
  }
  const poDay = utcDay(poDate ?? new Date());
  if (poDay == null) throw new AppError('PO Date is not a valid date', 400);

  let eddDay = poDay + (lead ?? 0);
  if (hasValue(expectedDeliveryDate)) {
    eddDay = utcDay(expectedDeliveryDate);
    if (eddDay == null) throw new AppError('Expected Delivery Date is not a valid date', 400);
  }
  const days = eddDay - poDay;
  if (days < 0) throw new AppError('Expected Delivery Date cannot be before the PO Date', 400);
  if (days > MAX_LEAD_DAYS) {
    throw new AppError(`Expected Delivery Date is more than ${MAX_LEAD_DAYS} days after the PO Date`, 400);
  }
  if (lead != null && lead !== days) {
    throw new AppError(`Lead Time (${leadTimeLabel(lead)}) does not match the PO Date → Expected Delivery Date gap (${leadTimeLabel(days)})`, 400);
  }
  return { expectedDeliveryDate: new Date(eddDay * DAY_MS), leadTimeDays: days, leadTime: leadTimeLabel(days) };
};
