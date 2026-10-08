import React, { useMemo, useState } from 'react';
import {
  Paper, Stack, Typography, TextField, InputAdornment, Table, TableHead, TableBody, TableRow, TableCell,
  Chip, Skeleton, TablePagination, Button, MenuItem,
} from '@mui/material';
import { History, Search, ArrowDownLeft, ArrowUpRight, Download, X, Scale } from 'lucide-react';
import dayjs from 'dayjs';
import {
  RmShell, Panel, TableScroll, KpiTile, MoveChip, EmptyNote, Th,
  O2D, moveToken, txnLabel, num, imsTableSx,
} from './rmImsMeta';
import { useGetRmMovementsQuery } from '../../store/api/rmImsApi';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.rm;

const RmImsMovements = () => {
  const [search, setSearch] = useState('');
  const [dir, setDir] = useState('ALL');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);

  // The list is server-paginated, so the direction filter narrows the page in
  // hand rather than the whole ledger — the count line says so explicitly.
  const { data, isFetching } = useGetRmMovementsQuery({ search: search || undefined, page: page + 1, limit });
  const rows = useMemo(() => data?.data || [], [data]);
  const total = data?.meta?.total || 0;

  const shown = useMemo(() => (dir === 'ALL' ? rows : rows.filter((r) => r.movementType === dir)), [rows, dir]);
  const totals = useMemo(() => rows.reduce((t, m) => {
    if (m.movementType === 'IN') t.in += Number(m.quantity || 0); else t.out += Number(m.quantity || 0);
    return t;
  }, { in: 0, out: 0 }), [rows]);
  const net = totals.in - totals.out;

  const exportCsv = () => {
    const header = ['Movement no', 'Date', 'SKU Code', 'Item Name', 'What happened', 'Direction', 'Quantity', 'Balance after', 'Batch', 'Reference', 'Recorded by'];
    const lines = shown.map((m) => [
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

  const activeFilters = (dir !== 'ALL' ? 1 : 0) + (search ? 1 : 0);

  return (
    <RmShell
      icon={History}
      title="Movement history"
      subtitle="Every coil and circle that came in or went out — receipts, issues, cutting and QC."
      actions={(
        <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!shown.length}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
          Export page
        </Button>
      )}
    >
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
        <KpiTile label="Movements" value={num(total)} sub="Across the whole ledger" color={O2D.brand} icon={History} />
        <KpiTile label="Units received" value={`+${num(totals.in)}`} sub="On this page"
          color={moveToken('IN').color} icon={ArrowDownLeft}
          active={dir === 'IN'} onClick={() => setDir(dir === 'IN' ? 'ALL' : 'IN')} />
        <KpiTile label="Units issued" value={`−${num(totals.out)}`} sub="On this page"
          color={moveToken('OUT').color} icon={ArrowUpRight}
          active={dir === 'OUT'} onClick={() => setDir(dir === 'OUT' ? 'ALL' : 'OUT')} />
        <KpiTile label="Net change" value={`${net >= 0 ? '+' : '−'}${num(Math.abs(net))}`}
          sub={net >= 0 ? 'Store grew on this page' : 'Store shrank on this page'}
          color={net >= 0 ? moveToken('IN').color : moveToken('OUT').color} icon={Scale} />
      </Stack>

      <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search by item, code, batch, movement no or reference…" sx={{ minWidth: { xs: '100%', sm: 300 }, flex: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
          <TextField select size="small" label="Direction" value={dir} onChange={(e) => setDir(e.target.value)} sx={{ minWidth: 165 }}>
            <MenuItem value="ALL">In and out</MenuItem>
            <MenuItem value="IN">Only coming in</MenuItem>
            <MenuItem value="OUT">Only going out</MenuItem>
          </TextField>
          <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, ml: 'auto', whiteSpace: 'nowrap' }}>
            {dir === 'ALL'
              ? <><b>{num(total)}</b> movement{total === 1 ? '' : 's'}</>
              : <><b>{shown.length}</b> of {rows.length} on this page</>}
          </Typography>
          {activeFilters > 0 && (
            <Button size="small" startIcon={<X size={12} />} onClick={() => { setSearch(''); setDir('ALL'); setPage(0); }}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.body }}>
              Reset ({activeFilters})
            </Button>
          )}
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
              {!isFetching && shown.length === 0 && (
                <TableRow><TableCell colSpan={10} sx={{ border: 0 }}>
                  <EmptyNote icon={History} title="No movements to show"
                    hint="Clear the direction filter or the search, or record a Stock In, Stock Out or coil cutting to start the history." />
                </TableCell></TableRow>
              )}
              {shown.map((m, i) => {
                const t = moveToken(m.movementType);
                return (
                  <TableRow key={m._id} hover>
                    <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{i + 1}</TableCell>
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
          component="div" count={total} page={page} rowsPerPage={limit}
          onPageChange={(_, p) => setPage(p)}
          onRowsPerPageChange={(e) => { setLimit(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="Movements per page:"
          sx={{ borderTop: `1px solid ${O2D.lineSoft}`, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } }}
        />
      </Panel>

      {dir !== 'ALL' && (
        <Typography sx={{ fontSize: '0.68rem', color: O2D.faint, px: 0.5 }}>
          The direction filter narrows the page you are looking at. Use the search box to narrow the whole ledger.
        </Typography>
      )}
    </RmShell>
  );
};

export default RmImsMovements;
