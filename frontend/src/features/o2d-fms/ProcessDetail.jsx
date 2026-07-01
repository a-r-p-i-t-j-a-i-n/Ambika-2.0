import React, { useState } from 'react';
import {
  Box, Paper, Stack, Typography, Chip, LinearProgress, Skeleton, alpha, Button, Avatar, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem, IconButton,
  Table, TableBody, TableCell, TableHead, TableRow, ToggleButtonGroup, ToggleButton,
  Accordion, AccordionSummary, AccordionDetails, Checkbox,
} from '@mui/material';
import { ArrowLeft, CheckCircle2, Circle, AlertTriangle, Clock, SlidersHorizontal, Table as TableIcon, GitBranch, Columns3, LayoutGrid, ChevronDown, Plus, X, Link2, Truck, Boxes, ReceiptText, IndianRupee, ArrowRight } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGetProcessByIdQuery, usePlanOrderMutation, useGetConsignmentsQuery } from '../../store/api/o2dFmsApi';
import { useGetScheduleQuery } from '../../store/api/dispatchControlApi';
import { useListAccessUsersQuery } from '../../store/api/accessControlApi';
import { usePermissions } from '../../hooks/usePermission';
import StepDetailCard from './components/StepDetailCard';
import PhaseTimeline from '../planning/components/PhaseTimeline';
import { ACTION_LINKS, actionLinkMeta } from './actionLinks';

const num = (n) => Number(n || 0).toLocaleString('en-IN');

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
          // Multiple connected "Do it now" screens. Seed from the array, falling
          // back to the legacy single key.
          actionLinks: (s.actionLinks?.length ? s.actionLinks : (s.actionLink ? [s.actionLink] : [])),
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
        // Send the full set; mirror the first into the legacy single key so removing
        // a link actually clears it everywhere (the task reads actionLinks first).
        actionLinks: r.actionLinks || [],
        actionLink: (r.actionLinks && r.actionLinks[0]) || null,
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
                {(r.actionLinks || []).map((k) => (
                  <Chip key={k} size="small" sx={{ bgcolor: alpha('#1d4ed8', 0.1), color: '#1d4ed8' }} label={`🔗 ${actionLinkMeta(k)?.label || k}`} />
                ))}
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
                {/* Connected system actions — pick ANY number; each renders its own
                    "Do it now" link on the doer's task. Deselecting one removes it. */}
                <TextField select size="small" fullWidth
                  label="Connect to system actions — each shows a 'Do it now' link on the task"
                  value={r.actionLinks || []}
                  onChange={(e) => upd(i, { actionLinks: typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value })}
                  SelectProps={{
                    multiple: true,
                    displayEmpty: true,
                    renderValue: (sel) => (sel && sel.length
                      ? ACTION_LINKS.filter((a) => sel.includes(a.key)).map((a) => a.label).join(', ')
                      : 'None'),
                  }}
                >
                  {ACTION_LINKS.map((a) => (
                    <MenuItem key={a.key} value={a.key}>
                      <Checkbox size="small" checked={(r.actionLinks || []).includes(a.key)} sx={{ py: 0.25, mr: 0.5 }} />
                      {a.label}
                    </MenuItem>
                  ))}
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
  DONE:        { color: '#0f766e', label: 'Done' },
  DELAYED:     { color: '#b45309', label: 'Late' },
  IN_PROGRESS: { color: '#1d4ed8', label: 'In progress' },
  PENDING:     { color: '#475569', label: 'Pending' },
  SKIPPED:     { color: '#94a3b8', label: 'Skipped' },
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
  { key: 'pending', label: 'Pending',        color: '#475569', match: (s) => (s.status === 'PENDING' || s.status === 'IN_PROGRESS') && !s.isOverdue },
  { key: 'done',    label: 'Done (on time)', color: '#0f766e', match: (s) => s.status === 'DONE' },
  { key: 'late',    label: 'Completed late', color: '#b45309', match: (s) => s.status === 'DELAYED' },
];

// Phased/split dispatch panel — pulls the live schedule and shows the per-phase
// timeline + an overall qty progress bar. Visible whenever the order has the
// quantity-gated dispatch step, so the tracker reflects "done for phase 1, pending
// for the rest" instead of one all-or-nothing tick.
const DispatchPhasesPanel = ({ soNumber, dispatchStep, onPhaseClick }) => {
  const { data, isFetching } = useGetScheduleQuery(soNumber, { skip: !soNumber });
  const sched = data?.data;
  const phaseChips = sched?.phaseChips || [];
  const totals = sched?.totals || {};
  const prog = dispatchStep?.dispatchProgress || {};

  const ordered    = prog.orderedQty ?? totals.orderQty ?? 0;
  const dispatched = prog.dispatchedQty ?? totals.actualQty ?? 0;
  const balance    = prog.balanceQty ?? Math.max(0, ordered - dispatched);
  const pct        = ordered > 0 ? Math.min(100, Math.round((dispatched / ordered) * 100)) : 0;
  const phasesTotal = prog.phasesTotal ?? new Set(phaseChips.map((p) => p.phaseNo)).size;
  const done = ['DONE', 'DELAYED'].includes(dispatchStep?.status);
  const accent = done ? '#0f766e' : '#1d4ed8';

  return (
    <Paper sx={{ p: 2.5, borderRadius: 3, mb: 2, border: '1px solid', borderColor: alpha(accent, 0.25) }}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Truck size={18} color={accent} />
        <Typography sx={{ fontWeight: 800 }}>Dispatch — phased</Typography>
        <Chip size="small" label={done ? 'Fully dispatched' : 'In progress'}
          sx={{ fontWeight: 700, bgcolor: alpha(accent, 0.12), color: accent }} />
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {num(prog.phasesDone ?? 0)} / {num(phasesTotal)} phase{phasesTotal === 1 ? '' : 's'} done
        </Typography>
      </Stack>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary">
          <strong style={{ color: accent }}>{num(dispatched)}</strong> / {num(ordered)} pcs dispatched · {num(balance)} pending
        </Typography>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>{pct}%</Typography>
      </Stack>
      <LinearProgress variant="determinate" value={pct}
        sx={{ height: 8, borderRadius: 4, mb: 1.5, bgcolor: alpha(accent, 0.12), '& .MuiLinearProgress-bar': { bgcolor: accent } }} />
      {isFetching && !phaseChips.length ? (
        <Skeleton variant="rounded" height={130} />
      ) : phaseChips.length ? (
        <PhaseTimeline phaseChips={phaseChips} onPhaseClick={onPhaseClick} />
      ) : (
        <Typography variant="caption" color="text.secondary">No dispatch plan / phases created yet.</Typography>
      )}
    </Paper>
  );
};

// Small status pill — green when that stage is done, muted grey while pending.
const StagePill = ({ ok, label }) => (
  <Chip size="small" label={label}
    sx={{ height: 18, fontSize: '0.58rem', fontWeight: 700,
      bgcolor: ok ? alpha('#0f766e', 0.14) : alpha('#94a3b8', 0.14),
      color: ok ? '#0f766e' : 'text.disabled' }} />
);

// Consignment Tracker — one row per Delivery Challan with its downstream chain
// (Invoice → Eway → Delivery → Payment). Each dispatch is its own consignment, so the
// MD/doer sees exactly which challan is invoiced/delivered/paid and which is pending.
const ConsignmentsPanel = ({ processId }) => {
  const navigate = useNavigate();
  const { data, isFetching } = useGetConsignmentsQuery(processId, { skip: !processId });
  const res = data?.data;
  const consignments = res?.consignments || [];
  const s = res?.summary || {};
  const accent = '#7c3aed';
  if (!isFetching && !consignments.length) return null; // no dispatches yet

  // Pass ?dc=<this challan> so the target form auto-selects the exact consignment.
  const goInvoice = (c) => navigate(`/o2d/invoice-entry?dc=${encodeURIComponent(c.dcNumber || '')}`);
  const goDeliver = (c) => navigate(`/o2d/track-delivery?dc=${encodeURIComponent(c.dcNumber || '')}`);
  const goPay = (c) => navigate(`/o2d/payments?part=receipt&dc=${encodeURIComponent(c.dcNumber || '')}`);

  return (
    <Paper sx={{ p: 2.5, borderRadius: 3, mb: 2, border: '1px solid', borderColor: alpha(accent, 0.25) }}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.25 }}>
        <Boxes size={18} color={accent} />
        <Typography sx={{ fontWeight: 800 }}>Consignments</Typography>
        <Typography variant="caption" color="text.secondary">each challan’s invoice → eway → delivery → payment</Typography>
        <Box sx={{ flex: 1 }} />
        <Chip size="small" label={`${num(s.total)} consignment${s.total === 1 ? '' : 's'}`} sx={{ fontWeight: 700, bgcolor: alpha(accent, 0.1), color: accent }} />
        <Chip size="small" variant="outlined" icon={<ReceiptText size={11} />} label={`${num(s.invoicedDone)}/${num(s.total)} invoiced`} />
        <Chip size="small" variant="outlined" icon={<Truck size={11} />} label={`${num(s.deliveredDone)}/${num(s.total)} delivered`} />
        <Chip size="small" variant="outlined" icon={<IndianRupee size={11} />} label={`${num(s.paidDone)}/${num(s.total)} paid`} />
      </Stack>
      {isFetching && !consignments.length ? <Skeleton variant="rounded" height={120} /> : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 760, '& td, & th': { fontSize: '0.74rem', py: 0.6, px: 1.25 } }}>
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(accent, 0.05) }}>
                {['Challan', 'Date', 'Phase', 'Qty', 'Invoice', 'Eway', 'Delivery', 'Payment', ''].map((h, i) => (
                  <TableCell key={h || i} align={i === 3 ? 'right' : 'left'} sx={{ fontWeight: 700, fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'text.secondary', whiteSpace: 'nowrap' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {consignments.map((c) => (
                <TableRow key={String(c.dcId)} hover>
                  <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: '#0b2545', whiteSpace: 'nowrap' }}>{c.dcNumber}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{c.dcDate ? new Date(c.dcDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</TableCell>
                  <TableCell><Chip size="small" label={c.phaseNo || '—'} sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, bgcolor: alpha('#1d4ed8', 0.1), color: '#1d4ed8' }} /></TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{num(c.qty)}</TableCell>
                  <TableCell><StagePill ok={c.invoice?.has} label={c.invoice?.has ? (c.invoice.invoiceNo || 'Invoiced') : 'Pending'} /></TableCell>
                  <TableCell><StagePill ok={c.eway?.has} label={c.eway?.has ? 'Eway ✓' : '—'} /></TableCell>
                  <TableCell><StagePill ok={c.delivery?.delivered} label={c.delivery?.delivered ? 'Delivered' : (c.delivery?.status || 'Pending')} /></TableCell>
                  <TableCell><StagePill ok={c.payment?.confirmed} label={c.payment?.confirmed ? 'Paid' : (c.payment?.has ? 'Following up' : 'Pending')} /></TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      {!c.invoice?.has && <Tooltip title="Create invoice for this challan"><Button size="small" variant="text" onClick={() => goInvoice(c)} sx={{ minWidth: 0, px: 0.75, fontSize: '0.62rem' }}>Invoice</Button></Tooltip>}
                      {c.invoice?.has && !c.delivery?.delivered && <Tooltip title="Record delivery"><Button size="small" variant="text" onClick={() => goDeliver(c)} sx={{ minWidth: 0, px: 0.75, fontSize: '0.62rem' }}>POD</Button></Tooltip>}
                      {c.invoice?.has && !c.payment?.confirmed && <Tooltip title="Record payment"><Button size="small" variant="text" onClick={() => goPay(c)} sx={{ minWidth: 0, px: 0.75, fontSize: '0.62rem' }}>Pay</Button></Tooltip>}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Paper>
  );
};

// One compact card in a left-to-right chain (a spine step or a consignment stage).
// The whole card is clickable → jumps to that step's screen (view / do / redo).
const ChainCard = ({ code, title, done, active, sub, subDate, onGo, goLabel }) => {
  const c = done ? '#0f766e' : (active ? '#1d4ed8' : '#94a3b8');
  return (
    <Paper variant="outlined" onClick={onGo}
      sx={{
        flex: '0 0 auto', width: 156, p: 1, borderRadius: 2, borderTop: '3px solid', borderTopColor: c,
        cursor: onGo ? 'pointer' : 'default', transition: 'box-shadow .12s, transform .12s',
        '&:hover': onGo ? { boxShadow: 4, transform: 'translateY(-2px)', borderColor: c } : {},
      }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem', fontWeight: 700 }}>{code}</Typography>
      <Typography sx={{ fontWeight: 700, fontSize: '0.72rem', lineHeight: 1.2, minHeight: 30 }}>{title}</Typography>
      <Chip size="small" label={done ? 'Done' : (sub || 'Pending')} sx={{ height: 18, fontSize: '0.58rem', fontWeight: 700, maxWidth: '100%', bgcolor: alpha(c, 0.14), color: c }} />
      {subDate && <Typography variant="caption" sx={{ display: 'block', mt: 0.4, color: 'text.secondary', fontSize: '0.62rem' }} noWrap>{subDate}</Typography>}
      {onGo && (
        <Stack direction="row" spacing={0.25} alignItems="center" sx={{ mt: 0.5, color: done ? '#0f766e' : '#1d4ed8' }}>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 800 }}>{goLabel || (done ? 'Open' : 'Do it')}</Typography>
          <ArrowRight size={11} />
        </Stack>
      )}
    </Paper>
  );
};
const ChainLink = () => <Box sx={{ flex: '0 0 auto', alignSelf: 'center', width: 16, height: 2, bgcolor: alpha('#94a3b8', 0.5) }} />;

// ── Split view — the shared spine (1.01–2.05) runs ONCE, then the flow forks at
// Actual Dispatch: every Delivery Challan gets its own chain (Dispatch → Invoice →
// Eway → Delivery → Payment) left-to-right, stacked below. Steps before dispatch
// never repeat. Driven by the per-consignment ledger (real documents).
const SplitSheetView = ({ steps, processId, soNumber, currentStepCode, navigate }) => {
  const { data, isFetching } = useGetConsignmentsQuery(processId, { skip: !processId });
  const res = data?.data;
  const consignments = res?.consignments || [];
  const summary = res?.summary || {};
  const accent = '#7c3aed';

  const dispatchSeq = steps.find((s) => s.stepCode === '2.06' || s.triggerKey === 'ACTUAL_DISPATCH')?.sequence ?? 6;
  const spine = steps.filter((s) => (s.sequence || 0) < dispatchSeq);

  // Full post-dispatch chain per consignment (2.06 → 2.13). Every card is clickable and
  // jumps to that step's screen, passing BOTH ?so and ?dc so the target form auto-selects
  // THIS exact Delivery Challan (not just the order's newest one).
  const stagesFor = (c) => {
    const link = (base, part) => {
      const sp = new URLSearchParams();
      if (part) sp.set('part', part);
      if (soNumber) sp.set('so', soNumber);
      if (c.dcNumber) sp.set('dc', c.dcNumber);
      const qs = sp.toString();
      return qs ? `${base}?${qs}` : base;
    };
    return [
      { code: '2.06', title: 'Actual Dispatch', done: true, sub: `${num(c.qty)} pcs`, subDate: c.dcDate ? fmt(c.dcDate) : null, onGo: () => navigate(link('/challans')), goLabel: 'View' },
      { code: '2.07', title: 'Invoice & Eway', done: !!c.invoice?.has, sub: c.invoice?.has ? (c.invoice.invoiceNo || 'Invoiced') : 'Pending', subDate: c.invoice?.date ? fmt(c.invoice.date) : null, onGo: () => navigate(link('/o2d/invoice-entry')), goLabel: c.invoice?.has ? 'Do again' : 'Invoice' },
      { code: '2.08', title: 'Email Invoice', done: false, sub: c.invoice?.has ? 'Send to client' : 'After invoice', onGo: () => navigate(link('/o2d/invoice-email')), goLabel: 'Email' },
      { code: '2.09', title: 'Track Delivery', done: !!c.delivery?.delivered, sub: c.delivery?.delivered ? 'Delivered' : (c.delivery?.status || 'Pending'), subDate: c.delivery?.date ? fmt(c.delivery.date) : null, onGo: () => navigate(link('/o2d/track-delivery')), goLabel: c.delivery?.delivered ? 'Do again' : 'POD' },
      { code: '2.10', title: 'Payment Follow-up', done: !!c.payment?.has, sub: c.payment?.has ? 'Following up' : 'Pending', onGo: () => navigate(link('/o2d/payments', 'followup')), goLabel: 'Follow up' },
      { code: '2.11', title: 'Payment', done: !!c.payment?.confirmed, sub: c.payment?.confirmed ? 'Paid' : (c.payment?.has ? 'Follow-up' : 'Pending'), onGo: () => navigate(link('/o2d/payments', 'receipt')), goLabel: c.payment?.confirmed ? 'Do again' : 'Pay' },
      { code: '2.12', title: 'Transport Bill', done: c.transport?.receiptStatus === 'DONE', sub: c.transport?.receiptStatus === 'DONE' ? 'Received' : 'Pending', onGo: () => navigate(link('/o2d/transport-bill', 'receive')), goLabel: 'Receive' },
      { code: '2.13', title: 'Transport Payment', done: c.transport?.paymentStatus === 'DONE', sub: c.transport?.paymentStatus === 'DONE' ? 'Paid' : 'Pending', onGo: () => navigate(link('/o2d/transport-bill', 'status')), goLabel: 'Pay bill' },
    ];
  };

  return (
    <Stack spacing={2}>
      {/* Shared spine — runs once */}
      <Paper sx={{ p: 2, borderRadius: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
          <Boxes size={16} color="#0b2545" />
          <Typography sx={{ fontWeight: 800 }}>Order → Plan</Typography>
          <Chip size="small" label="shared · runs once" sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700, bgcolor: alpha('#0b2545', 0.08), color: '#0b2545' }} />
        </Stack>
        <Box sx={{ display: 'flex', alignItems: 'stretch', overflowX: 'auto', pb: 1 }}>
          {spine.map((s, i) => (
            <React.Fragment key={s.stepCode}>
              {i > 0 && <ChainLink />}
              <ChainCard code={s.stepCode} title={s.name}
                done={['DONE', 'DELAYED'].includes(s.status)}
                active={s.stepCode === currentStepCode || s.status === 'IN_PROGRESS'}
                sub={(STATUS[s.status] || STATUS.PENDING).label}
                subDate={s.actual ? fmt(s.actual) : null}
                onGo={() => navigate(`/o2d-fms/task/${processId}/${encodeURIComponent(s.stepCode)}`)} goLabel="Open" />
            </React.Fragment>
          ))}
        </Box>
      </Paper>

      {/* Fork marker */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 0.5 }}>
        <GitBranch size={15} color={accent} />
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
          Forks at Actual Dispatch — one chain per Delivery Challan{summary.total ? ` (${summary.total})` : ''}. Steps 1.01–2.05 never repeat.
        </Typography>
      </Stack>

      {/* Per-consignment chains */}
      {isFetching && !consignments.length ? (
        <Skeleton variant="rounded" height={140} />
      ) : !consignments.length ? (
        <Paper sx={{ p: 3.5, borderRadius: 3, textAlign: 'center', color: 'text.secondary' }}>
          <Truck size={28} style={{ opacity: 0.4 }} />
          <Typography sx={{ mt: 0.5, fontWeight: 700 }}>No dispatches yet</Typography>
          <Typography variant="caption">Once the first Delivery Challan is created, its chain appears here — and each further dispatch adds its own below.</Typography>
        </Paper>
      ) : consignments.map((c, idx) => (
        <Paper key={String(c.dcId)} sx={{ p: 2, borderRadius: 3, border: '1px solid', borderColor: alpha(accent, 0.22) }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            <Chip size="small" label={`Consignment ${idx + 1}`} sx={{ fontWeight: 800, height: 20, fontSize: '0.62rem', bgcolor: alpha(accent, 0.12), color: accent }} />
            <Typography sx={{ fontWeight: 800, fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem', color: '#0b2545' }}>{c.dcNumber}</Typography>
            <Chip size="small" variant="outlined" label={c.phaseNo || '—'} sx={{ height: 18, fontSize: '0.6rem' }} />
            <Typography variant="caption" color="text.secondary">{num(c.qty)} pcs{c.boxes ? ` · ${num(c.boxes)} box` : ''} · {c.dcDate ? fmt(c.dcDate) : '—'}</Typography>
          </Stack>
          <Box sx={{ display: 'flex', alignItems: 'stretch', overflowX: 'auto', pb: 1 }}>
            {stagesFor(c).map((st, i) => (
              <React.Fragment key={st.code}>
                {i > 0 && <ChainLink />}
                <ChainCard {...st} />
              </React.Fragment>
            ))}
          </Box>
        </Paper>
      ))}
    </Stack>
  );
};

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
  // The quantity-gated dispatch step (if any) drives the phased-dispatch panel.
  const dispatchStep = steps.find((s) => s.quantityGated || s.dispatchProgress);
  const openPlanForPhase = (p) => navigate(`/dispatch-planning?so=${encodeURIComponent(process.soNumber)}${p?.phaseNo ? `&phase=${encodeURIComponent(p.phaseNo)}` : ''}`);

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

          {/* Phased/split dispatch — per-phase progress so the dispatch step isn't
              shown "done" after only phase 1. */}
          {dispatchStep && process.soNumber && (
            <DispatchPhasesPanel soNumber={process.soNumber} dispatchStep={dispatchStep} onPhaseClick={openPlanForPhase} />
          )}

          {/* Consignment Tracker — per-challan invoice/eway/delivery/payment status. */}
          {process.soNumber && <ConsignmentsPanel processId={id} />}

          {/* Four ways to read the same flow — MD picks whatever's clearest. */}
          <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
            <ToggleButtonGroup size="small" value={view} exclusive onChange={(_, v) => v && setView(v)} sx={{ flexWrap: 'wrap' }}>
              <ToggleButton value="table"><TableIcon size={15} style={{ marginRight: 6 }} /> Full</ToggleButton>
              <ToggleButton value="sheet"><Columns3 size={15} style={{ marginRight: 6 }} /> Sheet</ToggleButton>
              <ToggleButton value="split"><Boxes size={15} style={{ marginRight: 6 }} /> Split</ToggleButton>
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
                        <TableCell>
                          <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Chip size="small" label={s.isOverdue ? 'Overdue' : tn.label} sx={{ bgcolor: alpha(s.isOverdue ? '#be123c' : tn.color, 0.12), color: s.isOverdue ? '#be123c' : tn.color, fontWeight: 600 }} />
                            {s.dispatchProgress && (
                              <Tooltip title={`${num(s.dispatchProgress.dispatchedQty)} of ${num(s.dispatchProgress.orderedQty)} pcs dispatched`}>
                                <Chip size="small" variant="outlined" icon={<Truck size={11} />} label={`${num(s.dispatchProgress.dispatchedQty)}/${num(s.dispatchProgress.orderedQty)}`} sx={{ fontWeight: 700 }} />
                              </Tooltip>
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell><Typography variant="caption">{fmt(s.planned)}</Typography></TableCell>
                        <TableCell><Typography variant="caption">{fmt(s.actual)}</Typography></TableCell>
                        <TableCell align="right">{s.delayMins > 0 ? <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 700 }}>+{s.delayMins}m</Typography> : <Typography variant="caption" color="text.secondary">—</Typography>}</TableCell>
                        <TableCell align="center">
                          <Stack direction="row" spacing={0.5} justifyContent="center" alignItems="center" flexWrap="wrap" useFlexGap>
                            {s.checklistTotal > 0
                              ? <Chip size="small" variant="outlined" color={s.checklistDone === s.checklistTotal ? 'success' : 'default'} label={`${s.checklistDone}/${s.checklistTotal}`} />
                              : (!(s.actionLinksTotal > 0) && <Typography variant="caption" color="text.secondary">—</Typography>)}
                            {s.actionLinksTotal > 0 && (
                              <Chip size="small" variant="outlined" icon={<Link2 size={11} />}
                                color={s.actionLinksDone >= s.actionLinksTotal ? 'success' : 'default'}
                                label={`${s.actionLinksDone}/${s.actionLinksTotal}`} />
                            )}
                          </Stack>
                        </TableCell>
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

          {/* ── Split view: shared spine once, then a chain per Delivery Challan ── */}
          {view === 'split' && (
            <SplitSheetView steps={steps} processId={id} soNumber={process.soNumber} currentStepCode={process.currentStepCode} navigate={navigate} />
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
