import React from 'react';
import StatusChip from '../components/StatusChip';

/** Shared meta for Purchase Tally Entry screens (Purchase FMS Step 1.12). */

export const TALLY_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED'];

// Checklist keys in display order, with their labels (mirrors the backend model).
export const CHECKLIST_ITEMS = [
  { key: 'companyGstDetails',         label: "Our Company's Name, address & GST details" },
  { key: 'invoiceQtyMatchesPoAndGrn', label: 'Invoice qty matches PO qty & GRN qty' },
  { key: 'invoiceRateMatchesPo',      label: 'Invoice rate matches PO rates' },
  { key: 'gstRateApplicable',         label: 'GST rate applicable' },
  { key: 'tdsDeductedIfApplicable',   label: 'Deduct TDS if applicable' },
  { key: 'totalCalculationVerified',  label: 'Total calculation verified' },
];
export const CHECKLIST_TOTAL = CHECKLIST_ITEMS.length;

export const checklistProgress = (cl = {}) => CHECKLIST_ITEMS.filter((i) => cl?.[i.key]).length;

export const TallyStatusChip = ({ status }) => <StatusChip status={status} />;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
