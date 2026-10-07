import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, InputAdornment, Table, TableHead, TableBody,
  TableRow, TableCell, Chip, Skeleton, TablePagination, Button, MenuItem,
} from '@mui/material';
import { History, Search, ArrowDownLeft, ArrowUpRight, Download, X, Scale } from 'lucide-react';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import {
  ImsShell, Panel, TableScroll, KpiTile, MoveChip, EmptyNote, Th,
  O2D, moveToken, txnLabel, num, imsTableSx,
} from './imsMeta';
import { useGetImsMovementsQuery } from '../../store/api/imsApi';
import { FIELD } from './imsFieldHelp';

const H = FIELD.ims;

const RANGES = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 0, label: 'Everything' },
];

// IMS movement history — the full IN/OUT ledger (who / when / why).
const ImsMovements = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [dir, setDir] = useState('ALL');   // ALL | IN | OUT
  const [range, setRange] = useState(30);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  const { data, isFetching } = useGetImsMovementsQuery({ search: search || undefined, sort: '-movementDate', limit: 1000 });
  const rows = useMemo(() => data?.data || [], [data]);

  const filtered = useMemo(() => {
    const cutoff = range ? dayjs().subtract(range, 'day').startOf('day') : null;
    return rows.filter((r) => (dir === 'ALL' || r.movementType === dir)
      && (!cutoff || dayjs(r.movementDate).isAfter(cutoff)));
  }, [rows, dir, range]);

  const totals = useMemo(() => filtered.reduce((t, m) => {
    if (m.movementType === 'IN') t.in += Number(m.quantity || 0); else t.out += Number(m.quantity || 0);
    return t;
  }, { in: 0, out: 0 }), [filtered]);

  useEffect(() => { setPage(0); }, [search, dir, range, rowsPerPage]);
  const paged = useMemo(() => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [filtered, page, rowsPerPage]);

  const exportCsv = () => {
    const header = ['Date', 'Movement no', 'SKU Code', 'Item Name', 'What happened', 'Direction', 'Quantity', 'Balance after', 'Recorded by', 'Notes'];
    const lines = filtered.map((m) => [
      dayjs(m.movementDate).format('YYYY-MM-DD'), m.movementNumber, m.skuCode, m.skuName,
      txnLabel(m.txnType), m.movementType === 'IN' ? 'In' : 'Out', m.quantity, m.balanceAfter,
      m.performedByName, m.remarks,
    ]);
    const csv = [header, ...lines].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `stock-movements_${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const net = totals.in - totals.out;
  const activeFilters = (dir !== 'ALL' ? 1 : 0) + (range !== 30 ? 1 : 0) + (search ? 1 : 0);

  return (
    <ImsShell
      icon={History}
      title="Movement history"
      subtitle="Every unit that came in or went out — what, when, why and who recorded it."
      actions={(
        <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!filtered.length}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
          Export
        </Button>
      )}
    >
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
        <KpiTile label="Movements" value={num(filtered.length)} sub={range ? `In the last ${range} days` : 'All time'}
          color={O2D.brand} icon={History} />
        <KpiTile label="Units received" value={`+${num(totals.in)}`} sub="Came into the store"
          color={moveToken('IN').color} icon={ArrowDownLeft}
          active={dir === 'IN'} onClick={() => setDir(dir === 'IN' ? 'ALL' : 'IN')} />
        <KpiTile label="Units issued" value={`−${num(totals.out)}`} sub="Left the store"
          color={moveToken('OUT').color} icon={ArrowUpRight}
          active={dir === 'OUT'} onClick={() => setDir(dir === 'OUT' ? 'ALL' : 'OUT')} />
        <KpiTile label="Net change" value={`${net >= 0 ? '+' : '−'}${num(Math.abs(net))}`}
          sub={net >= 0 ? 'Store grew over this period' : 'Store shrank over this period'}
          color={net >= 0 ? moveToken('IN').color : moveToken('OUT').color} icon={Scale} />
      </Stack>

      <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by item, code, movement no or reference…" sx={{ minWidth: { xs: '100%', sm: 300 }, flex: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
          <TextField select size="small" label="Period" value={range} onChange={(e) => setRange(Number(e.target.value))} sx={{ minWidth: 150 }}>
            {RANGES.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Direction" value={dir} onChange={(e) => setDir(e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="ALL">In and out</MenuItem>
            <MenuItem value="IN">Only coming in</MenuItem>
            <MenuItem value="OUT">Only going out</MenuItem>
          </TextField>
          <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, ml: 'auto', whiteSpace: 'nowrap' }}>
            <b>{filtered.length}</b> movement{filtered.length === 1 ? '' : 's'}
          </Typography>
          {activeFilters > 0 && (
            <Button size="small" startIcon={<X size={12} />} onClick={() => { setSearch(''); setDir('ALL'); setRange(30); }}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.body }}>
              Reset ({activeFilters})
            </Button>
          )}
        </Stack>
      </Paper>

      <Panel dense>
        <TableScroll>
          <Table size="small" sx={imsTableSx(1000)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell align="center"><Th label="Date" hint={H.movementDate} /></TableCell>
                <TableCell><Th label="Movement no" hint={H.movementNumber} /></TableCell>
                <TableCell><Th label="Item Name" hint={H.skuName} /></TableCell>
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
                    hint="Widen the period, clear the direction filter, or record a Stock In / Stock Out to start the history." />
                </TableCell></TableRow>
              )}
              {paged.map((m, i) => {
                const t = moveToken(m.movementType);
                return (
                  <TableRow key={m._id} hover sx={{ cursor: m.skuId ? 'pointer' : 'default' }}
                    onClick={() => m.skuId && navigate(`/ims/item/${m.skuId}`)}>
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
                      {(m.refNumber || m.vendorName) && (
                        <Chip size="small" label={[m.refNumber, m.vendorName].filter(Boolean).join(' · ')}
                          sx={{ height: 17, fontSize: '0.62rem', mt: 0.25, borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.sub }} />
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
          rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="Movements per page:"
          sx={{ borderTop: `1px solid ${O2D.lineSoft}`, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } }}
        />
      </Panel>
    </ImsShell>
  );
};

export default ImsMovements;
