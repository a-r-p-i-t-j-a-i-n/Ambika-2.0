import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Typography, CircularProgress,
} from '@mui/material';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useApprovePurchaseOrderMutation } from '../../../store/api/procurementApi';
import { fmtINR } from './poMeta';

/** Approve / reject a draft Vendor PO. */
const PurchaseOrderApprovalDialog = ({ open, onClose, po }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [remarks, setRemarks] = useState('');
  const [approvePo, { isLoading }] = useApprovePurchaseOrderMutation();

  useEffect(() => { if (open) setRemarks(''); }, [open]);

  const decide = async (decision) => {
    try {
      await approvePo({ id: po._id, decision, remarks: remarks.trim() }).unwrap();
      enqueueSnackbar(`PO ${decision === 'REJECTED' ? 'rejected' : 'approved'}`, { variant: decision === 'REJECTED' ? 'info' : 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save decision', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Approve Purchase Order
        {po?.poNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{po.poNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2, p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9' }}>
          <Typography variant="body2" fontWeight={700}>{po?.vendorName}</Typography>
          <Typography variant="caption" color="text.secondary">
            {po?.items?.length || 0} item(s) · {fmtINR(po?.grandTotal)} · Indent {po?.indentNumber || '—'}
          </Typography>
        </Box>
        <TextField label="Remarks" fullWidth multiline minRows={2} value={remarks}
          onChange={(e) => setRemarks(e.target.value)} placeholder="Optional approval / rejection note" />
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={isLoading}>Cancel</Button>
        <Button color="error" variant="outlined" startIcon={<XCircle size={16} />} onClick={() => decide('REJECTED')} disabled={isLoading}>
          Reject
        </Button>
        <Button color="success" variant="contained"
          startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <CheckCircle2 size={16} />}
          onClick={() => decide('APPROVED')} disabled={isLoading}>
          Approve
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default PurchaseOrderApprovalDialog;
