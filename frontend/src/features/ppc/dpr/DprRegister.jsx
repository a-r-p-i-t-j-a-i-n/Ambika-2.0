import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, Grid, Stack, Typography, Paper, TextField, MenuItem, Autocomplete, Button, IconButton,
  Table, TableHead, TableBody, TableRow, TableCell, TablePagination, Chip, Skeleton, InputAdornment,
  Dialog, DialogTitle, DialogContent, DialogActions, Snackbar, Alert, Tooltip, LinearProgress,
} from '@mui/material';
import {
  ClipboardList, Plus, Search, Pencil, Trash2, Download, Gauge, PackageCheck, XCircle, Timer,
} from 'lucide-react';
import {
  DprHero, StatTile, OeeChip, PPC_ACCENT, oeeColor, ratioColor, num, pct, compactInr, SHIFTS,
} from './dprMeta';
import { useGetDprEntriesQuery, useDeleteDprEntryMutation, useGetDprOptionsQuery } from '../../../store/api/dprApi';

const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—');

const DprRegister = () => {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const { data: optRes } = useGetDprOptionsQuery();
  const options = optRes?.data || {};

  const [filters, setFilters] = useState({
    from: '', to: '', machineCode: sp.get('machineCode') || '', skuCode: sp.get('skuCode') || '',
    operatorName: sp.get('operatorName') || '', shift: '', search: '',
  });
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);
  const [toDelete, setToDelete] = useState(null);
  const [snack, setSnack] = useState(null);
  const setF = (k, v) => { setFilters((p) => ({ ...p, [k]: v })); setPage(0); };

  const params = useMemo(() => {
    const p = { page: page + 1, limit: rowsPerPage };
    Object.entries(filters).forEach(([k, v]) => { if (v) p[k] = v; });
    return p;
  }, [filters, page, rowsPerPage]);

  const { data, isFetching, refetch } = useGetDprEntriesQuery(params);
  const [deleteEntry, { isLoading: deleting }] = useDeleteDprEntryMutation();
  const docs = data?.data || [];
  const pagination = data?.meta?.pagination || { total: 0 };
  const summary = data?.meta?.summary || {};

  // If the URL carried a filter (arriving from a dashboard), reflect it once.
  useEffect(() => { /* filters already seeded from searchParams */ }, []);

  const doDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteEntry(toDelete._id).unwrap();
      setSnack({ sev: 'success', msg: 'Entry deleted.' });
    } catch (e) {
      setSnack({ sev: 'error', msg: e?.data?.message || 'Delete failed.' });
    } finally { setToDelete(null); }
  };

  const exportCsv = () => {
    const head = ['Date', 'Shift', 'Machine', 'Operator', 'SKU Code', 'SKU', 'Operation', 'Produced', 'Good', 'Reject', 'OEE%', 'Avail%', 'Perf%', 'Qual%', 'Avail(min)', 'Loss(min)'];
    const rows = docs.map((e) => [
      fmtDate(e.date), e.shift, e.machineCode, e.operatorName, e.skuCode, e.skuName, e.operationLabel,
      e.oee?.productionQty ?? 0, e.oee?.goodQty ?? 0, e.oee?.rejectQty ?? 0,
      ((e.oee?.oee || 0) * 100).toFixed(1), ((e.oee?.availability || 0) * 100).toFixed(1),
      ((e.oee?.performance || 0) * 100).toFixed(1), ((e.oee?.quality || 0) * 100).toFixed(1),
      e.availableMinutes ?? 0, e.oee?.downtimeTotal ?? 0,
    ]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `dpr-register-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ pb: 6 }}>
      <DprHero icon={ClipboardList} title="DPR Register" subtitle="Every daily production entry with its computed OEE"
        action={<Button variant="contained" startIcon={<Plus size={18} />} onClick={() => navigate('/ppc/dpr/new')}
          sx={{ bgcolor: 'rgba(255,255,255,0.18)', fontWeight: 800, '&:hover': { bgcolor: 'rgba(255,255,255,0.28)' } }}>New DPR Entry</Button>} />

      <Box sx={{ p: { xs: 1.5, md: 2.5 } }}>
        {/* Roll-up of the filtered set */}
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          <Grid item xs={6} md={3}><StatTile label="Entries" value={num(pagination.total)} color={PPC_ACCENT} icon={ClipboardList} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Weighted OEE" value={pct(summary.oeePct)} color={oeeColor(summary.oeePct)} icon={Gauge} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Produced (good)" value={`${num(summary.goodQty)} / ${num(summary.productionQty)}`} color="#0f766e" icon={PackageCheck} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Rejected" value={`${num(summary.rejectQty)} pcs`} sub={pct(summary.qualityPct) + ' quality'} color="#dc2626" icon={XCircle} /></Grid>
        </Grid>

        {/* Filters */}
        <Paper elevation={0} sx={{ p: 1.25, borderRadius: '14px', border: '1px solid', borderColor: 'divider', mb: 2 }}>
          <Grid container spacing={1} alignItems="center">
            <Grid item xs={6} sm={3} md={1.6}><TextField size="small" fullWidth type="date" label="From" InputLabelProps={{ shrink: true }} value={filters.from} onChange={(e) => setF('from', e.target.value)} /></Grid>
            <Grid item xs={6} sm={3} md={1.6}><TextField size="small" fullWidth type="date" label="To" InputLabelProps={{ shrink: true }} value={filters.to} onChange={(e) => setF('to', e.target.value)} /></Grid>
            <Grid item xs={6} sm={3} md={1.6}>
              <Autocomplete size="small" options={(options.machines || []).map((m) => m.code)} value={filters.machineCode || null}
                onChange={(_e, v) => setF('machineCode', v || '')} renderInput={(p) => <TextField {...p} label="Machine" />} />
            </Grid>
            <Grid item xs={6} sm={3} md={2}>
              <Autocomplete size="small" options={(options.skus || []).map((s) => s.skuCode)} value={filters.skuCode || null}
                onChange={(_e, v) => setF('skuCode', v || '')} renderInput={(p) => <TextField {...p} label="SKU" />} />
            </Grid>
            <Grid item xs={6} sm={3} md={1.6}>
              <TextField size="small" fullWidth select label="Shift" value={filters.shift} onChange={(e) => setF('shift', e.target.value)}>
                <MenuItem value="">All</MenuItem>
                {SHIFTS.map((s) => <MenuItem key={s} value={s}>Shift {s}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6} md={2.4}>
              <TextField size="small" fullWidth placeholder="Search operator / die…" value={filters.search}
                onChange={(e) => setF('search', e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
            </Grid>
            <Grid item xs={12} md={1.2}>
              <Button size="small" fullWidth variant="outlined" startIcon={<Download size={15} />} onClick={exportCsv} disabled={!docs.length}>CSV</Button>
            </Grid>
          </Grid>
        </Paper>

        {isFetching && <LinearProgress sx={{ mb: 1, borderRadius: 2 }} />}

        <Paper elevation={0} sx={{ borderRadius: '14px', border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {['Date', 'Shift', 'Machine', 'Operator', 'SKU', 'Operation', 'Prod', 'Good', 'Rej', 'OEE', 'Avail', ''].map((h, i) => (
                    <TableCell key={h + i} align={i >= 6 && i <= 10 ? 'right' : 'left'}
                      sx={{ fontWeight: 800, fontSize: '0.7rem', textTransform: 'uppercase', color: 'text.secondary', whiteSpace: 'nowrap' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {isFetching && !docs.length
                  ? Array.from({ length: 8 }).map((_, i) => <TableRow key={i}><TableCell colSpan={12}><Skeleton height={26} /></TableCell></TableRow>)
                  : docs.map((e) => (
                    <TableRow key={e._id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(e.date)}</TableCell>
                      <TableCell><Chip size="small" label={e.shift} sx={{ height: 20, fontWeight: 700 }} /></TableCell>
                      <TableCell sx={{ fontWeight: 800 }}>{e.machineCode}</TableCell>
                      <TableCell sx={{ fontSize: '0.8rem' }}>{e.operatorName || '—'}</TableCell>
                      <TableCell sx={{ maxWidth: 150 }}>
                        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.1 }} noWrap>{e.skuCode}</Typography>
                        <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }} noWrap>{e.skuName}</Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: '0.78rem', maxWidth: 140 }} title={e.operationLabel}><Box component="span" sx={{ display: 'block' }} noWrap>{e.operationLabel || '—'}</Box></TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{num(e.oee?.productionQty)}</TableCell>
                      <TableCell align="right">{num(e.oee?.goodQty)}</TableCell>
                      <TableCell align="right" sx={{ color: e.oee?.rejectQty ? '#dc2626' : 'text.secondary' }}>{num(e.oee?.rejectQty)}</TableCell>
                      <TableCell align="right"><OeeChip value={(e.oee?.oee || 0) * 100} /></TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: ratioColor((e.oee?.availability || 0) * 100) }}>{pct((e.oee?.availability || 0) * 100)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title="Edit"><IconButton size="small" onClick={() => navigate(`/ppc/dpr/${e._id}/edit`)}><Pencil size={15} /></IconButton></Tooltip>
                        <Tooltip title="Delete"><IconButton size="small" onClick={() => setToDelete(e)}><Trash2 size={15} /></IconButton></Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                {!isFetching && !docs.length && (
                  <TableRow><TableCell colSpan={12}>
                    <Stack alignItems="center" sx={{ py: 5, color: 'text.secondary' }}>
                      <Typography sx={{ fontSize: '0.9rem', mb: 1 }}>No DPR entries match these filters.</Typography>
                      <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => navigate('/ppc/dpr/new')} sx={{ bgcolor: PPC_ACCENT, '&:hover': { bgcolor: '#5b21b6' } }}>Add the first entry</Button>
                    </Stack>
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
          <TablePagination component="div" count={pagination.total || 0} page={page} onPageChange={(_e, p) => setPage(p)}
            rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[25, 50, 100, 250]} />
        </Paper>
      </Box>

      <Dialog open={!!toDelete} onClose={() => setToDelete(null)}>
        <DialogTitle>Delete DPR entry?</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.9rem' }}>
            {toDelete && `${fmtDate(toDelete.date)} · ${toDelete.machineCode} · ${toDelete.skuCode} · ${toDelete.operationLabel}`}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setToDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={doDelete} disabled={deleting}>Delete</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snack} autoHideDuration={3000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.sev} variant="filled" onClose={() => setSnack(null)}>{snack.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
};

export default DprRegister;
