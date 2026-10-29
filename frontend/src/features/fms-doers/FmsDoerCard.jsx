import React from 'react';
import { Paper, Box, Typography, Button, Chip } from '@mui/material';
import { UserCheck, ArrowLeft, AlertTriangle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useGetFmsTasksByEntityQuery } from '../../store/api/fmsDoerApi';
import { PFMS, pfmsCardSx } from '../procurement/pfmsTheme';
import { TaskStatusChip, fmtDateTime, userName } from './fmsDoerMeta';

const Field = ({ label, children }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: PFMS.sub, mb: 0.25 }}>{label}</Typography>
    <Box sx={{ fontWeight: 600, color: PFMS.ink, fontSize: '0.86rem' }}>{children}</Box>
  </Box>
);

const names = (list) => (list || []).map(userName).filter(Boolean).join(', ');
const doersOf = (t) => t.doers || (t.assignedDoerId ? [t.assignedDoerId] : []);

/**
 * "Current Step · Doers · Due · Status" for one workflow item, from the FMS
 * doer tasks. Renders nothing when the item has no FMS task (nothing pending
 * and no history), so it can be dropped onto any detail page safely.
 *
 * Opened from a task (?fmsTask=<id>, see FmsTasksPage), it marks that task
 * — "You opened this from your task" with a way back — or, if the task has
 * moved on since, says who completed it. An id that is not one of this
 * record's tasks is ignored.
 *
 * When there is no OPEN task — the common case once a step is done — this
 * renders a single compact line rather than the full field grid, so a card
 * that only has one sentence to say doesn't still claim a full field-grid's
 * worth of height.
 */
const FmsDoerCard = ({ entityType, entityId, sx }) => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromTask = params.get('fmsTask');
  const { data } = useGetFmsTasksByEntityQuery({ entityType, entityId }, { skip: !entityType || !entityId });
  const open = data?.data?.open || [];
  const history = data?.data?.history || [];
  const last = history.find((t) => t.status === 'DONE');
  const openedFrom = fromTask ? open.find((t) => String(t._id) === fromTask) : null;
  const finishedFrom = fromTask && !openedFrom ? history.find((t) => String(t._id) === fromTask) : null;
  if (!open.length && !last && !finishedFrom) return null;

  const backToTasks = (
    <Button size="small" variant="text" startIcon={<ArrowLeft size={14} />} onClick={() => navigate('/fms/my-tasks')}
      sx={{ ml: 'auto', flexShrink: 0 }}>
      My FMS Tasks
    </Button>
  );
  const finishedNote = finishedFrom && (
    <Box data-testid="fms-task-context" data-state="finished"
      sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', p: 1, mb: 1.25, borderRadius: 1, bgcolor: PFMS.surfaceAlt }}>
      <Typography variant="caption" sx={{ color: PFMS.ink, fontWeight: 600 }}>
        The task you opened ({finishedFrom.stepLabel}) is {finishedFrom.status === 'DONE'
          ? `already done — by ${finishedFrom.completedById?.name || finishedFrom.completedByName || 'System'} on ${fmtDateTime(finishedFrom.completedAt)}`
          : `closed${finishedFrom.closedReason ? ` (${finishedFrom.closedReason})` : ''}`}.
      </Typography>
      {backToTasks}
    </Box>
  );

  if (!open.length) {
    return (
      <Paper elevation={0} sx={{ ...pfmsCardSx, p: 1.5, mb: 2.5, ...sx }}>
        {finishedNote}
        {last && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontWeight: 700, color: 'primary.main', fontSize: '0.85rem', flexShrink: 0 }}>
              <UserCheck size={16} /> FMS Responsibility
            </Typography>
            <Typography variant="caption" sx={{ color: PFMS.sub }}>
              Last completed: {last.stepLabel} — performed by {last.completedById?.name || last.completedByName || 'System'} on {fmtDateTime(last.completedAt)}
              {doersOf(last).length ? ` (assigned: ${names(doersOf(last))})` : ''}
            </Typography>
          </Box>
        )}
      </Paper>
    );
  }

  return (
    <Paper elevation={0} sx={{ ...pfmsCardSx, p: 2, mb: 2.5, ...sx }} data-testid="fms-doer-card">
      <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, fontWeight: 700, color: 'primary.main', fontSize: '0.92rem' }}>
        <UserCheck size={18} /> FMS Responsibility
      </Typography>
      {finishedNote}
      {open.map((t, i) => {
        const mine = openedFrom && String(openedFrom._id) === String(t._id);
        return (
          <Box key={t._id} sx={{ mb: i === open.length - 1 && !last ? 0 : 1.25 }}>
            {mine && (
              <Box data-testid="fms-task-context" data-state="open"
                sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', p: 1, mb: 1, borderRadius: 1, bgcolor: 'rgba(29,78,216,0.07)' }}>
                <Typography variant="caption" sx={{ color: PFMS.ink, fontWeight: 700 }}>
                  You opened this from your FMS task: Step {t.stepCode} · {t.stepLabel}
                </Typography>
                {backToTasks}
              </Box>
            )}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(auto-fit, minmax(150px, 210px))' }, gap: 2 }}>
              <Field label="Current Step">{t.stepLabel}</Field>
              <Field label={doersOf(t).length > 1 ? 'Assigned Doers' : 'Assigned Doer'}>
                {doersOf(t).length ? names(doersOf(t)) : <Box component="span" sx={{ color: PFMS.faint, fontStyle: 'italic' }}>Unassigned</Box>}
                {t.buddies?.length > 0 && (
                  <Typography variant="caption" sx={{ color: PFMS.sub, display: 'block', fontWeight: 500 }}>Buddy: {names(t.buddies)}</Typography>
                )}
              </Field>
              <Field label="Status">
                {t.isOverdue
                  ? <Chip size="small" icon={<AlertTriangle size={12} />} label="Overdue" color="error" variant="outlined" sx={{ fontWeight: 700 }} />
                  : <TaskStatusChip status={t.status} />}
              </Field>
              <Field label="Due">{t.plannedAt ? fmtDateTime(t.plannedAt) : '—'}</Field>
              <Field label="Waiting Since">{fmtDateTime(t.openedAt)}</Field>
            </Box>
          </Box>
        );
      })}
      {last && (
        <Typography variant="caption" sx={{ color: PFMS.sub, display: 'block' }}>
          Last completed: {last.stepLabel} — performed by {last.completedById?.name || last.completedByName || 'System'} on {fmtDateTime(last.completedAt)}
          {doersOf(last).length ? ` (assigned: ${names(doersOf(last))})` : ''}
        </Typography>
      )}
    </Paper>
  );
};

export default FmsDoerCard;
