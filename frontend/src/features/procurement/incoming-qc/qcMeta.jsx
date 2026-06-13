import React from 'react';
import { Chip } from '@mui/material';

/** Shared meta for Incoming QC screens (Purchase FMS Step 1.9). */

export const QC_STATUSES = ['DRAFT', 'IN_PROGRESS', 'PASSED', 'FAILED', 'PARTIAL', 'CANCELLED'];
export const QC_RESULTS = ['PASS', 'FAIL', 'PARTIAL_PASS'];
export const DEFECT_SEVERITIES = ['MINOR', 'MAJOR', 'CRITICAL'];

const STATUS_META = {
  DRAFT:       { label: 'Draft',       color: 'default' },
  IN_PROGRESS: { label: 'In Progress', color: 'info' },
  PASSED:      { label: 'Passed',      color: 'success' },
  FAILED:      { label: 'Failed',      color: 'error' },
  PARTIAL:     { label: 'Partial',     color: 'warning' },
  CANCELLED:   { label: 'Cancelled',   color: 'default' },
};

const RESULT_META = {
  PASS:         { label: 'Pass',         color: 'success' },
  FAIL:         { label: 'Fail',         color: 'error' },
  PARTIAL_PASS: { label: 'Partial Pass', color: 'warning' },
};

const pick = (map, key) => map[key] || { label: key || '—', color: 'default' };

export const QcStatusChip = ({ status }) => {
  const m = pick(STATUS_META, status);
  return <Chip size="small" label={m.label} color={m.color} sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const QcResultChip = ({ result }) => {
  if (!result) return <Chip size="small" variant="outlined" label="—" />;
  const m = pick(RESULT_META, result);
  return <Chip size="small" label={m.label} color={m.color} variant="outlined" sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
