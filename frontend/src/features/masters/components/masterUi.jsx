// ── Shared presentation kit for the Master screens (SKU, Parties) ────────────
// These screens previously each carried their own hex values and their own grid
// styling, so they drifted apart from the O2D/FMS language and from each other.
// Everything visual they share now lives here: same tokens, same grid chrome,
// same pill. Presentation only — no data or query behaviour.

import React from 'react';
import { Box, Typography, Stack, alpha } from '@mui/material';
import { O2D } from '../../o2d-fms/o2dTheme';

export const BRAND = O2D.brand;      // #1d4ed8
export const BRAND_DK = '#1e3a8a';
export const NAVY = '#0b2545';       // deepest readable navy — never pure black
export const DANGER = '#be123c';

/**
 * Status/label pill.
 *
 * Rendered as inline-flex with an explicit height and `alignSelf: center`. A
 * plain block <Box> inside a DataGrid cell inherits the row's full height, which
 * is why the TYPE column read as tall stretched rectangles instead of chips.
 */
/**
 * `minWidth` makes a column of pills read as one set instead of a ragged edge:
 * pass the width of the longest label in that column and every pill matches it,
 * label centred. Without it the pill still hugs its text, so existing callers
 * are unaffected. It is a floor, not a cap — an unexpectedly long label grows
 * the pill rather than clipping it.
 */
export const Pill = ({ color = BRAND, icon = null, children, title, minWidth }) => (
  <Box
    title={title}
    sx={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 0.5,
      alignSelf: 'center', flexShrink: 0,
      height: 22, px: 1, minWidth, borderRadius: '6px',
      bgcolor: alpha(color, 0.09),
      border: `1px solid ${alpha(color, 0.22)}`,
      color,
      fontSize: '0.68rem', fontWeight: 800, lineHeight: 1,
      whiteSpace: 'nowrap',
    }}
  >
    {icon}
    {children}
  </Box>
);

/** Muted em-dash for empty cells — one look for "nothing here" across both grids. */
export const Empty = () => (
  <Typography sx={{ fontSize: '0.8rem', color: O2D.faint, alignSelf: 'center' }}>—</Typography>
);

/** Plain cell text, vertically centred so it lines up with the pills beside it. */
export const CellText = ({ children, weight = 600, color = O2D.body, mono = false }) => (
  <Typography
    noWrap
    sx={{
      alignSelf: 'center', fontSize: '0.8rem', fontWeight: weight, color,
      ...(mono ? { fontFamily: 'ui-monospace, SFMono-Regular, monospace', letterSpacing: '-0.01em' } : null),
    }}
  >
    {children}
  </Typography>
);

/** Page title + one-line description. Same rhythm as the O2D screens. */
export const PageHeading = ({ title, subtitle }) => (
  <Box>
    <Typography sx={{ fontSize: { xs: '1.15rem', sm: '1.3rem' }, fontWeight: 800, color: NAVY, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
      {title}
    </Typography>
    <Typography sx={{ fontSize: '0.78rem', color: O2D.sub, fontWeight: 500, mt: 0.35 }}>
      {subtitle}
    </Typography>
  </Box>
);

/** Empty-state block for a filtered grid. */
export const NoRows = ({ icon: Icon, title, hint }) => (
  <Stack alignItems="center" justifyContent="center" sx={{ height: '100%', gap: 0.75, color: O2D.faint }}>
    {Icon ? <Icon size={30} style={{ opacity: 0.45 }} /> : null}
    <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', color: O2D.sub }}>{title}</Typography>
    <Typography sx={{ fontSize: '0.78rem' }}>{hint}</Typography>
  </Stack>
);

/**
 * Shared DataGrid chrome. The `& .MuiDataGrid-cell` flex rule is the structural
 * half of the alignment fix — it guarantees every cell centres its content
 * vertically regardless of what a renderCell returns.
 */
export const gridSx = {
  border: 0,
  '--DataGrid-overlayHeight': '220px',
  '& .MuiDataGrid-columnHeaders': { borderBottom: `1px solid ${O2D.line}` },
  '& .MuiDataGrid-columnHeader': { bgcolor: O2D.surfaceAlt, '&:focus, &:focus-within': { outline: 'none' } },
  '& .MuiDataGrid-columnHeaderTitle': {
    fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.07em',
    textTransform: 'uppercase', color: BRAND_DK,
  },
  '& .MuiDataGrid-cell': {
    display: 'flex', alignItems: 'center',
    borderBottom: `1px solid ${O2D.lineSoft}`,
    '&:focus, &:focus-within': { outline: 'none' },
  },
  '& .MuiDataGrid-row': { transition: 'background .12s' },
  '& .MuiDataGrid-row:hover': { bgcolor: alpha(BRAND, 0.045) },
  '& .MuiDataGrid-footerContainer': { borderTop: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt },
  '& .MuiTablePagination-root': { fontSize: '0.78rem' },
};

/** Outer page shell — warm O2D canvas, consistent padding. */
export const pageSx = {
  display: 'flex', flexDirection: 'column', gap: 1.75,
  p: { xs: 1.5, sm: 2.25 }, minHeight: '100vh', bgcolor: O2D.canvas,
};

/** White panel that holds a grid. */
export const panelSx = {
  flexGrow: 1, borderRadius: '10px', overflow: 'hidden',
  border: `1px solid ${O2D.line}`, boxShadow: 'none', bgcolor: O2D.surface,
};

/** Search / action inputs sitting on the canvas. */
export const fieldSx = {
  '& .MuiOutlinedInput-root': {
    bgcolor: O2D.surface, borderRadius: '8px', fontSize: '0.82rem',
    '& fieldset': { borderColor: O2D.line },
    '&:hover fieldset': { borderColor: alpha(BRAND, 0.4) },
  },
};

export const btnSx = {
  height: 36, borderRadius: '8px', fontWeight: 800, textTransform: 'none',
  whiteSpace: 'nowrap', fontSize: '0.82rem',
};

export { O2D };
