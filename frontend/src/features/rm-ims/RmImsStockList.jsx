import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, TextField, InputAdornment, Table, TableHead, TableBody, TableRow, TableCell,
  IconButton, Tooltip, Skeleton, Dialog, DialogTitle, DialogContent, DialogActions, Button, MenuItem,
  CircularProgress, Collapse, TablePagination, Chip, Switch, FormControlLabel, Alert,
} from '@mui/material';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Layers, Search, Pencil, Eye, X, Save, Info, Download, Calculator, Disc3, CircleDashed } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import {
  RmShell, Panel, TableScroll, KpiTile, StatusChip, StatusLegend, EmptyNote, Th, Eyebrow,
  KindChip, AvailMeter, availBand, uomOf,
  O2D, O2D_TIP, STOCK_TOKENS, STOCK_ORDER, stockToken, num, inr, imsTableSx,
} from './rmImsMeta';
import { useGetRmOverviewQuery, useUpsertRmPolicyMutation } from '../../store/api/rmImsApi';
import { FIELD } from '../ims/imsFieldHelp';
import AwaitingQcNote from '../ims/AwaitingQcNote';

const H = FIELD.rm;

const num0 = (v) => (v == null ? '—' : num(v));

// A planning figure this item has no policy for. Shown instead of the fallback
// the service plans with, so a default is never read as the client's own number.
const NotConfigured = () => (
  <Tooltip arrow slotProps={O2D_TIP}
    title="No planning policy set for this item. IMS falls back to a system default to keep the levels working — set a policy to make this a real figure.">
    <Box component="span" sx={{ color: O2D.faint, cursor: 'help' }}>—</Box>
  </Tooltip>
);

/**
 * Material In Transit, and where the figure came from.
 *
 * A PO-backed number names the purchase orders behind it, because that is what
 * makes it checkable — a buyer can go and look. A typed number says so plainly,
 * so nobody mistakes somebody's estimate for a confirmed order.
 */
const InTransitCell = ({ row: r }) => (
  <Box sx={{ display: 'inline-block', textAlign: 'right' }}>
    <InTransitFigure row={r} />
    <AwaitingQcNote qty={r.awaitingQc} grnNumbers={r.awaitingQcGrnNumbers} fmt={num} />
  </Box>
);

const InTransitFigure = ({ row: r }) => {
  if (!r.inTransit) return <Box component="span" sx={{ color: O2D.faint }}>—</Box>;

  if (r.inTransitSource === 'PO') {
    const overdue = r.openPoOverdueCount > 0;
    const title = [
      `${num(r.inTransit)} pending on ${r.openPoCount} open purchase order${r.openPoCount > 1 ? 's' : ''}.`,
      r.openPoNumbers.length ? r.openPoNumbers.join(', ') : '',
      r.openPoReceivedQty > 0
        ? `${num(r.openPoReceivedQty)} of ${num(r.openPoOrderedQty)} ordered has already been received — counted in the stock on hand, or as Awaiting QC until its QC completes, not here.`
        : '',
      r.openPoEarliestExpectedAt ? `Earliest expected ${dayjs(r.openPoEarliestExpectedAt).format('DD MMM YYYY')}.` : '',
      overdue ? `${num(r.openPoOverdueQty)} of it is past its expected date.` : '',
    ].filter(Boolean).join(' ');
    return (
      <Tooltip arrow slotProps={O2D_TIP} title={title}>
        <Box sx={{ display: 'inline-block', cursor: 'help', textAlign: 'right' }}>
          <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.body, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
            {num(r.inTransit)}
          </Typography>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: overdue ? STOCK_TOKENS.REORDER.color : O2D.faint }}>
            {overdue ? 'PO · overdue' : `PO × ${r.openPoCount}`}
          </Typography>
        </Box>
      </Tooltip>
    );
  }

  return (
    <Tooltip arrow slotProps={O2D_TIP}
      title="Typed into the planning policy by hand — no open purchase order backs it. Raise the PO in Purchase FMS and this becomes a live figure.">
      <Box sx={{ display: 'inline-block', cursor: 'help', textAlign: 'right' }}>
        <Typography sx={{ fontSize: '0.8rem', color: O2D.body, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
          {num(r.inTransit)}
        </Typography>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: O2D.faint }}>typed</Typography>
      </Box>
    </Tooltip>
  );
};

/** The daily rate, saying whether it was measured or is still just the plan. */
const AdcCell = ({ row: r }) => {
  if (!r.adc) {
    return (
      <Tooltip arrow slotProps={O2D_TIP}
        title="No consumption recorded yet and no planned rate set. The item is still active and still holds its stock — it simply cannot be planned until one of the two exists.">
        <Box component="span" sx={{ color: O2D.faint, cursor: 'help' }}>—</Box>
      </Tooltip>
    );
  }
  const measured = r.adcSource === 'MEASURED';
  return (
    <Tooltip arrow slotProps={O2D_TIP}
      title={measured
        ? `Measured: ${num(r.consumption90dQty)} issued over the last ${r.consumption90dDays} days ÷ ${r.consumption90dDays}.`
        : `The planned ${String(r.consumptionMode || '').toLowerCase()} rate. Nothing has been issued in the last ${r.consumption90dDays} days, so there is no measured rate to use yet.`}>
      <Box sx={{ display: 'inline-block', cursor: 'help', textAlign: 'right' }}>
        <Typography sx={{ fontSize: '0.8rem', color: O2D.body, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>{num(r.adc)}</Typography>
        <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: measured ? STOCK_TOKENS.OK.color : O2D.faint }}>
          {measured ? 'measured' : 'planned'}
        </Typography>
      </Box>
    </Tooltip>
  );
};

// Every planning word on this screen, in plain English. Raw material carries a
// couple of terms consumables do not — booked quantity and the three
// consumption modes — so they get spelled out too.
const GLOSSARY = [
  ['Total Available Quantity', 'How much of this coil or circle is physically in the store right now. Coil is weighed in kilos; circles are counted in pieces.'],
  ['Material In Transit', 'Ordered from the vendor and not yet received — read live from the open purchase orders in Purchase FMS. What a PO has already delivered is in the stock on hand instead, never counted twice. "typed" means somebody entered the figure by hand and no PO backs it.'],
  ['Booked Qty', 'Already promised to a confirmed order — not really free to use.'],
  ['Daily Avg Consumption', 'The average issued per day over the last 90 days, measured from the ledger. An item with no issues yet shows its planned Low/Normal/Peak rate instead, marked "planned".'],
  ['Daily Consumption', 'What was actually issued today — a running total, not an average. Blank means nothing has gone out today.'],
  ['Choose Current Consumption', 'Whether we are planning against a Low, Normal or Peak production rate. It picks which daily-use figure drives the reorder point.'],
  ['Safety Factor', 'A cushion multiplier for demand spikes and late deliveries, set per item. 1.5 means we hold 50% extra.'],
  ['Lead Time (From Indent to Receipt)', 'Days the vendor takes to deliver after you place the order.'],
  ['Reorder at', 'The trigger level. When stock drops to this, place the order — Daily Avg Consumption × Lead Time. The Safety Factor does not enter here, so changing it never moves this number.'],
  ['Max Level', 'The ceiling. When we buy, we buy enough to reach this level — Daily Avg Consumption × Lead Time × Safety Factor. An "M" beside the figure means it was overridden by hand and ignores the formula.'],
  ['Available %', 'Total Available Quantity measured against the Max Level. Under 33% is critical.'],
  ['Cover', 'How many days the current stock lasts at the chosen daily consumption rate.'],
];

const KIND_FILTERS = [
  { value: 'ALL', label: 'All raw material', icon: Layers },
  { value: 'COIL', label: 'Coils only', icon: Disc3 },
  { value: 'CIRCLE', label: 'Circles only', icon: CircleDashed },
];

// Colour key for the footer. It reads STOCK_TOKENS / STOCK_ORDER directly — the
// very same map the row tints and the Status chips already use — so the legend
// cannot drift from the table. No colour is defined here.
const ColorCodingLegend = () => (
  <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap
    sx={{ py: { xs: 1, md: 0 } }}>
    <Typography sx={{
      fontSize: '0.68rem', fontWeight: 800, color: O2D.sub,
      letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>
      Color Coding
    </Typography>
    {STOCK_ORDER.map((k) => {
      const t = STOCK_TOKENS[k];
      return (
        <Tooltip key={k} arrow slotProps={O2D_TIP} title={t.meaning}>
          <Stack direction="row" alignItems="center" spacing={0.55} sx={{ cursor: 'help' }}>
            <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: t.color, flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.7rem', color: O2D.body, whiteSpace: 'nowrap' }}>{t.label}</Typography>
          </Stack>
        </Tooltip>
      );
    })}
  </Stack>
);

const helperSx = { sx: { fontSize: '0.66rem', color: O2D.sub, mx: 0, mt: 0.4 } };

// Safety Factor bounds — the same 1.0–5.0 in 0.1 steps that Consumables &
// Packaging uses and that rmPolicySchema now enforces server-side. Below 1.0 the
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

// ── Planning policy dialog ───────────────────────────────────────────────────
// Same idea as the consumables drawer: show the arithmetic live, so nobody has
// to save a change to find out what it did to the reorder point.
const PolicyDialog = ({ row, onClose }) => {
  const [save, { isLoading }] = useUpsertRmPolicyMutation();
  const [f, setF] = useState({
    consumptionMode: row.consumptionMode || 'LOW',
    adcLow: row.adcLow || 0, adcNormal: row.adcNormal || 0, adcPeak: row.adcPeak || 0,
    leadDays: row.leadDays || 16, safetyFactor: row.safetyFactor ?? 1.5,
    moq: row.moq || 0,
    // The stored override, not the resolved figure: in AUTO the field shows the
    // live formula instead, so seeding it with the resolved max level would turn
    // a calculated number into a "manual" one the moment somebody toggled.
    maxLevel: row.storedMaxLevel || '',
    // The server resolves MANUAL only when the stored Max Level is a genuine
    // override (explicitly set, or a legacy value the formula cannot explain).
    // Anything else follows ADC × Lead Time × Safety Factor.
    maxLevelMode: row.maxLevelMode === 'MANUAL' ? 'MANUAL' : 'AUTO',
    materialInTransit: row.inTransit || 0, bookedQty: row.booked || 0,
    vendorName: row.vendorName || '', rate: row.rate || 0,
  });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const activeAdc = Number({ LOW: f.adcLow, NORMAL: f.adcNormal, PEAK: f.adcPeak }[f.consumptionMode]) || 0;
  const lead = Number(f.leadDays) || 0;
  const sf = Number(f.safetyFactor) || 0;
  const manual = f.maxLevelMode === 'MANUAL';
  const storedMax = Number(f.maxLevel) || 0;
  // Max Level = Daily Avg Consumption × Lead Time × Safety Factor. Kept live, so
  // moving the Safety Factor moves the level in front of the user's eyes.
  const formulaMax = Math.round(activeAdc * lead * sf);
  const effectiveMax = manual && storedMax > 0 ? storedMax : formulaMax;
  // The reorder point is lead-time demand and carries NO Safety Factor — the
  // Safety Factor belongs to the Max Level. Mirrors rmIms.service.js, which
  // computes reorderPoint = adc × leadDays.
  const derivedReorderAt = Math.round(activeAdc * lead);
  const safetyStock = Math.max(0, effectiveMax - derivedReorderAt);
  const modeLabel = { LOW: 'Low', NORMAL: 'Normal', PEAK: 'Peak' }[f.consumptionMode];
  const uom = uomOf(row);

  const sfError = safetyFactorError(f.safetyFactor);
  const maxError = manual && !(storedMax > 0) ? 'Enter a Max Level, or switch back to the calculated value.' : '';

  const submit = async () => {
    if (sfError || maxError) { enqueueSnackbar(sfError || maxError, { variant: 'warning' }); return; }
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

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: '10px', border: `1px solid ${O2D.line}` } }}>
      <DialogTitle sx={{ py: 1.25, borderBottom: `1px solid ${O2D.lineSoft}` }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ minWidth: 0, mr: 'auto' }}>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: O2D.ink }}>Planning policy</Typography>
            <Typography noWrap sx={{ fontSize: '0.72rem', color: O2D.sub }}>
              {row.skuName} · {row.skuCode}
            </Typography>
          </Box>
          <KindChip kind={row.kind} withHint={false} />
          <IconButton size="small" onClick={onClose} sx={{ color: O2D.sub }}><X size={16} /></IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ bgcolor: O2D.canvas, p: 1.5 }}>
        <Stack spacing={1.25}>
          <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
            <Eyebrow>How fast is it used?</Eyebrow>
            <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, mt: 0.4, mb: 1.25 }}>
              Enter the daily consumption at each production rate, then pick which rate we are planning against today.
              Only the selected one drives the reorder point.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
              <TextField size="small" type="number" label="Daily Avg Consumption (Low)" value={f.adcLow} onChange={set('adcLow')} fullWidth
                InputProps={{ endAdornment: <InputAdornment position="end"><Box sx={{ fontSize: '0.66rem', color: O2D.faint }}>{uom}/day</Box></InputAdornment> }} />
              <TextField size="small" type="number" label="Daily Avg Consumption (Normal)" value={f.adcNormal} onChange={set('adcNormal')} fullWidth
                InputProps={{ endAdornment: <InputAdornment position="end"><Box sx={{ fontSize: '0.66rem', color: O2D.faint }}>{uom}/day</Box></InputAdornment> }} />
              <TextField size="small" type="number" label="Daily Avg Consumption (Peak)" value={f.adcPeak} onChange={set('adcPeak')} fullWidth
                InputProps={{ endAdornment: <InputAdornment position="end"><Box sx={{ fontSize: '0.66rem', color: O2D.faint }}>{uom}/day</Box></InputAdornment> }} />
            </Stack>
            <TextField select size="small" label="Choose Current Consumption" value={f.consumptionMode} onChange={set('consumptionMode')}
              fullWidth sx={{ mt: 1.5 }}
              helperText="Switch this when the factory moves between a slow season and a busy one."
              FormHelperTextProps={helperSx}>
              <MenuItem value="LOW">Low production</MenuItem>
              <MenuItem value="NORMAL">Normal production</MenuItem>
              <MenuItem value="PEAK">Peak production</MenuItem>
            </TextField>
          </Paper>

          <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
            <Eyebrow>How long does it take to arrive?</Eyebrow>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ mt: 1.25 }}>
              <TextField size="small" type="number" label="Lead Time (From Indent to Receipt)" value={f.leadDays} onChange={set('leadDays')} fullWidth
                helperText="Days the vendor takes to deliver after you place the order." FormHelperTextProps={helperSx} />
              <TextField size="small" type="number" label="Safety Factor" value={f.safetyFactor} onChange={set('safetyFactor')} fullWidth
                inputProps={{ min: SF_MIN, max: SF_MAX, step: SF_STEP }}
                error={!!sfError}
                helperText={sfError || `Cushion for demand spikes and late deliveries. ${SF_MIN.toFixed(1)}–${SF_MAX.toFixed(1)} in 0.1 steps; 1.5 keeps 50% extra. Set per item — this changes this item only.`}
                FormHelperTextProps={helperSx} />
            </Stack>
          </Paper>

          {/* Live arithmetic */}
          <Paper elevation={0} sx={{
            p: 1.5, borderRadius: '8px',
            border: `1px solid ${STOCK_TOKENS.OK.border}`, bgcolor: STOCK_TOKENS.OK.tint,
          }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
              <Box sx={{ color: STOCK_TOKENS.OK.color, display: 'flex' }}><Calculator size={15} /></Box>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: STOCK_TOKENS.OK.color }}>What this works out to</Typography>
            </Stack>
            <Stack spacing={0.5} sx={{ fontSize: '0.74rem', color: O2D.body }}>
              {activeAdc > 0 && lead > 0 && sf > 0 ? (
                <>
                  <Typography sx={{ fontSize: 'inherit', color: 'inherit' }}>
                    <b>Reorder at {num(derivedReorderAt)} {uom}</b> — {num(activeAdc)} per day × {num(lead)} days
                    at the <b>{modeLabel}</b> rate. No Safety Factor here, so changing it never moves this number.
                  </Typography>
                  <Typography sx={{ fontSize: 'inherit', color: 'inherit' }}>
                    <b>Max Level {num(effectiveMax)} {uom}</b> — {manual
                      ? 'entered by hand below; the formula is overridden.'
                      : `${num(activeAdc)} per day × ${num(lead)} days × ${num(sf)} safety.`}
                  </Typography>
                  <Typography sx={{ fontSize: 'inherit', color: 'inherit' }}>
                    <b>Safety Stock {num(safetyStock)} {uom}</b> — Max Level {num(effectiveMax)} − lead-time demand {num(derivedReorderAt)}.
                  </Typography>
                  <Typography sx={{ fontSize: 'inherit', color: 'inherit' }}>
                    IMS flags this item for buying the moment stock falls to {num(derivedReorderAt)}, and suggests
                    ordering back up to {num(effectiveMax)}.
                  </Typography>
                </>
              ) : (
                <Typography sx={{ fontSize: 'inherit', color: 'inherit' }}>
                  {`Enter the ${modeLabel} daily consumption, Lead Time and Safety Factor to see the levels they produce.`}
                </Typography>
              )}
            </Stack>
          </Paper>

          <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
            <Eyebrow>Buying rules and current commitments</Eyebrow>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ mt: 1.25, alignItems: 'flex-start' }}>
              <TextField size="small" type="number" label="MOQ" value={f.moq} onChange={set('moq')} fullWidth
                helperText="The smallest quantity the supplier will accept. Leave blank if there is none."
                FormHelperTextProps={helperSx} />
              <Box sx={{ width: '100%' }}>
                <FormControlLabel
                  control={<Switch size="small" checked={manual}
                    onChange={(e) => setF((p) => ({ ...p, maxLevelMode: e.target.checked ? 'MANUAL' : 'AUTO' }))} />}
                  label={<Typography sx={{ fontSize: '0.72rem', color: O2D.body }}>Set Max Level manually</Typography>}
                  sx={{ ml: 0, mb: 0.5 }}
                />
                {/* In AUTO the field shows the LIVE formula result rather than a
                    stored value, so the Safety Factor edit above is visible here
                    immediately instead of only after a save. */}
                <TextField size="small" type="number" label="Max Level" fullWidth
                  value={manual ? f.maxLevel : formulaMax}
                  onChange={set('maxLevel')}
                  disabled={!manual}
                  inputProps={{ min: 0, step: 0.01 }}
                  error={!!maxError}
                  helperText={maxError || (manual
                    ? 'Overrides the formula. This number stays put whatever the Safety Factor is.'
                    : 'Calculated as Daily Avg Consumption × Lead Time × Safety Factor. Moves whenever you change the Safety Factor.')}
                  FormHelperTextProps={helperSx} />
                {manual && (
                  <Alert severity="warning" icon={false}
                    sx={{ mt: 0.75, py: 0.25, fontSize: '0.68rem', borderRadius: '6px', '& .MuiAlert-message': { py: 0.5 } }}>
                    Max Level is manually overridden. Changing Safety Factor will not affect this value.
                  </Alert>
                )}
              </Box>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ mt: 1.5 }}>
              <TextField size="small" type="number" label="Material In Transit" value={f.materialInTransit} onChange={set('materialInTransit')} fullWidth
                helperText="Ordered but not yet received." FormHelperTextProps={helperSx} />
              <TextField size="small" type="number" label="Booked Qty" value={f.bookedQty} onChange={set('bookedQty')} fullWidth
                helperText="Promised to confirmed orders." FormHelperTextProps={helperSx} />
            </Stack>
            {/* Opening Stock Quantity deliberately lives on Stock In, not here.
                Editing it in the policy posted no movement, so the planning row
                and the stock ledger silently drifted apart. Stock In → reason
                "Opening stock" records the same balance AND the movement. */}
            <Typography sx={{ fontSize: '0.66rem', color: O2D.faint, mt: 1 }}>
              Opening Stock Quantity is recorded on the Stock In screen, under the reason “Opening stock”, so it
              lands in the ledger too.
            </Typography>
          </Paper>

          <Paper elevation={0} sx={{ p: 1.5, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
            <Eyebrow>Supplier</Eyebrow>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} sx={{ mt: 1.25 }}>
              <TextField size="small" label="Vendor Name" value={f.vendorName} onChange={set('vendorName')} fullWidth />
              <TextField size="small" type="number" label="Rate" value={f.rate} onChange={set('rate')} sx={{ width: { xs: '100%', sm: 180 } }}
                InputProps={{ startAdornment: <InputAdornment position="start"><Box sx={{ fontSize: '0.72rem', color: O2D.faint }}>₹</Box></InputAdornment> }}
                helperText={`Per ${uom}. Used to value stock and estimate spend.`} FormHelperTextProps={helperSx} />
            </Stack>
          </Paper>

          <Typography sx={{ fontSize: '0.68rem', color: O2D.faint }}>
            Changing this policy never changes the stock itself — on-hand only moves through Stock In, Stock Out and coil cutting.
          </Typography>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ borderTop: `1px solid ${O2D.lineSoft}`, px: 1.5, py: 1 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 700, color: O2D.body }}>Cancel</Button>
        <Button variant="contained" disableElevation onClick={submit} disabled={isLoading}
          startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : <Save size={15} />}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}>
          Save policy
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const RmImsStockList = () => {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [kind, setKind] = useState(params.get('kind') || 'ALL');
  const [status, setStatus] = useState(params.get('status') || 'ALL');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState(null);
  const [showGlossary, setShowGlossary] = useState(false);
  const [showUnmatched, setShowUnmatched] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Load the whole set and filter kind/status client-side, so the legend can
  // show live counts for every band rather than only the one being viewed.
  const queryArgs = useMemo(() => (search ? { search } : {}), [search]);
  const { data, isFetching } = useGetRmOverviewQuery(queryArgs);
  const rows = useMemo(() => data?.data || [], [data]);
  const unmatchedPo = useMemo(() => data?.meta?.inTransit?.unmatched || [], [data]);

  const setParam = (key, value, setter) => {
    setter(value);
    if (value === 'ALL') params.delete(key); else params.set(key, value);
    setParams(params, { replace: true });
  };

  const kindRows = useMemo(() => (kind === 'ALL' ? rows : rows.filter((r) => r.kind === kind)), [rows, kind]);
  const counts = useMemo(() => {
    const c = { ALL: kindRows.length };
    STOCK_ORDER.forEach((k) => { c[k] = kindRows.filter((r) => r.status === k).length; });
    return c;
  }, [kindRows]);

  const filtered = useMemo(() => {
    const list = status === 'ALL' ? kindRows : kindRows.filter((r) => r.status === status);
    // Worst first, then thinnest availability — the order a planner works in.
    return [...list].sort((a, b) => STOCK_ORDER.indexOf(a.status) - STOCK_ORDER.indexOf(b.status)
      || (a.availablePct ?? 1e9) - (b.availablePct ?? 1e9));
  }, [kindRows, status]);

  useEffect(() => { setPage(0); }, [search, kind, status, rowsPerPage]);
  const paged = useMemo(() => filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [filtered, page, rowsPerPage]);

  const summary = useMemo(() => ({
    coils: rows.filter((r) => r.kind === 'COIL').length,
    circles: rows.filter((r) => r.kind === 'CIRCLE').length,
    onHand: rows.reduce((t, r) => t + Number(r.onHand || 0), 0),
    value: rows.reduce((t, r) => t + Number(r.onHand || 0) * Number(r.rate || 0), 0),
    toOrder: rows.filter((r) => ['REORDER', 'OUT_OF_STOCK'].includes(r.status)).length,
  }), [rows]);

  const exportCsv = () => {
    // Same words, same order as the table on screen, so a printed sheet and the
    // app read alike. "Days cover" stays the CSV spelling of the "Cover" column,
    // matching the Consumables export.
    const header = [
      'SKU Code', 'Item Name', 'Material', 'UOM', 'Total Available Quantity', 'Recorded weight (kg)', 'Material In Transit', 'In Transit source', 'Booked Qty',
      'Daily Avg Consumption', 'ADC source', 'Daily Consumption', 'Safety Factor', 'Lead Time (From Indent to Receipt)', 'Reorder at', 'Max Level',
      'Max Level set', 'Available %', 'Days cover', 'Vendor Name', 'Status',
      // Appended LAST so every earlier column keeps its position for anyone
      // reading the file by column number. Received, waiting for Incoming QC:
      // never part of on hand or in transit.
      'Awaiting QC',
    ];
    const lines = filtered.map((r) => [
      r.skuCode, r.skuName, r.kind === 'CIRCLE' ? 'Circle' : 'Coil', uomOf(r),
      r.onHand, r.kind === 'CIRCLE' ? r.onHandKg : '', r.inTransit, r.inTransitSource, r.booked,
      r.adc, r.adcSource, r.dailyConsumption ?? '', r.safetyFactor, r.leadDays, r.reorderPoint, r.maxLevel,
      r.maxLevelMode === 'MANUAL' ? 'Manual' : 'Auto',
      r.availablePct ?? '', r.daysCover ?? '', r.vendorName, stockToken(r.status).label,
      r.awaitingQc || 0,
    ]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `raw-material-stock_${dayjs().format('YYYY-MM-DD')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const activeFilters = (kind !== 'ALL' ? 1 : 0) + (status !== 'ALL' ? 1 : 0) + (search ? 1 : 0);

  return (
    <RmShell
      icon={Layers}
      title="Stock & Master Data"
      subtitle="Every coil and circle — what's on hand, what's committed, and when to buy more."
      actions={(
        <Button size="small" variant="outlined" startIcon={<Download size={14} />} onClick={exportCsv} disabled={!filtered.length}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
          Export
        </Button>
      )}
    >
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
        <KpiTile label="Coils" value={num(summary.coils)} sub="Uncut raw metal" color="#0f766e" icon={Disc3}
          active={kind === 'COIL'} onClick={() => setParam('kind', kind === 'COIL' ? 'ALL' : 'COIL', setKind)} />
        <KpiTile label="Circles" value={num(summary.circles)} sub="Cut and ready" color="#4338ca" icon={CircleDashed}
          active={kind === 'CIRCLE'} onClick={() => setParam('kind', kind === 'CIRCLE' ? 'ALL' : 'CIRCLE', setKind)} />
        <KpiTile label="Total Available Quantity" value={num(summary.onHand)} sub="Across all raw material" color={O2D.brand} icon={Layers} />
        <KpiTile label="Value in store" value={inr(summary.value)} sub="At the recorded rate" color="#7c3aed" icon={Calculator} />
        <KpiTile label="To order now" value={num(summary.toOrder)} sub="At or below reorder point"
          color={STOCK_TOKENS.REORDER.color} icon={Info} />
      </Stack>

      <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code, item or category…" sx={{ minWidth: { xs: '100%', sm: 260 }, flex: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }} />
          <TextField select size="small" label="Material" value={kind} onChange={(e) => setParam('kind', e.target.value, setKind)} sx={{ minWidth: 175 }}>
            {KIND_FILTERS.map((k) => <MenuItem key={k.value} value={k.value}>{k.label}</MenuItem>)}
          </TextField>
          <Button size="small" startIcon={<Info size={14} />} onClick={() => setShowGlossary((v) => !v)}
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.74rem', color: showGlossary ? O2D.brand : O2D.sub }}>
            What do these columns mean?
          </Button>
          <Typography sx={{ fontSize: '0.7rem', color: O2D.sub, whiteSpace: 'nowrap', ml: 'auto' }}>
            <b>{filtered.length}</b> of {rows.length}
          </Typography>
          {activeFilters > 0 && (
            <Button size="small" startIcon={<X size={12} />}
              onClick={() => { setSearch(''); setParam('kind', 'ALL', setKind); setParam('status', 'ALL', setStatus); }}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.body }}>
              Clear ({activeFilters})
            </Button>
          )}
        </Stack>

        <Box sx={{ mt: 1, pt: 1, borderTop: `1px solid ${O2D.lineSoft}` }}>
          <StatusLegend counts={counts} value={status} onPick={(s) => setParam('status', s, setStatus)} />
        </Box>

        <Collapse in={showGlossary}>
          <Box sx={{ mt: 1, p: 1.25, borderRadius: '7px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.lineSoft}` }}>
            <Eyebrow>How to read this table</Eyebrow>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 0.6, mt: 0.75 }}>
              {GLOSSARY.map(([term, meaning]) => (
                <Stack key={term} direction="row" spacing={0.75}>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: O2D.ink, minWidth: 118, flexShrink: 0 }}>{term}</Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>{meaning}</Typography>
                </Stack>
              ))}
            </Box>
          </Box>
        </Collapse>
      </Paper>

      {/* Open PO lines procurement holds that could not be attributed to a raw
          material item — usually a JSL line described by grade/width/finish with
          no SKU on it. Surfaced rather than swallowed: each one is material on
          its way that no item's In Transit figure is counting. */}
      {unmatchedPo.length > 0 && (
        <Alert severity="warning" icon={false}
          sx={{ borderRadius: '8px', py: 0.5, '& .MuiAlert-message': { width: '100%' } }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700 }}>
              {unmatchedPo.length} open purchase-order line{unmatchedPo.length > 1 ? 's' : ''} could not be matched to a raw-material item
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', opacity: 0.9 }}>
              — that material is on its way but is not counted in any In Transit figure below.
            </Typography>
            <Button size="small" onClick={() => setShowUnmatched((v) => !v)}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', ml: 'auto' }}>
              {showUnmatched ? 'Hide' : 'Show these lines'}
            </Button>
          </Stack>
          <Collapse in={showUnmatched}>
            <Box sx={{ mt: 1 }}>
              {unmatchedPo.map((u, i) => (
                <Typography key={`${u.poNumber}-${i}`} sx={{ fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace' }}>
                  {u.poNumber || '(no PO number)'} · {u.vendorName || 'no vendor'} · {u.skuCode || u.itemName
                    || [u.grade, u.width, u.finish].filter(Boolean).join(' ') || 'unnamed item'} · pending {num(u.pendingQty)} {u.unit} — {u.reason}
                </Typography>
              ))}
            </Box>
          </Collapse>
        </Alert>
      )}

      <Panel dense>
        <TableScroll>
          <Table size="small" sx={imsTableSx(1860)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell><Th label="SKU Code" hint={H.skuCode} /></TableCell>
                <TableCell><Th label="Item Name" hint={H.skuName} /></TableCell>
                <TableCell>Material</TableCell>
                <TableCell><Th label="UOM" hint={H.unit} /></TableCell>
                <TableCell align="right"><Th label="Total Available Quantity" hint={H.onHand} /></TableCell>
                <TableCell align="right"><Th label="Material In Transit" hint={H.inTransit} /></TableCell>
                <TableCell align="right"><Th label="Booked Qty" hint={H.booked} /></TableCell>
                <TableCell align="right"><Th label="Daily Avg Consumption" hint={H.adc} /></TableCell>
                <TableCell align="right"><Th label="Daily Consumption" hint={H.dailyConsumption} /></TableCell>
                {/* Safety Factor sits beside the levels it drives, and carries the
                    same label and the same ×-suffix as the Consumables stock list,
                    so a planner reads it the same way in either module. */}
                <TableCell align="right"><Th label="Safety Factor" hint={H.safetyFactor} /></TableCell>
                <TableCell align="right"><Th label="Lead Time (From Indent to Receipt)" hint={H.leadDays} /></TableCell>
                <TableCell align="right"><Th label="Reorder at" hint={H.reorderPoint} /></TableCell>
                <TableCell align="right"><Th label="Max Level" hint={H.maxLevel} /></TableCell>
                <TableCell align="right"><Th label="Available %" hint={H.availablePct} /></TableCell>
                <TableCell align="right"><Th label="Cover" hint={H.daysCover} /></TableCell>
                <TableCell><Th label="Vendor Name" hint={H.vendorName} /></TableCell>
                <TableCell><Th label="Status" hint={H.status} /></TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {isFetching && rows.length === 0 && (
                <TableRow><TableCell colSpan={19} sx={{ border: 0, p: 1.5 }}><Skeleton variant="rounded" height={280} /></TableCell></TableRow>
              )}
              {!isFetching && filtered.length === 0 && (
                <TableRow><TableCell colSpan={19} sx={{ border: 0 }}>
                  <EmptyNote icon={Layers} title="No raw material matches these filters"
                    hint="Try clearing the status filter, switching between coils and circles, or searching a different code." />
                </TableCell></TableRow>
              )}
              {paged.map((r, i) => {
                const t = stockToken(r.status);
                const critical = r.status === 'OUT_OF_STOCK' || r.status === 'REORDER';
                const band = availBand(r.availablePct);
                return (
                  <TableRow key={r.skuId} hover sx={{
                    ...(critical ? { bgcolor: t.tint, borderLeft: `3px solid ${t.color}` } : { borderLeft: '3px solid transparent' }),
                  }}>
                    {/* Derived from the page offset, not the array index, so page 2
                        continues at 26 rather than restarting at 1. Purely
                        presentational — it feeds no filter, sort or calculation. */}
                    <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>
                      {page * rowsPerPage + i + 1}
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      <Typography sx={{ fontSize: '0.73rem', color: O2D.body, fontFamily: 'ui-monospace, monospace' }}>{r.skuCode}</Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 240 }}>
                      <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 700, color: O2D.ink }} title={r.skuName}>{r.skuName}</Typography>
                    </TableCell>
                    <TableCell><KindChip kind={r.kind} /></TableCell>
                    <TableCell>
                      <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: O2D.sub }}>{uomOf(r)}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: O2D.ink }}>
                      {num(r.onHand)}
                      {/* Circles are counted in pieces AND weighed. The weight is
                          shown under the count, never added to it. */}
                      {r.kind === 'CIRCLE' && r.onHandKg > 0 && (
                        <Tooltip arrow slotProps={O2D_TIP}
                          title="The weight recorded alongside these pieces. A record only — planning, Max Level and Available % all work in pieces.">
                          <Typography sx={{ fontSize: '0.62rem', fontWeight: 600, color: O2D.faint, cursor: 'help' }}>
                            {num(r.onHandKg)} kg
                          </Typography>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}><InTransitCell row={r} /></TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.booked ? O2D.body : O2D.faint }}>{num0(r.booked)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}><AdcCell row={r} /></TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.dailyConsumption ? O2D.body : O2D.faint }}>
                      {r.dailyConsumption == null ? '—' : num(r.dailyConsumption)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.body }}>
                      {r.hasPolicy ? `${num(r.safetyFactor)}×` : <NotConfigured />}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: O2D.body }}>
                      {r.hasPolicy ? `${num(r.leadDays)}d` : <NotConfigured />}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num0(r.reorderPoint)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end" alignItems="center">
                        <span>{num0(r.maxLevel)}</span>
                        {/* "M" = this Max Level was typed in and ignores the formula,
                            so the Safety Factor beside it does not explain it. */}
                        {r.maxLevelMode === 'MANUAL' && (
                          <Tooltip arrow slotProps={O2D_TIP}
                            title={`Manually overridden. The formula would give ${num(r.formulaMaxLevel)} — changing the Safety Factor will not affect this value.`}>
                            <Box component="span" sx={{
                              fontSize: '0.6rem', fontWeight: 800, color: O2D.sub, cursor: 'help',
                              border: `1px solid ${O2D.line}`, borderRadius: '4px', px: 0.4, lineHeight: 1.5,
                            }}>M</Box>
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell align="right"><AvailMeter pct={r.availablePct} /></TableCell>
                    <TableCell align="right" sx={{
                      fontVariantNumeric: 'tabular-nums', fontWeight: 700,
                      color: band && band.color === '#b91c1c' ? STOCK_TOKENS.OUT_OF_STOCK.color : O2D.body,
                    }}>
                      {r.daysCover == null ? '—' : `${num(r.daysCover)}d`}
                    </TableCell>
                    <TableCell sx={{ maxWidth: 150 }}>
                      <Typography noWrap sx={{ fontSize: '0.73rem', color: r.vendorName ? O2D.body : O2D.faint }} title={r.vendorName}>
                        {r.vendorName || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell><StatusChip status={r.status} /></TableCell>
                    <TableCell align="right" sx={{ width: 84, whiteSpace: 'nowrap' }}>
                      <Tooltip arrow slotProps={O2D_TIP} title="Open this item — stock, planning, purchase orders and its day-by-day history">
                        <IconButton size="small" onClick={() => navigate(`/rm-ims/item/${r.skuId}`)} sx={{ color: O2D.sub }}><Eye size={15} /></IconButton>
                      </Tooltip>
                      <Tooltip arrow slotProps={O2D_TIP} title="Edit the planning policy (Daily Avg Consumption, Lead Time, Safety Factor, MOQ)">
                        <IconButton size="small" onClick={() => setEdit(r)} sx={{ color: O2D.sub }}><Pencil size={15} /></IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
        {/* Footer row: colour key on the left, pagination on the far right.
            flexWrap lets the two drop onto separate lines on tablet/mobile
            instead of forcing the panel to scroll sideways. */}
        <Box sx={{
          borderTop: `1px solid ${O2D.lineSoft}`,
          display: 'flex', flexWrap: 'wrap', alignItems: 'center',
          justifyContent: 'space-between', columnGap: 2, rowGap: 0.5, pl: { xs: 1, sm: 1.5 },
        }}>
          <ColorCodingLegend />
          <TablePagination
            component="div" count={filtered.length} page={page} onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage} onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50, 100]} labelRowsPerPage="Items per page:"
            sx={{ borderTop: 0, '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': { fontSize: '0.73rem', color: O2D.sub } }}
          />
        </Box>
      </Panel>

      {/* Availability bands, spelled out once so the meter never needs decoding. */}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center" sx={{ px: 0.5 }}>
        <Typography sx={{ fontSize: '0.68rem', color: O2D.faint, fontWeight: 700 }}>Availability bands:</Typography>
        {[[0, 'Under 33% — critically low'], [50, '33–66% — thin'], [90, '67–100% — comfortable'], [110, 'Over 100% — above plan']]
          .map(([p, label]) => {
            const b = availBand(p);
            return (
              <Chip key={label} size="small" label={label}
                sx={{
                  height: 21, fontSize: '0.66rem', fontWeight: 700, borderRadius: '999px',
                  bgcolor: O2D.surface, color: b.color, border: `1px solid ${b.color}44`,
                }} />
            );
          })}
      </Stack>

      {edit && <PolicyDialog row={edit} onClose={() => setEdit(null)} />}
    </RmShell>
  );
};

export default RmImsStockList;
