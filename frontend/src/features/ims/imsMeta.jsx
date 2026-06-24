import React from 'react';
import { Box, Stack, Typography, Chip } from '@mui/material';

// Stock-status → colour + label. Single source of truth for all IMS screens.
export const STATUS_META = {
  OK:           { color: '#0f766e', label: 'OK' },
  LOW:          { color: '#b45309', label: 'Low' },
  REORDER:      { color: '#dc2626', label: 'Reorder' },
  OUT_OF_STOCK: { color: '#7f1d1d', label: 'Out of stock' },
  OVERSTOCK:    { color: '#6366f1', label: 'Overstock' },
};

export const num = (n) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export const StatusChip = ({ status, size = 'small' }) => {
  const m = STATUS_META[status] || STATUS_META.OK;
  return (
    <Chip
      size={size}
      label={m.label}
      sx={{ fontWeight: 700, height: 22, bgcolor: `${m.color}1f`, color: m.color, border: `1px solid ${m.color}55` }}
    />
  );
};

// Shared blue gradient hero used across the IMS screens.
export const ImsHero = ({ icon: Icon, title, subtitle, action }) => (
  <Box sx={{
    color: '#fff', px: { xs: 2.5, md: 4 }, pt: { xs: 2.5, md: 3 }, pb: { xs: 3.5, md: 4.5 },
    background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)',
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
          {subtitle && <Typography sx={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.82rem', mt: 0.25 }}>{subtitle}</Typography>}
        </Box>
      </Stack>
      {action}
    </Stack>
  </Box>
);

export default ImsHero;
