import React from 'react';
import { Box, Stack, Typography } from '@mui/material';

/**
 * Shared page shell for the O2D step-entry forms (2.8–2.13) — branded hero +
 * a centred content column, so every step form looks identical.
 */
const O2dStepShell = ({ icon: Icon, step, title, subtitle, children, maxWidth = 880 }) => (
  <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
    <Box sx={{
      color: '#fff', px: { xs: 3, md: 5 }, pt: { xs: 4, md: 5 }, pb: { xs: 5, md: 7 },
      background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)',
    }}>
      <Stack direction="row" spacing={2.5} alignItems="center">
        <Box sx={{ width: 52, height: 52, borderRadius: 2.5, display: 'grid', placeItems: 'center',
          background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}>
          {Icon ? <Icon size={26} color="#fff" /> : null}
        </Box>
        <Box>
          {step && (
            <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {step}
            </Typography>
          )}
          <Typography sx={{ color: '#fff', fontSize: { xs: '1.4rem', md: '1.9rem' }, fontWeight: 800, letterSpacing: '-0.02em' }}>
            {title}
          </Typography>
          {subtitle && <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.92rem', mt: 0.5 }}>{subtitle}</Typography>}
        </Box>
      </Stack>
    </Box>
    <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6, maxWidth, mx: 'auto' }}>
      {children}
    </Box>
  </Box>
);

export default O2dStepShell;
