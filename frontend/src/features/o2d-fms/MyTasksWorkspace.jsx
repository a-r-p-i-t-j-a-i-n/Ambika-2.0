import React, { useState, useMemo, useEffect } from 'react';
import {
  Box, Paper, Stack, Typography, Chip, Button, Skeleton, alpha,
  TextField, InputAdornment, ToggleButtonGroup, ToggleButton, MenuItem,
  Table, TableBody, TableCell, TableHead, TableRow, TablePagination, Tooltip,
} from '@mui/material';
import { ClipboardList, AlertTriangle, ArrowRight, Inbox, Search, ArrowUpDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetMyTasksQuery } from '../../store/api/o2dFmsApi';

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const isDueSoon = (d) => d && (new Date(d) - Date.now()) > 0 && (new Date(d) - Date.now()) < 24 * 3600 * 1000;

const MyTasksWorkspace = () => {
  // Poll so updates made by the MD (re-plan / reassign) appear without a manual refresh.
  const { data, isLoading } = useGetMyTasksQuery(undefined, { pollingInterval: 30_000, refetchOnMountOrArgChange: true });
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('actionable');
  const [sortBy, setSortBy] = useState('due');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const tasks = data?.data || [];
  const isPending = (t) => t.status === 'PENDING';
  const isDone = (t) => t.status === 'DONE' || t.status === 'DELAYED';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = tasks.filter((t) => {
      if (filter === 'actionable' && !isPending(t)) return false;
      if (filter === 'overdue' && !(isPending(t) && t.isOverdue)) return false;
      if (filter === 'dueSoon' && !(isPending(t) && isDueSoon(t.planned))) return false;
      if (filter === 'done' && !isDone(t)) return false;
      if (filter === 'buddy' && !t.asBuddy) return false;
      if (q && !`${t.soNumber} ${t.partyName} ${t.name} ${t.stepCode} ${t.tool || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sortBy === 'order') return (a.soNumber || '').localeCompare(b.soNumber || '');
      if (sortBy === 'step') return (a.name || '').localeCompare(b.name || '');
      return new Date(a.planned || 0) - new Date(b.planned || 0);
    });
    return list;
  }, [tasks, search, filter, sortBy]);

  // Keep the page index valid as filters change.
  useEffect(() => { setPage(0); }, [search, filter, sortBy]);
  const paged = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const counts = {
    actionable: tasks.filter(isPending).length,
    overdue: tasks.filter((t) => isPending(t) && t.isOverdue).length,
    dueSoon: tasks.filter((t) => isPending(t) && isDueSoon(t.planned)).length,
    done: tasks.filter(isDone).length,
    buddy: tasks.filter((t) => t.asBuddy).length,
  };

  const openTask = (t) => navigate(`/o2d-fms/task/${t.processId}/${encodeURIComponent(t.stepCode)}`);

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>My Tasks</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Everything assigned to you — what to do, for which order, and by when.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Chip label={`${counts.actionable} to do`} color="primary" variant="outlined" />
          {counts.overdue > 0 && <Chip icon={<AlertTriangle size={14} />} label={`${counts.overdue} overdue`} color="error" />}
        </Stack>
      </Stack>

      {!isLoading && tasks.length > 0 && (
        <Paper sx={{ p: 1.25, borderRadius: 3, mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', justifyContent: 'space-between' }}>
          <ToggleButtonGroup size="small" value={filter} exclusive onChange={(_, v) => v && setFilter(v)} sx={{ flexWrap: 'wrap' }}>
            <ToggleButton value="actionable">To do ({counts.actionable})</ToggleButton>
            <ToggleButton value="overdue" sx={{ color: counts.overdue ? '#be123c' : undefined }}>Overdue ({counts.overdue})</ToggleButton>
            <ToggleButton value="dueSoon">Due ≤24h ({counts.dueSoon})</ToggleButton>
            <ToggleButton value="done">Completed ({counts.done})</ToggleButton>
            <ToggleButton value="buddy">As buddy ({counts.buddy})</ToggleButton>
          </ToggleButtonGroup>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <TextField select size="small" value={sortBy} onChange={(e) => setSortBy(e.target.value)} sx={{ width: 150 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><ArrowUpDown size={14} /></InputAdornment> }}>
              <MenuItem value="due">Sort: Due date</MenuItem>
              <MenuItem value="order">Sort: Order #</MenuItem>
              <MenuItem value="step">Sort: Step</MenuItem>
            </TextField>
            <TextField size="small" placeholder="Search order, party, step…" value={search} onChange={(e) => setSearch(e.target.value)}
              sx={{ width: { xs: '100%', sm: 260 } }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
          </Stack>
        </Paper>
      )}

      {isLoading ? (
        <Skeleton variant="rounded" height={360} />
      ) : tasks.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 3 }}>
          <Inbox size={40} style={{ opacity: 0.4 }} />
          <Typography variant="h6" sx={{ mt: 1 }}>You're all caught up</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>No steps are waiting on you right now.</Typography>
        </Paper>
      ) : filtered.length === 0 ? (
        <Paper sx={{ p: 5, textAlign: 'center', borderRadius: 3, color: 'text.secondary' }}>
          <Search size={32} style={{ opacity: 0.4 }} />
          <Typography sx={{ mt: 1 }}>No tasks match your filters.</Typography>
          <Button size="small" sx={{ mt: 1 }} onClick={() => { setSearch(''); setFilter('all'); }}>Clear filters</Button>
        </Paper>
      ) : (
        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha('#1d4ed8', 0.06) }}>
                <TableCell sx={{ width: 48 }}>#</TableCell>
                <TableCell>Task</TableCell>
                <TableCell>Order</TableCell>
                <TableCell>Due / planned</TableCell>
                <TableCell align="center">Checklist</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paged.map((t, i) => (
                <TableRow
                  key={`${t.processId}-${t.stepCode}`}
                  hover
                  onClick={() => openTask(t)}
                  sx={{ cursor: 'pointer', bgcolor: t.isOverdue ? alpha('#be123c', 0.04) : 'inherit' }}
                >
                  <TableCell>{page * rowsPerPage + i + 1}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <ClipboardList size={15} />
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{t.name}</Typography>
                      <Chip size="small" variant="outlined" label={t.stepCode} />
                      {t.tool && <Chip size="small" label={t.tool} sx={{ bgcolor: alpha('#1d4ed8', 0.08) }} />}
                      {t.asBuddy && <Chip size="small" color="secondary" variant="filled" label="🤝 You're the buddy" />}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{t.soNumber}</Typography>
                    <Typography variant="caption" color="text.secondary">{t.partyName}</Typography>
                  </TableCell>
                  <TableCell>
                    {isDone(t) ? (
                      <Stack spacing={0.25}>
                        <Chip size="small" color={t.status === 'DELAYED' ? 'warning' : 'success'} label={t.status === 'DELAYED' ? 'Done (late)' : 'Done'} />
                        <Typography variant="caption" color="text.secondary">{fmt(t.completedAt)}</Typography>
                      </Stack>
                    ) : (
                      <>
                        <Typography variant="body2" sx={{ color: t.isOverdue ? '#be123c' : 'text.primary', fontWeight: t.isOverdue ? 700 : 400 }}>
                          {fmt(t.planned)}
                        </Typography>
                        {t.isOverdue && <Chip size="small" color="error" icon={<AlertTriangle size={11} />} label="Overdue" sx={{ mt: 0.25 }} />}
                      </>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {t.checklistTotal > 0
                      ? <Chip size="small" variant="outlined" color={t.checklistDone === t.checklistTotal ? 'success' : 'default'} label={`${t.checklistDone}/${t.checklistTotal}`} />
                      : <Typography variant="caption" color="text.disabled">—</Typography>}
                  </TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    <Button size="small" variant={isDone(t) ? 'outlined' : 'contained'} endIcon={<ArrowRight size={14} />} onClick={() => openTask(t)}>
                      {isDone(t) ? 'View' : 'Do it'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            component="div"
            count={filtered.length}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50]}
          />
        </Paper>
      )}
    </Box>
  );
};

export default MyTasksWorkspace;
