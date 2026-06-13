import React from 'react';
import { Chip } from '@mui/material';

/** Shared meta for Vendor Invoice screens (Purchase FMS Step 1.10). */

export const INVOICE_STATUSES = ['DRAFT', 'RECEIVED', 'APPROVED', 'REJECTED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED'];

const STATUS_META = {
  DRAFT:             { label: 'Draft',             color: 'default' },
  RECEIVED:          { label: 'Received',          color: 'info' },
  APPROVED:          { label: 'Approved',          color: 'success' },
  REJECTED:          { label: 'Rejected',          color: 'error' },
  PAYMENT_PENDING:   { label: 'Payment Pending',   color: 'warning' },
  PAYMENT_COMPLETED: { label: 'Payment Completed', color: 'success' },
};

const pick = (map, key) => map[key] || { label: key || '—', color: 'default' };

export const InvoiceStatusChip = ({ status }) => {
  const m = pick(STATUS_META, status);
  return <Chip size="small" label={m.label} color={m.color} sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
