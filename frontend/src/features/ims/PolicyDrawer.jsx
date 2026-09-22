import React, { useState } from 'react';
import {
  Drawer, Box, Paper, Stack, Typography, IconButton, TextField, Button, Skeleton,
  CircularProgress, Divider, FormControlLabel, Switch, Alert,
} from '@mui/material';
import { X, Save, Calculator } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import { O2D, STOCK_TOKENS, Eyebrow, num } from './imsMeta';
import { useGetImsPolicyQuery, useUpsertImsPolicyMutation } from '../../store/api/imsApi';

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
              <Eyebrow>The numbers that drive everything</Eyebrow>
              <Stack spacing={1.5} sx={{ mt: 1.25 }}>
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
              {adc > 0 && lead > 0 && sf > 0 ? (
                <Stack spacing={0.4}>
                  <Typography sx={{ fontSize: '0.74rem', color: O2D.body }}>
                    <b>Reorder at {num(leadTimeDemand)}</b> — {num(adc)} per day × {num(lead)} days.
                    {' '}No Safety Factor here, so changing it never moves this number.
                  </Typography>
                  <Typography sx={{ fontSize: '0.74rem', color: O2D.body }}>
                    <b>Max Level {num(effectiveMax)}</b> — {manual
                      ? 'entered by hand below; the formula is overridden.'
                      : <>{num(adc)} per day × {num(lead)} days × {num(sf)} safety.</>}
                  </Typography>
                  <Typography sx={{ fontSize: '0.74rem', color: O2D.body }}>
                    <b>Safety Stock {num(safetyStock)}</b> — Max Level {num(effectiveMax)} − lead-time demand {num(leadTimeDemand)}.
                  </Typography>
                  <Typography sx={{ fontSize: '0.74rem', color: O2D.body }}>
                    IMS flags this item for buying the moment Closing Stock falls to {num(leadTimeDemand)},
                    and suggests ordering back up to {num(effectiveMax)}.
                  </Typography>
                </Stack>
              ) : (
                <Typography sx={{ fontSize: '0.74rem', color: O2D.body }}>
                  Once this item has consumption history, and Lead Time and Safety Factor are set, the levels they produce appear here.
                </Typography>
              )}
            </Paper>

            <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
              <Eyebrow>Buying rules</Eyebrow>
              <Stack spacing={1.5} sx={{ mt: 1.25 }}>
                <TextField label="MOQ" type="number" size="small" fullWidth
                  value={form.moq} onChange={set('moq')}
                  helperText="The smallest quantity the supplier will accept. Leave blank if there is none."
                  FormHelperTextProps={helperSx} />
                {/* Max Level is formula-driven by default so the Safety Factor
                    actually bites. A deliberate override is opt-in, and the
                    drawer says plainly what that costs. */}
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
              </Stack>
            </Paper>

            <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
              <Eyebrow>Notes</Eyebrow>
              <Stack spacing={1.5} sx={{ mt: 1.25 }}>
                {/* SKU master data — shown here for context, edited in SKU Master
                    so there is exactly one place it can be changed. */}
                <TextField label="Converted Item Name (For Resale)" size="small" fullWidth
                  value={form.convertedItemNameForResale || '—'} InputProps={{ readOnly: true }}
                  helperText="Master data — set this in SKU Master."
                  FormHelperTextProps={helperSx} />
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
          <Button fullWidth variant="contained" disableElevation disabled={isLoading || !form || blocked} onClick={submit}
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
