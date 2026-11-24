import React, { useMemo, useState, useEffect, useTransition } from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, TextField, InputAdornment, TablePagination, alpha, Collapse,
  Button, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions,
  Autocomplete, Checkbox, CircularProgress, Link as MuiLink,
} from '@mui/material';
import {
  Search, Workflow, CheckCircle2, Clock, AlertTriangle, CircleDashed,
  Plus, Trash2, ArrowRight, ClipboardList, ExternalLink, User, CalendarClock, Pencil, Layers, Mail, Ban, RotateCcw,
  Send,
} from 'lucide-react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import { useGetProcessesQuery, useGetBoardConsignmentsQuery, useGetO2dDoerPlanQuery } from '../../store/api/o2dFmsApi';
import { useDeleteOrderMutation } from '../../store/api/orderApi';
import { FLUENT, primaryBtnSx, fluentTableSx } from '../ims/imsFluent';
import { LoadErrorNote, CapNote, O2dPage, O2dStatusPill, CardStripSkeleton, TableSkeleton } from './components/O2dUi';
import {
  useDeleteChallanMutation, useCancelChallanMutation, useRestoreChallanMutation,
} from '../../store/api/dispatchControlApi';
import { usePermissions } from '../../hooks/usePermission';
import { resolveActionLink, resolveEntityLink, actionLinkMeta } from './actionLinks';
import BoardRowEditDialog from './BoardRowEditDialog';
import BulkEmailDialog from './BulkEmailDialog';
import OrderEntryDrawer from '../orders/OrderEntryDrawer';
import { O2D } from './o2dTheme';
import { StepCard, stepTone, stepIcon, STEP_RAIL_SX, useStepRail } from './components/O2dStepCard';
import { useHiddenSteps, useO2dRights, stepKey } from '../../utils/embed';

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

// How many orders the board loads (unchanged); shown when the list reaches it.
const BOARD_LIMIT = 300;

// One visual state per step-row, in work-priority order (lower = more urgent).
const stepState = (s) => {
  if (['DONE', 'DELAYED'].includes(s.status)) {
    return { key: 'done', rank: 3, tone: s.status === 'DELAYED' ? 'amber' : 'green', label: s.status === 'DELAYED' ? 'Completed (late)' : 'Completed', color: s.status === 'DELAYED' ? '#b45309' : '#15803d', bg: s.status === 'DELAYED' ? '#fffbeb' : '#ecfdf5', border: s.status === 'DELAYED' ? '#fde68a' : '#bbf7d0', Icon: CheckCircle2 };
  }
  if (s.isOverdue) return { key: 'overdue', rank: 0, tone: 'rose', label: 'Overdue', color: '#dc2626', bg: '#fef2f2', border: '#fecaca', Icon: AlertTriangle };
  if (s.status === 'IN_PROGRESS') return { key: 'progress', rank: 1, tone: 'blue', label: 'In Progress', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe', Icon: Clock };
  return { key: 'pending', rank: 2, tone: 'grey', label: 'Pending', color: '#64748b', bg: '#f8fafc', border: '#e2e8f0', Icon: CircleDashed };
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
// The Sales Order detail page — one path for the SO Number link and Order Entry.
const orderPath = (p) => resolveEntityLink('ORDER_ENTRY', ctxOf(p))?.to;

// Actions that should NOT appear as board links. 2.03 Check Inventory is a
// physical job — the doer checks stock and marks the step done right here;
// bouncing them to the PPC planning screen was pure friction.
const BOARD_HIDDEN_ACTIONS = ['PPC'];
const boardKeysOf = (s) => stepKeysOf(s).filter((k) => !BOARD_HIDDEN_ACTIONS.includes(k));

// "Order Entry" IS the work only while the order is not punched in yet (1.01).
// Once it exists (2.02 Tally check and later) it would just reopen that order,
// so the row offers "Do Task" instead — the step page: checklist, Mark Done.
const isWorkAction = (p, key) => !(key === 'ORDER_ENTRY' && p.salesOrderId);

// PENDING rows: the step's "do the work" links — the form opens directly.
const rowDoLinks = (p, s) => boardKeysOf(s)
  .filter((key) => isWorkAction(p, key))
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
      // Order Entry opens the Sales Order's own detail page — the same page the
      // SO Number link opens — whatever link was captured when it was done.
      const candidates = ['DISPATCH_PLAN_PDF', 'CHALLAN_PDF'].includes(key)
        ? [resolveActionLink(key, ctx), ap?.link, resolveEntityLink(key, ctx)?.to].filter(Boolean)
        : key === 'ORDER_ENTRY'
          ? [resolveEntityLink(key, ctx)?.to, ap?.link, resolveActionLink(key, ctx)].filter(Boolean)
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
  { value: 'progress', label: 'In Progress' },
  { value: 'pending',  label: 'Pending' },
  { value: 'done',     label: 'Completed' },
];

const fmtNum = (n) => Number(n || 0).toLocaleString('en-IN');

// Step cards, icons, colours and rail: components/O2dStepCard.jsx (shared with
// O2D Master Data).

// ── Table text + row buttons — one scale for the whole register ─────────────
// Values 0.8rem, captions ("by …", tags) 0.7rem, the IMS table sizes.
const TXT = { fontSize: '0.8rem', color: O2D.body };
const CAP = { fontSize: '0.7rem', color: O2D.sub };
// Row action buttons: 28px, 8px corners. Pending = the brand primary; done =
// the record link in pastel green; `tone` for Cancel (rose) / Restore (green).
const rowBtnSx = (kind = 'do') => ({
  height: 28, minWidth: 0, px: 1.1, borderRadius: '8px', boxShadow: 'none',
  textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', whiteSpace: 'nowrap',
  '& .MuiButton-startIcon, & .MuiButton-endIcon': { ml: 0.4, mr: 0.4 },
  ...(kind === 'do' && { bgcolor: O2D.brand, color: '#fff', '&:hover': { bgcolor: '#1e40af', boxShadow: 'none' } }),
  ...(kind !== 'do' && (() => {
    const t = FLUENT[kind === 'done' ? 'green' : kind];
    return { color: t.accent, borderColor: t.border, bgcolor: t.bg, '&:hover': { borderColor: t.accent, bgcolor: t.tint } };
  })()),
});
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
  // A cancelled dispatch cancels everything downstream of it. Checked first so
  // the row never shows "pending work" for a consignment nobody will ship.
  if (dc.cancelled) {
    return { done: false, cancelled: true, at: dc.cancelledAt, by: dc.cancelledByName, reason: dc.cancelReason };
  }
  const log = dc.log?.[step.code];
  if (log?.status === 'CANCELLED') {
    return { done: false, cancelled: true, at: log.doneAt, by: log.doneByName };
  }
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

// The step-column chips speak the shared pill (red reads as the rose pastel).
const MINI_TONE = { green: 'green', red: 'rose', amber: 'amber', grey: 'grey' };
const MiniChip = ({ label, tone = 'grey' }) => <O2dStatusPill label={label} tone={MINI_TONE[tone] || 'grey'} />;

// Attached S3 documents — one small chip per file, opening in a new tab.
const DocLinks = ({ urls }) => (!urls?.length
  ? <Typography sx={{ fontSize: '0.75rem', color: O2D.faint }}>—</Typography>
  : (
    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
      {urls.map((u, i) => (
        <O2dStatusPill
          key={u} tone="blue" clickable icon={ExternalLink}
          label={urls.length === 1 ? 'Open' : `${i + 1}`}
          onClick={() => window.open(u, '_blank', 'noopener')}
          sx={{ cursor: 'pointer', '&:hover': { bgcolor: FLUENT.blue.border } }}
        />
      ))}
    </Stack>
  ));

const extraDash = <Typography sx={{ ...TXT, color: O2D.faint }}>—</Typography>;
const extraCellNode = (dc, key) => {
  if (!dc) return extraDash;
  const txt = (v, fmt = (x) => x) => (v ? <Typography sx={{ ...TXT, whiteSpace: 'nowrap' }}>{fmt(v)}</Typography> : extraDash);
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
      return <MiniChip label={st === 'DONE' ? 'Completed' : st === 'PENDING' ? 'Pending' : st}
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
  // Order deletion needs `orders.delete` server-side (MD/root, or a Delegation
  // sign-in whose lock icon allows Delete on a step) — hide the button
  // entirely for everyone else instead of showing a dead control.
  const canDeleteOrders = can('orders.delete') || isRoot;
  // Delegation Suite → Employees → lock icon: Edit / Delete per step and the
  // New Sales Order button (no limits when Ambika 2.0 is used on its own).
  const rights = useO2dRights();
  const [deleteChallan, { isLoading: deletingChallan }] = useDeleteChallanMutation();
  const [cancelChallan] = useCancelChallanMutation();
  const [restoreChallan] = useRestoreChallanMutation();
  const [restoringId, setRestoringId] = useState(null);
  const [cancelRow, setCancelRow] = useState(null);   // { p, dc } pending cancel
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [deleteOrder, { isLoading: deletingOrder }] = useDeleteOrderMutation();
  // Either delete in flight keeps the confirm dialog busy (no second click).
  const deleting = deletingOrder || deletingChallan;
  const [confirmRow, setConfirmRow] = useState(null); // { p, dc } pending delete confirmation
  // New Sales Order opens over the board (same drawer as Sales Orders), so
  // Cancel leaves the user here and the sidebar keeps O2D FMS selected.
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [sortBy, setSortBy] = useState('recentFirst');
  const { data, isLoading, isError, error, refetch } = useGetProcessesQuery({ limit: BOARD_LIMIT, sort: '-createdAt', view: 'list' }, { pollingInterval: 60_000, skipPollingIfUnfocused: true });
  const rows = useMemo(() => data?.data || [], [data]);
  // Steps the MD switched off for this employee in the Delegation Suite
  // (empty when Ambika 2.0 is used on its own).
  const hiddenSteps = useHiddenSteps('o2d');
  // FMS → Doer Assignment: each step's main doer, buddy and mandatory flag.
  const { data: planRes } = useGetO2dDoerPlanQuery();
  const planByStep = useMemo(() => new Map((planRes?.data?.steps || []).map((p) => [p.stepCode, {
    ...p,
    // Every main doer / buddy of the step, as one line of names.
    doerNames: (p.doers || []).map((d) => d.name).filter(Boolean).join(', '),
    buddyNames: (p.buddies || []).map((b) => b.name).filter(Boolean).join(', '),
  }])), [planRes]);

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
    // Leave out hidden steps only now, so the fork above still sees them all.
    return hiddenSteps.size ? list.filter((x) => !hiddenSteps.has(stepKey(x.code))) : list;
  }, [rows, hiddenSteps]);

  const activeCode = stepCode && steps.some((s) => s.code === stepCode) ? stepCode : steps[0]?.code;
  // Card click → the step change renders as a transition (the router keeps the
  // old register on screen until the new one is ready). While it is pending the
  // clicked card shows as selected and the register shows a skeleton — never the
  // previous step's rows. isPending ends by itself when the new step commits.
  const [switching, startSwitch] = useTransition();
  const [switchTo, setSwitchTo] = useState(null);
  const goStep = (code) => {
    setSwitchTo(code);
    startSwitch(() => navigate(`/o2d-fms/steps/${encodeURIComponent(code)}`));
  };
  const shownCode = switching && switchTo ? switchTo : activeCode;
  // Rail: centres the selected card; card tooltips stay inside it (never over the sidebar).
  const { railRef, tipProps: cardTipProps } = useStepRail(activeCode, steps.length);
  const activeStep = steps.find((s) => s.code === activeCode);
  // Edit = the pencil + Cancel dispatch; Delete = the bin — on this step's rows.
  const canEdit = rights.canEdit(activeCode);
  const canDelete = canDeleteOrders && rights.canDelete(activeCode);
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
  const { data: consRes } = useGetBoardConsignmentsQuery(undefined, { pollingInterval: 60_000, skipPollingIfUnfocused: true });
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

  const [search, setSearch] = useState('');
  // "All" by default — doers landing on a step must see every order on it,
  // done and pending alike (the sheet shows everything; filters are opt-in).
  const [status, setStatus] = useState('all');
  // Pick one order or one party from a list (empty = all).
  const [soFilter, setSoFilter] = useState(null);
  const [partyFilter, setPartyFilter] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  useEffect(() => { setPage(0); setSelected([]); }, [search, status, soFilter, partyFilter, activeCode, rowsPerPage, sortBy]);

  // The dropdowns' lists: every order on the board (newest first, as loaded)
  // and every party (A–Z).
  const soOptions = useMemo(() => [...new Set(rows.map((p) => p.soNumber).filter(Boolean))], [rows]);
  const partyOptions = useMemo(
    () => [...new Set(rows.map((p) => p.partyName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  // Every step's rows under the CURRENT filters (SO, Party, Search, Show) — one
  // row per order = that order's entry for the step. The selected step's table
  // AND every step card read this same list, so a card's figure is always the
  // number of orders its table lists (filters included).
  const filteredByStep = useMemo(() => {
    const q = search.trim().toLowerCase();
    const perDcOf = new Map(steps.map((x) => [x.code, x.perDc]));
    const out = new Map(steps.map((x) => [x.code, []]));
    rows.forEach((p) => {
      if (soFilter && p.soNumber !== soFilter) return;
      if (partyFilter && p.partyName !== partyFilter) return;
      const seen = new Set();   // an order's FIRST entry for a step (as before)
      (p.steps || []).forEach((s) => {
        const list = out.get(s.stepCode);
        if (!list || seen.has(s.stepCode)) return;
        seen.add(s.stepCode);
        const st = stepState(s);
        if (status === 'open' && st.key === 'done') return;
        if (!['all', 'open'].includes(status) && st.key !== status) return;
        if (q) {
          // On the per-challan steps, DC number / L.R. no also match the search.
          const dcText = perDcOf.get(s.stepCode)
            ? (dcBySo.get(p.soNumber) || []).map((d) => `${d.dcNumber || ''} ${d.lrNo || ''}`).join(' ')
            : '';
          if (!`${p.soNumber || ''} ${p.poNumber || ''} ${p.partyName || ''} ${dcText}`.toLowerCase().includes(q)) return;
        }
        list.push({ p, s, st });
      });
    });
    return out;
  }, [rows, steps, search, status, soFilter, partyFilter, dcBySo]);

  // Card figures: orders listed (= the table), and of those how many are still
  // open and how many overdue — counted from the same rows, nothing else.
  const stepCounts = useMemo(() => {
    const out = {};
    filteredByStep.forEach((list, code) => {
      out[code] = {
        total: list.length,
        open: list.filter(({ st }) => st.key !== 'done').length,
        overdue: list.filter(({ st }) => st.key === 'overdue').length,
      };
    });
    return out;
  }, [filteredByStep]);

  // The selected step's table — latest activity first by default (the
  // chronological FMS register); the doer can re-order it from the toolbar.
  const stepRows = useMemo(
    () => (activeCode ? sortRows(filteredByStep.get(activeCode) || [], sortBy) : []),
    [filteredByStep, activeCode, sortBy],
  );

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

  // Un-cancel: straight action, no confirm dialog — it only puts things back,
  // and the state it restores is the one the user already had.
  const handleRestore = async (dc) => {
    if (!dc?.dcId || restoringId) return;
    setRestoringId(dc.dcId);
    try {
      await restoreChallan(dc.dcId).unwrap();
      enqueueSnackbar(`${dc.dcNumber} restored — it counts as dispatched again.`, { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not restore this dispatch.', { variant: 'error' });
    } finally {
      setRestoringId(null);
    }
  };

  const handleCancel = async () => {
    const dc = cancelRow?.dc;
    if (!dc?.dcId) return;
    setCancelling(true);
    try {
      await cancelChallan({ id: dc.dcId, reason: cancelReason.trim() || undefined }).unwrap();
      setCancelRow(null);
      setCancelReason('');
      enqueueSnackbar(`${dc.dcNumber} cancelled — its quantity is back on the plan.`, { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not cancel this dispatch.', { variant: 'error' });
    } finally {
      setCancelling(false);
    }
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

  // 10 fixed columns + Edit; per-challan steps add Split + Cancel (Cancel goes
  // with Edit).
  const colCount = 10 + (canEdit ? 1 : 0) + fieldCols.length + (canDelete ? 1 : 0)
    + (isPerDcStep ? 1 + (canEdit ? 1 : 0) + dcCols.length : 0) + (isEmailStep ? 1 : 0) + extraCols.length;

  // ── Frozen panes ──
  // Action + SO Number (+ Split on the dispatch step) stay pinned while the
  // wide sheet scrolls left-right, and the header row stays pinned while it
  // scrolls up-down — a row never loses its identity. Fixed widths make the
  // cumulative `left` offsets exact.
  const FROZEN = isPerDcStep ? [{ w: 180 }, { w: 132 }, { w: 84 }] : [{ w: isEmailStep ? 222 : 180 }, { w: 132 }];
  const freezeSx = (i, head = false) => ({
    // Frozen only where there is room for them (1200px and up). Below that ~400px
    // of frozen columns would cover over half the register, so they scroll with the row.
    position: { xs: 'static', lg: 'sticky' },
    left: FROZEN.slice(0, i).reduce((a, c) => a + c.w, 0),
    width: FROZEN[i].w, minWidth: FROZEN[i].w, maxWidth: FROZEN[i].w,
    // Header cells must paint above frozen body cells; frozen body cells above
    // the scrolling ones — but below the sticky header (z 2) passing over them.
    zIndex: head ? 3 : 1,
    ...(head && { bgcolor: '#f2f6fc' }),
    ...(i === FROZEN.length - 1 && {
      borderRight: { lg: '1px solid #dfe7f2' },
      boxShadow: { lg: '4px 0 6px -3px rgba(15,23,42,0.10)' },
    }),
  });

  return (
    <O2dPage
      icon={Workflow}
      title="O2D — Step Board"
      subtitle="Pick a step, see every order on it, click a link to do the work."
      actions={(
        // Row 1, right: the two things that START work — same controls, same handlers.
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ minWidth: 0 }}>
          <Autocomplete
            size="small" options={quickOptions} value={null} blurOnSelect
            sx={{
              width: { xs: '100%', md: 150, lg: 178, xl: 205 }, minWidth: 140, flexShrink: 1,
              // Same 40px / 8px / 0.8rem control as the filter bar below.
              '& .MuiInputBase-root': { minHeight: 40, borderRadius: '8px', fontSize: '0.8rem', bgcolor: '#fff' },
              '& .MuiInputLabel-root': { fontSize: '0.78rem' },
            }}
            getOptionLabel={(o) => o?.label || ''}
            isOptionEqualToValue={() => false}
            onChange={(_, opt) => { if (opt) navigate(`/challans?so=${encodeURIComponent(opt.so)}`); }}
            renderInput={(params) => <TextField {...params} label="Quick dispatch" placeholder="SO / party…" />}
          />
          {rights.canAdd && (
            <Button variant="contained" size="small" disableElevation startIcon={<Plus size={14} />}
              onClick={() => setNewOrderOpen(true)}
              sx={{ ...primaryBtnSx(O2D.brand), flexShrink: 0, px: { md: 1.1, xl: 1.6 } }}>
              <Box component="span" sx={{ display: { xs: 'none', xl: 'inline' } }}>New Sales Order</Box>
              <Box component="span" sx={{ display: { xs: 'inline', xl: 'none' } }}>New Order</Box>
            </Button>
          )}
        </Stack>
      )}
    >
      {/* Row 2 — the filters as one toolbar. A grid, so they line up evenly at
          1280px and stack two-up / one-up on tablets and phones instead of
          squeezing the title (each control keeps its own value and handler). */}
      <Paper elevation={0} data-testid="o2d-board-filters" sx={{ p: 1 }}>
        <Box sx={{
          display: 'grid', gap: 1,
          // Every control the same: 40px, 8px corners, 0.8rem text, label on the border.
          '& .MuiInputBase-root': { minHeight: 40, borderRadius: '8px', fontSize: '0.8rem', bgcolor: '#fff' },
          '& .MuiInputLabel-root': { fontSize: '0.78rem' },
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', lg: '1.15fr 1.15fr 1.4fr 0.95fr 0.8fr' },
          '& > *': { width: '100% !important', minWidth: '0 !important' },
        }}>
          {/* Pick one order / one party — the list below shows only that. */}
          <Autocomplete
            size="small" options={soOptions} value={soFilter} onChange={(_, v) => setSoFilter(v)}
            sx={{ width: { xs: '100%', md: 150, lg: 168, xl: 190 }, minWidth: 120, flexShrink: 1 }}
            renderInput={(params) => <TextField {...params} label="SO Number" placeholder="All orders" InputLabelProps={{ ...params.InputLabelProps, shrink: true }} />}
          />
          <Autocomplete
            size="small" options={partyOptions} value={partyFilter} onChange={(_, v) => setPartyFilter(v)}
            sx={{ width: { xs: '100%', md: 150, lg: 175, xl: 210 }, minWidth: 120, flexShrink: 1 }}
            renderInput={(params) => <TextField {...params} label="Party" placeholder="All parties" InputLabelProps={{ ...params.InputLabelProps, shrink: true }} />}
          />
          <TextField
            size="small" label="Search" placeholder="SO, PO, party, DC, LR…" value={search} InputLabelProps={{ shrink: true }}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ width: { xs: '100%', md: 130, lg: 160, xl: 200 }, minWidth: 110, flexShrink: 1 }}
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
            onChange={(e) => setStatus(e.target.value)} sx={{ width: { xs: '100%', md: 104, xl: 140 }, flexShrink: 0 }}
            SelectProps={{ native: true }} InputLabelProps={{ shrink: true }}
          >
            {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </TextField>
        </Box>
      </Paper>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minWidth: 0 }}>
        {isError && <LoadErrorNote title="Could not load the orders" error={error} onRetry={refetch} compact={!!data} />}
        <CapNote shown={rows.length} cap={BOARD_LIMIT} noun="orders" />
        {/* ── Step rail — the whole flow, left to right, as compact IMS KPI
            cards: the step's open count (unchanged), its state as a pastel
            tone (rose = something overdue, blue = open work, teal = clear),
            and the same click / keyboard navigation to the step. ── */}
        {isLoading ? <CardStripSkeleton count={13} /> : (
          <Box ref={railRef} data-testid="o2d-step-rail" role="group" aria-label="O2D steps" sx={STEP_RAIL_SX}>
            {steps.map((s, idx) => {
              const active = s.code === shownCode;
              const { total = 0, open = 0, overdue: od = 0 } = stepCounts[s.code] || {};
              // Who does this step: the assigned main doer (Doer Assignment), else the SOP owner.
              const plan = planByStep.get(s.code);
              const who = plan?.doerNames || s.ownerName;
              return (
                <Tooltip
                  key={s.code} arrow placement="top" disableInteractive enterDelay={250}
                  slotProps={cardTipProps}
                  title={(
                    <Box data-testid="o2d-step-tip">
                      <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: O2D.brand }}>{s.code} · {s.name}</Typography>
                      <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, mt: 0.25 }}>
                        {total} order{total === 1 ? '' : 's'} · {open} open{od ? ` · ${od} overdue` : ''}
                      </Typography>
                      {who && (
                        <Typography sx={{ fontSize: '0.7rem', color: O2D.sub }}>
                          Who: {who}{plan?.buddyNames ? ` · Buddy: ${plan.buddyNames}` : ''}
                        </Typography>
                      )}
                      {plan?.mandatory === false && <Typography sx={{ fontSize: '0.7rem', color: O2D.sub }}>Optional step — can be skipped</Typography>}
                      {s.whenText && <Typography sx={{ fontSize: '0.7rem', color: O2D.sub }}>When: {s.whenText}</Typography>}
                    </Box>
                  )}
                >
                <StepCard
                    data-step={s.code} data-active={active ? 'true' : undefined}
                    testId={`o2d-step-card-${s.code}`}
                    code={s.code} name={s.name}
                    // Orders this step's table lists under the current filters.
                    // Step number as the figure; the count in the red O2D alert badge.
                    badge={total}
                    tone={stepTone(idx)}
                    icon={stepIcon(s.code)}
                    active={active}
                    onClick={() => goStep(s.code)}
                />
                </Tooltip>
              );
            })}
          </Box>
        )}

        {/* ── The selected step's orders — flat table, left to right ── */}
        <Paper elevation={0} data-testid="o2d-board-register" sx={{ borderRadius: '10px', overflow: 'hidden', bgcolor: O2D.surface }}>
          {switching ? (
            <Box data-testid="o2d-board-switching">
              <Box sx={{ px: { xs: 1.25, md: 1.75 }, py: 1.1, bgcolor: FLUENT.blue.bg, borderBottom: `1px solid ${FLUENT.blue.border}` }}>
                <TableSkeleton rows={0} columns={4} sx={{ bgcolor: 'transparent', '& > div:first-of-type': { bgcolor: 'transparent', borderBottom: 0, px: 0, height: 30 } }} />
              </Box>
              <TableSkeleton rows={8} columns={7} />
            </Box>
          ) : (<>
          {activeStep && (
            /* Step info bar — the register's header band (the IMS ledger band):
               What · Who · When on the left, the step's totals on the right. */
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap data-testid="o2d-step-info"
              sx={{ px: { xs: 1.25, md: 1.75 }, py: 1.1, bgcolor: FLUENT.blue.bg, borderBottom: `1px solid ${FLUENT.blue.border}` }}>
              <Box sx={{ width: 30, height: 30, borderRadius: '8px', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: '#fff', color: FLUENT.blue.accent, border: `1px solid ${FLUENT.blue.border}` }}>
                <Workflow size={15} />
              </Box>
              <Typography component="h2" sx={{ fontSize: '0.92rem', fontWeight: 800, color: FLUENT.blue.ink, mr: 0.5 }}>{activeStep.code} · {activeStep.name}</Typography>
              {(planByStep.get(activeStep.code)?.doerNames || activeStep.ownerName) && (
                <Tooltip title="Main doers — any one of them can complete this step">
                  <span><O2dStatusPill tone="blue" icon={User} label={planByStep.get(activeStep.code)?.doerNames || activeStep.ownerName} /></span>
                </Tooltip>
              )}
              {planByStep.get(activeStep.code)?.buddyNames && (
                <O2dStatusPill tone="grey" label={`Buddy: ${planByStep.get(activeStep.code).buddyNames}`} />
              )}
              {planByStep.get(activeStep.code)?.mandatory === false && <O2dStatusPill tone="amber" label="Optional" />}
              {activeStep.whenText && <O2dStatusPill tone="grey" icon={CalendarClock} label={activeStep.whenText} />}
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ ml: 'auto' }}>
                <Typography sx={{ fontSize: '0.74rem', color: O2D.sub, whiteSpace: 'nowrap' }}>
                  <b style={{ color: O2D.ink }}>{stepRows.length}</b> order{stepRows.length === 1 ? '' : 's'}
                  {isPerDcStep && (() => { const n = displayRows.filter((r) => r.dc).length; return n > 0
                    ? <Box component="span"> · <b style={{ color: O2D.ink }}>{n}</b> dispatch{n === 1 ? '' : 'es'}</Box> : null; })()}
                </Typography>
                {overdueOnStep > 0 && <O2dStatusPill tone="rose" icon={AlertTriangle} label={`${overdueOnStep} overdue`} />}
              </Stack>
            </Stack>
          )}
          {/* Desktop: the register scrolls inside its panel under a sticky header.
              Phone: the page scrolls (no box-in-a-box). */}
          <Box sx={{ overflow: 'auto', maxHeight: { xs: 'none', md: 'max(360px, calc(100vh - 330px))' } }}>
            {isLoading ? <TableSkeleton rows={8} columns={7} /> : (
              <Table size="small" stickyHeader data-testid="o2d-board-table" sx={{
                // The shared Fluent table (soft-blue header, airy rows, clear hover).
                ...fluentTableSx(1000, { zebra: false }),
                '& tbody td': { fontSize: '0.8rem', color: O2D.body, py: 1, verticalAlign: 'middle' },
                // Frozen body cells need an opaque background (rows scroll under
                // them) that still follows the row's hover tint.
                '& tbody td.frozenCell': { bgcolor: O2D.surface },
                '& tbody tr:hover td.frozenCell': { bgcolor: '#f1f6fe' },
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
                    {isPerDcStep && <TableCell align="center" sx={{ ...freezeSx(2, true), px: 0.75 }}>Split</TableCell>}
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
                    {isPerDcStep && canEdit && <TableCell align="center" sx={{ width: 74 }}>Cancel</TableCell>}
                    {canEdit && <TableCell align="center" sx={{ width: 52 }}>Edit</TableCell>}
                    {canDelete && <TableCell align="right" sx={{ width: 56 }}>Delete</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stepRows.length === 0 ? (
                    <TableRow><TableCell colSpan={colCount} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                      {rows.length === 0 ? (isError ? 'The orders could not be loaded — see the note above.' : 'No orders yet.') : 'No orders match on this step.'}
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
                    const rowCancelled = !!dcState?.cancelled;
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
                      <TableRow
                        hover
                        sx={rowCancelled ? {
                          // Neutral grey ground so a cancelled dispatch is obvious at a
                          // glance without hiding it — the row stays as the record and
                          // its "Cancelled" chip carries the meaning (no red wash).
                          bgcolor: FLUENT.grey.bg,
                          '& .frozenCell': { bgcolor: FLUENT.grey.tint },
                          '&:hover': { bgcolor: FLUENT.grey.tint },
                        } : undefined}
                      >
                        <TableCell className="frozenCell" sx={freezeSx(0)}>
                          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" alignItems="center">
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
                                  sx={rowBtnSx('do')}
                                >
                                  Do Task
                                </Button>
                              ) : <Typography sx={{ ...TXT, color: O2D.faint }}>—</Typography>
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
                                  sx={rowBtnSx(rowDone ? 'done' : 'do')}
                                >
                                  {a.label}
                                </Button>
                              </Tooltip>
                              );
                            })}
                          </Stack>
                        </TableCell>
                        <TableCell className="frozenCell" sx={freezeSx(1)}>
                          {p.salesOrderId && p.soNumber ? (
                            // Opens the Sales Order's detail page — the same page as
                            // the Order Entry link. A real link: Ctrl-click / new tab work.
                            <Tooltip title="Open this sales order" arrow>
                              <MuiLink
                                component={RouterLink} to={orderPath(p)} underline="hover"
                                data-testid="o2d-board-so-link"
                                sx={{ ...TXT, fontWeight: firstOfGroup ? 700 : 600, color: firstOfGroup ? FLUENT.blue.accent : O2D.sub, fontVariantNumeric: 'tabular-nums', '&:hover': { color: FLUENT.blue.accent } }}
                              >
                                {p.soNumber}
                              </MuiLink>
                            </Tooltip>
                          ) : (
                            <Typography sx={{ ...TXT, fontWeight: firstOfGroup ? 700 : 500, color: firstOfGroup ? O2D.ink : O2D.sub, fontVariantNumeric: 'tabular-nums' }}>
                              {p.soNumber || '—'}
                            </Typography>
                          )}
                        </TableCell>
                        {isPerDcStep && (
                          <TableCell align="center" className="frozenCell" sx={{ ...freezeSx(2), px: 0.75 }}>
                            {splitTotal > 0 ? (
                              <Tooltip title={`${splitTotal} dispatch${splitTotal === 1 ? '' : 'es'} for this order — click for the full split view`} arrow>
                                <O2dStatusPill
                                  tone="blue" icon={Layers} label={`${splitIndex}/${splitTotal}`} clickable
                                  aria-expanded={expandedKey === rowKey}
                                  onClick={() => setExpandedKey(expandedKey === rowKey ? null : rowKey)}
                                  sx={{
                                    cursor: 'pointer', fontVariantNumeric: 'tabular-nums',
                                    ...(expandedKey === rowKey && { bgcolor: FLUENT.blue.accent, color: '#fff', borderColor: FLUENT.blue.accent, '& .MuiChip-icon': { color: '#fff' } }),
                                  }}
                                />
                              </Tooltip>
                            ) : <Typography sx={{ ...TXT, color: O2D.faint }}>—</Typography>}
                          </TableCell>
                        )}
                        <TableCell sx={{ maxWidth: 240 }}>
                          <Typography noWrap title={p.partyName || undefined} sx={{ ...TXT, color: O2D.ink, fontWeight: 600 }}>{p.partyName || '—'}</Typography>
                        </TableCell>
                        <TableCell><Typography sx={{ ...TXT, whiteSpace: 'nowrap' }}>{dc?.poNumber || p.poNumber || '—'}</Typography></TableCell>
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
                                  ...TXT,
                                  maxWidth: col.key === 'sku' ? 220 : undefined,
                                  fontWeight: col.key === 'dcNumber' && val !== '—' ? 700 : 400,
                                  color: val === '—' ? O2D.faint
                                    : isBal ? (dc.invoice.balance > 0 ? FLUENT.orange.accent : '#15803d')
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
                                <Typography sx={{ ...TXT, color: val === '—' ? O2D.faint : O2D.body }}>{val}</Typography>
                              </Tooltip>
                            </TableCell>
                          );
                        })}
                        <TableCell>
                          {dc ? (<>
                            {/* Per-challan status — THIS challan's own progress on
                                the active step; hover for the full story (who,
                                when, phase, remark). */}
                            <Tooltip arrow title={rowCancelled
                              ? `${dc.dcNumber} was cancelled${dcState?.by ? ` by ${dcState.by}` : ''}${dcState?.at ? ` · ${fmtDT(dcState.at)}` : ''}${dcState?.reason ? ` · ${dcState.reason}` : ''} — its quantity no longer counts as dispatched.`
                              : rowDone
                                ? `Done${dcState?.by ? ` by ${dcState.by}` : ''}${dcState?.at ? ` · ${fmtDT(dcState.at)}` : ''}${dc.phaseNo ? ` · Phase ${dc.phaseNo}` : ''}${dc.remark ? ` · ${dc.remark}` : ''}`
                                : `${dc.dcNumber} is still waiting on this step${dc.phaseNo ? ` · Phase ${dc.phaseNo}` : ''}`}>
                            <span><O2dStatusPill
                              tone={rowCancelled ? 'grey' : rowDone ? 'green' : 'grey'}
                              icon={rowCancelled ? Ban : rowDone ? CheckCircle2 : CircleDashed}
                              label={rowCancelled ? 'Cancelled' : rowDone ? 'Completed' : 'Pending'} /></span>
                            </Tooltip>
                            {(rowCancelled || rowDone) && dcState?.by && (
                              <Typography sx={{ ...CAP, mt: 0.25 }}>by <b>{dcState.by}</b></Typography>
                            )}
                          </>) : firstOfGroup && (<>
                          <O2dStatusPill tone={st.tone} icon={Icon} label={st.label} />
                          {tag && <Typography sx={{ ...CAP, fontWeight: 700, color: FLUENT.blue.accent, mt: 0.25 }}>{tag}</Typography>}
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
                                  <O2dStatusPill tone="grey" label="Not sent" />
                                );
                              }
                              const ok = em.status === 'SENT';
                              const tip = [em.to ? `To ${em.to}` : '', em.by ? `by ${em.by}` : '', !ok && em.error ? em.error : '']
                                .filter(Boolean).join(' · ');
                              return (<>
                                <Tooltip title={tip} arrow disableHoverListener={!tip}>
                                  <span><O2dStatusPill tone={ok ? 'green' : 'rose'} label={ok ? 'Sent' : 'Failed'} /></span>
                                </Tooltip>
                                <Typography sx={{ ...CAP, mt: 0.25, whiteSpace: 'nowrap' }}>{fmtDT(em.at)}</Typography>
                              </>);
                            })()}
                          </TableCell>
                        )}
                        <TableCell>
                          {firstOfGroup && (
                          <Typography sx={{ ...TXT, whiteSpace: 'nowrap', color: st.key === 'overdue' ? FLUENT.rose.accent : O2D.body, fontWeight: st.key === 'overdue' ? 700 : 400 }}>
                            {fmtDT(s.planned)}
                          </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          {dc ? (rowDone ? (<>
                            <Typography sx={{ ...TXT, whiteSpace: 'nowrap', fontWeight: 700, color: FLUENT.green.accent }}>
                              {fmtDT(dcState?.at)}
                            </Typography>
                            {dcState?.by && (
                              <Typography sx={CAP}>by {dcState.by}</Typography>
                            )}
                          </>) : <Typography sx={{ ...TXT, color: O2D.faint }}>—</Typography>)
                          : firstOfGroup && (<>
                          <Typography sx={{ ...TXT, whiteSpace: 'nowrap', fontWeight: done ? 700 : 400, color: done ? (late ? FLUENT.amber.accent : FLUENT.green.accent) : O2D.faint }}>
                            {fmtDT(s.actual)}
                          </Typography>
                          {done && doneBy && (
                            <Typography sx={CAP}>by {doneBy}</Typography>
                          )}
                          </>)}
                        </TableCell>
                        <TableCell>
                          {firstOfGroup && (done ? (
                            (s.delayMins || 0) > 0
                              ? <O2dStatusPill tone="amber" label={fmtDelay(s.delayMins)} />
                              : <O2dStatusPill tone="green" label="On time" />
                          ) : <Typography sx={{ ...TXT, color: O2D.faint }}>—</Typography>)}
                        </TableCell>
                        <TableCell sx={{ maxWidth: 200 }}>{firstOfGroup && <Typography noWrap title={who} sx={TXT}>{who}</Typography>}</TableCell>
                        {/* Quiet escape hatch to the full task page — checklist, proof,
                            comments and the formal submit still live there. */}
                        <TableCell align="center">
                          <Tooltip title={dc ? `Open task for ${dc.dcNumber} (checklist & submit)` : 'Open task page (checklist & submit)'} arrow>
                            <IconButton size="small" aria-label={dc ? `Open task for ${dc.dcNumber}` : `Open task for ${p.soNumber || 'this order'}`} onClick={() => openTask(p, dc)} sx={{ color: O2D.sub, '&:hover': { color: O2D.brand } }}>
                              <ClipboardList size={15} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                        {/* Cancel THIS dispatch. Not a delete: the row stays, the
                            quantity goes back to the plan, and 2.06→2.13 for this
                            challan all read cancelled. Already-cancelled rows show
                            a static marker instead of a second button. */}
                        {isPerDcStep && canEdit && (
                          <TableCell align="center">
                            {!dc ? <Typography sx={{ ...TXT, color: O2D.faint }}>—</Typography>
                              : rowCancelled ? (
                                <Tooltip arrow title={`Cancelled${dcState?.by ? ` by ${dcState.by}` : ''}${dcState?.reason ? ` · ${dcState.reason}` : ''} — click to undo: the quantity counts as dispatched again and steps 2.06→2.13 return to their real state.`}>
                                  <span>
                                    <Button
                                      size="small" variant="outlined"
                                      disabled={restoringId === dc.dcId}
                                      startIcon={restoringId === dc.dcId ? <CircularProgress size={11} /> : <RotateCcw size={12} />}
                                      onClick={() => handleRestore(dc)}
                                      sx={rowBtnSx('green')}
                                    >
                                      Restore
                                    </Button>
                                  </span>
                                </Tooltip>
                              ) : (
                                <Tooltip arrow title={`Cancel dispatch ${dc.dcNumber} — its quantity returns to the plan and every later step is cancelled`}>
                                  <Button
                                    size="small" variant="outlined"
                                    startIcon={<Ban size={12} />}
                                    onClick={() => { setCancelReason(''); setCancelRow({ p, dc }); }}
                                    sx={rowBtnSx('rose')}
                                  >
                                    Cancel
                                  </Button>
                                </Tooltip>
                              )}
                          </TableCell>
                        )}
                        {/* Edit THIS row in place — an Excel-style popup, no
                            redirect. A challan row edits its Delivery Challan;
                            an order row edits the Sales Order basics. */}
                        {canEdit && (
                          <TableCell align="center">
                            <Tooltip title={dc ? `Edit ${dc.dcNumber}` : (p.salesOrderId ? 'Edit this order' : 'No sales order linked yet')} arrow>
                              <span>
                                <IconButton
                                  size="small" disabled={!dc && !p.salesOrderId}
                                  aria-label={dc ? `Edit ${dc.dcNumber}` : 'Edit this order'}
                                  onClick={() => setEditRow({ p, s, dc })}
                                  sx={{ color: O2D.brand, '&:hover': { bgcolor: alpha(O2D.brand, 0.08) } }}
                                >
                                  <Pencil size={15} />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </TableCell>
                        )}
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
                                  aria-label={dc ? `Delete challan ${dc.dcNumber}` : 'Delete this order'}
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
                          <TableCell colSpan={colCount} sx={{ p: 0, bgcolor: FLUENT.blue.bg, borderBottom: `2px solid ${FLUENT.blue.border}` }}>
                            <Collapse in appear>
                              <Box sx={{ px: 2, py: 1.5 }}>
                                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                                  <Typography sx={{ fontSize: '0.84rem', fontWeight: 800, color: FLUENT.blue.ink }}>
                                    {p.soNumber} — dispatch split
                                  </Typography>
                                  {s.dispatchProgress && (<>
                                    <O2dStatusPill tone="grey" label={`Ordered ${fmtNum(s.dispatchProgress.orderedQty)}`} />
                                    <O2dStatusPill tone="blue" label={`Dispatched ${fmtNum(s.dispatchProgress.dispatchedQty)} (${s.dispatchProgress.pct || 0}%)`} />
                                    {s.dispatchProgress.phasesTotal > 0 && (
                                      <O2dStatusPill tone="green" label={`Phases ${s.dispatchProgress.phasesDone}/${s.dispatchProgress.phasesTotal}`} />
                                    )}
                                  </>)}
                                </Stack>
                                <Box sx={{ overflowX: 'auto', borderRadius: '8px', border: `1px solid ${FLUENT.blue.border}`, bgcolor: O2D.surface }}>
                                <Table size="small" sx={{ ...fluentTableSx(900), '& tbody td': { fontSize: '0.78rem', color: O2D.body, py: 0.75 } }}>
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
                                      <TableRow key={String(d.dcId)} sx={String(d.dcId) === String(dc?.dcId) ? { bgcolor: FLUENT.blue.tint } : undefined}>
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
                px: 1.75, py: 1,
                bgcolor: FLUENT.blue.bg,
                borderTop: `1px solid ${FLUENT.blue.border}`,
                backdropFilter: 'blur(3px)',
              }}
            >
              <Chip
                size="small"
                label={selected.length}
                sx={{ height: 22, minWidth: 28, fontWeight: 800, fontSize: '0.72rem', bgcolor: FLUENT.blue.accent, color: '#fff' }}
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
                disableElevation sx={primaryBtnSx(O2D.brand)}
              >
                Send {selected.length} email{selected.length === 1 ? '' : 's'}
              </Button>
            </Stack>
          )}

          <Box data-testid="o2d-board-footer" sx={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
            columnGap: 2, rowGap: 0.5, pl: { xs: 1.25, md: 1.75 }, borderTop: `1px solid ${O2D.lineSoft}`, bgcolor: O2D.surface,
          }}>
            {/* Colour key — the same pastel tones the pills on this board use. */}
            <Stack direction="row" columnGap={1.5} rowGap={0.5} alignItems="center" flexWrap="wrap" useFlexGap
              data-testid="o2d-board-legend" sx={{ py: { xs: 1, md: 0.75 } }}>
              <Typography sx={{ fontSize: '0.64rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: O2D.faint }}>
                Colour key
              </Typography>
              {[
                [FLUENT.blue.accent, 'Work to do · in progress'],
                [FLUENT.green.accent, 'Completed on time'],
                [FLUENT.amber.accent, 'Completed late'],
                [FLUENT.orange.accent, 'Amount outstanding'],
                [FLUENT.grey.accent, 'Pending · cancelled'],
                [FLUENT.rose.accent, 'Overdue · failed'],
              ].map(([c, label]) => (
                <Stack key={label} direction="row" spacing={0.5} alignItems="center">
                  <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: c, flexShrink: 0 }} />
                  <Typography sx={{ fontSize: '0.7rem', color: O2D.body, whiteSpace: 'nowrap' }}>{label}</Typography>
                </Stack>
              ))}
            </Stack>
            <TablePagination
              component="div"
              count={displayRows.length}
              page={page}
              onPageChange={(_, pg) => setPage(pg)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => setRowsPerPage(parseInt(e.target.value, 10))}
              rowsPerPageOptions={[25, 50, 100]}
              labelRowsPerPage="Rows per page:"
              sx={{ border: 0, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.74rem', color: O2D.sub } }}
            />
          </Box>
          </>)}
        </Paper>

      <OrderEntryDrawer open={newOrderOpen} onClose={() => setNewOrderOpen(false)} />

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

      {/* Cancel confirmation — spell out exactly what cancelling does, because
          the point of it (versus delete) is that the numbers move. */}
      <Dialog open={!!cancelRow} onClose={() => !cancelling && setCancelRow(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Ban size={18} color="#b91c1c" /> Cancel this dispatch?
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.85rem', color: O2D.body, mb: 1.5 }}>
            Dispatch <b>{cancelRow?.dc?.dcNumber}</b> on order <b>{cancelRow?.p?.soNumber}</b> will be
            marked cancelled. It stays on the board as a record, but:
          </Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.25, mb: 1.5, '& li': { fontSize: '0.8rem', color: O2D.body, mb: 0.5 } }}>
            <li>its quantity <b>stops counting as dispatched</b> and returns to the plan</li>
            <li>Plan vs Actual and the order balance update accordingly</li>
            <li>steps <b>2.06 → 2.13</b> for this challan are marked cancelled</li>
            <li>you can raise a <b>fresh dispatch</b> against the same plan</li>
          </Box>
          <TextField
            fullWidth size="small" label="Reason (optional)" value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="e.g. Client cancelled the order"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCancelRow(null)} disabled={cancelling} sx={{ textTransform: 'none', fontWeight: 700 }}>
            Keep it
          </Button>
          <Button
            variant="contained" color="error" disableElevation disabled={cancelling}
            startIcon={<Ban size={14} />} onClick={handleCancel}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px' }}
          >
            {cancelling ? 'Cancelling…' : 'Cancel dispatch'}
          </Button>
        </DialogActions>
      </Dialog>

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
                It moves to the Recycle Bin, where it can be restored.
              </>
            ) : (
              <>
                <b>{confirmRow?.p?.soNumber || 'This order'}</b>
                {confirmRow?.p?.partyName ? ` — ${confirmRow.p.partyName}` : ''} will be deleted along with its
                complete O2D tracker (all steps, entries and history). It moves to the Recycle Bin, where it can be restored.
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
    </O2dPage>
  );
};

export default O2dStepBoard;
