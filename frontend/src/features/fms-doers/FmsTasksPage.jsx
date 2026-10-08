import React, { useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Tabs, Tab, Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  TextField, MenuItem, Button, Tooltip, CircularProgress, Link as MuiLink,
} from '@mui/material';
import { ArrowRight, UserCog, AlertTriangle } from 'lucide-react';
import { Link as RouterLink } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import {
  useGetMyFmsTasksQuery, useGetFmsTasksQuery, useGetAssignableUsersQuery, useReassignFmsTaskMutation,
} from '../../store/api/fmsDoerApi';
import { usePermissions } from '../../hooks/usePermission';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsTableHeadSx } from '../procurement/pfmsTheme';
import { TaskStatusChip, fmtDateTime, userName } from './fmsDoerMeta';
import DoerPickerDialog from './DoerPickerDialog';

const ItemCell = ({ t }) => (
  <>
    {t.entityLink
      ? <MuiLink component={RouterLink} to={t.entityLink} fontWeight={700} underline="hover">{t.entityRef || '—'}</MuiLink>
      : <Typography variant="body2" fontWeight={700}>{t.entityRef || '—'}</Typography>}
    {t.summary && <Typography variant="caption" sx={{ color: PFMS.sub, display: 'block' }}>{t.summary}</Typography>}
  </>
);

const StepCell = ({ t }) => (
  <>
    <Typography variant="body2" fontWeight={700} sx={{ color: PFMS.ink }}>{t.stepLabel}</Typography>
    <Typography variant="caption" sx={{ color: PFMS.sub }}>{t.fmsLabel} · Step {t.stepCode}</Typography>
  </>
);

const EmptyRow = ({ cols, text }) => (
  <TableRow><TableCell colSpan={cols} align="center" sx={{ py: 5, color: PFMS.sub }}>{text}</TableCell></TableRow>
);

// ── My FMS Tasks ─────────────────────────────────────────────────────────────
const MyTasks = () => {
  const { data, isLoading } = useGetMyFmsTasksQuery(undefined, { pollingInterval: 60_000 });
  const tasks = data?.data || [];
  return (
    <Paper sx={{ ...pfmsCardSx, overflow: 'hidden' }}>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={pfmsTableHeadSx}>Current Step</TableCell>
              <TableCell sx={pfmsTableHeadSx}>Item</TableCell>
              <TableCell sx={pfmsTableHeadSx}>Status</TableCell>
              <TableCell sx={pfmsTableHeadSx}>Waiting Since</TableCell>
              <TableCell sx={pfmsTableHeadSx} align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5 }}><CircularProgress size={22} /></TableCell></TableRow>}
            {!isLoading && !tasks.length && <EmptyRow cols={5} text="No pending FMS tasks assigned to you." />}
            {tasks.map((t) => (
              <TableRow key={t._id} hover>
                <TableCell>
                  <StepCell t={t} />
                  {t.missingPermissions?.length > 0 && (
                    <Tooltip title={`You are the doer for this step but do not have its permission (${t.missingPermissions.join(', ')}). Ask an admin.`}>
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: '#b45309', mt: 0.25 }}>
                        <AlertTriangle size={13} /><Typography variant="caption" fontWeight={700}>Permission missing</Typography>
                      </Box>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell><ItemCell t={t} /></TableCell>
                <TableCell><TaskStatusChip status={t.status} /></TableCell>
                <TableCell sx={{ color: PFMS.sub }}>{fmtDateTime(t.openedAt)}</TableCell>
                <TableCell align="right">
                  {t.entityLink && (
                    <Button size="small" variant="contained" endIcon={<ArrowRight size={15} />} component={RouterLink} to={t.entityLink}>
                      Open
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

// ── All FMS Tasks (oversight) ────────────────────────────────────────────────
const AllTasks = () => {
  const { enqueueSnackbar } = useSnackbar();
  const [status, setStatus] = useState('OPEN');
  const [stepKey, setStepKey] = useState('');
  const [doerId, setDoerId] = useState('');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState(null);

  const { data, isLoading, isFetching } = useGetFmsTasksQuery({ status, limit: 500, ...(search ? { search } : {}) });
  const all = data?.data || [];
  const { data: usersRes, isFetching: usersLoading } = useGetAssignableUsersQuery(
    { fmsKey: target?.fmsKey, stepKey: target?.stepKey }, { skip: !target },
  );
  const [reassign, { isLoading: saving }] = useReassignFmsTaskMutation();

  const stepOptions = useMemo(() => {
    const m = new Map(); all.forEach((t) => m.set(t.stepKey, `${t.stepCode} · ${t.stepLabel}`)); return [...m.entries()];
  }, [all]);
  const doerOptions = useMemo(() => {
    const m = new Map(); all.forEach((t) => { if (t.assignedDoerId) m.set(String(t.assignedDoerId._id), t.assignedDoerId.name); }); return [...m.entries()];
  }, [all]);
  const rows = all.filter((t) => (!stepKey || t.stepKey === stepKey)
    && (!doerId || (doerId === 'none' ? !t.assignedDoerId : String(t.assignedDoerId?._id) === doerId)));

  const submit = async ({ doerUserId, reason }) => {
    try {
      const res = await reassign({ id: target._id, doerUserId, reason }).unwrap();
      const warn = res?.data?.permissionWarning || [];
      enqueueSnackbar(
        warn.length ? `Reassigned — note: the new doer lacks ${warn.join(', ')}` : 'Task reassigned',
        { variant: warn.length ? 'warning' : 'success' },
      );
      setTarget(null);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to reassign', { variant: 'error' });
    }
  };

  return (
    <>
      <Paper sx={{ ...pfmsCardSx, p: 1, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField size="small" placeholder="Search item no…" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ width: { xs: '100%', sm: 200 } }} />
        <TextField size="small" select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 140 }}>
          <MenuItem value="OPEN">Pending</MenuItem>
          <MenuItem value="DONE">Completed</MenuItem>
          <MenuItem value="CLOSED">Closed</MenuItem>
          <MenuItem value="ALL">All</MenuItem>
        </TextField>
        <TextField size="small" select label="Step" value={stepKey} onChange={(e) => setStepKey(e.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">All steps</MenuItem>
          {stepOptions.map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Doer" value={doerId} onChange={(e) => setDoerId(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">All doers</MenuItem>
          <MenuItem value="none">Unassigned</MenuItem>
          {doerOptions.map(([id, name]) => <MenuItem key={id} value={id}>{name}</MenuItem>)}
        </TextField>
        <Typography variant="caption" sx={{ color: PFMS.sub, ml: 'auto' }}>{rows.length} item(s)</Typography>
      </Paper>
      <Paper sx={{ ...pfmsCardSx, overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={pfmsTableHeadSx}>Current Step</TableCell>
                <TableCell sx={pfmsTableHeadSx}>Item</TableCell>
                <TableCell sx={pfmsTableHeadSx}>Doer</TableCell>
                <TableCell sx={pfmsTableHeadSx}>Status</TableCell>
                <TableCell sx={pfmsTableHeadSx}>Waiting Since</TableCell>
                <TableCell sx={pfmsTableHeadSx}>Performed By</TableCell>
                <TableCell sx={pfmsTableHeadSx} align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {(isLoading || isFetching) && !rows.length && <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5 }}><CircularProgress size={22} /></TableCell></TableRow>}
              {!isLoading && !isFetching && !rows.length && <EmptyRow cols={7} text="No FMS tasks match these filters." />}
              {rows.map((t) => (
                <TableRow key={t._id} hover>
                  <TableCell><StepCell t={t} /></TableCell>
                  <TableCell><ItemCell t={t} /></TableCell>
                  <TableCell>
                    {t.assignedDoerId
                      ? <Typography variant="body2" fontWeight={700}>{userName(t.assignedDoerId)}</Typography>
                      : <Typography variant="body2" sx={{ color: PFMS.faint, fontStyle: 'italic' }}>Unassigned</Typography>}
                  </TableCell>
                  <TableCell><TaskStatusChip status={t.status} /></TableCell>
                  <TableCell sx={{ color: PFMS.sub }}>{fmtDateTime(t.openedAt)}</TableCell>
                  <TableCell sx={{ color: PFMS.sub }}>
                    {t.status === 'OPEN' ? '—' : (
                      <>
                        {t.completedById?.name || t.completedByName || 'System'}
                        <Typography variant="caption" display="block">{fmtDateTime(t.completedAt)}</Typography>
                      </>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {t.status === 'OPEN' && (
                      <Button size="small" variant="outlined" startIcon={<UserCog size={15} />} onClick={() => setTarget(t)}>Reassign</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <DoerPickerDialog
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title="Reassign task"
        subtitle={target ? `${target.stepLabel} · ${target.entityRef}` : ''}
        users={usersRes?.data || []}
        loading={usersLoading}
        currentDoerId={target?.assignedDoerId?._id}
        saving={saving}
        confirmLabel="Reassign"
        note="Only this item moves. The step's configured doer is unchanged."
        onSubmit={submit}
      />
    </>
  );
};

const FmsTasksPage = () => {
  const { can } = usePermissions();
  const canManage = can('fms.manageDoers');
  const [tab, setTab] = useState(0);
  return (
    <Box sx={{ ...pfmsPageSx, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box>
        <Typography sx={pfmsTitleSx}>FMS Tasks</Typography>
        <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>Items waiting at an FMS step, with the doer responsible for each</Typography>
      </Box>
      {canManage && (
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, textTransform: 'none', fontWeight: 700 } }}>
          <Tab label="My FMS Tasks" />
          <Tab label="All FMS Tasks" />
        </Tabs>
      )}
      {tab === 0 || !canManage ? <MyTasks /> : <AllTasks />}
    </Box>
  );
};

export default FmsTasksPage;
