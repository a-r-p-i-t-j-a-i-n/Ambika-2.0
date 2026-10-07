import React, { useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, MenuItem, Button, CircularProgress, Chip,
  Switch, FormControlLabel, Alert,
} from '@mui/material';
import { ArrowUpFromLine, Save, Info, AlertTriangle } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import dayjs from 'dayjs';
import {
  ScrapShell, Panel, StepHead, newRequestId,
  SCRAP_OUT_REASON_OPTIONS, SCRAP_WAREHOUSE_OPTIONS, DEFAULT_SCRAP_WAREHOUSE,
  O2D, STOCK_TOKENS, num, IMS_FORM_MAX, noSpinnerSx,
} from './scrapImsMeta';
import { SCRAP_QTY_UNITS, SCRAP_QTY_UNIT_OPTIONS, readScrapQuantity, stepFor, fmtEntered } from './scrapUom';
import ScrapBuyerPicker from './ScrapBuyerPicker';
import ScrapOutHistory from './ScrapOutHistory';
import { useGetScrapStockQuery, useScrapOutMutation } from '../../store/api/scrapImsApi';

const helperSx = { fontSize: '0.66rem', color: O2D.sub, mx: 0 };

/**
 * Scrap Out — scrap sold, dumped or moved off site.
 *
 * The available figure is shown before anything is typed, and an over-issue is
 * blocked in the form as well as on the server. The server check is the real
 * one — it reads the balance inside the transaction, so a colleague issuing at
 * the same moment cannot slip between this screen's check and the write.
 *
 * WHO IT WENT TO. A sale names its buyer from the Scrap Buyer master — picked,
 * or added on the spot — and the server records the buyer's details as they
 * stand in the master. Every other reason keeps the optional free-text
 * "Issued to", which for a transfer names a site rather than a buyer.
 *
 * HOW MUCH. Entered in KG, Quintal or Ton, the way the weighbridge slip reads.
 * Stock is kept in KG, so the figure is converted to KG on screen at once and
 * every check — "is there enough?", the after-balance — runs on that KG figure.
 */
const ScrapImsStockOut = () => {
  const { data: stockRes } = useGetScrapStockQuery();
  const stock = stockRes?.data;
  const [scrapOut, { isLoading }] = useScrapOutMutation();

  const [form, setForm] = useState({
    date: dayjs().format('YYYY-MM-DD'),
    quantity: '',
    uom: 'KG',
    warehouse: DEFAULT_SCRAP_WAREHOUSE,
    reason: 'SALE',
    customReason: '',
    buyer: null,
    partyName: '',
    reference: '',
    remarks: '',
    allowNegative: false,
  });
  const [requestId, setRequestId] = useState(newRequestId);
  // Bumped on every save so the history below goes back to page 1, where the
  // new row lands. The refetch itself comes from the mutation's tags.
  const [savedCount, setSavedCount] = useState(0);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const isSale = form.reason === 'SALE';
  const q = readScrapQuantity(form.quantity, form.uom);
  const kg = q.ok ? q.kg : 0;
  const hasQty = q.ok;
  const unit = SCRAP_QTY_UNITS[form.uom];
  const needsCustomReason = form.reason === 'OTHER' && !form.customReason.trim();
  const needsBuyer = isSale && !form.buyer;

  const activeReason = SCRAP_OUT_REASON_OPTIONS.find((r) => r.value === form.reason);
  const activeWarehouse = SCRAP_WAREHOUSE_OPTIONS.find((w) => w.value === form.warehouse);
  const onHand = Number(
    stock?.byWarehouse?.find((w) => w.warehouse === form.warehouse)?.qtyOnHand || 0,
  );

  const over = hasQty && kg > onHand;
  const blocked = over && !form.allowNegative;
  const ready = hasQty && !needsCustomReason && !needsBuyer && !blocked;

  const submit = async () => {
    if (!hasQty) return enqueueSnackbar(q.error || 'Enter how much scrap is going out.', { variant: 'warning' });
    if (needsCustomReason) return enqueueSnackbar('Custom Reason is required when Reason is Other.', { variant: 'warning' });
    if (needsBuyer) return enqueueSnackbar('Choose who the scrap was sold to.', { variant: 'warning' });
    if (blocked) return enqueueSnackbar('That is more scrap than is on hand. Lower the quantity, or allow a negative balance.', { variant: 'warning' });
    try {
      const res = await scrapOut({
        date: form.date,
        quantity: Number(form.quantity),
        uom: form.uom,
        warehouse: form.warehouse,
        reason: form.reason,
        customReason: form.reason === 'OTHER' ? form.customReason.trim() : undefined,
        // A sale names its buyer by master id; the server records the name.
        buyerId: isSale ? form.buyer?._id : undefined,
        partyName: !isSale ? (form.partyName.trim() || undefined) : undefined,
        reference: form.reference || undefined,
        remarks: form.remarks || undefined,
        allowNegative: form.allowNegative,
        clientRequestId: requestId,
      }).unwrap();

      if (res?.data?.duplicate) {
        enqueueSnackbar('Already recorded — this entry was submitted twice, so the scrap was not deducted again.', { variant: 'info' });
      } else {
        const line = res?.data?.results?.[0];
        const outKg = line?.quantityKg ?? kg;
        const typed = form.uom !== 'KG' ? ` (${fmtEntered(form.quantity, form.uom)} ${unit.label})` : '';
        enqueueSnackbar(
          `${num(outKg)} kg${typed} issued from ${form.warehouse}${isSale && form.buyer ? ` to ${form.buyer.name}` : ''}`
          + `${line?.balanceAfter != null ? ` — now ${num(line.balanceAfter)} kg` : ''}.`,
          { variant: 'success' },
        );
      }
      setForm((f) => ({
        ...f, quantity: '', buyer: null, partyName: '', reference: '', remarks: '', customReason: '', allowNegative: false,
      }));
      setRequestId(newRequestId());
      setSavedCount((n) => n + 1);
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not issue the scrap.', { variant: 'error' });
    }
  };

  const qtyHelper = !q.empty && !q.ok ? q.error
    : blocked ? `${num(kg)} kg is more than the ${num(onHand)} kg on hand at ${form.warehouse}.`
      : hasQty && form.uom !== 'KG' ? `= ${num(kg)} kg`
        : 'Decimals are fine — a part load is a normal entry.';

  return (
    <ScrapShell
      icon={ArrowUpFromLine}
      title="Scrap Out — take scrap off the books"
      subtitle="Record scrap that was sold, disposed of or moved out. On-hand goes down and the movement is logged against your name."
      maxWidth={IMS_FORM_MAX}
    >
      {/* The form in its own column, so the sticky confirm bar (step 4) stops
          at the end of the form instead of floating over the history below. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minWidth: 0, '& > *': { minWidth: 0 } }}>
        <Paper elevation={0} sx={{ borderRadius: '8px', px: 1.5, py: 1, border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt }}>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <Box sx={{ color: O2D.brand, display: 'flex', pt: 0.15 }}><Info size={15} /></Box>
            <Typography sx={{ fontSize: '0.73rem', color: O2D.body }}>
              This records the <b>quantity</b> that left, not what it fetched. There is no scrap rate anywhere in the
              source data, so scrap is not valued here — record the sale value in the sale document and put its number
              in <b>Reference</b> so the two can be tied together.
            </Typography>
          </Stack>
        </Paper>

        {/* ── Step 1 ── */}
        <Panel>
          <StepHead n={1} title="Issue details" hint="When the scrap left, why, and from where." done={!!form.date} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 1.25, mt: 1.25 }}>
            <TextField
              size="small" type="date" label="Date issued" value={form.date}
              onChange={(e) => set('date', e.target.value)}
              InputLabelProps={{ shrink: true }}
              inputProps={{ max: dayjs().format('YYYY-MM-DD') }}
            />
            <TextField
              select size="small" label="Reason" value={form.reason}
              onChange={(e) => set('reason', e.target.value)}
              helperText={activeReason?.hint}
              FormHelperTextProps={{ sx: helperSx }}
            >
              {SCRAP_OUT_REASON_OPTIONS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
            </TextField>
            <TextField
              select size="small" label="Taken from" value={form.warehouse}
              onChange={(e) => set('warehouse', e.target.value)}
              helperText={activeWarehouse?.hint}
              FormHelperTextProps={{ sx: helperSx }}
            >
              {SCRAP_WAREHOUSE_OPTIONS.map((w) => <MenuItem key={w.value} value={w.value}>{w.label}</MenuItem>)}
            </TextField>

            {form.reason === 'OTHER' && (
              <TextField
                size="small" label="Custom Reason" value={form.customReason}
                onChange={(e) => set('customReason', e.target.value)}
                placeholder="Say where this scrap went"
                error={needsCustomReason}
                inputProps={{ maxLength: 200 }}
                helperText={needsCustomReason
                  ? 'Custom Reason is required when Reason is Other.'
                  : 'Saved as a custom reason and shown in the ledger.'}
                FormHelperTextProps={{ sx: helperSx }}
              />
            )}
          </Box>
        </Panel>

        {/* ── Step 2 ── */}
        <Panel>
          <StepHead
            n={2}
            title={isSale ? 'Buyer / sale details' : 'Who it went to'}
            hint={isSale ? 'Who bought the scrap, and the sale paperwork.' : 'Optional — the site, contractor or person it went to.'}
            done={isSale ? !!form.buyer : true}
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 1.25, mt: 1.25, alignItems: 'start' }}>
            {isSale ? (
              <ScrapBuyerPicker
                value={form.buyer}
                onChange={(b) => set('buyer', b)}
                error={false}
              />
            ) : (
              <TextField
                size="small" label="Issued to (optional)" value={form.partyName}
                onChange={(e) => set('partyName', e.target.value)}
                placeholder="Site / contractor / person"
                inputProps={{ maxLength: 200 }}
                helperText="Stored as its own field, so the ledger can be searched by it later."
                FormHelperTextProps={{ sx: helperSx }}
              />
            )}
            <TextField
              size="small" label="Reference (optional)" value={form.reference}
              onChange={(e) => set('reference', e.target.value)}
              placeholder={isSale ? 'Sale invoice / bill no.' : 'Gate pass / challan no.'}
              inputProps={{ maxLength: 120 }}
              helperText="The link between this movement and the paperwork."
              FormHelperTextProps={{ sx: helperSx }}
            />
          </Box>

          {isSale && form.buyer && (
            <Paper elevation={0} data-testid="selected-buyer" sx={{ mt: 1.25, px: 1.5, py: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt }}>
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: O2D.ink }}>
                {form.buyer.name}{form.buyer.code ? <Box component="span" sx={{ fontWeight: 600, color: O2D.sub }}> · {form.buyer.code}</Box> : null}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, columnGap: 2, rowGap: 0.25, mt: 0.5 }}>
                {[
                  ['Contact', form.buyer.contactPerson],
                  ['Phone', form.buyer.phone],
                  ['GSTIN', form.buyer.gstNo],
                  ['Address', [form.buyer.address, form.buyer.state].filter(Boolean).join(', ')],
                ].map(([k, v]) => (
                  <Typography key={k} sx={{ fontSize: '0.7rem', color: O2D.body }}>
                    <Box component="span" sx={{ color: O2D.sub }}>{k}: </Box>{v || '—'}
                  </Typography>
                ))}
              </Box>
            </Paper>
          )}
        </Panel>

        {/* ── Step 3 ── */}
        <Panel>
          <StepHead n={3} title="How much is going out?" hint={`Available at ${form.warehouse}: ${num(onHand)} kg.`} done={hasQty && !blocked} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 120px', sm: '180px 130px 1fr' }, gap: 1.25, mt: 1.25, alignItems: 'start' }}>
            <TextField
              size="small" type="number" label="Quantity" value={form.quantity}
              onChange={(e) => set('quantity', e.target.value)}
              sx={noSpinnerSx}
              inputProps={{ min: 0, step: stepFor(form.uom), 'data-testid': 'scrap-out-qty' }}
              error={(!q.empty && !q.ok) || blocked}
              helperText={qtyHelper}
              FormHelperTextProps={{ sx: { ...helperSx, color: (!q.empty && !q.ok) || blocked ? STOCK_TOKENS.OUT_OF_STOCK?.color || '#b91c1c' : O2D.sub, fontWeight: hasQty && form.uom !== 'KG' && !blocked ? 700 : 400 } }}
            />
            <TextField
              select size="small" label="Unit" value={form.uom}
              onChange={(e) => set('uom', e.target.value)}
              SelectProps={{ 'data-testid': 'scrap-out-uom' }}
              helperText={SCRAP_QTY_UNIT_OPTIONS.find((u) => u.value === form.uom)?.hint}
              FormHelperTextProps={{ sx: helperSx }}
            >
              {SCRAP_QTY_UNIT_OPTIONS.map((u) => <MenuItem key={u.value} value={u.value}>{u.label}</MenuItem>)}
            </TextField>
            <TextField
              size="small" label="Remarks (optional)" value={form.remarks}
              onChange={(e) => set('remarks', e.target.value)}
              placeholder="Anything worth knowing about this issue"
              inputProps={{ maxLength: 500 }}
              sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}
            />
          </Box>

          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
            <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>At {form.warehouse}:</Typography>
            <Chip size="small" label={`${num(onHand)} kg now`}
              sx={{ height: 22, fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.line}`, color: O2D.body }} />
            {hasQty && (
              <>
                <Typography sx={{ fontSize: '0.72rem', color: O2D.faint }}>→</Typography>
                <Chip size="small" label={`${num(onHand - kg)} kg after`}
                  sx={{
                    height: 22, fontWeight: 800, fontSize: '0.68rem', borderRadius: '999px',
                    bgcolor: over ? '#fee2e2' : O2D.surfaceAlt,
                    border: `1px solid ${over ? '#fecaca' : O2D.line}`,
                    color: over ? '#b91c1c' : O2D.body,
                  }} />
              </>
            )}
          </Stack>

          {over && (
            <Alert
              severity={form.allowNegative ? 'warning' : 'error'}
              icon={<AlertTriangle size={16} />}
              sx={{ mt: 1.5, borderRadius: '8px', fontSize: '0.74rem', alignItems: 'flex-start' }}
            >
              <b>
                {num(kg)} kg{form.uom !== 'KG' ? ` (${fmtEntered(form.quantity, form.uom)} ${unit.label})` : ''} is more than
                the {num(onHand)} kg recorded at {form.warehouse}.
              </b>
              {' '}
              {form.allowNegative
                ? 'You have allowed a negative balance, so this will be recorded and the balance will go below zero. Do this only when the recorded figure is genuinely behind reality — then correct it with a Scrap In.'
                : 'Either lower the quantity, or allow a negative balance below if the scrap really did leave and the recorded figure is behind.'}
            </Alert>
          )}
        </Panel>

        {/* ── Step 4 ── */}
        <Paper elevation={0} sx={{
          position: 'sticky', bottom: 12, zIndex: 4, borderRadius: '8px', px: 1.5, py: 1.15,
          border: `1px solid ${ready ? STOCK_TOKENS.OK.border : O2D.line}`,
          bgcolor: ready ? STOCK_TOKENS.OK.tint : O2D.surface,
          boxShadow: '0 6px 20px rgba(28,30,33,0.08)',
        }}>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
            <StepHead n={4} title="Confirm and save"
              hint={needsBuyer ? 'Choose who the scrap was sold to.'
                : blocked ? 'More scrap than is on hand.'
                  : ready ? 'Everything looks right.' : 'Enter a quantity above zero.'}
              done={ready} />
            <Stack direction="row" spacing={0.75} sx={{ ml: 'auto' }} flexWrap="wrap" useFlexGap alignItems="center">
              <FormControlLabel
                control={(
                  <Switch
                    size="small" checked={form.allowNegative}
                    onChange={(e) => set('allowNegative', e.target.checked)}
                  />
                )}
                label="Allow negative"
                sx={{ mr: 0.5, '& .MuiFormControlLabel-label': { fontSize: '0.72rem', color: O2D.sub, fontWeight: 600 } }}
              />
              {hasQty && (
                <Chip size="small" label={`${num(kg)} kg out`}
                  sx={{ height: 24, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', bgcolor: '#fee2e2', border: '1px solid #fecaca', color: '#b91c1c' }} />
              )}
              <Button
                variant="contained" disableElevation onClick={submit} disabled={isLoading || !ready}
                startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}
              >
                Issue scrap
              </Button>
            </Stack>
          </Stack>
        </Paper>
      </Box>

      <ScrapOutHistory refreshKey={savedCount} />
    </ScrapShell>
  );
};

export default ScrapImsStockOut;
