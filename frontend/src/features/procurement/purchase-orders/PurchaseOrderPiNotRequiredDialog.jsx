import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Typography, CircularProgress, Alert,
} from '@mui/material';
import { CircleSlash } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useMarkPoPiNotRequiredMutation } from '../../../store/api/procurementApi';

/**
 * Mark a PO's Proforma Invoice as Not Required (the audited "PI optional" path).
 * Reason is mandatory; remarks optional. The decision is recorded forever and
 * moves the PO straight to the GRN stage (no PI, no advance payment).
 */
const PurchaseOrderPiNotRequiredDialog = ({ open, onClose, po }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [mark, { isLoading }] = useMarkPoPiNotRequiredMutation();

  useEffect(() => { if (open) { setReason(''); setRemarks(''); } }, [open]);

  const submit = async () => {
    if (!reason.trim()) { enqueueSnackbar('Reason is required', { variant: 'warning' }); return; }
    try {
      await mark({ id: po._id, reason: reason.trim(), remarks: remarks.trim() }).unwrap();
      enqueueSnackbar('PI marked as Not Required', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to mark PI Not Required', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
        <CircleSlash size={20} /> Mark PI Not Required
        {po?.poNumber && (
          <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>
            {po.poNumber}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This records that no proforma invoice and no advance payment are required for this PO.
          It will move straight to the GRN stage. The decision is audited (who, when, why) and kept permanently.
        </Alert>
        <TextField label="Reason *" fullWidth autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Vendor does not provide PI" sx={{ mb: 2 }} error={!reason.trim()}
          helperText={!reason.trim() ? 'Required' : ''} />
        <TextField label="Remarks" fullWidth multiline minRows={2} value={remarks}
          onChange={(e) => setRemarks(e.target.value)} placeholder="Optional — e.g. Material will be supplied directly" />
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={isLoading}>Cancel</Button>
        <Button variant="contained" color="warning"
          startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <CircleSlash size={16} />}
          onClick={submit} disabled={isLoading}>
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PurchaseOrderPiNotRequiredDialog;
