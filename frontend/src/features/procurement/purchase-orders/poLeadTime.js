/**
 * New PO form: PO Date ↔ Expected Delivery Date ↔ Lead Time (days).
 *
 * Lead Time = calendar days from PO Date to Expected Delivery Date. The field
 * the user last set is the ANCHOR (`leadAnchor`); the other one is always
 * re-derived from it and the PO Date, so a PO Date change moves the derived
 * field only and nothing drifts while a date is half-typed:
 *   LEAD → Expected Delivery Date = PO Date + Lead Time
 *   EDD  → Lead Time = Expected Delivery Date − PO Date
 * `leadSource` says where the values came from: VENDOR (the Vendor Master
 * default), MANUAL (typed/picked here) or SAVED (the PO being edited/revised).
 * Only VENDOR values are replaced when the vendor changes.
 *
 * Dates are 'YYYY-MM-DD' strings counted as UTC days — the same arithmetic as
 * the server (backend purchase-order/poLeadTime.js), so month end, year end and
 * 29 Feb behave identically and no timezone shifts a day.
 */
const DAY_MS = 86400000;

// Same cap as the server.
export const MAX_LEAD_DAYS = 365;

const isoDay = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').slice(0, 10));
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  // Reject roll-overs such as 2026-02-30.
  return new Date(t).getUTCDate() === +m[3] ? Math.round(t / DAY_MS) : null;
};

/** '2026-10-29' + 7 → '2026-11-05'; '' when the date isn't valid. */
export const addDaysIso = (iso, days) => {
  const d = isoDay(iso);
  return d == null ? '' : new Date((d + days) * DAY_MS).toISOString().slice(0, 10);
};

/** Calendar days from `from` to `to` (negative when `to` is earlier), or null. */
export const daysBetweenIso = (from, to) => {
  const a = isoDay(from);
  const b = isoDay(to);
  return a == null || b == null ? null : b - a;
};

/** Lead Time input ('7') → 7; null when blank or not a whole number. */
export const parseLeadDays = (raw) => (/^\d+$/.test(String(raw ?? '').trim()) ? parseInt(raw, 10) : null);

/** A vendor's configured default (Vendor Master `leadTimeDays`), or null. */
export const vendorLeadDays = (vendor) => {
  const n = vendor?.leadTimeDays;
  return Number.isInteger(n) && n >= 0 && n <= MAX_LEAD_DAYS ? n : null;
};

export const EMPTY_DELIVERY = { expectedDeliveryDate: '', leadTime: '', leadAnchor: '', leadSource: '' };

// Re-derive the non-anchor field from the anchor and the PO Date.
const derive = (h) => {
  if (h.leadAnchor === 'LEAD') {
    const n = parseLeadDays(h.leadTime);
    return { ...h, expectedDeliveryDate: n == null ? '' : addDaysIso(h.poDate, n) };
  }
  if (h.leadAnchor === 'EDD') {
    const n = daysBetweenIso(h.poDate, h.expectedDeliveryDate);
    return { ...h, leadTime: n == null || n < 0 ? '' : String(n) };
  }
  return h;
};

/** User typed a Lead Time. Clearing it clears the date too (no stale date). */
export const setLeadTime = (h, raw) => {
  const value = String(raw ?? '').trim();
  if (!value) return { ...h, ...EMPTY_DELIVERY };
  return derive({ ...h, leadTime: value, leadAnchor: 'LEAD', leadSource: 'MANUAL' });
};

/** User picked/typed an Expected Delivery Date. Clearing it clears the Lead Time. */
export const setDeliveryDate = (h, iso) => {
  if (!iso) return { ...h, ...EMPTY_DELIVERY };
  return derive({ ...h, expectedDeliveryDate: iso, leadAnchor: 'EDD', leadSource: 'MANUAL' });
};

/** PO Date changed: the anchor stays, the other field follows. */
export const setPoDate = (h, iso) => derive({ ...h, poDate: iso });

/**
 * The selected vendor's default Lead Time (null = none configured). Fills the
 * pair when it is empty or still holds the previous vendor's default; values the
 * user entered (or the saved PO's) are never replaced. A previous vendor's
 * default is cleared when the new vendor has none, so it can't linger as stale.
 */
export const inheritVendorLead = (h, days) => {
  const filled = h.leadTime !== '' || Boolean(h.expectedDeliveryDate);
  if (filled && h.leadSource !== 'VENDOR') return h;
  if (days == null) return h.leadSource === 'VENDOR' ? { ...h, ...EMPTY_DELIVERY } : h;
  return derive({ ...h, leadTime: String(days), leadAnchor: 'LEAD', leadSource: 'VENDOR' });
};

/**
 * Starting pair for a saved PO. Edit keeps the saved delivery date as the
 * anchor; revise starts from today's PO Date, so it keeps the saved Lead Time
 * and moves the date with it. Older POs (free-text lead time) take the gap
 * between their own dates.
 */
export const deliveryFromSavedPo = (po, poDate, { revise = false } = {}) => {
  const savedEdd = po?.expectedDeliveryDate ? String(po.expectedDeliveryDate).slice(0, 10) : '';
  const savedPoDate = po?.poDate ? String(po.poDate).slice(0, 10) : '';
  const gap = daysBetweenIso(savedPoDate, savedEdd);
  const lead = Number.isInteger(po?.leadTimeDays) ? po.leadTimeDays : (gap != null && gap >= 0 ? gap : null);
  if (revise && lead != null) {
    return derive({ poDate, ...EMPTY_DELIVERY, leadTime: String(lead), leadAnchor: 'LEAD', leadSource: 'SAVED' });
  }
  if (!savedEdd) return { poDate, ...EMPTY_DELIVERY };
  return derive({ poDate, ...EMPTY_DELIVERY, expectedDeliveryDate: savedEdd, leadAnchor: 'EDD', leadSource: 'SAVED' });
};

/** Field errors: { lead, edd } — '' when fine. */
export const deliveryErrors = (h) => {
  const out = { lead: '', edd: '' };
  if (h.leadTime !== '' && parseLeadDays(h.leadTime) == null) out.lead = 'Whole days only (0 or more)';
  else if (parseLeadDays(h.leadTime) > MAX_LEAD_DAYS) out.lead = `At most ${MAX_LEAD_DAYS} days`;
  if (!h.expectedDeliveryDate) out.edd = 'Required';
  else {
    const gap = daysBetweenIso(h.poDate, h.expectedDeliveryDate);
    if (gap != null && gap < 0) out.edd = 'Cannot be before the PO Date';
    else if (gap != null && gap > MAX_LEAD_DAYS) out.edd = `More than ${MAX_LEAD_DAYS} days after the PO Date`;
  }
  return out;
};
