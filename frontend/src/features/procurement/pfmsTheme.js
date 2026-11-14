// ── Purchase FMS visual tokens ──────────────────────────────────────────────
// Purchase FMS started out reusing the O2D FMS design language verbatim. It
// still inherits the structure (hairline borders, 8px radius, compact table and
// typography scale) and the status language, but the SURFACE palette is now
// cool-neutral rather than O2D's warm greige: white panels on a very light
// slate canvas. O2D FMS keeps its warm look — o2dTheme.js is the owner of those
// values and is deliberately NOT edited here; only the keys listed in
// PFMS_SURFACES below are overridden for this module.
import { O2D, STATUS_TOKENS } from '../o2d-fms/o2dTheme';

// The cool-neutral surface set. Everything else (brand, body, band) falls
// through to O2D unchanged.
const PFMS_SURFACES = {
  ink:        '#0f172a', // primary text — slate ink, never black
  sub:        '#64748b', // secondary text / captions
  faint:      '#94a3b8', // placeholder / disabled glyphs
  line:       '#e2e8f0', // hairline borders
  lineSoft:   '#eef2f7', // row separators
  surface:    '#ffffff', // content panels
  surfaceAlt: '#f8fafc', // table head / tinted band
  canvas:     '#f4f6fa', // page background
};

export const PFMS = { ...O2D, ...PFMS_SURFACES };
export { STATUS_TOKENS };

// Shared sx fragments — reused across every Purchase FMS list/detail page
// instead of re-typing the same literals per file.
//
// `minHeight` is chrome-aware. A page rendered on its own route fills the
// viewport exactly as it always did, because --pfms-chrome is undefined and the
// fallback is 0px. A page rendered INSIDE the Purchase FMS hub sits below the
// hub's header + step rail, which publishes its measured height as
// --pfms-chrome (see PurchaseFmsHub.jsx) — without that subtraction the page is
// always taller than the window by the height of the hub chrome, which is what
// produced the permanent vertical scrollbar and the big empty canvas band under
// every table.
export const pfmsPageSx = {
  p: { xs: 1.5, md: 2 },
  minHeight: 'calc(100vh - var(--pfms-chrome, 0px))',
  bgcolor: PFMS.canvas,
};
// A step's own tab bar under the hub (StepWithQueue, GrnQcStep): fixed height,
// and the page under it subtracts hub + tabs (PurchaseFmsHub publishes
// --pfms-hub-chrome) so pfmsPageSx's minHeight still fits the window.
const STEP_TABS_HEIGHT = 40;
export const pfmsStepTabsSx = {
  minHeight: STEP_TABS_HEIGHT,
  height: STEP_TABS_HEIGHT,
  '& .MuiTab-root': { minHeight: STEP_TABS_HEIGHT, fontWeight: 700, textTransform: 'none' },
};
export const pfmsUnderStepTabsStyle = { '--pfms-chrome': `calc(var(--pfms-hub-chrome, 0px) + ${STEP_TABS_HEIGHT}px)` };
export const pfmsTitleSx ={ fontSize: '1rem', fontWeight: 800, color: PFMS.ink, lineHeight: 1.2 };
export const pfmsSubtitleSx = { fontSize: '0.72rem', color: PFMS.sub, fontWeight: 500 };
export const pfmsCardSx = { borderRadius: '8px', border: `1px solid ${PFMS.line}`, bgcolor: PFMS.surface };
// The KPI card row above every Purchase FMS list — one responsive grid for all
// steps (the layout Purchase Indents introduced): 2 cards per row on phones,
// up to 3 on tablets, the whole row on desktop. Rows longer than 6 cards
// (Advance Payments' 7) wrap at 4 on desktop, as they did before. Layout
// only — the cards themselves are unchanged.
// ── KPI summary row ──
// Every Purchase FMS summary row (11 step routes + the Awaiting queues) is laid
// out here, so all rows share one rhythm. The cards always fill 100% of the
// row: N cards = N equal columns. When a row is too narrow for all of them it
// wraps into equal columns, and a shorter last line stretches to the full
// width too — no empty space at the right, no horizontal overflow.
const KPI_GAP_PX = 10;
// Width of one card when `n` share a line (the half pixel keeps sub-pixel
// rounding from pushing the last card onto a new line; flex-grow takes it back).
const kpiBasis = (n) => `calc((100% - ${(n - 1) * KPI_GAP_PX}px) / ${n} - 0.5px)`;
// Cards per line by screen width (MUI default breakpoints; content width is the
// screen minus the sidebar). Medium screens split 5-6 cards 3+N, 7-8 cards 4+N.
const KPI_MD_COLS = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 3, 6: 3, 7: 4, 8: 4 };
const kpiCardsPerLine = (count) => ({
  xs: Math.min(count, 2),
  md: KPI_MD_COLS[count] || 4,
  lg: count <= 6 ? count : 4,
  xl: Math.min(count, 8), // ≥ 1400px: a 7-8 card row fits on one line
});
export const pfmsKpiRowSx = (count = 5) => {
  const per = kpiCardsPerLine(count);
  return {
    display: 'flex',
    flexWrap: 'wrap',
    gap: `${KPI_GAP_PX}px`,
    width: '100%',
    '& > *': { flex: `1 1 ${kpiBasis(per.xs)}`, minWidth: 0 },
    '@media (min-width: 900px)': { '& > *': { flexBasis: kpiBasis(per.md) } },
    '@media (min-width: 1200px)': { '& > *': { flexBasis: kpiBasis(per.lg) } },
    '@media (min-width: 1400px)': { '& > *': { flexBasis: kpiBasis(per.xl) } },
  };
};

// Coordinated light tones for KPI cards, one per KPI category. A card's
// `color` picks its tone (see kpiToneFor); every tone is a soft pastel
// surface + hairline border + icon chip around one saturated ink, so a row
// of mixed categories still reads as one family.
export const PFMS_KPI_TONES = {
  total:    { fg: '#1d4ed8', bg: '#f4f8ff', border: '#dbe6fd', chip: '#e3ecfe' }, // Total / All
  pending:  { fg: '#b45309', bg: '#fffaf1', border: '#f9e6c3', chip: '#fdeecf' }, // Pending / awaiting action
  progress: { fg: '#0f766e', bg: '#f1fbf9', border: '#cdeee7', chip: '#d8f3ee' }, // Approved / in progress
  done:     { fg: '#15803d', bg: '#f3fbf5', border: '#d2efdb', chip: '#dcf4e4' }, // Done / completed
  partial:  { fg: '#c2410c', bg: '#fff7f2', border: '#fbdfcd', chip: '#fee8da' }, // Partial
  negative: { fg: '#be123c', bg: '#fff5f7', border: '#f9d8e0', chip: '#fde3ea' }, // Cancelled / failed / delayed
  short:    { fg: '#7e22ce', bg: '#fbf7ff', border: '#eadcfa', chip: '#f2e7fd' }, // Short-closed
  payment:  { fg: '#0e7490', bg: '#f1fafc', border: '#cdebf2', chip: '#d9f1f7' }, // Payment / quote stage
  neutral:  { fg: '#475569', bg: '#f7f9fc', border: '#dfe5ee', chip: '#e8edf4' }, // Skipped / waiting on others
};
// The hex colours the screens pass, by category.
const KPI_TONE_BY_COLOR = {
  '#2563eb': 'total',
  '#b45309': 'pending', '#d97706': 'pending',
  '#0f766e': 'progress', '#4338ca': 'progress',
  '#16a34a': 'done', '#15803d': 'done',
  '#c2410c': 'partial',
  '#be123c': 'negative', '#dc2626': 'negative',
  '#7e22ce': 'short',
  '#0e7490': 'payment',
  '#64748b': 'neutral',
};
export const kpiToneFor = (color) => PFMS_KPI_TONES[KPI_TONE_BY_COLOR[String(color || '').toLowerCase()]] || null;
// Number inputs in form tables (GRN Material Receipt, QC Inspection): no
// up/down spinner, which crowds a narrow centred quantity.
export const pfmsNoSpinSx = {
  '& input[type=number]': { MozAppearance: 'textfield' },
  '& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
};
export const pfmsTableHeadSx = {
  bgcolor: PFMS.surfaceAlt,
  fontWeight: 800,
  fontSize: '0.66rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: PFMS.sub,
  borderBottom: `1px solid ${PFMS.line}`,
};

// Shared field styling for the filter toolbars — labels sit ABOVE the control
// so every filter reads as a labelled field rather than a floating select.
export const pfmsFieldLabelSx = {
  fontSize: '0.68rem',
  fontWeight: 700,
  color: PFMS.sub,
  mb: 0.5,
  display: 'block',
};

// Every Purchase FMS filter select uses '' as its "no filter" value, and ''
// is ALSO MUI's own "this field is empty" sentinel: SelectInput skips
// computing the display entirely unless isFilled(value) — which is false for
// '' — or displayEmpty is set (see @mui/material/Select/SelectInput.js, "No
// need to display any value if the field is empty"). Without this the
// selected `<MenuItem value="">All` is never rendered and the closed
// dropdown shows a zero-width space, so an unfiltered filter reads as blank
// rather than as "All". Spread onto every filter TextField's `SelectProps`.
export const ALL_WHEN_UNSET = { displayEmpty: true };
