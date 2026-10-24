// ── IMS design system ────────────────────────────────────────────────────────
// The IMS area speaks the SAME visual language as O2D: warm khaki canvas, crisp
// white panels, hairline borders, and colour that follows the STATE (never
// decoration). So we import the O2D palette rather than re-inventing one — one
// source of truth means a doer never has to learn a second colour code when they
// move from the order flow into inventory.
import { O2D, O2D_TIP } from '../o2d-fms/o2dTheme';

export { O2D, O2D_TIP };

// Stock status → the full visual chip. Same shape as O2D's STATUS_TOKENS:
// strong colour + chip background + border + a faint tint for row washes.
// `label` is what the client sees; `meaning` is the plain-English sentence we
// show in the legend / tooltip so nobody has to guess what "REORDER" implies.
export const STOCK_TOKENS = {
  OK: {
    color: '#15803d', bg: '#dcfce7', border: '#bbf7d0', tint: '#f2fdf5',
    label: 'Healthy', meaning: 'Comfortably above the reorder point — no action needed.',
  },
  LOW: {
    color: '#b45309', bg: '#fef3c7', border: '#fde68a', tint: '#fffbeb',
    label: 'Running low', meaning: 'Cover is thinning. Watch it — an order is coming due.',
  },
  REORDER: {
    color: '#c2410c', bg: '#ffedd5', border: '#fed7aa', tint: '#fff7ed',
    label: 'Order now', meaning: 'At or below the reorder point. Raise a purchase order today.',
  },
  OUT_OF_STOCK: {
    color: '#b91c1c', bg: '#fee2e2', border: '#fecaca', tint: '#fef2f2',
    label: 'Out of stock', meaning: 'Nothing on hand. Production can stop — order urgently.',
  },
  OVERSTOCK: {
    color: '#4338ca', bg: '#e0e7ff', border: '#c7d2fe', tint: '#f5f6ff',
    label: 'Overstocked', meaning: 'Above the max level. Money is parked in the store — hold off buying.',
  },
};

export const stockToken = (status) => STOCK_TOKENS[status] || STOCK_TOKENS.OK;

// The order we always list statuses in — worst first, so the eye lands on the
// problems before the healthy stock.
export const STOCK_ORDER = ['OUT_OF_STOCK', 'REORDER', 'LOW', 'OK', 'OVERSTOCK'];

// Movement direction. IN is a gain (green), OUT is a departure (warm orange —
// deliberately NOT red, because issuing to production is normal, not an error).
export const MOVE_TOKENS = {
  IN:  { color: '#15803d', bg: '#dcfce7', border: '#bbf7d0', sign: '+', label: 'In' },
  OUT: { color: '#c2410c', bg: '#ffedd5', border: '#fed7aa', sign: '−', label: 'Out' },
};

export const moveToken = (t) => (t === 'IN' ? MOVE_TOKENS.IN : MOVE_TOKENS.OUT);

// Transaction type → plain-English label. Internal codes never reach the screen.
export const TXN_LABEL = {
  GRN_IN: 'Vendor receipt', OPENING: 'Opening stock', ADJUST_IN: 'Added manually',
  // "Stock out", not "Issued…" — on the floor "issue" reads as "a problem".
  ADJUST_OUT: 'Removed manually', CONSUME_OUT: 'Stock out', QC_REJECT_OUT: 'QC rejected',
  RETURN_OUT: 'Returned to vendor', TRANSFER_IN: 'Transferred in', TRANSFER_OUT: 'Transferred out',
  DISPATCH_OUT: 'Dispatched',
  // Raw-material only — the two halves of a coil → circle conversion.
  CONVERT_OUT: 'Coil cut up', CONVERT_IN: 'Circles produced',
  // Finished-goods only — the two ends of the FG flow.
  PRODUCE_IN: 'Produced', SALES_RETURN_IN: 'Sales return',
};

export const txnLabel = (t) => TXN_LABEL[t] || t || '—';

// ── Formatters ───────────────────────────────────────────────────────────────
export const num = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// Short money for chart axes and tight tiles: ₹12L, ₹3.4Cr, ₹8k …
export const compactInr = (v) => {
  const n = Number(v || 0);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(n % 1e7 ? 1 : 0)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(n % 1e5 ? 1 : 0)}L`;
  if (n >= 1e3) return `₹${Math.round(n / 1e3)}k`;
  return `₹${n}`;
};

// ── Layout widths ────────────────────────────────────────────────────────────
// The one width every multi-line entry screen is capped at — Stock In, Stock
// Out, Production In, Dispatch Out, and the RM pair. It exists so a form never
// stretches into an unreadable single line of controls on an ultrawide monitor,
// NOT to keep the page narrow: with the 268px sidebar open, a 1920 viewport
// gives the content area ~1650px, so anything much below this leaves a wide
// dead margin down both sides while the table inside is still scrolling.
//
// It lives here rather than being retyped per screen because "the entry screens
// are all the same width" is the actual requirement — six literals drift, one
// token cannot.
export const IMS_FORM_MAX = 1680;

// ── Shared sx recipes ────────────────────────────────────────────────────────
// One table look for every IMS grid — warm hairlines, a tinted sticky-feeling
// header, and hover that lifts the row without shouting.
export const imsTableSx = (minWidth) => ({
  minWidth,
  '& td, & th': { borderColor: O2D.lineSoft },
  '& tbody tr:hover': { bgcolor: O2D.surfaceAlt },
  '& thead th': {
    bgcolor: O2D.surfaceAlt, fontWeight: 800, fontSize: '0.66rem', textTransform: 'uppercase',
    letterSpacing: '0.04em', color: O2D.sub, borderBottom: `1px solid ${O2D.line}`, whiteSpace: 'nowrap',
  },
  '& tbody td': { fontSize: '0.8rem', color: O2D.body },
});

// Numbers always line up column-to-column.
export const numCell = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

// `minWidth: 0` is load-bearing, not cosmetic. A panel is almost always a flex
// or grid child, and those default to `min-width: auto` — meaning the panel
// refuses to shrink below its widest content. A 1120px-wide table then stretches
// the panel past the viewport and the inner scroller never gets a chance to
// scroll. Resetting it to 0 hands the overflow back to `hScrollSx` below.
export const panelSx = {
  borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface, minWidth: 0,
};

// The horizontal scroller every wide IMS table sits inside. The scrollbar is
// styled to always read as a scrollbar (thin, warm, visible on the tinted track)
// so nobody assumes the table simply ends at the right edge of the screen.
export const hScrollSx = {
  overflowX: 'auto',
  maxWidth: '100%',
  // Firefox
  scrollbarWidth: 'thin',
  scrollbarColor: `${O2D.faint} ${O2D.surfaceAlt}`,
  // WebKit / Chromium
  '&::-webkit-scrollbar': { height: 9 },
  '&::-webkit-scrollbar-track': { background: O2D.surfaceAlt, borderRadius: 999 },
  '&::-webkit-scrollbar-thumb': {
    background: '#c9c4b8', borderRadius: 999, border: `2px solid ${O2D.surfaceAlt}`,
  },
  '&::-webkit-scrollbar-thumb:hover': { background: O2D.faint },
};
