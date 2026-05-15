import React, { useMemo } from 'react';
import { Box, Paper, Typography, Tooltip, alpha, useTheme, Stack } from '@mui/material';
import { Calendar, CircleDot } from 'lucide-react';
import dayjs from 'dayjs';

const STATUS_COLOR = (theme, status) => ({
  PLANNED:     theme.palette.primary.main,
  IN_PROGRESS: theme.palette.warning.main,
  DISPATCHED:  theme.palette.success.main,
  DELAYED:     theme.palette.error.main,
  CANCELLED:   theme.palette.text.disabled,
}[status] || theme.palette.primary.main);

// Group phases by phaseNo (a phase spans multiple SKUs in our model).
const groupByPhaseNo = (phaseChips = []) => {
  const map = new Map();
  for (const p of phaseChips) {
    const g = map.get(p.phaseNo) || { phaseNo: p.phaseNo, plannedDate: p.plannedDate, plannedQty: 0, actualQty: 0, skuCount: 0, status: 'PLANNED' };
    g.plannedQty += Number(p.plannedQty || 0);
    g.actualQty  += Number(p.actualQty || 0);
    g.skuCount += 1;
    // Bias status towards the "worst" — DELAYED beats IN_PROGRESS beats PLANNED beats DISPATCHED beats CANCELLED.
    const priority = { DELAYED: 4, IN_PROGRESS: 3, PLANNED: 2, DISPATCHED: 1, CANCELLED: 0 };
    if ((priority[p.status] || 0) > (priority[g.status] || 0)) g.status = p.status;
    if (p.plannedDate && (!g.plannedDate || new Date(p.plannedDate) < new Date(g.plannedDate))) g.plannedDate = p.plannedDate;
    map.set(p.phaseNo, g);
  }
  return [...map.values()].sort((a, b) => new Date(a.plannedDate || 0) - new Date(b.plannedDate || 0));
};

const PhaseTimeline = ({ phaseChips = [], onPhaseClick }) => {
  const theme = useTheme();
  const phases = useMemo(() => groupByPhaseNo(phaseChips), [phaseChips]);

  if (!phases.length) {
    return (
      <Paper sx={{ p: 3, borderRadius: '14px', textAlign: 'center' }}>
        <Stack direction="row" spacing={1} justifyContent="center" alignItems="center" color="text.secondary">
          <Calendar size={14} />
          <Typography variant="body2" color="text.secondary">
            No phases yet — click <strong>+ Add Phase</strong> to plan your first dispatch.
          </Typography>
        </Stack>
      </Paper>
    );
  }

  // Build a date range covering all phases (min..max) with at least 30 days padding.
  const dates = phases.map((p) => dayjs(p.plannedDate));
  const minD = dayjs.min ? dayjs.min(dates) : dates.reduce((a, b) => (a.isBefore(b) ? a : b), dates[0]);
  const maxD = dayjs.max ? dayjs.max(dates) : dates.reduce((a, b) => (a.isAfter(b)  ? a : b), dates[0]);
  const start = minD.subtract(7, 'day');
  const end   = (maxD.isBefore(start.add(30, 'day')) ? start.add(30, 'day') : maxD.add(7, 'day'));
  const totalDays = end.diff(start, 'day') + 1;
  const today = dayjs();

  const posPct = (d) => {
    const days = Math.max(0, Math.min(totalDays, dayjs(d).diff(start, 'day')));
    return (days / totalDays) * 100;
  };

  // Monthly tick marks
  const monthTicks = [];
  let cursor = start.startOf('month');
  while (cursor.isBefore(end)) {
    monthTicks.push({ date: cursor, left: posPct(cursor) });
    cursor = cursor.add(1, 'month');
  }

  return (
    <Paper sx={{ p: 2, borderRadius: '14px' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.25 }}>
        <Calendar size={14} color={theme.palette.primary.main} />
        <Typography variant="subtitle2" fontWeight={800}>Plan Timeline</Typography>
        <Typography variant="caption" color="text.secondary">
          · {phases.length} phase{phases.length > 1 ? 's' : ''}
        </Typography>
      </Stack>

      <Box sx={{ position: 'relative', height: 80, mx: 1 }}>
        {/* Track */}
        <Box sx={{
          position: 'absolute', left: 0, right: 0, top: 38,
          height: 4, borderRadius: 999, bgcolor: alpha(theme.palette.primary.main, 0.08),
        }} />

        {/* Month ticks */}
        {monthTicks.map((m) => (
          <Box key={m.date.toISOString()} sx={{ position: 'absolute', left: `${m.left}%`, top: 0, transform: 'translateX(-50%)' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', fontWeight: 600 }}>
              {m.date.format('MMM YY')}
            </Typography>
            <Box sx={{ width: 1, height: 8, bgcolor: alpha(theme.palette.primary.main, 0.18), mx: 'auto', mt: 0.25 }} />
          </Box>
        ))}

        {/* Today marker */}
        {today.isAfter(start) && today.isBefore(end) && (
          <Box sx={{
            position: 'absolute', left: `${posPct(today)}%`, top: 18, bottom: 0,
            width: 2, transform: 'translateX(-50%)',
            background: `linear-gradient(180deg, ${theme.palette.error.main}, transparent)`,
          }}>
            <Box sx={{
              position: 'absolute', top: -7, left: '50%', transform: 'translateX(-50%)',
              fontSize: '0.6rem', fontWeight: 800, color: 'error.main',
              bgcolor: 'background.paper', px: 0.5, borderRadius: '4px',
              border: '1px solid', borderColor: 'error.main',
            }}>TODAY</Box>
          </Box>
        )}

        {/* Phase chips */}
        {phases.map((p) => {
          const color = STATUS_COLOR(theme, p.status);
          const pct = p.plannedQty > 0 ? Math.min(100, Math.round((p.actualQty / p.plannedQty) * 100)) : 0;
          return (
            <Tooltip
              key={p.phaseNo}
              arrow
              title={
                <Box>
                  <Typography variant="caption" fontWeight={800}>{p.phaseNo} · {dayjs(p.plannedDate).format('DD MMM YYYY')}</Typography><br/>
                  <Typography variant="caption">Planned {p.plannedQty.toLocaleString('en-IN')} · Actual {p.actualQty.toLocaleString('en-IN')}</Typography><br/>
                  <Typography variant="caption">{p.skuCount} SKU{p.skuCount > 1 ? 's' : ''} · {p.status}</Typography>
                </Box>
              }
            >
              <Box
                onClick={() => onPhaseClick?.(p)}
                sx={{
                  position: 'absolute',
                  left: `${posPct(p.plannedDate)}%`,
                  top: 30,
                  transform: 'translateX(-50%)',
                  cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                }}
              >
                <Box sx={{
                  px: 1, py: 0.25, borderRadius: '999px',
                  bgcolor: alpha(color, 0.12), color, border: `1.5px solid ${color}`,
                  fontSize: '0.65rem', fontWeight: 800,
                  whiteSpace: 'nowrap', mb: 0.25,
                  display: 'flex', alignItems: 'center', gap: 0.5,
                }}>
                  <CircleDot size={10} />
                  {p.phaseNo}
                </Box>
                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: color, border: '2px solid', borderColor: 'background.paper', boxShadow: 1 }} />
                <Typography variant="caption" sx={{ fontSize: '0.62rem', mt: 0.25, fontWeight: 700, color: 'text.secondary' }}>
                  {dayjs(p.plannedDate).format('DD MMM')} · {pct}%
                </Typography>
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Paper>
  );
};

export default PhaseTimeline;
