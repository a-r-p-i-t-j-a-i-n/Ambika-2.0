import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, Box, Typography, CircularProgress,
} from '@mui/material';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useApproveIndentMutation,
  useRejectIndentMutation,
} from '../../../store/api/procurementApi';

/**
 * Approve / reject an indent.
 * Fields: Revised Quantity, Approved Quantity, Remarks → Approve | Reject.
 */
const IndentApprovalDialog = ({ open, onClose, indent }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [revisedQuantity, setRevisedQuantity] = useState('');
  const [approvedQuantity, setApprovedQuantity] = useState('');
  const [remarks, setRemarks] = useState('');

  const [approve, { isLoading: approving }] = useApproveIndentMutation();
  const [reject, { isLoading: rejecting }] = useRejectIndentMutation();
  const busy = approving || rejecting;

  useEffect(() => {
    if (open && indent) {
      setRevisedQuantity(indent.revisedQuantity || indent.quantity || '');
      setApprovedQuantity(indent.approvedQuantity || indent.quantity || '');
      setRemarks('');
    }
  }, [open, indent]);

  const handleApprove = async () => {
    if (approvedQuantity === '' || Number(approvedQuantity) < 0) {
      enqueueSnackbar('Enter an approved quantity', { variant: 'warning' });
      return;
    }
    try {
      await approve({
        id: indent._id,
        revisedQuantity: revisedQuantity === '' ? 0 : Number(revisedQuantity),
        approvedQuantity: Number(approvedQuantity),
        remarks: remarks.trim(),
      }).unwrap();
      enqueueSnackbar('Indent approved', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to approve', { variant: 'error' });
    }
  };

  const handleReject = async () => {
    try {
      await reject({ id: indent._id, remarks: remarks.trim() }).unwrap();
      enqueueSnackbar('Indent rejected', { variant: 'info' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to reject', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Approve Indent
        {indent?.indentNumber && (
          <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>
            {indent.indentNumber}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2, p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9' }}>
          <Typography variant="body2" fontWeight={700}>{indent?.productNameRevised}</Typography>
          <Typography variant="caption" color="text.secondary">
            Requested: {indent?.quantity} {indent?.unit} · {indent?.department} · by {indent?.raisedBy || '—'}
          </Typography>
        </Box>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <TextField label="Revised Quantity" type="number" fullWidth value={revisedQuantity}
              onChange={(e) => setRevisedQuantity(e.target.value)} inputProps={{ min: 0 }} />
          </Grid>
          <Grid item xs={6}>
            <TextField label="Approved Quantity *" type="number" fullWidth value={approvedQuantity}
              onChange={(e) => setApprovedQuantity(e.target.value)} inputProps={{ min: 0 }} />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Remarks" fullWidth multiline minRows={2} value={remarks}
              onChange={(e) => setRemarks(e.target.value)} placeholder="Optional note for the requester" />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={busy}>Cancel</Button>
        <Button color="error" variant="outlined" startIcon={<XCircle size={16} />} onClick={handleReject} disabled={busy}>
          Reject
        </Button>
        <Button color="success" variant="contained" startIcon={approving ? <CircularProgress size={16} color="inherit" /> : <CheckCircle2 size={16} />}
          onClick={handleApprove} disabled={busy}>
          Approve
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default IndentApprovalDialog;
