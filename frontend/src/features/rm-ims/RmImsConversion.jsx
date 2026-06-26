import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, Button, Autocomplete, IconButton, MenuItem, FormControlLabel, Switch,
  Table, TableHead, TableBody, TableRow, TableCell, CircularProgress, alpha, useTheme, Chip, Divider,
} from '@mui/material';
import { Recycle, Plus, X, Save, Disc3 } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import dayjs from 'dayjs';
import { ImsHero, num } from '../ims/imsMeta';
import { useGetRmOverviewQuery, useGetRmConversionsQuery, useRmConvertMutation } from '../../store/api/rmImsApi';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const RmImsConversion = () => {
  const theme = useTheme();
  const { data: ov } = useGetRmOverviewQuery({});
  const items = useMemo(() => ov?.data || [], [ov]);
  const coils = useMemo(() => items.filter((i) => i.kind === 'COIL'), [items]);
  const circleSkus = useMemo(() => items.filter((i) => i.kind === 'CIRCLE'), [items]);
  const { data: convRes } = useGetRmConversionsQuery({ limit: 50 });
  const conversions = convRes?.data || [];
  const totals = convRes?.meta || {};
  const [convert, { isLoading }] = useRmConvertMutation();

  const [coil, setCoil] = useState(null);
  const [head, setHead] = useState({ conversionDate: dayjs().format('YYYY-MM-DD'), batchNo: '', coilWeightKg: '', rate: '', scrapVerified: 'PENDING', allowNegative: false });
  const [circles, setCircles] = useState([{ sku: null, sizeLabel: '', pcs: '', weightKg: '' }]);

  const setC = (i, k, v) => setCircles((p) => p.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addC = () => setCircles((p) => [...p, { sku: null, sizeLabel: '', pcs: '', weightKg: '' }]);
  const delC = (i) => setCircles((p) => p.filter((_, j) => j !== i));

  const circlesWeight = round2(circles.reduce((s, c) => s + Number(c.weightKg || 0), 0));
  const coilWt = Number(head.coilWeightKg || 0);
  const scrap = round2(coilWt - circlesWeight);
  const yieldPct = coilWt > 0 ? round2((circlesWeight / coilWt) * 100) : 0;
  const validCircles = circles.filter((c) => c.sku && Number(c.weightKg) > 0);

  const submit = async () => {
    if (!coil) return enqueueSnackbar('Pick the coil being cut.', { variant: 'warning' });
    if (coilWt <= 0) return enqueueSnackbar('Enter the coil weight consumed.', { variant: 'warning' });
    if (!validCircles.length) return enqueueSnackbar('Add at least one produced circle with weight.', { variant: 'warning' });
    try {
      const res = await convert({
        conversionDate: head.conversionDate, batchNo: head.batchNo || undefined,
        coilSkuId: coil.skuId, coilWeightKg: coilWt, rate: Number(head.rate || coil.rate || 0),
        scrapVerified: head.scrapVerified, allowNegative: head.allowNegative,
        circles: validCircles.map((c) => ({ circleSkuId: c.sku.skuId, sizeLabel: c.sizeLabel || c.sku.skuName, pcs: Number(c.pcs || 0), weightKg: Number(c.weightKg) })),
      }).unwrap();
      enqueueSnackbar(`Conversion ${res?.data?.conversionNumber || ''} saved · yield ${num(res?.data?.yieldRatioPct)}%.`, { variant: 'success' });
      setCoil(null); setHead((h) => ({ ...h, batchNo: '', coilWeightKg: '', rate: '' }));
      setCircles([{ sku: null, sizeLabel: '', pcs: '', weightKg: '' }]);
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Conversion failed.', { variant: 'error' }); }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <ImsHero icon={Recycle} title="Coil → Circle Conversion" subtitle="Cut a coil into circles — consumes coil stock, adds circle stock, records scrap & yield." />
      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        {/* Conversion form */}
        <Paper elevation={0} sx={{ p: 2, borderRadius: '14px', border: '1px solid', borderColor: 'divider', mb: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
            <Autocomplete
              size="small" options={coils} value={coil} onChange={(_, v) => { setCoil(v); if (v && !head.rate) setHead((h) => ({ ...h, rate: v.rate || '' })); }}
              getOptionLabel={(o) => (o ? `${o.skuCode} — ${o.skuName}` : '')}
              isOptionEqualToValue={(a, b) => a.skuId === b?.skuId}
              sx={{ flex: 1, minWidth: 280 }}
              renderOption={(props, o) => (<li {...props} key={o.skuId}><Box><Typography variant="body2" fontWeight={700}>{o.skuCode}</Typography><Typography variant="caption" color="text.secondary">{o.skuName} · on hand {num(o.onHand)}</Typography></Box></li>)}
              renderInput={(p) => <TextField {...p} label="Coil (raw material) *" placeholder="Search coil…" InputProps={{ ...p.InputProps, startAdornment: <Disc3 size={15} style={{ marginLeft: 6, marginRight: 2, opacity: 0.6 }} /> }} />}
            />
            <TextField size="small" type="date" label="Date" value={head.conversionDate} onChange={(e) => setHead((h) => ({ ...h, conversionDate: e.target.value }))} InputLabelProps={{ shrink: true }} />
            <TextField size="small" label="Batch No." value={head.batchNo} onChange={(e) => setHead((h) => ({ ...h, batchNo: e.target.value }))} />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="center">
            <TextField size="small" type="number" label="Coil weight (kg) *" value={head.coilWeightKg} onChange={(e) => setHead((h) => ({ ...h, coilWeightKg: e.target.value }))} />
            <TextField size="small" type="number" label="Rate (₹/kg)" value={head.rate} onChange={(e) => setHead((h) => ({ ...h, rate: e.target.value }))} />
            <TextField select size="small" label="Scrap verified" value={head.scrapVerified} onChange={(e) => setHead((h) => ({ ...h, scrapVerified: e.target.value }))} sx={{ minWidth: 150 }}>
              <MenuItem value="PENDING">Pending</MenuItem><MenuItem value="JOB_WORK">Job work</MenuItem><MenuItem value="DONE">Done</MenuItem>
            </TextField>
            <FormControlLabel control={<Switch checked={head.allowNegative} onChange={(e) => setHead((h) => ({ ...h, allowNegative: e.target.checked }))} />} label="Allow negative coil" sx={{ whiteSpace: 'nowrap' }} />
          </Stack>

          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase' }}>Circles produced</Typography>
          <Box sx={{ overflowX: 'auto', mt: 1 }}>
            <Table size="small" sx={{ minWidth: 720 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  {['Circle SKU', 'Size label', 'Pcs', 'Weight (kg)', ''].map((h, i) => (
                    <TableCell key={h} align={[2, 3].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {circles.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ minWidth: 260 }}>
                      <Autocomplete
                        size="small" options={circleSkus} value={c.sku} onChange={(_, v) => setC(i, 'sku', v)}
                        getOptionLabel={(o) => (o ? `${o.skuCode} — ${o.skuName}` : '')}
                        isOptionEqualToValue={(a, b) => a.skuId === b?.skuId}
                        renderOption={(props, o) => (<li {...props} key={o.skuId}><Box><Typography variant="body2" fontWeight={700}>{o.skuCode}</Typography><Typography variant="caption" color="text.secondary">{o.skuName}</Typography></Box></li>)}
                        renderInput={(p) => <TextField {...p} placeholder="Search circle…" />}
                      />
                    </TableCell>
                    <TableCell sx={{ width: 200 }}><TextField size="small" value={c.sizeLabel} onChange={(e) => setC(i, 'sizeLabel', e.target.value)} placeholder='e.g. Cu - 0.8mm - 8.50"' fullWidth /></TableCell>
                    <TableCell align="right" sx={{ width: 110 }}><TextField size="small" type="number" value={c.pcs} onChange={(e) => setC(i, 'pcs', e.target.value)} inputProps={{ min: 0, style: { textAlign: 'right' } }} /></TableCell>
                    <TableCell align="right" sx={{ width: 120 }}><TextField size="small" type="number" value={c.weightKg} onChange={(e) => setC(i, 'weightKg', e.target.value)} inputProps={{ min: 0, style: { textAlign: 'right' } }} /></TableCell>
                    <TableCell><IconButton size="small" onClick={() => delC(i)} disabled={circles.length === 1}><X size={15} /></IconButton></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <Button size="small" startIcon={<Plus size={15} />} onClick={addC} sx={{ mt: 1 }}>Add circle</Button>

          {/* Live yield summary */}
          <Stack direction="row" spacing={1.5} sx={{ mt: 2, flexWrap: 'wrap' }} useFlexGap alignItems="center">
            <Chip label={`Coil: ${num(coilWt)} kg`} sx={{ fontWeight: 700 }} />
            <Chip label={`Circles: ${num(circlesWeight)} kg`} sx={{ fontWeight: 700, bgcolor: alpha(theme.palette.info.main, 0.12), color: theme.palette.info.dark }} />
            <Chip label={`Scrap: ${num(scrap)} kg`} sx={{ fontWeight: 700, bgcolor: alpha(theme.palette.warning.main, 0.14), color: theme.palette.warning.dark }} />
            <Chip label={`Yield: ${num(yieldPct)}%`} sx={{ fontWeight: 800, bgcolor: alpha(theme.palette.success.main, 0.14), color: theme.palette.success.dark }} />
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" onClick={submit} disabled={isLoading} startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={16} />}>
              {isLoading ? 'Saving…' : 'Save conversion'}
            </Button>
          </Stack>
          {scrap < 0 && <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>Circle weight exceeds coil weight — check the numbers.</Typography>}
        </Paper>

        {/* History */}
        <Paper elevation={0} sx={{ borderRadius: '14px', border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', flexWrap: 'wrap' }} useFlexGap>
            <Typography sx={{ fontWeight: 800, fontSize: '0.8rem', textTransform: 'uppercase', color: 'text.secondary' }}>Scrap summary</Typography>
            <Box sx={{ flex: 1 }} />
            {totals.coilKg != null && <Chip size="small" label={`Coil ${num(totals.coilKg)} kg`} />}
            {totals.circlesKg != null && <Chip size="small" label={`Circles ${num(totals.circlesKg)} kg`} />}
            {totals.scrapKg != null && <Chip size="small" label={`Scrap ${num(totals.scrapKg)} kg`} />}
            {totals.avgYield != null && <Chip size="small" color="success" label={`Avg yield ${num(totals.avgYield)}%`} />}
          </Stack>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 880 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  {['Date', 'Batch / No.', 'Coil', 'Coil kg', 'Circles kg', 'Scrap kg', 'Yield', 'Verified'].map((h, i) => (
                    <TableCell key={h} align={[3, 4, 5].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {conversions.length === 0 && (
                  <TableRow><TableCell colSpan={8} sx={{ textAlign: 'center', py: 3, color: 'text.disabled' }}>No conversions yet.</TableCell></TableRow>
                )}
                {conversions.map((c) => (
                  <TableRow key={c._id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{dayjs(c.conversionDate).format('DD MMM YY')}</TableCell>
                    <TableCell><Typography variant="body2" fontWeight={600}>{c.batchNo || '—'}</Typography><Typography variant="caption" color="text.secondary">{c.conversionNumber}</Typography></TableCell>
                    <TableCell><Typography variant="body2" noWrap title={c.coilSkuName}>{c.coilSkuCode}</Typography></TableCell>
                    <TableCell align="right">{num(c.coilWeightKg)}</TableCell>
                    <TableCell align="right">{num(c.circlesWeightKg)}</TableCell>
                    <TableCell align="right">{num(c.scrapKg)}</TableCell>
                    <TableCell><Chip size="small" label={`${num(c.yieldRatioPct)}%`} sx={{ fontWeight: 800, bgcolor: alpha(theme.palette.success.main, 0.12), color: theme.palette.success.dark }} /></TableCell>
                    <TableCell><Chip size="small" variant="outlined" label={c.scrapVerified} sx={{ height: 20, fontSize: '0.6rem' }} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default RmImsConversion;
