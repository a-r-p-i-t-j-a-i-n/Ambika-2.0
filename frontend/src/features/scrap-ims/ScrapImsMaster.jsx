import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, InputAdornment, MenuItem, Button, Skeleton,
  Table, TableHead, TableBody, TableRow, TableCell, TablePagination, Tooltip,
} from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Recycle, Search, Download, ChevronRight, Scale, CircleDashed, Layers, RotateCcw, AlertTriangle,
} from 'lucide-react';
import dayjs from 'dayjs';
import {
  ScrapShell, SCRAP_ACCENT, Panel, TableScroll, KpiTile, EmptyNote,
  yieldBand, YIELD_GOOD_PCT, YIELD_HIGH_PCT, YIELD_LOW_PCT, LOCATION_TOKENS,
  kg, O2D, O2D_TIP, num, imsTableSx,
} from './scrapImsMeta';
import { OverallYield, CircleSkus } from './scrapMasterShared';
import { DateSortField } from '../rm-ims/cuttingShared';
import { SORTS } from '../rm-ims/cuttingFilters';
import { useGetScrapMasterBySkuQuery } from '../../store/api/scrapImsApi';

/**
 * SCRAP MASTER DATA — one row per COIL SKU.
 *
 * What a coil grade has given, whichever coil or purchase it came from: the
 * coil cut, the circles (by circle SKU — one coil can be cut into several
 * sizes), the scrap, and the yield over all of it. Click a row for the coil
 * SKU's own page — every cut of it, one by one (ScrapImsSkuDetail.jsx) — opened
 * on the same filters.
 *
 * The yield is the OVERALL one — every circle ÷ every kilogram of coil cut —
 * colour-coded by the client's own bands, and its tooltip shows how it was
 * worked out and how it moved month by month (September 80%, October 82%…).
 *
 * The per-cut register (with "Cut?" and the coils that were never cut) is
 * Cut history (ScrapImsList.jsx). Every figure here is from the server
 * (scrapIms.service.js → getMasterBySku); nothing is summed in the browser.
 */

// Most scrap first, beside the shared orders — the question this page answers.
const MASTER_SORTS = [...SORTS, { value: 'scrap', label: 'Most scrap first', short: 'Most scrap' }];
const NO_FILTERS = { search: '', from: '', to: '', sort: '', location: '' };
const ROWS_PER_PAGE = [10, 25, 50, 100];
const day = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');
const numSx = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const BAND_NOTE = `Green ${YIELD_GOOD_PCT}–${YIELD_HIGH_PCT}% is normal · amber below ${YIELD_LOW_PCT}% · red above ${YIELD_HIGH_PCT}% (check the weights).`;

/**
 * The sheet: every column its own width, one-line bold headers that stay at
 * the top while the rows scroll, and a box never taller than the screen, so
 * its sideways scrollbar is always in view.
 */
const COLS = {
  sno: 56, coil: 140, circle: 220, cuts: 70, coilKg: 120, circles: 120, scrap: 120, yield: 100, last: 112, open: 40,
};
const colSx = (k) => ({ width: COLS[k], minWidth: COLS[k] });
const masterTableSx = (() => {
  const base = imsTableSx(Object.values(COLS).reduce((s, w) => s + w, 0));
  return {
    ...base,
    tableLayout: 'fixed',
    borderCollapse: 'separate',
    borderSpacing: 0,
    '& td, & th': { ...base['& td, & th'], px: 0.75 },
    '& tbody > tr[data-sku] > td': { py: 1.1 },
    '& > .MuiTableHead-root > .MuiTableRow-root > .MuiTableCell-root': {
      ...base['& thead th'], whiteSpace: 'nowrap', textTransform: 'none', letterSpacing: 0,
      fontSize: '0.74rem', fontWeight: 800, color: O2D.ink, position: 'sticky', top: 0, zIndex: 2,
      borderBottom: `1px solid ${O2D.line}`,
    },
  };
})();
const scrollSx = { overflowY: 'auto', maxHeight: { md: 'max(420px, calc(100vh - 250px))' } };

/** Scrap, with where it was cut in the tooltip (in-house is stock; job work is not). */
const ScrapKg = ({ r }) => (
  <Tooltip arrow slotProps={O2D_TIP}
    title={`In-house (PLG01) ${kg(r.plantScrapKg)} — Ambika's scrap stock. Job work (JW001) ${kg(r.jobWorkScrapKg)} — stayed with the job worker.`}>
    <Box component="span" sx={{ cursor: 'help', fontWeight: 800, color: SCRAP_ACCENT, ...numSx }}>{num(r.scrapKg)}</Box>
  </Tooltip>
);

const ScrapImsMaster = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Opened with filters (a dashboard link, or Back from a coil SKU's page).
  const [input, setInput] = useState(() => ({
    ...NO_FILTERS,
    search: params.get('search') || '',
    from: params.get('from') || '',
    to: params.get('to') || '',
    sort: params.get('sort') || '',
    location: ['PLG01', 'JW001'].includes(params.get('location')) ? params.get('location') : '',
  }));
  const [appliedSearch, setAppliedSearch] = useState(() => (params.get('search') || '').trim());
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // The search is sent after a pause in typing; everything else at once.
  useEffect(() => {
    if (input.search.trim() === appliedSearch) return undefined;
    const t = setTimeout(() => { setAppliedSearch(input.search.trim()); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [input.search, appliedSearch]);
  const setNow = (k, v) => { setInput((f) => ({ ...f, [k]: v })); setPage(0); };
  const setMany = (patch) => { setInput((f) => ({ ...f, ...patch })); setPage(0); };
  const reset = () => { setInput(NO_FILTERS); setAppliedSearch(''); setPage(0); };
  const anyFilter = Object.values(input).some(Boolean);

  // The filters every row shares — and the coil SKU's page opens on.
  const filters = useMemo(() => {
    const f = { search: appliedSearch, from: input.from, to: input.to, location: input.location };
    return Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  }, [appliedSearch, input.from, input.to, input.location]);
  const query = { ...filters, ...(input.sort ? { sort: input.sort } : {}), page: page + 1, limit: rowsPerPage };
  const { data, currentData, isFetching, isError, error } = useGetScrapMasterBySkuQuery(query);
  const view = isError ? undefined : (currentData || (isFetching ? data : undefined));
  const stale = !!view && view !== currentData;
  const rows = view?.data || [];
  const s = view?.meta || {};
  const total = s.pagination?.total || 0;

  const openSku = (code) => {
    const qs = new URLSearchParams(filters).toString();
    navigate(`/scrap-ims/sku/${encodeURIComponent(code)}${qs ? `?${qs}` : ''}`);
  };

  const exportCsv = () => {
    const header = ['Coil SKU', 'Coil name', 'Circle SKUs', 'Cuts', 'Coil cut (kg)', 'Circles (pcs)', 'Circles (kg)',
      'Scrap (kg)', 'In-house scrap (kg)', 'Job work scrap (kg)', 'Yield %', 'Yield by month', 'Last cut'];
    const lines = rows.map((r) => [
      r.coilSkuCode, r.coilSkuName, r.circleSkus.map((c) => c.code).join(' | '), r.cuts, r.coilKg, r.circlesPcs, r.circlesKg,
      r.scrapKg, r.plantScrapKg, r.jobWorkScrapKg, r.yieldPct ?? '',
      r.months.map((m) => `${m.month || 'no date'}: ${m.yieldPct ?? '—'}%`).join('; '),
      r.lastCutAt ? dayjs(r.lastCutAt).format('YYYY-MM-DD') : '',
    ]);
    const csv = [header, ...lines].map((x) => x.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `scrap-master-data_${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const pager = (
    <TablePagination
      component="div" count={total} page={total ? page : 0} onPageChange={(_, p) => setPage(p)}
      rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
      rowsPerPageOptions={ROWS_PER_PAGE} labelRowsPerPage="Rows per page:"
      sx={{ border: 0, '& .MuiTablePagination-toolbar': { minHeight: 40 }, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.74rem', color: O2D.body } }}
    />
  );
  const fieldSx = { '& .MuiInputBase-root': { height: 40, bgcolor: O2D.surface, borderRadius: '7px', fontSize: '0.8rem' } };

  return (
    <ScrapShell
      icon={Recycle}
      title="Scrap master data"
      subtitle="Scrap by coil SKU — click a row for every cut of it, date by date."
      actions={(
        <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!rows.length}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
          Export
        </Button>
      )}
    >
      {/* ── Totals over every matching coil SKU, not the page ── */}
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap sx={{ opacity: stale ? 0.6 : 1 }}>
        <KpiTile label="Coil SKUs" value={num(s.skus || 0)} sub={`${num(s.cuts || 0)} cuts`} color={O2D.brand} icon={Layers} />
        <KpiTile label="Coil cut" value={kg(s.coilKg || 0)} sub="Total coil weight cut" color="#0f766e" icon={Scale} />
        <KpiTile label="Circles produced" value={`${num(s.circlesPcs || 0)} pcs`} sub={kg(s.circlesKg || 0)} color="#4338ca" icon={CircleDashed} />
        <KpiTile label="Total scrap" value={kg(s.scrapKg || 0)}
          sub={`In-house ${kg(s.plantScrapKg || 0)} · Job work ${kg(s.jobWorkScrapKg || 0)}`} color={SCRAP_ACCENT} icon={Recycle} />
        <Tooltip arrow slotProps={O2D_TIP} title={`Circles ${kg(s.circlesKg || 0)} ÷ coil cut ${kg(s.coilKg || 0)} × 100, over every matching cut. ${BAND_NOTE}`}>
          <Box sx={{ display: 'flex', flex: '1 1 160px', minWidth: 155 }}>
            <KpiTile label="Overall yield" value={s.yieldPct != null ? `${num(s.yieldPct)}%` : '—'}
              sub="Circles ÷ coil cut" color={yieldBand(s.yieldPct)?.color || '#15803d'} icon={Recycle} />
          </Box>
        </Tooltip>
      </Stack>

      {/* ── Search and filters, one line ── */}
      <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" value={input.search} onChange={(e) => setInput((f) => ({ ...f, search: e.target.value }))}
            placeholder="Search coil SKU, circle SKU, batch…" sx={{ ...fieldSx, flex: '1 1 220px', minWidth: 180 }}
            inputProps={{ 'data-testid': 'master-search' }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} color={O2D.sub} /></InputAdornment> }} />
          <Box sx={{ flex: '0 1 210px', minWidth: 170 }}>
            <DateSortField id="scrap-master-date-sort" input={input} setNow={setNow} setMany={setMany} sorts={MASTER_SORTS} testId="master-date-sort" />
          </Box>
          <TextField select size="small" value={input.location} onChange={(e) => setNow('location', e.target.value)}
            SelectProps={{ displayEmpty: true }} sx={{ ...fieldSx, flex: '0 1 170px', minWidth: 140 }} inputProps={{ 'aria-label': 'Where it was cut' }}>
            <MenuItem value="">All locations</MenuItem>
            <MenuItem value="PLG01">{LOCATION_TOKENS.PLG01.label}</MenuItem>
            <MenuItem value="JW001">{LOCATION_TOKENS.JW001.label}</MenuItem>
          </TextField>
          <Button onClick={reset} disabled={!anyFilter} startIcon={<RotateCcw size={14} />}
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.78rem', height: 40, color: O2D.body }}>
            Reset
          </Button>
        </Stack>
      </Paper>

      <Panel dense>
        <Stack direction="row" alignItems="center" sx={{ px: 1.5, borderBottom: `1px solid ${O2D.lineSoft}` }}>
          <Typography sx={{ fontSize: '0.74rem', color: O2D.sub, mr: 'auto' }}>
            One row per coil SKU — click it to open every cut of it, date by date.
          </Typography>
          {pager}
        </Stack>
        <TableScroll sx={scrollSx}>
          <Table size="small" sx={{ ...masterTableSx, opacity: stale ? 0.55 : 1 }} aria-label="Scrap master data by coil SKU" aria-busy={isFetching}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={colSx('sno')}>S.No.</TableCell>
                <TableCell sx={colSx('coil')}>Coil SKU</TableCell>
                <TableCell sx={colSx('circle')}>Circle SKU</TableCell>
                <TableCell align="center" sx={colSx('cuts')}>Cuts</TableCell>
                <TableCell align="center" sx={colSx('coilKg')}>Coil cut (kg)</TableCell>
                <TableCell align="center" sx={colSx('circles')}>Circles<Box component="span" sx={{ display: 'block', fontWeight: 600, color: O2D.sub, fontSize: '0.64rem' }}>Pcs | kg</Box></TableCell>
                <TableCell align="center" sx={colSx('scrap')}>Scrap (kg)</TableCell>
                <TableCell align="center" sx={colSx('yield')}>Yield</TableCell>
                <TableCell align="center" sx={colSx('last')}>Last cut</TableCell>
                <TableCell sx={colSx('open')} />
              </TableRow>
            </TableHead>
            <TableBody>
              {!view && isFetching && (
                <TableRow><TableCell colSpan={10} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={240} /></TableCell></TableRow>
              )}
              {!isFetching && !rows.length && (
                <TableRow><TableCell colSpan={10} sx={{ border: 0 }}>
                  {/* A failed load is said as a failure, never as "no match". */}
                  <EmptyNote icon={isError ? AlertTriangle : Search}
                    title={isError ? 'Could not load the scrap master data.' : 'No coil SKU matches these filters'}
                    hint={isError ? (error?.data?.message || 'The server did not answer. Refresh the page to try again.') : 'Change or reset the filters to see more.'} />
                </TableCell></TableRow>
              )}
              {rows.map((r, i) => (
                <TableRow key={r.coilSkuCode || i} hover data-sku={r.coilSkuCode} data-testid="master-row"
                  role="link" tabIndex={0} aria-label={`Open every cut of ${r.coilSkuCode}`}
                  onClick={() => openSku(r.coilSkuCode)}
                  onKeyDown={(e) => { if (e.key === 'Enter') openSku(r.coilSkuCode); }}
                  sx={{ cursor: 'pointer' }}>
                  <TableCell align="center" sx={{ ...numSx, color: O2D.sub }}>{page * rowsPerPage + i + 1}</TableCell>
                  <TableCell>
                    <Tooltip arrow slotProps={O2D_TIP} title={r.coilSkuName || r.coilSkuCode}>
                      <Typography noWrap sx={{ fontSize: '0.82rem', fontWeight: 800, color: O2D.brand }}>{r.coilSkuCode || '—'}</Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell><CircleSkus list={r.circleSkus} /></TableCell>
                  <TableCell align="center" sx={{ ...numSx, fontWeight: 700 }}>{num(r.cuts)}</TableCell>
                  <TableCell align="center" sx={{ ...numSx, fontWeight: 800, color: O2D.ink }}>{num(r.coilKg)}</TableCell>
                  <TableCell align="center">
                    <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: O2D.ink, ...numSx }}>{num(r.circlesPcs)}</Typography>
                    <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: '#4338ca', ...numSx }}>{kg(r.circlesKg)}</Typography>
                  </TableCell>
                  <TableCell align="center"><ScrapKg r={r} /></TableCell>
                  <TableCell align="center"><OverallYield pct={r.yieldPct} circlesKg={r.circlesKg} coilKg={r.coilKg} months={r.months} /></TableCell>
                  <TableCell align="center" sx={{ ...numSx, fontWeight: 600 }}>{day(r.lastCutAt)}</TableCell>
                  <TableCell align="center" sx={{ color: O2D.sub, pl: 0 }}><ChevronRight size={16} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableScroll>
        <Stack direction="row" justifyContent="flex-end" sx={{ px: 1.5, borderTop: `1px solid ${O2D.lineSoft}` }}>{pager}</Stack>
      </Panel>
    </ScrapShell>
  );
};

export default ScrapImsMaster;
