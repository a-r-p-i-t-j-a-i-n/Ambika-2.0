import React, { useState } from 'react';
import {
  Box, Paper, Stack, Typography, Chip, LinearProgress, Skeleton, alpha, Button, Avatar, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem, IconButton,
  Table, TableBody, TableCell, TableHead, TableRow, ToggleButtonGroup, ToggleButton,
  Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import { ArrowLeft, CheckCircle2, Circle, AlertTriangle, Clock, SlidersHorizontal, Table as TableIcon, GitBranch, Columns3, LayoutGrid, ChevronDown, Plus, X } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGetProcessByIdQuery, usePlanOrderMutation } from '../../store/api/o2dFmsApi';
import { useListAccessUsersQuery } from '../../store/api/accessControlApi';
import { usePermissions } from '../../hooks/usePermission';
import StepDetailCard from './components/StepDetailCard';
import { ACTION_LINKS, actionLinkMeta } from './actionLinks';

const UNITS = ['MINUTES', 'HOURS', 'DAYS', 'WEEKS', 'MONTHS'];

// Show the order's current lead time as a friendly value + unit (so the field
// pre-fills with the real plan instead of a blank).
const fromMins = (m) => {
  if (!m) return { value: '', unit: 'HOURS' };
  if (m % 43200 === 0) return { value: m / 43200, unit: 'MONTHS' };
  if (m % 10080 === 0) return { value: m / 10080, unit: 'WEEKS' };
  if (m % 1440 === 0) return { value: m / 1440, unit: 'DAYS' };
  if (m % 60 === 0) return { value: m / 60, unit: 'HOURS' };
  return { value: m, unit: 'MINUTES' };
};

// Per-order plan: the COMPLETE plan for THIS order — task, checklist, doer,
// buddy and deadline per step. Pre-filled from the order's current plan
// (inherited from the template). Saving touches only this order.
const PlanOrderDialog = ({ open, onClose, processId, steps, users, onSaved }) => {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [planOrder, { isLoading }] = usePlanOrderMutation();

  React.useEffect(() => {
    if (open) {
      setError('');
      setRows((steps || []).map((s) => {
        const lt = fromMins(s.leadTimeMins);
        return {
          stepCode: s.stepCode, stepName: s.name,
          taskTitle: s.taskTitle || '', instructions: s.instructions || '',
          checklist: (s.checklist || []).map((c) => c.text),
          assignees: (s.assignees?.length ? s.assignees : (s.assignedTo ? [s.assignedTo] : [])).map((x) => String(x._id || x)),
          buddies: (s.buddies?.length ? s.buddies : (s.buddyUserId ? [s.buddyUserId] : [])).map((x) => String(x._id || x)),
          leadValue: lt.value, leadUnit: lt.unit,
          actionLink: s.actionLink || '',
          // Read-only gates carried from the template (shown so the full plan is visible).
          verifications: (s.verifications || []).map((v) => v.question),
          formFields: (s.formFields || []).map((f) => f.label),
          proofRequired: !!s.proof?.required,
          approvalRequired: !!s.approval?.required,
        };
      }));
    }
    // Seed once when the dialog opens; depend on the open flag + order id only
    // (not the steps array ref, which would re-seed and could thrash).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, processId]);

  const upd = (i, patch) => setRows((x) => x.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const nameOf = (id) => users.find((u) => u._id === id)?.name;

  const save = async () => {
    setError('');
    try {
      await planOrder({ id: processId, steps: rows.map((r) => ({
        stepCode: r.stepCode,
        taskTitle: r.taskTitle || undefined,
        instructions: r.instructions || undefined,
        assignees: r.assignees || [],
        buddies: r.buddies || [],
        leadTime: r.leadValue ? { value: Number(r.leadValue), unit: r.leadUnit } : undefined,
        checklist: r.checklist.filter(Boolean).map((text) => ({ text })),
        actionLink: r.actionLink || null,
      })) }).unwrap();
      onSaved?.();
      onClose();
    } catch (e) { setError(e?.data?.message || 'Could not save the plan.'); }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Update the plan — this order only
        <Typography variant="caption" color="text.secondary" display="block">
          Pre-filled from the current plan. Edits here apply to this order only — the template stays untouched.
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        {rows.map((r, i) => (
          <Accordion key={r.stepCode} disableGutters TransitionProps={{ unmountOnExit: true }} sx={{ '&:before': { display: 'none' }, border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 1 }}>
            <AccordionSummary expandIcon={<ChevronDown size={16} />}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Chip size="small" variant="outlined" label={r.stepCode} />
                <Typography sx={{ fontWeight: 600 }}>{r.stepName}</Typography>
                {r.assignees.length > 0 && <Chip size="small" sx={{ bgcolor: alpha('#1d4ed8', 0.1) }} label={r.assignees.map((id) => nameOf(id)).filter(Boolean).join(', ') || `${r.assignees.length} doer(s)`} />}
                {r.checklist.length > 0 && <Chip size="small" variant="outlined" label={`✓ ${r.checklist.length}`} />}
                {r.leadValue && <Chip size="small" variant="outlined" label={`${r.leadValue} ${r.leadUnit.toLowerCase()}`} />}
                {r.actionLink && <Chip size="small" sx={{ bgcolor: alpha('#1d4ed8', 0.1), color: '#1d4ed8' }} label={`🔗 ${actionLinkMeta(r.actionLink)?.label || r.actionLink}`} />}
                {r.verifications.length > 0 && <Chip size="small" variant="outlined" color="secondary" label={`${r.verifications.length} Q`} />}
                {r.formFields.length > 0 && <Chip size="small" variant="outlined" color="info" label={`${r.formFields.length} field`} />}
                {r.proofRequired && <Chip size="small" variant="outlined" color="warning" label="proof" />}
                {r.approvalRequired && <Chip size="small" variant="outlined" color="success" label="approval" />}
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1.5}>
                <TextField size="small" label="Task title" value={r.taskTitle} onChange={(e) => upd(i, { taskTitle: e.target.value })} fullWidth placeholder={r.stepName} />
                <TextField size="small" label="Instructions" value={r.instructions} onChange={(e) => upd(i, { instructions: e.target.value })} fullWidth multiline minRows={2} />
                {/* The connected system action ("Do it now" link) for this step. */}
                <TextField select size="small" fullWidth label="Connect to system action — shows a 'Do it now' link on the task"
                  value={r.actionLink || ''} onChange={(e) => upd(i, { actionLink: e.target.value })}>
                  <MenuItem value=""><em>None</em></MenuItem>
                  {ACTION_LINKS.map((a) => <MenuItem key={a.key} value={a.key}>{a.label}</MenuItem>)}
                </TextField>
                {(r.verifications.length > 0 || r.formFields.length > 0 || r.proofRequired || r.approvalRequired) && (
                  <Box sx={{ p: 1, borderRadius: 1, bgcolor: alpha('#475569', 0.05), border: '1px dashed', borderColor: 'divider' }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>Requirements from template (completed on the task):</Typography>
                    {r.verifications.length > 0 && <Typography variant="caption" display="block">• Verify: {r.verifications.join('; ')}</Typography>}
                    {r.formFields.length > 0 && <Typography variant="caption" display="block">• Capture: {r.formFields.join(', ')}</Typography>}
                    {r.proofRequired && <Typography variant="caption" display="block">• Proof attachment required</Typography>}
                    {r.approvalRequired && <Typography variant="caption" display="block">• Approval required</Typography>}
                  </Box>
                )}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField select size="small" label="Doers (one or more)" value={r.assignees} sx={{ flex: 1 }}
                    onChange={(e) => upd(i, { assignees: typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value })}
                    SelectProps={{ multiple: true, renderValue: (sel) => users.filter((u) => sel.includes(u._id)).map((u) => u.name).join(', ') || '—' }}>
                    {users.map((u) => <MenuItem key={u._id} value={u._id}>{u.name}</MenuItem>)}
                  </TextField>
                  <TextField select size="small" label="Buddies (backup)" value={r.buddies} sx={{ flex: 1 }}
                    onChange={(e) => upd(i, { buddies: typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value })}
                    SelectProps={{ multiple: true, renderValue: (sel) => users.filter((u) => sel.includes(u._id)).map((u) => u.name).join(', ') || '—' }}>
                    {users.map((u) => <MenuItem key={u._id} value={u._id}>{u.name}</MenuItem>)}
                  </TextField>
                  <TextField size="small" label="Lead" type="number" value={r.leadValue} onChange={(e) => upd(i, { leadValue: e.target.value })} sx={{ width: 90 }} />
                  <TextField select size="small" label="Unit" value={r.leadUnit} onChange={(e) => upd(i, { leadUnit: e.target.value })} sx={{ width: 110 }}>
                    {UNITS.map((u) => <MenuItem key={u} value={u}>{u.toLowerCase()}</MenuItem>)}
                  </TextField>
                </Stack>
                <Box>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>Checklist</Typography>
                  {r.checklist.map((text, ci) => (
                    <Stack key={ci} direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                      <TextField size="small" value={text} fullWidth
                        onChange={(e) => { const c = [...r.checklist]; c[ci] = e.target.value; upd(i, { checklist: c }); }} />
                      <IconButton size="small" onClick={() => upd(i, { checklist: r.checklist.filter((_, k) => k !== ci) })}><X size={14} /></IconButton>
                    </Stack>
                  ))}
                  <Button size="small" startIcon={<Plus size={14} />} onClick={() => upd(i, { checklist: [...r.checklist, ''] })} sx={{ mt: 0.5 }}>Add item</Button>
                </Box>
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))}
        {error && <Typography color="error" variant="body2" sx={{ mt: 1 }}>{error}</Typography>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={isLoading}>Save plan</Button>
      </DialogActions>
    </Dialog>
  );
};

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const STATUS = {
  DONE:    { color: '#0f766e', label: 'Done' },
  DELAYED: { color: '#b45309', label: 'Late' },
  PENDING: { color: '#475569', label: 'Pending' },
  SKIPPED: { color: '#94a3b8', label: 'Skipped' },
};

const PHASE_LABEL = {
  PRE_PRODUCTION: 'Pre-Production', PLANNING: 'Planning', EXECUTION: 'Execution', POST_DISPATCH: 'Post-Dispatch',
};

// Names of all doers on a step (arrays, with legacy single fallback).
const doerNames = (s) => {
  const list = (s.assignees?.length ? s.assignees : [s.assignedTo]).filter(Boolean);
  return list.map((u) => u.name || 'User').join(', ');
};

// One labelled line inside a Sheet-view step column.
const SheetRow = ({ label, value }) => (
  <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ py: 0.3 }}>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="caption" sx={{ fontWeight: 600, textAlign: 'right' }}>{value}</Typography>
  </Stack>
);

// Board-view columns (group steps by where they stand).
const BOARD_COLS = [
  { key: 'overdue', label: 'Overdue',        color: '#be123c', match: (s) => s.isOverdue },
  { key: 'pending', label: 'Pending',        color: '#475569', match: (s) => s.status === 'PENDING' && !s.isOverdue },
  { key: 'done',    label: 'Done (on time)', color: '#0f766e', match: (s) => s.status === 'DONE' },
  { key: 'late',    label: 'Completed late', color: '#b45309', match: (s) => s.status === 'DELAYED' },
];

const ProcessDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, refetch } = useGetProcessByIdQuery(id);
  const { can, isRoot } = usePermissions();
  const canManage = can('o2dfms.manage') || isRoot;
  const { data: usersRes } = useListAccessUsersQuery(undefined, { skip: !canManage });
  const [active, setActive] = useState(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [view, setView] = useState('table'); // table = scannable full view (default) | timeline

  const process = data?.data;
  const steps = process?.steps || [];
  const completed = steps.filter((s) => ['DONE', 'DELAYED'].includes(s.status)).length;
  const pct = steps.length ? Math.round((completed / steps.length) * 100) : 0;

  // Group steps by phase for visual sectioning.
  const phases = steps.reduce((acc, s) => {
    const key = s.phase || 'OTHER';
    (acc[key] = acc[key] || []).push(s);
    return acc;
  }, {});

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate(-1)}>Back</Button>
        {process && canManage && (
          <Button variant="outlined" startIcon={<SlidersHorizontal size={16} />} onClick={() => setPlanOpen(true)}>
            Update the plan
          </Button>
        )}
      </Stack>

      {isLoading ? (
        <Skeleton variant="rounded" height={400} />
      ) : !process ? (
        <Paper sx={{ p: 4, textAlign: 'center' }}>No O2D process found for this order.</Paper>
      ) : (
        <>
          <Paper sx={{ p: 2.5, borderRadius: 3, mb: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={2}>
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 800 }}>{process.soNumber}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {process.partyName} · PO {process.poNumber || '—'} · {process.uniqueO2DId || ''}
                </Typography>
              </Box>
              <Chip
                label={process.isCompleted ? 'Completed' : 'In Progress'}
                color={process.isCompleted ? 'success' : 'primary'}
                sx={{ fontWeight: 700 }}
              />
            </Stack>
            <Box sx={{ mt: 2 }}>
              <Stack direction="row" justifyContent="space-between" mb={0.5}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{completed} / {steps.length} steps done</Typography>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>{pct}%</Typography>
              </Stack>
              <LinearProgress variant="determinate" value={pct} sx={{ height: 8, borderRadius: 4 }} />
            </Box>
          </Paper>

          {/* Four ways to read the same flow — MD picks whatever's clearest. */}
          <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
            <ToggleButtonGroup size="small" value={view} exclusive onChange={(_, v) => v && setView(v)} sx={{ flexWrap: 'wrap' }}>
              <ToggleButton value="table"><TableIcon size={15} style={{ marginRight: 6 }} /> Full</ToggleButton>
              <ToggleButton value="sheet"><Columns3 size={15} style={{ marginRight: 6 }} /> Sheet</ToggleButton>
              <ToggleButton value="board"><LayoutGrid size={15} style={{ marginRight: 6 }} /> Board</ToggleButton>
              <ToggleButton value="timeline"><GitBranch size={15} style={{ marginRight: 6 }} /> Timeline</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {/* ── Full view: every step at a glance — who / status / planned / actual / delay / checklist ── */}
          {view === 'table' && (
            <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: alpha('#1d4ed8', 0.06) }}>
                    <TableCell sx={{ width: 40 }}>#</TableCell>
                    <TableCell>Step</TableCell>
                    <TableCell>Doer</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Planned</TableCell>
                    <TableCell>Actual</TableCell>
                    <TableCell align="right">Delay</TableCell>
                    <TableCell align="center">Checklist</TableCell>
                    <TableCell>Done by</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {steps.map((s, i) => {
                    const tn = STATUS[s.status] || STATUS.PENDING;
                    const isCurrent = s.stepCode === process.currentStepCode;
                    return (
                      <TableRow key={s.stepCode} hover onClick={() => setActive(s)}
                        sx={{
                          cursor: 'pointer',
                          bgcolor: s.isOverdue ? alpha('#be123c', 0.05) : isCurrent ? alpha('#1d4ed8', 0.04) : 'inherit',
                          borderLeft: '3px solid', borderLeftColor: s.isOverdue ? '#be123c' : isCurrent ? '#1d4ed8' : 'transparent',
                        }}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.name}</Typography>
                          <Typography variant="caption" color="text.secondary">{s.stepCode}{isCurrent ? ' · current' : ''}</Typography>
                        </TableCell>
                        <TableCell>
                          {doerNames(s)
                            ? <Typography variant="body2">{doerNames(s)}</Typography>
                            : <Typography variant="caption" color="text.secondary">{s.defaultOwnerRole || 'Unassigned'}</Typography>}
                        </TableCell>
                        <TableCell><Chip size="small" label={s.isOverdue ? 'Overdue' : tn.label} sx={{ bgcolor: alpha(s.isOverdue ? '#be123c' : tn.color, 0.12), color: s.isOverdue ? '#be123c' : tn.color, fontWeight: 600 }} /></TableCell>
                        <TableCell><Typography variant="caption">{fmt(s.planned)}</Typography></TableCell>
                        <TableCell><Typography variant="caption">{fmt(s.actual)}</Typography></TableCell>
                        <TableCell align="right">{s.delayMins > 0 ? <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 700 }}>+{s.delayMins}m</Typography> : <Typography variant="caption" color="text.secondary">—</Typography>}</TableCell>
                        <TableCell align="center">{s.checklistTotal > 0 ? <Chip size="small" variant="outlined" color={s.checklistDone === s.checklistTotal ? 'success' : 'default'} label={`${s.checklistDone}/${s.checklistTotal}`} /> : <Typography variant="caption" color="text.secondary">—</Typography>}</TableCell>
                        <TableCell><Typography variant="caption">{s.completedBy?.name || '—'}</Typography></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Paper>
          )}

          {/* ── Sheet view: horizontal, step-by-step columns (like the original FMS sheet) ── */}
          {view === 'sheet' && (
            <Paper sx={{ borderRadius: 3, p: 1.5, overflowX: 'auto' }}>
              <Stack direction="row" spacing={1.5} sx={{ minWidth: 'min-content', pb: 1 }}>
                {steps.map((s, i) => {
                  const tn = STATUS[s.status] || STATUS.PENDING;
                  const head = s.isOverdue ? '#be123c' : tn.color;
                  return (
                    <Paper key={s.stepCode} variant="outlined" onClick={() => setActive(s)}
                      sx={{ flex: '0 0 auto', width: 210, p: 1.25, borderRadius: 2, cursor: 'pointer',
                        borderTop: '3px solid', borderTopColor: head, '&:hover': { boxShadow: 3 } }}>
                      <Typography variant="caption" color="text.secondary">Step {i + 1} · {s.stepCode}</Typography>
                      <Typography sx={{ fontWeight: 700, lineHeight: 1.2, mb: 1, minHeight: 34 }}>{s.name}</Typography>
                      <Chip size="small" label={s.isOverdue ? 'Overdue' : tn.label}
                        sx={{ mb: 1, bgcolor: alpha(head, 0.12), color: head, fontWeight: 600 }} />
                      <SheetRow label="Doer(s)" value={doerNames(s) || s.defaultOwnerRole || 'Unassigned'} />
                      <SheetRow label="Planned" value={fmt(s.planned)} />
                      <SheetRow label="Actual" value={fmt(s.actual)} />
                      <SheetRow label="Delay" value={s.delayMins > 0 ? `+${s.delayMins}m` : '—'} />
                      <SheetRow label="Checklist" value={s.checklistTotal ? `${s.checklistDone}/${s.checklistTotal}` : '—'} />
                      <SheetRow label="Done by" value={s.completedBy?.name || '—'} />
                    </Paper>
                  );
                })}
              </Stack>
            </Paper>
          )}

          {/* ── Board view: steps grouped by where they stand (quick analysis) ── */}
          {view === 'board' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, gap: 1.5 }}>
              {BOARD_COLS.map((col) => {
                const list = steps.filter(col.match);
                return (
                  <Paper key={col.key} sx={{ p: 1.25, borderRadius: 3, bgcolor: alpha(col.color, 0.04), minHeight: 120 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
                      <Typography sx={{ fontWeight: 700, color: col.color }}>{col.label}</Typography>
                      <Chip size="small" label={list.length} sx={{ bgcolor: alpha(col.color, 0.15), color: col.color, fontWeight: 700 }} />
                    </Stack>
                    <Stack spacing={1}>
                      {list.length === 0
                        ? <Typography variant="caption" color="text.disabled">—</Typography>
                        : list.map((s) => (
                          <Paper key={s.stepCode} variant="outlined" onClick={() => setActive(s)}
                            sx={{ p: 1, borderRadius: 2, cursor: 'pointer', '&:hover': { boxShadow: 2 } }}>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.name}</Typography>
                            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25, flexWrap: 'wrap' }}>
                              <Typography variant="caption" color="text.secondary">{s.stepCode} · {doerNames(s) || 'Unassigned'}</Typography>
                              {s.checklistTotal > 0 && <Chip size="small" variant="outlined" label={`✓ ${s.checklistDone}/${s.checklistTotal}`} />}
                            </Stack>
                          </Paper>
                        ))}
                    </Stack>
                  </Paper>
                );
              })}
            </Box>
          )}

          {view === 'timeline' && Object.entries(phases).map(([phase, list]) => (
            <Box key={phase} sx={{ mb: 2 }}>
              <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                {PHASE_LABEL[phase] || phase}
              </Typography>
              <Stack spacing={1} mt={0.5}>
                {list.map((s) => {
                  const tone = STATUS[s.status] || STATUS.PENDING;
                  const overdue = s.isOverdue;
                  const DoneIcon = ['DONE', 'DELAYED'].includes(s.status) ? CheckCircle2 : Circle;
                  return (
                    <Paper
                      key={s.stepCode}
                      onClick={() => setActive(s)}
                      sx={{
                        p: 1.5, borderRadius: 2, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 1.5,
                        borderLeft: '4px solid', borderLeftColor: overdue ? '#be123c' : tone.color,
                        bgcolor: overdue ? alpha('#be123c', 0.04) : 'background.paper',
                        transition: 'box-shadow .15s', '&:hover': { boxShadow: 3 },
                      }}
                    >
                      <DoneIcon size={20} color={tone.color} />
                      <Box sx={{ flex: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography sx={{ fontWeight: 700 }}>{s.name}</Typography>
                          <Chip size="small" variant="outlined" label={s.stepCode} />
                          {overdue && <Chip size="small" icon={<AlertTriangle size={12} />} label="Overdue" color="error" />}
                        </Stack>
                        <Stack direction="row" spacing={2} sx={{ color: 'text.secondary', mt: 0.25 }}>
                          <Stack direction="row" spacing={0.5} alignItems="center">
                            <Clock size={13} /><Typography variant="caption">Plan {fmt(s.planned)}</Typography>
                          </Stack>
                          {s.actual && <Typography variant="caption">Actual {fmt(s.actual)}</Typography>}
                          {s.delayMins > 0 && <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 700 }}>+{s.delayMins} min</Typography>}
                        </Stack>
                      </Box>
                      {s.assignedTo?.name && (
                        <Tooltip title={s.assignedTo.name}>
                          <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: alpha('#1d4ed8', 0.15), color: '#1e3a8a' }}>
                            {s.assignedTo.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}
                          </Avatar>
                        </Tooltip>
                      )}
                      <Chip size="small" label={tone.label} sx={{ bgcolor: alpha(tone.color, 0.12), color: tone.color, fontWeight: 600 }} />
                    </Paper>
                  );
                })}
              </Stack>
            </Box>
          ))}
        </>
      )}

      <StepDetailCard
        open={!!active}
        onClose={(changed) => { setActive(null); if (changed) refetch(); }}
        processId={id}
        step={active}
        orderLabel={process ? `${process.soNumber} · ${process.partyName}` : ''}
        canAct={can('o2dfms.act') || isRoot}
        canManage={canManage}
      />

      <PlanOrderDialog
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        processId={id}
        steps={steps}
        users={usersRes?.data || []}
        onSaved={refetch}
      />
    </Box>
  );
};

export default ProcessDetail;
