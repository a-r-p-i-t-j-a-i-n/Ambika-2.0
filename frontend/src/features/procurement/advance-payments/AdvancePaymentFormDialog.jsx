import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, MenuItem, Box, Typography, CircularProgress, Alert,
} from '@mui/material';
import { Wallet, Save } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useCreateAdvancePaymentMutation } from '../../../store/api/procurementApi';
import { PAYMENT_STATUSES, PAYMENT_MODES, modeLabel, fmtINR } from './apMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { PFMS } from '../pfmsTheme';

/**
 * Step 1.7 — record an Advance Payment against a PI (Google-form fields).
 * Rules mirrored from the backend:
 *   FULL_PAYMENT  → amount must equal the PI balance.
 *   SHORT_PAYMENT_COMPLETED → remarks required, must leave a balance.
 *   CANCELLED     → nothing is posted.
 */
const todayStr = () => new Date().toISOString().slice(0, 10);

const STATUS_LABELS = {
  PART_PAYMENT: 'Part Payment',
  FULL_PAYMENT: 'Full Payment',
  SHORT_PAYMENT_COMPLETED: 'Short Payment Completed',
  CANCELLED: 'Cancelled',
};

const AdvancePaymentFormDialog = ({ open, onClose, pi }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [paymentStatus, setPaymentStatus] = useState('PART_PAYMENT');
  const [paymentDate, setPaymentDate] = useState(todayStr());
  const [paidAmount, setPaidAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('E_FUND_TRANSFER');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [remarks, setRemarks] = useState('');
  const [createPayment, { isLoading }] = useCreateAdvancePaymentMutation();

  const balance = Number(pi?.balanceAmount) || 0;
  const isCancelled = paymentStatus === 'CANCELLED';
  const isShort = paymentStatus === 'SHORT_PAYMENT_COMPLETED';
  const isFull = paymentStatus === 'FULL_PAYMENT';

  useEffect(() => {
    if (!open) return;
    setPaymentStatus('PART_PAYMENT');
    setPaymentDate(todayStr());
    setPaidAmount('');
    setPaymentMode('E_FUND_TRANSFER');
    setReferenceNumber('');
    setRemarks('');
  }, [open]);

  // Full payment auto-fills the exact balance.
  useEffect(() => {
    if (isFull) setPaidAmount(String(balance));
  }, [isFull, balance]);

  const handleSubmit = async () => {
    if (!isCancelled && (!paidAmount || Number(paidAmount) <= 0)) {
      enqueueSnackbar('Paid amount must be greater than zero', { variant: 'warning' });
      return;
    }
    if (isShort && !remarks.trim()) {
      enqueueSnackbar('Remarks are required for short payment completion', { variant: 'warning' });
      return;
    }
    try {
      const res = await createPayment({
        piId: pi._id,
        paymentStatus,
        paymentDate,
        paidAmount: isCancelled ? 0 : Number(paidAmount),
        paymentMode,
        paymentReferenceNumber: referenceNumber.trim(),
        remarks: remarks.trim(),
      }).unwrap();
      enqueueSnackbar(`Payment ${res?.data?.paymentNumber || ''} recorded`, { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to record payment', { variant: 'error' });
    }
  };

  const after = isCancelled ? balance : Math.max(0, balance - (Number(paidAmount) || 0));

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Wallet size={20} /> Record Advance Payment
        {pi?.piNumber && <Typography component="span" sx={{ ml: 0.5, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{pi.piNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2, p: 1.5, borderRadius: '8px', bgcolor: PFMS.surfaceAlt, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={700}>VENDOR</Typography>
            <Typography variant="body2" fontWeight={700}>{pi?.vendorName || '—'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={700}>TOTAL</Typography>
            <Typography variant="body2" fontWeight={700}>{fmtINR(pi?.totalValue)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={700}>PAID</Typography>
            <Typography variant="body2" fontWeight={700} sx={{ color: '#0f766e' }}>{fmtINR(pi?.paidAmount)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={700}>BALANCE</Typography>
            <Typography variant="body2" fontWeight={800} sx={{ color: '#b45309' }}>{fmtINR(balance)}</Typography>
          </Box>
        </Box>

        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField label="Payment Status *" select fullWidth value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}>
              {PAYMENT_STATUSES.map((s) => <MenuItem key={s} value={s}>{STATUS_LABELS[s]}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <DateInputDDMMYYYY label="Amount Date *" fullWidth value={paymentDate}
              onChange={setPaymentDate} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label={isCancelled ? 'Paid Amount (not posted)' : 'Paid Amount *'} type="number" fullWidth
              value={paidAmount} onChange={(e) => setPaidAmount(e.target.value)}
              disabled={isCancelled || isFull}
              inputProps={{ min: 0, step: 0.01 }}
              helperText={isFull ? 'Full payment clears the exact balance' : isCancelled ? 'No posting for cancelled entries' : `Max ${fmtINR(balance)}`} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Payment Mode" select fullWidth value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)}>
              {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{modeLabel(m)}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <TextField label="Reference Number" fullWidth value={referenceNumber}
              onChange={(e) => setReferenceNumber(e.target.value)}
              placeholder="GBM-00345061714 / UTR123456789 / CHQ000123" />
          </Grid>
          <Grid item xs={12}>
            <TextField label={isShort ? 'Remarks * (required for short closure)' : 'Remarks'} fullWidth multiline minRows={2}
              value={remarks} onChange={(e) => setRemarks(e.target.value)}
              placeholder={isShort ? 'e.g. Vendor agreed to close order with short receipt.' : ''}
              error={isShort && !remarks.trim()} />
          </Grid>
          {!isCancelled && (
            <Grid item xs={12}>
              <Alert severity={after === 0 ? 'success' : 'info'}>
                Balance after this payment: <b>{fmtINR(after)}</b>
                {after === 0 ? ' — PI will be marked PAYMENT COMPLETED.' : isShort ? ' — PI will be closed short.' : ''}
              </Alert>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={isLoading}>Cancel</Button>
        <Button variant="contained" startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
          onClick={handleSubmit} disabled={isLoading}>
          Record Payment
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AdvancePaymentFormDialog;
