import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Typography, CircularProgress, Alert,
} from '@mui/material';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useApproveVendorInvoiceMutation,
  useRejectVendorInvoiceMutation,
} from '../../../store/api/procurementApi';
import { fmtINR } from './invoiceMeta';

/** Approve / reject a vendor invoice. Approval requires the invoice document. */
const VendorInvoiceApprovalDialog = ({ open, onClose, invoice }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [remarks, setRemarks] = useState('');
  const [approveInv, { isLoading: approving }] = useApproveVendorInvoiceMutation();
  const [rejectInv, { isLoading: rejecting }] = useRejectVendorInvoiceMutation();
  const busy = approving || rejecting;

  useEffect(() => { if (open) setRemarks(''); }, [open]);
  const hasDoc = Boolean(invoice?.invoiceDocument?.fileUrl);

  const decide = async (kind) => {
    const fn = kind === 'approve' ? approveInv : rejectInv;
    try {
      await fn({ id: invoice._id, remarks: remarks.trim() }).unwrap();
      enqueueSnackbar(kind === 'approve' ? 'Invoice approved — payment pending' : 'Invoice rejected', { variant: kind === 'approve' ? 'success' : 'info' });
      onClose?.(true);
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed', { variant: 'error' }); }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Approve Invoice
        {invoice?.invoiceNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{invoice.invoiceNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2, p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9' }}>
          <Typography variant="body2" fontWeight={700}>{invoice?.vendorName}</Typography>
          <Typography variant="caption" color="text.secondary">
            GRN {invoice?.grnNumber || '—'} · Net Payable {fmtINR(invoice?.netPayableAmount)}
          </Typography>
        </Box>
        {!hasDoc && <Alert severity="warning" sx={{ mb: 2 }}>Upload the invoice document (Edit) before approving.</Alert>}
        <TextField label="Remarks" fullWidth multiline minRows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={busy}>Cancel</Button>
        <Button color="error" variant="outlined" startIcon={<XCircle size={16} />} onClick={() => decide('reject')} disabled={busy}>Reject</Button>
        <Button color="success" variant="contained" startIcon={approving ? <CircularProgress size={16} color="inherit" /> : <CheckCircle2 size={16} />} onClick={() => decide('approve')} disabled={busy || !hasDoc}>Approve</Button>
      </DialogActions>
    </Dialog>
  );
};

export default VendorInvoiceApprovalDialog;
