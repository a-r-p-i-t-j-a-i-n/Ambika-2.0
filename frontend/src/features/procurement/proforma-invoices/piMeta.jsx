import React from 'react';
import StatusChip from '../components/StatusChip';

/** Shared meta for Proforma Invoice screens (Purchase FMS Step 1.6). */

export const PI_STATUSES = ['DRAFT', 'RECEIVED', 'APPROVED', 'READY_FOR_ADVANCE_PAYMENT', 'PAYMENT_COMPLETED', 'CANCELLED'];

export const PiStatusChip = ({ status }) => <StatusChip status={status} />;
export const PiApprovalChip = ({ status }) => <StatusChip status={status} />;
export const PoPiChip = ({ status }) => <StatusChip status={status} />;

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
