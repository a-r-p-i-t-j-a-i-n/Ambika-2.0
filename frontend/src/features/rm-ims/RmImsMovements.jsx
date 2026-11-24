import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, InputAdornment, Table, TableHead, TableBody, TableRow, TableCell,
  Chip, Skeleton, TablePagination, Button, MenuItem, Autocomplete, LinearProgress, Alert,
} from '@mui/material';
import { History, Search, ArrowDownLeft, ArrowUpRight, Download, RotateCcw, Scale, X } from 'lucide-react';
import dayjs from 'dayjs';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  RmShell, Panel, TableScroll, RmKpiCard, RmKpiGrid, MoveChip, EmptyNote, Th, KindChip,
  O2D, moveToken, txnLabel, num,
} from './rmImsMeta';
import { FLUENT, FLUENT_DEPTH, rmTableSx, headerBtnSx } from './rmFluent';

// Who recorded it — initials in a soft lavender badge, the name beside it.
const initialsOf = (name = '') => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const RecordedBy = ({ name }) => (name ? (
  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
    <Box sx={{
      width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
      fontSize: '0.6rem', fontWeight: 800, bgcolor: FLUENT.lavender.tint, color: FLUENT.lavender.accent, border: `1px solid ${FLUENT.lavender.border}`,
    }}>{initialsOf(name)}</Box>
    <Typography noWrap sx={{ fontSize: '0.76rem', color: O2D.body }} title={name}>{name}</Typography>
  </Stack>
) : <Typography sx={{ fontSize: '0.72rem', color: O2D.faint }}>—</Typography>);
import { DateSortField } from './cuttingShared';
import { SORTS } from './cuttingFilters';
import { useGetRmMovementsQuery, useGetRmOverviewQuery, useLazyGetRmMovementsQuery } from '../../store/api/rmImsApi';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.rm;

// Newest or oldest first — the history is in date order either way.
const HISTORY_SORTS = SORTS.filter((s) => s.value !== 'az');
// What happened, as the floor says it. A value may name several movement types.
const WHAT_HAPPENED = [
  { value: '', label: 'Everything' },
  { value: 'GRN_IN', label: 'Vendor receipt' },
  { value: 'OPENING,ADJUST_IN', label: 'Stock in (by hand)' },
  { value: 'CONSUME_OUT', label: 'Stock out' },
  { value: 'CONVERT_OUT', label: 'Coil cut up' },
  { value: 'CONVERT_IN', label: 'Circles produced' },
  { value: 'ADJUST_OUT', label: 'Removed manually' },
  { value: 'QC_REJECT_OUT,RETURN_OUT', label: 'QC rejected / returned' },
];
const NO_FILTERS = { search: '', sku: null, txnType: '', direction: '', from: '', to: '', sort: '' };

// "Net change by item" reads every matching movement, 200 a page (the API's
// limit). Above this many it asks for narrower filters instead of showing a
// breakdown of only part of the ledger.
const NET_PAGE = 200;
const NET_MAX_ROWS = 10000;

/**
 * Every movement the filters match, grouped per item — read page by page from
 * the same endpoint the table uses, so the per-item nets add up to the Net
 * change card exactly. Runs only while the view is open.
 */
const useNetByItem = (open, filters) => {
  const [fetchPage] = useLazyGetRmMovementsQuery();
  const [state, setState] = useState({ status: 'idle', rows: [], read: 0, total: 0 });
  const key = JSON.stringify(filters);
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    (async () => {
      setState({ status: 'loading', rows: [], read: 0, total: 0 });
      try {
        const first = await fetchPage({ ...filters, page: 1, limit: NET_PAGE }, true).unwrap();
        const total = first?.meta?.total || 0;
        if (total > NET_MAX_ROWS) { if (!cancelled) setState({ status: 'too-many', rows: [], read: 0, total }); return; }
        let all = first?.data || [];
        const pages = Math.ceil(total / NET_PAGE);
        for (let pg = 2; pg <= pages && !cancelled; pg += 1) {
          if (!cancelled) setState((p0) => ({ ...p0, read: all.length, total }));
          const res = await fetchPage({ ...filters, page: pg, limit: NET_PAGE }, true).unwrap();
          all = all.concat(res?.data || []);
        }
        const by = new Map();
        all.forEach((m) => {
          const k = String(m.skuId || m.skuCode);
          const row = by.get(k) || { key: k, skuId: m.skuId, skuCode: m.skuCode, skuName: m.skuName, unit: m.unit, in: 0, out: 0, count: 0, last: null };
          if (m.movementType === 'IN') row.in += Number(m.quantity || 0); else row.out += Number(m.quantity || 0);
          row.count += 1;
          if (!row.last || dayjs(m.movementDate).isAfter(row.last)) row.last = m.movementDate;
          by.set(k, row);
        });
        const rows = [...by.values()]
          .map((r) => ({ ...r, net: Math.round((r.in - r.out) * 100) / 100 }))
          .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || (a.skuName || '').localeCompare(b.skuName || ''));
        if (!cancelled) setState({ status: 'ready', rows, read: all.length, total });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', rows: [], read: 0, total: 0, message: e?.data?.message });
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, fetchPage]);
  return state;
};

/**
 * MOVEMENT HISTORY — every coil and circle that came in or went out, newest
 * first (by the day, then by when it was saved). Search, item, what happened,
 * direction and Date & sort — on one line — all narrow the WHOLE ledger on the
 * server, and the cards add up everything they match, not just this page.
 */
const RmImsMovements = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // `?txnType=` deep links (e.g. Cut Coils → "Total Coil Used" opens the coil
  // cut-up ledger). Only a value this screen offers is taken.
  const [f, setF] = useState(() => {
    const t = params.get('txnType') || '';
    return { ...NO_FILTERS, txnType: WHAT_HAPPENED.some((o) => o.value && o.value === t) ? t : '' };
  });
  // The Net change card's view: net movement per item instead of the ledger rows.
  const [netView, setNetView] = useState(false);
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);
  const { data: ov } = useGetRmOverviewQuery({});
  const items = useMemo(() => ov?.data || [], [ov]);
  const kindBySku = useMemo(() => new Map(items.map((it) => [String(it.skuId), it.kind])), [items]);

  useEffect(() => {
    if (f.search.trim() === appliedSearch) return undefined;
    const t = setTimeout(() => { setAppliedSearch(f.search.trim()); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [f.search, appliedSearch]);
  const setNow = (k, v) => { setF((p) => ({ ...p, [k]: v })); setPage(0); };
  const setMany = (patch) => { setF((p) => ({ ...p, ...patch })); setPage(0); };
  const reset = () => { setF(NO_FILTERS); setAppliedSearch(''); setPage(0); setNetView(false); };
  const activeFilters = [f.search, f.sku, f.txnType, f.direction, f.from || f.to, f.sort].filter(Boolean).length;

  const query = {
    page: page + 1, limit,
    ...(appliedSearch ? { search: appliedSearch } : {}),
    ...(f.sku ? { skuId: f.sku.skuId } : {}),
    ...(f.txnType ? { txnType: f.txnType } : {}),
    ...(f.direction ? { direction: f.direction } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.sort ? { sort: f.sort } : {}),
  };
  const { data, isFetching } = useGetRmMovementsQuery(query);
  // The same filters without paging — what the Net change breakdown covers.
  const { page: _p, limit: _l, ...netFilters } = query;
  const net$ = useNetByItem(netView, netFilters);
  const rows = useMemo(() => data?.data || [], [data]);
  const total = data?.meta?.total || 0;
  const totals = data?.meta?.totals || {};
  const net = Number(totals.inQty || 0) - Number(totals.outQty || 0);
  // KPI cards — each a shortcut; clicking the active card again turns it off.
  const showAllMovements = () => { setNow('direction', ''); setNetView(false); };
  const toggleDir = (d) => { setNetView(false); setNow('direction', f.direction === d ? '' : d); };
  const toggleNet = () => { if (netView) { setNetView(false); return; } setNow('direction', ''); setNetView(true); };
  const netPaged = net$.rows.slice(page * limit, page * limit + limit);

  const exportCsv = () => {
    const header = ['Movement no', 'Date', 'SKU Code', 'Item Name', 'What happened', 'Direction', 'Quantity', 'Balance after', 'Batch', 'Reference', 'Recorded by'];
    const lines = rows.map((m) => [
      m.movementNumber, dayjs(m.movementDate).format('YYYY-MM-DD'), m.skuCode, m.skuName,
      txnLabel(m.txnType), m.movementType === 'IN' ? 'In' : 'Out', m.quantity, m.balanceAfter,
      m.batchNo, m.refNumber || m.refType, m.performedByName,
    ]);
    const csv = [header, ...lines].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `raw-material-movements_${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const fieldSx = { '& .MuiInputBase-root': { height: 40, bgcolor: O2D.surface, borderRadius: '7px', fontSize: '0.8rem' } };

  return (
    <RmShell
      icon={History}
      title="Movement History"
      subtitle="Every coil and circle that came in or went out — stock in, stock out, cutting and QC. Newest first."
      actions={(
        <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!rows.length}
          sx={headerBtnSx}>
          Export page
        </Button>
      )}
    >
      {/* ── Totals of everything the filters match, every page ── */}
      <RmKpiGrid>
        <RmKpiCard label="Movements" value={num(total)} sub={activeFilters ? 'Matching the filters' : 'Across the whole ledger'}
          tone={FLUENT.blue} icon={History} actionLabel="Show all" onClick={showAllMovements}
          hint="Show every movement — in and out." />
        <RmKpiCard label="Units in" value={`+${num(totals.inQty || 0)}`} sub={`${num(totals.inCount || 0)} movements in`}
          tone={FLUENT.teal} icon={ArrowDownLeft} actionLabel="Filter"
          active={f.direction === 'IN' && !netView} onClick={() => toggleDir('IN')}
          hint="Show only movements coming into the store." />
        <RmKpiCard label="Units out" value={`−${num(totals.outQty || 0)}`} sub={`${num(totals.outCount || 0)} movements out`}
          tone={FLUENT.orange} icon={ArrowUpRight} actionLabel="Filter"
          active={f.direction === 'OUT' && !netView} onClick={() => toggleDir('OUT')}
          hint="Show only movements going out of the store." />
        <RmKpiCard label="Net change" value={`${net >= 0 ? '+' : '−'}${num(Math.abs(net))}`}
          sub={net >= 0 ? 'Store grew' : 'Store shrank'}
          tone={net >= 0 ? FLUENT.teal : FLUENT.orange} icon={Scale} actionLabel="By item"
          active={netView} onClick={toggleNet}
          hint="Break the net change down item by item." />
      </RmKpiGrid>

      {/* ── Search and filters, one line ── */}
      <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" value={f.search} onChange={(e) => setF((p) => ({ ...p, search: e.target.value }))}
            placeholder="Search movement, batch, reference…" sx={{ ...fieldSx, flex: '1 1 190px', maxWidth: 300 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} color={O2D.sub} /></InputAdornment> }} />
          <Autocomplete
            size="small" options={items} value={f.sku} onChange={(_, v) => setNow('sku', v)}
            getOptionLabel={(o) => (o ? o.skuCode : '')}
            isOptionEqualToValue={(a, b) => a.skuId === b?.skuId}
            slotProps={{ popper: { sx: { minWidth: 260 } } }}
            renderOption={(props, o) => (
              <li {...props} key={o.skuId}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: '0.78rem', fontWeight: 700, color: O2D.ink }}>{o.skuCode}</Typography>
                  <Typography noWrap sx={{ fontSize: '0.66rem', color: O2D.sub }}>{o.skuName}</Typography>
                </Box>
              </li>
            )}
            renderInput={(p) => <TextField {...p} placeholder="All items" sx={fieldSx} inputProps={{ ...p.inputProps, 'aria-label': 'Item' }} />}
            sx={{ flex: '0 1 180px', minWidth: 150 }}
          />
          <TextField select size="small" value={f.txnType} onChange={(e) => setNow('txnType', e.target.value)}
            SelectProps={{ displayEmpty: true }} sx={{ ...fieldSx, flex: '0 1 185px', minWidth: 150 }} inputProps={{ 'aria-label': 'What happened' }}>
            {WHAT_HAPPENED.map((o) => <MenuItem key={o.value || 'all'} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" value={f.direction} onChange={(e) => { setNetView(false); setNow('direction', e.target.value); }}
            SelectProps={{ displayEmpty: true }} sx={{ ...fieldSx, flex: '0 1 150px', minWidth: 130 }} inputProps={{ 'aria-label': 'Direction' }}>
            <MenuItem value="">In and out</MenuItem>
            <MenuItem value="IN">Only coming in</MenuItem>
            <MenuItem value="OUT">Only going out</MenuItem>
          </TextField>
          <Box sx={{ flex: '0 1 205px', minWidth: 170 }}>
            <DateSortField id="rm-movements-date-sort" input={f} setNow={setNow} setMany={setMany} sorts={HISTORY_SORTS} testId="movements-date-sort" />
          </Box>
          <Button onClick={reset} disabled={!activeFilters} startIcon={<RotateCcw size={14} />}
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.78rem', height: 40, color: O2D.body }}>
            Reset
          </Button>
        </Stack>
      </Paper>

      {netView ? (
        <Panel dense title="Net change by item" icon={Scale}
          hint={`Every movement the filters match${activeFilters ? '' : ' — the whole ledger'}: what came in, what went out and the difference, per item. Largest change first.`}
          actions={(
            <Button size="small" startIcon={<X size={12} />} onClick={toggleNet}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.body }}>
              Back to movements
            </Button>
          )}>
          {net$.status === 'loading' && (
            <Box sx={{ px: 1.5, py: 1.25 }}>
              <Typography sx={{ fontSize: '0.72rem', color: O2D.sub, mb: 0.5 }}>
                Reading movements{net$.total ? ` — ${num(net$.read)} of ${num(net$.total)}` : '…'}
              </Typography>
              <LinearProgress variant={net$.total ? 'determinate' : 'indeterminate'} value={net$.total ? (net$.read / net$.total) * 100 : 0} />
            </Box>
          )}
          {net$.status === 'too-many' && (
            <Alert severity="info" sx={{ m: 1.5 }}>
              {num(net$.total)} movements match — too many to break down here. Narrow it with a date range or an item first.
            </Alert>
          )}
          {net$.status === 'error' && (
            <Alert severity="error" sx={{ m: 1.5 }}>{net$.message || 'Could not read the movements.'}</Alert>
          )}
          {net$.status === 'ready' && (
            <>
              <TableScroll>
                <Table size="small" sx={rmTableSx(880)} data-testid="rm-net-by-item">
                  <TableHead>
                    <TableRow>
                      <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                      <TableCell><Th label="Item" hint={H.skuName} /></TableCell>
                      <TableCell align="right">Units in</TableCell>
                      <TableCell align="right">Units out</TableCell>
                      <TableCell align="right">Net change</TableCell>
                      <TableCell align="right">Movements</TableCell>
                      <TableCell align="center">Last movement</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {net$.rows.length === 0 && (
                      <TableRow><TableCell colSpan={7} sx={{ border: 0 }}>
                        <EmptyNote icon={Scale} title="No movements match" hint="Change or reset the filters to see the net change by item." />
                      </TableCell></TableRow>
                    )}
                    {netPaged.map((r, i) => {
                      const t = moveToken(r.net >= 0 ? 'IN' : 'OUT');
                      return (
                        <TableRow key={r.key} hover sx={{ cursor: r.skuId ? 'pointer' : 'default', borderLeft: `3px solid ${r.net === 0 ? 'transparent' : t.color}` }}
                          onClick={() => r.skuId && navigate(`/rm-ims/item/${r.skuId}`)}>
                          <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{page * limit + i + 1}</TableCell>
                          <TableCell sx={{ maxWidth: 300 }}>
                            <Typography noWrap sx={{ fontSize: '0.79rem', fontWeight: 600, color: O2D.ink }} title={r.skuName}>{r.skuName}</Typography>
                            <Typography sx={{ fontSize: '0.65rem', color: O2D.sub, fontFamily: 'ui-monospace, monospace' }}>{r.skuCode}</Typography>
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: moveToken('IN').color, fontWeight: 700 }}>{r.in ? `+${num(r.in)}` : '—'}</TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: moveToken('OUT').color, fontWeight: 700 }}>{r.out ? `−${num(r.out)}` : '—'}</TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: r.net === 0 ? O2D.sub : t.color }}>
                            {r.net === 0 ? '0' : `${r.net > 0 ? '+' : '−'}${num(Math.abs(r.net))}`}
                            {r.unit ? <Box component="span" sx={{ ml: 0.4, fontSize: '0.64rem', fontWeight: 600, color: O2D.faint }}>{r.unit}</Box> : null}
                          </TableCell>
                          <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{num(r.count)}</TableCell>
                          <TableCell align="center" sx={{ whiteSpace: 'nowrap', color: O2D.sub }}>{r.last ? dayjs(r.last).format('DD MMM YYYY') : '—'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableScroll>
              <TablePagination
                component="div" count={net$.rows.length} page={net$.rows.length ? page : 0} rowsPerPage={limit}
                onPageChange={(_, pg) => setPage(pg)}
                onRowsPerPageChange={(e) => { setLimit(parseInt(e.target.value, 10)); setPage(0); }}
                rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="Items per page:"
                sx={{ borderTop: `1px solid ${O2D.lineSoft}`, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } }}
              />
            </>
          )}
        </Panel>
      ) : (
      <Paper elevation={0} data-testid="rm-movements-ledger" sx={{
        borderRadius: '10px', overflow: 'hidden', minWidth: 0,
        border: `1px solid ${FLUENT.blue.border}`, bgcolor: O2D.surface, boxShadow: FLUENT_DEPTH.rest,
      }}>
        {/* Ledger header band */}
        <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap
          sx={{ px: { xs: 1.5, md: 2 }, py: 1.25, bgcolor: FLUENT.blue.bg, borderBottom: `1px solid ${FLUENT.blue.border}` }}>
          <Box sx={{ width: 32, height: 32, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: '#fff', border: `1px solid ${FLUENT.blue.border}`, color: FLUENT.blue.accent, flexShrink: 0 }}>
            <History size={16} />
          </Box>
          <Box sx={{ minWidth: 0, mr: 'auto' }}>
            <Typography component="h2" sx={{ fontSize: '0.92rem', fontWeight: 800, color: FLUENT.blue.ink, lineHeight: 1.25 }}>Stock ledger</Typography>
            <Typography sx={{ fontSize: '0.7rem', color: O2D.sub }}>
              {f.sort === 'oldest' ? 'Oldest first' : 'Newest first'} — every coil and circle in or out, with the balance it left.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip size="small" icon={<ArrowDownLeft size={12} />} label={`${num(totals.inCount || 0)} in`}
              sx={{ height: 24, fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px', bgcolor: FLUENT.teal.tint, color: FLUENT.teal.accent, border: `1px solid ${FLUENT.teal.border}`, '& .MuiChip-icon': { color: FLUENT.teal.accent } }} />
            <Chip size="small" icon={<ArrowUpRight size={12} />} label={`${num(totals.outCount || 0)} out`}
              sx={{ height: 24, fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px', bgcolor: FLUENT.orange.tint, color: FLUENT.orange.accent, border: `1px solid ${FLUENT.orange.border}`, '& .MuiChip-icon': { color: FLUENT.orange.accent } }} />
          </Stack>
        </Stack>
        <TableScroll>
          <Table size="small" sx={rmTableSx(1180)} data-testid="rm-movements-table">
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 60 }}>S.No.</TableCell>
                <TableCell><Th label="Date" hint={H.movementDate} /></TableCell>
                <TableCell><Th label="Movement no" hint={H.movementNumber} /></TableCell>
                <TableCell><Th label="Item" hint={H.skuName} /></TableCell>
                <TableCell><Th label="What happened" hint={H.movementType} /></TableCell>
                <TableCell align="right"><Th label="Change" hint={H.movementQty} /></TableCell>
                <TableCell align="right"><Th label="Balance after" hint={H.balanceAfter} /></TableCell>
                <TableCell><Th label="Batch" hint={H.batchNo} /></TableCell>
                <TableCell>Reference</TableCell>
                <TableCell><Th label="Recorded by" hint={H.recordedBy} /></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={10} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={280} /></TableCell></TableRow>
              )}
              {!isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={10} sx={{ border: 0 }}>
                  <EmptyNote icon={History} title="No movements to show"
                    hint={activeFilters ? 'Change or reset the filters to see more.' : 'Record a Stock In, Stock Out or coil cutting to start the history.'} />
                </TableCell></TableRow>
              )}
              {rows.map((m, i) => {
                const t = moveToken(m.movementType);
                const inbound = m.movementType === 'IN';
                const edge = inbound ? FLUENT.teal.accent : FLUENT.orange.accent;
                const kind = kindBySku.get(String(m.skuId));
                return (
                  <TableRow key={m._id} hover data-direction={m.movementType}
                    sx={{ '& > td:first-of-type': { boxShadow: `inset 3px 0 0 ${edge}` } }}>
                    <TableCell align="center" sx={{ width: 60, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{page * limit + i + 1}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink }}>{dayjs(m.movementDate).format('DD MMM YYYY')}</Typography>
                      <Typography sx={{ fontSize: '0.66rem', color: O2D.faint }}>{dayjs(m.createdAt || m.movementDate).format('ddd · HH:mm')}</Typography>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Box component="span" sx={{
                        px: 0.75, py: 0.25, borderRadius: '6px', fontFamily: 'ui-monospace, monospace', fontSize: '0.7rem', fontWeight: 700,
                        color: FLUENT.grey.ink, bgcolor: FLUENT.grey.tint, border: `1px solid ${FLUENT.grey.border}`,
                      }}>{m.movementNumber}</Box>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 260 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
                        <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink, minWidth: 0 }} title={m.skuName}>{m.skuName}</Typography>
                        {kind && <KindChip kind={kind} withHint={false} />}
                      </Stack>
                      <Typography sx={{ fontSize: '0.66rem', color: O2D.sub, fontFamily: 'ui-monospace, monospace' }}>{m.skuCode}</Typography>
                    </TableCell>
                    <TableCell><MoveChip movementType={m.movementType} txnType={m.txnType} /></TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Typography component="span" sx={{ fontSize: '0.88rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: t.color }}>
                        {t.sign}{num(m.quantity)}
                      </Typography>
                      {m.unit && <Typography component="span" sx={{ ml: 0.5, fontSize: '0.64rem', fontWeight: 700, color: O2D.faint }}>{m.unit}</Typography>}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: O2D.ink, whiteSpace: 'nowrap' }}>{num(m.balanceAfter)}</TableCell>
                    <TableCell>
                      {m.batchNo
                        ? <Chip size="small" label={m.batchNo}
                            sx={{ height: 21, fontSize: '0.66rem', fontWeight: 700, borderRadius: '6px', bgcolor: FLUENT.blue.tint, border: `1px solid ${FLUENT.blue.border}`, color: FLUENT.blue.ink }} />
                        : <Typography sx={{ fontSize: '0.72rem', color: O2D.faint }}>—</Typography>}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 180 }}>
                      <Typography noWrap sx={{ fontSize: '0.74rem', color: O2D.body }} title={m.refNumber || m.refType}>
                        {m.refNumber || m.refType || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 200 }}><RecordedBy name={m.performedByName} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
        <TablePagination
          component="div" count={total} page={total ? page : 0} rowsPerPage={limit}
          onPageChange={(_, p) => setPage(p)}
          onRowsPerPageChange={(e) => { setLimit(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="Movements per page:"
          sx={{ borderTop: `1px solid ${FLUENT.blue.border}`, bgcolor: FLUENT.blue.bg, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } }}
        />
      </Paper>
      )}
    </RmShell>
  );
};

export default RmImsMovements;
