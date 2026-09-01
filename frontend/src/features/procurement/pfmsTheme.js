// ── Purchase FMS visual tokens ──────────────────────────────────────────────
// Purchase FMS reuses the O2D FMS design language verbatim so the two FMS
// modules read as one system — same warm-neutral surfaces, same hairline
// borders, same compact table/typography scale. O2D FMS remains the single
// source of truth for these values; nothing here is a new palette.
// See ../o2d-fms/o2dTheme.js for the canonical definitions.
import { O2D as PFMS, STATUS_TOKENS } from '../o2d-fms/o2dTheme';

export { PFMS, STATUS_TOKENS };

// Shared sx fragments — reused across every Purchase FMS list/detail page
// instead of re-typing the same literals per file.
export const pfmsPageSx = { p: { xs: 1.5, md: 2 }, minHeight: '100vh', bgcolor: PFMS.canvas };
export const pfmsTitleSx = { fontSize: '1rem', fontWeight: 800, color: PFMS.ink, lineHeight: 1.2 };
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
