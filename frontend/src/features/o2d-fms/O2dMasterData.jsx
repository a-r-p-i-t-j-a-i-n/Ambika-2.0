import React, { useState, useMemo, useCallback } from 'react';
import {
  Box, Paper, Stack, Typography, Button, Autocomplete,
  ToggleButtonGroup, ToggleButton, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, MenuItem, InputAdornment, Dialog, Divider, IconButton, Tooltip, Link, Menu, useMediaQuery,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Link as RouterLink } from 'react-router-dom';
import {
  Database, Table as TableIcon, Rows3, LayoutGrid, Columns3, Search, FileSpreadsheet,
  FileText, X, ExternalLink, ScrollText, CheckCircle2, Circle, Link2, Clock, User as UserIcon,
  Paperclip, Mail, Download, ChevronDown,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useGetOrderIntakesQuery } from '../../store/api/orderIntakeApi';
import { useGetOrdersQuery } from '../../store/api/orderApi';
import { useGetChallansQuery, useGetSchedulesQuery } from '../../store/api/dispatchControlApi';
import { useGetSalesInvoicesQuery } from '../../store/api/salesInvoiceApi';
import { useGetPaymentsQuery, useGetTransportBillsQuery } from '../../store/api/o2dFulfillmentApi';
import { useGetPartiesQuery } from '../../store/api/partyApi';
import { O2D, O2D_TIP } from './o2dTheme';
import { FLUENT, FLUENT_DEPTH, fluentTableSx, headerBtnSx } from '../ims/imsFluent';
import { useGetProcessesQuery } from '../../store/api/o2dFmsApi';
import { actionLinkMeta, resolveEntityLink, TRIGGER_TO_ACTION } from './actionLinks';
import { exportRowsToExcel, printTablePdf } from '../../utils/exportMasterData';
import { resolveFileUrl } from '../../utils/fileUrl';
import { useHiddenSteps, stepKey } from '../../utils/embed';
import { LoadErrorNote, CapNote, O2dPage, O2dStatusPill, TableSkeleton, CardGridSkeleton } from './components/O2dUi';
import { GRID_SKELETON_OVERLAY } from './components/gridSkeleton';
import { StepCard, stepTone, stepIcon, STEP_RAIL_SX, useStepRail } from './components/O2dStepCard';

const num = (n) => (Number(n || 0)).toLocaleString('en-IN');
const dt = (d) => (d ? dayjs(d).format('DD MMM YYYY · hh:mm A') : '—');
const dd = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
const col = (field, headerName, extra = {}) => ({ field, headerName, flex: 1, minWidth: 120, sortable: true, ...extra });

// ── Step catalog (ACTIVE fmsKey = CURRENT_SHEET) — every O2D step, in order.
// `code` ties a tab to its FMS step so each row can show that step's audit + links.
const STEP_META = {
  // Client flow: 1.01 IS the sales-order punch-in ("Order Received"); 2.02 is
  // the PO-vs-Tally check that follows it — a pure process step, no entity.
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

// Tabs that have NO dedicated entity collection — their data & audit live purely
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
  { key: 'so', label: 'Order Received · 1.01' },
  { key: 'poTally', label: 'PO Entry in Tally · 2.02' },
  { key: 'inventory', label: 'Check Inventory · 2.03' },
  { key: 'plan', label: 'Dispatch Scheduler & Planning · 2.04' },
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
// ── Colour coding — one meaning per colour, on every step tab and view ──────
// Status words become pills (green done · blue received / in progress · amber
// planning / pending · red cancelled / overdue · purple skipped / short closed);
// record numbers are blue, quantities indigo, what has moved green, what is
// still owed amber, dates teal, people purple. Checked in order: first match wins.
// Status values are shown with the shared O2D pill and the Step Board's words
// (DONE → "Completed", DELAYED → "Completed (late)", IN_PROGRESS → "In Progress").
// Only the WORDING and colour change — the stored value, the Status filter and
// the Board grouping all still use the raw value. First match wins.
const statusToneKey = (value) => {
  const u = String(value || '').toUpperCase();
  if (u === 'DELAYED') return 'amber';                                   // done, but late
  if (/CANCEL/.test(u)) return 'grey';
  if (/(REJECT|FAIL|OVERDUE|NOT_RECEIVED)/.test(u)) return 'rose';
  if (/(DONE|COMPLETE|DELIVER|PAID|CONFIRM|CONVERT|CLOSED|SENT|INVOICED)/.test(u)) return 'green';
  if (/(SKIP|SHORT)/.test(u)) return 'lavender';
  if (u === 'PENDING') return 'grey';
  if (/(PLAN|PENDING|PARTIAL|SCHEDUL|WAIT|HOLD|DRAFT)/.test(u)) return 'amber';
  if (/(RECEIV|PROGRESS|OPEN|NEW|DISPATCH|TRANSIT|ACTIVE)/.test(u)) return 'blue';
  return 'grey';
};
const statusLabel = (value) => {
  const u = String(value || '').toUpperCase();
  if (u === 'DONE') return 'Completed';
  if (u === 'DELAYED') return 'Completed (late)';
  return String(value || '').replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
};
const StatusPill = ({ value }) => <O2dStatusPill tone={statusToneKey(value)} label={statusLabel(value)} />;

// What each column means, by field name (shared across the step tabs).
const FIELD_TONES = {
  status: 'status', intakeStatus: 'status', followUpStatus: 'status', confirmation: 'status', receiptStatus: 'status', paymentStatus: 'status',
  soNumber: 'ref', order: 'ref', dcNumber: 'ref', invoiceNo: 'ref',
  poNumber: 'ref2',
  partyName: 'party',
  totalOrderQty: 'qty', totalPlanned: 'qty', invoiceAmount: 'qty', totalQuantityPcs: 'qty',
  totalDispatchedQty: 'good', amountReceived: 'good', receivedAmount: 'good',
  totalBalanceQty: 'balance', balance: 'balance',
  createdAt: 'date', orderDate: 'date', dcDate: 'date', invoiceDate: 'date', poDate: 'date', planned: 'date',
  doneOn: 'date', followedOn: 'date', receivedDate: 'date', receiptOn: 'date', paymentOn: 'date',
  delay: 'delay', followDelay: 'delay',
  doneBy: 'person', createdByName: 'person', contactName: 'person',
};
// IMS register text: dark ink for record numbers and parties, body text for
// the rest; colour only where it carries meaning (moved = green, still owed =
// amber, late = rose, zero = faint).
const NUM = { fontVariantNumeric: 'tabular-nums' };
const TONE_SX = {
  ref: { color: O2D.ink, fontWeight: 700, ...NUM },
  ref2: { color: O2D.sub, fontWeight: 500, ...NUM },
  party: { color: O2D.ink, fontWeight: 600 },
  qty: { color: O2D.body, fontWeight: 600, ...NUM },
  good: { color: FLUENT.green.accent, fontWeight: 700, ...NUM },
  date: { color: O2D.body, ...NUM },
  person: { color: O2D.body },
  owed: { color: FLUENT.amber.accent, fontWeight: 700, ...NUM },
  late: { color: FLUENT.rose.accent, fontWeight: 700 },
  zero: { color: O2D.faint, ...NUM },
  plain: { color: O2D.body },
};
// One line, cut with "…" when the column is narrow — the full value on hover.
const ONE_LINE = { display: 'block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

// A value that may be cut with "…" — the full value shows in the O2D tooltip,
// but only when it really is cut (measured on hover).
const OverflowTip = ({ text, sx }) => {
  const [cut, setCut] = useState(false);
  return (
    <Tooltip arrow placement="top-start" disableInteractive slotProps={O2D_TIP} title={cut ? String(text) : ''}>
      <Box component="span" onMouseEnter={(e) => setCut(e.currentTarget.scrollWidth > e.currentTarget.clientWidth + 1)} sx={{ ...ONE_LINE, ...sx }}>
        {text}
      </Box>
    </Tooltip>
  );
};

// SO number → the existing Sales Order page (the Step Board's SO link look).
const SO_FIELDS = ['soNumber', 'order'];
const SoLink = ({ so, to }) => (
  <Tooltip arrow title="Open this sales order" slotProps={O2D_TIP}>
    <Link component={RouterLink} to={to} underline="hover" data-testid="o2d-md-so-link" onClick={(e) => e.stopPropagation()}
      sx={{ color: FLUENT.blue.accent, fontWeight: 700, fontSize: 'inherit', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {so}
    </Link>
  </Tooltip>
);

// One value, coloured by what its column means. `soTo(row)` → the order page
// for SO-number columns (null when the order is not known → plain text).
const ToneCell = ({ c, row, soTo }) => {
  const text = displayVal(c, row);
  if (text === '—' || text === '') return <Box component="span" sx={{ color: O2D.faint }}>—</Box>;
  const tone = FIELD_TONES[c.field] || 'plain';
  if (tone === 'status') return <StatusPill value={text} />;
  if (SO_FIELDS.includes(c.field) && row.soNumber && soTo && String(text).startsWith(row.soNumber)) {
    const to = soTo(row);
    const rest = String(text).slice(String(row.soNumber).length);   // e.g. " / PO/2463" on 2.06
    if (to) {
      return (
        <Box component="span" sx={{ ...ONE_LINE, fontSize: 'inherit' }}>
          <SoLink so={row.soNumber} to={to} />
          {rest && <Box component="span" sx={{ color: O2D.sub, ...NUM }}>{rest}</Box>}
        </Box>
      );
    }
  }
  const raw = c.valueGetter ? c.valueGetter(undefined, row) : row[c.field];
  let sx = TONE_SX[tone] || TONE_SX.plain;
  if (tone === 'balance') sx = Number(raw) > 0 ? TONE_SX.owed : TONE_SX.good;
  else if ((tone === 'qty' || tone === 'good') && Number(raw) === 0) sx = TONE_SX.zero;
  else if (tone === 'delay') sx = /late/i.test(text) ? TONE_SX.late : (/on time/i.test(text) ? TONE_SX.good : TONE_SX.plain);
  return <OverflowTip text={text} sx={{ ...sx, fontSize: 'inherit' }} />;
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

// Row "Log" / "Links & Log" button — the board's 28px row-button look.
const LOG_BTN_SX = {
  height: 28, minWidth: 0, px: 1, borderRadius: '8px', textTransform: 'none', fontWeight: 700, fontSize: '0.72rem',
  color: FLUENT.blue.accent, borderColor: FLUENT.blue.border, bgcolor: FLUENT.blue.bg,
  '&:hover': { borderColor: FLUENT.blue.accent, bgcolor: FLUENT.blue.tint },
};
// A record card (Cards / Board views) — the IMS panel look.
const MD_CARD_SX = {
  p: 1.5, minWidth: 0, borderRadius: '10px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface, boxShadow: FLUENT_DEPTH.rest,
};
// Every filter control: 40px, 8px corners, 0.8rem text, label on the border.
const FILTER_BAR_SX = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1,
  '& .MuiInputBase-root': { minHeight: 40, borderRadius: '8px', fontSize: '0.8rem', bgcolor: '#fff' },
  '& .MuiInputLabel-root': { fontSize: '0.78rem' },
};
// Nothing to show — said the same way in every view.
const MdEmpty = ({ filtered }) => (
  <Stack alignItems="center" justifyContent="center" spacing={0.5} sx={{ py: 4, height: '100%' }}>
    <Database size={20} color={O2D.faint} />
    <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.body }}>No records on this step</Typography>
    {filtered && <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>Nothing matches the filters — clear them to see everything.</Typography>}
  </Stack>
);

// ── Small building blocks for the audit log ──
const LogLine = ({ icon: Icon, children }) => (
  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'text.secondary', fontSize: '0.72rem' }}>
    {Icon && <Icon size={12} />}<span>{children}</span>
  </Stack>
);

/** Connected records → ONE compact clickable link on a single line (extras collapse
 *  to "+N"), so a row with many connected records can't grow tall or overlap. The
 *  full list is always available in the row's "Log" detail. */
const LinkChips = ({ links }) => {
  if (!links?.length) return <Typography variant="caption" color="text.disabled">—</Typography>;
  const first = links[0];
  const extra = links.length - 1;
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'nowrap', minWidth: 0 }}>
      <Tooltip title={`${first.label}${first.doneByName ? ` · ${first.doneByName}${first.doneAt ? ` · ${dd(first.doneAt)}` : ''}` : (first.to ? ' · open record' : ' · not done yet')}`}>
        {first.to ? (
          <Link component={RouterLink} to={first.to}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, minWidth: 0, maxWidth: 170,
              fontSize: '0.72rem', fontWeight: 700, textDecoration: 'none',
              color: first.doneByName ? FLUENT.green.accent : FLUENT.blue.accent,
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
  if (!links.length && !atts && !emails) return <Typography variant="caption" color="text.disabled">—</Typography>;
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" data-testid="o2d-md-connected" sx={{ flexWrap: 'nowrap', overflow: 'hidden', maxWidth: '100%' }}>
      <LinkChips links={links} />
      {atts > 0 && (
        <Tooltip title={`${atts} attachment${atts > 1 ? 's' : ''}`}>
          <O2dStatusPill tone="grey" icon={Paperclip} label={atts} />
        </Tooltip>
      )}
      {emails > 0 && (
        <Tooltip title={`${emails} email${emails > 1 ? 's' : ''} sent`}>
          <O2dStatusPill tone="blue" icon={Mail} label={emails} />
        </Tooltip>
      )}
    </Stack>
  );
};

/**
 * Links & Log — the full "who did what, when, why" log for one step + its
 * links, in a centred dialog (the New Sales Order window's look): sticky header
 * with Close, a status bar, and a body that scrolls on its own. Full screen on
 * a phone. Closes on Close, Esc or a click outside; a record link closes it too.
 */
const StepLogDrawer = ({ open, onClose, tab, row, resolve, stepName }) => {
  const fullScreen = useMediaQuery('(max-width:599.95px)');
  const { step, proc } = (open && row) ? resolve(row) : { step: null, proc: null };
  const meta = STEP_META[tab] || {};
  const links = stepLinks(step, proc);
  const orderLink = proc?.salesOrderId
    ? { label: `Sales Order · ${proc.soNumber || ''}`, to: `/orders/${encodeURIComponent(String(proc.salesOrderId?._id || proc.salesOrderId))}` }
    : (proc?.intakeId ? { label: 'Order Intake', to: `/order-intake?convert=${encodeURIComponent(String(proc.intakeId?._id || proc.intakeId))}` } : null);

  // Each section = one rounded panel (as in the New Sales Order window).
  const Section = ({ title, children }) => (
    <Box sx={{ mb: 1.5, p: { xs: 1.5, sm: 2 }, borderRadius: '12px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
      <Typography sx={{ fontWeight: 800, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary', mb: 0.75 }}>{title}</Typography>
      {children}
    </Box>
  );

  const statusVal = step?.status || 'PENDING';
  const headTone = FLUENT[statusToneKey(statusVal)] || FLUENT.grey;
  const delayText = humanDelay(step);
  return (
    <Dialog
      open={open} onClose={onClose} fullScreen={fullScreen} maxWidth="md" fullWidth scroll="paper"
      aria-labelledby="o2d-md-log-title"
      PaperProps={{
        'data-testid': 'o2d-md-log',
        sx: {
          width: '100%', maxWidth: 760, maxHeight: fullScreen ? '100%' : '88vh', m: fullScreen ? 0 : 2, p: 0,
          borderRadius: fullScreen ? 0 : 3, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: O2D.canvas,
        },
      }}
    >
      {/* Header (stays put while the body scrolls): step icon · name · order, status, Close */}
      <Box sx={{
        flexShrink: 0, bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}`,
        px: { xs: 2, sm: 3 }, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <Box sx={{
            width: 38, height: 38, borderRadius: '12px', display: 'grid', placeItems: 'center', flexShrink: 0,
            background: `linear-gradient(135deg, ${FLUENT.blue.accent}, ${O2D.brand})`, color: '#fff',
          }}>
            {React.createElement(stepIcon(meta.code), { size: 18 })}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography id="o2d-md-log-title" sx={{ fontSize: '1rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.2 }}>
              {stepName || meta.name}
            </Typography>
            <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mt: 0.4 }}>
              <Typography sx={{ fontSize: '0.74rem', color: O2D.sub, fontVariantNumeric: 'tabular-nums' }}>
                <b style={{ color: O2D.brand }}>{meta.code}</b> · {proc?.soNumber || proc?.uniqueO2DId || '—'}{proc?.partyName ? ` · ${proc.partyName}` : ''}
              </Typography>
              <StatusPill value={statusVal} />
            </Stack>
          </Box>
        </Box>
        <IconButton aria-label="Close" onClick={onClose} sx={{ display: { xs: 'inline-flex', sm: 'none' }, color: O2D.sub, flexShrink: 0 }}>
          <X size={18} />
        </IconButton>
        <Button variant="outlined" onClick={onClose} startIcon={<X size={14} />} data-testid="o2d-md-log-close"
          sx={{ ...headerBtnSx, display: { xs: 'none', sm: 'inline-flex' }, flexShrink: 0 }}>
          Close
        </Button>
      </Box>
      {/* Status bar — the step's status colour (where the order window shows its progress). */}
      <Box sx={{ height: 3, flexShrink: 0, bgcolor: headTone.accent }} />

      {/* Body — scrolls on its own */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: { xs: 2, sm: 3 }, py: 2.5 }}>
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
                <StatusPill value={statusVal} />
                {delayText !== '—' && <O2dStatusPill tone={delayText === 'On time' ? 'green' : 'amber'} label={delayText} />}
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
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: '0.8rem', fontWeight: 700, color: FLUENT.blue.accent }}>
                    <Link2 size={14} /> {orderLink.label}
                  </Link>
                )}
                {links.length === 0 && <Typography variant="caption" color="text.disabled">No connected screens on this step.</Typography>}
                {links.map((l) => (
                  <Box key={l.key} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
                    {l.to ? (
                      <Link component={RouterLink} to={l.to} onClick={onClose}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: '0.8rem', fontWeight: 700, color: FLUENT.blue.accent }}>
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

            {/* Emails sent (2.05 dispatch schedule / 2.08 invoice & eway) */}
            {(step?.emailLog || []).length > 0 && (
              <Section title="Emails Sent">
                <Stack spacing={1}>
                  {step.emailLog.map((em) => {
                    const failed = String(em.status || '').toUpperCase().startsWith('FAIL');
                    return (
                      <Box key={em._id} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
                          <Mail size={14} color={failed ? FLUENT.rose.accent : FLUENT.green.accent} />
                          <O2dStatusPill tone={failed ? 'rose' : 'green'} label={failed ? 'Failed' : 'Sent'} />
                          <Typography variant="caption" color="text.secondary">{dt(em.sentAt)}</Typography>
                        </Stack>
                        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>{em.subject || '(no subject)'}</Typography>
                        <LogLine icon={UserIcon}>Sent by <b>{em.sentByName || '—'}</b></LogLine>
                        <LogLine>To: {em.to || '—'}</LogLine>
                        {em.cc?.length > 0 && <LogLine>CC: {em.cc.join(', ')}</LogLine>}
                        {em.body && (
                          <Box sx={{ mt: 0.5, p: 0.75, borderRadius: '6px', bgcolor: FLUENT.blue.bg,
                            fontSize: '0.74rem', maxHeight: 140, overflowY: 'auto', whiteSpace: 'pre-wrap' }}
                            dangerouslySetInnerHTML={{ __html: em.body }} />
                        )}
                        {(em.attachments || []).length > 0 && (
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" rowGap={0.5} sx={{ mt: 0.5 }}>
                            {em.attachments.map((a, ai) => (
                              <O2dStatusPill key={ai} tone="grey" icon={Paperclip} label={a.fileName || 'file'} />
                            ))}
                          </Stack>
                        )}
                        {failed && em.error && <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: FLUENT.rose.accent }}>{em.error}</Typography>}
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
                      {c.done ? <CheckCircle2 size={14} color={FLUENT.green.accent} style={{ marginTop: 2 }} /> : <Circle size={14} color={O2D.faint} style={{ marginTop: 2 }} />}
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
                        <O2dStatusPill tone={vv.answer === 'YES' ? 'green' : vv.answer === 'NO' ? 'rose' : 'grey'} label={vv.answer || '—'} />
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
                    <Box key={cm._id} sx={{ p: 1, borderRadius: '8px', bgcolor: FLUENT.blue.bg }}>
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
                      <Link href={resolveFileUrl(a.fileUrl)} target="_blank" rel="noreferrer" sx={{ fontWeight: 700 }}>{a.fileName}</Link>
                      {a.uploadedByName ? ` · ${a.uploadedByName}` : ''}
                    </LogLine>
                  ))}
                </Stack>
              </Section>
            )}
          </>
        )}
      </Box>
    </Dialog>
  );
};

/**
 * O2D Master Data — a per-step data view (one tab per O2D step) mirroring the
 * client's sheet tabs: every entry shown with its full columns (who/what/when),
 * its connected records (links), and a full audit log per step (Links & Log).
 * Switch between Table / Sheet / Cards / Board views. Read-only.
 */
const O2dMasterData = () => {
  // Steps the MD switched off for this employee in the Delegation Suite lose
  // their tab here too (none when Ambika 2.0 is used on its own).
  const hiddenSteps = useHiddenSteps('o2d');
  const visibleTabs = useMemo(
    () => (hiddenSteps.size ? TABS.filter((t) => !hiddenSteps.has(stepKey(STEP_META[t.key]?.code))) : TABS),
    [hiddenSteps],
  );
  const [pickedTab, setTab] = useState('so'); // 1.01 Order Received — first step first
  const [pager, setPager] = useState({ page: 0, pageSize: 25 });   // table-view paging
  const tab = visibleTabs.some((t) => t.key === pickedTab) ? pickedTab : (visibleTabs[0]?.key || 'so');
  const [view, setView] = useState('table');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [logRow, setLogRow] = useState(null); // row whose Links & Log drawer is open
  // ── GLOBAL filters — set once, apply to every step tab (do NOT reset on switch).
  const [soFilter, setSoFilter] = useState('');
  const [partyFilter, setPartyFilter] = useState('');
  const [exportAnchor, setExportAnchor] = useState(null); // Export → Excel / PDF menu
  const [dateMode, setDateMode] = useState('all'); // all | month | day | custom
  const [monthVal, setMonthVal] = useState(dayjs().format('YYYY-MM'));
  const [dayVal, setDayVal] = useState(dayjs().format('YYYY-MM-DD'));
  const [fromVal, setFromVal] = useState('');
  const [toVal, setToVal] = useState('');

  // Party dropdown source — the full parties master (stable across tabs).
  const { data: partiesRes } = useGetPartiesQuery({ limit: 1000, sort: 'name' });
  const partyOptions = useMemo(() => (partiesRes?.data || []).map((p) => p.name).filter(Boolean), [partiesRes]);

  // Switching tabs keeps the global party/date filters — only the per-tab search/status reset.
  const switchTab = (t) => { setTab(t); setSearch(''); setStatusFilter(''); setPager((pg) => ({ ...pg, page: 0 })); };
  const clearGlobal = () => { setSoFilter(''); setPartyFilter(''); setDateMode('all'); setFromVal(''); setToVal(''); };

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
  // SO Number dropdown — every order, newest first (as loaded).
  const soOptions = useMemo(() => [...new Set(processes.map((p) => p.soNumber).filter(Boolean))], [processes]);

  // Payment/transport rows carry only dcNumber → resolve to soNumber via challans.
  // (Same request as the 2.06 tab's own list — loaded once, shared from the cache.)
  const dcMapQ = useGetChallansQuery({ limit: 1000, sort: '-dcDate' });
  const dcToSo = useMemo(() => {
    const m = new Map();
    (dcMapQ?.data?.data || []).forEach((c) => { if (c.dcNumber) m.set(String(c.dcNumber), c.soNumber); });
    return m;
  }, [dcMapQ]);

  // Every step tab's records load up front — the SAME read-only lists each tab
  // already loaded on opening (RTK caches them) — so each step card can show its
  // real record count, not only the open tab's.
  const intakeQ = useGetOrderIntakesQuery({ limit: 500, sort: '-createdAt' }, { skip: tab !== 'intake' });
  const soQ = useGetOrdersQuery({ limit: 1000, sort: '-orderDate' });
  const planQ = useGetSchedulesQuery({ limit: 1000, sort: '-updatedAt' });
  const dcQ = useGetChallansQuery({ limit: 1000, sort: '-dcDate' });
  const invQ = useGetSalesInvoicesQuery({ limit: 1000, sort: '-invoiceDate' });
  const payQ = useGetPaymentsQuery(undefined);
  const tbQ = useGetTransportBillsQuery(undefined);

  const queryOf = (key) => (PROC_TABS.includes(key) ? procQ : {
    intake: intakeQ, so: soQ, plan: planQ, dispatch: dcQ, invoice: invQ,
    paymentFollowup: payQ, paymentReceipt: payQ,
    transportReceipt: tbQ, transportPayment: tbQ,
  }[key]);
  const current = queryOf(tab);
  const columns = COLUMNS[tab];

  // Rows for the pure process-step tabs: one row per order that has this step.
  const procRowsOf = useMemo(() => {
    const out = {};
    PROC_TABS.forEach((key) => {
      const code = STEP_META[key].code;
      out[key] = processes.map((p) => {
        const step = (p.steps || []).find((s) => s.stepCode === code);
        if (!step) return null;
        return {
          _id: `${p._id}_${code}`, processId: p._id,
          soNumber: p.soNumber, poNumber: p.poNumber, partyName: p.partyName, uniqueO2DId: p.uniqueO2DId,
          __step: step, __proc: p,
        };
      }).filter(Boolean);
    });
    return out;
  }, [processes]);
  const rawOf = (key) => (PROC_TABS.includes(key) ? procRowsOf[key] : (queryOf(key)?.data?.data || []));

  const rawRows = useMemo(() => rawOf(tab),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, procRowsOf, current?.data]);

  // Step display names = this page's own catalog (STEP_META) — used on the
  // cards, tooltips, the table header band and Links & Log.
  const nameOf = (key) => STEP_META[key]?.name || key;

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

  // Distinct statuses present (for the status filter dropdown).
  const statuses = useMemo(() => [...new Set(rawRows.map((r) => statusOf(tab, r)).filter(Boolean))], [rawRows, tab]);

  // The GLOBAL filters (SO + party + date) — the ones every step tab shares.
  const applyGlobal = (key, input) => {
    let list = input;
    if (soFilter) {
      // A row's order: its own SO, else via its challan (payment / transport
      // rows), else via its process (order intake).
      const soOfRow = (r) => r.soNumber
        || (r.dcNumber && dcToSo.get(String(r.dcNumber)))
        || (key === 'intake' ? procByIntake.get(String(r._id))?.soNumber : undefined);
      list = list.filter((r) => soOfRow(r) === soFilter);
    }
    if (partyFilter) list = list.filter((r) => { const p = partyOf(key, r); return p === undefined || p === partyFilter; });
    if (dateMode !== 'all') list = list.filter((r) => inDateRange(dateOf(key, r)));
    return list;
  };

  // Apply GLOBAL SO + party + date, then per-tab status + free-text search.
  const rows = useMemo(() => {
    let list = applyGlobal(tab, rawRows);
    if (statusFilter) list = list.filter((r) => statusOf(tab, r) === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => columns.some((c) => String(displayVal(c, r)).toLowerCase().includes(q)));
    return [...list].sort((a, b) => new Date(dateOf(tab, b) || 0) - new Date(dateOf(tab, a) || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawRows, statusFilter, search, tab, columns, soFilter, dcToSo, procByIntake, partyFilter, dateMode, monthVal, dayVal, fromVal, toVal]);

  // A row's SO → the existing Sales Order page (same path as the Step Board's
  // SO link): the order itself on 1.01, else the order its FMS process links.
  const soTo = useCallback((row) => {
    const so = row?.soNumber;
    if (!so) return null;
    const proc = row.__proc || procBySo.get(String(so));
    const orderId = tab === 'so' ? row._id : (proc?.salesOrderId?._id || proc?.salesOrderId);
    return orderId ? (resolveEntityLink('ORDER_ENTRY', { orderId })?.to || null) : null;
  }, [tab, procBySo]);

  // Grid columns — Connected + Log first (where the Step Board keeps its Action
  // column, so they are always on screen), then the tab's columns. Exports use
  // the tab's own `columns`, so they are unchanged.
  const gridColumns = useMemo(() => [
    {
      field: '__links', headerName: 'Connected', width: 210, minWidth: 170,
      sortable: false, filterable: false, disableColumnMenu: true,
      renderCell: (p) => <ConnectedCell {...stepForRow(p.row)} />,
    },
    {
      field: '__log', headerName: 'Log', width: 84, minWidth: 84,
      sortable: false, filterable: false, disableColumnMenu: true,
      renderCell: (p) => (
        <Button size="small" variant="outlined" startIcon={<ScrollText size={13} />} onClick={() => setLogRow(p.row)} sx={LOG_BTN_SX}>Log</Button>
      ),
    },
    ...columns.map((c) => ({
      ...c,
      // +12px: the Step Board's 16px cell padding (the grid default is 10px).
      minWidth: (c.minWidth || 120) + 12,
      // Room for the longest status pill ("Completed (late)"), party names and "SO / PO".
      ...(FIELD_TONES[c.field] === 'status' && { minWidth: Math.max(c.minWidth || 0, 150) + 12 }),
      ...(c.field === 'partyName' && { minWidth: Math.max(c.minWidth || 0, 200) }),
      ...(c.field === 'soNumber' && /\//.test(c.headerName) && { minWidth: 190 }),
      renderCell: (p) => <ToneCell c={c} row={p.row} soTo={soTo} />,
    })),
  ], [columns, stepForRow, soTo]);

  // Grid height: fitted to its rows, and on a desktop capped to the viewport so
  // the header and the horizontal scrollbar stay on screen (the Step Board's
  // scroll-inside-the-panel behaviour). On a phone the page scrolls instead.
  const desk = useMediaQuery('(min-width:900px)');
  const lastPage = Math.max(0, Math.ceil(rows.length / pager.pageSize) - 1);
  const pageModel = { page: Math.min(pager.page, lastPage), pageSize: pager.pageSize };
  const onPage = Math.max(0, Math.min(pager.pageSize, rows.length - pageModel.page * pager.pageSize));
  const gridContentH = 43 + (onPage ? onPage * 44 : 150) + 52 + 16;
  const gridHeight = desk ? `min(${gridContentH}px, max(360px, calc(100vh - 370px)))` : `${gridContentH}px`;

  const activeTab = TABS.find((t) => t.key === tab);
  const filterSummary = [
    soFilter && `SO: ${soFilter}`,
    partyFilter && `Party: ${partyFilter}`,
    dateMode === 'month' && monthVal && `Month: ${dayjs(`${monthVal}-01`).format('MMM YYYY')}`,
    dateMode === 'day' && dayVal && `Day: ${dayjs(dayVal).format('DD MMM YYYY')}`,
    dateMode === 'custom' && (fromVal || toVal) && `Range: ${fromVal ? dayjs(fromVal).format('DD MMM YYYY') : '…'} → ${toVal ? dayjs(toVal).format('DD MMM YYYY') : '…'}`,
    statusFilter && `Status: ${statusFilter}`,
  ].filter(Boolean).join('  ·  ') || 'All records';
  const exportBase = `O2D ${activeTab?.label || tab}${soFilter ? ` - ${soFilter}` : ''}${partyFilter ? ` - ${partyFilter}` : ''}`.replace(/[\\/:*?"<>|]/g, '-');
  const doExcel = () => exportRowsToExcel({ columns, rows, displayVal, sheetName: activeTab?.label || tab, fileName: `${exportBase}.xlsx` });
  const doPdf = () => printTablePdf({ title: activeTab?.label ? `O2D — ${activeTab.label}` : 'O2D Master Data', subtitle: filterSummary, columns, rows, displayVal });

  const anyGlobal = Boolean(soFilter || partyFilter || dateMode !== 'all');
  // The open tab's records are still on their way (no data yet for this tab).
  const tabLoading = Boolean(current?.isLoading || (current?.isFetching && !current?.data));
  const anyFilter = Boolean(anyGlobal || statusFilter || search);
  const activeMeta = STEP_META[tab] || {};
  const { railRef, tipProps } = useStepRail(tab, visibleTabs.length);

  // Step card figures: the records each tab lists under the shared SO / party /
  // date filters (exactly what opening that tab shows); the open tab also
  // counts its own search + status, so its card always equals its table.
  const tabCounts = {};
  visibleTabs.forEach((t) => {
    const q = queryOf(t.key);
    if (q?.isLoading) tabCounts[t.key] = { loading: true };
    else if (q?.isError && !q?.data) tabCounts[t.key] = { error: true };
    else tabCounts[t.key] = { n: t.key === tab ? rows.length : applyGlobal(t.key, rawOf(t.key)).length };
  });

  return (
    <O2dPage icon={Database} title="O2D Master Data"
      subtitle="Every step · who did what, when · connected records & full audit log. One tab per O2D step."
      actions={visibleTabs.length > 0 && (
        // Export (the current tab, as filtered) + the view switch — compact, top right.
        <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
          <Button
            size="small" variant="outlined" startIcon={<Download size={14} />} endIcon={<ChevronDown size={14} />}
            onClick={(e) => setExportAnchor(e.currentTarget)} data-testid="o2d-md-export" sx={headerBtnSx}
          >
            Export
          </Button>
          <Menu anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
            <MenuItem onClick={() => { setExportAnchor(null); doExcel(); }} sx={{ gap: 1.25, fontSize: '0.82rem' }}>
              <FileSpreadsheet size={16} color={FLUENT.green.accent} /> Excel (.xlsx)
            </MenuItem>
            <MenuItem onClick={() => { setExportAnchor(null); doPdf(); }} sx={{ gap: 1.25, fontSize: '0.82rem' }}>
              <FileText size={16} color={FLUENT.rose.accent} /> PDF
            </MenuItem>
          </Menu>
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)} aria-label="View"
            sx={{
              height: 32, bgcolor: '#fff', borderRadius: '8px',
              '& .MuiToggleButton-root': { px: 1, border: `1px solid ${FLUENT.grey.border}`, color: O2D.sub },
              '& .MuiToggleButton-root.Mui-selected': { color: FLUENT.blue.accent, bgcolor: FLUENT.blue.bg },
              '& .MuiToggleButton-root:first-of-type': { borderRadius: '8px 0 0 8px' },
              '& .MuiToggleButton-root:last-of-type': { borderRadius: '0 8px 8px 0' },
            }}>
            {VIEWS.map((vw) => (
              <ToggleButton key={vw.key} value={vw.key} title={vw.label} aria-label={vw.label}>
                <vw.icon size={15} />
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>
      )}>
      <Box sx={{ minWidth: 0, overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {visibleTabs.length === 0 ? (
          <Paper elevation={0} sx={{ borderRadius: '10px', p: 4, textAlign: 'center', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
            <Typography sx={{ fontWeight: 800, color: O2D.ink }}>No O2D steps are switched on for you</Typography>
            <Typography sx={{ fontSize: '0.8rem', color: O2D.sub, mt: 0.5 }}>
              Ask your MD to switch them on in Delegation → Employees → lock icon → Ambika 2.0 ERP.
            </Typography>
          </Paper>
        ) : (<>
        {/* ── Filters: search · SO · party · date · status, then the count.
            SO, party and date apply to every step tab (kept when you switch);
            search and status are per tab. ── */}
        <Paper elevation={0} data-testid="o2d-md-filters" sx={{ borderRadius: '10px', p: 1, border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
          <Box sx={FILTER_BAR_SX}>
            <TextField
              size="small" label="Search" placeholder="Any value in this tab…" value={search} onChange={(e) => setSearch(e.target.value)}
              InputLabelProps={{ shrink: true }} sx={{ flex: '1 1 170px', minWidth: 0 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment> }}
            />
            <Autocomplete
              size="small" options={soOptions} value={soFilter || null}
              onChange={(_, v) => setSoFilter(v || '')}
              sx={{ flex: '1 1 160px', minWidth: 0 }}
              renderInput={(pr) => <TextField {...pr} label="SO Number" placeholder="All orders" InputLabelProps={{ ...pr.InputLabelProps, shrink: true }} />}
            />
            <Autocomplete
              size="small" options={partyOptions} value={partyFilter || null}
              onChange={(_, v) => setPartyFilter(v || '')}
              sx={{ flex: '1 1 190px', minWidth: 0 }}
              renderInput={(pr) => <TextField {...pr} label="Party" placeholder="All parties" InputLabelProps={{ ...pr.InputLabelProps, shrink: true }} />}
            />
            <TextField select size="small" label="Date" value={dateMode} onChange={(e) => setDateMode(e.target.value)}
              InputLabelProps={{ shrink: true }} sx={{ flex: '0 1 140px', minWidth: 120 }}>
              <MenuItem value="all">All dates</MenuItem>
              <MenuItem value="month">By month</MenuItem>
              <MenuItem value="day">By day</MenuItem>
              <MenuItem value="custom">Custom range</MenuItem>
            </TextField>
            {dateMode === 'month' && (
              <TextField size="small" type="month" label="Month" InputLabelProps={{ shrink: true }} value={monthVal} onChange={(e) => setMonthVal(e.target.value)} sx={{ flex: '0 1 150px', minWidth: 130 }} />
            )}
            {dateMode === 'day' && (
              <TextField size="small" type="date" label="Day" InputLabelProps={{ shrink: true }} value={dayVal} onChange={(e) => setDayVal(e.target.value)} sx={{ flex: '0 1 150px', minWidth: 130 }} />
            )}
            {dateMode === 'custom' && (
              <>
                <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={fromVal} onChange={(e) => setFromVal(e.target.value)} sx={{ flex: '0 1 150px', minWidth: 130 }} />
                <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={toVal} onChange={(e) => setToVal(e.target.value)} sx={{ flex: '0 1 150px', minWidth: 130 }} />
              </>
            )}
            <TextField
              select size="small" label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              InputLabelProps={{ shrink: true }} sx={{ flex: '0 1 160px', minWidth: 130 }}
              SelectProps={{ displayEmpty: true, renderValue: (v) => (v ? statusLabel(v) : 'All statuses') }}
            >
              <MenuItem value="">All statuses</MenuItem>
              {statuses.map((st) => <MenuItem key={st} value={st}><StatusPill value={st} /></MenuItem>)}
            </TextField>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flex: '0 0 auto' }}>
              <Tooltip title={filterSummary}>
                <span data-testid="o2d-md-count">
                  <O2dStatusPill tone="blue"
                    label={`${rows.length}${rows.length !== rawRows.length ? ` / ${rawRows.length}` : ''} record${rows.length === 1 ? '' : 's'}`}
                    sx={{ fontVariantNumeric: 'tabular-nums' }} />
                </span>
              </Tooltip>
              {anyFilter && (
                <Button size="small" startIcon={<X size={14} />} onClick={() => { clearGlobal(); setStatusFilter(''); setSearch(''); }}
                  sx={{ height: 32, fontWeight: 700, minWidth: 0, textTransform: 'none', borderRadius: '8px', color: O2D.sub }}>
                  Clear
                </Button>
              )}
            </Stack>
          </Box>
        </Paper>

        {/* ── Step cards — the Step Board's cards (same size, icon, colour);
            the figure is the records that tab lists. Click = open that tab. ── */}
        <Box ref={railRef} data-testid="o2d-md-rail" role="group" aria-label="O2D steps" sx={STEP_RAIL_SX}>
          {visibleTabs.map((t, idx) => {
            const meta = STEP_META[t.key] || {};
            const c = tabCounts[t.key] || {};
            const name = nameOf(t.key);
            const active = tab === t.key;
            return (
              <Tooltip
                key={t.key} arrow placement="top" disableInteractive enterDelay={250} slotProps={tipProps}
                title={(
                  <Box>
                    <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: O2D.brand }}>{meta.code} · {name}</Typography>
                    <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, mt: 0.25 }}>
                      {c.loading ? 'Loading…' : c.error ? 'Could not load these records'
                        : `${c.n} record${c.n === 1 ? '' : 's'}${anyGlobal || (active && (statusFilter || search)) ? ' matching the filters' : ''}`}
                    </Typography>
                  </Box>
                )}
              >
                <StepCard
                  data-step={meta.code} data-active={active ? 'true' : undefined}
                  testId={`o2d-md-card-${t.key}`} code={meta.code} name={name} unit="records" labelLines={3}
                  // Step number as the figure; the record count in the red O2D alert badge.
                  badge={c.loading ? '…' : c.error ? '—' : c.n}
                  tone={stepTone(idx)} icon={stepIcon(meta.code)} active={active}
                  onClick={() => switchTab(t.key)}
                />
              </Tooltip>
            );
          })}
        </Box>

        <Paper elevation={0} data-testid="o2d-md-register" sx={{ borderRadius: '10px', overflow: 'hidden', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
          {/* The open step's band — the register's header (as on the Step Board). */}
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap data-testid="o2d-md-band"
            sx={{ px: { xs: 1.25, md: 1.75 }, py: 1.1, bgcolor: FLUENT.blue.bg, borderBottom: `1px solid ${FLUENT.blue.border}` }}>
            <Box sx={{ width: 30, height: 30, borderRadius: '8px', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: '#fff', color: FLUENT.blue.accent, border: `1px solid ${FLUENT.blue.border}` }}>
              {React.createElement(stepIcon(activeMeta.code), { size: 15 })}
            </Box>
            <Typography component="h2" sx={{ fontSize: '0.92rem', fontWeight: 800, color: FLUENT.blue.ink, minWidth: 0 }}>
              {activeMeta.code} · {nameOf(tab)}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, ml: 'auto', display: { xs: 'none', sm: 'block' } }}>
              Click a row for its links &amp; full log
            </Typography>
          </Stack>

          {/* A failed load is said as one, never shown as "No records"; and a tab
              whose query reached its 1,000-record limit says so. */}
          {current?.isError && (
            <LoadErrorNote title="Could not load these records" error={current.error} onRetry={current.refetch}
              compact={!!current.data} sx={{ mx: 1.5, mt: 1.25 }} />
          )}
          {(isProcTab || ['so', 'plan', 'dispatch', 'invoice'].includes(tab)) && (
            <CapNote shown={(current?.data?.data || []).length} cap={1000} noun="records" sx={{ mx: 1.5, mt: 1.25 }} />
          )}

          {/* ── Table view (DataGrid) ── */}
          {view === 'table' && (
            <Box data-testid="o2d-md-grid" sx={{ width: '100%', minWidth: 0, height: gridHeight }}>
              <DataGrid
                rows={rows} columns={gridColumns} getRowId={(r) => r._id} loading={current?.isFetching}
                rowHeight={44} columnHeaderHeight={43}
                paginationModel={pageModel} onPaginationModelChange={setPager}
                pageSizeOptions={[25, 50, 100]} disableRowSelectionOnClick
                slots={{ noRowsOverlay: MdEmpty }} slotProps={{ noRowsOverlay: { filtered: anyFilter }, loadingOverlay: GRID_SKELETON_OVERLAY }}
                onCellClick={(p) => { if (p.field !== '__links' && p.field !== '__log') setLogRow(p.row); }}
                sx={{
                  // The Step Board's Fluent table (fluentTableSx values) on the grid.
                  border: 0, borderRadius: 0, cursor: 'pointer', maxWidth: '100%', fontSize: '0.8rem',
                  '--DataGrid-overlayHeight': '150px', '--DataGrid-rowBorderColor': '#edf0f5', '--DataGrid-containerBackground': '#f2f6fc',
                  '& .MuiDataGrid-columnHeader': { px: 2, bgcolor: '#f2f6fc' },
                  // Header row: the Step Board's header rule colour.
                  '& .MuiDataGrid-columnHeaders': { '--DataGrid-rowBorderColor': '#dfe7f2' },
                  // Resize handles stay, but only show on hover — no grid lines in the header.
                  '& .MuiDataGrid-columnSeparator': { opacity: 0 },
                  '& .MuiDataGrid-columnHeader:hover .MuiDataGrid-columnSeparator': { opacity: 1 },
                  '& .MuiDataGrid-cell': { px: 2, borderColor: '#edf0f5', color: O2D.body, display: 'flex', alignItems: 'center' },
                  '& .MuiDataGrid-cell--textRight': { justifyContent: 'flex-end' },
                  '& .MuiDataGrid-row:hover': { bgcolor: '#f1f6fe' },
                  '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within, & .MuiDataGrid-columnHeader:focus, & .MuiDataGrid-columnHeader:focus-within': { outline: 'none' },
                  '& .MuiDataGrid-footerContainer': { borderTop: '1px solid #edf0f5', minHeight: 52, bgcolor: O2D.surface },
                  '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows, & .MuiTablePagination-select': { fontSize: '0.74rem', color: O2D.sub },
                }}
              />
            </Box>
          )}

          {/* While the open tab's records load (first time), the non-grid views show
              a skeleton in their own shape — never another tab's records. */}
          {tabLoading && (view === 'sheet' ? <TableSkeleton rows={8} columns={7} /> : (view === 'cards' || view === 'board') ? <CardGridSkeleton /> : null)}

          {/* ── Sheet view (dense spreadsheet) ── */}
          {view === 'sheet' && !tabLoading && (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ ...fluentTableSx(720, { zebra: false }), '& tbody td': { fontSize: '0.78rem', color: O2D.body, whiteSpace: 'nowrap', maxWidth: 260 } }}>
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Connected</TableCell>
                    <TableCell>Log</TableCell>
                    {columns.map((c) => <TableCell key={c.field} align={c.type === 'number' ? 'right' : 'left'}>{c.headerName}</TableCell>)}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={row._id} hover sx={{ cursor: 'pointer' }} onClick={() => setLogRow(row)}>
                      <TableCell sx={{ color: `${O2D.faint} !important`, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</TableCell>
                      <TableCell sx={{ whiteSpace: 'normal', maxWidth: 220 }} onClick={(e) => e.stopPropagation()}><ConnectedCell {...stepForRow(row)} /></TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Button size="small" variant="outlined" startIcon={<ScrollText size={13} />} onClick={() => setLogRow(row)} sx={LOG_BTN_SX}>Log</Button>
                      </TableCell>
                      {columns.map((c) => <TableCell key={c.field} align={c.type === 'number' ? 'right' : 'left'}><ToneCell c={c} row={row} soTo={soTo} /></TableCell>)}
                    </TableRow>
                  ))}
                  {rows.length === 0 && <TableRow><TableCell colSpan={columns.length + 3}><MdEmpty filtered={anyFilter} /></TableCell></TableRow>}
                </TableBody>
              </Table>
            </Box>
          )}

          {/* ── Cards view ── */}
          {view === 'cards' && !tabLoading && (
            <Box sx={{ p: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 1.25 }}>
              {rows.map((row) => (
                <Paper key={row._id} elevation={0} sx={MD_CARD_SX}>
                  <Typography noWrap title={String(displayVal(columns[0], row))} sx={{ fontWeight: 800, fontSize: '0.86rem', color: O2D.ink, mb: 0.75 }}>
                    {displayVal(columns[0], row)}
                  </Typography>
                  <Stack spacing={0.5}>
                    {columns.slice(1).map((c) => (
                      <Stack key={c.field} direction="row" justifyContent="space-between" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, flexShrink: 0 }}>{c.headerName}</Typography>
                        <Box sx={{ fontSize: '0.78rem', minWidth: 0, textAlign: 'right' }}><ToneCell c={c} row={row} soTo={soTo} /></Box>
                      </Stack>
                    ))}
                  </Stack>
                  <Divider sx={{ my: 1, borderColor: O2D.lineSoft }} />
                  <ConnectedCell {...stepForRow(row)} />
                  <Button size="small" variant="outlined" fullWidth startIcon={<ScrollText size={14} />} onClick={() => setLogRow(row)} sx={{ ...LOG_BTN_SX, mt: 1 }}>
                    Links &amp; Log
                  </Button>
                </Paper>
              ))}
              {rows.length === 0 && <Box sx={{ gridColumn: '1 / -1' }}><MdEmpty filtered={anyFilter} /></Box>}
            </Box>
          )}

          {/* ── Board view (grouped by status) ── */}
          {view === 'board' && !tabLoading && (
            <Box sx={{ p: 1.5, display: 'flex', gap: 1.25, overflowX: 'auto', alignItems: 'flex-start' }}>
              {(() => {
                const groups = {};
                rows.forEach((r) => { const st = statusOf(tab, r); (groups[st] = groups[st] || []).push(r); });
                const keys = Object.keys(groups);
                if (!keys.length) return <Box sx={{ flex: 1 }}><MdEmpty filtered={anyFilter} /></Box>;
                return keys.map((st) => (
                  <Box key={st} sx={{ flex: '0 0 270px', minWidth: 0, p: 1, borderRadius: '10px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.lineSoft}` }}>
                    <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 1, px: 0.25 }}>
                      <StatusPill value={st} />
                      <O2dStatusPill tone="grey" label={groups[st].length} sx={{ fontVariantNumeric: 'tabular-nums' }} />
                    </Stack>
                    <Stack spacing={0.75}>
                      {groups[st].map((row) => (
                        <Paper key={row._id} elevation={0} onClick={() => setLogRow(row)}
                          sx={{ ...MD_CARD_SX, p: 1.25, cursor: 'pointer', '&:hover': { borderColor: FLUENT.blue.border, boxShadow: FLUENT_DEPTH.hover } }}>
                          <Typography noWrap title={String(displayVal(columns[0], row))} sx={{ fontWeight: 800, fontSize: '0.8rem', color: O2D.ink, mb: 0.25 }}>
                            {displayVal(columns[0], row)}
                          </Typography>
                          {columns.slice(1, 4).map((c) => (
                            <Stack key={c.field} direction="row" justifyContent="space-between" spacing={1} sx={{ minWidth: 0 }}>
                              <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, flexShrink: 0 }}>{c.headerName}</Typography>
                              <Box sx={{ fontSize: '0.72rem', minWidth: 0, textAlign: 'right' }}><ToneCell c={c} row={row} soTo={soTo} /></Box>
                            </Stack>
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
        </>)}
      </Box>

      {/* Links & Log dialog — the full "who did what, when, why" audit for a step. */}
      <StepLogDrawer open={!!logRow} onClose={() => setLogRow(null)} tab={tab} row={logRow} resolve={stepForRow} stepName={nameOf(tab)} />
    </O2dPage>
  );
};

export default O2dMasterData;
