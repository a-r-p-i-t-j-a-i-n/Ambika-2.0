import React from 'react';
import { Chip } from '@mui/material';

/** Shared meta for Proforma Invoice screens (Purchase FMS Step 1.6). */

export const PI_STATUSES = ['DRAFT', 'RECEIVED', 'APPROVED', 'READY_FOR_ADVANCE_PAYMENT', 'PAYMENT_COMPLETED', 'CANCELLED'];

const PI_STATUS_META = {
  DRAFT:                     { label: 'Draft',             color: 'default' },
  RECEIVED:                  { label: 'Received',          color: 'info' },
  APPROVED:                  { label: 'Approved',          color: 'success' },
  READY_FOR_ADVANCE_PAYMENT: { label: 'Ready For Payment', color: 'success' },
  PAYMENT_COMPLETED:         { label: 'Payment Completed', color: 'success' },
  CANCELLED:                 { label: 'Cancelled',         color: 'error' },
};

const PI_APPROVAL_META = {
  PENDING:  { label: 'Pending',  color: 'warning' },
  APPROVED: { label: 'Approved', color: 'success' },
  REJECTED: { label: 'Rejected', color: 'error' },
};

// PO-level PI mirror (VendorPurchaseOrder.piStatus).
const PO_PI_META = {
  NOT_RECEIVED:              { label: 'Not Received',      color: 'default' },
  PI_RECEIVED:               { label: 'PI Received',       color: 'info' },
  PI_APPROVED:               { label: 'PI Approved',       color: 'success' },
  READY_FOR_ADVANCE_PAYMENT: { label: 'Ready For Payment', color: 'success' },
  PAYMENT_COMPLETED:         { label: 'Payment Completed', color: 'success' },
  PI_NOT_REQUIRED:           { label: 'PI Not Required',   color: 'info' },
};

const pick = (map, key) => map[key] || { label: key || '—', color: 'default' };

export const PiStatusChip = ({ status }) => {
  const m = pick(PI_STATUS_META, status);
  return <Chip size="small" label={m.label} color={m.color} sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const PiApprovalChip = ({ status }) => {
  const m = pick(PI_APPROVAL_META, status);
  return <Chip size="small" label={m.label} color={m.color} variant="outlined" sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const PoPiChip = ({ status }) => {
  const m = pick(PO_PI_META, status);
  return <Chip size="small" label={m.label} color={m.color} sx={{ fontWeight: 700, borderRadius: '6px' }} />;
};

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
