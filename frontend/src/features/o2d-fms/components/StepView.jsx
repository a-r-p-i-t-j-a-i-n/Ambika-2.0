import React, { useEffect, useMemo, useRef } from 'react';
import {
  Box, Paper, Stack, Typography, Chip, Button, Tooltip, IconButton, alpha,
  Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material';
import {
  CheckCircle2, Info, ArrowRight, ExternalLink, Plus, Truck, Eye,
  ChevronLeft, ChevronRight, ListChecks, Boxes, AlertTriangle, Clock,
} from 'lucide-react';
import { O2D, O2D_TIP, isDone } from '../o2dTheme';
import { actionLinkMeta, resolveEntityLink } from '../actionLinks';
import { inferActionDone, consignmentActionDone } from './StepDetailCard';

/**
 * STEP VIEW — the order workspace, one operation at a time.
 * ---------------------------------------------------------
 * The client works this flow in a Google Sheet, so this view keeps that mental
 * model: a left-to-right rail of the 13 steps, and beneath it ONE spreadsheet-like
 * table showing exactly the columns that step is about (sales order · dispatch
 * plan · challan · invoice · payment …).
 *
 * Two rules make it trustworthy, and they are not negotiable:
 *
 *  1. Work is ALWAYS started from the step's FMS task — the same task a doer gets
 *     in My Tasks (`/o2d-fms/task/:processId/:stepCode`). The task carries the
 *     checklist, the proof, the "Do it now" links and Mark Done. The tracker never
 *     deep-links straight into PPC / Dispatch Planning / Challans, because that
 *     bypasses the checklist and the step never gets recorded as done.
 *  2. From 2.06 (Actual Dispatch) onwards the flow FORKS: an order ships in many
 *     consignments, so every Delivery Challan gets its own row — and its own task,
 *     scoped with `?dc=` — for 2.06 → 2.13.
 */

const num = (n) => Number(n || 0).toLocaleString('en-IN');
const money = (n) => (Number(n || 0) ? `₹${Number(n).toLocaleString('en-IN')}` : '—');

// Date-only values (dispatch / invoice / delivery dates) are stored at midnight UTC —
// printing a time would render the +05:30 offset as a spurious "5:30 am".
const fmt = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  const dateOnly = dt.getUTCHours() === 0 && dt.getUTCMinutes() === 0 && dt.getUTCSeconds() === 0;
  return dt.toLocaleString('en-IN', dateOnly ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' });
};
const dOnly = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '—');

// Steps that recur PER delivery challan — everything after the shared spine 1.01–2.05.
export const PER_CHALLAN_STEPS = ['2.06', '2.07', '2.08', '2.09', '2.10', '2.11', '2.12', '2.13'];

// Names of all doers on a step (arrays, with legacy single fallback).
const doerNames = (s) => {
  const list = (s?.assignees?.length ? s.assignees : [s?.assignedTo]).filter(Boolean);
  return list.map((u) => u.name || 'User').join(', ');
};

const stepActionKeys = (step) => (step?.actionLinks?.length
  ? step.actionLinks
  : (step?.actionLink ? [step.actionLink] : []));

// Orders created before a step gained its connected screens still deserve a working
// Step View. These mirror the seeded template and only fill gaps — stored data wins.
const ACTION_FALLBACKS = {
  '1.01': ['ORDER_ENTRY'], '2.02': ['ORDER_ENTRY'], '2.03': ['PPC'],
  '2.04': ['DISPATCH_PLAN', 'DISPATCH_PLAN_PDF'], '2.05': ['EMAIL_DISPATCH_SCHEDULE'],
  '2.06': ['ACTUAL_DISPATCH', 'CHALLAN_PDF'], '2.07': ['INVOICE_ENTRY'], '2.08': ['INVOICE_EMAIL'],
  '2.09': ['TRACK_DELIVERY'], '2.10': ['PAYMENT_FOLLOWUP'], '2.11': ['PAYMENT_RECEIPT'],
  '2.12': ['TRANSPORT_BILL_RECEIVE'], '2.13': ['TRANSPORT_BILL_STATUS'],
};

// Steps whose work is genuinely TWO separate jobs get two separate action columns,
// each with its own status — exactly how the sheet reads: "planned?" and "PDF sent?".
const SPLIT_ACTION_COLUMNS = {
  '2.04': [
    { key: 'DISPATCH_PLAN', label: 'Dispatch planning', short: 'Plan it' },
    { key: 'DISPATCH_PLAN_PDF', label: 'Generate PDF', short: 'Generate PDF' },
  ],
  '2.06': [
    { key: 'ACTUAL_DISPATCH', label: 'Actual dispatch', short: 'Dispatch' },
    { key: 'CHALLAN_PDF', label: 'Delivery challan PDF', short: 'Challan PDF' },
  ],
};

// Is a per-challan step done FOR THIS challan — read from that challan's own ledger.
const challanStepDone = (code, c) => {
  if (!c) return false;
  switch (code) {
    case '2.06': return true; // this challan IS the dispatch
    case '2.07': return !!c.invoice?.has;
    case '2.08': return c.invoice?.emailStatus === 'SENT' || !!c.invoice?.emailSentAt;
    case '2.09': return !!c.delivery?.delivered;
    case '2.10': return !!c.payment?.has;
    case '2.11': return !!c.payment?.confirmed;
    case '2.12': return c.transport?.receiptStatus === 'DONE';
    case '2.13': return c.transport?.paymentStatus === 'DONE';
    default: return false;
  }
};
/**
 * The row's TASK status — deliberately not the same thing as "the work happened".
 *
 * A challan can exist, a PDF can be generated, an invoice can be raised — and the
 * FMS step still be open because nobody opened the task and hit Mark done. Showing
 * such a row as "Done" is a lie that hides work: the tracker says finished while a
 * doer still owes the sign-off. So the Status column reports the TASK, and the
 * action columns report the RECORDS. When the two disagree the row says so out
 * loud — "Not marked done" — which is the state that needs someone's attention.
 */
const TASK_STATE = {
  DONE:     { key: 'DONE', label: 'Done', color: '#15803d', hint: 'The task was marked done — this step is closed.' },
  LATE:     { key: 'DONE', label: 'Done · late', color: '#b45309', hint: 'The task was marked done, but after its planned time.' },
  UNSIGNED: { key: 'UNSIGNED', label: 'Not marked done', color: '#b45309', hint: 'The work is recorded, but nobody has marked the task done yet — until they do, this step still counts as pending. Open the task and Mark done to close it.' },
  OVERDUE:  { key: 'ALERT', label: 'Overdue', color: '#be123c', hint: 'Past its planned time and still not done.' },
  PARTIAL:  { key: 'BUSY', label: 'In progress', color: '#1d4ed8', hint: 'Some of the work is recorded, but not all of it — and the task is not marked done.' },
  STARTED:  { key: 'BUSY', label: 'In progress', color: '#1d4ed8', hint: 'This step has started. Nothing is recorded against it yet.' },
  TODO:     { key: 'TODO', label: 'To do', color: '#475569', hint: 'Nothing recorded for this row yet.' },
  SKIPPED:  { key: 'TODO', label: 'Skipped', color: '#94a3b8', hint: 'This step was skipped for this order.' },
};

/**
 * @param workDone every piece of this row's work is in the system
 * @param partial  some of it is (e.g. the plan exists but its PDF doesn't)
 */
const taskStateOf = ({ step, workDone, partial = false }) => {
  if (step.status === 'DELAYED') return TASK_STATE.LATE;
  if (step.status === 'DONE') return TASK_STATE.DONE;
  if (step.status === 'SKIPPED') return TASK_STATE.SKIPPED;
  // The telling case: the record exists but the step is still open.
  if (workDone) return TASK_STATE.UNSIGNED;
  if (partial) return TASK_STATE.PARTIAL;
  if (step.isOverdue) return TASK_STATE.OVERDUE;
  if (step.status === 'IN_PROGRESS') return TASK_STATE.STARTED;
  return TASK_STATE.TODO;
};

// Icon for a state — one glyph per meaning, so the column scans without reading.
const stateIcon = (state) => (state.key === 'DONE' ? <CheckCircle2 size={12} />
  : (state.key === 'UNSIGNED' || state.key === 'ALERT') ? <AlertTriangle size={12} />
    : <Clock size={12} />);

// This challan's OWN timestamp for a per-challan step.
const challanActualOf = (code, c) => c?.log?.[code]?.doneAt
  || ({ '2.06': c?.dcDate, '2.07': c?.invoice?.date, '2.08': c?.invoice?.emailSentAt, '2.09': c?.delivery?.date }[code])
  || null;

// ── Per-step spreadsheet columns ────────────────────────────────────────────
// What that operation is actually ABOUT — the figures the client reads in their
// sheet. `get({ p, step, c, sum, dp })` → a string or a node.
const SHEET_COLS = {
  '1.01': [
    { label: 'Party', get: ({ p }) => p?.partyName || '—' },
    { label: 'PO number', mono: true, get: ({ p }) => p?.poNumber || '—' },
    { label: 'O2D ID', mono: true, get: ({ p }) => p?.uniqueO2DId || '—' },
    { label: 'Order qty', align: 'right', get: ({ sum, dp }) => (sum?.orderedQty || dp?.orderedQty ? num(sum?.orderedQty || dp?.orderedQty) : '—') },
  ],
  '2.02': [
    { label: 'Party', get: ({ p }) => p?.partyName || '—' },
    { label: 'PO number', mono: true, get: ({ p }) => p?.poNumber || '—' },
    { label: 'Order qty', align: 'right', get: ({ sum, dp }) => (sum?.orderedQty || dp?.orderedQty ? num(sum?.orderedQty || dp?.orderedQty) : '—') },
  ],
  '2.03': [
    { label: 'Party', get: ({ p }) => p?.partyName || '—' },
    { label: 'Order qty', align: 'right', get: ({ sum, dp }) => num(sum?.orderedQty || dp?.orderedQty) },
    { label: 'Dispatched', align: 'right', get: ({ sum, dp }) => num(sum?.dispatchedQty || dp?.dispatchedQty) },
    { label: 'Balance', align: 'right', get: ({ sum, dp }) => num(sum?.balanceQty ?? dp?.balanceQty) },
  ],
  '2.04': [
    { label: 'Party', get: ({ p }) => p?.partyName || '—' },
    { label: 'Order qty', align: 'right', get: ({ sum, dp }) => num(sum?.orderedQty || dp?.orderedQty) },
    { label: 'Phases planned', align: 'right', get: ({ dp }) => (dp?.phasesTotal ? `${num(dp.phasesDone || 0)} / ${num(dp.phasesTotal)}` : '—') },
  ],
  '2.05': [
    { label: 'Party', get: ({ p }) => p?.partyName || '—' },
    { label: 'PO number', mono: true, get: ({ p }) => p?.poNumber || '—' },
    { label: 'Phases', align: 'right', get: ({ dp }) => (dp?.phasesTotal ? num(dp.phasesTotal) : '—') },
  ],
  '2.06': [
    { label: 'DC date', get: ({ c }) => dOnly(c?.dcDate) },
    { label: 'Phase', get: ({ c }) => c?.phaseNo || '—' },
    { label: 'Qty (pcs)', align: 'right', get: ({ c }) => num(c?.qty) },
    { label: 'Boxes', align: 'right', get: ({ c }) => (c?.boxes ? num(c.boxes) : '—') },
  ],
  '2.07': [
    { label: 'DC date', get: ({ c }) => dOnly(c?.dcDate) },
    { label: 'Invoice no.', mono: true, get: ({ c }) => c?.invoice?.invoiceNo || '—' },
    { label: 'Invoice date', get: ({ c }) => dOnly(c?.invoice?.date) },
    { label: 'Amount', align: 'right', get: ({ c }) => money(c?.invoice?.amount) },
    { label: 'E-way', get: ({ c }) => (c?.eway?.has ? 'Generated' : '—') },
  ],
  '2.08': [
    { label: 'Invoice no.', mono: true, get: ({ c }) => c?.invoice?.invoiceNo || '—' },
    { label: 'Email status', get: ({ c }) => (c?.invoice?.emailStatus === 'SENT' ? 'Sent' : c?.invoice?.emailStatus === 'FAILED' ? 'Failed' : 'Not sent') },
    { label: 'Sent at', get: ({ c }) => fmt(c?.invoice?.emailSentAt) },
  ],
  '2.09': [
    { label: 'Invoice no.', mono: true, get: ({ c }) => c?.invoice?.invoiceNo || '—' },
    { label: 'Qty (pcs)', align: 'right', get: ({ c }) => num(c?.qty) },
    { label: 'Delivery status', get: ({ c }) => c?.delivery?.status || 'Pending' },
    { label: 'Delivered on', get: ({ c }) => dOnly(c?.delivery?.date) },
  ],
  '2.10': [
    { label: 'Invoice no.', mono: true, get: ({ c }) => c?.invoice?.invoiceNo || '—' },
    { label: 'Invoice amount', align: 'right', get: ({ c }) => money(c?.invoice?.amount) },
    { label: 'Balance', align: 'right', get: ({ c }) => money(c?.invoice?.balance) },
    { label: 'Follow-up', get: ({ c }) => (c?.payment?.outcome === 'NOT_RECEIVED' ? 'Not received' : c?.payment?.has ? 'In follow-up' : 'Not started') },
  ],
  '2.11': [
    { label: 'Invoice no.', mono: true, get: ({ c }) => c?.invoice?.invoiceNo || '—' },
    { label: 'Invoice amount', align: 'right', get: ({ c }) => money(c?.invoice?.amount) },
    { label: 'Received', align: 'right', get: ({ c }) => money(c?.payment?.received || c?.invoice?.received) },
    { label: 'Balance', align: 'right', get: ({ c }) => money(c?.invoice?.balance) },
  ],
  '2.12': [
    { label: 'DC date', get: ({ c }) => dOnly(c?.dcDate) },
    { label: 'Qty (pcs)', align: 'right', get: ({ c }) => num(c?.qty) },
    { label: 'Bill received', get: ({ c }) => (c?.transport?.receiptStatus === 'DONE' ? 'Received' : 'Pending') },
  ],
  '2.13': [
    { label: 'DC date', get: ({ c }) => dOnly(c?.dcDate) },
    { label: 'Bill received', get: ({ c }) => (c?.transport?.receiptStatus === 'DONE' ? 'Received' : 'Pending') },
    { label: 'Transport paid', get: ({ c }) => (c?.transport?.paymentStatus === 'DONE' ? 'Paid' : 'Pending') },
  ],
};

const DEFAULT_COLS = [
  { label: 'Party', get: ({ p }) => p?.partyName || '—' },
  { label: 'PO number', mono: true, get: ({ p }) => p?.poNumber || '—' },
];

// ── Small presentational pieces ─────────────────────────────────────────────

const HeadCell = ({ children, align = 'left', sticky = false, width }) => (
  <TableCell align={align} sx={{
    width,
    bgcolor: O2D.surfaceAlt,
    fontWeight: 800, fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.06em',
    color: O2D.sub, whiteSpace: 'nowrap', py: 0.9,
    ...(sticky ? { position: 'sticky', left: 0, zIndex: 3, borderRight: `1px solid ${O2D.line}` } : {}),
  }}>{children}</TableCell>
);

// One label:value line inside a tooltip — muted label, solid value, so the popover
// reads as a mini record card rather than a wall of blue text.
const TipRow = ({ label, value }) => (
  <Stack direction="row" spacing={1} justifyContent="space-between">
    <Typography sx={{ fontSize: '0.66rem', fontWeight: 600, color: O2D.sub }}>{label}</Typography>
    <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, color: O2D.body, textAlign: 'right' }}>{value}</Typography>
  </Stack>
);

const StatusPill = ({ label, color, icon }) => (
  <Chip size="small" icon={icon} label={label}
    sx={{
      height: 21, fontSize: '0.63rem', fontWeight: 800, borderRadius: '5px',
      bgcolor: alpha(color, 0.12), color,
      '& .MuiChip-icon': { color, ml: 0.6, mr: -0.3 },
      '& .MuiChip-label': { px: 0.9 },
    }} />
);

/**
 * One action column cell. Pending → the ONE button that matters: "Do this task",
 * which opens the step's FMS task (checklist + Do-it-now + Mark done). Done → the
 * green stamp with who/when, plus a direct link to the record that was produced.
 */
const ActionCell = ({ state, onDoTask, onView, ctaLabel }) => {
  if (!state) return <TableCell />;
  const { done, at, by, viewTo, meta, doneWord } = state;
  const stamp = [by, at ? fmt(at) : null].filter(Boolean).join(' · ');
  return (
    <TableCell sx={{ whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
      {done ? (
        <Stack direction="row" spacing={0.75} alignItems="center">
          <CheckCircle2 size={15} color="#15803d" style={{ flexShrink: 0 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: '#15803d', lineHeight: 1.2 }}>{doneWord || 'Done'}</Typography>
            {stamp && (
              <Typography noWrap sx={{ fontSize: '0.62rem', color: O2D.sub, lineHeight: 1.2, maxWidth: 150 }}>{stamp}</Typography>
            )}
          </Box>
          {viewTo && (
            <Tooltip arrow slotProps={O2D_TIP} title={`Open the ${meta?.viewLabel || meta?.label || 'record'}`}>
              <IconButton size="small" onClick={() => onView(viewTo)} sx={{ color: '#15803d' }}>
                <ExternalLink size={13} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip arrow slotProps={O2D_TIP} title="Open the task again (re-do or re-check the checklist)">
            <IconButton size="small" onClick={onDoTask} sx={{ color: O2D.brand }}>
              <ListChecks size={13} />
            </IconButton>
          </Tooltip>
        </Stack>
      ) : (
        <Tooltip arrow slotProps={O2D_TIP} title={meta ? `Opens this order's FMS task. Inside: the checklist and the "${meta.label}" screen — finish there and it ticks itself.` : 'Open this order\'s FMS task — checklist, proof and Mark done.'}>
          <Button size="small" variant="contained" onClick={onDoTask} endIcon={<ArrowRight size={13} />}
            sx={{ textTransform: 'none', fontWeight: 700, boxShadow: 'none', whiteSpace: 'nowrap', py: 0.35 }}>
            {ctaLabel || 'Do this task'}
          </Button>
        </Tooltip>
      )}
    </TableCell>
  );
};

/**
 * One entry in the colour key. It draws the SAME dot the rail draws and carries the
 * same words the Task-status column uses, so nothing has to be decoded — a person
 * who has never seen this screen can read the rail from this one line. Clicking it
 * jumps to the first step in that state, which is usually what you wanted anyway.
 */
const LegendChip = ({ state, count, onJump }) => (
  <Tooltip arrow slotProps={O2D_TIP} title={count ? `${state.hint} Click to jump to the first one.` : state.hint}>
    <Stack
      direction="row" spacing={0.5} alignItems="center"
      onClick={count && onJump ? onJump : undefined}
      sx={{
        px: 0.75, py: 0.25, borderRadius: '999px', flexShrink: 0,
        border: '1px solid', borderColor: count ? alpha(state.color, 0.3) : 'transparent',
        bgcolor: count ? alpha(state.color, 0.07) : 'transparent',
        opacity: count ? 1 : 0.42,
        cursor: count && onJump ? 'pointer' : 'default',
        '&:hover': count && onJump ? { bgcolor: alpha(state.color, 0.14) } : {},
      }}
    >
      <Box sx={{
        width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
        // Filled = closed. Hollow = still open. Same language as the rail's circles.
        bgcolor: state.key === 'DONE' ? state.color : 'transparent',
        border: '2px solid', borderColor: state.color,
      }} />
      <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: O2D.sub, whiteSpace: 'nowrap' }}>
        {state.label}
      </Typography>
      {count > 0 && (
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: state.color }}>{count}</Typography>
      )}
    </Stack>
  </Tooltip>
);

// One tile on the left-to-right rail. Its ring colour is the step's TASK state — the
// same colour, and the same words, the key above the rail explains.
const RailTile = ({ step, active, badge, state, onClick, tileRef }) => {
  const done = isDone(step.status);
  const flagged = state.key === 'ALERT' || state.key === 'UNSIGNED';
  const ring = state.color;
  return (
    // The ref lives on an outer wrapper so it never collides with the ref MUI's
    // Tooltip attaches to its own child.
    <Box ref={tileRef} sx={{ flex: '0 0 auto' }}>
    <Tooltip
      arrow
      slotProps={O2D_TIP}
      title={(
        <Box sx={{ py: 0.25, minWidth: 178 }}>
          <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, color: O2D.ink, mb: 0.4 }}>
            {step.stepCode} · {step.name}
          </Typography>
          <TipRow label="Doer" value={doerNames(step) || step.defaultOwnerRole || 'Unassigned'} />
          <TipRow label="Planned" value={fmt(step.planned)} />
          <TipRow label="Actual" value={fmt(step.actual)} />
          {step.checklistTotal > 0 && <TipRow label="Checklist" value={`${step.checklistDone}/${step.checklistTotal}`} />}
          <Typography sx={{ mt: 0.4, fontSize: '0.68rem', fontWeight: 800, color: state.color }}>
            {state.label}
          </Typography>
        </Box>
      )}
    >
      <Box onClick={onClick}
        sx={{
          width: 158, px: 1.15, py: 1, cursor: 'pointer', borderRadius: '9px',
          border: '1px solid', borderColor: active ? alpha(O2D.brand, 0.55) : O2D.line,
          bgcolor: active ? '#fff' : O2D.surfaceAlt,
          boxShadow: active ? `0 6px 16px ${alpha(O2D.brand, 0.16)}` : 'none',
          transition: 'all .14s',
          '&:hover': { borderColor: alpha(O2D.brand, 0.45), bgcolor: '#fff' },
        }}>
        <Stack direction="row" spacing={0.6} alignItems="center" sx={{ mb: 0.5 }}>
          <Box sx={{
            width: 19, height: 19, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
            bgcolor: done ? ring : '#fff', color: done ? '#fff' : ring,
            border: '2px solid', borderColor: ring,
          }}>
            {done ? <CheckCircle2 size={11} /> : <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: ring }} />}
          </Box>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: active ? O2D.brand : O2D.ink, letterSpacing: '0.01em' }}>
            {step.stepCode}
          </Typography>
          <Box sx={{ flex: 1 }} />
          {badge != null && (
            <Chip size="small" label={badge}
              sx={{ height: 16, fontSize: '0.55rem', fontWeight: 800, bgcolor: alpha('#7c3aed', 0.12), color: '#6d28d9', '& .MuiChip-label': { px: 0.6 } }} />
          )}
          <Info size={12} color={O2D.faint} style={{ flexShrink: 0 }} />
        </Stack>
        <Typography sx={{
          fontSize: '0.66rem', lineHeight: 1.25, color: active ? O2D.ink : O2D.body, fontWeight: active ? 700 : 500,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 30,
        }}>
          {step.name}
        </Typography>
        {flagged && (
          <Typography noWrap sx={{ mt: 0.3, fontSize: '0.58rem', fontWeight: 800, color: state.color }}>
            {state.label}
          </Typography>
        )}
      </Box>
    </Tooltip>
    </Box>
  );
};

// ── The view ────────────────────────────────────────────────────────────────

const StepView = ({
  steps, process, processId, consignments = [], summary = {},
  selectedCode, onSelect, onOpenTask, onPeekStep, onOpenLink, onRecordDispatch,
}) => {
  const railRef = useRef(null);
  const tileRefs = useRef({});

  const step = useMemo(
    () => steps.find((s) => s.stepCode === selectedCode) || steps[0],
    [steps, selectedCode],
  );

  // Keep the selected tile centred as the user walks the rail.
  useEffect(() => {
    const el = tileRefs.current[selectedCode];
    const box = railRef.current;
    if (!el || !box) return;
    const target = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
    box.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
  }, [selectedCode]);

  if (!step) return null;

  const perChallan = PER_CHALLAN_STEPS.includes(step.stepCode);
  const isDispatchStep = step.stepCode === '2.06' || step.triggerKey === 'ACTUAL_DISPATCH';
  const dp = steps.find((s) => s.dispatchProgress)?.dispatchProgress || {};

  const actionKeys = stepActionKeys(step).length ? stepActionKeys(step) : (ACTION_FALLBACKS[step.stepCode] || []);
  // Two-column steps only split when BOTH of their actions are actually configured
  // on the order; otherwise a single "Action" column keeps the table honest.
  const splitCols = (SPLIT_ACTION_COLUMNS[step.stepCode] || []).filter((c) => actionKeys.includes(c.key));
  const useSplit = splitCols.length > 1;

  const dataCols = SHEET_COLS[step.stepCode] || DEFAULT_COLS;
  const ctxIds = {
    soNumber: process?.soNumber,
    orderId: process?.salesOrderId?._id || process?.salesOrderId,
    processId,
    intakeId: process?.intakeId?._id || process?.intakeId,
  };

  // Resolve one connected action's state for a given row (order-level or challan).
  const actionStateFor = (key, c) => {
    const meta = actionLinkMeta(key);
    if (!meta) return null;
    const prog = (step.actionProgress || []).find((a) => a.key === key) || null;
    const scoped = c ? consignmentActionDone(key, c) : null;
    const done = scoped != null ? scoped : (!!prog || inferActionDone(key, process));
    const log = c ? (c.log?.[step.stepCode] || null) : null;
    const at = scoped != null ? (log?.doneAt || challanActualOf(step.stepCode, c)) : (prog?.doneAt || null);
    const by = scoped != null ? (log?.doneByName || null) : (prog?.doneByName || null);
    // The generated challan PDF is stored ON the challan, so this column is
    // per-consignment truth — a second dispatch asks for its own PDF instead of
    // inheriting the first challan's — and it opens that exact file. Nothing
    // records who generated it or when, so we claim neither.
    if (key === 'CHALLAN_PDF' && c) {
      return { done: !!c.pdfUrl, at: null, by: null, viewTo: c.pdfUrl || null, meta, doneWord: 'Generated' };
    }
    // Where to SEE what was produced. A captured deep-link (the exact record the
    // doer generated) always wins; otherwise fall back to the entity's screen,
    // narrowed to THIS row — its own challan, or its own invoice.
    let viewTo = prog?.link || (done ? resolveEntityLink(key, ctxIds)?.to : null);
    if (viewTo && c && viewTo.startsWith('/') && !prog?.link) {
      const narrow = viewTo.startsWith('/invoices')
        ? (c.invoice?.invoiceNo ? `inv=${encodeURIComponent(c.invoice.invoiceNo)}` : null)
        : (c.dcNumber ? `dc=${encodeURIComponent(c.dcNumber)}` : null);
      if (narrow) viewTo += `${viewTo.includes('?') ? '&' : '?'}${narrow}`;
    }
    return { done, at, by, viewTo, meta };
  };

  // "Work recorded" for a whole-order row = every connected screen has been done;
  // some-but-not-all is its own state, so a step with a plan but no PDF reads as
  // "In progress" rather than pretending nothing has happened.
  const orderActionStates = actionKeys.map((k) => actionStateFor(k, null)).filter(Boolean);
  const orderDoneCount = orderActionStates.filter((a) => a.done).length;
  const orderWorkDone = orderActionStates.length > 0 && orderDoneCount === orderActionStates.length;
  const orderPartial = orderDoneCount > 0 && !orderWorkDone;

  const rows = perChallan && consignments.length
    ? consignments.map((c) => {
      // The RECORD for this challan (challan created / invoiced / delivered / paid).
      const workDone = challanStepDone(step.stepCode, c);
      const log = c.log?.[step.stepCode] || null;
      return {
        id: String(c.dcId),
        c,
        ref: c.dcNumber,
        refSub: c.phaseNo && c.phaseNo !== '—' ? c.phaseNo : `${num(c.qty)} pcs`,
        workDone,
        state: taskStateOf({ step, workDone }),
        planned: step.planned,
        actual: challanActualOf(step.stepCode, c),
        doneBy: log?.doneByName || (isDone(step.status) ? step.completedBy?.name : null) || '—',
      };
    })
    : [{
      id: 'order',
      c: null,
      ref: process?.soNumber || '—',
      refSub: process?.uniqueO2DId || process?.partyName || '',
      workDone: orderWorkDone,
      state: taskStateOf({ step, workDone: orderWorkDone, partial: orderPartial }),
      planned: step.planned,
      actual: step.actual,
      doneBy: step.completedBy?.name || '—',
    }];

  const awaitingDispatch = perChallan && !consignments.length;
  const doneRows = rows.filter((r) => r.workDone).length;
  // The nudge that closes the loop: everything is recorded, only the sign-off is
  // missing. This is the single most common way a step silently stalls.
  const needsSignOff = !isDone(step.status) && rows.some((r) => r.workDone);
  const headerState = taskStateOf({
    step,
    workDone: rows.length > 0 && rows.every((r) => r.workDone),
    partial: rows.some((r) => r.workDone) || orderPartial,
  });

  // Rail badge: per-challan steps show "done / total consignments" so the fork is
  // visible without opening the step.
  // Does this step have work in the system that nobody has signed off?
  const unsignedFor = (s) => {
    if (isDone(s.status)) return false;
    return PER_CHALLAN_STEPS.includes(s.stepCode)
      ? consignments.some((c) => challanStepDone(s.stepCode, c))
      : (s.actionProgress || []).length > 0;
  };

  // A step's state on the RAIL, from the same rules the table's Task-status column
  // uses — so a tile, its pill and the colour key can never drift apart.
  const railStateOf = (s) => taskStateOf({ step: s, workDone: unsignedFor(s) });

  // The colour key. Fixed order so it never reshuffles under the reader; states that
  // don't occur in this order are dimmed rather than hidden, so the key always
  // teaches the whole language.
  const legend = [
    TASK_STATE.DONE, TASK_STATE.LATE, TASK_STATE.UNSIGNED, TASK_STATE.OVERDUE, TASK_STATE.PARTIAL, TASK_STATE.TODO,
    // Skipping is rare — only teach that colour on an order that actually has one,
    // so the key doesn't carry a word most people will never meet.
    ...(steps.some((s) => s.status === 'SKIPPED') ? [TASK_STATE.SKIPPED] : []),
  ]
    .map((state) => ({
      state,
      // LATE and DONE share a key, so match on the label — it is what the reader sees.
      steps: steps.filter((s) => railStateOf(s).label === state.label),
    }));

  const badgeFor = (s) => {
    if (!PER_CHALLAN_STEPS.includes(s.stepCode)) return null;
    if (!consignments.length) return null;
    const d = consignments.filter((c) => challanStepDone(s.stepCode, c)).length;
    return `${d}/${consignments.length}`;
  };

  const openTask = (c) => onOpenTask(step.stepCode, c?.dcNumber || null);
  // On a per-challan step the CTA should land on the first consignment still waiting.
  const nextChallan = (perChallan && !isDispatchStep)
    ? (consignments.find((c) => !challanStepDone(step.stepCode, c)) || consignments[0] || null)
    : null;

  /**
   * A SECOND dispatch is not "the 2.06 task" again.
   *
   * Once the first dispatch is recorded, 2.06's task is a finished record — it shows
   * the previous challan, its Done stamps and "Do again". Sending a doer there to
   * ship the balance means reading someone else's completed work and hunting for the
   * right button. So "New dispatch" opens the dispatch FORM straight away, preset to
   * this order, ready for the remaining quantity. Saving it still closes the loop
   * through the FMS task (the form returns there and ticks the action), so nothing
   * is bypassed — the doer just starts at the blank form instead of the old one.
   *
   * The FIRST dispatch is different: nothing has been recorded yet, so that one
   * rightly starts at the task with its checklist.
   */
  const isRepeatDispatch = isDispatchStep && consignments.length > 0 && !!onRecordDispatch;
  const heroCtaLabel = isRepeatDispatch ? 'New dispatch' : 'Do this task';
  const onHeroCta = isRepeatDispatch ? onRecordDispatch : () => openTask(nextChallan);

  // What is still owed on this order — the figure the new dispatch form gets filled with.
  const balanceQty = summary?.balanceQty ?? dp?.balanceQty ?? 0;

  const totalCols = 1 + dataCols.length + 5 + (useSplit ? splitCols.length : 1);

  return (
    <Stack spacing={1.25}>
      {/* ── The rail: the whole order, left to right ───────────────────────── */}
      <Paper elevation={0} sx={{ border: `1px solid ${O2D.line}`, borderRadius: '10px', bgcolor: O2D.surface, overflow: 'hidden' }}>
        {/* Colour key — the rail is colour-coded, so the code is spelled out right
            above it. Nobody should have to be told what green or red means. */}
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap
          sx={{ px: 1.25, py: 0.75, bgcolor: O2D.surfaceAlt, borderBottom: `1px solid ${O2D.line}` }}>
          <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: O2D.faint, flexShrink: 0 }}>
            What the colours mean
          </Typography>
          {legend.map(({ state, steps: inState }) => (
            <LegendChip key={state.label} state={state} count={inState.length}
              onJump={inState.length ? () => onSelect(inState[0].stepCode) : undefined} />
          ))}
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: O2D.sub, flexShrink: 0 }}>
            {steps.filter((s) => isDone(s.status)).length}/{steps.length} steps done
          </Typography>
        </Stack>
        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 1, py: 0.9 }}>
          <IconButton size="small" onClick={() => railRef.current?.scrollBy({ left: -340, behavior: 'smooth' })}
            sx={{ flexShrink: 0, border: `1px solid ${O2D.line}` }}>
            <ChevronLeft size={15} />
          </IconButton>
          <Box ref={railRef} sx={{
            display: 'flex', gap: 0.75, overflowX: 'auto', flex: 1, py: 0.25, px: 0.25,
            scrollbarWidth: 'thin',
            '&::-webkit-scrollbar': { height: 5 },
            '&::-webkit-scrollbar-thumb': { bgcolor: O2D.line, borderRadius: 3 },
          }}>
            {steps.map((s) => (
              <RailTile
                key={s.stepCode}
                step={s}
                active={s.stepCode === step.stepCode}
                badge={badgeFor(s)}
                state={railStateOf(s)}
                onClick={() => onSelect(s.stepCode)}
                tileRef={(el) => { tileRefs.current[s.stepCode] = el; }}
              />
            ))}
          </Box>
          <IconButton size="small" onClick={() => railRef.current?.scrollBy({ left: 340, behavior: 'smooth' })}
            sx={{ flexShrink: 0, border: `1px solid ${O2D.line}` }}>
            <ChevronRight size={15} />
          </IconButton>
        </Stack>

        {/* Selected-step strip — what this step is, who owns it, and the one CTA. */}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} alignItems={{ md: 'center' }}
          sx={{ px: 1.5, py: 1.15, borderTop: `1px solid ${O2D.line}`, bgcolor: alpha(headerState.color, 0.045) }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', color: O2D.ink }}>{step.stepCode} · {step.name}</Typography>
              <Tooltip arrow slotProps={O2D_TIP} title={headerState.hint}>
                <Box sx={{ display: 'inline-flex' }}>
                  <StatusPill label={headerState.label} color={headerState.color} icon={stateIcon(headerState)} />
                </Box>
              </Tooltip>
              {step.checklistTotal > 0 && (
                <Chip size="small" variant="outlined" icon={<ListChecks size={12} />}
                  label={`${step.checklistDone}/${step.checklistTotal}`}
                  sx={{ height: 21, fontSize: '0.63rem', fontWeight: 700 }} />
              )}
              {perChallan && consignments.length > 0 && (
                <Tooltip arrow slotProps={O2D_TIP} title={`${doneRows} of ${consignments.length} delivery challans have this step's work recorded.`}>
                  <Chip size="small" icon={<Boxes size={12} />} label={`${doneRows}/${consignments.length} challans`}
                    sx={{ height: 21, fontSize: '0.63rem', fontWeight: 800, bgcolor: alpha('#7c3aed', 0.12), color: '#6d28d9', '& .MuiChip-icon': { color: '#6d28d9' } }} />
                </Tooltip>
              )}
            </Stack>
            <Typography sx={{ mt: 0.3, fontSize: '0.7rem', color: O2D.sub }}>
              {perChallan
                ? 'This step repeats for every dispatch — one row per Delivery Challan, each completed on its own.'
                : 'Runs once for the whole sales order.'}
              {' '}Doer: <b>{doerNames(step) || step.defaultOwnerRole || 'Unassigned'}</b>
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.75} flexShrink={0}>
            <Button size="small" variant="outlined" startIcon={<Eye size={14} />} onClick={() => onPeekStep(step)}
              sx={{ textTransform: 'none', fontWeight: 700 }}>
              Quick look
            </Button>
            <Tooltip arrow slotProps={O2D_TIP}
              title={isRepeatDispatch
                ? `Opens a blank dispatch form for ${process?.soNumber || 'this order'}${balanceQty > 0 ? ` — ${num(balanceQty)} pcs still to ship` : ''}. Saving it creates the next delivery challan and returns you to the task.`
                : 'Opens this step\'s FMS task — checklist, proof and Mark done.'}>
              <Button size="small" variant="contained"
                startIcon={isRepeatDispatch ? <Truck size={14} /> : undefined}
                endIcon={isRepeatDispatch ? undefined : <ArrowRight size={14} />}
                onClick={onHeroCta}
                sx={{ textTransform: 'none', fontWeight: 800, boxShadow: 'none' }}>
                {heroCtaLabel}
              </Button>
            </Tooltip>
          </Stack>
        </Stack>

        {/* The work is in the system but the step is still open — the one state that
            silently stalls an order, so it gets said plainly and with its own way out. */}
        {needsSignOff && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}
            sx={{ px: 1.5, py: 1, borderTop: `1px solid ${O2D.line}`, bgcolor: alpha('#b45309', 0.07) }}>
            <AlertTriangle size={15} color="#b45309" style={{ flexShrink: 0 }} />
            <Typography sx={{ flex: 1, fontSize: '0.72rem', color: '#92400e', fontWeight: 600 }}>
              The work for this step is recorded, but nobody has marked the task done — so it still counts
              as pending{step.checklistTotal ? ` (checklist ${step.checklistDone}/${step.checklistTotal})` : ''}.
            </Typography>
            <Button size="small" variant="contained" color="warning" endIcon={<ArrowRight size={13} />}
              onClick={() => openTask(nextChallan)}
              sx={{ textTransform: 'none', fontWeight: 800, boxShadow: 'none', flexShrink: 0 }}>
              Open task &amp; mark done
            </Button>
          </Stack>
        )}
      </Paper>

      {/* ── The sheet: one focused table for THIS step ─────────────────────── */}
      <Paper elevation={0} sx={{ border: `1px solid ${O2D.line}`, borderRadius: '10px', bgcolor: O2D.surface, overflow: 'hidden' }}>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{
            minWidth: 940,
            '& td, & th': { borderColor: O2D.lineSoft, py: 0.7 },
            '& tbody tr:nth-of-type(even) td': { bgcolor: alpha(O2D.surfaceAlt, 0.6) },
            '& tbody tr:hover td': { bgcolor: alpha(O2D.brand, 0.04) },
          }}>
            <TableHead>
              <TableRow>
                <HeadCell sticky width={168}>{perChallan ? 'Delivery challan' : 'Sales order'}</HeadCell>
                {dataCols.map((col) => <HeadCell key={col.label} align={col.align}>{col.label}</HeadCell>)}
                <HeadCell>Doer</HeadCell>
                {/* "Task status" and "Recorded by" are named apart on purpose: the
                    status is about the FMS task being signed off, the columns to its
                    right are about the work/record itself. */}
                <HeadCell>Task status</HeadCell>
                <HeadCell>Planned</HeadCell>
                <HeadCell>Actual</HeadCell>
                <HeadCell>Recorded by</HeadCell>
                {useSplit
                  ? splitCols.map((c) => <HeadCell key={c.key}>{c.label}</HeadCell>)
                  : <HeadCell>Action</HeadCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {awaitingDispatch ? (
                <TableRow>
                  <TableCell colSpan={totalCols} sx={{ py: 3.5 }}>
                    <Stack alignItems="center" spacing={1}>
                      <Truck size={26} color={O2D.faint} />
                      <Typography sx={{ fontWeight: 800, fontSize: '0.84rem', color: O2D.ink }}>
                        {isDispatchStep ? 'No dispatch recorded yet' : 'Waiting for the first dispatch'}
                      </Typography>
                      <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, textAlign: 'center', maxWidth: 460 }}>
                        {isDispatchStep
                          ? 'Do the dispatch task — the delivery challan it creates becomes the first row here, and every later dispatch adds another.'
                          : `This step runs per delivery challan. Once step 2.06 records a dispatch, its challan appears here as its own row for ${step.stepCode}.`}
                      </Typography>
                      {/* "Go to step 2.06" means move the rail there — not open a task
                          for a step the reader hasn't chosen to work on yet. */}
                      <Button size="small" variant="contained" endIcon={<ArrowRight size={14} />}
                        onClick={() => (isDispatchStep ? openTask(null) : onSelect('2.06'))}
                        sx={{ textTransform: 'none', fontWeight: 800, boxShadow: 'none', mt: 0.5 }}>
                        {isDispatchStep ? 'Do this task' : 'Go to step 2.06'}
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ) : rows.map((row) => {
                const cellCtx = { p: process, step, c: row.c, sum: summary, dp };
                return (
                  <TableRow key={row.id}>
                    <TableCell sx={{
                      position: 'sticky', left: 0, zIndex: 2, bgcolor: O2D.surface,
                      borderRight: `1px solid ${O2D.line}`, whiteSpace: 'nowrap',
                    }}>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        {row.c && <Box sx={{ width: 3, height: 26, borderRadius: 2, bgcolor: row.workDone ? '#22c55e' : '#7c3aed', flexShrink: 0 }} />}
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 800, fontSize: '0.75rem', color: O2D.ink, lineHeight: 1.2 }}>
                            {row.ref}
                          </Typography>
                          {row.refSub && <Typography noWrap sx={{ fontSize: '0.62rem', color: O2D.sub, maxWidth: 150 }}>{row.refSub}</Typography>}
                        </Box>
                      </Stack>
                    </TableCell>

                    {dataCols.map((col) => (
                      <TableCell key={col.label} align={col.align || 'left'} sx={{
                        whiteSpace: 'nowrap', fontSize: '0.74rem',
                        fontFamily: col.mono || col.align === 'right' ? 'ui-monospace, SFMono-Regular, monospace' : undefined,
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {col.get(cellCtx)}
                      </TableCell>
                    ))}

                    <TableCell sx={{ fontSize: '0.74rem', whiteSpace: 'nowrap' }}>
                      {doerNames(step) || step.defaultOwnerRole || 'Unassigned'}
                    </TableCell>
                    <TableCell>
                      <Tooltip arrow slotProps={O2D_TIP} title={row.state.hint}>
                        <Box sx={{ display: 'inline-flex' }}>
                          <StatusPill label={row.state.label} color={row.state.color} icon={stateIcon(row.state)} />
                        </Box>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.74rem', whiteSpace: 'nowrap', color: step.isOverdue && !isDone(step.status) ? '#be123c' : undefined, fontWeight: step.isOverdue && !isDone(step.status) ? 700 : 400 }}>
                      {fmt(row.planned)}
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.74rem', whiteSpace: 'nowrap' }}>{fmt(row.actual)}</TableCell>
                    <TableCell sx={{ fontSize: '0.74rem', whiteSpace: 'nowrap' }}>{row.doneBy}</TableCell>

                    {useSplit ? splitCols.map((col) => (
                      <ActionCell
                        key={col.key}
                        state={actionStateFor(col.key, row.c)}
                        ctaLabel={col.short}
                        onDoTask={() => openTask(row.c)}
                        onView={onOpenLink}
                      />
                    )) : (
                      <ActionCell
                        state={actionStateFor(actionKeys[0], row.c) || {
                          done: row.workDone, at: row.actual, by: row.doneBy !== '—' ? row.doneBy : null, viewTo: null, meta: null,
                        }}
                        onDoTask={() => openTask(row.c)}
                        onView={onOpenLink}
                      />
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>

        {/* 2.06 is where the order forks — say so, and give the way to fork again. */}
        {isDispatchStep && (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}
            sx={{ px: 1.4, py: 1.05, borderTop: `1px solid ${O2D.line}`, bgcolor: alpha('#7c3aed', 0.04) }}>
            <Boxes size={15} color="#7c3aed" style={{ flexShrink: 0 }} />
            <Typography sx={{ flex: 1, fontSize: '0.7rem', color: O2D.sub }}>
              An order ships in as many consignments as it needs. Every actual dispatch creates a new delivery
              challan — a new row here, and its own 2.07 → 2.13 chain.
              {balanceQty > 0 && (
                <Box component="span" sx={{ fontWeight: 800, color: '#6d28d9' }}>
                  {' '}{num(balanceQty)} pcs still to ship.
                </Box>
              )}
            </Typography>
            {/* ONE button, and it opens the form. There used to be two here — a
                "Quick entry" and a "do the task" — which landed in different places
                for what a doer reads as the same intent. */}
            <Button size="small" variant="outlined" startIcon={<Plus size={14} />} disabled={!onRecordDispatch}
              onClick={onRecordDispatch}
              sx={{ textTransform: 'none', fontWeight: 800, color: '#6d28d9', borderColor: alpha('#7c3aed', 0.5), flexShrink: 0 }}>
              Record another dispatch
            </Button>
          </Stack>
        )}
      </Paper>
    </Stack>
  );
};

export default StepView;
