import React, { useState } from 'react';
import { Box, Stack, Typography, alpha } from '@mui/material';
import { FmsGateBanner, FmsGateDialog } from '../FmsGate';
import BackButton from '../../../components/BackButton';
import { O2D } from '../o2dTheme';

/**
 * Shared page shell for the O2D step-entry forms (2.5–2.13) — branded hero +
 * a centred content column, so every step form looks identical.
 *
 * Pass `gate` (the object from useFmsGate) and the shell shows the sequential-
 * gate banner + "complete the previous step" popup automatically. The screen
 * still disables its own submit via `gate.blocked`.
 */
// `actions` (optional) sits on the right of the header, as in the IMS ImsShell.
const O2dStepShell = ({ icon: Icon, step, title, subtitle, actions, children, maxWidth = 1240, gate }) => {
  const [gateOpen, setGateOpen] = useState(false);
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: O2D.canvas }}>
      {/* Flush warm top bar — same editorial language as every other O2D screen
          (was a big blue gradient hero that didn't match the client palette). */}
      <Box sx={{
        position: 'sticky', top: 0, zIndex: 5,
        bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}`,
        px: { xs: 1.5, md: 2 }, py: 1,
      }}>
        <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
          <BackButton iconOnly sx={{ color: O2D.body, border: `1px solid ${O2D.line}`, borderRadius: '8px', flexShrink: 0 }} />
          <Box sx={{ width: 30, height: 30, borderRadius: '6px', display: 'grid', placeItems: 'center', flexShrink: 0,
            bgcolor: alpha(O2D.brand, 0.1), color: O2D.brand }}>
            {Icon ? <Icon size={16} /> : null}
          </Box>
          <Box sx={{ minWidth: 0, flex: '1 1 240px' }}>
            <Stack direction="row" spacing={0.75} alignItems="baseline">
              <Typography sx={{ color: O2D.ink, fontSize: '1rem', fontWeight: 800, lineHeight: 1.2 }}>
                {title}
              </Typography>
              {step && (
                <Typography sx={{ color: O2D.faint, fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0 }}>
                  {step}
                </Typography>
              )}
            </Stack>
            {/* Wraps on a phone; one line (full text on hover) from sm up. */}
            {subtitle && (
              <Typography title={typeof subtitle === 'string' ? subtitle : undefined}
                sx={{ color: O2D.sub, fontSize: '0.72rem', whiteSpace: { xs: 'normal', sm: 'nowrap' }, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          {actions && <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ ml: 'auto' }}>{actions}</Stack>}
        </Stack>
      </Box>
      {/* The form's sections stack with the standard IMS rhythm. */}
      <Box sx={{ px: { xs: 1.25, md: 1.75 }, py: 1.5, pb: 6, maxWidth, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
        {gate?.blocked && <FmsGateBanner gate={gate.gate} onOpen={() => setGateOpen(true)} />}
        {children}
      </Box>
      {gate && <FmsGateDialog gate={gate.gate} open={gateOpen} onClose={() => setGateOpen(false)} />}
    </Box>
  );
};

export default O2dStepShell;
