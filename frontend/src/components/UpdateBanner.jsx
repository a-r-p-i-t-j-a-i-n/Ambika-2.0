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
      sx={{ zIndex: (t) => t.zIndex.snackbar + 10 }}
    >
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.5,
          px: 2, py: 1.25, borderRadius: 2,
          background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 100%)',
          color: '#fff', boxShadow: '0 10px 30px rgba(15,23,42,0.35)',
          maxWidth: 460,
        }}
      >
        <Sparkles size={18} style={{ flexShrink: 0 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', lineHeight: 1.2 }}>
            A new version is available
          </Typography>
          <Typography sx={{ fontSize: '0.78rem', opacity: 0.85 }}>
            Click update to get the latest features and fixes.
          </Typography>
        </Box>
        <Button
          onClick={reload}
          variant="contained"
          startIcon={<RefreshCw size={15} />}
          sx={{
            flexShrink: 0, fontWeight: 800, textTransform: 'none',
            bgcolor: '#fff', color: '#1d4ed8',
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
