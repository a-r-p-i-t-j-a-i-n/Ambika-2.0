import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, MenuItem, InputAdornment, Table, TableHead, TableBody,
  TableRow, TableCell, Chip, IconButton, Tooltip, Button, Drawer, Divider, Skeleton, alpha, useTheme,
  Dialog, DialogTitle, DialogContent, ToggleButtonGroup, ToggleButton, CircularProgress, TablePagination,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { Boxes, Search, Pencil, LineChart as LineChartIcon, PackageOpen, AlertTriangle, TrendingDown, ChevronRight } from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ReferenceLine, CartesianGrid } from 'recharts';
import dayjs from 'dayjs';
import { ImsHero, StatusChip, STATUS_META, num, inr } from './imsMeta';
import { useGetImsOverviewQuery, useGetImsForecastQuery } from '../../store/api/imsApi';
import PolicyDrawer from './PolicyDrawer';

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

// ── Forecast dialog ──
const ForecastDialog = ({ item, onClose }) => {
  const theme = useTheme();
  const [days, setDays] = useState(30);
  const { data, isFetching } = useGetImsForecastQuery({ skuId: item?.skuId, days }, { skip: !item });
  const fc = data?.data;
  const series = (fc?.series || []).map((p) => ({ ...p, label: dayjs(p.date).format('DD MMM') }));

  return (
    <Dialog open={!!item} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Stock projection — {item?.skuName}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{item?.skuCode}</Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={`On hand: ${num(fc?.metrics?.onHand)}`} />
            <Chip size="small" label={`ADC: ${num(fc?.metrics?.adc)}/day`} />
            <Chip size="small" label={`Reorder pt: ${num(fc?.metrics?.reorderPoint)}`} />
            <Chip size="small" color={fc?.reorderDay != null ? 'warning' : 'default'}
              label={fc?.reorderDay != null ? `Reorder in ~${fc.reorderDay} days` : 'No reorder in window'} />
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
                <ReferenceLine y={fc?.metrics?.maxLevel} stroke={theme.palette.success.main} strokeDasharray="4 4" label={{ value: 'Max', fontSize: 10, fill: theme.palette.success.main }} />
                <Line type="monotone" dataKey="projected" stroke={theme.palette.primary.main} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

const ImsStockList = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [tab, setTab] = useState('ALL');
  const [editSku, setEditSku] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const { data, isFetching } = useGetImsOverviewQuery({ search: search || undefined });
  const rows = useMemo(() => data?.data || [], [data]);
  const summary = data?.meta || {};
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => rows.filter((r) =>
    (tab === 'ALL' || r.status === tab) && (!category || r.category === category)), [rows, tab, category]);

  // Back to the first page whenever the result set changes (search/filter/tab).
  React.useEffect(() => { setPage(0); }, [search, category, tab]);
  const paged = useMemo(() => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [filtered, page, rowsPerPage]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <ImsHero icon={Boxes} title="Stock & Master Data" subtitle="Every consumable & packaging item — on-hand, planning policy and reorder status." />

      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
          <SummaryCard label="Items" value={num(summary.itemCount)} color={theme.palette.primary.main} icon={Boxes} />
          <SummaryCard label="Total on-hand" value={num(summary.totalOnHand)} color="#0f766e" icon={PackageOpen} />
          <SummaryCard label="Stock value" value={inr(summary.totalStockValue)} color="#6366f1" icon={PackageOpen} />
          <SummaryCard label="Need reorder" value={num((summary.reorder || 0) + (summary.outOfStock || 0))} color="#dc2626" icon={AlertTriangle} />
          <SummaryCard label="Low / cover" value={num(summary.low)} color="#b45309" icon={TrendingDown} />
        </Stack>

        <Paper sx={{ p: 1.5, borderRadius: 3, mb: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
            <TextField size="small" fullWidth value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, item or category…"
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
              return (
                <Chip key={s} clickable onClick={() => setTab(s)}
                  label={`${s === 'ALL' ? 'All' : m?.label} (${count})`}
                  variant={tab === s ? 'filled' : 'outlined'}
                  sx={{ fontWeight: 700, ...(tab === s && m ? { bgcolor: m.color, color: '#fff' } : {}) }} />
              );
            })}
          </Stack>
        </Paper>

        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 1080 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  {['SKU', 'Item', 'Category', 'On hand', 'In transit', 'ADC', 'Lead', 'SF', 'Reorder pt', 'Max', 'Days cover', 'Status', ''].map((h, i) => (
                    <TableCell key={h} align={[3, 4, 5, 6, 7, 8, 9, 10].includes(i) ? 'right' : 'left'}
                      sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {isFetching && rows.length === 0 && (
                  <TableRow><TableCell colSpan={13}><Skeleton variant="rounded" height={240} /></TableCell></TableRow>
                )}
                {!isFetching && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={13} sx={{ textAlign: 'center', py: 5, color: 'text.disabled' }}>No items match.</TableCell></TableRow>
                )}
                {paged.map((r) => (
                  <TableRow key={r.skuId} hover sx={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/ims/item/${r.skuId}`)}>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: theme.palette.primary.dark, whiteSpace: 'nowrap' }}>{r.skuCode}</TableCell>
                    <TableCell sx={{ maxWidth: 240 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={r.skuName}>{r.skuName}</Typography>
                      {!r.hasPolicy && <Typography variant="caption" color="warning.main">No policy set</Typography>}
                    </TableCell>
                    <TableCell><Typography variant="caption" color="text.secondary">{r.category || '—'}</Typography></TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{num(r.onHand)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.inTransit ? num(r.inTransit) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.adc ? num(r.adc) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.leadDays}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.safetyFactor}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.reorderPoint)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.maxLevel)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.daysCover != null && r.daysCover < r.leadDays ? 'error.main' : 'text.primary', fontWeight: 600 }}>
                      {r.daysCover == null ? '—' : `${num(r.daysCover)}d`}
                    </TableCell>
                    <TableCell><StatusChip status={r.status} /></TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                        <Tooltip title="Stock projection"><IconButton size="small" onClick={(e) => { e.stopPropagation(); setForecast(r); }}><LineChartIcon size={15} /></IconButton></Tooltip>
                        <Tooltip title="Edit policy"><IconButton size="small" onClick={(e) => { e.stopPropagation(); setEditSku(r.skuId); }}><Pencil size={15} /></IconButton></Tooltip>
                        <Tooltip title="Open history"><ChevronRight size={16} style={{ opacity: 0.5 }} /></Tooltip>
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
            rowsPerPageOptions={[10, 25, 50, 100]}
            labelRowsPerPage="Rows:"
          />
        </Paper>
      </Box>

      <PolicyDrawer skuId={editSku} onClose={() => setEditSku(null)} />
      <ForecastDialog item={forecast} onClose={() => setForecast(null)} />
    </Box>
  );
};

export default ImsStockList;
