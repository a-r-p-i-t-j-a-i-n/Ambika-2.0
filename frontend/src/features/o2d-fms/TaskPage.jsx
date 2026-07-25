import React from 'react';
import {
  Box, Paper, Stack, Typography, Chip, Button, Skeleton, alpha, Tooltip, Avatar,
} from '@mui/material';
import {
  ArrowLeft, History, CheckCircle2, ListChecks, RefreshCw, UserCog, Paperclip,
  MessageSquare, FileEdit, Truck, Workflow, ArrowRight, Check, User, Clock, ExternalLink, Link2,
} from 'lucide-react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useGetProcessByIdQuery, useGetConsignmentsQuery } from '../../store/api/o2dFmsApi';
import { usePermissions } from '../../hooks/usePermission';
import StepDetailCard from './components/StepDetailCard';
import { O2D, tokenOf, isDone, timingOf } from './o2dTheme';

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const dOnly = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');
const tOnly = (d) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');

// One labelled card in the right sidebar.
const SideCard = ({ label, children }) => (
  <Paper elevation={0} sx={{ borderRadius: 1.5, border: `1px solid ${O2D.line}`, p: 1.5, bgcolor: O2D.surfaceAlt }}>
    <Typography sx={{ fontSize: '0.56rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: O2D.faint, mb: 1 }}>{label}</Typography>
    {children}
  </Paper>
);

// Planned / Actual / Delay mini-tile.
const MiniTile = ({ label, top, bottom, color }) => (
  <Box sx={{ flex: 1, textAlign: 'center', px: 0.5, py: 0.6, borderRadius: 1, border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
    <Typography sx={{ fontSize: '0.5rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: O2D.faint }}>{label}</Typography>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: color || O2D.ink, lineHeight: 1.15 }}>{top}</Typography>
    {bottom ? <Typography sx={{ fontSize: '0.58rem', color: color || O2D.sub, lineHeight: 1.1 }}>{bottom}</Typography> : null}
  </Box>
);

// Map an activity action to an icon + label + colour.
const ACTIVITY = {
  ORDER_ENTRY:        { icon: CheckCircle2, label: 'Order received',     color: '#15803d' },
  STEP_COMPLETED:     { icon: CheckCircle2, label: 'Step completed',     color: '#15803d' },
  STEP_ACTION_DONE:   { icon: Check,        label: 'Action done',        color: '#15803d' },
  DISPATCH_PROGRESS:  { icon: Truck,        label: 'Dispatch recorded',  color: '#1d4ed8' },
  CONSIGNMENT_PROGRESS:{ icon: Truck,       label: 'Consignment update', color: '#7c3aed' },
  CHECKLIST_TICKED:   { icon: ListChecks,   label: 'Checklist ticked',   color: '#1d4ed8' },
  CHECKLIST_UNTICKED: { icon: ListChecks,   label: 'Checklist unticked', color: '#94a3b8' },
  STEP_PLAN_UPDATED:  { icon: FileEdit,     label: 'Plan updated',       color: '#b45309' },
  STEP_REASSIGNED:    { icon: UserCog,      label: 'Reassigned',         color: '#7c3aed' },
  STEP_ATTACHMENT:    { icon: Paperclip,    label: 'Attachment added',   color: '#0369a1' },
  COMMENT:            { icon: MessageSquare, label: 'Comment',           color: '#475569' },
  DEFAULT:            { icon: History,      label: 'Activity',           color: '#64748b' },
};

// One step node on the full 13-step rail. Small by design — a done step is a green
// tick, the step you're on gets a coloured ring, everything else is a muted dot.
// Hover shows the full name; the step code always shows under the dot.
const StepDot = ({ s, current, last }) => {
  const tk = tokenOf(s.status);
  const done = isDone(s.status);
  return (
    <>
      <Tooltip title={`${s.stepCode} · ${s.name}`} arrow>
        <Stack alignItems="center" spacing={0.4} sx={{ flexShrink: 0, minWidth: 40, cursor: 'default' }}>
          <Box sx={{
            // The step being viewed always shows as the current ring — even if it's
            // also "done" — so you can see where you are on the rail.
            width: current ? 24 : 20, height: current ? 24 : 20, borderRadius: '50%', display: 'grid', placeItems: 'center',
            bgcolor: current ? '#fff' : (done ? tk.ring : O2D.surface),
            color: done ? '#fff' : tk.color,
            border: '2px solid', borderColor: (current || done) ? tk.ring : O2D.line,
            boxShadow: current ? `0 0 0 4px ${alpha(tk.ring, 0.18)}` : 'none',
            transition: 'all .12s',
          }}>
            {current ? <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: tk.ring }} /> : (done ? <Check size={12} /> : null)}
          </Box>
          <Typography sx={{ fontSize: '0.56rem', fontWeight: current ? 800 : 700, color: current ? tk.color : (done ? O2D.body : O2D.faint), lineHeight: 1 }}>
            {s.stepCode}
          </Typography>
        </Stack>
      </Tooltip>
      {!last && <Box sx={{ flex: 1, minWidth: 10, height: 2, mt: '10px', bgcolor: done ? tk.ring : O2D.line }} />}
    </>
  );
};

const TaskPage = () => {
  const { processId, stepCode } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const entryDone = searchParams.get('entryDone') === '1'; // returned from a connected form
  const { data, isLoading, refetch, isFetching } = useGetProcessByIdQuery(processId, { pollingInterval: 30_000 });
  const { can, isRoot } = usePermissions();

  const process = data?.data;
  const step = process?.steps?.find((s) => s.stepCode === stepCode);

  // Build the activity feed: timeline entries that mention this step + comments.
  const activity = React.useMemo(() => {
    if (!process || !step) return [];
    const out = [];
    (process.activityTimeline || []).forEach((a) => {
      if ((a.description || '').includes(stepCode)) {
        out.push({ action: a.action, text: a.description, who: a.actorId?.name || 'System', at: a.timestamp });
      }
    });
    (step.comments || []).forEach((c) => {
      out.push({ action: 'COMMENT', text: c.text, who: c.userName || c.userId?.name || 'User', at: c.at });
    });
    return out.sort((x, y) => new Date(y.at) - new Date(x.at));
  }, [process, step, stepCode]);

  // When the task is scoped to ONE delivery challan (?dc=), the post-dispatch steps
  // must reflect THAT challan's own progress — a new dispatch shows 2.07-2.13 fresh,
  // not the previous challan's green ticks. We read the per-challan ledger for this.
  const dcParam = searchParams.get('dc');
  // Fetch the challan ledger whenever the order has one — we need it for BOTH the
  // scoped rail (one challan) and the unscoped rail (order-level, every challan).
  const { data: consRes } = useGetConsignmentsQuery(processId, { skip: !processId });
  const scopedChallan = React.useMemo(
    () => (dcParam ? (consRes?.data?.consignments || []).find((c) => c.dcNumber === dcParam) : null),
    [dcParam, consRes],
  );
  // Per-challan done-state for a post-dispatch step (null = spine step → real status).
  const challanStepDone = (code, c) => {
    if (!c) return null;
    switch (code) {
      case '2.06': return true; // this challan IS a dispatch
      case '2.07': return !!c.invoice?.has;
      case '2.08': return c.invoice?.emailStatus === 'SENT' || !!c.invoice?.emailSentAt;
      case '2.09': return !!c.delivery?.delivered;
      case '2.10': return !!c.payment?.has;
      case '2.11': return !!c.payment?.confirmed;
      case '2.12': return c.transport?.receiptStatus === 'DONE';
      case '2.13': return c.transport?.paymentStatus === 'DONE';
      default: return null;
    }
  };

  // Post-dispatch steps that recur per delivery challan (2.06 stays the shared
  // dispatch step and keeps its own status).
  const POST_STEPS = ['2.07', '2.08', '2.09', '2.10', '2.11', '2.12', '2.13'];

  // Order journey rail — EVERY step (all 13) in sequence, so the doer sees the whole
  // flow and exactly where they are. The post-dispatch steps are per-challan:
  //  • scoped to ONE challan (?dc) → that challan's own progress;
  //  • unscoped (e.g. on the dispatch step) → ORDER-LEVEL: a step is green only when
  //    EVERY challan has done it, so a brand-new dispatch shows 2.07-2.13 fresh
  //    (a non-gated step marked done for just one earlier challan must NOT read done).
  const railSteps = React.useMemo(() => {
    if (!process?.steps) return [];
    const sorted = [...process.steps].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    const cons = consRes?.data?.consignments || [];
    return sorted.map((s) => {
      if (!POST_STEPS.includes(s.stepCode)) return s; // spine + 2.06 → real status
      if (scopedChallan) {
        return { ...s, status: challanStepDone(s.stepCode, scopedChallan) ? 'DONE' : 'PENDING' };
      }
      if (cons.length) {
        const allDone = cons.every((c) => challanStepDone(s.stepCode, c) === true);
        return { ...s, status: allDone ? 'DONE' : 'PENDING' };
      }
      return s;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [process, scopedChallan, consRes]);
  const doneCount = railSteps.filter((s) => isDone(s.status)).length;

  // "Up next" — the IMMEDIATE next step (only a genuinely SKIPPED step is bypassed).
  // We must NOT hop over a step that's merely aggregate-DONE: for a per-consignment
  // step that's done on a PRIOR challan but not this one, jumping past it would skip
  // real work (2.07 → 2.09, skipping the 2.08 email for this delivery).
  const nextStep = React.useMemo(() => {
    if (!process?.steps) return null;
    const ordered = [...process.steps].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    const idx = ordered.findIndex((s) => s.stepCode === stepCode);
    if (idx < 0) return null;
    return ordered.slice(idx + 1).find((s) => s.status !== 'SKIPPED') || null;
  }, [process, stepCode]);

  const tk = step ? tokenOf(step.status) : null;
  // When scoped to a challan, the done-state / who / when must come from THAT
  // challan's own record — each delivery is invoiced / emailed / delivered at its
  // OWN time, so the sidebar and hero show this challan's timing, not the shared step.
  const challanActualOf = (code, c) => {
    if (!c) return null;
    const logAt = c.log?.[code]?.doneAt;
    if (logAt) return logAt;
    return ({ '2.06': c.dcDate, '2.07': c.invoice?.date, '2.08': c.invoice?.emailSentAt, '2.09': c.delivery?.date }[code]) || null;
  };
  const scopedDone = scopedChallan ? (challanStepDone(stepCode, scopedChallan) === true) : (step ? isDone(step.status) : false);
  const actualAt = scopedChallan ? challanActualOf(stepCode, scopedChallan) : step?.actual;
  const actualBy = scopedChallan ? (scopedChallan.log?.[stepCode]?.doneByName || null) : (step?.completedBy?.name || null);
  const stepDone = scopedDone;
  const timing = step ? timingOf(step) : null;
  const ownerName = step
    ? ((step.assignees?.[0]?.name) || step.assignedTo?.name || step.defaultOwnerRole || step.ownerName || 'Unassigned')
    : '';
  const buddyNames = step
    ? (step.buddies?.length ? step.buddies : [step.buddyUserId]).filter(Boolean).map((u) => u.name || 'User').join(', ')
    : '';
  const linkedOrderId = process ? (process.salesOrderId?._id || process.salesOrderId) : null;

  return (
    <Box sx={{ bgcolor: O2D.canvas, minHeight: '100vh' }}>
      {/* ── Slim top bar — Back · identity · Order flow · Refresh ─────────── */}
      <Box sx={{
        position: 'sticky', top: 0, zIndex: 5, bgcolor: alpha('#ffffff', 0.9), backdropFilter: 'blur(6px)',
        borderBottom: `1px solid ${O2D.line}`, px: { xs: 1.5, md: 2.5 }, py: 1,
      }}>
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ flexWrap: 'nowrap' }}>
          <Button startIcon={<ArrowLeft size={15} />} onClick={() => navigate(-1)}
            sx={{ flexShrink: 0, fontWeight: 700, color: O2D.body, textTransform: 'none' }}>Back</Button>
          {process && (
            <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: '0.85rem', color: O2D.sub }}>
              <b style={{ color: O2D.ink }}>{process.soNumber}</b> · {process.partyName}{process.poNumber ? ` · PO ${process.poNumber}` : ''}
            </Typography>
          )}
          {process && (
            <Button variant="text" size="small" startIcon={<Workflow size={14} />}
              onClick={() => navigate(`/o2d-fms/process/${process._id}`)}
              sx={{ fontWeight: 700, whiteSpace: 'nowrap', textTransform: 'none', color: O2D.brand, flexShrink: 0 }}>
              Order flow
            </Button>
          )}
          <Button size="small" startIcon={<RefreshCw size={13} />} onClick={() => refetch()} disabled={isFetching}
            sx={{ textTransform: 'none', color: O2D.sub, flexShrink: 0 }}>Refresh</Button>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.25, md: 1.75 }, py: { xs: 1.25, md: 1.75 } }}>
        {isLoading ? (
          <Skeleton variant="rounded" height={480} sx={{ borderRadius: 1.5 }} />
        ) : !process || !step ? (
          <Paper sx={{ p: 5, textAlign: 'center', borderRadius: 1.5, color: O2D.sub, border: `1px solid ${O2D.line}` }} elevation={0}>
            This task could not be found. It may have been removed or re-planned.
          </Paper>
        ) : (
          <Stack spacing={2}>
            {/* ── Hero — status colour leads, one clear title, faded step code ── */}
            <Paper elevation={0} sx={{ position: 'relative', overflow: 'hidden', borderRadius: 1.5, border: `1px solid ${O2D.line}`, bgcolor: stepDone ? tk.tint : O2D.surface }}>
              {/* colour spine on the left edge = the state at a glance */}
              <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, bgcolor: tk.ring }} />
              <Box sx={{ p: { xs: 1.25, md: 1.5 }, pl: { xs: 1.75, md: 2.25 }, pr: { xs: 7, md: 9 } }}>
                {/* faded step code, watermark style */}
                <Typography sx={{ position: 'absolute', right: 16, top: 8, fontSize: { xs: '1.7rem', md: '2.1rem' }, fontWeight: 900, color: alpha(tk.color, 0.11), lineHeight: 1, letterSpacing: '-0.02em', userSelect: 'none' }}>
                  {step.stepCode}
                </Typography>
                <Chip
                  size="small"
                  icon={<Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: tk.ring, ml: '6px' }} />}
                  label={tk.label}
                  sx={{ fontWeight: 800, fontSize: '0.6rem', letterSpacing: '0.04em', textTransform: 'uppercase', color: tk.color, bgcolor: tk.bg, height: 20, '& .MuiChip-icon': { color: tk.ring } }}
                />
                <Typography sx={{ fontSize: { xs: '1.05rem', md: '1.25rem' }, fontWeight: 800, color: O2D.ink, lineHeight: 1.2, mt: 0.6 }}>
                  {step.taskTitle || step.name}
                </Typography>
                <Typography sx={{ fontSize: '0.76rem', color: O2D.sub, mt: 0.25 }}>
                  {stepDone ? (
                    <>Done{actualBy ? ` by ${actualBy}` : ''}{actualAt ? ` · ${fmt(actualAt)}` : ''}
                      {timing && <Box component="span" sx={{ color: timing.color, fontWeight: 700 }}> · {timing.text}</Box>}</>
                  ) : (
                    <>Owner: <b style={{ color: O2D.body }}>{ownerName}</b>
                      {step.whenText ? ` · ${step.whenText}` : (step.slaMinutes != null ? ` · within ${step.slaMinutes} min` : '')}
                      {step.isOverdue && <Box component="span" sx={{ color: '#b45309', fontWeight: 700 }}> · overdue</Box>}</>
                  )}
                </Typography>
              </Box>
            </Paper>

            {/* ── Order journey rail — all 13 steps, current one ringed ────── */}
            {railSteps.length > 0 && (
              <Paper elevation={0} sx={{ borderRadius: 1.5, border: `1px solid ${O2D.line}`, px: { xs: 1.25, md: 1.75 }, py: 1.25, bgcolor: O2D.surfaceAlt }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: O2D.faint }}>
                    Order journey
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: O2D.sub }}>
                    {doneCount}/{railSteps.length} steps done
                  </Typography>
                </Stack>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', overflowX: 'auto', pb: 0.5 }}>
                  {railSteps.map((s, i) => (
                    <StepDot key={s.stepCode} s={s} current={s.stepCode === stepCode} last={i === railSteps.length - 1} />
                  ))}
                </Box>
              </Paper>
            )}

            {/* ── Two columns: task + checklist LEFT, the who/when/refs RIGHT ── */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0,1fr) 320px' }, gap: 2, alignItems: 'start' }}>
              {/* LEFT — the interactive task body (slim: owner/when + linked move right) */}
              <Box sx={{ minWidth: 0 }}>
                <StepDetailCard
                  asPage hideHeader slimSop hideLinked open
                  processId={process._id}
                  step={step}
                  orderLabel={`${process.soNumber} · ${process.partyName}`}
                  canAct={can('o2dfms.act') || isRoot}
                  canManage={can('o2dfms.manage') || isRoot}
                  autoComplete={entryDone}
                  onClose={() => refetch()}
                />
              </Box>

              {/* RIGHT — everything a watcher needs at a glance, no scrolling */}
              <Stack spacing={1.5} sx={{ position: { md: 'sticky' }, top: { md: 56 } }}>
                <SideCard label="Order reference">
                  <Typography sx={{ fontWeight: 800, color: O2D.brand, fontSize: '0.9rem', lineHeight: 1.2 }}>{process.soNumber}</Typography>
                  <Typography sx={{ fontSize: '0.78rem', color: O2D.body, mt: 0.25 }}>{process.partyName}</Typography>
                  {process.poNumber && <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>PO {process.poNumber}</Typography>}
                </SideCard>

                <SideCard label="Owner">
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Avatar sx={{ width: 30, height: 30, fontSize: '0.8rem', fontWeight: 800, bgcolor: alpha(O2D.brand, 0.12), color: O2D.brand }}>
                      {(ownerName || '?').charAt(0).toUpperCase()}
                    </Avatar>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: '0.82rem', color: O2D.ink }} noWrap>{ownerName}</Typography>
                      <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }} noWrap>
                        {step.tool || 'Manual'}{step.whenText ? ` · ${step.whenText}` : (step.slaMinutes != null ? ` · within ${step.slaMinutes} min` : '')}
                      </Typography>
                    </Box>
                  </Stack>
                  {buddyNames && (
                    <Typography sx={{ fontSize: '0.66rem', color: O2D.faint, mt: 0.75 }}>Backup: {buddyNames}</Typography>
                  )}
                </SideCard>

                <SideCard label="Timing">
                  <Stack direction="row" spacing={0.75}>
                    <MiniTile label="Planned" top={dOnly(step.planned)} bottom={tOnly(step.planned)} />
                    <MiniTile label="Actual" top={dOnly(actualAt)} bottom={tOnly(actualAt)} color={stepDone ? '#15803d' : undefined} />
                    <MiniTile label="Delay" top={stepDone ? (timing?.text?.startsWith('Late') ? 'Late' : 'On time') : '—'} bottom={stepDone && timing?.text?.startsWith('Late') ? `${step.delayMins}m` : ''} color={stepDone ? timing?.color : O2D.faint} />
                  </Stack>
                </SideCard>

                {linkedOrderId && (
                  <SideCard label="Linked record">
                    <Button fullWidth variant="outlined" endIcon={<ExternalLink size={13} />}
                      onClick={() => navigate(`/orders/${linkedOrderId}`)}
                      sx={{ justifyContent: 'space-between', textTransform: 'none', fontWeight: 700, borderColor: O2D.line, color: O2D.body, borderRadius: 1 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                        <Link2 size={14} color={O2D.faint} />
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700 }} noWrap>Sales Order · {process.soNumber}</Typography>
                      </Stack>
                    </Button>
                  </SideCard>
                )}
              </Stack>
            </Box>

            {/* ── Up next ─────────────────────────────────────────────────── */}
            {nextStep && (
              <Paper elevation={0} sx={{ borderRadius: 1.5, border: `1px solid ${O2D.line}`, p: { xs: 1.5, md: 2 }, display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: O2D.band }}>
                <Box sx={{ textAlign: 'center', flexShrink: 0, pr: 1.5, borderRight: `1px solid ${O2D.line}` }}>
                  <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: O2D.faint }}>Up next</Typography>
                  <Typography sx={{ fontSize: '1.15rem', fontWeight: 900, color: O2D.brand, lineHeight: 1.1 }}>{nextStep.stepCode}</Typography>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 800, color: O2D.ink, fontSize: '0.9rem' }} noWrap>{nextStep.taskTitle || nextStep.name}</Typography>
                  {nextStep.instructions && <Typography sx={{ fontSize: '0.75rem', color: O2D.sub }} noWrap>{nextStep.instructions}</Typography>}
                </Box>
                <Button variant="contained" disableElevation endIcon={<ArrowRight size={15} />}
                  onClick={() => navigate(`/o2d-fms/task/${process._id}/${encodeURIComponent(nextStep.stepCode)}${dcParam ? `?dc=${encodeURIComponent(dcParam)}` : ''}`)}
                  sx={{ fontWeight: 800, whiteSpace: 'nowrap', borderRadius: 1, textTransform: 'none', bgcolor: O2D.brand }}>
                  Go to step
                </Button>
              </Paper>
            )}

            {/* ── Activity ───────────────────────────────────────────────── */}
            <Paper elevation={0} sx={{ p: { xs: 1.5, md: 2 }, borderRadius: 1.5, border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt }}>
              <Stack direction="row" spacing={1} alignItems="center" mb={1.25}>
                <History size={15} color={O2D.faint} />
                <Typography sx={{ fontWeight: 800, fontSize: '0.78rem', color: O2D.body }}>Activity</Typography>
                <Chip size="small" variant="outlined" label={activity.length} sx={{ height: 18, fontSize: '0.64rem' }} />
              </Stack>
              {activity.length === 0 ? (
                <Typography variant="body2" sx={{ color: O2D.faint, fontSize: '0.8rem' }}>No activity yet — actions on this task will appear here.</Typography>
              ) : (
                <Stack spacing={0}>
                  {activity.map((a, i) => {
                    const meta = ACTIVITY[a.action] || ACTIVITY.DEFAULT;
                    const Icon = meta.icon;
                    return (
                      <Stack key={i} direction="row" spacing={1.5} sx={{ position: 'relative', pb: 1.75 }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: alpha(meta.color, 0.12), color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Icon size={14} />
                          </Box>
                          {i < activity.length - 1 && <Box sx={{ width: 2, flex: 1, bgcolor: O2D.line, mt: 0.5 }} />}
                        </Box>
                        <Box sx={{ pt: 0.25 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700, fontSize: '0.8rem', color: O2D.ink }}>{meta.label}</Typography>
                          <Typography variant="body2" sx={{ color: O2D.sub, fontSize: '0.78rem' }}>{a.text}</Typography>
                          <Typography variant="caption" sx={{ color: O2D.faint }}>{a.who} · {fmt(a.at)}</Typography>
                        </Box>
                      </Stack>
                    );
                  })}
                </Stack>
              )}
            </Paper>
          </Stack>
        )}
      </Box>
    </Box>
  );
};

export default TaskPage;
