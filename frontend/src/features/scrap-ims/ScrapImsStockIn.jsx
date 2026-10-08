import React, { useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, MenuItem, Button, CircularProgress, Chip,
} from '@mui/material';
import { ArrowDownToLine, Save, Info } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import dayjs from 'dayjs';
import {
  ScrapShell, Panel, StepHead, newRequestId,
  SCRAP_IN_REASON_OPTIONS, SCRAP_WAREHOUSE_OPTIONS, DEFAULT_SCRAP_WAREHOUSE, SCRAP_UOM,
  O2D, STOCK_TOKENS, num, IMS_FORM_MAX, noSpinnerSx,
} from './scrapImsMeta';
import { useGetScrapStockQuery, useScrapInMutation } from '../../store/api/scrapImsApi';

/**
 * Scrap In — scrap that reached the yard from somewhere other than a recorded
 * cut.
 *
 * ONE line, not a table. Every other IMS entry screen is a multi-line grid
 * because those modules stock hundreds of items; scrap is a single item in a
 * single unit, so a grid would be four columns of the same answer. The request
 * still travels the identical idempotent, transactional path on the server.
 */
const ScrapImsStockIn = () => {
  const { data: stockRes } = useGetScrapStockQuery();
  const stock = stockRes?.data;
  const [scrapIn, { isLoading }] = useScrapInMutation();

  const [form, setForm] = useState({
    date: dayjs().format('YYYY-MM-DD'),
    quantityKg: '',
    warehouse: DEFAULT_SCRAP_WAREHOUSE,
    reason: 'PRODUCTION_RETURN',
    customReason: '',
    partyName: '',
    reference: '',
    remarks: '',
  });

  // Minted once per filled-in form. The server recognises a replay of the same
  // id — a double-click, a retry, a second tab — and does not add the scrap
  // twice. A new id is taken only after a SUCCESSFUL save, so a corrected retry
  // of a failed submission is still accepted.
  const [requestId, setRequestId] = useState(newRequestId);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const qty = Number(form.quantityKg);
  const hasQty = qty > 0;
  const needsCustomReason = form.reason === 'OTHER' && !form.customReason.trim();
  const ready = hasQty && !needsCustomReason;

  const activeReason = SCRAP_IN_REASON_OPTIONS.find((r) => r.value === form.reason);
  const activeWarehouse = SCRAP_WAREHOUSE_OPTIONS.find((w) => w.value === form.warehouse);
  const onHand = Number(
    stock?.byWarehouse?.find((w) => w.warehouse === form.warehouse)?.qtyOnHand || 0,
  );

  const submit = async () => {
    if (!hasQty) return enqueueSnackbar('Enter how much scrap came in.', { variant: 'warning' });
    if (needsCustomReason) return enqueueSnackbar('Custom Reason is required when Reason is Other.', { variant: 'warning' });
    try {
      const res = await scrapIn({
        date: form.date,
        quantityKg: qty,
        warehouse: form.warehouse,
        reason: form.reason,
        customReason: form.reason === 'OTHER' ? form.customReason.trim() : undefined,
        partyName: form.partyName || undefined,
        reference: form.reference || undefined,
        remarks: form.remarks || undefined,
        clientRequestId: requestId,
      }).unwrap();

      if (res?.data?.duplicate) {
        enqueueSnackbar('Already recorded — this entry was submitted twice, so the scrap was not added again.', { variant: 'info' });
      } else {
        const bal = res?.data?.results?.[0]?.balanceAfter;
        enqueueSnackbar(
          `${num(qty)} kg added at ${form.warehouse}${bal != null ? ` — now ${num(bal)} kg` : ''}.`,
          { variant: 'success' },
        );
      }
      setForm((f) => ({ ...f, quantityKg: '', partyName: '', reference: '', remarks: '', customReason: '' }));
      setRequestId(newRequestId());
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not add the scrap.', { variant: 'error' });
    }
  };

  return (
    <ScrapShell
      icon={ArrowDownToLine}
      title="Scrap In — bring scrap into the yard"
      subtitle="For scrap that arrived some way other than a cut recorded here. On-hand goes up and the movement is logged against your name."
      maxWidth={IMS_FORM_MAX}
    >
      <Paper elevation={0} sx={{ borderRadius: '8px', px: 1.5, py: 1, border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt }}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Box sx={{ color: O2D.brand, display: 'flex', pt: 0.15 }}><Info size={15} /></Box>
          <Typography sx={{ fontSize: '0.73rem', color: O2D.body }}>
            Do <b>not</b> use this for offcuts from an in-house cut. Cutting a coil at PLG01 already adds its scrap
            to stock automatically, so entering it here as well would count the same metal twice. This screen is for
            scrap with no cut behind it — a job worker sending offcuts back, an opening count, or a correction.
          </Typography>
        </Stack>
      </Paper>

      {/* ── Step 1 ── */}
      <Panel>
        <StepHead n={1} title="Entry details" hint="When the scrap came in, and why." done={!!form.date} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 1.25, mt: 1.25 }}>
          <TextField
            size="small" type="date" label="Date received" value={form.date}
            onChange={(e) => set('date', e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ max: dayjs().format('YYYY-MM-DD') }}
          />
          <TextField
            select size="small" label="Reason" value={form.reason}
            onChange={(e) => set('reason', e.target.value)}
            helperText={activeReason?.hint}
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }}
          >
            {SCRAP_IN_REASON_OPTIONS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
          </TextField>
          <TextField
            select size="small" label="Held at" value={form.warehouse}
            onChange={(e) => set('warehouse', e.target.value)}
            helperText={activeWarehouse?.hint}
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }}
          >
            {SCRAP_WAREHOUSE_OPTIONS.map((w) => <MenuItem key={w.value} value={w.value}>{w.label}</MenuItem>)}
          </TextField>

          {form.reason === 'OTHER' && (
            <TextField
              size="small" label="Custom Reason" value={form.customReason}
              onChange={(e) => set('customReason', e.target.value)}
              placeholder="Say where this scrap came from"
              error={needsCustomReason}
              inputProps={{ maxLength: 200 }}
              helperText={needsCustomReason
                ? 'Custom Reason is required when Reason is Other.'
                : 'Saved as a custom reason and shown in the ledger.'}
              FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }}
            />
          )}

          <TextField
            size="small" label="Received from (optional)" value={form.partyName}
            onChange={(e) => set('partyName', e.target.value)}
            placeholder="Job worker / department"
            inputProps={{ maxLength: 200 }}
            helperText="Stored as its own field, so the ledger can be filtered by it later."
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }}
          />
          <TextField
            size="small" label="Reference (optional)" value={form.reference}
            onChange={(e) => set('reference', e.target.value)}
            placeholder="Gate pass / challan no."
            inputProps={{ maxLength: 120 }}
            helperText="Helps you trace this entry later in the ledger."
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }}
          />
        </Box>
      </Panel>

      {/* ── Step 2 ── */}
      <Panel>
        <StepHead n={2} title="How much came in?" hint={`Scrap is weighed, never counted — the figure is in ${SCRAP_UOM}.`} done={hasQty} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '220px 1fr' }, gap: 1.25, mt: 1.25, alignItems: 'start' }}>
          <TextField
            size="small" type="number" label={`Quantity (${SCRAP_UOM})`} value={form.quantityKg}
            onChange={(e) => set('quantityKg', e.target.value)}
            sx={noSpinnerSx}
            inputProps={{ min: 0, step: '0.01' }}
            error={form.quantityKg !== '' && !hasQty}
            helperText={form.quantityKg !== '' && !hasQty
              ? 'Quantity must be more than zero.'
              : 'Decimals are fine — 447.5 kg is a valid weight.'}
            FormHelperTextProps={{ sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0 } }}
          />
          <TextField
            size="small" label="Remarks (optional)" value={form.remarks}
            onChange={(e) => set('remarks', e.target.value)}
            placeholder="Anything worth knowing about this scrap"
            inputProps={{ maxLength: 500 }}
          />
        </Box>

        {/* The one number that tells the operator whether they got it right. */}
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
          <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>At {form.warehouse}:</Typography>
          <Chip size="small" label={`${num(onHand)} kg now`}
            sx={{ height: 22, fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
          {hasQty && (
            <>
              <Typography sx={{ fontSize: '0.72rem', color: O2D.faint }}>→</Typography>
              <Chip size="small" label={`${num(onHand + qty)} kg after`}
                sx={{ height: 22, fontWeight: 800, fontSize: '0.68rem', borderRadius: '999px', bgcolor: STOCK_TOKENS.OK.bg, border: `1px solid ${STOCK_TOKENS.OK.border}`, color: STOCK_TOKENS.OK.color }} />
            </>
          )}
        </Stack>
      </Panel>

      {/* ── Step 3 ── */}
      <Paper elevation={0} sx={{
        position: 'sticky', bottom: 12, zIndex: 4, borderRadius: '8px', px: 1.5, py: 1.15,
        border: `1px solid ${ready ? STOCK_TOKENS.OK.border : O2D.line}`,
        bgcolor: ready ? STOCK_TOKENS.OK.tint : O2D.surface,
        boxShadow: '0 6px 20px rgba(28,30,33,0.08)',
      }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <StepHead n={3} title="Confirm and save"
            hint={ready ? 'Everything looks right.' : 'Enter a quantity above zero.'}
            done={ready} />
          <Stack direction="row" spacing={0.75} sx={{ ml: 'auto' }} flexWrap="wrap" useFlexGap alignItems="center">
            {hasQty && (
              <Chip size="small" label={`${num(qty)} kg in`}
                sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: STOCK_TOKENS.OK.bg, border: `1px solid ${STOCK_TOKENS.OK.border}`, color: STOCK_TOKENS.OK.color }} />
            )}
            <Button
              variant="contained" disableElevation onClick={submit} disabled={isLoading || !ready}
              startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}
            >
              Add scrap
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </ScrapShell>
  );
};

export default ScrapImsStockIn;
