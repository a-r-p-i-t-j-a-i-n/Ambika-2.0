import React, { useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, FormControlLabel, InputAdornment, MenuItem, Skeleton,
  Stack, Switch, TextField, Typography,
} from '@mui/material';
import {
  Calculator, Gauge, Save, ShoppingCart, SlidersHorizontal, Timer, Truck,
} from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { FormSection, SummaryItem, uomOf, O2D, STOCK_TOKENS, num, inr } from './rmImsMeta';
import { useGetRmPolicyQuery, useUpsertRmPolicyMutation } from '../../store/api/rmImsApi';
// The same large centered dialog Register SKU / Edit SKU use (imported, not changed).
import SkuDialogShell from '../masters/SkuDialogShell';

const helperSx = { sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0, mt: 0.4 } };

// Safety Factor bounds — the same 1.0–5.0 in 0.1 steps that Consumables &
// Packaging uses and that rmPolicySchema enforces server-side. Below 1.0 the
// "safety" stock sits under the lead-time demand, which is a negative buffer.
const SF_MIN = 1;
const SF_MAX = 5;
const SF_STEP = 0.1;

/** '' when the value is a valid Safety Factor, otherwise the message to show. */
const safetyFactorError = (v) => {
  if (v === '' || v === null || v === undefined) return 'Safety Factor is required.';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'Enter a number.';
  if (n < SF_MIN || n > SF_MAX) return `Must be between ${SF_MIN.toFixed(1)} and ${SF_MAX.toFixed(1)}.`;
  // 1.2 / 0.1 is 11.999… in binary floating point, so compare against the
  // nearest whole step with a tolerance instead of using a modulo.
  const steps = n / SF_STEP;
  if (Math.abs(steps - Math.round(steps)) > 1e-6) return 'Use steps of 0.1 — e.g. 1.0, 1.2, 1.5, 2.0.';
  return '';
};

/**
 * The form's starting values — from the STORED policy (GET /rm-ims/policy).
 *
 * The dialog this replaced seeded from the stock-list row instead, and two of
 * that row's figures are not what is stored:
 *   • row.inTransit is the LIVE open-PO quantity whenever a PO exists — the
 *     typed policy figure is only the fallback for an item with no PO. Saving
 *     wrote the PO quantity into the typed field, so once the PO was received
 *     the item showed phantom in-transit stock.
 *   • row.rate is the stored rate OR the average cost when none is stored.
 *     Saving froze today's average cost as a typed rate.
 * Everything else is identical to what the row carried (the row is built from
 * the same policy), so nothing else about what is saved changes.
 */
const seed = (p, row) => ({
  consumptionMode: (p ? p.consumptionMode : row.consumptionMode) || 'LOW',
  adcLow: p ? (p.adcLow ?? 0) : (row.adcLow || 0),
  adcNormal: p ? (p.adcNormal ?? 0) : (row.adcNormal || 0),
  adcPeak: p ? (p.adcPeak ?? 0) : (row.adcPeak || 0),
  leadDays: p ? (p.leadDays ?? 16) : (row.leadDays || 16),
  safetyFactor: p ? (p.safetyFactor ?? 1.5) : (row.safetyFactor ?? 1.5),
  moq: p ? (p.moq ?? 0) : (row.moq || 0),
  // The stored override, not the resolved figure: in AUTO the field shows the
  // live formula instead, so seeding it with the resolved max level would turn
  // a calculated number into a "manual" one the moment somebody toggled.
  maxLevel: p ? (p.maxLevel || '') : (row.storedMaxLevel || ''),
  // The server resolves MANUAL only when the stored Max Level is a genuine
  // override. Anything else follows ADC × Lead Time × Safety Factor.
  maxLevelMode: ((p ? p.maxLevelMode : row.maxLevelMode) === 'MANUAL') ? 'MANUAL' : 'AUTO',
  materialInTransit: p ? (p.materialInTransit || 0) : 0,
  bookedQty: p ? (p.bookedQty || 0) : (row.booked || 0),
  vendorName: p ? (p.vendorName || '') : (row.vendorName || ''),
  rate: p ? (p.rate || 0) : 0,
});

/**
 * Edit an item's Raw Material planning policy — a large centered dialog in the
 * Register SKU style (it replaced the small Planning policy dialog). Same
 * fields, same checks, same live arithmetic and the same PUT /rm-ims/policy
 * payload as before.
 *
 * @param row  the Stock & Master Data row (code, name, kind, unit, live figures)
 */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const RmPolicyForm = ({ row, initial, measuredAdc, onClose }) => {
  const [save, { isLoading }] = useUpsertRmPolicyMutation();
  const [f, setF] = useState(initial);

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const uom = uomOf(row);

  // The rate the levels are planned with — exactly rmIms.service's
  // resolveActiveAdc: the MEASURED 90-day rate whenever this item has issues in
  // the window, otherwise the planned Low / Normal / Peak rate the mode picks.
  // The dialog this replaced always used the planned rate, so its "what this
  // works out to" could disagree with the stock list (e.g. 1,000 vs 47.25).
  const plannedAdc = Number({ LOW: f.adcLow, NORMAL: f.adcNormal, PEAK: f.adcPeak }[f.consumptionMode]) || 0;
  const measured = round2(measuredAdc);
  const activeAdc = measured > 0 ? measured : plannedAdc;
  const adcIsMeasured = measured > 0;
  const lead = Number(f?.leadDays) || 0;
  const sf = Number(f?.safetyFactor) || 0;
  const manual = f?.maxLevelMode === 'MANUAL';
  const storedMax = Number(f?.maxLevel) || 0;
  // Max Level = Daily Avg Consumption × Lead Time × Safety Factor. Kept live, so
  // moving the Safety Factor moves the level in front of the user's eyes.
  // Rounded to 2 places, as the service does.
  const formulaMax = round2(activeAdc * lead * sf);
  const effectiveMax = manual && storedMax > 0 ? storedMax : formulaMax;
  // The reorder point is lead-time demand and carries NO Safety Factor — the
  // Safety Factor belongs to the Max Level. Mirrors rmIms.service.js, which
  // computes reorderPoint = adc × leadDays.
  const derivedReorderAt = round2(activeAdc * lead);
  const safetyStock = round2(Math.max(0, effectiveMax - derivedReorderAt));
  const modeLabel = { LOW: 'Low', NORMAL: 'Normal', PEAK: 'Peak' }[f?.consumptionMode] || 'Low';

  const sfError = safetyFactorError(f.safetyFactor);
  const maxError = manual && !(storedMax > 0) ? 'Enter a Max Level, or switch back to the calculated value.' : '';
  const blocked = !!sfError || !!maxError;

  const submit = async () => {
    if (blocked) { enqueueSnackbar(sfError || maxError, { variant: 'warning' }); return; }
    try {
      await save({
        skuId: row.skuId,
        consumptionMode: f.consumptionMode,
        adcLow: Number(f.adcLow) || 0, adcNormal: Number(f.adcNormal) || 0, adcPeak: Number(f.adcPeak) || 0,
        leadDays: lead, safetyFactor: sf,
        moq: Number(f.moq) || 0,
        // Always sent, so the server never has to infer this row's mode again.
        maxLevel: storedMax, maxLevelMode: f.maxLevelMode,
        materialInTransit: Number(f.materialInTransit) || 0, bookedQty: Number(f.bookedQty) || 0,
        vendorName: f.vendorName || '', rate: Number(f.rate) || 0,
      }).unwrap();
      enqueueSnackbar('Planning policy saved.', { variant: 'success' });
      onClose();
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Could not save the policy.', { variant: 'error' }); }
  };

  const perDay = <InputAdornment position="end"><Box sx={{ fontSize: '0.66rem', color: O2D.faint }}>{uom}/day</Box></InputAdornment>;
  const poBacked = row.inTransitSource === 'PO';

  return (
    <>
      {/* ── Body (scrolls on its own) ───────────────────────────────────── */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: { xs: 2, sm: 3 }, py: 2.5, bgcolor: O2D.canvas }} data-testid="rm-policy-body">
        {(
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 2, alignItems: 'start' }}>
            <Stack spacing={2} sx={{ minWidth: 0 }}>
              <FormSection icon={Gauge} title="How fast is it used?"
                hint={adcIsMeasured
                  ? `Planning uses the measured rate — ${num(measured)} ${uom}/day issued over the last 90 days. The Low / Normal / Peak rates below take over only when nothing has been issued for 90 days.`
                  : 'Enter the daily consumption at each production rate, then pick which rate we are planning against today. Only the selected one drives the reorder point.'}>
                {/* One per line, so each label reads in full in this column. */}
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 1.5 }}>
                  <TextField size="small" type="number" label="Daily Avg Consumption (Low)" value={f.adcLow} onChange={set('adcLow')} fullWidth InputProps={{ endAdornment: perDay }} />
                  <TextField size="small" type="number" label="Daily Avg Consumption (Normal)" value={f.adcNormal} onChange={set('adcNormal')} fullWidth InputProps={{ endAdornment: perDay }} />
                  <TextField size="small" type="number" label="Daily Avg Consumption (Peak)" value={f.adcPeak} onChange={set('adcPeak')} fullWidth InputProps={{ endAdornment: perDay }} />
                </Box>
                <TextField select size="small" label="Choose Current Consumption" value={f.consumptionMode} onChange={set('consumptionMode')}
                  fullWidth helperText="Switch this when the factory moves between a slow season and a busy one." FormHelperTextProps={helperSx}>
                  <MenuItem value="LOW">Low production</MenuItem>
                  <MenuItem value="NORMAL">Normal production</MenuItem>
                  <MenuItem value="PEAK">Peak production</MenuItem>
                </TextField>
              </FormSection>

              <FormSection icon={Timer} title="How long does it take to arrive?">
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                  <TextField size="small" type="number" label="Lead Time (From Indent to Receipt)" value={f.leadDays} onChange={set('leadDays')} fullWidth
                    helperText="Days the vendor takes to deliver after you place the order." FormHelperTextProps={helperSx} />
                  <TextField size="small" type="number" label="Safety Factor" value={f.safetyFactor} onChange={set('safetyFactor')} fullWidth
                    inputProps={{ min: SF_MIN, max: SF_MAX, step: SF_STEP }} error={!!sfError}
                    helperText={sfError || `Cushion for demand spikes and late deliveries. ${SF_MIN.toFixed(1)}–${SF_MAX.toFixed(1)} in 0.1 steps; 1.5 keeps 50% extra. Set per item — this changes this item only.`}
                    FormHelperTextProps={sfError ? undefined : helperSx} />
                </Box>
              </FormSection>

              <FormSection icon={Truck} title="Supplier">
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) 190px' }, gap: 1.5 }}>
                  <TextField size="small" label="Vendor Name" value={f.vendorName} onChange={set('vendorName')} fullWidth />
                  <TextField size="small" type="number" label="Rate" value={f.rate} onChange={set('rate')} fullWidth
                    InputProps={{ startAdornment: <InputAdornment position="start"><Box sx={{ fontSize: '0.72rem', color: O2D.faint }}>₹</Box></InputAdornment> }}
                    helperText={Number(f.rate) > 0
                      ? `Per ${uom}. Used to value stock and estimate spend.`
                      : `Per ${uom}. Left at 0, stock is valued at the average cost${row.avgCost ? ` (${inr(row.avgCost)})` : ''}.`}
                    FormHelperTextProps={helperSx} />
                </Box>
              </FormSection>
            </Stack>

            <Stack spacing={2} sx={{ minWidth: 0 }}>
              {/* Live arithmetic */}
              <FormSection icon={Calculator} title="What this works out to" tone={STOCK_TOKENS.OK}>
                <Stack spacing={0.75} data-testid="rm-policy-live">
                  {activeAdc > 0 && lead > 0 && sf > 0 ? (
                    <>
                      <Typography sx={{ fontSize: '0.78rem', color: O2D.body }}>
                        <b>Reorder at {num(derivedReorderAt)} {uom}</b> — {num(activeAdc)} per day × {num(lead)} days
                        {adcIsMeasured ? <> at the <b>measured</b> 90-day rate</> : <> at the <b>{modeLabel}</b> rate</>}. No Safety Factor here, so changing it never moves this number.
                      </Typography>
                      <Typography sx={{ fontSize: '0.78rem', color: O2D.body }}>
                        <b>Max Level {num(effectiveMax)} {uom}</b> — {manual
                          ? 'entered by hand below; the formula is overridden.'
                          : `${num(activeAdc)} per day × ${num(lead)} days × ${num(sf)} safety.`}
                      </Typography>
                      <Typography sx={{ fontSize: '0.78rem', color: O2D.body }}>
                        <b>Safety Stock {num(safetyStock)} {uom}</b> — Max Level {num(effectiveMax)} − lead-time demand {num(derivedReorderAt)}.
                      </Typography>
                      <Typography sx={{ fontSize: '0.78rem', color: O2D.body }}>
                        IMS flags this item for buying the moment stock falls to {num(derivedReorderAt)}, and suggests
                        ordering back up to {num(effectiveMax)}.
                      </Typography>
                    </>
                  ) : (
                    <Typography sx={{ fontSize: '0.78rem', color: O2D.body }}>
                      {`Enter the ${modeLabel} daily consumption, Lead Time and Safety Factor to see the levels they produce.`}
                    </Typography>
                  )}
                </Stack>
              </FormSection>

              <FormSection icon={ShoppingCart} title="Buying rules and current commitments">
                <TextField size="small" type="number" label="MOQ" value={f.moq} onChange={set('moq')} fullWidth
                  helperText="The smallest quantity the supplier will accept. Leave blank if there is none." FormHelperTextProps={helperSx} />
                <Box>
                  <FormControlLabel
                    control={<Switch size="small" checked={manual}
                      onChange={(e) => setF((p) => ({ ...p, maxLevelMode: e.target.checked ? 'MANUAL' : 'AUTO' }))} />}
                    label={<Typography sx={{ fontSize: '0.74rem', fontWeight: 700, color: O2D.ink }}>Set Max Level manually</Typography>}
                    sx={{ ml: 0, mb: 0.5 }}
                  />
                  {/* In AUTO the field shows the LIVE formula result rather than a
                      stored value, so a Safety Factor edit is visible immediately. */}
                  <TextField size="small" type="number" label="Max Level" fullWidth
                    value={manual ? f.maxLevel : formulaMax} onChange={set('maxLevel')} disabled={!manual}
                    inputProps={{ min: 0, step: 0.01 }} error={!!maxError}
                    helperText={maxError || (manual
                      ? 'Overrides the formula. This number stays put whatever the Safety Factor is.'
                      : 'Calculated as Daily Avg Consumption × Lead Time × Safety Factor. Moves whenever you change the Safety Factor.')}
                    FormHelperTextProps={maxError ? undefined : helperSx} />
                  {manual && (
                    <Alert severity="warning" icon={false}
                      sx={{ mt: 0.75, py: 0.25, fontSize: '0.7rem', borderRadius: '6px', '& .MuiAlert-message': { py: 0.5 } }}>
                      Max Level is manually overridden. Changing Safety Factor will not affect this value.
                    </Alert>
                  )}
                </Box>
                {/* What the stock list actually uses for in-transit, when a PO exists. */}
                {poBacked && (
                  <Alert severity="info" icon={false} data-testid="rm-policy-po-transit"
                    sx={{ py: 0.25, fontSize: '0.72rem', borderRadius: '8px', '& .MuiAlert-message': { py: 0.5 } }}>
                    <b>{num(row.inTransit)} {uom}</b> is in transit on {row.openPoCount} open purchase order{row.openPoCount === 1 ? '' : 's'}
                    {row.openPoNumbers?.length ? ` (${row.openPoNumbers.join(', ')})` : ''}
                    {row.openPoEarliestExpectedAt ? `, earliest expected ${dayjs(row.openPoEarliestExpectedAt).format('DD MMM YYYY')}` : ''}.
                    {' '}That live figure is what planning uses; the field below is only used when no PO is open.
                  </Alert>
                )}
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
                  <TextField size="small" type="number" label="Material In Transit" value={f.materialInTransit} onChange={set('materialInTransit')} fullWidth
                    helperText={poBacked ? 'Typed fallback — used only when no purchase order is open.' : 'Ordered but not yet received.'}
                    FormHelperTextProps={helperSx} />
                  <TextField size="small" type="number" label="Booked Qty" value={f.bookedQty} onChange={set('bookedQty')} fullWidth
                    helperText="Promised to confirmed orders." FormHelperTextProps={helperSx} />
                </Box>
                {/* Opening Stock Quantity deliberately lives on Stock In, not here.
                    Editing it in the policy posted no movement, so the planning row
                    and the stock ledger silently drifted apart. */}
                <Typography sx={{ fontSize: '0.68rem', color: O2D.faint }}>
                  Opening Stock Quantity is recorded on the Stock In screen, under the reason “Opening stock”, so it lands in the ledger too.
                </Typography>
              </FormSection>

              <Typography sx={{ fontSize: '0.7rem', color: O2D.faint, px: 0.5 }}>
                Changing this policy never changes the stock itself — on-hand only moves through Stock In, Stock Out and coil cutting.
              </Typography>
            </Stack>
          </Box>
        )}
      </Box>

      {/* ── Fixed bottom action bar ─────────────────────────────────────── */}
      <Box sx={{
        flexShrink: 0, zIndex: 10, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper',
        px: { xs: 2, sm: 3 }, py: 1.75,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap',
      }}>
        <Stack direction="row" spacing={2.5} sx={{ minWidth: 0, display: { xs: 'none', sm: 'flex' } }}>
          <SummaryItem label="Reorder at" value={`${num(derivedReorderAt)} ${uom}`} color={STOCK_TOKENS.REORDER.color} />
          <SummaryItem label={manual ? 'Max Level (manual)' : 'Max Level'} value={`${num(effectiveMax)} ${uom}`} color={STOCK_TOKENS.OK.color} />
          <SummaryItem label="Safety Stock" value={`${num(safetyStock)} ${uom}`} />
        </Stack>
        <Stack direction="row" spacing={1.25} sx={{ ml: 'auto' }}>
          <Button variant="outlined" onClick={onClose} sx={{ minWidth: 110 }}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={isLoading || blocked}
            startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} sx={{ minWidth: 150 }}>
            Save policy
          </Button>
        </Stack>
      </Box>
    </>
  );
};

/**
 * The dialog: loads the STORED policy, then mounts the form seeded from it.
 * A load error opens the form on the row's values (the previous behaviour)
 * rather than blocking the edit.
 */
const RmPolicyDialog = ({ row, onClose }) => {
  const { data, isFetching, isError } = useGetRmPolicyQuery(row.skuId, { refetchOnMountOrArgChange: true });
  const ready = !isFetching && (data !== undefined || isError);
  return (
    <SkuDialogShell
      open
      onClose={onClose}
      testId="rm-policy-dialog"
      icon={SlidersHorizontal}
      title="Edit Planning Policy"
      subtitle={`${row.skuCode} · ${row.skuName} · ${row.kind === 'CIRCLE' ? 'Circle' : 'Coil'} · counted in ${uomOf(row)}`}
    >
      {ready ? (
        <RmPolicyForm key={row.skuId} row={row} initial={seed(isError ? null : (data?.data || null), row)}
          measuredAdc={(isError ? null : data?.data?.measuredAdc) ?? row.measuredAdc ?? 0} onClose={onClose} />
      ) : (
        <>
          <Box sx={{ flex: 1, minHeight: 0, px: { xs: 2, sm: 3 }, py: 2.5, bgcolor: O2D.canvas }}>
            <Stack spacing={2}><Skeleton variant="rounded" height={190} /><Skeleton variant="rounded" height={230} /></Stack>
          </Box>
          <Box sx={{ flexShrink: 0, borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', px: { xs: 2, sm: 3 }, py: 1.75, display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="outlined" onClick={onClose} sx={{ minWidth: 110 }}>Cancel</Button>
          </Box>
        </>
      )}
    </SkuDialogShell>
  );
};

export default RmPolicyDialog;
