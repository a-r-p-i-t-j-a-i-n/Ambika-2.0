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
          px: { xs: 2, sm: 2.75 }, py: { xs: 1.5, sm: 1.75 }, borderRadius: 3.5,
          background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)',
          color: '#ffffff',
          border: '1px solid rgba(255,255,255,0.18)',
          boxShadow: '0 18px 48px rgba(13,37,69,0.55)',
          width: { xs: '100%', sm: 'auto' }, maxWidth: 540,
        }}
      >
        {/* Icon badge */}
        <Box
          sx={{
            flexShrink: 0, width: 40, height: 40, borderRadius: '50%',
            display: 'grid', placeItems: 'center',
            bgcolor: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.25)',
          }}
        >
          <Sparkles size={20} color="#ffffff" />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', lineHeight: 1.25, color: '#ffffff' }}>
            A new version is available
          </Typography>
          <Typography sx={{ fontSize: '0.8rem', lineHeight: 1.3, color: 'rgba(255,255,255,0.92)' }}>
            Update now to get the latest features and fixes.
          </Typography>
        </Box>

        <Button
          onClick={reload}
          variant="contained"
          disableElevation
          startIcon={<RefreshCw size={16} />}
          sx={{
            flexShrink: 0, fontWeight: 800, textTransform: 'none', whiteSpace: 'nowrap',
            borderRadius: 2, px: 2.25, py: 1,
            bgcolor: '#ffffff', color: '#1d4ed8',
            boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
            '&:hover': { bgcolor: '#eef2ff' },
          }}
        >
          Update now
        </Button>
      </Box>
    </Snackbar>
  );
};

export default UpdateBanner;
