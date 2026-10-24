import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, MenuItem, Box, Typography, CircularProgress, Chip, Alert,
  Table, TableHead, TableBody, TableRow, TableCell,
} from '@mui/material';
import { CheckCircle2, History } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useMarkFollowUpDoneMutation, useGetFollowUpsByPoQuery } from '../../../store/api/procurementApi';
import { FOLLOWUP_TYPES, FuStatusChip, fmtDate } from './fuMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

const todayStr = () => new Date().toISOString().slice(0, 10);
const ACTIVE = ['PENDING', 'RESCHEDULED'];
const OUTCOME_META = {
  CREATED:       { label: 'Started',       color: 'default' },
  FOLLOWED_UP:   { label: 'Followed up',   color: 'info' },
  RESCHEDULED:   { label: 'Rescheduled',   color: 'warning' },
  READY_FOR_GRN: { label: 'Ready for GRN', color: 'success' },
  DONE:          { label: 'Done',          color: 'success' },
};
const histHeadSx = { fontWeight: 700, fontSize: '0.66rem', textTransform: 'uppercase', color: 'text.secondary', bgcolor: '#f8fafc', py: 0.75, whiteSpace: 'nowrap' };

const fmtLogDate = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Record a follow-up cycle. Entering a Next Follow-up Date keeps the follow-up
 * active (RESCHEDULED) so it can be continued later; entering a Final Material
 * Date confirms delivery (READY_FOR_GRN). Prior communication history is shown.
 */
const FollowUpDoneDialog = ({ open, onClose, followUp }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [actualAt, setActualAt] = useState(todayStr());
  const [followUpType, setFollowUpType] = useState('CALL');
  const [remarks, setRemarks] = useState('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');
  const [finalMaterialDate, setFinalMaterialDate] = useState('');
  const [message, setMessage] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [dateError, setDateError] = useState(false);
  const [markDone, { isLoading }] = useMarkFollowUpDoneMutation();
  // Concluded follow-ups open read-only: history only, no update form.
  const readOnly = Boolean(followUp) && !ACTIVE.includes(followUp.followUpStatus);

  // History across EVERY follow-up cycle of this PO, newest first — falls back
  // to this record's own log until the per-PO query resolves.
  const { data: poFuRes, isFetching: historyLoading } = useGetFollowUpsByPoQuery(followUp?.poId, { skip: !open || !followUp?.poId });
  const history = (poFuRes?.data?.length ? poFuRes.data : (followUp ? [followUp] : []))
    .flatMap((f) => (f.communicationLog || []).map((c) => ({ ...c, followUpNumber: f.followUpNumber })))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const DATE_ERROR_MSG = 'Please provide either Next Follow-up Date or Final Material Date.';

  useEffect(() => {
    if (!open) return;
    setActualAt(todayStr());
    setFollowUpType(followUp?.followUpType || 'CALL');
    setRemarks(followUp?.remarks || '');
    // Hydrate from the saved follow-up so the previously entered date is shown.
    setNextFollowUpDate(followUp?.nextFollowUpDate ? followUp.nextFollowUpDate.slice(0, 10) : '');
    setFinalMaterialDate(followUp?.finalMaterialDate ? followUp.finalMaterialDate.slice(0, 10) : '');
    setMessage(''); // a fresh message per cycle — history is shown above
    setContactPerson(followUp?.contactPerson || '');
    setDateError(false);
  }, [open, followUp]);

  // Next vs Final are mutually exclusive: exactly one must be provided. Both
  // fields stay enabled — picking one automatically clears the other, so the
  // user can freely switch (e.g. replace a saved Next date with a Final date).
  const handleNextChange = (val) => {
    setNextFollowUpDate(val);
    if (val) { setFinalMaterialDate(''); setDateError(false); }
  };
  const handleFinalChange = (val) => {
    setFinalMaterialDate(val);
    if (val) { setNextFollowUpDate(''); setDateError(false); }
  };

  const handleSubmit = async () => {
    if (!actualAt) { enqueueSnackbar('Actual Date is required', { variant: 'warning' }); return; }
    // Exactly one of next / final is required.
    if (!nextFollowUpDate && !finalMaterialDate) {
      setDateError(true);
      enqueueSnackbar(DATE_ERROR_MSG, { variant: 'warning' });
      return;
    }
    try {
      await markDone({
        id: followUp._id, actualAt, followUpType,
        remarks: remarks.trim(),
        // Mutually exclusive: exactly one of next / final is submitted.
        nextFollowUpDate: nextFollowUpDate || null,
        finalMaterialDate: finalMaterialDate || null,
        message: message.trim(),
        contactPerson: contactPerson.trim(),
      }).unwrap();
      enqueueSnackbar(
        finalMaterialDate ? 'Final material date confirmed — ready for GRN' : 'Follow-up continued — next date saved',
        { variant: 'success' },
      );
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to mark done', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        {readOnly ? 'Follow-up History' : (followUp?.followUpStatus === 'RESCHEDULED' ? 'Follow-up Again' : 'Update Follow-up')}
        {followUp?.followUpNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{followUp.followUpNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2, p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9', display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" fontWeight={700}>{followUp?.poNumber}</Typography>
          <Typography variant="caption" color="text.secondary">{followUp?.vendorName}</Typography>
          {followUp?.followUpStatus && <FuStatusChip status={followUp.followUpStatus} />}
          {followUp?.expectedDeliveryDate && (
            <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 700 }}>Expected: {fmtDate(followUp.expectedDeliveryDate)}</Typography>
          )}
          {followUp?.pendingQty != null && (
            <Typography variant="caption" sx={{ fontWeight: 700 }}>Pending: {followUp.pendingQty}{followUp.pendingQtyUnit ? ` ${followUp.pendingQtyUnit}` : ''}</Typography>
          )}
          {!readOnly && <Chip size="small" label="Next date = continue · Final date = ready for GRN" sx={{ fontWeight: 600, ml: { sm: 'auto' } }} />}
        </Box>

        {/* Full follow-up history for this PO, every cycle. */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.66rem', display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <History size={13} /> Follow-up History ({history.length})
            {historyLoading && <CircularProgress size={11} sx={{ ml: 0.5 }} />}
          </Typography>
          {history.length === 0 ? (
            <Typography variant="body2" color="text.disabled" sx={{ mt: 0.75 }}>No follow-up recorded yet — this will be the first entry.</Typography>
          ) : (
            <Box sx={{ mt: 0.75, maxHeight: readOnly ? 420 : 220, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: '8px' }}>
              <Table size="small" stickyHeader sx={{ minWidth: 640 }}>
                <TableHead>
                  <TableRow>
                    {['Date', 'Type', 'Contact', 'Outcome', 'Message / Remarks', 'By'].map((h) => <TableCell key={h} sx={histHeadSx}>{h}</TableCell>)}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {history.map((c, i) => {
                    const meta = OUTCOME_META[c.outcome];
                    return (
                      <TableRow key={i} sx={{ verticalAlign: 'top' }}>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          <Typography variant="body2">{fmtLogDate(c.timestamp)}</Typography>
                          {c.followUpNumber && <Typography variant="caption" color="text.disabled">{c.followUpNumber}</Typography>}
                        </TableCell>
                        <TableCell><Chip size="small" label={c.type || 'CALL'} sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700 }} /></TableCell>
                        <TableCell><Typography variant="body2">{c.contactPerson || '—'}</Typography></TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {meta ? <Chip size="small" variant="outlined" color={meta.color} label={meta.label} sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700 }} /> : '—'}
                          {c.finalMaterialDate && <Typography variant="caption" display="block" sx={{ color: 'success.main', fontWeight: 700, mt: 0.25 }}>Final: {fmtDate(c.finalMaterialDate)}</Typography>}
                          {c.nextFollowUpDate && <Typography variant="caption" display="block" sx={{ color: 'warning.main', fontWeight: 700, mt: 0.25 }}>Next: {fmtDate(c.nextFollowUpDate)}</Typography>}
                        </TableCell>
                        <TableCell sx={{ maxWidth: 260 }}>
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.message || '—'}</Typography>
                          {c.remarks && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>Remarks: {c.remarks}</Typography>}
                        </TableCell>
                        <TableCell><Typography variant="body2" color="text.secondary" noWrap>{c.byName || '—'}</Typography></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          )}
        </Box>

        {readOnly && (
          <Alert severity="info" sx={{ mb: 0 }}>
            This follow-up is {String(followUp.followUpStatus).replace(/_/g, ' ').toLowerCase()} — no further updates can be recorded on it.
          </Alert>
        )}

        {/* Update form — only while the follow-up is active. */}
        {!readOnly && (<>
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
          {/* Next vs Final material date are mutually exclusive — exactly one is required. */}
          <Grid item xs={6}>
            <DateInputDDMMYYYY label="Next Date to Follow-up" fullWidth openOnClick
              value={nextFollowUpDate} onChange={handleNextChange} error={dateError}
              helperText="Use when vendor has not yet confirmed material delivery." />
          </Grid>
          <Grid item xs={6}>
            <DateInputDDMMYYYY label="Final Date of Material" fullWidth openOnClick
              value={finalMaterialDate} onChange={handleFinalChange} error={dateError}
              helperText="Use when vendor has confirmed the material delivery date." />
          </Grid>
          {dateError && (
            <Grid item xs={12}>
              <Typography variant="caption" color="error" sx={{ fontWeight: 600 }}>{DATE_ERROR_MSG}</Typography>
            </Grid>
          )}
          <Grid item xs={12}>
            <TextField label="Contact Person" fullWidth value={contactPerson}
              onChange={(e) => setContactPerson(e.target.value)} placeholder="Who did you speak to?" />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Communication Message" fullWidth multiline minRows={2} value={message}
              onChange={(e) => setMessage(e.target.value)} placeholder="What did the vendor say?" />
          </Grid>
          <Grid item xs={12}>
            <TextField label="Remarks" fullWidth value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Grid>
        </Grid>
        </>)}
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={isLoading}>{readOnly ? 'Close' : 'Cancel'}</Button>
        {!readOnly && <Button variant="contained" color="success"
          startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <CheckCircle2 size={16} />}
          onClick={handleSubmit} disabled={isLoading}>
          {finalMaterialDate ? 'Confirm & Ready for GRN' : 'Save Follow-up'}
        </Button>}
      </DialogActions>
    </Dialog>
  );
};

export default FollowUpDoneDialog;
