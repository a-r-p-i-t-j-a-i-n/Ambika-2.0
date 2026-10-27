import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Tabs, Tab, Table, TableHead, TableBody, TableRow, TableCell,
  TextField, MenuItem, Button, Tooltip, Chip, Skeleton, Stack, alpha, InputAdornment,
  ToggleButtonGroup, ToggleButton, TablePagination,
} from '@mui/material';
import { UserCog, AlertTriangle, ClipboardList, Inbox, Search, ArrowUpDown, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import {
  useGetMyFmsTasksQuery, useGetFmsTasksQuery, useGetAssignableUsersQuery, useReassignFmsTaskMutation,
} from '../../store/api/fmsDoerApi';
import { usePermissions } from '../../hooks/usePermission';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsTableHeadSx } from '../procurement/pfmsTheme';
import { fmtDateTime, userName } from './fmsDoerMeta';
import DoerPickerDialog from './DoerPickerDialog';

/**
 * FMS Tasks — Purchase FMS work, laid out like O2D's My Tasks / All Tasks:
 * status filters, search, sort, paging, due dates, and a row that opens the
 * task. A Purchase task opens the record its step is done on (Indent, PO, PI,
 * GRN, QC, Invoice, Voucher), with ?fmsTask=<id> so that page shows which
 * task sent the doer there. The server builds and checks that link; a
 * deleted record gives no link and says so.
 */

const DAY_MS = 24 * 3600 * 1000;
const isDueSoon = (t) => t.status === 'OPEN' && !t.isOverdue && t.plannedAt
  && new Date(t.plannedAt) - Date.now() > 0 && new Date(t.plannedAt) - Date.now() < DAY_MS;
const doersOf = (t) => t.doers || (t.assignedDoerId ? [t.assignedDoerId] : []);
const haystack = (t) => `${t.entityRef} ${t.summary} ${t.stepLabel} ${t.stepCode} ${doersOf(t).map((d) => d.name).join(' ')}`.toLowerCase();

const statusChip = (t) => {
  if (t.isOverdue) {
    return <Chip size="small" icon={<AlertTriangle size={13} />} label="Overdue"
      sx={{ fontWeight: 700, color: '#dc2626', bgcolor: '#fef2f2', border: '1px solid #fecaca', '& .MuiChip-icon': { color: '#dc2626' } }} />;
  }
  if (t.status === 'DONE') return <Chip size="small" color="success" label="Completed" />;
  if (t.status === 'CLOSED') return <Chip size="small" variant="outlined" label="Closed" />;
  if (isDueSoon(t)) return <Chip size="small" color="warning" variant="outlined" label="Due soon" />;
  return <Chip size="small" variant="outlined" label="Pending" />;
};

const TaskCell = ({ t }) => (
  <Box sx={{ minWidth: 0 }}>
    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
      <ClipboardList size={15} style={{ flexShrink: 0 }} />
      <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0, color: PFMS.ink }} noWrap title={t.stepLabel}>{t.stepLabel}</Typography>
      <Chip size="small" variant="outlined" label={t.stepCode} sx={{ flexShrink: 0 }} />
    </Stack>
    {t.missingPermissions?.length > 0 && (
      <Tooltip title={`You are a doer for this step but do not have its permission (${t.missingPermissions.join(', ')}). Ask an admin.`}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: '#b45309', mt: 0.25 }}>
          <AlertTriangle size={13} /><Typography variant="caption" fontWeight={700}>Permission missing</Typography>
        </Box>
      </Tooltip>
    )}
  </Box>
);

const ItemCell = ({ t }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography variant="body2" fontWeight={700} noWrap sx={{ color: t.link ? 'primary.main' : PFMS.ink }}>
      {t.linkLabel ? `${t.linkLabel} ` : ''}{t.entityRef || '—'}
    </Typography>
    {t.summary && <Typography variant="caption" color="text.secondary" noWrap display="block">{t.summary}</Typography>}
    {t.link
      ? (t.linkAction && t.status === 'OPEN' && <Typography variant="caption" sx={{ color: PFMS.sub, display: 'block' }}>Next: {t.linkAction}</Typography>)
      : <Typography variant="caption" sx={{ color: '#b45309', display: 'block' }} data-testid="task-link-issue">{t.linkIssue || 'No page to open'}</Typography>}
  </Box>
);

const DueCell = ({ t }) => (
  <Typography variant="body2" sx={{ color: t.isOverdue ? '#be123c' : 'text.primary', fontWeight: t.isOverdue ? 700 : 400 }}>
    {t.status === 'OPEN' ? (t.plannedAt ? fmtDateTime(t.plannedAt) : '—') : fmtDateTime(t.completedAt)}
  </Typography>
);

// Opening a task = its record, as the server linked it.
const useOpenTask = () => {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  return (t) => {
    if (t.link) navigate(t.link);
    else enqueueSnackbar(t.linkIssue || 'This record cannot be opened', { variant: 'warning' });
  };
};

const rowSx = (t, i) => ({
  height: 56,
  cursor: t.link ? 'pointer' : 'default',
  bgcolor: t.isOverdue ? alpha('#be123c', 0.06) : (t.asBuddy ? alpha('#7c3aed', 0.12) : (i % 2 ? PFMS.surfaceAlt : 'inherit')),
});

const Empty = ({ icon, title, text, action }) => (
  <Paper elevation={0} sx={{ ...pfmsCardSx, p: 6, textAlign: 'center' }}>
    <Box sx={{ opacity: 0.4 }}>{icon}</Box>
    <Typography variant="h6" sx={{ mt: 1 }}>{title}</Typography>
    {text && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{text}</Typography>}
    {action}
  </Paper>
);

// ── My FMS Tasks ─────────────────────────────────────────────────────────────
const MY_FILTERS = [
  { key: 'actionable', label: 'To do', match: (t) => t.status === 'OPEN' },
  { key: 'overdue', label: 'Overdue', match: (t) => t.isOverdue },
  { key: 'dueSoon', label: 'Due ≤24h', match: isDueSoon },
  { key: 'done', label: 'Completed', match: (t) => t.status === 'DONE' },
  { key: 'buddy', label: 'As buddy', match: (t) => t.asBuddy && t.status === 'OPEN' },
];

const MyTasks = () => {
  const { data, isLoading } = useGetMyFmsTasksQuery(undefined, { pollingInterval: 60_000 });
  const tasks = data?.data || [];
  return (
    <>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip label={`${counts.actionable} to do`} color="primary" variant="outlined" data-testid="my-tasks-todo" />
        {counts.overdue > 0 && <Chip icon={<AlertTriangle size={14} />} label={`${counts.overdue} overdue`} color="error" />}
      </Stack>

      {tasks.length > 0 && (
        <Paper elevation={0} sx={{ ...pfmsCardSx, p: 1, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
          <ToggleButtonGroup size="small" value={filter} exclusive onChange={(_, v) => { if (v) { setFilter(v); setPage(0); } }} sx={{ flexWrap: 'wrap' }}>
            {MY_FILTERS.map((f) => (
              <ToggleButton key={f.key} value={f.key} data-testid={`my-filter-${f.key}`}
                sx={{ textTransform: 'none', fontWeight: 600, color: f.key === 'overdue' && counts.overdue ? '#be123c' : undefined }}>
                {f.label} ({counts[f.key]})
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <TextField select size="small" value={sortBy} onChange={(e) => { setSortBy(e.target.value); setPage(0); }} sx={{ width: 180 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><ArrowUpDown size={14} /></InputAdornment> }}>
              <MenuItem value="due">Sort: Due date</MenuItem>
              <MenuItem value="item">Sort: Item no.</MenuItem>
              <MenuItem value="step">Sort: Step</MenuItem>
            </TextField>
            <TextField size="small" placeholder="Search item, vendor, step…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              sx={{ width: { xs: '100%', sm: 260 } }} inputProps={{ 'data-testid': 'my-tasks-search' }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
          </Stack>
        </Paper>
      )}

      {counts.buddy > 0 && (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box component="span" sx={{ width: 14, height: 14, borderRadius: 0.5, bgcolor: alpha('#7c3aed', 0.16), border: '1px solid', borderColor: alpha('#7c3aed', 0.45) }} />
          Purple rows are steps where you're the backup (buddy) — step in if the main doer can't.
        </Typography>
      )}

      {!tasks.length ? (
        <Empty icon={<Inbox size={36} />} title="You're all caught up" text="No Purchase FMS steps are waiting on you right now." />
      ) : !filtered.length ? (
        <Empty icon={<Search size={36} />} title="No tasks match your filters"
          action={<Button size="small" sx={{ mt: 1 }} onClick={() => { setSearch(''); setFilter('actionable'); setPage(0); }}>Clear filters</Button>} />
      ) : (
        <Paper elevation={0} sx={{ ...pfmsCardSx, overflowX: 'auto' }} data-testid="my-tasks-table">
          <Table size="small" sx={{ minWidth: 860 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...pfmsTableHeadSx, width: 44 }}>#</TableCell>
                <TableCell sx={{ ...pfmsTableHeadSx, width: 300 }}>Task</TableCell>
                <TableCell sx={pfmsTableHeadSx}>Item</TableCell>
                <TableCell sx={{ ...pfmsTableHeadSx, width: 120 }}>Status</TableCell>
                <TableCell sx={{ ...pfmsTableHeadSx, width: 160 }}>{filter === 'done' ? 'Completed' : 'Due'}</TableCell>
                <TableCell sx={{ ...pfmsTableHeadSx, width: 160 }}>Waiting since</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paged.map((t, i) => (
                <TableRow key={t._id} hover onClick={() => openTask(t)} sx={rowSx(t, i)}
                  data-testid="my-task-row" data-ref={t.entityRef} data-step={t.stepKey} data-link={t.link || ''}>
                  <TableCell>{page * rowsPerPage + i + 1}</TableCell>
                  <TableCell sx={{ maxWidth: 300 }}><TaskCell t={t} /></TableCell>
                  <TableCell sx={{ maxWidth: 260 }}><ItemCell t={t} /></TableCell>
                  <TableCell>{statusChip(t)}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}><DueCell t={t} /></TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', color: PFMS.sub }}>{fmtDateTime(t.openedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination component="div" count={filtered.length} page={page} onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50]} />
        </Paper>
      )}
    </>
  );
};

// ── All FMS Tasks (oversight) ────────────────────────────────────────────────
const ALL_STATS = [
  { key: 'all', label: 'Total', color: '#1d4ed8', match: () => true },
  { key: 'overdue', label: 'Overdue', color: '#be123c', match: (t) => t.isOverdue },
  { key: 'dueSoon', label: 'Due ≤24h', color: '#b45309', match: isDueSoon },
  { key: 'unassigned', label: 'Unassigned', color: '#64748b', match: (t) => t.status === 'OPEN' && !doersOf(t).length },
];

const AllTasks = () => {
  const { enqueueSnackbar } = useSnackbar();
  const openTask = useOpenTask();
  const [status, setStatus] = useState('OPEN');
  const [stepKey, setStepKey] = useState('');
  const [doerId, setDoerId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [stat, setStat] = useState('all');
  const [target, setTarget] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(15);

  useEffect(() => {
    const h = setTimeout(() => { setSearch(searchInput.trim()); setPage(0); }, 300);
    return () => clearTimeout(h);
  }, [searchInput]);

  const { data, isLoading, isFetching, isError, refetch } = useGetFmsTasksQuery({ status, limit: 500, ...(search ? { search } : {}) });
  const all = useMemo(() => data?.data || [], [data]);
  const { data: usersRes, isFetching: usersLoading } = useGetAssignableUsersQuery(
    { fmsKey: target?.fmsKey, stepKey: target?.stepKey }, { skip: !target },
  );
  const [reassign, { isLoading: saving }] = useReassignFmsTaskMutation();

  const stepOptions = useMemo(() => {
    const m = new Map(); all.forEach((t) => m.set(t.stepKey, { label: `${t.stepCode} · ${t.stepLabel}`, seq: t.sequence || 0 }));
    return [...m.entries()].sort((a, b) => a[1].seq - b[1].seq);
  }, [all]);
  const doerOptions = useMemo(() => {
    const m = new Map(); all.forEach((t) => doersOf(t).forEach((d) => m.set(String(d._id), d.name)));
    return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [all]);
  const base = useMemo(() => all.filter((t) => (!stepKey || t.stepKey === stepKey)
    && (!doerId || (doerId === 'none' ? !doersOf(t).length : doersOf(t).some((d) => String(d._id) === doerId)))), [all, stepKey, doerId]);
  const counts = useMemo(() => Object.fromEntries(ALL_STATS.map((s) => [s.key, base.filter(s.match).length])), [base]);
  const activeStat = ALL_STATS.find((s) => s.key === stat) || ALL_STATS[0];
  const rows = useMemo(() => base.filter(activeStat.match), [base, activeStat]);

  const paged = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

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
      {/* Stat strip — each stat doubles as a filter (as on O2D All Tasks). */}
      <Paper elevation={0} sx={{ ...pfmsCardSx, p: 1, display: 'grid', gap: 1, gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: `repeat(${ALL_STATS.length}, 1fr)` } }}>
        {ALL_STATS.map((s) => {
          const active = stat === s.key;
          return (
            <Box key={s.key} role="button" tabIndex={0} onClick={() => { setStat(s.key); setPage(0); }} onKeyDown={(e) => { if (e.key === 'Enter') { setStat(s.key); setPage(0); } }}
              data-testid={`all-stat-${s.key}`}
              sx={{
                px: 1.5, py: 1, borderRadius: 2, cursor: 'pointer', textAlign: 'center', minWidth: 0,
                border: '1px solid', borderColor: active ? s.color : PFMS.line, bgcolor: active ? alpha(s.color, 0.1) : 'transparent',
              }}>
              <Typography variant="h6" sx={{ fontWeight: 800, color: s.color, lineHeight: 1.1 }}>{counts[s.key] ?? 0}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>{s.label}</Typography>
            </Box>
          );
        })}
      </Paper>

      <Paper elevation={0} sx={{ ...pfmsCardSx, p: 1, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField size="small" placeholder="Search item, vendor, step…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
          sx={{ width: { xs: '100%', sm: 220 } }} inputProps={{ 'data-testid': 'all-tasks-search' }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
        <TextField size="small" select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} sx={{ minWidth: 140 }}>
          <MenuItem value="OPEN">Pending</MenuItem>
          <MenuItem value="DONE">Completed</MenuItem>
          <MenuItem value="CLOSED">Closed</MenuItem>
          <MenuItem value="ALL">All</MenuItem>
        </TextField>
        <TextField size="small" select label="Step" value={stepKey} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }} onChange={(e) => { setStepKey(e.target.value); setPage(0); }} sx={{ minWidth: 220 }}>
          <MenuItem value="">All steps</MenuItem>
          {stepOptions.map(([k, o]) => <MenuItem key={k} value={k}>{o.label}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Doer" value={doerId} SelectProps={{ displayEmpty: true }} InputLabelProps={{ shrink: true }} onChange={(e) => { setDoerId(e.target.value); setPage(0); }} sx={{ minWidth: 180 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Users size={15} /></InputAdornment> }}>
          <MenuItem value="">All doers</MenuItem>
          <MenuItem value="none">Unassigned</MenuItem>
          {doerOptions.map(([id, name]) => <MenuItem key={id} value={id}>{name}</MenuItem>)}
        </TextField>
        <Typography variant="caption" sx={{ color: PFMS.sub, ml: 'auto' }} data-testid="all-tasks-count">{rows.length} item(s)</Typography>
      </Paper>

      {isLoading || (isFetching && !all.length) ? <Skeleton variant="rounded" height={360} /> : isError ? (
        <Empty icon={<AlertTriangle size={36} />} title="Could not load the tasks" action={<Button size="small" sx={{ mt: 1 }} onClick={refetch}>Try again</Button>} />
      ) : (
        <Paper elevation={0} sx={{ ...pfmsCardSx, overflowX: 'auto' }} data-testid="all-tasks-table">
          <Table size="small" sx={{ minWidth: 1040 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...pfmsTableHeadSx, width: 44 }}>#</TableCell>
                <TableCell sx={pfmsTableHeadSx}>Task</TableCell>
                <TableCell sx={pfmsTableHeadSx}>Item</TableCell>
                <TableCell sx={pfmsTableHeadSx}>Doer(s)</TableCell>
                <TableCell sx={pfmsTableHeadSx}>Status</TableCell>
                <TableCell sx={pfmsTableHeadSx}>Due / Done</TableCell>
                <TableCell sx={pfmsTableHeadSx} align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {!rows.length && (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 5, color: PFMS.sub }}>No FMS tasks match these filters.</TableCell></TableRow>
              )}
              {paged.map((t, i) => (
                <TableRow key={t._id} hover onClick={() => openTask(t)} sx={rowSx(t, i)}
                  data-testid="all-task-row" data-ref={t.entityRef} data-step={t.stepKey} data-link={t.link || ''}>
                  <TableCell>{page * rowsPerPage + i + 1}</TableCell>
                  <TableCell sx={{ maxWidth: 280 }}><TaskCell t={t} /></TableCell>
                  <TableCell sx={{ maxWidth: 240 }}><ItemCell t={t} /></TableCell>
                  <TableCell sx={{ maxWidth: 220 }} data-testid="all-task-doers">
                    {doersOf(t).length
                      ? <Typography variant="body2" fontWeight={700}>{doersOf(t).map(userName).join(', ')}</Typography>
                      : <Typography variant="body2" sx={{ color: PFMS.faint, fontStyle: 'italic' }}>Unassigned</Typography>}
                    {t.buddies?.length > 0 && (
                      <Typography variant="caption" sx={{ color: PFMS.sub, display: 'block' }}>Buddy: {t.buddies.map(userName).join(', ')}</Typography>
                    )}
                  </TableCell>
                  <TableCell>{statusChip(t)}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <DueCell t={t} />
                    {t.status !== 'OPEN' && (
                      <Typography variant="caption" sx={{ color: PFMS.sub, display: 'block' }}>
                        by {t.completedById?.name || t.completedByName || 'System'}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {t.status === 'OPEN' && (
                      <Button size="small" variant="outlined" startIcon={<UserCog size={15} />}
                        onClick={(e) => { e.stopPropagation(); setTarget(t); }}>
                        Reassign
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination component="div" count={rows.length} page={page} onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[15, 30, 60]} />
        </Paper>
      )}
      <DoerPickerDialog
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title="Reassign task"
        subtitle={target ? `${target.stepLabel} · ${target.entityRef}` : ''}
        users={usersRes?.data || []}
        loading={usersLoading}
        currentDoerId={doersOf(target || {}).length === 1 ? doersOf(target)[0]._id : null}
        saving={saving}
        confirmLabel="Reassign"
        note="Only this item moves — the picked person becomes its main doer. The step's Doer Assignment is unchanged."
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
        <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>Purchase FMS items waiting on you — what to do, for which record, and by when</Typography>
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
