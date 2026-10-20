import React from 'react';
import { Box, Chip, Stack, Typography, Tooltip, alpha } from '@mui/material';
import { LayoutDashboard, Layers, PackagePlus, PackageMinus, Recycle, ShoppingCart, History, Disc3, CircleDashed } from 'lucide-react';
import { ImsShell, O2D, O2D_TIP, num } from '../ims/imsMeta';

// Everything visual comes from the shared IMS/O2D system — raw material is a
// different KIND of stock, not a different product. Re-exported here so the RM
// screens have one import line.
export * from '../ims/imsMeta';

// ── RM sub-navigation ────────────────────────────────────────────────────────
// Same workflow order as consumables, with Conversion slotted in where it
// actually happens: after material is issued, before you decide what to buy.
export const RM_NAV = [
  { label: 'Overview',    short: 'Overview', path: '/rm-ims',            icon: LayoutDashboard, exact: true },
  { label: 'Stock list',  short: 'Stock',    path: '/rm-ims/stock',      icon: Layers },
  { label: 'Stock In',    short: 'In',       path: '/rm-ims/stock-in',   icon: PackagePlus },
  { label: 'Stock Out',   short: 'Out',      path: '/rm-ims/stock-out',  icon: PackageMinus },
  { label: 'Coil to Circle', short: 'Cut',   path: '/rm-ims/conversion', icon: Recycle },
  { label: 'Buying list', short: 'Buy',      path: '/rm-ims/reorder',    icon: ShoppingCart },
  { label: 'History',     short: 'History',  path: '/rm-ims/movements',  icon: History },
];

export const RmShell = (props) => <ImsShell {...props} navItems={RM_NAV} />;

// ── Where material physically sits ───────────────────────────────────────────
// The client's sheet records a 'Received At' against every receipt and every
// scrap line, and it only ever holds two values: the plant and the job worker
// who cuts most of the coil. They map onto the stock engine's existing
// `warehouse` field, so nothing new is invented here — the two codes the sheet
// already uses are simply given names.
//
// Job-work STOCK BEHAVIOUR (what counts as ours, transfers, reconciliation) is
// deliberately not modelled yet — this only records where an entry happened.
// The list and the default now live in their own import-light module, so the
// GRN Complete dialog can reuse the SAME two values without pulling the whole
// IMS component surface into the procurement bundle. Re-exported here so every
// RM screen keeps importing them from exactly where it always did.
export { RECEIVED_AT_OPTIONS, DEFAULT_RECEIVED_AT } from './receivedAt.js';

// ── Why stock moved ──────────────────────────────────────────────────────────
// Same vocabulary and the same wording as Consumables & Packaging, so a planner
// reads the identical list whichever IMS module they are standing in. The codes
// are the ones the API validates against.
// 'Vendor receipt' is deliberately absent: coils and circles received from a
// supplier are recorded as a GRN, signed by the MD and accepted by Incoming QC,
// which posts the accepted weight to RM stock by itself. Entering the same
// delivery here as well made it usable before QC and double-counted it once the
// QC posted. Movements already posted under that reason keep their History label.
export const STOCK_IN_REASON_OPTIONS = [
  { value: 'OPENING_STOCK',         label: 'Opening stock',          hint: 'The material that already existed when you started using IMS.' },
  { value: 'CORRECTION_ADJUSTMENT', label: 'Correction / adjustment', hint: 'Fixing a counting mistake so the system matches the physical store.' },
  { value: 'OTHER',                 label: 'Other',                  hint: 'Anything else — type your own reason so History can explain it later.' },
];

export const STOCK_OUT_REASON_OPTIONS = [
  { value: 'PRODUCTION_ISSUE', label: 'Production issue',    hint: 'Material issued to the line to be used in production.' },
  { value: 'MAINTENANCE',      label: 'Maintenance / upkeep', hint: 'Used servicing or maintaining the machines.' },
  { value: 'SAMPLE_TESTING',   label: 'Sample / testing',     hint: 'Taken for a sample, a trial or quality testing.' },
  { value: 'OTHER',            label: 'Other',                hint: 'Anything else — type your own reason so History can explain it later.' },
];

// ── Unit of measure ──────────────────────────────────────────────────────────
// Coil and Circle are NOT counted in the same unit, and that is the single
// easiest thing to get wrong on a raw-material screen: coil is weighed in kilos,
// circles are counted in pieces (the client's Total Available Quantity for a
// circle sums 'Qty (In Pcs)'). Every quantity column therefore says which.
export const uomOf = (row = {}) => row.unit || (row.kind === 'CIRCLE' ? 'PCS' : 'KGS');

// ── Coil vs Circle ───────────────────────────────────────────────────────────
// The one distinction that runs through every RM screen, so it gets its own
// consistent token pair rather than a plain outlined chip.
export const KIND_TOKENS = {
  COIL:   { color: '#0f766e', bg: '#ccfbf1', border: '#99f6e4', label: 'Coil',   icon: Disc3,
    meaning: 'Raw metal as it arrives from the mill, before it is cut.' },
  CIRCLE: { color: '#4338ca', bg: '#e0e7ff', border: '#c7d2fe', label: 'Circle', icon: CircleDashed,
    meaning: 'Blanks cut from a coil, ready for production.' },
};

export const kindToken = (k) => KIND_TOKENS[k] || KIND_TOKENS.COIL;

export const KindChip = ({ kind, withHint = true }) => {
  const t = kindToken(kind);
  const Icon = t.icon;
  const chip = (
    <Chip
      size="small" icon={<Icon size={12} />} label={t.label}
      sx={{
        height: 21, fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px',
        bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`,
        '& .MuiChip-icon': { color: t.color, ml: 0.7, mr: -0.3 }, '& .MuiChip-label': { px: 0.8 },
      }}
    />
  );
  return withHint ? <Tooltip arrow title={t.meaning} slotProps={O2D_TIP}><span>{chip}</span></Tooltip> : chip;
};

// ── Available-% meter ────────────────────────────────────────────────────────
// The sheet's own bands: under a third is critical, a third to two-thirds is
// thin, up to full is fine, over full is more than the plan calls for. Shown as
// a small bar rather than a bare percentage so the band reads at a glance.
export const availBand = (pct) => (
  pct == null ? null
    : pct < 33 ? { color: '#b91c1c', label: 'Critically low' }
      : pct <= 66 ? { color: '#b45309', label: 'Thin' }
        : pct <= 100 ? { color: '#15803d', label: 'Comfortable' }
          : { color: '#4338ca', label: 'Above plan' }
);

export const AvailMeter = ({ pct }) => {
  const band = availBand(pct);
  if (!band) return <Typography sx={{ fontSize: '0.72rem', color: O2D.faint }}>—</Typography>;
  return (
    <Tooltip arrow slotProps={O2D_TIP}
      title={`${band.label} — on-hand is ${num(pct)}% of the level this item is planned to hold.`}>
      <Stack spacing={0.3} sx={{ minWidth: 74, cursor: 'help' }}>
        <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: band.color, textAlign: 'right', lineHeight: 1 }}>
          {num(pct)}%
        </Typography>
        <Box sx={{ height: 4, borderRadius: 2, bgcolor: O2D.lineSoft, overflow: 'hidden' }}>
          <Box sx={{ height: '100%', width: `${Math.min(100, Math.max(2, pct))}%`, bgcolor: band.color, borderRadius: 2 }} />
        </Box>
      </Stack>
    </Tooltip>
  );
};

// ── Conversion yield ─────────────────────────────────────────────────────────
// Yield is THE number on the conversion screen — how much of a coil survived as
// usable circles. Anything under 85% is worth a second look on the shop floor.
export const yieldBand = (pct) => {
  const n = Number(pct || 0);
  if (n >= 92) return { color: '#15803d', bg: '#dcfce7', border: '#bbf7d0', label: 'Excellent' };
  if (n >= 85) return { color: '#0f766e', bg: '#ccfbf1', border: '#99f6e4', label: 'Good' };
  if (n >= 75) return { color: '#b45309', bg: '#fef3c7', border: '#fde68a', label: 'Below par' };
  return { color: '#b91c1c', bg: '#fee2e2', border: '#fecaca', label: 'Poor' };
};

export const YieldChip = ({ pct, withHint = true }) => {
  const b = yieldBand(pct);
  const chip = (
    <Chip
      size="small" label={`${num(pct)}%`}
      sx={{
        height: 21, fontWeight: 800, fontSize: '0.7rem', borderRadius: '999px',
        bgcolor: b.bg, color: b.color, border: `1px solid ${b.border}`, '& .MuiChip-label': { px: 0.9 },
      }}
    />
  );
  return withHint
    ? <Tooltip arrow slotProps={O2D_TIP} title={`${b.label} — ${num(pct)}% of the coil's weight came out as usable circles; the rest is scrap.`}><span>{chip}</span></Tooltip>
    : chip;
};

// Scrap-verification state → plain English.
export const SCRAP_LABEL = { PENDING: 'Not yet checked', JOB_WORK: 'Sent for job work', DONE: 'Verified' };
export const SCRAP_TONE = {
  PENDING: { color: '#b45309', bg: '#fef3c7', border: '#fde68a' },
  JOB_WORK: { color: '#4338ca', bg: '#e0e7ff', border: '#c7d2fe' },
  DONE: { color: '#15803d', bg: '#dcfce7', border: '#bbf7d0' },
};

export const ScrapChip = ({ state }) => {
  const t = SCRAP_TONE[state] || SCRAP_TONE.PENDING;
  return (
    <Chip
      size="small" label={SCRAP_LABEL[state] || state || '—'}
      sx={{
        height: 21, fontWeight: 700, fontSize: '0.67rem', borderRadius: '999px',
        bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`, '& .MuiChip-label': { px: 0.9 },
      }}
    />
  );
};

// ── Physical-coil cutting status ─────────────────────────────────────────────
// DERIVED from quantities, never picked by the operator. The server computes it
// (coilLineage.js → cuttingStatus / ledgerCoilState); `cuttingStatusOf` mirrors
// the same three-line rule ONLY for the live "after this round" preview, before
// anything is saved.
const CUT_EPS = 0.001;
export const cuttingStatusOf = ({ cutKg = 0, remainingKg = 0 } = {}) => {
  if (Number(cutKg) <= CUT_EPS) return 'NOT_CUT';
  if (Number(remainingKg) > CUT_EPS) return 'PARTIALLY_CUT';
  return 'FULLY_CUT';
};

export const CUT_STATUS_TONE = {
  NOT_CUT: { label: 'Not cut', color: '#475569', bg: '#f1f5f9', border: '#e2e8f0' },
  PARTIALLY_CUT: { label: 'Partially cut', color: '#b45309', bg: '#fef3c7', border: '#fde68a' },
  FULLY_CUT: { label: 'Fully cut', color: '#15803d', bg: '#dcfce7', border: '#bbf7d0' },
  // A ROUND that left metal on the coil.
  PARTIAL: { label: 'Partial', color: '#b45309', bg: '#fef3c7', border: '#fde68a' },
};

export const CutStatusChip = ({ status, label }) => {
  const t = CUT_STATUS_TONE[status] || CUT_STATUS_TONE.NOT_CUT;
  return (
    <Chip
      size="small" label={label || t.label}
      sx={{
        height: 21, fontWeight: 800, fontSize: '0.67rem', borderRadius: '999px', whiteSpace: 'nowrap',
        bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`, '& .MuiChip-label': { px: 0.9 },
      }}
    />
  );
};

// ── Numbered step header, shared by the three RM entry forms ─────────────────
export const StepHead = ({ n, title, hint, done }) => (
  <Stack direction="row" spacing={1} alignItems="center">
    <Box sx={{
      width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
      fontSize: '0.7rem', fontWeight: 800,
      bgcolor: done ? '#dcfce7' : alpha(O2D.brand, 0.1),
      color: done ? '#15803d' : O2D.brand,
      border: `1px solid ${done ? '#bbf7d0' : alpha(O2D.brand, 0.25)}`,
    }}>{n}</Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: O2D.ink, lineHeight: 1.25 }}>{title}</Typography>
      {hint && <Typography sx={{ fontSize: '0.68rem', color: O2D.sub }}>{hint}</Typography>}
    </Box>
  </Stack>
);

export default RmShell;
