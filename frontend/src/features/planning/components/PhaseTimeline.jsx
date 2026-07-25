import React, { useMemo } from 'react';
import { Box, Paper, Typography, Tooltip, alpha, useTheme, Stack, LinearProgress } from '@mui/material';
import { Calendar, CircleDot } from 'lucide-react';
import dayjs from 'dayjs';

const STATUS_META = (theme) => ({
  PLANNED:     { color: theme.palette.primary.main,      label: 'Planned' },
  IN_PROGRESS: { color: theme.palette.warning.main,      label: 'In progress' },
  DISPATCHED:  { color: theme.palette.success.main,      label: 'Dispatched' },
  DELAYED:     { color: theme.palette.error.main,        label: 'Delayed' },
  CANCELLED:   { color: theme.palette.text.disabled,     label: 'Cancelled' },
});
const colorOf = (theme, status) => (STATUS_META(theme)[status]?.color || theme.palette.primary.main);

// Group phases by phaseNo (a phase spans multiple SKUs in our model).
const groupByPhaseNo = (phaseChips = []) => {
  const map = new Map();
  for (const p of phaseChips) {
    const g = map.get(p.phaseNo) || { phaseNo: p.phaseNo, plannedDate: p.plannedDate, plannedQty: 0, actualQty: 0, skuCount: 0, status: 'PLANNED' };
    g.plannedQty += Number(p.plannedQty || 0);
    g.actualQty  += Number(p.actualQty || 0);
    g.skuCount += 1;
    const priority = { DELAYED: 4, IN_PROGRESS: 3, PLANNED: 2, DISPATCHED: 1, CANCELLED: 0 };
    if ((priority[p.status] || 0) > (priority[g.status] || 0)) g.status = p.status;
    if (p.plannedDate && (!g.plannedDate || new Date(p.plannedDate) < new Date(g.plannedDate))) g.plannedDate = p.plannedDate;
    map.set(p.phaseNo, g);
  }
  return [...map.values()].sort((a, b) => new Date(a.plannedDate || 0) - new Date(b.plannedDate || 0));
};

const fmt = (n) => Number(n || 0).toLocaleString('en-IN');

const PhaseTimeline = ({ phaseChips = [], onPhaseClick }) => {
  const theme = useTheme();
  const meta = STATUS_META(theme);
  const phases = useMemo(() => groupByPhaseNo(phaseChips), [phaseChips]);

  if (!phases.length) {
    return (
      <Paper sx={{ p: 3, borderRadius: '8px', textAlign: 'center' }}>
        <Stack direction="row" spacing={1} justifyContent="center" alignItems="center" color="text.secondary">
          <Calendar size={14} />
          <Typography variant="body2" color="text.secondary">
            No phases yet — click <strong>+ Add Phase</strong> to plan your first dispatch.
          </Typography>
        </Stack>
      </Paper>
    );
  }

  const today = dayjs();
  const isDone = (s) => s === 'DISPATCHED';
  const isOverdue = (p) => dayjs(p.plannedDate).isBefore(today, 'day') && !isDone(p.status) && p.status !== 'CANCELLED';

  const overdue = phases.filter(isOverdue).length;
  const dispatched = phases.filter((p) => isDone(p.status)).length;
  const upcoming = phases.length - dispatched - overdue;
  const range = `${dayjs(phases[0].plannedDate).format('DD MMM')} → ${dayjs(phases[phases.length - 1].plannedDate).format('DD MMM YYYY')}`;

  return (
    <Paper sx={{ p: 2, borderRadius: '8px' }}>
      {/* Header + legend */}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" rowGap={0.5} sx={{ mb: 1 }}>
        <Calendar size={14} color={theme.palette.primary.main} />
        <Typography variant="subtitle2" fontWeight={800}>Plan Timeline</Typography>
        <Typography variant="caption" color="text.secondary">· {phases.length} phase{phases.length > 1 ? 's' : ''} · {range}</Typography>
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={1.25} alignItems="center">
          {['PLANNED', 'IN_PROGRESS', 'DISPATCHED', 'DELAYED'].map((s) => (
            <Stack key={s} direction="row" spacing={0.5} alignItems="center">
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: meta[s].color }} />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.62rem' }}>{meta[s].label}</Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>

      {/* Today summary line */}
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.25 }}>
        Today <strong>{today.format('DD MMM YYYY')}</strong>
        {dispatched > 0 && <> · <span style={{ color: theme.palette.success.main, fontWeight: 700 }}>{dispatched} dispatched</span></>}
        {overdue > 0 && <> · <span style={{ color: theme.palette.error.main, fontWeight: 700 }}>{overdue} overdue</span></>}
        {upcoming > 0 && <> · <span style={{ color: theme.palette.primary.main, fontWeight: 700 }}>{upcoming} upcoming</span></>}
      </Typography>

      {/* Connected stepper — evenly spaced so clustered dates never overlap */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', overflowX: 'auto', pb: 0.5 }}>
        {phases.map((p, i) => {
          const color = colorOf(theme, p.status);
          const pct = p.plannedQty > 0 ? Math.min(100, Math.round((p.actualQty / p.plannedQty) * 100)) : 0;
          const overdueFlag = isOverdue(p);
          return (
            <Box
              key={p.phaseNo}
              onClick={() => onPhaseClick?.(p)}
              sx={{ flex: 1, minWidth: 116, cursor: 'pointer', textAlign: 'center', '&:hover .pulse': { boxShadow: `0 0 0 6px ${alpha(color, 0.15)}` } }}
            >
              {/* connector + node */}
              <Box sx={{ position: 'relative', height: 22, mb: 0.75 }}>
                <Box sx={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 3, bgcolor: alpha(theme.palette.text.primary, 0.08), transform: 'translateY(-50%)' }} />
                {/* hide half-connectors at the ends */}
                {i === 0 && <Box sx={{ position: 'absolute', top: '50%', left: 0, width: '50%', height: 5, bgcolor: 'background.paper', transform: 'translateY(-50%)' }} />}
                {i === phases.length - 1 && <Box sx={{ position: 'absolute', top: '50%', right: 0, width: '50%', height: 5, bgcolor: 'background.paper', transform: 'translateY(-50%)' }} />}
                <Tooltip arrow title={
                  <Box>
                    <Typography variant="caption" fontWeight={800}>{p.phaseNo} · {dayjs(p.plannedDate).format('DD MMM YYYY')}</Typography><br />
                    <Typography variant="caption">Planned {fmt(p.plannedQty)} · Actual {fmt(p.actualQty)} ({pct}%)</Typography><br />
                    <Typography variant="caption">{p.skuCount} SKU{p.skuCount > 1 ? 's' : ''} · {meta[p.status]?.label || p.status}{overdueFlag ? ' · OVERDUE' : ''}</Typography>
                  </Box>
                }>
                  <Box className="pulse" sx={{
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    width: 18, height: 18, borderRadius: '50%', bgcolor: color,
                    border: `3px solid ${overdueFlag ? theme.palette.error.main : theme.palette.background.paper}`,
                    boxShadow: overdueFlag ? `0 0 0 3px ${alpha(theme.palette.error.main, 0.25)}` : 1,
                    display: 'grid', placeItems: 'center', transition: 'box-shadow .15s',
                  }}>
                    <CircleDot size={9} color="#fff" />
                  </Box>
                </Tooltip>
              </Box>

              {/* phase number pill */}
              <Box sx={{
                display: 'inline-flex', alignItems: 'center', px: 1, py: 0.1, borderRadius: '999px',
                bgcolor: alpha(color, 0.12), color, border: `1.5px solid ${color}`, fontSize: '0.66rem', fontWeight: 800,
              }}>{p.phaseNo}</Box>

              <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, mt: 0.4, color: overdueFlag ? 'error.main' : 'text.primary', fontSize: '0.68rem' }}>
                {dayjs(p.plannedDate).format('DD MMM YYYY')}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontSize: '0.64rem', fontVariantNumeric: 'tabular-nums' }}>
                {fmt(p.actualQty)} / {fmt(p.plannedQty)}
              </Typography>
              <Box sx={{ px: 1.5, mt: 0.4 }}>
                <LinearProgress
                  variant="determinate" value={pct}
                  sx={{ height: 5, borderRadius: 3, bgcolor: alpha(color, 0.12), '& .MuiLinearProgress-bar': { bgcolor: color } }}
                />
                <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>{pct}%</Typography>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
};

export default PhaseTimeline;
