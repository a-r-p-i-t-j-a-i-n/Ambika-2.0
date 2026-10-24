/**
 * "Available qty" filter for the IMS stock lists — what it can say and how it
 * matches a row. The field itself is QtyRangeFilter.jsx.
 *
 *   exact  a      exactly a              (on hand = a)
 *   below  a      fewer than a           (on hand < a)
 *   above  a      more than a            (on hand > a)
 *   range  a, b   a to b, both included  (a ≤ on hand ≤ b)
 *
 * The operator types it: "10" offers Exactly 10 / Below 10 / Above 10, "10-20" (or
 * "10 to 20") offers Between 10 and 20.
 */

export const NO_QTY_RANGE = { mode: '', a: null, b: null };

// One-click picks for the empty box — the cuts people ask for most.
export const QTY_PRESETS = [
  { mode: 'below', a: 10 },
  { mode: 'below', a: 15 },
  { mode: 'above', a: 15 },
  { mode: 'above', a: 80 },
  { mode: 'above', a: 100 },
];

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const RANGE_RE = new RegExp(String.raw`^\s*(${NUM})\s*(?:-|–|to)\s*(${NUM})\s*$`, 'i');
const NUMBER_RE = new RegExp(String.raw`^\s*(${NUM})\s*$`);

/** What the operator typed: a number, a range (low first), or nothing usable. */
export const parseQtyText = (text) => {
  const t = String(text || '');
  const r = t.match(RANGE_RE);
  if (r) {
    const x = Number(r[1]);
    const y = Number(r[2]);
    return { kind: 'range', a: Math.min(x, y), b: Math.max(x, y) };
  }
  const n = t.match(NUMBER_RE);
  if (n) return { kind: 'number', n: Number(n[1]) };
  return null;
};

/** Does an on-hand figure pass the filter? No filter passes everything. */
export const matchesQtyRange = (range, qty) => {
  if (!range?.mode) return true;
  const q = Number(qty || 0);
  if (range.mode === 'exact') return Math.abs(q - range.a) < 0.001;
  if (range.mode === 'below') return q < range.a;
  if (range.mode === 'above') return q > range.a;
  if (range.mode === 'range') return q >= range.a && q <= range.b;
  return true;
};

const fmt = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** The filter in words, for the field and its menu. */
export const describeQtyRange = (range) => {
  if (!range?.mode) return 'Any quantity';
  if (range.mode === 'exact') return `Exactly ${fmt(range.a)}`;
  if (range.mode === 'below') return `Below ${fmt(range.a)}`;
  if (range.mode === 'above') return `Above ${fmt(range.a)}`;
  return `${fmt(range.a)} – ${fmt(range.b)}`;
};

export const sameQtyRange = (x, y) => (x?.mode || '') === (y?.mode || '') && x?.a === y?.a && x?.b === y?.b;
