import React, { useEffect, useMemo, useState } from 'react';
import {
  Paper, Stack, Typography, TextField, InputAdornment, Table, TableHead, TableBody,
  TableRow, TableCell, Chip, Skeleton, TablePagination, Button, MenuItem,
} from '@mui/material';
import { History, Search, ArrowDownLeft, ArrowUpRight, Download, X, Scale } from 'lucide-react';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import {
  FgShell, Panel, TableScroll, KpiCard, KpiGrid, MoveChip, EmptyNote, Th,
  O2D, moveToken, txnLabel, num,
} from './fgImsMeta';
import { FLUENT, fluentTableSx, headerBtnSx } from '../ims/imsFluent';
import { useGetFgMovementsQuery } from '../../store/api/fgImsApi';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.fg;

const RANGES = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 0, label: 'Everything' },
];

// Direction edge on a ledger row: teal for in, orange for out (the RM ledger's look).
const edgeSx = (movementType) => ({
  '& > td:first-of-type': { boxShadow: `inset 3px 0 0 ${movementType === 'IN' ? FLUENT.teal.accent : FLUENT.orange.accent}` },
});

// FG movement history — the full IN/OUT ledger (production, dispatch, adjustments).
const FgImsMovements = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [dir, setDir] = useState('ALL'); // ALL | IN | OUT
  // The Net change card's view: net movement per finished good instead of the ledger rows.
  const [netView, setNetView] = useState(false);
  const [range, setRange] = useState(30);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const { data, isFetching } = useGetFgMovementsQuery({ search: search || undefined, limit: 500 });
  const rows = useMemo(() => data?.data || [], [data]);

  // The period (and search) — what the KPI cards describe. Direction is applied
  // on top only for the table, so a card never reads 0 just because another
  // card is filtering the rows.
  const inPeriod = useMemo(() => {
    const cutoff = range ? dayjs().subtract(range, 'day').startOf('day') : null;
    return rows.filter((r) => !cutoff || dayjs(r.movementDate).isAfter(cutoff));
  }, [rows, range]);

  const filtered = useMemo(
    () => inPeriod.filter((r) => dir === 'ALL' || r.movementType === dir),
    [inPeriod, dir],
  );

  const totals = useMemo(() => inPeriod.reduce((t, m) => {
    if (m.movementType === 'IN') t.in += Number(m.quantity || 0); else t.out += Number(m.quantity || 0);
    return t;
  }, { in: 0, out: 0 }), [inPeriod]);
  const net = totals.in - totals.out;

  // Net change per finished good over the period — the breakdown behind the Net change card.
  const netByItem = useMemo(() => {
    const by = new Map();
    inPeriod.forEach((m) => {
      const k = String(m.skuId || m.skuCode);
      const row = by.get(k) || { key: k, skuId: m.skuId, skuCode: m.skuCode, skuName: m.skuName, in: 0, out: 0, count: 0, last: null };
      if (m.movementType === 'IN') row.in += Number(m.quantity || 0); else row.out += Number(m.quantity || 0);
      row.count += 1;
      if (!row.last || dayjs(m.movementDate).isAfter(row.last)) row.last = m.movementDate;
      by.set(k, row);
    });
    return [...by.values()]
      .map((r) => ({ ...r, net: r.in - r.out }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || (a.skuName || '').localeCompare(b.skuName || ''));
  }, [inPeriod]);

  useEffect(() => { setPage(0); }, [search, dir, range, rowsPerPage, netView]);
  const paged = useMemo(() => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [filtered, page, rowsPerPage]);
  const netPaged = useMemo(() => netByItem.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [netByItem, page, rowsPerPage]);

  // KPI cards — each a shortcut; clicking the active card again turns it off.
  const showAllMovements = () => { setDir('ALL'); setNetView(false); };
  const toggleDir = (d) => { setNetView(false); setDir(dir === d ? 'ALL' : d); };
  const toggleNet = () => { if (netView) { setNetView(false); return; } setDir('ALL'); setNetView(true); };

  const exportCsv = () => {
    const header = ['Date', 'Movement no', 'SKU Code', 'Finished Good', 'What happened', 'Direction', 'Quantity', 'Balance after', 'Recorded by', 'Notes'];
    const lines = filtered.map((m) => [
      dayjs(m.movementDate).format('YYYY-MM-DD'), m.movementNumber, m.skuCode, m.skuName,
      txnLabel(m.txnType), m.movementType === 'IN' ? 'In' : 'Out', m.quantity, m.balanceAfter,
      m.performedByName, m.remarks,
    ]);
    const csv = [header, ...lines].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `fg-stock-movements_${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const activeFilters = (dir !== 'ALL' ? 1 : 0) + (netView ? 1 : 0) + (range !== 30 ? 1 : 0) + (search ? 1 : 0);
  const periodLabel = range ? `In the last ${range} days` : 'All time';
  const pagerSx = { borderTop: `1px solid ${O2D.lineSoft}`, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } };

  return (
    <FgShell
      icon={History}
      title="Movement History"
      subtitle="Every unit produced or dispatched — what, when, why and who recorded it."
      actions={(
        <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!filtered.length} sx={headerBtnSx}>
          Export
        </Button>
      )}
    >
      <KpiGrid>
        <KpiCard label="Movements" value={num(inPeriod.length)} sub={periodLabel}
          tone={FLUENT.blue} icon={History} actionLabel="Show all" onClick={showAllMovements}
          hint="Show every movement in this period — in and out." />
        <KpiCard label="Units produced in" value={`+${num(totals.in)}`} sub="Came into the store"
          tone={FLUENT.teal} icon={ArrowDownLeft} actionLabel="Filter"
          active={dir === 'IN' && !netView} onClick={() => toggleDir('IN')}
          hint="Show only movements coming into the store." />
        <KpiCard label="Units dispatched out" value={`−${num(totals.out)}`} sub="Left the store"
          tone={FLUENT.orange} icon={ArrowUpRight} actionLabel="Filter"
          active={dir === 'OUT' && !netView} onClick={() => toggleDir('OUT')}
          hint="Show only movements going out of the store." />
        <KpiCard label="Net change" value={`${net >= 0 ? '+' : '−'}${num(Math.abs(net))}`}
          sub={net >= 0 ? 'Store grew over this period' : 'Store shrank over this period'}
          tone={FLUENT.lavender} icon={Scale} actionLabel="By item"
          active={netView} onClick={toggleNet}
          hint="Break the net change down finished good by finished good." />
      </KpiGrid>

      {/* The ledger is fetched a page at a time (the API caps a page at 500), so
          say so rather than letting these totals read as all-time figures. */}
      {rows.length >= 500 && (
        <Typography sx={{ fontSize: '0.68rem', color: O2D.faint, px: 0.5 }}>
          Totals cover the 500 most recent movements. Narrow the period or search to summarise a smaller set exactly.
        </Typography>
      )}

      <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by finished good, code, movement no, reference or batch…" sx={{ minWidth: { xs: '100%', sm: 300 }, flex: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
          <TextField select size="small" label="Period" value={range} onChange={(e) => setRange(Number(e.target.value))} sx={{ minWidth: 150 }}>
            {RANGES.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Direction" value={dir} onChange={(e) => { setNetView(false); setDir(e.target.value); }} sx={{ minWidth: 175 }}>
            <MenuItem value="ALL">In and out</MenuItem>
            <MenuItem value="IN">Only production / in</MenuItem>
            <MenuItem value="OUT">Only dispatch / out</MenuItem>
          </TextField>
          <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, ml: 'auto', whiteSpace: 'nowrap' }}>
            {netView
              ? <><b>{netByItem.length}</b> item{netByItem.length === 1 ? '' : 's'} · net by item</>
              : <><b>{filtered.length}</b> movement{filtered.length === 1 ? '' : 's'}</>}
          </Typography>
          {activeFilters > 0 && (
            <Button size="small" startIcon={<X size={12} />} onClick={() => { setSearch(''); setDir('ALL'); setNetView(false); setRange(30); }}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.body }}>
              Reset ({activeFilters})
            </Button>
          )}
        </Stack>
      </Paper>

      {netView ? (
        <Panel dense title="Net change by finished good" icon={Scale}
          hint={`${periodLabel} — what was produced in, what was dispatched out, and the difference, per item. Largest change first.`}
          actions={(
            <Button size="small" startIcon={<X size={12} />} onClick={toggleNet}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.body }}>
              Back to movements
            </Button>
          )}>
          <TableScroll>
            <Table size="small" sx={fluentTableSx(860)} data-testid="fg-net-by-item">
              <TableHead>
                <TableRow>
                  <TableCell align="center" sx={{ width: 64 }}>S.No.</TableCell>
                  <TableCell><Th label="Finished Good" hint={H.skuName} /></TableCell>
                  <TableCell align="right">Units in</TableCell>
                  <TableCell align="right">Units out</TableCell>
                  <TableCell align="right">Net change</TableCell>
                  <TableCell align="right">Movements</TableCell>
                  <TableCell align="center">Last movement</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {netByItem.length === 0 && (
                  <TableRow><TableCell colSpan={7} sx={{ border: 0 }}>
                    <EmptyNote icon={Scale} title="No movements in this window"
                      hint="Widen the period or clear the search to see the net change by finished good." />
                  </TableCell></TableRow>
                )}
                {netPaged.map((r, i) => {
                  const t = moveToken(r.net >= 0 ? 'IN' : 'OUT');
                  return (
                    <TableRow key={r.key} hover sx={{ cursor: r.skuId ? 'pointer' : 'default', ...(r.net === 0 ? null : edgeSx(r.net > 0 ? 'IN' : 'OUT')) }}
                      onClick={() => r.skuId && navigate(`/fg-ims/item/${r.skuId}`)}>
                      <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{page * rowsPerPage + i + 1}</TableCell>
                      <TableCell sx={{ maxWidth: 280 }}>
                        <Typography noWrap sx={{ fontSize: '0.79rem', fontWeight: 600, color: O2D.ink }} title={r.skuName}>{r.skuName}</Typography>
                        <Typography sx={{ fontSize: '0.65rem', color: O2D.sub, fontFamily: 'ui-monospace, monospace' }}>{r.skuCode}</Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: moveToken('IN').color, fontWeight: 700 }}>{r.in ? `+${num(r.in)}` : '—'}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: moveToken('OUT').color, fontWeight: 700 }}>{r.out ? `−${num(r.out)}` : '—'}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, color: r.net === 0 ? O2D.sub : t.color }}>
                        {r.net === 0 ? '0' : `${r.net > 0 ? '+' : '−'}${num(Math.abs(r.net))}`}
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
            component="div" count={netByItem.length} page={page} onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="Items per page:" sx={pagerSx}
          />
        </Panel>
      ) : (
        <Panel dense>
          <TableScroll>
            <Table size="small" sx={fluentTableSx(1000)} data-testid="fg-movements-table">
              <TableHead>
                <TableRow>
                  <TableCell align="center" sx={{ width: 64 }}>S.No.</TableCell>
                  <TableCell align="center"><Th label="Date" hint={H.movementDate} /></TableCell>
                  <TableCell><Th label="Movement no" hint={H.movementNumber} /></TableCell>
                  <TableCell><Th label="Finished Good" hint={H.skuName} /></TableCell>
                  <TableCell align="center"><Th label="What happened" hint={H.movementType} /></TableCell>
                  <TableCell align="right"><Th label="Change" hint={H.movementQty} /></TableCell>
                  <TableCell align="right"><Th label="Balance after" hint={H.balanceAfter} /></TableCell>
                  <TableCell><Th label="Recorded by" hint={H.recordedBy} /></TableCell>
                  <TableCell><Th label="Notes" hint={H.movementNotes} /></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isFetching && rows.length === 0 && (
                  <TableRow><TableCell colSpan={9} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={240} /></TableCell></TableRow>
                )}
                {!isFetching && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={9} sx={{ border: 0 }}>
                    <EmptyNote icon={History} title="No movements in this window"
                      hint={rows.length === 0
                        ? 'The first Production In or Dispatch Out you record will appear here.'
                        : 'Widen the period, clear the direction filter, or record a Production In / Dispatch Out.'} />
                  </TableCell></TableRow>
                )}
                {paged.map((m, i) => {
                  const t = moveToken(m.movementType);
                  return (
                    <TableRow key={m._id} hover data-direction={m.movementType} sx={{ cursor: m.skuId ? 'pointer' : 'default', ...edgeSx(m.movementType) }}
                      onClick={() => m.skuId && navigate(`/fg-ims/item/${m.skuId}`)}>
                      <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{page * rowsPerPage + i + 1}</TableCell>
                      <TableCell align="center" sx={{ whiteSpace: 'nowrap' }}>
                        <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: O2D.ink }}>{dayjs(m.movementDate).format('DD MMM YYYY')}</Typography>
                        <Typography sx={{ fontSize: '0.65rem', color: O2D.faint }}>{dayjs(m.createdAt || m.movementDate).format('HH:mm')}</Typography>
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.7rem', color: O2D.sub, whiteSpace: 'nowrap' }}>{m.movementNumber}</TableCell>
                      <TableCell sx={{ maxWidth: 230 }}>
                        <Typography noWrap sx={{ fontSize: '0.79rem', fontWeight: 600, color: O2D.ink }} title={m.skuName}>{m.skuName}</Typography>
                        <Typography sx={{ fontSize: '0.65rem', color: O2D.sub, fontFamily: 'ui-monospace, monospace' }}>{m.skuCode}</Typography>
                      </TableCell>
                      <TableCell align="center"><MoveChip movementType={m.movementType} txnType={m.txnType} /></TableCell>
                      <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: t.color, whiteSpace: 'nowrap' }}>
                        {t.sign}{num(m.quantity)}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{num(m.balanceAfter)}</TableCell>
                      <TableCell sx={{ color: O2D.sub, whiteSpace: 'nowrap' }}>{m.performedByName || '—'}</TableCell>
                      <TableCell sx={{ maxWidth: 240 }}>
                        <Typography noWrap sx={{ fontSize: '0.72rem', color: O2D.sub }} title={m.remarks}>{m.remarks || '—'}</Typography>
                        {(m.refNumber || m.batchNo) && (
                          <Chip size="small" label={[m.refNumber, m.batchNo].filter(Boolean).join(' · ')}
                            sx={{ height: 17, fontSize: '0.62rem', mt: 0.25, borderRadius: '999px', bgcolor: FLUENT.blue.tint, border: `1px solid ${FLUENT.blue.border}`, color: FLUENT.blue.ink }} />
                        )}
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
            rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="Movements per page:" sx={pagerSx}
          />
        </Panel>
      )}
    </FgShell>
  );
};

export default FgImsMovements;
