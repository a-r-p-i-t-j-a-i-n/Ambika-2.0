import React from 'react';
import { Box, Button, Chip, Skeleton, Stack, Typography } from '@mui/material';
import { AlertTriangle, Info, RotateCcw } from 'lucide-react';
import { FLUENT, FLUENT_DEPTH, headerBtnSx, fluentTableSx } from '../../ims/imsFluent';
import { ImsShell } from '../../ims/imsMeta';
import { O2D } from '../o2dTheme';

// ── O2D page = the IMS page shell ───────────────────────────────────────────
// Every O2D screen sits in the same shell the inventory modules use: warm
// canvas, sticky header (icon · title · subtitle on the left, actions on the
// right in one row from a desktop width), the standard content gutter. The
// content style below gives every panel and table on the page the Fluent look
// in ONE place, so screens drop their one-off styling instead of repeating it.
const TABLE = fluentTableSx(undefined, { zebra: false });
const O2D_CONTENT_SX = {
  // Panels: flat, hairline border, Fluent depth — the IMS Panel look.
  '& > .MuiPaper-root, & > * > .MuiPaper-root': {
    borderRadius: '10px', border: `1px solid ${O2D.line}`, boxShadow: FLUENT_DEPTH.rest, backgroundImage: 'none',
  },
  // Tables: the shared Fluent table recipe (soft-blue header, airy rows).
  '& .MuiTable-root': { ...TABLE, minWidth: undefined },
  // Data grids: the same header treatment.
  '& .MuiDataGrid-columnHeaders, & .MuiDataGrid-columnHeader': { bgcolor: '#f2f6fc' },
  '& .MuiDataGrid-columnHeaderTitle': {
    fontWeight: 700, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#3b4a63',
  },
  '& .MuiDataGrid-row:hover': { bgcolor: '#f1f6fe' },
  // Buttons: IMS casing, weight and corners.
  '& .MuiButton-root': { textTransform: 'none', fontWeight: 700, borderRadius: '8px' },
};
export const O2dPage = ({ children, ...props }) => (
  <ImsShell nav={false} accent={O2D.brand} actionsInline contentSx={O2D_CONTENT_SX} {...props}>
    {children}
  </ImsShell>
);

// Shared O2D screen states, built only from the IMS Fluent tokens so O2D reads
// like the inventory modules. Presentation only: they show what a query
// already returned; nothing here fetches, filters or changes any data.

const errorText = (error) => error?.data?.message || error?.error || 'The server did not answer.';

/**
 * A load that failed. Without data it stands in for the screen's content (so a
 * failure is never shown as "nothing here yet"); with data already on screen
 * (`compact`) it is a slim note above it, and the data stays visible.
 * `onRetry` is the query's own `refetch`.
 */
export const LoadErrorNote = ({ title = 'Could not load this screen', error, onRetry, compact = false, sx }) => (
  <Box role="alert" data-testid="o2d-load-error" sx={{
    border: `1px solid ${FLUENT.rose.border}`, bgcolor: FLUENT.rose.bg, borderRadius: '10px',
    px: compact ? 1.5 : 2, py: compact ? 0.9 : 2, boxShadow: compact ? 'none' : FLUENT_DEPTH.rest, ...sx,
  }}>
    <Stack direction="row" spacing={1.25} alignItems={compact ? 'center' : 'flex-start'} flexWrap="wrap" useFlexGap>
      <Box sx={{ color: FLUENT.rose.accent, display: 'flex', pt: compact ? 0 : 0.25 }}><AlertTriangle size={compact ? 15 : 18} /></Box>
      <Box sx={{ minWidth: 0, flex: '1 1 220px' }}>
        <Typography sx={{ fontSize: compact ? '0.78rem' : '0.86rem', fontWeight: 800, color: FLUENT.rose.ink }}>
          {compact ? 'Could not refresh — showing the last loaded data.' : title}
        </Typography>
        <Typography sx={{ fontSize: '0.72rem', color: FLUENT.rose.ink, opacity: 0.85 }}>{errorText(error)}</Typography>
      </Box>
      {onRetry && (
        <Button size="small" variant="outlined" startIcon={<RotateCcw size={14} />} onClick={() => onRetry()} sx={headerBtnSx}>
          Retry
        </Button>
      )}
    </Stack>
  </Box>
);

/**
 * Says when a list has reached the record cap its screen already loads with,
 * so a count is never read as the full total. The cap itself is unchanged.
 */
export const CapNote = ({ shown = 0, cap, noun = 'records', sx }) => (shown >= cap ? (
  <Stack direction="row" spacing={0.75} alignItems="center" data-testid="o2d-cap-note" sx={{
    border: `1px solid ${FLUENT.amber.border}`, bgcolor: FLUENT.amber.bg, borderRadius: '8px', px: 1.25, py: 0.6, ...sx,
  }}>
    <Box sx={{ color: FLUENT.amber.accent, display: 'flex' }}><Info size={14} /></Box>
    <Typography sx={{ fontSize: '0.72rem', color: FLUENT.amber.ink }}>
      Showing the latest <b>{cap.toLocaleString('en-IN')}</b> {noun}. Older ones are not loaded on this screen, so counts here cover these only.
    </Typography>
  </Stack>
) : null);

/**
 * The O2D status pill — the IMS 22px pill (StatusChip geometry) coloured from
 * the shared Fluent tokens, so every status on an O2D screen reads the same way.
 * `tone` is a FLUENT key: green · amber · orange · rose · blue · teal · lavender · grey.
 * Extra props (onClick, clickable, title…) pass through to the MUI Chip.
 */
// forwardRef so a Tooltip can wrap a pill directly (the tooltip needs the ref).
export const O2dStatusPill = React.forwardRef(({ tone = 'grey', label, icon: Icon, sx, ...rest }, ref) => {
  const t = FLUENT[tone] || FLUENT.grey;
  return (
    <Chip
      ref={ref} size="small" label={label} icon={Icon ? <Icon size={12} /> : undefined} {...rest}
      sx={{
        height: 22, fontWeight: 700, fontSize: '0.7rem', borderRadius: '999px', maxWidth: '100%',
        bgcolor: t.tint, color: t.accent, border: `1px solid ${t.border}`,
        '& .MuiChip-icon': { color: t.accent, ml: 0.75, mr: -0.25 }, '& .MuiChip-label': { px: 1 },
        ...sx,
      }}
    />
  );
});
O2dStatusPill.displayName = 'O2dStatusPill';

// ── Skeleton loaders (the Vuetify v-skeleton-loader look) ───────────────────
// Shown ONLY while data is actually loading, in the exact place and size of the
// content they stand in for, so the page never jumps and no previous content is
// shown meanwhile. Soft grey bars with the wave shimmer.
const SK = { bgcolor: 'rgba(15, 23, 42, 0.07)' };

/** One 193 x 72 step / KPI card: icon · divider · figure + label lines. */
export const CardSkeleton = () => (
  <Box aria-hidden data-skeleton="card" sx={{
    display: 'flex', alignItems: 'center', gap: '11px', height: 72, boxSizing: 'border-box', px: '14px',
    borderRadius: '7px', border: '1px solid #e7ebf1', bgcolor: '#fff', flex: '0 0 193px', minWidth: 0,
  }}>
    <Skeleton animation="wave" variant="rounded" width={26} height={26} sx={{ ...SK, borderRadius: '7px', flexShrink: 0 }} />
    <Box sx={{ width: '1px', height: 42, bgcolor: '#eef1f5', flexShrink: 0 }} />
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Skeleton animation="wave" variant="text" width="46%" height={26} sx={SK} />
      <Skeleton animation="wave" variant="text" width="78%" height={14} sx={SK} />
    </Box>
  </Box>
);

/** A row of card skeletons — same strip geometry as the real cards. */
export const CardStripSkeleton = ({ count = 6, sx }) => (
  <Box role="progressbar" aria-label="Loading" aria-busy="true" data-skeleton="card-strip"
    sx={{ display: 'flex', gap: '9px', overflow: 'hidden', px: 0.5, pt: 0.5, pb: 1, ...sx }}>
    {Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />)}
  </Box>
);

/** A table placeholder: soft-blue header band + rows of bars. */
export const TableSkeleton = ({ rows = 8, columns = 6, rowHeight = 44, sx }) => (
  <Box role="progressbar" aria-label="Loading" aria-busy="true" data-skeleton="table" sx={{ width: '100%', bgcolor: '#fff', ...sx }}>
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', height: 43, px: 2, bgcolor: '#f2f6fc', borderBottom: '1px solid #dfe7f2' }}>
      {Array.from({ length: columns }, (_, c) => (
        <Skeleton key={c} animation="wave" variant="text" height={12} sx={{ ...SK, flex: c === 1 ? 1.6 : 1 }} />
      ))}
    </Box>
    {Array.from({ length: rows }, (_, r) => (
      <Box key={r} sx={{ display: 'flex', gap: 2, alignItems: 'center', height: rowHeight, px: 2, borderBottom: '1px solid #edf0f5' }}>
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} animation="wave" variant="text" height={14}
            sx={{ ...SK, flex: c === 1 ? 1.6 : 1, maxWidth: c === 0 ? 90 : undefined, opacity: 1 - r * 0.06 }} />
        ))}
      </Box>
    ))}
  </Box>
);

/** A grid of record cards (the Cards / Board views). */
export const CardGridSkeleton = ({ count = 6 }) => (
  <Box role="progressbar" aria-label="Loading" aria-busy="true" data-skeleton="card-grid" sx={{
    p: 1.5, display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' },
  }}>
    {Array.from({ length: count }, (_, i) => (
      <Box key={i} sx={{ p: 1.5, borderRadius: '10px', border: '1px solid #e7ebf1', bgcolor: '#fff' }}>
        <Skeleton animation="wave" variant="text" width="40%" height={22} sx={SK} />
        {[0, 1, 2, 3].map((k) => (
          <Box key={k} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <Skeleton animation="wave" variant="text" width="30%" height={16} sx={SK} />
            <Skeleton animation="wave" variant="text" width="38%" height={16} sx={SK} />
          </Box>
        ))}
      </Box>
    ))}
  </Box>
);
