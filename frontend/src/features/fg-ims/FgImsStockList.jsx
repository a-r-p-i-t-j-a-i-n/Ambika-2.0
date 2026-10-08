import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, MenuItem, InputAdornment, Table, TableHead, TableBody, alpha,
  TableRow, TableCell, Chip, IconButton, Tooltip, Button, Skeleton, TablePagination, Collapse,
  Dialog, DialogTitle, DialogContent, DialogActions, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Boxes, Search, Pencil, LineChart as LineChartIcon, PackageOpen, AlertTriangle, TrendingDown,
  ChevronRight, ClipboardList, Download, Info, X,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ReferenceLine, CartesianGrid,
} from 'recharts';
import dayjs from 'dayjs';
import {
  FgShell, Panel, TableScroll, KpiTile, StatusChip, StatusLegend, EmptyNote, Th, Eyebrow,
  O2D, O2D_TIP, STOCK_TOKENS, STOCK_ORDER, num, imsTableSx,
  pctColor, MODE_LABEL, FG_GLOSSARY, FG_ACCENT, FG_STATUS_MEANING, FG_STATUS_LABEL,
} from './fgImsMeta';
import { useGetFgOverviewQuery, useGetFgForecastQuery } from '../../store/api/fgImsApi';
import FgPolicyDrawer from './FgPolicyDrawer';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.fg;

// The status word a planner reads, for the places that need the bare string
// (the CSV, the colour key) rather than a <StatusChip>.
const fgStatusLabel = (k) => FG_STATUS_LABEL[k] || STOCK_TOKENS[k]?.label || k;

// FG categories are free text off the SKU master, not the fixed itemType enum
// the consumables list colour-codes. Same pill geometry, neutral colour — the
// shape stays consistent without inventing a colour map the data cannot back.
const CategoryChip = ({ category }) => (category ? (
  <Chip
    size="small" label={category}
    sx={{
      height: 22, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px',
      bgcolor: O2D.surfaceAlt, color: O2D.sub, border: `1px solid ${O2D.line}`,
      '& .MuiChip-label': { px: 1 },
    }}
  />
) : <Typography sx={{ fontSize: '0.8rem', color: O2D.faint }}>—</Typography>);

// What a policy-only column shows for an item that has no policy. The value the
// backend plans with is a default, not something anyone set for this item, so
// the cell says so instead of printing the default as if it were data.
const NotConfigured = () => (
  <Tooltip arrow slotProps={O2D_TIP}
    title="No planning policy set for this item. IMS falls back to a system default to keep the levels working — set a policy to make this a real figure.">
    <Box component="span" sx={{ cursor: 'help', color: O2D.faint }}>—</Box>
  </Tooltip>
);

const PctPill = ({ value }) => {
  if (value == null) return <Typography sx={{ fontSize: '0.8rem', color: O2D.faint }}>—</Typography>;
  const c = pctColor(value);
  return (
    <Chip size="small" label={`${value}%`}
      sx={{
        height: 22, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px',
        bgcolor: alpha(c, 0.12), color: c, border: `1px solid ${alpha(c, 0.32)}`,
        '& .MuiChip-label': { px: 1 },
      }} />
  );
};

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
        <Tooltip key={k} arrow slotProps={O2D_TIP} title={FG_STATUS_MEANING[k] || t.meaning}>
          <Stack direction="row" alignItems="center" spacing={0.55} sx={{ cursor: 'help' }}>
            <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: t.color, flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.7rem', color: O2D.body, whiteSpace: 'nowrap' }}>{fgStatusLabel(k)}</Typography>
          </Stack>
        </Tooltip>
      );
    })}
  </Stack>
);

// ── Demand projection dialog ─────────────────────────────────────────────────
const ForecastDialog = ({ item, onClose }) => {
  const [days, setDays] = useState(30);
  const { data, isFetching } = useGetFgForecastQuery({ skuId: item?.skuId, days }, { skip: !item });
  const fc = data?.data;
  const m = fc?.metrics || {};
  const series = (fc?.series || []).map((p) => ({ ...p, label: dayjs(p.date).format('DD MMM') }));

  // The two dates that matter — spelled as sentences, not as chips full of
  // jargon. Finished goods are produced, so the verdict schedules a run.
  const verdict = fc?.stockoutDay != null
    ? { tone: STOCK_TOKENS.OUT_OF_STOCK, text: `At the current rate of demand this item runs out in about ${fc.stockoutDay} days.` }
    : fc?.reorderDay != null
      ? { tone: STOCK_TOKENS.REORDER, text: `Stock hits its Reorder At level in about ${fc.reorderDay} days — schedule the production run now.` }
      : { tone: STOCK_TOKENS.OK, text: `No production run and no stock-out expected in the next ${days} days.` };

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
              ['Available Qty', num(m.onHand)],
              ['Average Daily Demand', `${num(m.add)}/day`],
              ['Reorder At', num(m.reorderPoint)],
              ['Max Level', num(m.maxLevel)],
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
                        label={{ value: 'Reorder At', fontSize: 10, fill: STOCK_TOKENS.REORDER.color, position: 'insideTopLeft' }} />
                    )}
                    {m.maxLevel > 0 && (
                      <ReferenceLine y={m.maxLevel} stroke={STOCK_TOKENS.OK.color} strokeDasharray="4 4"
                        label={{ value: 'Max Level', fontSize: 10, fill: STOCK_TOKENS.OK.color, position: 'insideTopLeft' }} />
                    )}
                    <Line type="monotone" dataKey="projected" stroke={FG_ACCENT} strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Box>
            )}
            <Typography sx={{ fontSize: '0.68rem', color: O2D.faint, mt: 0.75 }}>
              The line assumes the active season's Average Daily Demand continues and nothing new is produced.
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

const FgImsStockList = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState(params.get('status') || 'ALL');
  const [sort, setSort] = useState('urgency');
  const [showGlossary, setShowGlossary] = useState(false);
  const [editSku, setEditSku] = useState(null);
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

  const { data, isFetching } = useGetFgOverviewQuery({ search: search || undefined });
  const rows = useMemo(() => data?.data || [], [data]);
  const summary = data?.meta || {};
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(), [rows]);

  const counts = useMemo(() => {
    const c = { ALL: rows.length };
    STOCK_ORDER.forEach((k) => { c[k] = rows.filter((r) => r.status === k).length; });
    return c;
  }, [rows]);

  // Urgency ranking mirrors the status legend order, so "worst first" means the
  // same thing here as everywhere else in IMS.
  const urgency = (r) => STOCK_ORDER.indexOf(r.status);

  const filtered = useMemo(() => {
    const list = rows.filter((r) => (status === 'ALL' || r.status === status) && (!category || r.category === category));
    const sorters = {
      urgency: (a, b) => urgency(a) - urgency(b) || (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9),
      cover: (a, b) => (a.daysCover ?? 1e9) - (b.daysCover ?? 1e9),
      produce: (a, b) => Number(b.suggestedProduceQty || 0) - Number(a.suggestedProduceQty || 0),
      onhand: (a, b) => Number(b.onHand || 0) - Number(a.onHand || 0),
      name: (a, b) => (a.skuName || '').localeCompare(b.skuName || ''),
      code: (a, b) => (a.skuCode || '').localeCompare(b.skuCode || ''),
    };
    return [...list].sort(sorters[sort] || sorters.urgency);
  }, [rows, status, category, sort]);

  const activeFilters = (status !== 'ALL' ? 1 : 0) + (category ? 1 : 0) + (search ? 1 : 0);

  useEffect(() => { setPage(0); }, [search, category, status, sort, rowsPerPage]);
  const paged = useMemo(() => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [filtered, page, rowsPerPage]);

  const exportCsv = () => {
    // Column for column, the table on screen: S.No. first, Safety Factor 8th,
    // Projected Available 9th. The export used to swap those two and claim in a
    // comment that it did not, so a reader comparing the file against the screen
    // found the numbers under the wrong headings.
    // Reorder At stays absent here because it is absent from the table. The
    // Production Plan export still carries it — that is where it is acted on.
    // Season is the one addition, after Status, so nothing before it shifts.
    const header = ['S.No.', 'SKU Code', 'Finished Good', 'Category', 'Available Qty', 'In Production (WIP)',
      'Booked (Committed Orders)', 'Safety Factor', 'Projected Available', 'Average Daily Demand', 'Lead Time',
      'Max Level', 'Days Cover', 'Available %', 'Status', 'Season'];
    // A row with no planning policy exports a blank Safety Factor and Lead Time
    // rather than the system default, for the same reason the table shows "—":
    // neither number was configured for this item.
    const lines = filtered.map((r, i) => [i + 1, r.skuCode, r.skuName, r.category, r.onHand, r.inProduction,
      r.booked, r.hasPolicy ? r.safetyFactor : '', r.projectedAvailable, r.add, r.hasPolicy ? r.leadDays : '',
      r.maxLevel, r.daysCover ?? '', r.availablePct ?? '', fgStatusLabel(r.status),
      MODE_LABEL[r.consumptionMode] || r.consumptionMode]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `finished-goods-stock_${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <FgShell
      icon={Boxes}
      title="Stock & Master Data"
      subtitle="Every finished good — what is in stock, its seasonal demand policy and what to produce next."
      actions={(
        <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv}
          disabled={!filtered.length}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
          Export
        </Button>
      )}
    >
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
        <KpiTile label="Finished goods" value={num(summary.itemCount)} sub="In the master list" color={FG_ACCENT} icon={Boxes} />
        <KpiTile label="Closing Stock" value={num(summary.totalOnHand)} sub="Total units physically in store" color="#0f766e" icon={PackageOpen} />
        <KpiTile label="Booked (orders)" value={num(summary.totalBooked)} sub="Committed to customer orders" color="#1d4ed8" icon={ClipboardList} />
        {/* Counts Out of stock + Produce together, so it opens the Production
            Plan rather than a single-status filter that would show fewer rows
            than the number on the tile. */}
        <KpiTile label="Need production" value={num((summary.reorder || 0) + (summary.outOfStock || 0))}
          sub="Open the production plan" color={STOCK_TOKENS.REORDER.color} icon={AlertTriangle}
          onClick={() => navigate('/fg-ims/planning')} />
        <KpiTile label="Low cover" value={num(summary.low)} sub="Watch these next"
          color={STOCK_TOKENS.LOW.color} icon={TrendingDown}
          active={status === 'LOW'} onClick={() => pickStatus('LOW')} />
      </Stack>

      {/* ── Filters — one line, then the status legend doubling as a filter ── */}
      <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code, finished good or category…" sx={{ minWidth: { xs: '100%', sm: 260 }, flex: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
          <TextField select size="small" label="Category" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ minWidth: 170 }}>
            <MenuItem value="">All categories</MenuItem>
            {categories.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)} sx={{ minWidth: 165 }}>
            <MenuItem value="urgency">Most urgent first</MenuItem>
            <MenuItem value="cover">Least days of cover</MenuItem>
            <MenuItem value="produce">Most to produce</MenuItem>
            <MenuItem value="onhand">Highest stock</MenuItem>
            <MenuItem value="name">Item name (A–Z)</MenuItem>
            <MenuItem value="code">Item code</MenuItem>
          </TextField>
          <Button size="small" startIcon={<Info size={14} />} onClick={() => setShowGlossary((v) => !v)}
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.74rem', color: showGlossary ? FG_ACCENT : O2D.sub }}>
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
          <StatusLegend counts={counts} value={status} onPick={pickStatus}
            labels={FG_STATUS_LABEL} meanings={FG_STATUS_MEANING} />
        </Box>

        {/* The glossary — hidden by default, one click away forever after. */}
        <Collapse in={showGlossary}>
          <Box sx={{ mt: 1, p: 1.25, borderRadius: '7px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.lineSoft}` }}>
            <Eyebrow>How to read this table</Eyebrow>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 0.6, mt: 0.75 }}>
              {FG_GLOSSARY.map(([term, meaning]) => (
                <Stack key={term} direction="row" spacing={0.75}>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: O2D.ink, minWidth: 120, flexShrink: 0 }}>{term}</Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>{meaning}</Typography>
                </Stack>
              ))}
            </Box>
          </Box>
        </Collapse>
      </Paper>

      <Panel dense>
        <TableScroll>
          <Table size="small" sx={imsTableSx(1580)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell><Th label="SKU Code" hint={H.skuCode} /></TableCell>
                <TableCell><Th label="Finished Good" hint={H.skuName} /></TableCell>
                <TableCell><Th label="Category" hint={H.category} /></TableCell>
                <TableCell align="right"><Th label="Available Qty" hint={H.onHand} /></TableCell>
                <TableCell align="right"><Th label="In Production (WIP)" hint={H.inProduction} /></TableCell>
                <TableCell align="right"><Th label="Booked (Committed Orders)" hint={H.booked} /></TableCell>
                {/* Safety Factor sits at column 8 (counting S.No. as 1) in every
                    IMS stock list, so a planner finds it in the same place
                    whichever module they are in. */}
                <TableCell align="right"><Th label="Safety Factor" hint={H.safetyFactor} /></TableCell>
                <TableCell align="right"><Th label="Projected Available" hint={H.projectedAvailable} /></TableCell>
                <TableCell align="right"><Th label="Average Daily Demand" hint={H.add} /></TableCell>
                <TableCell align="right"><Th label="Lead Time" hint={H.leadDays} /></TableCell>
                {/* No "Reorder At" column here by request. The level itself is
                    untouched and still drives the Status chip on this very row,
                    the Production Plan, the forecast and the dispatch warnings —
                    it is simply not shown as a column on this screen. It stays
                    visible on the item quick-view, the item detail page and the
                    Production Plan. */}
                <TableCell align="right"><Th label="Max Level" hint={H.maxLevel} /></TableCell>
                <TableCell align="right"><Th label="Days Cover" hint={H.daysCover} /></TableCell>
                <TableCell align="right"><Th label="Available %" hint={H.availablePct} /></TableCell>
                <TableCell align="center"><Th label="Status" hint={H.status} /></TableCell>
                <TableCell align="center" />
              </TableRow>
            </TableHead>
            <TableBody>
              {isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={16} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={260} /></TableCell></TableRow>
              )}
              {!isFetching && filtered.length === 0 && (
                <TableRow><TableCell colSpan={16} sx={{ border: 0 }}>
                  <EmptyNote icon={Boxes} title="No finished goods match these filters"
                    hint="Try clearing the status filter or searching for a different code." />
                </TableCell></TableRow>
              )}
              {paged.map((r, i) => {
                const t = STOCK_TOKENS[r.status] || STOCK_TOKENS.OK;
                const critical = r.status === 'OUT_OF_STOCK' || r.status === 'REORDER';
                const tightCover = r.daysCover != null && r.daysCover < r.leadDays;
                return (
                  <TableRow key={r.skuId} hover sx={{
                    cursor: 'pointer',
                    // Problem rows carry a faint wash and a coloured left edge, so
                    // they're findable while scrolling without reading a chip.
                    ...(critical ? { bgcolor: t.tint, borderLeft: `3px solid ${t.color}` } : { borderLeft: '3px solid transparent' }),
                    '&:hover .row-go': { opacity: 1, transform: 'translateX(0)' },
                  }} onClick={() => navigate(`/fg-ims/item/${r.skuId}`)}>
                    {/* Derived from the page offset, not the array index, so page 2
                        continues at 26 rather than restarting at 1. Purely
                        presentational — it feeds no filter, sort or calculation. */}
                    <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>
                      {page * rowsPerPage + i + 1}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: FG_ACCENT, whiteSpace: 'nowrap' }}>{r.skuCode}</TableCell>
                    <TableCell sx={{ maxWidth: 250 }}>
                      <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 600, color: O2D.ink }} title={r.skuName}>{r.skuName}</Typography>
                      {!r.hasPolicy ? (
                        <Tooltip arrow slotProps={O2D_TIP} title="Without a planning policy IMS cannot work out a Reorder At level. Click the pencil to set one.">
                          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: STOCK_TOKENS.LOW.color, cursor: 'help' }}>
                            No planning policy set
                          </Typography>
                        </Tooltip>
                      ) : (
                        <Typography sx={{ fontSize: '0.65rem', color: O2D.sub }}>
                          {MODE_LABEL[r.consumptionMode] || r.consumptionMode} demand
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell><CategoryChip category={r.category} /></TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: O2D.ink }}>{num(r.onHand)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.inProduction ? O2D.body : O2D.faint }}>{r.inProduction ? num(r.inProduction) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.booked ? O2D.body : O2D.faint }}>{r.booked ? num(r.booked) : '—'}</TableCell>
                    {/* Both of these are policy figures. An item with no policy
                        has none, so it shows "—" rather than the system default
                        dressed up as a configured value — the row already says
                        "No planning policy set" right beside it. The backend's
                        own fallback is untouched: it still plans with 1.5. */}
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {r.hasPolicy ? `${num(r.safetyFactor)}×` : <NotConfigured />}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: O2D.ink }}>{num(r.projectedAvailable)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.add ? num(r.add) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {r.hasPolicy ? `${num(r.leadDays)}d` : <NotConfigured />}
                    </TableCell>
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
                    <TableCell align="right" sx={{
                      fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                      color: tightCover ? STOCK_TOKENS.OUT_OF_STOCK.color : O2D.body,
                    }}>
                      {r.daysCover == null ? '—' : `${num(r.daysCover)}d`}
                    </TableCell>
                    <TableCell align="right"><PctPill value={r.availablePct} /></TableCell>
                    <TableCell align="center"><StatusChip status={r.status} /></TableCell>
                    <TableCell align="center" sx={{ width: 108, whiteSpace: 'nowrap' }}>
                      <Stack direction="row" spacing={0.25} justifyContent="center" alignItems="center">
                        <Tooltip arrow slotProps={O2D_TIP} title="See when this runs out">
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setForecast(r); }} sx={{ color: O2D.sub }}>
                            <LineChartIcon size={15} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip arrow slotProps={O2D_TIP} title="Edit the planning policy (seasonal demand, Lead Time, Safety Factor)">
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setEditSku(r.skuId); }} sx={{ color: O2D.sub }}>
                            <Pencil size={15} />
                          </IconButton>
                        </Tooltip>
                        <Box className="row-go" sx={{
                          display: 'inline-flex', color: FG_ACCENT, opacity: 0,
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

      <FgPolicyDrawer skuId={editSku} onClose={() => setEditSku(null)} />
      <ForecastDialog item={forecast} onClose={() => setForecast(null)} />
    </FgShell>
  );
};

export default FgImsStockList;
