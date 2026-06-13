import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Typography, CircularProgress, Alert,
} from '@mui/material';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useApproveProformaInvoiceMutation,
  useRejectProformaInvoiceMutation,
} from '../../../store/api/procurementApi';
import { fmtINR } from './piMeta';

/** Approve / reject a PI. Approval requires the PI document (backend enforces). */
const ProformaInvoiceApprovalDialog = ({ open, onClose, pi }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [remarks, setRemarks] = useState('');
  const [approvePi, { isLoading: approving }] = useApproveProformaInvoiceMutation();
  const [rejectPi, { isLoading: rejecting }] = useRejectProformaInvoiceMutation();
  const busy = approving || rejecting;

  useEffect(() => { if (open) setRemarks(''); }, [open]);

  const hasDocument = Boolean(pi?.piDocument?.fileUrl);

  const handleApprove = async () => {
    try {
      await approvePi({ id: pi._id, remarks: remarks.trim() }).unwrap();
      enqueueSnackbar('PI approved — ready for advance payment', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to approve', { variant: 'error' });
    }
  };

  const handleReject = async () => {
    try {
      await rejectPi({ id: pi._id, remarks: remarks.trim() }).unwrap();
      enqueueSnackbar('PI rejected', { variant: 'info' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to reject', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        PI Verification
        {pi?.piNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{pi.piNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2, p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9' }}>
          <Typography variant="body2" fontWeight={700}>{pi?.vendorName}</Typography>
          <Typography variant="caption" color="text.secondary">
            PO {pi?.poNumber || '—'} · {pi?.items?.length || 0} item(s) · {fmtINR(pi?.totalValue)}
          </Typography>
        </Box>
        {!hasDocument && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            No PI document uploaded yet — upload it (Edit PI) before approving.
          </Alert>
        )}
        <TextField label="Remarks" fullWidth multiline minRows={2} value={remarks}
          onChange={(e) => setRemarks(e.target.value)} placeholder="Approval / rejection note" />
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={busy}>Cancel</Button>
        <Button color="error" variant="outlined" startIcon={<XCircle size={16} />} onClick={handleReject} disabled={busy}>
          Reject
        </Button>
        <Button color="success" variant="contained"
          startIcon={approving ? <CircularProgress size={16} color="inherit" /> : <CheckCircle2 size={16} />}
          onClick={handleApprove} disabled={busy || !hasDocument}>
          Approve
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ProformaInvoiceApprovalDialog;
