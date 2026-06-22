import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Paper, Typography, Stack, Button, IconButton, Chip, alpha, useTheme,
  TextField, MenuItem, Dialog, DialogTitle, DialogContent, Divider, Tooltip,
  useMediaQuery, Skeleton, Popover,
} from '@mui/material';
import {
  ChevronLeft, ChevronRight, ChevronDown, CalendarDays, Truck, Search, X, ArrowRight,
  Package, Building2,
} from 'lucide-react';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useGetSchedulesQuery } from '../../store/api/dispatchControlApi';

dayjs.extend(isoWeek);

const num = (n) => Number(n || 0).toLocaleString('en-IN');
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Sidebar brand palette — keep the calendar visually in sync with the nav.
const NAVY = '#0b2545';
const BRAND = '#1d4ed8';
const BRAND_DK = '#1e3a8a';
const BRAND_GRADIENT = 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)';
// Richer, darker grid line than the default divider — gives the calendar weight.
const GRID = '#aab8d4';

// Phase lifecycle → colour. Mirrors the schedule model's status enum.
// "Planned" uses the sidebar brand blue so the default state matches the nav.
const STATUS = {
  PLANNED:     { label: 'Planned',     color: BRAND },
  IN_PROGRESS: { label: 'In Progress', color: '#b45309' },
  DISPATCHED:  { label: 'Dispatched',  color: '#0f766e' },
  DELAYED:     { label: 'Delayed',     color: '#be123c' },
  CANCELLED:   { label: 'Cancelled',   color: '#64748b' },
};
const statusMeta = (s) => STATUS[s] || STATUS.PLANNED;
// Worst-status wins when several SKUs share one phase.
const PRIORITY = { DELAYED: 5, IN_PROGRESS: 4, PLANNED: 3, DISPATCHED: 2, CANCELLED: 1 };

/**
 * Dispatch Calendar — a Google-Calendar-style month grid of every planned
 * dispatch phase across all orders. Each day cell shows small pills (party ·
 * qty); click a day to see the full plan for that date. Built for the MD to
 * grasp "what's planned when" at a glance. Read-only.
 */
const DispatchCalendar = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [cursor, setCursor] = useState(dayjs().startOf('month'));
  const [partyFilter, setPartyFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [openDay, setOpenDay] = useState(null); // 'YYYY-MM-DD' of the day dialog
  const [pickerEl, setPickerEl] = useState(null); // month/year picker anchor
  const [pickerYear, setPickerYear] = useState(dayjs().year());

  const openPicker = (e) => { setPickerYear(cursor.year()); setPickerEl(e.currentTarget); };
  const pickMonth = (mIdx) => { setCursor(dayjs().year(pickerYear).month(mIdx).startOf('month')); setPickerEl(null); };

  const { data: schedRes, isLoading } = useGetSchedulesQuery({ limit: 1000, sort: '-updatedAt' });
  const schedules = useMemo(() => schedRes?.data || [], [schedRes]);

  // Flatten every phase into one event per (order · phaseNo · date), rolling up
  // the SKU lines so a multi-SKU phase shows as a single calendar entry.
  const allEvents = useMemo(() => {
    const map = new Map();
    schedules.forEach((s) => {
      (s.items || []).forEach((item) => {
        (item.phases || []).forEach((ph) => {
          if (!ph.plannedDate) return;
          const dateKey = dayjs(ph.plannedDate).format('YYYY-MM-DD');
          const key = `${s.soNumber}__${ph.phaseNo}__${dateKey}`;
          const ev = map.get(key) || {
            id: key, dateKey, date: ph.plannedDate,
            soNumber: s.soNumber, poNumber: s.poNumber, partyName: s.partyName || '—',
            phaseNo: ph.phaseNo, plannedQty: 0, actualQty: 0, status: 'CANCELLED', skus: [],
          };
          ev.plannedQty += Number(ph.plannedQty || 0);
          ev.actualQty += Number(ph.totalActualQty || 0);
          if ((PRIORITY[ph.status] || 0) > (PRIORITY[ev.status] || 0)) ev.status = ph.status;
          ev.skus.push({
            skuName: item.skuName, skuCode: item.skuCode,
            plannedQty: Number(ph.plannedQty || 0), actualQty: Number(ph.totalActualQty || 0),
            status: ph.status,
          });
          map.set(key, ev);
        });
      });
    });
    return [...map.values()];
  }, [schedules]);

  const parties = useMemo(
    () => [...new Set(allEvents.map((e) => e.partyName).filter((p) => p && p !== '—'))].sort(),
    [allEvents],
  );

  // Apply filters once, reused by the grid and the day dialog.
  const events = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allEvents.filter((e) => {
      if (partyFilter && e.partyName !== partyFilter) return false;
      if (statusFilter && e.status !== statusFilter) return false;
      if (q && !`${e.soNumber} ${e.partyName} ${e.phaseNo} ${e.skus.map((s) => s.skuName).join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allEvents, partyFilter, statusFilter, search]);

  const eventsByDate = useMemo(() => {
    const m = new Map();
    events.forEach((e) => { (m.get(e.dateKey) || m.set(e.dateKey, []).get(e.dateKey)).push(e); });
    // Sort each day's events by worst status first, then biggest qty.
    m.forEach((list) => list.sort((a, b) => (PRIORITY[b.status] - PRIORITY[a.status]) || (b.plannedQty - a.plannedQty)));
    return m;
  }, [events]);

  // The 6-week grid (42 cells) covering this month.
  const gridDays = useMemo(() => {
    const start = cursor.startOf('month').day(0); // back to Sunday
    return Array.from({ length: 42 }, (_, i) => start.add(i, 'day'));
  }, [cursor]);

  // This-month roll-up for the header.
  const monthStats = useMemo(() => {
    const inMonth = events.filter((e) => dayjs(e.date).isSame(cursor, 'month'));
    return {
      phases: inMonth.length,
      planned: inMonth.reduce((s, e) => s + e.plannedQty, 0),
      dispatched: inMonth.reduce((s, e) => s + e.actualQty, 0),
    };
  }, [events, cursor]);

  const today = dayjs();
  const dayEvents = openDay ? (eventsByDate.get(openDay) || []) : [];

  const goPlan = (e) => navigate(`/dispatch-planning?so=${encodeURIComponent(e.soNumber)}&phase=${encodeURIComponent(e.phaseNo)}`);

  return (
    <Box sx={{ p: { xs: 1, sm: 1.5 }, minHeight: '100vh' }}>
      {/* ── Header (clean, no background) ── */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5}
        sx={{ mb: 1.25, px: 0.5 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ width: 38, height: 38, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(BRAND, 0.1), color: BRAND, border: `1px solid ${alpha(BRAND, 0.2)}` }}>
            <CalendarDays size={20} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: { xs: '1.1rem', sm: '1.25rem' }, fontWeight: 800, lineHeight: 1.1, color: BRAND_DK }}>Dispatch Calendar</Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.76rem', display: { xs: 'none', sm: 'block' } }}>
              Every planned dispatch, day by day. Click a date to see what&apos;s planned.
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={2.5} sx={{ pr: 0.5 }}>
          {[
            { k: 'Phases', v: monthStats.phases },
            { k: 'Planned', v: num(monthStats.planned) },
            { k: 'Dispatched', v: num(monthStats.dispatched) },
          ].map((s) => (
            <Box key={s.k} sx={{ textAlign: 'right', display: { xs: s.k === 'Phases' ? 'block' : 'none', sm: 'block' } }}>
              <Typography sx={{ fontSize: '1rem', fontWeight: 800, lineHeight: 1, color: BRAND_DK }}>{s.v}</Typography>
              <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.secondary' }}>{s.k}</Typography>
            </Box>
          ))}
        </Stack>
      </Stack>

      <Paper sx={{ borderRadius: 2.5, overflow: 'hidden', border: `1.5px solid ${GRID}` }}>
        {/* ── Toolbar: month nav · filters · legend ── */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: { xs: 1.25, sm: 1.75 }, py: 0.85, flexWrap: 'wrap', rowGap: 0.75, borderBottom: `1px solid ${theme.palette.divider}` }}>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <IconButton size="small" onClick={() => setCursor((c) => c.subtract(1, 'month'))} sx={{ border: `1px solid ${theme.palette.divider}`, color: BRAND }}>
              <ChevronLeft size={17} />
            </IconButton>
            <Button
              onClick={openPicker}
              endIcon={<ChevronDown size={15} />}
              sx={{ fontWeight: 800, fontSize: '0.95rem', minWidth: 150, color: BRAND_DK, textTransform: 'none',
                '&:hover': { bgcolor: alpha(BRAND, 0.06) } }}
            >
              {cursor.format('MMMM YYYY')}
            </Button>
            <IconButton size="small" onClick={() => setCursor((c) => c.add(1, 'month'))} sx={{ border: `1px solid ${theme.palette.divider}`, color: BRAND }}>
              <ChevronRight size={17} />
            </IconButton>
            <Popover
              open={Boolean(pickerEl)} anchorEl={pickerEl} onClose={() => setPickerEl(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
              transformOrigin={{ vertical: 'top', horizontal: 'center' }}
              PaperProps={{ sx: { p: 1.5, borderRadius: 2.5, width: 260, border: `1.5px solid ${GRID}` } }}
            >
              {/* Year stepper */}
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <IconButton size="small" onClick={() => setPickerYear((y) => y - 1)} sx={{ color: BRAND }}><ChevronLeft size={18} /></IconButton>
                <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: BRAND_DK }}>{pickerYear}</Typography>
                <IconButton size="small" onClick={() => setPickerYear((y) => y + 1)} sx={{ color: BRAND }}><ChevronRight size={18} /></IconButton>
              </Stack>
              {/* Month grid */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.75 }}>
                {MONTHS.map((mLabel, i) => {
                  const isActive = cursor.year() === pickerYear && cursor.month() === i;
                  return (
                    <Button
                      key={mLabel} onClick={() => pickMonth(i)}
                      variant={isActive ? 'contained' : 'text'} size="small"
                      sx={{ minWidth: 0, py: 0.6, fontWeight: 700, textTransform: 'none',
                        color: isActive ? '#fff' : BRAND_DK,
                        bgcolor: isActive ? BRAND : 'transparent',
                        '&:hover': { bgcolor: isActive ? BRAND_DK : alpha(BRAND, 0.08) } }}
                    >
                      {mLabel}
                    </Button>
                  );
                })}
              </Box>
            </Popover>
            <Button size="small" variant="outlined" onClick={() => setCursor(dayjs().startOf('month'))} sx={{ ml: 0.5, fontWeight: 700, py: 0.25 }}>
              Today
            </Button>
          </Stack>

          <Box sx={{ flex: 1 }} />

          <TextField
            size="small" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order / SKU…"
            sx={{ width: { xs: '100%', sm: 200 }, '& .MuiInputBase-root': { height: 34 } }}
            InputProps={{ startAdornment: <Search size={14} style={{ marginRight: 6 }} /> }}
          />
          <TextField select size="small" value={partyFilter} onChange={(e) => setPartyFilter(e.target.value)}
            sx={{ width: 160, '& .MuiInputBase-root': { height: 34 } }}
            SelectProps={{ displayEmpty: true, renderValue: (v) => v || 'All clients' }}>
            <MenuItem value="">All clients</MenuItem>
            {parties.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
          </TextField>
          <TextField select size="small" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            sx={{ width: 140, '& .MuiInputBase-root': { height: 34 } }}
            SelectProps={{ displayEmpty: true, renderValue: (v) => (v ? statusMeta(v).label : 'All statuses') }}>
            <MenuItem value="">All statuses</MenuItem>
            {Object.keys(STATUS).map((s) => <MenuItem key={s} value={s}>{STATUS[s].label}</MenuItem>)}
          </TextField>
        </Stack>

        {/* Legend */}
        <Stack direction="row" spacing={1.75} sx={{ px: { xs: 1.25, sm: 1.75 }, py: 0.5, flexWrap: 'wrap', rowGap: 0.4, borderBottom: `1px solid ${theme.palette.divider}`, bgcolor: alpha(BRAND, 0.03) }}>
          {Object.entries(STATUS).map(([k, v]) => (
            <Stack key={k} direction="row" spacing={0.5} alignItems="center">
              <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: v.color }} />
              <Typography sx={{ fontSize: '0.64rem', fontWeight: 700, color: 'text.secondary' }}>{v.label}</Typography>
            </Stack>
          ))}
        </Stack>

        {isLoading ? (
          <Box sx={{ p: 2 }}><Skeleton variant="rounded" height={460} /></Box>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Box sx={{ minWidth: 700 }}>
              {/* Weekday header */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1.5px solid ${GRID}`, bgcolor: alpha(NAVY, 0.04) }}>
                {WEEKDAYS.map((w) => (
                  <Typography key={w} sx={{ py: 0.5, textAlign: 'center', fontWeight: 800, fontSize: '0.66rem', color: BRAND_DK, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {w}
                  </Typography>
                ))}
              </Box>

              {/* Day grid */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {gridDays.map((day) => {
                  const key = day.format('YYYY-MM-DD');
                  const list = eventsByDate.get(key) || [];
                  const inMonth = day.isSame(cursor, 'month');
                  const isToday = day.isSame(today, 'day');
                  const shown = list.slice(0, 2);
                  const more = list.length - shown.length;
                  return (
                    <Box
                      key={key}
                      onClick={() => list.length && setOpenDay(key)}
                      sx={{
                        height: { xs: 64, md: 80 }, p: 0.5, overflow: 'hidden',
                        borderRight: `1px solid ${GRID}`,
                        borderBottom: `1px solid ${GRID}`,
                        bgcolor: isToday ? alpha(BRAND, 0.05) : (inMonth ? 'background.paper' : alpha(NAVY, 0.025)),
                        cursor: list.length ? 'pointer' : 'default',
                        transition: 'background .15s',
                        '&:hover': list.length ? { bgcolor: alpha(BRAND, 0.07) } : {},
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.25 }}>
                        <Box sx={{
                          width: 19, height: 19, borderRadius: '50%', display: 'grid', placeItems: 'center',
                          fontSize: '0.68rem', fontWeight: 800,
                          bgcolor: isToday ? BRAND : 'transparent',
                          color: isToday ? '#fff' : (inMonth ? 'text.primary' : '#94a3b8'),
                        }}>
                          {day.date()}
                        </Box>
                        {list.length > 0 && (
                          <Chip size="small" label={list.length} sx={{ height: 15, fontSize: '0.56rem', fontWeight: 800, bgcolor: alpha(BRAND, 0.1), color: BRAND_DK, '& .MuiChip-label': { px: 0.55 } }} />
                        )}
                      </Stack>

                      <Stack spacing={0.3}>
                        {shown.map((e) => {
                          const m = statusMeta(e.status);
                          return (
                            <Tooltip key={e.id} title={`${e.soNumber} · ${e.phaseNo} · ${e.partyName} · ${num(e.plannedQty)} pcs · ${m.label}`} disableInteractive>
                              <Box sx={{
                                px: 0.5, py: '1px', borderRadius: 0.6, overflow: 'hidden',
                                bgcolor: alpha(m.color, 0.13), borderLeft: `3px solid ${m.color}`,
                                display: 'flex', alignItems: 'center', gap: 0.4,
                              }}>
                                <Typography noWrap sx={{ fontSize: '0.6rem', fontWeight: 700, color: m.color, flex: 1, minWidth: 0 }}>
                                  {e.partyName}
                                </Typography>
                                <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, color: m.color, flexShrink: 0 }}>
                                  {num(e.plannedQty)}
                                </Typography>
                              </Box>
                            </Tooltip>
                          );
                        })}
                        {more > 0 && (
                          <Typography sx={{ fontSize: '0.56rem', fontWeight: 800, color: BRAND, pl: 0.5, lineHeight: 1.3 }}>
                            +{more} more
                          </Typography>
                        )}
                      </Stack>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Box>
        )}
      </Paper>

      {/* ── Day detail dialog ── */}
      <Dialog open={Boolean(openDay)} onClose={() => setOpenDay(null)} fullWidth maxWidth="sm" fullScreen={isMobile}>
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Stack direction="row" spacing={1.25} alignItems="center">
              <Box sx={{ width: 38, height: 38, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(theme.palette.primary.main, 0.1), color: 'primary.main' }}>
                <CalendarDays size={20} />
              </Box>
              <Box>
                <Typography sx={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1.1 }}>
                  {openDay ? dayjs(openDay).format('dddd, DD MMMM YYYY') : ''}
                </Typography>
                <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', fontWeight: 600 }}>
                  {dayEvents.length} phase{dayEvents.length === 1 ? '' : 's'} planned ·{' '}
                  {num(dayEvents.reduce((s, e) => s + e.plannedQty, 0))} pcs
                </Typography>
              </Box>
            </Stack>
            <IconButton size="small" onClick={() => setOpenDay(null)}><X size={18} /></IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 1.5 }}>
          <Stack spacing={1.25}>
            {dayEvents.map((e) => {
              const m = statusMeta(e.status);
              return (
                <Paper key={e.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2, borderLeft: `4px solid ${m.color}` }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                        <Chip size="small" label={e.phaseNo} sx={{ height: 20, fontWeight: 800, bgcolor: alpha(m.color, 0.12), color: m.color }} />
                        <Typography sx={{ fontWeight: 800, fontSize: '0.9rem' }}>{e.soNumber}</Typography>
                        <Chip size="small" label={m.label} sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, bgcolor: alpha(m.color, 0.1), color: m.color }} />
                      </Stack>
                      <Stack direction="row" spacing={0.6} alignItems="center" sx={{ mt: 0.5, color: 'text.secondary' }}>
                        <Building2 size={13} />
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600 }}>{e.partyName}</Typography>
                      </Stack>
                    </Box>
                    <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: m.color }}>{num(e.plannedQty)}</Typography>
                      <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.secondary', letterSpacing: '0.05em' }}>PLANNED PCS</Typography>
                      {e.actualQty > 0 && (
                        <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: STATUS.DISPATCHED.color, mt: 0.25 }}>
                          {num(e.actualQty)} dispatched
                        </Typography>
                      )}
                    </Box>
                  </Stack>

                  <Divider sx={{ my: 1 }} />
                  <Stack spacing={0.5}>
                    {e.skus.map((s, i) => (
                      <Stack key={i} direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
                          <Package size={12} color={theme.palette.text.secondary} />
                          <Typography noWrap sx={{ fontSize: '0.74rem', fontWeight: 600 }}>{s.skuName}</Typography>
                        </Stack>
                        <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, flexShrink: 0 }}>
                          {num(s.plannedQty)}{s.actualQty > 0 ? ` / ${num(s.actualQty)}` : ''}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>

                  <Button size="small" endIcon={<ArrowRight size={14} />} onClick={() => goPlan(e)} sx={{ mt: 1, fontWeight: 700 }}>
                    Open in planning
                  </Button>
                </Paper>
              );
            })}
            {dayEvents.length === 0 && (
              <Stack alignItems="center" sx={{ py: 4, color: 'text.disabled' }}>
                <Truck size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
                <Typography sx={{ fontSize: '0.85rem' }}>Nothing planned this day.</Typography>
              </Stack>
            )}
          </Stack>
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default DispatchCalendar;
