import React from 'react';
import { Chip } from '@mui/material';

/** Shared meta for Vendor Voucher screens (Purchase FMS Step 1.11). */

export const VOUCHER_STATUSES = ['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'FULLY_PAID', 'CANCELLED'];
export const PAYMENT_MODES = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH', 'OTHER'];

const STATUS_META = {
  DRAFT:          { label: 'Draft',          color: 'default' },
  POSTED:         { label: 'Posted',         color: 'info' },
  PARTIALLY_PAID: { label: 'Partially Paid', color: 'warning' },
  FULLY_PAID:     { label: 'Fully Paid',     color: 'success' },
  CANCELLED:      { label: 'Cancelled',      color: 'error' },
};

const pick = (map, key) => map[key] || { label: key || '—', color: 'default' };

export const VoucherStatusChip = ({ status }) => {
  const m = pick(STATUS_META, status);
  return <Chip size="small" label={m.label} color={m.color} sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
