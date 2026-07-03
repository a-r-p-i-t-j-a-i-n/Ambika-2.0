import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Stack, Typography,
  Chip, TextField, Button, Divider, Alert, IconButton, alpha, Autocomplete,
  Checkbox, FormControlLabel, LinearProgress, Avatar, Tooltip, Paper,
} from '@mui/material';
import {
  X, User, ClipboardList, Wrench, Clock, CheckCircle2, Link2, AlertTriangle, UserCog,
  Users, MessageSquare, Send, Paperclip, HelpCircle, FormInput, ShieldCheck, ArrowRight, Zap,
  ExternalLink, Truck, Boxes,
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
import PhaseTimeline from '../../planning/components/PhaseTimeline';
import { resolveActionLink, actionLinkMeta, resolveEntityLink } from '../actionLinks';
import { resolveFileUrl } from '../../../utils/fileUrl';

const num = (n) => Number(n || 0).toLocaleString('en-IN');
import { useListAccessUsersQuery } from '../../../store/api/accessControlApi';
import { useSelector } from 'react-redux';
import AttachmentList from '../../../components/AttachmentList';
import VoiceRecorder from '../../../components/VoiceRecorder';

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

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
  // One record link per attached action, de-duped and minus the order itself.
  const recordLinks = stepActionKeys(step)
    .map((key) => { const r = resolveEntityLink(key, ctx); return r ? { key, ...r } : null; })
    .filter(Boolean)
    .filter((r) => r.to !== orderLink?.to);
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
const StepDetailCard = ({ open, onClose, processId, step, orderLabel, canAct: canActProp, canManage, asPage = false, autoComplete = false, consignment = null }) => {
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
  // Consignment-gated downstream step (Invoice / POD / Payment) → load the
  // per-challan ledger so the card shows which consignment is still pending.
  const isConsGated = !!(liveStep?.consignmentGated || liveStep?.executionProgress);
  const { data: consRes } = useGetConsignmentsQuery(processId, { skip: !open || !processId || !isConsGated });

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
    if (seededFor.current === ls.stepCode) return;
    const { recordLinks } = deriveLinks(procRes?.data, ls);
    const seed = recordLinks[0]?.to;
    if (seed) { seededFor.current = ls.stepCode; setLink((cur) => cur || seed); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [procRes?.data, step?.stepCode]);

  // Returning from a connected screen's "Do it now" (?doneAction=<key>) → record
  // that exact action as done on the step, capturing its record deep-link. The
  // step itself is NOT auto-completed (several actions may be attached).
  const actionDoneRef = React.useRef(null);
  React.useEffect(() => {
    const key = searchParams.get('doneAction');
    if (!key) return;
    const ls = procRes?.data?.steps?.find((s) => s.stepCode === step?.stepCode) || step;
    if (!ls) return;
    const marker = `${ls.stepCode}:${key}`;
    if (actionDoneRef.current === marker) return;
    if ((ls.actionProgress || []).some((a) => a.key === key)) { actionDoneRef.current = marker; return; }
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
  const actionsDone = actions.filter((a) => a.prog || a.inferredDone).length;

  // Linked business records this task maps to — for anyone reviewing the step.
  const { orderLink, recordLinks } = deriveLinks(proc, liveStep);
  // Open an internal app route via the router; an external URL in a new tab.
  const openLink = (to) => { if (!to) return; to.startsWith('/') ? navigate(to) : window.open(resolveFileUrl(to), '_blank', 'noopener,noreferrer'); };
  const goAction = (a) => {
    if (!a?.to) return;
    const sep = a.to.includes('?') ? '&' : '?';
    // When this task is opened for a specific consignment (multi-dispatch order),
    // carry its DC so the connected form auto-selects that exact challan.
    const dcPart = consignment?.dcNumber ? `&dc=${encodeURIComponent(consignment.dcNumber)}` : '';
    navigate(`${a.to}${sep}fromTask=${processId}&fromStep=${encodeURIComponent(liveStep.stepCode)}&fromAction=${encodeURIComponent(a.key)}${dcPart}`);
  };
  // Jump to another step's task page in this same order.
  const goToStep = (code) => navigate(`/o2d-fms/task/${processId}/${encodeURIComponent(code)}`);

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
    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>{liveStep.taskTitle || liveStep.name}</Typography>
      <Chip size="small" label={liveStep.stepCode} variant="outlined" />
      <Chip size="small" label={tone.label} sx={{ bgcolor: alpha(tone.color, 0.12), color: tone.color, fontWeight: 600 }} />
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
        <Stack spacing={2}>
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
          {/* ── Next step in the order's flow — always at the very top so the doer
                can move straight on (Order Intake → Sales Order → Check Inventory →
                Dispatch Planning → … → done). ── */}
          {nextStep && (
            <Paper variant="outlined" sx={{
              p: 1.5, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
              bgcolor: alpha('#1d4ed8', 0.06), borderColor: alpha('#1d4ed8', 0.35),
            }}>
              <Box sx={{ p: 0.7, borderRadius: 2, bgcolor: alpha('#1d4ed8', 0.12), color: '#1d4ed8', display: 'flex' }}>
                <ArrowRight size={16} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {done ? 'Next step' : 'Up next'}
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {nextStep.stepCode} · {nextStep.taskTitle || nextStep.name}
                  </Typography>
                  {(STATUS_TONE[nextStep.status] || STATUS_TONE.PENDING) && (
                    <Chip size="small" label={(STATUS_TONE[nextStep.status] || STATUS_TONE.PENDING).label}
                      sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700,
                        bgcolor: alpha((STATUS_TONE[nextStep.status] || STATUS_TONE.PENDING).color, 0.12),
                        color: (STATUS_TONE[nextStep.status] || STATUS_TONE.PENDING).color }} />
                  )}
                </Stack>
              </Box>
              <Button variant="contained" size="small" endIcon={<ArrowRight size={14} />}
                onClick={() => goToStep(nextStep.stepCode)} sx={{ boxShadow: 'none', whiteSpace: 'nowrap' }}>
                {['DONE', 'DELAYED'].includes(nextStep.status) ? 'Review next step' : 'Open next step'}
              </Button>
            </Paper>
          )}
          {flowComplete && done && (
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
          )}
          {/* Shared step already completed by someone — make it explicit. */}
          {done && (
            <Alert severity="success" icon={<CheckCircle2 size={18} />} sx={{ py: 0.5 }}>
              Completed{liveStep.completedBy?.name ? ` by ${liveStep.completedBy.name}` : ''}{liveStep.actual ? ` · ${fmt(liveStep.actual)}` : ''}.
              {' '}Nothing more to do on this step.
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
            const phaseChips = sched?.phaseChips || [];
            const totals = sched?.totals || {};
            const prog = liveStep.dispatchProgress || {};
            const ordered = prog.orderedQty ?? totals.orderQty ?? 0;
            const dispatched = prog.dispatchedQty ?? totals.actualQty ?? 0;
            const balance = prog.balanceQty ?? Math.max(0, ordered - dispatched);
            const pct = ordered > 0 ? Math.min(100, Math.round((dispatched / ordered) * 100)) : 0;
            const accent = done ? '#0f766e' : '#1d4ed8';
            return (
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: alpha(accent, 0.04), borderColor: alpha(accent, 0.3) }}>
                <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
                  <Truck size={16} color={accent} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Phased dispatch</Typography>
                  <Chip size="small" label={done ? 'Fully dispatched' : 'In progress'} sx={{ fontWeight: 700, bgcolor: alpha(accent, 0.12), color: accent }} />
                  <Box sx={{ flex: 1 }} />
                  <Typography variant="caption" color="text.secondary">{num(dispatched)} / {num(ordered)} pcs · {num(balance)} pending</Typography>
                </Stack>
                <LinearProgress variant="determinate" value={pct} sx={{ height: 7, borderRadius: 4, mb: 1.25, bgcolor: alpha(accent, 0.12), '& .MuiLinearProgress-bar': { bgcolor: accent } }} />
                {phaseChips.length
                  ? <PhaseTimeline phaseChips={phaseChips} onPhaseClick={(p) => proc?.soNumber && navigate(`/dispatch-planning?so=${encodeURIComponent(proc.soNumber)}${p?.phaseNo ? `&phase=${encodeURIComponent(p.phaseNo)}` : ''}`)} />
                  : <Typography variant="caption" color="text.secondary">No phases planned yet.</Typography>}
                {!done && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                    Completes automatically once every phase is dispatched (balance 0).
                  </Typography>
                )}
              </Paper>
            );
          })()}

          {/* ── Consignment-gated (Invoice / POD / Payment): per-challan status.
                Completes only when every consignment is done. ── */}
          {isConsGated && (() => {
            const cons = consRes?.data?.consignments || [];
            const sm = consRes?.data?.summary || {};
            const stage = ep?.kind || (liveStep.triggerKey); // INVOICE | POD | PAYMENT
            const accent = done ? '#0f766e' : '#7c3aed';
            const doneCount = ep?.done ?? (stage === 'INVOICE' ? sm.invoicedDone : stage === 'POD' ? sm.deliveredDone : sm.paidDone) ?? 0;
            const total = ep?.total ?? sm.total ?? cons.length;
            const isStageDone = (c) => stage === 'INVOICE' ? c.invoice?.has : stage === 'POD' ? c.delivery?.delivered : c.payment?.confirmed;
            const label = ep?.label || (stage === 'INVOICE' ? 'invoiced' : stage === 'POD' ? 'delivered' : 'paid');
            return (
              <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: alpha(accent, 0.04), borderColor: alpha(accent, 0.3) }}>
                <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
                  <Boxes size={16} color={accent} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Per-consignment</Typography>
                  <Chip size="small" label={done ? `All ${label}` : 'In progress'} sx={{ fontWeight: 700, bgcolor: alpha(accent, 0.12), color: accent }} />
                  <Box sx={{ flex: 1 }} />
                  <Typography variant="caption" color="text.secondary">{num(doneCount)} / {num(total)} {label}</Typography>
                </Stack>
                {cons.length ? (
                  <Stack spacing={0.5}>
                    {cons.map((c) => (
                      <Stack key={String(c.dcId)} direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 0.5, borderRadius: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}>
                        {isStageDone(c) ? <CheckCircle2 size={14} color="#0f766e" /> : <Clock size={14} color="#94a3b8" />}
                        <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{c.dcNumber}</Typography>
                        <Typography variant="caption" color="text.secondary">· {c.phaseNo} · {num(c.qty)} pcs</Typography>
                        <Box sx={{ flex: 1 }} />
                        <Typography variant="caption" sx={{ fontWeight: 700, color: isStageDone(c) ? '#0f766e' : 'text.disabled' }}>
                          {stage === 'INVOICE' ? (c.invoice?.has ? (c.invoice.invoiceNo || 'Invoiced') : 'Pending')
                            : stage === 'POD' ? (c.delivery?.delivered ? 'Delivered' : (c.delivery?.status || 'Pending'))
                            : (c.payment?.confirmed ? 'Paid' : (c.payment?.has ? 'Following up' : 'Pending'))}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                ) : <Typography variant="caption" color="text.secondary">No consignments (delivery challans) yet.</Typography>}
                {!done && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                    Recurs per challan — completes automatically once every consignment is {label}.
                  </Typography>
                )}
              </Paper>
            );
          })()}

          {/* ── Do the real work → one "Do it now" per connected screen. Each tracks
                its own done-status; none are mandatory to finish the step. ── */}
          {actions.length > 0 && (
            <Paper variant="outlined" sx={{
              p: 1.5, borderRadius: 2, bgcolor: alpha('#1d4ed8', 0.05), borderColor: alpha('#1d4ed8', 0.35),
            }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: actions.length ? 1 : 0 }}>
                <Box sx={{ p: 0.7, borderRadius: 2, bgcolor: alpha('#1d4ed8', 0.12), color: '#1d4ed8', display: 'flex' }}><Zap size={16} /></Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#1e3a8a' }}>
                  Connected actions{actions.length > 1 ? ` — ${actionsDone}/${actions.length} done` : ''}
                </Typography>
                {proc?.soNumber && <Typography variant="caption" color="text.secondary">· opens for {proc.soNumber}</Typography>}
              </Stack>
              <Stack spacing={1}>
                {actions.map((a) => {
                  const aDone = !!a.prog || a.inferredDone;
                  return (
                    <Stack key={a.key} direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap
                      sx={{ p: 1, borderRadius: 1.5, bgcolor: 'background.paper', border: '1px solid', borderColor: aDone ? alpha('#0f766e', 0.35) : 'divider' }}>
                      {aDone
                        ? <CheckCircle2 size={16} color="#0f766e" style={{ flexShrink: 0 }} />
                        : <ArrowRight size={16} color="#1d4ed8" style={{ flexShrink: 0 }} />}
                      <Box sx={{ flex: 1, minWidth: 160 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{a.meta.label}</Typography>
                        {aDone ? (
                          <Typography variant="caption" sx={{ color: '#0f766e' }}>
                            {a.prog
                              ? `Done${a.prog.doneByName ? ` by ${a.prog.doneByName}` : ''}${a.prog.doneAt ? ` · ${fmt(a.prog.doneAt)}` : ''}`
                              : 'Done — this entry already exists in the system.'}
                          </Typography>
                        ) : (
                          <Typography variant="caption" color="text.secondary">Not done yet — do the work there; this gets recorded for you.</Typography>
                        )}
                      </Box>
                      {aDone && a.viewTo && (
                        <Button size="small" variant="text" color="success" endIcon={<ExternalLink size={13} />}
                          onClick={() => openLink(a.viewTo)} sx={{ textTransform: 'none' }}>
                          View
                        </Button>
                      )}
                      {/* Always available — even after the step is Done — so the doer can
                          re-open the screen to correct/re-do it (e.g. Not Delivered → Delivered,
                          re-generate a PDF, re-record a dispatch). */}
                      {a.to && (
                        <Button size="small" variant={aDone ? 'outlined' : 'contained'} endIcon={<ArrowRight size={14} />}
                          onClick={() => goAction(a)} sx={{ whiteSpace: 'nowrap', boxShadow: 'none' }}>
                          {aDone ? 'Do again' : 'Do it now'}
                        </Button>
                      )}
                    </Stack>
                  );
                })}
              </Stack>
            </Paper>
          )}

          {/* ── Linked records → jump to the related entry to verify this task ── */}
          {(orderLink || recordLinks.length > 0) && (
            <Paper variant="outlined" sx={{
              p: 1.5, borderRadius: 2, bgcolor: alpha('#0f766e', 0.05), borderColor: alpha('#0f766e', 0.35),
            }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Link2 size={16} color="#0f766e" />
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#115e59' }}>Linked records</Typography>
                <Typography variant="caption" color="text.secondary">— open to check this task’s entry</Typography>
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

          {/* Who / What / How / When */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <MetaRow icon={ClipboardList} label="What" value={liveStep.instructions || liveStep.description || liveStep.name} />
            <MetaRow icon={User} label={doerList.length > 1 ? 'Doers' : 'Doer'}
              value={doerList.length ? doerList.map((u) => u.name || 'User').join(', ') : (liveStep.defaultOwnerRole || 'Unassigned')} />
            <MetaRow icon={Wrench} label="How (tool)" value={liveStep.tool} />
            <MetaRow icon={Clock} label="When (SLA)" value={liveStep.slaMinutes != null ? `${liveStep.slaMinutes} min` : '—'} />
          </Box>
          {buddyList.length > 0 && (
            <MetaRow icon={Users} label={buddyList.length > 1 ? 'Buddies (backup)' : 'Buddy (backup)'} value={buddyList.map((u) => u.name || 'User').join(', ')} />
          )}

          {/* Checklist */}
          {checklist.length > 0 && (
            <>
              <Divider />
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Checklist</Typography>
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
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Verification questions</Typography>
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
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Data to record</Typography>
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
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        {headerChips}
        {orderLabel && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{orderLabel}</Typography>}
        <IconButton onClick={() => onClose?.(false)} sx={{ position: 'absolute', right: 8, top: 8 }}><X size={18} /></IconButton>
      </DialogTitle>
      <DialogContent dividers>{body}</DialogContent>
      <DialogActions>
        <Button onClick={() => onClose?.(false)}>Close</Button>
        {markDoneBtn}
      </DialogActions>
    </Dialog>
  );
};

export default StepDetailCard;
