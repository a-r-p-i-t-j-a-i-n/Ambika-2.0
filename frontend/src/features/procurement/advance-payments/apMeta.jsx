import React from 'react';
import StatusChip from '../components/StatusChip';

/** Shared meta for Advance Payment screens (Purchase FMS Step 1.7). */

export const PAYMENT_STATUSES = ['PART_PAYMENT', 'FULL_PAYMENT', 'SHORT_PAYMENT_COMPLETED', 'CANCELLED'];
export const PAYMENT_MODES = ['E_FUND_TRANSFER', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH', 'OTHER'];

export const PaymentStatusChip = ({ status }) => <StatusChip status={status} />;

export const modeLabel = (mode) => String(mode || '—').replace(/_/g, ' ');

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
