import React from 'react';
import StatusChip from '../components/StatusChip';

/** Shared meta for Goods Receipt Note screens (Purchase FMS Step 1.8). */

export const GRN_STATUSES = ['DRAFT', 'RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED', 'CANCELLED'];

export const HOW_ITEM_RECEIVED = [
  'FULL_MATERIAL_RECEIVED', 'PARTIAL_RECEIVED', 'EXTRA_RECEIVED', 'DAMAGED_RECEIVED',
];

// Draft = editable / deletable / completable (mirrors the server's open-draft guard).
export const isGrnDraft = (grn) => grn?.grnStatus === 'DRAFT' && !grn?.stockPosted;
// Completed ("Complete GRN" done) — read-only for good. Stock posts at QC
// (GRNs completed before QC-gated posting posted it here).
export const isGrnCompleted = (grn) => ['RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED'].includes(grn?.grnStatus);

export const GrnStatusChip = ({ status }) => <StatusChip status={status} />;
export const QcStatusChip = ({ status }) => <StatusChip status={status} />;

export const howReceivedLabel = (v) => String(v || '—').replace(/_/g, ' ');

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
