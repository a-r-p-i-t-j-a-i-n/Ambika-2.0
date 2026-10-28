import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, Button, IconButton, useMediaQuery,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { X, ExternalLink, Eye } from 'lucide-react';
import { PFMS } from '../pfmsTheme';

/**
 * Read-only quick view for one Purchase FMS list row, opened from the row's eye
 * icon so the user stays on the list. It shows what the list already loaded for
 * that row (no extra request); the full detail page stays one click away via
 * "Open full …" (and the row click / ⋮ → View).
 *
 * fields: [{ label, value, span? }] — value may be a node; empty → "—".
 */
const isEmpty = (v) => v === null || v === undefined || v === '';

const RowQuickViewDialog = ({
  open, onClose, title, number, status, subtitle, fields = [], children, openFullLabel = 'Open full page', onOpenFull,
}) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Dialog open={Boolean(open)} onClose={onClose} fullScreen={fullScreen} maxWidth="md" fullWidth
      aria-labelledby="row-quick-view-title" data-testid="row-quick-view-dialog">
      <DialogTitle id="row-quick-view-title" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 1.5, pr: 1.5 }}>
        <Box sx={{ width: 34, height: 34, borderRadius: '8px', display: 'grid', placeItems: 'center', flexShrink: 0,
          bgcolor: (t) => alpha(t.palette.primary.main, 0.08), color: 'primary.main' }}>
          <Eye size={18} />
        </Box>
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography component="span" sx={{ fontWeight: 800, fontSize: '1rem', color: PFMS.ink }}>{title}</Typography>
            {number && (
              <Typography component="span" sx={{ fontWeight: 700, fontSize: '0.9rem', color: 'primary.main', overflowWrap: 'anywhere' }}>
                {number}
              </Typography>
            )}
            {status}
          </Box>
          {subtitle && (
            <Typography sx={{ fontSize: '0.78rem', color: PFMS.sub, overflowWrap: 'anywhere' }}>{subtitle}</Typography>
          )}
        </Box>
        <IconButton onClick={onClose} size="small" aria-label="Close"><X size={18} /></IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: { xs: 1.5, sm: 2 } }}>
        <Box sx={{ display: 'grid', gap: 1.5,
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(auto-fill, minmax(170px, 1fr))' } }}>
          {fields.map((f) => (
            <Box key={f.label} sx={{ minWidth: 0, gridColumn: f.span ? `span ${f.span}` : undefined }}>
              <Typography component="div" sx={{ fontSize: '0.68rem', fontWeight: 700, color: PFMS.sub, mb: 0.25 }}>{f.label}</Typography>
              <Typography component="div" sx={{ fontSize: '0.86rem', fontWeight: 600, color: PFMS.ink, overflowWrap: 'anywhere' }}>
                {isEmpty(f.value) ? '—' : f.value}
              </Typography>
            </Box>
          ))}
        </Box>
        {children}
      </DialogContent>

      <DialogActions sx={{ p: 1.5, gap: 1 }}>
        {onOpenFull && (
          <Button startIcon={<ExternalLink size={15} />} onClick={() => { onClose(); onOpenFull(); }}>
            {openFullLabel}
          </Button>
        )}
        <Button variant="contained" onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default RowQuickViewDialog;
