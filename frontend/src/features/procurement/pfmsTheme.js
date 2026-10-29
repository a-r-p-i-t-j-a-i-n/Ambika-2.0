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
