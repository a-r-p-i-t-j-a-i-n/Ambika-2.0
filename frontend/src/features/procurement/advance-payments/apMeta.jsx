import React from 'react';
import StatusChip from '../components/StatusChip';

/** Shared meta for Advance Payment screens (Purchase FMS Step 1.7). */

export const PAYMENT_STATUSES = ['PART_PAYMENT', 'FULL_PAYMENT', 'SHORT_PAYMENT_COMPLETED', 'CANCELLED'];
export const PAYMENT_MODES = ['E_FUND_TRANSFER', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH', 'OTHER'];

export const PaymentStatusChip = ({ status }) => <StatusChip status={status} />;

// Where one PO's / PI's whole advance stands (backend advancePayment.eligibility piPaymentStateOf).
export const PI_PAYMENT_STATES = ['PENDING', 'PARTIALLY_PAID', 'FULLY_PAID', 'SHORT_CLOSED'];

// Picker states (backend advanceStateOf): what to tell the user for a PO that can't be paid yet.
export const ADVANCE_STATE = {
  PAYABLE:         { label: 'Ready for advance', tone: 'green' },
  AWAITING_MD:     { label: 'Awaiting MD approval', tone: 'amber' },
  PI_PENDING:      { label: 'PI not approved', tone: 'amber' },
  PI_REJECTED:     { label: 'PI rejected', tone: 'red' },
  NO_PI:           { label: 'No PI yet', tone: 'neutral' },
  PO_NOT_RELEASED: { label: 'PO not released', tone: 'neutral' },
  PI_NOT_REQUIRED: { label: 'PI not required', tone: 'neutral' },
  FULLY_PAID:      { label: 'Fully paid', tone: 'green' },
  SHORT_CLOSED:    { label: 'Closed short', tone: 'purple' },
};

export const modeLabel = (mode) => String(mode || '—').replace(/_/g, ' ');

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
