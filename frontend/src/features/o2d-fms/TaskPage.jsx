import React from 'react';
import {
  Box, Paper, Stack, Typography, Chip, Button, Skeleton, alpha, Divider,
} from '@mui/material';
import {
  ArrowLeft, History, CheckCircle2, ListChecks, RefreshCw, UserCog, Paperclip, MessageSquare, FileEdit, Truck,
} from 'lucide-react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useGetProcessByIdQuery } from '../../store/api/o2dFmsApi';
import { usePermissions } from '../../hooks/usePermission';
import StepDetailCard from './components/StepDetailCard';

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// Map an activity action to an icon + label + colour.
const ACTIVITY = {
  ORDER_ENTRY:        { icon: CheckCircle2, label: 'Order received',     color: '#0f766e' },
  STEP_COMPLETED:     { icon: CheckCircle2, label: 'Step completed',     color: '#0f766e' },
  DISPATCH_PROGRESS:  { icon: Truck,        label: 'Dispatch recorded',  color: '#1d4ed8' },
  CHECKLIST_TICKED:   { icon: ListChecks,   label: 'Checklist ticked',   color: '#1d4ed8' },
  CHECKLIST_UNTICKED: { icon: ListChecks,   label: 'Checklist unticked', color: '#94a3b8' },
  STEP_PLAN_UPDATED:  { icon: FileEdit,     label: 'Plan updated',       color: '#b45309' },
  STEP_REASSIGNED:    { icon: UserCog,      label: 'Reassigned',         color: '#7c3aed' },
  STEP_ATTACHMENT:    { icon: Paperclip,    label: 'Attachment added',   color: '#0369a1' },
  COMMENT:            { icon: MessageSquare, label: 'Comment',           color: '#475569' },
  DEFAULT:            { icon: History,      label: 'Activity',           color: '#64748b' },
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

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, width: '100%', maxWidth: 1100 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate(-1)}>Back</Button>
        <Button size="small" startIcon={<RefreshCw size={14} />} onClick={() => refetch()} disabled={isFetching}>Refresh</Button>
      </Stack>

      {isLoading ? (
        <Skeleton variant="rounded" height={460} />
      ) : !process || !step ? (
        <Paper sx={{ p: 5, textAlign: 'center', borderRadius: 3, color: 'text.secondary' }}>
          This task could not be found. It may have been removed or re-planned.
        </Paper>
      ) : (
        <>
          {/* Order context */}
          <Paper sx={{ p: 2, borderRadius: 3, mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{process.soNumber}</Typography>
              <Typography variant="caption" color="text.secondary">{process.partyName} · PO {process.poNumber || '—'}</Typography>
            </Box>
            <Button variant="text" onClick={() => navigate(`/o2d-fms/process/${process._id}`)}>View whole order flow →</Button>
          </Paper>

          {/* The full task — checklist, attachments, comments, complete (reused card, inline) */}
          <StepDetailCard
            asPage
            open
            processId={process._id}
            step={step}
            orderLabel={`${process.soNumber} · ${process.partyName}`}
            canAct={can('o2dfms.act') || isRoot}
            canManage={can('o2dfms.manage') || isRoot}
            autoComplete={entryDone}
            onClose={() => refetch()}
          />

          {/* Activity history */}
          <Paper sx={{ p: 2, borderRadius: 3, mt: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" mb={1.5}>
              <History size={18} />
              <Typography sx={{ fontWeight: 700 }}>Activity history</Typography>
              <Chip size="small" variant="outlined" label={activity.length} />
            </Stack>
            <Divider sx={{ mb: 1.5 }} />
            {activity.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No activity yet — actions on this task will appear here.</Typography>
            ) : (
              <Stack spacing={0}>
                {activity.map((a, i) => {
                  const meta = ACTIVITY[a.action] || ACTIVITY.DEFAULT;
                  const Icon = meta.icon;
                  return (
                    <Stack key={i} direction="row" spacing={1.5} sx={{ position: 'relative', pb: 2 }}>
                      {/* timeline rail */}
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: alpha(meta.color, 0.12), color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Icon size={15} />
                        </Box>
                        {i < activity.length - 1 && <Box sx={{ width: 2, flex: 1, bgcolor: 'divider', mt: 0.5 }} />}
                      </Box>
                      <Box sx={{ pt: 0.25 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {meta.label}{a.action === 'COMMENT' ? '' : ''}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">{a.text}</Typography>
                        <Typography variant="caption" color="text.disabled">{a.who} · {fmt(a.at)}</Typography>
                      </Box>
                    </Stack>
                  );
                })}
              </Stack>
            )}
          </Paper>
        </>
      )}
    </Box>
  );
};

export default TaskPage;
