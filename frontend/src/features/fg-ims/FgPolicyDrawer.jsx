import React, { useState } from 'react';
import {
  Drawer, Box, Paper, Stack, Typography, IconButton, TextField, Button, Skeleton,
  CircularProgress, Divider, FormControlLabel, Switch, Alert, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { X, Save, Calculator } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import { useGetFgPolicyQuery, useUpsertFgPolicyMutation } from '../../store/api/fgImsApi';
import { MODE_OPTIONS, FG_ACCENT, FG_ACCENT_DARK, O2D, STOCK_TOKENS, Eyebrow, num } from './fgImsMeta';

const helperSx = { sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0, mt: 0.4 } };

// FG's own Safety Factor range — deliberately NOT the Consumables IMS's bounded
// 1.0–5.0 / 0.1-step rule (PolicyDrawer.jsx / ims.validation.js): finished-goods
// planning needs room for wide seasonal cover, so the only rule is "0 or more",
// same as the backend Joi schema (fgIms.validation.js). Mirrored here for the
// fast answer; the server re-checks.
const SF_MIN = 0;

/** @returns {string} an error message, or '' when the value is a valid Safety Factor. */
const safetyFactorError = (raw) => {
  if (raw === '' || raw === null || raw === undefined) return 'Safety Factor is required.';
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'Enter a number.';
  if (n < SF_MIN) return `Must be ${SF_MIN} or greater.`;
  return '';
};

/** Right-side drawer to edit a finished good's planning policy — seasonal demand
 *  (Off-season / Normal / Peak), safety factor, in-production & order book.
 *  Reused by the Stock/Master list and the Item detail page.
 *
 *  Same chrome as the Consumables planning drawer — white header bar, sectioned
 *  body, live calculation preview, sticky save — so the two never feel like two
 *  different products. The FIELDS are finished-goods only. */
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
      // Resolved by the server: 'MANUAL' only when the stored Max Level is a
      // genuine override. Anything else follows Demand × Lead Time × Safety Factor.
      maxLevelMode: p.maxLevelMode === 'MANUAL' ? 'MANUAL' : 'AUTO',
      materialInTransit: p.materialInTransit ?? '',
      bookedQty: p.bookedQty ?? '',
      rate: p.rate ?? '',
      remarks: p.remarks ?? '',
    });
  }, [skuId, data]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const n = (v) => (v === '' || v === null ? undefined : Number(v));
  const r2 = (v) => Math.round(v * 100) / 100;

  // Average Daily Demand for the season currently selected — a planned figure the
  // planner types, never a measured one.
  const activeDemand = form ? Number(
    { LOW: form.adcLow, NORMAL: form.adcNormal, PEAK: form.adcPeak }[form.consumptionMode] || form.adcNormal || 0,
  ) : 0;
  const lead = Number(form?.leadDays || 0);
  // Mirrors the server's own fallback (fgIms.service deriveMetrics), so the panel
  // below can never promise a level the server would not actually compute.
  const sf = Number(form?.safetyFactor || 1.5);

  // The planning numbers, exactly as fgIms.service computes them.
  const leadTimeDemand = r2(activeDemand * lead);   // Reorder At — no Safety Factor in it
  const formulaMax = r2(activeDemand * lead * sf);  // Max Level = Demand × Lead Time × SF
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
        consumptionMode: form.consumptionMode,
        adcLow: n(form.adcLow), adcNormal: n(form.adcNormal), adcPeak: n(form.adcPeak),
        averageDailyConsumption: n(form.adcNormal),
        leadDays: n(form.leadDays), safetyFactor: n(form.safetyFactor),
        moq: n(form.moq),
        // AUTO clears the stored figure, which is this module's long-standing
        // "blank means follow the formula" rule — so the Safety Factor bites and
        // an old override can never quietly reassert itself later.
        maxLevel: manual ? n(form.maxLevel) : 0,
        maxLevelMode: manual ? 'MANUAL' : 'AUTO',
        materialInTransit: n(form.materialInTransit), bookedQty: n(form.bookedQty),
        rate: n(form.rate), remarks: form.remarks || '',
      }).unwrap();
      enqueueSnackbar('Planning policy saved.', { variant: 'success' });
      onClose();
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not save policy.', { variant: 'error' }); }
  };

  return (
    <Drawer anchor="right" open={!!skuId} onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 430 }, bgcolor: O2D.canvas, display: 'flex', flexDirection: 'column' } }}>
      {/* Header — same flush white bar as every IMS screen. */}
      <Stack direction="row" alignItems="center" spacing={1}
        sx={{ px: 1.75, py: 1.15, bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}` }}>
        <Box sx={{ minWidth: 0, mr: 'auto' }}>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.2 }}>Planning policy</Typography>
          <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>Tells IMS when to flag this item for production and how much to make.</Typography>
        </Box>
        <IconButton onClick={onClose} size="small" sx={{ color: O2D.sub }}><X size={17} /></IconButton>
      </Stack>

      <Box sx={{ p: 1.5, overflowY: 'auto', flex: 1 }}>
        {isFetching || !form ? <Skeleton variant="rounded" height={380} /> : (
          <Stack spacing={1.25}>
            {/* ── Seasonal demand — the finished-goods-only part of the policy ── */}
            <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
              <Eyebrow>Average Daily Demand, by season</Eyebrow>
              <Typography sx={{ fontSize: '0.68rem', color: O2D.sub, mt: 0.5 }}>
                Units expected to be dispatched per day. Planned figures, set by hand — not measured from the ledger.
              </Typography>
              <ToggleButtonGroup size="small" exclusive fullWidth value={form.consumptionMode}
                onChange={(_, v) => v && setForm((f) => ({ ...f, consumptionMode: v }))}
                sx={{
                  mt: 1.25,
                  '& .MuiToggleButton-root': {
                    textTransform: 'none', fontWeight: 700, fontSize: '0.74rem', py: 0.4,
                    borderColor: O2D.line, color: O2D.body,
                    '&.Mui-selected': { bgcolor: FG_ACCENT, color: '#fff', '&:hover': { bgcolor: FG_ACCENT_DARK } },
                  },
                }}>
                {MODE_OPTIONS.map((o) => <ToggleButton key={o.value} value={o.value}>{o.label}</ToggleButton>)}
              </ToggleButtonGroup>
              <Typography sx={{ fontSize: '0.66rem', color: O2D.faint, mt: 0.6 }}>
                The season picked here is the one every level on this item is calculated from.
              </Typography>
              <Stack direction="row" spacing={1.25} sx={{ mt: 1.25 }}>
                <TextField label="Off-season" type="number" size="small" fullWidth value={form.adcLow} onChange={set('adcLow')} />
                <TextField label="Normal" type="number" size="small" fullWidth value={form.adcNormal} onChange={set('adcNormal')} />
                <TextField label="Peak" type="number" size="small" fullWidth value={form.adcPeak} onChange={set('adcPeak')} />
              </Stack>
            </Paper>

            <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
              <Eyebrow>The numbers that drive everything</Eyebrow>
              <Stack spacing={1.5} sx={{ mt: 1.25 }}>
                <TextField label="Lead Time (Production)" type="number" size="small" fullWidth
                  value={form.leadDays} onChange={set('leadDays')}
                  helperText="Days to produce a batch, from starting the run to stock being ready."
                  FormHelperTextProps={helperSx} />
                <TextField label="Safety Factor" type="number" size="small" fullWidth
                  value={form.safetyFactor} onChange={set('safetyFactor')}
                  error={!!sfError}
                  inputProps={{ min: SF_MIN, step: 0.1 }}
                  helperText={sfError || 'Cushion for demand spikes and production delays. 1.5 keeps 50% extra. No upper limit — finished goods need room for wide seasonal cover.'}
                  FormHelperTextProps={sfError ? undefined : helperSx} />
              </Stack>
            </Paper>

            {/* Live arithmetic — the levels these three numbers produce, shown
                before the planner commits to them. */}
            <Paper elevation={0} sx={{
              p: 1.5, borderRadius: '8px',
              border: `1px solid ${STOCK_TOKENS.OK.border}`, bgcolor: STOCK_TOKENS.OK.tint,
            }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
                <Box sx={{ color: STOCK_TOKENS.OK.color, display: 'flex' }}><Calculator size={15} /></Box>
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: STOCK_TOKENS.OK.color }}>What this works out to</Typography>
              </Stack>
              {activeDemand > 0 && lead > 0 && sf > 0 ? (
                <Stack spacing={0.4}>
                  <Typography sx={{ fontSize: '0.74rem', color: O2D.body }}>
                    <b>Reorder At {num(leadTimeDemand)}</b> — {num(activeDemand)} per day × {num(lead)} days.
                    {' '}No Safety Factor here, so changing it never moves this number.
                  </Typography>
                  <Typography sx={{ fontSize: '0.74rem', color: O2D.body }}>
                    <b>Max Level {num(effectiveMax)}</b> — {manual
                      ? 'entered by hand below; the formula is overridden.'
                      : `${num(activeDemand)} per day × ${num(lead)} days × ${num(sf)} safety.`}
                  </Typography>
                  <Typography sx={{ fontSize: '0.74rem', color: O2D.body }}>
                    <b>Safety Stock {num(safetyStock)}</b> — Max Level {num(effectiveMax)} − lead-time demand {num(leadTimeDemand)}.
                  </Typography>
                  <Typography sx={{ fontSize: '0.74rem', color: O2D.body }}>
                    This item lands on the Production Plan once Projected Available falls to {num(leadTimeDemand)},
                    with enough suggested to reach {num(effectiveMax)}.
                  </Typography>
                </Stack>
              ) : (
                <Typography sx={{ fontSize: '0.74rem', color: O2D.body }}>
                  Set the demand for this season, the Lead Time and the Safety Factor, and the levels they produce appear here.
                </Typography>
              )}
            </Paper>

            <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
              <Eyebrow>Production rules</Eyebrow>
              <Stack spacing={1.5} sx={{ mt: 1.25 }}>
                <TextField label="MOQ (Min Production Batch)" type="number" size="small" fullWidth
                  value={form.moq} onChange={set('moq')}
                  helperText="The smallest run worth producing. Leave blank if there is none."
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
                      : 'Calculated as Average Daily Demand × Lead Time × Safety Factor. Moves whenever you change the Safety Factor or the season\'s demand.')}
                    FormHelperTextProps={maxError ? undefined : helperSx} />
                  {manual && (
                    <Alert severity="warning" icon={false}
                      sx={{ mt: 0.75, py: 0.25, fontSize: '0.7rem', borderRadius: '6px', '& .MuiAlert-message': { py: 0.5 } }}>
                      Max Level is manually overridden. Changing Safety Factor will not affect this value.
                    </Alert>
                  )}
                </Box>
                <TextField label="In Production (WIP)" type="number" size="small" fullWidth
                  value={form.materialInTransit} onChange={set('materialInTransit')}
                  helperText="On the line now — counted towards what is available."
                  FormHelperTextProps={helperSx} />
              </Stack>
            </Paper>

            <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
              <Eyebrow>Order book &amp; costing</Eyebrow>
              <Stack spacing={1.5} sx={{ mt: 1.25 }}>
                <TextField label="Booked (Committed Orders)" type="number" size="small" fullWidth
                  value={form.bookedQty} onChange={set('bookedQty')}
                  helperText="Already promised to customer orders — subtracted from what is available to promise."
                  FormHelperTextProps={helperSx} />
                <TextField label="Costing Rate (₹ / unit)" type="number" size="small" fullWidth
                  value={form.rate} onChange={set('rate')}
                  helperText="Used to value on-hand finished stock. Falls back to avg / RM cost."
                  FormHelperTextProps={helperSx} />
              </Stack>
            </Paper>

            <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
              <Eyebrow>Notes</Eyebrow>
              <Stack spacing={1.5} sx={{ mt: 1.25 }}>
                <TextField label="Remarks" size="small" fullWidth multiline minRows={2}
                  value={form.remarks} onChange={set('remarks')} />
              </Stack>
            </Paper>

            <Divider sx={{ borderColor: O2D.lineSoft }} />
            <Typography sx={{ fontSize: '0.68rem', color: O2D.faint }}>
              Changing this policy never changes the stock itself — in-stock quantity moves only through Production In and Dispatch Out.
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
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: FG_ACCENT, '&:hover': { bgcolor: FG_ACCENT_DARK } }}>
            Save policy
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
};

export default FgPolicyDrawer;
