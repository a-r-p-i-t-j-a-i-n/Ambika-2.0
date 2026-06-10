import React, { useState, useMemo, useEffect } from 'react';
import {
  Box, Paper, Stack, Typography, Chip, Button, Skeleton, alpha, IconButton,
  TextField, InputAdornment, MenuItem,
  Table, TableBody, TableCell, TableHead, TableRow, TablePagination,
} from '@mui/material';
import { ListChecks, AlertTriangle, Search, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetAllTasksQuery } from '../../store/api/o2dFmsApi';

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const isDueSoon = (d) => d && (new Date(d) - Date.now()) > 0 && (new Date(d) - Date.now()) < 24 * 3600 * 1000;
const isDone = (t) => t.status === 'DONE' || t.status === 'DELAYED';

// Each stat doubles as a filter (click to narrow the table). `match` decides membership.
const STAT_DEFS = [
  { key: 'all',       label: 'Total',             color: '#1d4ed8', match: () => true },
  { key: 'pending',   label: 'Pending',           color: '#475569', match: (t) => t.status === 'PENDING' },
  { key: 'overdue',   label: 'Overdue',           color: '#be123c', match: (t) => t.isOverdue },
  { key: 'dueSoon',   label: 'Due ≤24h',          color: '#b45309', match: (t) => t.status === 'PENDING' && isDueSoon(t.planned) },
  { key: 'completed', label: 'Completed',         color: '#0f766e', match: (t) => isDone(t) },
  { key: 'onTime',    label: 'On time',           color: '#0f766e', match: (t) => t.status === 'DONE' },
  { key: 'late',      label: 'Done late',         color: '#b45309', match: (t) => t.status === 'DELAYED' },
  { key: 'checklist', label: 'Checklist pending', color: '#7c3aed', match: (t) => t.status === 'PENDING' && t.checklistTotal > 0 && t.checklistDone < t.checklistTotal },
  { key: 'unassigned', label: 'Unassigned',       color: '#94a3b8', match: (t) => !(t.doers || []).length },
];
const STATS_PER_PAGE = 5;

const STATUS_TONE = { DONE: '#0f766e', DELAYED: '#b45309', PENDING: '#475569', SKIPPED: '#94a3b8' };

const AllTasks = () => {
  const navigate = useNavigate();
  const { data, isLoading } = useGetAllTasksQuery(undefined, { pollingInterval: 60_000 });
  const tasks = data?.data || [];

  const [filterKey, setFilterKey] = useState('all'); // active stat-filter
  const [assignee, setAssignee] = useState('');       // doer id or ''
  const [search, setSearch] = useState('');
  const [statPage, setStatPage] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(15);

  // Unique doers for the assignee dropdown (derived from the data).
  const doerOptions = useMemo(() => {
    const map = new Map();
    tasks.forEach((t) => (t.doers || []).forEach((d) => map.set(d._id, d.name)));
    return [...map.entries()].map(([_id, name]) => ({ _id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  // Base = filtered by assignee + search (stats computed on this).
  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (assignee && !(t.doers || []).some((d) => d._id === assignee)) return false;
      if (q && !`${t.soNumber} ${t.partyName} ${t.name} ${t.stepCode} ${(t.doers || []).map((d) => d.name).join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, assignee, search]);

  const counts = useMemo(() => {
    const c = {};
    STAT_DEFS.forEach((s) => { c[s.key] = base.filter(s.match).length; });
    return c;
  }, [base]);

  const activeStat = STAT_DEFS.find((s) => s.key === filterKey) || STAT_DEFS[0];
  const filtered = useMemo(() => base.filter(activeStat.match), [base, activeStat]);

  useEffect(() => { setPage(0); }, [filterKey, assignee, search]);
  const paged = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const statWindow = STAT_DEFS.slice(statPage * STATS_PER_PAGE, statPage * STATS_PER_PAGE + STATS_PER_PAGE);
  const maxStatPage = Math.ceil(STAT_DEFS.length / STATS_PER_PAGE) - 1;

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>All Tasks</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Every doer's tasks across all orders — filter, search and track.</Typography>
        </Box>
      </Stack>

      {/* ── Single-line stat strip with ‹ › paging ── */}
      <Paper sx={{ p: 1, borderRadius: 3, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton size="small" disabled={statPage === 0} onClick={() => setStatPage((p) => Math.max(0, p - 1))}><ChevronLeft size={18} /></IconButton>
        <Stack direction="row" spacing={1} sx={{ flex: 1, overflow: 'hidden' }}>
          {statWindow.map((s) => {
            const active = filterKey === s.key;
            return (
              <Box key={s.key} onClick={() => setFilterKey(s.key)}
                sx={{
                  flex: 1, minWidth: 0, px: 1.5, py: 1, borderRadius: 2, cursor: 'pointer', textAlign: 'center',
                  border: '1px solid', borderColor: active ? s.color : 'divider',
                  bgcolor: active ? alpha(s.color, 0.1) : 'transparent',
                  transition: 'all .15s', '&:hover': { borderColor: s.color },
                }}>
                <Typography variant="h6" sx={{ fontWeight: 800, color: s.color, lineHeight: 1.1 }}>{counts[s.key] ?? 0}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }} noWrap>{s.label}</Typography>
              </Box>
            );
          })}
        </Stack>
        <IconButton size="small" disabled={statPage >= maxStatPage} onClick={() => setStatPage((p) => Math.min(maxStatPage, p + 1))}><ChevronRight size={18} /></IconButton>
      </Paper>

      {/* ── Filters ── */}
      <Paper sx={{ p: 1.25, borderRadius: 3, mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip label={activeStat.label === 'Total' ? 'Showing all' : `Filter: ${activeStat.label}`} onDelete={filterKey !== 'all' ? () => setFilterKey('all') : undefined} color={filterKey !== 'all' ? 'primary' : 'default'} variant="outlined" />
        </Stack>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <TextField select size="small" value={assignee} onChange={(e) => setAssignee(e.target.value)} sx={{ width: 200 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Users size={15} /></InputAdornment> }}>
            <MenuItem value="">All doers</MenuItem>
            {doerOptions.map((d) => <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>)}
          </TextField>
          <TextField size="small" placeholder="Search order, party, step, doer…" value={search} onChange={(e) => setSearch(e.target.value)}
            sx={{ width: { xs: '100%', sm: 280 } }} InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
        </Stack>
      </Paper>

      {isLoading ? <Skeleton variant="rounded" height={360} /> : (
        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha('#1d4ed8', 0.06) }}>
                <TableCell sx={{ width: 48 }}>#</TableCell>
                <TableCell>Task</TableCell>
                <TableCell>Order</TableCell>
                <TableCell>Doer(s)</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Due / Done</TableCell>
                <TableCell align="center">Checklist</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>No tasks match.</TableCell></TableRow>
              ) : paged.map((t, i) => {
                const tone = STATUS_TONE[t.status] || '#475569';
                return (
                  <TableRow key={`${t.processId}-${t.stepCode}`} hover sx={{ cursor: 'pointer', bgcolor: t.isOverdue ? alpha('#be123c', 0.04) : 'inherit' }}
                    onClick={() => navigate(`/o2d-fms/task/${t.processId}/${encodeURIComponent(t.stepCode)}`)}>
                    <TableCell>{page * rowsPerPage + i + 1}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <ListChecks size={15} />
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.name}</Typography>
                        <Chip size="small" variant="outlined" label={t.stepCode} />
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{t.soNumber}</Typography>
                      <Typography variant="caption" color="text.secondary">{t.partyName}</Typography>
                    </TableCell>
                    <TableCell><Typography variant="body2">{(t.doers || []).map((d) => d.name).join(', ') || <em style={{ color: '#94a3b8' }}>Unassigned</em>}</Typography></TableCell>
                    <TableCell><Chip size="small" label={t.isOverdue ? 'Overdue' : t.status} sx={{ bgcolor: alpha(t.isOverdue ? '#be123c' : tone, 0.12), color: t.isOverdue ? '#be123c' : tone, fontWeight: 600 }} /></TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography variant="caption">{isDone(t) ? fmt(t.completedAt) : fmt(t.planned)}</Typography>
                    </TableCell>
                    <TableCell align="center">
                      {t.checklistTotal > 0
                        ? <Chip size="small" variant="outlined" color={t.checklistDone === t.checklistTotal ? 'success' : 'default'} label={`${t.checklistDone}/${t.checklistTotal}`} />
                        : <Typography variant="caption" color="text.disabled">—</Typography>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <TablePagination component="div" count={filtered.length} page={page} onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[15, 30, 60]} />
        </Paper>
      )}
    </Box>
  );
};

export default AllTasks;
