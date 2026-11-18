// IMS Fluent design tokens — shared by Consumables & Packaging, Raw Material
// and Finished Goods. Plain values only (no components), so the *Meta.jsx
// component files stay fast-refresh friendly. Scrap and the rest of the ERP do
// not import this file; their look is unchanged.
import { O2D, STOCK_TOKENS } from './imsTheme';

// ── Fluent-inspired palette ─────────────────────────────────────────────────
// Soft tints for cards, section bands and rows, each with a stronger accent for
// the icon / figure and a deep ink for text on the tint.
export const FLUENT = {
  blue:     { bg: '#f3f8fe', tint: '#eaf3fd', border: '#cfe2f8', accent: '#1f6fd1', ink: '#123a6b' },
  teal:     { bg: '#f1faf9', tint: '#e3f5f2', border: '#c3e7e1', accent: '#0f7b70', ink: '#0d4a44' },
  green:    { bg: '#f2fbf5', tint: '#e4f6ea', border: '#c4e8d0', accent: '#15803d', ink: '#0f4a25' },
  lavender: { bg: '#f6f4fd', tint: '#eeeafb', border: '#ddd6f5', accent: '#5b4bc4', ink: '#33296f' },
  orange:   { bg: '#fef7f0', tint: '#fdeedf', border: '#f6d9bd', accent: '#c4560d', ink: '#6b2f07' },
  amber:    { bg: '#fefaf0', tint: '#fdf3dc', border: '#f3e1ad', accent: '#a86a06', ink: '#5c3a03' },
  rose:     { bg: '#fef5f5', tint: '#fde9e9', border: '#f5cfcf', accent: '#b42323', ink: '#661414' },
  grey:     { bg: '#f7f8fa', tint: '#eef0f3', border: '#dde1e7', accent: '#4b5563', ink: '#1f2937' },
};

// Fluent depth 4 (resting) and depth 8 (hover).
export const FLUENT_DEPTH = {
  rest: '0 1.6px 3.6px rgba(15,23,42,0.07), 0 0.3px 0.9px rgba(15,23,42,0.06)',
  hover: '0 3.2px 7.2px rgba(15,23,42,0.10), 0 0.6px 1.8px rgba(15,23,42,0.08)',
};

/**
 * The standard IMS table: a soft-blue header, airy rows, a quiet zebra and a
 * clear hover. `zebra: false` for a table whose rows carry their own tint.
 */
export const fluentTableSx = (minWidth, { zebra = true } = {}) => ({
  minWidth,
  '& td, & th': { borderColor: '#edf0f5' },
  '& thead th': {
    bgcolor: '#f2f6fc', color: '#3b4a63', fontWeight: 700, fontSize: '0.68rem',
    letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap',
    py: 1.1, borderBottom: '1px solid #dfe7f2',
  },
  '& tbody td': { fontSize: '0.8rem', color: O2D.body, py: 1.1 },
  ...(zebra ? { '& tbody tr:nth-of-type(even)': { bgcolor: '#fbfcfe' } } : null),
  '& tbody tr:hover': { bgcolor: '#f1f6fe' },
});
// The Raw Material name for the same recipe.
export const rmTableSx = fluentTableSx;

// ── Header buttons ──────────────────────────────────────────────────────────
// The quiet outlined button (secondary actions: "Open Stock List", "Export")
// and the filled primary one, the same height as the dashboard alert button.
export const headerBtnSx = {
  textTransform: 'none', fontWeight: 700, borderRadius: '8px', height: 32, whiteSpace: 'nowrap',
  borderColor: FLUENT.grey.border, color: O2D.body, bgcolor: '#fff',
  '&:hover': { borderColor: FLUENT.blue.accent, bgcolor: FLUENT.blue.bg },
};
export const primaryBtnSx = (bg = O2D.brand, hover) => ({
  textTransform: 'none', fontWeight: 700, borderRadius: '8px', height: 32, whiteSpace: 'nowrap',
  bgcolor: bg, '&:hover': { bgcolor: hover || bg, filter: hover ? 'none' : 'brightness(0.92)' },
});

// ── Stock status → pastel ───────────────────────────────────────────────────
// Panels, verdicts and rows that used to wash in the status colour (out of
// stock = light red) take a pastel instead. The status CHIP keeps the shared
// STOCK_TOKENS colour — that is the one place the genuine severity is shown —
// so nothing about what a status means, or when it applies, changes.
export const STATUS_FLUENT = {
  OK: FLUENT.teal,
  LOW: FLUENT.amber,
  REORDER: FLUENT.amber,
  OUT_OF_STOCK: FLUENT.orange,
  OVERSTOCK: FLUENT.lavender,
};
export const fluentForStatus = (status) => STATUS_FLUENT[status] || FLUENT.grey;
// The pastel for a STOCK_TOKENS entry (verdict panels pass the token itself).
export const pastelOf = (token) => fluentForStatus(Object.keys(STOCK_TOKENS).find((k) => STOCK_TOKENS[k] === token));
// A verdict / notice panel in that pastel: the tint, its border, and deep ink text.
export const pastelPanelSx = (token) => {
  const t = pastelOf(token);
  return { border: `1px solid ${t.border}`, bgcolor: t.bg };
};

// Problem rows in a stock list: a soft pastel wash and a muted left edge, so
// they are findable while scrolling without a wall of red.
const ROW_TONE = {
  OUT_OF_STOCK: { bg: '#fff6ef', edge: '#eba47c' }, // apricot
  REORDER: { bg: '#fffaee', edge: '#e9bf6b' },      // soft amber
};
export const statusRowSx = (status) => {
  const t = ROW_TONE[status];
  return t
    ? { bgcolor: t.bg, '& > td:first-of-type': { boxShadow: `inset 3px 0 0 ${t.edge}` } }
    : null;
};

// Lists where EVERY row is a problem (Buying List, Production Plan): no wash,
// only the muted pastel left edge — the Status chip carries the severity.
export const statusEdgeSx = (status) => ({
  '& > td:first-of-type': { boxShadow: `inset 3px 0 0 ${ROW_TONE[status]?.edge || fluentForStatus(status).border}` },
});
// Text that explains a status ("Why it's here"): the pastel's deep accent, not red.
export const statusInk = (status) => fluentForStatus(status).accent;

// A form line that asks for more than the store holds: pastel amber, not red.
// The quantity field itself still shows its error state.
export const overLineRowSx = { bgcolor: '#fffaee', '& > td:first-of-type': { boxShadow: 'inset 3px 0 0 #e9bf6b' } };

// A percentage of target → a pastel pill tone. Low cover reads orange, not red.
export const pctFluent = (p) => {
  if (p == null) return FLUENT.grey;
  if (p < 33) return FLUENT.orange;
  if (p <= 66) return FLUENT.amber;
  if (p <= 110) return FLUENT.teal;
  return FLUENT.lavender;
};
