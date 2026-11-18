// Raw Material IMS design tokens — plain values only (no components), so
// rmImsMeta.jsx can stay a components file for React fast refresh.
import { O2D } from '../ims/imsTheme';

// ── Fluent-inspired palette (Raw Material only) ─────────────────────────────
// Soft tints for cards and section headers, each with a stronger accent for the
// icon and the figure. Raw Material screens only — Consumables, Finished Goods
// and Scrap keep their own look.
export const FLUENT = {
  blue:     { bg: '#f3f8fe', tint: '#eaf3fd', border: '#cfe2f8', accent: '#1f6fd1', ink: '#123a6b' },
  teal:     { bg: '#f1faf9', tint: '#e3f5f2', border: '#c3e7e1', accent: '#0f7b70', ink: '#0d4a44' },
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
 * The standard Raw Material table: a soft-blue header, airy rows, a quiet
 * zebra and a clear hover. Same recipe as imsTableSx, only lighter.
 */
// `zebra: false` for a table whose rows carry their own status tint.
export const rmTableSx = (minWidth, { zebra = true } = {}) => ({
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
