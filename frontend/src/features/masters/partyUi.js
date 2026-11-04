// Shared look and helpers for the Party detail page (PartyDetails,
// PartyOrderHistory, PartyAddSkusDialog). Presentation only.
import { O2D, NAVY } from '../../components/pageKit';

export const TONE = {
  blue: '#2563eb',
  violet: '#7c3aed',
  green: '#15803d',
  amber: '#d97706',
  rose: '#e11d48',
  indigo: '#4f46e5',
  slate: '#64748b',
  teal: '#0d9488',
  code: '#334155', // codes: dark, bold, on a light grey chip
};

export const cardSx = {
  borderRadius: '12px', overflow: 'hidden', bgcolor: O2D.surface,
  border: `1px solid ${O2D.line}`, boxShadow: '0 1px 3px rgba(15, 23, 42, 0.05)',
};

export const thSx = {
  fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: O2D.sub,
  bgcolor: '#f8fafc', borderBottom: `1px solid ${O2D.line}`, py: 1.1, whiteSpace: 'nowrap',
};
export const tdSx = { fontSize: '0.82rem', color: NAVY, borderBottom: `1px solid ${O2D.lineSoft}`, py: 1.05 };
export const numSx = { ...tdSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

export const money = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const qty = (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

export const unitTone = (unit = '') => (/kg/i.test(unit) ? TONE.amber : /pc/i.test(unit) ? TONE.blue : TONE.slate);

/** "flat jar, katori" → ['flat jar', 'katori'] — several searches at once. */
export const searchTerms = (text = '') => text.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);

/** No terms → everything matches; otherwise any one term found in the text. */
export const matchesAny = (terms, text) => !terms.length || terms.some((t) => text.includes(t));

/** Text → a safe piece of a server-side regex search. */
export const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
