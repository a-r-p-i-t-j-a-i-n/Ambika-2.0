import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Typography, CircularProgress, Alert, Grid, Chip,
  FormControl, FormLabel, RadioGroup, FormControlLabel, Radio,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import { ClipboardCheck, Wrench } from 'lucide-react';
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
  const [serviceResult, setServiceResult] = useState(''); // service QC: chosen by user
  const [completeQc, { isLoading }] = useCompleteIncomingQcMutation();

  const isService = qc?.sourceType === 'SERVICE';

  useEffect(() => { if (open) { setRemarks(''); setServiceResult(''); } }, [open]);

  const items = qc?.items || [];
  const result = expectedResult(items);

  const handleComplete = async () => {
    if (isService && !serviceResult) {
      enqueueSnackbar('Select a QC result (Pass / Fail / Partial)', { variant: 'warning' });
      return;
    }
    try {
      await completeQc({
        id: qc._id,
        remarks: remarks.trim(),
        ...(isService ? { overallResult: serviceResult } : {}),
      }).unwrap();
      enqueueSnackbar('Incoming QC completed', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to complete QC', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth={isService ? 'md' : 'xs'} fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Complete QC
        {qc?.qcNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{qc.qcNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        {isService ? (
          <>
            <Box sx={{ mb: 2, p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9', display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <Wrench size={16} color="#7c3aed" />
              <Typography variant="body2" fontWeight={700}>Service QC</Typography>
              <Chip size="small" label={qc?.serviceCompletionNumber || qc?.indentNumber || '—'} sx={{ fontWeight: 700 }} />
            </Box>

            {/* Inspection table (service line items from the indent) */}
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>Inspection ({items.length})</Typography>
            <TableContainer sx={{ mb: 2, mt: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: '8px' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell>SKU</TableCell>
                    <TableCell align="right">Requested</TableCell>
                    <TableCell align="right">Accepted</TableCell>
                    <TableCell align="right">Rejected</TableCell>
                    <TableCell align="right">Rework</TableCell>
                    <TableCell>Remarks</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.length === 0 && (
                    <TableRow><TableCell colSpan={7}><Typography variant="body2" color="text.secondary" sx={{ py: 1, textAlign: 'center' }}>No items.</Typography></TableCell></TableRow>
                  )}
                  {items.map((it, i) => (
                    <TableRow key={it._id || i}>
                      <TableCell sx={{ fontWeight: 600 }}>{it.itemName}</TableCell>
                      <TableCell>{it.skuCode || '—'}</TableCell>
                      <TableCell align="right">{it.receivedQty}</TableCell>
                      <TableCell align="right" sx={{ color: '#0f766e', fontWeight: 700 }}>{it.acceptedQty}</TableCell>
                      <TableCell align="right">{it.rejectedQty}</TableCell>
                      <TableCell align="right">{it.reworkQty}</TableCell>
                      <TableCell>{it.qcRemarks || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            <FormControl required sx={{ mb: 2 }}>
              <FormLabel sx={{ fontSize: '0.8rem', fontWeight: 700 }}>Service QC Result *</FormLabel>
              <RadioGroup row value={serviceResult} onChange={(e) => setServiceResult(e.target.value)}>
                <FormControlLabel value="PASS" control={<Radio color="success" />} label="Pass" />
                <FormControlLabel value="FAIL" control={<Radio color="error" />} label="Fail" />
                <FormControlLabel value="PARTIAL_PASS" control={<Radio color="warning" />} label="Partial" />
              </RadioGroup>
            </FormControl>
            {(qc?.checkedByName || qc?.preparedBy) && (
              <Box sx={{ mb: 2, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {qc?.checkedByName && <Typography variant="caption" color="text.secondary">Checked By: <b>{qc.checkedByName}</b></Typography>}
                {qc?.preparedBy && <Typography variant="caption" color="text.secondary">Prepared By: <b>{qc.preparedBy}</b></Typography>}
              </Box>
            )}
            <Alert severity="info" sx={{ mb: 2 }}>Service QC validates work quality only — no stock / inventory is affected.</Alert>
            <TextField label="QC Remarks" fullWidth multiline minRows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </>
        ) : (
          <>
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
          </>
        )}
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
