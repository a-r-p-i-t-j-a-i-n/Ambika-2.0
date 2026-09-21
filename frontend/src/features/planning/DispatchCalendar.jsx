import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Paper, Typography, Stack, Button, IconButton, Chip, alpha, useTheme,
  TextField, MenuItem, Dialog, DialogTitle, DialogContent, Divider, Tooltip,
  useMediaQuery, Skeleton, Popover, Checkbox, ListItemText,
  ToggleButton, ToggleButtonGroup, CircularProgress, Menu, ListItemIcon,
} from '@mui/material';
import {
  ChevronLeft, ChevronRight, ChevronDown, CalendarDays, Truck, Search, X, ArrowRight,
  Package, Building2, Download, FileDown, Eye, LayoutGrid, List as ListIcon, ChevronRight as MoreIcon,
} from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import { useGetSchedulesQuery } from '../../store/api/dispatchControlApi';
import {
  printDispatchCalendar, printDispatchList,
  downloadDispatchCalendarPdf, downloadDispatchListPdf,
} from '../../utils/printDispatchCalendar';
import { groupDayByParty } from '../../utils/dispatchCalendarGrouping';
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
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar' | 'list'
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
            // A cancelled dispatch must not appear as an Actual anywhere — the
            // row is kept on the plan for history, but its qty was reversed.
            .filter((a) => !a.cancelled)
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
            // A cancelled dispatch must not appear as an Actual anywhere — the
            // row is kept on the plan for history, but its qty was reversed.
            .filter((a) => !a.cancelled)
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

  // Merge each day by PARTY (same party = one card, regardless of SO/PO) and merge
  // identical items inside it — this is what the calendar cells, the day dialog and
  // the list view all render, so the client sees one clean "who + what + how much"
  // per party per day.
  const groupedByDate = useMemo(() => {
    const m = new Map();
    eventsByDate.forEach((list, dateKey) => m.set(dateKey, groupDayByParty(list)));
    return m;
  }, [eventsByDate]);

  // Flat, date-sorted list of this month's party-groups — powers the List view.
  const monthGroups = useMemo(() => {
    const out = [];
    [...groupedByDate.entries()]
      .filter(([dateKey]) => dayjs(dateKey).isSame(cursor, 'month'))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([dateKey, groups]) => out.push({ dateKey, groups }));
    return out;
  }, [groupedByDate, cursor]);

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
  const dayGroups = openDay ? (groupedByDate.get(openDay) || []) : [];
  const dayScheduledQty = dayEvents
    .filter((e) => e.eventType !== 'actual')
    .reduce((sum, e) => sum + Number(e.plannedQty || 0), 0);
  const dayActualRows = dayEvents.filter((e) => e.eventType === 'actual');
  const dayActualQty = dayActualRows.length
    ? dayActualRows.reduce((sum, e) => sum + Number(e.actualQty || 0), 0)
    : dayEvents.reduce((sum, e) => sum + Number(e.actualQty || 0), 0);

  const goPlan = (e) => navigate(`/dispatch-planning?so=${encodeURIComponent(e.soNumber)}&phase=${encodeURIComponent(e.phaseNo)}`);
  const goPlanSo = (so) => navigate(`/dispatch-planning?so=${encodeURIComponent(so)}`);
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
  // Export follows the active view: the Calendar tab uses the month grid,
  // the List tab uses the same data as a date-wise list.
  const exportPayload = () => ({
    month: cursor.toISOString(),
    events,
    filters: {
      contentLabel: CONTENT_FILTERS[contentFilter],
      partyLabel,
      statusLabel,
      search: search.trim(),
    },
  });
  // Export offers two routes off one button: preview in a tab, or save the file.
  const [exportAnchor, setExportAnchor] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const handleExportPdf = () => {
    const print = viewMode === 'list' ? printDispatchList : printDispatchCalendar;
    return print(exportPayload());
  };
  // Straight to a .pdf file — no print dialog. Rasterising a long month takes a
  // moment, so the button shows a spinner while it runs.
  const handleDownloadPdf = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const download = viewMode === 'list' ? downloadDispatchListPdf : downloadDispatchCalendarPdf;
      const ok = await download(exportPayload());
      if (ok) enqueueSnackbar('PDF downloaded.', { variant: 'success' });
    } finally {
      setDownloading(false);
    }
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

          {/* Calendar ⇄ List view toggle — same data + filters, two ways to read it. */}
          <ToggleButtonGroup size="small" exclusive value={viewMode} onChange={(_, v) => v && setViewMode(v)}
            sx={{ ml: 0.5, '& .MuiToggleButton-root': { px: 1, py: 0.4, textTransform: 'none', fontWeight: 700, fontSize: '0.74rem', color: O2D.body, borderColor: GRID, '&.Mui-selected': { bgcolor: alpha(BRAND, 0.12), color: BRAND_DK, '&:hover': { bgcolor: alpha(BRAND, 0.18) } } } }}>
            <ToggleButton value="calendar"><LayoutGrid size={14} style={{ marginRight: 5 }} />Calendar</ToggleButton>
            <ToggleButton value="list"><ListIcon size={14} style={{ marginRight: 5 }} />List</ToggleButton>
          </ToggleButtonGroup>

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
          {/* One export entry point — asks download or preview. */}
          <Button size="small" variant="contained" disabled={downloading}
            startIcon={downloading ? <CircularProgress size={13} color="inherit" /> : <Download size={15} />}
            endIcon={<ChevronDown size={13} />}
            onClick={(e) => setExportAnchor(e.currentTarget)}
            sx={{ height: 32, fontWeight: 800, whiteSpace: 'nowrap', textTransform: 'none', flexShrink: 0, borderRadius: '6px', px: 1.5 }}>
            {downloading ? 'Preparing…' : 'Export PDF'}
          </Button>
          <Menu
            anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { mt: 0.5, minWidth: 268, borderRadius: '8px', border: `1px solid ${GRID}` } } }}>
            <Typography sx={{ px: 1.75, pt: 1, pb: 0.75, fontSize: '0.6rem', fontWeight: 800, color: O2D.faint, letterSpacing: '0.08em' }}>
              {viewMode === 'list' ? 'LIST VIEW' : 'CALENDAR VIEW'} · {monthStats.entries} EVENT{monthStats.entries === 1 ? '' : 'S'}
            </Typography>
            <MenuItem onClick={() => { setExportAnchor(null); handleDownloadPdf(); }} sx={{ py: 0.9 }}>
              <ListItemIcon sx={{ minWidth: 30, color: BRAND }}><FileDown size={16} /></ListItemIcon>
              <ListItemText
                primary="Download PDF"
                secondary="Saves the file straight to your Downloads"
                primaryTypographyProps={{ fontSize: '0.82rem', fontWeight: 800, color: NAVY }}
                secondaryTypographyProps={{ fontSize: '0.66rem', color: O2D.sub }} />
            </MenuItem>
            <MenuItem onClick={() => { setExportAnchor(null); handleExportPdf(); }} sx={{ py: 0.9 }}>
              <ListItemIcon sx={{ minWidth: 30, color: BRAND }}><Eye size={16} /></ListItemIcon>
              <ListItemText
                primary="Preview"
                secondary="Opens a tab — print or save from there"
                primaryTypographyProps={{ fontSize: '0.82rem', fontWeight: 800, color: NAVY }}
                secondaryTypographyProps={{ fontSize: '0.66rem', color: O2D.sub }} />
            </MenuItem>
            {hasActiveFilters && (
              <Typography sx={{ px: 1.75, pt: 0.5, pb: 1, fontSize: '0.64rem', color: O2D.sub, maxWidth: 268 }}>
                Filters applied: <b style={{ color: BRAND_DK }}>{[CONTENT_FILTERS[contentFilter], partyLabel, statusLabel, search.trim() && `“${search.trim()}”`].filter(Boolean).join(' · ')}</b>
              </Typography>
            )}
          </Menu>
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
            One card = one party's day · orders &amp; items merged
          </Typography>
        </Stack>

        {isLoading ? (
          <Box sx={{ p: 2 }}><Skeleton variant="rounded" height={460} /></Box>
        ) : viewMode === 'list' ? (
          /* ── List view — same filters, read top-to-bottom by date ── */
          <Box sx={{ p: { xs: 1, sm: 1.5 } }}>
            {monthGroups.length === 0 ? (
              <Stack alignItems="center" sx={{ py: 6, color: 'text.disabled' }}>
                <Truck size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
                <Typography sx={{ fontSize: '0.85rem' }}>No dispatches match the current filters this month.</Typography>
              </Stack>
            ) : monthGroups.map(({ dateKey, groups }) => {
              const d = dayjs(dateKey);
              const isTodayRow = d.isSame(today, 'day');
              const dayTotal = groups.reduce((s, g) => s + g.totalQty, 0);
              return (
                <Stack key={dateKey} direction="row" spacing={1.25} sx={{ mb: 2 }}>
                  {/* Date rail sits OUTSIDE the card: big day numeral with the short
                      month stacked under it, so the month reads without the full date. */}
                  <Box sx={{ width: 52, flexShrink: 0, textAlign: 'right', pt: 1.25 }}>
                    <Typography sx={{
                      fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.05,
                      color: isTodayRow ? BRAND : NAVY, fontVariantNumeric: 'tabular-nums',
                    }}>
                      {d.format('DD')}
                    </Typography>
                    {/* Month matches the day numeral's size so the rail reads as one unit. */}
                    <Typography sx={{
                      fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.01em', lineHeight: 1.15,
                      color: isTodayRow ? BRAND : BRAND_DK,
                    }}>
                      {d.format('MMM').toUpperCase()}
                    </Typography>
                  </Box>

                  <Paper variant="outlined" sx={{ flex: 1, minWidth: 0, borderRadius: '10px', borderColor: O2D.line, overflow: 'hidden' }}>
                    {/* Status ribbon — one segment per party, so a day's mix of
                        planned / in-progress / dispatched reads before any text. */}
                    <Stack direction="row" sx={{ height: 3 }}>
                      {groups.map((g) => <Box key={g.id} sx={{ flex: 1, bgcolor: eventMeta(g).color }} />)}
                    </Stack>

                    {/* Day header — weekday small, full date bold and larger beneath it. */}
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, pt: 1.25, pb: 1 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: NAVY, lineHeight: 1.15 }}>{d.format('dddd')}</Typography>
                        {/* Full date stays as the reference line, but smaller now that
                            the rail carries the day + month. */}
                        <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: BRAND_DK, letterSpacing: '0.04em', lineHeight: 1.3 }}>
                          {d.format('DD MMM YYYY').toUpperCase()}
                        </Typography>
                      </Box>
                      <Box sx={{ flex: 1 }} />
                      <Stack direction="row" alignItems="center" spacing={1.25}
                        sx={{ px: 1.5, py: 0.6, borderRadius: '999px', border: `1px solid ${GRID}`, bgcolor: O2D.surface, flexShrink: 0 }}>
                        <Box sx={{ textAlign: 'right' }}>
                          <Typography sx={{ fontSize: '0.52rem', fontWeight: 800, color: O2D.faint, letterSpacing: '0.09em', lineHeight: 1.2 }}>DAY TOTAL</Typography>
                          <Typography sx={{ fontSize: '0.88rem', fontWeight: 800, color: NAVY, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>{num(dayTotal)} pcs</Typography>
                        </Box>
                        <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: GRID }} />
                        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: O2D.sub, whiteSpace: 'nowrap' }}>
                          {groups.length} part{groups.length === 1 ? 'y' : 'ies'}
                        </Typography>
                      </Stack>
                    </Stack>

                    {/* One band per party — party block · SKU tiles · total panel. */}
                    <Stack spacing={1} sx={{ px: 1.5, pb: 1.5 }}>
                      {groups.map((g) => {
                        const m = eventMeta(g);
                        const isActual = g.eventType === 'actual';
                        const rows = (g.skus || []).filter((sk) => (isActual ? sk.actualQty : sk.plannedQty) > 0);
                        return (
                          <Stack key={g.id} direction={{ xs: 'column', md: 'row' }} onClick={() => setOpenDay(dateKey)}
                            sx={{
                              borderRadius: '8px', overflow: 'hidden', cursor: 'pointer',
                              border: `1px solid ${alpha(m.color, 0.22)}`,
                              transition: 'box-shadow .15s',
                              '&:hover': { boxShadow: `0 2px 10px ${alpha(m.color, 0.18)}` },
                            }}>
                            {/* Party block */}
                            <Box sx={{
                              width: { md: 168 }, flexShrink: 0, p: 1.25,
                              bgcolor: alpha(m.color, 0.07), borderLeft: `4px solid ${m.color}`,
                            }}>
                              <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: NAVY, lineHeight: 1.2 }}>{g.partyName}</Typography>
                              <Typography sx={{ fontSize: '0.6rem', color: O2D.sub, mb: 0.85 }}>
                                {g.orderCount} order{g.orderCount > 1 ? 's' : ''} · {isActual ? 'Actual' : 'Scheduled'}
                              </Typography>
                              <Chip size="small" label={`${isActual ? '✓' : '●'} ${m.label}`}
                                sx={{ height: 21, width: '100%', borderRadius: '4px', fontSize: '0.62rem', fontWeight: 800, bgcolor: m.color, color: '#fff', '& .MuiChip-label': { px: 0.75 } }} />
                            </Box>

                            {/* SKU tiles — the number is the hero, name above, unit below. */}
                            <Stack direction="row" spacing={1} sx={{ flex: 1, minWidth: 0, p: 1.25, flexWrap: 'wrap', rowGap: 1 }}>
                              {rows.map((sk, i) => (
                                <Box key={i} sx={{
                                  minWidth: 92, px: 1.25, py: 0.85, borderRadius: '8px',
                                  bgcolor: alpha(m.color, 0.07), border: `1px solid ${alpha(m.color, 0.2)}`,
                                }}>
                                  <Typography noWrap sx={{ fontSize: '0.62rem', fontWeight: 700, color: O2D.body, mb: 0.35, maxWidth: 130 }}>{sk.skuName}</Typography>
                                  <Typography sx={{ fontSize: '1.2rem', fontWeight: 800, color: m.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                                    {num(isActual ? sk.actualQty : sk.plannedQty)}
                                  </Typography>
                                  <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: O2D.faint, mt: 0.15 }}>pcs</Typography>
                                </Box>
                              ))}
                            </Stack>

                            {/* Party total panel */}
                            <Box sx={{
                              width: { md: 132 }, flexShrink: 0, p: 1.25, bgcolor: alpha(m.color, 0.07),
                              display: 'flex', flexDirection: 'column', justifyContent: 'center',
                              alignItems: { xs: 'flex-start', md: 'flex-end' },
                            }}>
                              <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, color: m.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                                {num(g.totalQty)}
                              </Typography>
                              <Typography sx={{ fontSize: '0.55rem', fontWeight: 800, color: O2D.faint, letterSpacing: '0.09em', mt: 0.25 }}>TOTAL PCS</Typography>
                              {g.delayDays > 0 && (
                                <Chip size="small" label={`${g.delayDays}d late`}
                                  sx={{ mt: 0.6, height: 18, fontSize: '0.56rem', fontWeight: 800, bgcolor: alpha(STATUS.DELAYED.color, 0.12), color: STATUS.DELAYED.color }} />
                              )}
                            </Box>
                          </Stack>
                        );
                      })}
                    </Stack>
                  </Paper>
                </Stack>
              );
            })}
          </Box>
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
                  const groups = groupedByDate.get(key) || [];
                  const isToday = day.isSame(today, 'day');
                  const shown = groups.slice(0, 2);
                  const more = groups.length - shown.length;
                  return (
                    <Box
                      key={key}
                      onClick={() => groups.length && setOpenDay(key)}
                      sx={{
                        // Rows grow to fit the item lines, but a day never shows more
                        // than 2 dispatches (the rest collapse to "+N more"), so the
                        // month still reads as a calendar instead of a long scroll.
                        minHeight: { xs: 72, md: 88 }, p: 0.5,
                        borderRight: `1px solid ${GRID}`,
                        borderBottom: `1px solid ${GRID}`,
                        bgcolor: isToday ? alpha(BRAND, 0.06) : (inMonth ? O2D.surface : O2D.surfaceAlt),
                        cursor: groups.length ? 'pointer' : 'default',
                        transition: 'background .15s',
                        '&:hover': groups.length ? { bgcolor: alpha(BRAND, 0.07) } : {},
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
                        {groups.length > 1 && (
                          <Box sx={{
                            width: 15, height: 15, borderRadius: '50%', display: 'grid', placeItems: 'center',
                            fontSize: '0.54rem', fontWeight: 900, bgcolor: STATUS.IN_PROGRESS.color, color: '#fff',
                          }}>{groups.length}</Box>
                        )}
                      </Stack>

                      {/* One card PER PARTY (orders merged), with each item merged into a
                          single line and a party total. No SO number — the client reads
                          this day-wise as "who + what + how much". */}
                      <Stack spacing={0.4}>
                        {shown.map((g) => {
                          const m = eventMeta(g);
                          const isActual = g.eventType === 'actual';
                          const rows = (g.skus || []).filter((sk) => (isActual ? sk.actualQty : sk.plannedQty) > 0);
                          return (
                            <Tooltip key={g.id} title={`${g.partyName} · ${g.orderCount} order${g.orderCount > 1 ? 's' : ''} · ${num(g.totalQty)} pcs · ${isActual ? 'Actual' : 'Scheduled'}`} disableInteractive>
                              <Box sx={{
                                borderLeft: `3px solid ${m.color}`, bgcolor: alpha(m.color, 0.07),
                                borderRadius: '3px', px: 0.5, py: 0.3,
                              }}>
                                <Stack direction="row" alignItems="center" spacing={0.5}>
                                  <Typography noWrap sx={{ fontSize: '0.6rem', fontWeight: 800, color: O2D.ink, flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                                    {shortParty(g.partyName)}
                                  </Typography>
                                  <Typography sx={{ fontSize: '0.46rem', fontWeight: 900, color: m.color, flexShrink: 0 }}>
                                    {isActual ? 'ACT' : 'SCH'}
                                  </Typography>
                                  {g.orderCount > 1 && (
                                    <Typography sx={{ fontSize: '0.46rem', fontWeight: 800, color: O2D.faint, flexShrink: 0 }}>
                                      ×{g.orderCount}
                                    </Typography>
                                  )}
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
                                    {num(g.totalQty)} pcs
                                  </Typography>
                                </Stack>
                              </Box>
                            </Tooltip>
                          );
                        })}
                        {more > 0 && (
                          <Box onClick={(ev) => { ev.stopPropagation(); setOpenDay(key); }}
                            sx={{ mt: 0.1, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 0.25,
                              px: 0.6, py: 0.15, borderRadius: '4px', cursor: 'pointer',
                              bgcolor: alpha(BRAND, 0.1), color: BRAND, '&:hover': { bgcolor: alpha(BRAND, 0.2) } }}>
                            <Typography sx={{ fontSize: '0.54rem', fontWeight: 800, lineHeight: 1.3 }}>
                              +{more} more {more === 1 ? 'party' : 'parties'}
                            </Typography>
                            <MoreIcon size={9} />
                          </Box>
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
            {dayGroups.map((g) => {
              const m = eventMeta(g);
              const isActual = g.eventType === 'actual';
              const qtyLabel = isActual ? 'ACTUAL PCS' : 'SCHEDULED PCS';
              return (
                <Paper key={g.id} variant="outlined" sx={{ p: 1.5, borderRadius: '6px', borderColor: O2D.line, borderLeft: `4px solid ${m.color}` }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                    <Box sx={{ minWidth: 0 }}>
                      {/* Party first — this whole card IS the party's day. */}
                      <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
                        <Building2 size={15} color={m.color} />
                        <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, color: O2D.ink }}>{g.partyName}</Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5, mt: 0.6 }}>
                        <Chip size="small" label={isActual ? 'Actual' : 'Scheduled'} sx={{ height: 20, fontSize: '0.6rem', fontWeight: 800, bgcolor: alpha(EVENT_TYPE[g.eventType]?.color || m.color, 0.12), color: EVENT_TYPE[g.eventType]?.color || m.color }} />
                        <Chip size="small" label={m.label} sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, bgcolor: alpha(m.color, 0.1), color: m.color }} />
                        <Chip size="small" label={`${g.orderCount} order${g.orderCount > 1 ? 's' : ''}`} sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, bgcolor: alpha(O2D.brand, 0.08), color: O2D.brand }} />
                        {g.delayDays > 0 && <Chip size="small" label={`${g.delayDays}d late`} sx={{ height: 18, fontSize: '0.58rem', fontWeight: 800, bgcolor: alpha(STATUS.DELAYED.color, 0.1), color: STATUS.DELAYED.color }} />}
                      </Stack>
                    </Box>
                    <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', color: m.color }}>{num(g.totalQty)}</Typography>
                      <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: 'text.secondary', letterSpacing: '0.05em' }}>{qtyLabel}</Typography>
                      {!isActual && g.actualQty > 0 && (
                        <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: STATUS.DISPATCHED.color, mt: 0.25 }}>
                          {num(g.actualQty)} dispatched
                        </Typography>
                      )}
                      {!isActual && Number(g.pendingQty || 0) > 0 && (
                        <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: g.isDelayed ? STATUS.DELAYED.color : '#b45309', mt: 0.25 }}>
                          {num(g.pendingQty)} pending
                        </Typography>
                      )}
                    </Box>
                  </Stack>

                  <Divider sx={{ my: 1 }} />
                  {/* Merged items — one line per item, quantities combined across the
                      party's orders for this day. */}
                  <Stack spacing={0.5}>
                    {g.skus.map((s, i) => (
                      <Stack key={i} direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
                          <Package size={12} color={theme.palette.text.secondary} />
                          <Typography noWrap sx={{ fontSize: '0.74rem', fontWeight: 600 }}>{s.skuName}</Typography>
                        </Stack>
                        <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                          {isActual
                            ? `${num(s.actualQty)} actual`
                            : `${num(s.plannedQty)}${s.actualQty > 0 ? ` / ${num(s.actualQty)} done` : ''}`}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>

                  {/* Drill into the plan — one chip per order that fed this party's day. */}
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 1.25, flexWrap: 'wrap', rowGap: 0.5 }}>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: O2D.faint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Open plan:</Typography>
                    {g.soNumbers.map((so) => (
                      <Chip key={so} size="small" clickable onClick={() => goPlanSo(so)}
                        icon={<ArrowRight size={12} />} label={so}
                        sx={{ height: 22, fontSize: '0.66rem', fontWeight: 700, bgcolor: alpha(O2D.brand, 0.08), color: O2D.brand, '& .MuiChip-icon': { color: O2D.brand } }} />
                    ))}
                  </Stack>
                </Paper>
              );
            })}
            {dayGroups.length === 0 && (
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
