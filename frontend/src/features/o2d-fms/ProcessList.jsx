import React, { useMemo, useState, useEffect } from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, LinearProgress, TextField, MenuItem, Skeleton, Button, InputAdornment,
  ToggleButtonGroup, ToggleButton, TablePagination,
} from '@mui/material';
import { Search, ArrowRight, Workflow, CheckCircle2, Clock, AlertTriangle, SlidersHorizontal, X, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetProcessesQuery } from '../../store/api/o2dFmsApi';

// Status pill styles — tinted background + matching text/icon colour per state.
const STATUS_STYLES = {
  completed: { label: 'Completed',   color: '#15803d', bg: '#ecfdf5', border: '#bbf7d0', Icon: CheckCircle2 },
  progress:  { label: 'In progress', color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', Icon: Clock },
  overdue:   { label: 'Overdue',     color: '#dc2626', bg: '#fef2f2', border: '#fecaca', Icon: AlertTriangle },
};

const StatusPill = ({ variant, label }) => {
  const s = STATUS_STYLES[variant];
  const Icon = s.Icon;
  return (
    <Chip
      size="small" icon={<Icon size={14} />} label={label || s.label}
      sx={{
        height: 26, fontWeight: 700, color: s.color, bgcolor: s.bg,
        border: `1px solid ${s.border}`, borderRadius: '999px',
        '& .MuiChip-icon': { color: s.color, ml: 0.75, mr: -0.25 }, '& .MuiChip-label': { px: 1 },
      }}
    />
  );
};

const progressOf = (steps = []) => {
  const done = steps.filter((s) => ['DONE', 'DELAYED'].includes(s.status)).length;
  return steps.length ? Math.round((done / steps.length) * 100) : 0;
};
const overdueCount = (steps = []) => steps.filter((s) => s.isOverdue).length;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const PROGRESS_OPTS = [
  { value: 'all', label: 'Any progress' },
  { value: 'notstarted', label: 'Not started (0%)' },
  { value: 'inprogress', label: 'In progress (1–99%)' },
  { value: 'completed', label: 'Completed (100%)' },
];
const SORT_OPTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'progress', label: 'Progress (high → low)' },
  { value: 'overdue', label: 'Most overdue' },
  { value: 'party', label: 'Party (A → Z)' },
  { value: 'so', label: 'SO number' },
];

const ProcessList = () => {
  const navigate = useNavigate();
  // Load a wide set and filter entirely client-side so every filter composes.
  const { data, isLoading } = useGetProcessesQuery({ limit: 300, sort: '-createdAt' }, { pollingInterval: 60_000 });
  const rows = useMemo(() => data?.data || [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all'); // all | active | overdue | completed
  const [party, setParty] = useState('');
  const [step, setStep] = useState('');        // current-step code
  const [progress, setProgress] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // Option lists derived from the loaded data.
  const partyOptions = useMemo(() => [...new Set(rows.map((p) => p.partyName).filter(Boolean))].sort(), [rows]);
  const stepOptions = useMemo(() => {
    const map = new Map();
    rows.forEach((p) => {
      const cur = (p.steps || []).find((s) => s.stepCode === p.currentStepCode);
      if (cur && !map.has(cur.stepCode)) map.set(cur.stepCode, { code: cur.stepCode, name: cur.name, seq: cur.sequence || 0 });
    });
    return [...map.values()].sort((a, b) => a.seq - b.seq);
  }, [rows]);

  const counts = useMemo(() => ({
    all: rows.length,
    active: rows.filter((p) => !p.isCompleted).length,
    overdue: rows.filter((p) => overdueCount(p.steps) > 0).length,
    completed: rows.filter((p) => p.isCompleted).length,
  }), [rows]);

  const inCreatedRange = (createdAt) => {
    if (!from && !to) return true;
    if (!createdAt) return false;
    const t = new Date(createdAt).getTime();
    if (from && t < new Date(`${from}T00:00:00`).getTime()) return false;
    if (to && t > new Date(`${to}T23:59:59`).getTime()) return false;
    return true;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows.filter((p) => {
      if (status === 'active' && p.isCompleted) return false;
      if (status === 'completed' && !p.isCompleted) return false;
      if (status === 'overdue' && overdueCount(p.steps) === 0) return false;
      if (party && p.partyName !== party) return false;
      if (step && p.currentStepCode !== step) return false;
      if (progress !== 'all') {
        const pct = progressOf(p.steps);
        if (progress === 'completed' && !p.isCompleted) return false;
        if (progress === 'notstarted' && !(pct === 0 && !p.isCompleted)) return false;
        if (progress === 'inprogress' && !(pct > 0 && pct < 100 && !p.isCompleted)) return false;
      }
      if (!inCreatedRange(p.createdAt)) return false;
      if (q && !`${p.soNumber || ''} ${p.poNumber || ''} ${p.partyName || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const sorters = {
      newest: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
      oldest: (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
      progress: (a, b) => progressOf(b.steps) - progressOf(a.steps),
      overdue: (a, b) => overdueCount(b.steps) - overdueCount(a.steps),
      party: (a, b) => (a.partyName || '').localeCompare(b.partyName || ''),
      so: (a, b) => (a.soNumber || '').localeCompare(b.soNumber || ''),
    };
    return [...list].sort(sorters[sort] || sorters.newest);
  }, [rows, search, status, party, step, progress, from, to, sort]);

  useEffect(() => { setPage(0); }, [search, status, party, step, progress, from, to, sort, rowsPerPage]);
  const paged = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const activeFilters = (status !== 'all' ? 1 : 0) + (party ? 1 : 0) + (step ? 1 : 0)
    + (progress !== 'all' ? 1 : 0) + (from || to ? 1 : 0) + (search ? 1 : 0);
  const clearAll = () => {
    setSearch(''); setStatus('all'); setParty(''); setStep(''); setProgress('all'); setFrom(''); setTo(''); setSort('newest');
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Workflow size={20} />
            <Typography variant="h5" sx={{ fontWeight: 800 }}>FMS Tracker</Typography>
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Every order's flow, end to end — filter to find exactly what you need.</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ width: { xs: '100%', sm: 'auto' } }}>
          <TextField
            size="small" placeholder="Search SO / PO / party…" value={search}
            onChange={(e) => setSearch(e.target.value)} sx={{ flex: 1, minWidth: { xs: 0, sm: 240 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> }}
          />
          {/* A new FMS starts by punching in a Sales Order — quick link to do that. */}
          <Button variant="contained" size="small" startIcon={<Plus size={15} />}
            onClick={() => navigate('/orders?new=1')} sx={{ whiteSpace: 'nowrap', fontWeight: 700 }}>
            New Sales Order
          </Button>
        </Stack>
      </Stack>

      {/* ── Filters ── */}
      <Paper sx={{ p: 1.5, borderRadius: 3, mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
          <SlidersHorizontal size={15} />
          <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary' }}>Filters</Typography>
          <Box sx={{ flex: 1 }} />
          <Typography variant="caption" color="text.secondary">
            Showing <b>{filtered.length}</b> of {rows.length} order(s)
          </Typography>
          {activeFilters > 0 && (
            <Button size="small" color="inherit" startIcon={<X size={13} />} onClick={clearAll} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Clear ({activeFilters})
            </Button>
          )}
        </Stack>

        <ToggleButtonGroup size="small" exclusive value={status} onChange={(_, v) => v && setStatus(v)} sx={{ mb: 1.25, flexWrap: 'wrap' }}>
          <ToggleButton value="all" sx={{ textTransform: 'none' }}>All ({counts.all})</ToggleButton>
          <ToggleButton value="active" sx={{ textTransform: 'none' }}>In progress ({counts.active})</ToggleButton>
          <ToggleButton value="overdue" sx={{ textTransform: 'none', color: counts.overdue ? '#dc2626' : undefined }}>Overdue ({counts.overdue})</ToggleButton>
          <ToggleButton value="completed" sx={{ textTransform: 'none' }}>Completed ({counts.completed})</ToggleButton>
        </ToggleButtonGroup>

        <Box sx={{
          display: 'grid', gap: 1.25,
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', xl: 'repeat(6, 1fr)' },
        }}>
          <TextField select size="small" label="Party" value={party} onChange={(e) => setParty(e.target.value)} fullWidth>
            <MenuItem value="">All parties</MenuItem>
            {partyOptions.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Current step" value={step} onChange={(e) => setStep(e.target.value)} fullWidth>
            <MenuItem value="">All steps</MenuItem>
            {stepOptions.map((s) => <MenuItem key={s.code} value={s.code}>{s.code} · {s.name}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Progress" value={progress} onChange={(e) => setProgress(e.target.value)} fullWidth>
            {PROGRESS_OPTS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
          <TextField size="small" type="date" label="Created from" value={from} onChange={(e) => setFrom(e.target.value)}
            InputLabelProps={{ shrink: true }} inputProps={{ max: to || undefined }} fullWidth />
          <TextField size="small" type="date" label="Created to" value={to} onChange={(e) => setTo(e.target.value)}
            InputLabelProps={{ shrink: true }} inputProps={{ min: from || undefined }} fullWidth />
          <TextField select size="small" label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)} fullWidth>
            {SORT_OPTS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
        </Box>
      </Paper>

      <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{ overflowX: 'auto' }}>
          {isLoading ? <Skeleton variant="rounded" height={300} /> : (
            <Table size="small" sx={{ minWidth: 860 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 190 }}>Order</TableCell><TableCell sx={{ minWidth: 150 }}>Current step</TableCell>
                  <TableCell sx={{ width: 200 }}>Progress</TableCell><TableCell>Status</TableCell>
                  <TableCell>Created</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ py: 5, color: 'text.secondary' }}>No orders match these filters.</TableCell></TableRow>
                ) : paged.map((p) => {
                  const pct = progressOf(p.steps);
                  const od = overdueCount(p.steps);
                  const cur = p.steps?.find((s) => s.stepCode === p.currentStepCode);
                  return (
                    <TableRow key={p._id} hover>
                      <TableCell>
                        <Typography sx={{ fontWeight: 700 }}>{p.soNumber || '—'}</Typography>
                        <Typography variant="caption" color="text.secondary" noWrap display="block">
                          {p.partyName}{p.poNumber ? ` · PO ${p.poNumber}` : ''}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{cur?.name || (p.isCompleted ? '—' : p.currentStepCode || '—')}</Typography>
                        {cur?.stepCode && <Typography variant="caption" color="text.secondary">{cur.stepCode}</Typography>}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <LinearProgress variant="determinate" value={pct} sx={{ flex: 1, height: 6, borderRadius: 3 }} />
                          <Typography variant="caption" sx={{ fontWeight: 700, minWidth: 30 }}>{pct}%</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {p.isCompleted ? <StatusPill variant="completed" />
                          : od > 0 ? <StatusPill variant="overdue" label={`${od} overdue`} />
                            : <StatusPill variant="progress" />}
                      </TableCell>
                      <TableCell><Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{fmtDate(p.createdAt)}</Typography></TableCell>
                      <TableCell align="right">
                        <Button size="small" endIcon={<ArrowRight size={14} />} onClick={() => navigate(`/o2d-fms/process/${p._id}`)}>Open</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Box>
        <TablePagination
          component="div"
          count={filtered.length}
          page={page}
          onPageChange={(_, pg) => setPage(pg)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => setRowsPerPage(parseInt(e.target.value, 10))}
          rowsPerPageOptions={[10, 25, 50, 100]}
          labelRowsPerPage="Orders per page:"
        />
      </Paper>
    </Box>
  );
};

export default ProcessList;
