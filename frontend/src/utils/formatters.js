/**
 * Shared formatters — Indian locale by default.
 */
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
dayjs.extend(relativeTime);

const inrFmt = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const intFmt = new Intl.NumberFormat('en-IN');

export const fmtINR = (n) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return inrFmt.format(Number(n));
};

export const fmtINRCompact = (n) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹ ${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹ ${(n / 1e5).toFixed(2)} L`;
  if (abs >= 1e3) return `₹ ${(n / 1e3).toFixed(1)} k`;
  return inrFmt.format(n);
};

export const fmtInt = (n) => (n == null ? '—' : intFmt.format(n));

export const fmtPct = (n, digits = 1) => {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${Number(n).toFixed(digits)}%`;
};

export const fmtDate = (d, format = 'DD MMM YYYY') => {
  if (!d) return '—';
  return dayjs(d).format(format);
};

export const fmtFromNow = (d) => {
  if (!d) return '—';
  return dayjs(d).fromNow();
};
