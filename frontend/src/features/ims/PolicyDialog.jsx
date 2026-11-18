import React, { useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, Button, Skeleton,
  CircularProgress, FormControlLabel, Switch, Alert, alpha,
} from '@mui/material';
import {
  Save, Calculator, SlidersHorizontal, ShoppingCart, StickyNote,
} from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import { O2D, STOCK_TOKENS, num } from './imsMeta';
import { useGetImsPolicyQuery, useUpsertImsPolicyMutation } from '../../store/api/imsApi';
// The same large centered dialog Register SKU / Edit SKU use (imported, not changed).
import SkuDialogShell from '../masters/SkuDialogShell';

const helperSx = { sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0, mt: 0.4 } };

// Safety Factor is per-SKU and bounded: below 1.0 the buffer would sit under the
// lead-time demand, above 5.0 is overstocking. Mirrors the Joi rule in
// backend ims.validation.js — the server re-checks, this is only the fast answer.
const SF_MIN = 1;
const SF_MAX = 5;
const SF_STEP = 0.1;

/** @returns {string} an error message, or '' when the value is a valid Safety Factor. */
const safetyFactorError = (raw) => {
  if (raw === '' || raw === null || raw === undefined) return 'Safety Factor is required.';
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'Enter a number.';
  if (n < SF_MIN || n > SF_MAX) return `Must be between ${SF_MIN.toFixed(1)} and ${SF_MAX.toFixed(1)}.`;
  // 1.2 / 0.1 is 11.999… in floating point, so compare to the nearest step.
  const steps = n / SF_STEP;
  if (Math.abs(steps - Math.round(steps)) > 1e-6) return 'Use steps of 0.1 — e.g. 1.0, 1.2, 1.5, 2.0.';
  return '';
};

/** A section card in the dialog body — the Register SKU form's section style. */
const FormSection = ({ icon, title, hint, children, tone }) => {
  const Icon = icon;
  return (
  <Paper sx={{
    p: 2.5, borderRadius: '14px',
    ...(tone ? { border: `1px solid ${tone.border}`, bgcolor: tone.tint, boxShadow: 'none' } : null),
  }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: hint ? 0.5 : 1.5 }}>
      <Box sx={(t) => ({
        width: 24, height: 24, borderRadius: '8px', display: 'grid', placeItems: 'center',
        bgcolor: tone ? alpha(tone.color, 0.12) : alpha(t.palette.primary.main, 0.10),
        color: tone ? tone.color : 'primary.main',
      })}>
        <Icon size={13} strokeWidth={2.5} />
      </Box>
      <Typography sx={{
        fontSize: '0.72rem', fontWeight: 700, color: tone ? tone.color : 'text.secondary',
        textTransform: 'uppercase', letterSpacing: '0.08em',
      }}>{title}</Typography>
    </Box>
    {hint && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>{hint}</Typography>}
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</Box>
  </Paper>
  );
};

/** One live figure in the bottom bar. */
const SummaryItem = ({ label, value, color = 'text.primary' }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
    <Typography variant="body2" fontWeight={800} color={color} noWrap sx={{ fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
  </Box>
);

/**
 * Edit an item's IMS planning policy — a large centered dialog in the Register
 * SKU style (it replaced the right-side Planning policy drawer). Used by Stock &
 * Master Data and the item page.
 *
 * Everything that decides what is saved is unchanged from the drawer: the same
 * fields, the same Safety Factor / manual Max Level checks, the same live
 * arithmetic (exactly as ims.service computes it) and the same PUT
 * /ims/policy/:skuId payload.
 *
 * @param skuId  the SKU being edited (the dialog is open while this is set)
 * @param item   optional { skuCode, skuName } for the header
 */
const PolicyDialog = ({ skuId, item, onClose }) => {
  const { data, isFetching } = useGetImsPolicyQuery(skuId, { skip: !skuId });
  const [save, { isLoading }] = useUpsertImsPolicyMutation();
  const [form, setForm] = useState(null);

  React.useEffect(() => {
    if (!skuId) { setForm(null); return; }
    // The query returns the API envelope { success, data: policy } — the policy
    // is `data.data` (as FgPolicyDrawer reads it). The drawer this replaced read
    // `data` itself, so it never prefilled: it always opened on the defaults
    // (ADC 0, Safety Factor 1.5, no MOQ / Max Level), and Save would then have
    // written those defaults over the item's real policy.
    const p = data?.data || {};
    setForm({
      // Read-only: measured from the CONSUME_OUT ledger, not editable here.
      calculatedAdc: p.calculatedAdc ?? 0,
      consumption90dDays: p.consumption90dDays ?? 90,
      leadDays: p.leadDays ?? 16,
      safetyFactor: p.safetyFactor ?? 1.5,
      moq: p.moq ?? '',
      maxLevel: p.maxLevel ?? '',
      // The server resolves this: 'MANUAL' only when the stored Max Level is a
      // genuine override (explicitly set, or a legacy value the formula cannot
      // explain). Anything else follows ADC × Lead Time × Safety Factor.
      maxLevelMode: p.maxLevelMode === 'MANUAL' ? 'MANUAL' : 'AUTO',
      materialInTransit: p.materialInTransit ?? '',
      // Read-only here: SKU master supplies it (falls back to the legacy policy copy).
      convertedItemNameForResale: p.convertedItemNameForResale ?? '',
      remarks: p.remarks ?? '',
    });
  }, [skuId, data]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const n = (v) => (v === '' || v === null ? undefined : Number(v));

  const adc = Number(form?.calculatedAdc || 0);
  const lead = Number(form?.leadDays || 0);
  const sf = Number(form?.safetyFactor || 0);
  const r2 = (v) => Math.round(v * 100) / 100;

  // The four planning numbers, exactly as ims.service computes them.
  const leadTimeDemand = r2(adc * lead);        // Reorder At — no Safety Factor in it
  const formulaMax = r2(adc * lead * sf);       // Max Level = ADC × Lead Time × SF
  const manual = form?.maxLevelMode === 'MANUAL';
  const storedMax = Number(form?.maxLevel || 0);
  const effectiveMax = manual && storedMax > 0 ? r2(storedMax) : formulaMax;
  const safetyStock = r2(Math.max(0, effectiveMax - leadTimeDemand));

  const sfError = form ? safetyFactorError(form.safetyFactor) : '';
  // A manual Max Level must actually carry a number, or the thresholds collapse.
  const maxError = manual && !(storedMax > 0) ? 'Enter a Max Level, or switch back to the calculated value.' : '';
  const blocked = !!sfError || !!maxError;

  const submit = async () => {
    if (blocked) { enqueueSnackbar(sfError || maxError, { variant: 'warning' }); return; }
    try {
      await save({
        skuId,
        leadDays: n(form.leadDays), safetyFactor: n(form.safetyFactor),
        moq: n(form.moq), maxLevel: n(form.maxLevel), materialInTransit: n(form.materialInTransit),
        maxLevelMode: manual ? 'MANUAL' : 'AUTO',
        // convertedItemName is deliberately not sent — the resale name is SKU
        // master data now, and omitting it leaves the legacy policy copy untouched.
        remarks: form.remarks || '',
      }).unwrap();
      // The mutation invalidates ImsOverview/ImsDashboard, so the Stock & Master
      // Data table re-reads the recalculated numbers — no browser refresh needed.
      enqueueSnackbar('Planning policy saved.', { variant: 'success' });
      onClose();
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not save the policy.', { variant: 'error' }); }
  };

  const loading = isFetching || !form;
  const subtitle = item?.skuCode || item?.skuName
    ? [item.skuCode, item.skuName].filter(Boolean).join(' · ')
    : 'Tells IMS when to warn you and how much to buy.';

  return (
    <SkuDialogShell
      open={!!skuId}
      onClose={onClose}
      testId="ims-policy-dialog"
      icon={SlidersHorizontal}
      title="Edit Planning Policy"
      subtitle={subtitle}
    >
      {/* ── Body (scrolls on its own) ───────────────────────────────────── */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: { xs: 2, sm: 3 }, py: 2.5 }} data-testid="ims-policy-body">
        {loading ? (
          <Stack spacing={2}>
            <Skeleton variant="rounded" height={170} />
            <Skeleton variant="rounded" height={220} />
          </Stack>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
            <Stack spacing={2} sx={{ minWidth: 0 }}>
              <FormSection icon={SlidersHorizontal} title="The numbers that drive everything"
                hint="These three numbers decide when IMS warns you and how much it suggests buying.">
                {/* Calculated, never typed. It comes from the CONSUME_OUT ledger,
                    so there is nothing to edit and no way to disagree with it. */}
                <TextField label="Average Daily Consumption" size="small" fullWidth
                  value={adc} InputProps={{ readOnly: true }}
                  helperText={`Calculated from the last ${form.consumption90dDays} days of actual consumption — not editable. Issue stock to change it.`}
                  FormHelperTextProps={helperSx} />
                <TextField label="Lead Time (From Indent to Receipt)" type="number" size="small" fullWidth
                  value={form.leadDays} onChange={set('leadDays')}
                  helperText="Days the vendor takes to deliver after you place the order."
                  FormHelperTextProps={helperSx} />
                <TextField label="Safety Factor" type="number" size="small" fullWidth
                  value={form.safetyFactor} onChange={set('safetyFactor')}
                  error={!!sfError}
                  inputProps={{ min: SF_MIN, max: SF_MAX, step: SF_STEP }}
                  helperText={sfError || `Cushion for demand spikes and late deliveries. ${SF_MIN.toFixed(1)}–${SF_MAX.toFixed(1)} in 0.1 steps; 1.5 keeps 50% extra. Set per item — this changes this item only.`}
                  FormHelperTextProps={sfError ? undefined : helperSx} />
              </FormSection>

              <FormSection icon={ShoppingCart} title="Buying rules">
                <TextField label="MOQ" type="number" size="small" fullWidth
                  value={form.moq} onChange={set('moq')}
                  helperText="The smallest quantity the supplier will accept. Leave blank if there is none."
                  FormHelperTextProps={helperSx} />
                {/* Max Level is formula-driven by default so the Safety Factor
                    actually bites. A deliberate override is opt-in, and the
                    dialog says plainly what that costs. */}
                <Box>
                  <FormControlLabel
                    sx={{ ml: 0 }}
                    control={(
                      <Switch size="small" checked={manual}
                        onChange={(e) => setForm((f) => ({ ...f, maxLevelMode: e.target.checked ? 'MANUAL' : 'AUTO' }))} />
                    )}
                    label={<Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: O2D.ink }}>Set Max Level manually</Typography>}
                  />
                  <TextField label="Max Level" type="number" size="small" fullWidth sx={{ mt: 0.75 }}
                    value={manual ? form.maxLevel : formulaMax} onChange={set('maxLevel')}
                    disabled={!manual} error={!!maxError}
                    inputProps={{ min: 0, step: 0.01 }}
                    helperText={maxError || (manual
                      ? 'Overrides the formula. This number stays put whatever the Safety Factor is.'
                      : 'Calculated as Average Daily Consumption × Lead Time × Safety Factor. Moves whenever you change the Safety Factor, or as consumption history shifts the ADC.')}
                    FormHelperTextProps={maxError ? undefined : helperSx} />
                  {manual && (
                    <Alert severity="warning" icon={false}
                      sx={{ mt: 0.75, py: 0.25, fontSize: '0.7rem', borderRadius: '6px', '& .MuiAlert-message': { py: 0.5 } }}>
                      Max Level is manually overridden. Changing Safety Factor will not affect this value.
                    </Alert>
                  )}
                </Box>
                <TextField label="Material In Transit" type="number" size="small" fullWidth
                  value={form.materialInTransit} onChange={set('materialInTransit')}
                  helperText="Ordered but not yet received — subtracted from what the buying list asks for."
                  FormHelperTextProps={helperSx} />
              </FormSection>
            </Stack>

            <Stack spacing={2} sx={{ minWidth: 0 }}>
              {/* Live arithmetic — the levels these numbers produce, shown
                  before the client commits to them. */}
              <FormSection icon={Calculator} title="What this works out to" tone={STOCK_TOKENS.OK}>
                {adc > 0 && lead > 0 && sf > 0 ? (
                  <Stack spacing={0.75} data-testid="ims-policy-live">
                    <Typography sx={{ fontSize: '0.78rem', color: O2D.body }}>
                      <b>Reorder at {num(leadTimeDemand)}</b> — {num(adc)} per day × {num(lead)} days.
                      {' '}No Safety Factor here, so changing it never moves this number.
                    </Typography>
                    <Typography sx={{ fontSize: '0.78rem', color: O2D.body }}>
                      <b>Max Level {num(effectiveMax)}</b> — {manual
                        ? 'entered by hand; the formula is overridden.'
                        : <>{num(adc)} per day × {num(lead)} days × {num(sf)} safety.</>}
                    </Typography>
                    <Typography sx={{ fontSize: '0.78rem', color: O2D.body }}>
                      <b>Safety Stock {num(safetyStock)}</b> — Max Level {num(effectiveMax)} − lead-time demand {num(leadTimeDemand)}.
                    </Typography>
                    <Typography sx={{ fontSize: '0.78rem', color: O2D.body }}>
                      IMS flags this item for buying the moment Closing Stock falls to {num(leadTimeDemand)},
                      and suggests ordering back up to {num(effectiveMax)}.
                    </Typography>
                  </Stack>
                ) : (
                  <Typography sx={{ fontSize: '0.78rem', color: O2D.body }} data-testid="ims-policy-live">
                    Once this item has consumption history, and Lead Time and Safety Factor are set, the levels they produce appear here.
                  </Typography>
                )}
              </FormSection>

              <FormSection icon={StickyNote} title="Notes">
                {/* SKU master data — shown here for context, edited in SKU Master
                    so there is exactly one place it can be changed. */}
                <TextField label="Converted Item Name (For Resale)" size="small" fullWidth
                  value={form.convertedItemNameForResale || '—'} InputProps={{ readOnly: true }}
                  helperText="Master data — set this in SKU Master."
                  FormHelperTextProps={helperSx} />
                <TextField label="Remarks" size="small" fullWidth multiline minRows={3}
                  value={form.remarks} onChange={set('remarks')} />
              </FormSection>

              <Typography sx={{ fontSize: '0.7rem', color: O2D.faint, px: 0.5 }}>
                Changing this policy never changes the stock itself — on-hand only moves through Stock In and Stock Out.
              </Typography>
            </Stack>
          </Box>
        )}
      </Box>

      {/* ── Fixed bottom action bar ─────────────────────────────────────── */}
      <Box sx={{
        flexShrink: 0, zIndex: 10,
        borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper',
        px: { xs: 2, sm: 3 }, py: 1.75,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap',
      }}>
        <Stack direction="row" spacing={2.5} sx={{ minWidth: 0, display: { xs: 'none', sm: 'flex' } }}>
          <SummaryItem label="Reorder at" value={loading ? '—' : num(leadTimeDemand)} color={STOCK_TOKENS.REORDER.color} />
          <SummaryItem label={manual ? 'Max Level (manual)' : 'Max Level'} value={loading ? '—' : num(effectiveMax)} color={STOCK_TOKENS.OK.color} />
          <SummaryItem label="Safety Stock" value={loading ? '—' : num(safetyStock)} />
        </Stack>
        <Stack direction="row" spacing={1.25} sx={{ ml: 'auto' }}>
          <Button variant="outlined" onClick={onClose} sx={{ minWidth: 110 }}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={isLoading || !form || blocked}
            startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
            sx={{ minWidth: 150 }}>
            Save policy
          </Button>
        </Stack>
      </Box>
    </SkuDialogShell>
  );
};

export default PolicyDialog;
