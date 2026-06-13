import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Typography, CircularProgress, Alert, FormControlLabel, Checkbox,
} from '@mui/material';
import { PackageCheck } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useCompleteGrnMutation } from '../../../store/api/procurementApi';
import { fmtINR } from './grnMeta';

/**
 * Complete a GRN: posts received quantities to stock (via inventoryService)
 * and updates the PO/PI received quantities. This action is irreversible.
 */
const GrnCompleteDialog = ({ open, onClose, grn }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [allowOverReceipt, setAllowOverReceipt] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [completeGrn, { isLoading }] = useCompleteGrnMutation();

  useEffect(() => { if (open) { setAllowOverReceipt(false); setRemarks(''); } }, [open]);

  const handleComplete = async () => {
    try {
      await completeGrn({ id: grn._id, allowOverReceipt, remarks: remarks.trim() }).unwrap();
      enqueueSnackbar('GRN completed — stock posted', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to complete GRN', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Complete GRN
        {grn?.grnNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{grn.grnNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2, p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9' }}>
          <Typography variant="body2" fontWeight={700}>{grn?.vendorName}</Typography>
          <Typography variant="caption" color="text.secondary">
            PO {grn?.poNumber || '—'} · {grn?.items?.length || 0} item(s) · qty {grn?.totalReceivedQty} · {fmtINR(grn?.totalValue)}
          </Typography>
        </Box>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This will <b>increase stock</b> by the received quantities and update the PO. It cannot be undone.
        </Alert>
        <FormControlLabel
          control={<Checkbox checked={allowOverReceipt} onChange={(e) => setAllowOverReceipt(e.target.checked)} />}
          label="Allow over-receipt (received qty may exceed pending PO qty)"
        />
        <TextField label="Remarks" fullWidth multiline minRows={2} value={remarks}
          onChange={(e) => setRemarks(e.target.value)} sx={{ mt: 1.5 }} />
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={isLoading}>Cancel</Button>
        <Button variant="contained" color="success"
          startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <PackageCheck size={16} />}
          onClick={handleComplete} disabled={isLoading}>
          Complete &amp; Post Stock
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default GrnCompleteDialog;
