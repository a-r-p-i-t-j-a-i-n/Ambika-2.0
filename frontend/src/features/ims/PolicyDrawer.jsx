import React, { useState } from 'react';
import {
  Drawer, Box, Paper, Stack, Typography, IconButton, TextField, Button, Skeleton,
  CircularProgress, Divider,
} from '@mui/material';
import { X, Save, Calculator } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import { O2D, STOCK_TOKENS, Eyebrow, num } from './imsMeta';
import { useGetImsPolicyQuery, useUpsertImsPolicyMutation } from '../../store/api/imsApi';

const helperSx = { sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0, mt: 0.4 } };

/** Right-side drawer to edit an item's IMS planning policy. Reused by the Stock
 *  list and the Item detail page.
 *
 *  These four numbers are the whole engine behind the buying list, so the drawer
 *  explains each one in plain English AND shows the reorder point it produces —
 *  a client should never have to save a change to find out what it did. */
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
      enqueueSnackbar('Planning policy saved.', { variant: 'success' });
      onClose();
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not save the policy.', { variant: 'error' }); }
  };

  const adc = Number(form?.averageDailyConsumption || 0);
  const lead = Number(form?.leadDays || 0);
  const sf = Number(form?.safetyFactor || 0);
  const derived = Math.round(adc * lead * sf);
  const effectiveMax = Number(form?.maxLevel || 0) || derived;

  return (
    <Drawer anchor="right" open={!!skuId} onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 430 }, bgcolor: O2D.canvas, display: 'flex', flexDirection: 'column' } }}>
      {/* Header — same flush white bar as every IMS screen. */}
      <Stack direction="row" alignItems="center" spacing={1}
        sx={{ px: 1.75, py: 1.15, bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}` }}>
        <Box sx={{ minWidth: 0, mr: 'auto' }}>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.2 }}>Planning policy</Typography>
          <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>Tells IMS when to warn you and how much to buy.</Typography>
        </Box>
        <IconButton onClick={onClose} size="small" sx={{ color: O2D.sub }}><X size={17} /></IconButton>
      </Stack>

      <Box sx={{ p: 1.5, overflowY: 'auto', flex: 1 }}>
        {isFetching || !form ? <Skeleton variant="rounded" height={380} /> : (
          <Stack spacing={1.25}>
            <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
              <Eyebrow>The three numbers that drive everything</Eyebrow>
              <Stack spacing={1.5} sx={{ mt: 1.25 }}>
                <TextField label="Average daily use" type="number" size="small" fullWidth
                  value={form.averageDailyConsumption} onChange={set('averageDailyConsumption')}
                  helperText="How many units this item consumes on a normal day."
                  FormHelperTextProps={helperSx} />
                <TextField label="Lead time (days)" type="number" size="small" fullWidth
                  value={form.leadDays} onChange={set('leadDays')}
                  helperText="Days the vendor takes to deliver after you place the order."
                  FormHelperTextProps={helperSx} />
                <TextField label="Safety factor" type="number" size="small" fullWidth
                  value={form.safetyFactor} onChange={set('safetyFactor')}
                  helperText="Cushion for demand spikes and late deliveries. 1.5 keeps 50% extra."
                  FormHelperTextProps={helperSx} />
              </Stack>
            </Paper>

            {/* Live arithmetic — the reorder point these three numbers produce,
                shown before the client commits to them. */}
            <Paper elevation={0} sx={{
              p: 1.5, borderRadius: '8px',
              border: `1px solid ${STOCK_TOKENS.OK.border}`, bgcolor: STOCK_TOKENS.OK.tint,
            }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
                <Box sx={{ color: STOCK_TOKENS.OK.color, display: 'flex' }}><Calculator size={15} /></Box>
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: STOCK_TOKENS.OK.color }}>What this works out to</Typography>
              </Stack>
              <Typography sx={{ fontSize: '0.74rem', color: O2D.body }}>
                {adc > 0 && lead > 0 && sf > 0 ? (
                  <>
                    {num(adc)} per day × {num(lead)} days × {num(sf)} safety = <b>reorder at {num(derived)} units</b>.
                    {' '}IMS will flag this item for buying the moment on-hand falls to {num(derived)}, and will suggest
                    ordering back up to {num(effectiveMax)}.
                  </>
                ) : 'Fill in daily use, lead time and safety factor to see the reorder point this produces.'}
              </Typography>
            </Paper>

            <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
              <Eyebrow>Buying rules</Eyebrow>
              <Stack spacing={1.5} sx={{ mt: 1.25 }}>
                <TextField label="Minimum order quantity" type="number" size="small" fullWidth
                  value={form.moq} onChange={set('moq')}
                  helperText="The smallest quantity the supplier will accept. Leave blank if there is none."
                  FormHelperTextProps={helperSx} />
                <TextField label="Order up to (max level)" type="number" size="small" fullWidth
                  value={form.maxLevel} onChange={set('maxLevel')}
                  helperText={`Leave blank to use the calculated ${num(derived)}. Set a number to override it.`}
                  FormHelperTextProps={helperSx} />
                <TextField label="Material already in transit" type="number" size="small" fullWidth
                  value={form.materialInTransit} onChange={set('materialInTransit')}
                  helperText="Ordered but not yet received — subtracted from what the buying list asks for."
                  FormHelperTextProps={helperSx} />
              </Stack>
            </Paper>

            <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
              <Eyebrow>Notes</Eyebrow>
              <Stack spacing={1.5} sx={{ mt: 1.25 }}>
                <TextField label="Converted item name (for resale)" size="small" fullWidth
                  value={form.convertedItemName} onChange={set('convertedItemName')} />
                <TextField label="Remarks" size="small" fullWidth multiline minRows={2}
                  value={form.remarks} onChange={set('remarks')} />
              </Stack>
            </Paper>

            <Divider sx={{ borderColor: O2D.lineSoft }} />
            <Typography sx={{ fontSize: '0.68rem', color: O2D.faint }}>
              Changing this policy never changes the stock itself — on-hand only moves through Stock In and Stock Out.
            </Typography>
          </Stack>
        )}
      </Box>

      {/* Sticky save — always reachable, however long the form scrolls. */}
      <Box sx={{ p: 1.25, bgcolor: O2D.surface, borderTop: `1px solid ${O2D.line}` }}>
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 700, color: O2D.body }}>Cancel</Button>
          <Button fullWidth variant="contained" disableElevation disabled={isLoading || !form} onClick={submit}
            startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}>
            Save policy
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
};

export default PolicyDrawer;
