import React, { useState } from 'react';
import {
  Drawer, Stack, Typography, IconButton, TextField, MenuItem, Button, Skeleton, CircularProgress,
  Divider, Box, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { X, Save } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import { useGetFgPolicyQuery, useUpsertFgPolicyMutation } from '../../store/api/fgImsApi';
import { MODE_OPTIONS, FG_ACCENT } from './fgImsMeta';

/** Right-side drawer to edit a finished good's planning policy — seasonal demand
 *  (Off-season / Normal / Peak), safety factor, in-production & order book.
 *  Reused by the Stock/Master list and the Item detail page. */
const FgPolicyDrawer = ({ skuId, onClose }) => {
  const { data, isFetching } = useGetFgPolicyQuery(skuId, { skip: !skuId });
  const [save, { isLoading }] = useUpsertFgPolicyMutation();
  const [form, setForm] = useState(null);

  React.useEffect(() => {
    if (!skuId) { setForm(null); return; }
    // API envelope is { data: policy } — read the policy off `.data`.
    const p = data?.data || {};
    setForm({
      consumptionMode: p.consumptionMode ?? 'NORMAL',
      adcLow: p.adcLow ?? '',
      adcNormal: p.adcNormal ?? (p.averageDailyConsumption ?? ''),
      adcPeak: p.adcPeak ?? '',
      leadDays: p.leadDays ?? 7,
      safetyFactor: p.safetyFactor ?? 1.5,
      moq: p.moq ?? '',
      maxLevel: p.maxLevel ?? '',
      materialInTransit: p.materialInTransit ?? '',
      bookedQty: p.bookedQty ?? '',
      rate: p.rate ?? '',
      remarks: p.remarks ?? '',
    });
  }, [skuId, data]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const n = (v) => (v === '' || v === null ? undefined : Number(v));

  const activeAdc = form ? Number(
    { LOW: form.adcLow, NORMAL: form.adcNormal, PEAK: form.adcPeak }[form.consumptionMode] || form.adcNormal || 0,
  ) : 0;
  const derivedMax = form ? Math.round(activeAdc * Number(form.leadDays || 0) * Number(form.safetyFactor || 0)) : 0;

  const submit = async () => {
    try {
      await save({
        skuId,
        consumptionMode: form.consumptionMode,
        adcLow: n(form.adcLow), adcNormal: n(form.adcNormal), adcPeak: n(form.adcPeak),
        averageDailyConsumption: n(form.adcNormal),
        leadDays: n(form.leadDays), safetyFactor: n(form.safetyFactor),
        moq: n(form.moq), maxLevel: n(form.maxLevel),
        materialInTransit: n(form.materialInTransit), bookedQty: n(form.bookedQty),
        rate: n(form.rate), remarks: form.remarks || '',
      }).unwrap();
      enqueueSnackbar('Item policy saved.', { variant: 'success' });
      onClose();
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not save policy.', { variant: 'error' }); }
  };

  return (
    <Drawer anchor="right" open={!!skuId} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 440 }, p: 2.5 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>Finished-good planning policy</Typography>
        <IconButton onClick={onClose}><X size={18} /></IconButton>
      </Stack>
      {isFetching || !form ? <Skeleton variant="rounded" height={420} /> : (
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>Active demand season</Typography>
            <ToggleButtonGroup size="small" exclusive fullWidth value={form.consumptionMode}
              onChange={(_, v) => v && setForm((f) => ({ ...f, consumptionMode: v }))} sx={{ mt: 0.5 }}>
              {MODE_OPTIONS.map((o) => <ToggleButton key={o.value} value={o.value} sx={{ textTransform: 'none', fontWeight: 700 }}>{o.label}</ToggleButton>)}
            </ToggleButtonGroup>
          </Box>
          <Typography variant="caption" color="text.secondary">Average daily demand (units dispatched / day) by season</Typography>
          <Stack direction="row" spacing={1.5}>
            <TextField label="Off-season" type="number" size="small" fullWidth value={form.adcLow} onChange={set('adcLow')} />
            <TextField label="Normal" type="number" size="small" fullWidth value={form.adcNormal} onChange={set('adcNormal')} />
            <TextField label="Peak" type="number" size="small" fullWidth value={form.adcPeak} onChange={set('adcPeak')} />
          </Stack>
          <Divider flexItem />
          <Stack direction="row" spacing={1.5}>
            <TextField label="Production lead time (days)" type="number" size="small" fullWidth value={form.leadDays} onChange={set('leadDays')} />
            <TextField label="Safety factor" type="number" size="small" fullWidth value={form.safetyFactor} onChange={set('safetyFactor')} />
          </Stack>
          <Stack direction="row" spacing={1.5}>
            <TextField label="Min production batch (MOQ)" type="number" size="small" fullWidth value={form.moq} onChange={set('moq')} />
            <TextField label="Max level (target)" type="number" size="small" fullWidth value={form.maxLevel} onChange={set('maxLevel')}
              helperText={`Auto = demand×lead×SF = ${derivedMax || 0}`} />
          </Stack>
          <Stack direction="row" spacing={1.5}>
            <TextField label="In production (WIP)" type="number" size="small" fullWidth value={form.materialInTransit} onChange={set('materialInTransit')} />
            <TextField label="Booked (committed to orders)" type="number" size="small" fullWidth value={form.bookedQty} onChange={set('bookedQty')} />
          </Stack>
          <TextField label="Costing rate (₹ / unit)" type="number" size="small" value={form.rate} onChange={set('rate')}
            helperText="Used to value on-hand finished stock. Falls back to avg / RM cost." />
          <TextField label="Remarks" size="small" multiline minRows={2} value={form.remarks} onChange={set('remarks')} />
          <Button variant="contained" onClick={submit} disabled={isLoading}
            sx={{ bgcolor: FG_ACCENT, '&:hover': { bgcolor: '#047857' } }}
            startIcon={isLoading ? <CircularProgress size={15} color="inherit" /> : <Save size={16} />}>
            Save policy
          </Button>
          <Typography variant="caption" color="text.secondary">
            Leave Max level blank/0 to auto-use demand × lead × safety factor. In-stock quantity changes only via Production In / Dispatch Out.
          </Typography>
        </Stack>
      )}
    </Drawer>
  );
};

export default FgPolicyDrawer;
