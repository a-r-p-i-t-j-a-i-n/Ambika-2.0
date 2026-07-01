import React from 'react';
import { Snackbar, Button, Box, Typography } from '@mui/material';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useVersionWatcher } from '../hooks/useVersionWatcher';

/**
 * UpdateBanner
 * ------------
 * Shows a friendly, non-dismissable prompt at the bottom of the screen the
 * moment a newer build is deployed, with a single "Update now" button that
 * reloads into the latest version. Designed for non-technical users — no
 * jargon, no "clear your cache", just one click.
 *
 * Rendered once at the app root; renders nothing until an update is detected.
 */
const UpdateBanner = () => {
  const updateReady = useVersionWatcher();

  const reload = () => {
    // Full reload re-fetches index.html (no-cache) → newest hashed bundles.
    window.location.reload();
  };

  if (!updateReady) return null;

  return (
    <Snackbar
      open
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      sx={{ zIndex: (t) => t.zIndex.snackbar + 10, bottom: { xs: 16, sm: 28 }, px: { xs: 1.5, sm: 0 } }}
    >
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: { xs: 1.5, sm: 2 },
          px: { xs: 1.75, sm: 2.25 }, py: { xs: 1.25, sm: 1.5 }, borderRadius: 3,
          bgcolor: '#ffffff',
          border: '1px solid #e2e8f0',
          borderTop: '3px solid #1d4ed8',
          boxShadow: '0 16px 44px rgba(13,37,69,0.22)',
          width: { xs: '100%', sm: 'auto' }, maxWidth: 540,
        }}
      >
        {/* Icon badge */}
        <Box
          sx={{
            flexShrink: 0, width: 40, height: 40, borderRadius: '50%',
            display: 'grid', placeItems: 'center',
            bgcolor: 'rgba(29,78,216,0.10)', border: '1px solid rgba(29,78,216,0.20)',
          }}
        >
          <Sparkles size={20} color="#1d4ed8" />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', lineHeight: 1.25, color: '#0b2545' }}>
            A new version is available
          </Typography>
          <Typography sx={{ fontSize: '0.8rem', lineHeight: 1.3, color: '#475569' }}>
            Update now to get the latest features and fixes.
          </Typography>
        </Box>

        <Button
          onClick={reload}
          disableElevation
          disableRipple
          startIcon={<RefreshCw size={16} color="#ffffff" />}
          sx={{
            flexShrink: 0, fontWeight: 800, textTransform: 'none', whiteSpace: 'nowrap',
            borderRadius: 2, px: 2.25, py: 1,
            // Force high-contrast solid blue button that no theme override can flatten.
            bgcolor: '#1d4ed8 !important', color: '#ffffff !important',
            boxShadow: '0 4px 14px rgba(29,78,216,0.35)',
            '& .MuiButton-startIcon': { color: '#ffffff' },
            '&:hover': { bgcolor: '#1e40af !important' },
          }}
        >
          Update now
        </Button>
      </Box>
    </Snackbar>
  );
};

export default UpdateBanner;
