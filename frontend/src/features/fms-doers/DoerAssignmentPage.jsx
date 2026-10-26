import React, { useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Table, TableHead, TableBody, TableRow, TableCell,
  TableContainer, Button, Tooltip, IconButton, Alert, CircularProgress, Link as MuiLink,
  Dialog, DialogTitle, DialogContent, DialogActions, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { UserCog, History, ListChecks, RefreshCw } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import {
  useGetDoerAssignmentsQuery, useGetAssignableUsersQuery,
  useSetDoerAssignmentMutation, useApplyDoerToOpenTasksMutation, useSyncFmsTasksMutation,
} from '../../store/api/fmsDoerApi';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsTableHeadSx } from '../procurement/pfmsTheme';
import { AssignmentStatusChip, PermissionStatusChip, userName } from './fmsDoerMeta';
import DoerPickerDialog from './DoerPickerDialog';
import AssignmentHistoryDialog from './AssignmentHistoryDialog';
import O2dDoerPlan from './O2dDoerPlan';

// The FMS flows this page sets up — O2D first (the default).
const FMS_CHOICES = [
  { key: 'O2D', label: 'O2D FMS' },
  { key: 'PURCHASE', label: 'Purchase FMS' },
];

/**
 * FMS → Doer Assignment. Pick an FMS, then one primary doer per step.
 * A new doer applies to items that reach the step from now on; items already
 * pending keep their doer until moved explicitly ("Apply to open tasks").
 */
const DoerAssignmentPage = () => {
  const { enqueueSnackbar } = useSnackbar();
  const [fmsKey, setFmsKey] = useState('O2D');
  const isO2d = fmsKey === 'O2D';
  const [editStep, setEditStep] = useState(null);
  const [historyStep, setHistoryStep] = useState(null);
  const [applyStep, setApplyStep] = useState(null);

  // O2D has its own setup screen (O2dDoerPlan); this table is for Purchase.
  const { data, isLoading, isFetching } = useGetDoerAssignmentsQuery(fmsKey, { skip: isO2d });
  const fms = data?.data?.fms;
  const steps = data?.data?.steps || [];
  const { data: usersRes, isFetching: usersLoading } = useGetAssignableUsersQuery(
    { fmsKey, stepKey: editStep?.stepKey }, { skip: !editStep },
  );
  const [setAssignment, { isLoading: saving }] = useSetDoerAssignmentMutation();
  const [applyToOpen, { isLoading: applying }] = useApplyDoerToOpenTasksMutation();
  const [syncTasks, { isLoading: syncing }] = useSyncFmsTasksMutation();

  const summary = useMemo(() => ({
    assigned: steps.filter((s) => s.status === 'ASSIGNED').length,
    unassigned: steps.filter((s) => s.status === 'UNASSIGNED').length,
    issues: steps.filter((s) => s.status === 'DOER_INACTIVE' || s.permissionStatus === 'MISSING').length,
  }), [steps]);

  const save = async (body) => {
    try {
      const res = await setAssignment({ fmsKey, stepKey: editStep.stepKey, ...body }).unwrap();
      const pending = res?.data?.openTasks?.notWithNewDoer || 0;
      enqueueSnackbar(
        pending
          ? `Doer saved. ${pending} item(s) already pending at this step keep their current doer — use "Apply to open tasks" to move them.`
          : 'Doer saved',
        { variant: 'success' },
      );
      setEditStep(null);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save doer', { variant: 'error' });
    }
  };

  const confirmApply = async () => {
    try {
      const res = await applyToOpen({ fmsKey, stepKey: applyStep.stepKey, reason: 'Applied new step doer to pending items' }).unwrap();
      enqueueSnackbar(`${res?.data?.reassigned || 0} pending item(s) moved to ${applyStep.doer?.name}`, { variant: 'success' });
      setApplyStep(null);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to apply', { variant: 'error' });
    }
  };

  const onSync = async () => {
    try { await syncTasks().unwrap(); enqueueSnackbar('Pending items re-checked', { variant: 'success' }); }
    catch (err) { enqueueSnackbar(err?.data?.message || 'Sync failed', { variant: 'error' }); }
  };

  return (
    <Box sx={{ ...pfmsPageSx, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Box>
          <Typography sx={pfmsTitleSx}>FMS Doer Assignment</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>
            {isO2d
              ? 'Lead time, main doer, buddy and mandatory for every O2D step'
              : 'One primary doer per step · being the doer does not grant permissions'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {!isO2d && fms?.editable && (
            <Tooltip title="Re-check which items are waiting at each step">
              <span>
                <Button variant="outlined" startIcon={syncing ? <CircularProgress size={14} /> : <RefreshCw size={16} />} onClick={onSync} disabled={syncing}>
                  Sync
                </Button>
              </span>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Which FMS to set up — O2D by default. */}
      <ToggleButtonGroup exclusive size="small" value={fmsKey} onChange={(_e, v) => v && setFmsKey(v)} aria-label="FMS"
        sx={{ alignSelf: 'flex-start', bgcolor: PFMS.surface }}>
        {FMS_CHOICES.map((c) => (
          <ToggleButton key={c.key} value={c.key} sx={{ textTransform: 'none', fontWeight: 700, px: 2.25 }}>{c.label}</ToggleButton>
        ))}
      </ToggleButtonGroup>

      {isO2d ? <O2dDoerPlan /> : (<>
      {fms && !fms.editable && (
        <Alert severity="info" variant="outlined" sx={{ bgcolor: PFMS.surface }}>
          {fms.label} already has its own doer configuration and task runtime. Its current doers are shown below read-only —
          change them in{' '}
          {(fms.configLinks || []).map((l, i) => (
            <React.Fragment key={l.path}>
              {i > 0 && ' or '}
              <MuiLink component={RouterLink} to={l.path} fontWeight={700}>{l.label}</MuiLink>
            </React.Fragment>
          ))}.
        </Alert>
      )}

      {fms?.editable && (
        <Typography variant="body2" sx={{ color: PFMS.sub }}>
          {summary.assigned} assigned · {summary.unassigned} unassigned
          {summary.issues ? ` · ${summary.issues} need attention` : ''}
        </Typography>
      )}

      <Paper sx={{ ...pfmsCardSx, overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...pfmsTableHeadSx, width: 48 }}>#</TableCell>
                <TableCell sx={pfmsTableHeadSx}>Step</TableCell>
                <TableCell sx={pfmsTableHeadSx}>Doer</TableCell>
                {fms?.editable ? (
                  <>
                    <TableCell sx={pfmsTableHeadSx}>Permission Status</TableCell>
                    <TableCell sx={pfmsTableHeadSx}>Status</TableCell>
                    <TableCell sx={pfmsTableHeadSx} align="right">Pending Items</TableCell>
                    <TableCell sx={pfmsTableHeadSx} align="right">Actions</TableCell>
                  </>
                ) : (
                  <TableCell sx={pfmsTableHeadSx}>Configured In</TableCell>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {(isLoading || isFetching) && !steps.length && (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5 }}><CircularProgress size={22} /></TableCell></TableRow>
              )}
              {!isLoading && !steps.length && (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5, color: PFMS.sub }}>No steps found for this FMS.</TableCell></TableRow>
              )}
              {steps.map((s) => (fms?.editable ? (
                <TableRow key={s.stepKey} hover>
                  <TableCell sx={{ color: PFMS.sub, fontWeight: 700 }}>{s.sequence}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={700} sx={{ color: PFMS.ink }}>{s.label}</Typography>
                    <Typography variant="caption" sx={{ color: PFMS.sub }}>Step {s.code} · {s.description}</Typography>
                  </TableCell>
                  <TableCell>
                    {s.doer
                      ? <Typography variant="body2" fontWeight={700}>{userName(s.doer)}</Typography>
                      : <Typography variant="body2" sx={{ color: PFMS.faint, fontStyle: 'italic' }}>Not assigned</Typography>}
                  </TableCell>
                  <TableCell><PermissionStatusChip status={s.permissionStatus} missing={s.missingPermissions} /></TableCell>
                  <TableCell><AssignmentStatusChip status={s.status} /></TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={700}>{s.openTasks.total}</Typography>
                    {(s.openTasks.withOtherDoer + s.openTasks.unassigned) > 0 && s.doer && (
                      <Typography variant="caption" sx={{ color: '#b45309', display: 'block' }}>
                        {s.openTasks.withOtherDoer + s.openTasks.unassigned} not with {s.doer.name}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Button size="small" variant="outlined" startIcon={<UserCog size={15} />} onClick={() => setEditStep(s)}>
                      Change Doer
                    </Button>
                    {s.doer && (s.openTasks.withOtherDoer + s.openTasks.unassigned) > 0 && (
                      <Tooltip title={`Move pending items at this step to ${s.doer.name}`}>
                        <IconButton size="small" sx={{ ml: 0.5 }} onClick={() => setApplyStep(s)}><ListChecks size={16} /></IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="Doer history">
                      <IconButton size="small" sx={{ ml: 0.5 }} onClick={() => setHistoryStep(s)}><History size={16} /></IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={s.stepKey} hover>
                  <TableCell sx={{ color: PFMS.sub, fontWeight: 700 }}>{s.sequence}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={700} sx={{ color: PFMS.ink }}>{s.label}</Typography>
                    <Typography variant="caption" sx={{ color: PFMS.sub }}>Step {s.code}</Typography>
                  </TableCell>
                  <TableCell>
                    {s.doers?.length
                      ? s.doers.map(userName).join(', ')
                      : (s.doerRole ? `Role: ${s.doerRole}` : <Box component="span" sx={{ color: PFMS.faint, fontStyle: 'italic' }}>Not assigned</Box>)}
                  </TableCell>
                  <TableCell sx={{ color: PFMS.sub }}>{s.source || '—'}</TableCell>
                </TableRow>
              )))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      </>)}

      <DoerPickerDialog
        open={Boolean(editStep)}
        onClose={() => setEditStep(null)}
        title="Change Doer"
        subtitle={editStep ? `${fms?.label} → Step ${editStep.code} · ${editStep.label}` : ''}
        users={usersRes?.data || []}
        loading={usersLoading}
        currentDoerId={editStep?.doer?._id}
        allowUnassign
        saving={saving}
        confirmLabel="Save Doer"
        note={editStep?.openTasks?.total
          ? `${editStep.openTasks.total} item(s) are already pending at this step. They keep their current doer; the new doer applies to items that reach this step from now on.`
          : 'The new doer applies to items that reach this step from now on.'}
        onSubmit={save}
      />

      <AssignmentHistoryDialog open={Boolean(historyStep)} onClose={() => setHistoryStep(null)} fmsKey={fmsKey} step={historyStep} />

      <Dialog open={Boolean(applyStep)} onClose={() => (applying ? null : setApplyStep(null))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Apply to pending items?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Move {applyStep ? applyStep.openTasks.withOtherDoer + applyStep.openTasks.unassigned : 0} item(s) pending at
            {' '}<b>{applyStep?.label}</b> to <b>{applyStep?.doer?.name}</b>. Each move is recorded in that item's history.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setApplyStep(null)} disabled={applying}>Cancel</Button>
          <Button variant="contained" onClick={confirmApply} disabled={applying}>{applying ? 'Applying…' : 'Apply'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DoerAssignmentPage;
