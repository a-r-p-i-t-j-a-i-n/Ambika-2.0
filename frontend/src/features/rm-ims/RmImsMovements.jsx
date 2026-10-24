import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, InputAdornment, Table, TableHead, TableBody, TableRow, TableCell,
  Chip, Skeleton, TablePagination, Button, MenuItem, Autocomplete,
} from '@mui/material';
import { History, Search, ArrowDownLeft, ArrowUpRight, Download, RotateCcw, Scale } from 'lucide-react';
import dayjs from 'dayjs';
import {
  RmShell, Panel, TableScroll, KpiTile, MoveChip, EmptyNote, Th,
  O2D, moveToken, txnLabel, num, imsTableSx,
} from './rmImsMeta';
import { DateSortField } from './cuttingShared';
import { SORTS } from './cuttingFilters';
import { useGetRmMovementsQuery, useGetRmOverviewQuery } from '../../store/api/rmImsApi';
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

/**
 * MOVEMENT HISTORY — every coil and circle that came in or went out, newest
 * first (by the day, then by when it was saved). Search, item, what happened,
 * direction and Date & sort — on one line — all narrow the WHOLE ledger on the
 * server, and the cards add up everything they match, not just this page.
 */
const RmImsMovements = () => {
  const [f, setF] = useState(NO_FILTERS);
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);
  const { data: ov } = useGetRmOverviewQuery({});
  const items = useMemo(() => ov?.data || [], [ov]);

  useEffect(() => {
    if (f.search.trim() === appliedSearch) return undefined;
    const t = setTimeout(() => { setAppliedSearch(f.search.trim()); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [f.search, appliedSearch]);
  const setNow = (k, v) => { setF((p) => ({ ...p, [k]: v })); setPage(0); };
  const setMany = (patch) => { setF((p) => ({ ...p, ...patch })); setPage(0); };
  const reset = () => { setF(NO_FILTERS); setAppliedSearch(''); setPage(0); };
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
  const rows = useMemo(() => data?.data || [], [data]);
  const total = data?.meta?.total || 0;
  const totals = data?.meta?.totals || {};
  const net = Number(totals.inQty || 0) - Number(totals.outQty || 0);

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
      title="Movement history"
      subtitle="Every coil and circle that came in or went out — stock in, stock out, cutting and QC. Newest first."
      actions={(
        <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!rows.length}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
          Export page
        </Button>
      )}
    >
      {/* ── Totals of everything the filters match, every page ── */}
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
        <KpiTile label="Movements" value={num(total)} sub={activeFilters ? 'Matching the filters' : 'Across the whole ledger'} color={O2D.brand} icon={History} />
        <KpiTile label="Units in" value={`+${num(totals.inQty || 0)}`} sub={`${num(totals.inCount || 0)} movements in`}
          color={moveToken('IN').color} icon={ArrowDownLeft}
          active={f.direction === 'IN'} onClick={() => setNow('direction', f.direction === 'IN' ? '' : 'IN')} />
        <KpiTile label="Units out" value={`−${num(totals.outQty || 0)}`} sub={`${num(totals.outCount || 0)} movements out`}
          color={moveToken('OUT').color} icon={ArrowUpRight}
          active={f.direction === 'OUT'} onClick={() => setNow('direction', f.direction === 'OUT' ? '' : 'OUT')} />
        <KpiTile label="Net change" value={`${net >= 0 ? '+' : '−'}${num(Math.abs(net))}`}
          sub={net >= 0 ? 'Store grew' : 'Store shrank'}
          color={net >= 0 ? moveToken('IN').color : moveToken('OUT').color} icon={Scale} />
      </Stack>

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
          <TextField select size="small" value={f.direction} onChange={(e) => setNow('direction', e.target.value)}
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

      <Panel dense>
        <TableScroll>
          <Table size="small" sx={imsTableSx(1080)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
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
                return (
                  <TableRow key={m._id} hover>
                    <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{page * limit + i + 1}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: O2D.ink }}>{dayjs(m.movementDate).format('DD MMM YYYY')}</Typography>
                      <Typography sx={{ fontSize: '0.65rem', color: O2D.faint }}>{dayjs(m.createdAt || m.movementDate).format('HH:mm')}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.7rem', color: O2D.sub, whiteSpace: 'nowrap' }}>{m.movementNumber}</TableCell>
                    <TableCell sx={{ maxWidth: 230 }}>
                      <Typography noWrap sx={{ fontSize: '0.79rem', fontWeight: 600, color: O2D.ink }} title={m.skuName}>{m.skuName}</Typography>
                      <Typography sx={{ fontSize: '0.65rem', color: O2D.sub, fontFamily: 'ui-monospace, monospace' }}>{m.skuCode}</Typography>
                    </TableCell>
                    <TableCell><MoveChip movementType={m.movementType} txnType={m.txnType} /></TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: t.color, whiteSpace: 'nowrap' }}>
                      {t.sign}{num(m.quantity)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{num(m.balanceAfter)}</TableCell>
                    <TableCell>
                      {m.batchNo
                        ? <Chip size="small" label={m.batchNo}
                            sx={{ height: 19, fontSize: '0.65rem', fontWeight: 700, borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
                        : <Typography sx={{ fontSize: '0.72rem', color: O2D.faint }}>—</Typography>}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 170 }}>
                      <Typography noWrap sx={{ fontSize: '0.72rem', color: O2D.sub }} title={m.refNumber || m.refType}>
                        {m.refNumber || m.refType || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ color: O2D.sub, whiteSpace: 'nowrap' }}>{m.performedByName || '—'}</TableCell>
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
          sx={{ borderTop: `1px solid ${O2D.lineSoft}`, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } }}
        />
      </Panel>
    </RmShell>
  );
};

export default RmImsMovements;
