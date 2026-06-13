import React from 'react';
import { Chip } from '@mui/material';

/** Shared meta for the Vendor Purchase Order screens (Purchase FMS Step 1.4). */

export const PO_STATUSES = [
  'DRAFT', 'APPROVED', 'RELEASED_TO_VENDOR', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED', 'CLOSED',
];

const PO_STATUS_META = {
  DRAFT:              { label: 'Draft',              color: 'default' },
  APPROVED:           { label: 'Approved',           color: 'info' },
  RELEASED_TO_VENDOR: { label: 'Released to Vendor', color: 'success' },
  PARTIAL_RECEIVED:   { label: 'Partial Received',   color: 'warning' },
  FULLY_RECEIVED:     { label: 'Fully Received',     color: 'success' },
  CANCELLED:          { label: 'Cancelled',          color: 'error' },
  CLOSED:             { label: 'Closed',             color: 'default' },
};

const APPROVAL_META = {
  DRAFT:    { label: 'Pending', color: 'warning' },
  APPROVED: { label: 'Approved', color: 'success' },
  REJECTED: { label: 'Rejected', color: 'error' },
};

const RELEASE_META = {
  NOT_RELEASED: { label: 'Not Released', color: 'default' },
  RELEASED:     { label: 'Released',     color: 'success' },
};

const pick = (map, key) => map[key] || { label: key || '—', color: 'default' };

export const PoStatusChip = ({ status }) => {
  const m = pick(PO_STATUS_META, status);
  return <Chip size="small" label={m.label} color={m.color} sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const PoApprovalChip = ({ status }) => {
  const m = pick(APPROVAL_META, status);
  return <Chip size="small" label={m.label} color={m.color} variant="outlined" sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const PoReleaseChip = ({ status }) => {
  const m = pick(RELEASE_META, status);
  return <Chip size="small" label={m.label} color={m.color} sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
