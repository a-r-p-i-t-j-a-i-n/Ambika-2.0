import React from 'react';
import StatusChip from '../components/StatusChip';

/** Shared meta for Incoming QC screens (Purchase FMS Step 1.9). */

export const QC_STATUSES = ['DRAFT', 'IN_PROGRESS', 'PASSED', 'FAILED', 'PARTIAL', 'CANCELLED'];
export const QC_RESULTS = ['PASS', 'FAIL', 'PARTIAL_PASS'];
export const DEFECT_SEVERITIES = ['MINOR', 'MAJOR', 'CRITICAL'];

export const QcStatusChip = ({ status }) => <StatusChip status={status} />;

export const QcResultChip = ({ result }) => (
  result ? <StatusChip status={result} /> : <StatusChip status="—" tone="neutral" label="—" />
);

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
