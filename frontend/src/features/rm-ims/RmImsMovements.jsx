import React, { useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, InputAdornment, Table, TableHead, TableBody, TableRow, TableCell,
  Chip, Skeleton, alpha, useTheme, TablePagination,
} from '@mui/material';
import { History, Search } from 'lucide-react';
import dayjs from 'dayjs';
import { ImsHero, num } from '../ims/imsMeta';
import { useGetRmMovementsQuery } from '../../store/api/rmImsApi';

const RmImsMovements = () => {
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);

  const { data, isFetching } = useGetRmMovementsQuery({ search: search || undefined, page: page + 1, limit });
  const rows = data?.data || [];
  const total = data?.meta?.total || 0;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <ImsHero icon={History} title="RM Movement History" subtitle="Every coil & circle stock movement — receipts, issues, conversions and QC." />
      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        <Paper elevation={0} sx={{ p: 1.5, borderRadius: '14px', border: '1px solid', borderColor: 'divider', mb: 2 }}>
          <TextField
            size="small" placeholder="Search movement / SKU / batch / reference…" value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            sx={{ width: { xs: '100%', md: 360 }, '& .MuiOutlinedInput-root': { borderRadius: '12px' } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }}
          />
        </Paper>

        <Paper elevation={0} sx={{ borderRadius: '14px', border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            {isFetching ? <Skeleton variant="rounded" height={360} /> : (
              <Table size="small" sx={{ minWidth: 980 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                    {['Movement', 'Date', 'Item', 'Txn', 'Qty', 'Balance', 'Batch', 'Reference', 'By'].map((h, i) => (
                      <TableCell key={h} align={[4, 5].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={9} sx={{ textAlign: 'center', py: 4, color: 'text.disabled' }}>No movements.</TableCell></TableRow>
                  )}
                  {rows.map((m) => {
                    const isIn = m.movementType === 'IN';
                    return (
                      <TableRow key={m._id} hover>
                        <TableCell><Typography variant="body2" fontWeight={700} color="primary.main">{m.movementNumber}</Typography></TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{dayjs(m.movementDate).format('DD MMM YY')}</TableCell>
                        <TableCell sx={{ maxWidth: 220 }}><Typography variant="body2" noWrap title={m.skuName}>{m.skuName}</Typography><Typography variant="caption" color="text.secondary">{m.skuCode}</Typography></TableCell>
                        <TableCell><Chip size="small" label={m.txnType} sx={{ height: 20, fontSize: '0.58rem', fontWeight: 700, bgcolor: alpha(isIn ? theme.palette.success.main : theme.palette.error.main, 0.12), color: isIn ? theme.palette.success.dark : theme.palette.error.dark }} /></TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: isIn ? 'success.main' : 'error.main' }}>{isIn ? '+' : '−'}{num(m.quantity)}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(m.balanceAfter)}</TableCell>
                        <TableCell>{m.batchNo || '—'}</TableCell>
                        <TableCell><Typography variant="caption" noWrap>{m.refNumber || m.refType || '—'}</Typography></TableCell>
                        <TableCell><Typography variant="caption">{m.performedByName || '—'}</Typography></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </Box>
          <TablePagination
            component="div" count={total} page={page} rowsPerPage={limit}
            onPageChange={(_, p) => setPage(p)}
            onRowsPerPageChange={(e) => { setLimit(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </Paper>
      </Box>
    </Box>
  );
};

export default RmImsMovements;
