import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, IconButton, Chip, Table, TableHead, TableBody, TableRow,
  TableCell, Skeleton, alpha, useTheme, TablePagination, Divider, ToggleButtonGroup, ToggleButton, Tooltip,
  Tabs, Tab, TextField, FormControlLabel, Switch,
} from '@mui/material';
import {
  ArrowLeft, Pencil, ArrowDownLeft, ArrowUpRight, Boxes, Clock, History, Download, LineChart as LineChartIcon,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, ReferenceLine, CartesianGrid,
} from 'recharts';
import dayjs from 'dayjs';
import { useParams, useNavigate } from 'react-router-dom';
import { StatusChip, num, inr } from './imsMeta';
import { useGetImsForecastQuery, useGetImsMovementsQuery, useGetImsHistoryQuery } from '../../store/api/imsApi';
import PolicyDrawer from './PolicyDrawer';

const TXN_LABEL = {
  GRN_IN: 'GRN receipt', OPENING: 'Opening', ADJUST_IN: 'Stock-in', ADJUST_OUT: 'Adjust out',
  CONSUME_OUT: 'Production issue', QC_REJECT_OUT: 'QC reject', RETURN_OUT: 'Return',
  TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out', DISPATCH_OUT: 'Dispatch',
};

const Metric = ({ label, value, color }) => (
  <Box sx={{ px: 1.5, py: 1, borderRadius: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', minWidth: 110 }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
    <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: color || 'text.primary' }}>{value}</Typography>
  </Box>
);

const SummaryPill = ({ label, value, color }) => (
  <Box sx={{ px: 1.25, py: 0.75, borderRadius: 2, border: '1px solid', borderColor: 'divider', minWidth: 92 }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>{label}</Typography>
    <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', color: color || 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
  </Box>
);

const RANGE_PRESETS = [
  { days: 15, label: '15d' }, { days: 30, label: '30d' }, { days: 60, label: '60d' }, { days: 90, label: '90d' },
];

// ── Stock history (the Excel sheet's dated closing-stock columns, vertical & filterable) ──
const StockHistory = ({ skuId }) => {
  const theme = useTheme();
  const today = dayjs().format('YYYY-MM-DD');
  const [preset, setPreset] = useState(30);
  const [from, setFrom] = useState(dayjs().subtract(29, 'day').format('YYYY-MM-DD'));
  const [to, setTo] = useState(today);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(15);

  const applyPreset = (n) => {
    if (!n) return;
    setPreset(n);
    setFrom(dayjs().subtract(n - 1, 'day').format('YYYY-MM-DD'));
    setTo(dayjs().format('YYYY-MM-DD'));
    setPage(0);
  };
  const onFrom = (v) => { setPreset(0); setFrom(v); setPage(0); };
  const onTo = (v) => { setPreset(0); setTo(v); setPage(0); };

  const { data, isFetching } = useGetImsHistoryQuery({ skuId, from, to }, { skip: !skuId });
  const res = data?.data;
  const days = useMemo(() => res?.days || [], [res]);
  const summary = res?.summary || {};
  const metrics = res?.metrics || {};

  const chart = useMemo(() => days.map((d) => ({ ...d, label: dayjs(d.date).format('DD MMM') })), [days]);
  // Table reads newest-first; "only changes" hides the carried-forward flat days.
  const tableDays = useMemo(() => {
    const list = onlyChanges ? days.filter((d) => d.movementCount > 0) : days;
    return [...list].reverse();
  }, [days, onlyChanges]);

  useEffect(() => { setPage(0); }, [onlyChanges]);
  const paged = useMemo(
    () => tableDays.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [tableDays, page, rowsPerPage],
  );

  const exportCsv = () => {
    const header = ['Date', 'Opening', 'In', 'Out', 'Net', 'Closing'];
    const lines = days.map((d) => [d.date, d.opening, d.inQty, d.outQty, d.net, d.closing].join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-history_${res?.sku?.skuCode || skuId}_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
      {/* Filter bar */}
      <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <History size={18} color={theme.palette.primary.main} />
          <Typography sx={{ fontWeight: 800 }}>Stock history</Typography>
          <Typography variant="caption" color="text.secondary">end-of-day closing balance, per day</Typography>
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="outlined" startIcon={<Download size={15} />} onClick={exportCsv} disabled={!days.length}>
            Export CSV
          </Button>
        </Stack>
        <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
          <ToggleButtonGroup size="small" exclusive value={preset} onChange={(_, v) => applyPreset(v)}>
            {RANGE_PRESETS.map((p) => <ToggleButton key={p.days} value={p.days}>{p.label}</ToggleButton>)}
          </ToggleButtonGroup>
          <TextField size="small" type="date" label="From" value={from} onChange={(e) => onFrom(e.target.value)}
            InputLabelProps={{ shrink: true }} inputProps={{ max: to }} sx={{ width: 165 }} />
          <TextField size="small" type="date" label="To" value={to} onChange={(e) => onTo(e.target.value)}
            InputLabelProps={{ shrink: true }} inputProps={{ min: from, max: today }} sx={{ width: 165 }} />
          <FormControlLabel
            control={<Switch size="small" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />}
            label={<Typography variant="caption">Only days with movement</Typography>}
          />
        </Stack>
        {/* Summary pills */}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
          <SummaryPill label="Opening" value={num(summary.openingBalance)} />
          <SummaryPill label="Total in" value={`+${num(summary.totalIn)}`} color={theme.palette.success.main} />
          <SummaryPill label="Total out" value={`−${num(summary.totalOut)}`} color={theme.palette.error.main} />
          <SummaryPill label="Closing" value={num(summary.closingBalance)} color={theme.palette.primary.main} />
          <SummaryPill label="Peak" value={num(summary.peak)} />
          <SummaryPill label="Low" value={num(summary.low)} color={summary.low <= 0 ? theme.palette.error.main : undefined} />
          <SummaryPill label="Active days" value={`${num(summary.daysWithMovement)} / ${num(res?.range?.dayCount)}`} />
        </Stack>
      </Box>

      {/* History chart */}
      <Box sx={{ p: 2, pb: 0.5 }}>
        {isFetching && !days.length ? <Skeleton variant="rounded" height={240} /> : (
          <Box sx={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="imsHistFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={theme.palette.primary.main} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={theme.palette.primary.main} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={28} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <RTooltip formatter={(v) => num(v)} labelFormatter={(l) => `Closing — ${l}`} />
                {metrics.reorderPoint > 0 && (
                  <ReferenceLine y={metrics.reorderPoint} stroke={theme.palette.warning.main} strokeDasharray="4 4"
                    label={{ value: 'Reorder', fontSize: 10, fill: theme.palette.warning.main }} />
                )}
                {metrics.maxLevel > 0 && (
                  <ReferenceLine y={metrics.maxLevel} stroke={theme.palette.success.main} strokeDasharray="4 4"
                    label={{ value: 'Max', fontSize: 10, fill: theme.palette.success.main }} />
                )}
                <Area type="monotone" dataKey="closing" stroke={theme.palette.primary.main} strokeWidth={2.5}
                  fill="url(#imsHistFill)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        )}
      </Box>

      {/* Daily ledger table */}
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 720 }}>
          <TableHead>
            <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
              {['Date', 'Opening', 'In', 'Out', 'Net', 'Closing', 'Status'].map((h, i) => (
                <TableCell key={h} align={[1, 2, 3, 4, 5].includes(i) ? 'right' : 'left'}
                  sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {isFetching && !days.length && (
              <TableRow><TableCell colSpan={7}><Skeleton variant="rounded" height={160} /></TableCell></TableRow>
            )}
            {!isFetching && tableDays.length === 0 && (
              <TableRow><TableCell colSpan={7} sx={{ textAlign: 'center', py: 5, color: 'text.disabled' }}>No history in this window.</TableCell></TableRow>
            )}
            {paged.map((d) => {
              const statusColor = d.stockOut ? theme.palette.error.main : d.belowReorder ? theme.palette.warning.main : null;
              return (
                <TableRow key={d.date} hover sx={{ bgcolor: d.movementCount > 0 ? alpha(theme.palette.primary.main, 0.025) : 'inherit' }}>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{dayjs(d.date).format('ddd, DD MMM YYYY')}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>{num(d.opening)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: d.inQty ? 'success.main' : 'text.disabled', fontWeight: d.inQty ? 700 : 400 }}>
                    {d.inQty ? `+${num(d.inQty)}` : '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: d.outQty ? 'error.main' : 'text.disabled', fontWeight: d.outQty ? 700 : 400 }}>
                    {d.outQty ? `−${num(d.outQty)}` : '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: d.net > 0 ? 'success.main' : d.net < 0 ? 'error.main' : 'text.disabled' }}>
                    {d.net === 0 ? '—' : `${d.net > 0 ? '+' : '−'}${num(Math.abs(d.net))}`}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: statusColor || 'text.primary' }}>{num(d.closing)}</TableCell>
                  <TableCell>
                    {d.stockOut
                      ? <Chip size="small" label="Out of stock" sx={{ height: 20, fontWeight: 700, bgcolor: alpha(theme.palette.error.main, 0.12), color: theme.palette.error.dark }} />
                      : d.belowReorder
                        ? <Chip size="small" label="Below reorder" sx={{ height: 20, fontWeight: 700, bgcolor: alpha(theme.palette.warning.main, 0.14), color: theme.palette.warning.dark }} />
                        : <Typography variant="caption" color="text.disabled">OK</Typography>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
      <TablePagination
        component="div"
        count={tableDays.length}
        page={page}
        onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
        rowsPerPageOptions={[15, 30, 60, 100]}
        labelRowsPerPage="Days:"
      />
    </Paper>
  );
};

// ── Forward stock projection (existing burn-down) ──
const StockForecast = ({ skuId }) => {
  const theme = useTheme();
  const [days, setDays] = useState(30);
  const { data: fcRes, isFetching: fcLoading } = useGetImsForecastQuery({ skuId, days });
  const fc = fcRes?.data;
  const m = fc?.metrics || {};
  const series = (fc?.series || []).map((p) => ({ ...p, label: dayjs(p.date).format('DD MMM') }));

  return (
    <Paper sx={{ p: 2.5, borderRadius: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <LineChartIcon size={18} color={theme.palette.primary.main} />
          <Typography sx={{ fontWeight: 800 }}>Stock projection</Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip size="small" color={fc?.reorderDay != null ? 'warning' : 'default'}
            label={fc?.reorderDay != null ? `Reorder in ~${fc.reorderDay}d` : 'No reorder in window'} />
          <Chip size="small" color={fc?.stockoutDay != null ? 'error' : 'success'}
            label={fc?.stockoutDay != null ? `Stock-out in ~${fc.stockoutDay}d` : 'No stock-out in window'} />
          <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)}>
            {[15, 30, 60, 90].map((d) => <ToggleButton key={d} value={d}>{d}d</ToggleButton>)}
          </ToggleButtonGroup>
        </Stack>
      </Stack>
      {fcLoading ? <Skeleton variant="rounded" height={260} /> : (
        <Box sx={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <RTooltip />
              <ReferenceLine y={m.reorderPoint} stroke={theme.palette.warning.main} strokeDasharray="4 4" label={{ value: 'Reorder', fontSize: 10, fill: theme.palette.warning.main }} />
              <ReferenceLine y={m.maxLevel} stroke={theme.palette.success.main} strokeDasharray="4 4" label={{ value: 'Max', fontSize: 10, fill: theme.palette.success.main }} />
              <Line type="monotone" dataKey="projected" stroke={theme.palette.primary.main} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Paper>
  );
};

// ── In/Out movement ledger (existing) ──
const MovementHistory = ({ skuId }) => {
  const theme = useTheme();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const { data: mvRes, isFetching: mvLoading } = useGetImsMovementsQuery({ skuId, sort: '-movementDate', limit: 500 });
  const movements = useMemo(() => mvRes?.data || [], [mvRes]);
  const paged = useMemo(() => movements.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [movements, page, rowsPerPage]);

  return (
    <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
      <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}`, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Clock size={18} color={theme.palette.primary.main} />
        <Typography sx={{ fontWeight: 800 }}>In / Out movements</Typography>
        <Chip size="small" label={`${movements.length} movements`} sx={{ ml: 1 }} />
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 980 }}>
          <TableHead>
            <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
              {['Date', 'Recorded at', 'Type', 'Qty', 'Balance', 'By', 'Source / Ref', 'Details'].map((h, i) => (
                <TableCell key={h} align={[3, 4].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {mvLoading && movements.length === 0 && (
              <TableRow><TableCell colSpan={8}><Skeleton variant="rounded" height={200} /></TableCell></TableRow>
            )}
            {!mvLoading && movements.length === 0 && (
              <TableRow><TableCell colSpan={8} sx={{ textAlign: 'center', py: 5, color: 'text.disabled' }}>No movements recorded for this item yet.</TableCell></TableRow>
            )}
            {paged.map((mv) => {
              const isIn = mv.movementType === 'IN';
              const ref = [mv.refNumber, mv.poNumber, mv.vendorName].filter(Boolean).join(' · ');
              return (
                <TableRow key={mv._id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{dayjs(mv.movementDate).format('DD MMM YYYY')}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="caption" color="text.secondary">{dayjs(mv.createdAt || mv.movementDate).format('DD MMM, HH:mm')}</Typography>
                    <Typography variant="caption" sx={{ display: 'block', fontFamily: 'ui-monospace, monospace', opacity: 0.7 }}>{mv.movementNumber}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip size="small" icon={isIn ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                      label={TXN_LABEL[mv.txnType] || mv.txnType}
                      sx={{ height: 22, fontWeight: 700, bgcolor: alpha(isIn ? theme.palette.success.main : theme.palette.error.main, 0.12), color: isIn ? theme.palette.success.dark : theme.palette.error.dark }} />
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: isIn ? 'success.main' : 'error.main' }}>
                    {isIn ? '+' : '−'}{num(mv.quantity)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{num(mv.balanceAfter)}</TableCell>
                  <TableCell><Typography variant="caption">{mv.performedByName || '—'}</Typography></TableCell>
                  <TableCell sx={{ maxWidth: 180 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{mv.sourceModule || '—'}</Typography>
                    {ref && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap title={ref}>{ref}</Typography>}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 260 }}><Typography variant="caption" color="text.secondary" noWrap title={mv.remarks}>{mv.remarks || '—'}</Typography></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
      <TablePagination
        component="div"
        count={movements.length}
        page={page}
        onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
        rowsPerPageOptions={[10, 25, 50, 100]}
        labelRowsPerPage="Rows:"
      />
    </Paper>
  );
};

const ImsItemDetail = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { skuId } = useParams();
  const [editSku, setEditSku] = useState(null);
  const [tab, setTab] = useState('history');

  // Lightweight fetch just for the header metrics strip (reuses the forecast snapshot).
  const { data: fcRes, isFetching: fcLoading } = useGetImsForecastQuery({ skuId, days: 30 });
  const fc = fcRes?.data;
  const sku = fc?.sku;
  const m = fc?.metrics || {};

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Header */}
      <Box sx={{ color: '#fff', px: { xs: 2, md: 4 }, pt: 3, pb: 5,
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)' }}>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/ims/stock')}
          sx={{ color: 'rgba(255,255,255,0.9)', mb: 1.5 }}>Back to Stock</Button>
        {fcLoading && !sku ? <Skeleton variant="text" width={280} sx={{ bgcolor: 'rgba(255,255,255,0.2)' }} /> : (
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" useFlexGap>
            <Stack direction="row" spacing={2} alignItems="center">
              <Box sx={{ width: 48, height: 48, borderRadius: 2.5, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.14)' }}>
                <Boxes size={24} color="#fff" />
              </Box>
              <Box>
                <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.3rem', md: '1.7rem' }, lineHeight: 1.1 }}>{sku?.skuName}</Typography>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                  <Typography sx={{ fontFamily: 'ui-monospace, monospace', color: 'rgba(255,255,255,0.85)' }}>{sku?.skuCode}</Typography>
                  {sku?.category && <Chip size="small" label={sku.category} sx={{ height: 20, bgcolor: 'rgba(255,255,255,0.16)', color: '#fff' }} />}
                  <StatusChip status={m.status} />
                </Stack>
              </Box>
            </Stack>
            <Button variant="contained" startIcon={<Pencil size={15} />} onClick={() => setEditSku(skuId)}
              sx={{ bgcolor: 'rgba(255,255,255,0.18)', '&:hover': { bgcolor: 'rgba(255,255,255,0.28)' } }}>
              Edit policy
            </Button>
          </Stack>
        )}
      </Box>

      <Box sx={{ px: { xs: 2, md: 4 }, mt: -3, position: 'relative', pb: 6 }}>
        {/* Metrics */}
        <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
          <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
            <Metric label="On hand" value={num(m.onHand)} color={theme.palette.primary.main} />
            <Metric label="In transit" value={num(m.inTransit)} />
            <Metric label="ADC / day" value={num(m.adc)} />
            <Metric label="Lead (days)" value={num(m.leadDays)} />
            <Metric label="Safety factor" value={num(m.safetyFactor)} />
            <Metric label="Reorder pt" value={num(m.reorderPoint)} />
            <Metric label="Max level" value={num(m.maxLevel)} />
            <Metric label="Days cover" value={m.daysCover == null ? '—' : `${num(m.daysCover)}d`} color={m.daysCover != null && m.daysCover < m.leadDays ? theme.palette.error.main : undefined} />
            <Metric label="Suggested order" value={num(m.suggestedOrderQty)} color={theme.palette.warning.dark} />
            <Metric label="Stock value" value={inr(m.stockValue)} />
          </Stack>
        </Paper>

        {/* Tabbed views: history (default), projection, movements */}
        <Paper sx={{ borderRadius: 3, mb: 2 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
            sx={{ px: 1, borderBottom: `1px solid ${theme.palette.divider}`, minHeight: 48 }}>
            <Tab value="history" iconPosition="start" icon={<History size={16} />} label="Stock history" sx={{ minHeight: 48, textTransform: 'none', fontWeight: 700 }} />
            <Tab value="forecast" iconPosition="start" icon={<LineChartIcon size={16} />} label="Projection" sx={{ minHeight: 48, textTransform: 'none', fontWeight: 700 }} />
            <Tab value="movements" iconPosition="start" icon={<Clock size={16} />} label="Movements" sx={{ minHeight: 48, textTransform: 'none', fontWeight: 700 }} />
          </Tabs>
        </Paper>

        {tab === 'history' && <StockHistory skuId={skuId} />}
        {tab === 'forecast' && <StockForecast skuId={skuId} />}
        {tab === 'movements' && <MovementHistory skuId={skuId} />}
      </Box>

      <PolicyDrawer skuId={editSku} onClose={() => setEditSku(null)} />
    </Box>
  );
};

export default ImsItemDetail;
