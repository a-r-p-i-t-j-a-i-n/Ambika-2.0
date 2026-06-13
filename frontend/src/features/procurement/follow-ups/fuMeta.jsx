import React from 'react';
import { Chip } from '@mui/material';

/** Shared meta for Material Follow-up screens (Purchase FMS Step 1.5). */

export const FOLLOWUP_STATUSES = ['PENDING', 'DONE', 'RESCHEDULED', 'READY_FOR_GRN', 'CLOSED'];
export const FOLLOWUP_TYPES = ['CALL', 'EMAIL', 'WHATSAPP', 'VISIT', 'OTHER'];

const STATUS_META = {
  PENDING:       { label: 'Pending',       color: 'warning' },
  DONE:          { label: 'Done',          color: 'success' },
  RESCHEDULED:   { label: 'Rescheduled',   color: 'info' },
  READY_FOR_GRN: { label: 'Ready for GRN', color: 'success' },
  CLOSED:        { label: 'Closed',        color: 'default' },
};

const TYPE_META = {
  CALL:     { label: 'Call',     color: 'info' },
  EMAIL:    { label: 'Email',    color: 'primary' },
  WHATSAPP: { label: 'WhatsApp', color: 'success' },
  VISIT:    { label: 'Visit',    color: 'warning' },
  OTHER:    { label: 'Other',    color: 'default' },
};

const pick = (map, key) => map[key] || { label: key || '—', color: 'default' };

export const FuStatusChip = ({ status }) => {
  const m = pick(STATUS_META, status);
  return <Chip size="small" label={m.label} color={m.color} sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const FuTypeChip = ({ type }) => {
  const m = pick(TYPE_META, type);
  return <Chip size="small" label={m.label} color={m.color} variant="outlined" sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

// PO-level follow-up mirror (VendorPurchaseOrder.followUpStatus).
const PO_FU_META = {
  NOT_STARTED:   { label: 'Not Started',   color: 'default' },
  PENDING:       { label: 'Pending',       color: 'warning' },
  IN_PROGRESS:   { label: 'In Progress',   color: 'info' },
  READY_FOR_GRN: { label: 'Ready for GRN', color: 'success' },
  CLOSED:        { label: 'Closed',        color: 'default' },
};

export const PoFollowUpChip = ({ status }) => {
  const m = pick(PO_FU_META, status);
  return <Chip size="small" label={m.label} color={m.color} sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

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
