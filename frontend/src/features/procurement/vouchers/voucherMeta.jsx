import React from 'react';
import StatusChip from '../components/StatusChip';

/** Shared meta for Vendor Voucher screens (Purchase FMS Step 1.11). */

export const VOUCHER_STATUSES = ['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'FULLY_PAID', 'SHORT_CLOSED', 'CANCELLED'];
export const PAYMENT_MODES = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH', 'OTHER'];

export const VoucherStatusChip = ({ status }) => <StatusChip status={status} />;

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
