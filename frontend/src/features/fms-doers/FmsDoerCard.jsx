import React from 'react';
import { Paper, Box, Typography } from '@mui/material';
import { UserCheck } from 'lucide-react';
import { useGetFmsTasksByEntityQuery } from '../../store/api/fmsDoerApi';
import { PFMS, pfmsCardSx } from '../procurement/pfmsTheme';
import { TaskStatusChip, fmtDateTime, userName } from './fmsDoerMeta';

const Field = ({ label, children }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: PFMS.sub, mb: 0.25 }}>{label}</Typography>
    <Box sx={{ fontWeight: 600, color: PFMS.ink, fontSize: '0.86rem' }}>{children}</Box>
  </Box>
);

/**
 * "Current Step · Assigned Doer · Status" for one workflow item, from the FMS
 * doer tasks. Renders nothing when the item has no FMS task (nothing pending
 * and no history), so it can be dropped onto any detail page safely.
 *
 * When there is no OPEN task — the common case once a step is done — this
 * renders a single compact line rather than the full field grid, so a card
 * that only has one sentence to say doesn't still claim a full field-grid's
 * worth of height.
 */
const FmsDoerCard = ({ entityType, entityId, sx }) => {
  const { data } = useGetFmsTasksByEntityQuery({ entityType, entityId }, { skip: !entityType || !entityId });
  const open = data?.data?.open || [];
  const last = (data?.data?.history || []).find((t) => t.status === 'DONE');
  if (!open.length && !last) return null;

  if (!open.length) {
    return (
      <Paper elevation={0} sx={{ ...pfmsCardSx, p: 1.5, mb: 2.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', ...sx }}>
        <Typography sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontWeight: 700, color: 'primary.main', fontSize: '0.85rem', flexShrink: 0 }}>
          <UserCheck size={16} /> FMS Responsibility
        </Typography>
        <Typography variant="caption" sx={{ color: PFMS.sub }}>
          Last completed: {last.stepLabel} — performed by {last.completedById?.name || last.completedByName || 'System'} on {fmtDateTime(last.completedAt)}
          {last.assignedDoerId ? ` (assigned doer: ${last.assignedDoerId.name})` : ''}
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper elevation={0} sx={{ ...pfmsCardSx, p: 2, mb: 2.5, ...sx }}>
      <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, fontWeight: 700, color: 'primary.main', fontSize: '0.92rem' }}>
        <UserCheck size={18} /> FMS Responsibility
      </Typography>
      {open.map((t, i) => (
        <Box
          key={t._id}
          sx={{
            display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(auto-fit, minmax(150px, 210px))' }, gap: 2,
            mb: i === open.length - 1 && !last ? 0 : 1.25,
          }}
        >
          <Field label="Current Step">{t.stepLabel}</Field>
          <Field label="Assigned Doer">
            {t.assignedDoerId ? userName(t.assignedDoerId) : <Box component="span" sx={{ color: PFMS.faint, fontStyle: 'italic' }}>Unassigned</Box>}
          </Field>
          <Field label="Status"><TaskStatusChip status={t.status} /></Field>
          <Field label="Waiting Since">{fmtDateTime(t.openedAt)}</Field>
        </Box>
      ))}
      {last && (
        <Typography variant="caption" sx={{ color: PFMS.sub, display: 'block' }}>
          Last completed: {last.stepLabel} — performed by {last.completedById?.name || last.completedByName || 'System'} on {fmtDateTime(last.completedAt)}
          {last.assignedDoerId ? ` (assigned doer: ${last.assignedDoerId.name})` : ''}
        </Typography>
      )}
    </Paper>
  );
};

export default FmsDoerCard;
