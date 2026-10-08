import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, Chip, Table, TableHead, TableBody, TableRow,
  TableCell, Skeleton, TablePagination, ToggleButtonGroup, ToggleButton,
  Tabs, Tab, TextField, FormControlLabel, Switch,
} from '@mui/material';
import {
  Pencil, Boxes, Clock, History, Download, LineChart as LineChartIcon, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip, ReferenceLine, CartesianGrid,
} from 'recharts';
import dayjs from 'dayjs';
import { useParams } from 'react-router-dom';
import { useSmartBack } from '../../hooks/useSmartBack';
import {
  FgShell, Panel, TableScroll, StatusChip, MoveChip, EmptyNote, Help, Th,
  O2D, STOCK_TOKENS, moveToken, num, inr, imsTableSx, FG_ACCENT,
} from './fgImsMeta';
import { useGetFgForecastQuery, useGetFgMovementsQuery, useGetFgHistoryQuery } from '../../store/api/fgImsApi';
import FgPolicyDrawer from './FgPolicyDrawer';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.fg;

// One metric in the header strip. `hint` carries the plain-English definition so
// the strip stays compact without becoming a wall of jargon.
const Metric = ({ label, value, hint, color, strong }) => (
  <Box sx={{
    px: 1.25, py: 0.85, borderRadius: '7px', bgcolor: O2D.surface,
    border: `1px solid ${strong ? (color || FG_ACCENT) : O2D.line}`, minWidth: 108, flex: '1 1 108px',
  }}>
    <Stack direction="row" alignItems="center" spacing={0}>
      <Typography noWrap sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', color: O2D.sub }}>
        {label}
      </Typography>
      {hint && <Help text={hint} size={11} />}
    </Stack>
    <Typography sx={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1.2, color: color || O2D.ink, fontVariantNumeric: 'tabular-nums' }}>
      {value}
    </Typography>
  </Box>
);

const SummaryPill = ({ label, value, color }) => (
  <Box sx={{ px: 1.1, py: 0.6, borderRadius: '7px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface, minWidth: 88 }}>
    <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: O2D.sub, lineHeight: 1.3 }}>{label}</Typography>
    <Typography sx={{ fontWeight: 800, fontSize: '0.88rem', color: color || O2D.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
  </Box>
);

const RANGE_PRESETS = [15, 30, 60, 90];

const toggleSx = {
  '& .MuiToggleButton-root': {
    textTransform: 'none', fontWeight: 700, fontSize: '0.7rem', px: 1.1, py: 0.3,
    borderColor: O2D.line, color: O2D.body,
    '&.Mui-selected': { bgcolor: FG_ACCENT, color: '#fff', '&:hover': { bgcolor: FG_ACCENT } },
  },
};

// ── Stock history — the dated closing-stock ledger, day by day ────────────────
const StockHistory = ({ skuId }) => {
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

  const chart = useMemo(() => days.map((d) => ({ ...d, label: dayjs(d.date).format('DD MMM') })), [days]);
  // Newest-first reads like a bank statement; "hide days with no movement" hides
  // the flat carried-forward days that pad out a long window.
  const tableDays = useMemo(() => {
    const list = onlyChanges ? days.filter((d) => d.movementCount > 0) : days;
    return [...list].reverse();
  }, [days, onlyChanges]);

  useEffect(() => { setPage(0); }, [onlyChanges]);
  const paged = useMemo(() => tableDays.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [tableDays, page, rowsPerPage]);

  const exportCsv = () => {
    const header = ['Date', 'Opening', 'In', 'Out', 'Net', 'Closing'];
    const lines = days.map((d) => [d.date, d.opening, d.inQty, d.outQty, d.net, d.closing].join(','));
    const url = URL.createObjectURL(new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fg-stock-history_${res?.sku?.skuCode || skuId}_${from}_to_${to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <Panel
      title="Day-by-day stock history"
      hint="The closing balance at the end of every day, exactly as a stock register would show it."
      icon={History}
      actions={(
        <Button size="small" variant="outlined" startIcon={<Download size={13} />} onClick={exportCsv} disabled={!days.length}
          sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
          Export
        </Button>
      )}
      dense
    >
      <Box sx={{ p: 1.5, borderBottom: `1px solid ${O2D.lineSoft}` }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <ToggleButtonGroup size="small" exclusive value={preset} onChange={(_, v) => applyPreset(v)} sx={toggleSx}>
            {RANGE_PRESETS.map((n) => <ToggleButton key={n} value={n}>{n} days</ToggleButton>)}
          </ToggleButtonGroup>
          <TextField size="small" type="date" label="From" value={from} onChange={(e) => onFrom(e.target.value)}
            InputLabelProps={{ shrink: true }} inputProps={{ max: to }} sx={{ width: 160 }} />
          <TextField size="small" type="date" label="To" value={to} onChange={(e) => onTo(e.target.value)}
            InputLabelProps={{ shrink: true }} inputProps={{ min: from, max: today }} sx={{ width: 160 }} />
          <FormControlLabel
            control={<Switch size="small" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} />}
            label={<Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>Hide days with no movement</Typography>}
          />
        </Stack>
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
          <SummaryPill label="Opening" value={num(summary.openingBalance)} />
          <SummaryPill label="Total in" value={`+${num(summary.totalIn)}`} color={moveToken('IN').color} />
          <SummaryPill label="Total out" value={`−${num(summary.totalOut)}`} color={moveToken('OUT').color} />
          <SummaryPill label="Closing" value={num(summary.closingBalance)} color={FG_ACCENT} />
          <SummaryPill label="Highest" value={num(summary.peak)} />
          <SummaryPill label="Lowest" value={num(summary.low)} color={summary.low <= 0 ? STOCK_TOKENS.OUT_OF_STOCK.color : undefined} />
          <SummaryPill label="Active days" value={`${num(summary.daysWithMovement)} / ${num(res?.range?.dayCount)}`} />
        </Stack>
      </Box>

      <Box sx={{ p: 1.5, pb: 0.5 }}>
        {isFetching && !days.length ? <Skeleton variant="rounded" height={230} /> : (
          <Box sx={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 14, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="fgHistFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={FG_ACCENT} stopOpacity={0.24} />
                    <stop offset="100%" stopColor={FG_ACCENT} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={O2D.lineSoft} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: O2D.sub }} interval="preserveStartEnd"
                  minTickGap={28} tickLine={false} axisLine={{ stroke: O2D.line }} />
                <YAxis tick={{ fontSize: 10, fill: O2D.sub }} allowDecimals={false} tickLine={false} axisLine={false} width={44} />
                <RTooltip formatter={(v) => [num(v), 'Closing stock']} labelFormatter={(l) => l} />
                {metrics.reorderPoint > 0 && (
                  <ReferenceLine y={metrics.reorderPoint} stroke={STOCK_TOKENS.REORDER.color} strokeDasharray="4 4"
                    label={{ value: 'Reorder At', fontSize: 10, fill: STOCK_TOKENS.REORDER.color, position: 'insideTopLeft' }} />
                )}
                {metrics.maxLevel > 0 && (
                  <ReferenceLine y={metrics.maxLevel} stroke={STOCK_TOKENS.OK.color} strokeDasharray="4 4"
                    label={{ value: 'Max Level', fontSize: 10, fill: STOCK_TOKENS.OK.color, position: 'insideTopLeft' }} />
                )}
                <Area type="monotone" dataKey="closing" stroke={FG_ACCENT} strokeWidth={2.5} fill="url(#fgHistFill)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        )}
      </Box>

      <TableScroll>
        <Table size="small" sx={imsTableSx(720)}>
          <TableHead>
            <TableRow>
              <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
              <TableCell align="center"><Th label="Date" hint={H.movementDate} /></TableCell>
              <TableCell align="right"><Th label="Opened with" hint={H.openingBalance} /></TableCell>
              <TableCell align="right"><Th label="Came in" hint={H.dayIn} /></TableCell>
              <TableCell align="right"><Th label="Went out" hint={H.dayOut} /></TableCell>
              <TableCell align="right"><Th label="Net" hint={H.dayNet} /></TableCell>
              <TableCell align="right"><Th label="Closed with" hint={H.closingBalance} /></TableCell>
              <TableCell align="center">Level</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isFetching && !days.length && (
              <TableRow><TableCell colSpan={8} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={160} /></TableCell></TableRow>
            )}
            {!isFetching && tableDays.length === 0 && (
              <TableRow><TableCell colSpan={8} sx={{ border: 0 }}>
                <EmptyNote icon={History} title="No history in this window"
                  hint="Widen the date range, or switch off 'hide days with no movement'." />
              </TableCell></TableRow>
            )}
            {paged.map((d, i) => {
              const tone = d.stockOut ? STOCK_TOKENS.OUT_OF_STOCK : d.belowReorder ? STOCK_TOKENS.REORDER : null;
              return (
                <TableRow key={d.date} hover sx={tone ? { bgcolor: tone.tint } : (d.movementCount > 0 ? { bgcolor: O2D.surfaceAlt } : null)}>
                  <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{page * rowsPerPage + i + 1}</TableCell>
                  <TableCell align="center" sx={{ whiteSpace: 'nowrap', fontWeight: 600, color: O2D.ink }}>{dayjs(d.date).format('ddd, DD MMM YYYY')}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{num(d.opening)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: d.inQty ? moveToken('IN').color : O2D.faint, fontWeight: d.inQty ? 700 : 400 }}>
                    {d.inQty ? `+${num(d.inQty)}` : '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: d.outQty ? moveToken('OUT').color : O2D.faint, fontWeight: d.outQty ? 700 : 400 }}>
                    {d.outQty ? `−${num(d.outQty)}` : '—'}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: d.net > 0 ? moveToken('IN').color : d.net < 0 ? moveToken('OUT').color : O2D.faint }}>
                    {d.net === 0 ? '—' : `${d.net > 0 ? '+' : '−'}${num(Math.abs(d.net))}`}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: tone?.color || O2D.ink }}>{num(d.closing)}</TableCell>
                  <TableCell align="center">
                    {tone
                      ? <Chip size="small" label={d.stockOut ? 'Out of stock' : 'Below Reorder At'}
                          sx={{ height: 20, fontWeight: 700, fontSize: '0.66rem', borderRadius: '999px', bgcolor: tone.bg, color: tone.color, border: `1px solid ${tone.border}` }} />
                      : <Typography sx={{ fontSize: '0.7rem', color: O2D.faint }}>Healthy</Typography>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableScroll>
      <TablePagination
        component="div" count={tableDays.length} page={page} onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
        rowsPerPageOptions={[15, 30, 60, 100]} labelRowsPerPage="Days per page:"
        sx={{ borderTop: `1px solid ${O2D.lineSoft}`, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } }}
      />
    </Panel>
  );
};

// ── Forward demand projection ────────────────────────────────────────────────
const StockForecast = ({ skuId }) => {
  const [days, setDays] = useState(30);
  const { data: fcRes, isFetching } = useGetFgForecastQuery({ skuId, days });
  const fc = fcRes?.data;
  const m = fc?.metrics || {};
  const series = (fc?.series || []).map((p) => ({ ...p, label: dayjs(p.date).format('DD MMM') }));

  const verdict = fc?.stockoutDay != null
    ? { tone: STOCK_TOKENS.OUT_OF_STOCK, text: `At the current rate of demand this item runs out in about ${fc.stockoutDay} days.` }
    : fc?.reorderDay != null
      ? { tone: STOCK_TOKENS.REORDER, text: `Stock reaches its Reorder At level in about ${fc.reorderDay} days — schedule the production run before then.` }
      : { tone: STOCK_TOKENS.OK, text: `No production run and no stock-out expected within the next ${days} days.` };

  return (
    <Panel title="What happens next" icon={LineChartIcon}
      hint="A straight-line projection assuming the active season's Average Daily Demand continues and nothing new is produced."
      actions={(
        <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)} sx={toggleSx}>
          {RANGE_PRESETS.map((n) => <ToggleButton key={n} value={n}>{n} days</ToggleButton>)}
        </ToggleButtonGroup>
      )}
    >
      <Paper elevation={0} sx={{
        borderRadius: '8px', px: 1.5, py: 1.1, mb: 1.25,
        border: `1px solid ${verdict.tone.border}`, bgcolor: verdict.tone.tint,
      }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Box sx={{ color: verdict.tone.color, display: 'flex' }}>
            {verdict.tone === STOCK_TOKENS.OK ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
          </Box>
          <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: verdict.tone.color }}>{verdict.text}</Typography>
        </Stack>
      </Paper>
      {isFetching ? <Skeleton variant="rounded" height={270} /> : (
        <Box sx={{ height: 280 }}>
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
    </Panel>
  );
};

// ── In/Out movement ledger for this one item ─────────────────────────────────
const MovementHistory = ({ skuId }) => {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const { data: mvRes, isFetching } = useGetFgMovementsQuery({ skuId, limit: 500 });
  const movements = useMemo(() => mvRes?.data || [], [mvRes]);
  const paged = useMemo(() => movements.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [movements, page, rowsPerPage]);

  return (
    <Panel title="Every movement for this item" icon={Clock}
      hint={`${movements.length} entr${movements.length === 1 ? 'y' : 'ies'} — each one is a production run, a dispatch or a correction.`}
      dense>
      <TableScroll>
        <Table size="small" sx={imsTableSx(960)}>
          <TableHead>
            <TableRow>
              <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
              <TableCell align="center"><Th label="Date" hint={H.movementDate} /></TableCell>
              <TableCell><Th label="Recorded at" hint={H.recordedAt} /></TableCell>
              <TableCell align="center"><Th label="What happened" hint={H.movementType} /></TableCell>
              <TableCell align="right"><Th label="Change" hint={H.movementQty} /></TableCell>
              <TableCell align="right">Balance after</TableCell>
              <TableCell><Th label="Recorded by" hint={H.recordedBy} /></TableCell>
              <TableCell><Th label="Source / reference" hint={H.movementRef} /></TableCell>
              <TableCell><Th label="Notes" hint={H.movementNotes} /></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isFetching && movements.length === 0 && (
              <TableRow><TableCell colSpan={9} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={200} /></TableCell></TableRow>
            )}
            {!isFetching && movements.length === 0 && (
              <TableRow><TableCell colSpan={9} sx={{ border: 0 }}>
                <EmptyNote icon={Clock} title="Nothing recorded for this item yet"
                  hint="The first Production In or Dispatch Out you record will appear here." />
              </TableCell></TableRow>
            )}
            {paged.map((mv, i) => {
              const t = moveToken(mv.movementType);
              const ref = [mv.refNumber, mv.batchNo].filter(Boolean).join(' · ');
              return (
                <TableRow key={mv._id} hover>
                  <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{page * rowsPerPage + i + 1}</TableCell>
                  <TableCell align="center" sx={{ whiteSpace: 'nowrap', fontWeight: 600, color: O2D.ink }}>{dayjs(mv.movementDate).format('DD MMM YYYY')}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography sx={{ fontSize: '0.71rem', color: O2D.sub }}>{dayjs(mv.createdAt || mv.movementDate).format('DD MMM, HH:mm')}</Typography>
                    <Typography sx={{ fontSize: '0.65rem', fontFamily: 'ui-monospace, monospace', color: O2D.faint }}>{mv.movementNumber}</Typography>
                  </TableCell>
                  <TableCell align="center"><MoveChip movementType={mv.movementType} txnType={mv.txnType} /></TableCell>
                  <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: t.color, whiteSpace: 'nowrap' }}>
                    {t.sign}{num(mv.quantity)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{num(mv.balanceAfter)}</TableCell>
                  <TableCell sx={{ color: O2D.sub, whiteSpace: 'nowrap' }}>{mv.performedByName || '—'}</TableCell>
                  <TableCell sx={{ maxWidth: 180 }}>
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: O2D.body }}>{mv.sourceModule || '—'}</Typography>
                    {ref && <Typography noWrap sx={{ fontSize: '0.66rem', color: O2D.sub }} title={ref}>{ref}</Typography>}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 240 }}>
                    <Typography noWrap sx={{ fontSize: '0.72rem', color: O2D.sub }} title={mv.remarks}>{mv.remarks || '—'}</Typography>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableScroll>
      <TablePagination
        component="div" count={movements.length} page={page} onPageChange={(_, p) => setPage(p)}
        rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
        rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="Movements per page:"
        sx={{ borderTop: `1px solid ${O2D.lineSoft}`, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } }}
      />
    </Panel>
  );
};

const FgImsItemDetail = () => {
  const goBack = useSmartBack('/fg-ims/stock');
  const { skuId } = useParams();
  const [editSku, setEditSku] = useState(null);
  const [tab, setTab] = useState('history');

  // The forecast snapshot doubles as the header's metric source.
  const { data: fcRes, isFetching } = useGetFgForecastQuery({ skuId, days: 30 });
  const fc = fcRes?.data;
  const sku = fc?.sku;
  const m = fc?.metrics || {};

  const tightCover = m.daysCover != null && m.leadDays != null && m.daysCover < m.leadDays;
  const tone = STOCK_TOKENS[m.status] || STOCK_TOKENS.OK;

  // The one sentence a planner needs before reading any chart on this page.
  // Finished goods are produced, never purchased — the wording says so.
  const verdict = m.status === 'OUT_OF_STOCK'
    ? 'Nothing is left in the store. Produce urgently — customer orders cannot be filled.'
    : m.status === 'REORDER'
      ? `Projected Available has reached the Reorder At level of ${num(m.reorderPoint)}. Schedule about ${num(m.suggestedProduceQty)} units.`
      : m.status === 'LOW'
        ? `Cover is thinning${m.daysCover != null ? ` — roughly ${num(m.daysCover)} days left` : ''}. Keep an eye on it.`
        : m.status === 'OVERSTOCK'
          ? 'Stock is above the Max Level. Hold off producing until it comes down.'
          : 'Stock is at a healthy level. Nothing to do right now.';

  return (
    <FgShell
      icon={Boxes}
      title={sku?.skuName || 'Finished good'}
      subtitle={sku ? `${sku.skuCode}${sku.category ? ` · ${sku.category}` : ''}` : 'Loading item…'}
      onBack={goBack}
      backLabel="Back to the stock list"
      actions={(
        <Stack direction="row" spacing={0.75} alignItems="center">
          {m.status && <StatusChip status={m.status} />}
          <Button size="small" variant="outlined" startIcon={<Pencil size={14} />} onClick={() => setEditSku(skuId)}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
            Edit planning policy
          </Button>
        </Stack>
      )}
    >
      {isFetching && !sku ? <Skeleton variant="rounded" height={96} /> : (
        <Paper elevation={0} sx={{
          borderRadius: '8px', px: 1.5, py: 1.1, border: `1px solid ${tone.border}`, bgcolor: tone.tint,
        }}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Box sx={{ color: tone.color, display: 'flex', flexShrink: 0 }}>
              {m.status === 'OK' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            </Box>
            <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: tone.color }}>{verdict}</Typography>
          </Stack>
        </Paper>
      )}

      {/* ── The planning numbers, each one explained on hover ── */}
      <Panel title="The numbers behind this item" hint="Hover any label to see what it means.">
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Metric label="Available Qty" value={num(m.onHand)} color={FG_ACCENT} strong
            hint="Finished units physically in the store right now." />
          <Metric label="In Production (WIP)" value={num(m.inProduction)}
            hint="On the line now, expected to be completed and added to stock." />
          <Metric label="Booked (Committed Orders)" value={num(m.booked)}
            hint="Already committed to confirmed customer orders, so not free to promise." />
          <Metric label="Projected Available" value={num(m.projectedAvailable)}
            hint="Available Qty + In Production − Booked." />
          <Metric label="Average Daily Demand" value={num(m.add)}
            hint="Units expected to be dispatched per day for the active season. A planned figure, set by hand in the policy." />
          {/* A policy figure: an item with no policy has none, so the tile says
              so rather than showing the system default as if it were set. The
              backend fallback that keeps the levels working is untouched. */}
          <Metric label="Lead Time"
            value={m.hasPolicy === false ? 'Not configured' : `${num(m.leadDays)}d`}
            hint="Days to produce a batch, from starting the run to stock being ready." />
          <Metric label="Reorder At" value={num(m.reorderPoint)}
            hint="When Projected Available falls to this number, start a production run — Average Daily Demand × Lead Time." />
          {/* 8th tile, matching the Safety Factor's column position in the stock list. */}
          <Metric label="Safety Factor"
            value={m.hasPolicy === false ? 'Not configured' : `${num(m.safetyFactor)}×`}
            hint="Cushion multiplier for demand spikes and production delays. 1.5 means we hold 50% extra." />
          <Metric label="Max Level" value={num(m.maxLevel)}
            hint={m.maxLevelMode === 'MANUAL'
              ? `Manually overridden. The formula would give ${num(m.formulaMaxLevel)} — changing the Safety Factor will not affect it.`
              : 'When we produce, we produce enough to reach this level — Average Daily Demand × Lead Time × Safety Factor.'} />
          <Metric label="Days Cover" value={m.daysCover == null ? '—' : `${num(m.daysCover)}d`}
            color={tightCover ? STOCK_TOKENS.REORDER.color : undefined} strong={tightCover}
            hint="Days the current stock lasts at the active season's Average Daily Demand." />
          <Metric label="Production Quantity" value={num(m.suggestedProduceQty)}
            color={m.suggestedProduceQty > 0 ? STOCK_TOKENS.REORDER.color : undefined}
            hint="How much to produce to bring stock back to the Max Level, allowing for what is already in production and booked." />
          <Metric label="Stock Value" value={inr(m.stockValue)}
            hint="What the finished stock on hand is worth at its costing rate." />
        </Stack>
      </Panel>

      <Paper elevation={0} sx={{ borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto"
          sx={{
            px: 0.5, minHeight: 40,
            '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontWeight: 700, fontSize: '0.78rem', color: O2D.sub },
            '& .Mui-selected': { color: `${FG_ACCENT} !important` },
            '& .MuiTabs-indicator': { backgroundColor: FG_ACCENT, height: 2 },
          }}>
          <Tab value="history" iconPosition="start" icon={<History size={15} />} label="Day-by-day history" />
          <Tab value="forecast" iconPosition="start" icon={<LineChartIcon size={15} />} label="What happens next" />
          <Tab value="movements" iconPosition="start" icon={<Clock size={15} />} label="Every movement" />
        </Tabs>
      </Paper>

      {tab === 'history' && <StockHistory skuId={skuId} />}
      {tab === 'forecast' && <StockForecast skuId={skuId} />}
      {tab === 'movements' && <MovementHistory skuId={skuId} />}

      <FgPolicyDrawer skuId={editSku} onClose={() => setEditSku(null)} />
    </FgShell>
  );
};

export default FgImsItemDetail;
