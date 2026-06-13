import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Typography, CircularProgress, Alert, Grid,
} from '@mui/material';
import { ClipboardCheck } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useCompleteIncomingQcMutation } from '../../../store/api/procurementApi';
import { QcResultChip } from './qcMeta';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Expected result preview + confirm. Rejected qty moves out of stock on complete. */
const expectedResult = (items = []) => {
  const allAccepted = items.every((it) => round2(it.acceptedQty) === round2(it.receivedQty) && round2(it.rejectedQty) === 0 && round2(it.reworkQty) === 0);
  const allRejected = items.every((it) => round2(it.rejectedQty) === round2(it.receivedQty) && round2(it.acceptedQty) === 0);
  if (allAccepted) return 'PASS';
  if (allRejected) return 'FAIL';
  return 'PARTIAL_PASS';
};

const Stat = ({ label, value, color }) => (
  <Box sx={{ textAlign: 'center' }}>
    <Typography sx={{ fontSize: '1.2rem', fontWeight: 800, color }}>{value}</Typography>
    <Typography variant="caption" color="text.secondary" fontWeight={700}>{label}</Typography>
  </Box>
);

const IncomingQCCompleteDialog = ({ open, onClose, qc }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [remarks, setRemarks] = useState('');
  const [completeQc, { isLoading }] = useCompleteIncomingQcMutation();

  useEffect(() => { if (open) setRemarks(''); }, [open]);

  const items = qc?.items || [];
  const result = expectedResult(items);

  const handleComplete = async () => {
    try {
      await completeQc({ id: qc._id, remarks: remarks.trim() }).unwrap();
      enqueueSnackbar('Incoming QC completed', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to complete QC', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Complete QC
        {qc?.qcNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{qc.qcNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2, p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9' }}>
          <Grid container spacing={1}>
            <Grid item xs={3}><Stat label="Received" value={qc?.totalReceived} color="text.primary" /></Grid>
            <Grid item xs={3}><Stat label="Accepted" value={qc?.totalAccepted} color="#0f766e" /></Grid>
            <Grid item xs={3}><Stat label="Rejected" value={qc?.totalRejected} color="#be123c" /></Grid>
            <Grid item xs={3}><Stat label="Rework" value={qc?.totalRework} color="#b45309" /></Grid>
          </Grid>
        </Box>
        <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" fontWeight={700}>Expected Result:</Typography>
          <QcResultChip result={result} />
        </Box>
        <Alert severity={qc?.totalRejected > 0 ? 'warning' : 'info'} sx={{ mb: 2 }}>
          {qc?.totalRejected > 0
            ? `Rejected ${qc.totalRejected} will be moved OUT of stock (QC_REJECT_OUT). Accepted qty stays.`
            : 'Accepted qty stays in stock; no stock-out needed.'}
        </Alert>
        <TextField label="Remarks" fullWidth multiline minRows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={isLoading}>Cancel</Button>
        <Button variant="contained" color="success"
          startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <ClipboardCheck size={16} />}
          onClick={handleComplete} disabled={isLoading}>
          Complete QC
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default IncomingQCCompleteDialog;
