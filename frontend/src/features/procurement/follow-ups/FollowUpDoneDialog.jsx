import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, MenuItem, Box, Typography, CircularProgress, Chip,
} from '@mui/material';
import { CheckCircle2 } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useMarkFollowUpDoneMutation } from '../../../store/api/procurementApi';
import { FOLLOWUP_TYPES } from './fuMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

const todayStr = () => new Date().toISOString().slice(0, 10);

/** Mark a follow-up as DONE (records actual date, delay, next/final dates). */
const FollowUpDoneDialog = ({ open, onClose, followUp }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [actualAt, setActualAt] = useState(todayStr());
  const [followUpType, setFollowUpType] = useState('CALL');
  const [remarks, setRemarks] = useState('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');
  const [finalMaterialDate, setFinalMaterialDate] = useState('');
  const [message, setMessage] = useState('');
  const [markDone, { isLoading }] = useMarkFollowUpDoneMutation();

  useEffect(() => {
    if (!open) return;
    setActualAt(todayStr());
    setFollowUpType(followUp?.followUpType || 'CALL');
    setRemarks('');
    setNextFollowUpDate('');
    setFinalMaterialDate('');
    setMessage('');
  }, [open, followUp]);

  // A next follow-up date means follow-up continues later — final material date
  // is hidden and never submitted; the two are mutually exclusive.
  const hasNext = !!nextFollowUpDate;

  const handleSubmit = async () => {
    if (!actualAt) { enqueueSnackbar('Actual Date is required', { variant: 'warning' }); return; }
    try {
      await markDone({
        id: followUp._id, actualAt, followUpType,
        remarks: remarks.trim(),
        // Mutually exclusive: keep at most one of next / final.
        nextFollowUpDate: hasNext ? nextFollowUpDate : null,
        finalMaterialDate: hasNext ? null : (finalMaterialDate || null),
        message: message.trim(),
      }).unwrap();
      enqueueSnackbar('Follow-up marked done', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to mark done', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Mark Follow-up Done
        {followUp?.followUpNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{followUp.followUpNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2, p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9', display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" fontWeight={700}>{followUp?.poNumber}</Typography>
          <Typography variant="caption" color="text.secondary">{followUp?.vendorName}</Typography>
          <Chip size="small" label="Status Done = Yes" color="success" sx={{ fontWeight: 700 }} />
        </Box>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <DateInputDDMMYYYY label="Actual Date *" fullWidth value={actualAt} onChange={setActualAt}
              error={!actualAt} helperText={!actualAt ? 'Required' : ''} />
          </Grid>
          <Grid item xs={6}>
            <TextField label="Follow-up Type" select fullWidth value={followUpType}
              onChange={(e) => setFollowUpType(e.target.value)}>
              {FOLLOWUP_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={6}>
            <DateInputDDMMYYYY label="Next Date to Follow-up" fullWidth value={nextFollowUpDate} onChange={setNextFollowUpDate}
              helperText="Optional — set to continue follow-up later" />
          </Grid>
          {/* Final material date only applies when there is no further follow-up. */}
          {!hasNext && (
            <Grid item xs={6}>
              <DateInputDDMMYYYY label="Final Date of Material" fullWidth value={finalMaterialDate} onChange={setFinalMaterialDate}
                helperText="Optional — leave blank if not known" />
            </Grid>
          )}
          <Grid item xs={12}>
            <TextField label="Communication Message" fullWidth multiline minRows={2} value={message}
              onChange={(e) => setMessage(e.target.value)} placeholder="What did the vendor say?" />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Remarks" fullWidth value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={isLoading}>Cancel</Button>
        <Button variant="contained" color="success"
          startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <CheckCircle2 size={16} />}
          onClick={handleSubmit} disabled={isLoading}>
          Mark Done
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FollowUpDoneDialog;
