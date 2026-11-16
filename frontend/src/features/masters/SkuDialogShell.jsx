import React from 'react';
import {
  Box, Dialog, IconButton, Tooltip, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { PackagePlus, Sparkles, X } from 'lucide-react';

/**
 * Large centered enterprise dialog shared by Register SKU and Edit SKU — the
 * same interaction and layout as the New Sales Order dialog
 * (orders/OrderEntryDrawer.jsx): dimmed backdrop, up to 1160px wide and 92vh
 * tall (full screen on phones), a fixed header, and a body + fixed bottom
 * action bar supplied by the child (SkuForm).
 */
const SkuDialogShell = ({ open = true, onClose, testId, title, subtitle, icon = PackagePlus, children }) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const Icon = icon;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      disableEnforceFocus
      fullScreen={fullScreen}
      maxWidth="lg"
      fullWidth
      scroll="paper"
      PaperProps={{
        'data-testid': testId,
        sx: {
          width: '100%',
          maxWidth: 1160,
          height: fullScreen ? '100%' : '92vh',
          m: fullScreen ? 0 : 2,
          p: 0,
          borderRadius: fullScreen ? 0 : 3,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          bgcolor: 'background.default',
        },
      }}
    >
      {/* ── Header (fixed) ─────────────────────────────────────────── */}
      <Box sx={{
        flexShrink: 0, zIndex: 10,
        bgcolor: 'background.paper',
        borderBottom: '1px solid', borderColor: 'divider',
        px: 3, py: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <Box sx={{
            width: 38, height: 38, borderRadius: '12px', display: 'grid', placeItems: 'center', flexShrink: 0,
            background: `linear-gradient(135deg, ${theme.palette.primary.light}, ${theme.palette.primary.dark})`,
            color: 'common.white',
          }}>
            <Icon size={18} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: 'text.primary', lineHeight: 1.15 }} noWrap>
              {title}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }} noWrap>
              <Sparkles size={11} /> {subtitle}
            </Typography>
          </Box>
        </Box>
        <Tooltip title="Close">
          <IconButton onClick={onClose} aria-label="Close" size="small" sx={{ color: 'text.secondary' }}>
            <X size={18} />
          </IconButton>
        </Tooltip>
      </Box>

      {children}
    </Dialog>
  );
};

export default SkuDialogShell;
