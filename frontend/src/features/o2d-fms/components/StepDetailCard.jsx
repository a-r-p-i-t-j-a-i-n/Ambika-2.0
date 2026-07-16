import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Stack, Typography,
  Chip, TextField, Button, Divider, Alert, IconButton, alpha, Autocomplete,
  Checkbox, FormControlLabel, LinearProgress, Avatar, Tooltip, Paper,
} from '@mui/material';
import {
  X, User, ClipboardList, Wrench, Clock, CheckCircle2, Link2, AlertTriangle, UserCog,
  Users, MessageSquare, Send, Paperclip, HelpCircle, FormInput, ShieldCheck, ArrowRight, Zap,
  ExternalLink, Truck, Boxes, Workflow,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  useCompleteStepMutation, useAssignStepMutation, useToggleChecklistItemMutation,
  useAddStepCommentMutation, useGetProcessByIdQuery,
  useUploadFileMutation, useAddStepAttachmentsMutation, useRemoveStepAttachmentMutation,
  useAnswerVerificationMutation, useFillFormFieldMutation, useApproveStepMutation,
  useMarkActionDoneMutation, useGetConsignmentsQuery,
} from '../../../store/api/o2dFmsApi';
import { useGetScheduleQuery } from '../../../store/api/dispatchControlApi';
import { resolveActionLink, actionLinkMeta, resolveEntityLink } from '../actionLinks';
import { resolveFileUrl } from '../../../utils/fileUrl';

const num = (n) => Number(n || 0).toLocaleString('en-IN');
import { useListAccessUsersQuery } from '../../../store/api/accessControlApi';
import { useSelector } from 'react-redux';
import AttachmentList from '../../../components/AttachmentList';
import VoiceRecorder from '../../../components/VoiceRecorder';

// Date-only values (dispatch/invoice/delivery dates) are stored at midnight UTC —
// showing a time would render the +05:30 IST offset as a spurious "5:30 am", so we
// drop the time for those and keep it only for genuine timestamps.
const fmt = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  const dateOnly = dt.getUTCHours() === 0 && dt.getUTCMinutes() === 0 && dt.getUTCSeconds() === 0;
  return dt.toLocaleString('en-IN', dateOnly ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' });
};

const STATUS_TONE = {
  DONE:        { color: '#0f766e', label: 'Completed' },
  DELAYED:     { color: '#b45309', label: 'Completed (late)' },
  IN_PROGRESS: { color: '#1d4ed8', label: 'In progress' },
  PENDING:     { color: '#475569', label: 'Pending' },
  SKIPPED:     { color: '#94a3b8', label: 'Skipped' },
};

// The connected-action keys on a step (multiple allowed; legacy single → [single]).
const stepActionKeys = (step) => (step?.actionLinks?.length
  ? step.actionLinks
  : (step?.actionLink ? [step.actionLink] : []));

// A spine / order-level connected action is effectively "done" the moment the
// record it produces exists on the process — even when the doer punched it in on
// a screen that can't call back into this task (Orders / Order-Intake), so
// markActionDone never fired. Only ONCE-PER-ORDER actions are inferred here;
// per-consignment actions (invoice / dispatch / payment…) are intentionally
// excluded so one consignment's record never marks another's action as done.
const inferActionDone = (key, proc) => {
  switch (key) {
    case 'ORDER_INTAKE': return !!(proc?.intakeId);
    case 'ORDER_ENTRY':
    case 'ORDER_DETAILS': return !!(proc?.salesOrderId);
    default: return false;
  }
};

// When a task is scoped to ONE consignment (Delivery Challan), an action's
// done-state must come from THAT challan — not the shared step-level progress.
// So a fresh challan (e.g. DC-047) shows "Do it now" for a blank invoice, while a
// challan that's already invoiced shows "Do again". Returns null for actions that
// aren't per-consignment (→ fall back to the step-level state).
const consignmentActionDone = (key, c) => {
  if (!c) return null;
  switch (key) {
    case 'ACTUAL_DISPATCH': return true; // the challan itself IS the dispatch
    case 'INVOICE':
    case 'INVOICE_ENTRY': return !!c.invoice?.has;
    // Emailed = SENT, or simply ATTEMPTED — emailSentAt is stamped on every send,
    // including a FAILED SMTP attempt (common on localhost). So once the doer has
    // emailed this challan they see "Do again · Done by … · time" (and can re-send),
    // never a blank "Do it now" after the fact.
    case 'INVOICE_EMAIL': return c.invoice?.emailStatus === 'SENT' || !!c.invoice?.emailSentAt;
    case 'POD':
    case 'TRACK_DELIVERY': return !!c.delivery?.delivered;
    case 'PAYMENT_FOLLOWUP': return !!c.payment?.has;
    case 'PAYMENT':
    case 'PAYMENT_RECEIPT': return !!c.payment?.confirmed;
    case 'TRANSPORT_BILL_RECEIVE': return c.transport?.receiptStatus === 'DONE';
    case 'TRANSPORT_BILL_STATUS': return c.transport?.paymentStatus === 'DONE';
    default: return null; // not a per-consignment action → use step-level
  }
};

// Post-dispatch steps that recur per delivery challan — invoice → email → track →
// pay → transport. Any step wired to one of these actions is worked one consignment
// at a time (so the task/form scopes to a single challan via ?dc=).
const PER_CONSIGNMENT_ACTIONS = [
  'INVOICE', 'INVOICE_ENTRY', 'INVOICE_EMAIL', 'POD', 'TRACK_DELIVERY',
  'PAYMENT', 'PAYMENT_FOLLOWUP', 'PAYMENT_RECEIPT', 'TRANSPORT_BILL_RECEIVE', 'TRANSPORT_BILL_STATUS',
];
const STAGE_DONE_WORD = {
  INVOICE: 'invoiced', INVOICE_ENTRY: 'invoiced', INVOICE_EMAIL: 'emailed',
  POD: 'delivered', TRACK_DELIVERY: 'delivered',
  PAYMENT: 'paid', PAYMENT_RECEIPT: 'paid', PAYMENT_FOLLOWUP: 'followed up',
  TRANSPORT_BILL_RECEIVE: 'transport received', TRANSPORT_BILL_STATUS: 'transport settled',
};

// Work out the business records this task is mapped to, so a watcher can jump
// straight to them to verify: the order it belongs to (universal) plus the
// specific record(s) this step produces/touches (challan, dispatch plan, invoice…).
const deriveLinks = (proc, step) => {
  const ctx = {
    soNumber: proc?.soNumber,
    orderId: proc?.salesOrderId?._id || proc?.salesOrderId,
    processId: proc?._id,
    intakeId: proc?.intakeId?._id || proc?.intakeId,
  };
  const orderLink = ctx.orderId
    ? { label: `Sales Order${proc?.soNumber ? ` · ${proc.soNumber}` : ''}`, to: `/orders/${encodeURIComponent(String(ctx.orderId))}` }
    : (ctx.intakeId ? { label: 'Order Intake', to: `/order-intake?convert=${encodeURIComponent(String(ctx.intakeId))}` } : null);
  // One record link per attached action, minus the order itself — and de-duped by
  // destination so two action keys that point at the SAME page (e.g. DISPATCH_PLAN
  // + DISPATCH_PLAN_PDF both open Dispatch Planning) collapse into a single button.
  const seenTo = new Set();
  const recordLinks = stepActionKeys(step)
    .map((key) => { const r = resolveEntityLink(key, ctx); return r ? { key, ...r } : null; })
    .filter(Boolean)
    .filter((r) => r.to !== orderLink?.to)
    .filter((r) => { if (seenTo.has(r.to)) return false; seenTo.add(r.to); return true; });
  return { ctx, orderLink, recordLinks };
};

const MetaRow = ({ icon: Icon, label, value }) => (
  <Stack direction="row" spacing={1.25} alignItems="flex-start">
    <Box sx={{ mt: '2px', color: 'text.secondary' }}><Icon size={16} /></Box>
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{value || '—'}</Typography>
    </Box>
  </Stack>
);

// One tile in the "What to do" SOP header — a labelled Who / How / When fact.
const SopTile = ({ icon: Icon, label, value }) => (
  <Box sx={{ p: 0.75, borderRadius: 1.5, bgcolor: 'action.hover', display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
    <Box sx={{ color: 'text.secondary', mt: '1px', flexShrink: 0 }}><Icon size={13} /></Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ display: 'block', color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 700, fontSize: '0.58rem' }}>{label}</Typography>
      <Typography sx={{ fontWeight: 600, lineHeight: 1.2, wordBreak: 'break-word', fontSize: '0.8rem' }}>{value || '—'}</Typography>
    </Box>
  </Box>
);

// One Yes/No verification question. Picking "No" asks for a remark first.
const VerificationRow = ({ item, disabled, onAnswer }) => {
  const [noMode, setNoMode] = useState(false);
  const [remark, setRemark] = useState('');
  const answered = !!item.answer;
  return (
    <Box sx={{ py: 0.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="body2" sx={{ flex: 1, minWidth: 200 }}>{item.question}</Typography>
        <Button size="small" variant={item.answer === 'YES' ? 'contained' : 'outlined'} color="success"
          disabled={disabled} sx={{ minWidth: 52, px: 1 }}
          onClick={() => { setNoMode(false); onAnswer(item, item.answer === 'YES' ? null : 'YES'); }}>
          Yes
        </Button>
        <Button size="small" variant={item.answer === 'NO' ? 'contained' : 'outlined'} color="error"
          disabled={disabled} sx={{ minWidth: 52, px: 1 }}
          onClick={() => (item.answer === 'NO' ? onAnswer(item, null) : setNoMode(true))}>
          No
        </Button>
      </Stack>
      {answered && (
        <Typography variant="caption" color="text.secondary">
          {item.answer === 'NO' && item.remark ? `Reason: ${item.remark} — ` : ''}by {item.answeredByName || 'user'}{item.answeredAt ? ` · ${fmt(item.answeredAt)}` : ''}
        </Typography>
      )}
      {noMode && !disabled && (
        <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
          <TextField size="small" fullWidth autoFocus placeholder="Why not? (required for No)"
            value={remark} onChange={(e) => setRemark(e.target.value)} />
          <Button size="small" variant="contained" color="error" disabled={!remark.trim()}
            onClick={() => { onAnswer(item, 'NO', remark.trim()); setNoMode(false); setRemark(''); }}>
            Save No
          </Button>
          <Button size="small" onClick={() => { setNoMode(false); setRemark(''); }}>Cancel</Button>
        </Stack>
      )}
    </Box>
  );
};

// One data-capture field. Saves on the Save button (shown once edited).
const FormFieldRow = ({ item, disabled, onSave }) => {
  const [val, setVal] = useState(item.value ?? '');
  React.useEffect(() => { setVal(item.value ?? ''); }, [item.value]);
  const dirty = String(val ?? '') !== String(item.value ?? '');
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
      <TextField
        size="small" fullWidth disabled={disabled}
        label={`${item.label}${item.required ? ' *' : ''}`}
        type={item.fieldType === 'NUMBER' ? 'number' : item.fieldType === 'DATE' ? 'date' : 'text'}
        InputLabelProps={item.fieldType === 'DATE' ? { shrink: true } : undefined}
        value={val} onChange={(e) => setVal(e.target.value)}
        helperText={item.filledByName ? `Filled by ${item.filledByName}` : undefined}
      />
      {dirty && !disabled && (
        <Button size="small" variant="contained" onClick={() => onSave(item, val)}>Save</Button>
      )}
    </Stack>
  );
};

/**
 * Reusable step panel — SOP definition (Who/What/How/When) + Planned/Actual/Delay
 * + the task layer (checklist, comments, buddy). When opened from My Tasks the
 * passed `step` is partial, so we fetch the full process to hydrate checklist/comments.
 */
const StepDetailCard = ({ open, onClose, processId, step, orderLabel, canAct: canActProp, canManage, asPage = false, autoComplete = false, consignment: consignmentProp = null }) => {
  const myId = useSelector((s) => s.auth?.user?._id);
  const [link, setLink] = useState('');
  const [remarks, setRemarks] = useState('');
  const [assignSel, setAssignSel] = useState([]); // selected doer ids (reassign)
  const [buddySel, setBuddySel] = useState([]);    // selected buddy ids (reassign)
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  const [uploading, setUploading] = useState(false);
  const fileInputRef = React.useRef(null);

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [markActionDone] = useMarkActionDoneMutation();
  const [completeStep, { isLoading: completing }] = useCompleteStepMutation();
  const [assignStep, { isLoading: assigning }] = useAssignStepMutation();
  const [toggleItem] = useToggleChecklistItemMutation();
  const [answerVerification] = useAnswerVerificationMutation();
  const [fillFormField] = useFillFormFieldMutation();
  const [approveStepMut, { isLoading: approving }] = useApproveStepMutation();
  const [addComment, { isLoading: commenting }] = useAddStepCommentMutation();
  const [uploadFile] = useUploadFileMutation();
  const [addAttachments] = useAddStepAttachmentsMutation();
  const [removeAttachment] = useRemoveStepAttachmentMutation();
  const { data: usersRes } = useListAccessUsersQuery(undefined, { skip: !canManage });
  const users = usersRes?.data || [];

  // Always read the live step from the process query while open, so checklist
  // ticks/unticks and comments reflect immediately after each mutation
  // (the mutation invalidates the O2DProcess tag → this refetches).
  const { data: procRes } = useGetProcessByIdQuery(processId, { skip: !open || !processId });
  const liveStep = procRes?.data?.steps?.find((s) => s.stepCode === step?.stepCode) || step;

  // Phased / split dispatch: when this is the quantity-gated dispatch step, pull the
  // live schedule so the card can show the per-phase breakdown + overall progress.
  const isQtyGated = !!(liveStep?.quantityGated || liveStep?.dispatchProgress);
  const { data: schedRes } = useGetScheduleQuery(
    procRes?.data?.soNumber,
    { skip: !open || !procRes?.data?.soNumber || !isQtyGated },
  );
  // Post-dispatch step (invoice / email / track / pay / transport) → load the
  // per-challan ledger. Detected by the step's per-consignment action key, so even
  // the non-gated ones (email / follow-up / transport) can scope to one challan.
  const isConsGated = !!(liveStep?.consignmentGated || liveStep?.executionProgress);
  const stepKeys = stepActionKeys(liveStep);
  const primaryActionKey = stepKeys[0] || liveStep?.triggerKey;
  const isPerConsStep = !isQtyGated && (isConsGated || stepKeys.some((k) => PER_CONSIGNMENT_ACTIONS.includes(k)));
  const { data: consRes } = useGetConsignmentsQuery(processId, { skip: !open || !processId || !isPerConsStep });

  // Resolve WHICH consignment (delivery challan) this task is working on. A
  // post-dispatch step opened as a doer's TASK PAGE focuses on ONE challan — the
  // specific one named by ?dc=, else the next challan still PENDING for THIS step,
  // else the most-recent — instead of the whole order's book. So the doer sees just
  // the delivery their task is for and opens a FRESH form for it (never the prior
  // consignment's filled data). Explicit prop always wins; review popups (not
  // asPage) stay unscoped so managers still see every consignment.
  const consList = consRes?.data?.consignments || [];
  // Is a specific challan already done for THIS step? Uses the per-challan status
  // for the step's own action (invoiced / emailed / delivered / paid / transport…).
  const isStageDoneFor = (c) => { const d = consignmentActionDone(primaryActionKey, c); return d == null ? false : d; };
  const dcScopeParam = searchParams.get('dc');
  const consignment = consignmentProp
    || (dcScopeParam ? consList.find((c) => c.dcNumber === dcScopeParam) : null)
    || ((asPage && isPerConsStep && consList.length)
      ? (consList.find((c) => !isStageDoneFor(c)) || consList[consList.length - 1])
      : null);
  // The challan currently in focus — used to carry the ?dc scope through to the
  // connected form AND forward to the next step, so the whole chain stays per-challan.
  const activeDc = consignment?.dcNumber || dcScopeParam || '';
  const stageDoneWord = STAGE_DONE_WORD[primaryActionKey] || 'done';
  const consComplete = consignment ? isStageDoneFor(consignment) : false;

  // Seed reassign multi-selects from the step's current doers/buddies.
  React.useEffect(() => {
    const a = (liveStep?.assignees?.length ? liveStep.assignees : [liveStep?.assignedTo]).filter(Boolean);
    const b = (liveStep?.buddies?.length ? liveStep.buddies : [liveStep?.buddyUserId]).filter(Boolean);
    setAssignSel(a.map((u) => String(u._id || u)));
    setBuddySel(b.map((u) => String(u._id || u)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, processId, liveStep?.stepCode]);

  // When the doer returns from a connected entry form (?entryDone=1), tick any
  // remaining checklist items once so they only review proof/comments & submit.
  // (Must stay above the early-return below to keep hook order stable.)
  const autoTickedRef = React.useRef(false);
  React.useEffect(() => {
    if (!autoComplete || autoTickedRef.current) return;
    const ls = procRes?.data?.steps?.find((s) => s.stepCode === step?.stepCode) || step;
    if (!ls || ['DONE', 'DELAYED'].includes(ls.status) || !(ls.checklist || []).length) return;
    const pending = (ls.checklist || []).filter((c) => !c.done);
    autoTickedRef.current = true;
    if (!pending.length) return;
    (async () => {
      for (const item of pending) {
        try { await toggleItem({ id: processId, stepCode: ls.stepCode, itemId: item._id, done: true }).unwrap(); }
        catch { /* ignore individual failures */ }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoComplete, processId, step?.stepCode, procRes?.data]);

  // Pre-fill the completion "Link" once with the produced record's deep-link, so
  // a finished step automatically carries a one-click pointer to the related
  // record (order / challan / dispatch plan / invoice). The doer can still edit.
  const seededFor = React.useRef(null);
  React.useEffect(() => {
    const ls = procRes?.data?.steps?.find((s) => s.stepCode === step?.stepCode) || step;
    if (!ls || ['DONE', 'DELAYED'].includes(ls.status)) return;
    // Scope the completion fields to (step + consignment). Switching to another
    // challan re-seeds fresh, so one consignment's link/remarks never carry into
    // another's — each challan's step is filled and completed independently.
    const scopeKey = `${ls.stepCode}::${consignment?.dcNumber || ''}`;
    if (seededFor.current === scopeKey) return;
    seededFor.current = scopeKey;
    setRemarks('');
    const { recordLinks } = deriveLinks(procRes?.data, ls);
    setLink(recordLinks[0]?.to || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procRes?.data, step?.stepCode, consignment?.dcNumber]);

  // Returning from a connected screen's "Do it now" (?doneAction=<key>) → record
  // that exact action as done on the step, capturing its record deep-link. The
  // step itself is NOT auto-completed (several actions may be attached).
  // We record on EVERY return (not only the first) so a recurring action — like a
  // 2nd/3rd actual dispatch on the qty-gated step — refreshes its "done-by / when"
  // to the latest occurrence instead of freezing on the first dispatch's time.
  // The ref still guards against re-firing within a single mount (no write loop).
  const actionDoneRef = React.useRef(null);
  React.useEffect(() => {
    const key = searchParams.get('doneAction');
    if (!key) return;
    const ls = procRes?.data?.steps?.find((s) => s.stepCode === step?.stepCode) || step;
    if (!ls) return;
    const marker = `${ls.stepCode}:${key}`;
    if (actionDoneRef.current === marker) return;
    const { recordLinks } = deriveLinks(procRes?.data, ls);
    const recLink = recordLinks.find((r) => r.key === key)?.to || null;
    actionDoneRef.current = marker;
    markActionDone({ id: processId, stepCode: ls.stepCode, actionKey: key, link: recLink || undefined }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, processId, step?.stepCode, procRes?.data]);

  if (!step) return null;
  // All doers + buddies on the step (arrays, with legacy single fallback).
  const doerList = (liveStep.assignees?.length ? liveStep.assignees : [liveStep.assignedTo]).filter(Boolean);
  const buddyList = (liveStep.buddies?.length ? liveStep.buddies : [liveStep.buddyUserId]).filter(Boolean);
  // The assigned doer or buddy can always act on their own step, even if their
  // role doesn't carry the global o2dfms.act permission.
  const idStr = (u) => String(u._id || u);
  const isDoerForMe = !!myId && doerList.map(idStr).includes(String(myId));
  const isBuddyForMe = !!myId && buddyList.map(idStr).includes(String(myId));
  const isMine = isDoerForMe || isBuddyForMe;
  const canAct = canActProp || isMine;
  const done = ['DONE', 'DELAYED'].includes(liveStep.status);
  const tone = STATUS_TONE[liveStep.status] || STATUS_TONE.PENDING;
  const checklist = liveStep.checklist || [];
  const comments = liveStep.comments || [];
  const remaining = checklist.filter((c) => !c.done).length;
  const proc = procRes?.data;

  // ── Next step in this order's flow ──
  // The IMMEDIATE next step by sequence (2.07 → 2.08 → 2.09 …), so the pipeline
  // reads one-by-one and never appears to "skip" a step. Consignment-gated steps
  // (Invoice/POD/Payment) can complete out of order, so we must NOT hop over a
  // DONE step to the next pending one — that made 2.07 point at 2.09 (skipping the
  // 2.08 email) and 2.09 point at 2.11 (skipping 2.10). Only a genuinely SKIPPED
  // step (not part of this order's flow) is bypassed.
  const procSteps = proc?.steps || [];
  const myStepIdx = procSteps.findIndex((s) => s.stepCode === liveStep.stepCode);
  const nextStep = myStepIdx >= 0
    ? procSteps.slice(myStepIdx + 1).find((s) => s.status !== 'SKIPPED')
    : null;
  const flowComplete = !nextStep && (proc?.isCompleted || (myStepIdx >= 0 && myStepIdx === procSteps.length - 1));

  // ── Completion blockers (mirror of the backend gate) ──
  const verifications = liveStep.verifications || [];
  const formFields = liveStep.formFields || [];
  const unanswered = verifications.filter((v) => !v.answer).length;
  const emptyFields = formFields.filter((f) => f.required && (f.value === null || f.value === undefined || f.value === ''));
  const proofNeed = liveStep.proof?.required ? Math.max(0, (liveStep.proof.minCount || 1) - (liveStep.attachments || []).length) : 0;
  const approvalPending = !!liveStep.approval?.required && !liveStep.approval?.approvedBy;
  const iAmApprover = !!myId && (liveStep.approval?.approverIds || []).map((u) => String(u._id || u)).includes(String(myId));

  const blockers = [];
  if (remaining > 0 && !liveStep.allowIncompleteChecklist) blockers.push(`${remaining} checklist item(s)`);
  if (unanswered > 0) blockers.push(`${unanswered} verification question(s)`);
  if (emptyFields.length > 0) blockers.push(`fields: ${emptyFields.map((f) => f.label).join(', ')}`);
  if (proofNeed > 0) blockers.push(`${proofNeed} more proof attachment(s)`);
  if (approvalPending) blockers.push('approval');
  const checklistBlocks = blockers.length > 0;

  // Connected screens → the real "Do it now" target(s) for THIS order. A step can
  // carry several; each gets its own button and its own done-status.
  const ctxIds = {
    soNumber: proc?.soNumber,
    orderId: proc?.salesOrderId?._id || proc?.salesOrderId,
    processId,
    intakeId: proc?.intakeId?._id || proc?.intakeId,
  };
  const actionProgress = liveStep.actionProgress || [];
  const actions = stepActionKeys(liveStep)
    .map((key) => {
      const meta = actionLinkMeta(key);
      if (!meta) return null;
      const prog = actionProgress.find((a) => a.key === key) || null;
      // Fall back to record-existence for spine actions the external screen
      // couldn't record (see inferActionDone). The "View" link then points at
      // the produced record itself.
      const inferredDone = !prog && inferActionDone(key, proc);
      const viewTo = prog?.link || (inferredDone ? resolveEntityLink(key, ctxIds)?.to : null);
      return { key, meta, to: resolveActionLink(key, ctxIds), prog, inferredDone, viewTo };
    })
    .filter(Boolean);
  // On the quantity-gated dispatch step (2.06) every new dispatch spawns a NEW
  // delivery challan that needs its OWN challan PDF — so "Generate Challan PDF" only
  // counts as done when it was generated AFTER the latest dispatch. A PDF made for a
  // prior challan is stale, so it's offered fresh again ("Do it now") for the new one.
  const lastDispatchAt = isQtyGated
    ? (actionProgress.find((a) => a.key === 'ACTUAL_DISPATCH')?.doneAt || null)
    : null;
  const isActionDone = (a) => {
    const cd = consignment ? consignmentActionDone(a.key, consignment) : null;
    if (cd != null) return cd;
    if (isQtyGated && a.key === 'CHALLAN_PDF' && lastDispatchAt) {
      return !!(a.prog?.doneAt && new Date(a.prog.doneAt) >= new Date(lastDispatchAt));
    }
    return !!a.prog || a.inferredDone;
  };
  const actionsDone = actions.filter(isActionDone).length;

  // When the task is scoped to ONE consignment (challan), this step's "done by /
  // when" must come from THAT challan's own record — each Delivery Challan is
  // dispatched / invoiced / delivered / paid at its own time (logged per-challan
  // in the DB) — not the shared step-level actionProgress. So a 3-dispatch order
  // shows three different dispatch dates, one per consignment.
  const consStepLog = consignment ? (consignment.log?.[liveStep.stepCode] || null) : null;
  const consDoneBy = consStepLog?.doneByName || null;
  // Prefer the per-challan log; else fall back to the challan's own dated record
  // for that step (dispatch date, invoice date, email-sent, delivery date).
  const consDoneAt = consStepLog?.doneAt || (consignment ? ({
    '2.06': consignment.dcDate,
    '2.07': consignment.invoice?.date,
    '2.08': consignment.invoice?.emailSentAt,
    '2.09': consignment.delivery?.date,
  }[liveStep.stepCode] || null) : null);

  // Linked business records this task maps to — for anyone reviewing the step.
  const { orderLink, recordLinks } = deriveLinks(proc, liveStep);
  // Open an internal app route via the router; an external URL in a new tab.
  const openLink = (to) => { if (!to) return; to.startsWith('/') ? navigate(to) : window.open(resolveFileUrl(to), '_blank', 'noopener,noreferrer'); };
  const goAction = (a) => {
    if (!a?.to) return;
    const sep = a.to.includes('?') ? '&' : '?';
    // When this task is scoped to a specific challan, carry its DC so the connected
    // form auto-selects that exact challan and opens fresh for it.
    const dcPart = activeDc ? `&dc=${encodeURIComponent(activeDc)}` : '';
    navigate(`${a.to}${sep}fromTask=${processId}&fromStep=${encodeURIComponent(liveStep.stepCode)}&fromAction=${encodeURIComponent(a.key)}${dcPart}`);
  };
  // Jump to another step's task page in this same order — carrying the challan scope
  // forward, so moving 2.07 → 2.08 → 2.09 stays on the SAME delivery challan.
  const goToStep = (code) => {
    const q = activeDc ? `?dc=${encodeURIComponent(activeDc)}` : '';
    navigate(`/o2d-fms/task/${processId}/${encodeURIComponent(code)}${q}`);
  };

  const handleVerify = async (item, answer, vRemark) => {
    setError('');
    try { await answerVerification({ id: processId, stepCode: liveStep.stepCode, itemId: item._id, answer, remark: vRemark }).unwrap(); }
    catch (e) { setError(e?.data?.message || 'Could not save the answer.'); }
  };
  const handleField = async (item, value) => {
    setError('');
    try { await fillFormField({ id: processId, stepCode: liveStep.stepCode, itemId: item._id, value }).unwrap(); }
    catch (e) { setError(e?.data?.message || 'Could not save the field.'); }
  };
  const handleApprove = async () => {
    setError('');
    try { await approveStepMut({ id: processId, stepCode: liveStep.stepCode }).unwrap(); }
    catch (e) { setError(e?.data?.message || 'Could not approve.'); }
  };

  const handleComplete = async () => {
    setError('');
    if (liveStep.requiresLink && !link) { setError('This step requires a link.'); return; }
    if (checklistBlocks) { setError(`Still needed before Mark Done: ${blockers.join('; ')}.`); return; }
    try {
      await completeStep({ id: processId, stepCode: liveStep.stepCode, link: link || undefined, remarks: remarks || undefined }).unwrap();
      onClose?.(true);
    } catch (e) {
      setError(e?.data?.message || 'Could not complete the step.');
    }
  };

  const handleAssign = async () => {
    setError('');
    try {
      await assignStep({ id: processId, stepCode: liveStep.stepCode, assignees: assignSel, buddies: buddySel }).unwrap();
    } catch (e) {
      setError(e?.data?.message || 'Could not reassign the step.');
    }
  };

  const handleToggle = async (item) => {
    try { await toggleItem({ id: processId, stepCode: liveStep.stepCode, itemId: item._id, done: !item.done }).unwrap(); }
    catch (e) { setError(e?.data?.message || 'Could not update checklist.'); }
  };

  // Upload one or more files (or a recorded voice note) → attach to this step.
  const uploadAndAttach = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true); setError('');
    try {
      const attachments = [];
      for (const f of files) {
        const res = await uploadFile({ file: f, folder: 'o2d-fms' }).unwrap();
        const d = res.data || res;
        attachments.push({ fileName: d.fileName || f.name, fileUrl: d.url, fileKey: d.key, fileType: d.mimeType || f.type, sizeBytes: d.sizeBytes || f.size });
      }
      await addAttachments({ id: processId, stepCode: liveStep.stepCode, attachments }).unwrap();
    } catch (e) {
      setError(e?.data?.message || 'Upload failed.');
    } finally { setUploading(false); }
  };

  const handleComment = async () => {
    if (!comment.trim()) return;
    try { await addComment({ id: processId, stepCode: liveStep.stepCode, text: comment }).unwrap(); setComment(''); }
    catch (e) { setError(e?.data?.message || 'Could not add comment.'); }
  };

  const headerChips = (
    <Stack direction="row" alignItems="center" spacing={0.75} flexWrap="wrap" useFlexGap>
      <Typography sx={{ fontWeight: 800, fontSize: '1.02rem', lineHeight: 1.25 }}>{liveStep.taskTitle || liveStep.name}</Typography>
      <Chip size="small" label={liveStep.stepCode} variant="outlined" sx={{ height: 20, fontSize: '0.68rem' }} />
      <Chip size="small" label={tone.label} sx={{ height: 20, fontSize: '0.68rem', bgcolor: alpha(tone.color, 0.12), color: tone.color, fontWeight: 700 }} />
    </Stack>
  );
  // Quantity-gated dispatch step can't be ticked done until every phase ships —
  // it auto-completes on the last dispatch (balance 0). Mirror the backend guard.
  const qtyGatedBlocked = isQtyGated && !done
    && !(liveStep.dispatchProgress && liveStep.dispatchProgress.orderedQty > 0 && liveStep.dispatchProgress.balanceQty <= 0);
  // Consignment-gated step (Invoice / POD / Payment) → blocked until every
  // consignment is done; auto-completes on the last one.
  const consSummary = consRes?.data?.summary;
  const ep = liveStep.executionProgress;
  const consGatedBlocked = isConsGated && !done
    && !(consSummary ? (consSummary.fullyDispatched && (ep ? consSummary[`all${ep.kind === 'INVOICE' ? 'Invoiced' : ep.kind === 'POD' ? 'Delivered' : 'Paid'}`] : false))
      : (ep && ep.total > 0 && ep.done >= ep.total && ep.fullyDispatched));
  const gatedBlocked = qtyGatedBlocked || consGatedBlocked;
  const markDoneBtn = (!done && canAct) ? (
    <Tooltip title={gatedBlocked ? (qtyGatedBlocked ? 'Completes automatically once all phases are dispatched (balance 0).' : 'Completes automatically once every consignment is done.') : ''}>
      <span>
        <Button onClick={handleComplete} disabled={completing || checklistBlocks || gatedBlocked} variant="contained" startIcon={<CheckCircle2 size={16} />}>
          Mark Done
        </Button>
      </span>
    </Tooltip>
  ) : null;

  const body = (
        <Stack spacing={1}>
          {/* ── Consignment context — shown when this task was opened for ONE specific
                delivery challan of a multi-dispatch order, so it's unmistakable which
                challan's work this is and every action deep-links to that DC. ── */}
          {consignment?.dcNumber && (
            <Paper variant="outlined" sx={{
              p: 1.25, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap',
              bgcolor: alpha('#7c3aed', 0.06), borderColor: alpha('#7c3aed', 0.35),
            }}>
              <Box sx={{ p: 0.6, borderRadius: 1.5, bgcolor: alpha('#7c3aed', 0.12), color: '#7c3aed', display: 'flex' }}><Boxes size={15} /></Box>
              <Box sx={{ flex: 1, minWidth: 160 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.05em' }}>This consignment</Typography>
                <Typography variant="body2" sx={{ fontWeight: 800 }}>
                  {consignment.dcNumber}{consignment.phaseNo ? ` · ${consignment.phaseNo}` : ''}{consignment.qty ? ` · ${Number(consignment.qty).toLocaleString('en-IN')} pcs` : ''}
                </Typography>
              </Box>
              <Chip size="small" label="Actions apply to this challan" sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700, bgcolor: alpha('#7c3aed', 0.1), color: '#6d28d9' }} />
            </Paper>
          )}
          {/* ── What to do — the SOP up front: the task itself, then Who / How / When.
                This LEADS the popup so a non-technical doer immediately sees their job
                (the "next step" pointer lives at the very bottom now). ── */}
          <Paper variant="outlined" sx={{ p: { xs: 1.25, md: 1.5 }, borderRadius: 2 }}>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.6 }}>
              <Box sx={{ p: 0.4, borderRadius: 1.5, bgcolor: alpha('#1d4ed8', 0.1), color: '#1d4ed8', display: 'flex' }}><ClipboardList size={13} /></Box>
              <Typography variant="caption" sx={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary', fontSize: '0.66rem' }}>What to do</Typography>
            </Stack>
            <Typography sx={{ fontWeight: 700, lineHeight: 1.3, mb: 1, fontSize: '0.9rem' }}>
              {liveStep.instructions || liveStep.description || liveStep.name}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' }, gap: 0.75 }}>
              <SopTile icon={User} label="Who does it"
                value={doerList.length ? doerList.map((u) => u.name || 'User').join(', ') : (liveStep.defaultOwnerRole || liveStep.ownerName || 'Unassigned')} />
              <SopTile icon={Wrench} label="How (tool)" value={liveStep.tool || '—'} />
              <SopTile icon={Clock} label="When"
                value={liveStep.whenText || (liveStep.slaMinutes != null ? `Within ${liveStep.slaMinutes} min` : '—')} />
            </Box>
            {buddyList.length > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.6 }}>
                Backup (buddy): {buddyList.map((u) => u.name || 'User').join(', ')}
              </Typography>
            )}
          </Paper>

          {/* ── Do this task here — the WHERE/HOW, placed right under "What to do" so
                a doer sees the task and its action button together, no scrolling. ── */}
          {actions.length > 0 && (
            <Paper variant="outlined" sx={{
              p: 1.25, borderRadius: 2, bgcolor: alpha('#1d4ed8', 0.05), borderColor: alpha('#1d4ed8', 0.35),
            }}>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
                <Box sx={{ p: 0.4, borderRadius: 1.5, bgcolor: alpha('#1d4ed8', 0.12), color: '#1d4ed8', display: 'flex' }}><Zap size={13} /></Box>
                <Typography variant="caption" sx={{ fontWeight: 800, color: '#1e3a8a', fontSize: '0.72rem' }}>
                  Do this task here{actions.length > 1 ? ` — ${actionsDone}/${actions.length} done` : ''}
                </Typography>
                {proc?.soNumber && <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.66rem' }}>· opens for {proc.soNumber}</Typography>}
              </Stack>
              <Stack spacing={0.75}>
                {actions.map((a) => {
                  // Scoped to ONE consignment → this action's done-state comes from
                  // THAT challan, so a fresh challan opens a blank form ("Do it now")
                  // and never shows the first challan's data.
                  const aDone = isActionDone(a);
                  // The step-level "View" link points at the FIRST challan's record —
                  // hide it when scoped so it can't open the wrong consignment's data.
                  const showView = aDone && a.viewTo && !consignment;
                  return (
                    <Stack key={a.key} direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap
                      sx={{ px: 1, py: 0.75, borderRadius: 1.5, bgcolor: 'background.paper', border: '1px solid', borderColor: aDone ? alpha('#0f766e', 0.35) : 'divider' }}>
                      {aDone
                        ? <CheckCircle2 size={15} color="#0f766e" style={{ flexShrink: 0 }} />
                        : <ArrowRight size={15} color="#1d4ed8" style={{ flexShrink: 0 }} />}
                      <Box sx={{ flex: 1, minWidth: 160 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.83rem', lineHeight: 1.25 }}>{a.meta.label}</Typography>
                        {aDone ? (
                          <Typography variant="caption" sx={{ color: '#0f766e', fontSize: '0.68rem', lineHeight: 1.2 }}>
                            {(() => {
                              // Scoped to a challan → use THAT challan's own done-by/date.
                              const by = consDoneBy || a.prog?.doneByName;
                              const at = consDoneAt || a.prog?.doneAt;
                              return (by || at || a.prog || consStepLog)
                                ? `Done${by ? ` by ${by}` : ''}${at ? ` · ${fmt(at)}` : ''}`
                                : 'Done — this entry already exists in the system.';
                            })()}
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem', lineHeight: 1.2 }}>
                            {consignment ? 'Not done for this consignment yet — open it to record a fresh entry.' : 'Not done yet — do the work there; this gets recorded for you.'}
                          </Typography>
                        )}
                      </Box>
                      {showView && (
                        <Button size="small" variant="text" color="success" endIcon={<ExternalLink size={13} />}
                          onClick={() => openLink(a.viewTo)} sx={{ textTransform: 'none' }}>
                          View
                        </Button>
                      )}
                      {a.to && (
                        <Button size="small" variant={aDone ? 'outlined' : 'contained'} endIcon={<ArrowRight size={14} />}
                          onClick={() => goAction(a)} sx={{ whiteSpace: 'nowrap', boxShadow: 'none' }}>
                          {aDone ? (consignment ? 'Open / edit' : 'Do again') : 'Do it now'}
                        </Button>
                      )}
                    </Stack>
                  );
                })}
              </Stack>
            </Paper>
          )}
          {/* Completed banner. When scoped to ONE consignment, report THAT challan's
              own status + date; otherwise the whole step's aggregate completion. */}
          {(consignment ? consComplete : done) && (
            <Alert severity="success" icon={<CheckCircle2 size={18} />} sx={{ py: 0.5 }}>
              {consignment ? (
                <>This delivery ({consignment.dcNumber}) is {stageDoneWord}{consDoneBy ? ` by ${consDoneBy}` : ''}{consDoneAt ? ` · ${fmt(consDoneAt)}` : ''}.</>
              ) : (
                <>Completed{liveStep.completedBy?.name ? ` by ${liveStep.completedBy.name}` : ''}{liveStep.actual ? ` · ${fmt(liveStep.actual)}` : ''}. Nothing more to do on this step.</>
              )}
            </Alert>
          )}
          {/* Returned from the connected entry form — checklist auto-marked. */}
          {autoComplete && !done && (
            <Alert severity="info" icon={<CheckCircle2 size={18} />} sx={{ py: 0.5 }}>
              Entry submitted — checklist marked for you. Add any proof or comments, then <b>Mark Done</b>.
            </Alert>
          )}
          {isBuddyForMe && !isDoerForMe && (
            <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1.25, bgcolor: alpha('#7c3aed', 0.1), borderColor: alpha('#7c3aed', 0.4) }}>
              <Box sx={{ color: '#6d28d9', display: 'flex' }}><Users size={18} /></Box>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 700, color: '#5b21b6' }}>You're the buddy (backup) on this step</Typography>
                <Typography variant="caption" sx={{ color: '#6d28d9' }}>
                  Step in if the main doer{doerList.length ? ` (${doerList.map((u) => u.name || 'User').join(', ')})` : ''} can't — you have full access to complete it.
                </Typography>
              </Box>
            </Paper>
          )}
          {liveStep.isOverdue && !done && (
            <Alert icon={<AlertTriangle size={18} />} severity="warning" sx={{ py: 0.5 }}>This step is past its planned time.</Alert>
          )}

          {/* ── Phased / split dispatch: per-phase breakdown + overall qty progress.
                Completes only when every phase is dispatched (balance 0). ── */}
          {isQtyGated && (() => {
            const sched = schedRes?.data;
            const totals = sched?.totals || {};
            const prog = liveStep.dispatchProgress || {};
            const ordered = prog.orderedQty ?? totals.orderQty ?? 0;
            const dispatched = prog.dispatchedQty ?? totals.actualQty ?? 0;
            const balance = prog.balanceQty ?? Math.max(0, ordered - dispatched);
            const pct = ordered > 0 ? Math.min(100, Math.round((dispatched / ordered) * 100)) : 0;
            const accent = done ? '#0f766e' : '#1d4ed8';
            return (
              <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, bgcolor: alpha(accent, 0.04), borderColor: alpha(accent, 0.3) }}>
                <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
                  <Truck size={16} color={accent} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, fontSize: '0.78rem' }}>Dispatch progress</Typography>
                  <Chip size="small" label={done ? 'Fully dispatched' : 'In progress'} sx={{ fontWeight: 700, bgcolor: alpha(accent, 0.12), color: accent }} />
                  <Box sx={{ flex: 1 }} />
                  <Typography variant="caption" color="text.secondary">{num(dispatched)} / {num(ordered)} pcs · {num(balance)} pending</Typography>
                </Stack>
                <LinearProgress variant="determinate" value={pct} sx={{ height: 7, borderRadius: 4, bgcolor: alpha(accent, 0.12), '& .MuiLinearProgress-bar': { bgcolor: accent } }} />
                {!done && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                    Keep creating delivery challans until the full quantity is dispatched — this step then completes automatically.
                  </Typography>
                )}
              </Paper>
            );
          })()}

          {/* ── Consignment-gated (Invoice / POD / Payment): per-challan status.
                Completes only when every consignment is done. ── */}
          {isConsGated && (() => {
            const allCons = consRes?.data?.consignments || [];
            const sm = consRes?.data?.summary || {};
            const stage = ep?.kind || (liveStep.triggerKey); // INVOICE | POD | PAYMENT
            const accent = done ? '#0f766e' : '#7c3aed';
            const isStageDone = (c) => stage === 'INVOICE' ? c.invoice?.has : stage === 'POD' ? c.delivery?.delivered : c.payment?.confirmed;
            const label = ep?.label || (stage === 'INVOICE' ? 'invoiced' : stage === 'POD' ? 'delivered' : 'paid');
            const stageText = (c) => stage === 'INVOICE' ? (c.invoice?.has ? (c.invoice.invoiceNo || 'Invoiced') : 'Pending')
              : stage === 'POD' ? (c.delivery?.delivered ? 'Delivered' : (c.delivery?.status || 'Pending'))
              : (c.payment?.confirmed ? 'Paid' : (c.payment?.has ? 'Following up' : 'Pending'));
            // When this task was opened for ONE specific challan, show ONLY that
            // challan — the doer is working this delivery, not reviewing the whole
            // order's book. The full per-challan list is kept for the order-level view.
            const scopedDc = consignment?.dcNumber;
            const cons = scopedDc ? allCons.filter((c) => c.dcNumber === scopedDc) : allCons;
            const doneCount = ep?.done ?? (stage === 'INVOICE' ? sm.invoicedDone : stage === 'POD' ? sm.deliveredDone : sm.paidDone) ?? 0;
            const total = ep?.total ?? sm.total ?? allCons.length;
            return (
              <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2, bgcolor: alpha(accent, 0.04), borderColor: alpha(accent, 0.3) }}>
                <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
                  <Boxes size={16} color={accent} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, fontSize: '0.78rem' }}>{scopedDc ? 'This delivery' : 'Per-consignment'}</Typography>
                  <Chip size="small" label={scopedDc ? (cons[0] && isStageDone(cons[0]) ? stageText(cons[0]) : 'Pending') : (done ? `All ${label}` : 'In progress')}
                    sx={{ fontWeight: 700, bgcolor: alpha(accent, 0.12), color: accent }} />
                  <Box sx={{ flex: 1 }} />
                  {!scopedDc && <Typography variant="caption" color="text.secondary">{num(doneCount)} / {num(total)} {label}</Typography>}
                </Stack>
                {cons.length ? (
                  <Stack spacing={0.5}>
                    {cons.map((c) => (
                      <Stack key={String(c.dcId)} direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                        {isStageDone(c) ? <CheckCircle2 size={14} color="#0f766e" /> : <Clock size={14} color="#94a3b8" />}
                        <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{c.dcNumber}</Typography>
                        <Typography variant="caption" color="text.secondary">· {c.phaseNo} · {num(c.qty)} pcs</Typography>
                        <Box sx={{ flex: 1 }} />
                        <Typography variant="caption" sx={{ fontWeight: 700, color: isStageDone(c) ? '#0f766e' : 'text.disabled' }}>{stageText(c)}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                ) : <Typography variant="caption" color="text.secondary">No consignments (delivery challans) yet.</Typography>}
                {!done && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                    {scopedDc
                      ? `Do the work above and mark this delivery ${label}.`
                      : `Recurs per challan — completes automatically once every consignment is ${label}.`}
                  </Typography>
                )}
              </Paper>
            );
          })()}

          {/* (Do this task here → moved up, directly under "What to do".) */}

          {/* ── Linked records → jump to the related entry to verify this task ── */}
          {(orderLink || recordLinks.length > 0) && (
            <Paper variant="outlined" sx={{
              p: 1.25, borderRadius: 2, bgcolor: alpha('#0f766e', 0.05), borderColor: alpha('#0f766e', 0.35),
            }}>
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
                <Link2 size={14} color="#0f766e" />
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#115e59', fontSize: '0.78rem' }}>Linked records</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.66rem' }}>— open to check this task’s entry</Typography>
              </Stack>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {recordLinks.map((r) => (
                  <Button key={r.key} size="small" variant="contained" color="success" endIcon={<ExternalLink size={14} />}
                    onClick={() => openLink(r.to)} sx={{ textTransform: 'none', boxShadow: 'none' }}>
                    {r.label}
                  </Button>
                ))}
                {orderLink && (
                  <Button size="small" variant="outlined" color="success" endIcon={<ExternalLink size={14} />}
                    onClick={() => openLink(orderLink.to)} sx={{ textTransform: 'none' }}>
                    {orderLink.label}
                  </Button>
                )}
              </Stack>
            </Paper>
          )}

          {/* (Who / What / How / When now leads the popup as the "What to do" card.) */}

          {/* Checklist */}
          {checklist.length > 0 && (
            <>
              <Divider />
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.78rem' }}>Checklist</Typography>
                <Typography variant="caption" color={remaining ? 'warning.main' : 'success.main'}>
                  {checklist.length - remaining}/{checklist.length} done
                </Typography>
              </Stack>
              <LinearProgress variant="determinate" value={((checklist.length - remaining) / checklist.length) * 100} sx={{ height: 6, borderRadius: 3 }} />
              <Box>
                {checklist.map((item) => {
                  const tip = item.done
                    ? `Done${item.doneBy?.name ? ` by ${item.doneBy.name}` : ''}${item.doneAt ? ` · ${fmt(item.doneAt)}` : ''} — click to undo`
                    : (done ? 'Step completed' : (canAct ? 'Click to mark done' : 'Read-only'));
                  return (
                    <Tooltip key={item._id} title={tip} placement="left" arrow>
                      <FormControlLabel
                        control={<Checkbox checked={!!item.done} disabled={done || !canAct} onChange={() => handleToggle(item)} size="small" />}
                        label={<Typography variant="body2" sx={{ textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'text.secondary' : 'text.primary' }}>{item.text}</Typography>}
                        sx={{ display: 'flex', mb: -0.5, alignItems: 'flex-start', cursor: done || !canAct ? 'default' : 'pointer' }}
                      />
                    </Tooltip>
                  );
                })}
              </Box>
            </>
          )}

          {/* ── Yes/No verification questions ── */}
          {verifications.length > 0 && (
            <>
              <Divider />
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Stack direction="row" spacing={1} alignItems="center">
                  <HelpCircle size={16} color="#7c3aed" />
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.78rem' }}>Verification questions</Typography>
                </Stack>
                <Typography variant="caption" color={unanswered ? 'warning.main' : 'success.main'}>
                  {verifications.length - unanswered}/{verifications.length} answered
                </Typography>
              </Stack>
              <Box>
                {verifications.map((v) => (
                  <VerificationRow key={v._id} item={v} disabled={done || !canAct} onAnswer={handleVerify} />
                ))}
              </Box>
            </>
          )}

          {/* ── Data capture fields ── */}
          {formFields.length > 0 && (
            <>
              <Divider />
              <Stack direction="row" spacing={1} alignItems="center">
                <FormInput size={16} color="#0369a1" />
                <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.78rem' }}>Data to record</Typography>
              </Stack>
              <Box>
                {formFields.map((f) => (
                  <FormFieldRow key={f._id} item={f} disabled={done || !canAct} onSave={handleField} />
                ))}
              </Box>
            </>
          )}

          {/* ── Approval gate ── */}
          {liveStep.approval?.required && (
            <>
              <Divider />
              <Paper variant="outlined" sx={{
                p: 1.25, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap',
                bgcolor: alpha(approvalPending ? '#b45309' : '#0f766e', 0.05),
                borderColor: alpha(approvalPending ? '#b45309' : '#0f766e', 0.35),
              }}>
                <ShieldCheck size={18} color={approvalPending ? '#b45309' : '#0f766e'} />
                <Box sx={{ flex: 1, minWidth: 160 }}>
                  {approvalPending ? (
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {(() => {
                        const names = (liveStep.approval.approverIds || []).map((u) => u?.name).filter(Boolean);
                        return names.length ? `Waiting for approval from ${names.join(' / ')}` : 'Waiting for the named approver to approve';
                      })()}
                    </Typography>
                  ) : (
                    <Typography variant="body2" sx={{ fontWeight: 600, color: '#0f766e' }}>
                      Approved by {liveStep.approval.approvedByName || 'approver'}{liveStep.approval.approvedAt ? ` · ${fmt(liveStep.approval.approvedAt)}` : ''}
                    </Typography>
                  )}
                </Box>
                {approvalPending && (iAmApprover || canManage) && !done && (
                  <Button size="small" variant="contained" color="success" startIcon={<CheckCircle2 size={15} />}
                    disabled={approving} onClick={handleApprove}>
                    {approving ? 'Approving…' : 'Approve'}
                  </Button>
                )}
              </Paper>
            </>
          )}

          <Divider />
          {/* Planned / Actual / Delay */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2 }}>
            <MetaRow icon={Clock} label="Planned" value={fmt(liveStep.planned)} />
            <MetaRow icon={CheckCircle2} label="Actual" value={fmt(liveStep.actual)} />
            <MetaRow icon={AlertTriangle} label="Time delay" value={liveStep.delayMins ? `${liveStep.delayMins} min late` : (done ? 'On time' : '—')} />
          </Box>

          {liveStep.link && (
            <Stack direction="row" spacing={1} alignItems="center">
              <Link2 size={16} />
              {liveStep.link.startsWith('/') ? (
                <Box component="span" role="link" tabIndex={0}
                  onClick={() => openLink(liveStep.link)}
                  onKeyDown={(e) => { if (e.key === 'Enter') openLink(liveStep.link); }}
                  sx={{ color: 'primary.main', cursor: 'pointer', textDecoration: 'underline', wordBreak: 'break-all' }}>
                  {liveStep.link}
                </Box>
              ) : (
                <a href={resolveFileUrl(liveStep.link)} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>{liveStep.link}</a>
              )}
            </Stack>
          )}
          {liveStep.completedBy?.name && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Completed by {liveStep.completedBy.name}</Typography>
          )}

          {/* Attachments & proof (files + voice notes) */}
          <Divider />
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Stack direction="row" spacing={1} alignItems="center">
              <Paperclip size={16} /><Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Attachments & proof</Typography>
              {liveStep.proof?.required && (
                <Chip size="small" color={proofNeed > 0 ? 'warning' : 'success'} variant="outlined"
                  label={proofNeed > 0 ? `Proof: ${proofNeed} more needed` : `Proof complete (${liveStep.proof.minCount} required)`} />
              )}
            </Stack>
            {(liveStep.attachments || []).length > 0 && (
              <Chip size="small" variant="outlined" label={`${liveStep.attachments.length}`} />
            )}
          </Stack>
          <AttachmentList
            attachments={liveStep.attachments || []}
            onRemove={canAct ? (att) => removeAttachment({ id: processId, stepCode: liveStep.stepCode, attachmentId: att._id }) : undefined}
          />
          {(liveStep.attachments || []).length === 0 && (
            <Typography variant="caption" color="text.disabled">No files or voice notes yet.</Typography>
          )}
          {canAct && (
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <input ref={fileInputRef} id="step-attach-input" name="stepAttachments" type="file" multiple hidden
                onChange={(e) => { uploadAndAttach(e.target.files); e.target.value = ''; }} />
              <Button size="small" variant="outlined" startIcon={<Paperclip size={15} />}
                onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? 'Uploading…' : 'Attach files'}
              </Button>
              <VoiceRecorder onRecorded={(file) => uploadAndAttach([file])} disabled={uploading} />
            </Stack>
          )}

          {/* Comments */}
          <Divider />
          <Stack direction="row" spacing={1} alignItems="center">
            <MessageSquare size={16} /><Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Comments</Typography>
          </Stack>
          {comments.length === 0 && (
            <Typography variant="caption" color="text.disabled">No comments yet.</Typography>
          )}
          {comments.map((cm) => {
            const who = cm.userName || cm.userId?.name || 'User';
            return (
              <Stack key={cm._id} direction="row" spacing={1} alignItems="flex-start">
                <Avatar sx={{ width: 24, height: 24, fontSize: 11, bgcolor: alpha('#1d4ed8', 0.15), color: '#1e3a8a' }}>
                  {who[0]?.toUpperCase()}
                </Avatar>
                <Box>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>{who}</Typography>
                  <Typography variant="caption" color="text.secondary"> · {fmt(cm.at)}</Typography>
                  <Typography variant="body2">{cm.text}</Typography>
                </Box>
              </Stack>
            );
          })}
          {canAct && (
            <Stack direction="row" spacing={1}>
              <TextField size="small" placeholder="Add a comment…" value={comment} onChange={(e) => setComment(e.target.value)} fullWidth
                onKeyDown={(e) => { if (e.key === 'Enter') handleComment(); }} />
              <IconButton onClick={handleComment} disabled={commenting}><Send size={16} /></IconButton>
            </Stack>
          )}

          {/* Action area */}
          {!done && canAct && (
            <>
              <Divider />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Complete this step</Typography>
              <TextField size="small" label={`Link${liveStep.requiresLink ? ' (required)' : ''}`} placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} fullWidth />
              <TextField size="small" label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} fullWidth multiline minRows={2} />
              {checklistBlocks && <Alert severity="info" sx={{ py: 0.5 }}>To enable “Mark Done”, finish: {blockers.join('; ')}.</Alert>}
            </>
          )}

          {!done && canManage && (
            <>
              <Divider />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Reassign — multiple doers & buddies allowed</Typography>
              <Stack spacing={1}>
                <Autocomplete
                  multiple size="small"
                  options={users}
                  getOptionLabel={(u) => u.name ? `${u.name} — ${u.email}` : (u.email || '')}
                  isOptionEqualToValue={(o, v) => o._id === v._id}
                  value={users.filter((u) => assignSel.includes(u._id))}
                  onChange={(_, v) => setAssignSel(v.map((u) => u._id))}
                  disableCloseOnSelect
                  ChipProps={{ size: 'small' }}
                  renderInput={(p) => <TextField {...p} label="Doers" placeholder="Type to search…" />}
                />
                <Autocomplete
                  multiple size="small"
                  options={users}
                  getOptionLabel={(u) => u.name ? `${u.name} — ${u.email}` : (u.email || '')}
                  isOptionEqualToValue={(o, v) => o._id === v._id}
                  value={users.filter((u) => buddySel.includes(u._id))}
                  onChange={(_, v) => setBuddySel(v.map((u) => u._id))}
                  disableCloseOnSelect
                  ChipProps={{ size: 'small' }}
                  renderInput={(p) => <TextField {...p} label="Buddies (backup)" placeholder="Type to search…" />}
                />
                <Button onClick={handleAssign} disabled={assigning} startIcon={<UserCog size={16} />} variant="outlined" sx={{ alignSelf: 'flex-start' }}>Save assignment</Button>
              </Stack>
            </>
          )}

          {/* ── What's next — at the very BOTTOM so the current task always leads.
                Shown as a quiet footer pointer, never the first thing the doer sees. ── */}
          {nextStep && (
            <>
              <Divider />
              <Paper variant="outlined" sx={{
                p: 1.25, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap',
                bgcolor: alpha('#1d4ed8', 0.05), borderColor: alpha('#1d4ed8', 0.3),
              }}>
                <Box sx={{ p: 0.6, borderRadius: 1.5, bgcolor: alpha('#1d4ed8', 0.12), color: '#1d4ed8', display: 'flex' }}>
                  <ArrowRight size={15} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 180 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {done ? 'Next step' : 'After this'}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {nextStep.stepCode} · {nextStep.taskTitle || nextStep.name}
                  </Typography>
                </Box>
                <Button variant="outlined" size="small" endIcon={<ArrowRight size={14} />}
                  onClick={() => goToStep(nextStep.stepCode)} sx={{ whiteSpace: 'nowrap' }}>
                  {['DONE', 'DELAYED'].includes(nextStep.status) ? 'Review' : 'Open'}
                </Button>
              </Paper>
            </>
          )}
          {flowComplete && done && (
            <>
              <Divider />
              <Paper variant="outlined" sx={{
                p: 1.5, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
                bgcolor: alpha('#0f766e', 0.06), borderColor: alpha('#0f766e', 0.35),
              }}>
                <CheckCircle2 size={18} color="#0f766e" />
                <Typography variant="body2" sx={{ fontWeight: 700, color: '#115e59', flex: 1, minWidth: 180 }}>
                  This was the last step — the order’s O2D flow is complete. 🎉
                </Typography>
                <Button variant="outlined" color="success" size="small"
                  onClick={() => proc?._id && navigate(`/o2d-fms/process/${proc._id}`)} sx={{ whiteSpace: 'nowrap' }}>
                  View whole order flow
                </Button>
              </Paper>
            </>
          )}

          {error && <Alert severity="error" sx={{ py: 0.5 }}>{error}</Alert>}
        </Stack>
  );

  // Inline page mode — used by the full Task page (no dialog chrome).
  if (asPage) {
    return (
      <Box>
        {headerChips}
        {orderLabel && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>{orderLabel}</Typography>}
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 2.5 }, borderRadius: 3, mt: 1.5 }}>{body}</Paper>
        {markDoneBtn && <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>{markDoneBtn}</Stack>}
      </Box>
    );
  }

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="md" fullWidth
      PaperProps={{ sx: { borderRadius: 3, maxHeight: 'calc(100% - 48px)' } }}>
      <DialogTitle sx={{ pr: 6, py: 1.25, px: { xs: 2, md: 2.5 } }}>
        {headerChips}
        {orderLabel && <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.72rem' }}>{orderLabel}</Typography>}
        <IconButton onClick={() => onClose?.(false)} size="small" sx={{ position: 'absolute', right: 8, top: 8 }}><X size={17} /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ px: { xs: 1.5, md: 2 }, py: 1.5 }}>{body}</DialogContent>
      <DialogActions sx={{ py: 1, px: 2 }}>
        <Button size="small" startIcon={<Workflow size={15} />} sx={{ mr: 'auto', textTransform: 'none' }}
          onClick={() => { onClose?.(false); navigate(`/o2d-fms/process/${processId}`); }}>
          FMS Tracker
        </Button>
        <Button onClick={() => onClose?.(false)}>Close</Button>
        {markDoneBtn}
      </DialogActions>
    </Dialog>
  );
};

export default StepDetailCard;
