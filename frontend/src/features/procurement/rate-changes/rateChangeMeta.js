/**
 * Shared meta for Rate Change Approvals (PO rate ≠ the vendor's Vendor Master
 * rate). The server decides who may approve; these helpers only shape the UI.
 */

// Same OR rule as the backend route: either slug, or the MD (root).
export const RATE_APPROVER_PERMISSIONS = ['procurement.approveRateChange', 'procurement.approve'];

export const RATE_STATUS = {
  PENDING:   { label: 'Pending',   color: '#b45309', bg: '#fef3c7' },
  APPROVED:  { label: 'Approved',  color: '#15803d', bg: '#dcfce7' },
  REJECTED:  { label: 'Rejected',  color: '#b91c1c', bg: '#fee2e2' },
  WITHDRAWN: { label: 'Withdrawn', color: '#475569', bg: '#e2e8f0' },
};
export const RATE_STATUSES = Object.keys(RATE_STATUS);

/** What a PO line says about its rate change (the PO form, the PO detail). */
export const RATE_LINE_LABEL = {
  PENDING:   'Rate Approval Pending',
  APPROVED:  'Rate Approved',
  REJECTED:  'Rate Rejected',
  WITHDRAWN: 'Rate Request Withdrawn',
};

export const RATE_EVENT = {
  REQUESTED:         { label: 'Requested',          color: '#1d4ed8' },
  APPROVED:          { label: 'Approved',           color: '#15803d' },
  REJECTED:          { label: 'Rejected',           color: '#b91c1c' },
  WITHDRAWN:         { label: 'Withdrawn',          color: '#475569' },
  APPROVAL_CONFLICT: { label: 'Approval refused',   color: '#c2410c' },
};
export const RATE_EVENTS = Object.keys(RATE_EVENT);

export const RATE_CHANGE_PATH = '/purchase-fms/rate-change-approvals';

export const fmtRate = (n) => (n == null || n === ''
  ? '—'
  : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`);

/** "+₹12.50 (+12.5%)" / "−₹5.00 (−4.17%)" — percent left out when there is no base rate. */
export const fmtDiff = (amount, percent) => {
  if (amount == null) return '—';
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : '';
  const abs = Math.abs(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const pct = percent == null ? '' : ` (${sign}${Math.abs(percent).toFixed(2).replace(/\.?0+$/, '')}%)`;
  return `${sign}₹${abs}${pct}`;
};

export const diffColor = (amount) => (amount > 0 ? '#b91c1c' : amount < 0 ? '#15803d' : 'inherit');

/** The same "same price" rule as the server (4 decimals). */
export const sameRate = (a, b) => a != null && b != null && a !== '' && b !== ''
  && Math.round(Number(a) * 10000) === Math.round(Number(b) * 10000);

/** What a request changes: the rate, the unit the vendor prices in, or both (older requests have no changeType = RATE). */
export const CHANGE_TYPE = {
  RATE:      { label: 'Rate change',        short: 'Rate' },
  UNIT:      { label: 'Unit change',        short: 'Unit' },
  RATE_UNIT: { label: 'Rate & unit change', short: 'Rate + unit' },
};
export const changeTypeOf = (r) => (CHANGE_TYPE[r?.changeType] ? r.changeType : 'RATE');
export const isUnitChange = (r) => changeTypeOf(r) !== 'RATE';
export const changeLabel = (r) => CHANGE_TYPE[changeTypeOf(r)].label;
export const changeShort = (r) => CHANGE_TYPE[changeTypeOf(r)].short;

/** "₹100.00 / Kgs" — a rate with its unit (the unit is left out when there is none). */
export const fmtPrice = (rate, unit) => `${fmtRate(rate)}${unit ? ` / ${unit}` : ''}`;
/** The vendor's price before and the requested price, for a request row / panel. */
export const existingPriceOf = (r) => (isUnitChange(r) ? fmtPrice(r.existingVendorRate, r.existingVendorUnit) : fmtRate(r.existingVendorRate));
export const requestedPriceOf = (r) => (isUnitChange(r) ? fmtPrice(r.requestedRate, r.requestedUnit || r.unit) : fmtRate(r.requestedRate));

/** The Purchase Approval page's tab / deep-link params for new-vendor POs. */
export const NEW_VENDOR_TAB = 'new-vendor';
