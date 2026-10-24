import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, InputAdornment, MenuItem, Button, Skeleton, Chip,
  Table, TableHead, TableBody, TableRow, TableCell, TablePagination, IconButton, Tooltip, Popover,
} from '@mui/material';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Recycle, Search, Download, Eye, Disc3, Scale, CircleDashed, Layers, RotateCcw, AlertTriangle, RefreshCw,
  CalendarDays, ChevronDown,
} from 'lucide-react';
import dayjs from 'dayjs';
import {
  ScrapShell, SCRAP_ACCENT, Panel, TableScroll, KpiTile, EmptyNote, LocationChip,
  yieldBand, YIELD_GOOD_PCT, YIELD_HIGH_PCT, YIELD_LOW_PCT, LOCATION_TOKENS,
  kg, O2D, O2D_TIP, num, imsTableSx,
} from './scrapImsMeta';
import { OverallYield, CircleSkus } from './scrapMasterShared';
import { DateSortField } from '../rm-ims/cuttingShared';
import { SORTS } from '../rm-ims/cuttingFilters';
import { useGetScrapSkuHistoryQuery } from '../../store/api/scrapImsApi';

/**
 * ONE COIL SKU — opened from its row on Scrap master data.
 *
 * Cards with what the grade has given (cuts, coil cut, circles, scrap and the
 * overall yield), its yield month by month and its circles by size; then
 * every cut of it as a sheet, newest first, scrolling left to right: the
 * date, batch, whether it was a full cut, a partial cut or never cut, the
 * coil weight it took, the circle SKUs, pieces and weight, the scrap, the
 * yield, where it was cut and the conversion.
 *
 * Opened on the master page's filters (they ride in the URL) so the cards
 * match the row that was clicked; they can be changed here too. Every figure
 * is the server's (scrapIms.service.js → getSkuHistory).
 */

// Newest or oldest first — A → Z means nothing inside one coil SKU.
const DETAIL_SORTS = SORTS.filter((s) => s.value !== 'az');
const ROWS_PER_PAGE = [10, 25, 50, 100];
const BAND_NOTE = `Green ${YIELD_GOOD_PCT}–${YIELD_HIGH_PCT}% is normal · amber below ${YIELD_LOW_PCT}% · red above ${YIELD_HIGH_PCT}% (check the weights).`;
const day = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
const numSx = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

/** How a row was cut — the operator's choice where it was recorded. */
const CUTTING = {
  FULL: { label: 'Full cut', color: '#15803d', tip: 'The coil was finished in this cut — its circles, scrap and yield are for the whole coil.' },
  PARTIAL_WAIT: { label: 'Partial cut', color: '#b45309', tip: 'Only the coil weight is entered for a partial cut — its circles, scrap and yield come with the coil\'s full cut.' },
  PARTIAL_OLD: { label: 'Partial cut', color: '#b45309', tip: 'Part of the coil, with its circles entered at the time (recorded before partial cuts waited for the full cut).' },
  CUT: { label: 'Cut', color: '#1d4ed8', tip: 'Cut — the cutting type was not recorded (an imported or older entry).' },
  UNCUT: { label: 'Not cut', color: '#b91c1c', tip: 'On the client\'s sheet, but this coil was never cut — not scrap, and left out of every figure.' },
  CORRECTION: { label: 'Correction', color: '#7c3aed', tip: 'A stock correction of this SKU\'s scrap — the change it made. Not a cut: no coil, circles or yield.' },
};
const cuttingOf = (r) => {
  // Its tooltip is the correction itself: who, which number, recorded → counted.
  if (r.kind === 'CORRECTION') return { ...CUTTING.CORRECTION, tip: r.remarks || CUTTING.CORRECTION.tip };
  if (r.kind === 'UNCUT') return CUTTING.UNCUT;
  if (r.kind === 'PARTIAL') return CUTTING.PARTIAL_WAIT;
  if (r.cuttingType === 'FULL') return CUTTING.FULL;
  if (r.cuttingType === 'PARTIAL') return CUTTING.PARTIAL_OLD;
  return CUTTING.CUT;
};
const CuttingChip = ({ r }) => {
  const t = cuttingOf(r);
  return (
    <Tooltip arrow slotProps={O2D_TIP} title={t.tip}>
      <Chip size="small" label={t.label} data-testid="sku-cut-type"
        sx={{ height: 22, fontWeight: 700, fontSize: '0.66rem', borderRadius: '999px', cursor: 'help', bgcolor: `${t.color}12`, color: t.color, border: `1px solid ${t.color}44` }} />
    </Tooltip>
  );
};
// "—" for a figure a row does not have, saying why.
const Missing = ({ r }) => (
  <Tooltip arrow slotProps={O2D_TIP} title={cuttingOf(r).tip}>
    <Box component="span" sx={{ color: O2D.faint, cursor: 'help' }}>—</Box>
  </Tooltip>
);

/**
 * The sheet: every column its own width, bold one-line headers fixed at the
 * top, the Action column pinned at the right, and a box never taller than
 * the screen — so the sideways scrollbar is always in view, as in Excel.
 */
const COLS = {
  sno: 56, date: 112, batch: 140, cutting: 112, cutKg: 125, circle: 220, pcs: 95, circleKg: 125, scrap: 110, yield: 100, where: 120, conv: 165, action: 84,
};
const colSx = (k) => ({ width: COLS[k], minWidth: COLS[k] });
const sheetSx = (() => {
  const base = imsTableSx(Object.values(COLS).reduce((s, w) => s + w, 0));
  return {
    ...base,
    tableLayout: 'fixed',
    borderCollapse: 'separate',
    borderSpacing: 0,
    '& td, & th': { ...base['& td, & th'], px: 0.75 },
    '& tbody > tr > td': { py: 1 },
    '& > .MuiTableHead-root > .MuiTableRow-root > .MuiTableCell-root': {
      ...base['& thead th'], whiteSpace: 'nowrap', textTransform: 'none', letterSpacing: 0,
      fontSize: '0.74rem', fontWeight: 800, color: O2D.ink, position: 'sticky', top: 0, zIndex: 2,
      borderBottom: `1px solid ${O2D.line}`,
    },
  };
})();
const actionSx = (bg) => ({
  ...colSx('action'), position: 'sticky', right: 0, zIndex: 1, bgcolor: bg, whiteSpace: 'nowrap',
  boxShadow: `inset 1px 0 0 ${O2D.line}, -8px 0 10px -8px rgba(28,30,33,0.22)`,
  'tr:hover > &': { bgcolor: O2D.surfaceAlt },
});
const scrollSx = { overflowY: 'auto', maxHeight: { md: 'max(420px, calc(100vh - 250px))' } };

/**
 * THE TWO POPUPS of the filter bar — read only when asked for, so the page
 * itself is the cards and the sheet. Plain tables: one row a month (newest
 * first) or a circle size, every figure in its own column.
 */
const peekBtnSx = {
  textTransform: 'none', fontWeight: 700, fontSize: '0.78rem', height: 40, borderRadius: '7px',
  borderColor: O2D.line, color: O2D.body, whiteSpace: 'nowrap',
};
const peekTableSx = {
  '& th': { fontSize: '0.68rem', fontWeight: 800, color: O2D.sub, bgcolor: O2D.surfaceAlt, whiteSpace: 'nowrap', py: 0.75 },
  '& td': { fontSize: '0.76rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', py: 0.6 },
};
const PeekHead = ({ title, hint }) => (
  <Box sx={{ px: 1.5, pt: 1.25, pb: 0.75 }}>
    <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: O2D.ink }}>{title}</Typography>
    <Typography sx={{ fontSize: '0.66rem', color: O2D.sub }}>{hint}</Typography>
  </Box>
);
const MonthTable = ({ months }) => (
  <Box sx={{ minWidth: 460 }}>
    <PeekHead title="Yield by month" hint={`Circles ÷ coil cut, month by month. ${BAND_NOTE}`} />
    <Table size="small" stickyHeader sx={peekTableSx}>
      <TableHead>
        <TableRow>
          <TableCell>Month</TableCell>
          <TableCell align="center">Cuts</TableCell>
          <TableCell align="right">Coil cut</TableCell>
          <TableCell align="right">Circles</TableCell>
          <TableCell align="right">Scrap</TableCell>
          <TableCell align="center">Yield</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {[...months].reverse().map((m) => {
          const band = yieldBand(m.yieldPct);
          return (
            <TableRow key={m.month || 'none'} hover>
              <TableCell sx={{ fontWeight: 700, color: O2D.ink }}>{m.month ? dayjs(`${m.month}-01`).format('MMM YYYY') : '—'}</TableCell>
              <TableCell align="center">{num(m.cuts)}</TableCell>
              <TableCell align="right">{kg(m.coilKg)}</TableCell>
              <TableCell align="right">{kg(m.circlesKg)}</TableCell>
              <TableCell align="right" sx={{ color: SCRAP_ACCENT, fontWeight: 700 }}>{kg(m.scrapKg)}</TableCell>
              <TableCell align="center" sx={{ fontWeight: 800, color: band?.color || O2D.faint }}>{m.yieldPct == null ? '—' : `${num(m.yieldPct)}%`}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  </Box>
);
const CircleTable = ({ circles }) => (
  <Box sx={{ minWidth: 380 }}>
    <PeekHead title="Circles by size" hint="Every circle size cut from this coil SKU." />
    <Table size="small" stickyHeader sx={peekTableSx}>
      <TableHead>
        <TableRow>
          <TableCell>Circle SKU</TableCell>
          <TableCell align="right">Pieces</TableCell>
          <TableCell align="right">Weight</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {circles.map((c) => (
          <TableRow key={c.code} hover>
            <TableCell>
              <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: '#4338ca' }}>{c.code}</Typography>
              {c.name && <Typography sx={{ fontSize: '0.64rem', color: O2D.sub }}>{c.name}</Typography>}
            </TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>{num(c.pcs)} pcs</TableCell>
            <TableCell align="right">{kg(c.kg)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </Box>
);

const ScrapImsSkuDetail = () => {
  const { code: rawCode } = useParams();
  const code = decodeURIComponent(rawCode || '');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [input, setInput] = useState(() => ({
    search: params.get('search') || '',
    from: params.get('from') || '',
    to: params.get('to') || '',
    sort: '',
    location: ['PLG01', 'JW001'].includes(params.get('location')) ? params.get('location') : '',
  }));
  const [appliedSearch, setAppliedSearch] = useState(() => (params.get('search') || '').trim());
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  // Which popup is open from the filter bar: the yield by month or the circle sizes.
  const [peek, setPeek] = useState(null);

  useEffect(() => {
    if (input.search.trim() === appliedSearch) return undefined;
    const t = setTimeout(() => { setAppliedSearch(input.search.trim()); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [input.search, appliedSearch]);
  const setNow = (k, v) => { setInput((f) => ({ ...f, [k]: v })); setPage(0); };
  const setMany = (patch) => { setInput((f) => ({ ...f, ...patch })); setPage(0); };
  const reset = () => { setInput({ search: '', from: '', to: '', sort: '', location: '' }); setAppliedSearch(''); setPage(0); };
  const anyFilter = Object.values(input).some(Boolean);

  const filters = useMemo(() => {
    const f = { search: appliedSearch, from: input.from, to: input.to, location: input.location };
    return Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  }, [appliedSearch, input.from, input.to, input.location]);
  const {
    data, currentData, isFetching, isError, error, refetch,
  } = useGetScrapSkuHistoryQuery({ coilSkuCode: code, ...filters }, { skip: !code });
  const view = isError ? undefined : (currentData || (isFetching ? data : undefined));
  const stale = !!view && view !== currentData;
  const s = view?.meta || {};
  // Newest first from the server; "Oldest first" turns it round.
  const all = useMemo(() => {
    const rows = view?.data || [];
    return input.sort === 'oldest' ? [...rows].reverse() : rows;
  }, [view, input.sort]);
  const rows = all.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

  const back = () => {
    const qs = new URLSearchParams(filters).toString();
    navigate(`/scrap-ims/records${qs ? `?${qs}` : ''}`);
  };

  const exportCsv = () => {
    const header = ['Date', 'Batch No', 'Cutting', 'Coil cut (kg)', 'Coil the circles came from (kg)', 'Circle SKUs', 'Circles (pcs)',
      'Circle weight (kg)', 'Scrap (kg)', 'Yield %', 'Where', 'Conversion'];
    const lines = all.map((r) => [
      r.date ? dayjs(r.date).format('YYYY-MM-DD') : '', r.batchNo, cuttingOf(r).label, r.kind === 'UNCUT' || r.kind === 'CORRECTION' ? '' : r.cutKg, r.basisKg || '',
      r.circleSkus.map((c) => `${c.code} (${c.pcs} pcs, ${c.kg} kg)`).join(' | '), r.circlesPcs ?? '', r.circlesKg ?? '',
      r.scrapKg ?? '', r.yieldPct ?? '', r.location || '', r.conversionNumber,
    ]);
    const csv = [header, ...lines].map((x) => x.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `scrap_${code}_${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const fieldSx = { '& .MuiInputBase-root': { height: 40, bgcolor: O2D.surface, borderRadius: '7px', fontSize: '0.8rem' } };
  const cutsSub = [
    s.partialRounds ? `${num(s.partialRounds)} partial` : null,
    s.uncut ? `${num(s.uncut)} not cut` : null,
  ].filter(Boolean).join(' · ') || 'Cuts with scrap recorded';

  return (
    <ScrapShell
      icon={Recycle}
      title={`Coil SKU ${code}`}
      subtitle={`${s.coilSkuName ? `${s.coilSkuName} — ` : ''}every cut of this coil SKU, date by date.`}
      onBack={back}
      backLabel="Back to Scrap master data"
      actions={(
        <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!all.length}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
          Export
        </Button>
      )}
    >
      {/* ── What this coil SKU has given — the same figures as its row ── */}
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap sx={{ opacity: stale ? 0.6 : 1 }}>
        <KpiTile label="Cuts" value={num(s.cuts || 0)} sub={cutsSub} color={O2D.brand} icon={Layers} />
        <KpiTile label="Coil cut" value={kg(s.coilKg || 0)}
          sub={s.pendingKg > 0.005 ? `+ ${kg(s.pendingKg)} waiting for its full cut` : 'Total coil weight cut'} color="#0f766e" icon={Scale} />
        <KpiTile label="Circles produced" value={`${num(s.circlesPcs || 0)} pcs`} sub={kg(s.circlesKg || 0)} color="#4338ca" icon={CircleDashed} />
        <KpiTile label="Scrap generated" value={kg(s.scrapKg || 0)}
          sub={`In-house ${kg(s.plantScrapKg || 0)} · Job work ${kg(s.jobWorkScrapKg || 0)}`} color={SCRAP_ACCENT} icon={Recycle} />
        <Tooltip arrow slotProps={O2D_TIP} title={`Circles ${kg(s.circlesKg || 0)} ÷ coil cut ${kg(s.coilKg || 0)} × 100. ${BAND_NOTE}`}>
          <Box sx={{ display: 'flex', flex: '1 1 160px', minWidth: 155 }}>
            <KpiTile label="Overall yield" value={s.yieldPct != null ? `${num(s.yieldPct)}%` : '—'}
              sub="Circles ÷ coil cut" color={yieldBand(s.yieldPct)?.color || '#15803d'} icon={Recycle} />
          </Box>
        </Tooltip>
      </Stack>

      {/* ── Search and filters, one line — the monthly yield and the circle
          sizes are a click away here, not spread over the page ── */}
      <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" value={input.search} onChange={(e) => setInput((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search batch, circle SKU, conversion…" sx={{ ...fieldSx, flex: '1 1 220px', minWidth: 180 }}
            inputProps={{ 'data-testid': 'sku-search' }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} color={O2D.sub} /></InputAdornment> }} />
          <Box sx={{ flex: '0 1 210px', minWidth: 170 }}>
            <DateSortField id="scrap-sku-date-sort" input={input} setNow={setNow} setMany={setMany} sorts={DETAIL_SORTS} testId="sku-date-sort" />
          </Box>
          <TextField select size="small" value={input.location} onChange={(e) => setNow('location', e.target.value)}
            SelectProps={{ displayEmpty: true }} sx={{ ...fieldSx, flex: '0 1 170px', minWidth: 140 }} inputProps={{ 'aria-label': 'Where it was cut' }}>
            <MenuItem value="">All locations</MenuItem>
            <MenuItem value="PLG01">{LOCATION_TOKENS.PLG01.label}</MenuItem>
            <MenuItem value="JW001">{LOCATION_TOKENS.JW001.label}</MenuItem>
          </TextField>
          <Button variant="outlined" onClick={(e) => setPeek({ el: e.currentTarget, what: 'months' })} disabled={!s.months?.length}
            startIcon={<CalendarDays size={14} />} endIcon={<ChevronDown size={14} />} data-testid="sku-month-yields"
            sx={peekBtnSx}>
            Yield by month
          </Button>
          <Button variant="outlined" onClick={(e) => setPeek({ el: e.currentTarget, what: 'circles' })} disabled={!s.circleSkus?.length}
            startIcon={<CircleDashed size={14} />} endIcon={<ChevronDown size={14} />} data-testid="sku-circle-sizes"
            sx={peekBtnSx}>
            Circles by size
          </Button>
          <Button onClick={reset} disabled={!anyFilter} startIcon={<RotateCcw size={14} />}
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.78rem', height: 40, color: O2D.body }}>
            Reset
          </Button>
        </Stack>
      </Paper>

      <Popover open={!!peek} anchorEl={peek?.el} onClose={() => setPeek(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 0.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, maxHeight: 420 } } }}>
        {peek?.what === 'months' && <MonthTable months={s.months || []} />}
        {peek?.what === 'circles' && <CircleTable circles={s.circleSkus || []} />}
      </Popover>

      {/* ── Every cut, as a sheet ── */}
      <Panel dense>
        <TableScroll sx={scrollSx}>
          <Table size="small" sx={{ ...sheetSx, opacity: stale ? 0.55 : 1 }} aria-label={`Every cut of ${code}`} aria-busy={isFetching}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={colSx('sno')}>S.No.</TableCell>
                <TableCell align="center" sx={colSx('date')}>Date</TableCell>
                <TableCell sx={colSx('batch')}>Batch No.</TableCell>
                <TableCell align="center" sx={colSx('cutting')}>Cutting</TableCell>
                <TableCell align="center" sx={colSx('cutKg')}>Coil cut (kg)</TableCell>
                <TableCell sx={colSx('circle')}>Circle SKU</TableCell>
                <TableCell align="center" sx={colSx('pcs')}>Circles (pcs)</TableCell>
                <TableCell align="center" sx={colSx('circleKg')}>Circle weight (kg)</TableCell>
                <TableCell align="center" sx={colSx('scrap')}>Scrap (kg)</TableCell>
                <TableCell align="center" sx={colSx('yield')}>Yield</TableCell>
                <TableCell align="center" sx={colSx('where')}>Where</TableCell>
                <TableCell sx={colSx('conv')}>Conversion No.</TableCell>
                <TableCell align="center" sx={{ ...actionSx(O2D.surfaceAlt) }}>Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!view && isFetching && (
                <TableRow><TableCell colSpan={13} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={240} /></TableCell></TableRow>
              )}
              {!view && isError && !isFetching && (
                <TableRow><TableCell colSpan={13} sx={{ border: 0 }}>
                  <Stack alignItems="center" spacing={0.75} sx={{ py: 1.5 }}>
                    <EmptyNote icon={AlertTriangle} title={`Could not load the cuts of ${code}.`}
                      hint={error?.data?.message || 'The server did not answer. Try again in a moment.'} dense />
                    <Button size="small" variant="outlined" startIcon={<RefreshCw size={13} />} onClick={refetch}
                      sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem' }}>Try again</Button>
                  </Stack>
                </TableCell></TableRow>
              )}
              {view && !all.length && (
                <TableRow><TableCell colSpan={13} sx={{ border: 0 }}>
                  <EmptyNote icon={Search} title={`No cut of ${code} matches these filters`} hint="Change or reset the filters to see more." />
                </TableCell></TableRow>
              )}
              {rows.map((r, i) => {
                const coilId = r.coilReceiptId || r.manualCoilId;
                const pending = r.kind !== 'CUT';
                const correction = r.kind === 'CORRECTION';
                const bg = r.kind === 'UNCUT' ? '#fffbeb' : O2D.surface;
                return (
                  <TableRow key={`${r.kind}-${r.id}`} hover data-testid="sku-cut-row" data-kind={r.kind}
                    sx={r.kind === 'UNCUT' ? { bgcolor: '#fffbeb' } : undefined}>
                    <TableCell align="center" sx={{ ...numSx, color: O2D.sub }}>{page * rowsPerPage + i + 1}</TableCell>
                    <TableCell align="center" sx={{ ...numSx, fontWeight: 700, color: O2D.ink }}>{day(r.date)}</TableCell>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.74rem', whiteSpace: 'nowrap' }}>
                      {coilId ? (
                        <Tooltip arrow slotProps={O2D_TIP} title="Open this physical coil — every round it was cut in">
                          <Box component="button" type="button" onClick={() => navigate(`/rm-ims/coil/${coilId}`)}
                            sx={{ p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer', color: O2D.brand, fontWeight: 700, fontFamily: 'inherit', fontSize: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 0.5, '&:hover': { textDecoration: 'underline' } }}>
                            <Disc3 size={12} />{r.batchNo || '—'}
                          </Box>
                        </Tooltip>
                      ) : (r.batchNo || '—')}
                    </TableCell>
                    <TableCell align="center"><CuttingChip r={r} /></TableCell>
                    <TableCell align="center">
                      {r.kind === 'UNCUT' || correction ? <Missing r={r} /> : (
                        <>
                          <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: O2D.ink, ...numSx }}>{num(r.cutKg)}</Typography>
                          {/* A full cut that settled earlier partial rounds: its circles
                              came from more coil than this round took. */}
                          {r.basisKg > r.cutKg + 0.001 && (
                            <Tooltip arrow slotProps={O2D_TIP}
                              title={`This full cut's circles came from ${kg(r.basisKg)} of the coil — this cut's ${kg(r.cutKg)} and ${kg(r.basisKg - r.cutKg)} cut in the partial rounds before it. Scrap and yield are over all of it.`}>
                              <Typography sx={{ fontSize: '0.62rem', color: O2D.sub, cursor: 'help', ...numSx }}>of {num(r.basisKg)} kg coil</Typography>
                            </Tooltip>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell>{pending ? <Box sx={{ textAlign: 'center' }}><Missing r={r} /></Box> : <CircleSkus list={r.circleSkus} />}</TableCell>
                    <TableCell align="center" sx={{ ...numSx, fontWeight: 700 }}>{pending ? <Missing r={r} /> : num(r.circlesPcs)}</TableCell>
                    <TableCell align="center" sx={{ ...numSx, color: '#4338ca', fontWeight: 600 }}>{pending ? <Missing r={r} /> : num(r.circlesKg)}</TableCell>
                    <TableCell align="center" sx={{ ...numSx, fontWeight: 800, color: SCRAP_ACCENT }}>
                      {/* A correction shows the change it made: +12.5 or −42.67. */}
                      {correction ? `${r.scrapKg < 0 ? '−' : '+'}${num(Math.abs(r.scrapKg))}` : pending ? <Missing r={r} /> : num(r.scrapKg)}
                    </TableCell>
                    <TableCell align="center">
                      {pending ? <Missing r={r} /> : <OverallYield pct={r.yieldPct} circlesKg={r.circlesKg} coilKg={r.basisKg} label="Yield" testId="sku-yield" />}
                    </TableCell>
                    <TableCell align="center">{r.location ? <LocationChip location={r.location} /> : <Box component="span" sx={{ color: O2D.faint }}>—</Box>}</TableCell>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.7rem', color: O2D.sub, whiteSpace: 'nowrap' }}>{r.conversionNumber || '—'}</TableCell>
                    <TableCell align="center" sx={actionSx(bg)}>
                      <Stack direction="row" spacing={0.25} justifyContent="center">
                        {r.scrapRecordId && !correction && (
                          <Tooltip arrow slotProps={O2D_TIP} title="Open this cut's scrap record">
                            <IconButton size="small" onClick={() => navigate(`/scrap-ims/record/${r.scrapRecordId}`)} sx={{ color: O2D.sub }}><Eye size={15} /></IconButton>
                          </Tooltip>
                        )}
                        {coilId && (
                          <Tooltip arrow slotProps={O2D_TIP} title="Open this physical coil">
                            <IconButton size="small" onClick={() => navigate(`/rm-ims/coil/${coilId}`)} sx={{ color: O2D.sub }}><Disc3 size={15} /></IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
        <Stack direction="row" alignItems="center" sx={{ px: 1.5, borderTop: `1px solid ${O2D.lineSoft}` }}>
          {s.truncated && (
            <Typography sx={{ fontSize: '0.66rem', color: O2D.sub, mr: 'auto' }}>Showing the newest 5,000 cuts — narrow the dates to see older ones.</Typography>
          )}
          <Box sx={{ ml: 'auto' }}>
            <TablePagination
              component="div" count={all.length} page={all.length ? page : 0} onPageChange={(_, p) => setPage(p)}
              rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
              rowsPerPageOptions={ROWS_PER_PAGE} labelRowsPerPage="Rows per page:"
              sx={{ border: 0, '& .MuiTablePagination-toolbar': { minHeight: 40 }, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.74rem', color: O2D.body } }}
            />
          </Box>
        </Stack>
      </Panel>
    </ScrapShell>
  );
};

export default ScrapImsSkuDetail;
