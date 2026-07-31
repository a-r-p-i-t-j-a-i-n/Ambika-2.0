import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Paper, Typography, Stack, Button, IconButton, Chip, alpha, useTheme,
  TextField, MenuItem, Dialog, DialogTitle, DialogContent, Divider, Tooltip,
  useMediaQuery, Skeleton, Popover, Checkbox, ListItemText,
} from '@mui/material';
import {
  ChevronLeft, ChevronRight, ChevronDown, CalendarDays, Truck, Search, X, ArrowRight,
  Package, Building2, Download,
} from 'lucide-react';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useGetSchedulesQuery } from '../../store/api/dispatchControlApi';
import { printDispatchCalendar } from '../../utils/printDispatchCalendar';
import { O2D } from '../o2d-fms/o2dTheme';

dayjs.extend(isoWeek);

const num = (n) => Number(n || 0).toLocaleString('en-IN');

// Client names eat a lot of width in a calendar cell. Drop the legal suffixes
// (Pvt / Ltd / Limited / Technologies…) and, if it's still long, keep just the
// first word — "Elin Electronics Limited." → "Elin", "Epack Durable Ltd" → "Epack Durable".
const shortParty = (name) => {
  const raw = String(name || '—').trim();
  const cleaned = raw
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co|company|technologies|industries|enterprises|works)\b\.?/gi, '')
    .replace(/[.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(Boolean);
  if (!words.length) return raw;
  const two = words.slice(0, 2).join(' ');
  return two.length > 14 ? words[0] : two;
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Sidebar brand palette — keep the calendar visually in sync with the nav.
const NAVY = '#0b2545';
const BRAND = '#1d4ed8';
const BRAND_DK = '#1e3a8a';
const BRAND_GRADIENT = 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)';
// Richer, darker grid line than the default divider — gives the calendar weight.
const GRID = O2D.line; // warm hairline

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

const CONTENT_FILTERS = {
  all: 'All dispatches',
  scheduled: 'Scheduled only',
  actual: 'Actual only',
  delayed: 'Delayed only',
};

const EVENT_TYPE = {
  scheduled: { label: 'Scheduled', short: 'SCH', color: BRAND },
  actual: { label: 'Actual', short: 'ACT', color: STATUS.DISPATCHED.color },
};

const eventQty = (event) => (
  event.eventType === 'actual'
    ? Number(event.actualQty || 0)
    : Number(event.plannedQty || 0)
);

const eventMeta = (event) => {
  if (event.isDelayed) return { label: 'Delayed', short: EVENT_TYPE[event.eventType]?.short || 'SCH', color: STATUS.DELAYED.color };
  if (event.eventType === 'actual') return EVENT_TYPE.actual;
  return statusMeta(event.status);
};

const maxDate = (dates) => {
  const valid = dates.map((d) => dayjs(d)).filter((d) => d.isValid());
  if (!valid.length) return null;
  return valid.reduce((latest, d) => (d.isAfter(latest) ? d : latest), valid[0]);
};

const delayDaysFor = ({ plannedDate, actualDate, pendingQty, today }) => {
  const planned = dayjs(plannedDate);
  if (!planned.isValid()) return 0;
  const actual = actualDate ? dayjs(actualDate) : null;
  if (actual?.isValid() && actual.startOf('day').isAfter(planned.startOf('day'))) {
    return actual.startOf('day').diff(planned.startOf('day'), 'day');
  }
  if (Number(pendingQty || 0) > 0 && planned.startOf('day').isBefore(today)) {
    return today.diff(planned.startOf('day'), 'day');
  }
  return 0;
};

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
  const [partyFilter, setPartyFilter] = useState([]);
  const [contentFilter, setContentFilter] = useState('all');
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
    const todayStart = dayjs().startOf('day');
    schedules.forEach((s) => {
      (s.items || []).forEach((item) => {
        (item.phases || []).forEach((ph) => {
          if (!ph.plannedDate) return;
          // A CANCELLED phase is no longer a live plan — it's only kept in the data
          // for audit (a rescheduled/removed phase that already had a dispatch is
          // soft-cancelled, not deleted). Skip it so an edited plan doesn't show the
          // OLD date as a second "planned" entry next to the updated one.
          if (ph.status === 'CANCELLED') return;
          const plannedQty = Number(ph.plannedQty || 0);
          const actualQty = Number(ph.totalActualQty || 0);
          const pendingQty = Math.max(0, plannedQty - actualQty);
          const actualDispatches = (ph.actualDispatches || [])
            .map((a) => ({
              date: a.date || a.actualDate || a.dcDate || a.invoiceDate,
              qty: Number(a.qty || a.actualQty || a.quantityPcs || 0),
              invoiceNo: a.invoiceNo,
              invoiceDate: a.invoiceDate,
              invoiceDoc: a.invoiceDoc,
            }))
            .filter((a) => a.date && dayjs(a.date).isValid() && a.qty > 0);
          const lastActual = maxDate(actualDispatches.map((a) => a.date));
          const phaseDelayDays = delayDaysFor({
            plannedDate: ph.plannedDate,
            actualDate: lastActual,
            pendingQty,
            today: todayStart,
          });
          const dateKey = dayjs(ph.plannedDate).format('YYYY-MM-DD');
          const key = `${s.soNumber}__${ph.phaseNo}__${dateKey}`;
          const ev = map.get(key) || {
            id: key, dateKey, date: ph.plannedDate,
            soNumber: s.soNumber, poNumber: s.poNumber, partyName: s.partyName || '—',
            phaseNo: ph.phaseNo, plannedQty: 0, actualQty: 0, status: 'CANCELLED', skus: [],
          };
          ev.eventType = 'scheduled';
          ev.typeLabel = EVENT_TYPE.scheduled.label;
          ev.plannedDate = ph.plannedDate;
          ev.pendingQty = Number(ev.pendingQty || 0) + pendingQty;
          ev.delayDays = Math.max(Number(ev.delayDays || 0), phaseDelayDays);
          ev.isDelayed = Boolean(ev.isDelayed || ph.status === 'DELAYED' || phaseDelayDays > 0);
          ev.lastActualDate = lastActual?.isValid()
            ? (ev.lastActualDate && dayjs(ev.lastActualDate).isAfter(lastActual) ? ev.lastActualDate : lastActual.toISOString())
            : ev.lastActualDate;
          ev.plannedQty += plannedQty;
          ev.actualQty += actualQty;
          if ((PRIORITY[ph.status] || 0) > (PRIORITY[ev.status] || 0)) ev.status = ph.status;
          ev.skus.push({
            skuName: item.skuName, skuCode: item.skuCode,
            plannedQty, actualQty, pendingQty,
            status: ph.status, actualDispatches,
          });
          map.set(key, ev);
        });
      });
    });
    return [...map.values()];
  }, [schedules]);

  const actualEvents = useMemo(() => {
    const map = new Map();
    const todayStart = dayjs().startOf('day');

    schedules.forEach((s) => {
      (s.items || []).forEach((item) => {
        (item.phases || []).forEach((ph) => {
          const plannedQty = Number(ph.plannedQty || 0);
          const actualDispatches = (ph.actualDispatches || [])
            .map((a) => ({
              date: a.date || a.actualDate || a.dcDate || a.invoiceDate,
              qty: Number(a.qty || a.actualQty || a.quantityPcs || 0),
              invoiceNo: a.invoiceNo,
              invoiceDate: a.invoiceDate,
              invoiceDoc: a.invoiceDoc,
            }))
            .filter((a) => a.date && dayjs(a.date).isValid() && a.qty > 0);

          actualDispatches.forEach((actual) => {
            const actualDate = dayjs(actual.date);
            const dateKey = actualDate.format('YYYY-MM-DD');
            const key = `actual__${s.soNumber}__${ph.phaseNo}__${dateKey}`;
            const actualDelayDays = delayDaysFor({
              plannedDate: ph.plannedDate,
              actualDate: actual.date,
              pendingQty: 0,
              today: todayStart,
            });
            const ev = map.get(key) || {
              id: key,
              eventType: 'actual',
              typeLabel: EVENT_TYPE.actual.label,
              dateKey,
              date: actual.date,
              plannedDate: ph.plannedDate,
              soNumber: s.soNumber,
              poNumber: s.poNumber,
              partyName: s.partyName || '-',
              phaseNo: ph.phaseNo,
              plannedQty: 0,
              actualQty: 0,
              pendingQty: 0,
              status: ph.status || 'DISPATCHED',
              isDelayed: false,
              delayDays: 0,
              lastActualDate: actual.date,
              skus: [],
            };
            ev.plannedQty += plannedQty;
            ev.actualQty += actual.qty;
            ev.delayDays = Math.max(Number(ev.delayDays || 0), actualDelayDays);
            ev.isDelayed = Boolean(ev.isDelayed || ph.status === 'DELAYED' || actualDelayDays > 0);
            if ((PRIORITY[ph.status] || 0) > (PRIORITY[ev.status] || 0)) ev.status = ph.status;
            ev.skus.push({
              skuName: item.skuName,
              skuCode: item.skuCode,
              plannedQty,
              actualQty: actual.qty,
              pendingQty: 0,
              status: ph.status,
              actualDate: actual.date,
              invoiceNo: actual.invoiceNo,
              invoiceDoc: actual.invoiceDoc,
            });
            map.set(key, ev);
          });
        });
      });
    });

    return [...map.values()];
  }, [schedules]);

  const calendarEvents = useMemo(() => [...allEvents, ...actualEvents], [allEvents, actualEvents]);

  const parties = useMemo(
    () => [...new Set(allEvents.map((e) => e.partyName).filter((p) => p && p !== '—'))].sort(),
    [allEvents],
  );

  // Apply filters once, reused by the grid and the day dialog.
  const events = useMemo(() => {
    const q = search.trim().toLowerCase();
    return calendarEvents.filter((e) => {
      if (partyFilter.length && !partyFilter.includes(e.partyName)) return false;
      // The default / scheduled / delayed views are PLAN views — each phase shows
      // ONCE, on its PLANNED date (the scheduled card already carries its dispatched
      // qty + status). Actual-date cards appear only in the dedicated "Actual" view.
      // This is why a plan rescheduled AFTER it was dispatched (e.g. plan moved
      // 30 Jul → 27 Jul while the challan stays dated 30 Jul) now shows only on 27,
      // instead of doubling up on both dates.
      if (contentFilter === 'actual') {
        if (e.eventType !== 'actual') return false;
      } else {
        if (e.eventType === 'actual') return false;
        if (contentFilter === 'scheduled' && e.eventType !== 'scheduled') return false;
        if (contentFilter === 'delayed' && !e.isDelayed) return false;
      }
      if (statusFilter && e.status !== statusFilter) return false;
      if (q && !`${e.soNumber} ${e.poNumber || ''} ${e.partyName} ${e.phaseNo} ${e.typeLabel || ''} ${e.skus.map((s) => `${s.skuName} ${s.skuCode || ''} ${s.invoiceNo || ''}`).join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [calendarEvents, partyFilter, contentFilter, statusFilter, search]);

  const eventsByDate = useMemo(() => {
    const m = new Map();
    events.forEach((e) => { (m.get(e.dateKey) || m.set(e.dateKey, []).get(e.dateKey)).push(e); });
    // Sort each day's events by worst status first, then biggest qty.
    m.forEach((list) => list.sort((a, b) => (
      Number(b.isDelayed) - Number(a.isDelayed)
      || (PRIORITY[b.status] - PRIORITY[a.status])
      || (eventQty(b) - eventQty(a))
    )));
    return m;
  }, [events]);

  // Only the weeks that contain THIS month's days (5 or 6 rows) — no extra trailing
  // week of the next month. Cells that fall in the prev/next month are rendered
  // blank below, so the calendar shows only the selected month's dates.
  const gridDays = useMemo(() => {
    const startOfMonth = cursor.startOf('month');
    const start = startOfMonth.day(0); // back to the Sunday of the first week
    const weeks = Math.ceil((startOfMonth.day() + cursor.daysInMonth()) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => start.add(i, 'day'));
  }, [cursor]);

  // This-month roll-up for the header.
  const monthStats = useMemo(() => {
    const inMonth = events.filter((e) => dayjs(e.date).isSame(cursor, 'month'));
    const scheduled = inMonth.filter((e) => e.eventType !== 'actual');
    const actual = inMonth.filter((e) => e.eventType === 'actual');
    return {
      entries: inMonth.length,
      planned: scheduled.reduce((s, e) => s + e.plannedQty, 0),
      dispatched: actual.length
        ? actual.reduce((s, e) => s + e.actualQty, 0)
        : scheduled.reduce((s, e) => s + e.actualQty, 0),
      pending: scheduled.reduce((s, e) => s + Number(e.pendingQty || 0), 0),
      delayed: inMonth.filter((e) => e.isDelayed).length,
    };
  }, [events, cursor]);

  const today = dayjs();
  const dayEvents = openDay ? (eventsByDate.get(openDay) || []) : [];
  const dayScheduledQty = dayEvents
    .filter((e) => e.eventType !== 'actual')
    .reduce((sum, e) => sum + Number(e.plannedQty || 0), 0);
  const dayActualRows = dayEvents.filter((e) => e.eventType === 'actual');
  const dayActualQty = dayActualRows.length
    ? dayActualRows.reduce((sum, e) => sum + Number(e.actualQty || 0), 0)
    : dayEvents.reduce((sum, e) => sum + Number(e.actualQty || 0), 0);

  const goPlan = (e) => navigate(`/dispatch-planning?so=${encodeURIComponent(e.soNumber)}&phase=${encodeURIComponent(e.phaseNo)}`);
  const partyLabel = partyFilter.length === 0
    ? 'All parties'
    : partyFilter.length === 1 ? partyFilter[0] : `${partyFilter.length} parties`;
  const statusLabel = statusFilter ? statusMeta(statusFilter).label : 'All statuses';
  const hasActiveFilters = partyFilter.length > 0 || contentFilter !== 'all' || statusFilter || search.trim();
  const clearFilters = () => {
    setPartyFilter([]);
    setContentFilter('all');
    setStatusFilter('');
    setSearch('');
  };
  const handlePartyChange = (value) => {
    setPartyFilter(typeof value === 'string' ? value.split(',') : value);
  };
  const handleExportPdf = () => {
    const ok = printDispatchCalendar({
      month: cursor.toISOString(),
      events,
      filters: {
        contentLabel: CONTENT_FILTERS[contentFilter],
        partyLabel,
        statusLabel,
        search: search.trim(),
      },
    });
    return ok;
  };

  return (
    <Box sx={{ p: { xs: 1, sm: 1.5 }, minHeight: '100vh', bgcolor: O2D.canvas }}>
      {/* ── Header (clean, no background) ── */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5}
        sx={{ mb: 1.25, px: 0.5 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ width: 38, height: 38, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(BRAND, 0.1), color: BRAND, border: `1px solid ${alpha(BRAND, 0.2)}` }}>
            <CalendarDays size={20} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: { xs: '1.05rem', sm: '1.15rem' }, fontWeight: 800, lineHeight: 1.1, color: O2D.ink }}>Dispatch Calendar</Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.76rem', display: { xs: 'none', sm: 'block' } }}>
              Planned SKUs and quantities by date — 1 view, no clicks needed.
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={2.5} sx={{ pr: 0.5 }}>
          {[
            { k: 'Events', v: monthStats.entries, c: O2D.ink },
            { k: 'Planned pcs', v: num(monthStats.planned), c: '#1d4ed8' },
            { k: 'Actual pcs', v: num(monthStats.dispatched), c: '#15803d' },
            { k: 'Delayed', v: monthStats.delayed, c: monthStats.delayed > 0 ? '#dc2626' : O2D.faint },
          ].map((s) => (
            <Box key={s.k} sx={{ textAlign: 'right', display: { xs: s.k === 'Events' ? 'block' : 'none', sm: 'block' } }}>
              <Typography sx={{ fontSize: '1rem', fontWeight: 800, lineHeight: 1, color: s.c }}>{s.v}</Typography>
              <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.secondary' }}>{s.k}</Typography>
            </Box>
          ))}
        </Stack>
      </Stack>

      <Paper elevation={0} sx={{ borderRadius: '8px', overflow: 'hidden', border: `1px solid ${GRID}`, bgcolor: O2D.surface }}>
        {/* ── Toolbar: month nav · filters · legend ── */}
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ px: { xs: 1.25, sm: 1.5 }, py: 0.75, flexWrap: { xs: 'wrap', md: 'nowrap' }, rowGap: 0.75, borderBottom: `1px solid ${GRID}` }}>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <IconButton size="small" onClick={() => setCursor((c) => c.subtract(1, 'month'))} sx={{ border: `1px solid ${GRID}`, color: BRAND }}>
              <ChevronLeft size={17} />
            </IconButton>
            <Button
              onClick={openPicker}
              endIcon={<ChevronDown size={15} />}
              sx={{ fontWeight: 800, fontSize: '0.88rem', minWidth: 124, flexShrink: 0, color: BRAND_DK, textTransform: 'none',
                '&:hover': { bgcolor: alpha(BRAND, 0.06) } }}
            >
              {cursor.format('MMMM YYYY')}
            </Button>
            <IconButton size="small" onClick={() => setCursor((c) => c.add(1, 'month'))} sx={{ border: `1px solid ${GRID}`, color: BRAND }}>
              <ChevronRight size={17} />
            </IconButton>
            <Popover
              open={Boolean(pickerEl)} anchorEl={pickerEl} onClose={() => setPickerEl(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
              transformOrigin={{ vertical: 'top', horizontal: 'center' }}
              PaperProps={{ sx: { p: 1.5, borderRadius: '8px', width: 260, border: `1px solid ${GRID}` } }}
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
            sx={{ width: { xs: '100%', sm: 150 }, flexShrink: 1, minWidth: 110, '& .MuiInputBase-root': { height: 32, fontSize: '0.78rem' } }}
            InputProps={{ startAdornment: <Search size={14} style={{ marginRight: 6 }} /> }}
          />
          <TextField select size="small" value={contentFilter} onChange={(e) => setContentFilter(e.target.value)}
            sx={{ width: 128, flexShrink: 0, '& .MuiInputBase-root': { height: 32, fontSize: '0.78rem' } }}
            SelectProps={{ displayEmpty: true, renderValue: (v) => CONTENT_FILTERS[v] || CONTENT_FILTERS.all }}>
            {Object.entries(CONTENT_FILTERS).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
          </TextField>
          <TextField select size="small" value={partyFilter} onChange={(e) => handlePartyChange(e.target.value)}
            sx={{ width: 132, flexShrink: 0, '& .MuiInputBase-root': { height: 32, fontSize: '0.78rem' } }}
            SelectProps={{
              multiple: true,
              displayEmpty: true,
              renderValue: () => partyLabel,
            }}>
            {parties.map((p) => (
              <MenuItem key={p} value={p}>
                <Checkbox size="small" checked={partyFilter.includes(p)} sx={{ p: 0.5, mr: 0.5 }} />
                <ListItemText primary={p} primaryTypographyProps={{ noWrap: true, fontSize: '0.78rem' }} />
              </MenuItem>
            ))}
          </TextField>
          <TextField select size="small" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            sx={{ width: 118, flexShrink: 0, '& .MuiInputBase-root': { height: 32, fontSize: '0.78rem' } }}
            SelectProps={{ displayEmpty: true, renderValue: (v) => (v ? statusMeta(v).label : 'All statuses') }}>
            <MenuItem value="">All statuses</MenuItem>
            {Object.keys(STATUS).map((s) => <MenuItem key={s} value={s}>{STATUS[s].label}</MenuItem>)}
          </TextField>
          {hasActiveFilters && (
            <Button size="small" variant="text" startIcon={<X size={14} />} onClick={clearFilters} sx={{ height: 32, fontWeight: 700, textTransform: 'none', flexShrink: 0, minWidth: 0, px: 1 }}>
              Clear
            </Button>
          )}
          <Button size="small" variant="contained" startIcon={<Download size={15} />} onClick={handleExportPdf} sx={{ height: 32, fontWeight: 800, whiteSpace: 'nowrap', textTransform: 'none', flexShrink: 0, borderRadius: '6px', px: 1.5 }}>
            Export PDF
          </Button>
        </Stack>

        {/* Legend */}
        <Stack direction="row" spacing={1.75} sx={{ px: { xs: 1.25, sm: 1.75 }, py: 0.5, flexWrap: 'wrap', rowGap: 0.4, borderBottom: `1px solid ${GRID}`, bgcolor: O2D.surfaceAlt }}>
          {Object.entries(EVENT_TYPE).map(([k, v]) => (
            <Stack key={k} direction="row" spacing={0.5} alignItems="center">
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: v.color }} />
              <Typography sx={{ fontSize: '0.64rem', fontWeight: 800, color: 'text.secondary' }}>{v.label}</Typography>
            </Stack>
          ))}
          <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />
          {Object.entries(STATUS).map(([k, v]) => (
            <Stack key={k} direction="row" spacing={0.5} alignItems="center">
              <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: v.color }} />
              <Typography sx={{ fontSize: '0.64rem', fontWeight: 700, color: 'text.secondary' }}>{v.label}</Typography>
            </Stack>
          ))}
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: '0.64rem', color: O2D.faint, whiteSpace: 'nowrap' }}>
            Each event shows all SKUs and quantities
          </Typography>
        </Stack>

        {isLoading ? (
          <Box sx={{ p: 2 }}><Skeleton variant="rounded" height={460} /></Box>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Box sx={{ minWidth: 700 }}>
              {/* Weekday header */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${GRID}`, bgcolor: O2D.surfaceAlt }}>
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
                  const inMonth = day.isSame(cursor, 'month');
                  // Prev/next-month cells → blank (only the selected month is shown).
                  if (!inMonth) {
                    return (
                      <Box key={key} sx={{
                        minHeight: { xs: 72, md: 88 },
                        borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}`,
                        bgcolor: O2D.surfaceAlt,
                      }} />
                    );
                  }
                  const list = eventsByDate.get(key) || [];
                  const isToday = day.isSame(today, 'day');
                  const shown = list.slice(0, 2);
                  const more = list.length - shown.length;
                  return (
                    <Box
                      key={key}
                      onClick={() => list.length && setOpenDay(key)}
                      sx={{
                        // Rows grow to fit the item lines, but a day never shows more
                        // than 2 dispatches (the rest collapse to "+N more"), so the
                        // month still reads as a calendar instead of a long scroll.
                        minHeight: { xs: 72, md: 88 }, p: 0.5,
                        borderRight: `1px solid ${GRID}`,
                        borderBottom: `1px solid ${GRID}`,
                        bgcolor: isToday ? alpha(BRAND, 0.06) : (inMonth ? O2D.surface : O2D.surfaceAlt),
                        cursor: list.length ? 'pointer' : 'default',
                        transition: 'background .15s',
                        '&:hover': list.length ? { bgcolor: alpha(BRAND, 0.07) } : {},
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.4 }}>
                        <Box sx={{
                          width: 19, height: 19, borderRadius: '50%', display: 'grid', placeItems: 'center',
                          fontSize: '0.68rem', fontWeight: 800,
                          bgcolor: isToday ? BRAND : 'transparent',
                          color: isToday ? '#fff' : (inMonth ? 'text.primary' : '#94a3b8'),
                        }}>
                          {day.date()}
                        </Box>
                        {list.length > 1 && (
                          <Box sx={{
                            width: 15, height: 15, borderRadius: '50%', display: 'grid', placeItems: 'center',
                            fontSize: '0.54rem', fontWeight: 900, bgcolor: STATUS.IN_PROGRESS.color, color: '#fff',
                          }}>{list.length}</Box>
                        )}
                      </Stack>

                      {/* Client's layout: short party name · status · SO, then every SKU
                          with its quantity and the event total. Names are shortened so
                          the item lines have room. */}
                      <Stack spacing={0.4}>
                        {shown.map((e) => {
                          const m = eventMeta(e);
                          const isActual = e.eventType === 'actual';
                          const qty = eventQty(e);
                          const rows = (e.skus || []).filter((sk) => (isActual ? sk.actualQty : sk.plannedQty) > 0);
                          return (
                            <Tooltip key={e.id} title={`${e.partyName} · ${e.soNumber} · ${e.phaseNo} · ${num(qty)} pcs · ${e.typeLabel || m.label}`} disableInteractive>
                              <Box sx={{
                                borderLeft: `3px solid ${m.color}`, bgcolor: alpha(m.color, 0.07),
                                borderRadius: '3px', px: 0.5, py: 0.3,
                              }}>
                                <Stack direction="row" alignItems="center" spacing={0.5}>
                                  <Typography noWrap sx={{ fontSize: '0.6rem', fontWeight: 800, color: O2D.ink, flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                                    {shortParty(e.partyName)}
                                  </Typography>
                                  <Typography sx={{ fontSize: '0.46rem', fontWeight: 900, color: m.color, flexShrink: 0 }}>
                                    {(EVENT_TYPE[e.eventType]?.short || 'SCH')}
                                  </Typography>
                                  <Typography noWrap sx={{ fontSize: '0.46rem', fontWeight: 700, color: O2D.faint, flexShrink: 0 }}>
                                    {String(e.soNumber || '').replace(/^AGL\//, '').replace(/\/\d{2}-\d{2}$/, '')}
                                  </Typography>
                                </Stack>
                                {rows.map((sk, i) => (
                                  <Stack key={i} direction="row" alignItems="center" spacing={0.5}>
                                    <Typography noWrap sx={{ fontSize: '0.54rem', color: O2D.body, flex: 1, minWidth: 0, lineHeight: 1.35 }}>
                                      {sk.skuName}
                                    </Typography>
                                    <Typography sx={{ fontSize: '0.54rem', fontWeight: 800, color: O2D.ink, flexShrink: 0, fontVariantNumeric: 'tabular-nums', lineHeight: 1.35 }}>
                                      {num(isActual ? sk.actualQty : sk.plannedQty)}
                                    </Typography>
                                  </Stack>
                                ))}
                                <Stack direction="row" alignItems="center" spacing={0.5}
                                  sx={{ mt: 0.2, pt: 0.2, borderTop: `1px solid ${alpha(m.color, 0.22)}` }}>
                                  <Typography sx={{ fontSize: '0.44rem', fontWeight: 800, color: O2D.faint, textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1 }}>
                                    Total
                                  </Typography>
                                  <Typography sx={{ fontSize: '0.56rem', fontWeight: 900, color: m.color, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                                    {num(qty)} pcs
                                  </Typography>
                                </Stack>
                              </Box>
                            </Tooltip>
                          );
                        })}
                        {more > 0 && (
                          <Typography sx={{ fontSize: '0.54rem', fontWeight: 800, color: BRAND, pl: 0.5, lineHeight: 1.3 }}>
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
                  {dayEvents.length} entr{dayEvents.length === 1 ? 'y' : 'ies'} - Scheduled {num(dayScheduledQty)} pcs - Actual {num(dayActualQty)} pcs
                </Typography>
                <Typography sx={{ display: 'none' }}>
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
              const m = eventMeta(e);
              const qty = eventQty(e);
              const qtyLabel = e.eventType === 'actual' ? 'ACTUAL PCS' : 'SCHEDULED PCS';
              return (
                <Paper key={e.id} variant="outlined" sx={{ p: 1.5, borderRadius: '6px', borderColor: O2D.line, borderLeft: `4px solid ${m.color}` }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                        <Chip size="small" label={e.typeLabel || EVENT_TYPE[e.eventType]?.label || 'Scheduled'} sx={{ height: 20, fontSize: '0.6rem', fontWeight: 800, bgcolor: alpha(EVENT_TYPE[e.eventType]?.color || m.color, 0.12), color: EVENT_TYPE[e.eventType]?.color || m.color }} />
                        <Chip size="small" label={e.phaseNo} sx={{ height: 20, fontWeight: 800, bgcolor: alpha(m.color, 0.12), color: m.color }} />
                        <Typography sx={{ fontWeight: 800, fontSize: '0.9rem' }}>{e.soNumber}</Typography>
                        <Chip size="small" label={m.label} sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, bgcolor: alpha(m.color, 0.1), color: m.color }} />
                        {e.delayDays > 0 && <Chip size="small" label={`${e.delayDays}d late`} sx={{ height: 18, fontSize: '0.58rem', fontWeight: 800, bgcolor: alpha(STATUS.DELAYED.color, 0.1), color: STATUS.DELAYED.color }} />}
                      </Stack>
                      <Stack direction="row" spacing={0.6} alignItems="center" sx={{ mt: 0.5, color: 'text.secondary' }}>
                        <Building2 size={13} />
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600 }}>{e.partyName}</Typography>
                      </Stack>
                    </Box>
                    <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: m.color }}>{num(qty)}</Typography>
                      <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.secondary', letterSpacing: '0.05em' }}>{qtyLabel}</Typography>
                      {e.eventType !== 'actual' && e.actualQty > 0 && (
                        <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: STATUS.DISPATCHED.color, mt: 0.25 }}>
                          {num(e.actualQty)} dispatched
                        </Typography>
                      )}
                      {e.eventType !== 'actual' && Number(e.pendingQty || 0) > 0 && (
                        <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: e.isDelayed ? STATUS.DELAYED.color : '#b45309', mt: 0.25 }}>
                          {num(e.pendingQty)} pending
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
                          {e.eventType === 'actual'
                            ? `${num(s.actualQty)} actual${s.invoiceNo ? ` / ${s.invoiceNo}` : ''}`
                            : `${num(s.plannedQty)}${s.actualQty > 0 ? ` / ${num(s.actualQty)}` : ''}`}
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
                <Typography sx={{ fontSize: '0.85rem' }}>No dispatch entries this day.</Typography>
              </Stack>
            )}
          </Stack>
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default DispatchCalendar;
