import React, { useState } from 'react';
import {
  Drawer, Stack, Typography, IconButton, TextField, Button, Skeleton, CircularProgress,
} from '@mui/material';
import { X, Save } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import { useGetImsPolicyQuery, useUpsertImsPolicyMutation } from '../../store/api/imsApi';

/** Right-side drawer to edit an item's IMS planning policy. Reused by the
 *  Stock list and the Item detail page. */
const PolicyDrawer = ({ skuId, onClose }) => {
  const { data, isFetching } = useGetImsPolicyQuery(skuId, { skip: !skuId });
  const [save, { isLoading }] = useUpsertImsPolicyMutation();
  const [form, setForm] = useState(null);

  React.useEffect(() => {
    if (!skuId) { setForm(null); return; }
    const p = data || {};
    setForm({
      averageDailyConsumption: p.averageDailyConsumption ?? '',
      leadDays: p.leadDays ?? 16,
      safetyFactor: p.safetyFactor ?? 1.5,
      moq: p.moq ?? '',
      maxLevel: p.maxLevel ?? '',
      materialInTransit: p.materialInTransit ?? '',
      convertedItemName: p.convertedItemName ?? '',
      remarks: p.remarks ?? '',
    });
  }, [skuId, data]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const n = (v) => (v === '' || v === null ? undefined : Number(v));

  const submit = async () => {
    try {
      await save({
        skuId,
        averageDailyConsumption: n(form.averageDailyConsumption),
        leadDays: n(form.leadDays), safetyFactor: n(form.safetyFactor),
        moq: n(form.moq), maxLevel: n(form.maxLevel), materialInTransit: n(form.materialInTransit),
        convertedItemName: form.convertedItemName || '', remarks: form.remarks || '',
      }).unwrap();
      enqueueSnackbar('Item policy saved.', { variant: 'success' });
      onClose();
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not save policy.', { variant: 'error' }); }
  };

  const derivedMax = form ? Math.round((Number(form.averageDailyConsumption || 0)) * (Number(form.leadDays || 0)) * (Number(form.safetyFactor || 0))) : 0;

  return (
    <Drawer anchor="right" open={!!skuId} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 420 }, p: 2.5 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>Item planning policy</Typography>
        <IconButton onClick={onClose}><X size={18} /></IconButton>
      </Stack>
      {isFetching || !form ? <Skeleton variant="rounded" height={360} /> : (
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Average daily consumption (ADC)" type="number" size="small" value={form.averageDailyConsumption} onChange={set('averageDailyConsumption')} />
          <Stack direction="row" spacing={1.5}>
            <TextField label="Lead time (days)" type="number" size="small" fullWidth value={form.leadDays} onChange={set('leadDays')} />
            <TextField label="Safety factor" type="number" size="small" fullWidth value={form.safetyFactor} onChange={set('safetyFactor')} />
          </Stack>
          <Stack direction="row" spacing={1.5}>
            <TextField label="MOQ" type="number" size="small" fullWidth value={form.moq} onChange={set('moq')} />
            <TextField label="Max level (order-up-to)" type="number" size="small" fullWidth value={form.maxLevel} onChange={set('maxLevel')}
              helperText={`Auto = ADC×lead×SF = ${derivedMax || 0}`} />
          </Stack>
          <TextField label="Material in transit" type="number" size="small" value={form.materialInTransit} onChange={set('materialInTransit')} />
          <TextField label="Converted item name (for resale)" size="small" value={form.convertedItemName} onChange={set('convertedItemName')} />
          <TextField label="Remarks" size="small" multiline minRows={2} value={form.remarks} onChange={set('remarks')} />
          <Button variant="contained" startIcon={isLoading ? <CircularProgress size={15} color="inherit" /> : <Save size={16} />} disabled={isLoading} onClick={submit}>
            Save policy
          </Button>
          <Typography variant="caption" color="text.secondary">
            Leave Max level blank/0 to auto-use ADC × lead × safety factor. On-hand stock is changed only via Stock-In / Stock-Out.
          </Typography>
        </Stack>
      )}
    </Drawer>
  );
};

export default PolicyDrawer;
