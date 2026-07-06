import React from 'react';
import StatusChip from '../components/StatusChip';

/** Shared meta for the Vendor Purchase Order screens (Purchase FMS Step 1.4). */

export const PO_STATUSES = [
  'DRAFT', 'APPROVED', 'RELEASED_TO_VENDOR', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED', 'CLOSED',
];

export const PoStatusChip = ({ status }) => <StatusChip status={status} />;
export const PoApprovalChip = ({ status }) => <StatusChip status={status} />;
export const PoReleaseChip = ({ status }) => <StatusChip status={status} />;

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

// A PO only gets its final poNumber on approval; until then show the draft
// reference (or a plain "Pending Approval" label if even that hasn't loaded).
export const poDisplayNumber = (po) => po?.poNumber || po?.draftNumber || 'Pending Approval';
