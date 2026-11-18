import React from 'react';
import { Box, Chip, Paper, Stack, Typography, Tooltip, alpha } from '@mui/material';
import { LayoutDashboard, Layers, PackagePlus, PackageMinus, Recycle, ShoppingCart, History, Disc3, CircleDashed, ArrowUpRight } from 'lucide-react';
import { ImsShell, O2D, O2D_TIP, num } from '../ims/imsMeta';
import { FLUENT, FLUENT_DEPTH } from './rmFluent';

// Everything visual comes from the shared IMS/O2D system — raw material is a
// different KIND of stock, not a different product. Re-exported here so the RM
// screens have one import line.
export * from '../ims/imsMeta';

// ── RM sub-navigation ────────────────────────────────────────────────────────
// Same workflow order as consumables, with Conversion slotted in where it
// actually happens: after material is issued, before you decide what to buy.
// Labels and order are the sidebar's (MainLayout → Raw Material), word for
// word, so a screen is called the same thing wherever it is reached from.
export const RM_NAV = [
  { label: 'Dashboard',              short: 'Dashboard', path: '/rm-ims',            icon: LayoutDashboard, exact: true },
  { label: 'Stock & Master Data',    short: 'Stock',     path: '/rm-ims/stock',      icon: Layers },
  { label: 'Stock In',               short: 'In',        path: '/rm-ims/stock-in',   icon: PackagePlus },
  { label: 'Stock Out',              short: 'Out',       path: '/rm-ims/stock-out',  icon: PackageMinus },
  { label: 'Cut Coils into Circles', short: 'Cut',       path: '/rm-ims/conversion', icon: Recycle },
  { label: 'Buying List',            short: 'Buy',       path: '/rm-ims/reorder',    icon: ShoppingCart },
  { label: 'Movement History',       short: 'History',   path: '/rm-ims/movements',  icon: History },
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
  { value: 'PRODUCTION_ISSUE', label: 'Used in production',  hint: 'Material sent to the line to be used in production.' },
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
      <Stack spacing={0.3} sx={{ width: 74, mx: 'auto', cursor: 'help' }}>
        <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: band.color, textAlign: 'center', lineHeight: 1 }}>
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


/**
 * The Raw Material KPI card. Built so nothing clips: the label wraps onto a
 * second line instead of being cut to "TOTAL …", the figure steps down a size
 * when it is long (₹8,74,008), the caption wraps to two lines, and the action
 * is a small arrow in the corner rather than words competing with the label.
 * The card is a real button (Tab, Enter / Space) and says when it is filtering.
 *
 * `compact` (the dashboard's single row of six): tighter padding, a smaller
 * icon, and the arrow moves down beside the caption so the label and the
 * figure get the card's full width. Same data, same click.
 */
export const RmKpiCard = ({
  label, value, sub, tone = FLUENT.blue, icon: Icon, onClick, active, hint, actionLabel = 'Open', testId, compact = false,
}) => {
  const clickable = !!onClick;
  const text = String(value ?? '');
  // Compact: the figure is also capped by the card's own width (container
  // units), so a long amount shrinks to fit instead of being cut off.
  // ~0.64em per digit / symbol and ~0.3em per comma or point at weight 800.
  const valueEm = [...text].reduce((w, ch) => w + (/[,.\s]/.test(ch) ? 0.3 : 0.64), 0) || 1;
  const valueSize = compact
    ? `min(${text.length > 11 ? '0.98rem' : text.length > 8 ? '1.1rem' : '1.28rem'}, calc(100cqi / ${valueEm.toFixed(2)}))`
    : (text.length > 11 ? '1.12rem' : text.length > 8 ? '1.25rem' : '1.45rem');
  const arrow = clickable && (
    <Box className="rm-kpi-go" aria-hidden sx={{ display: 'flex', color: tone.ink, opacity: active ? 1 : 0.45, flexShrink: 0, transition: 'opacity .15s, color .15s' }}>
      <ArrowUpRight size={compact ? 13 : 15} />
    </Box>
  );
  const onKey = (e) => {
    if (!clickable) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); }
  };
  const card = (
    <Paper
      elevation={0}
      data-testid={testId}
      onClick={onClick}
      onKeyDown={onKey}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-pressed={clickable ? !!active : undefined}
      aria-label={clickable ? `${label}: ${text}` : undefined}
      sx={{
        position: 'relative', minWidth: 0, height: '100%', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', gap: compact ? 0.5 : 0.75,
        ...(compact ? { px: 1.25, py: 1.1, containerType: 'inline-size' } : { p: 1.5 }), borderRadius: '10px',
        border: `1px solid ${active ? tone.accent : tone.border}`,
        bgcolor: active ? tone.tint : tone.bg,
        boxShadow: active ? `inset 0 0 0 1px ${tone.accent}, ${FLUENT_DEPTH.rest}` : FLUENT_DEPTH.rest,
        transition: 'box-shadow .15s, border-color .15s, transform .15s, background-color .15s',
        ...(clickable ? {
          cursor: 'pointer', outline: 'none',
          '&:hover': { borderColor: tone.accent, boxShadow: FLUENT_DEPTH.hover, transform: 'translateY(-1px)' },
          '&:hover .rm-kpi-go': { opacity: 1, color: tone.accent },
          '&:focus-visible': { boxShadow: `0 0 0 3px ${alpha(tone.accent, 0.3)}` },
        } : null),
      }}
    >
      {/* Compact: the header is two label-lines tall on every card, so the
          figures line up across the row whether the label wraps or not. */}
      <Stack direction="row" spacing={compact ? 0.75 : 1} alignItems={compact ? 'center' : 'flex-start'} sx={compact ? { minHeight: 28 } : undefined}>
        {Icon && (
          <Box sx={{
            width: compact ? 24 : 32, height: compact ? 24 : 32, borderRadius: compact ? '7px' : '8px',
            display: 'grid', placeItems: 'center', flexShrink: 0,
            bgcolor: '#fff', color: tone.accent, border: `1px solid ${tone.border}`,
          }}>
            <Icon size={compact ? 13 : 16} />
          </Box>
        )}
        {/* The label wraps (two lines at most) — never "TOTAL …". */}
        <Typography sx={{
          flex: 1, minWidth: 0, pt: compact ? 0 : 0.25,
          fontSize: compact ? '0.7rem' : '0.76rem', fontWeight: 600, color: tone.ink, lineHeight: compact ? 1.25 : 1.3, opacity: 0.9,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>{label}</Typography>
        {!compact && arrow}
      </Stack>
      <Typography sx={{
        fontSize: valueSize, fontWeight: 800, lineHeight: compact ? 1.2 : 1.15, color: tone.ink,
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }} title={text}>{value}</Typography>
      <Stack direction="row" alignItems={compact ? 'flex-end' : 'center'} spacing={compact ? 0.5 : 0.75} sx={{ mt: 'auto', minWidth: 0 }}>
        {sub && (
          <Typography title={typeof sub === 'string' ? sub : undefined} sx={{
            flex: 1, minWidth: 0, fontSize: compact ? '0.65rem' : '0.7rem', color: O2D.sub, lineHeight: compact ? 1.3 : 1.35,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{sub}</Typography>
        )}
        {compact && !active && arrow}
        {active && (
          <Box component="span" sx={{
            flexShrink: 0, px: 0.8, py: 0.15, borderRadius: '999px', fontSize: '0.6rem', fontWeight: 800,
            letterSpacing: '0.03em', textTransform: 'uppercase', color: '#fff', bgcolor: tone.accent,
          }}>Filtered</Box>
        )}
      </Stack>
    </Paper>
  );
  // Above the card and never interactive, so it can't sit over the filters.
  return hint || actionLabel ? (
    <Tooltip arrow placement="top" disableInteractive title={hint || actionLabel}
      slotProps={{ ...O2D_TIP, popper: { ...(O2D_TIP.popper || {}), sx: { ...(O2D_TIP.popper?.sx || {}), pointerEvents: 'none' } } }}>
      {card}
    </Tooltip>
  ) : card;
};

/**
 * The row the RM KPI cards sit in. Columns are set per screen size from the
 * number of cards, so a row of six never squeezes into six slivers: three a
 * row on a laptop, all six only on a wide screen.
 */
// `compact` (with compact cards): one row of all the cards from a desktop
// width up (lg), three a row on a tablet / small laptop, two on a phone.
export const RmKpiGrid = ({ count, compact = false, children }) => {
  const n = count || React.Children.count(children);
  const wide = n > 5 ? 3 : n;
  return (
    <Box sx={{
      display: 'grid', gap: compact ? 1 : 1.25, alignItems: 'stretch',
      // Compact: every row as tall as the tallest, so all cards match when they wrap.
      ...(compact ? { gridAutoRows: '1fr' } : null),
      gridTemplateColumns: compact ? {
        xs: `repeat(${Math.min(2, n)}, minmax(0, 1fr))`,
        sm: `repeat(${Math.min(3, n)}, minmax(0, 1fr))`,
        lg: `repeat(${n}, minmax(0, 1fr))`,
      } : {
        xs: '1fr',
        sm: `repeat(${Math.min(2, n)}, minmax(0, 1fr))`,
        md: `repeat(${Math.min(3, n)}, minmax(0, 1fr))`,
        lg: `repeat(${wide}, minmax(0, 1fr))`,
        xl: `repeat(${n}, minmax(0, 1fr))`,
      },
    }}>
      {children}
    </Box>
  );
};


// ── Form sections (the Register SKU form's look) ────────────────────────────
// Every RM form — the Planning policy dialog, Stock In and Stock Out — groups
// its fields in these cards, so they read like Register SKU: a rounded panel,
// a small uppercase label with an icon tile, an optional one-line hint, and an
// optional step number for the entry screens filled in order.
export const FormSection = ({ icon, title, hint, step, tone, fluent, actions, children, bodySx, testId }) => {
  const Icon = icon;
  // `fluent` (a FLUENT tone) gives the section a soft tinted header band on a
  // white body; `tone` (a STOCK_TOKENS entry) tints the whole card.
  const color = fluent?.accent || tone?.color || O2D.brand;
  return (
    <Paper elevation={0} data-testid={testId} sx={{
      p: { xs: 1.75, md: 2.25 }, borderRadius: fluent ? '10px' : '14px', minWidth: 0, overflow: 'hidden',
      border: `1px solid ${fluent ? fluent.border : tone ? tone.border : O2D.line}`,
      bgcolor: tone ? tone.tint : O2D.surface,
      boxShadow: fluent ? FLUENT_DEPTH.rest : tone ? 'none' : '0 1px 2px rgba(28,30,33,0.04)',
    }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{
        mb: hint ? 0.5 : 1.5,
        ...(fluent ? {
          mx: { xs: -1.75, md: -2.25 }, mt: { xs: -1.75, md: -2.25 }, px: { xs: 1.75, md: 2.25 }, py: 1.1,
          bgcolor: fluent.tint, borderBottom: `1px solid ${fluent.border}`, mb: 1.5,
        } : null),
      }}>
        {step != null ? (
          <Box sx={{
            width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
            fontSize: '0.72rem', fontWeight: 800, bgcolor: alpha(color, 0.12), color, border: `1px solid ${alpha(color, 0.25)}`,
          }}>{step}</Box>
        ) : Icon && (
          <Box sx={{ width: 24, height: 24, borderRadius: '8px', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: alpha(color, 0.12), color }}>
            <Icon size={13} strokeWidth={2.5} />
          </Box>
        )}
        <Typography sx={{
          fontSize: '0.72rem', fontWeight: 700, color: fluent ? fluent.ink : tone ? tone.color : O2D.sub,
          textTransform: 'uppercase', letterSpacing: '0.08em', mr: 'auto !important',
        }}>{title}</Typography>
        {actions}
      </Stack>
      {hint && <Typography sx={{ display: 'block', mb: 1.5, fontSize: '0.72rem', color: O2D.sub }}>{hint}</Typography>}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, ...bodySx }}>{children}</Box>
    </Paper>
  );
};

/** One live figure in a form's bottom bar — the Register SKU footer's summary. */
export const SummaryItem = ({ label, value, color = O2D.ink }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ display: 'block', fontSize: '0.7rem', color: O2D.sub }}>{label}</Typography>
    <Typography noWrap sx={{ fontSize: '0.88rem', fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
  </Box>
);

export default RmShell;
