import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, Typography, CircularProgress, Alert, FormControlLabel, Checkbox,
} from '@mui/material';
import { PackageCheck } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useMarkReadyForGrnMutation } from '../../../store/api/procurementApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Declare material READY FOR GRN. Updates the linked PO's followUpStatus too.
 * No stock is received here — the GRN module owns that (built later).
 */
const FollowUpReadyForGrnDialog = ({ open, onClose, followUp }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [finalMaterialDate, setFinalMaterialDate] = useState('');
  const [remarks, setRemarks] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [markReady, { isLoading }] = useMarkReadyForGrnMutation();

  useEffect(() => {
    if (!open) return;
    // Pre-fill only when a Final Material Date was already confirmed (Step 1.5).
    // A follow-up with only a Next Follow-up Date stays blank → must be filled.
    setFinalMaterialDate(followUp?.finalMaterialDate ? followUp.finalMaterialDate.slice(0, 10) : '');
    setRemarks('');
    setConfirmed(false);
  }, [open, followUp]);

  // Material delivery must be confirmed via a Final Material Date before GRN.
  const missingFinalDate = !finalMaterialDate;

  const handleSubmit = async () => {
    if (missingFinalDate) { enqueueSnackbar('Final Material Date is required before GRN.', { variant: 'warning' }); return; }
    if (!confirmed) { enqueueSnackbar('Tick the confirmation checkbox first', { variant: 'warning' }); return; }
    try {
      await markReady({ id: followUp._id, finalMaterialDate, remarks: remarks.trim() }).unwrap();
      enqueueSnackbar('Material marked ready for GRN', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to mark ready for GRN', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Ready For GRN
        {followUp?.followUpNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{followUp.followUpNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 2 }}>
          This marks the PO <b>{followUp?.poNumber}</b> as <b>Ready For GRN</b>. Stock is NOT received here —
          the GRN module will handle receiving later.
        </Alert>
        {missingFinalDate && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Final Material Date is required before GRN. Material delivery is not yet confirmed.
          </Alert>
        )}
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <DateInputDDMMYYYY label="Final Material Date *" fullWidth required openOnClick value={finalMaterialDate}
              onChange={setFinalMaterialDate} error={missingFinalDate}
              helperText={missingFinalDate ? 'Final Material Date is required before GRN.' : ''} />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Remarks" fullWidth multiline minRows={2} value={remarks}
              onChange={(e) => setRemarks(e.target.value)} />
          </Grid>
          <Grid item xs={12}>
            <FormControlLabel
              control={<Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />}
              label="I confirm the vendor has the material ready for delivery / receiving"
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={isLoading}>Cancel</Button>
        <Button variant="contained" color="success"
          startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <PackageCheck size={16} />}
          onClick={handleSubmit} disabled={isLoading || !confirmed || missingFinalDate}>
          Mark Ready For GRN
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FollowUpReadyForGrnDialog;
