import React from 'react';
import StatusChip from '../components/StatusChip';

/** Shared meta for Goods Receipt Note screens (Purchase FMS Step 1.8). */

export const GRN_STATUSES = ['DRAFT', 'RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED'];

export const HOW_ITEM_RECEIVED = [
  'FULL_MATERIAL_RECEIVED', 'PARTIAL_RECEIVED', 'EXTRA_RECEIVED', 'DAMAGED_RECEIVED',
];

export const GrnStatusChip = ({ status }) => <StatusChip status={status} />;
export const QcStatusChip = ({ status }) => <StatusChip status={status} />;

export const howReceivedLabel = (v) => String(v || '—').replace(/_/g, ' ');

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
