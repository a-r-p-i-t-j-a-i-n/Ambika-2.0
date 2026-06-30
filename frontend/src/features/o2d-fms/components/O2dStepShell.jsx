import React, { useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { FmsGateBanner, FmsGateDialog } from '../FmsGate';

/**
 * Shared page shell for the O2D step-entry forms (2.5–2.13) — branded hero +
 * a centred content column, so every step form looks identical.
 *
 * Pass `gate` (the object from useFmsGate) and the shell shows the sequential-
 * gate banner + "complete the previous step" popup automatically. The screen
 * still disables its own submit via `gate.blocked`.
 */
const O2dStepShell = ({ icon: Icon, step, title, subtitle, children, maxWidth = 1240, gate }) => {
  const [gateOpen, setGateOpen] = useState(false);
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box sx={{
        color: '#fff', px: { xs: 2.5, md: 3.5 }, pt: { xs: 2.75, md: 3.25 }, pb: { xs: 3.5, md: 4.25 },
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)',
      }}>
        <Stack direction="row" spacing={1.75} alignItems="center">
          <Box sx={{ width: 42, height: 42, borderRadius: 2, display: 'grid', placeItems: 'center', flexShrink: 0,
            background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}>
            {Icon ? <Icon size={20} color="#fff" /> : null}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            {step && (
              <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {step}
              </Typography>
            )}
            <Typography sx={{ color: '#fff', fontSize: { xs: '1.15rem', md: '1.4rem' }, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {title}
            </Typography>
            {subtitle && <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.8rem', mt: 0.35 }}>{subtitle}</Typography>}
          </Box>
        </Stack>
      </Box>
      <Box sx={{ px: { xs: 1.5, md: 2.5 }, mt: { xs: -2.5, md: -3 }, position: 'relative', zIndex: 1, pb: 6, maxWidth, mx: 'auto' }}>
        {gate?.blocked && <FmsGateBanner gate={gate.gate} onOpen={() => setGateOpen(true)} />}
        {children}
      </Box>
      {gate && <FmsGateDialog gate={gate.gate} open={gateOpen} onClose={() => setGateOpen(false)} />}
    </Box>
  );
};

export default O2dStepShell;
