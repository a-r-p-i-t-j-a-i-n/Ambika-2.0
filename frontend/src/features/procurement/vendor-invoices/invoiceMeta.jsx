import React from 'react';
import StatusChip from '../components/StatusChip';

/** Shared meta for Vendor Invoice screens (Purchase FMS Step 1.10). */

export const INVOICE_STATUSES = ['DRAFT', 'RECEIVED', 'APPROVED', 'REJECTED', 'PAYMENT_PENDING', 'PAYMENT_COMPLETED'];

export const InvoiceStatusChip = ({ status }) => <StatusChip status={status} />;

// ── Order-vs-received variance (Invoice Qty vs QC Accepted Qty) ──
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Returns { variance, status } for an invoice line. */
export const varianceOf = (invoiceQty, acceptedQty) => {
  const variance = round2((Number(invoiceQty) || 0) - (Number(acceptedQty) || 0));
  const status = variance === 0 ? 'MATCHED' : (variance < 0 ? 'SHORT' : 'EXCESS');
  return { variance, status };
};

export const VarianceChip = ({ status }) => <StatusChip status={status} />;

// Subtle row tint per variance status (EXCESS red, SHORT orange, MATCHED green).
export const varianceRowBg = (status) => ({
  EXCESS: 'rgba(185,28,28,0.06)',
  SHORT:  'rgba(194,65,12,0.06)',
  MATCHED: 'rgba(21,128,61,0.05)',
}[status] || 'transparent');

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
