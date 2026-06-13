import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Typography, CircularProgress, FormControlLabel, Switch, Alert,
} from '@mui/material';
import { Send } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useReleasePurchaseOrderMutation } from '../../../store/api/procurementApi';
import { fmtINR } from './poMeta';

/**
 * Release an approved PO to the supplier.
 * On release the backend sets RELEASED_TO_VENDOR and generates the PO PDF.
 */
const PurchaseOrderReleaseDialog = ({ open, onClose, po }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [sendEmail, setSendEmail] = useState(true);
  const [remarks, setRemarks] = useState('');
  const [releasePo, { isLoading }] = useReleasePurchaseOrderMutation();

  useEffect(() => { if (open) { setSendEmail(Boolean(po?.vendorEmail)); setRemarks(''); } }, [open, po]);

  const handleRelease = async () => {
    try {
      const res = await releasePo({ id: po._id, sendEmail, remarks: remarks.trim() }).unwrap();
      const url = res?.data?.poPdfUrl;
      enqueueSnackbar(url ? 'PO released — PDF generated' : 'PO released', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to release PO', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Release to Supplier
        {po?.poNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{po.poNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2, p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9' }}>
          <Typography variant="body2" fontWeight={700}>{po?.vendorName}</Typography>
          <Typography variant="caption" color="text.secondary">
            {po?.items?.length || 0} item(s) · {fmtINR(po?.grandTotal)}
          </Typography>
        </Box>
        <Alert severity="info" sx={{ mb: 2 }}>
          Releasing marks the PO as <b>Released to Vendor</b> and generates the official PO PDF.
        </Alert>
        <FormControlLabel
          control={<Switch checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />}
          label={`Send email to supplier${po?.vendorEmail ? ` (${po.vendorEmail})` : ''}`}
        />
        <TextField label="Remarks" fullWidth multiline minRows={2} value={remarks}
          onChange={(e) => setRemarks(e.target.value)} sx={{ mt: 2 }} />
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={isLoading}>Cancel</Button>
        <Button variant="contained" color="success"
          startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <Send size={16} />}
          onClick={handleRelease} disabled={isLoading}>
          Confirm Release
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PurchaseOrderReleaseDialog;
