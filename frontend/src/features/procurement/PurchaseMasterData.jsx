import React, { useState, useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, Tabs, Tab, Chip, alpha, useTheme,
  ToggleButtonGroup, ToggleButton, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, MenuItem, InputAdornment, IconButton, Tooltip, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, Autocomplete, Popover, Badge,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Database, Table as TableIcon, Rows3, LayoutGrid, Columns3, Search, Pencil, Trash2, SlidersHorizontal, X } from 'lucide-react';
import dayjs from 'dayjs';
import { useSnackbar } from 'notistack';
import { usePermissions } from '../../hooks/usePermission';
import {
  useGetIndentsQuery, useGetPurchaseOrdersQuery, useGetFollowUpsQuery,
  useGetProformaInvoicesQuery, useGetAdvancePaymentsQuery, useGetGrnsQuery,
  useGetIncomingQcsQuery, useGetVendorInvoicesQuery, useGetVouchersQuery,
  useGetTallyEntriesQuery, useGetFinalPaymentsQuery,
  useDeleteIndentMutation, useDeletePurchaseOrderMutation, useDeleteFollowUpMutation,
  useDeleteProformaInvoiceMutation, useDeleteAdvancePaymentMutation, useDeleteGrnMutation,
  useDeleteIncomingQcMutation, useDeleteVendorInvoiceMutation, useDeleteVoucherMutation,
  useDeleteTallyEntryMutation, useDeleteFinalPaymentMutation,
} from '../../store/api/procurementApi';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsTableHeadSx } from './pfmsTheme';
import IndentFormDrawer from './indents/IndentFormDrawer';
import PurchaseOrderFormDrawer from './purchase-orders/PurchaseOrderFormDrawer';
import FollowUpFormDrawer from './follow-ups/FollowUpFormDrawer';
import ProformaInvoiceFormDrawer from './proforma-invoices/ProformaInvoiceFormDrawer';
import GrnFormDialog from './grn/GrnFormDialog';
import IncomingQCFormDialog from './incoming-qc/IncomingQCFormDialog';
import VendorInvoiceFormDialog from './vendor-invoices/VendorInvoiceFormDialog';
import VoucherFormDialog from './vouchers/VoucherFormDialog';
import TallyEntryFormDialog from './tally-entry/TallyEntryFormDialog';

const num = (n) => (Number(n || 0)).toLocaleString('en-IN');
const dd = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
const col = (field, headerName, extra = {}) => ({ field, headerName, flex: 1, minWidth: 120, sortable: true, ...extra });

// One column set per Purchase FMS step (mirrors the 11 procurement screens).
const COLUMNS = {
  indent: [
    col('indentNumber', 'Indent No', { minWidth: 150 }),
    col('timestamp', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.timestamp || r.createdAt) }),
    col('vendorName', 'Vendor', { minWidth: 170, valueGetter: (v, r) => r.vendorName || '—' }),
    col('items', 'Items', { minWidth: 220, sortable: false, valueGetter: (v, r) => (r.items || []).map((i) => `${i.itemName || i.productNameRevised || i.skuCode} (${num(i.quantity)})`).join(', ') || '—' }),
    col('approvalStatus', 'Approval', { minWidth: 130 }),
    col('overallStatus', 'Stage', { minWidth: 150 }),
  ],
  po: [
    col('poNumber', 'PO Number', { minWidth: 160 }),
    col('poDate', 'PO Date', { minWidth: 120, valueGetter: (v, r) => dd(r.poDate) }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('grandTotal', 'Grand Total ₹', { minWidth: 130, type: 'number', valueGetter: (v, r) => Number(r.grandTotal || 0) }),
    col('approvalStatus', 'Approval', { minWidth: 120 }),
    col('releaseStatus', 'Release', { minWidth: 110 }),
    col('poStatus', 'PO Status', { minWidth: 130 }),
    col('expectedDeliveryDate', 'Expected', { minWidth: 120, valueGetter: (v, r) => dd(r.expectedDeliveryDate) }),
  ],
  followup: [
    col('followUpNumber', 'Follow-up No', { minWidth: 150 }),
    col('poNumber', 'PO Number', { minWidth: 140 }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('followUpType', 'Type', { minWidth: 120, valueGetter: (v, r) => r.followUpType || '—' }),
    col('nextFollowUpDate', 'Next Follow-up', { minWidth: 130, valueGetter: (v, r) => dd(r.nextFollowUpDate) }),
    col('finalMaterialDate', 'Material Date', { minWidth: 130, valueGetter: (v, r) => dd(r.finalMaterialDate) }),
    col('followUpStatus', 'Status', { minWidth: 120 }),
    col('performedByName', 'By', { minWidth: 130, valueGetter: (v, r) => r.performedByName || '—' }),
  ],
  pi: [
    col('piNumber', 'PI Number', { minWidth: 150 }),
    col('piDate', 'PI Date', { minWidth: 120, valueGetter: (v, r) => dd(r.piDate) }),
    col('poNumber', 'PO Number', { minWidth: 140 }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('totalValue', 'Total ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.totalValue || 0) }),
    col('paidAmount', 'Paid ₹', { minWidth: 110, type: 'number', valueGetter: (v, r) => Number(r.paidAmount || 0) }),
    col('balanceAmount', 'Balance ₹', { minWidth: 110, type: 'number', valueGetter: (v, r) => Number(r.balanceAmount || 0) }),
    col('piStatus', 'Status', { minWidth: 130 }),
  ],
  advance: [
    col('paymentNumber', 'Payment No', { minWidth: 150 }),
    col('paymentDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.paymentDate) }),
    col('piNumber', 'PI / PO', { minWidth: 150, valueGetter: (v, r) => `${r.piNumber || '—'}${r.poNumber ? ` / ${r.poNumber}` : ''}` }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('paidAmount', 'Paid ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.paidAmount || 0) }),
    col('balanceAmount', 'Balance ₹', { minWidth: 110, type: 'number', valueGetter: (v, r) => Number(r.balanceAmount || 0) }),
    col('paymentMode', 'Mode', { minWidth: 110, valueGetter: (v, r) => r.paymentMode || '—' }),
    col('paymentStatus', 'Status', { minWidth: 120 }),
  ],
  grn: [
    col('grnNumber', 'GRN Number', { minWidth: 160 }),
    col('grnDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.grnDate) }),
    col('poNumber', 'PO Number', { minWidth: 140 }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('totalReceivedQty', 'Received Qty', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.totalReceivedQty || 0) }),
    col('totalValue', 'Value ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.totalValue || 0) }),
    col('grnStatus', 'GRN Status', { minWidth: 130 }),
    col('qcStatus', 'QC Status', { minWidth: 120, valueGetter: (v, r) => r.qcStatus || '—' }),
  ],
  qc: [
    col('qcNumber', 'QC Number', { minWidth: 150 }),
    col('qcDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.qcDate) }),
    col('grnNumber', 'GRN Number', { minWidth: 150 }),
    col('vendorName', 'Vendor', { minWidth: 160 }),
    col('totalReceived', 'Received', { minWidth: 100, type: 'number', valueGetter: (v, r) => Number(r.totalReceived || 0) }),
    col('totalAccepted', 'Accepted', { minWidth: 100, type: 'number', valueGetter: (v, r) => Number(r.totalAccepted || 0) }),
    col('totalRejected', 'Rejected', { minWidth: 100, type: 'number', valueGetter: (v, r) => Number(r.totalRejected || 0) }),
    col('overallResult', 'Result', { minWidth: 110, valueGetter: (v, r) => r.overallResult || '—' }),
    col('qcStatus', 'Status', { minWidth: 110 }),
  ],
  vendorInvoice: [
    col('invoiceNumber', 'Invoice No', { minWidth: 150 }),
    col('invoiceDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.invoiceDate) }),
    col('poNumber', 'PO Number', { minWidth: 140 }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('invoiceAmount', 'Invoice ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.invoiceAmount || 0) }),
    col('netPayableAmount', 'Net Payable ₹', { minWidth: 130, type: 'number', valueGetter: (v, r) => Number(r.netPayableAmount || 0) }),
    col('invoiceStatus', 'Status', { minWidth: 140 }),
  ],
  voucher: [
    col('voucherNumber', 'Voucher No', { minWidth: 150 }),
    col('voucherDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.voucherDate) }),
    col('invoiceNumber', 'Invoice No', { minWidth: 140 }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('netPayableAmount', 'Net Payable ₹', { minWidth: 130, type: 'number', valueGetter: (v, r) => Number(r.netPayableAmount || 0) }),
    col('paidAmount', 'Paid ₹', { minWidth: 110, type: 'number', valueGetter: (v, r) => Number(r.paidAmount || 0) }),
    col('balanceAmount', 'Balance ₹', { minWidth: 110, type: 'number', valueGetter: (v, r) => Number(r.balanceAmount || 0) }),
    col('voucherStatus', 'Status', { minWidth: 130 }),
  ],
  tally: [
    col('entryNumber', 'Entry No', { minWidth: 150 }),
    col('voucherNumber', 'Voucher No', { minWidth: 140 }),
    col('invoiceNumber', 'Invoice No', { minWidth: 140 }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('tallyVoucherNumber', 'Tally Voucher', { minWidth: 140, valueGetter: (v, r) => r.tallyVoucherNumber || '—' }),
    col('tallyLedgerName', 'Ledger', { minWidth: 140, valueGetter: (v, r) => r.tallyLedgerName || '—' }),
    col('tallyEntryStatus', 'Status', { minWidth: 120 }),
  ],
  final: [
    col('paymentNumber', 'Payment No', { minWidth: 150 }),
    col('paymentDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.paymentDate) }),
    col('voucherNumber', 'Voucher No', { minWidth: 140 }),
    col('vendorName', 'Vendor', { minWidth: 170 }),
    col('paidAmount', 'Paid ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.paidAmount || 0) }),
    col('balanceAfterPayment', 'Balance ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.balanceAfterPayment || 0) }),
    col('paymentMode', 'Mode', { minWidth: 110, valueGetter: (v, r) => r.paymentMode || '—' }),
    col('paymentStatus', 'Status', { minWidth: 120 }),
  ],
};

const TABS = [
  { key: 'indent',        label: 'Indents · 1.1–1.3' },
  { key: 'po',            label: 'Purchase Orders · 1.4' },
  { key: 'followup',      label: 'Follow-ups · 1.5' },
  { key: 'pi',            label: 'PI Forms · 1.6' },
  { key: 'advance',       label: 'Advance Payments · 1.7' },
  { key: 'grn',           label: 'GRN · 1.8' },
  { key: 'qc',            label: 'Incoming QC · 1.9' },
  { key: 'vendorInvoice', label: 'Vendor Invoices · 1.10' },
  { key: 'voucher',       label: 'Vouchers · 1.11' },
  { key: 'tally',         label: 'Tally Entries · 1.12' },
  { key: 'final',         label: 'Final Payments · 1.13' },
];

// Once a record's own status shows this Purchase FMS step's work is done, it
// belongs in the NEXT step's tab, not this one — hide it here. Only forward
// progress is hidden; cancelled/rejected/failed dead-ends stay visible in
// their current tab since there's no next-step tab for them to move to.
const HIDE_WHEN_ADVANCED = {
  indent:        { field: 'overallStatus',    hide: ['PARTIAL_PO_CREATED', 'PO_READY'] },
  po:            { field: 'followUpStatus',   show: ['NOT_STARTED'] },
  followup:      { field: 'followUpStatus',   hide: ['DONE', 'READY_FOR_GRN', 'CLOSED'] },
  pi:            { field: 'piStatus',         hide: ['READY_FOR_ADVANCE_PAYMENT', 'PAYMENT_COMPLETED'] },
  advance:       { field: 'paymentStatus',    hide: ['FULL_PAYMENT', 'SHORT_PAYMENT_COMPLETED'] },
  grn:           { field: 'grnStatus',        hide: ['FULLY_RECEIVED'] },
  qc:            { field: 'qcStatus',         hide: ['PASSED', 'FAILED'] },
  vendorInvoice: { field: 'invoiceStatus',    hide: ['PAYMENT_PENDING', 'PAYMENT_COMPLETED'] },
  voucher:       { field: 'voucherStatus',    hide: ['FULLY_PAID', 'SHORT_CLOSED'] },
  tally:         { field: 'tallyEntryStatus', hide: ['COMPLETED'] },
  final:         { field: 'paymentStatus',    hide: ['FULL_PAYMENT', 'SHORT_PAYMENT_COMPLETED'] },
};
const isStageActive = (tab, row) => {
  const rule = HIDE_WHEN_ADVANCED[tab];
  if (!rule) return true;
  const v = row[rule.field];
  return rule.show ? rule.show.includes(v) : !rule.hide.includes(v);
};

// Edit reuses each module's own existing drawer/dialog — same component, same
// prop, same eligibility gate the module's own worklist page already uses.
// AdvancePayment and FinalPayment have no edit UI wired anywhere in the app
// today (both mutate posted money), so they're Delete-only here too.
const EDIT_CONFIG = {
  indent:        { Component: IndentFormDrawer,         prop: 'indent',  canEdit: (r) => r.approvalStatus === 'DRAFT' },
  po:            { Component: PurchaseOrderFormDrawer,  prop: 'po',      canEdit: (r) => r.approvalStatus === 'DRAFT' },
  followup:      { Component: FollowUpFormDrawer,       prop: 'followUp',canEdit: (r) => ['PENDING', 'RESCHEDULED'].includes(r.followUpStatus) },
  pi:            { Component: ProformaInvoiceFormDrawer,prop: 'pi',      canEdit: (r) => ['DRAFT', 'RECEIVED'].includes(r.piStatus) && r.approvalStatus !== 'APPROVED' },
  grn:           { Component: GrnFormDialog,            prop: 'grn',     canEdit: (r) => r.grnStatus === 'DRAFT' },
  qc:            { Component: IncomingQCFormDialog,     prop: 'qc',      canEdit: (r) => ['DRAFT', 'IN_PROGRESS'].includes(r.qcStatus) },
  vendorInvoice: { Component: VendorInvoiceFormDialog,  prop: 'invoice', canEdit: (r) => ['DRAFT', 'RECEIVED', 'APPROVED', 'PAYMENT_PENDING'].includes(r.invoiceStatus) },
  voucher:       { Component: VoucherFormDialog,        prop: 'voucher', canEdit: (r) => r.voucherStatus === 'DRAFT' },
  tally:         { Component: TallyEntryFormDialog,     prop: 'entry',   canEdit: (r) => r.tallyEntryStatus === 'PENDING' },
};

// Delete is gated the same way the backend guards it — same status window as
// Edit for the 9 standard modules. AdvancePayment can only delete the latest
// payment against its PI (computed from the fetched rows, matching the
// backend's LIFO guard); FinalPayment's delete reverses via the existing
// cancel() flow server-side, so any row is offerable here.
const CAN_DELETE = {
  indent:        (r) => r.approvalStatus === 'DRAFT',
  po:            (r) => r.approvalStatus === 'DRAFT',
  followup:      (r) => ['PENDING', 'RESCHEDULED'].includes(r.followUpStatus),
  pi:            (r) => ['DRAFT', 'RECEIVED'].includes(r.piStatus) && r.approvalStatus !== 'APPROVED',
  grn:           (r) => r.grnStatus === 'DRAFT',
  qc:            (r) => ['DRAFT', 'IN_PROGRESS'].includes(r.qcStatus),
  vendorInvoice: (r) => r.invoiceStatus === 'DRAFT',
  voucher:       (r) => r.voucherStatus === 'DRAFT',
  tally:         (r) => r.tallyEntryStatus === 'PENDING',
  advance:       (r, ctx) => !!ctx?.latestAdvanceIds?.has(r._id),
  final:         () => true,
};

const DELETE_PERMISSION = {
  indent: 'procurement.deleteIndent', po: 'procurement.deletePurchaseOrder', followup: 'procurement.deleteFollowUp',
  pi: 'procurement.deleteProformaInvoice', advance: 'procurement.deleteAdvancePayment', grn: 'procurement.deleteGrn',
  qc: 'procurement.deleteIncomingQc', vendorInvoice: 'procurement.deleteVendorInvoice', voucher: 'procurement.deleteVoucher',
  tally: 'procurement.deleteTallyEntry', final: 'procurement.deleteFinalPayment',
};

const RECORD_NUMBER_FIELD = {
  indent: 'indentNumber', po: 'poNumber', followup: 'followUpNumber', pi: 'piNumber',
  advance: 'paymentNumber', grn: 'grnNumber', qc: 'qcNumber', vendorInvoice: 'invoiceNumber',
  voucher: 'voucherNumber', tally: 'entryNumber', final: 'paymentNumber',
};

const TAB_LABEL_SINGULAR = {
  indent: 'Indent', po: 'Purchase order', followup: 'Follow-up', pi: 'Proforma invoice',
  advance: 'Advance payment', grn: 'GRN', qc: 'QC record', vendorInvoice: 'Vendor invoice',
  voucher: 'Voucher', tally: 'Tally entry', final: 'Final payment',
};

// Compute a column's display value for the non-grid views (sheet / cards / board).
const displayVal = (c, row) => {
  const raw = c.valueGetter ? c.valueGetter(undefined, row) : row[c.field];
  return typeof raw === 'number' ? num(raw) : (raw ?? '—');
};
// Status accessor per step — used to group records in the Board view.
const statusOf = (tab, row) => ({
  indent: row.overallStatus || row.approvalStatus,
  po: row.poStatus,
  followup: row.followUpStatus,
  pi: row.piStatus,
  advance: row.paymentStatus,
  grn: row.grnStatus,
  qc: row.qcStatus,
  vendorInvoice: row.invoiceStatus,
  voucher: row.voucherStatus,
  tally: row.tallyEntryStatus,
  final: row.paymentStatus,
}[tab]) || 'PENDING';

// Date each step is filtered on by the From/To range — the same date its
// table's Date column shows (Tally has none, so it uses createdAt).
const DATE_OF = {
  indent: (r) => r.timestamp || r.createdAt,
  po: (r) => r.poDate,
  followup: (r) => r.nextFollowUpDate,
  pi: (r) => r.piDate,
  advance: (r) => r.paymentDate,
  grn: (r) => r.grnDate,
  qc: (r) => r.qcDate,
  vendorInvoice: (r) => r.invoiceDate,
  voucher: (r) => r.voucherDate,
  tally: (r) => r.createdAt,
  final: (r) => r.paymentDate,
};

// Step-specific filters, keyed on real row fields. Options are the distinct
// values present in the fetched rows; a filter with no values is not shown.
// `main` ones sit in the toolbar row, the rest go under "More".
const EXTRA_FILTERS = {
  indent:        [{ key: 'approvalStatus', label: 'Approval', main: true }, { key: 'department', label: 'Department' }],
  po:            [{ key: 'approvalStatus', label: 'Approval', main: true }, { key: 'releaseStatus', label: 'Release' }, { key: 'followUpStatus', label: 'Follow-up' }],
  followup:      [{ key: 'poNumber', label: 'PO Number', main: true }, { key: 'followUpType', label: 'Type' }, { key: 'performedByName', label: 'Performed by' }],
  pi:            [{ key: 'poNumber', label: 'PO Number', main: true }, { key: 'approvalStatus', label: 'Approval' }],
  advance:       [{ key: 'paymentMode', label: 'Payment Mode', main: true }, { key: 'piNumber', label: 'PI Number' }, { key: 'poNumber', label: 'PO Number' }],
  grn:           [{ key: 'poNumber', label: 'PO Number', main: true }, { key: 'qcStatus', label: 'QC Status' }],
  qc:            [{ key: 'grnNumber', label: 'GRN Number', main: true }, { key: 'overallResult', label: 'Result' }],
  vendorInvoice: [{ key: 'poNumber', label: 'PO Number', main: true }],
  voucher:       [{ key: 'invoiceNumber', label: 'Invoice No', main: true }],
  tally:         [{ key: 'voucherNumber', label: 'Voucher No', main: true }, { key: 'invoiceNumber', label: 'Invoice No' }, { key: 'tallyLedgerName', label: 'Ledger' }],
  final:         [{ key: 'paymentMode', label: 'Payment Mode', main: true }, { key: 'voucherNumber', label: 'Voucher No' }],
};

const distinct = (rows, get) => [...new Set(rows.map(get).filter((v) => v != null && v !== '').map(String))].sort();
const ymd = (d) => (d ? dayjs(d).format('YYYY-MM-DD') : '');

const VIEWS = [
  { key: 'table', label: 'Table', icon: TableIcon },
  { key: 'sheet', label: 'Sheet', icon: Rows3 },
  { key: 'cards', label: 'Cards', icon: LayoutGrid },
  { key: 'board', label: 'Board', icon: Columns3 },
];

/**
 * Purchase Master Data — a per-step data view (one tab per Purchase FMS step),
 * mirroring the O2D Master Data page: every entry shown with its full columns
 * (vendor / amounts / dates / status). Switch Table / Sheet / Cards / Board.
 * Each tab shows every record by default; the Pending / Completed toggle
 * narrows it by whether the record has advanced (see HIDE_WHEN_ADVANCED). The
 * Table view's Action column offers Edit/Delete where the record's own
 * status and the user's permissions allow it.
 */
const PurchaseMasterData = () => {
  const theme = useTheme();
  const { enqueueSnackbar } = useSnackbar();
  const { can } = usePermissions();
  const [tab, setTab] = useState('indent');
  const [view, setView] = useState('table');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // 'all' = every record (Master Data default); 'pending' = only records still
  // at this step, 'done' = only ones advanced past it (HIDE_WHEN_ADVANCED).
  // Default must be 'all' — once a record
  // advances, the pending-only view hides it from every earlier tab.
  const [scope, setScope] = useState('all');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [extra, setExtra] = useState({}); // { [field]: value } for EXTRA_FILTERS
  const [moreAnchor, setMoreAnchor] = useState(null);
  const [editRow, setEditRow] = useState(null);   // { tab, row } | null
  const [deleteRow, setDeleteRow] = useState(null); // { tab, row } | null
  const [deleting, setDeleting] = useState(false);

  const clearFilters = () => { setSearch(''); setStatusFilter(''); setVendorFilter(null); setDateFrom(''); setDateTo(''); setExtra({}); };
  const switchTab = (t) => { setTab(t); clearFilters(); };

  // Only the active tab fetches (skip the rest) — fast and cache-friendly.
  const P = { limit: 1000, sort: '-createdAt' };
  const indentQ = useGetIndentsQuery(P, { skip: tab !== 'indent' });
  const poQ = useGetPurchaseOrdersQuery(P, { skip: tab !== 'po' });
  const followQ = useGetFollowUpsQuery(P, { skip: tab !== 'followup' });
  const piQ = useGetProformaInvoicesQuery(P, { skip: tab !== 'pi' });
  const advQ = useGetAdvancePaymentsQuery(P, { skip: tab !== 'advance' });
  const grnQ = useGetGrnsQuery(P, { skip: tab !== 'grn' });
  const qcQ = useGetIncomingQcsQuery(P, { skip: tab !== 'qc' });
  const viQ = useGetVendorInvoicesQuery(P, { skip: tab !== 'vendorInvoice' });
  const vouQ = useGetVouchersQuery(P, { skip: tab !== 'voucher' });
  const tallyQ = useGetTallyEntriesQuery(P, { skip: tab !== 'tally' });
  const finalQ = useGetFinalPaymentsQuery(P, { skip: tab !== 'final' });

  const [deleteIndent] = useDeleteIndentMutation();
  const [deletePo] = useDeletePurchaseOrderMutation();
  const [deleteFollowup] = useDeleteFollowUpMutation();
  const [deletePi] = useDeleteProformaInvoiceMutation();
  const [deleteAdvance] = useDeleteAdvancePaymentMutation();
  const [deleteGrn] = useDeleteGrnMutation();
  const [deleteQc] = useDeleteIncomingQcMutation();
  const [deleteVendorInvoice] = useDeleteVendorInvoiceMutation();
  const [deleteVoucher] = useDeleteVoucherMutation();
  const [deleteTally] = useDeleteTallyEntryMutation();
  const [deleteFinal] = useDeleteFinalPaymentMutation();
  const deleteFns = {
    indent: deleteIndent, po: deletePo, followup: deleteFollowup, pi: deletePi, advance: deleteAdvance,
    grn: deleteGrn, qc: deleteQc, vendorInvoice: deleteVendorInvoice, voucher: deleteVoucher,
    tally: deleteTally, final: deleteFinal,
  };

  const current = {
    indent: indentQ, po: poQ, followup: followQ, pi: piQ, advance: advQ, grn: grnQ,
    qc: qcQ, vendorInvoice: viQ, voucher: vouQ, tally: tallyQ, final: finalQ,
  }[tab];
  const columns = COLUMNS[tab];
  // Real DB rows for this tab, minus whatever has already advanced past this
  // Purchase FMS step (see HIDE_WHEN_ADVANCED) — a pure function of fetched
  // data, so it's correct after refresh and identical for every user.
  const rawRows = useMemo(
    () => (current?.data?.data || []).filter((r) => scope === 'all' || isStageActive(tab, r) === (scope === 'pending')),
    [current, tab, scope],
  );

  // AdvancePayment can only delete its most-recently-created payment per PI
  // (keeps the balance-reversal chain reversible in order) — computed from
  // the same rows already on screen.
  const latestAdvanceIds = useMemo(() => {
    if (tab !== 'advance') return null;
    const latestByPi = new Map();
    rawRows.forEach((r) => {
      const cur = latestByPi.get(r.piId);
      if (!cur || new Date(r.createdAt) > new Date(cur.createdAt)) latestByPi.set(r.piId, r);
    });
    return new Set([...latestByPi.values()].map((r) => r._id));
  }, [rawRows, tab]);

  // Distinct statuses present (for the status filter dropdown).
  const statuses = useMemo(() => [...new Set(rawRows.map((r) => statusOf(tab, r)).filter(Boolean))], [rawRows, tab]);

  const vendors = useMemo(() => distinct(rawRows, (r) => r.vendorName), [rawRows]);
  const extraDefs = useMemo(
    () => (EXTRA_FILTERS[tab] || [])
      .map((f) => ({ ...f, options: distinct(rawRows, (r) => r[f.key]) }))
      .filter((f) => f.options.length > 0),
    [rawRows, tab],
  );
  const mainExtras = extraDefs.filter((f) => f.main);
  const moreExtras = extraDefs.filter((f) => !f.main);
  const moreActive = moreExtras.filter((f) => extra[f.key]).length + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);
  const anyFilter = !!(search || statusFilter || vendorFilter || dateFrom || dateTo || Object.values(extra).some(Boolean));

  // Apply status / vendor / date / step filters + free-text search (matches any visible column).
  const rows = useMemo(() => {
    let list = rawRows;
    if (statusFilter) list = list.filter((r) => statusOf(tab, r) === statusFilter);
    if (vendorFilter) list = list.filter((r) => r.vendorName === vendorFilter);
    if (dateFrom || dateTo) {
      list = list.filter((r) => {
        const d = ymd(DATE_OF[tab]?.(r) || r.createdAt);
        return d && (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);
      });
    }
    Object.entries(extra).forEach(([k, v]) => { if (v) list = list.filter((r) => String(r[k] ?? '') === v); });
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => columns.some((c) => String(displayVal(c, r)).toLowerCase().includes(q)));
    return list;
  }, [rawRows, statusFilter, vendorFilter, dateFrom, dateTo, extra, search, tab, columns]);

  const fieldSx = { '& .MuiInputBase-root': { height: 34, fontSize: '0.82rem' } };
  const renderExtra = (f, width) => (
    <Autocomplete
      key={f.key} size="small" options={f.options} value={extra[f.key] || null}
      onChange={(_, v) => setExtra((p) => ({ ...p, [f.key]: v || '' }))}
      sx={{ width, ...fieldSx, '& .MuiAutocomplete-input': { py: '0 !important' } }}
      renderInput={(params) => <TextField {...params} placeholder={f.label} />}
    />
  );

  // Table-view-only column set: base columns + an Action column (Edit/Delete),
  // gated per-row by each module's own eligibility rule.
  const tableColumns = useMemo(() => {
    const actionsCol = {
      field: '__actions', headerName: 'Action', width: 84, sortable: false, filterable: false,
      align: 'center', headerAlign: 'center',
      renderCell: (params) => {
        const row = params.row;
        const editCfg = EDIT_CONFIG[tab];
        const showEdit = !!editCfg?.canEdit(row);
        const showDelete = can(DELETE_PERMISSION[tab]) && !!CAN_DELETE[tab]?.(row, { latestAdvanceIds });
        if (!showEdit && !showDelete) return null;
        return (
          <Stack direction="row" spacing={0.25}>
            {showEdit && (
              <Tooltip title="Edit">
                <IconButton size="small" onClick={() => setEditRow({ tab, row })}><Pencil size={14} /></IconButton>
              </Tooltip>
            )}
            {showDelete && (
              <Tooltip title="Delete">
                <IconButton size="small" color="error" onClick={() => setDeleteRow({ tab, row })}><Trash2 size={14} /></IconButton>
              </Tooltip>
            )}
          </Stack>
        );
      },
    };
    return [...columns, actionsCol];
  }, [columns, tab, can, latestAdvanceIds]);

  const closeEdit = () => setEditRow(null);

  const handleConfirmDelete = async () => {
    if (!deleteRow) return;
    setDeleting(true);
    try {
      await deleteFns[deleteRow.tab](deleteRow.row._id).unwrap();
      enqueueSnackbar(`${TAB_LABEL_SINGULAR[deleteRow.tab]} deleted`, { variant: 'success' });
      setDeleteRow(null);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to delete', { variant: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box sx={{ ...pfmsPageSx }}>
      {/* Header */}
      <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 2 }}>
        <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(PFMS.brand, 0.1), color: PFMS.brand, border: `1px solid ${alpha(PFMS.brand, 0.2)}` }}>
          <Database size={21} />
        </Box>
        <Box>
          <Typography sx={pfmsTitleSx}>Purchase Master Data (1)</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>
            Every procurement entry, step by step — vendor, amounts, dates &amp; status. One tab per Purchase FMS step.
          </Typography>
        </Box>
      </Stack>

      <Box sx={{ pb: 6 }}>
        <Paper sx={{ ...pfmsCardSx, overflow: 'hidden' }}>
          <Tabs value={tab} onChange={(_, v) => switchTab(v)} variant="scrollable" scrollButtons="auto"
            sx={{ borderBottom: `1px solid ${theme.palette.divider}`, minHeight: 40, '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', fontSize: '0.78rem', minHeight: 40, py: 0.5 } }}>
            {TABS.map((t) => <Tab key={t.key} value={t.key} label={t.label} />)}
          </Tabs>

          {/* Compact toolbar: search · vendor · status · step filter · scope · More · count · view */}
          <Stack direction="row" alignItems="center" useFlexGap spacing={1} sx={{ px: 1.5, py: 1, flexWrap: 'wrap', borderBottom: `1px solid ${theme.palette.divider}` }}>
            <TextField
              size="small" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              sx={{ width: { xs: '100%', sm: 200 }, ...fieldSx }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment> }}
            />
            {vendors.length > 0 && (
              <Autocomplete
                size="small" options={vendors} value={vendorFilter} onChange={(_, v) => setVendorFilter(v)}
                sx={{ width: { xs: '100%', sm: 190 }, ...fieldSx, '& .MuiAutocomplete-input': { py: '0 !important' } }}
                renderInput={(params) => <TextField {...params} placeholder="Vendor" />}
              />
            )}
            <TextField
              select size="small" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              sx={{ width: { xs: 'calc(50% - 4px)', sm: 160 }, ...fieldSx }}
              SelectProps={{ displayEmpty: true, renderValue: (v) => (v || 'All statuses') }}
            >
              <MenuItem value="">All statuses</MenuItem>
              {statuses.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            {mainExtras.map((f) => renderExtra(f, { xs: 'calc(50% - 4px)', sm: 160 }))}
            <ToggleButtonGroup size="small" exclusive value={scope} onChange={(_, v) => v && setScope(v)} sx={{ height: 34 }}>
              <ToggleButton value="all" sx={{ px: 1.25, textTransform: 'none', fontSize: '0.75rem', fontWeight: 700 }}>All</ToggleButton>
              <ToggleButton value="pending" sx={{ px: 1.25, textTransform: 'none', fontSize: '0.75rem', fontWeight: 700 }}>Pending</ToggleButton>
              <ToggleButton value="done" sx={{ px: 1.25, textTransform: 'none', fontSize: '0.75rem', fontWeight: 700 }}>Completed</ToggleButton>
            </ToggleButtonGroup>
            <Badge color="primary" badgeContent={moreActive} invisible={!moreActive}>
              <Button
                size="small" variant="outlined" color="inherit" onClick={(e) => setMoreAnchor(e.currentTarget)}
                startIcon={<SlidersHorizontal size={14} />}
                sx={{ height: 34, textTransform: 'none', fontWeight: 700, fontSize: '0.78rem', borderColor: theme.palette.divider, color: 'text.secondary' }}
              >
                More
              </Button>
            </Badge>
            {anyFilter && (
              <Button size="small" onClick={clearFilters} startIcon={<X size={14} />} sx={{ height: 34, textTransform: 'none', fontWeight: 700, fontSize: '0.78rem' }}>
                Clear
              </Button>
            )}
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
              {rows.length}{anyFilter ? ` / ${rawRows.length}` : ''} record{rows.length === 1 ? '' : 's'}
            </Typography>
            <Box sx={{ flex: 1 }} />
            {/* Icon-only view switcher — compact */}
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
              {VIEWS.map((vw) => (
                <ToggleButton key={vw.key} value={vw.key} title={vw.label} sx={{ px: 1, py: 0.4 }}>
                  <vw.icon size={15} />
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>

          {/* "More" — date range + this step's overflow filters */}
          <Popover
            open={!!moreAnchor} anchorEl={moreAnchor} onClose={() => setMoreAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            slotProps={{ paper: { sx: { p: 1.75, mt: 0.5, width: 300, maxWidth: 'calc(100vw - 32px)' } } }}
          >
            <Stack spacing={1.25}>
              <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Date range
              </Typography>
              <Stack direction="row" spacing={1}>
                <TextField
                  type="date" size="small" label="From" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  InputLabelProps={{ shrink: true }} inputProps={{ max: dateTo || undefined }} sx={{ flex: 1, ...fieldSx }}
                />
                <TextField
                  type="date" size="small" label="To" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  InputLabelProps={{ shrink: true }} inputProps={{ min: dateFrom || undefined }} sx={{ flex: 1, ...fieldSx }}
                />
              </Stack>
              {moreExtras.length > 0 && (
                <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.04em', pt: 0.5 }}>
                  More filters
                </Typography>
              )}
              {moreExtras.map((f) => renderExtra(f, '100%'))}
              <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ pt: 0.5 }}>
                <Button size="small" onClick={() => { setDateFrom(''); setDateTo(''); setExtra((p) => ({ ...p, ...Object.fromEntries(moreExtras.map((f) => [f.key, ''])) })); }} sx={{ textTransform: 'none' }}>
                  Reset
                </Button>
                <Button size="small" variant="contained" onClick={() => setMoreAnchor(null)} sx={{ textTransform: 'none' }}>Done</Button>
              </Stack>
            </Stack>
          </Popover>

          {/* ── Table view (DataGrid) ── */}
          {view === 'table' && (
            <Box sx={{ px: 1.5, pb: 1.5 }}>
              <DataGrid
                rows={rows} columns={tableColumns} getRowId={(r) => r._id} loading={current?.isFetching}
                autoHeight density="compact"
                initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                pageSizeOptions={[25, 50, 100]} disableRowSelectionOnClick
                sx={{ border: 0, '& .MuiDataGrid-columnHeaders': { bgcolor: alpha(theme.palette.primary.main, 0.04) } }}
              />
            </Box>
          )}

          {/* ── Sheet view (dense spreadsheet) ── */}
          {view === 'sheet' && (
            <Box sx={{ px: 1.5, pb: 1.5, overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 720, '& td, & th': { border: `1px solid ${theme.palette.divider}`, fontSize: '0.78rem', px: 1, py: 0.6, whiteSpace: 'nowrap' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={pfmsTableHeadSx}>#</TableCell>
                    {columns.map((c) => <TableCell key={c.field} sx={pfmsTableHeadSx}>{c.headerName}</TableCell>)}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={row._id} hover>
                      <TableCell sx={{ color: 'text.disabled' }}>{i + 1}</TableCell>
                      {columns.map((c) => <TableCell key={c.field}>{displayVal(c, row)}</TableCell>)}
                    </TableRow>
                  ))}
                  {rows.length === 0 && <TableRow><TableCell colSpan={columns.length + 1} sx={{ textAlign: 'center', color: 'text.disabled', py: 3 }}>No records.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </Box>
          )}

          {/* ── Cards view ── */}
          {view === 'cards' && (
            <Box sx={{ p: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 1.5 }}>
              {rows.map((row) => (
                <Paper key={row._id} sx={{ ...pfmsCardSx, p: 1.5 }}>
                  <Typography sx={{ fontWeight: 800, fontSize: '0.85rem', color: theme.palette.primary.dark, mb: 0.75 }}>
                    {displayVal(columns[0], row)}
                  </Typography>
                  <Stack spacing={0.4}>
                    {columns.slice(1).map((c) => (
                      <Stack key={c.field} direction="row" justifyContent="space-between" spacing={1}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{c.headerName}</Typography>
                        <Typography variant="caption" sx={{ fontWeight: 700, textAlign: 'right' }}>{displayVal(c, row)}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Paper>
              ))}
              {rows.length === 0 && <Typography variant="body2" color="text.disabled" sx={{ p: 2 }}>No records.</Typography>}
            </Box>
          )}

          {/* ── Board view (grouped by status) ── */}
          {view === 'board' && (
            <Box sx={{ p: 1.5, display: 'flex', gap: 1.5, overflowX: 'auto' }}>
              {(() => {
                const groups = {};
                rows.forEach((r) => { const s = statusOf(tab, r); (groups[s] = groups[s] || []).push(r); });
                const keys = Object.keys(groups);
                if (!keys.length) return <Typography variant="body2" color="text.disabled" sx={{ p: 2 }}>No records.</Typography>;
                return keys.map((s) => (
                  <Box key={s} sx={{ minWidth: 260, flex: '0 0 260px' }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, px: 0.5 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s}</Typography>
                      <Chip size="small" label={groups[s].length} sx={{ height: 18, fontSize: '0.62rem' }} />
                    </Stack>
                    <Stack spacing={1}>
                      {groups[s].map((row) => (
                        <Paper key={row._id} sx={{ ...pfmsCardSx, p: 1.25 }}>
                          <Typography sx={{ fontWeight: 800, fontSize: '0.8rem', color: theme.palette.primary.dark }}>{displayVal(columns[0], row)}</Typography>
                          {columns.slice(1, 4).map((c) => (
                            <Typography key={c.field} variant="caption" display="block" color="text.secondary">
                              {c.headerName}: <b style={{ color: theme.palette.text.primary }}>{displayVal(c, row)}</b>
                            </Typography>
                          ))}
                        </Paper>
                      ))}
                    </Stack>
                  </Box>
                ));
              })()}
            </Box>
          )}
        </Paper>
      </Box>

      {/* Edit — reuses whichever module's own drawer/dialog this tab already uses */}
      {editRow && EDIT_CONFIG[editRow.tab] && (() => {
        const { Component, prop } = EDIT_CONFIG[editRow.tab];
        return <Component open onClose={closeEdit} {...{ [prop]: editRow.row }} />;
      })()}

      {/* Delete confirmation */}
      <Dialog open={!!deleteRow} onClose={() => (deleting ? null : setDeleteRow(null))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Delete {deleteRow ? TAB_LABEL_SINGULAR[deleteRow.tab] : ''}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This will delete{' '}
            <b>{deleteRow ? (deleteRow.row[RECORD_NUMBER_FIELD[deleteRow.tab]] || 'this record') : ''}</b>.
            This action cannot be undone from here.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteRow(null)} disabled={deleting}>Cancel</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default PurchaseMasterData;
