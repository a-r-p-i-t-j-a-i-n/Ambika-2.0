import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Stack, Typography,
  Chip, TextField, Button, Divider, Alert, IconButton, MenuItem, alpha,
  Checkbox, FormControlLabel, LinearProgress, Avatar, Tooltip, Paper,
} from '@mui/material';
import {
  X, User, ClipboardList, Wrench, Clock, CheckCircle2, Link2, AlertTriangle, UserCog,
  Users, MessageSquare, Send, Paperclip,
} from 'lucide-react';
import {
  useCompleteStepMutation, useAssignStepMutation, useToggleChecklistItemMutation,
  useAddStepCommentMutation, useGetProcessByIdQuery,
  useUploadFileMutation, useAddStepAttachmentsMutation, useRemoveStepAttachmentMutation,
} from '../../../store/api/o2dFmsApi';
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

/**
 * Reusable step panel — SOP definition (Who/What/How/When) + Planned/Actual/Delay
 * + the task layer (checklist, comments, buddy). When opened from My Tasks the
 * passed `step` is partial, so we fetch the full process to hydrate checklist/comments.
 */
const StepDetailCard = ({ open, onClose, processId, step, orderLabel, canAct: canActProp, canManage, asPage = false }) => {
  const myId = useSelector((s) => s.auth?.user?._id);
  const [link, setLink] = useState('');
  const [remarks, setRemarks] = useState('');
  const [assignSel, setAssignSel] = useState([]); // selected doer ids (reassign)
  const [buddySel, setBuddySel] = useState([]);    // selected buddy ids (reassign)
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  const [uploading, setUploading] = useState(false);
  const fileInputRef = React.useRef(null);

  const [completeStep, { isLoading: completing }] = useCompleteStepMutation();
  const [assignStep, { isLoading: assigning }] = useAssignStepMutation();
  const [toggleItem] = useToggleChecklistItemMutation();
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
  const checklistBlocks = remaining > 0 && !liveStep.allowIncompleteChecklist;

  const handleComplete = async () => {
    setError('');
    if (liveStep.requiresLink && !link) { setError('This step requires a link.'); return; }
    if (checklistBlocks) { setError(`Tick all checklist items first (${remaining} remaining).`); return; }
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
              {checklistBlocks && <Alert severity="info" sx={{ py: 0.5 }}>Finish the checklist to enable “Mark Done”.</Alert>}
            </>
          )}

          {!done && canManage && (
            <>
              <Divider />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Reassign — multiple doers & buddies allowed</Typography>
              <Stack spacing={1}>
                <TextField select size="small" label="Doers" value={assignSel}
                  onChange={(e) => setAssignSel(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
                  SelectProps={{ multiple: true, renderValue: (sel) => users.filter((u) => sel.includes(u._id)).map((u) => u.name).join(', ') || 'Unassigned' }}>
                  {users.map((u) => <MenuItem key={u._id} value={u._id}>{u.name} — {u.email}</MenuItem>)}
                </TextField>
                <TextField select size="small" label="Buddies (backup)" value={buddySel}
                  onChange={(e) => setBuddySel(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
                  SelectProps={{ multiple: true, renderValue: (sel) => users.filter((u) => sel.includes(u._id)).map((u) => u.name).join(', ') || 'None' }}>
                  {users.map((u) => <MenuItem key={u._id} value={u._id}>{u.name} — {u.email}</MenuItem>)}
                </TextField>
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
