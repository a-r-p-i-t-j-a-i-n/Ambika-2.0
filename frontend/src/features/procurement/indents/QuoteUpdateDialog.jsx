import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, MenuItem, FormControlLabel, Switch, Typography, CircularProgress,
} from '@mui/material';
import { Save } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useReceiveQuoteMutation,
  useApproveQuotationMutation,
} from '../../../store/api/procurementApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

/**
 * Dual-purpose quote dialog.
 *   mode="receive"  → Receive Quote   (Quote Status, Quotation Uploaded, Form Link, Actual Date, Remarks)
 *   mode="approve"  → Approve Quotation(Approved Quotation, Form Link, Actual Date, Remarks)
 */
const todayStr = () => new Date().toISOString().slice(0, 10);

const QuoteUpdateDialog = ({ open, onClose, indent, mode = 'receive' }) => {
  const { enqueueSnackbar } = useSnackbar();
  const isReceive = mode === 'receive';

  const [status, setStatus] = useState('RECEIVED');
  const [quotationUploaded, setQuotationUploaded] = useState(false);
  const [approvedQuotation, setApprovedQuotation] = useState('');
  const [formLink, setFormLink] = useState('');
  const [actualAt, setActualAt] = useState(todayStr());
  const [remarks, setRemarks] = useState('');

  const [receiveQuote, { isLoading: receiving }] = useReceiveQuoteMutation();
  const [approveQuotation, { isLoading: approving }] = useApproveQuotationMutation();
  const busy = receiving || approving;

  useEffect(() => {
    if (!open) return;
    setStatus('RECEIVED');
    setQuotationUploaded(!!indent?.quoteStep?.quotationUploaded);
    setApprovedQuotation(indent?.quotationApprovalStep?.approvedQuotation || indent?.vendorName || '');
    setFormLink('');
    setActualAt(todayStr());
    setRemarks('');
  }, [open, indent, mode]);

  const handleSubmit = async () => {
    try {
      if (isReceive) {
        await receiveQuote({
          id: indent._id, status, quotationUploaded,
          formLink: formLink.trim(), actualAt, remarks: remarks.trim(),
        }).unwrap();
        enqueueSnackbar('Quote recorded', { variant: 'success' });
      } else {
        await approveQuotation({
          id: indent._id, approvedQuotation: approvedQuotation.trim(),
          formLink: formLink.trim(), actualAt, remarks: remarks.trim(),
        }).unwrap();
        enqueueSnackbar('Quotation approved', { variant: 'success' });
      }
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        {isReceive ? 'Receive Quote' : 'Approve Quotation'}
        {indent?.indentNumber && (
          <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>
            {indent.indentNumber}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          {isReceive ? (
            <>
              <Grid item xs={12} sm={6}>
                <TextField label="Quote Status" select fullWidth value={status} onChange={(e) => setStatus(e.target.value)}>
                  <MenuItem value="RECEIVED">Received</MenuItem>
                  <MenuItem value="NOT_REQUIRED">Not Required</MenuItem>
                  <MenuItem value="PENDING">Pending</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} sx={{ display: 'flex', alignItems: 'center' }}>
                <FormControlLabel
                  control={<Switch checked={quotationUploaded} onChange={(e) => setQuotationUploaded(e.target.checked)} />}
                  label="Quotation Uploaded"
                />
              </Grid>
            </>
          ) : (
            <Grid item xs={12}>
              <TextField label="Approved Quotation" fullWidth value={approvedQuotation}
                onChange={(e) => setApprovedQuotation(e.target.value)} placeholder="Vendor / quote reference" />
            </Grid>
          )}
          <Grid item xs={12} sm={7}>
            <TextField label="Form Link" fullWidth value={formLink}
              onChange={(e) => setFormLink(e.target.value)} placeholder="https://…" />
          </Grid>
          <Grid item xs={12} sm={5}>
            <DateInputDDMMYYYY label="Actual Date" fullWidth value={actualAt}
              onChange={setActualAt} />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Remarks" fullWidth multiline minRows={2} value={remarks}
              onChange={(e) => setRemarks(e.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={busy}>Cancel</Button>
        <Button variant="contained" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
          onClick={handleSubmit} disabled={busy}>
          {isReceive ? 'Save Quote' : 'Approve Quotation'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default QuoteUpdateDialog;
