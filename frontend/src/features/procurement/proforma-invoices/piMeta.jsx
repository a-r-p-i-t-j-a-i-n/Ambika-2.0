import React from 'react';
import StatusChip from '../components/StatusChip';

/** Shared meta for Proforma Invoice screens (Purchase FMS Step 1.6). */

export const PI_STATUSES = ['DRAFT', 'RECEIVED', 'APPROVED', 'READY_FOR_ADVANCE_PAYMENT', 'PAYMENT_COMPLETED', 'CANCELLED'];

export const PiStatusChip = ({ status }) => <StatusChip status={status} />;
export const PiApprovalChip = ({ status }) => <StatusChip status={status} />;
// A PO's PI status specifically — PI is optional, so NOT_RECEIVED (no PI
// created yet) reads as an open option rather than a stalled "Not Received".
// Scoped to this chip only, not the shared StatusChip label map (NOT_RECEIVED
// also serves an unrelated indent status elsewhere).
export const PoPiChip = ({ status }) => (
  <StatusChip status={status} label={status === 'NOT_RECEIVED' ? 'No PI — Optional' : undefined} />
);

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
