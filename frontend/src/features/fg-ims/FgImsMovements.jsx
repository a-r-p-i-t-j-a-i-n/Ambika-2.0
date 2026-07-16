import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, InputAdornment, Table, TableHead, TableBody,
  TableRow, TableCell, Chip, Skeleton, alpha, ToggleButtonGroup, ToggleButton, TablePagination,
} from '@mui/material';
import { History, Search, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import dayjs from 'dayjs';
import { FgHero, num, TXN_LABEL, ROWS_PER_PAGE } from './fgImsMeta';
import { useGetFgMovementsQuery } from '../../store/api/fgImsApi';

// FG movement history — the full IN/OUT ledger (production, dispatch, adjustments).
const FgImsMovements = () => {
  const [search, setSearch] = useState('');
  const [dir, setDir] = useState('ALL'); // ALL | IN | OUT
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const { data, isFetching } = useGetFgMovementsQuery({ search: search || undefined, limit: 500 });
  const rows = useMemo(() => data?.data || [], [data]);
  const filtered = useMemo(() => (dir === 'ALL' ? rows : rows.filter((r) => r.movementType === dir)), [rows, dir]);
  React.useEffect(() => { setPage(0); }, [search, dir]);
  const paged = useMemo(() => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [filtered, page, rowsPerPage]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <FgHero icon={History} title="Movement History" subtitle="Every stock IN and OUT — production, dispatch, opening, returns and adjustments." />

      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        <Paper sx={{ p: 1.5, borderRadius: 3, mb: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
            <TextField size="small" fullWidth value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search movement no, SKU, item, reference, batch…"
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> }} />
            <ToggleButtonGroup size="small" exclusive value={dir} onChange={(_, v) => v && setDir(v)}>
              <ToggleButton value="ALL">All</ToggleButton>
              <ToggleButton value="IN">Production / In</ToggleButton>
              <ToggleButton value="OUT">Dispatch / Out</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Paper>

        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 940 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha('#059669', 0.06) }}>
                  {['Date', 'Movement #', 'Finished good', 'Type', 'Qty', 'Balance', 'By', 'Notes'].map((h, i) => (
                    <TableCell key={h} align={[4, 5].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {isFetching && rows.length === 0 && (
                  <TableRow><TableCell colSpan={8}><Skeleton variant="rounded" height={240} /></TableCell></TableRow>
                )}
                {!isFetching && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={8} sx={{ textAlign: 'center', py: 5, color: 'text.disabled' }}>No movements yet.</TableCell></TableRow>
                )}
                {paged.map((m) => {
                  const isIn = m.movementType === 'IN';
                  return (
                    <TableRow key={m._id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{dayjs(m.movementDate).format('DD MMM YYYY')}</TableCell>
                      <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.75rem' }}>{m.movementNumber}</TableCell>
                      <TableCell sx={{ maxWidth: 240 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={m.skuName}>{m.skuName}</Typography>
                        <Typography variant="caption" color="text.secondary">{m.skuCode}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" icon={isIn ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                          label={TXN_LABEL[m.txnType] || m.txnType}
                          sx={{ height: 22, fontWeight: 700, bgcolor: alpha(isIn ? '#059669' : '#dc2626', 0.12), color: isIn ? '#047857' : '#b91c1c' }} />
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: isIn ? '#047857' : '#dc2626' }}>
                        {isIn ? '+' : '−'}{num(m.quantity)}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(m.balanceAfter)}</TableCell>
                      <TableCell><Typography variant="caption">{m.performedByName || '—'}</Typography></TableCell>
                      <TableCell sx={{ maxWidth: 260 }}><Typography variant="caption" color="text.secondary" noWrap title={m.remarks}>{m.remarks || '—'}</Typography></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
          <TablePagination
            component="div"
            count={filtered.length}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={ROWS_PER_PAGE}
            labelRowsPerPage="Rows:"
          />
        </Paper>
      </Box>
    </Box>
  );
};

export default FgImsMovements;
