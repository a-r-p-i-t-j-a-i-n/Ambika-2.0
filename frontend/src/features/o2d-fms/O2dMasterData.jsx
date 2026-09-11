import React, { useState, useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, Chip, alpha, useTheme, Button, Autocomplete,
  ToggleButtonGroup, ToggleButton, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, MenuItem, InputAdornment, Drawer, Divider, IconButton, Tooltip, Link,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Link as RouterLink } from 'react-router-dom';
import {
  Database, Table as TableIcon, Rows3, LayoutGrid, Columns3, Search, FileSpreadsheet,
  FileText, X, ExternalLink, ScrollText, CheckCircle2, Circle, Link2, Clock, User as UserIcon,
  Paperclip, Mail,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useGetOrderIntakesQuery } from '../../store/api/orderIntakeApi';
import { useGetOrdersQuery } from '../../store/api/orderApi';
import { useGetChallansQuery, useGetSchedulesQuery } from '../../store/api/dispatchControlApi';
import { useGetSalesInvoicesQuery } from '../../store/api/salesInvoiceApi';
import { useGetPaymentsQuery, useGetTransportBillsQuery } from '../../store/api/o2dFulfillmentApi';
import { useGetPartiesQuery } from '../../store/api/partyApi';
import { O2D, tokenOf } from './o2dTheme';
import { useGetProcessesQuery } from '../../store/api/o2dFmsApi';
import { actionLinkMeta, resolveEntityLink, TRIGGER_TO_ACTION } from './actionLinks';
import { exportRowsToExcel, printTablePdf } from '../../utils/exportMasterData';
import { resolveFileUrl } from '../../utils/fileUrl';

const num = (n) => (Number(n || 0)).toLocaleString('en-IN');
const dt = (d) => (d ? dayjs(d).format('DD MMM YYYY Â· hh:mm A') : 'â€”');
const dd = (d) => (d ? dayjs(d).format('DD MMM YYYY') : 'â€”');
const col = (field, headerName, extra = {}) => ({ field, headerName, flex: 1, minWidth: 120, sortable: true, ...extra });

// â”€â”€ Step catalog (ACTIVE fmsKey = CURRENT_SHEET) â€” every O2D step, in order.
// `code` ties a tab to its FMS step so each row can show that step's audit + links.
const STEP_META = {
  // Client flow: 1.01 IS the sales-order punch-in ("Order Received"); 2.02 is
  // the PO-vs-Tally check that follows it â€” a pure process step, no entity.
  so:               { code: '1.01', name: 'Order Received (SO Punch-in)' },
  poTally:          { code: '2.02', name: 'PO Recd Entry in Tally & Dispatch Vs PO' },
  inventory:        { code: '2.03', name: 'Check Inventory' },
  plan:             { code: '2.04', name: 'Create Dispatch Scheduler & Planning' },
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

// Tabs that have NO dedicated entity collection â€” their data & audit live purely
// on the FMS process step (email / inventory / delivery-tracking steps).
const PROC_TABS = ['poTally', 'inventory', 'emailSchedule', 'emailInvoice', 'trackDelivery'];

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

// â”€â”€ Human helpers for the FMS step audit â”€â”€
const humanDelay = (step) => {
  if (!step) return 'â€”';
  const mins = step.delayMins || 0;
  if (mins <= 0) return step.status === 'DONE' ? 'On time' : 'â€”';
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const parts = [d && `${d}d`, h && `${h}h`, !d && !h && `${m}m`].filter(Boolean);
  return `${parts.join(' ')} late`;
};
// Best available "who did this step" from the denormalised sub-item names.
const stepDoer = (step) => {
  if (!step) return 'â€”';
  const ap = (step.actionProgress || []).filter((a) => a.doneByName);
  if (ap.length) return ap[ap.length - 1].doneByName;
  const ff = (step.formFields || []).find((f) => f.filledByName);
  if (ff) return ff.filledByName;
  const ck = (step.checklist || []).find((c) => c.doneByName);
  if (ck) return ck.doneByName;
  return step.status === 'DONE' ? 'Completed' : 'â€”';
};

// Resolve a step's connected records â†’ clickable links with their own "who/when" log.
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
  col('order', 'Order', { minWidth: 150, valueGetter: (v, r) => r.soNumber || r.uniqueO2DId || 'â€”' }),
  col('partyName', 'Party', { minWidth: 170, valueGetter: (v, r) => r.partyName || 'â€”' }),
  col('poNumber', 'PO Number', { minWidth: 130, valueGetter: (v, r) => r.poNumber || 'â€”' }),
  col('status', 'Status', { minWidth: 120, valueGetter: (v, r) => r.__step?.status || 'PENDING' }),
  col('planned', 'Planned', { minWidth: 120, valueGetter: (v, r) => dd(r.__step?.planned) }),
  col('doneOn', 'Done On', { minWidth: 180, valueGetter: (v, r) => dt(r.__step?.actual) }),
  col('delay', 'Delay', { minWidth: 110, valueGetter: (v, r) => humanDelay(r.__step) }),
  col('doneBy', 'Done By', { minWidth: 140, valueGetter: (v, r) => stepDoer(r.__step) }),
  col('remarks', 'Remarks', { minWidth: 180, sortable: false, valueGetter: (v, r) => r.__step?.remarks || 'â€”' }),
];

// One column set per O2D step (mirrors the client's sheet tabs).
const COLUMNS = {
  intake: [
    col('createdAt', 'Timestamp', { minWidth: 180, valueGetter: (v, r) => dt(r.createdAt) }),
    col('partyName', "Party's Name", { minWidth: 180 }),
    col('channel', 'Channel', { minWidth: 110 }),
    col('contactName', 'Contact', { minWidth: 120, valueGetter: (v, r) => r.contactName || 'â€”' }),
    col('items', 'Items', { minWidth: 220, sortable: false, valueGetter: (v, r) => (r.items || []).map((i) => `${i.skuName} (${num(i.qty)})`).join(', ') || 'â€”' }),
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
  poTally: procCols,
  inventory: procCols,
  plan: [
    col('soNumber', 'SO Number', { minWidth: 150 }),
    col('poNumber', 'PO Number', { minWidth: 130 }),
    col('partyName', 'Party', { minWidth: 170 }),
    col('skuCount', 'SKUs', { minWidth: 80, type: 'number', valueGetter: (v, r) => (r.items || []).length }),
    col('phaseCount', 'Phases', { minWidth: 80, type: 'number', valueGetter: (v, r) => new Set((r.items || []).flatMap((it) => (it.phases || []).map((ph) => ph.phaseNo).filter((n) => n != null))).size }),
    col('totalPlanned', 'Planned Qty', { minWidth: 110, type: 'number', valueGetter: (v, r) => (r.items || []).reduce((s, it) => s + (it.phases || []).reduce((p, ph) => p + Number(ph.plannedQty || 0), 0), 0) }),
    col('poDate', 'PO Date', { minWidth: 120, valueGetter: (v, r) => dd(r.poDate) }),
    col('status', 'Status', { minWidth: 110 }),
  ],
  emailSchedule: procCols,
  dispatch: [
    col('dcNumber', 'DC Number', { minWidth: 150 }),
    col('dcDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.dcDate) }),
    col('partyName', 'Party', { minWidth: 160 }),
    col('soNumber', 'SO / PO', { minWidth: 150, valueGetter: (v, r) => `${r.soNumber || 'â€”'}${r.poNumber ? ` / ${r.poNumber}` : ''}` }),
    col('phase', 'Phase', { minWidth: 100, valueGetter: (v, r) => (
      r.isUnplanned
        ? 'Unplanned'
        : ([...new Set((r.phaseRefs || []).map((x) => x.phaseNo).filter(Boolean))].join(', ') || r.phaseRef?.phaseNo || 'â€”')
    ) }),
    col('totalQuantityPcs', 'Qty (pcs)', { minWidth: 100, type: 'number', valueGetter: (v, r) => Number(r.totalQuantityPcs || 0) }),
    col('totalBoxes', 'Boxes', { minWidth: 80, type: 'number', valueGetter: (v, r) => Number(r.totalBoxes || 0) }),
    col('transporterName', 'Transporter', { minWidth: 140, valueGetter: (v, r) => r.transporterName || 'â€”' }),
    col('invoiceNo', 'Invoice No', { minWidth: 130, valueGetter: (v, r) => r.invoiceNo || 'â€”' }),
    col('status', 'Status', { minWidth: 110 }),
  ],
  invoice: [
    col('invoiceNo', 'Invoice No', { minWidth: 150 }),
    col('invoiceDate', 'Date', { minWidth: 120, valueGetter: (v, r) => dd(r.invoiceDate) }),
    col('partyName', 'Party', { minWidth: 160 }),
    col('invoiceAmount', 'Amount â‚¹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.invoiceAmount || 0) }),
    col('amountReceived', 'Received â‚¹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.amountReceived || 0) }),
    col('balance', 'Balance â‚¹', { minWidth: 110, type: 'number', valueGetter: (v, r) => Number(r.balance || 0) }),
    col('dcNumber', 'DC No', { minWidth: 130, valueGetter: (v, r) => r.dcNumber || 'â€”' }),
    col('transporterName', 'Transporter', { minWidth: 140, valueGetter: (v, r) => r.transporterName || 'â€”' }),
    col('status', 'Status', { minWidth: 110 }),
  ],
  emailInvoice: procCols,
  trackDelivery: procCols,
  // 2.10 â€” Payment Follow-up (Payment.followUp)
  paymentFollowup: [
    col('partyName', 'Party', { minWidth: 170 }),
    col('dcNumber', 'DC No', { minWidth: 130, valueGetter: (v, r) => r.dcNumber || 'â€”' }),
    col('type', 'Type', { minWidth: 140, valueGetter: (v, r) => r.type || 'â€”' }),
    col('followUpStatus', 'Follow-up', { minWidth: 120, valueGetter: (v, r) => r.followUp?.status || 'PENDING' }),
    col('followedOn', 'Followed On', { minWidth: 130, valueGetter: (v, r) => dd(r.followUp?.actual) }),
    col('followDelay', 'Delay', { minWidth: 100, valueGetter: (v, r) => r.followUp?.timeDelay || 'â€”' }),
  ],
  // 2.11 â€” Receive Payment & Tally (Payment.confirmation)
  paymentReceipt: [
    col('partyName', 'Party', { minWidth: 170 }),
    col('dcNumber', 'DC No', { minWidth: 130, valueGetter: (v, r) => r.dcNumber || 'â€”' }),
    col('receivedAmount', 'Received â‚¹', { minWidth: 120, type: 'number', valueGetter: (v, r) => Number(r.confirmation?.receivedAmount || 0) }),
    col('receivedDate', 'Received On', { minWidth: 130, valueGetter: (v, r) => dd(r.confirmation?.receivedDate) }),
    col('confirmation', 'Confirmed', { minWidth: 120, valueGetter: (v, r) => r.confirmation?.status || 'PENDING' }),
  ],
  // 2.12 â€” Receive Transport Bill (TransportBill.receipt)
  transportReceipt: [
    col('dcNumber', 'DC No', { minWidth: 150, valueGetter: (v, r) => r.dcNumber || 'â€”' }),
    col('receiptStatus', 'Bill Received', { minWidth: 140, valueGetter: (v, r) => r.receipt?.status || 'PENDING' }),
    col('receiptOn', 'Received On', { minWidth: 170, valueGetter: (v, r) => dt(r.receipt?.actual) }),
  ],
  // 2.13 â€” Transport Bill Payment (TransportBill.payment)
  transportPayment: [
    col('dcNumber', 'DC No', { minWidth: 150, valueGetter: (v, r) => r.dcNumber || 'â€”' }),
    col('paymentStatus', 'Bill Paid', { minWidth: 130, valueGetter: (v, r) => r.payment?.status || 'PENDING' }),
    col('paymentOn', 'Paid On', { minWidth: 170, valueGetter: (v, r) => dt(r.payment?.actual) }),
  ],
};

const TABS = [
  { key: 'so', label: 'Order Received Â· 1.01' },
  { key: 'poTally', label: 'PO Entry in Tally Â· 2.02' },
  { key: 'inventory', label: 'Check Inventory Â· 2.03' },
  { key: 'plan', label: 'Dispatch Scheduler & Planning Â· 2.04' },
  { key: 'emailSchedule', label: 'Email Schedule Â· 2.05' },
  { key: 'dispatch', label: 'Actual Dispatch Â· 2.06' },
  { key: 'invoice', label: 'Invoices Â· 2.07' },
  { key: 'emailInvoice', label: 'Email Invoice Â· 2.08' },
  { key: 'trackDelivery', label: 'Track Delivery Â· 2.09' },
  { key: 'paymentFollowup', label: 'Payment Follow-up Â· 2.10' },
  { key: 'paymentReceipt', label: 'Receive Payment Â· 2.11' },
  { key: 'transportReceipt', label: 'Transport Bill Â· 2.12' },
  { key: 'transportPayment', label: 'Transport Payment Â· 2.13' },
];

// Compute a column's display value for the non-grid views (sheet / cards / board).
const displayVal = (c, row) => {
  const raw = c.valueGetter ? c.valueGetter(undefined, row) : row[c.field];
  return typeof raw === 'number' ? num(raw) : (raw ?? 'â€”');
};
// Status accessor per step â€” used to group records in the Board view.
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

// â”€â”€ Small building blocks for the audit log â”€â”€
const LogLine = ({ icon: Icon, children }) => (
  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'text.secondary', fontSize: '0.72rem' }}>
    {Icon && <Icon size={12} />}<span>{children}</span>
  </Stack>
);

/** Connected records â†’ ONE compact clickable link on a single line (extras collapse
 *  to "+N"), so a row with many connected records can't grow tall or overlap. The
 *  full list is always available in the row's "Log" detail. */
const LinkChips = ({ links }) => {
  if (!links?.length) return <Typography variant="caption" color="text.disabled">â€”</Typography>;
  const first = links[0];
  const extra = links.length - 1;
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'nowrap', minWidth: 0 }}>
      <Tooltip title={`${first.label}${first.doneByName ? ` Â· ${first.doneByName}${first.doneAt ? ` Â· ${dd(first.doneAt)}` : ''}` : (first.to ? ' Â· open record' : ' Â· not done yet')}`}>
        {first.to ? (
          <Link component={RouterLink} to={first.to}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, minWidth: 0, maxWidth: 170,
              fontSize: '0.72rem', fontWeight: 700, textDecoration: 'none',
              color: (t) => (first.doneByName ? t.palette.success.main : t.palette.primary.main),
              '&:hover': { textDecoration: 'underline' } }}>
            <ExternalLink size={11} style={{ flexShrink: 0 }} />
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{first.label}</Box>
          </Link>
        ) : (
          <Typography variant="caption" noWrap sx={{ maxWidth: 170, color: 'text.secondary' }}>{first.label}</Typography>
        )}
      </Tooltip>
      {extra > 0 && (
        <Tooltip title={links.slice(1).map((l) => l.label).join(', ')}>
          <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', flexShrink: 0 }}>+{extra}</Typography>
        </Tooltip>
      )}
    </Stack>
  );
};

/** Row cell: connected-record chips + small indicators for attachments / emails sent. */
const ConnectedCell = ({ step, proc }) => {
  const links = stepLinks(step, proc);
  const atts = step?.attachments?.length || 0;
  const emails = step?.emailLog?.length || 0;
  if (!links.length && !atts && !emails) return <Typography variant="caption" color="text.disabled">â€”</Typography>;
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'nowrap', overflow: 'hidden', maxWidth: '100%' }}>
      <LinkChips links={links} />
      {atts > 0 && (
        <Tooltip title={`${atts} attachment${atts > 1 ? 's' : ''}`}>
          <Chip size="small" icon={<Paperclip size={11} />} label={atts} sx={{ height: 22, fontSize: '0.66rem', fontWeight: 700 }} />
        </Tooltip>
      )}
      {emails > 0 && (
        <Tooltip title={`${emails} email${emails > 1 ? 's' : ''} sent`}>
          <Chip size="small" icon={<Mail size={11} />} label={emails} color="info" variant="outlined" sx={{ height: 22, fontSize: '0.66rem', fontWeight: 700 }} />
        </Tooltip>
      )}
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
    ? { label: `Sales Order Â· ${proc.soNumber || ''}`, to: `/orders/${encodeURIComponent(String(proc.salesOrderId?._id || proc.salesOrderId))}` }
    : (proc?.intakeId ? { label: 'Order Intake', to: `/order-intake?convert=${encodeURIComponent(String(proc.intakeId?._id || proc.intakeId))}` } : null);

  const Section = ({ title, children }) => (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ fontWeight: 800, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary', mb: 0.75 }}>{title}</Typography>
      {children}
    </Box>
  );

  const headTk = tokenOf(step?.status);
  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 440 }, p: 0, bgcolor: O2D.canvas } }}>
      {/* Header â€” flush editorial: status spine + chip + faded step code (no navy) */}
      <Box sx={{ position: 'relative', overflow: 'hidden', bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}` }}>
        <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, bgcolor: headTk.ring }} />
        <Box sx={{ pt: 1.5, pb: 1.25, pl: 2, pr: 6 }}>
          <Typography sx={{ position: 'absolute', right: 44, top: 8, fontSize: '1.9rem', fontWeight: 900, color: O2D.brand, lineHeight: 1, userSelect: 'none', letterSpacing: '-0.02em' }}>
            {meta.code}
          </Typography>
          <Chip size="small"
            icon={<Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: headTk.ring, ml: '6px' }} />}
            label={headTk.label}
            sx={{ fontWeight: 800, fontSize: '0.6rem', letterSpacing: '0.04em', textTransform: 'uppercase', color: headTk.color, bgcolor: headTk.bg, height: 20, '& .MuiChip-icon': { color: headTk.ring } }} />
          <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', lineHeight: 1.2, color: O2D.ink, mt: 0.5 }}>{meta.name}</Typography>
          <Typography sx={{ fontSize: '0.74rem', color: O2D.sub, mt: 0.25 }}>
            {proc?.soNumber || proc?.uniqueO2DId || 'â€”'}{proc?.partyName ? ` Â· ${proc.partyName}` : ''}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8, color: O2D.sub }}><X size={17} /></IconButton>
      </Box>

      <Box sx={{ p: 2, overflowY: 'auto', flexGrow: 1, bgcolor: O2D.surface }}>
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
                <Chip size="small" label={headTk.label}
                  sx={{ fontWeight: 800, fontSize: '0.66rem', color: headTk.color, bgcolor: headTk.bg }} />
                {humanDelay(step) !== 'â€”' && (
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
                      {l.doneByName ? <>Done by <b>{l.doneByName}</b>{l.doneAt ? ` Â· ${dt(l.doneAt)}` : ''}</> : 'Not completed yet'}
                    </LogLine>
                  </Box>
                ))}
              </Stack>
            </Section>

            {/* Emails sent (2.05 dispatch schedule / 2.08 invoice & eway) */}
            {(step?.emailLog || []).length > 0 && (
              <Section title="Emails Sent">
                <Stack spacing={1}>
                  {step.emailLog.map((em) => {
                    const failed = String(em.status || '').toUpperCase().startsWith('FAIL');
                    return (
                      <Box key={em._id} sx={{ p: 1, borderRadius: 1.5, border: `1px solid ${theme.palette.divider}` }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
                          <Mail size={14} color={failed ? theme.palette.error.main : theme.palette.success.main} />
                          <Chip size="small" label={failed ? 'Failed' : 'Sent'} color={failed ? 'error' : 'success'} sx={{ height: 18, fontSize: '0.62rem', fontWeight: 700 }} />
                          <Typography variant="caption" color="text.secondary">{dt(em.sentAt)}</Typography>
                        </Stack>
                        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>{em.subject || '(no subject)'}</Typography>
                        <LogLine icon={UserIcon}>Sent by <b>{em.sentByName || 'â€”'}</b></LogLine>
                        <LogLine>To: {em.to || 'â€”'}</LogLine>
                        {em.cc?.length > 0 && <LogLine>CC: {em.cc.join(', ')}</LogLine>}
                        {em.body && (
                          <Box sx={{ mt: 0.5, p: 0.75, borderRadius: 1, bgcolor: (t) => alpha(t.palette.primary.main, 0.04),
                            fontSize: '0.74rem', maxHeight: 140, overflowY: 'auto', whiteSpace: 'pre-wrap' }}
                            dangerouslySetInnerHTML={{ __html: em.body }} />
                        )}
                        {(em.attachments || []).length > 0 && (
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" rowGap={0.5} sx={{ mt: 0.5 }}>
                            {em.attachments.map((a, ai) => (
                              <Chip key={ai} size="small" icon={<Paperclip size={11} />} label={a.fileName || 'file'} sx={{ height: 20, fontSize: '0.64rem' }} />
                            ))}
                          </Stack>
                        )}
                        {failed && em.error && <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>{em.error}</Typography>}
                      </Box>
                    );
                  })}
                </Stack>
              </Section>
            )}

            {/* Form fields captured */}
            {(step?.formFields || []).length > 0 && (
              <Section title="Data Captured">
                <Stack spacing={0.75}>
                  {step.formFields.map((f) => (
                    <Box key={f._id}>
                      <Stack direction="row" justifyContent="space-between" spacing={1}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{f.label}</Typography>
                        <Typography variant="caption" sx={{ fontWeight: 700, textAlign: 'right' }}>
                          {f.value == null || f.value === '' ? 'â€”' : (f.fieldType === 'DATE' ? dd(f.value) : String(f.value))}
                        </Typography>
                      </Stack>
                      {f.filledByName && <LogLine icon={UserIcon}>{f.filledByName}{f.filledAt ? ` Â· ${dd(f.filledAt)}` : ''}</LogLine>}
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
                        {c.done && c.doneByName && <LogLine icon={UserIcon}>{c.doneByName}{c.doneAt ? ` Â· ${dd(c.doneAt)}` : ''}</LogLine>}
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
                        <Chip size="small" label={vv.answer || 'â€”'} color={vv.answer === 'YES' ? 'success' : vv.answer === 'NO' ? 'error' : 'default'} sx={{ height: 18, fontSize: '0.62rem' }} />
                        {vv.remark && <Typography variant="caption" color="text.secondary">{vv.remark}</Typography>}
                      </Stack>
                      {vv.answeredByName && <LogLine icon={UserIcon}>{vv.answeredByName}{vv.answeredAt ? ` Â· ${dd(vv.answeredAt)}` : ''}</LogLine>}
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
                      <LogLine icon={UserIcon}>{cm.userName || 'User'}{cm.at ? ` Â· ${dt(cm.at)}` : ''}</LogLine>
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
                      <Link href={resolveFileUrl(a.fileUrl)} target="_blank" rel="noreferrer" sx={{ fontWeight: 700 }}>{a.fileName}</Link>
                      {a.uploadedByName ? ` Â· ${a.uploadedByName}` : ''}
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
 * O2D Master Data â€” a per-step data view (one tab per O2D step) mirroring the
 * client's sheet tabs: every entry shown with its full columns (who/what/when),
 * its connected records (links), and a full audit log per step (Links & Log).
 * Switch between Table / Sheet / Cards / Board views. Read-only.
 */
const O2dMasterData = () => {
  const theme = useTheme();
  const [tab, setTab] = useState('so'); // 1.01 Order Received â€” first step first
  const [view, setView] = useState('table');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [logRow, setLogRow] = useState(null); // row whose Links & Log drawer is open
  // â”€â”€ GLOBAL filters â€” set once, apply to every step tab (do NOT reset on switch).
  const [partyFilter, setPartyFilter] = useState('');
  const [dateMode, setDateMode] = useState('all'); // all | month | day | custom
  const [monthVal, setMonthVal] = useState(dayjs().format('YYYY-MM'));
  const [dayVal, setDayVal] = useState(dayjs().format('YYYY-MM-DD'));
  const [fromVal, setFromVal] = useState('');
  const [toVal, setToVal] = useState('');

  // Party dropdown source â€” the full parties master (stable across tabs).
  const { data: partiesRes } = useGetPartiesQuery({ limit: 1000, sort: 'name' });
  const partyOptions = useMemo(() => (partiesRes?.data || []).map((p) => p.name).filter(Boolean), [partiesRes]);

  // Switching tabs keeps the global party/date filters â€” only the per-tab search/status reset.
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

  // The FMS process register â€” the audit ledger. Loaded always: it drives the
  // pure process tabs AND supplies the "Links & Log" for every entity tab.
  const procQ = useGetProcessesQuery({ limit: 1000, sort: '-createdAt' });
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

  // Payment/transport rows carry only dcNumber â†’ resolve to soNumber via challans.
  const needDcMap = ['paymentFollowup', 'paymentReceipt', 'transportReceipt', 'transportPayment'].includes(tab);
  const dcMapQ = useGetChallansQuery({ limit: 1000, sort: '-dcDate' }, { skip: !needDcMap });
  const dcToSo = useMemo(() => {
    const m = new Map();
    (dcMapQ?.data?.data || []).forEach((c) => { if (c.dcNumber) m.set(String(c.dcNumber), c.soNumber); });
    return m;
  }, [dcMapQ]);

  // Only the active entity tab fetches (skip the rest) â€” fast and cache-friendly.
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

  // Resolve any row â†’ its FMS process step (for the Links & Log layer).
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
    {
      field: '__links', headerName: 'Connected', flex: 1, minWidth: 150,
      sortable: false, filterable: false, disableColumnMenu: true,
      renderCell: (p) => <ConnectedCell {...stepForRow(p.row)} />,
    },
    {
      field: '__log', headerName: 'Log', width: 78, minWidth: 78,
      sortable: false, filterable: false, disableColumnMenu: true,
      renderCell: (p) => (
        <Button size="small" startIcon={<ScrollText size={14} />} onClick={() => setLogRow(p.row)} sx={{ fontWeight: 700, minWidth: 0 }}>Log</Button>
      ),
    },
  ], [columns, stepForRow]);

  const activeTab = TABS.find((t) => t.key === tab);
  const filterSummary = [
    partyFilter && `Party: ${partyFilter}`,
    dateMode === 'month' && monthVal && `Month: ${dayjs(`${monthVal}-01`).format('MMM YYYY')}`,
    dateMode === 'day' && dayVal && `Day: ${dayjs(dayVal).format('DD MMM YYYY')}`,
    dateMode === 'custom' && (fromVal || toVal) && `Range: ${fromVal ? dayjs(fromVal).format('DD MMM YYYY') : 'â€¦'} â†’ ${toVal ? dayjs(toVal).format('DD MMM YYYY') : 'â€¦'}`,
    statusFilter && `Status: ${statusFilter}`,
  ].filter(Boolean).join('  Â·  ') || 'All records';
  const exportBase = `O2D ${activeTab?.label || tab}${partyFilter ? ` - ${partyFilter}` : ''}`.replace(/[\\/:*?"<>|]/g, '-');
  const doExcel = () => exportRowsToExcel({ columns, rows, displayVal, sheetName: activeTab?.label || tab, fileName: `${exportBase}.xlsx` });
  const doPdf = () => printTablePdf({ title: activeTab?.label ? `O2D â€” ${activeTab.label}` : 'O2D Master Data', subtitle: filterSummary, columns, rows, displayVal });

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: O2D.canvas, overflowX: 'hidden', maxWidth: '100%' }}>
      {/* Flush warm top bar */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 5, bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}`, px: { xs: 1.5, md: 2 }, py: 1 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ width: 30, height: 30, borderRadius: '6px', display: 'grid', placeItems: 'center', bgcolor: alpha(O2D.brand, 0.1), color: O2D.brand }}>
            <Database size={16} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: O2D.ink, fontSize: { xs: '1rem', md: '1.1rem' }, fontWeight: 800, lineHeight: 1.2 }}>O2D Master Data</Typography>
            <Typography noWrap sx={{ color: O2D.sub, fontSize: '0.72rem' }}>
              Every step Â· who did what, when Â· connected records &amp; full audit log. One tab per O2D step.
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.25, md: 1.75 }, py: 1.5, pb: 6, minWidth: 0, overflowX: 'hidden' }}>
        {/* â”€â”€ GLOBAL filters (apply to every step tab) + export â”€â”€ */}
        <Paper elevation={0} sx={{ borderRadius: '8px', p: 1, mb: 1.25, border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
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
            {filterSummary} â€” applies to <strong>every step tab</strong>. Export reflects the current tab &amp; filters.
          </Typography>
        </Paper>

        <Paper elevation={0} sx={{ borderRadius: '8px', overflow: 'hidden', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
          {/* Step rail â€” the same card language as the O2D Step Board, so the
              steps read as STEPS, not thin text tabs: bold code, name beneath,
              blue card when active, light-blue lift on hover. */}
          <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', px: 1.25, py: 1, borderBottom: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt }}>
            {TABS.map((t) => {
              const meta = STEP_META[t.key] || {};
              const active = tab === t.key;
              return (
                <Tooltip key={t.key} arrow title={`${meta.code || ''} Â· ${meta.name || t.label}`}>
                  <Paper
                    elevation={0} role="tab" tabIndex={0} aria-selected={active}
                    onClick={() => switchTab(t.key)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(t.key); } }}
                    sx={{
                      px: 1.5, py: 0.75, minWidth: 132, flexShrink: 0, cursor: 'pointer', borderRadius: '8px',
                      border: `1.5px solid ${active ? O2D.brand : O2D.line}`,
                      bgcolor: active ? alpha(O2D.brand, 0.06) : O2D.surface,
                      transition: 'border-color .15s, background-color .15s, box-shadow .15s',
                      '&:hover': {
                        borderColor: O2D.brand,
                        bgcolor: alpha(O2D.brand, 0.05),
                        boxShadow: `0 2px 10px ${alpha(O2D.brand, 0.14)}`,
                        '& .mdStepCode, & .mdStepName': { color: O2D.brand },
                      },
                      '&:focus-visible': { outline: `2px solid ${O2D.brand}`, outlineOffset: 1 },
                    }}
                  >
                    <Typography className="mdStepCode" sx={{ fontSize: '0.8rem', fontWeight: 800, lineHeight: 1.2, color: active ? O2D.brand : O2D.ink, transition: 'color .15s' }}>
                      {meta.code || ''}
                    </Typography>
                    <Typography noWrap className="mdStepName" sx={{ fontSize: '0.68rem', fontWeight: active ? 700 : 500, color: active ? O2D.brand : O2D.sub, maxWidth: 150, transition: 'color .15s' }}>
                      {meta.name || t.label}
                    </Typography>
                  </Paper>
                </Tooltip>
              );
            })}
          </Box>

          {/* Compact toolbar: search Â· status Â· count Â· view */}
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1, flexWrap: 'wrap', borderBottom: `1px solid ${O2D.line}` }}>
            <TextField
              size="small" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Searchâ€¦"
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
            {/* Icon-only view switcher â€” compact */}
            <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
              {VIEWS.map((vw) => (
                <ToggleButton key={vw.key} value={vw.key} title={vw.label} sx={{ px: 1, py: 0.4 }}>
                  <vw.icon size={15} />
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>

          {/* â”€â”€ Table view (DataGrid) â”€â”€ */}
          {view === 'table' && (
            <Box sx={{ px: 1.5, pb: 1.5, width: '100%', minWidth: 0, overflowX: 'hidden' }}>
              <DataGrid
                rows={rows} columns={gridColumns} getRowId={(r) => r._id} loading={current?.isFetching}
                autoHeight density="compact"
                initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
                pageSizeOptions={[25, 50, 100]} disableRowSelectionOnClick
                onCellClick={(p) => { if (p.field !== '__links' && p.field !== '__log') setLogRow(p.row); }}
                sx={{ border: 0, cursor: 'pointer', maxWidth: '100%',
                  '& .MuiDataGrid-columnHeaders': { bgcolor: O2D.surfaceAlt, borderBottom: `1px solid ${O2D.line}` }, '& .MuiDataGrid-cell': { borderColor: O2D.lineSoft }, '& .MuiDataGrid-row:hover': { bgcolor: O2D.surfaceAlt } }}
              />
            </Box>
          )}

          {/* â”€â”€ Sheet view (dense spreadsheet) â”€â”€ */}
          {view === 'sheet' && (
            <Box sx={{ px: 1.5, pb: 1.5, overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 720, '& td, & th': { border: `1px solid ${O2D.lineSoft}`, fontSize: '0.78rem', px: 1, py: 0.6, whiteSpace: 'nowrap' }, '& tbody tr:hover': { bgcolor: O2D.surfaceAlt } }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: O2D.surfaceAlt, '& th': { fontWeight: 800, fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: O2D.sub } }}>
                    <TableCell sx={{ fontWeight: 800 }}>#</TableCell>
                    {columns.map((c) => <TableCell key={c.field} sx={{ fontWeight: 800 }}>{c.headerName}</TableCell>)}
                    <TableCell sx={{ fontWeight: 800 }}>Connected</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Log</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={row._id} hover sx={{ cursor: 'pointer' }} onClick={() => setLogRow(row)}>
                      <TableCell sx={{ color: 'text.disabled' }}>{i + 1}</TableCell>
                      {columns.map((c) => <TableCell key={c.field}>{displayVal(c, row)}</TableCell>)}
                      <TableCell sx={{ whiteSpace: 'normal' }} onClick={(e) => e.stopPropagation()}><ConnectedCell {...stepForRow(row)} /></TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button size="small" startIcon={<ScrollText size={13} />} onClick={() => setLogRow(row)}>Log</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {rows.length === 0 && <TableRow><TableCell colSpan={columns.length + 3} sx={{ textAlign: 'center', color: 'text.disabled', py: 3 }}>No records.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </Box>
          )}

          {/* â”€â”€ Cards view â”€â”€ */}
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
                  <ConnectedCell {...stepForRow(row)} />
                  <Button size="small" fullWidth startIcon={<ScrollText size={14} />} onClick={() => setLogRow(row)} sx={{ mt: 0.75, fontWeight: 700 }}>
                    Links &amp; Log
                  </Button>
                </Paper>
              ))}
              {rows.length === 0 && <Typography variant="body2" color="text.disabled" sx={{ p: 2 }}>No records.</Typography>}
            </Box>
          )}

          {/* â”€â”€ Board view (grouped by status) â”€â”€ */}
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

      {/* Links & Log drawer â€” the full "who did what, when, why" audit for a step. */}
      <StepLogDrawer open={!!logRow} onClose={() => setLogRow(null)} tab={tab} row={logRow} resolve={stepForRow} />
    </Box>
  );
};

export default O2dMasterData;
