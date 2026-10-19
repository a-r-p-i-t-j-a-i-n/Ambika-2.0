import React from 'react';
import { Chip } from '@mui/material';
import StatusChip, { TONES } from '../components/StatusChip';

/** Shared meta for Vendor Voucher screens (Purchase FMS Step 1.11). */

export const VOUCHER_STATUSES = ['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'FULLY_PAID', 'SHORT_CLOSED', 'CANCELLED'];
export const PAYMENT_MODES = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH', 'OTHER'];

export const VOUCHER_TYPES = [
  { value: 'PURCHASE', label: 'Purchase Voucher', short: 'PUR' },
  { value: 'EXPENSE', label: 'Expense / Direct Bill', short: 'EXP' },
];

export const EXPENSE_CATEGORIES = [
  'Computer Repair', 'Printer Repair', 'Stationery', 'Travel', 'Electricity',
  'Internet', 'AMC', 'Office Maintenance', 'Consultancy', 'Courier', 'Fuel',
  'Software Subscription', 'Rent', 'Housekeeping', 'Security Services', 'Other',
];

export const VoucherStatusChip = ({ status }) => <StatusChip status={status} />;

export const VoucherTypeChip = ({ type }) => {
  const isExpense = type === 'EXPENSE';
  const tone = isExpense ? TONES.orange : TONES.blue;
  return (
    <Chip size="small" label={isExpense ? 'EXP' : 'PUR'}
      sx={{ fontWeight: 800, bgcolor: tone.bg, color: tone.fg }} />
  );
};

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
