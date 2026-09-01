// ── Shared page chrome ───────────────────────────────────────────────────────
// Pricing Hub, Turnover Calculator, Approval Inbox, Analytics and Quotes each
// carried their own copy of the same gradient hero (title at 2rem, radial blobs,
// negative-margin overlap) plus their own panel radii and shadows. That made the
// product read as five different apps and put ~150px of decoration above the
// fold on every screen.
//
// This is the single source for that chrome. Presentation only.

import React from 'react';
import { Box, Stack, Typography, alpha } from '@mui/material';
import { O2D } from '../features/o2d-fms/o2dTheme';

export const BRAND = O2D.brand;   // #1d4ed8
export const BRAND_DK = '#1e3a8a';
export const NAVY = '#0b2545';    // deepest readable navy — never pure black
export const DANGER = '#be123c';

/**
 * Page header: icon tile, title, subtitle, right-hand actions.
 *
 * Title is 1.3rem, not the 2rem the old heroes used — at 2rem the heading
 * out-weighed the data it introduced, and every screen sized it differently.
 */
export const PageHero = ({ icon: Icon, title, subtitle, actions, badge }) => (
  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
      {Icon && (
        <Box sx={{
          width: 38, height: 38, borderRadius: '8px', flexShrink: 0,
          display: 'grid', placeItems: 'center',
          bgcolor: alpha(BRAND, 0.1), color: BRAND,
          border: `1px solid ${alpha(BRAND, 0.2)}`,
        }}>
          <Icon size={19} strokeWidth={2.2} />
        </Box>
      )}
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography sx={{ color: NAVY, fontSize: { xs: '1.15rem', md: '1.3rem' }, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
            {title}
          </Typography>
          {badge}
        </Stack>
        {subtitle && (
          <Typography sx={{ color: O2D.sub, fontSize: '0.78rem', mt: 0.2, maxWidth: 760 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
    </Stack>
    {actions && <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>{actions}</Stack>}
  </Stack>
);

/** Page shell — warm O2D canvas, consistent padding and gap. */
export const pageSx = {
  minHeight: '100vh', bgcolor: O2D.canvas,
  p: { xs: 1.5, md: 2.25 },
  display: 'flex', flexDirection: 'column', gap: 1.5,
};

/** Content panel. Flat with a hairline border — no drop shadows. */
export const panelSx = {
  borderRadius: '10px', overflow: 'hidden',
  border: `1px solid ${O2D.line}`, boxShadow: 'none', bgcolor: O2D.surface,
};

export const fieldSx = {
  '& .MuiOutlinedInput-root': {
    bgcolor: O2D.surface, borderRadius: '8px', fontSize: '0.82rem',
    '& fieldset': { borderColor: O2D.line },
    '&:hover fieldset': { borderColor: alpha(BRAND, 0.4) },
  },
};

export const btnSx = {
  height: 36, borderRadius: '8px', fontWeight: 800,
  textTransform: 'none', whiteSpace: 'nowrap', fontSize: '0.82rem', boxShadow: 'none',
};

export const primaryBtnSx = { ...btnSx, bgcolor: BRAND, '&:hover': { bgcolor: BRAND_DK, boxShadow: 'none' } };

export const ghostBtnSx = {
  ...btnSx,
  bgcolor: O2D.surface, color: BRAND_DK, borderColor: O2D.line,
  '&:hover': { borderColor: BRAND, bgcolor: alpha(BRAND, 0.04) },
};

/** Type scale — so "big number", "label" and "body" mean the same thing everywhere. */
export const TYPE = {
  statValue: { fontSize: '1.05rem', fontWeight: 800, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' },
  statLabel: { fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: O2D.sub, lineHeight: 1.3 },
  sectionTitle: { fontSize: '0.9rem', fontWeight: 800, color: NAVY, letterSpacing: '-0.01em' },
  body: { fontSize: '0.82rem', color: O2D.body },
  caption: { fontSize: '0.72rem', color: O2D.sub },
};

export { O2D };
