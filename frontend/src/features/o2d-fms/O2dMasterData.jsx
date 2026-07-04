import React, { useState, useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, Tabs, Tab, Chip, alpha, useTheme, Button, Autocomplete,
  ToggleButtonGroup, ToggleButton, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, MenuItem, InputAdornment, Drawer, Divider, IconButton, Tooltip, Link,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Link as RouterLink } from 'react-router-dom';
import {
  Database, Table as TableIcon, Rows3, LayoutGrid, Columns3, Search, FileSpreadsheet,
  FileText, X, ExternalLink, ScrollText, CheckCircle2, Circle, Link2, Clock, User as UserIcon,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useGetOrderIntakesQuery } from '../../store/api/orderIntakeApi';
import { useGetOrdersQuery } from '../../store/api/orderApi';
import { useGetChallansQuery, useGetSchedulesQuery } from '../../store/api/dispatchControlApi';
import { useGetSalesInvoicesQuery } from '../../store/api/salesInvoiceApi';
import { useGetPaymentsQuery, useGetTransportBillsQuery } from '../../store/api/o2dFulfillmentApi';
import { useGetPartiesQuery } from '../../store/api/partyApi';
import { useGetProcessesQuery } from '../../store/api/o2dFmsApi';
import { actionLinkMeta, resolveEntityLink, TRIGGER_TO_ACTION } from './actionLinks';
import { exportRowsToExcel, printTablePdf } from '../../utils/exportMasterData';

const num = (n) => (Number(n || 0)).toLocaleString('en-IN');
const dt = (d) => (d ? dayjs(d).format('DD MMM YYYY · hh:mm A') : '—');
const dd = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
const col = (field, headerName, extra = {}) => ({ field, headerName, flex: 1, minWidth: 120, sortable: true, ...extra });

// ── Step catalog (ACTIVE fmsKey = CURRENT_SHEET) — every O2D step, in order.
// `code` ties a tab to its FMS step so each row can show that step's audit + links.
const STEP_META = {
  intake:           { code: '1.01', name: 'Order Received' },
  so:               { code: '2.02', name: 'PO Entry in Tally & Dispatch vs PO' },
  inventory:        { code: '2.03', name: 'Check Inventory' },
  plan:             { code: '2.04', name: 'Dispatch Scheduler & PDF' },
  emailSchedule:    { code: '2.05', name: 'Email Dispatch Schedule' },
  dispatch:         { code: '2.06', name: 'Final Qty to be Dispatched (Challan)' },
  invoice:          { code: '2.07', name: 'Create Invoice & Eway Bill' },
  emailInvoice:     { code: '2.08', name: 'Email Invoice & Eway to Client' },
  trackDelivery:    { code: '2.09', name: 'Track Delivery' },
  paymentFollowup:  { code: '2.10', name: 'Follow up for Payment' },
  paymentReceipt:   { code: '2.11', name: 'Payment Confirmation & Tally Entry' },
  transportReceipt: { code: '2.12', name: 'Receive Transportation Bill' },
  transportPayment: { code: '2.13', name: 'Transportation Bill Payment' },
};

// Tabs that have NO dedicated entity collection — their data & audit live purely
// on the FMS process step (email / inventory / delivery-tracking steps).
const PROC_TABS = ['inventory', 'emailSchedule', 'emailInvoice', 'trackDelivery'];

// The date each step is filtered on (its "when it happened" field).
const dateOf = (tab, r) => {
  if (r.__step) return r.__step.actual || r.__step.planned; // process-step rows
  return ({
    intake: r.createdAt, so: r.orderDate, plan: r.updatedAt || r.poDate, dispatch: r.dcDate,
    invoice: r.invoiceDate,
    paymentFollowup: r.followUp?.actual, paymentReceipt: r.confirmation?.receivedDate,
    transportReceipt: r.receipt?.actual, transportPayment: r.payment?.actual,
  }[tab]);
};
// Party for each step (undefined = this step has no party, so the party filter is skipped).
const partyOf = (tab, r) => (tab === 'transportReceipt' || tab === 'transportPayment' ? undefined : r.partyName);

// ── Human helpers for the FMS step audit ──
const humanDelay = (step) => {
  if (!step) return '—';
  const mins = step.delayMins || 0;
  if (mins <= 0) return step.status === 'DONE' ? 'On time' : '—';
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const parts = [d && `${d}d`, h && `${h}h`, !d && !h && `${m}m`].filter(Boolean);
  return `${parts.join(' ')} late`;
};
// Best available "who did this step" from the denormalised sub-item names.
const stepDoer = (step) => {
  if (!step) return '—';
  const ap = (step.actionProgress || []).filter((a) => a.doneByName);
  if (ap.length) return ap[ap.length - 1].doneByName;
  const ff = (step.formFields || []).find((f) => f.filledByName);
  if (ff) return ff.filledByName;
  const ck = (step.checklist || []).find((c) => c.doneByName);
  if (ck) return ck.doneByName;
  return step.status === 'DONE' ? 'Completed' : '—';
};

// Resolve a step's connected records → clickable links with their own "who/when" log.
// This is the "two links on 2.06 = Actual Dispatch + Delivery Challan" the sheet expects.
const stepLinks = (step, proc) => {
  if (!step || !proc) return [];
  const ctx = {
    soNumber: proc.soNumber,
    orderId: proc.salesOrderId?._id || proc.salesOrderId,
    processId: proc._id,
    intakeId: proc.intakeId?._id || proc.intakeId,
  };
  const configured = step.actionLinks?.length ? step.actionLinks : (step.actionLink ? [step.actionLink] : []);
  // Also surface the record this step's trigger produces (e.g. ACTUAL_DISPATCH on
  // step 2.06) so trigger-driven steps always show their produced record alongside
  // any explicitly-configured links. De-duped, configured links first.
  const trig = step.triggerKey && step.triggerKey !== 'MANUAL' ? TRIGGER_TO_ACTION[step.triggerKey] : null;
  const keys = [...new Set([...configured, ...(trig ? [trig] : [])])];
  return keys.map((key) => {
    const meta = actionLinkMeta(key);
    const prog = (step.actionProgress || []).find((a) => a.key === key);
    const rec = resolveEntityLink(key, ctx);
    return {
      key,
      label: meta?.viewLabel || meta?.label || key,
      to: prog?.link || rec?.to || null,
      doneByName: prog?.doneByName || null,
      doneAt: prog?.doneAt || null,
    };
  });
};

// Standard audit columns for the pure process-step tabs (no entity collection).
const procCols = [
  col('order', 'Order', { minWidth: 150, valueGetter: (v, r) => r.soNumber || r.uniqueO2DId || '—' }),
  col('partyName', 'Party', { minWidth: 170, valueGetter: (v, r) => r.partyName || '—' }),
  col('poNumber', 'PO Number', { minWidth: 130, valueGetter: (v, r) => r.poNumber || '—' }),
  col('status', 'Status', { minWidth: 120, valueGetter: (v, r) => r.__step?.status || 'PENDING' }),
  col('planned', 'Planned', { minWidth: 120, valueGetter: (v, r) => dd(r.__step?.planned) }),
  col('doneOn', 'Done On', { minWidth: 180, valueGetter: (v, r) => dt(r.__step?.actual) }),
  col('delay', 'Delay', { minWidth: 110, valueGetter: (v, r) => humanDelay(r.__step) }),
  col('doneBy', 'Done By', { minWidth: 140, valueGetter: (v, r) => stepDoer(r.__step) }),
  col('remarks', 'Remarks', { minWidth: 180, sortable: false, valueGetter: (v, r) => r.__step?.remarks || '—' }),
];

// One column set per O2D step (mirrors the client's sheet tabs).
const COLUMNS = {
  intake: [
    col('createdAt', 'Timestamp', { minWidth: 180, valueGetter: (v, r) => dt(r.createdAt) }),
    col('partyName', "Party's Name", { minWidth: 180 }),
    col('channel', 'Channel', { minWidth: 110 }),
    col('contactName', 'Contact', { minWidth: 120, valueGetter: (v, r) => r.contactName || '—' }),
    col('items', 'Items', { minWidth: 220, sortable: false, valueGetter: (v, r) => (r.items || []).map((i) => `${i.skuName} (${num(i.qty)})`).join(', ') || '—' }),
    col('intakeStatus', 'Status', { minWidth: 110 }),
    col('createdByName', 'Logged By', { minWidth: 130, valueGetter: (v, r) => r.createdByName || r.createdBy?.name || 'System' }),
  ],
  so: [
    col('soNumber', 'SO Number', { minWidth: 150 }),
    col('poNumber', 'PO Number', { minWidth: 130 }),
    col('partyName', 'Party', { minWidth: 170 }),
    col('location', 'Location', { minWidth: 120 }),
    col('orderDate', 'Order Date', { minWidth: 120, valueGetter: (v, r) => dd(r.orderDate) }),
    col('totalOrderQty', 'Order Qty', { minWidth: 100, type: 'number', valueGetter: (v, r) => Number(r.totalOrderQty || 0) }),
    col('totalDispatchedQty', 'Dispatched', { minWidth: 110, type: 'number', valueGetter: (v, r) => Number(r.totalDispatchedQty || 0) }),
    col('totalBalanceQty', 'Balance', { minWidth: 100, type: 'number', valueGetter: (v, r) => Number(r.totalBalanceQty || 0) }),
    col('status', 'Status', { minWidth: 120 }),
  ],
  inventory: procCols,
  plan: [
    col('soNumber', 'SO Number', { minWidth: 150 }),
    col('poNumber', 'PO Number', { minWidth: 130 }),
    col('partyName', 'Party', { minWidth: 170 }),
    col('skuCount', 'SKUs', { minWidth: 80, type: 'number', valueGetter: (v, r) => (r.items || []).length }),
    col('phaseCount', 'Phases', { minWidth: 80, type: 'number', valueGetter: (v, r) => (r.items || []).reduce((s, it) => s + (it.phases || []).length, 0) }),
    col('totalPlanned', 'Planned Qty', { minWidth: 110, type: 'number', valueGetter: (v, r) => (r.items || []).reduce((s, it) => s + (it.phases || []).reduce((p, ph) => p + Number(ph.plannedQty || 0), 0), 0) }),
    col('poDate', 'PO Date', { minWidth: 120, valueGetter: (v, r) => dd(r.poDate) }),
    col('status', 'Status', { minWidth: 110 }),
  ],
  emailSchedule: procCols,
  dispatch: [
    col('dcNumber', 'DC Number', { minWidth: 150 }),
    col('dcDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.dcDate) }),
    col('partyName', 'Party', { minWidth: 160 }),
    col('soNumber', 'SO / PO', { minWidth: 150, valueGetter: (v, r) => `${r.soNumber || '—'}${r.poNumber ? ` / ${r.poNumber}` : ''}` }),
    col('phase', 'Phase', { minWidth: 100, valueGetter: (v, r) => (
      r.isUnplanned
        ? 'Unplanned'
        : ([...new Set((r.phaseRefs || []).map((x) => x.phaseNo).filter(Boolean))].join(', ') || r.phaseRef?.phaseNo || '—')
    ) }),
    col('totalQuantityPcs', 'Qty (pcs)', { minWidth: 100, type: 'number', valueGetter: (v, r) => Number(r.totalQuantityPcs || 0) }),
    col('totalBoxes', 'Boxes', { minWidth: 80, type: 'number', valueGetter: (v, r) => Number(r.totalBoxes || 0) }),
    col('transporterName', 'Transporter', { minWidth: 140, valueGetter: (v, r) => r.transporterName || '—' }),
    col('invoiceNo', 'Invoice No', { minWidth: 130, valueGetter: (v, r) => r.invoiceNo || '—' }),
    col('status', 'Status', { minWidth: 110 }),
  ],
  invoice: [
    col('invoiceNo', 'Invoice No', { minWidth: 150 }),
    col('invoiceDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.invoiceDate) }),
    col('partyName', 'Party', { minWidth: 160 }),
    col('invoiceAmount', 'Amount ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.invoiceAmount || 0) }),
    col('amountReceived', 'Received ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.amountReceived || 0) }),
    col('balance', 'Balance ₹', { minWidth: 110, type: 'number', valueGetter: (v, r) => Number(r.balance || 0) }),
    col('dcNumber', 'DC No', { minWidth: 130, valueGetter: (v, r) => r.dcNumber || '—' }),
    col('transporterName', 'Transporter', { minWidth: 140, valueGetter: (v, r) => r.transporterName || '—' }),
    col('status', 'Status', { minWidth: 110 }),
  ],
  emailInvoice: procCols,
  trackDelivery: procCols,
  // 2.10 — Payment Follow-up (Payment.followUp)
  paymentFollowup: [
    col('partyName', 'Party', { minWidth: 170 }),
    col('dcNumber', 'DC No', { minWidth: 130, valueGetter: (v, r) => r.dcNumber || '—' }),
    col('type', 'Type', { minWidth: 140, valueGetter: (v, r) => r.type || '—' }),
    col('followUpStatus', 'Follow-up', { minWidth: 120, valueGetter: (v, r) => r.followUp?.status || 'PENDING' }),
    col('followedOn', 'Followed On', { minWidth: 130, valueGetter: (v, r) => dd(r.followUp?.actual) }),
    col('followDelay', 'Delay', { minWidth: 100, valueGetter: (v, r) => r.followUp?.timeDelay || '—' }),
  ],
  // 2.11 — Receive Payment & Tally (Payment.confirmation)
  paymentReceipt: [
    col('partyName', 'Party', { minWidth: 170 }),
    col('dcNumber', 'DC No', { minWidth: 130, valueGetter: (v, r) => r.dcNumber || '—' }),
    col('receivedAmount', 'Received ₹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.confirmation?.receivedAmount || 0) }),
    col('receivedDate', 'Received On', { minWidth: 130, valueGetter: (v, r) => dd(r.confirmation?.receivedDate) }),
    col('confirmation', 'Confirmed', { minWidth: 120, valueGetter: (v, r) => r.confirmation?.status || 'PENDING' }),
  ],
  // 2.12 — Receive Transport Bill (TransportBill.receipt)
  transportReceipt: [
    col('dcNumber', 'DC No', { minWidth: 150, valueGetter: (v, r) => r.dcNumber || '—' }),
    col('receiptStatus', 'Bill Received', { minWidth: 140, valueGetter: (v, r) => r.receipt?.status || 'PENDING' }),
    col('receiptOn', 'Received On', { minWidth: 170, valueGetter: (v, r) => dt(r.receipt?.actual) }),
  ],
  // 2.13 — Transport Bill Payment (TransportBill.payment)
  transportPayment: [
    col('dcNumber', 'DC No', { minWidth: 150, valueGetter: (v, r) => r.dcNumber || '—' }),
    col('paymentStatus', 'Bill Paid', { minWidth: 130, valueGetter: (v, r) => r.payment?.status || 'PENDING' }),
    col('paymentOn', 'Paid On', { minWidth: 170, valueGetter: (v, r) => dt(r.payment?.actual) }),
  ],
};

const TABS = [
  { key: 'intake', label: 'Order Received · 1.01' },
  { key: 'so', label: 'Sales Orders · 2.02' },
  { key: 'inventory', label: 'Check Inventory · 2.03' },
  { key: 'plan', label: 'Dispatch Plans · 2.04' },
  { key: 'emailSchedule', label: 'Email Schedule · 2.05' },
  { key: 'dispatch', label: 'Actual Dispatch · 2.06' },
  { key: 'invoice', label: 'Invoices · 2.07' },
  { key: 'emailInvoice', label: 'Email Invoice · 2.08' },
  { key: 'trackDelivery', label: 'Track Delivery · 2.09' },
  { key: 'paymentFollowup', label: 'Payment Follow-up · 2.10' },
  { key: 'paymentReceipt', label: 'Receive Payment · 2.11' },
  { key: 'transportReceipt', label: 'Transport Bill · 2.12' },
  { key: 'transportPayment', label: 'Transport Payment · 2.13' },
];

// Compute a column's display value for the non-grid views (sheet / cards / board).
const displayVal = (c, row) => {
  const raw = c.valueGetter ? c.valueGetter(undefined, row) : row[c.field];
  return typeof raw === 'number' ? num(raw) : (raw ?? '—');
};
// Status accessor per step — used to group records in the Board view.
const statusOf = (tab, row) => {
  if (row.__step) return row.__step.status || 'PENDING';
  return ({
    intake: row.intakeStatus,
    so: row.status, plan: row.status, dispatch: row.status, invoice: row.status,
    paymentFollowup: row.followUp?.status,
    paymentReceipt: row.confirmation?.status,
    transportReceipt: row.receipt?.status,
    transportPayment: row.payment?.status,
  }[tab]) || 'PENDING';
};

const VIEWS = [
  { key: 'table', label: 'Table', icon: TableIcon },
  { key: 'sheet', label: 'Sheet', icon: Rows3 },
  { key: 'cards', label: 'Cards', icon: LayoutGrid },
  { key: 'board', label: 'Board', icon: Columns3 },
];

// ── Small building blocks for the audit log ──
const LogLine = ({ icon: Icon, children }) => (
  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'text.secondary', fontSize: '0.72rem' }}>
    {Icon && <Icon size={12} />}<span>{children}</span>
  </Stack>
);

/** Inline "connected records" chips shown in each row — click to open the record. */
const LinkChips = ({ links }) => {
  if (!links?.length) return <Typography variant="caption" color="text.disabled">—</Typography>;
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" rowGap={0.5}>
      {links.map((l) => (
        <Tooltip key={l.key} title={l.doneByName ? `${l.doneByName}${l.doneAt ? ` · ${dd(l.doneAt)}` : ''}` : (l.to ? 'Open record' : 'Not done yet')}>
          <span>
            <Chip
              size="small" label={l.label}
              icon={<ExternalLink size={11} />}
              clickable={!!l.to}
              component={l.to ? RouterLink : 'div'}
              to={l.to || undefined}
              sx={{ height: 22, fontSize: '0.66rem', fontWeight: 600,
                bgcolor: (t) => alpha(l.doneByName ? t.palette.success.main : t.palette.primary.main, 0.1),
                '& .MuiChip-icon': { ml: '4px' } }}
            />
          </span>
        </Tooltip>
      ))}
    </Stack>
  );
};

/** Right-side drawer: the full "who did what, when, why" log for one step + its links. */
const StepLogDrawer = ({ open, onClose, tab, row, resolve }) => {
  const theme = useTheme();
  const { step, proc } = (open && row) ? resolve(row) : { step: null, proc: null };
  const meta = STEP_META[tab] || {};
  const links = stepLinks(step, proc);
  const orderLink = proc?.salesOrderId
    ? { label: `Sales Order · ${proc.soNumber || ''}`, to: `/orders/${encodeURIComponent(String(proc.salesOrderId?._id || proc.salesOrderId))}` }
    : (proc?.intakeId ? { label: 'Order Intake', to: `/order-intake?convert=${encodeURIComponent(String(proc.intakeId?._id || proc.intakeId))}` } : null);

  const Section = ({ title, children }) => (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontWeight: 800, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary', mb: 0.75 }}>{title}</Typography>
      {children}
    </Box>
  );

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 440 }, p: 0 } }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1.75, color: '#fff', background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 100%)' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography sx={{ fontSize: '0.68rem', opacity: 0.8, fontWeight: 700 }}>STEP {meta.code}</Typography>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1.15 }}>{meta.name}</Typography>
            <Typography sx={{ fontSize: '0.74rem', opacity: 0.85, mt: 0.25 }}>
              {proc?.soNumber || proc?.uniqueO2DId || '—'}{proc?.partyName ? ` · ${proc.partyName}` : ''}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} sx={{ color: '#fff' }}><X size={18} /></IconButton>
        </Stack>
      </Box>

      <Box sx={{ p: 2, overflowY: 'auto' }}>
        {!proc && (
          <Typography variant="body2" color="text.disabled" sx={{ py: 2 }}>
            No FMS process record found for this row.
          </Typography>
        )}

        {proc && (
          <>
            {/* Timeline */}
            <Section title="Status & Timing">
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" rowGap={0.5} sx={{ mb: 1 }}>
                <Chip size="small" label={step?.status || 'PENDING'}
                  sx={{ fontWeight: 700, bgcolor: (t) => alpha(
                    step?.status === 'DONE' ? t.palette.success.main : step?.status === 'DELAYED' ? t.palette.error.main : t.palette.warning.main, 0.14) }} />
                {humanDelay(step) !== '—' && (
                  <Chip size="small" label={humanDelay(step)}
                    color={humanDelay(step) === 'On time' ? 'success' : 'error'} variant="outlined" sx={{ fontWeight: 700 }} />
                )}
              </Stack>
              <Stack spacing={0.4}>
                <LogLine icon={Clock}>Planned: <b>{dd(step?.planned)}</b></LogLine>
                <LogLine icon={Clock}>Done on: <b>{dt(step?.actual)}</b></LogLine>
                <LogLine icon={UserIcon}>By: <b>{stepDoer(step)}</b></LogLine>
              </Stack>
            </Section>

            {/* Connected records */}
            <Section title="Connected Records (Links)">
              <Stack spacing={0.75}>
                {orderLink && (
                  <Link component={RouterLink} to={orderLink.to} onClick={onClose}
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: '0.8rem', fontWeight: 700 }}>
                    <Link2 size={14} /> {orderLink.label}
                  </Link>
                )}
                {links.length === 0 && <Typography variant="caption" color="text.disabled">No connected screens on this step.</Typography>}
                {links.map((l) => (
                  <Box key={l.key} sx={{ p: 1, borderRadius: 1.5, border: `1px solid ${theme.palette.divider}` }}>
                    {l.to ? (
                      <Link component={RouterLink} to={l.to} onClick={onClose}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: '0.8rem', fontWeight: 700 }}>
                        <ExternalLink size={14} /> {l.label}
                      </Link>
                    ) : (
                      <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: 'text.secondary', display: 'flex', gap: 0.75, alignItems: 'center' }}>
                        <ExternalLink size={14} /> {l.label}
                      </Typography>
                    )}
                    <LogLine icon={l.doneByName ? CheckCircle2 : Circle}>
                      {l.doneByName ? <>Done by <b>{l.doneByName}</b>{l.doneAt ? ` · ${dt(l.doneAt)}` : ''}</> : 'Not completed yet'}
                    </LogLine>
                  </Box>
                ))}
              </Stack>
            </Section>

            {/* Form fields captured */}
            {(step?.formFields || []).length > 0 && (
              <Section title="Data Captured">
                <Stack spacing={0.75}>
                  {step.formFields.map((f) => (
                    <Box key={f._id}>
                      <Stack direction="row" justifyContent="space-between" spacing={1}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{f.label}</Typography>
                        <Typography variant="caption" sx={{ fontWeight: 700, textAlign: 'right' }}>
                          {f.value == null || f.value === '' ? '—' : (f.fieldType === 'DATE' ? dd(f.value) : String(f.value))}
                        </Typography>
                      </Stack>
                      {f.filledByName && <LogLine icon={UserIcon}>{f.filledByName}{f.filledAt ? ` · ${dd(f.filledAt)}` : ''}</LogLine>}
                    </Box>
                  ))}
                </Stack>
              </Section>
            )}

            {/* Checklist */}
            {(step?.checklist || []).length > 0 && (
              <Section title={`Checklist (${(step.checklist || []).filter((c) => c.done).length}/${step.checklist.length})`}>
                <Stack spacing={0.5}>
                  {step.checklist.map((c) => (
                    <Stack key={c._id} direction="row" spacing={0.75} alignItems="flex-start">
                      {c.done ? <CheckCircle2 size={14} color={theme.palette.success.main} style={{ marginTop: 2 }} /> : <Circle size={14} color={theme.palette.text.disabled} style={{ marginTop: 2 }} />}
                      <Box>
                        <Typography variant="caption" sx={{ fontWeight: 600 }}>{c.text}</Typography>
                        {c.done && c.doneByName && <LogLine icon={UserIcon}>{c.doneByName}{c.doneAt ? ` · ${dd(c.doneAt)}` : ''}</LogLine>}
                      </Box>
                    </Stack>
                  ))}
                </Stack>
              </Section>
            )}

            {/* Verifications */}
            {(step?.verifications || []).length > 0 && (
              <Section title="Verifications">
                <Stack spacing={0.75}>
                  {step.verifications.map((vv) => (
                    <Box key={vv._id}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>{vv.question}</Typography>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <Chip size="small" label={vv.answer || '—'} color={vv.answer === 'YES' ? 'success' : vv.answer === 'NO' ? 'error' : 'default'} sx={{ height: 18, fontSize: '0.62rem' }} />
                        {vv.remark && <Typography variant="caption" color="text.secondary">{vv.remark}</Typography>}
                      </Stack>
                      {vv.answeredByName && <LogLine icon={UserIcon}>{vv.answeredByName}{vv.answeredAt ? ` · ${dd(vv.answeredAt)}` : ''}</LogLine>}
                    </Box>
                  ))}
                </Stack>
              </Section>
            )}

            {/* Remarks */}
            {step?.remarks && (
              <Section title="Remarks">
                <Typography variant="body2">{step.remarks}</Typography>
              </Section>
            )}

            {/* Comments */}
            {(step?.comments || []).length > 0 && (
              <Section title="Comments">
                <Stack spacing={0.75}>
                  {step.comments.map((cm) => (
                    <Box key={cm._id} sx={{ p: 1, borderRadius: 1.5, bgcolor: (t) => alpha(t.palette.primary.main, 0.04) }}>
                      <Typography variant="body2">{cm.text}</Typography>
                      <LogLine icon={UserIcon}>{cm.userName || 'User'}{cm.at ? ` · ${dt(cm.at)}` : ''}</LogLine>
                    </Box>
                  ))}
                </Stack>
              </Section>
            )}

            {/* Attachments */}
            {(step?.attachments || []).length > 0 && (
              <Section title="Attachments">
                <Stack spacing={0.5}>
                  {step.attachments.map((a) => (
                    <LogLine key={a._id} icon={FileText}>
                      <Link href={a.fileUrl} target="_blank" rel="noreferrer" sx={{ fontWeight: 700 }}>{a.fileName}</Link>
                      {a.uploadedByName ? ` · ${a.uploadedByName}` : ''}
                    </LogLine>
                  ))}
                </Stack>
              </Section>
            )}
          </>
        )}
      </Box>
    </Drawer>
  );
};

/**
 * O2D Master Data — a per-step data view (one tab per O2D step) mirroring the
 * client's sheet tabs: every entry shown with its full columns (who/what/when),
 * its connected records (links), and a full audit log per step (Links & Log).
 * Switch between Table / Sheet / Cards / Board views. Read-only.
 */
const O2dMasterData = () => {
  const theme = useTheme();
  const [tab, setTab] = useState('intake');
  const [view, setView] = useState('table');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [logRow, setLogRow] = useState(null); // row whose Links & Log drawer is open
  // ── GLOBAL filters — set once, apply to every step tab (do NOT reset on switch).
  const [partyFilter, setPartyFilter] = useState('');
  const [dateMode, setDateMode] = useState('all'); // all | month | day | custom
  const [monthVal, setMonthVal] = useState(dayjs().format('YYYY-MM'));
  const [dayVal, setDayVal] = useState(dayjs().format('YYYY-MM-DD'));
  const [fromVal, setFromVal] = useState('');
  const [toVal, setToVal] = useState('');

  // Party dropdown source — the full parties master (stable across tabs).
  const { data: partiesRes } = useGetPartiesQuery({ limit: 1000, sort: 'name' });
  const partyOptions = useMemo(() => (partiesRes?.data || []).map((p) => p.name).filter(Boolean), [partiesRes]);

  // Switching tabs keeps the global party/date filters — only the per-tab search/status reset.
  const switchTab = (t) => { setTab(t); setSearch(''); setStatusFilter(''); };
  const clearGlobal = () => { setPartyFilter(''); setDateMode('all'); setFromVal(''); setToVal(''); };

  const inDateRange = (d) => {
    if (dateMode === 'all') return true;
    if (!d) return false;
    const dj = dayjs(d);
    if (!dj.isValid()) return false;
    if (dateMode === 'month') return !monthVal || dj.format('YYYY-MM') === monthVal;
    if (dateMode === 'day') return !dayVal || dj.format('YYYY-MM-DD') === dayVal;
    if (dateMode === 'custom') {
      const okFrom = !fromVal || !dj.isBefore(dayjs(fromVal), 'day');
      const okTo = !toVal || !dj.isAfter(dayjs(toVal), 'day');
      return okFrom && okTo;
    }
    return true;
  };

  const isProcTab = PROC_TABS.includes(tab);

  // The FMS process register — the audit ledger. Loaded always: it drives the
  // pure process tabs AND supplies the "Links & Log" for every entity tab.
  const procQ = useGetProcessesQuery({ limit: 3000, sort: '-createdAt' });
  const processes = useMemo(() => procQ?.data?.data || [], [procQ]);
  const procBySo = useMemo(() => {
    const m = new Map();
    processes.forEach((p) => { if (p.soNumber) m.set(String(p.soNumber), p); });
    return m;
  }, [processes]);
  const procByIntake = useMemo(() => {
    const m = new Map();
    processes.forEach((p) => { const id = p.intakeId?._id || p.intakeId; if (id) m.set(String(id), p); });
    return m;
  }, [processes]);

  // Payment/transport rows carry only dcNumber → resolve to soNumber via challans.
  const needDcMap = ['paymentFollowup', 'paymentReceipt', 'transportReceipt', 'transportPayment'].includes(tab);
  const dcMapQ = useGetChallansQuery({ limit: 3000, sort: '-dcDate' }, { skip: !needDcMap });
  const dcToSo = useMemo(() => {
    const m = new Map();
    (dcMapQ?.data?.data || []).forEach((c) => { if (c.dcNumber) m.set(String(c.dcNumber), c.soNumber); });
    return m;
  }, [dcMapQ]);

  // Only the active entity tab fetches (skip the rest) — fast and cache-friendly.
  const intakeQ = useGetOrderIntakesQuery({ limit: 500, sort: '-createdAt' }, { skip: tab !== 'intake' });
  const soQ = useGetOrdersQuery({ limit: 1000, sort: '-orderDate' }, { skip: tab !== 'so' });
  const planQ = useGetSchedulesQuery({ limit: 1000, sort: '-updatedAt' }, { skip: tab !== 'plan' });
  const dcQ = useGetChallansQuery({ limit: 1000, sort: '-dcDate' }, { skip: tab !== 'dispatch' });
  const invQ = useGetSalesInvoicesQuery({ limit: 1000, sort: '-invoiceDate' }, { skip: tab !== 'invoice' });
  const payQ = useGetPaymentsQuery(undefined, { skip: tab !== 'paymentFollowup' && tab !== 'paymentReceipt' });
  const tbQ = useGetTransportBillsQuery(undefined, { skip: tab !== 'transportReceipt' && tab !== 'transportPayment' });

  const current = isProcTab ? procQ : {
    intake: intakeQ, so: soQ, plan: planQ, dispatch: dcQ, invoice: invQ,
    paymentFollowup: payQ, paymentReceipt: payQ,
    transportReceipt: tbQ, transportPayment: tbQ,
  }[tab];
  const columns = COLUMNS[tab];

  // Rows for the pure process-step tabs: one row per order that has this step.
  const procRows = useMemo(() => {
    if (!isProcTab) return [];
    const code = STEP_META[tab].code;
    return processes.map((p) => {
      const step = (p.steps || []).find((s) => s.stepCode === code);
      if (!step) return null;
      return {
        _id: `${p._id}_${code}`, processId: p._id,
        soNumber: p.soNumber, poNumber: p.poNumber, partyName: p.partyName, uniqueO2DId: p.uniqueO2DId,
        __step: step, __proc: p,
      };
    }).filter(Boolean);
  }, [processes, tab, isProcTab]);

  const rawRows = useMemo(() => (isProcTab ? procRows : (current?.data?.data || [])), [isProcTab, procRows, current]);

  // Resolve any row → its FMS process step (for the Links & Log layer).
  const stepForRow = useMemo(() => (row) => {
    if (row.__step) return { step: row.__step, proc: row.__proc };
    let proc = null;
    if (tab === 'intake') proc = procByIntake.get(String(row._id));
    else {
      const so = row.soNumber || dcToSo.get(String(row.dcNumber));
      if (so) proc = procBySo.get(String(so));
    }
    if (!proc) return { step: null, proc: null };
    const code = STEP_META[tab].code;
    return { step: (proc.steps || []).find((s) => s.stepCode === code) || null, proc };
  }, [tab, procBySo, procByIntake, dcToSo]);

  // Connected-record chips for a row (resolves its FMS step, then its links).
  const linksForRow = useMemo(() => (row) => { const { step, proc } = stepForRow(row); return stepLinks(step, proc); }, [stepForRow]);

  // Distinct statuses present (for the status filter dropdown).
  const statuses = useMemo(() => [...new Set(rawRows.map((r) => statusOf(tab, r)).filter(Boolean))], [rawRows, tab]);

  // Apply GLOBAL party + date, then per-tab status + free-text search.
  const rows = useMemo(() => {
    let list = rawRows;
    if (partyFilter) list = list.filter((r) => { const p = partyOf(tab, r); return p === undefined || p === partyFilter; });
    if (dateMode !== 'all') list = list.filter((r) => inDateRange(dateOf(tab, r)));
    if (statusFilter) list = list.filter((r) => statusOf(tab, r) === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => columns.some((c) => String(displayVal(c, r)).toLowerCase().includes(q)));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawRows, statusFilter, search, tab, columns, partyFilter, dateMode, monthVal, dayVal, fromVal, toVal]);

  // Grid columns = the tab's columns + a Connected-records column + a Log button.
  const gridColumns = useMemo(() => [
    ...columns,
    col('__links', 'Connected', {
      minWidth: 210, flex: 1.2, sortable: false, filterable: false,
      renderCell: (p) => <LinkChips links={linksForRow(p.row)} />,
    }),
    col('__log', 'Log', {
      width: 92, flex: 0, sortable: false, filterable: false,
      renderCell: (p) => (
        <Button size="small" startIcon={<ScrollText size={14} />} onClick={() => setLogRow(p.row)} sx={{ fontWeight: 700 }}>Log</Button>
      ),
    }),
  ], [columns, stepForRow]);

  const activeTab = TABS.find((t) => t.key === tab);
  const filterSummary = [
    partyFilter && `Party: ${partyFilter}`,
    dateMode === 'month' && monthVal && `Month: ${dayjs(`${monthVal}-01`).format('MMM YYYY')}`,
    dateMode === 'day' && dayVal && `Day: ${dayjs(dayVal).format('DD MMM YYYY')}`,
    dateMode === 'custom' && (fromVal || toVal) && `Range: ${fromVal ? dayjs(fromVal).format('DD MMM YYYY') : '…'} → ${toVal ? dayjs(toVal).format('DD MMM YYYY') : '…'}`,
    statusFilter && `Status: ${statusFilter}`,
  ].filter(Boolean).join('  ·  ') || 'All records';
  const exportBase = `O2D ${activeTab?.label || tab}${partyFilter ? ` - ${partyFilter}` : ''}`.replace(/[\\/:*?"<>|]/g, '-');
  const doExcel = () => exportRowsToExcel({ columns, rows, displayVal, sheetName: activeTab?.label || tab, fileName: `${exportBase}.xlsx` });
  const doPdf = () => printTablePdf({ title: activeTab?.label ? `O2D — ${activeTab.label}` : 'O2D Master Data', subtitle: filterSummary, columns, rows, displayVal });

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Hero (compact) */}
      <Box sx={{ color: '#fff', px: { xs: 2, md: 3 }, pt: { xs: 1.75, md: 2 }, pb: { xs: 2.5, md: 3 },
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)' }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Box sx={{ width: 36, height: 36, borderRadius: 2, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}>
            <Database size={18} color="#fff" />
          </Box>
          <Box>
            <Typography sx={{ color: '#fff', fontSize: { xs: '1.05rem', md: '1.2rem' }, fontWeight: 800, lineHeight: 1.1 }}>O2D Master Data</Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.72rem' }}>
              Every step · who did what, when · connected records &amp; full audit log. One tab per O2D step.
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.5, md: 3 }, mt: { xs: -1.5, md: -1.75 }, position: 'relative', pb: 6 }}>
        {/* ── GLOBAL filters (apply to every step tab) + export ── */}
        <Paper sx={{ borderRadius: 3, p: 1.25, mb: 1.5, border: `1px solid ${theme.palette.divider}` }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" rowGap={1}>
            <Chip label="FILTERS" size="small" sx={{ fontWeight: 800, letterSpacing: '0.06em', bgcolor: alpha(theme.palette.primary.main, 0.1), color: 'primary.dark' }} />
            <Autocomplete
              size="small" options={partyOptions} value={partyFilter || null}
              onChange={(_, v) => setPartyFilter(v || '')}
              sx={{ width: 230 }}
              renderInput={(pr) => <TextField {...pr} placeholder="All parties" sx={{ '& .MuiInputBase-root': { height: 34 } }} />}
            />
            <TextField select size="small" value={dateMode} onChange={(e) => setDateMode(e.target.value)}
              sx={{ width: 140, '& .MuiInputBase-root': { height: 34 } }}>
              <MenuItem value="all">All dates</MenuItem>
              <MenuItem value="month">By month</MenuItem>
              <MenuItem value="day">By day</MenuItem>
              <MenuItem value="custom">Custom range</MenuItem>
            </TextField>
            {dateMode === 'month' && (
              <TextField size="small" type="month" value={monthVal} onChange={(e) => setMonthVal(e.target.value)} sx={{ width: 150, '& .MuiInputBase-root': { height: 34 } }} />
            )}
            {dateMode === 'day' && (
              <TextField size="small" type="date" value={dayVal} onChange={(e) => setDayVal(e.target.value)} sx={{ width: 160, '& .MuiInputBase-root': { height: 34 } }} />
            )}
            {dateMode === 'custom' && (
              <>
                <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={fromVal} onChange={(e) => setFromVal(e.target.value)} sx={{ width: 155, '& .MuiInputBase-root': { height: 34 } }} />
                <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={toVal} onChange={(e) => setToVal(e.target.value)} sx={{ width: 155, '& .MuiInputBase-root': { height: 34 } }} />
              </>
            )}
            {(partyFilter || dateMode !== 'all') && (
              <Button size="small" startIcon={<X size={14} />} onClick={clearGlobal} sx={{ fontWeight: 700 }}>Clear</Button>
            )}
            <Box sx={{ flex: 1 }} />
            <Button size="small" variant="outlined" startIcon={<FileSpreadsheet size={15} />} onClick={doExcel}>Excel</Button>
            <Button size="small" variant="contained" startIcon={<FileText size={15} />} onClick={doPdf}>PDF</Button>
          </Stack>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, mt: 0.75, display: 'block' }}>
            {filterSummary} — applies to <strong>every step tab</strong>. Export reflects the current tab &amp; filters.
          </Typography>
        </Paper>

        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Tabs value={tab} onChange={(_, v) => switchTab(v)} variant="scrollable" scrollButtons="auto"
            sx={{ borderBottom: `1px solid ${theme.palette.divider}`, minHeight: 36, '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', fontSize: '0.72rem', minHeight: 36, py: 0.25, minWidth: 'auto', px: 1.5 } }}>
            {TABS.map((t) => <Tab key={t.key} value={t.key} label={t.label} />)}
          </Tabs>

          {/* Compact toolbar: search · status · count · view */}
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1, flexWrap: 'wrap', borderBottom: `1px solid ${theme.palette.divider}` }}>
            <TextField
              size="small" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              sx={{ width: { xs: '100%', sm: 240 }, '& .MuiInputBase-root': { height: 34 } }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment> }}
            />
            <TextField
              select size="small" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              sx={{ width: 150, '& .MuiInputBase-root': { height: 34 } }} displayEmpty
              SelectProps={{ displayEmpty: true, renderValue: (v) => (v || 'All statuses') }}
            >
              <MenuItem value="">All statuses</MenuItem>
              {statuses.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
              {rows.length}{statusFilter || search ? ` / ${rawRows.length}` : ''} record{rows.length === 1 ? '' : 's'}
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

          {/* ── Table view (DataGrid) ── */}
          {view === 'table' && (
            <Box sx={{ px: 1.5, pb: 1.5 }}>
              <DataGrid
                rows={rows} columns={gridColumns} getRowId={(r) => r._id} loading={current?.isFetching}
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
                  <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.06) }}>
                    <TableCell sx={{ fontWeight: 800 }}>#</TableCell>
                    {columns.map((c) => <TableCell key={c.field} sx={{ fontWeight: 800 }}>{c.headerName}</TableCell>)}
                    <TableCell sx={{ fontWeight: 800 }}>Connected</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Log</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={row._id} hover>
                      <TableCell sx={{ color: 'text.disabled' }}>{i + 1}</TableCell>
                      {columns.map((c) => <TableCell key={c.field}>{displayVal(c, row)}</TableCell>)}
                      <TableCell sx={{ whiteSpace: 'normal' }}><LinkChips links={linksForRow(row)} /></TableCell>
                      <TableCell>
                        <Button size="small" startIcon={<ScrollText size={13} />} onClick={() => setLogRow(row)}>Log</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && <TableRow><TableCell colSpan={columns.length + 3} sx={{ textAlign: 'center', color: 'text.disabled', py: 3 }}>No records.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </Box>
          )}

          {/* ── Cards view ── */}
          {view === 'cards' && (
            <Box sx={{ p: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 1.5 }}>
              {rows.map((row) => (
                <Paper key={row._id} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
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
                  <Divider sx={{ my: 1 }} />
                  <LinkChips links={linksForRow(row)} />
                  <Button size="small" fullWidth startIcon={<ScrollText size={14} />} onClick={() => setLogRow(row)} sx={{ mt: 0.75, fontWeight: 700 }}>
                    Links &amp; Log
                  </Button>
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
                        <Paper key={row._id} variant="outlined" sx={{ p: 1.25, borderRadius: 2, cursor: 'pointer' }} onClick={() => setLogRow(row)}>
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

      {/* Links & Log drawer — the full "who did what, when, why" audit for a step. */}
      <StepLogDrawer open={!!logRow} onClose={() => setLogRow(null)} tab={tab} row={logRow} resolve={stepForRow} />
    </Box>
  );
};

export default O2dMasterData;
