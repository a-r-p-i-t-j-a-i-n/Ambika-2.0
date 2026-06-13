import React from 'react';
import { Chip } from '@mui/material';

/** Shared meta for Advance Payment screens (Purchase FMS Step 1.7). */

export const PAYMENT_STATUSES = ['PART_PAYMENT', 'FULL_PAYMENT', 'SHORT_PAYMENT_COMPLETED', 'CANCELLED'];
export const PAYMENT_MODES = ['E_FUND_TRANSFER', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH', 'OTHER'];

const STATUS_META = {
  PART_PAYMENT:            { label: 'Part Payment',  color: 'warning' },
  FULL_PAYMENT:            { label: 'Full Payment',  color: 'success' },
  SHORT_PAYMENT_COMPLETED: { label: 'Short Closed',  color: 'info' },
  CANCELLED:               { label: 'Cancelled',     color: 'error' },
};

const pick = (map, key) => map[key] || { label: key || '—', color: 'default' };

export const PaymentStatusChip = ({ status }) => {
  const m = pick(STATUS_META, status);
  return <Chip size="small" label={m.label} color={m.color} sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const modeLabel = (mode) => String(mode || '—').replace(/_/g, ' ');

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
