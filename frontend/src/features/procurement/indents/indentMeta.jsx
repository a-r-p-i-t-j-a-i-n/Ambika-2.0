import React from 'react';
import StatusChip from '../components/StatusChip';

/** Dropdown option sets shared across the Indent screens. */
export const UNITS = ['Pcs', 'Kg', 'Meter', 'Roll', 'Box', 'Set', 'Litre', 'Dozen'];

/**
 * Map a stored unit to its canonical UNITS casing (legacy data may hold "PCS",
 * "kg", etc.). Falls back to the first option so the select never goes
 * out-of-range. Returns '' for empty input.
 */
export const normalizeUnit = (u) => {
  if (!u) return '';
  const match = UNITS.find((opt) => opt.toLowerCase() === String(u).trim().toLowerCase());
  return match || UNITS[0];
};
export const DEPARTMENTS = ['Stores', 'Production', 'QC', 'Admin', 'Maintenance', 'Packing'];

export const APPROVAL_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'];

/**
 * Resolve an uploaded file URL. Files are served from the API host root
 * (e.g. http://host/uploads/...), NOT under /api/v1.
 */
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';
export const fileHref = (url) => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  const origin = API_BASE.replace(/\/api\/v1\/?$/, '');
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
};

/**
 * Build the display-only item reference from an indent number + line number.
 * Display-only — the original indent number is never changed.
 *   Ind-50/26-27 + lineNo 2 → Ind-50.2/26-27
 * Splits on the LAST "/" so the base and fiscal year stay intact.
 */
export const buildItemDisplayNumber = (indentNumber, lineNo) => {
  const n = Number(lineNo);
  if (!indentNumber || !n) return indentNumber || '';
  const slash = indentNumber.lastIndexOf('/');
  if (slash === -1) return `${indentNumber}.${n}`;
  return `${indentNumber.slice(0, slash)}.${n}/${indentNumber.slice(slash + 1)}`;
};

/**
 * Resolve an item's display reference: prefer a server-stamped value, else derive
 * it from the indent number + the item's stable line number (falling back to its
 * position in the items array).
 */
export const itemRef = (indentNumber, item, index = 0) =>
  item?.itemDisplayNumber
  || buildItemDisplayNumber(indentNumber, Number(item?.itemLineNo) || (index + 1));

export const ApprovalChip = ({ status }) => <StatusChip status={status} />;
export const OverallChip = ({ status }) => <StatusChip status={status} />;
export const QuoteChip = ({ status }) => <StatusChip status={status} />;
export const QuotationChip = ({ status }) => <StatusChip status={status} />;
