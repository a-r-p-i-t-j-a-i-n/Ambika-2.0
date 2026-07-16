import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, MenuItem, InputAdornment, Table, TableHead, TableBody,
  TableRow, TableCell, Chip, IconButton, Tooltip, Skeleton, alpha, useTheme,
  Dialog, DialogTitle, DialogContent, ToggleButtonGroup, ToggleButton, TablePagination,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { Boxes, Search, Pencil, LineChart as LineChartIcon, PackageOpen, AlertTriangle, TrendingDown, ChevronRight, ClipboardList } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ReferenceLine, CartesianGrid } from 'recharts';
import dayjs from 'dayjs';
import { FgHero, StatusChip, STATUS_META, num, inr, pctColor, MODE_LABEL, ROWS_PER_PAGE } from './fgImsMeta';
import { useGetFgOverviewQuery, useGetFgForecastQuery } from '../../store/api/fgImsApi';
import FgPolicyDrawer from './FgPolicyDrawer';

const STATUS_TABS = ['ALL', 'REORDER', 'OUT_OF_STOCK', 'LOW', 'OK', 'OVERSTOCK'];

const SummaryCard = ({ label, value, color, icon: Icon }) => (
  <Paper sx={{ p: 1.75, borderRadius: 3, flex: 1, minWidth: 150, display: 'flex', alignItems: 'center', gap: 1.5 }}>
    <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.12), color }}>
      <Icon size={20} />
    </Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
      <Typography sx={{ fontWeight: 800, fontSize: '1.1rem' }}>{value}</Typography>
    </Box>
  </Paper>
);

const PctPill = ({ value }) => {
  if (value == null) return <Typography variant="caption" color="text.disabled">—</Typography>;
  const c = pctColor(value);
  return <Chip size="small" label={`${value}%`} sx={{ height: 20, fontWeight: 700, bgcolor: alpha(c, 0.14), color: c, border: `1px solid ${alpha(c, 0.4)}` }} />;
};

// ── Demand projection dialog ──
const ForecastDialog = ({ item, onClose }) => {
  const theme = useTheme();
  const [days, setDays] = useState(30);
  const { data, isFetching } = useGetFgForecastQuery({ skuId: item?.skuId, days }, { skip: !item });
  const fc = data?.data;
  const series = (fc?.series || []).map((p) => ({ ...p, label: dayjs(p.date).format('DD MMM') }));

  return (
    <Dialog open={!!item} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Demand projection — {item?.skuName}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{item?.skuCode}</Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={`In stock: ${num(fc?.metrics?.onHand)}`} />
            <Chip size="small" label={`Demand: ${num(fc?.metrics?.add)}/day`} />
            <Chip size="small" label={`Reorder pt: ${num(fc?.metrics?.reorderPoint)}`} />
            <Chip size="small" color={fc?.reorderDay != null ? 'warning' : 'default'}
              label={fc?.reorderDay != null ? `Produce in ~${fc.reorderDay} days` : 'No reorder in window'} />
            <Chip size="small" color={fc?.stockoutDay != null ? 'error' : 'success'}
              label={fc?.stockoutDay != null ? `Stock-out in ~${fc.stockoutDay} days` : 'No stock-out in window'} />
          </Stack>
          <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)}>
            {[15, 30, 60, 90].map((d) => <ToggleButton key={d} value={d}>{d}d</ToggleButton>)}
          </ToggleButtonGroup>
        </Stack>
        {isFetching ? <Skeleton variant="rounded" height={300} /> : (
          <Box sx={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <RTooltip />
                <ReferenceLine y={fc?.metrics?.reorderPoint} stroke={theme.palette.warning.main} strokeDasharray="4 4" label={{ value: 'Reorder', fontSize: 10, fill: theme.palette.warning.main }} />
                <ReferenceLine y={fc?.metrics?.maxLevel} stroke="#059669" strokeDasharray="4 4" label={{ value: 'Max', fontSize: 10, fill: '#059669' }} />
                <Line type="monotone" dataKey="projected" stroke="#059669" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

const FgImsStockList = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [tab, setTab] = useState('ALL');
  const [editSku, setEditSku] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const { data, isFetching } = useGetFgOverviewQuery({ search: search || undefined });
  const rows = useMemo(() => data?.data || [], [data]);
  const summary = data?.meta || {};
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => rows.filter((r) =>
    (tab === 'ALL' || r.status === tab) && (!category || r.category === category)), [rows, tab, category]);

  React.useEffect(() => { setPage(0); }, [search, category, tab]);
  const paged = useMemo(() => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [filtered, page, rowsPerPage]);

  const HEADERS = ['SKU', 'Finished good', 'Category', 'In stock', 'In prod.', 'Booked', 'Available', 'Demand/day', 'Lead', 'SF', 'Reorder pt', 'Target', 'Days cover', 'Avail %', 'Status', ''];
  const rightCols = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <FgHero icon={Boxes} title="Finished Goods — Stock & Master" subtitle="Every finished good — in stock, seasonal demand policy and production status." />

      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
          <SummaryCard label="Finished goods" value={num(summary.itemCount)} color="#059669" icon={Boxes} />
          <SummaryCard label="Total in stock" value={num(summary.totalOnHand)} color="#0f766e" icon={PackageOpen} />
          <SummaryCard label="Stock value" value={inr(summary.totalStockValue)} color="#6366f1" icon={PackageOpen} />
          <SummaryCard label="Booked (orders)" value={num(summary.totalBooked)} color="#1d4ed8" icon={ClipboardList} />
          <SummaryCard label="Need production" value={num((summary.reorder || 0) + (summary.outOfStock || 0))} color="#dc2626" icon={AlertTriangle} />
          <SummaryCard label="Low cover" value={num(summary.low)} color="#b45309" icon={TrendingDown} />
        </Stack>

        <Paper sx={{ p: 1.5, borderRadius: 3, mb: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
            <TextField size="small" fullWidth value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, finished good or category…"
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> }} />
            <TextField select size="small" label="Category" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ minWidth: 200 }}>
              <MenuItem value="">All categories</MenuItem>
              {categories.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
          </Stack>
          <Stack direction="row" spacing={0.75} sx={{ mt: 1.5, flexWrap: 'wrap' }} useFlexGap>
            {STATUS_TABS.map((s) => {
              const count = s === 'ALL' ? rows.length : rows.filter((r) => r.status === s).length;
              const m = STATUS_META[s];
              const label = s === 'REORDER' ? 'Produce' : (m?.label || s);
              return (
                <Chip key={s} clickable onClick={() => setTab(s)}
                  label={`${s === 'ALL' ? 'All' : label} (${count})`}
                  variant={tab === s ? 'filled' : 'outlined'}
                  sx={{ fontWeight: 700, ...(tab === s && m ? { bgcolor: m.color, color: '#fff' } : {}) }} />
              );
            })}
          </Stack>
        </Paper>

        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 1520 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha('#059669', 0.06) }}>
                  {HEADERS.map((h, i) => (
                    <TableCell key={h || i} align={rightCols.includes(i) ? 'right' : 'left'}
                      sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {isFetching && rows.length === 0 && (
                  <TableRow><TableCell colSpan={HEADERS.length}><Skeleton variant="rounded" height={240} /></TableCell></TableRow>
                )}
                {!isFetching && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={HEADERS.length} sx={{ textAlign: 'center', py: 5, color: 'text.disabled' }}>No finished goods match.</TableCell></TableRow>
                )}
                {paged.map((r) => (
                  <TableRow key={r.skuId} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/fg-ims/item/${r.skuId}`)}>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: '#047857', whiteSpace: 'nowrap' }}>{r.skuCode}</TableCell>
                    <TableCell sx={{ maxWidth: 240 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={r.skuName}>{r.skuName}</Typography>
                      {!r.hasPolicy
                        ? <Typography variant="caption" color="warning.main">No policy set</Typography>
                        : <Typography variant="caption" color="text.secondary">{MODE_LABEL[r.consumptionMode] || r.consumptionMode} demand</Typography>}
                    </TableCell>
                    <TableCell><Typography variant="caption" color="text.secondary">{r.category || '—'}</Typography></TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{num(r.onHand)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.inProduction ? num(r.inProduction) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.booked ? num(r.booked) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{num(r.projectedAvailable)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.add ? num(r.add) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.leadDays ? num(r.leadDays) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.safetyFactor ? `${num(r.safetyFactor)}×` : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.reorderPoint)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.maxLevel)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.daysCover != null && r.daysCover < r.leadDays ? 'error.main' : 'text.primary', fontWeight: 600 }}>
                      {r.daysCover == null ? '—' : `${num(r.daysCover)}d`}
                    </TableCell>
                    <TableCell align="right"><PctPill value={r.availablePct} /></TableCell>
                    <TableCell><StatusChip status={r.status} /></TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                        <Tooltip title="Demand projection"><IconButton size="small" onClick={(e) => { e.stopPropagation(); setForecast(r); }}><LineChartIcon size={15} /></IconButton></Tooltip>
                        <Tooltip title="Edit policy"><IconButton size="small" onClick={(e) => { e.stopPropagation(); setEditSku(r.skuId); }}><Pencil size={15} /></IconButton></Tooltip>
                        <ChevronRight size={16} style={{ opacity: 0.5 }} />
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <TablePagination
            component="div"
            count={filtered.length}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={ROWS_PER_PAGE}
            labelRowsPerPage="Rows:"
          />
        </Paper>
      </Box>

      <FgPolicyDrawer skuId={editSku} onClose={() => setEditSku(null)} />
      <ForecastDialog item={forecast} onClose={() => setForecast(null)} />
    </Box>
  );
};

export default FgImsStockList;
