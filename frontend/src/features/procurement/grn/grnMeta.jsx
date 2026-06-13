import React from 'react';
import { Chip } from '@mui/material';

/** Shared meta for Goods Receipt Note screens (Purchase FMS Step 1.8). */

export const GRN_STATUSES = ['DRAFT', 'RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED'];

export const HOW_ITEM_RECEIVED = [
  'FULL_MATERIAL_RECEIVED', 'PARTIAL_RECEIVED', 'EXTRA_RECEIVED', 'DAMAGED_RECEIVED',
];

const GRN_STATUS_META = {
  DRAFT:            { label: 'Draft',            color: 'default' },
  RECEIVED:         { label: 'Received',         color: 'info' },
  PARTIAL_RECEIVED: { label: 'Partial Received', color: 'warning' },
  FULLY_RECEIVED:   { label: 'Fully Received',   color: 'success' },
  CANCELLED:        { label: 'Cancelled',        color: 'error' },
};

const QC_META = {
  PENDING: { label: 'QC Pending', color: 'warning' },
  PASSED:  { label: 'QC Passed',  color: 'success' },
  FAILED:  { label: 'QC Failed',  color: 'error' },
  PARTIAL: { label: 'QC Partial', color: 'info' },
};

const pick = (map, key) => map[key] || { label: key || '—', color: 'default' };

export const GrnStatusChip = ({ status }) => {
  const m = pick(GRN_STATUS_META, status);
  return <Chip size="small" label={m.label} color={m.color} sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const QcStatusChip = ({ status }) => {
  const m = pick(QC_META, status);
  return <Chip size="small" label={m.label} color={m.color} variant="outlined" sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const howReceivedLabel = (v) => String(v || '—').replace(/_/g, ' ');

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
