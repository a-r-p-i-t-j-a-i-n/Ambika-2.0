import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, Button, IconButton,
  CircularProgress, useMediaQuery,
} from '@mui/material';
import { useTheme, alpha } from '@mui/material/styles';
import { X, ExternalLink, PackageX, AlertTriangle, ListChecks } from 'lucide-react';
import { useGetPurchaseOrderQuery } from '../../../store/api/procurementApi';
import { PoStatusChip, poDisplayNumber } from './poMeta';
import { PFMS } from '../pfmsTheme';
import PoItemsTable from './PoItemsTable';

/**
 * Read-only item quick view for one PO, opened from the Purchase Orders list's
 * eye icon so the user stays on the list. Loads the PO by id (same query as the
 * detail page) and renders the detail page's own items table. `currentData`
 * is used so a previously viewed PO's items never show while another loads.
 */
const PoItemsQuickViewDialog = ({ po, onClose }) => {
  const navigate = useNavigate();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const open = Boolean(po);
  const { currentData, isFetching, isError, error, refetch } = useGetPurchaseOrderQuery(po?._id, { skip: !open });
  const detail = po && currentData?.data?._id === po._id ? currentData.data : null;
  const items = detail?.items || [];

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} maxWidth="lg" fullWidth
      aria-labelledby="po-items-quick-view-title">
      <DialogTitle id="po-items-quick-view-title"
        sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 1.5, pr: 1.5 }}>
        <Box sx={{ width: 34, height: 34, borderRadius: '8px', display: 'grid', placeItems: 'center', flexShrink: 0,
          bgcolor: (t) => alpha(t.palette.primary.main, 0.08), color: 'primary.main' }}>
          <ListChecks size={18} />
        </Box>
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography component="span" sx={{ fontWeight: 800, fontSize: '1rem', color: PFMS.ink }}>
              Item Details{detail ? ` (${items.length})` : ''}
            </Typography>
            <Typography component="span" sx={{ fontWeight: 700, fontSize: '0.9rem', color: 'primary.main' }}>
              {poDisplayNumber(detail || po)}
            </Typography>
            {(detail || po)?.poStatus && <PoStatusChip status={(detail || po).poStatus} />}
          </Box>
          <Typography sx={{ fontSize: '0.78rem', color: PFMS.sub, overflowWrap: 'anywhere' }}>
            {(detail || po)?.vendorName || '—'}
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small" aria-label="Close"><X size={18} /></IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: { xs: 1.5, sm: 2 } }}>
        {!detail && isFetching && (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
            <CircularProgress size={28} />
            <Typography sx={{ mt: 1.5, fontSize: '0.85rem', color: PFMS.sub }}>Loading items…</Typography>
          </Box>
        )}
        {!detail && !isFetching && isError && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <AlertTriangle size={30} color="#dc2626" />
            <Typography sx={{ mt: 1, fontWeight: 700, color: PFMS.ink }}>Could not load this PO's items</Typography>
            <Typography sx={{ fontSize: '0.82rem', color: PFMS.sub, mb: 2 }}>
              {error?.data?.message || 'Please try again.'}
            </Typography>
            <Button variant="outlined" size="small" onClick={refetch}>Retry</Button>
          </Box>
        )}
        {detail && items.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 6, color: 'text.disabled' }}>
            <PackageX size={30} />
            <Typography sx={{ mt: 1, fontSize: '0.85rem', color: PFMS.sub }}>This PO has no items.</Typography>
          </Box>
        )}
        {detail && items.length > 0 && <PoItemsTable po={detail} />}
      </DialogContent>

      <DialogActions sx={{ p: 1.5, gap: 1 }}>
        <Button startIcon={<ExternalLink size={15} />} disabled={!po}
          onClick={() => { const id = po._id; onClose(); navigate(`/procurement/purchase-orders/${id}`); }}>
          Open full PO
        </Button>
        <Button variant="contained" onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default PoItemsQuickViewDialog;
