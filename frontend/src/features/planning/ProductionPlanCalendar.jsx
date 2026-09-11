import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Typography, Stack, Button, IconButton, Chip, alpha,
  TextField, Dialog, DialogTitle, DialogContent, Divider, Tooltip, Skeleton,
  ToggleButton, ToggleButtonGroup, Autocomplete, Menu, MenuItem, ListItemIcon,
  CircularProgress,
} from '@mui/material';
import {
  ChevronLeft, ChevronRight, CalendarDays, Search, X, Plus, Download,
  LayoutGrid, List as ListIcon, Building2, Pencil, Trash2, FileSpreadsheet,
  ChevronRight as MoreIcon, Factory, Eye, FileDown,
} from 'lucide-react';
import { useSnackbar } from 'notistack';
import dayjs from 'dayjs';
import * as XLSX from 'xlsx';
import {
  useGetProductionPlansQuery,
  useDeleteProductionPlanMutation,
} from '../../store/api/productionPlanApi';
import {
  printPlanCalendar, printPlanList,
  downloadPlanCalendarPdf, downloadPlanListPdf,
} from '../../utils/printDispatchCalendar';
import { groupDayByParty } from '../../utils/dispatchCalendarGrouping';
import { O2D, O2D_TIP } from '../o2d-fms/o2dTheme';
import ProductionPlanDialog from './ProductionPlanDialog';

// Straight from the Dispatch Calendar — the two screens must read as one system.
const NAVY = '#0b2545';
const BRAND = '#1d4ed8';
const BRAND_DK = '#1e3a8a';
const GRID = O2D.line;

const STATUS = {
  PLANNED:     { label: 'Planned',     short: 'PLN', color: BRAND },
  IN_PROGRESS: { label: 'In Progress', short: 'WIP', color: '#b45309' },
  COMPLETED:   { label: 'Completed',   short: 'DON', color: '#0f766e' },
  CANCELLED:   { label: 'Cancelled',   short: 'CAN', color: '#64748b' },
};
const statusMeta = (s) => STATUS[s] || STATUS.PLANNED;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const num = (n) => Number(n || 0).toLocaleString('en-IN');

// utils/exportUtils.js holds JSX in a .js file and breaks the Vite build if
// imported, so the sheet writer lives here (same shape exportMasterData uses).
const toExcel = (rows, fileName) => {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Plan');
  XLSX.writeFile(wb, fileName);
};

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

export default function ProductionPlanCalendar() {
  const { enqueueSnackbar } = useSnackbar();
  const today = dayjs();

  const [cursor, setCursor] = useState(dayjs());
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar' | 'list' | 'party'
  const [partyFilter, setPartyFilter] = useState([]);
  const [search, setSearch] = useState('');
  const [dayOpen, setDayOpen] = useState(null);
  const [editing, setEditing] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogDate, setDialogDate] = useState(null);
  const [exportAnchor, setExportAnchor] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const monthStart = cursor.startOf('month');
  const monthEnd = cursor.endOf('month');

  const { data: res, isLoading, isFetching } = useGetProductionPlansQuery({
    from: monthStart.format('YYYY-MM-DD'),
    to: monthEnd.format('YYYY-MM-DD'),
  });
  const [deletePlan] = useDeleteProductionPlanMutation();

  const plans = useMemo(() => res?.data || [], [res]);

  const partyOptions = useMemo(
    () => [...new Set(plans.map((p) => p.partyName).filter(Boolean))].sort(),
    [plans],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plans.filter((p) => {
      if (partyFilter.length && !partyFilter.includes(p.partyName)) return false;
      if (!q) return true;
      const hay = `${p.planNo || ''} ${p.partyName || ''} ${p.soNumber || ''} ${p.poNumber || ''} ${(p.items || []).map((i) => `${i.skuName} ${i.skuCode}`).join(' ')}`;
      return hay.toLowerCase().includes(q);
    });
  }, [plans, partyFilter, search]);

  // ── Plans → the Dispatch Calendar's event contract ────────────────────
  // Shaping the data this way is what lets the screen, the grouping rule and
  // the whole PDF engine be shared instead of forked. `_plan` rides along so a
  // merged card can still open the individual plan it came from.
  const events = useMemo(() => filtered.map((p) => ({
    id: p._id,
    dateKey: dayjs(p.plannedDate).format('YYYY-MM-DD'),
    date: p.plannedDate,
    partyName: p.partyName || '—',
    eventType: 'scheduled',
    status: p.planStatus || 'PLANNED',
    isDelayed: false,
    delayDays: 0,
    soNumber: p.soNumber || p.planNo,
    poNumber: p.poNumber || '',
    plannedQty: Number(p.totalPlannedQty || 0),
    actualQty: Number(p.totalProducedQty || 0),
    pendingQty: 0,
    skus: (p.items || []).map((it) => ({
      skuName: it.skuName,
      skuCode: it.skuCode,
      plannedQty: Number(it.plannedQty || 0),
      actualQty: Number(it.producedQty || 0),
      pendingQty: 0,
    })),
    _plan: p,
  })), [filtered]);

  // Day → party-merged groups, using the SAME rule the dispatch screen uses.
  const byDay = useMemo(() => {
    const m = new Map();
    events.forEach((e) => {
      if (!m.has(e.dateKey)) m.set(e.dateKey, []);
      m.get(e.dateKey).push(e);
    });
    return new Map([...m.entries()].map(([k, list]) => [k, groupDayByParty(list)]));
  }, [events]);

  const monthGroups = useMemo(
    () => [...byDay.entries()]
      .filter(([k]) => dayjs(k).isSame(monthStart, 'month'))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dateKey, groups]) => ({ dateKey, groups })),
    [byDay, monthStart],
  );

  const partyMatrix = useMemo(() => {
    const daysInMonth = monthEnd.date();
    const rows = new Map();
    filtered.forEach((p) => {
      if (p.planStatus === 'CANCELLED') return;
      if (!rows.has(p.partyName)) {
        rows.set(p.partyName, { partyName: p.partyName, days: Array(daysInMonth).fill(0), total: 0 });
      }
      const r = rows.get(p.partyName);
      const d = dayjs(p.plannedDate).date() - 1;
      const qty = Number(p.totalPlannedQty || 0);
      if (d >= 0 && d < daysInMonth) r.days[d] += qty;
      r.total += qty;
    });
    return [...rows.values()].sort((a, b) => b.total - a.total);
  }, [filtered, monthEnd]);

  const monthStats = useMemo(() => {
    const live = filtered.filter((p) => p.planStatus !== 'CANCELLED');
    return {
      plans: live.length,
      planned: live.reduce((s, p) => s + Number(p.totalPlannedQty || 0), 0),
      produced: live.reduce((s, p) => s + Number(p.totalProducedQty || 0), 0),
      parties: new Set(live.map((p) => p.partyName)).size,
    };
  }, [filtered]);

  const cells = useMemo(() => {
    const out = [];
    const lead = monthStart.day();
    for (let i = lead; i > 0; i -= 1) out.push({ day: monthStart.subtract(i, 'day'), inMonth: false });
    for (let d = 1; d <= monthEnd.date(); d += 1) out.push({ day: monthStart.date(d), inMonth: true });
    while (out.length % 7 !== 0) out.push({ day: monthEnd.add((out.length % 7) + 1, 'day'), inMonth: false });
    return out;
  }, [monthStart, monthEnd]);

  const openNew = (date = null) => { setEditing(null); setDialogDate(date); setDialogOpen(true); };
  const openEdit = (plan) => { setEditing(plan); setDialogDate(null); setDialogOpen(true); };

  const handleDelete = async (plan) => {
    try {
      await deletePlan(plan._id).unwrap();
      enqueueSnackbar(`Plan ${plan.planNo} cancelled`, { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to cancel the plan', { variant: 'error' });
    }
  };

  // ── Export — identical flow to the Dispatch Calendar ──────────────────
  const partyLabel = partyFilter.length
    ? `${partyFilter.length} part${partyFilter.length === 1 ? 'y' : 'ies'}: ${partyFilter.join(', ')}`
    : 'All parties';

  const exportPayload = () => ({
    month: cursor.toISOString(),
    events,
    filters: { partyLabel, search: search.trim() },
    title: viewMode === 'list' ? 'Production Planning List' : 'Production Planning Calendar',
    docTitle: 'Production Plan',
    footer: 'Generated from Ambika Production Planning',
    fileStem: 'Production-Plan',
    statLabels: ['Plans', 'Planned pcs', 'Produced pcs', 'Parties'],
    emptyText: 'No plans match the current filters this month.',
    // No "delayed" notion on a plan — the 4th tile carries the party count.
    statValues: { delayed: monthStats.parties },
  });

  const handlePreview = () => {
    const print = viewMode === 'list' ? printPlanList : printPlanCalendar;
    print(exportPayload());
    setExportAnchor(null);
  };

  const handleDownloadPdf = async () => {
    if (downloading) return;
    setExportAnchor(null);
    setDownloading(true);
    try {
      const download = viewMode === 'list' ? downloadPlanListPdf : downloadPlanCalendarPdf;
      const ok = await download(exportPayload());
      if (ok) enqueueSnackbar('PDF downloaded.', { variant: 'success' });
    } finally {
      setDownloading(false);
    }
  };

  const exportLines = () => {
    const rows = filtered.flatMap((p) => (p.items || []).map((it) => ({
      'Plan No':  p.planNo,
      Date:       dayjs(p.plannedDate).format('DD-MM-YYYY'),
      Party:      p.partyName,
      'SKU Code': it.skuCode || '',
      SKU:        it.skuName,
      Planned:    Number(it.plannedQty || 0),
      Produced:   Number(it.producedQty || 0),
      'SO No':    p.soNumber || '',
      'PO No':    p.poNumber || '',
      Status:     p.planStatus,
      Note:       it.note || '',
    })));
    if (!rows.length) return enqueueSnackbar('Nothing to export for this month', { variant: 'info' });
    toExcel(rows, `Production-Plan-${cursor.format('MMM-YYYY')}.xlsx`);
    setExportAnchor(null);
  };

  const exportPartyMatrix = () => {
    if (!partyMatrix.length) return enqueueSnackbar('Nothing to export for this month', { variant: 'info' });
    const rows = partyMatrix.map((r) => {
      const row = { Party: r.partyName };
      r.days.forEach((q, i) => { row[String(i + 1)] = q || ''; });
      row.Total = r.total;
      return row;
    });
    toExcel(rows, `Production-Plan-Partywise-${cursor.format('MMM-YYYY')}.xlsx`);
    setExportAnchor(null);
  };

  const dayGroups = dayOpen ? (byDay.get(dayOpen) || []) : [];
  const navBtn = { border: `1px solid ${GRID}`, color: BRAND, borderRadius: '8px' };

  // One party band: party block | SKU tiles | total panel. Shared by the list
  // view and the day drill-down, exactly as the dispatch screen does it.
  const PartyBand = ({ g, onClick }) => {
    const m = statusMeta(g.status);
    const rows = (g.skus || []).filter((sk) => Number(sk.plannedQty) > 0);
    return (
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        onClick={onClick}
        sx={{
          borderRadius: '8px', overflow: 'hidden', cursor: onClick ? 'pointer' : 'default',
          border: `1px solid ${alpha(m.color, 0.22)}`,
          transition: 'box-shadow .15s',
          '&:hover': onClick ? { boxShadow: `0 2px 10px ${alpha(m.color, 0.18)}` } : {},
        }}
      >
        <Box sx={{ width: { md: 168 }, flexShrink: 0, p: 1.25, bgcolor: alpha(m.color, 0.07), borderLeft: `4px solid ${m.color}` }}>
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: NAVY, lineHeight: 1.2 }}>{g.partyName}</Typography>
          <Typography sx={{ fontSize: '0.6rem', color: O2D.sub, mb: 0.85 }}>
            {g.events.length} plan{g.events.length > 1 ? 's' : ''} · {g.orderCount ? `${g.orderCount} ref` : 'no order'}
          </Typography>
          <Chip
            size="small"
            label={`● ${m.label}`}
            sx={{ height: 21, width: '100%', borderRadius: '4px', fontSize: '0.62rem', fontWeight: 800, bgcolor: m.color, color: '#fff', '& .MuiChip-label': { px: 0.75 } }}
          />
        </Box>

        <Stack direction="row" spacing={1} sx={{ flex: 1, minWidth: 0, p: 1.25, flexWrap: 'wrap', rowGap: 1 }}>
          {rows.length ? rows.map((sk, i) => (
            <Box key={i} sx={{ minWidth: 92, px: 1.25, py: 0.85, borderRadius: '8px', bgcolor: alpha(m.color, 0.07), border: `1px solid ${alpha(m.color, 0.2)}` }}>
              <Typography noWrap sx={{ fontSize: '0.62rem', fontWeight: 700, color: O2D.body, mb: 0.35, maxWidth: 130 }}>{sk.skuName}</Typography>
              <Typography sx={{ fontSize: '1.2rem', fontWeight: 800, color: m.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {num(sk.plannedQty)}
              </Typography>
              <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: O2D.faint, mt: 0.15 }}>pcs</Typography>
            </Box>
          )) : <Typography sx={{ fontSize: '0.72rem', color: O2D.faint, alignSelf: 'center' }}>No items</Typography>}
        </Stack>

        <Box sx={{
          width: { md: 132 }, flexShrink: 0, p: 1.25, bgcolor: alpha(m.color, 0.07),
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          alignItems: { xs: 'flex-start', md: 'flex-end' },
        }}>
          <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, color: m.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {num(g.totalQty)}
          </Typography>
          <Typography sx={{ fontSize: '0.55rem', fontWeight: 800, color: O2D.faint, letterSpacing: '0.09em', mt: 0.25 }}>TOTAL PCS</Typography>
        </Box>
      </Stack>
    );
  };

  return (
    <Box sx={{ p: { xs: 1, sm: 1.5 }, minHeight: '100vh', bgcolor: O2D.canvas }}>
      {/* ── Header ─────────────────────────────────────────────────── */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5} sx={{ mb: 1.25, px: 0.5 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ width: 38, height: 38, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(BRAND, 0.1), color: BRAND, border: `1px solid ${alpha(BRAND, 0.2)}` }}>
            <Factory size={20} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: { xs: '1.05rem', sm: '1.15rem' }, fontWeight: 800, lineHeight: 1.1, color: O2D.ink }}>
              Production Plan
            </Typography>
            <Typography sx={{ color: O2D.sub, fontSize: '0.76rem', display: { xs: 'none', sm: 'block' } }}>
              Party-wise monthly plan — a purchase order is not required.
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" spacing={2.5} alignItems="center" sx={{ pr: 0.5 }}>
          {[
            { k: 'Plans', v: monthStats.plans, c: O2D.ink },
            { k: 'Planned pcs', v: num(monthStats.planned), c: BRAND },
            { k: 'Produced pcs', v: num(monthStats.produced), c: '#15803d' },
            { k: 'Parties', v: monthStats.parties, c: O2D.ink },
          ].map((s) => (
            <Box key={s.k} sx={{ textAlign: 'right', display: { xs: s.k === 'Plans' ? 'block' : 'none', sm: 'block' } }}>
              <Typography sx={{ fontSize: '1rem', fontWeight: 800, lineHeight: 1, color: s.c, fontVariantNumeric: 'tabular-nums' }}>{s.v}</Typography>
              <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: O2D.sub }}>{s.k}</Typography>
            </Box>
          ))}
          <Button variant="contained" startIcon={<Plus size={15} />} onClick={() => openNew()}
            sx={{ ml: 1, fontWeight: 800, borderRadius: '8px', textTransform: 'none', boxShadow: 'none' }}>
            New Plan
          </Button>
        </Stack>
      </Stack>

      <Paper elevation={0} sx={{ borderRadius: '8px', overflow: 'hidden', border: `1px solid ${GRID}`, bgcolor: O2D.surface }}>
        {/* ── Toolbar ──────────────────────────────────────────────── */}
        <Stack direction="row" alignItems="center" spacing={0.75}
          sx={{ px: { xs: 1.25, sm: 1.5 }, py: 0.75, flexWrap: { xs: 'wrap', lg: 'nowrap' }, rowGap: 0.75, borderBottom: `1px solid ${GRID}` }}>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <IconButton size="small" onClick={() => setCursor((c) => c.subtract(1, 'month'))} sx={navBtn}><ChevronLeft size={17} /></IconButton>
            <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', minWidth: 124, textAlign: 'center', color: BRAND_DK }}>
              {cursor.format('MMMM YYYY')}
            </Typography>
            <IconButton size="small" onClick={() => setCursor((c) => c.add(1, 'month'))} sx={navBtn}><ChevronRight size={17} /></IconButton>
            <Button size="small" onClick={() => setCursor(dayjs())}
              sx={{ fontWeight: 800, color: BRAND, textTransform: 'none', '&:hover': { bgcolor: alpha(BRAND, 0.06) } }}>
              Today
            </Button>
          </Stack>

          {/* View switch — Calendar · List · Party grid */}
          <ToggleButtonGroup size="small" exclusive value={viewMode} onChange={(_, v) => v && setViewMode(v)}
            sx={{ '& .MuiToggleButton-root': { border: `1px solid ${GRID}`, px: 1.1, gap: 0.5, textTransform: 'none', fontWeight: 800, fontSize: '0.72rem', color: O2D.sub, '&.Mui-selected': { bgcolor: alpha(BRAND, 0.1), color: BRAND } } }}>
            <ToggleButton value="calendar"><LayoutGrid size={14} /> Calendar</ToggleButton>
            <ToggleButton value="list"><ListIcon size={14} /> List</ToggleButton>
            <ToggleButton value="party">
              <Tooltip arrow slotProps={O2D_TIP} title="Party-wise monthly grid"><Building2 size={14} /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>

          <Box sx={{ flex: 1, minWidth: 8 }} />

          <Autocomplete
            multiple size="small" limitTags={1}
            options={partyOptions} value={partyFilter}
            onChange={(_, v) => setPartyFilter(v)}
            sx={{ minWidth: 175, maxWidth: 260 }}
            renderInput={(params) => <TextField {...params} placeholder={partyFilter.length ? '' : 'All parties'} />}
          />

          <TextField
            size="small" placeholder="Search plan, SKU, SO/PO…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: 180 }}
            InputProps={{
              startAdornment: <Search size={15} style={{ marginRight: 7, color: O2D.faint }} />,
              endAdornment: search ? <IconButton size="small" onClick={() => setSearch('')}><X size={13} /></IconButton> : null,
            }}
          />

          <Button
            variant="contained" size="small"
            startIcon={downloading ? <CircularProgress size={13} color="inherit" /> : <Download size={14} />}
            onClick={(e) => setExportAnchor(e.currentTarget)}
            disabled={downloading}
            sx={{ fontWeight: 800, borderRadius: '8px', textTransform: 'none', boxShadow: 'none', flexShrink: 0 }}
          >
            Export PDF
          </Button>
          <Menu anchorEl={exportAnchor} open={Boolean(exportAnchor)} onClose={() => setExportAnchor(null)}>
            <MenuItem onClick={handlePreview}>
              <ListItemIcon><Eye size={16} /></ListItemIcon>
              Preview in new tab
            </MenuItem>
            <MenuItem onClick={handleDownloadPdf}>
              <ListItemIcon><FileDown size={16} /></ListItemIcon>
              Download PDF
            </MenuItem>
            <Divider />
            <MenuItem onClick={exportLines}>
              <ListItemIcon><FileSpreadsheet size={16} /></ListItemIcon>
              Excel — detailed lines
            </MenuItem>
            <MenuItem onClick={exportPartyMatrix}>
              <ListItemIcon><Building2 size={16} /></ListItemIcon>
              Excel — party-wise grid
            </MenuItem>
          </Menu>
        </Stack>

        {/* ── Legend ───────────────────────────────────────────────── */}
        <Stack direction="row" alignItems="center" spacing={1.5}
          sx={{ px: { xs: 1.25, sm: 1.5 }, py: 0.5, borderBottom: `1px solid ${GRID}`, bgcolor: O2D.surfaceAlt, flexWrap: 'wrap', rowGap: 0.5 }}>
          {Object.values(STATUS).map((s) => (
            <Stack key={s.label} direction="row" alignItems="center" spacing={0.5}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: s.color }} />
              <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: O2D.body }}>{s.label}</Typography>
            </Stack>
          ))}
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.06em', color: O2D.faint }}>
            {isFetching ? 'REFRESHING…' : `${viewMode === 'list' ? 'LIST VIEW' : viewMode === 'party' ? 'PARTY GRID' : 'CALENDAR VIEW'} · ${monthStats.plans} PLAN${monthStats.plans === 1 ? '' : 'S'}`}
          </Typography>
        </Stack>

        {isLoading ? (
          <Box sx={{ p: 1.5 }}><Skeleton variant="rounded" height={520} /></Box>
        ) : viewMode === 'calendar' ? (
          /* ── Calendar grid ─────────────────────────────────────── */
          <Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', bgcolor: O2D.band }}>
              {WEEKDAYS.map((d) => (
                <Box key={d} sx={{ py: 0.6, textAlign: 'center', borderRight: `1px solid ${GRID}`, '&:last-of-type': { borderRight: 0 } }}>
                  <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: O2D.sub }}>{d}</Typography>
                </Box>
              ))}
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {cells.map(({ day, inMonth }) => {
                const key = day.format('YYYY-MM-DD');
                const groups = inMonth ? (byDay.get(key) || []) : [];
                const shown = groups.slice(0, 2);
                const more = groups.length - shown.length;
                const dayQty = groups.reduce((s, g) => s + g.totalQty, 0);
                const isToday = day.isSame(today, 'day') && inMonth;

                return (
                  <Box
                    key={key}
                    onClick={() => (groups.length ? setDayOpen(key) : inMonth && openNew(key))}
                    sx={{
                      minHeight: { xs: 76, md: 96 }, p: 0.5,
                      borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}`,
                      bgcolor: isToday ? alpha(BRAND, 0.06) : (inMonth ? O2D.surface : O2D.surfaceAlt),
                      cursor: inMonth ? 'pointer' : 'default',
                      transition: 'background .15s',
                      '&:hover': inMonth ? { bgcolor: alpha(BRAND, 0.07) } : {},
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.4 }}>
                      <Box sx={{
                        width: 19, height: 19, borderRadius: '50%', display: 'grid', placeItems: 'center',
                        fontSize: '0.68rem', fontWeight: 800,
                        bgcolor: isToday ? BRAND : 'transparent',
                        color: isToday ? '#fff' : (inMonth ? O2D.ink : O2D.faint),
                      }}>
                        {day.date()}
                      </Box>
                      {dayQty > 0 && (
                        <Typography sx={{ fontSize: '0.56rem', fontWeight: 800, color: BRAND, fontVariantNumeric: 'tabular-nums' }}>{num(dayQty)}</Typography>
                      )}
                    </Stack>

                    <Stack spacing={0.4}>
                      {shown.map((g) => {
                        const m = statusMeta(g.status);
                        const rows = (g.skus || []).filter((sk) => Number(sk.plannedQty) > 0);
                        return (
                          <Tooltip key={g.id} arrow slotProps={O2D_TIP} disableInteractive
                            title={`${g.partyName} · ${num(g.totalQty)} pcs · ${m.label}`}>
                            <Box sx={{ borderLeft: `3px solid ${m.color}`, bgcolor: alpha(m.color, 0.07), borderRadius: '3px', px: 0.5, py: 0.3 }}>
                              <Stack direction="row" alignItems="center" spacing={0.5}>
                                <Typography noWrap sx={{ fontSize: '0.6rem', fontWeight: 800, color: O2D.ink, flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                                  {shortParty(g.partyName)}
                                </Typography>
                                <Typography sx={{ fontSize: '0.46rem', fontWeight: 900, color: m.color, flexShrink: 0 }}>{m.short}</Typography>
                                {g.events.length > 1 && (
                                  <Typography sx={{ fontSize: '0.46rem', fontWeight: 800, color: O2D.faint, flexShrink: 0 }}>×{g.events.length}</Typography>
                                )}
                              </Stack>

                              {rows.slice(0, 3).map((sk, i) => (
                                <Stack key={i} direction="row" alignItems="center" spacing={0.5}>
                                  <Typography noWrap sx={{ fontSize: '0.54rem', color: O2D.body, flex: 1, minWidth: 0, lineHeight: 1.35 }}>{sk.skuName}</Typography>
                                  <Typography sx={{ fontSize: '0.54rem', fontWeight: 800, color: O2D.ink, flexShrink: 0, fontVariantNumeric: 'tabular-nums', lineHeight: 1.35 }}>
                                    {num(sk.plannedQty)}
                                  </Typography>
                                </Stack>
                              ))}
                              {rows.length > 3 && (
                                <Typography sx={{ fontSize: '0.5rem', fontWeight: 700, color: O2D.faint, lineHeight: 1.4 }}>
                                  +{rows.length - 3} more SKU{rows.length - 3 > 1 ? 's' : ''}
                                </Typography>
                              )}

                              <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.2, pt: 0.2, borderTop: `1px solid ${alpha(m.color, 0.22)}` }}>
                                <Typography sx={{ fontSize: '0.44rem', fontWeight: 800, color: O2D.faint, textTransform: 'uppercase', letterSpacing: '0.05em', flex: 1 }}>Total</Typography>
                                <Typography sx={{ fontSize: '0.56rem', fontWeight: 900, color: m.color, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                                  {num(g.totalQty)} pcs
                                </Typography>
                              </Stack>
                            </Box>
                          </Tooltip>
                        );
                      })}

                      {more > 0 && (
                        <Box onClick={(ev) => { ev.stopPropagation(); setDayOpen(key); }}
                          sx={{ mt: 0.1, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 0.25, px: 0.6, py: 0.15, borderRadius: '4px', cursor: 'pointer', bgcolor: alpha(BRAND, 0.1), color: BRAND, '&:hover': { bgcolor: alpha(BRAND, 0.2) } }}>
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
        ) : viewMode === 'list' ? (
          /* ── List view — date rail + day card + party bands ─────── */
          <Box sx={{ p: { xs: 1, sm: 1.5 } }}>
            {monthGroups.length === 0 ? (
              <Stack alignItems="center" sx={{ py: 6, color: O2D.faint }}>
                <Factory size={32} style={{ opacity: 0.5, marginBottom: 8 }} />
                <Typography sx={{ fontSize: '0.85rem' }}>No plans match the current filters this month.</Typography>
              </Stack>
            ) : monthGroups.map(({ dateKey, groups }) => {
              const d = dayjs(dateKey);
              const isTodayRow = d.isSame(today, 'day');
              const dayTotal = groups.reduce((s, g) => s + g.totalQty, 0);
              return (
                <Stack key={dateKey} direction="row" spacing={1.25} sx={{ mb: 2 }}>
                  <Box sx={{ width: 52, flexShrink: 0, textAlign: 'right', pt: 1.25 }}>
                    <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.05, color: isTodayRow ? BRAND : NAVY, fontVariantNumeric: 'tabular-nums' }}>
                      {d.format('DD')}
                    </Typography>
                    <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.01em', lineHeight: 1.15, color: isTodayRow ? BRAND : BRAND_DK }}>
                      {d.format('MMM').toUpperCase()}
                    </Typography>
                  </Box>

                  <Paper variant="outlined" sx={{ flex: 1, minWidth: 0, borderRadius: '10px', borderColor: GRID, overflow: 'hidden' }}>
                    <Stack direction="row" sx={{ height: 3 }}>
                      {groups.map((g) => <Box key={g.id} sx={{ flex: 1, bgcolor: statusMeta(g.status).color }} />)}
                    </Stack>

                    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, pt: 1.25, pb: 1 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: NAVY, lineHeight: 1.15 }}>{d.format('dddd')}</Typography>
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

                    <Stack spacing={1} sx={{ px: 1.5, pb: 1.5 }}>
                      {groups.map((g) => <PartyBand key={g.id} g={g} onClick={() => setDayOpen(dateKey)} />)}
                    </Stack>
                  </Paper>
                </Stack>
              );
            })}
          </Box>
        ) : (
          /* ── Party-wise monthly grid ───────────────────────────── */
          <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={{ borderCollapse: 'collapse', minWidth: 900 }}>
              <Box component="thead" sx={{ bgcolor: O2D.surfaceAlt }}>
                <Box component="tr">
                  <Box component="th" sx={{ p: 1, textAlign: 'left', fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: O2D.sub, position: 'sticky', left: 0, bgcolor: O2D.surfaceAlt, minWidth: 170, borderBottom: `1px solid ${GRID}`, borderRight: `1px solid ${GRID}` }}>
                    Party
                  </Box>
                  {Array.from({ length: monthEnd.date() }, (_, i) => (
                    <Box component="th" key={i} sx={{ p: 0.5, fontSize: '0.6rem', fontWeight: 800, color: O2D.sub, minWidth: 30, borderBottom: `1px solid ${GRID}` }}>{i + 1}</Box>
                  ))}
                  <Box component="th" sx={{ p: 1, fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: O2D.ink, minWidth: 76, borderBottom: `1px solid ${GRID}`, borderLeft: `1px solid ${GRID}` }}>Total</Box>
                </Box>
              </Box>
              <Box component="tbody">
                {partyMatrix.length === 0 && (
                  <Box component="tr">
                    <Box component="td" colSpan={monthEnd.date() + 2} sx={{ p: 5, textAlign: 'center', color: O2D.sub, fontSize: '0.85rem' }}>
                      No plans this month.
                    </Box>
                  </Box>
                )}
                {partyMatrix.map((r) => {
                  const peak = Math.max(...r.days, 1);
                  return (
                    <Box component="tr" key={r.partyName} sx={{ borderBottom: `1px solid ${GRID}` }}>
                      <Box component="td" sx={{ p: 1, fontSize: '0.74rem', fontWeight: 800, color: NAVY, position: 'sticky', left: 0, bgcolor: O2D.surface, borderRight: `1px solid ${GRID}` }}>
                        {r.partyName}
                      </Box>
                      {r.days.map((q, i) => (
                        <Box component="td" key={i}
                          sx={{
                            p: 0.4, textAlign: 'center', fontSize: '0.6rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                            color: q ? (q / peak > 0.6 ? '#fff' : O2D.ink) : O2D.faint,
                            // Shaded against this party's own busiest day, so a small
                            // party's pattern is as readable as a large one's.
                            bgcolor: q ? alpha(BRAND, 0.12 + (q / peak) * 0.68) : 'transparent',
                          }}>
                          {q ? num(q) : '·'}
                        </Box>
                      ))}
                      <Box component="td" sx={{ p: 1, textAlign: 'right', fontSize: '0.76rem', fontWeight: 900, color: BRAND, fontVariantNumeric: 'tabular-nums', borderLeft: `1px solid ${GRID}` }}>
                        {num(r.total)}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Box>
        )}
      </Paper>

      {/* ── Day drill-down ───────────────────────────────────────── */}
      <Dialog open={Boolean(dayOpen)} onClose={() => setDayOpen(null)} maxWidth="md" fullWidth
        PaperProps={{ sx: { borderRadius: '10px', border: `1px solid ${GRID}` } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.25, pb: 1.25 }}>
          <Box sx={{ width: 32, height: 32, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: alpha(BRAND, 0.1), color: BRAND }}>
            <CalendarDays size={17} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: '0.98rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.2 }}>
              {dayOpen ? dayjs(dayOpen).format('dddd, DD MMMM YYYY') : ''}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, fontWeight: 600 }}>
              {dayGroups.length} part{dayGroups.length === 1 ? 'y' : 'ies'} ·{' '}
              {num(dayGroups.reduce((s, g) => s + g.totalQty, 0))} pcs
            </Typography>
          </Box>
          <Button size="small" startIcon={<Plus size={14} />} onClick={() => { openNew(dayOpen); setDayOpen(null); }}
            sx={{ fontWeight: 800, textTransform: 'none' }}>
            Add
          </Button>
          <IconButton size="small" onClick={() => setDayOpen(null)}><X size={16} /></IconButton>
        </DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2, bgcolor: O2D.surfaceAlt }}>
          <Stack spacing={1.5}>
            {dayGroups.map((g) => (
              <Box key={g.id}>
                <PartyBand g={g} />
                {/* The band merges a party's plans for the day; the individual
                    plans are listed under it so each can still be opened. */}
                <Stack direction="row" spacing={0.75} sx={{ mt: 0.6, flexWrap: 'wrap', rowGap: 0.6, pl: 0.5 }}>
                  {g.events.map((e) => (
                    <Chip
                      key={e.id}
                      size="small"
                      label={`${e._plan.planNo} · ${num(e.plannedQty)}`}
                      onClick={() => { openEdit(e._plan); setDayOpen(null); }}
                      onDelete={() => handleDelete(e._plan)}
                      deleteIcon={<Trash2 size={12} />}
                      icon={<Pencil size={12} />}
                      sx={{ height: 24, fontSize: '0.64rem', fontWeight: 700, bgcolor: O2D.surface, border: `1px solid ${GRID}` }}
                    />
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        </DialogContent>
      </Dialog>

      <ProductionPlanDialog
        open={dialogOpen}
        plan={editing}
        defaultDate={dialogDate}
        onClose={() => { setDialogOpen(false); setEditing(null); setDialogDate(null); }}
      />
    </Box>
  );
}
