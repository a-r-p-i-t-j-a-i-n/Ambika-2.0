import React from 'react';
import { Box, Chip, Tooltip } from '@mui/material';
import {
  LayoutDashboard, Recycle, Factory, Truck, Scissors, AlertTriangle,
  ArrowDownToLine, ArrowUpFromLine, ScrollText, Disc3, ListOrdered, ClipboardCheck,
} from 'lucide-react';
import { ImsShell, O2D, O2D_TIP, num } from '../ims/imsMeta';

// Everything visual comes from the shared IMS/O2D system — scrap is a
// different KIND of record, not a different product. Re-exported here so the
// scrap screens have one import line, the same way RM does.
export * from '../ims/imsMeta';

// Scrap gets its own accent, as Finished Goods does, so a glance at the header
// says which module you are in.
export const SCRAP_ACCENT = '#b45309';

// ── Scrap sub-navigation ─────────────────────────────────────────────────────
// Two halves, in this order on purpose. The register is the PRODUCTION record —
// one row per cut, the yield story. Scrap In / Out and the ledger are the
// BALANCE — how much scrap is actually in the yard. They are different numbers
// and the menu should not imply otherwise.
export const SCRAP_NAV = [
  { label: 'Overview', short: 'Overview', path: '/scrap-ims', icon: LayoutDashboard, exact: true },
  { label: 'Scrap master data', short: 'Master data', path: '/scrap-ims/records', icon: Recycle },
  // Every cut, one row each — the per-cut register master data groups by coil SKU.
  { label: 'Cut history', short: 'History', path: '/scrap-ims/history', icon: ListOrdered },
  /**
   * Scrap by the PHYSICAL coil it came off.
   *
   * It has to be in the menu. The panel also sits on the Overview, and that was
   * not enough to make it findable — "how much scrap came off THAT coil" is a
   * question people arrive with already formed, and a section three panels down
   * a dashboard is not somewhere a colleague can be sent. A menu item is also a
   * URL that can be pasted into a message.
   *
   * Placed after the register because it reads the same records, grouped: the
   * register is one row per CUT, this is one row per COIL.
   */
  { label: 'By physical coil', short: 'By coil', path: '/scrap-ims/by-coil', icon: Disc3 },
  { label: 'Scrap In', short: 'In', path: '/scrap-ims/scrap-in', icon: ArrowDownToLine },
  { label: 'Scrap Out', short: 'Out', path: '/scrap-ims/scrap-out', icon: ArrowUpFromLine },
  { label: 'Scrap movement', short: 'Movement', path: '/scrap-ims/movements', icon: ScrollText },
];

// ── Where scrap is HELD ──────────────────────────────────────────────────────
// The same two codes as the cutting locations, because they are warehouses in
// the ledger already, plus MAIN for a central store.
export const SCRAP_WAREHOUSE_OPTIONS = [
  { value: 'PLG01', label: 'PLG01 — Plant', hint: 'In-house yard. Scrap from in-house cutting lands here automatically.' },
  { value: 'JW001', label: 'JW001 — Job work', hint: 'Job worker’s site. Only use this for scrap you genuinely hold there.' },
  { value: 'MAIN', label: 'MAIN — Main store', hint: 'The central store, for scrap moved in from elsewhere.' },
];
export const DEFAULT_SCRAP_WAREHOUSE = 'PLG01';

// ── Why scrap moved ──────────────────────────────────────────────────────────
// Scrap gets its own vocabulary rather than the shared IMS one: the stock-in
// list is built around buying and scrap is never bought, and the stock-out list
// is built around consuming and scrap is never consumed — it is sold or dumped.
export const SCRAP_IN_REASON_OPTIONS = [
  { value: 'PRODUCTION_RETURN', label: 'Returned from production', hint: 'Offcuts brought back from the shop floor that no cut recorded.' },
  { value: 'JOB_WORK_RETURN', label: 'Returned by job worker', hint: 'A job worker sent the offcuts back, so they become our stock.' },
  { value: 'OPENING_STOCK', label: 'Opening stock', hint: 'Scrap already lying in the yard when it was first counted.' },
  { value: 'CORRECTION_ADJUSTMENT', label: 'Correction / adjustment', hint: 'The recorded figure was below what is physically there.' },
  { value: 'OTHER', label: 'Other', hint: 'Anything else — say what in your own words.' },
];

export const SCRAP_OUT_REASON_OPTIONS = [
  { value: 'SALE', label: 'Sold', hint: 'Sold to a scrap buyer. Record who, so the register can answer for it later.' },
  { value: 'DISPOSAL', label: 'Disposed of', hint: 'Dumped or destroyed — it left the yard and is not coming back.' },
  { value: 'TRANSFER', label: 'Transferred out', hint: 'Moved to another site or a job worker.' },
  { value: 'CORRECTION_ADJUSTMENT', label: 'Correction / adjustment', hint: 'The recorded figure was above what is physically there.' },
  { value: 'OTHER', label: 'Other', hint: 'Anything else — say what in your own words.' },
];

export const ScrapShell = (props) => <ImsShell {...props} navItems={SCRAP_NAV} accent={SCRAP_ACCENT} />;

// ── Where the cutting happened ───────────────────────────────────────────────
// The single most important distinction in this module. In-house scrap is metal
// Ambika physically has; job-work scrap stayed with the job worker and is only
// ever a yield measurement. Every screen shows the two apart.
export const LOCATION_TOKENS = {
  PLG01: {
    label: 'PLG01 — Plant', short: 'Plant', color: '#0f766e', bg: '#ccfbf1', border: '#99f6e4', icon: Factory,
    meaning: 'Cut in-house. This is the only scrap Ambika physically holds.',
  },
  JW001: {
    label: 'JW001 — Job work', short: 'Job work', color: '#7c3aed', bg: '#ede9fe', border: '#ddd6fe', icon: Truck,
    meaning: 'Cut by an outside job worker. The offcuts stayed with them — tracked for yield, not held as stock.',
  },
};
export const locationToken = (l) => LOCATION_TOKENS[l] || LOCATION_TOKENS.PLG01;

export const LocationChip = ({ location, withHint = true }) => {
  const t = locationToken(location);
  const Icon = t.icon;
  const chip = (
    <Chip
      size="small" icon={<Icon size={12} />} label={t.short}
      sx={{
        height: 21, fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px',
        bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`,
        '& .MuiChip-icon': { color: t.color, ml: 0.7, mr: -0.3 }, '& .MuiChip-label': { px: 0.8 },
      }}
    />
  );
  return withHint ? <Tooltip arrow title={t.meaning} slotProps={O2D_TIP}><span>{chip}</span></Tooltip> : chip;
};

// ── What was decided about the scrap ─────────────────────────────────────────
// The client's vocabulary is LOCATION-SPECIFIC and that is not an accident:
// Done/Rejected only ever appear against in-house cutting, Job work only
// against the job worker. The wording here is theirs, not a generic status set.
export const DISPOSITION_TOKENS = {
  DONE:     { label: 'Verified',   color: '#15803d', bg: '#dcfce7', border: '#bbf7d0', meaning: 'Weighed and accounted for in-house.' },
  JOB_WORK: { label: 'Job work',   color: '#7c3aed', bg: '#ede9fe', border: '#ddd6fe', meaning: 'Left with the job worker — never came back as stock.' },
  REJECTED: { label: 'Rejected',   color: '#b91c1c', bg: '#fee2e2', border: '#fecaca', meaning: 'Verification failed for this batch.' },
  PENDING:  { label: 'Not checked', color: '#b45309', bg: '#fef3c7', border: '#fde68a', meaning: 'Scrap has not been physically verified yet. It does NOT leave coil stock until it is.' },
};
export const dispositionToken = (d) => DISPOSITION_TOKENS[d] || DISPOSITION_TOKENS.PENDING;

export const DispositionChip = ({ disposition, withHint = true }) => {
  const t = dispositionToken(disposition);
  const chip = (
    <Chip
      size="small" label={t.label}
      sx={{
        height: 21, fontWeight: 700, fontSize: '0.68rem', borderRadius: '999px',
        bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`, '& .MuiChip-label': { px: 0.9 },
      }}
    />
  );
  return withHint ? <Tooltip arrow title={t.meaning} slotProps={O2D_TIP}><span>{chip}</span></Tooltip> : chip;
};

// ── Cut vs uncut ─────────────────────────────────────────────────────────────
// Fifteen rows of the client's sheet are coils that were never cut. Their
// circle weight is blank, so the sheet's own `coil − circles` formula reports
// the WHOLE coil as scrap. They are shown, flagged, and left out of every total.
export const BATCH_STATUS_TOKENS = {
  CUT: {
    label: 'Cut', color: '#0f766e', bg: '#ccfbf1', border: '#99f6e4',
    meaning: 'The coil was cut and this scrap is real.',
  },
  UNCUT: {
    label: 'Not cut', color: '#b45309', bg: '#fef3c7', border: '#fde68a',
    meaning: 'This coil was never cut, so no scrap came off it. The sheet reports the whole coil as scrap because its circle weight is blank — excluded from every total here.',
  },
  // Not a batch status: a record that is a Stock Correction of the coil SKU's
  // scrap (entryType CORRECTION) — shown in the same column, in its place.
  CORRECTION: {
    label: 'Correction', color: '#7c3aed', bg: '#f3e8ff', border: '#e9d5ff',
    meaning: 'A stock correction of this coil SKU\'s scrap — the change it made. Not a cut: no coil, circles or yield.',
  },
};
export const batchStatusToken = (s) => BATCH_STATUS_TOKENS[s] || BATCH_STATUS_TOKENS.CUT;

/** A record's status — or, for a correction, what it corrected (`remarks`). */
export const BatchStatusChip = ({ batchStatus, entryType, remarks }) => {
  const correction = entryType === 'CORRECTION';
  const t = batchStatusToken(correction ? 'CORRECTION' : batchStatus);
  return (
    <Tooltip arrow title={correction && remarks ? remarks : t.meaning} slotProps={O2D_TIP}>
      <Chip
        size="small" icon={correction ? <ClipboardCheck size={11} /> : batchStatus === 'UNCUT' ? <AlertTriangle size={11} /> : <Scissors size={11} />}
        label={t.label}
        sx={{
          height: 21, fontWeight: 700, fontSize: '0.67rem', borderRadius: '999px', cursor: 'help',
          bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`,
          '& .MuiChip-icon': { color: t.color, ml: 0.7, mr: -0.3 }, '& .MuiChip-label': { px: 0.8 },
        }}
      />
    </Tooltip>
  );
};

// ── Yield bands ──────────────────────────────────────────────────────────────
// These mirror the conditional formatting on column N ("Yield Ratio") of the
// client's `Summary Scrap` sheet, in the sheet's own rule order.
//
// The direction is the opposite of "higher is better", and that is deliberate.
// Circles cut out of a coil cannot pack tighter than roughly 86% of its weight,
// so a yield ABOVE that is not a good cut — it means the scrap was under-weighed
// and the row needs checking. The sheet flags it red for exactly that reason.
//
//   > 86%        red    (#EA9999 in the sheet)  implausible — check the weights
//   75% – 86%    green  (#B6D7A8)               the normal working band
//   < 74%        amber  (#FFD966)               poor utilisation, real scrap loss
//   74% – 75%    unbanded                       see the gap note below
//
// Rule order matters: the sheet's red and amber rules outrank its green one, so
// a verified batch still reads red when its yield is above 86%.
//
// The 74–75% gap is the sheet's own inconsistency — its amber rule stops at 74%
// while its green rule starts at 75%, leaving that slice matching no rule. The
// green rule also ORs in `Scrap Verified = Done / Job Work`, which is the only
// thing that can colour a yield sitting inside the gap. Both are reproduced
// rather than smoothed over, so this module and the sheet agree cell for cell.
export const YIELD_HIGH_PCT = 86;  // above this the sheet flags the row red
export const YIELD_LOW_PCT = 74;   // below this the sheet flags the row amber
export const YIELD_GOOD_PCT = 75;  // where the sheet's green band starts

export const YIELD_BANDS = {
  HIGH:     { key: 'HIGH',     color: '#b91c1c', label: 'Check',      excelFill: '#EA9999' },
  NORMAL:   { key: 'NORMAL',   color: '#15803d', label: 'Normal',     excelFill: '#B6D7A8' },
  LOW:      { key: 'LOW',      color: '#b45309', label: 'Low',        excelFill: '#FFD966' },
  UNBANDED: { key: 'UNBANDED', color: O2D.faint, label: 'Borderline', excelFill: null },
};

// `disposition` is the sheet's "Scrap Verified" column (Done / Job Work), and
// only changes the outcome inside the 74–75% gap.
export const yieldBand = (pct, disposition) => {
  const n = Number(pct);
  if (pct == null || !Number.isFinite(n)) return null;
  if (n > YIELD_HIGH_PCT) return YIELD_BANDS.HIGH;
  if (n < YIELD_LOW_PCT) return YIELD_BANDS.LOW;
  if (n >= YIELD_GOOD_PCT && n < YIELD_HIGH_PCT) return YIELD_BANDS.NORMAL;
  // Left over: 74–75%, and exactly 86% — the sheet's green rule is `< 86`, not `<=`.
  return (disposition === 'DONE' || disposition === 'JOB_WORK')
    ? YIELD_BANDS.NORMAL
    : YIELD_BANDS.UNBANDED;
};

const YIELD_MEANING = {
  HIGH: `which is above the ${YIELD_HIGH_PCT}% a coil can physically yield — the scrap for this cut was most likely under-weighed. Worth checking before the figure is trusted.`,
  NORMAL: `inside the normal ${YIELD_GOOD_PCT}–${YIELD_HIGH_PCT}% working band.`,
  LOW: `below ${YIELD_LOW_PCT}% — an unusual amount of this coil was lost as scrap.`,
  UNBANDED: `between ${YIELD_LOW_PCT}% and ${YIELD_GOOD_PCT}%, which the client's sheet leaves unbanded. It reads as normal once the scrap has been verified.`,
};

export const YieldChip = ({ pct, disposition }) => {
  const b = yieldBand(pct, disposition);
  if (!b) return <Box component="span" sx={{ color: O2D.faint }}>—</Box>;
  return (
    <Tooltip arrow slotProps={O2D_TIP}
      title={`${b.label} — ${num(pct)}% of the coil's weight came out as usable circles, ${YIELD_MEANING[b.key]}`}>
      <Chip size="small" label={`${num(pct)}%`}
        sx={{
          height: 21, fontWeight: 800, fontSize: '0.68rem', borderRadius: '999px', cursor: 'help',
          bgcolor: `${b.color}14`, color: b.color, border: `1px solid ${b.color}55`,
          '& .MuiChip-label': { px: 0.9 },
        }}
      />
    </Tooltip>
  );
};

/**
 * Scrap is weighed, always. Spelled KGS, the way the scrap SKU and the RM coils
 * are — the screens used to say "KG" while the ledger said "KGS", which reads
 * like two different units for the same pile of metal.
 */
export const SCRAP_UOM = 'KGS';

/**
 * A number field with no spinner arrows.
 *
 * `type="number"` still does the work that matters — a numeric keypad on a
 * phone, and rejecting letters — but the little up/down arrows are wrong for a
 * weight: nobody nudges a scrap load from 0 to 1 kg a click at a time, and they
 * steal width from the field on a narrow screen. Stepping is removed, typing is
 * not.
 */
export const noSpinnerSx = {
  '& input[type=number]': { MozAppearance: 'textfield' },
  '& input[type=number]::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 },
  '& input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
};

export const kg = (v) => (v == null ? '—' : `${num(v)} kg`);

// ── Scrap movement types ─────────────────────────────────────────────────────
export const SCRAP_TXN_TOKENS = {
  SCRAP_IN: { label: 'In', color: '#15803d', bg: '#dcfce7', border: '#bbf7d0' },
  SCRAP_OUT: { label: 'Out', color: '#b91c1c', bg: '#fee2e2', border: '#fecaca' },
  // IMS → Stock Correction: the yard counted, the balance set to the count.
  ADJUST_IN: { label: 'Correction +', color: '#1d4ed8', bg: '#dbeafe', border: '#bfdbfe' },
  ADJUST_OUT: { label: 'Correction −', color: '#7c3aed', bg: '#ede9fe', border: '#ddd6fe' },
};

export const ScrapTxnChip = ({ txnType }) => {
  const t = SCRAP_TXN_TOKENS[txnType] || SCRAP_TXN_TOKENS.SCRAP_IN;
  return (
    <Chip
      size="small" label={t.label}
      sx={{
        height: 21, fontWeight: 800, fontSize: '0.68rem', borderRadius: '999px',
        bgcolor: t.bg, color: t.color, border: `1px solid ${t.border}`, '& .MuiChip-label': { px: 0.9 },
      }}
    />
  );
};

/** Human wording for the stored reason codes, both directions in one map. */
export const SCRAP_REASON_LABEL = Object.fromEntries([
  ...SCRAP_IN_REASON_OPTIONS,
  ...SCRAP_OUT_REASON_OPTIONS,
  // The cut posts its own code, which no operator ever picks from a list.
  { value: 'CUTTING_OFFCUT', label: 'Offcut from an in-house cut' },
].map((o) => [o.value, o.label]));

export default ScrapShell;
