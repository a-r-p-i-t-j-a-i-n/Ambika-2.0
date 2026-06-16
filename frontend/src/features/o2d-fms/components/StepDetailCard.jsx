import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Stack, Typography,
  Chip, TextField, Button, Divider, Alert, IconButton, alpha, Autocomplete,
  Checkbox, FormControlLabel, LinearProgress, Avatar, Tooltip, Paper,
} from '@mui/material';
import {
  X, User, ClipboardList, Wrench, Clock, CheckCircle2, Link2, AlertTriangle, UserCog,
  Users, MessageSquare, Send, Paperclip, HelpCircle, FormInput, ShieldCheck, ArrowRight, Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useCompleteStepMutation, useAssignStepMutation, useToggleChecklistItemMutation,
  useAddStepCommentMutation, useGetProcessByIdQuery,
  useUploadFileMutation, useAddStepAttachmentsMutation, useRemoveStepAttachmentMutation,
  useAnswerVerificationMutation, useFillFormFieldMutation, useApproveStepMutation,
} from '../../../store/api/o2dFmsApi';
import { resolveActionLink, actionLinkMeta } from '../actionLinks';
import { useListAccessUsersQuery } from '../../../store/api/accessControlApi';
import { useSelector } from 'react-redux';
import AttachmentList from '../../../components/AttachmentList';
import VoiceRecorder from '../../../components/VoiceRecorder';

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const STATUS_TONE = {
  DONE:    { color: '#0f766e', label: 'Completed' },
  DELAYED: { color: '#b45309', label: 'Completed (late)' },
  PENDING: { color: '#475569', label: 'Pending' },
  SKIPPED: { color: '#94a3b8', label: 'Skipped' },
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
const StepDetailCard = ({ open, onClose, processId, step, orderLabel, canAct: canActProp, canManage, asPage = false, autoComplete = false }) => {
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

  // Action link → the real screen for THIS order.
  const actionMeta = liveStep.actionLink ? actionLinkMeta(liveStep.actionLink) : null;
  const actionTo = actionMeta ? resolveActionLink(liveStep.actionLink, {
    soNumber: proc?.soNumber,
    orderId: proc?.salesOrderId?._id || proc?.salesOrderId,
    processId,
    intakeId: proc?.intakeId?._id || proc?.intakeId,
  }) : null;

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
  const markDoneBtn = (!done && canAct) ? (
    <Button onClick={handleComplete} disabled={completing || checklistBlocks} variant="contained" startIcon={<CheckCircle2 size={16} />}>
      Mark Done
    </Button>
  ) : null;

  const body = (
        <Stack spacing={2}>
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

          {/* ── Do the real work → deep link to the connected screen for THIS order ── */}
          {actionMeta && actionTo && !done && (
            <Paper variant="outlined" sx={{
              p: 1.5, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
              bgcolor: alpha('#1d4ed8', 0.05), borderColor: alpha('#1d4ed8', 0.35),
            }}>
              <Box sx={{ p: 0.9, borderRadius: 2, bgcolor: alpha('#1d4ed8', 0.12), color: '#1d4ed8', display: 'flex' }}><Zap size={18} /></Box>
              <Box sx={{ flex: 1, minWidth: 180 }}>
                <Typography variant="body2" sx={{ fontWeight: 700, color: '#1e3a8a' }}>
                  This task is connected to: {actionMeta.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {proc?.soNumber ? `Opens directly for ${proc.soNumber}. ` : ''}Do the real work there — this step advances automatically.
                </Typography>
              </Box>
              <Button variant="contained" endIcon={<ArrowRight size={15} />} sx={{ whiteSpace: 'nowrap' }}
                onClick={() => {
                  // Carry the task context so the form can bring the doer back here.
                  const sep = actionTo.includes('?') ? '&' : '?';
                  navigate(`${actionTo}${sep}fromTask=${processId}&fromStep=${encodeURIComponent(liveStep.stepCode)}`);
                }}>
                Do it now
              </Button>
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
              <Link2 size={16} /><a href={liveStep.link} target="_blank" rel="noreferrer">{liveStep.link}</a>
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
