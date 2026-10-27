import React, { useMemo, useState, useEffect } from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, LinearProgress, TextField, MenuItem, Skeleton, Button, InputAdornment,
  TablePagination, alpha, Menu,
} from '@mui/material';
import { Search, ArrowRight, Workflow, CheckCircle2, Clock, AlertTriangle, X, Plus, CalendarRange } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetProcessesQuery } from '../../store/api/o2dFmsApi';
import { O2D } from './o2dTheme';

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
// Status filter as ONE dropdown (was four toggle buttons). `render` is the compact
// value shown when closed; Overdue is red so it stands out even collapsed.
const STATUS_FILTERS = [
  { value: 'all',       key: 'all',       label: 'All',         render: 'All' },
  { value: 'active',    key: 'active',    label: 'In progress', render: 'In progress' },
  { value: 'overdue',   key: 'overdue',   label: 'Overdue',     render: <span style={{ color: '#dc2626', fontWeight: 700 }}>Overdue</span> },
  { value: 'completed', key: 'completed', label: 'Completed',   render: 'Completed' },
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
  const { data, isLoading } = useGetProcessesQuery({ limit: 300, sort: '-createdAt', view: 'list' }, { pollingInterval: 60_000, skipPollingIfUnfocused: true });
  const rows = useMemo(() => data?.data || [], [data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all'); // all | active | overdue | completed
  const [party, setParty] = useState('');
  const [step, setStep] = useState('');        // current-step code
  const [progress, setProgress] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [dateAnchor, setDateAnchor] = useState(null); // Created-range popover anchor
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
    <Box sx={{ bgcolor: O2D.canvas, minHeight: '100vh' }}>
      {/* Flush top bar — title + search + New Sales Order, hard against the sidebar */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 5, bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}`, px: { xs: 1.5, md: 2 }, py: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1.25} flexWrap="wrap" useFlexGap>
          <Box sx={{ p: 0.5, borderRadius: '6px', bgcolor: alpha(O2D.brand, 0.1), color: O2D.brand, display: 'flex', flexShrink: 0 }}><Workflow size={16} /></Box>
          <Box sx={{ minWidth: 0, mr: 'auto' }}>
            <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.2 }}>FMS Tracker</Typography>
            <Typography noWrap sx={{ fontSize: '0.72rem', color: O2D.sub }}>Every order's flow, end to end — filter to find what you need.</Typography>
          </Box>
          <TextField
            size="small" placeholder="Search SO / PO / party…" value={search}
            onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: { xs: '100%', sm: 240 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }}
          />
          <Button variant="contained" size="small" disableElevation startIcon={<Plus size={14} />}
            onClick={() => navigate('/orders?new=1')} sx={{ whiteSpace: 'nowrap', fontWeight: 700, textTransform: 'none', borderRadius: '6px', bgcolor: O2D.brand, flexShrink: 0 }}>
            New Sales Order
          </Button>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.25, md: 1.75 }, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {/* ── Filters — ONE line: status + date-range collapsed into dropdowns ── */}
      <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {/* Status — single dropdown (was 4 tabs) */}
          <TextField select size="small" label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 150 }}
            SelectProps={{ renderValue: (v) => (STATUS_FILTERS.find((o) => o.value === v) || {}).render }}>
            {STATUS_FILTERS.map((o) => (
              <MenuItem key={o.value} value={o.value}>{o.label} ({counts[o.key]})</MenuItem>
            ))}
          </TextField>

          <TextField select size="small" label="Party" value={party} onChange={(e) => setParty(e.target.value)} sx={{ minWidth: 130, flex: 1 }}>
            <MenuItem value="">All parties</MenuItem>
            {partyOptions.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Current step" value={step} onChange={(e) => setStep(e.target.value)} sx={{ minWidth: 140, flex: 1 }}>
            <MenuItem value="">All steps</MenuItem>
            {stepOptions.map((s) => <MenuItem key={s.code} value={s.code}>{s.code} · {s.name}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Progress" value={progress} onChange={(e) => setProgress(e.target.value)} sx={{ minWidth: 120, flex: 1 }}>
            {PROGRESS_OPTS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>

          {/* Created — a single button that opens a From/To range popover on click */}
          <Button size="small" variant="outlined" startIcon={<CalendarRange size={14} />}
            onClick={(e) => setDateAnchor(e.currentTarget)}
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.74rem', borderRadius: '6px', borderColor: (from || to) ? O2D.brand : O2D.line, color: (from || to) ? O2D.brand : O2D.body, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {from || to ? `${from ? fmtDate(from) : '…'} → ${to ? fmtDate(to) : '…'}` : 'Created: any'}
          </Button>
          <Menu anchorEl={dateAnchor} open={!!dateAnchor} onClose={() => setDateAnchor(null)}
            slotProps={{ paper: { sx: { p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}` } } }}>
            <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: O2D.faint, mb: 1 }}>Created between</Typography>
            <Stack spacing={1.25} sx={{ minWidth: 200 }}>
              <TextField size="small" type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)}
                InputLabelProps={{ shrink: true }} inputProps={{ max: to || undefined }} fullWidth />
              <TextField size="small" type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)}
                InputLabelProps={{ shrink: true }} inputProps={{ min: from || undefined }} fullWidth />
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Button size="small" onClick={() => { setFrom(''); setTo(''); }} sx={{ textTransform: 'none' }}>Clear dates</Button>
                <Button size="small" variant="contained" disableElevation onClick={() => setDateAnchor(null)} sx={{ textTransform: 'none', borderRadius: '6px' }}>Done</Button>
              </Stack>
            </Stack>
          </Menu>

          <TextField select size="small" label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} sx={{ minWidth: 120, flex: 1 }}>
            {SORT_OPTS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>

          <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, whiteSpace: 'nowrap', ml: 'auto' }}>
            <b>{filtered.length}</b> of {rows.length}
          </Typography>
          {activeFilters > 0 && (
            <Button size="small" color="inherit" startIcon={<X size={12} />} onClick={clearAll}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', flexShrink: 0 }}>
              Clear ({activeFilters})
            </Button>
          )}
        </Stack>
      </Paper>

      <Paper elevation={0} sx={{ borderRadius: '8px', overflow: 'hidden', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Box sx={{ overflowX: 'auto' }}>
          {isLoading ? <Skeleton variant="rounded" height={300} /> : (
            <Table size="small" sx={{
              minWidth: 860,
              '& td, & th': { borderColor: O2D.lineSoft },
              '& tbody tr:hover': { bgcolor: O2D.surfaceAlt },
              '& thead th': { bgcolor: O2D.surfaceAlt, fontWeight: 800, fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: O2D.sub, borderBottom: `1px solid ${O2D.line}` },
            }}>
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
                    // The whole row opens the order — no separate "Open" button to hunt for.
                    <TableRow
                      key={p._id} hover
                      onClick={() => navigate(`/o2d-fms/process/${p._id}`)}
                      role="link" tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/o2d-fms/process/${p._id}`); } }}
                      sx={{
                        cursor: 'pointer',
                        '&:hover .row-go': { opacity: 1, transform: 'translateX(0)' },
                        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '-2px' },
                      }}
                    >
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
                      {/* Quiet affordance — slides in on hover so the row still reads as clickable */}
                      <TableCell align="right" sx={{ width: 44 }}>
                        <Box className="row-go" sx={{
                          display: 'inline-flex', color: 'primary.main',
                          opacity: 0, transform: 'translateX(-4px)', transition: 'opacity .15s, transform .15s',
                        }}>
                          <ArrowRight size={16} />
                        </Box>
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
    </Box>
  );
};

export default ProcessList;
