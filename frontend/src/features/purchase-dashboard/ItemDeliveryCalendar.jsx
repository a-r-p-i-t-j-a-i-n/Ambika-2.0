/**
 * Item Delivery Calendar — one event per released PO line: Scheduled (still to
 * receive, on the PO's expected delivery date; blue) or Delivered (fully
 * received, on its GRN date; green). Status filter beside the title; the
 * month name opens a month / year picker. The expanded view puts Status, Item,
 * Vendor, Calendar | List and Export PDF (download or preview) in one line.
 * Every filter updates the events, each day's count, the list and the export.
 * A day click narrows the page to the indents behind that day's events and
 * opens the day's list.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, ButtonBase, Chip, CircularProgress, Dialog, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Popover, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Download, Eye, FileDown, List, X } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import dayjs from 'dayjs';
import { Paper } from '@mui/material';
import { CalendarLegend, CalendarMonthGrid } from '../planning/CalendarGrid';
import { monthGridDays } from '../planning/calendarGridUtils';
import { groupDayByParty } from '../../utils/dispatchCalendarGrouping';
import { clock, startOfDay } from '../o2d-dashboard/dashboardModel';
import { CHIP_TONE, T } from '../o2d-dashboard/dashTheme';
import { fmtDate, fmtNum } from '../o2d-dashboard/format';
import { DashCard, MiniSelect } from '../o2d-dashboard/components/DashUi';
import { O2D } from '../o2d-fms/o2dTheme';
import {
  DELIVERY_STATUS_OPTIONS, deliveryItemOptions, deliveryVendorOptions, EMPTY_DELIVERY_FILTER, filterDeliveryEvents, monthEventsByDay,
} from './purchaseDashboardModel';
import { DELIVERED_COLOR, downloadDeliveryPdf, fileNameOf, previewDeliveryPdf, toCalendarEvents } from './deliveryCalendarPdf';
import { ItemDayDrawer } from './PurchaseDrawers';

const TONE = { SCHEDULED: CHIP_TONE.info, DELIVERED: CHIP_TONE.ok };
const monthName = ({ year, month }) => new Date(year, month, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const shift = ({ year, month }, by) => { const d = new Date(year, month + by, 1); return { year: d.getFullYear(), month: d.getMonth() }; };

const navBtnSx = {
  width: 26, height: 26, borderRadius: '6px', border: `1px solid ${T.borderSoft}`, bgcolor: '#fff', color: '#334155',
  '&:hover': { bgcolor: '#f3f6fb' },
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** ‹ Month YYYY ▾ › — the month name opens a picker: a ‹ year › row and Jan–Dec. */
const MonthNav = ({ value, onChange, compact = false }) => {
  const [anchor, setAnchor] = useState(null);
  const [year, setYear] = useState(value.year);
  const now = new Date();
  return (
    <Box data-testid={compact ? 'idc-row-month' : undefined} sx={{ display: 'flex', alignItems: 'center', gap: compact ? 0.25 : 0.75, flexShrink: 0, whiteSpace: 'nowrap' }}>
      <ButtonBase sx={navBtnSx} aria-label="Previous month" onClick={() => onChange(shift(value, -1))}><ChevronLeft size={13} /></ButtonBase>
      <ButtonBase
        data-testid="idc-month"
        aria-label="Pick month"
        aria-haspopup="dialog"
        onClick={(e) => { setYear(value.year); setAnchor(e.currentTarget); }}
        sx={{ fontSize: 13, fontWeight: 700, color: T.heading, minWidth: compact ? 0 : 116, px: compact ? 0.25 : 0.75, height: 26, borderRadius: '6px', gap: 0.5, whiteSpace: 'nowrap', '&:hover': { bgcolor: '#f3f6fb' } }}
      >
        {monthName(value)} <Box component="span" aria-hidden sx={{ fontSize: 10, color: T.text2 }}>▾</Box>
      </ButtonBase>
      <ButtonBase sx={navBtnSx} aria-label="Next month" onClick={() => onChange(shift(value, 1))}><ChevronRight size={13} /></ButtonBase>
      <Popover
        open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{ paper: { 'data-testid': 'idc-month-picker', sx: { p: 1.25, mt: 0.5, borderRadius: '10px', border: `1px solid ${T.border}`, width: 228 } } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <ButtonBase sx={navBtnSx} aria-label="Previous year" onClick={() => setYear((y) => y - 1)}><ChevronLeft size={13} /></ButtonBase>
          <Typography data-testid="idc-picker-year" sx={{ fontSize: 14, fontWeight: 800, color: T.heading }}>{year}</Typography>
          <ButtonBase sx={navBtnSx} aria-label="Next year" onClick={() => setYear((y) => y + 1)}><ChevronRight size={13} /></ButtonBase>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5 }}>
          {MONTHS.map((m, i) => {
            const shown = year === value.year && i === value.month;
            const isNow = year === now.getFullYear() && i === now.getMonth();
            return (
              <ButtonBase
                key={m}
                data-month={i}
                aria-current={shown ? 'date' : undefined}
                onClick={() => { onChange({ year, month: i }); setAnchor(null); }}
                sx={{
                  height: 32, borderRadius: '7px', fontSize: 12.5, fontWeight: shown ? 800 : 600,
                  color: shown ? '#fff' : T.text, bgcolor: shown ? T.brand : 'transparent',
                  border: `1px solid ${isNow && !shown ? T.brand : 'transparent'}`,
                  '&:hover': { bgcolor: shown ? T.brand : T.surface2 },
                }}
              >
                {m}
              </ButtonBase>
            );
          })}
        </Box>
      </Popover>
    </Box>
  );
};

/**
 * List view — the Dispatch Calendar's list layout on Purchase lines: one
 * section per day (day + month rail · card with weekday / date and DAY TOTAL ·
 * parties), one band per vendor and status (vendor · N PO lines · status chip |
 * one tile per PO line | TOTAL QTY, "Past due" for a scheduled line before
 * today). Same filtered events as the calendar.
 */
// The Dispatch Calendar list's own colours (planning/DispatchCalendar.jsx).
const NAVY = '#0b2545';
const BRAND = '#1d4ed8';
const BRAND_DK = '#1e3a8a';
const GRID = O2D.line;
const STATUS_COLOR = { SCHEDULED: CHIP_TONE.info.fg, DELIVERED: CHIP_TONE.ok.fg };
const STATUS_TEXT = { SCHEDULED: '● Scheduled', DELIVERED: '✓ Delivered' };
// Party row: vendor panel | tiles (natural width) | TOTAL QTY panel, so the
// total sits right after the last tile. Tiles are a fixed width, and the tile
// area is sized to the columns that fit the list (a wrapped flex box cannot
// shrink to its content on its own).
const TILE_W = 120;
const TILE_GAP = 8;
const LEFT_W = 180;
const RIGHT_W = 140;
// list width → room for tiles: rail 52 + gap 10, card border 2 + padding 24,
// party border 2 + left/right panels, tile area padding 20; 4 list padding and
// 16 slack for a scrollbar.
const tileRoom = (listW) => listW - 52 - 10 - 2 - 24 - 2 - LEFT_W - RIGHT_W - 20 - 4 - 16;
const tilesWidth = (n, listW) => {
  const cols = Math.max(1, Math.floor((tileRoom(listW) + TILE_GAP) / (TILE_W + TILE_GAP)));
  const c = Math.min(n, cols);
  return c * TILE_W + (c - 1) * TILE_GAP + 20;
};
const DeliveryList = ({ events }) => {
  const today = startOfDay(clock());
  const ref = useRef(null);
  const [listW, setListW] = useState(1100);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setListW(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const days = [];
  const byDay = new Map();
  events.forEach((e) => {
    const d = startOfDay(new Date(e.date).getTime());
    if (!byDay.has(d)) { byDay.set(d, new Map()); days.push(d); }
    const groups = byDay.get(d);
    const k = `${e.vendorKey}|${e.status}`;
    if (!groups.has(k)) groups.set(k, { key: k, vendor: e.vendor, status: e.status, lines: [] });
    groups.get(k).lines.push(e);
  });
  days.sort((x, y) => x - y);
  return (
    <Box ref={ref} data-testid="idc-list" sx={{ maxHeight: '60vh', overflowY: 'auto', pr: 0.5, width: '100%', maxWidth: 1100, mx: 'auto', boxSizing: 'border-box' }}>
      {!days.length && (
        <Typography data-testid="idc-list-empty" sx={{ py: 6, textAlign: 'center', fontSize: 13, color: T.muted }}>
          No delivery lines in this month for these filters.
        </Typography>
      )}
      {days.map((d) => {
        const date = new Date(d);
        const isToday = d === today;
        const groups = [...byDay.get(d).values()];
        const dayTotal = groups.reduce((s, g) => s + g.lines.reduce((a, e) => a + e.qty, 0), 0);
        const parties = new Set(groups.map((g) => g.vendor)).size;
        return (
          <Box key={d} data-testid="idc-list-day" data-day={date.getDate()} sx={{ display: 'flex', gap: 1.25, mb: 2 }}>
            <Box sx={{ width: 52, flexShrink: 0, textAlign: 'right', pt: 1.25 }}>
              <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.05, color: isToday ? BRAND : NAVY, fontVariantNumeric: 'tabular-nums' }}>
                {String(date.getDate()).padStart(2, '0')}
              </Typography>
              <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.01em', lineHeight: 1.15, color: isToday ? BRAND : BRAND_DK }}>
                {date.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase()}
              </Typography>
            </Box>
            <Box sx={{ flex: 1, minWidth: 0, borderRadius: '10px', border: `1px solid ${GRID}`, overflow: 'hidden', bgcolor: '#fff' }}>
              <Box data-testid="idc-day-bar" sx={{ display: 'flex', height: 4 }}>
                {groups.map((g) => <Box key={g.key} sx={{ flex: 1, bgcolor: STATUS_COLOR[g.status] }} />)}
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, pt: 1.25, pb: 1 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: NAVY, lineHeight: 1.15 }}>
                    {date.toLocaleDateString('en-IN', { weekday: 'long' })}
                  </Typography>
                  <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: BRAND_DK, letterSpacing: '0.04em', lineHeight: 1.3 }}>
                    {date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1 }} />
                <Box data-testid="idc-day-total" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 0.6, borderRadius: '999px', border: `1px solid ${GRID}`, bgcolor: O2D.surface, flexShrink: 0 }}>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography sx={{ fontSize: '0.52rem', fontWeight: 800, color: O2D.faint, letterSpacing: '0.09em', lineHeight: 1.2 }}>DAY TOTAL</Typography>
                    <Typography sx={{ fontSize: '0.88rem', fontWeight: 800, color: NAVY, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>{fmtNum(dayTotal)}</Typography>
                  </Box>
                  <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: GRID }} />
                  <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: O2D.sub, whiteSpace: 'nowrap' }}>
                    {parties} part{parties === 1 ? 'y' : 'ies'}
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, px: 1.5, pb: 1.5 }}>
                {groups.map((g) => {
                  const color = STATUS_COLOR[g.status];
                  const total = g.lines.reduce((a, e) => a + e.qty, 0);
                  const pastDue = g.status === 'SCHEDULED' && d < today;
                  return (
                    <Box key={g.key} data-testid="idc-list-party" data-status={g.status} data-vendor={g.vendor}
                      sx={{
                        display: 'flex', flexDirection: { xs: 'column', md: 'row' }, borderRadius: '8px', overflow: 'hidden', border: `1px solid ${alpha(color, 0.22)}`,
                        width: { xs: '100%', md: 'fit-content' }, maxWidth: '100%', boxSizing: 'border-box',
                      }}>
                      <Box data-testid="idc-party-left" sx={{ width: { md: LEFT_W }, flexShrink: 0, p: 1.25, bgcolor: alpha(color, 0.07), borderLeft: `4px solid ${color}` }}>
                        <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: NAVY, lineHeight: 1.2 }}>{g.vendor}</Typography>
                        <Typography sx={{ fontSize: '0.6rem', color: O2D.sub, mb: 0.85 }}>
                          {g.lines.length} PO line{g.lines.length === 1 ? '' : 's'}
                        </Typography>
                        <Chip size="small" label={STATUS_TEXT[g.status]}
                          sx={{ height: 21, width: '100%', borderRadius: '4px', fontSize: '0.62rem', fontWeight: 800, bgcolor: color, color: '#fff', '& .MuiChip-label': { px: 0.75 } }} />
                      </Box>
                      <Box data-testid="idc-party-tiles" sx={{ display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', gap: `${TILE_GAP}px`, flex: '0 1 auto', minWidth: 0, p: 1.25, boxSizing: 'border-box', width: { md: tilesWidth(g.lines.length, listW) } }}>
                        {g.lines.map((e) => (
                          <Box key={e.key} data-testid="idc-list-line" title={`${e.item} · ${fmtNum(e.qty)} ${e.unit} · ${e.poNumber}`} sx={{ width: { md: TILE_W }, minWidth: 92, boxSizing: 'border-box', px: 1.25, py: 0.85, borderRadius: '8px', bgcolor: alpha(color, 0.07), border: `1px solid ${alpha(color, 0.2)}` }}>
                            <Typography noWrap sx={{ fontSize: '0.62rem', fontWeight: 700, color: O2D.body, mb: 0.35, maxWidth: { xs: 150, md: '100%' } }}>{e.item}</Typography>
                            <Typography sx={{ fontSize: '1.2rem', fontWeight: 800, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmtNum(e.qty)}</Typography>
                            <Typography noWrap sx={{ fontSize: '0.55rem', fontWeight: 700, color: O2D.faint, mt: 0.15, maxWidth: { xs: 150, md: '100%' } }}>
                              {e.unit ? `${e.unit} · ` : ''}{e.poNumber}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                      <Box data-testid="idc-party-right" sx={{ width: { md: RIGHT_W }, flexShrink: 0, p: 1.25, bgcolor: alpha(color, 0.07), display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: { xs: 'flex-start', md: 'flex-end' } }}>
                        <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmtNum(total)}</Typography>
                        <Typography sx={{ fontSize: '0.55rem', fontWeight: 800, color: O2D.faint, letterSpacing: '0.09em', mt: 0.25 }}>TOTAL QTY</Typography>
                        {pastDue && (
                          <Chip size="small" label="Past due"
                            sx={{ mt: 0.6, height: 18, fontSize: '0.56rem', fontWeight: 800, bgcolor: alpha(CHIP_TONE.danger.fg, 0.12), color: CHIP_TONE.danger.fg }} />
                        )}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

const viewBtnSx = (on) => ({
  height: 30, px: 0.75, gap: 0.5, fontSize: 12.5, fontWeight: 700, borderRadius: '6px', whiteSpace: 'nowrap',
  color: on ? T.heading : T.text2, bgcolor: on ? '#fff' : 'transparent', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none',
});

/** Monday-first month grid (no weekday header row): day number, count, up to 2 events. */
const Grid = ({ value, byDay, selectedDay, onDay, big }) => {
  const { year, month } = value;
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const today = startOfDay(clock());
  const cells = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <Box data-testid="idc-grid" sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 0.5 }}>
      {cells.map((d, i) => {
        if (!d) return <Box key={`b-${i}`} />;
        const ts = new Date(year, month, d).getTime();
        const events = byDay.get(ts) || [];
        const scheduled = events.some((e) => e.status === 'SCHEDULED');
        const dayColor = !events.length ? T.text2 : scheduled ? TONE.SCHEDULED.fg : TONE.DELIVERED.fg;
        const sel = selectedDay === ts;
        return (
          <ButtonBase
            key={ts}
            data-day={d}
            data-count={events.length}
            onClick={() => onDay(ts, events)}
            sx={{
              minHeight: big ? 84 : 58, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'stretch',
              justifyContent: 'flex-start', gap: '2px', px: '5px', py: '4px', border: `1px solid ${sel ? T.brand : T.border}`, borderRadius: '8px',
              boxShadow: sel ? `inset 0 0 0 1px ${T.brand}` : 'none', '&:hover': { bgcolor: T.surface2 },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
              <Box sx={{
                fontSize: big ? 13 : 11, fontWeight: events.length ? 800 : 600,
                ...(ts === today
                  ? { color: '#fff', bgcolor: T.brand, borderRadius: 999, width: 20, height: 20, display: 'grid', placeItems: 'center' }
                  : { color: dayColor }),
              }}
              >
                {d}
              </Box>
              {events.length > 0 && (
                <Box component="span" data-testid="idc-day-count" sx={{ fontSize: 9.5, fontWeight: 800, color: dayColor }}>({events.length})</Box>
              )}
            </Box>
            {events.slice(0, 2).map((e) => (
              <Box
                key={e.key}
                component="span"
                data-status={e.status}
                title={`${e.item} · ${fmtNum(e.qty)} ${e.unit} · ${e.vendor} · ${e.poNumber} (${e.status === 'DELIVERED' ? 'delivered' : 'scheduled'})`}
                sx={{
                  display: 'block', fontSize: big ? 11 : 9.5, lineHeight: 1.3, px: 0.5, py: '1px', borderRadius: '4px', whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600, color: TONE[e.status].fg, bgcolor: TONE[e.status].bg,
                }}
              >
                {e.vendor} · {fmtNum(e.qty)}
              </Box>
            ))}
            {events.length > 2 && <Typography component="span" sx={{ fontSize: 9.5, color: T.muted }}>+{events.length - 2} more</Typography>}
          </ButtonBase>
        );
      })}
    </Box>
  );
};

const ItemDeliveryCalendar = ({ events, selectedDay, onPickDay, onOpenIndent, indentsById }) => {
  const [month, setMonth] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  const [f, setF] = useState(EMPTY_DELIVERY_FILTER);
  const [dayOpen, setDayOpen] = useState(null);
  const [exportAnchor, setExportAnchor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('calendar');

  const items = useMemo(() => deliveryItemOptions(events), [events]);
  const vendors = useMemo(() => deliveryVendorOptions(events), [events]);
  const shown = useMemo(() => filterDeliveryEvents(events, f), [events, f]);
  const byDay = useMemo(() => monthEventsByDay(shown, month.year, month.month), [shown, month]);
  const monthList = useMemo(() => [...byDay.values()].flat()
    .sort((a, b) => new Date(a.date) - new Date(b.date) || a.vendor.localeCompare(b.vendor)), [byDay]);
  const labelOf = (opts, v) => opts.find((o) => o.value === v)?.label;
  const filterText = [
    ['Status', labelOf(DELIVERY_STATUS_OPTIONS, f.status) || 'All'],
    ['Item', labelOf(items, f.item) || 'All'],
    ['Vendor', labelOf(vendors, f.vendor) || 'All'],
  ];

  const pick = (ts, dayEvents) => {
    onPickDay(ts, dayEvents);
    if (selectedDay !== ts) setDayOpen(ts);
  };
  const exportPdf = async (mode) => {
    setExportAnchor(null);
    setBusy(true);
    const payload = { year: month.year, month: month.month, filters: filterText, events: monthList, fileName: fileNameOf(month.year, month.month) };
    try {
      if (mode === 'download') { await downloadDeliveryPdf(payload); enqueueSnackbar('PDF downloaded.', { variant: 'success' }); } else await previewDeliveryPdf(payload);
    } catch {
      enqueueSnackbar('The PDF could not be made right now.', { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const [big, setBig] = useState(false);
  // Expanded view = the Dispatch Calendar's grid (shared CalendarMonthGrid),
  // fed the shown delivery lines as Dispatch-style events.
  const cursor = useMemo(() => dayjs(new Date(month.year, month.month, 1)), [month]);
  const gridDays = useMemo(() => monthGridDays(cursor), [cursor]);
  const groupedByDate = useMemo(() => {
    const byKey = new Map();
    toCalendarEvents(shown).forEach((e) => { if (!byKey.has(e.dateKey)) byKey.set(e.dateKey, []); byKey.get(e.dateKey).push(e); });
    return new Map([...byKey.entries()].map(([k, list]) => [k, groupDayByParty(list)]));
  }, [shown]);
  const openGridDay = (key) => {
    const ts = dayjs(key).startOf('day').valueOf();
    pick(ts, byDay.get(ts) || []);
  };
  const statusSelect = (
    <MiniSelect label="Status" value={f.status} onChange={(v) => setF((s) => ({ ...s, status: v }))} options={DELIVERY_STATUS_OPTIONS} sx={{ width: 112 }} />
  );
  const emptyText = !events.length
    ? 'No released PO line to show yet — scheduled and delivered items appear here once POs are released.'
    : shown.length
      ? `Nothing ${f.status === 'DELIVERED' ? 'delivered' : f.status === 'SCHEDULED' ? 'scheduled' : 'scheduled or delivered'} in ${monthName(month)}. Use ‹ › to see other months.`
      : 'No events match these filters.';
  const emptyNote = (
    <Typography data-testid="pd-calendar-empty" sx={{ fontSize: 12.5, color: T.muted, px: 0.5 }}>{emptyText}</Typography>
  );

  return (
    <>
      {/* The card: Status after the title, month nav on the right; ⤢ opens the
          wide expanded dialog below (its own, so it can be wider than O2D's). */}
      <DashCard
        title="Item Delivery Calendar"
        sx={{ '@media (min-width: 1080px)': { minHeight: 486 } }}
        onExpand={() => setBig(true)}
        expandLabel="Expand"
        actions={(
          // Status right after the title; the month nav on the right — one line
          // (on a phone the nav drops below rather than pushing the page sideways).
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: '1 1 auto', minWidth: 0, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
            {statusSelect}
            <Box sx={{ ml: 'auto' }}><MonthNav value={month} onChange={setMonth} /></Box>
          </Box>
        )}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Grid value={month} byDay={byDay} selectedDay={selectedDay} onDay={pick} big={false} />
          {(f.item || f.vendor) && (
            <Typography sx={{ fontSize: 11.5, color: T.text2, px: 0.5 }}>
              Showing {[f.item && `item ${labelOf(items, f.item)}`, f.vendor && `vendor ${labelOf(vendors, f.vendor)}`].filter(Boolean).join(' and ')} (set in the expanded view).{' '}
              <ButtonBase onClick={() => setF((s) => ({ ...s, item: '', vendor: '' }))} sx={{ fontSize: 11.5, fontWeight: 700, color: T.brand, verticalAlign: 'baseline' }}>Clear</ButtonBase>
            </Typography>
          )}
          {byDay.size === 0 && emptyNote}
        </Box>
      </DashCard>

      {/* Expanded view — ONE header line, no separate title row:
          Item Delivery Calendar | Status | Item | Vendor | [Calendar | List] | ‹ Month ▾ › | Export PDF  ×
          The dialog is xl so the line fits from 1200px up (1280 / 1440 / 1920);
          below that the line may wrap rather than push the dialog sideways. */}
      <Dialog
        open={big}
        onClose={() => setBig(false)}
        maxWidth={false}
        aria-labelledby="idc-dialog-title"
        // Width: wide enough for the one header line (1216px) and for the grid
        // panel below, which is exactly the Dispatch Calendar panel's width at the
        // same window size (100vw − sidebar − page padding), so its cells are the
        // very same size as on the Dispatch page.
        PaperProps={{ 'data-testid': 'idc-dialog', sx: { borderRadius: '12px', p: 2, display: 'flex', flexDirection: 'column', gap: 1, maxHeight: '88vh', bgcolor: '#fff', width: 'max(1216px, calc(100vw - 258px))', maxWidth: 'calc(100vw - 32px)', m: 2 } }}
      >
        <Box
          data-testid="idc-big-filters"
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flexWrap: 'wrap',
            '@media (min-width: 1200px)': { flexWrap: 'nowrap' },
            '& > *': { flexShrink: 0 },
          }}
        >
          <Typography id="idc-dialog-title" component="h2" sx={{ fontSize: 15, fontWeight: 800, color: NAVY, whiteSpace: 'nowrap', flexShrink: 0, mr: 0.75 }}>
            Item Delivery Calendar
          </Typography>
          <MiniSelect label="Status" value={f.status} onChange={(v) => setF((s) => ({ ...s, status: v }))}
            options={DELIVERY_STATUS_OPTIONS} sx={{ width: 100, maxWidth: 100 }} />
          <MiniSelect label="Item" value={f.item} onChange={(v) => setF((s) => ({ ...s, item: v }))}
            options={[{ value: '', label: 'All items' }, ...items]} sx={{ width: 150, maxWidth: 150 }} />
          <MiniSelect label="Vendor" value={f.vendor} onChange={(v) => setF((s) => ({ ...s, vendor: v }))}
            options={[{ value: '', label: 'All vendors' }, ...vendors]} sx={{ width: 150, maxWidth: 150 }} />
          <Box role="tablist" aria-label="Calendar or list" sx={{ display: 'inline-flex', p: '3px', borderRadius: '8px', bgcolor: T.surface3, flexShrink: 0 }}>
            <ButtonBase role="tab" aria-selected={view === 'calendar'} onClick={() => setView('calendar')} sx={viewBtnSx(view === 'calendar')}>
              <CalendarDays size={14} /> Calendar
            </ButtonBase>
            <ButtonBase role="tab" aria-selected={view === 'list'} onClick={() => setView('list')} sx={viewBtnSx(view === 'list')}>
              <List size={14} /> List
            </ButtonBase>
          </Box>
          <MonthNav value={month} onChange={setMonth} compact />
          <Button
            size="small" variant="contained" disabled={busy} onClick={(e) => setExportAnchor(e.currentTarget)}
            startIcon={busy ? <CircularProgress size={13} color="inherit" /> : <Download size={15} />} endIcon={<ChevronDown size={13} />}
            sx={{ ml: 'auto', height: 30, fontWeight: 800, textTransform: 'none', whiteSpace: 'nowrap', borderRadius: '6px', px: 1, flexShrink: 0, '& .MuiButton-startIcon': { mr: 0.5 }, '& .MuiButton-endIcon': { ml: 0.5 } }}
          >
            {busy ? 'Preparing…' : 'Export PDF'}
          </Button>
          <IconButton size="small" aria-label="Close" onClick={() => setBig(false)} sx={{ border: `1px solid ${T.borderSoft}`, borderRadius: '6px', width: 30, height: 30 }}>
            <X size={14} />
          </IconButton>
          <Menu
            anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { mt: 0.5, minWidth: 268, borderRadius: '8px', border: `1px solid ${T.border}` } } }}
          >
            <Typography sx={{ px: 1.75, pt: 1, pb: 0.75, fontSize: '0.6rem', fontWeight: 800, color: T.muted, letterSpacing: '0.08em' }}>
              {monthName(month).toUpperCase()} · {monthList.length} EVENT{monthList.length === 1 ? '' : 'S'}
            </Typography>
            <MenuItem onClick={() => exportPdf('download')} sx={{ py: 0.9 }}>
              <ListItemIcon sx={{ minWidth: 30, color: T.brand }}><FileDown size={16} /></ListItemIcon>
              <ListItemText primary="Download PDF" secondary="Saves the file straight to your Downloads"
                primaryTypographyProps={{ fontSize: '0.82rem', fontWeight: 800, color: T.heading }} secondaryTypographyProps={{ fontSize: '0.66rem', color: T.text2 }} />
            </MenuItem>
            <MenuItem onClick={() => exportPdf('preview')} sx={{ py: 0.9 }}>
              <ListItemIcon sx={{ minWidth: 30, color: T.brand }}><Eye size={16} /></ListItemIcon>
              <ListItemText primary="Preview" secondary="Opens a tab — print or save from there"
                primaryTypographyProps={{ fontSize: '0.82rem', fontWeight: 800, color: T.heading }} secondaryTypographyProps={{ fontSize: '0.66rem', color: T.text2 }} />
            </MenuItem>
            <Typography sx={{ px: 1.75, pt: 0.5, pb: 1, fontSize: '0.64rem', color: T.text2, maxWidth: 268 }}>
              Filters applied: <b>{filterText.map(([k, v]) => `${k}: ${v}`).join(' · ')}</b>
            </Typography>
          </Menu>
        </Box>
        {/* Height follows the content (max 88vh); a taller month scrolls here only. */}
        <Box data-testid="idc-dialog-body" sx={{ minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {view === 'list'
            ? <DeliveryList events={monthList} />
            : (
              <>
                {/* The Dispatch Calendar page's panel: same Paper, legend line and grid. */}
                <Paper elevation={0} sx={{ borderRadius: '8px', overflow: 'hidden', border: `1px solid ${GRID}`, bgcolor: O2D.surface, flexShrink: 0, width: 'calc(100vw - 292px)', maxWidth: '100%', mx: 'auto' }}>
                  <CalendarLegend
                    types={[{ label: 'Scheduled', color: BRAND }, { label: 'Delivered', color: DELIVERED_COLOR }]}
                    note="One card = one party's day · items merged"
                  />
                  <CalendarMonthGrid
                    gridDays={gridDays}
                    cursor={cursor}
                    today={dayjs()}
                    groupedByDate={groupedByDate}
                    selectedDate={selectedDay != null ? dayjs(selectedDay).format('YYYY-MM-DD') : null}
                    weekCols="repeat(7, 1fr)"
                    metaOf={(g) => ({ color: g.eventType === 'delivered' ? DELIVERED_COLOR : BRAND })}
                    tagOf={(g) => (g.eventType === 'delivered' ? 'DEL' : 'SCH')}
                    totalSuffix=""
                    cardTitle={(g) => `${g.partyName} · ${g.orderCount} PO${g.orderCount > 1 ? 's' : ''} · ${fmtNum(g.totalQty)} · ${g.eventType === 'delivered' ? 'Delivered' : 'Scheduled'}`}
                    onOpenDay={openGridDay}
                  />
                </Paper>
                {byDay.size === 0 && emptyNote}
              </>
            )}
        </Box>
      </Dialog>

      <ItemDayDrawer
        day={dayOpen}
        title={dayOpen != null ? `Item deliveries · ${fmtDate(dayOpen)}` : ''}
        events={dayOpen != null ? (byDay.get(startOfDay(dayOpen)) || []) : []}
        indentsById={indentsById}
        onOpenIndent={(r) => { setDayOpen(null); onOpenIndent(r); }}
        onClose={() => setDayOpen(null)}
      />
    </>
  );
};

export default ItemDeliveryCalendar;
