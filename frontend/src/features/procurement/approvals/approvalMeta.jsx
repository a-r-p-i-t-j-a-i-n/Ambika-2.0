import React from 'react';
import StatusChip from '../components/StatusChip';

/** Shared meta for the generic MD Digital Approval & Signature engine. */

export const ApprovalStatusChip = ({ status }) => <StatusChip status={status} />;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export const fmtTime = (d) =>
  (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');
