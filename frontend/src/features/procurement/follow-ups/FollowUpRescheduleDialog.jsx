import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, MenuItem, Typography, CircularProgress,
} from '@mui/material';
import { CalendarClock } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useRescheduleFollowUpMutation } from '../../../store/api/procurementApi';
import { FOLLOWUP_TYPES } from './fuMeta';

/** Push a follow-up to a new date (adds a communication-log entry). */
const FollowUpRescheduleDialog = ({ open, onClose, followUp }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');
  const [followUpType, setFollowUpType] = useState('CALL');
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState('');
  const [reschedule, { isLoading }] = useRescheduleFollowUpMutation();

  useEffect(() => {
    if (!open) return;
    setNextFollowUpDate('');
    setFollowUpType(followUp?.followUpType || 'CALL');
    setRemarks('');
    setMessage('');
  }, [open, followUp]);

  const handleSubmit = async () => {
    if (!nextFollowUpDate) { enqueueSnackbar('Pick the next follow-up date', { variant: 'warning' }); return; }
    try {
      await reschedule({
        id: followUp._id, nextFollowUpDate, followUpType,
        remarks: remarks.trim(), message: message.trim(),
      }).unwrap();
      enqueueSnackbar('Follow-up rescheduled', { variant: 'info' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to reschedule', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Reschedule Follow-up
        {followUp?.followUpNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{followUp.followUpNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <TextField label="Next Follow-up Date *" type="date" fullWidth value={nextFollowUpDate}
              onChange={(e) => setNextFollowUpDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid item xs={6}>
            <TextField label="Follow-up Type" select fullWidth value={followUpType}
              onChange={(e) => setFollowUpType(e.target.value)}>
              {FOLLOWUP_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <TextField label="Reason / Remarks" fullWidth value={remarks}
              onChange={(e) => setRemarks(e.target.value)} placeholder="Why is it moving?" />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Communication Message" fullWidth multiline minRows={2} value={message}
              onChange={(e) => setMessage(e.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={isLoading}>Cancel</Button>
        <Button variant="contained"
          startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <CalendarClock size={16} />}
          onClick={handleSubmit} disabled={isLoading}>
          Reschedule
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FollowUpRescheduleDialog;
