import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, MenuItem, InputAdornment, Table, TableHead, TableBody,
  TableRow, TableCell, Chip, IconButton, Tooltip, Button, Skeleton, TablePagination, Collapse,
  Dialog, DialogTitle, DialogContent, DialogActions, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Boxes, Search, Pencil, LineChart as LineChartIcon, PackageOpen, AlertTriangle, TrendingDown,
  ChevronRight, IndianRupee, Info, X, Download,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ReferenceLine, CartesianGrid,
} from 'recharts';
import dayjs from 'dayjs';
import {
  ImsShell, Panel, TableScroll, KpiTile, StatusChip, StatusLegend, EmptyNote, Th, Eyebrow,
  O2D, O2D_TIP, STOCK_TOKENS, STOCK_ORDER, stockToken, num, inr, imsTableSx,
} from './imsMeta';
import { useGetImsOverviewQuery, useGetImsForecastQuery } from '../../store/api/imsApi';
import PolicyDrawer from './PolicyDrawer';

// Plain-English definitions for the planning columns. These are the words that
// lose a non-warehouse reader, so every one of them carries its meaning inline.
const GLOSSARY = [
  ['On hand', 'How many units are physically in the store right now.'],
  ['In transit', 'Ordered from the vendor but not yet received.'],
  ['Daily use', 'Average number of units consumed per day (ADC), taken from actual issues.'],
  ['Lead time', 'Days the vendor takes to deliver after you place the order.'],
  ['Safety', 'A cushion multiplier for demand spikes and late deliveries. 1.5 means we hold 50% extra.'],
  ['Reorder at', 'The trigger level. When on-hand drops to this, place the order — Daily use × Lead time × Safety.'],
  ['Order up to', 'The ceiling. When we buy, we buy enough to reach this level.'],
  ['Cover', 'How many days the current stock will last at the average daily use.'],
];

// ── Stock projection dialog ──────────────────────────────────────────────────
const ForecastDialog = ({ item, onClose }) => {
  const [days, setDays] = useState(30);
  const { data, isFetching } = useGetImsForecastQuery({ skuId: item?.skuId, days }, { skip: !item });
  const fc = data?.data;
  const m = fc?.metrics || {};
  const series = (fc?.series || []).map((p) => ({ ...p, label: dayjs(p.date).format('DD MMM') }));

  // The two dates that matter — spelled as sentences, not as chips full of jargon.
  const verdict = fc?.stockoutDay != null
    ? { tone: STOCK_TOKENS.OUT_OF_STOCK, text: `At the current rate this item runs out in about ${fc.stockoutDay} days.` }
    : fc?.reorderDay != null
      ? { tone: STOCK_TOKENS.REORDER, text: `Stock hits its reorder point in about ${fc.reorderDay} days — plan the purchase order now.` }
      : { tone: STOCK_TOKENS.OK, text: `No reorder and no stock-out expected in the next ${days} days.` };

  return (
    <Dialog open={!!item} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { borderRadius: '10px', border: `1px solid ${O2D.line}` } }}>
      <DialogTitle sx={{ py: 1.25, borderBottom: `1px solid ${O2D.lineSoft}` }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ minWidth: 0, mr: 'auto' }}>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: O2D.ink }}>
              What happens to this stock next?
            </Typography>
            <Typography noWrap sx={{ fontSize: '0.72rem', color: O2D.sub }}>
              {item?.skuName} · {item?.skuCode}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose}><X size={16} /></IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent sx={{ bgcolor: O2D.canvas, p: 1.5 }}>
        <Stack spacing={1.25}>
          <Paper elevation={0} sx={{
            borderRadius: '8px', px: 1.5, py: 1.1,
            border: `1px solid ${verdict.tone.border}`, bgcolor: verdict.tone.tint,
          }}>
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: verdict.tone.color }}>{verdict.text}</Typography>
          </Paper>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            {[
              ['On hand now', num(m.onHand)],
              ['Used per day', `${num(m.adc)}/day`],
              ['Reorder at', num(m.reorderPoint)],
              ['Order up to', num(m.maxLevel)],
            ].map(([k, v]) => (
              <Chip key={k} size="small" label={<span><b>{k}:</b> {v}</span>}
                sx={{ height: 24, fontSize: '0.7rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
            ))}
            <Box sx={{ ml: 'auto' }}>
              <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)}
                sx={{ '& .MuiToggleButton-root': { textTransform: 'none', fontWeight: 700, fontSize: '0.7rem', px: 1.1, py: 0.3, borderColor: O2D.line } }}>
                {[15, 30, 60, 90].map((n) => <ToggleButton key={n} value={n}>{n} days</ToggleButton>)}
              </ToggleButtonGroup>
            </Box>
          </Stack>

          <Paper elevation={0} sx={{ borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface, p: 1.5 }}>
            {isFetching ? <Skeleton variant="rounded" height={300} /> : (
              <Box sx={{ height: 310 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 14, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={O2D.lineSoft} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: O2D.sub }} interval="preserveStartEnd"
                      minTickGap={24} tickLine={false} axisLine={{ stroke: O2D.line }} />
                    <YAxis tick={{ fontSize: 10, fill: O2D.sub }} allowDecimals={false} tickLine={false} axisLine={false} width={44} />
                    <RTooltip formatter={(v) => [num(v), 'Projected stock']} />
                    {m.reorderPoint > 0 && (
                      <ReferenceLine y={m.reorderPoint} stroke={STOCK_TOKENS.REORDER.color} strokeDasharray="4 4"
                        label={{ value: 'Reorder at', fontSize: 10, fill: STOCK_TOKENS.REORDER.color, position: 'insideTopLeft' }} />
                    )}
                    {m.maxLevel > 0 && (
                      <ReferenceLine y={m.maxLevel} stroke={STOCK_TOKENS.OK.color} strokeDasharray="4 4"
                        label={{ value: 'Order up to', fontSize: 10, fill: STOCK_TOKENS.OK.color, position: 'insideTopLeft' }} />
                    )}
                    <Line type="monotone" dataKey="projected" stroke={O2D.brand} strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            )}
            <Typography sx={{ fontSize: '0.68rem', color: O2D.faint, mt: 0.75 }}>
              The line assumes today's average daily use continues and no new stock arrives.
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
  const [status, setStatus] = useState(params.get('status') || 'ALL');
  const [sort, setSort] = useState('urgency');
  const [editSku, setEditSku] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [showGlossary, setShowGlossary] = useState(false);
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

  const { data, isFetching } = useGetImsOverviewQuery({ search: search || undefined });
  const rows = useMemo(() => data?.data || [], [data]);
  const summary = data?.meta || {};
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(), [rows]);

  const counts = useMemo(() => {
    const c = { ALL: rows.length };
    STOCK_ORDER.forEach((k) => { c[k] = rows.filter((r) => r.status === k).length; });
    return c;
  }, [rows]);

  // Urgency ranking mirrors the legend order, so "worst first" means the same
  // thing on this screen as it does on the dashboard.
  const urgency = (r) => STOCK_ORDER.indexOf(r.status);

  const filtered = useMemo(() => {
    const list = rows.filter((r) => (status === 'ALL' || r.status === status) && (!category || r.category === category));
    const sorters = {
      urgency: (a, b) => urgency(a) - urgency(b) || (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9),
      cover: (a, b) => (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9),
      name: (a, b) => (a.skuName || '').localeCompare(b.skuName || ''),
      code: (a, b) => (a.skuCode || '').localeCompare(b.skuCode || ''),
      onhand: (a, b) => Number(b.onHand || 0) - Number(a.onHand || 0),
    };
    return [...list].sort(sorters[sort] || sorters.urgency);
  }, [rows, status, category, sort]);

  useEffect(() => { setPage(0); }, [search, category, status, sort, rowsPerPage]);
  const paged = useMemo(() => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [filtered, page, rowsPerPage]);

  const exportCsv = () => {
    const header = ['Code', 'Item', 'Category', 'On hand', 'In transit', 'Daily use', 'Lead days', 'Safety', 'Reorder at', 'Order up to', 'Days cover', 'Status'];
    const lines = filtered.map((r) => [r.skuCode, r.skuName, r.category, r.onHand, r.inTransit, r.adc, r.leadDays, r.safetyFactor, r.reorderPoint, r.maxLevel, r.daysCover ?? '', stockToken(r.status).label]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `consumables-stock_${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const activeFilters = (status !== 'ALL' ? 1 : 0) + (category ? 1 : 0) + (search ? 1 : 0);

  return (
    <ImsShell
      icon={Boxes}
      title="Stock & Master Data"
      subtitle="Every consumable and packaging item — what's on hand, and when to buy more."
      actions={(
        <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv}
          disabled={!filtered.length}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
          Export
        </Button>
      )}
    >
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
        <KpiTile label="Items" value={num(summary.itemCount)} sub="In the master list" color={O2D.brand} icon={Boxes} />
        <KpiTile label="Units on hand" value={num(summary.totalOnHand)} sub="Physically in store" color="#0f766e" icon={PackageOpen} />
        <KpiTile label="Value in store" value={inr(summary.totalStockValue)} sub="At last purchase cost" color="#4338ca" icon={IndianRupee} />
        {/* This tile counts Out of stock + Order now together, so it opens the
            Buying list rather than a single-status filter that would show fewer
            rows than the number on the tile. */}
        <KpiTile label="To order now" value={num((summary.reorder || 0) + (summary.outOfStock || 0))}
          sub="Open the buying list" color={STOCK_TOKENS.REORDER.color} icon={AlertTriangle}
          onClick={() => navigate('/ims/reorder')} />
        <KpiTile label="Running low" value={num(summary.low)} sub="Watch these next"
          color={STOCK_TOKENS.LOW.color} icon={TrendingDown}
          active={status === 'LOW'} onClick={() => pickStatus('LOW')} />
      </Stack>

      {/* ── Filters — one line, then the status legend doubling as a filter ── */}
      <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code, item or category…" sx={{ minWidth: { xs: '100%', sm: 260 }, flex: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
          <TextField select size="small" label="Category" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ minWidth: 170 }}>
            <MenuItem value="">All categories</MenuItem>
            {categories.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)} sx={{ minWidth: 165 }}>
            <MenuItem value="urgency">Most urgent first</MenuItem>
            <MenuItem value="cover">Least days of cover</MenuItem>
            <MenuItem value="onhand">Highest stock</MenuItem>
            <MenuItem value="name">Item name (A–Z)</MenuItem>
            <MenuItem value="code">Item code</MenuItem>
          </TextField>
          <Button size="small" startIcon={<Info size={14} />} onClick={() => setShowGlossary((v) => !v)}
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.74rem', color: showGlossary ? O2D.brand : O2D.sub }}>
            What do these columns mean?
          </Button>
          <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, whiteSpace: 'nowrap', ml: 'auto' }}>
            <b>{filtered.length}</b> of {rows.length}
          </Typography>
          {activeFilters > 0 && (
            <Button size="small" startIcon={<X size={12} />}
              onClick={() => { setSearch(''); setCategory(''); pickStatus('ALL'); }}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.body }}>
              Clear ({activeFilters})
            </Button>
          )}
        </Stack>

        <Box sx={{ mt: 1, pt: 1, borderTop: `1px solid ${O2D.lineSoft}` }}>
          <StatusLegend counts={counts} value={status} onPick={pickStatus} />
        </Box>

        {/* The glossary — hidden by default, one click away forever after. */}
        <Collapse in={showGlossary}>
          <Box sx={{ mt: 1, p: 1.25, borderRadius: '7px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.lineSoft}` }}>
            <Eyebrow>How to read this table</Eyebrow>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 0.6, mt: 0.75 }}>
              {GLOSSARY.map(([term, meaning]) => (
                <Stack key={term} direction="row" spacing={0.75}>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: O2D.ink, minWidth: 88, flexShrink: 0 }}>{term}</Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>{meaning}</Typography>
                </Stack>
              ))}
            </Box>
          </Box>
        </Collapse>
      </Paper>

      <Panel dense>
        <TableScroll>
          <Table size="small" sx={imsTableSx(1120)}>
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Item</TableCell>
                <TableCell>Category</TableCell>
                <TableCell align="right"><Th label="On hand" hint="Units physically in the store right now." /></TableCell>
                <TableCell align="right"><Th label="In transit" hint="Ordered from the vendor but not yet received." /></TableCell>
                <TableCell align="right"><Th label="Daily use" hint="Average units consumed per day, from actual production issues." /></TableCell>
                <TableCell align="right"><Th label="Lead time" hint="Days the vendor takes to deliver after the order is placed." /></TableCell>
                <TableCell align="right"><Th label="Safety" hint="Cushion multiplier for demand spikes and late deliveries." /></TableCell>
                <TableCell align="right"><Th label="Reorder at" hint="When on-hand falls to this number, place the order." /></TableCell>
                <TableCell align="right"><Th label="Order up to" hint="Buy enough to bring stock back to this level." /></TableCell>
                <TableCell align="right"><Th label="Cover" hint="Days the current stock lasts at the average daily use." /></TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={13} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={260} /></TableCell></TableRow>
              )}
              {!isFetching && filtered.length === 0 && (
                <TableRow><TableCell colSpan={13} sx={{ border: 0 }}>
                  <EmptyNote icon={Boxes} title="No items match these filters"
                    hint="Try clearing the status filter or searching for a different code." />
                </TableCell></TableRow>
              )}
              {paged.map((r) => {
                const t = stockToken(r.status);
                const critical = r.status === 'OUT_OF_STOCK' || r.status === 'REORDER';
                const tightCover = r.daysCover != null && r.leadDays != null && r.daysCover < r.leadDays;
                return (
                  <TableRow key={r.skuId} hover sx={{
                    cursor: 'pointer',
                    // Problem rows carry a faint wash and a coloured left edge, so
                    // they're findable while scrolling without reading a chip.
                    ...(critical ? { bgcolor: t.tint, borderLeft: `3px solid ${t.color}` } : { borderLeft: '3px solid transparent' }),
                    '&:hover .row-go': { opacity: 1, transform: 'translateX(0)' },
                  }} onClick={() => navigate(`/ims/item/${r.skuId}`)}>
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
                    <TableCell sx={{ color: O2D.sub, fontSize: '0.73rem' }}>{r.category || '—'}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: O2D.ink }}>{num(r.onHand)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.inTransit ? O2D.body : O2D.faint }}>{r.inTransit ? num(r.inTransit) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.adc ? num(r.adc) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.leadDays != null ? `${num(r.leadDays)}d` : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.safetyFactor ? `${num(r.safetyFactor)}×` : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.reorderPoint)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.maxLevel)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: tightCover ? STOCK_TOKENS.REORDER.color : O2D.body }}>
                      {r.daysCover == null ? '—' : (
                        <Tooltip arrow slotProps={O2D_TIP}
                          title={tightCover
                            ? `Only ${num(r.daysCover)} days of stock left, but the vendor needs ${num(r.leadDays)} days to deliver. Order immediately.`
                            : `About ${num(r.daysCover)} days of stock left at the current rate of use.`}>
                          <span>{num(r.daysCover)}d</span>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell><StatusChip status={r.status} /></TableCell>
                    <TableCell align="right" sx={{ width: 108, whiteSpace: 'nowrap' }}>
                      <Stack direction="row" spacing={0.25} justifyContent="flex-end" alignItems="center">
                        <Tooltip arrow slotProps={O2D_TIP} title="See when this runs out">
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setForecast(r); }} sx={{ color: O2D.sub }}>
                            <LineChartIcon size={15} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip arrow slotProps={O2D_TIP} title="Edit the planning policy (daily use, lead time, safety)">
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setEditSku(r.skuId); }} sx={{ color: O2D.sub }}>
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
        <TablePagination
          component="div" count={filtered.length} page={page} onPageChange={(_, p) => setPage(p)}
          rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="Items per page:"
          sx={{ borderTop: `1px solid ${O2D.lineSoft}`, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } }}
        />
      </Panel>

      <PolicyDrawer skuId={editSku} onClose={() => setEditSku(null)} />
      <ForecastDialog item={forecast} onClose={() => setForecast(null)} />
    </ImsShell>
  );
};

export default ImsStockList;
