import React from 'react';
import StatusChip from '../components/StatusChip';

/** Shared meta for Material Follow-up screens (Purchase FMS Step 1.5). */

export const FOLLOWUP_STATUSES = ['PENDING', 'DONE', 'RESCHEDULED', 'READY_FOR_GRN', 'CLOSED'];
export const FOLLOWUP_TYPES = ['CALL', 'EMAIL', 'WHATSAPP', 'VISIT', 'OTHER'];

const TYPE_LABEL = { CALL: 'Call', EMAIL: 'Email', WHATSAPP: 'WhatsApp', VISIT: 'Visit', OTHER: 'Other' };

export const FuStatusChip = ({ status }) => <StatusChip status={status} />;
export const PoFollowUpChip = ({ status }) => <StatusChip status={status} />;

// Follow-up channel is a category (not a status) → neutral styling, no color coding.
export const FuTypeChip = ({ type }) => <StatusChip status={type} tone="neutral" label={TYPE_LABEL[type] || type} />;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

/** Minutes → friendly "2d 3h late" / "On time". */
export const fmtDelay = (minutes) => {
  const m = Number(minutes) || 0;
  if (m <= 0) return 'On time';
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (!d && mm) parts.push(`${mm}m`);
  return `${parts.join(' ') || '0m'} late`;
};

/** Pending/rescheduled past its planned date. */
export const isDelayed = (fu) =>
  ['PENDING', 'RESCHEDULED'].includes(fu?.followUpStatus) &&
  fu?.plannedAt && new Date(fu.plannedAt) < new Date();
