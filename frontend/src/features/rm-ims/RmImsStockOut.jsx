import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, Button, Autocomplete, IconButton, FormControlLabel, Switch,
  Table, TableHead, TableBody, TableRow, TableCell, CircularProgress, alpha, useTheme, Chip,
} from '@mui/material';
import { PackageMinus, Plus, X, Save } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import dayjs from 'dayjs';
import { ImsHero, num } from '../ims/imsMeta';
import { useGetRmOverviewQuery, useRmIssueMutation } from '../../store/api/rmImsApi';

const RmImsStockOut = () => {
  const theme = useTheme();
  const { data } = useGetRmOverviewQuery({});
  const items = useMemo(() => data?.data || [], [data]);
  const [issue, { isLoading }] = useRmIssueMutation();

  const [header, setHeader] = useState({ date: dayjs().format('YYYY-MM-DD'), purpose: '', issuedTo: '', department: '', reference: '', allowNegative: false });
  const [lines, setLines] = useState([{ sku: null, quantity: '', remarks: '' }]);
  const setLine = (i, k, v) => setLines((p) => p.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((p) => [...p, { sku: null, quantity: '', remarks: '' }]);
  const delLine = (i) => setLines((p) => p.filter((_, j) => j !== i));
  const valid = lines.filter((l) => l.sku && Number(l.quantity) > 0);

  const submit = async () => {
    if (!valid.length) return enqueueSnackbar('Add at least one item with a quantity.', { variant: 'warning' });
    try {
      const res = await issue({
        date: header.date, purpose: header.purpose || undefined, issuedTo: header.issuedTo || undefined,
        department: header.department || undefined, reference: header.reference || undefined, allowNegative: header.allowNegative,
        items: valid.map((l) => ({ skuId: l.sku.skuId, skuCode: l.sku.skuCode, quantity: Number(l.quantity), remarks: l.remarks || undefined })),
      }).unwrap();
      enqueueSnackbar(`Issued ${res?.data?.count || valid.length} item(s).`, { variant: 'success' });
      setLines([{ sku: null, quantity: '', remarks: '' }]);
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not issue stock.', { variant: 'error' }); }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <ImsHero icon={PackageMinus} title="RM Stock Out (Issue)" subtitle="Issue coils/circles to production or correct stock down." />
      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6, maxWidth: 1000, mx: 'auto' }}>
        <Paper elevation={0} sx={{ p: 2, borderRadius: '14px', border: '1px solid', borderColor: 'divider', mb: 2 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
            <TextField size="small" type="date" label="Date" value={header.date} onChange={(e) => setHeader((h) => ({ ...h, date: e.target.value }))} InputLabelProps={{ shrink: true }} />
            <TextField size="small" label="Purpose" value={header.purpose} onChange={(e) => setHeader((h) => ({ ...h, purpose: e.target.value }))} fullWidth />
            <TextField size="small" label="Issued to" value={header.issuedTo} onChange={(e) => setHeader((h) => ({ ...h, issuedTo: e.target.value }))} fullWidth />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="center">
            <TextField size="small" label="Department" value={header.department} onChange={(e) => setHeader((h) => ({ ...h, department: e.target.value }))} fullWidth />
            <TextField size="small" label="Reference" value={header.reference} onChange={(e) => setHeader((h) => ({ ...h, reference: e.target.value }))} fullWidth />
            <FormControlLabel control={<Switch checked={header.allowNegative} onChange={(e) => setHeader((h) => ({ ...h, allowNegative: e.target.checked }))} />} label="Allow negative" sx={{ whiteSpace: 'nowrap' }} />
          </Stack>
        </Paper>

        <Paper elevation={0} sx={{ borderRadius: '14px', border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 720 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  {['Item', 'On hand', 'Quantity', 'Remarks', ''].map((h, i) => (
                    <TableCell key={h} align={[1, 2].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {lines.map((l, i) => {
                  const over = l.sku && Number(l.quantity) > Number(l.sku.onHand) && !header.allowNegative;
                  return (
                    <TableRow key={i}>
                      <TableCell sx={{ minWidth: 280 }}>
                        <Autocomplete
                          size="small" options={items} value={l.sku} onChange={(_, v) => setLine(i, 'sku', v)}
                          getOptionLabel={(o) => (o ? `${o.skuCode} — ${o.skuName}` : '')}
                          isOptionEqualToValue={(a, b) => a.skuId === b?.skuId}
                          renderOption={(props, o) => (<li {...props} key={o.skuId}><Box><Typography variant="body2" fontWeight={700}>{o.skuCode} <Chip size="small" label={o.kind} sx={{ height: 16, fontSize: '0.55rem', ml: 0.5 }} /></Typography><Typography variant="caption" color="text.secondary">{o.skuName} · on hand {num(o.onHand)}</Typography></Box></li>)}
                          renderInput={(p) => <TextField {...p} placeholder="Search coil / circle…" />}
                        />
                      </TableCell>
                      <TableCell align="right"><Typography variant="caption" color="text.secondary">{l.sku ? num(l.sku.onHand) : '—'}</Typography></TableCell>
                      <TableCell align="right" sx={{ width: 120 }}><TextField size="small" type="number" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} error={over} inputProps={{ min: 0, style: { textAlign: 'right' } }} /></TableCell>
                      <TableCell><TextField size="small" value={l.remarks} onChange={(e) => setLine(i, 'remarks', e.target.value)} fullWidth /></TableCell>
                      <TableCell><IconButton size="small" onClick={() => delLine(i)} disabled={lines.length === 1}><X size={15} /></IconButton></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
          <Stack direction="row" justifyContent="space-between" sx={{ p: 1.5 }}>
            <Button size="small" startIcon={<Plus size={15} />} onClick={addLine}>Add line</Button>
            <Button variant="contained" color="error" onClick={submit} disabled={isLoading || !valid.length} startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={16} />}>
              {isLoading ? 'Issuing…' : `Issue (${valid.length})`}
            </Button>
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
};

export default RmImsStockOut;
