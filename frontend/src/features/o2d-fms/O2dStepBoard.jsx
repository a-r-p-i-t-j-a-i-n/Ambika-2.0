import React, { useMemo, useState, useEffect } from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, TextField, Skeleton, InputAdornment, TablePagination, alpha, Collapse,
  Button, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions,
  Autocomplete, Checkbox,
} from '@mui/material';
import {
  Search, Workflow, CheckCircle2, Clock, AlertTriangle, CircleDashed,
  Plus, Trash2, ArrowRight, ClipboardList, ExternalLink, User, CalendarClock, Pencil, Layers, Mail,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import { useGetProcessesQuery, useGetBoardConsignmentsQuery } from '../../store/api/o2dFmsApi';
import { useDeleteOrderMutation } from '../../store/api/orderApi';
import { useDeleteChallanMutation } from '../../store/api/dispatchControlApi';
import { usePermissions } from '../../hooks/usePermission';
import { resolveActionLink, resolveEntityLink, actionLinkMeta } from './actionLinks';
import BoardRowEditDialog from './BoardRowEditDialog';
import BulkEmailDialog from './BulkEmailDialog';
import { O2D } from './o2dTheme';

// ── Ambika 2.0 step-first O2D board ─────────────────────────────────────────
// The client's doers don't browse orders — they own ONE step of the flow and
// just need "what's on my step today". Every step of the (shared) flow is a tab
// across the top; selecting one lists every order on that step as a flat table
// that reads like the client's own Google-sheet FMS:
//   • per-step DATA columns appear dynamically (the step's configured form
//     fields — Vehicle No., Qty loaded, … — become columns),
//   • Planned / Actual / Delay are always present, colour-coded,
//   • "Who" shows the step's assignees (or the SOP owner),
//   • the Action column holds the step's real work links while pending, and
//     flips to the completed record's link once done (open / edit).

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
// The sheet tracks timestamps, not just dates — show both, compactly.
const fmtDT = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const effectiveStepDate = (step, process) => step?.actual || step?.completedAt || step?.planned || process?.updatedAt || process?.createdAt || 0;

// Minutes → the sheet's "Time Delay" feel: 1d 2h / 3h 25m / 12m.
const fmtDelay = (mins) => {
  const m = Math.round(Number(mins) || 0);
  if (m <= 0) return '';
  if (m >= 1440) return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
};

const nameOf = (u) => (u && typeof u === 'object' ? u.name : null);

// One visual state per step-row, in work-priority order (lower = more urgent).
const stepState = (s) => {
  if (['DONE', 'DELAYED'].includes(s.status)) {
    return { key: 'done', rank: 3, label: s.status === 'DELAYED' ? 'Done (late)' : 'Done', color: s.status === 'DELAYED' ? '#b45309' : '#15803d', bg: s.status === 'DELAYED' ? '#fffbeb' : '#ecfdf5', border: s.status === 'DELAYED' ? '#fde68a' : '#bbf7d0', Icon: CheckCircle2 };
  }
  if (s.isOverdue) return { key: 'overdue', rank: 0, label: 'Overdue', color: '#dc2626', bg: '#fef2f2', border: '#fecaca', Icon: AlertTriangle };
  if (s.status === 'IN_PROGRESS') return { key: 'progress', rank: 1, label: 'In progress', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', Icon: Clock };
  return { key: 'pending', rank: 2, label: 'Pending', color: '#64748b', bg: '#f8fafc', border: '#e2e8f0', Icon: CircleDashed };
};

// Short "2/5" / "40%" tag for a quantity- or consignment-gated step mid-flight.
const progressTag = (s) => {
  if (s.status !== 'IN_PROGRESS') return '';
  const dp = s.dispatchProgress;
  if (dp) {
    if (dp.phasesTotal > 0) return `${dp.phasesDone}/${dp.phasesTotal}`;
    return dp.orderedQty > 0 ? `${dp.pct || 0}%` : '';
  }
  const ep = s.executionProgress;
  if (ep && ep.total > 0) return `${ep.done}/${ep.total}`;
  return '';
};

// Older orders may predate a step's connected screens — same safety net as
// StepView's ACTION_FALLBACKS (mirrors the seeded template; stored data wins).
const ACTION_FALLBACKS = {
  '1.01': ['ORDER_ENTRY'], '2.02': ['ORDER_ENTRY'], '2.03': ['PPC'],
  '2.04': ['DISPATCH_PLAN', 'DISPATCH_PLAN_PDF'], '2.05': ['EMAIL_DISPATCH_SCHEDULE'],
  '2.06': ['ACTUAL_DISPATCH', 'CHALLAN_PDF'], '2.07': ['INVOICE_ENTRY'], '2.08': ['INVOICE_EMAIL'],
  '2.09': ['TRACK_DELIVERY'], '2.10': ['PAYMENT_FOLLOWUP'], '2.11': ['PAYMENT_RECEIPT'],
  '2.12': ['TRANSPORT_BILL_RECEIVE'], '2.13': ['TRANSPORT_BILL_STATUS'],
};

// Compact button labels — the registry's full labels ("Actual Dispatch
// (challan)", "Create Invoice & Eway Bill (2.7)") are too long for a column.
const SHORT_ACTION_LABELS = {
  ORDER_INTAKE: 'Order Intake', ORDER_ENTRY: 'Order Entry', PPC: 'PPC Plan',
  DISPATCH_PLAN: 'Dispatch Planning', DISPATCH_PLAN_PDF: 'Plan PDF',
  EMAIL_DISPATCH_SCHEDULE: 'Email Schedule',
  ACTUAL_DISPATCH: 'Dispatch Items', CHALLAN_PDF: 'Challan PDF',
  INVOICE_ENTRY: 'Invoice & Eway', INVOICE_EMAIL: 'Email Invoice',
  TRACK_DELIVERY: 'Track Delivery',
  PAYMENT_FOLLOWUP: 'Payment Follow-up', PAYMENT_RECEIPT: 'Receive Payment',
  TRANSPORT_BILL_RECEIVE: 'Receive Bill', TRANSPORT_BILL_STATUS: 'Bill Status',
};

const shortLabel = (key) => SHORT_ACTION_LABELS[key]
  || (actionLinkMeta(key)?.label || key).replace(/\s*\(.*\)$/, '');

const stepKeysOf = (s) => (s?.actionLinks?.length
  ? s.actionLinks
  : (s?.actionLink ? [s.actionLink] : (ACTION_FALLBACKS[s?.stepCode] || [])));

const ctxOf = (p) => ({ soNumber: p.soNumber, orderId: p.salesOrderId, processId: p._id, intakeId: p.intakeId });

// Actions that should NOT appear as board links. 2.03 Check Inventory is a
// physical job — the doer checks stock and marks the step done right here;
// bouncing them to the PPC planning screen was pure friction.
const BOARD_HIDDEN_ACTIONS = ['PPC'];
const boardKeysOf = (s) => stepKeysOf(s).filter((k) => !BOARD_HIDDEN_ACTIONS.includes(k));

// PENDING rows: the step's "do the work" links — the form opens directly.
const rowDoLinks = (p, s) => boardKeysOf(s)
  .map((key) => {
    const to = resolveActionLink(key, ctxOf(p));
    if (!to) return null;
    if (key !== 'ACTUAL_DISPATCH') return { key, label: shortLabel(key), to };
    const sep = to.includes('?') ? '&' : '?';
    const taskStep = s.stepCode || '2.06';
    const taskTo = `${to}${sep}fromTask=${encodeURIComponent(p._id)}&fromStep=${encodeURIComponent(taskStep)}&fromAction=ACTUAL_DISPATCH`;
    return { key, label: shortLabel(key), to: taskTo };
  })
  .filter(Boolean);

// DONE rows: the COMPLETED record's link (sheet behaviour — the link only
// exists once the work is done). Prefer the exact deep-link captured when the
// action was marked done; fall back to the record's view route. The doer can
// open it to check or edit.
const rowDoneLinks = (p, s) => {
  const ctx = ctxOf(p);
  const seen = new Set();
  const links = boardKeysOf(s)
    .map((key) => {
      const ap = (s.actionProgress || []).find((x) => x.key === key);
      // Each action keeps its OWN separate link: the deep-link captured when it
      // was done, else the record's view page, else the action's screen —
      // skipping any URL another action on this row already claimed. So a done
      // 2.06 shows "Actual Dispatch" AND "Challan PDF" as two distinct links.
      // PDF-generator actions are the exception: their button must land on the
      // GENERATOR page itself (pre-scoped ?so=…) so the doer can get the PDF —
      // captured links often point back at the planning screen instead.
      const candidates = ['DISPATCH_PLAN_PDF', 'CHALLAN_PDF'].includes(key)
        ? [resolveActionLink(key, ctx), ap?.link, resolveEntityLink(key, ctx)?.to].filter(Boolean)
        : [ap?.link, resolveEntityLink(key, ctx)?.to, resolveActionLink(key, ctx)].filter(Boolean);
      const to = candidates.find((c) => !seen.has(c));
      if (!to) return null;
      seen.add(to);
      return { key, label: shortLabel(key), to, doneByName: ap?.doneByName || null, doneAt: ap?.doneAt || null };
    })
    .filter(Boolean);
  // A pasted completion link (drive URL etc.) — the sheet's "Click here".
  if (s.link && !seen.has(s.link)) links.push({ key: '_link', label: 'Link', to: s.link, external: true });
  return links;
};

const STATUS_OPTS = [
  { value: 'all',      label: 'All' },
  { value: 'open',     label: 'To do (not done)' },
  { value: 'overdue',  label: 'Overdue' },
  { value: 'progress', label: 'In progress' },
  { value: 'pending',  label: 'Pending' },
  { value: 'done',     label: 'Done' },
];

const fmtNum = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtAmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN'));

// The sheet's per-dispatch columns — shown on the dispatch step only, one table
// row per Delivery Challan (a split order appears once per dispatch).
const DC_COLUMNS = [
  { key: 'ts',          label: 'Dispatch Time', min: 120 },
  { key: 'dcNumber',    label: 'DC Number', min: 130 },
  { key: 'phase',       label: 'Phase', min: 70 },
  { key: 'sku',         label: 'SKU', min: 160 },
  { key: 'qty',         label: 'Dispatch Qty', min: 110 },
  { key: 'invNo',       label: 'Invoice No.', min: 130 },
  { key: 'invDate',     label: 'Invoice Date', min: 100 },
  { key: 'invAmt',      label: 'Invoice Amt', min: 100 },
  { key: 'invRecd',     label: 'Amt Received', min: 100 },
  { key: 'balance',     label: 'Balance', min: 90 },
  { key: 'transType',   label: 'Transport Type', min: 110 },
  { key: 'transporter', label: 'Transporter', min: 140 },
  { key: 'lrNo',        label: 'L.R. No.', min: 100 },
  { key: 'remark',      label: 'Remarks', min: 120 },
];

// Generic dispatch columns a given step does not need. 2.11 already carries its
// own Payment / Amt Received / Received Date columns, so the sheet's Balance is
// noise there and the client asked for it gone.
const DC_COLUMNS_HIDDEN = { '2.11': ['balance'] };

// Sort choices for the register. "Activity" is the step's effective date (actual
// → completed → planned), which is what the board has always ordered by; the
// rest are the orderings people actually ask for when hunting a row.
const SORT_OPTS = [
  { value: 'recentFirst',  label: 'Latest first' },
  { value: 'oldestFirst',  label: 'Oldest first' },
  { value: 'plannedAsc',   label: 'Planned date ↑' },
  { value: 'plannedDesc',  label: 'Planned date ↓' },
  { value: 'partyAsc',     label: 'Party A–Z' },
  { value: 'partyDesc',    label: 'Party Z–A' },
  { value: 'soAsc',        label: 'SO number A–Z' },
  { value: 'soDesc',       label: 'SO number Z–A' },
  { value: 'delayDesc',    label: 'Most delayed' },
];

// `undefined`/null dates must sort LAST in both directions, never as epoch 0 —
// otherwise every not-yet-planned row floats to the top of "Planned date ↑".
const dateVal = (v) => { const t = v ? new Date(v).getTime() : NaN; return Number.isNaN(t) ? null : t; };
const byDate = (a, b, dir) => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir === 'asc' ? a - b : b - a;
};
const byText = (a, b, dir) => {
  const cmp = String(a || '').localeCompare(String(b || ''), 'en', { numeric: true, sensitivity: 'base' });
  return dir === 'asc' ? cmp : -cmp;
};

const sortRows = (list, mode) => {
  const out = [...list];
  switch (mode) {
    case 'oldestFirst':
      return out.sort((a, b) => byDate(dateVal(effectiveStepDate(a.s, a.p)), dateVal(effectiveStepDate(b.s, b.p)), 'asc'));
    case 'plannedAsc':
      return out.sort((a, b) => byDate(dateVal(a.s?.planned), dateVal(b.s?.planned), 'asc'));
    case 'plannedDesc':
      return out.sort((a, b) => byDate(dateVal(a.s?.planned), dateVal(b.s?.planned), 'desc'));
    case 'partyAsc':
      return out.sort((a, b) => byText(a.p?.partyName, b.p?.partyName, 'asc'));
    case 'partyDesc':
      return out.sort((a, b) => byText(a.p?.partyName, b.p?.partyName, 'desc'));
    case 'soAsc':
      return out.sort((a, b) => byText(a.p?.soNumber, b.p?.soNumber, 'asc'));
    case 'soDesc':
      return out.sort((a, b) => byText(a.p?.soNumber, b.p?.soNumber, 'desc'));
    case 'delayDesc':
      return out.sort((a, b) => (Number(b.s?.delayMins) || 0) - (Number(a.s?.delayMins) || 0));
    case 'recentFirst':
    default:
      return out.sort((a, b) => byDate(dateVal(effectiveStepDate(a.s, a.p)), dateVal(effectiveStepDate(b.s, b.p)), 'desc'));
  }
};

// Per-challan status of the ACTIVE step — each split runs 2.06–2.13 on its own.
// The explicit consignment log (who/when a doer recorded) wins; else the real
// documents decide (challan / invoice / email / delivery / payment / transport).
const dcStepState = (dc, step) => {
  if (!dc || !step) return null;
  const log = dc.log?.[step.code];
  if (log) return { done: true, at: log.doneAt, by: log.doneByName };
  if (step.isDispatch) return { done: true, at: dc.dcDate, by: dc.createdByName };
  switch (step.triggerKey) {
    case 'INVOICE': return dc.invoice?.invoiceNo ? { done: true, at: dc.invoice.date, by: null } : { done: false };
    case 'POD':     return dc.delivery?.delivered ? { done: true, at: dc.delivery.date, by: null } : { done: false };
    case 'PAYMENT': return (dc.payment?.confirmed || dc.payment?.outcome === 'RECEIVED')
      ? { done: true, at: dc.payment?.receivedDate, by: null } : { done: false };
    default: break;
  }
  // Step-code fallbacks for post-fork steps whose definitions carry no trigger
  // key — the real documents still tell the truth per challan.
  if (step.code === '2.07') return dc.invoice?.invoiceNo ? { done: true, at: dc.invoice.date, by: null } : { done: false };
  if (step.code === '2.08') return dc.invoice?.emailStatus === 'SENT' ? { done: true, at: dc.invoice.emailSentAt, by: null } : { done: false };
  if (step.code === '2.09') return dc.delivery?.delivered ? { done: true, at: dc.delivery.date, by: null } : { done: false };
  if (step.code === '2.11') {
    return (dc.payment?.confirmed || dc.payment?.outcome === 'RECEIVED')
      ? { done: true, at: dc.payment?.receivedDate, by: null } : { done: false };
  }
  if (step.code === '2.12') return dc.transport?.receiptStatus === 'DONE' ? { done: true, at: null, by: null } : { done: false };
  if (step.code === '2.13') return dc.transport?.paymentStatus === 'DONE' ? { done: true, at: null, by: null } : { done: false };
  return { done: false };
};

// ── Step-specific priority columns ──────────────────────────────────────────
// The fields a doer / MD needs FIRST on that step, straight from the step's
// own form and documents. Rendered right after PO Number, before the generic
// dispatch columns. Document links open the S3 file in a new tab (preview
// there, download from there).
const STEP_EXTRA_COLUMNS = {
  '2.07': [
    { key: 'invDocs',  label: 'Invoice', min: 110 },
    { key: 'ewayDocs', label: 'E-way Bill', min: 110 },
    { key: 'pdirDocs', label: 'PDIR', min: 110 },
  ],
  '2.09': [
    { key: 'delStatus',    label: 'Delivery Status', min: 120 },
    { key: 'delDate',      label: 'Delivery Date', min: 110 },
    // Only meaningful when the answer was "Not Delivered" — the date the doer
    // said they would chase it again.
    { key: 'delNextDate',  label: 'New Date to Track', min: 130 },
  ],
  '2.10': [
    { key: 'fuStatus', label: 'Follow-up', min: 100 },
    { key: 'fuDate',   label: 'Follow-up Date', min: 110 },
  ],
  '2.11': [
    { key: 'payOutcome', label: 'Payment', min: 110 },
    { key: 'payRecd',    label: 'Amt Received', min: 100 },
    { key: 'payDate',    label: 'Received Date', min: 110 },
  ],
  '2.12': [{ key: 'tbReceipt', label: 'Bill Receipt', min: 100 }],
  '2.13': [{ key: 'tbPayment', label: 'Bill Payment', min: 100 }],
};

const TONE_SX = {
  green: { color: '#15803d', bgcolor: '#ecfdf5', border: '1px solid #bbf7d0' },
  red:   { color: '#dc2626', bgcolor: '#fef2f2', border: '1px solid #fecaca' },
  amber: { color: '#b45309', bgcolor: '#fffbeb', border: '1px solid #fde68a' },
  grey:  { color: '#64748b', bgcolor: '#f8fafc', border: '1px solid #e2e8f0' },
};
const MiniChip = ({ label, tone = 'grey' }) => (
  <Chip size="small" label={label}
    sx={{ height: 22, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', ...TONE_SX[tone], '& .MuiChip-label': { px: 1 } }} />
);

// Attached S3 documents — one small chip per file, opening in a new tab.
const DocLinks = ({ urls }) => (!urls?.length
  ? <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>—</Typography>
  : (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {urls.map((u, i) => (
        <Chip
          key={u} size="small" clickable icon={<ExternalLink size={11} />}
          label={urls.length === 1 ? 'Open' : `${i + 1}`}
          onClick={() => window.open(u, '_blank', 'noopener')}
          sx={{
            height: 22, fontWeight: 700, fontSize: '0.7rem', color: O2D.brand,
            bgcolor: alpha(O2D.brand, 0.08), '&:hover': { bgcolor: alpha(O2D.brand, 0.16) },
            '& .MuiChip-icon': { color: O2D.brand, ml: 0.5 }, '& .MuiChip-label': { px: 0.75 },
          }}
        />
      ))}
    </Stack>
  ));

const extraDash = <Typography sx={{ fontSize: '0.75rem', color: '#7d8fb3' }}>—</Typography>;
const extraCellNode = (dc, key) => {
  if (!dc) return extraDash;
  const txt = (v, fmt = (x) => x) => (v ? <Typography sx={{ fontSize: '0.78rem', color: O2D.body, whiteSpace: 'nowrap' }}>{fmt(v)}</Typography> : extraDash);
  switch (key) {
    case 'invDocs':  return <DocLinks urls={dc.invoice?.invoiceUrls} />;
    case 'ewayDocs': return <DocLinks urls={dc.invoice?.ewayBillUrls} />;
    case 'pdirDocs': return <DocLinks urls={dc.invoice?.pdirUrls} />;
    case 'delStatus': {
      const st = dc.delivery?.status || 'Pending';
      const tone = dc.delivery?.delivered ? 'green' : /cancel/i.test(st) ? 'red' : /not/i.test(st) ? 'amber' : 'grey';
      return <MiniChip label={st} tone={tone} />;
    }
    case 'delDate':  return txt(dc.delivery?.date, fmtDT);
    case 'delNextDate': {
      const nd = dc.delivery?.newTrackDate;
      if (!nd || dc.delivery?.delivered) return extraDash;
      // Amber: this is an open commitment to chase, not a completed date.
      return <MiniChip label={fmtDT(nd)} tone="amber" />;
    }
    case 'fuStatus': {
      const st = dc.payment?.followUpStatus;
      if (!st) return extraDash;
      return <MiniChip label={st === 'DONE' ? 'Done' : st === 'PENDING' ? 'Pending' : st}
        tone={st === 'DONE' ? 'green' : st === 'PENDING' ? 'grey' : 'amber'} />;
    }
    case 'fuDate':   return txt(dc.payment?.followUpDate, fmtDT);
    case 'payOutcome': {
      const o = dc.payment?.outcome;
      if (!o) return extraDash;
      return <MiniChip label={o === 'RECEIVED' ? 'Received' : o === 'NOT_RECEIVED' ? 'Not received' : 'Pending'}
        tone={o === 'RECEIVED' ? 'green' : o === 'NOT_RECEIVED' ? 'red' : 'grey'} />;
    }
    case 'payRecd':  return dc.payment ? txt(fmtAmt(dc.payment.received)) : extraDash;
    case 'payDate':  return txt(dc.payment?.receivedDate, fmtDate);
    case 'tbReceipt': {
      const st = dc.transport?.receiptStatus;
      return st ? <MiniChip label={st === 'DONE' ? 'Received' : st} tone={st === 'DONE' ? 'green' : 'grey'} /> : extraDash;
    }
    case 'tbPayment': {
      const st = dc.transport?.paymentStatus;
      return st ? <MiniChip label={st === 'DONE' ? 'Paid' : st} tone={st === 'DONE' ? 'green' : 'grey'} /> : extraDash;
    }
    default: return extraDash;
  }
};

const dcCellValue = (dc, key) => {
  if (!dc) return '—';
  switch (key) {
    case 'ts':          return fmtDT(dc.dcDate);
    case 'dcNumber':    return dc.dcNumber || '—';
    case 'phase':       return dc.phaseNo || '—';
    case 'sku':         return dc.skuNames?.length ? dc.skuNames.join(' / ') : '—';
    case 'qty':         return dc.skuQtys?.length ? dc.skuQtys.map(fmtNum).join(' / ') : fmtNum(dc.totalQty);
    case 'invNo':       return dc.invoice?.invoiceNo || '—';
    case 'invDate':     return dc.invoice?.date ? fmtDate(dc.invoice.date) : '—';
    case 'invAmt':      return dc.invoice ? fmtAmt(dc.invoice.amount) : '—';
    case 'invRecd':     return dc.invoice ? fmtAmt(dc.invoice.received) : '—';
    case 'balance':     return dc.invoice ? fmtAmt(dc.invoice.balance) : '—';
    case 'transType':   return dc.transportType || '—';
    case 'transporter': return dc.transporterName || '—';
    case 'lrNo':        return dc.lrNo || '—';
    case 'remark':      return dc.remark || '—';
    default:            return '—';
  }
};

const O2dStepBoard = () => {
  const navigate = useNavigate();
  const { stepCode } = useParams();
  const { enqueueSnackbar } = useSnackbar();
  const { can, isRoot } = usePermissions();
  // Order deletion is MD/root-only server-side (`orders.delete`) — hide the
  // button entirely for everyone else instead of showing a dead control.
  const canDelete = can('orders.delete') || isRoot;
  const [deleteChallan] = useDeleteChallanMutation();
  const [deleteOrder, { isLoading: deleting }] = useDeleteOrderMutation();
  const [confirmRow, setConfirmRow] = useState(null); // { p, dc } pending delete confirmation
  const [sortBy, setSortBy] = useState('recentFirst');
  const { data, isLoading, refetch } = useGetProcessesQuery({ limit: 300, sort: '-createdAt' }, { pollingInterval: 60_000 });
  const rows = useMemo(() => data?.data || [], [data]);

  // The flow is the same for every order, so the step rail is simply the union
  // of embedded steps across the loaded processes, in sequence order. Carries
  // the SOP header values ("Who" / "When") for the step info bar.
  const steps = useMemo(() => {
    const map = new Map();
    rows.forEach((p) => (p.steps || []).forEach((s) => {
      if (!map.has(s.stepCode)) {
        const isDispatch = !!s.quantityGated || stepKeysOf(s).includes('ACTUAL_DISPATCH');
        map.set(s.stepCode, {
          code: s.stepCode, name: s.name, seq: s.sequence || 0,
          ownerName: s.ownerName || null, whenText: s.whenText || null,
          triggerKey: s.triggerKey || null,
          isDispatch,
          // Email steps (2.05 dispatch schedule / 2.08 invoice) get an
          // "Email Sent" column fed by the step's email audit log.
          isEmail: stepKeysOf(s).some((k) => ['EMAIL_DISPATCH_SCHEDULE', 'INVOICE_EMAIL'].includes(k)),
          // Steps that run once PER Delivery Challan get per-challan rows:
          // the dispatch step itself plus every consignment-gated step after
          // the flow forks (2.07 invoice … 2.13 transport payment).
          perDc: isDispatch || !!s.consignmentGated,
        });
      }
    }));
    const list = [...map.values()].sort((a, b) => a.seq - b.seq);
    // The flow forks at the dispatch step: EVERYTHING from there on (2.06 …
    // 2.13) runs once per Delivery Challan — email, delivery, payment and
    // transport all track each split separately. The stored consignment flag
    // only covers some steps, so the fork position is the source of truth.
    const forkSeq = list.find((x) => x.isDispatch)?.seq;
    if (forkSeq != null) list.forEach((x) => { if (x.seq >= forkSeq) x.perDc = true; });
    return list;
  }, [rows]);

  const activeCode = stepCode && steps.some((s) => s.code === stepCode) ? stepCode : steps[0]?.code;
  const activeStep = steps.find((s) => s.code === activeCode);
  // Per-challan steps (2.06–2.13): the table splits into one row per challan.
  const isPerDcStep = !!activeStep?.perDc;
  const isEmailStep = !!activeStep?.isEmail;

  // ── Bulk send (2.05) ────────────────────────────────────────────────────
  // Selection is keyed by SO number and cleared whenever the step or the filters
  // change, so a hidden row can never be swept into a send the user cannot see.
  const [selected, setSelected] = useState([]);   // [{ key, soNumber, dcId, dcNumber }]
  const [bulkOpen, setBulkOpen] = useState(false);
  // 2.05 mails one ORDER; 2.08 mails one CHALLAN's invoice.
  const bulkKind = activeCode === '2.08' ? 'invoice' : 'schedule';
  const selKeyOf = (r) => (r.dc ? `${r.p.soNumber}::${r.dc.dcNumber || r.dc.dcId}` : r.p.soNumber);
  // A per-challan step row with no challan yet has nothing to email.
  const selectableRow = (r) => (isPerDcStep ? Boolean(r.dc) : true);
  const isSelected = (key) => selected.some((x) => x.key === key);
  const toggleSelect = (r) => {
    const key = selKeyOf(r);
    setSelected((prev) => (prev.some((x) => x.key === key)
      ? prev.filter((x) => x.key !== key)
      : [...prev, { key, soNumber: r.p.soNumber, dcId: r.dc?.dcId, dcNumber: r.dc?.dcNumber }]));
  };

  // Every Delivery Challan across all orders, grouped by SO — the dispatch
  // step renders one table row per challan, exactly like the client's sheet.
  const { data: consRes } = useGetBoardConsignmentsQuery(undefined, { pollingInterval: 60_000 });
  const dcBySo = useMemo(() => {
    const map = new Map();
    (consRes?.data || []).forEach((dc) => {
      if (!dc.soNumber) return;
      if (!map.has(dc.soNumber)) map.set(dc.soNumber, []);
      map.get(dc.soNumber).push(dc);
    });
    return map;
  }, [consRes]);

  // One-line shortcut: pick an order, land straight on its Actual Dispatch
  // screen — the "dispatch again" case for a split order, without hunting
  // through steps or rows.
  const quickOptions = useMemo(() => rows
    .filter((p) => p.soNumber && !p.isCompleted)
    .map((p) => ({ so: p.soNumber, label: `${p.soNumber}${p.partyName ? ` · ${p.partyName}` : ''}` })), [rows]);

  // Per-step workload badge: orders where the step still needs action.
  const openCounts = useMemo(() => {
    const counts = {};
    rows.forEach((p) => (p.steps || []).forEach((s) => {
      if (!['DONE', 'DELAYED'].includes(s.status)) counts[s.stepCode] = (counts[s.stepCode] || 0) + 1;
    }));
    return counts;
  }, [rows]);

  // Overdue per step — turns that step's badge red (the loudest signal wins).
  const overdueCounts = useMemo(() => {
    const counts = {};
    rows.forEach((p) => (p.steps || []).forEach((s) => {
      if (stepState(s).key === 'overdue') counts[s.stepCode] = (counts[s.stepCode] || 0) + 1;
    }));
    return counts;
  }, [rows]);

  const [search, setSearch] = useState('');
  // "All" by default — doers landing on a step must see every order on it,
  // done and pending alike (the sheet shows everything; filters are opt-in).
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  useEffect(() => { setPage(0); setSelected([]); }, [search, status, activeCode, rowsPerPage, sortBy]);

  // One row per order = that order's entry for the ACTIVE step.
  const stepRows = useMemo(() => {
    if (!activeCode) return [];
    const q = search.trim().toLowerCase();
    const list = [];
    rows.forEach((p) => {
      const s = (p.steps || []).find((x) => x.stepCode === activeCode);
      if (!s) return;
      const st = stepState(s);
      if (status === 'open' && st.key === 'done') return;
      if (!['all', 'open'].includes(status) && st.key !== status) return;
      if (q) {
        // On the dispatch step, DC number / L.R. no also match the search.
        const dcText = isPerDcStep
          ? (dcBySo.get(p.soNumber) || []).map((d) => `${d.dcNumber || ''} ${d.lrNo || ''}`).join(' ')
          : '';
        if (!`${p.soNumber || ''} ${p.poNumber || ''} ${p.partyName || ''} ${dcText}`.toLowerCase().includes(q)) return;
      }
      list.push({ p, s, st });
    });
    // Latest activity first by default — the chronological FMS register — but the
    // doer can re-order it from the toolbar.
    return sortRows(list, sortBy);
  }, [rows, activeCode, search, status, isPerDcStep, dcBySo, sortBy]);

  // Dispatch step: expand each order into one row PER Delivery Challan (a split
  // order appears once per dispatch, like the sheet); orders not yet dispatched
  // keep a single row so the doer still sees the work links. Other steps: 1:1.
  const displayRows = useMemo(() => {
    if (!isPerDcStep) return stepRows.map((r) => ({ ...r, dc: null, splitIndex: 0, splitTotal: 0 }));
    const out = [];
    stepRows.forEach((r) => {
      const dcs = dcBySo.get(r.p.soNumber) || [];
      if (dcs.length === 0) out.push({ ...r, dc: null, splitIndex: 0, splitTotal: 0 });
      else [...dcs]
        .sort((a, b) => new Date(b.dcDate || 0) - new Date(a.dcDate || 0))
        .forEach((dc, i) => out.push({ ...r, dc, splitIndex: i + 1, splitTotal: dcs.length }));
    });
    return out;
  }, [stepRows, dcBySo, isPerDcStep]);

  // ── Dynamic per-step DATA columns ──
  // Whatever form fields the step is configured to capture (Vehicle No., Qty
  // loaded, …) become columns automatically — different step, different columns,
  // no code change needed when the Step Builder adds a field.
  const fieldCols = useMemo(() => {
    const labels = [];
    stepRows.forEach(({ s }) => (s.formFields || []).forEach((f) => {
      if (f.label && !labels.includes(f.label)) labels.push(f.label);
    }));
    return labels.slice(0, 6); // keep the table sane if a step over-collects
  }, [stepRows]);

  const overdueOnStep = useMemo(() => stepRows.filter(({ st }) => st.key === 'overdue').length, [stepRows]);

  const paged = displayRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  // Header checkbox spans only the rows currently rendered — selecting rows the
  // user cannot see is how accidental mass-sends happen.
  const pageTargets = useMemo(
    () => paged.filter(selectableRow).map((r) => ({
      key: selKeyOf(r), soNumber: r.p.soNumber, dcId: r.dc?.dcId, dcNumber: r.dc?.dcNumber,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paged, isPerDcStep],
  );
  const pageKeys = useMemo(() => pageTargets.map((t) => t.key), [pageTargets]);
  const allPageSelected = pageKeys.length > 0 && pageKeys.every((k) => selected.some((x) => x.key === k));
  const somePageSelected = pageKeys.some((k) => selected.some((x) => x.key === k)) && !allPageSelected;
  const toggleSelectPage = () => setSelected((prev) => (
    allPageSelected
      ? prev.filter((x) => !pageKeys.includes(x.key))
      : [...prev, ...pageTargets.filter((t) => !prev.some((x) => x.key === t.key))]
  ));

  // Which row's split panel is open (row key = processId + dcId).
  const [expandedKey, setExpandedKey] = useState(null);
  useEffect(() => { setExpandedKey(null); }, [activeCode, page]);

  // Row being edited in the inline Excel-style popup ({ p, s, dc }).
  const [editRow, setEditRow] = useState(null);

  // Steps with no screen to open (2.03 Check Inventory — a physical job):
  // the action button opens the TASK PAGE, where the doer reviews everything,
  // ticks the checklist deliberately, and clicks Mark Done — completion is a
  // human judgment, never a silent one-click from the board.

  // On a per-challan step each consignment has its OWN work for this step, so the
  // task opens scoped to that challan (?dc=) instead of the order's aggregate view.
  const openTask = (p, dc = null) => {
    const q = dc?.dcNumber ? `?dc=${encodeURIComponent(dc.dcNumber)}` : '';
    navigate(`/o2d-fms/task/${p._id}/${encodeURIComponent(activeCode)}${q}`);
  };
  // Captured completion links may be external (drive URLs) — open those in a tab.
  const openLink = (to) => (/^https?:\/\//i.test(to) ? window.open(to, '_blank', 'noopener') : navigate(to));

  /**
   * Open a step's connected form FROM THE BOARD, carrying the task context.
   *
   * Without fromTask/fromStep/fromAction the form cannot find its way back, and
   * `useReturnToTask` falls through to "resolve the order's active task" — which
   * on a split order lands on whichever challan it happens to pick. That is how
   * recording a payment for DC-081 returned to DC-082's task. `dc` keeps the
   * whole round trip pinned to the consignment whose row was clicked.
   *
   * Done rows link to the produced RECORD, not the form, so they open as-is.
   */
  const goRowAction = (a, row, rowDone) => {
    if (!a?.to) return;
    if (rowDone || a.external || /^https?:\/\//i.test(a.to)) return openLink(a.to);
    const sep = a.to.includes('?') ? '&' : '?';
    const dcPart = row.dc?.dcNumber ? `&dc=${encodeURIComponent(row.dc.dcNumber)}` : '';
    return navigate(
      `${a.to}${sep}fromTask=${row.p._id}`
      + `&fromStep=${encodeURIComponent(activeCode)}`
      + `&fromAction=${encodeURIComponent(a.key)}${dcPart}`,
    );
  };

  const handleDelete = async () => {
    const { p, dc } = confirmRow || {};
    // A challan row deletes only THAT dispatch; an order row deletes the order
    // and its whole tracker. Same split Edit already uses, so one row's buttons
    // all act on the same thing.
    if (dc?.dcId) {
      try {
        await deleteChallan(dc.dcId).unwrap();
        setConfirmRow(null);
        enqueueSnackbar(`Challan ${dc.dcNumber || ''} deleted.`, { variant: 'success' });
      } catch (err) {
        enqueueSnackbar(err?.data?.message || 'Could not delete this challan.', { variant: 'error' });
      }
      return;
    }
    if (!p?.salesOrderId) return;
    try {
      await deleteOrder(p.salesOrderId).unwrap();
      setConfirmRow(null);
      enqueueSnackbar(`Order ${p.soNumber || ''} deleted.`, { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not delete the order.', { variant: 'error' });
    }
  };

  // Step-specific priority columns (2.07 documents, 2.09 delivery, 2.10–2.13
  // payment/transport) — shown before the generic dispatch columns.
  const extraCols = isPerDcStep ? (STEP_EXTRA_COLUMNS[activeCode] || []) : [];
  const dcCols = useMemo(() => {
    const hide = DC_COLUMNS_HIDDEN[activeCode] || [];
    return hide.length ? DC_COLUMNS.filter((c) => !hide.includes(c.key)) : DC_COLUMNS;
  }, [activeCode]);

  const colCount = 11 + fieldCols.length + (canDelete ? 1 : 0) + (isPerDcStep ? 1 + dcCols.length : 0) + (isEmailStep ? 1 : 0) + extraCols.length;

  // ── Frozen panes ──
  // Action + SO Number (+ Split on the dispatch step) stay pinned while the
  // wide sheet scrolls left-right, and the header row stays pinned while it
  // scrolls up-down — a row never loses its identity. Fixed widths make the
  // cumulative `left` offsets exact.
  const FROZEN = isPerDcStep ? [{ w: 180 }, { w: 132 }, { w: 70 }] : [{ w: isEmailStep ? 222 : 180 }, { w: 132 }];
  const freezeSx = (i, head = false) => ({
    position: 'sticky',
    left: FROZEN.slice(0, i).reduce((a, c) => a + c.w, 0),
    width: FROZEN[i].w, minWidth: FROZEN[i].w, maxWidth: FROZEN[i].w,
    // Header cells must paint above frozen body cells; frozen body cells above
    // the scrolling ones — but below the sticky header (z 2) passing over them.
    zIndex: head ? 3 : 1,
    ...(head && { bgcolor: O2D.surfaceAlt }),
    ...(i === FROZEN.length - 1 && {
      borderRight: `1px solid ${O2D.line}`,
      boxShadow: '4px 0 6px -3px rgba(15,23,42,0.14)',
    }),
  });

  return (
    <Box sx={{ bgcolor: O2D.canvas, minHeight: '100vh' }}>
      {/* Top bar — title + search, nothing else to hunt through */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 5, bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}`, px: { xs: 1.5, md: 2 }, py: 1 }}>
        {/* ONE line on desktop — everything shrinks before anything wraps.
            (Wrapping is allowed only on phone widths.) */}
        <Stack direction="row" alignItems="center" spacing={1} useFlexGap
          sx={{ flexWrap: { xs: 'wrap', md: 'nowrap' } }}>
          <Box sx={{ p: 0.5, borderRadius: '6px', bgcolor: alpha(O2D.brand, 0.1), color: O2D.brand, display: 'flex', flexShrink: 0 }}><Workflow size={16} /></Box>
          <Box sx={{ minWidth: 0, mr: 'auto', flexShrink: 1 }}>
            <Typography noWrap sx={{ fontSize: '1rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.2 }}>O2D — Step Board</Typography>
            <Typography noWrap sx={{ fontSize: '0.72rem', color: O2D.sub, display: { xs: 'none', xl: 'block' } }}>Pick a step, see every order on it, click a link to do the work.</Typography>
          </Box>
          <TextField
            size="small" placeholder="Search SO / PO…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ width: { xs: '100%', md: 150, lg: 190, xl: 220 }, minWidth: 130, flexShrink: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }}
          />
          <TextField
            select size="small" label="Sort" id="o2d-stepboard-sort" value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            sx={{ width: { xs: '100%', md: 138, lg: 152 }, flexShrink: 0 }}
            SelectProps={{ native: true }} InputLabelProps={{ shrink: true }}
          >
            {SORT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </TextField>
          {/* Native select — a real <select> with a real id, so the floating
              label's `for` points at an actual form field (MUI's styled div
              variant trips DevTools' "Incorrect use of <label for>" check). */}
          <TextField
            select size="small" label="Show" id="o2d-stepboard-show" value={status}
            onChange={(e) => setStatus(e.target.value)} sx={{ width: 104, flexShrink: 0 }}
            SelectProps={{ native: true }} InputLabelProps={{ shrink: true }}
          >
            {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </TextField>
          <Autocomplete
            size="small" options={quickOptions} value={null} blurOnSelect
            sx={{ width: { xs: '100%', md: 150, lg: 178, xl: 205 }, minWidth: 140, flexShrink: 1 }}
            getOptionLabel={(o) => o?.label || ''}
            isOptionEqualToValue={() => false}
            onChange={(_, opt) => { if (opt) navigate(`/challans?so=${encodeURIComponent(opt.so)}`); }}
            renderInput={(params) => <TextField {...params} label="Quick dispatch" placeholder="SO / party…" />}
          />
          <Button variant="contained" size="small" disableElevation startIcon={<Plus size={14} />}
            onClick={() => navigate('/orders?new=1')}
            sx={{
              whiteSpace: 'nowrap', fontWeight: 700, textTransform: 'none', borderRadius: '6px',
              bgcolor: O2D.brand, flexShrink: 0, px: { md: 1.1, xl: 1.6 },
            }}>
            <Box component="span" sx={{ display: { xs: 'none', xl: 'inline' } }}>New Sales Order</Box>
            <Box component="span" sx={{ display: { xs: 'inline', xl: 'none' } }}>New Order</Box>
          </Button>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.25, md: 1.75 }, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {/* ── Step rail — the whole flow, left to right ── */}
        {isLoading ? <Skeleton variant="rounded" height={72} /> : (
          <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5 }}>
            {steps.map((s) => {
              const active = s.code === activeCode;
              const open = openCounts[s.code] || 0;
              return (
                <Tooltip
                  key={s.code} arrow placement="bottom"
                  // Light card tooltip (matches the Master FMS tooltips) — a
                  // dark bubble with blue text was unreadable.
                  slotProps={{
                    tooltip: {
                      sx: {
                        bgcolor: O2D.surface, color: O2D.brand, px: 1.25, py: 1, borderRadius: '8px',
                        maxWidth: 300, border: `1px solid ${O2D.line}`, boxShadow: '0 8px 26px rgba(28,30,33,0.16)',
                      },
                    },
                    arrow: { sx: { color: O2D.surface, '&::before': { border: `1px solid ${O2D.line}` } } },
                  }}
                  title={(
                    <Box>
                      <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: O2D.brand }}>{s.code} · {s.name}</Typography>
                      {s.ownerName && <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, mt: 0.25 }}>Who: {s.ownerName}</Typography>}
                      {s.whenText && <Typography sx={{ fontSize: '0.7rem', color: O2D.sub }}>When: {s.whenText}</Typography>}
                    </Box>
                  )}
                >
                <Paper
                  elevation={0} role="tab" tabIndex={0} aria-selected={active}
                  onClick={() => navigate(`/o2d-fms/steps/${encodeURIComponent(s.code)}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/o2d-fms/steps/${encodeURIComponent(s.code)}`); } }}
                  sx={{
                    px: 1.5, py: 1, minWidth: 150, flexShrink: 0, cursor: 'pointer', borderRadius: '8px',
                    border: `1.5px solid ${active ? O2D.brand : O2D.line}`,
                    bgcolor: active ? alpha(O2D.brand, 0.06) : O2D.surface,
                    transition: 'border-color .15s, background-color .15s, box-shadow .15s',
                    '&:hover': {
                      borderColor: O2D.brand,
                      bgcolor: alpha(O2D.brand, 0.05),
                      boxShadow: `0 2px 10px ${alpha(O2D.brand, 0.14)}`,
                      '& .stepName, & .stepCode': { color: O2D.brand },
                    },
                    '&:focus-visible': { outline: `2px solid ${O2D.brand}`, outlineOffset: 1 },
                  }}
                >
                  <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                    <Typography className="stepCode" sx={{ fontSize: '0.78rem', fontWeight: 800, color: active ? O2D.brand : O2D.ink, transition: 'color .15s' }}>{s.code}</Typography>
                    {/* Pending-work badge — big, solid, and PULSING while work
                        waits, so the eye lands on it; red when any is overdue. */}
                    {(() => {
                      const od = overdueCounts[s.code] || 0;
                      const badgeColor = od > 0 ? '#dc2626' : O2D.brand;
                      return (
                        <Chip size="small" label={open}
                          sx={{
                            height: 26, minWidth: 32, fontWeight: 900, fontSize: '0.84rem',
                            borderRadius: '999px',
                            bgcolor: open > 0 ? badgeColor : '#f1f5f9',
                            color: open > 0 ? '#fff' : O2D.sub,
                            '& .MuiChip-label': { px: 1 },
                            ...(open > 0 && {
                              animation: 'o2dBadgePulse 1.6s ease-in-out infinite',
                              '@keyframes o2dBadgePulse': {
                                '0%, 100%': { transform: 'scale(1)', boxShadow: `0 0 0 0 ${alpha(badgeColor, 0.45)}` },
                                '50%': { transform: 'scale(1.12)', boxShadow: `0 0 0 6px ${alpha(badgeColor, 0)}` },
                              },
                            }),
                          }} />
                      );
                    })()}
                  </Stack>
                  <Typography noWrap className="stepName" sx={{ fontSize: '0.72rem', color: active ? O2D.brand : O2D.sub, fontWeight: active ? 700 : 500, mt: 0.25, maxWidth: 170, transition: 'color .15s' }}>
                    {s.name}
                  </Typography>
                </Paper>
                </Tooltip>
              );
            })}
          </Box>
        )}

        {/* ── The selected step's orders — flat table, left to right ── */}
        <Paper elevation={0} sx={{ borderRadius: '8px', overflow: 'hidden', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
          {activeStep && (
            /* Step info bar — mirrors the sheet's header block: What · Who · When */
            <Stack direction="row" alignItems="center" spacing={1.25} flexWrap="wrap" useFlexGap
              sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${O2D.lineSoft}` }}>
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, color: O2D.ink }}>{activeStep.code} · {activeStep.name}</Typography>
              {activeStep.ownerName && (
                <Chip size="small" icon={<User size={12} />} label={activeStep.ownerName}
                  sx={{ height: 22, fontWeight: 700, fontSize: '0.7rem', bgcolor: alpha(O2D.brand, 0.08), color: O2D.brand, '& .MuiChip-icon': { color: O2D.brand } }} />
              )}
              {activeStep.whenText && (
                <Chip size="small" icon={<CalendarClock size={12} />} label={activeStep.whenText}
                  sx={{ height: 22, fontWeight: 700, fontSize: '0.7rem', bgcolor: '#f8fafc', color: O2D.sub, border: `1px solid ${O2D.line}`, '& .MuiChip-icon': { color: O2D.sub } }} />
              )}
              <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, ml: 'auto' }}>
                <b>{stepRows.length}</b> order{stepRows.length === 1 ? '' : 's'}
                {isPerDcStep && (() => { const n = displayRows.filter((r) => r.dc).length; return n > 0
                  ? <Box component="span"> · <b>{n}</b> dispatch{n === 1 ? '' : 'es'}</Box> : null; })()}
                {overdueOnStep > 0 && <Box component="span" sx={{ color: '#dc2626', fontWeight: 800 }}> · {overdueOnStep} overdue</Box>}
              </Typography>
            </Stack>
          )}
          <Box sx={{ overflow: 'auto', maxHeight: 'calc(100vh - 285px)' }}>
            {isLoading ? <Skeleton variant="rounded" height={300} /> : (
              <Table size="small" stickyHeader sx={{
                minWidth: 1000,
                '& td, & th': { borderColor: O2D.lineSoft },
                '& tbody tr:hover': { bgcolor: O2D.surfaceAlt },
                '& thead th': { bgcolor: O2D.surfaceAlt, fontWeight: 800, fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: O2D.sub, borderBottom: `1px solid ${O2D.line}` },
                // Frozen body cells need an opaque background (rows scroll under
                // them) that still follows the row's hover tint.
                '& tbody td.frozenCell': { bgcolor: O2D.surface },
                '& tbody tr:hover td.frozenCell': { bgcolor: O2D.surfaceAlt },
              }}>
                <TableHead>
                  <TableRow>
                    {/* Action FIRST — pending: the step's work links; done: the record's link */}
                    <TableCell sx={freezeSx(0, true)}>
                      {isEmailStep ? (
                        <Stack direction="row" alignItems="center" spacing={0.5}>
                          <Checkbox
                            size="small"
                            checked={allPageSelected}
                            indeterminate={somePageSelected}
                            onChange={toggleSelectPage}
                            sx={{ p: 0.25 }}
                            inputProps={{ 'aria-label': 'Select all orders on this page' }}
                          />
                          <span>Action</span>
                        </Stack>
                      ) : 'Action'}
                    </TableCell>
                    <TableCell sx={freezeSx(1, true)}>SO Number</TableCell>
                    {isPerDcStep && <TableCell align="center" sx={freezeSx(2, true)}>Split</TableCell>}
                    <TableCell sx={{ minWidth: 160 }}>Party</TableCell>
                    <TableCell sx={{ minWidth: 110 }}>PO Number</TableCell>
                    {extraCols.map((col) => (
                      <TableCell key={col.key} sx={{ minWidth: col.min }}>{col.label}</TableCell>
                    ))}
                    {isPerDcStep && dcCols.map((col) => (
                      <TableCell key={col.key} sx={{ minWidth: col.min }}>{col.label}</TableCell>
                    ))}
                    {fieldCols.map((label) => <TableCell key={label} sx={{ minWidth: 110 }}>{label}</TableCell>)}
                    <TableCell>Status</TableCell>
                    {isEmailStep && <TableCell sx={{ minWidth: 140 }}>Email Sent</TableCell>}
                    <TableCell>Planned</TableCell>
                    <TableCell>Actual</TableCell>
                    <TableCell>Delay</TableCell>
                    <TableCell sx={{ minWidth: 120 }}>Who</TableCell>
                    <TableCell align="center" sx={{ width: 52 }}>Task</TableCell>
                    <TableCell align="center" sx={{ width: 52 }}>Edit</TableCell>
                    {canDelete && <TableCell align="right" sx={{ width: 56 }}>Delete</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stepRows.length === 0 ? (
                    <TableRow><TableCell colSpan={colCount} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                      {rows.length === 0 ? 'No orders yet.' : 'No orders match on this step.'}
                    </TableCell></TableRow>
                  ) : paged.map((row) => {
                    const { p, s, st, dc, splitIndex, splitTotal } = row;
                    const Icon = st.Icon;
                    const tag = progressTag(s);
                    const done = st.key === 'done';
                    const rowKey = `${p._id}-${dc?.dcId || 'order'}`;
                    // Step-level cells (action links, status, dates, who, task,
                    // edit, delete) render once per ORDER — on its first row.
                    // Continuation rows of a split order carry only the DC data.
                    const firstOfGroup = !dc || splitIndex === 1;
                    // Per-challan state of THIS step — each split runs 2.06–2.13
                    // separately, so every row gets its OWN links + status.
                    const dcState = dc ? dcStepState(dc, activeStep) : null;
                    const rowDone = dc ? !!dcState?.done : done;
                    let links = rowDone ? rowDoneLinks(p, s) : rowDoLinks(p, s);
                    // A dispatched challan's PDF link points at ITS OWN pdf.
                    if (dc?.pdfUrl && rowDone) links = links.map((l) => (l.key === 'CHALLAN_PDF' ? { ...l, to: dc.pdfUrl, external: true } : l));
                    const late = s.status === 'DELAYED' || (s.delayMins || 0) > 0;
                    const doneBy = nameOf(s.completedBy)
                      || (s.actionProgress || []).map((a) => a.doneByName).filter(Boolean).pop()
                      || null;
                    const who = (s.assignees || []).map(nameOf).filter(Boolean).join(', ') || s.ownerName || '—';
                    return (
                      <React.Fragment key={rowKey}>
                      <TableRow hover>
                        <TableCell className="frozenCell" sx={freezeSx(0)}>
                          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center">
                            {isEmailStep && (
                              <Checkbox
                                size="small"
                                checked={isSelected(selKeyOf(row))}
                                disabled={!selectableRow(row)}
                                onChange={() => toggleSelect(row)}
                                sx={{ p: 0.25 }}
                                inputProps={{ 'aria-label': `Select ${selKeyOf(row)} for bulk email` }}
                              />
                            )}
                            {links.length === 0 ? (
                              (!dc && !rowDone) ? (
                                // No connected screen (e.g. 2.03 Check Inventory):
                                // open the TASK — review, tick the checklist,
                                // then Mark Done there, deliberately.
                                <Button
                                  size="small" disableElevation variant="contained"
                                  startIcon={<ClipboardList size={13} />}
                                  onClick={() => openTask(p)}
                                  sx={{
                                    textTransform: 'none', fontWeight: 700, fontSize: '0.72rem',
                                    borderRadius: '6px', whiteSpace: 'nowrap', px: 1.1, py: 0.35, bgcolor: O2D.brand,
                                  }}
                                >
                                  Do Task
                                </Button>
                              ) : <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>—</Typography>
                            ) : links.map((a) => {
                              const tipBy = dc ? dcState?.by : a.doneByName;
                              const tipAt = dc ? dcState?.at : a.doneAt;
                              return (
                              <Tooltip
                                key={a.key} arrow
                                title={rowDone && tipBy ? `Done by ${tipBy}${tipAt ? ` · ${fmtDT(tipAt)}` : ''}` : ''}
                                disableHoverListener={!(rowDone && tipBy)}
                              >
                                <Button
                                  size="small" disableElevation
                                  variant={rowDone ? 'outlined' : 'contained'}
                                  endIcon={rowDone ? <ExternalLink size={11} /> : <ArrowRight size={12} />}
                                  onClick={() => goRowAction(a, row, rowDone)}
                                  sx={{
                                    textTransform: 'none', fontWeight: 700, fontSize: '0.72rem',
                                    borderRadius: '6px', whiteSpace: 'nowrap', px: 1.1, py: 0.35,
                                    ...(rowDone
                                      ? { color: '#15803d', borderColor: '#bbf7d0', bgcolor: '#f0fdf4', '&:hover': { borderColor: '#15803d', bgcolor: '#ecfdf5' } }
                                      : { bgcolor: O2D.brand }),
                                  }}
                                >
                                  {a.label}
                                </Button>
                              </Tooltip>
                              );
                            })}
                          </Stack>
                        </TableCell>
                        <TableCell className="frozenCell" sx={freezeSx(1)}>
                          <Typography sx={{ fontWeight: firstOfGroup ? 700 : 500, fontSize: '0.82rem', color: firstOfGroup ? 'inherit' : O2D.sub }}>
                            {p.soNumber || '—'}
                          </Typography>
                        </TableCell>
                        {isPerDcStep && (
                          <TableCell align="center" className="frozenCell" sx={freezeSx(2)}>
                            {splitTotal > 0 ? (
                              <Tooltip title={`${splitTotal} dispatch${splitTotal === 1 ? '' : 'es'} for this order — click for the full split view`} arrow>
                                <Chip
                                  size="small" icon={<Layers size={12} />} label={`${splitIndex}/${splitTotal}`}
                                  onClick={() => setExpandedKey(expandedKey === rowKey ? null : rowKey)}
                                  sx={{
                                    height: 22, fontWeight: 800, fontSize: '0.68rem', cursor: 'pointer',
                                    bgcolor: expandedKey === rowKey ? O2D.brand : alpha(O2D.brand, 0.1),
                                    color: expandedKey === rowKey ? '#fff' : O2D.brand,
                                    '& .MuiChip-icon': { color: 'inherit' },
                                  }}
                                />
                              </Tooltip>
                            ) : <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>—</Typography>}
                          </TableCell>
                        )}
                        <TableCell><Typography noWrap sx={{ fontSize: '0.82rem' }}>{p.partyName || '—'}</Typography></TableCell>
                        <TableCell><Typography sx={{ fontSize: '0.82rem' }}>{dc?.poNumber || p.poNumber || '—'}</Typography></TableCell>
                        {extraCols.map((col) => (
                          <TableCell key={col.key}>{extraCellNode(dc, col.key)}</TableCell>
                        ))}
                        {isPerDcStep && dcCols.map((col) => {
                          const val = dcCellValue(dc, col.key);
                          const isBal = col.key === 'balance' && dc?.invoice;
                          const byTip = col.key === 'ts' && dc?.createdByName ? `by ${dc.createdByName}` : '';
                          return (
                            <TableCell key={col.key}>
                              <Tooltip title={byTip || (col.key === 'sku' && val !== '—' ? val : '')} arrow
                                disableHoverListener={!byTip && !(col.key === 'sku' && val !== '—')}>
                                <Typography noWrap sx={{
                                  fontSize: '0.78rem',
                                  maxWidth: col.key === 'sku' ? 220 : undefined,
                                  fontWeight: col.key === 'dcNumber' && val !== '—' ? 700 : 400,
                                  color: val === '—' ? O2D.faint
                                    : isBal ? (dc.invoice.balance > 0 ? '#dc2626' : '#15803d')
                                      : O2D.body,
                                }}>{val}</Typography>
                              </Tooltip>
                            </TableCell>
                          );
                        })}
                        {fieldCols.map((label) => {
                          const f = (s.formFields || []).find((x) => x.label === label);
                          const val = f?.value == null || f.value === ''
                            ? '—'
                            : f.fieldType === 'DATE' ? fmtDate(f.value)
                              : f.fieldType === 'NUMBER' ? Number(f.value).toLocaleString('en-IN')
                                : String(f.value);
                          return (
                            <TableCell key={label}>
                              <Tooltip title={f?.filledByName ? `${f.filledByName} · ${fmtDT(f.filledAt)}` : ''} arrow disableHoverListener={!f?.filledByName}>
                                <Typography sx={{ fontSize: '0.8rem', color: val === '—' ? O2D.faint : O2D.body }}>{val}</Typography>
                              </Tooltip>
                            </TableCell>
                          );
                        })}
                        <TableCell>
                          {dc ? (<>
                            {/* Per-challan status — THIS challan's own progress on
                                the active step; hover for the full story (who,
                                when, phase, remark). */}
                            <Tooltip arrow title={rowDone
                              ? `Done${dcState?.by ? ` by ${dcState.by}` : ''}${dcState?.at ? ` · ${fmtDT(dcState.at)}` : ''}${dc.phaseNo ? ` · Phase ${dc.phaseNo}` : ''}${dc.remark ? ` · ${dc.remark}` : ''}`
                              : `${dc.dcNumber} is still waiting on this step${dc.phaseNo ? ` · Phase ${dc.phaseNo}` : ''}`}>
                            <Chip size="small" icon={rowDone ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}
                              label={rowDone ? 'Done' : 'Pending'}
                              sx={{
                                height: 24, fontWeight: 700, borderRadius: '999px',
                                color: rowDone ? '#15803d' : '#64748b',
                                bgcolor: rowDone ? '#ecfdf5' : '#f8fafc',
                                border: `1px solid ${rowDone ? '#bbf7d0' : '#e2e8f0'}`,
                                '& .MuiChip-icon': { color: 'inherit', ml: 0.75, mr: -0.25 }, '& .MuiChip-label': { px: 1 },
                              }} />
                            </Tooltip>
                            {rowDone && dcState?.by && (
                              <Typography sx={{ fontSize: '0.68rem', color: O2D.sub, mt: 0.25 }}>by <b>{dcState.by}</b></Typography>
                            )}
                          </>) : firstOfGroup && (<>
                          <Chip size="small" icon={<Icon size={14} />} label={st.label}
                            sx={{
                              height: 24, fontWeight: 700, color: st.color, bgcolor: st.bg,
                              border: `1px solid ${st.border}`, borderRadius: '999px',
                              '& .MuiChip-icon': { color: st.color, ml: 0.75, mr: -0.25 }, '& .MuiChip-label': { px: 1 },
                            }} />
                          {tag && <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: O2D.brand, mt: 0.25 }}>{tag}</Typography>}
                          </>)}
                        </TableCell>
                        {isEmailStep && (
                          <TableCell>
                            {(() => {
                              // Per-challan invoice email (2.08) or the step's own
                              // email audit log (2.05) — latest event wins.
                              const em = dc
                                ? (dc.invoice?.emailStatus ? { status: dc.invoice.emailStatus, at: dc.invoice.emailSentAt } : null)
                                : ((s.emailLog || []).length
                                  ? (({ status, sentAt, to, sentByName, error }) => ({ status, at: sentAt, to, by: sentByName, error }))(s.emailLog[s.emailLog.length - 1])
                                  : null);
                              if (!em) {
                                return (
                                  <Chip size="small" label="Not sent" sx={{
                                    height: 22, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px',
                                    color: '#64748b', bgcolor: '#f8fafc', border: '1px solid #e2e8f0',
                                  }} />
                                );
                              }
                              const ok = em.status === 'SENT';
                              const tip = [em.to ? `To ${em.to}` : '', em.by ? `by ${em.by}` : '', !ok && em.error ? em.error : '']
                                .filter(Boolean).join(' · ');
                              return (<>
                                <Tooltip title={tip} arrow disableHoverListener={!tip}>
                                  <Chip size="small" label={ok ? 'Sent' : 'Failed'} sx={{
                                    height: 22, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px',
                                    color: ok ? '#15803d' : '#dc2626',
                                    bgcolor: ok ? '#ecfdf5' : '#fef2f2',
                                    border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}`,
                                  }} />
                                </Tooltip>
                                <Typography sx={{ fontSize: '0.68rem', color: O2D.sub, mt: 0.25, whiteSpace: 'nowrap' }}>{fmtDT(em.at)}</Typography>
                              </>);
                            })()}
                          </TableCell>
                        )}
                        <TableCell>
                          {firstOfGroup && (
                          <Typography sx={{ fontSize: '0.76rem', whiteSpace: 'nowrap', color: st.key === 'overdue' ? '#dc2626' : O2D.body, fontWeight: st.key === 'overdue' ? 700 : 400 }}>
                            {fmtDT(s.planned)}
                          </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          {dc ? (rowDone ? (<>
                            <Typography sx={{ fontSize: '0.76rem', whiteSpace: 'nowrap', fontWeight: 700, color: '#15803d' }}>
                              {fmtDT(dcState?.at)}
                            </Typography>
                            {dcState?.by && (
                              <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>by {dcState.by}</Typography>
                            )}
                          </>) : <Typography sx={{ fontSize: '0.76rem', color: O2D.faint }}>—</Typography>)
                          : firstOfGroup && (<>
                          <Typography sx={{ fontSize: '0.76rem', whiteSpace: 'nowrap', fontWeight: done ? 700 : 400, color: done ? (late ? '#b45309' : '#15803d') : O2D.faint }}>
                            {fmtDT(s.actual)}
                          </Typography>
                          {done && doneBy && (
                            <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>by {doneBy}</Typography>
                          )}
                          </>)}
                        </TableCell>
                        <TableCell>
                          {firstOfGroup && (done ? (
                            (s.delayMins || 0) > 0
                              ? <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: '#dc2626', whiteSpace: 'nowrap' }}>{fmtDelay(s.delayMins)}</Typography>
                              : <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: '#15803d', whiteSpace: 'nowrap' }}>On time</Typography>
                          ) : <Typography sx={{ fontSize: '0.76rem', color: O2D.faint }}>—</Typography>)}
                        </TableCell>
                        <TableCell>{firstOfGroup && <Typography noWrap sx={{ fontSize: '0.78rem', color: O2D.body }}>{who}</Typography>}</TableCell>
                        {/* Quiet escape hatch to the full task page — checklist, proof,
                            comments and the formal submit still live there. */}
                        <TableCell align="center">
                          <Tooltip title={dc ? `Open task for ${dc.dcNumber} (checklist & submit)` : 'Open task page (checklist & submit)'} arrow>
                            <IconButton size="small" onClick={() => openTask(p, dc)} sx={{ color: O2D.sub, '&:hover': { color: O2D.brand } }}>
                              <ClipboardList size={15} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                        {/* Edit THIS row in place — an Excel-style popup, no
                            redirect. A challan row edits its Delivery Challan;
                            an order row edits the Sales Order basics. */}
                        <TableCell align="center">
                          <Tooltip title={dc ? `Edit ${dc.dcNumber}` : (p.salesOrderId ? 'Edit this order' : 'No sales order linked yet')} arrow>
                            <span>
                              <IconButton
                                size="small" disabled={!dc && !p.salesOrderId}
                                onClick={() => setEditRow({ p, s, dc })}
                                sx={{ color: O2D.brand, '&:hover': { bgcolor: alpha(O2D.brand, 0.08) } }}
                              >
                                <Pencil size={15} />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </TableCell>
                        {canDelete && (
                          <TableCell align="right">
                            <Tooltip
                              title={dc
                                ? `Delete challan ${dc.dcNumber} (this dispatch only)`
                                : (p.salesOrderId ? 'Delete this order (and its whole tracker)' : 'No sales order linked — nothing to delete')}
                              arrow
                            >
                              <span>
                                <IconButton
                                  size="small" disabled={!dc && !p.salesOrderId}
                                  onClick={() => setConfirmRow({ p, dc })}
                                  sx={{ color: 'error.main', '&:hover': { bgcolor: alpha('#dc2626', 0.08) } }}
                                >
                                  <Trash2 size={15} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </TableCell>
                        )}
                      </TableRow>
                      {/* ── Split view — the order's whole dispatch story in one place:
                          plan progress + every Delivery Challan, sheet-style. ── */}
                      {isPerDcStep && expandedKey === rowKey && (
                        <TableRow>
                          <TableCell colSpan={colCount} sx={{ p: 0, bgcolor: alpha(O2D.brand, 0.03), borderBottom: `2px solid ${alpha(O2D.brand, 0.25)}` }}>
                            <Collapse in appear>
                              <Box sx={{ px: 2, py: 1.5 }}>
                                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: O2D.ink }}>
                                    {p.soNumber} — dispatch split
                                  </Typography>
                                  {s.dispatchProgress && (<>
                                    <Chip size="small" label={`Ordered ${fmtNum(s.dispatchProgress.orderedQty)}`}
                                      sx={{ height: 22, fontWeight: 700, fontSize: '0.7rem', bgcolor: '#f1f5f9', color: O2D.sub }} />
                                    <Chip size="small" label={`Dispatched ${fmtNum(s.dispatchProgress.dispatchedQty)} (${s.dispatchProgress.pct || 0}%)`}
                                      sx={{ height: 22, fontWeight: 700, fontSize: '0.7rem', bgcolor: alpha(O2D.brand, 0.1), color: O2D.brand }} />
                                    {s.dispatchProgress.phasesTotal > 0 && (
                                      <Chip size="small" label={`Phases ${s.dispatchProgress.phasesDone}/${s.dispatchProgress.phasesTotal}`}
                                        sx={{ height: 22, fontWeight: 700, fontSize: '0.7rem', bgcolor: '#ecfdf5', color: '#15803d' }} />
                                    )}
                                  </>)}
                                </Stack>
                                <Table size="small" sx={{
                                  bgcolor: O2D.surface, borderRadius: '6px', overflow: 'hidden',
                                  border: `1px solid ${O2D.line}`,
                                  '& td, & th': { borderColor: O2D.lineSoft, fontSize: '0.76rem' },
                                  '& thead th': { bgcolor: O2D.surfaceAlt, fontWeight: 800, fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: O2D.sub },
                                }}>
                                  <TableHead>
                                    <TableRow>
                                      <TableCell>#</TableCell><TableCell>Phase</TableCell><TableCell>DC Number</TableCell>
                                      <TableCell>Date</TableCell><TableCell>SKU</TableCell><TableCell>Qty</TableCell>
                                      <TableCell>Invoice No.</TableCell><TableCell>Invoice Amt</TableCell>
                                      <TableCell>Transporter</TableCell><TableCell>L.R. No.</TableCell><TableCell>By</TableCell>
                                    </TableRow>
                                  </TableHead>
                                  <TableBody>
                                    {(dcBySo.get(p.soNumber) || []).map((d, i) => (
                                      <TableRow key={String(d.dcId)} sx={String(d.dcId) === String(dc?.dcId) ? { bgcolor: alpha(O2D.brand, 0.06) } : undefined}>
                                        <TableCell>{i + 1}</TableCell>
                                        <TableCell>{d.phaseNo || '—'}</TableCell>
                                        <TableCell sx={{ fontWeight: 700 }}>{d.dcNumber}</TableCell>
                                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDT(d.dcDate)}</TableCell>
                                        <TableCell>{d.skuNames?.join(' / ') || '—'}</TableCell>
                                        <TableCell>{d.skuQtys?.length ? d.skuQtys.map(fmtNum).join(' / ') : fmtNum(d.totalQty)}</TableCell>
                                        <TableCell>{d.invoice?.invoiceNo || '—'}</TableCell>
                                        <TableCell>{d.invoice ? fmtAmt(d.invoice.amount) : '—'}</TableCell>
                                        <TableCell>{d.transporterName || '—'}</TableCell>
                                        <TableCell>{d.lrNo || '—'}</TableCell>
                                        <TableCell>{d.createdByName || '—'}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Box>
          {/* Bulk-send bar — only on the email step, only once something is ticked.
              Sticky to the bottom so the count stays visible while scrolling a
              long register. */}
          {isEmailStep && selected.length > 0 && (
            <Stack
              direction="row"
              alignItems="center"
              spacing={1.25}
              sx={{
                position: 'sticky', bottom: 0, zIndex: 4,
                px: 1.75, py: 1.15,
                bgcolor: alpha(O2D.brand, 0.06),
                borderTop: `1px solid ${alpha(O2D.brand, 0.25)}`,
                backdropFilter: 'blur(3px)',
              }}
            >
              <Chip
                size="small"
                label={selected.length}
                sx={{ height: 24, minWidth: 30, fontWeight: 900, fontSize: '0.75rem', bgcolor: O2D.brand, color: '#fff' }}
              />
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: O2D.ink }}>
                {bulkKind === 'invoice'
                  ? `challan${selected.length === 1 ? '' : 's'} selected`
                  : `order${selected.length === 1 ? '' : 's'} selected`}
              </Typography>
              <Button size="small" onClick={() => setSelected([])} sx={{ fontWeight: 700, textTransform: 'none', color: O2D.sub }}>
                Clear
              </Button>
              <Box sx={{ flex: 1 }} />
              <Button
                variant="contained"
                size="small"
                startIcon={<Mail size={15} />}
                onClick={() => setBulkOpen(true)}
                sx={{ fontWeight: 800, textTransform: 'none', borderRadius: '8px', boxShadow: 'none' }}
              >
                Send {selected.length} email{selected.length === 1 ? '' : 's'}
              </Button>
            </Stack>
          )}

          <TablePagination
            component="div"
            count={displayRows.length}
            page={page}
            onPageChange={(_, pg) => setPage(pg)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => setRowsPerPage(parseInt(e.target.value, 10))}
            rowsPerPageOptions={[25, 50, 100]}
            labelRowsPerPage="Orders per page:"
          />
        </Paper>

        {/* ── Colour map — what every colour on this board means, always in
            sight at the bottom of the screen. ── */}
        <Paper elevation={0} sx={{
          position: 'sticky', bottom: 8, zIndex: 4, borderRadius: '8px',
          border: `1px solid ${O2D.line}`, bgcolor: O2D.surface, px: 1.5, py: 0.75,
          boxShadow: '0 -2px 12px rgba(15,23,42,0.08)',
        }}>
          <Stack direction="row" spacing={1.75} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography sx={{ fontSize: '0.64rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', color: O2D.faint, flexShrink: 0 }}>
              Colour map
            </Typography>
            {[
              ['#1d4ed8', 'Blue button — work to do (opens the form)'],
              ['#15803d', 'Green — done / on time (opens the record)'],
              ['#b45309', 'Amber — done, but late'],
              ['#2563eb', 'Blue chip — in progress'],
              ['#64748b', 'Grey — pending, not started'],
              ['#dc2626', 'Red — overdue / delay / amount outstanding'],
            ].map(([c, label]) => (
              <Stack key={label} direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: c }} />
                <Typography sx={{ fontSize: '0.7rem', color: O2D.body, whiteSpace: 'nowrap' }}>{label}</Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>

      {isEmailStep && (
        <BulkEmailDialog
          open={bulkOpen}
          kind={bulkKind}
          targets={selected}
          // Selection survives the whole review session — including a partial
          // failure — and is only dropped once the dialog is dismissed.
          onClose={() => { setBulkOpen(false); setSelected([]); }}
          onSent={() => refetch?.()}
        />
      )}
      </Box>

      {/* In-place row editor — Excel-style popup, saves without leaving the board. */}
      <BoardRowEditDialog row={editRow} onClose={() => setEditRow(null)} />

      {/* Delete confirmation — deleting removes the sales order AND its whole
          FMS tracker (server-side cascade), so spell that out before acting. */}
      <Dialog open={!!confirmRow} onClose={() => !deleting && setConfirmRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800, fontSize: '1rem' }}>
          {confirmRow?.dc ? 'Delete this challan?' : 'Delete this order?'}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.85rem', color: O2D.body }}>
            {confirmRow?.dc ? (
              <>
                Delivery challan <b>{confirmRow.dc.dcNumber}</b> will be deleted. The sales
                order <b>{confirmRow?.p?.soNumber}</b> and its other dispatches are not affected.
                This cannot be undone.
              </>
            ) : (
              <>
                <b>{confirmRow?.p?.soNumber || 'This order'}</b>
                {confirmRow?.p?.partyName ? ` — ${confirmRow.p.partyName}` : ''} will be deleted along with its
                complete O2D tracker (all steps, entries and history). This cannot be undone.
              </>
            )}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmRow(null)} disabled={deleting} sx={{ textTransform: 'none', fontWeight: 700 }}>
            Cancel
          </Button>
          <Button
            variant="contained" color="error" disableElevation disabled={deleting}
            startIcon={<Trash2 size={14} />} onClick={handleDelete}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px' }}
          >
            {deleting ? 'Deleting…' : (confirmRow?.dc ? 'Delete challan' : 'Delete order')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default O2dStepBoard;
