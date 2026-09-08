import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, Chip, Table, TableHead, TableBody, TableRow,
  TableCell, Skeleton, alpha, useTheme, TablePagination, ToggleButtonGroup, ToggleButton,
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
import { useSmartBack } from '../../hooks/useSmartBack';
import { StatusChip, num, inr, TXN_LABEL, ROWS_PER_PAGE } from './fgImsMeta';
import { useGetFgForecastQuery, useGetFgMovementsQuery, useGetFgHistoryQuery } from '../../store/api/fgImsApi';
import FgPolicyDrawer from './FgPolicyDrawer';

const ACCENT = '#059669';

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

const RANGE_PRESETS = [{ days: 15, label: '15d' }, { days: 30, label: '30d' }, { days: 60, label: '60d' }, { days: 90, label: '90d' }];

// ── Stock history (dated closing-stock columns, vertical & filterable) ──
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

  const { data, isFetching } = useGetFgHistoryQuery({ skuId, from, to }, { skip: !skuId });
  const res = data?.data;
  const days = useMemo(() => res?.days || [], [res]);
  const summary = res?.summary || {};
  const metrics = res?.metrics || {};

  const chart = useMemo(() => days.map((dd) => ({ ...dd, label: dayjs(dd.date).format('DD MMM') })), [days]);
  const tableDays = useMemo(() => {
    const list = onlyChanges ? days.filter((dd) => dd.movementCount > 0) : days;
    return [...list].reverse();
  }, [days, onlyChanges]);

  useEffect(() => { setPage(0); }, [onlyChanges]);
  const paged = useMemo(() => tableDays.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [tableDays, page, rowsPerPage]);

  const exportCsv = () => {
    const header = ['Date', 'Opening', 'In', 'Out', 'Net', 'Closing'];
    const lines = days.map((dd) => [dd.date, dd.opening, dd.inQty, dd.outQty, dd.net, dd.closing].join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fg-stock-history_${res?.sku?.skuCode || skuId}_${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
      <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <History size={18} color={ACCENT} />
          <Typography sx={{ fontWeight: 800 }}>Stock history</Typography>
          <Typography variant="caption" color="text.secondary">end-of-day closing balance, per day</Typography>
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="outlined" startIcon={<Download size={15} />} onClick={exportCsv} disabled={!days.length}>Export CSV</Button>
        </Stack>
        <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
          <ToggleButtonGroup size="small" exclusive value={preset} onChange={(_, v) => applyPreset(v)}>
            {RANGE_PRESETS.map((p) => <ToggleButton key={p.days} value={p.days}>{p.label}</ToggleButton>)}
          </ToggleButtonGroup>
          <TextField size="small" type="date" label="From" value={from} onChange={(e) => onFrom(e.target.value)}
            InputLabelProps={{ shrink: true }} inputProps={{ max: to }} sx={{ width: 165 }} />
          <TextField size="small" type="date" label="To" value={to} onChange={(e) => onTo(e.target.value)}
            InputLabelProps={{ shrink: true }} inputProps={{ min: from, max: today }} sx={{ width: 165 }} />
          <FormControlLabel control={<Switch size="small" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />}
            label={<Typography variant="caption">Only days with movement</Typography>} />
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
          <SummaryPill label="Opening" value={num(summary.openingBalance)} />
          <SummaryPill label="Total in" value={`+${num(summary.totalIn)}`} color="#047857" />
          <SummaryPill label="Total out" value={`−${num(summary.totalOut)}`} color={theme.palette.error.main} />
          <SummaryPill label="Closing" value={num(summary.closingBalance)} color={ACCENT} />
          <SummaryPill label="Peak" value={num(summary.peak)} />
          <SummaryPill label="Low" value={num(summary.low)} color={summary.low <= 0 ? theme.palette.error.main : undefined} />
          <SummaryPill label="Active days" value={`${num(summary.daysWithMovement)} / ${num(res?.range?.dayCount)}`} />
        </Stack>
      </Box>

      <Box sx={{ p: 2, pb: 0.5 }}>
        {isFetching && !days.length ? <Skeleton variant="rounded" height={240} /> : (
          <Box sx={{ height: 250 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="fgHistFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ACCENT} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
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
                  <ReferenceLine y={metrics.maxLevel} stroke={ACCENT} strokeDasharray="4 4"
                    label={{ value: 'Target', fontSize: 10, fill: ACCENT }} />
                )}
                <Area type="monotone" dataKey="closing" stroke={ACCENT} strokeWidth={2.5} fill="url(#fgHistFill)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        )}
      </Box>

      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 720 }}>
          <TableHead>
            <TableRow sx={{ bgcolor: alpha(ACCENT, 0.06) }}>
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
            {paged.map((dd) => {
              const statusColor = dd.stockOut ? theme.palette.error.main : dd.belowReorder ? theme.palette.warning.main : null;
              return (
                <TableRow key={dd.date} hover sx={{ bgcolor: dd.movementCount > 0 ? alpha(ACCENT, 0.04) : 'inherit' }}>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{dayjs(dd.date).format('ddd, DD MMM YYYY')}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>{num(dd.opening)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: dd.inQty ? '#047857' : 'text.disabled', fontWeight: dd.inQty ? 700 : 400 }}>
                    {dd.inQty ? `+${num(dd.inQty)}` : '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: dd.outQty ? 'error.main' : 'text.disabled', fontWeight: dd.outQty ? 700 : 400 }}>
                    {dd.outQty ? `−${num(dd.outQty)}` : '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: dd.net > 0 ? '#047857' : dd.net < 0 ? 'error.main' : 'text.disabled' }}>
                    {dd.net === 0 ? '—' : `${dd.net > 0 ? '+' : '−'}${num(Math.abs(dd.net))}`}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: statusColor || 'text.primary' }}>{num(dd.closing)}</TableCell>
                  <TableCell>
                    {dd.stockOut
                      ? <Chip size="small" label="Out of stock" sx={{ height: 20, fontWeight: 700, bgcolor: alpha(theme.palette.error.main, 0.12), color: theme.palette.error.dark }} />
                      : dd.belowReorder
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
        component="div" count={tableDays.length} page={page} onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
        rowsPerPageOptions={[15, 30, 60, 100]} labelRowsPerPage="Days:"
      />
    </Paper>
  );
};

// ── Forward demand projection ──
const StockForecast = ({ skuId }) => {
  const theme = useTheme();
  const [days, setDays] = useState(30);
  const { data: fcRes, isFetching: fcLoading } = useGetFgForecastQuery({ skuId, days });
  const fc = fcRes?.data;
  const m = fc?.metrics || {};
  const series = (fc?.series || []).map((p) => ({ ...p, label: dayjs(p.date).format('DD MMM') }));

  return (
    <Paper sx={{ p: 2.5, borderRadius: 3 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <LineChartIcon size={18} color={ACCENT} />
          <Typography sx={{ fontWeight: 800 }}>Demand projection</Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip size="small" color={fc?.reorderDay != null ? 'warning' : 'default'}
            label={fc?.reorderDay != null ? `Produce in ~${fc.reorderDay}d` : 'No reorder in window'} />
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
              <ReferenceLine y={m.maxLevel} stroke={ACCENT} strokeDasharray="4 4" label={{ value: 'Target', fontSize: 10, fill: ACCENT }} />
              <Line type="monotone" dataKey="projected" stroke={ACCENT} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Paper>
  );
};

// ── In/Out movement ledger ──
const MovementHistory = ({ skuId }) => {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const { data: mvRes, isFetching: mvLoading } = useGetFgMovementsQuery({ skuId, limit: 500 });
  const movements = useMemo(() => mvRes?.data || [], [mvRes]);
  const paged = useMemo(() => movements.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [movements, page, rowsPerPage]);

  return (
    <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
      <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Clock size={18} color={ACCENT} />
        <Typography sx={{ fontWeight: 800 }}>In / Out movements</Typography>
        <Chip size="small" label={`${movements.length} movements`} sx={{ ml: 1 }} />
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 980 }}>
          <TableHead>
            <TableRow sx={{ bgcolor: alpha(ACCENT, 0.06) }}>
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
              const ref = [mv.refNumber, mv.batchNo].filter(Boolean).join(' · ');
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
                      sx={{ height: 22, fontWeight: 700, bgcolor: alpha(isIn ? '#059669' : '#dc2626', 0.12), color: isIn ? '#047857' : '#b91c1c' }} />
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: isIn ? '#047857' : '#dc2626' }}>
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
        component="div" count={movements.length} page={page} onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
        rowsPerPageOptions={ROWS_PER_PAGE} labelRowsPerPage="Rows:"
      />
    </Paper>
  );
};

const FgImsItemDetail = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const goBack = useSmartBack('/fg-ims/stock');
  const { skuId } = useParams();
  const [editSku, setEditSku] = useState(null);
  const [tab, setTab] = useState('history');

  const { data: fcRes, isFetching: fcLoading } = useGetFgForecastQuery({ skuId, days: 30 });
  const fc = fcRes?.data;
  const sku = fc?.sku;
  const m = fc?.metrics || {};

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box sx={{ color: '#fff', px: { xs: 2, md: 4 }, pt: 3, pb: 5,
        background: 'linear-gradient(135deg, #064e3b 0%, #047857 55%, #059669 100%)' }}>
        <Button startIcon={<ArrowLeft size={16} />} onClick={goBack}
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
        <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
          <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
            <Metric label="In stock" value={num(m.onHand)} color={ACCENT} />
            <Metric label="In production" value={num(m.inProduction)} />
            <Metric label="Booked" value={num(m.booked)} />
            <Metric label="Available" value={num(m.projectedAvailable)} color={theme.palette.primary.main} />
            <Metric label="Demand / day" value={num(m.add)} />
            <Metric label="Lead (days)" value={num(m.leadDays)} />
            <Metric label="Safety factor" value={num(m.safetyFactor)} />
            <Metric label="Reorder pt" value={num(m.reorderPoint)} />
            <Metric label="Target level" value={num(m.maxLevel)} />
            <Metric label="Days cover" value={m.daysCover == null ? '—' : `${num(m.daysCover)}d`} color={m.daysCover != null && m.daysCover < m.leadDays ? theme.palette.error.main : undefined} />
            <Metric label="Produce qty" value={num(m.suggestedProduceQty)} color={theme.palette.warning.dark} />
            <Metric label="Stock value" value={inr(m.stockValue)} />
          </Stack>
        </Paper>

        <Paper sx={{ borderRadius: 3, mb: 2 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
            sx={{ px: 1, borderBottom: `1px solid ${theme.palette.divider}`, minHeight: 48,
              '& .MuiTabs-indicator': { backgroundColor: ACCENT }, '& .Mui-selected': { color: `${ACCENT} !important` } }}>
            <Tab value="history" iconPosition="start" icon={<History size={16} />} label="Stock history" sx={{ minHeight: 48, textTransform: 'none', fontWeight: 700 }} />
            <Tab value="forecast" iconPosition="start" icon={<LineChartIcon size={16} />} label="Projection" sx={{ minHeight: 48, textTransform: 'none', fontWeight: 700 }} />
            <Tab value="movements" iconPosition="start" icon={<Clock size={16} />} label="Movements" sx={{ minHeight: 48, textTransform: 'none', fontWeight: 700 }} />
          </Tabs>
        </Paper>

        {tab === 'history' && <StockHistory skuId={skuId} />}
        {tab === 'forecast' && <StockForecast skuId={skuId} />}
        {tab === 'movements' && <MovementHistory skuId={skuId} />}
      </Box>

      <FgPolicyDrawer skuId={editSku} onClose={() => setEditSku(null)} />
    </Box>
  );
};

export default FgImsItemDetail;
