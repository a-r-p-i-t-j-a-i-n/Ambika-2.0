import React from 'react';
import { Chip } from '@mui/material';
import StatusChip, { TONES } from '../components/StatusChip';

/** Shared meta for Vendor Voucher screens (Purchase FMS Step 1.11). */

export const VOUCHER_STATUSES = ['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'FULLY_PAID', 'SHORT_CLOSED', 'CANCELLED'];
export const PAYMENT_MODES = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH', 'OTHER'];

// DIRECT_PURCHASE = goods bought with no Indent / PO / GRN. Its own type — a
// purchase, never an expense — and financial only (it posts no stock).
export const VOUCHER_TYPES = [
  { value: 'PURCHASE', label: 'Purchase Voucher', short: 'PUR' },
  { value: 'DIRECT_PURCHASE', label: 'Direct Purchase Voucher', short: 'DPV' },
  { value: 'EXPENSE', label: 'Expense / Direct Bill', short: 'EXP' },
];
export const isDirectPurchase = (v) => v?.voucherType === 'DIRECT_PURCHASE';
export const voucherTypeLabel = (type) => (VOUCHER_TYPES.find((t) => t.value === type) || VOUCHER_TYPES[0]).label;

// Preview of the server's line math (voucher/directPurchase.js — the server
// always recomputes): gross = qty × rate, taxable = gross − discount,
// tax = taxable × GST%, each rounded to paise.
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const directPurchaseLine = (it = {}) => {
  const grossAmount = r2((Number(it.quantity) || 0) * (Number(it.rate) || 0));
  const discountAmount = r2(it.discountAmount);
  const taxableAmount = r2(Math.max(0, grossAmount - discountAmount));
  const taxAmount = r2(taxableAmount * (Number(it.gstRate) || 0) / 100);
  return { grossAmount, discountAmount, taxableAmount, taxAmount, lineTotal: r2(taxableAmount + taxAmount) };
};
export const directPurchaseTotals = (items = []) => {
  const lines = items.map(directPurchaseLine);
  const sum = (k) => r2(lines.reduce((s, l) => s + l[k], 0));
  const t = { grossAmount: sum('grossAmount'), discountTotal: sum('discountAmount'), taxableAmount: sum('taxableAmount'), taxAmount: sum('taxAmount') };
  return { ...t, grandTotal: r2(t.taxableAmount + t.taxAmount) };
};

// What an Expense / Direct Bill voucher is raised against. Vouchers saved
// before this choice existed have no expenseType and read as DIRECT.
export const EXPENSE_TYPES = [
  { value: 'DIRECT', label: 'Direct Expense (Without PO & GRN)', short: 'Without PO / GRN',
    help: 'Office, service, repair or other bills with no Purchase Order or GRN behind them.' },
  { value: 'AGAINST_PO', label: 'Expense Against PO (Without GRN)', short: 'Against PO',
    help: 'Bill for an approved PO that is paid without a GRN. Only POs with no GRN and no vendor invoice are listed — once billed here, the PO cannot take a GRN.' },
  { value: 'AGAINST_GRN', label: 'Expense Against GRN (Without PO)', short: 'Against GRN',
    help: 'Bill for a completed GRN that was raised without a PO (Vendor Invoice does not accept these GRNs). One bill per GRN.' },
];
export const expenseTypeOf = (v) => (v?.voucherType === 'EXPENSE' ? (v.expenseType || 'DIRECT') : null);
export const expenseTypeMeta = (type) => EXPENSE_TYPES.find((t) => t.value === type) || EXPENSE_TYPES[0];

export const EXPENSE_CATEGORIES = [
  'Computer Repair', 'Printer Repair', 'Stationery', 'Travel', 'Electricity',
  'Internet', 'AMC', 'Office Maintenance', 'Consultancy', 'Courier', 'Fuel',
  'Software Subscription', 'Rent', 'Housekeeping', 'Security Services', 'Other',
];

export const VoucherStatusChip = ({ status }) => <StatusChip status={status} />;

export const VoucherTypeChip = ({ type }) => {
  const meta = VOUCHER_TYPES.find((t) => t.value === type) || VOUCHER_TYPES[0];
  const tone = type === 'EXPENSE' ? TONES.orange : type === 'DIRECT_PURCHASE' ? TONES.teal : TONES.blue;
  return (
    <Chip size="small" label={meta.short} title={meta.label} data-testid="voucher-type-chip"
      sx={{ fontWeight: 800, bgcolor: tone.bg, color: tone.fg }} />
  );
};

export const fmtINR = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (d) =>
  (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
