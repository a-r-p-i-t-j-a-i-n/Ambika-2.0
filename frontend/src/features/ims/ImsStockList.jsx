import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, MenuItem, InputAdornment, Table, TableHead, TableBody, alpha,
  TableRow, TableCell, Chip, IconButton, Tooltip, Button, Skeleton, TablePagination, Collapse,
  Dialog, DialogTitle, DialogContent, DialogActions, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Boxes, Search, Pencil, LineChart as LineChartIcon, PackageOpen, AlertTriangle, TrendingDown,
  ChevronRight, Info, X, Download, IndianRupee,
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Line, Area, Bar, XAxis, YAxis, Tooltip as RTooltip, ReferenceLine, CartesianGrid,
} from 'recharts';
import dayjs from 'dayjs';
import {
  ImsShell, Panel, TableScroll, KpiCard, KpiGrid, StatusChip, StatusLegend, EmptyNote, Th,
  O2D, O2D_TIP, STOCK_TOKENS, STOCK_ORDER, stockToken, num, inr,
} from './imsMeta';
import { FLUENT, fluentTableSx, statusRowSx, pastelOf, pastelPanelSx, headerBtnSx } from './imsFluent';
import QtyRangeFilter from './QtyRangeFilter';
import { NO_QTY_RANGE, matchesQtyRange } from './qtyRange';
import { useGetImsOverviewQuery, useGetImsForecastQuery, useGetImsHistoryQuery } from '../../store/api/imsApi';
import PolicyDialog from './PolicyDialog';
import { TYPE_META } from '../masters/itemTypeMeta';
import { FIELD } from './imsFieldHelp';
import AwaitingQcNote from './AwaitingQcNote';

const H = FIELD.ims;

// ── Item classification (SKU Master is the source of truth) ─────────────────
// Every row here IS a SKU Master record (ims.service joins SKU + stock + policy),
// so `itemType` on the row is the master classification verbatim. TYPE_META is
// imported from the SKU Master screen so a class always carries the same colour
// in both places — this screen never keeps its own category mapping.
const UNMAPPED_KEY = "__UNMAPPED__";
const titleCase = (s) => String(s).toLowerCase().split("_")
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

// A classification the master map has no colour for still shows its REAL master
// value, just in a neutral chip — nothing is ever inferred from the code or name.
// "Unmapped" is reserved for a row whose SKU carries no classification at all.
const typeMeta = (itemType) => {
  if (!itemType) return { label: "Unmapped", color: STOCK_TOKENS.OUT_OF_STOCK.color, unmapped: true };
  return TYPE_META[itemType] || { label: titleCase(itemType), color: O2D.sub };
};

// Same pill shape as StatusChip so the two columns read as one system.
const CategoryChip = ({ itemType }) => {
  const m = typeMeta(itemType);
  const chip = (
    <Chip
      size="small" label={m.label}
      sx={{
        height: 22, fontWeight: 700, fontSize: "0.7rem", borderRadius: "999px",
        bgcolor: alpha(m.color, 0.12), color: m.color, border: `1px solid ${alpha(m.color, 0.3)}`,
        "& .MuiChip-label": { px: 1 },
      }}
    />
  );
  return m.unmapped
    ? <Tooltip arrow slotProps={O2D_TIP} title="This item has no classification in the SKU Master. Set its type there to categorise it."><span>{chip}</span></Tooltip>
    : chip;
};

// What a policy-only column shows for an item that has no policy. The value the
// backend plans with is a default, not something anyone set for this item, so
// the cell says so instead of printing the default as if it were data.
const NotConfigured = () => (
  <Tooltip arrow slotProps={O2D_TIP}
    title="No planning policy set for this item. IMS falls back to a system default to keep the levels working — set a policy to make this a real figure.">
    <Box component="span" sx={{ cursor: 'help', color: O2D.faint }}>—</Box>
  </Tooltip>
);

// Plain-English definitions for the planning columns. These are the words that
// lose a non-warehouse reader, so every one of them carries its meaning inline.
const GLOSSARY = [
  ['Available Qty', 'How many units are physically in the store right now.'],
  ['Material In Transit', 'Ordered from the vendor but not yet received.'],
  ['Average Daily Consumption', 'Average consumption per day calculated from the last 90 days of actual consumption. Calculated, not typed in.'],
  ['Lead Time (From Indent to Receipt)', 'Days the vendor takes to deliver after you place the order.'],
  ['Safety Factor', 'A cushion multiplier for demand spikes and late deliveries, set per item. 1.5 means we hold 50% extra.'],
  ['Reorder at', 'The trigger level. When Closing Stock drops to this, place the order — Average Daily Consumption × Lead Time. The Safety Factor does not enter here, so changing it never moves this number.'],
  ['Max Level', 'The ceiling. When we buy, we buy enough to reach this level — Average Daily Consumption × Lead Time × Safety Factor. An "M" beside the figure means it was overridden by hand and ignores the formula.'],
  ['Daily Consumption', 'Actual consumption recorded today — the total issued to production so far today. Blank means nothing has been issued today. Average Daily Consumption is the steady 90-day rate; this is just today.'],
];

// Colour key for the footer. It reads STOCK_TOKENS / STOCK_ORDER directly — the
// very same map the row tints and the Status chips already use — so the legend
// cannot drift from the table. No colour is defined here.
const ColorCodingLegend = () => (
  <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap
    sx={{ py: { xs: 1, md: 0 } }}>
    <Typography sx={{
      fontSize: '0.68rem', fontWeight: 800, color: O2D.sub,
      letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      Color Coding
    </Typography>
    {STOCK_ORDER.map((k) => {
      const t = STOCK_TOKENS[k];
      return (
        <Tooltip key={k} arrow slotProps={O2D_TIP} title={t.meaning}>
          <Stack direction="row" alignItems="center" spacing={0.55} sx={{ cursor: 'help' }}>
            <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: t.color, flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.7rem', color: O2D.body, whiteSpace: 'nowrap' }}>{t.label}</Typography>
          </Stack>
        </Tooltip>
      );
    })}
  </Stack>
);

// ── Stock & consumption graph (row Graph icon) ───────────────────────────────
// One chart, three real series, nothing invented:
//   • Actual stock      — the closing balance of every past day, rebuilt from the
//                         ledger by GET /ims/history (it reconciles with on-hand).
//   • Units out / day   — what actually left the store each past day (same call).
//   • Forecast          — GET /ims/forecast: today's stock, + Awaiting QC and
//                         in-transit when due, − Average Daily Consumption a day.
//                         Its daily use (the ADC it assumes) is drawn as faint bars.
// The period toggle sets both directions: N days back and N days ahead.
const SERIES = {
  actual: { color: O2D.brand, label: 'Actual stock' },
  forecast: { color: '#7c3aed', label: 'Forecast stock' },
  out: { color: '#c2410c', label: 'Units out (actual)' },
  outForecast: { color: '#c2410c', label: 'Daily use (forecast)' },
};

const ChartLegendDot = ({ color, label, dashed, bar, faint }) => (
  <Stack direction="row" spacing={0.6} alignItems="center">
    {bar
      ? <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: color, opacity: faint ? 0.3 : 0.85 }} />
      : <Box sx={{ width: 16, height: 0, borderTop: `2.5px ${dashed ? 'dashed' : 'solid'} ${color}` }} />}
    <Typography sx={{ fontSize: '0.68rem', color: O2D.body, fontWeight: 600 }}>{label}</Typography>
  </Stack>
);

const GraphTip = ({ active, payload, unit }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const rows = [
    p.actual != null && ['Actual stock', p.actual, SERIES.actual.color],
    p.forecast != null && !p.isPast && ['Forecast stock', p.forecast, SERIES.forecast.color],
    p.isPast && ['Units out', p.out || 0, SERIES.out.color],
    p.isPast && p.inQty > 0 && ['Units in', p.inQty, STOCK_TOKENS.OK.color],
    !p.isPast && p.outForecast != null && ['Forecast use', p.outForecast, SERIES.out.color],
  ].filter(Boolean);
  return (
    <Box sx={{ bgcolor: O2D.surface, border: `1px solid ${O2D.line}`, borderRadius: '7px', px: 1.1, py: 0.75, boxShadow: '0 8px 24px rgba(28,30,33,0.16)' }}>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: O2D.ink, mb: 0.25 }}>
        {dayjs(p.key).format('ddd, DD MMM YYYY')}{p.isToday ? ' · today' : p.isPast ? '' : ' · forecast'}
      </Typography>
      {rows.map(([k, v, c]) => (
        <Typography key={k} sx={{ fontSize: '0.72rem', color: c, fontWeight: 700 }}>
          {k}: {num(v)}{unit ? ` ${unit}` : ''}
        </Typography>
      ))}
    </Box>
  );
};

const ForecastDialog = ({ item, onClose }) => {
  const [days, setDays] = useState(30);
  const skuId = item?.skuId;
  // History window: the last `days` IST calendar days up to today (inclusive).
  const to = dayjs().format('YYYY-MM-DD');
  const from = dayjs().subtract(days - 1, 'day').format('YYYY-MM-DD');
  const fc = useGetImsForecastQuery({ skuId, days }, { skip: !item });
  const hist = useGetImsHistoryQuery({ skuId, from, to }, { skip: !item });
  const f = fc.data?.data;
  const h = hist.data?.data;
  const m = f?.metrics || {};
  const unit = f?.sku?.unit || item?.unit || '';
  const loading = (fc.isFetching && !f) || (hist.isFetching && !h);
  const error = fc.error || hist.error;

  const { data: chartData, todayKey, summary } = useMemo(() => {
    if (!f || !h) return { data: [], todayKey: null, summary: null };
    const pastDays = h.days || [];
    const lastKey = pastDays.length ? pastDays[pastDays.length - 1].date : to;
    const points = pastDays.map((d) => ({
      key: d.date, label: dayjs(d.date).format('DD MMM'),
      actual: d.closing, out: d.outQty, inQty: d.inQty, isPast: true, isToday: d.date === lastKey,
    }));
    const series = f.series || [];
    // Day 0 of the forecast is today: it starts where the actual line ends, so
    // the two lines meet instead of leaving a gap.
    if (points.length && series[0]) points[points.length - 1].forecast = series[0].projected;
    let left = series[0]?.projected ?? 0;
    series.slice(1).forEach((p) => {
      const key = dayjs(lastKey).add(p.day, 'day').format('YYYY-MM-DD');
      // The daily use the projection assumes: the ADC, but never more than the
      // forecast says is left — once stock reaches 0 there is nothing to use.
      const use = m.adc > 0 ? Math.max(0, Math.min(m.adc, left)) : 0;
      left = p.projected;
      points.push({
        key, label: dayjs(key).format('DD MMM'), forecast: p.projected,
        outForecast: Math.round(use * 100) / 100, isPast: false,
      });
    });
    return { data: points, todayKey: lastKey, summary: h.summary };
  }, [f, h, m.adc, to]);

  const hasHistory = (summary?.totalIn || 0) + (summary?.totalOut || 0) > 0 || (summary?.closingBalance || 0) > 0;

  // The two dates that matter — spelled as sentences, not as chips full of jargon.
  const verdict = f?.stockoutDay != null
    ? { tone: STOCK_TOKENS.OUT_OF_STOCK, text: f.stockoutDay === 0 ? 'This item is out of stock today.' : `At the current rate this item runs out in about ${f.stockoutDay} days.` }
    : f?.reorderDay != null
      ? { tone: STOCK_TOKENS.REORDER, text: f.reorderDay === 0 ? 'Stock is already at its reorder point — plan the purchase order now.' : `Stock hits its reorder point in about ${f.reorderDay} days — plan the purchase order now.` }
      : { tone: STOCK_TOKENS.OK, text: m.adc > 0 ? `No reorder and no stock-out expected in the next ${days} days.` : `Nothing was consumed in the last 90 days, so stock is expected to stay at ${num(m.onHand)}${unit ? ` ${unit}` : ''}.` };

  const chips = [
    ['Closing Stock', `${num(m.onHand)}${unit ? ` ${unit}` : ''}`],
    ['Avg daily use (90d)', `${num(m.adc)}/day`],
    [`Out, last ${days}d`, num(summary?.totalOut)],
    [`In, last ${days}d`, num(summary?.totalIn)],
    ['Reorder at', num(m.reorderPoint)],
    ['Max Level', num(m.maxLevel)],
    ['Days of cover', m.daysCover == null ? '—' : num(m.daysCover)],
  ];

  return (
    <Dialog open={!!item} onClose={onClose} maxWidth="lg" fullWidth
      PaperProps={{ sx: { borderRadius: '12px', border: `1px solid ${O2D.line}` }, 'data-testid': 'ims-graph-dialog' }}>
      <DialogTitle sx={{ py: 1.25, borderBottom: `1px solid ${O2D.lineSoft}` }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Box sx={{
            width: 34, height: 34, borderRadius: '9px', display: 'grid', placeItems: 'center', flexShrink: 0,
            bgcolor: alpha(O2D.brand, 0.1), color: O2D.brand, border: `1px solid ${alpha(O2D.brand, 0.18)}`,
          }}>
            <LineChartIcon size={17} />
          </Box>
          <Box sx={{ minWidth: 0, mr: 'auto' }}>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: O2D.ink }}>
              Stock &amp; consumption — actual and forecast
            </Typography>
            <Typography noWrap sx={{ fontSize: '0.72rem', color: O2D.sub }}>
              {item?.skuName} · {item?.skuCode}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} aria-label="Close"><X size={16} /></IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ bgcolor: O2D.canvas, p: 1.5 }}>
        <Stack spacing={1.25} sx={{ pt: 1.25 }}>
          {error ? (
            <Paper elevation={0} sx={{ borderRadius: '8px', px: 1.5, py: 1.1, border: `1px solid ${STOCK_TOKENS.OUT_OF_STOCK.border}`, bgcolor: STOCK_TOKENS.OUT_OF_STOCK.tint }}>
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: STOCK_TOKENS.OUT_OF_STOCK.color }}>
                {error?.data?.message || 'Could not load this item’s stock history.'}
              </Typography>
            </Paper>
          ) : (
            <Paper elevation={0} data-testid="ims-graph-verdict" sx={{
              borderRadius: '8px', px: 1.5, py: 1.1,
              ...pastelPanelSx(verdict.tone),
            }}>
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: pastelOf(verdict.tone).ink }}>{loading ? 'Working it out…' : verdict.text}</Typography>
            </Paper>
          )}

          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
            {chips.map(([k, v]) => (
              <Chip key={k} size="small" label={<span><b>{k}:</b> {loading ? '…' : v}</span>}
                sx={{ height: 24, fontSize: '0.7rem', borderRadius: '999px', bgcolor: O2D.surface, border: `1px solid ${O2D.line}`, color: O2D.body }} />
            ))}
            <Box sx={{ ml: 'auto' }}>
              <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)}
                sx={{ '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 700, fontSize: '0.7rem', px: 1.1, py: 0.3, borderColor: O2D.line, bgcolor: O2D.surface } }}>
                {[15, 30, 60, 90].map((d) => <ToggleButton key={d} value={d}>{d} days</ToggleButton>)}
              </ToggleButtonGroup>
            </Box>
          </Stack>

          <Paper elevation={0} sx={{ borderRadius: '10px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface, p: 1.5 }}>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              <ChartLegendDot color={SERIES.actual.color} label={`Actual stock (last ${days} days)`} />
              <ChartLegendDot color={SERIES.forecast.color} label={`Forecast stock (next ${days} days)`} dashed />
              <ChartLegendDot color={SERIES.out.color} label="Units out per day (actual)" bar />
              <ChartLegendDot color={SERIES.out.color} label="Daily use the forecast assumes" bar faint />
            </Stack>
            {loading ? <Skeleton variant="rounded" height={320} /> : (
              <Box sx={{ height: 330 }} data-testid="ims-graph-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 14, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="imsActualFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={SERIES.actual.color} stopOpacity={0.18} />
                        <stop offset="100%" stopColor={SERIES.actual.color} stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={O2D.lineSoft} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: O2D.sub }} interval="preserveStartEnd"
                      minTickGap={28} tickLine={false} axisLine={{ stroke: O2D.line }} />
                    <YAxis yAxisId="stock" tick={{ fontSize: 10, fill: O2D.sub }} allowDecimals={false} tickLine={false} axisLine={false} width={48} />
                    <YAxis yAxisId="flow" orientation="right" tick={{ fontSize: 10, fill: SERIES.out.color }} allowDecimals={false} tickLine={false} axisLine={false} width={40} />
                    <RTooltip content={<GraphTip unit={unit} />} />
                    {todayKey && (
                      <ReferenceLine yAxisId="stock" x={dayjs(todayKey).format('DD MMM')} stroke={O2D.faint} strokeDasharray="2 3"
                        label={{ value: 'Today', fontSize: 10, fill: O2D.sub, position: 'insideTopRight' }} />
                    )}
                    {m.reorderPoint > 0 && (
                      <ReferenceLine yAxisId="stock" y={m.reorderPoint} stroke={STOCK_TOKENS.REORDER.color} strokeDasharray="4 4"
                        label={{ value: `Reorder at ${num(m.reorderPoint)}`, fontSize: 10, fill: STOCK_TOKENS.REORDER.color, position: 'insideTopLeft' }} />
                    )}
                    {m.maxLevel > 0 && (
                      <ReferenceLine yAxisId="stock" y={m.maxLevel} stroke={STOCK_TOKENS.OK.color} strokeDasharray="4 4"
                        label={{ value: `Max Level ${num(m.maxLevel)}`, fontSize: 10, fill: STOCK_TOKENS.OK.color, position: 'insideTopLeft' }} />
                    )}
                    <Bar yAxisId="flow" dataKey="out" fill={SERIES.out.color} fillOpacity={0.8} maxBarSize={14} radius={[3, 3, 0, 0]} />
                    <Bar yAxisId="flow" dataKey="outForecast" fill={SERIES.out.color} fillOpacity={0.22} maxBarSize={14} radius={[3, 3, 0, 0]} />
                    <Area yAxisId="stock" type="linear" dataKey="actual" stroke={SERIES.actual.color} strokeWidth={2.5}
                      fill="url(#imsActualFill)" dot={false} connectNulls={false} isAnimationActive={false} />
                    <Line yAxisId="stock" type="linear" dataKey="forecast" stroke={SERIES.forecast.color} strokeWidth={2.25}
                      strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </Box>
            )}
            <Typography sx={{ fontSize: '0.68rem', color: O2D.faint, mt: 0.75 }}>
              Actual stock and units out come straight from this item's movements. The forecast assumes today's average daily
              use (last 90 days) continues, adds stock awaiting QC and material in transit when due, and nothing else arrives.
              {!loading && !hasHistory && ' This item has no movements in the selected period.'}
            </Typography>
          </Paper>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ borderTop: `1px solid ${O2D.lineSoft}`, px: 1.5, py: 1 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 700, color: O2D.body }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

const ImsStockList = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  // Available qty — below / above / between (QtyRangeFilter).
  const [qtyRange, setQtyRange] = useState(NO_QTY_RANGE);
  const [status, setStatus] = useState(params.get('status') || 'ALL');
  // A deep-linked card view sorts the way its card promises from the first render.
  const [sort, setSort] = useState(() => ({ 'in-stock': 'onhand', value: 'value' }[params.get('view')] || 'urgency'));
  // The row being edited — the Planning Policy dialog shows its code and name.
  const [editItem, setEditItem] = useState(null);
  // KPI-card views, kept in the URL so the Dashboard can deep-link to them:
  //   IN_STOCK  the Closing Stock card — only items with stock on hand
  //   VALUE     the Value in store card — only items holding value, highest first
  const [view, setView] = useState({ 'in-stock': 'IN_STOCK', value: 'VALUE' }[params.get('view')] || 'ALL');
  const [forecast, setForecast] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Deep links from the dashboard tiles land pre-filtered.
  useEffect(() => {
    const s = params.get('status');
    if (s && s !== status) setStatus(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const pickStatus = (s) => {
    setStatus(s);
    if (s === 'ALL') { params.delete('status'); } else { params.set('status', s); }
    setParams(params, { replace: true });
  };
  const pickView = (v) => {
    setView(v);
    const param = { IN_STOCK: 'in-stock', VALUE: 'value' }[v];
    if (param) params.set('view', param); else params.delete('view');
    setParams(params, { replace: true });
  };
  // KPI cards. Each one is a filter shortcut; clicking the active card again
  // turns its filter off.
  const showEverything = () => {
    setSearch(''); setCategory(''); setQtyRange(NO_QTY_RANGE); setSort('urgency');
    setStatus('ALL'); setView('ALL');
    params.delete('status'); params.delete('view');
    setParams(params, { replace: true });
  };
  const toggleInStock = () => {
    if (view === 'IN_STOCK') { pickView('ALL'); return; }
    pickView('IN_STOCK'); setSort('onhand');
  };
  const toggleValue = () => {
    if (view === 'VALUE') { pickView('ALL'); setSort('urgency'); return; }
    pickView('VALUE'); setSort('value');
  };
  const toggleLow = () => pickStatus(status === 'LOW' ? 'ALL' : 'LOW');

  const { data, isFetching } = useGetImsOverviewQuery({ search: search || undefined });
  const rows = useMemo(() => data?.data || [], [data]);
  const summary = data?.meta || {};
  // Options come from the classifications actually present in the result set.
  const categories = useMemo(() => {
    const seen = new Map();
    rows.forEach((r) => {
      const key = r.itemType || UNMAPPED_KEY;
      if (!seen.has(key)) seen.set(key, typeMeta(r.itemType).label);
    });
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const counts = useMemo(() => {
    const c = { ALL: rows.length };
    STOCK_ORDER.forEach((k) => { c[k] = rows.filter((r) => r.status === k).length; });
    return c;
  }, [rows]);

  // Urgency ranking mirrors the legend order, so "worst first" means the same
  // thing on this screen as it does on the dashboard.
  const urgency = (r) => STOCK_ORDER.indexOf(r.status);

  const filtered = useMemo(() => {
    const list = rows.filter((r) => (status === 'ALL' || r.status === status)
      && (view !== 'IN_STOCK' || Number(r.onHand || 0) > 0)
      && (view !== 'VALUE' || Number(r.stockValue || 0) > 0)
      && (!category || (r.itemType || UNMAPPED_KEY) === category)
      && matchesQtyRange(qtyRange, r.onHand));
    const sorters = {
      urgency: (a, b) => urgency(a) - urgency(b) || (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9),
      cover: (a, b) => (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9),
      name: (a, b) => (a.skuName || '').localeCompare(b.skuName || ''),
      code: (a, b) => (a.skuCode || '').localeCompare(b.skuCode || ''),
      onhand: (a, b) => Number(b.onHand || 0) - Number(a.onHand || 0),
      value: (a, b) => Number(b.stockValue || 0) - Number(a.stockValue || 0),
    };
    return [...list].sort(sorters[sort] || sorters.urgency);
  }, [rows, status, view, category, sort, qtyRange]);

  useEffect(() => { setPage(0); }, [search, category, status, view, sort, rowsPerPage, qtyRange]);
  const paged = useMemo(() => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [filtered, page, rowsPerPage]);

  const exportCsv = () => {
    // Column for column, the table on screen. The export used to run Lead Time
    // before Safety Factor and put Daily Consumption after Max Level, and to
    // call the Available Qty column "Closing Stock" — three ways for a reader
    // comparing the file with the screen to land on the wrong number.
    // Safety Factor and Lead Time come out blank for an item with no planning
    // policy, matching the "—" the table shows.
    const header = ['S.No.', 'SKU Code', 'Item Name', 'Category', 'Available Qty', 'Material In Transit',
      'Average Daily Consumption', 'Safety Factor', 'Daily Consumption', 'Lead Time (From Indent to Receipt)',
      'Reorder at', 'Max Level', 'Converted Item Name (For Resale)', 'Status',
      // Appended LAST so existing columns keep their positions (see RM export).
      'Awaiting QC'];
    const lines = filtered.map((r, i) => [i + 1, r.skuCode, r.skuName, typeMeta(r.itemType).label, r.onHand,
      r.inTransit, r.adc, r.hasPolicy ? r.safetyFactor : '', r.dailyConsumption ?? '',
      r.hasPolicy ? r.leadDays : '', r.reorderPoint, r.maxLevel, r.convertedItemNameForResale || '',
      stockToken(r.status).label, r.awaitingQc || 0]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `consumables-stock_${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const activeFilters = (status !== 'ALL' ? 1 : 0) + (view !== 'ALL' ? 1 : 0) + (category ? 1 : 0) + (search ? 1 : 0) + (qtyRange.mode ? 1 : 0);
  const inStockCount = useMemo(() => rows.filter((r) => Number(r.onHand || 0) > 0).length, [rows]);
  const valuedCount = useMemo(() => rows.filter((r) => Number(r.stockValue || 0) > 0).length, [rows]);
  const toOrder = (summary.reorder || 0) + (summary.outOfStock || 0);

  return (
    <ImsShell
      icon={Boxes}
      title="Stock & Master Data"
      subtitle="Every consumable and packaging item — the Closing Stock, and when to buy more."
      actions={(
        <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv}
          disabled={!filtered.length} sx={headerBtnSx}>
          Export
        </Button>
      )}
    >
      <KpiGrid>
        <KpiCard label="Items" value={num(summary.itemCount)} sub="Every item in the master list"
          tone={FLUENT.teal} icon={Boxes} actionLabel="Show all" onClick={showEverything}
          hint="Show every item — clears all filters." />
        <KpiCard label="Closing Stock" value={num(summary.totalOnHand)}
          sub={`Units in store · ${num(inStockCount)} item${inStockCount === 1 ? '' : 's'} hold stock`}
          tone={FLUENT.blue} icon={PackageOpen} actionLabel="In stock"
          active={view === 'IN_STOCK'} onClick={toggleInStock}
          hint="Show only items with stock on hand, highest first." />
        {/* Sums the same per-item Stock value the Dashboard's "Value in store"
            card totals, so the figure here and there always agree. */}
        <KpiCard label="Value in store" value={inr(summary.totalStockValue)}
          sub={`At last purchase cost · ${num(valuedCount)} item${valuedCount === 1 ? '' : 's'} hold value`}
          tone={FLUENT.grey} icon={IndianRupee} actionLabel="By value"
          active={view === 'VALUE'} onClick={toggleValue}
          hint="Rank the items holding value, highest stock value first." />
        {/* This card counts Out of stock + Order now together, so it opens the
            Buying List rather than a single-status filter that would show fewer
            rows than the number on the card. */}
        <KpiCard label="To order now" value={num(toOrder)} sub="Out of stock + at reorder point"
          tone={FLUENT.orange} icon={AlertTriangle} actionLabel="Buying List"
          onClick={() => navigate('/ims/reorder')}
          hint="Open the Buying List with how much to order for each." />
        <KpiCard label="Running low" value={num(summary.low)} sub="Watch these next"
          tone={FLUENT.amber} icon={TrendingDown} actionLabel="Filter"
          active={status === 'LOW'} onClick={toggleLow}
          hint="Show only items that are running low." />
      </KpiGrid>

      {/* ── Filters — one line, then the status legend doubling as a filter ── */}
      <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code, item or category…" sx={{ minWidth: { xs: '100%', sm: 260 }, flex: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
          <TextField select size="small" label="Category" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ minWidth: 170 }}>
            <MenuItem value="">All categories</MenuItem>
            {categories.map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
          </TextField>
          <QtyRangeFilter value={qtyRange} onChange={setQtyRange} />
          <TextField select size="small" label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)} sx={{ minWidth: 165 }}>
            <MenuItem value="urgency">Most urgent first</MenuItem>
            <MenuItem value="cover">Least days of cover</MenuItem>
            <MenuItem value="onhand">Highest stock</MenuItem>
            <MenuItem value="value">Highest stock value</MenuItem>
            <MenuItem value="name">Item name (A–Z)</MenuItem>
            <MenuItem value="code">Item code</MenuItem>
          </TextField>
          <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, whiteSpace: 'nowrap', ml: 'auto' }}>
            <b>{filtered.length}</b> of {rows.length}
          </Typography>
          {activeFilters > 0 && (
            <Button size="small" startIcon={<X size={12} />}
              onClick={showEverything}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.body }}>
              Clear ({activeFilters})
            </Button>
          )}
        </Stack>

        <Box sx={{ mt: 1, pt: 1, borderTop: `1px solid ${O2D.lineSoft}` }}>
          <StatusLegend counts={counts} value={status} onPick={pickStatus} />
        </Box>

      </Paper>

      <Panel dense>
        <TableScroll>
          <Table size="small" sx={fluentTableSx(1120, { zebra: false })}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell><Th label="SKU Code" hint={H.skuCode} /></TableCell>
                <TableCell><Th label="Item Name" hint={H.skuName} /></TableCell>
                <TableCell><Th label="Category" hint={H.category} /></TableCell>
                <TableCell align="right"><Th label="Available Qty" hint={H.onHand} /></TableCell>
                <TableCell align="right"><Th label="Material In Transit" hint={H.inTransit} /></TableCell>
                <TableCell align="right"><Th label="Average Daily Consumption" hint={H.adc} /></TableCell>
                {/* Safety Factor sits at column 8 (counting S.No. as 1) in every
                    IMS stock list, so a planner finds it in the same place
                    whichever module they are in. */}
                <TableCell align="right"><Th label="Safety Factor" hint={H.safetyFactor} /></TableCell>
                <TableCell align="right"><Th label="Daily Consumption" hint={H.dailyConsumption} /></TableCell>
                <TableCell align="right"><Th label="Lead Time (From Indent to Receipt)" hint={H.leadDays} /></TableCell>
                <TableCell align="right"><Th label="Reorder at" hint={H.reorderPoint} /></TableCell>
                <TableCell align="right"><Th label="Max Level" hint={H.maxLevel} /></TableCell>
                <TableCell><Th label="Converted Item Name (For Resale)" hint={H.convertedItemName} /></TableCell>
                <TableCell align="center"><Th label="Status" hint={H.status} /></TableCell>
                <TableCell align="center" />
              </TableRow>
            </TableHead>
            <TableBody>
              {isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={15} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={260} /></TableCell></TableRow>
              )}
              {!isFetching && filtered.length === 0 && (
                <TableRow><TableCell colSpan={15} sx={{ border: 0 }}>
                  <EmptyNote icon={Boxes} title="No items match these filters"
                    hint="Try clearing the status filter or searching for a different code." />
                </TableCell></TableRow>
              )}
              {paged.map((r, i) => {
                return (
                  <TableRow key={r.skuId} hover data-status={r.status} sx={{
                    cursor: 'pointer',
                    // Problem rows carry a soft pastel wash and a muted left edge,
                    // so they're findable while scrolling without a wall of red.
                    ...statusRowSx(r.status),
                    '&:hover .row-go': { opacity: 1, transform: 'translateX(0)' },
                  }} onClick={() => navigate(`/ims/item/${r.skuId}`)}>
                    {/* Derived from the page offset, not the array index, so page 2
                        continues at 26 rather than restarting at 1. Purely
                        presentational — it feeds no filter, sort or calculation. */}
                    <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>
                      {page * rowsPerPage + i + 1}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: O2D.brand, whiteSpace: 'nowrap' }}>{r.skuCode}</TableCell>
                    <TableCell sx={{ maxWidth: 250 }}>
                      <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.ink }} title={r.skuName}>{r.skuName}</Typography>
                      {!r.hasPolicy && (
                        <Tooltip arrow slotProps={O2D_TIP} title="Without a planning policy IMS cannot work out a reorder point. Click the pencil to set one.">
                          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: STOCK_TOKENS.LOW.color, cursor: 'help' }}>
                            No planning policy set
                          </Typography>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell><CategoryChip itemType={r.itemType} /></TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: O2D.ink, whiteSpace: 'nowrap' }}>
                      {num(r.onHand)}
                      {/* The IMS stock unit — for a SKU bought in boxes this is still PCS. */}
                      {r.unit ? <Box component="span" sx={{ ml: 0.5, fontWeight: 600, fontSize: '0.72rem', color: O2D.sub }}>{r.unit}</Box> : null}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.inTransit ? O2D.body : O2D.faint }}>
                      {r.inTransit ? num(r.inTransit) : '—'}
                      <AwaitingQcNote qty={r.awaitingQc} grnNumbers={r.awaitingQcGrnNumbers} fmt={num} />
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {r.adc ? (
                        <Tooltip arrow slotProps={O2D_TIP}
                          title={`${num(r.consumption90dQty)} units consumed over the last ${num(r.consumption90dDays)} days across ${num(r.consumption90dEvents)} movement(s) — ${num(r.consumption90dQty)} ÷ ${num(r.consumption90dDays)}.`}>
                          <span>{num(r.adc)}</span>
                        </Tooltip>
                      ) : '—'}
                    </TableCell>
                    {/* A policy figure. An item with no policy has none, so it
                        shows "—" rather than the system default dressed up as a
                        configured value. The backend fallback is untouched. */}
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {r.hasPolicy ? `${num(r.safetyFactor)}×` : <NotConfigured />}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: r.dailyConsumption == null ? O2D.faint : O2D.ink }}>
                      {r.dailyConsumption == null ? '—' : (
                        <Tooltip arrow slotProps={O2D_TIP}
                          title={`${num(r.dailyConsumption)} unit(s) issued today across ${num(r.consumptionTodayEvents)} movement(s).`}>
                          <span>{num(r.dailyConsumption)}</span>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {r.hasPolicy ? `${num(r.leadDays)}d` : <NotConfigured />}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.reorderPoint)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {r.maxLevelMode === 'MANUAL' ? (
                        // Flagged, because this one does NOT follow the Safety Factor.
                        <Tooltip arrow slotProps={O2D_TIP}
                          title={`Manually overridden. The formula would give ${num(r.formulaMaxLevel)} — changing the Safety Factor will not affect this value.`}>
                          <Box component="span" sx={{ cursor: 'help', borderBottom: `1px dotted ${O2D.sub}` }}>
                            {num(r.maxLevel)}<Box component="span" sx={{ fontSize: '0.6rem', fontWeight: 800, color: O2D.sub, ml: 0.4 }}>M</Box>
                          </Box>
                        </Tooltip>
                      ) : num(r.maxLevel)}
                    </TableCell>
                    {/* SKU master data. Deliberately r.convertedItemNameForResale,
                        never the legacy InventoryPolicy copy — SKU Master is the
                        source of truth and the only place this is editable. */}
                    <TableCell sx={{ maxWidth: 230 }}>
                      {r.convertedItemNameForResale ? (
                        <Tooltip arrow slotProps={O2D_TIP} title={r.convertedItemNameForResale}>
                          <Typography noWrap sx={{ fontSize: '0.8rem', color: O2D.body }}>{r.convertedItemNameForResale}</Typography>
                        </Tooltip>
                      ) : <Typography sx={{ fontSize: '0.8rem', color: O2D.faint }}>—</Typography>}
                    </TableCell>
                    <TableCell align="center"><StatusChip status={r.status} /></TableCell>
                    <TableCell align="center" sx={{ width: 108, whiteSpace: 'nowrap' }}>
                      <Stack direction="row" spacing={0.25} justifyContent="center" alignItems="center">
                        <Tooltip arrow slotProps={O2D_TIP} title="Graph — actual stock and consumption, and the forecast">
                          <IconButton size="small" aria-label={`Graph for ${r.skuCode}`} onClick={(e) => { e.stopPropagation(); setForecast(r); }}
                            sx={{ color: O2D.sub, '&:hover': { color: O2D.brand, bgcolor: alpha(O2D.brand, 0.08) } }}>
                            <LineChartIcon size={15} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip arrow slotProps={O2D_TIP} title="Edit the planning policy (Lead Time, Safety Factor, MOQ)">
                          <IconButton size="small" aria-label={`Edit planning policy for ${r.skuCode}`} onClick={(e) => { e.stopPropagation(); setEditItem(r); }}
                            sx={{ color: O2D.sub, '&:hover': { color: O2D.brand, bgcolor: alpha(O2D.brand, 0.08) } }}>
                            <Pencil size={15} />
                          </IconButton>
                        </Tooltip>
                        <Box className="row-go" sx={{
                          display: 'inline-flex', color: O2D.brand, opacity: 0,
                          transform: 'translateX(-4px)', transition: 'opacity .15s, transform .15s',
                        }}>
                          <ChevronRight size={16} />
                        </Box>
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
        {/* Footer row: colour key on the left, pagination on the far right.
            flexWrap lets the two drop onto separate lines on tablet/mobile
            instead of forcing the panel to scroll sideways. */}
        <Box sx={{
          borderTop: `1px solid ${O2D.lineSoft}`,
          display: 'flex', flexWrap: 'wrap', alignItems: 'center',
          justifyContent: 'space-between', columnGap: 2, rowGap: 0.5, pl: { xs: 1, sm: 1.5 },
        }}>
          <ColorCodingLegend />
          <TablePagination
            component="div" count={filtered.length} page={page} onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="Items per page:"
            sx={{ borderTop: 0, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } }}
          />
        </Box>
      </Panel>

      <PolicyDialog skuId={editItem?.skuId || null} item={editItem} onClose={() => setEditItem(null)} />
      <ForecastDialog item={forecast} onClose={() => setForecast(null)} />
    </ImsShell>
  );
};

export default ImsStockList;
