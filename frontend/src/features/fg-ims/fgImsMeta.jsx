import React from 'react';
import { Box, Stack, Typography } from '@mui/material';

// Reuse the single source of truth for stock-status colours + number/currency
// formatting so every IMS (consumables, RM, finished goods) reads identically.
export { STATUS_META, StatusChip, num, inr } from '../ims/imsMeta';

// Finished-goods accent — emerald, to visually distinguish this IMS from the
// blue consumables/RM ones (finished = ready-to-sell).
export const FG_ACCENT = '#059669';

// Rows-per-page choices shared by every FG table — from a small page up to
// "show everything" (5000). Default is the first entry (10).
export const ROWS_PER_PAGE = [10, 25, 50, 100, 500, 1000, 5000];

// Movement transaction → human label, scoped to the finished-goods flow.
export const TXN_LABEL = {
  PRODUCE_IN: 'Production', OPENING: 'Opening', ADJUST_IN: 'Stock-in', ADJUST_OUT: 'Adjust out',
  DISPATCH_OUT: 'Dispatch', SALES_RETURN_IN: 'Sales return', QC_REJECT_OUT: 'QC reject',
  RETURN_OUT: 'Return', TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out',
  CONSUME_OUT: 'Consumed', GRN_IN: 'GRN receipt',
};

// Seasonal demand modes (the finished-goods sheet's Low/Normal/Peak columns).
export const MODE_LABEL = { LOW: 'Off-season', NORMAL: 'Normal', PEAK: 'Peak' };
export const MODE_OPTIONS = [
  { value: 'LOW', label: 'Off-season' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'PEAK', label: 'Peak' },
];

// Available-vs-target % → colour (mirrors the RM sheet's coloured % column).
export const pctColor = (p) => {
  if (p == null) return '#94a3b8';
  if (p < 33) return '#dc2626';
  if (p <= 66) return '#b45309';
  if (p <= 110) return '#0f766e';
  return '#6366f1';
};

// Emerald gradient hero used across the Finished Goods IMS screens.
export const FgHero = ({ icon: Icon, title, subtitle, action }) => (
  <Box sx={{
    color: '#fff', px: { xs: 2.5, md: 4 }, pt: { xs: 2.5, md: 3 }, pb: { xs: 3.5, md: 4.5 },
    background: 'linear-gradient(135deg, #064e3b 0%, #047857 55%, #059669 100%)',
  }}>
    <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
      <Stack direction="row" spacing={1.75} alignItems="center">
        {Icon && (
          <Box sx={{ width: 42, height: 42, borderRadius: 2, display: 'grid', placeItems: 'center', flexShrink: 0,
            background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}>
            <Icon size={20} color="#fff" />
          </Box>
        )}
        <Box>
          <Typography sx={{ color: '#fff', fontSize: { xs: '1.15rem', md: '1.4rem' }, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            {title}
          </Typography>
          {subtitle && <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.82rem', mt: 0.25 }}>{subtitle}</Typography>}
        </Box>
      </Stack>
      {action}
    </Stack>
  </Box>
);

export default FgHero;
