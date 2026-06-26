import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, MenuItem, Button, Autocomplete, IconButton,
  Table, TableHead, TableBody, TableRow, TableCell, CircularProgress, alpha, useTheme, Chip,
} from '@mui/material';
import { PackagePlus, Plus, X, Save } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import dayjs from 'dayjs';
import { ImsHero, num } from '../ims/imsMeta';
import { useGetRmOverviewQuery, useRmReceiveMutation } from '../../store/api/rmImsApi';

const REASONS = [{ v: 'VENDOR', l: 'Vendor receipt' }, { v: 'OPENING', l: 'Opening stock' }, { v: 'CORRECTION', l: 'Correction (+)' }];

const RmImsStockIn = () => {
  const theme = useTheme();
  const { data } = useGetRmOverviewQuery({});
  const items = useMemo(() => data?.data || [], [data]);
  const [receive, { isLoading }] = useRmReceiveMutation();

  const [header, setHeader] = useState({ date: dayjs().format('YYYY-MM-DD'), reason: 'VENDOR', reference: '' });
  const [lines, setLines] = useState([{ sku: null, quantity: '', unitCost: '', batchNo: '' }]);

  const setLine = (i, k, v) => setLines((p) => p.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((p) => [...p, { sku: null, quantity: '', unitCost: '', batchNo: '' }]);
  const delLine = (i) => setLines((p) => p.filter((_, j) => j !== i));

  const valid = lines.filter((l) => l.sku && Number(l.quantity) > 0);

  const submit = async () => {
    if (!valid.length) return enqueueSnackbar('Add at least one item with a quantity.', { variant: 'warning' });
    try {
      const res = await receive({
        date: header.date, reason: header.reason, reference: header.reference || undefined,
        items: valid.map((l) => ({ skuId: l.sku.skuId, skuCode: l.sku.skuCode, quantity: Number(l.quantity), unitCost: Number(l.unitCost || 0), batchNo: l.batchNo || undefined })),
      }).unwrap();
      enqueueSnackbar(`Stock added for ${res?.data?.count || valid.length} item(s).`, { variant: 'success' });
      setLines([{ sku: null, quantity: '', unitCost: '', batchNo: '' }]);
      setHeader((h) => ({ ...h, reference: '' }));
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not add stock.', { variant: 'error' }); }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <ImsHero icon={PackagePlus} title="RM Stock In" subtitle="Manual receipt / opening balance / correction. (Vendor GRNs post here automatically from Purchase FMS.)" />
      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6, maxWidth: 1000, mx: 'auto' }}>
        <Paper elevation={0} sx={{ p: 2, borderRadius: '14px', border: '1px solid', borderColor: 'divider', mb: 2 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField size="small" type="date" label="Date" value={header.date} onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))} InputLabelProps={{ shrink: true }} />
            <TextField select size="small" label="Reason" value={header.reason} onChange={(e) => setHeader((h) => ({ ...h, reason: e.target.value }))} sx={{ minWidth: 180 }}>
              {REASONS.map((r) => <MenuItem key={r.v} value={r.v}>{r.l}</MenuItem>)}
            </TextField>
            <TextField size="small" label="Reference (challan / note)" value={header.reference} onChange={(e) => setHeader((h) => ({ ...h, reference: e.target.value }))} fullWidth />
          </Stack>
        </Paper>

        <Paper elevation={0} sx={{ borderRadius: '14px', border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 760 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  {['Item', 'On hand', 'Quantity', 'Unit cost', 'Batch', ''].map((h, i) => (
                    <TableCell key={h} align={[1, 2, 3].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ minWidth: 280 }}>
                      <Autocomplete
                        size="small" options={items} value={l.sku} onChange={(_, v) => setLine(i, 'sku', v)}
                        getOptionLabel={(o) => (o ? `${o.skuCode} — ${o.skuName}` : '')}
                        isOptionEqualToValue={(a, b) => a.skuId === b?.skuId}
                        renderOption={(props, o) => (<li {...props} key={o.skuId}><Box><Typography variant="body2" fontWeight={700}>{o.skuCode} <Chip size="small" label={o.kind} sx={{ height: 16, fontSize: '0.55rem', ml: 0.5 }} /></Typography><Typography variant="caption" color="text.secondary">{o.skuName}</Typography></Box></li>)}
                        renderInput={(p) => <TextField {...p} placeholder="Search coil / circle…" />}
                      />
                    </TableCell>
                    <TableCell align="right"><Typography variant="caption" color="text.secondary">{l.sku ? num(l.sku.onHand) : '—'}</Typography></TableCell>
                    <TableCell align="right" sx={{ width: 120 }}><TextField size="small" type="number" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} inputProps={{ min: 0, style: { textAlign: 'right' } }} /></TableCell>
                    <TableCell align="right" sx={{ width: 120 }}><TextField size="small" type="number" value={l.unitCost} onChange={(e) => setLine(i, 'unitCost', e.target.value)} inputProps={{ min: 0, style: { textAlign: 'right' } }} placeholder={l.sku?.rate ? String(l.sku.rate) : ''} /></TableCell>
                    <TableCell sx={{ width: 130 }}><TextField size="small" value={l.batchNo} onChange={(e) => setLine(i, 'batchNo', e.target.value)} /></TableCell>
                    <TableCell><IconButton size="small" onClick={() => delLine(i)} disabled={lines.length === 1}><X size={15} /></IconButton></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <Stack direction="row" justifyContent="space-between" sx={{ p: 1.5 }}>
            <Button size="small" startIcon={<Plus size={15} />} onClick={addLine}>Add line</Button>
            <Button variant="contained" onClick={submit} disabled={isLoading || !valid.length} startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={16} />}>
              {isLoading ? 'Saving…' : `Add stock (${valid.length})`}
            </Button>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
};

export default RmImsStockIn;
