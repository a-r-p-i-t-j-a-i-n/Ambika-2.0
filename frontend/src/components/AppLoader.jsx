import React from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';

// ─────────────────────────────────────────────────────────────────────────────
// AppLoader
//  new 
// Default fallback for React.Suspense while a route chunk is downloading.
// Renders inside the existing layout (full-height column) so navigation does
// not jump. now 
// ─────────────────────────────────────────────────────────────────────────────

const AppLoader = ({ label = 'Loading workspace…' }) => (
  <Box
    sx={{
      minHeight: '60vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      color: '#1e3e94',
    }}
  >
    <Box
      sx={{
        position: 'relative',
        width: 64,
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <CircularProgress
        size={56}
        thickness={3.5}
        sx={{ color: '#1d4ed8' }}
      />
      <Box
        sx={{
          position: 'absolute',
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%)',
          boxShadow: '0 6px 14px rgba(30,58,138,0.30)',
        }}
      />
    </Box>
    <Typography
      sx={{
        fontSize: '0.85rem',
        fontWeight: 600,
        color: '#475a8a',
        letterSpacing: '0.02em',
      }}
    >
      {label}
    </Typography>
  </Box>
);

// A taller variant used by the initial app shell before MainLayout mounts.
export const AppBootLoader = () => (
  <Box
    sx={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #eef3fc 0%, #f5f8ff 100%)',
    }}
  >
    <AppLoader label="Starting AGL ERP…" />
  </Box>
);

export default AppLoader;
