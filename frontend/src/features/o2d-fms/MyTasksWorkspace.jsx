import React, { useState, useMemo, useEffect } from 'react';
import {
  Box, Paper, Stack, Typography, Chip, Button, Skeleton, alpha,
  TextField, InputAdornment, ToggleButtonGroup, ToggleButton, MenuItem,
  Table, TableBody, TableCell, TableHead, TableRow, TablePagination,
} from '@mui/material';
import { ClipboardList, AlertTriangle, Inbox, Search, ArrowUpDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetMyTasksQuery } from '../../store/api/o2dFmsApi';

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const num = (n) => Number(n || 0).toLocaleString('en-IN');
const isDueSoon = (d) => d && (new Date(d) - Date.now()) > 0 && (new Date(d) - Date.now()) < 24 * 3600 * 1000;

// Status chip shown in the dedicated Status column.
const statusChip = (t) => {
  if (t.isOverdue) {
    return (
      <Chip
        size="small"
        icon={<AlertTriangle size={14} />}
        label="Overdue"
        sx={{
          height: 26,
          fontWeight: 700,
          color: '#dc2626',
          bgcolor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '999px',
          '& .MuiChip-icon': { color: '#dc2626', ml: 0.75, mr: -0.25 },
          '& .MuiChip-label': { px: 1 },
        }}
      />
    );
  }
  if (t.status === 'DELAYED') return <Chip size="small" color="warning" label="Done late" />;
  if (t.status === 'DONE') return <Chip size="small" color="success" label="Done" />;
  // Quantity-/consignment-gated step part-way through — still the doer's task.
  if (t.status === 'IN_PROGRESS') {
    const ep = t.executionProgress;
    const label = t.dcNumber
      ? (t.consignmentTotal > 1 ? `To do · ${t.pendingConsignments}/${t.consignmentTotal} challans` : `To do · ${t.dcNumber}`)
      : t.dispatchProgress
        ? `In progress · ${num(t.dispatchProgress.balanceQty)} left`
        : ep ? `In progress · ${num(ep.done)}/${num(ep.total)} ${ep.label || ''}`.trim()
          : 'In progress';
    return <Chip size="small" color="primary" label={label} />;
  }
  if (isDueSoon(t.planned)) return <Chip size="small" color="warning" variant="outlined" label="Due soon" />;
  return <Chip size="small" variant="outlined" label="Pending" />;
};

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
  // "Actionable" = still on the doer's plate: PENDING or IN_PROGRESS (the phased
  // dispatch task stays IN_PROGRESS and recurs until every phase ships).
  const isActionable = (t) => t.status === 'PENDING' || t.status === 'IN_PROGRESS';
  const isDone = (t) => t.status === 'DONE' || t.status === 'DELAYED';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = tasks.filter((t) => {
      if (filter === 'actionable' && !isActionable(t)) return false;
      if (filter === 'overdue' && !(isActionable(t) && t.isOverdue)) return false;
      if (filter === 'dueSoon' && !(isActionable(t) && isDueSoon(t.planned))) return false;
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
    actionable: tasks.filter(isActionable).length,
    overdue: tasks.filter((t) => isActionable(t) && t.isOverdue).length,
    dueSoon: tasks.filter((t) => isActionable(t) && isDueSoon(t.planned)).length,
    done: tasks.filter(isDone).length,
    buddy: tasks.filter((t) => t.asBuddy).length,
  };

  // Open the task — for a per-consignment step still pending a challan, land straight
  // on THAT delivery (?dc=) so the doer works the exact consignment their task is for.
  const openTask = (t) => {
    const q = t.dcNumber ? `?dc=${encodeURIComponent(t.dcNumber)}` : '';
    navigate(`/o2d-fms/task/${t.processId}/${encodeURIComponent(t.stepCode)}${q}`);
  };

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

      {!isLoading && counts.buddy > 0 && (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
          <Box component="span" sx={{ width: 14, height: 14, borderRadius: 0.5, bgcolor: alpha('#7c3aed', 0.16), border: '1px solid', borderColor: alpha('#7c3aed', 0.45) }} />
          Purple rows are steps where you're the backup (buddy) — step in if the main doer can't.
        </Typography>
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
        <Paper sx={{ borderRadius: 3, overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 860 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: alpha('#1d4ed8', 0.06) }}>
                <TableCell sx={{ width: 44 }}>#</TableCell>
                <TableCell sx={{ width: 300 }}>Task</TableCell>
                <TableCell>Order</TableCell>
                <TableCell sx={{ width: 120 }}>Status</TableCell>
                <TableCell sx={{ width: 170 }}>Due / planned</TableCell>
                <TableCell align="center" sx={{ width: 96 }}>Checklist</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paged.map((t, i) => (
                <TableRow
                  key={`${t.processId}-${t.stepCode}`}
                  hover
                  onClick={() => openTask(t)}
                  sx={{
                    height: 56,
                    cursor: 'pointer',
                    // Overdue → light red; buddy → purple; else default.
                    bgcolor: t.isOverdue ? alpha('#be123c', 0.06) : (t.asBuddy ? alpha('#7c3aed', 0.16) : 'inherit'),
                    '&:hover': t.asBuddy && !t.isOverdue ? { bgcolor: `${alpha('#7c3aed', 0.22)} !important` } : undefined,
                  }}
                >
                  <TableCell>{page * rowsPerPage + i + 1}</TableCell>
                  <TableCell sx={{ maxWidth: 300 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                      <ClipboardList size={15} style={{ flexShrink: 0 }} />
                      <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0 }} noWrap title={t.name}>{t.name}</Typography>
                      <Chip size="small" variant="outlined" label={t.stepCode} sx={{ flexShrink: 0 }} />
                      {t.tool && <Chip size="small" label={t.tool} sx={{ bgcolor: alpha('#1d4ed8', 0.08), flexShrink: 0 }} />}
                      {t.dispatchProgress && (
                        <Chip size="small" color="primary" variant="outlined" sx={{ flexShrink: 0, fontWeight: 700 }}
                          label={`${num(t.dispatchProgress.dispatchedQty)}/${num(t.dispatchProgress.orderedQty)}${t.dispatchProgress.phasesTotal > 0 ? ` · ${t.dispatchProgress.phasesDone}/${t.dispatchProgress.phasesTotal} ph` : ''}`} />
                      )}
                      {t.executionProgress && (
                        <Chip size="small" color="secondary" variant="outlined" sx={{ flexShrink: 0, fontWeight: 700 }}
                          label={`${num(t.executionProgress.done)}/${num(t.executionProgress.total)} ${t.executionProgress.label || ''}`.trim()} />
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    <Typography variant="body2" noWrap>{t.soNumber}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap display="block">{t.partyName}</Typography>
                  </TableCell>
                  <TableCell>{statusChip(t)}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="body2" sx={{ color: t.isOverdue ? '#be123c' : 'text.primary', fontWeight: t.isOverdue ? 700 : 400 }}>
                      {isDone(t) ? fmt(t.completedAt) : fmt(t.planned)}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    {t.checklistTotal > 0
                      ? <Chip size="small" variant="outlined" color={t.checklistDone === t.checklistTotal ? 'success' : 'default'} label={`${t.checklistDone}/${t.checklistTotal}`} />
                      : <Typography variant="caption" color="text.disabled">—</Typography>}
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
