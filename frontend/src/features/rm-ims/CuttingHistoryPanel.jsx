import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Skeleton, Tooltip, TablePagination, Collapse, IconButton, TextField, MenuItem, Button, Chip,
  Autocomplete, InputAdornment, Badge,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import {
  History, ChevronRight, ChevronDown, AlertTriangle, ArrowUpRight, Scissors, HelpCircle,
  Search, SlidersHorizontal, RotateCcw, Disc3, Layers, CircleDashed, Trash2, Receipt, Pencil, RefreshCw,
} from 'lucide-react';
import dayjs from 'dayjs';
import {
  Panel, TableScroll, EmptyNote, YieldChip, CutStatusChip, KpiTile,
  O2D, O2D_TIP, num, imsTableSx, emptyCellSx,
} from './rmImsMeta';
import { LOCATION_TOKENS } from '../scrap-ims/scrapImsMeta';
import {
  useGetRmCuttingHistoryQuery, useGetRmCoilLineageQuery, useGetRmCuttingHistoryCirclesQuery,
} from '../../store/api/rmImsApi';

const day = (d) => (d ? dayjs(d).format('DD-MM-YYYY') : '—');
const numCell = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const COLS = 16;

// The shared table look, with two concessions to sixteen columns: headers may
// wrap ("Total coil KG" over two lines) and cells are a little tighter, so the
// table stays readable at a normal desktop width and scrolls inside its panel
// below that.
const historyTableSx = (() => {
  const base = imsTableSx(1480);
  return {
    ...base,
    '& td, & th': { ...base['& td, & th'], px: 1 },
    '& thead th': { ...base['& thead th'], whiteSpace: 'normal', lineHeight: 1.25, verticalAlign: 'bottom' },
  };
})();

/** How the physical coil is known: by its goods receipt, or a manual entry. */
const ENTRY_TOKENS = {
  GRN: { label: 'GRN', color: '#1d4ed8', bg: '#dbeafe', border: '#bfdbfe', icon: Receipt,
    meaning: 'Received on a goods receipt (GRN) — its weight and rate come from that receipt.' },
  MANUAL: { label: 'Manual entry', color: '#b45309', bg: '#fef3c7', border: '#fde68a', icon: Pencil,
    meaning: 'Entered on Cut Coils under "Manual Entry — No GRN": no goods receipt, total weight typed on its first round.' },
};

const EntryChip = ({ source }) => {
  const t = ENTRY_TOKENS[source] || ENTRY_TOKENS.GRN;
  const Icon = t.icon;
  return (
    <Tooltip arrow slotProps={O2D_TIP} title={t.meaning}>
      <Chip size="small" icon={<Icon size={11} />} label={t.label} data-testid="entry-type-chip"
        sx={{
          height: 20, fontWeight: 700, fontSize: '0.64rem', borderRadius: '999px',
          bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`,
          '& .MuiChip-icon': { color: t.color, ml: 0.6, mr: -0.4 }, '& .MuiChip-label': { px: 0.7 },
        }} />
    </Tooltip>
  );
};

/** Where the coil was cut. A coil whose rounds were cut in both places says so. */
const WhereCut = ({ location }) => {
  if (!location) return <Typography sx={{ fontSize: '0.7rem', color: O2D.faint }}>—</Typography>;
  if (location === 'MIXED') {
    return (
      <Tooltip arrow slotProps={O2D_TIP} title="Some rounds were cut at PLG01 and some at JW001. Open the coil to see each round's location.">
        <Chip size="small" label="Mixed" sx={{ height: 21, fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, color: O2D.body, border: `1px solid ${O2D.line}` }} />
      </Tooltip>
    );
  }
  // The location CODE (PLG01 / JW001), in the Scrap module's own colours and
  // with its own explanation of who owns the offcut.
  const t = LOCATION_TOKENS[location];
  if (!t) return <Typography sx={{ fontSize: '0.7rem', color: O2D.sub }}>{location}</Typography>;
  const Icon = t.icon;
  return (
    <Tooltip arrow slotProps={O2D_TIP} title={t.meaning}>
      <Chip size="small" icon={<Icon size={12} />} label={`${location} · ${t.short}`}
        sx={{
          height: 21, fontWeight: 700, fontSize: '0.66rem', borderRadius: '999px',
          bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`,
          '& .MuiChip-icon': { color: t.color, ml: 0.7, mr: -0.3 }, '& .MuiChip-label': { px: 0.8 },
        }} />
    </Tooltip>
  );
};

/**
 * The rounds of ONE coil, loaded only when its row is opened.
 *
 * Straight from the lineage endpoint — the same `deriveRounds` the full coil
 * page uses — so the round numbers, running remaining weight and per-round
 * status here can never disagree with that page.
 */
const CoilRounds = ({ receiptId }) => {
  const navigate = useNavigate();
  const { data, isFetching, isError } = useGetRmCoilLineageQuery(receiptId);
  const rounds = data?.data || [];
  const meta = data?.meta || {};
  const receipt = meta.receipt || {};

  return (
    <Box sx={{ px: 2, py: 1.25, bgcolor: O2D.surfaceAlt, borderBottom: `1px solid ${O2D.lineSoft}` }}>
      <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
        <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, color: O2D.ink }}>Cutting rounds</Typography>
        {receipt.batchNo && (
          <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>
            Batch {receipt.batchNo} · {receipt.skuCode} · total coil weight {num(receipt.receivedWeightKg)} kg
          </Typography>
        )}
        <Button size="small" endIcon={<ArrowUpRight size={13} />} onClick={() => navigate(`/rm-ims/coil/${receiptId}`)}
          sx={{ ml: 'auto', textTransform: 'none', fontWeight: 700, fontSize: '0.7rem' }}>
          Open coil page
        </Button>
      </Stack>
      {isError ? (
        <Typography sx={{ fontSize: '0.72rem', color: '#b91c1c' }}>Could not load the rounds for this coil.</Typography>
      ) : (
        <TableScroll>
          <Table size="small" sx={imsTableSx(900)} aria-label={`Cutting rounds for batch ${receipt.batchNo || ''}`}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64 }}>Round</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Cutting type</TableCell>
                <TableCell align="right">Cut this round</TableCell>
                <TableCell align="right">Circle output</TableCell>
                <TableCell align="right">Scrap</TableCell>
                <TableCell>Yield</TableCell>
                <TableCell align="right">Remaining</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Location</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isFetching && !rounds.length && (
                <TableRow><TableCell colSpan={10}><Skeleton height={22} /></TableCell></TableRow>
              )}
              {rounds.map((r) => (
                <TableRow key={r.conversionId} data-testid="cut-round-row">
                  <TableCell align="center" sx={{ ...numCell, fontWeight: 800, color: '#0f766e' }}>{r.roundNo}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography sx={{ fontSize: '0.76rem', fontWeight: 600, color: O2D.ink }}>{day(r.date)}</Typography>
                    <Typography sx={{ fontSize: '0.62rem', color: O2D.faint, fontFamily: 'ui-monospace, monospace' }}>{r.conversionNumber}</Typography>
                  </TableCell>
                  {/* The operator's choice for the round, as recorded — not
                      the outcome (that is Status). Never guessed when absent. */}
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {r.cuttingType ? (
                      <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: O2D.ink }}>
                        {r.cuttingType === 'FULL' ? 'Full' : 'Partial'}
                      </Typography>
                    ) : (
                      <Tooltip arrow slotProps={O2D_TIP} title="Not recorded — this round was saved before the cutting type was captured. It is not guessed from the weights.">
                        <Typography sx={{ fontSize: '0.74rem', color: O2D.faint, cursor: 'help' }}>—</Typography>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ ...numCell, fontWeight: 800 }}>{num(r.cutKg)} kg</TableCell>
                  <TableCell align="right" sx={{ ...numCell, color: '#4338ca' }}>{num(r.circlesKg)} kg</TableCell>
                  <TableCell align="right" sx={{ ...numCell, color: '#b45309' }}>{num(r.scrapKg)} kg</TableCell>
                  <TableCell>{r.yieldPct != null ? <YieldChip pct={r.yieldPct} /> : '—'}</TableCell>
                  <TableCell align="right" sx={{ ...numCell, fontWeight: 700, color: r.remainingAfterKg < 0 ? '#b91c1c' : O2D.ink }}>
                    {num(r.remainingAfterKg)} kg
                  </TableCell>
                  <TableCell><CutStatusChip status={r.status} /></TableCell>
                  <TableCell><WhereCut location={r.location} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
      )}
      {meta.totals && meta.totals.reconciles === false && (
        <Typography sx={{ mt: 0.75, fontSize: '0.66rem', color: '#b45309' }}>
          The stock ledger shows {num(meta.totals.ledgerAvailableKg)} kg left on this batch.{' '}
          {num(meta.totals.coil?.otherOutKg)} kg left it outside these rounds (earlier spreadsheet cuts or adjustments, which name no coil).
        </Typography>
      )}
    </Box>
  );
};

// ── Filters ──────────────────────────────────────────────────────────────────
// Round-level filters (dates, circle, location) are asked of each cutting
// round on the server; the rest of each coil. See listCuttingHistory.
const NO_FILTERS = {
  batchNo: '', from: '', to: '', circleSkuId: '', location: '',
  entryType: '', status: '', search: '',
};
const TEXT_KEYS = ['batchNo', 'search'];
const SECONDARY_KEYS = ['entryType', 'status', 'search'];
const LOCATION_OPTIONS = [
  { value: 'PLG01', label: 'PLG01 — Plant' },
  { value: 'JW001', label: 'JW001 — Job Work' },
];
const fieldSx = { '& .MuiInputBase-input': { fontSize: '0.78rem' }, '& .MuiInputLabel-root': { fontSize: '0.78rem' } };

/**
 * COIL TO CIRCLE HISTORY — one row per PHYSICAL COIL, its rounds on expand.
 *
 * The main content of the Coil to Circle page. Every figure is derived on the
 * server from the coil's receipt (or manual entry), its rounds and the batch
 * ledger (rmIms.service.js → listCuttingHistory). Nothing here is typed by
 * anyone, least of all the status — and nothing is filtered or summed in the
 * browser: filtering, counting and paging all happen on the server.
 *
 *   refreshKey   changes after every save, so the list jumps back to page 1,
 *                where the coil just cut now sits (newest cut first). Filters
 *                are kept as they are.
 */
const CuttingHistoryPanel = ({ refreshKey = 0 }) => {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  // What the inputs show, and what has been sent. Text is sent after a pause
  // in typing; everything else as soon as it is picked.
  const [input, setInput] = useState(NO_FILTERS);
  const [applied, setApplied] = useState(NO_FILTERS);
  const [moreOpen, setMoreOpen] = useState(false);
  const [open, setOpen] = useState(() => new Set());

  // A save happened: back to page 1 (React's "adjust state on a prop change").
  const [seenRefresh, setSeenRefresh] = useState(refreshKey);
  if (seenRefresh !== refreshKey) { setSeenRefresh(refreshKey); setPage(0); }

  useEffect(() => {
    if (TEXT_KEYS.every((k) => applied[k] === input[k].trim())) return undefined;
    const t = setTimeout(() => {
      setApplied((a) => ({ ...a, ...Object.fromEntries(TEXT_KEYS.map((k) => [k, input[k].trim()])) }));
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [input, applied]);

  const setText = (k, v) => setInput((f) => ({ ...f, [k]: v }));
  const setNow = (k, v) => {
    setInput((f) => ({ ...f, [k]: v }));
    setApplied((a) => ({ ...a, [k]: v }));
    setPage(0);
  };
  const reset = () => { setInput(NO_FILTERS); setApplied(NO_FILTERS); setPage(0); };

  const dateError = !!(applied.from && applied.to && applied.from > applied.to);
  const anyFilter = Object.values(input).some(Boolean);
  const secondaryActive = SECONDARY_KEYS.filter((k) => input[k]).length;

  const params = { page: page + 1, limit: rowsPerPage };
  for (const [k, v] of Object.entries(applied)) if (v) params[k] = v;
  const {
    data, currentData, isFetching, isError, error, refetch,
  } = useGetRmCuttingHistoryQuery(params, { skip: dateError });
  // The answer for THESE filters — or, while it loads, the previous one shown
  // dimmed. Never a stale answer once the request has failed.
  const view = isError ? undefined : (currentData || (isFetching ? data : undefined));
  const stale = !!view && view !== currentData;
  const rows = view?.data || [];
  const meta = view?.meta || {};
  const untraceable = meta.untraceable || {};
  const matching = meta.matching || {};
  const total = meta.pagination?.total || 0;
  // S.No. from the page the rows were actually fetched for.
  const rowBase = ((meta.pagination?.page || 1) - 1) * (meta.pagination?.limit || rowsPerPage);

  // Never sit on a page past the end of the answer just received.
  const lastPage = Math.max(0, Math.ceil(total / rowsPerPage) - 1);
  if (currentData && page > lastPage) setPage(lastPage);

  const circleList = useGetRmCuttingHistoryCirclesQuery();
  const circleOptions = useMemo(() => circleList.data?.data || [], [circleList.data]);
  const circleValue = useMemo(
    () => circleOptions.find((c) => c.skuId === input.circleSkuId) || null,
    [circleOptions, input.circleSkuId],
  );

  const toggle = (id) => setOpen((p) => {
    const next = new Set(p);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const roundFiltered = !!meta.roundFiltered;
  const errorText = error?.status === 'FETCH_ERROR'
    ? 'The server could not be reached. Check the connection and try again.'
    : (error?.data?.message || 'The server did not return the history. Try again in a moment.');

  return (
    <>
      {/* ── Summary — for exactly the coils and rounds listed below ── */}
      {view && (
        <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap data-testid="history-cards" sx={{ opacity: stale ? 0.6 : 1 }}>
          <KpiTile label="Physical coils" value={num(meta.coils || 0)}
            sub={`${num(meta.partiallyCut || 0)} partially · ${num(meta.fullyCut || 0)} fully cut`}
            color="#0f766e" icon={Disc3} />
          <KpiTile label="Cutting rounds" value={num(matching.rounds || 0)}
            sub={roundFiltered ? 'Rounds matching the filters' : 'Across these coils'}
            color={O2D.brand} icon={Layers} />
          <KpiTile label="Coil weight cut" value={`${num(matching.cutKg || 0)} kg`}
            sub={`${num(matching.circlesKg || 0)} kg circles${matching.yieldPct != null ? ` · yield ${num(matching.yieldPct)}%` : ''}`}
            color="#4338ca" icon={CircleDashed} />
          <KpiTile label="Scrap generated" value={`${num(matching.scrapKg || 0)} kg`}
            sub={`PLG01 ${num(matching.plantScrapKg || 0)} kg · with job worker ${num(matching.jobWorkScrapKg || 0)} kg`}
            color="#b45309" icon={Trash2} />
        </Stack>
      )}

      <Panel
        title="Coil to Circle history"
        icon={History}
        hint="One row per physical coil: how much was cut, what it produced, what remains — open a row for every cutting round."
        dense
        actions={view && !dateError && (
          <Chip size="small" data-testid="history-count"
            label={`${num(total)} coil${total === 1 ? '' : 's'}${anyFilter ? ' match' : ''}${roundFiltered ? ` · ${num(matching.rounds || 0)} matching round${matching.rounds === 1 ? '' : 's'}` : ''}`}
            sx={{ height: 22, fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
        )}
      >
        {/* ── Filter bar: the four everyday filters first, the rest behind "More filters" ── */}
        <Box sx={{ px: 1.5, pt: 1.25, pb: 1, borderBottom: `1px solid ${O2D.lineSoft}` }} data-testid="history-filters">
          <Box sx={{
            display: 'grid', gap: 1, alignItems: 'start',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: '1.3fr 0.9fr 0.9fr 1.6fr 1fr auto' },
          }}>
            <TextField size="small" label="Batch number" value={input.batchNo} sx={fieldSx}
              onChange={(e) => setText('batchNo', e.target.value)} placeholder="Full or part of it"
              inputProps={{ 'data-testid': 'filter-batch' }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment> }} />
            <TextField size="small" type="date" label="Cut from" value={input.from} sx={fieldSx}
              onChange={(e) => setNow('from', e.target.value)} InputLabelProps={{ shrink: true }}
              inputProps={{ 'data-testid': 'filter-from', max: input.to || undefined }} />
            <TextField size="small" type="date" label="Cut to" value={input.to} sx={fieldSx}
              onChange={(e) => setNow('to', e.target.value)} InputLabelProps={{ shrink: true }}
              error={dateError} helperText={dateError ? 'Must be on or after "Cut from"' : undefined}
              inputProps={{ 'data-testid': 'filter-to', min: input.from || undefined }} />
            <Autocomplete
              size="small" options={circleOptions} value={circleValue}
              onChange={(_, v) => setNow('circleSkuId', v?.skuId || '')}
              loading={circleList.isFetching}
              noOptionsText={circleList.isError ? 'Could not load circle sizes' : 'No circle has been produced yet'}
              getOptionLabel={(o) => (o ? `${o.skuCode} — ${o.skuName}` : '')}
              isOptionEqualToValue={(a, b) => a.skuId === b?.skuId}
              renderOption={(props, o) => (
                <li {...props} key={o.skuId}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: '0.78rem', fontWeight: 700, color: O2D.ink }}>{o.skuCode}</Typography>
                    <Typography noWrap sx={{ fontSize: '0.66rem', color: O2D.sub }}>{o.skuName} · {num(o.rounds)} round{o.rounds === 1 ? '' : 's'}</Typography>
                  </Box>
                </li>
              )}
              renderInput={(p) => (
                <TextField {...p} label="Circle SKU produced" placeholder="All circle sizes" sx={fieldSx}
                  inputProps={{ ...p.inputProps, 'data-testid': 'filter-circle' }}
                  helperText={circleList.isError ? 'Could not load circle sizes — the other filters still work.' : undefined}
                  FormHelperTextProps={{ sx: { mx: 0, fontSize: '0.64rem', color: '#b91c1c' } }} />
              )}
            />
            <TextField select size="small" label="Cutting location" value={input.location} sx={fieldSx}
              onChange={(e) => setNow('location', e.target.value)}
              SelectProps={{ displayEmpty: true, 'data-testid': 'filter-location' }} InputLabelProps={{ shrink: true }}>
              <MenuItem value="">All locations</MenuItem>
              {LOCATION_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </TextField>
            <Stack direction="row" spacing={0.5} sx={{ gridColumn: { xs: '1 / -1', lg: 'auto' }, justifyContent: { xs: 'flex-start', lg: 'flex-end' } }}>
              <Button size="small" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen || secondaryActive > 0}
                startIcon={(
                  <Badge color="primary" badgeContent={secondaryActive} invisible={!secondaryActive}
                    sx={{ '& .MuiBadge-badge': { fontSize: '0.58rem', height: 15, minWidth: 15 } }}>
                    <SlidersHorizontal size={14} />
                  </Badge>
                )}
                sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.74rem', color: O2D.body, whiteSpace: 'nowrap', height: 40 }}>
                More filters
              </Button>
              <Button size="small" onClick={reset} disabled={!anyFilter} startIcon={<RotateCcw size={13} />}
                data-testid="filter-reset"
                sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.74rem', whiteSpace: 'nowrap', height: 40 }}>
                Reset filters
              </Button>
            </Stack>
          </Box>
          <Collapse in={moreOpen || secondaryActive > 0}>
            <Box sx={{
              display: 'grid', gap: 1, mt: 1,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: '1fr 1fr 2fr' },
            }}>
              <TextField select size="small" label="Entry type" value={input.entryType} sx={fieldSx}
                onChange={(e) => setNow('entryType', e.target.value)}
                SelectProps={{ displayEmpty: true, 'data-testid': 'filter-entry-type' }} InputLabelProps={{ shrink: true }}>
                <MenuItem value="">GRN-linked and manual</MenuItem>
                <MenuItem value="GRN">GRN-linked</MenuItem>
                <MenuItem value="MANUAL">Manual entry (no GRN)</MenuItem>
              </TextField>
              <TextField select size="small" label="Cutting status" value={input.status} sx={fieldSx}
                onChange={(e) => setNow('status', e.target.value)}
                SelectProps={{ displayEmpty: true, 'data-testid': 'filter-status' }} InputLabelProps={{ shrink: true }}>
                <MenuItem value="">Any status</MenuItem>
                <MenuItem value="PARTIALLY_CUT">Partially cut</MenuItem>
                <MenuItem value="FULLY_CUT">Fully cut</MenuItem>
              </TextField>
              <TextField size="small" label="Coil SKU, GRN, item or supplier" value={input.search} sx={fieldSx}
                onChange={(e) => setText('search', e.target.value)}
                inputProps={{ 'data-testid': 'filter-search' }}
                InputProps={{ startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment> }} />
            </Box>
          </Collapse>
          {roundFiltered && !dateError && (
            <Typography sx={{ mt: 0.75, fontSize: '0.64rem', color: O2D.sub }}>
              Date, circle and location are matched against each cutting round. A coil is listed when one of its rounds
              matches them all; its row still shows the whole coil, and the cards above add up only the matching rounds.
            </Typography>
          )}
        </Box>

        <TableScroll>
          <Table size="small" sx={{ ...historyTableSx, opacity: stale ? 0.55 : 1, transition: 'opacity .15s' }} aria-label="Coil to Circle history" aria-busy={isFetching}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 36 }} />
                <TableCell align="center" sx={{ width: 52, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell>Date cut</TableCell>
                <TableCell>Batch number</TableCell>
                <TableCell>GRN / Entry type</TableCell>
                <TableCell>Coil SKU / Item</TableCell>
                <TableCell>Cutting location</TableCell>
                <TableCell align="right">Total coil weight KG</TableCell>
                <TableCell align="right">Total cut KG</TableCell>
                <TableCell align="right">Circles PCS</TableCell>
                <TableCell align="right">Circles KG</TableCell>
                <TableCell align="right">Scrap KG</TableCell>
                <TableCell>Yield %</TableCell>
                <TableCell align="right">Remaining KG</TableCell>
                <TableCell>Cutting status</TableCell>
                <TableCell align="right">Rounds</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {dateError && (
                <TableRow><TableCell colSpan={COLS} sx={emptyCellSx}>
                  <EmptyNote icon={AlertTriangle} tone="#b45309" dense
                    title={'"Cut from" is after "Cut to"'} hint="Correct the dates to see the matching coils." />
                </TableCell></TableRow>
              )}
              {!dateError && !view && isFetching && [0, 1, 2].map((i) => (
                <TableRow key={i}><TableCell colSpan={COLS}><Skeleton height={24} /></TableCell></TableRow>
              ))}
              {!dateError && isError && !isFetching && (
                <TableRow><TableCell colSpan={COLS} sx={emptyCellSx}>
                  <Stack alignItems="center" spacing={0.75} sx={{ py: 1.5 }} data-testid="history-error">
                    <EmptyNote icon={AlertTriangle} tone="#b91c1c" title="Could not load the cutting history" hint={errorText} dense />
                    <Button size="small" variant="outlined" startIcon={<RefreshCw size={13} />} onClick={refetch}
                      sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem' }}>
                      Try again
                    </Button>
                  </Stack>
                </TableCell></TableRow>
              )}
              {!dateError && currentData && rows.length === 0 && (
                <TableRow><TableCell colSpan={COLS} sx={emptyCellSx}>
                  <Stack alignItems="center" spacing={0.5} sx={{ py: 1 }} data-testid="history-empty">
                    <EmptyNote icon={Scissors} dense
                      title={anyFilter ? 'No coil matches these filters' : 'No physical coil has been cut yet'}
                      hint={anyFilter ? 'Change or reset the filters to see more.' : 'Each coil appears here after its first round is saved with "+ Coil to Circle", and updates with every round after that.'} />
                    {anyFilter && (
                      <Button size="small" onClick={reset} startIcon={<RotateCcw size={13} />}
                        sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem' }}>
                        Reset filters
                      </Button>
                    )}
                  </Stack>
                </TableCell></TableRow>
              )}
              {!dateError && rows.map((c, i) => {
                // The physical coil — its receipt, or its manual entry (no GRN).
                const id = String(c.coilId || c.coilReceiptId);
                const isOpen = open.has(id);
                const jw = c.jobWorkScrapKg > 0;
                const multi = c.rounds > 1 && c.firstCutAt && day(c.firstCutAt) !== day(c.lastCutAt);
                return (
                  <React.Fragment key={id}>
                    <TableRow hover sx={{ cursor: 'pointer', '& > td': isOpen ? { borderBottom: 0 } : undefined }}
                      onClick={() => toggle(id)} data-testid="cut-history-row" data-batch={c.batchNo} data-source={c.coilSource}>
                      <TableCell sx={{ width: 36, pr: 0 }}>
                        <IconButton size="small" sx={{ color: O2D.sub }} aria-expanded={isOpen}
                          aria-label={isOpen ? `Hide rounds of batch ${c.batchNo}` : `Show rounds of batch ${c.batchNo}`}>
                          {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </IconButton>
                      </TableCell>
                      <TableCell align="center" sx={{ ...numCell, color: O2D.sub }} data-testid="cut-history-sno">{rowBase + i + 1}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: O2D.ink }}>{day(c.lastCutAt)}</Typography>
                        {multi && <Typography sx={{ fontSize: '0.62rem', color: O2D.faint }}>first {day(c.firstCutAt)}</Typography>}
                      </TableCell>
                      <TableCell>
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: O2D.ink, fontFamily: 'ui-monospace, monospace', whiteSpace: 'nowrap' }}>{c.batchNo || '—'}</Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 170 }}>
                        <EntryChip source={c.coilSource} />
                        <Typography noWrap sx={{ mt: 0.25, fontSize: '0.64rem', color: O2D.sub }}
                          title={c.coilSource === 'MANUAL' ? 'No goods receipt' : (c.grnNo || c.receiptNumber)}>
                          {c.coilSource === 'MANUAL' ? 'No GRN' : (c.grnNo || c.receiptNumber || '—')}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 200 }}>
                        <Typography noWrap sx={{ fontSize: '0.76rem', fontWeight: 700, color: O2D.ink }}>{c.skuCode || '—'}</Typography>
                        <Typography noWrap sx={{ fontSize: '0.64rem', color: O2D.sub }} title={c.itemName}>{c.itemName || '—'}</Typography>
                      </TableCell>
                      <TableCell><WhereCut location={c.location} /></TableCell>
                      <TableCell align="right" sx={numCell}>{num(c.receivedKg)}</TableCell>
                      <TableCell align="right" sx={{ ...numCell, fontWeight: 800 }}>{num(c.cutKg)}</TableCell>
                      <TableCell align="right" sx={numCell}>
                        <Tooltip arrow slotProps={O2D_TIP} title={c.circleSkuCodes?.length ? `Sizes produced: ${c.circleSkuCodes.join(', ')}` : 'No circle sizes recorded'}>
                          <Box component="span" sx={{ cursor: 'help' }}>{c.circlesPcs != null ? num(c.circlesPcs) : '—'}</Box>
                        </Tooltip>
                      </TableCell>
                      <TableCell align="right" sx={{ ...numCell, color: '#4338ca', fontWeight: 700 }}>{num(c.circlesKg)}</TableCell>
                      <TableCell align="right" sx={numCell}>
                        <Tooltip arrow slotProps={O2D_TIP} title={jw
                          ? `${num(c.plantScrapKg)} kg is Ambika scrap (cut at PLG01). ${num(c.jobWorkScrapKg)} kg stayed with the job worker (JW001) — calculated for traceability, never added to Ambika's scrap stock.`
                          : 'Cut at PLG01 — this scrap went into Ambika\'s scrap stock.'}>
                          <Box component="span" sx={{ cursor: 'help' }}>
                            <Typography component="span" sx={{ fontSize: '0.78rem', color: '#b45309', fontWeight: 700 }}>{num(c.scrapKg)}</Typography>
                            {jw && (
                              <Typography sx={{ fontSize: '0.6rem', color: '#7c3aed' }}>
                                {c.plantScrapKg > 0 ? `${num(c.jobWorkScrapKg)} with job worker` : 'with job worker'}
                              </Typography>
                            )}
                          </Box>
                        </Tooltip>
                      </TableCell>
                      <TableCell>{c.yieldPct != null ? <YieldChip pct={c.yieldPct} /> : '—'}</TableCell>
                      <TableCell align="right" sx={{ ...numCell, fontWeight: 800, color: c.remainingKg < 0 ? '#b91c1c' : O2D.ink }}>
                        <Stack direction="row" spacing={0.4} alignItems="center" justifyContent="flex-end">
                          {!c.reconciles && (
                            <Tooltip arrow slotProps={O2D_TIP}
                              title={`The stock ledger shows ${num(c.ledgerAvailableKg)} kg left on this batch: ${num(c.otherOutKg)} kg left it outside these rounds (earlier spreadsheet cuts or adjustments, which name no coil). Status follows the ledger.`}>
                              <Box component="span" sx={{ display: 'flex', color: '#b45309' }}><AlertTriangle size={13} /></Box>
                            </Tooltip>
                          )}
                          <span>{num(c.remainingKg)}</span>
                        </Stack>
                      </TableCell>
                      <TableCell><CutStatusChip status={c.status} /></TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Stack direction="row" spacing={0.25} alignItems="center" justifyContent="flex-end">
                          <Tooltip arrow slotProps={O2D_TIP} title={isOpen ? 'Hide the cutting rounds' : 'View every cutting round of this coil'}>
                            <Button size="small" variant={isOpen ? 'contained' : 'outlined'} disableElevation
                              onClick={(e) => { e.stopPropagation(); toggle(id); }} data-testid="cut-history-rounds"
                              sx={{ minWidth: 0, px: 1, py: 0.1, textTransform: 'none', fontWeight: 800, fontSize: '0.7rem', borderRadius: '6px' }}>
                              {c.rounds} round{c.rounds === 1 ? '' : 's'}
                            </Button>
                          </Tooltip>
                          <Tooltip arrow slotProps={O2D_TIP} title="Open this coil's full history page">
                            <IconButton size="small" aria-label={`Open the history page of batch ${c.batchNo}`}
                              onClick={(e) => { e.stopPropagation(); navigate(`/rm-ims/coil/${id}`); }}
                              sx={{ color: O2D.brand }}>
                              <ArrowUpRight size={15} />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                        {roundFiltered && c.matchedRounds < c.rounds && (
                          <Typography sx={{ fontSize: '0.6rem', color: O2D.sub, mt: 0.25 }} data-testid="cut-history-matched">
                            {c.matchedRounds} of {c.rounds} match
                          </Typography>
                        )}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell colSpan={COLS} sx={{ p: 0, border: 0 }}>
                        <Collapse in={isOpen} unmountOnExit>
                          <CoilRounds receiptId={id} />
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
        <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap sx={{ px: 1.5, borderTop: `1px solid ${O2D.lineSoft}` }}>
          {/* Always stated, even at zero: cuts that name no coil are real and
              sit outside this table, and the reader is told how many. Only once
              the count is KNOWN — a "0" shown while loading would be a false fact. */}
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ py: 0.75, mr: 'auto', maxWidth: 720 }}>
            {view && (
              <>
                <Box sx={{ color: O2D.faint, display: 'flex' }}><HelpCircle size={13} /></Box>
                <Typography sx={{ fontSize: '0.66rem', color: O2D.sub }} data-testid="cut-history-untraceable">
                  {num(untraceable.records || 0)} older cut{untraceable.records === 1 ? '' : 's'} ({num(untraceable.cutKg || 0)} kg) name no physical coil — spreadsheet imports
                  or “No receipt available” — so they are not shown as rounds here or counted above. They remain in All conversions below.
                </Typography>
              </>
            )}
          </Stack>
          <TablePagination
            component="div" count={total} page={total ? page : 0} rowsPerPage={rowsPerPage}
            onPageChange={(_, p) => setPage(p)}
            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50]}
            sx={{ '& .MuiTablePagination-toolbar': { minHeight: 40 } }}
          />
        </Stack>
      </Panel>
    </>
  );
};

export default CuttingHistoryPanel;
