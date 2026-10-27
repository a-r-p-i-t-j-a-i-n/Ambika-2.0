import React, { useMemo, useState, useEffect } from 'react';
import {
  Box, Paper, Stack, Typography, Chip, TextField, Skeleton, Button, InputAdornment,
  ToggleButtonGroup, ToggleButton, Tooltip, alpha, LinearProgress, Grid,
  Table, TableBody, TableCell, TableHead, TableRow, TablePagination,
} from '@mui/material';
import {
  Search, ArrowRight, LayoutGrid, Rows3, Grid3X3, AlertTriangle, Workflow,
  Kanban, GanttChart, CheckCircle2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetProcessesQuery } from '../../store/api/o2dFmsApi';
import { O2D } from './o2dTheme';

const fmtD = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// Shared tooltip look for the whole page — a light, warm card (no black) with blue
// text, matching the client's design system. A warm hairline + soft shadow makes it
// read as its own panel on white.
const TIP_SLOT = {
  tooltip: {
    sx: {
      bgcolor: O2D.surface, color: O2D.brand, px: 1.25, py: 1, borderRadius: '8px',
      maxWidth: 260, border: `1px solid ${O2D.line}`, boxShadow: '0 8px 26px rgba(28,30,33,0.16)',
      '& .MuiTypography-root': { color: '#1e40af', lineHeight: 1.5 },
      '& .tipHd': { color: O2D.brand, fontWeight: 800, letterSpacing: '0.01em' },
      '& b': { color: O2D.brand, fontWeight: 700 },
    },
  },
  arrow: {
    sx: {
      color: O2D.surface,
      '&::before': { border: `1px solid ${O2D.line}` },
    },
  },
};

// Overdue chip — saturated red with WHITE text + icon so it stays legible and pops.
const OVERDUE_CHIP = {
  bgcolor: '#dc2626', color: '#fff', fontWeight: 800,
  '& .MuiChip-icon': { color: '#fff' },
  '& .MuiChip-label': { color: '#fff' },
};

// Step → display tone. Current = the step the order is waiting on right now.
// IN_PROGRESS (quantity-gated dispatch part-way through its phases) shows blue
// even when the "current" pointer has moved on to the next step.
const stepTone = (s, currentStepCode) => {
  if (['DONE', 'DELAYED'].includes(s.status)) return { bg: '#0f766e', label: 'Done' };
  if (s.status === 'IN_PROGRESS') return { bg: '#1d4ed8', label: 'In progress' };
  if (s.isOverdue) return { bg: '#be123c', label: 'Overdue' };
  if (s.stepCode === currentStepCode) return { bg: '#1d4ed8', label: 'In progress' };
  return { bg: '#cbd5e1', label: 'Waiting' };
};

// Short "1/5" progress tag for a gated step mid-flight (dispatch phases OR
// consignment-gated invoice/POD/payment).
const dispatchTag = (s) => {
  if (s.status !== 'IN_PROGRESS') return '';
  const dp = s.dispatchProgress;
  if (dp) {
    if (dp.phasesTotal > 0) return `${dp.phasesDone}/${dp.phasesTotal}`;
    return dp.orderedQty > 0 ? `${dp.pct || 0}%` : '';
  }
  const ep = s.executionProgress;
  if (ep && ep.total > 0) return `${ep.done}/${ep.total}`;
  return '';
};

const progressPct = (steps = []) => {
  const done = steps.filter((s) => ['DONE', 'DELAYED'].includes(s.status)).length;
  return steps.length ? Math.round((done / steps.length) * 100) : 0;
};
const overdueCount = (steps = []) => steps.filter((s) => s.isOverdue).length;

const stepStatusLabel = (s) => {
  if (['DONE', 'DELAYED'].includes(s.status)) return s.status === 'DELAYED' ? 'Done (late)' : 'Done';
  if (s.status === 'IN_PROGRESS') return 'In progress';
  return s.isOverdue ? 'Overdue' : 'Pending';
};

const stepTip = (s) => (
  <Box>
    <Typography variant="caption" className="tipHd" sx={{ display: 'block', mb: 0.25 }}>{s.stepCode} · {s.name}</Typography>
    <Typography variant="caption" display="block">Status: {stepStatusLabel(s)}</Typography>
    {s.dispatchProgress && (
      <Typography variant="caption" display="block">
        Dispatched: {Number(s.dispatchProgress.dispatchedQty || 0).toLocaleString('en-IN')} / {Number(s.dispatchProgress.orderedQty || 0).toLocaleString('en-IN')} pcs
        {s.dispatchProgress.phasesTotal > 0 ? ` · ${s.dispatchProgress.phasesDone}/${s.dispatchProgress.phasesTotal} phases` : ''}
      </Typography>
    )}
    {s.executionProgress && (
      <Typography variant="caption" display="block">
        {s.executionProgress.done}/{s.executionProgress.total} consignment(s) {s.executionProgress.label}
      </Typography>
    )}
    <Typography variant="caption" display="block">Planned: {fmtD(s.planned)}</Typography>
    {s.actual && <Typography variant="caption" display="block">Actual: {fmtD(s.actual)}</Typography>}
    {s.checklistTotal > 0 && <Typography variant="caption" display="block">Checklist: {s.checklistDone}/{s.checklistTotal}</Typography>}
  </Box>
);

// ── View 1: Pipeline — one horizontal step-chain strip per order ─────────────
const PipelineRow = ({ p, navigate }) => {
  const pct = progressPct(p.steps);
  const od = overdueCount(p.steps);
  return (
    <Paper sx={{ p: 1.75, borderRadius: 3, mb: 1.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={1}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800 }} noWrap>{p.soNumber || p.partyName}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap display="block">{p.partyName}{p.poNumber ? ` · PO ${p.poNumber}` : ''}</Typography>
          </Box>
          <Chip size="small" variant="outlined" label={`${pct}%`} />
          {od > 0 && <Chip size="small" icon={<AlertTriangle size={12} />} label={`${od} overdue`} sx={OVERDUE_CHIP} />}
          {p.isCompleted && <Chip size="small" color="success" label="Completed" />}
        </Stack>
        <Button size="small" endIcon={<ArrowRight size={14} />} onClick={() => navigate(`/o2d-fms/process/${p._id}`)}>Open</Button>
      </Stack>
      {/* The step chain — left to right, click a segment to open that task */}
      <Stack direction="row" spacing={0} alignItems="center" sx={{ overflowX: 'auto', pb: 0.5 }}>
        {(p.steps || []).map((s, i) => {
          const tone = stepTone(s, p.currentStepCode);
          const isCurrent = (s.stepCode === p.currentStepCode || s.status === 'IN_PROGRESS') && !['DONE', 'DELAYED'].includes(s.status);
          const tag = dispatchTag(s);
          return (
            <React.Fragment key={s.stepCode}>
              {i > 0 && <Box sx={{ width: 14, height: 2, flexShrink: 0, bgcolor: alpha('#94a3b8', 0.5) }} />}
              <Tooltip title={stepTip(s)} arrow slotProps={TIP_SLOT}>
                <Box
                  onClick={() => navigate(`/o2d-fms/task/${p._id}/${encodeURIComponent(s.stepCode)}`)}
                  sx={{
                    px: 1, py: 0.4, borderRadius: 5, cursor: 'pointer', flexShrink: 0,
                    fontSize: '0.66rem', fontWeight: 700, whiteSpace: 'nowrap',
                    bgcolor: tone.bg === '#cbd5e1' ? alpha('#cbd5e1', 0.35) : alpha(tone.bg, 0.14),
                    color: tone.bg === '#cbd5e1' ? '#64748b' : tone.bg,
                    border: '1.5px solid',
                    borderColor: isCurrent ? tone.bg : alpha(tone.bg, 0.35),
                    boxShadow: isCurrent ? `0 0 0 3px ${alpha(tone.bg, 0.15)}` : 'none',
                    '&:hover': { borderColor: tone.bg },
                  }}
                >
                  {tag ? `${s.stepCode} · ${tag}` : s.stepCode}
                </Box>
              </Tooltip>
            </React.Fragment>
          );
        })}
      </Stack>
    </Paper>
  );
};

// ── View 2: Matrix — orders × steps grid (the Google-sheet view, supercharged) ─
const MatrixView = ({ rows, navigate }) => {
  // Column set = union of step codes across visible rows, in sequence order.
  const columns = useMemo(() => {
    const map = new Map();
    rows.forEach((p) => (p.steps || []).forEach((s) => {
      if (!map.has(s.stepCode)) map.set(s.stepCode, { stepCode: s.stepCode, name: s.name, sequence: s.sequence || 0 });
    }));
    return [...map.values()].sort((a, b) => a.sequence - b.sequence);
  }, [rows]);

  return (
    <Paper sx={{ borderRadius: 3, overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 760 }}>
        <TableHead>
          <TableRow sx={{ bgcolor: alpha('#1d4ed8', 0.06) }}>
            <TableCell sx={{ minWidth: 190, position: 'sticky', left: 0, bgcolor: '#eef3fd', zIndex: 2 }}>Order</TableCell>
            {columns.map((c) => (
              <TableCell key={c.stepCode} align="center" sx={{ px: 0.5 }}>
                <Tooltip title={c.name} arrow slotProps={TIP_SLOT}><Typography variant="caption" sx={{ fontWeight: 700 }}>{c.stepCode}</Typography></Tooltip>
              </TableCell>
            ))}
            <TableCell align="center">%</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((p) => {
            const byCode = new Map((p.steps || []).map((s) => [s.stepCode, s]));
            return (
              <TableRow key={p._id} hover>
                <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1, cursor: 'pointer' }}
                  onClick={() => navigate(`/o2d-fms/process/${p._id}`)}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{p.soNumber || '—'}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap display="block">{p.partyName}</Typography>
                </TableCell>
                {columns.map((c) => {
                  const s = byCode.get(c.stepCode);
                  if (!s) return <TableCell key={c.stepCode} align="center" sx={{ px: 0.5 }}><Typography variant="caption" color="text.disabled">·</Typography></TableCell>;
                  const tone = stepTone(s, p.currentStepCode);
                  return (
                    <TableCell key={c.stepCode} align="center" sx={{ px: 0.5, py: 0.75 }}>
                      <Tooltip title={stepTip(s)} arrow slotProps={TIP_SLOT}>
                        <Box
                          onClick={() => navigate(`/o2d-fms/task/${p._id}/${encodeURIComponent(s.stepCode)}`)}
                          sx={{
                            width: 16, height: 16, borderRadius: '50%', mx: 'auto', cursor: 'pointer',
                            bgcolor: tone.bg === '#cbd5e1' ? alpha('#cbd5e1', 0.6) : tone.bg,
                            outline: s.stepCode === p.currentStepCode && !['DONE', 'DELAYED'].includes(s.status)
                              ? `3px solid ${alpha(tone.bg, 0.25)}` : 'none',
                            '&:hover': { transform: 'scale(1.25)' }, transition: 'transform .12s',
                          }}
                        />
                      </Tooltip>
                    </TableCell>
                  );
                })}
                <TableCell align="center"><Typography variant="caption" sx={{ fontWeight: 700 }}>{progressPct(p.steps)}%</Typography></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Paper>
  );
};

// ── View 3: Cards — compact two-up summary cards ─────────────────────────────
const CardsView = ({ rows, navigate }) => (
  <Grid container spacing={1.5}>
    {rows.map((p) => {
      const pct = progressPct(p.steps);
      const od = overdueCount(p.steps);
      const cur = (p.steps || []).find((s) => s.stepCode === p.currentStepCode);
      return (
        <Grid item xs={12} md={6} key={p._id}>
          <Paper sx={{ p: 2, borderRadius: 3, cursor: 'pointer', height: '100%', '&:hover': { boxShadow: 4 } }}
            onClick={() => navigate(`/o2d-fms/process/${p._id}`)}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 800 }} noWrap>{p.soNumber || p.partyName}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap display="block">{p.partyName}</Typography>
              </Box>
              {p.isCompleted
                ? <Chip size="small" color="success" label="Completed" />
                : od > 0
                  ? <Chip size="small" icon={<AlertTriangle size={12} />} label={`${od} overdue`} sx={OVERDUE_CHIP} />
                  : <Chip size="small" variant="outlined" color="primary" label="On track" />}
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.25 }}>
              <LinearProgress variant="determinate" value={pct} sx={{ flex: 1, height: 7, borderRadius: 4 }} />
              <Typography variant="caption" sx={{ fontWeight: 700 }}>{pct}%</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }} noWrap>
              {p.isCompleted ? `Finished ${fmtD(p.completedAt)}` : cur ? `Now at: ${cur.name} (${cur.stepCode})` : 'Not started'}
            </Typography>
          </Paper>
        </Grid>
      );
    })}
  </Grid>
);

// ── View 4: Kanban — columns are stages, cards are the orders sitting there ──
const KanbanView = ({ rows, navigate }) => {
  // One column per stage that actually has orders waiting on it, plus Completed.
  const columns = useMemo(() => {
    const map = new Map();
    const completed = [];
    rows.forEach((p) => {
      if (p.isCompleted) { completed.push(p); return; }
      const cur = (p.steps || []).find((s) => s.stepCode === p.currentStepCode)
        || (p.steps || []).find((s) => !['DONE', 'DELAYED'].includes(s.status));
      if (!cur) { completed.push(p); return; }
      const key = cur.stepCode;
      if (!map.has(key)) map.set(key, { stepCode: key, name: cur.name, sequence: cur.sequence || 0, orders: [] });
      map.get(key).orders.push({ p, cur });
    });
    const cols = [...map.values()].sort((a, b) => a.sequence - b.sequence);
    if (completed.length) cols.push({ stepCode: 'DONE', name: 'Completed', sequence: 9999, orders: completed.map((p) => ({ p, cur: null })) });
    return cols;
  }, [rows]);

  if (!columns.length) return null;
  return (
    <Box sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1, alignItems: 'flex-start' }}>
      {columns.map((col) => {
        const isDoneCol = col.stepCode === 'DONE';
        const headColor = isDoneCol ? '#0f766e' : '#1d4ed8';
        return (
          <Paper key={col.stepCode} sx={{ minWidth: 250, maxWidth: 250, borderRadius: 3, flexShrink: 0, bgcolor: alpha(headColor, 0.03) }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1.5, borderBottom: '2px solid', borderColor: alpha(headColor, 0.3) }}>
              {isDoneCol ? <CheckCircle2 size={15} color={headColor} /> : <Chip size="small" variant="outlined" label={col.stepCode} sx={{ fontWeight: 700 }} />}
              <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }} noWrap title={col.name}>{col.name}</Typography>
              <Chip size="small" label={col.orders.length} sx={{ bgcolor: alpha(headColor, 0.12), color: headColor, fontWeight: 700 }} />
            </Stack>
            <Stack spacing={1} sx={{ p: 1.25 }}>
              {col.orders.map(({ p, cur }) => {
                const od = cur?.isOverdue;
                return (
                  <Paper key={p._id} variant="outlined"
                    onClick={() => (cur
                      ? navigate(`/o2d-fms/task/${p._id}/${encodeURIComponent(cur.stepCode)}`)
                      : navigate(`/o2d-fms/process/${p._id}`))}
                    sx={{
                      p: 1.25, borderRadius: 2, cursor: 'pointer',
                      borderLeft: '4px solid', borderLeftColor: od ? '#be123c' : (isDoneCol ? '#0f766e' : '#1d4ed8'),
                      '&:hover': { boxShadow: 3 },
                    }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{p.soNumber || p.partyName}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap display="block">{p.partyName}</Typography>
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.75 }} flexWrap="wrap" useFlexGap>
                      <Chip size="small" variant="outlined" label={`${progressPct(p.steps)}%`} sx={{ height: 20, fontSize: '0.62rem' }} />
                      {od && <Chip size="small" color="error" label={`due ${fmtD(cur.planned).split(',')[0]}`} sx={{ height: 20, fontSize: '0.62rem' }} />}
                      {!od && cur?.planned && <Chip size="small" label={`due ${fmtD(cur.planned).split(',')[0]}`} sx={{ height: 20, fontSize: '0.62rem', bgcolor: alpha('#1d4ed8', 0.08) }} />}
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          </Paper>
        );
      })}
    </Box>
  );
};

// ── View 5: Timeline — Gantt-style schedule per order, with a Today marker ───
const TimelineView = ({ rows, navigate }) => {
  // Each step's bar spans from the previous step's deadline to its own deadline.
  const model = useMemo(() => {
    let min = Infinity; let max = -Infinity;
    const lanes = rows.map((p) => {
      let cursor = p.createdAt ? new Date(p.createdAt).getTime() : null;
      const segs = [];
      (p.steps || []).forEach((s) => {
        const end = s.planned ? new Date(s.planned).getTime() : null;
        if (cursor != null && end != null && end > cursor) {
          segs.push({ s, start: cursor, end });
          if (cursor < min) min = cursor;
          if (end > max) max = end;
        }
        if (end != null) cursor = end;
      });
      return { p, segs };
    });
    const now = Date.now();
    if (min !== Infinity) { min = Math.min(min, now); max = Math.max(max, now); }
    return { lanes, min, max, now, ok: min !== Infinity && max > min };
  }, [rows]);

  if (!model.ok) {
    return <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 3, color: 'text.secondary' }}>No planned dates available to draw a timeline.</Paper>;
  }
  const { lanes, min, max, now } = model;
  const span = max - min;
  const pct = (t) => `${(((t - min) / span) * 100).toFixed(2)}%`;
  // 5 evenly spaced date ticks across the axis.
  const ticks = Array.from({ length: 5 }, (_, i) => min + (span * i) / 4);

  return (
    <Paper sx={{ p: 2, borderRadius: 3 }}>
      {/* Axis */}
      <Stack direction="row" sx={{ mb: 1 }}>
        <Box sx={{ width: { xs: 130, sm: 190 }, flexShrink: 0 }} />
        <Box sx={{ flex: 1, position: 'relative', height: 18 }}>
          {ticks.map((t, i) => (
            <Typography key={i} variant="caption" color="text.secondary" sx={{
              position: 'absolute', left: pct(t), transform: i === 0 ? 'none' : (i === 4 ? 'translateX(-100%)' : 'translateX(-50%)'),
              whiteSpace: 'nowrap', fontSize: '0.62rem',
            }}>
              {new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </Typography>
          ))}
          <Box sx={{ position: 'absolute', left: pct(now), top: 14, transform: 'translateX(-50%)' }}>
            <Typography variant="caption" sx={{ color: '#be123c', fontWeight: 700, fontSize: '0.6rem' }}>Today</Typography>
          </Box>
        </Box>
      </Stack>

      {lanes.map(({ p, segs }) => (
        <Stack key={p._id} direction="row" alignItems="center" sx={{ mb: 1, '&:hover .lane': { bgcolor: alpha('#1d4ed8', 0.03) } }}>
          <Box sx={{ width: { xs: 130, sm: 190 }, flexShrink: 0, pr: 1, cursor: 'pointer' }} onClick={() => navigate(`/o2d-fms/process/${p._id}`)}>
            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{p.soNumber || p.partyName}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap display="block">{p.partyName}</Typography>
          </Box>
          <Box className="lane" sx={{ flex: 1, position: 'relative', height: 26, borderRadius: 1, bgcolor: alpha('#cbd5e1', 0.15) }}>
            {/* Today line */}
            <Box sx={{ position: 'absolute', left: pct(now), top: -2, bottom: -2, width: '2px', bgcolor: '#be123c', opacity: 0.55, zIndex: 2 }} />
            {segs.map(({ s, start, end }) => {
              const tone = stepTone(s, p.currentStepCode);
              const isCurrent = s.stepCode === p.currentStepCode && !['DONE', 'DELAYED'].includes(s.status);
              return (
                <Tooltip key={s.stepCode} title={stepTip(s)} arrow slotProps={TIP_SLOT}>
                  <Box
                    onClick={() => navigate(`/o2d-fms/task/${p._id}/${encodeURIComponent(s.stepCode)}`)}
                    sx={{
                      position: 'absolute', top: 4, bottom: 4, zIndex: 1,
                      left: pct(start), width: `calc(${(((end - start) / span) * 100).toFixed(2)}% - 2px)`,
                      minWidth: 6, borderRadius: 1, cursor: 'pointer',
                      bgcolor: tone.bg === '#cbd5e1' ? alpha('#94a3b8', 0.4) : alpha(tone.bg, isCurrent ? 0.95 : 0.75),
                      outline: isCurrent ? `2px solid ${alpha(tone.bg, 0.35)}` : 'none',
                      '&:hover': { transform: 'scaleY(1.18)' }, transition: 'transform .12s',
                    }}
                  />
                </Tooltip>
              );
            })}
          </Box>
        </Stack>
      ))}
      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 1 }}>
        Each bar is one step's planned window. Bars left of the red Today line should already be green — anything red there is late.
      </Typography>
    </Paper>
  );
};

// ── Master FMS — every order's flow on one screen ────────────────────────────
const MasterFms = () => {
  const navigate = useNavigate();
  const { data, isLoading } = useGetProcessesQuery({ limit: 200, sort: '-createdAt', view: 'list' }, { pollingInterval: 60_000, skipPollingIfUnfocused: true });
  const all = data?.data || [];

  const [view, setView] = useState('pipeline');   // pipeline | matrix | cards
  const [filter, setFilter] = useState('active'); // active | overdue | completed | all
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(5);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((p) => {
      if (filter === 'active' && p.isCompleted) return false;
      if (filter === 'completed' && !p.isCompleted) return false;
      if (filter === 'overdue' && overdueCount(p.steps) === 0) return false;
      if (q && !`${p.soNumber || ''} ${p.poNumber || ''} ${p.partyName || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, filter, search]);

  useEffect(() => { setPage(0); }, [filter, search, view, rowsPerPage]);
  const paged = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const counts = {
    active: all.filter((p) => !p.isCompleted).length,
    overdue: all.filter((p) => overdueCount(p.steps) > 0).length,
    completed: all.filter((p) => p.isCompleted).length,
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <LayoutGrid size={20} />
            <Typography variant="h5" sx={{ fontWeight: 800 }}>Master FMS</Typography>
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Every order's full flow on one screen — pick the view that suits you.
          </Typography>
        </Box>
        {/* Legend */}
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          {[['#0f766e', 'Done'], ['#1d4ed8', 'In progress'], ['#be123c', 'Overdue'], ['#cbd5e1', 'Waiting']].map(([c, l]) => (
            <Stack key={l} direction="row" spacing={0.5} alignItems="center">
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: c }} />
              <Typography variant="caption" color="text.secondary">{l}</Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>

      {/* Controls */}
      <Paper sx={{ p: 1.25, borderRadius: 3, mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <ToggleButtonGroup size="small" value={view} exclusive onChange={(_, v) => v && setView(v)}>
            <ToggleButton value="pipeline" sx={{ gap: 0.5, textTransform: 'none' }}><Rows3 size={15} />Pipeline</ToggleButton>
            <ToggleButton value="matrix" sx={{ gap: 0.5, textTransform: 'none' }}><Grid3X3 size={15} />Matrix</ToggleButton>
            <ToggleButton value="kanban" sx={{ gap: 0.5, textTransform: 'none' }}><Kanban size={15} />Stage board</ToggleButton>
            <ToggleButton value="timeline" sx={{ gap: 0.5, textTransform: 'none' }}><GanttChart size={15} />Timeline</ToggleButton>
            <ToggleButton value="cards" sx={{ gap: 0.5, textTransform: 'none' }}><LayoutGrid size={15} />Cards</ToggleButton>
          </ToggleButtonGroup>
          <ToggleButtonGroup size="small" value={filter} exclusive onChange={(_, v) => v && setFilter(v)}>
            <ToggleButton value="active" sx={{ textTransform: 'none' }}>In progress ({counts.active})</ToggleButton>
            <ToggleButton value="overdue" sx={{ textTransform: 'none', color: counts.overdue ? '#be123c' : undefined }}>Overdue ({counts.overdue})</ToggleButton>
            <ToggleButton value="completed" sx={{ textTransform: 'none' }}>Completed ({counts.completed})</ToggleButton>
            <ToggleButton value="all" sx={{ textTransform: 'none' }}>All ({all.length})</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        <TextField size="small" placeholder="Search SO / PO / party…" value={search} onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 240 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
      </Paper>

      {isLoading ? (
        <Skeleton variant="rounded" height={420} />
      ) : filtered.length === 0 ? (
        <Paper sx={{ p: 5, textAlign: 'center', borderRadius: 3, color: 'text.secondary' }}>
          <Workflow size={32} style={{ opacity: 0.4 }} />
          <Typography sx={{ mt: 1 }}>No orders match this view.</Typography>
        </Paper>
      ) : (
        <>
          {view === 'pipeline' && <Box>{paged.map((p) => <PipelineRow key={p._id} p={p} navigate={navigate} />)}</Box>}
          {view === 'matrix' && <MatrixView rows={paged} navigate={navigate} />}
          {view === 'kanban' && <KanbanView rows={paged} navigate={navigate} />}
          {view === 'timeline' && <TimelineView rows={paged} navigate={navigate} />}
          {view === 'cards' && <CardsView rows={paged} navigate={navigate} />}
          <Paper sx={{ borderRadius: 3, mt: 1.5 }}>
            <TablePagination
              component="div"
              count={filtered.length}
              page={page}
              onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => setRowsPerPage(parseInt(e.target.value, 10))}
              rowsPerPageOptions={[5, 10, 20, 50]}
              labelRowsPerPage="Orders per page:"
            />
          </Paper>
        </>
      )}
    </Box>
  );
};

export default MasterFms;
