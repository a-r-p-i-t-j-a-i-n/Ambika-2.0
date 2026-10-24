import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, MenuItem, Box, Typography, CircularProgress, Chip, Alert,
  Table, TableHead, TableBody, TableRow, TableCell, Autocomplete,
} from '@mui/material';
import { CheckCircle2, History } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useMarkFollowUpDoneMutation, useCreateFollowUpMutation, useGetFollowUpsByPoQuery, useGetPurchaseOrdersQuery,
} from '../../../store/api/procurementApi';
import { FOLLOWUP_TYPES, FuStatusChip, fmtDate } from './fuMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

// Today as an IST calendar day — the day the backend's date rules use
// (followUp.dates.js). A UTC day would still be yesterday before 05:30 IST.
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const ACTIVE = ['PENDING', 'RESCHEDULED'];
// The outcome decides what saving does (followUp.service markDone): NEXT keeps
// the follow-up active and re-plans it to the next date; FINAL records the
// vendor-confirmed delivery date and moves the PO to READY_FOR_GRN.
const OUTCOMES = {
  NEXT:  { label: 'Next Date to Follow Up', dateLabel: 'Next Date to Follow-up *', helper: 'Use when vendor has not yet confirmed material delivery.' },
  FINAL: { label: 'Final Date of Material', dateLabel: 'Final Date of Material *', helper: 'Use when vendor has confirmed the material delivery date.' },
};
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
 * Record a follow-up cycle. The outcome dropdown decides what happens:
 * "Next Date to Follow Up" keeps the follow-up active (RESCHEDULED) and plans
 * it for that date; "Final Date of Material" confirms delivery (READY_FOR_GRN).
 * Prior communication history is shown.
 *
 * Without a `followUp` ("Add Follow-up") the user picks a released PO first;
 * saving continues that PO's open follow-up, or starts one when it has none.
 */
const FollowUpDoneDialog = ({ open, onClose, followUp }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [pickedPo, setPickedPo] = useState(null);
  const [actualAt, setActualAt] = useState(todayStr());
  const [followUpType, setFollowUpType] = useState('CALL');
  const [remarks, setRemarks] = useState('');
  const [outcome, setOutcome] = useState('');
  const [outcomeDate, setOutcomeDate] = useState('');
  const [message, setMessage] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [outcomeError, setOutcomeError] = useState(false);
  const [markDone, { isLoading: marking }] = useMarkFollowUpDoneMutation();
  const [createFu, { isLoading: creating }] = useCreateFollowUpMutation();
  const isLoading = marking || creating;
  // Concluded follow-ups open read-only: history only, no update form.
  const readOnly = Boolean(followUp) && !ACTIVE.includes(followUp.followUpStatus);

  // Same PO list as the create form (FollowUpFormDrawer): released POs only.
  const { data: posRes, isLoading: posLoading } = useGetPurchaseOrdersQuery(
    { limit: 200, sort: '-releasedAt', poStatus: 'RELEASED_TO_VENDOR' },
    { skip: !open || Boolean(followUp) },
  );
  const poId = followUp?.poId || pickedPo?._id;

  // History across EVERY follow-up cycle of this PO, newest first — falls back
  // to this record's own log until the per-PO query resolves.
  const { currentData: poFuRes, isFetching: historyLoading } = useGetFollowUpsByPoQuery(poId, { skip: !open || !poId });
  const poFollowUps = poFuRes?.data || [];
  // The record this save updates: the one passed in, else the picked PO's open cycle.
  const target = followUp || poFollowUps.find((f) => ACTIVE.includes(f.followUpStatus)) || null;
  const history = (poFollowUps.length ? poFollowUps : (followUp ? [followUp] : []))
    .flatMap((f) => (f.communicationLog || []).map((c) => ({ ...c, followUpNumber: f.followUpNumber })))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const summary = followUp || (pickedPo && {
    poNumber: pickedPo.poNumber, vendorName: pickedPo.vendorName,
    followUpStatus: target?.followUpStatus, expectedDeliveryDate: pickedPo.expectedDeliveryDate,
  });

  useEffect(() => {
    if (!open) return;
    setPickedPo(null);
    setActualAt(todayStr());
    setFollowUpType(followUp?.followUpType || 'CALL');
    setRemarks(followUp?.remarks || '');
    // Every cycle picks its outcome afresh — a saved next date is never reused as a final one.
    setOutcome('');
    setOutcomeDate('');
    setMessage(''); // a fresh message per cycle — history is shown above
    setContactPerson(followUp?.contactPerson || '');
    setOutcomeError(false);
  }, [open, followUp]);

  const handleOutcomeChange = (val) => {
    setOutcome(val);
    setOutcomeDate(''); // the two dates mean different things — never carry one over
    setOutcomeError(false);
  };
  const handleOutcomeDateChange = (val) => {
    setOutcomeDate(val);
    if (val) setOutcomeError(false);
  };

  // Same rules as the backend: Actual Date may be backdated but not later than
  // today; a Next Date to Follow-up is on or after the Actual Date.
  const actualInFuture = Boolean(actualAt) && actualAt > todayStr();
  const nextBeforeActual = outcome === 'NEXT' && Boolean(outcomeDate) && Boolean(actualAt) && outcomeDate < actualAt;

  const handleSubmit = async () => {
    if (!poId) { enqueueSnackbar('Select a released PO first', { variant: 'warning' }); return; }
    if (!actualAt) { enqueueSnackbar('Actual Date is required', { variant: 'warning' }); return; }
    if (actualInFuture) { enqueueSnackbar('Actual Date cannot be later than today', { variant: 'warning' }); return; }
    if (!outcome || !outcomeDate) {
      setOutcomeError(true);
      enqueueSnackbar(outcome ? `${OUTCOMES[outcome].label} is required` : 'Choose the follow-up outcome', { variant: 'warning' });
      return;
    }
    if (nextBeforeActual) { enqueueSnackbar('Next Date to Follow-up cannot be before the Actual Date', { variant: 'warning' }); return; }
    try {
      // A PO without an open follow-up gets one first, under the same create
      // rules as everywhere else (the backend refuses a second active one).
      const id = target?._id || (await createFu({ poId, followUpType, contactPerson: contactPerson.trim() }).unwrap())?.data?._id;
      await markDone({
        id, actualAt, followUpType,
        remarks: remarks.trim(),
        // Only the chosen outcome's date is submitted.
        ...(outcome === 'FINAL' ? { finalMaterialDate: outcomeDate } : { nextFollowUpDate: outcomeDate }),
        message: message.trim(),
        contactPerson: contactPerson.trim(),
      }).unwrap();
      enqueueSnackbar(
        outcome === 'FINAL' ? 'Final material date confirmed — ready for GRN' : 'Follow-up continued — next date saved',
        { variant: 'success' },
      );
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save follow-up', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        {readOnly ? 'Follow-up History' : 'Update Follow-up'}
        {target?.followUpNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{target.followUpNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        {!followUp && (
          <Autocomplete
            sx={{ mb: 2 }}
            options={posRes?.data || []}
            loading={posLoading}
            value={pickedPo}
            getOptionLabel={(o) => (o ? `${o.poNumber} — ${o.vendorName}` : '')}
            isOptionEqualToValue={(o, v) => o._id === v._id}
            onChange={(_e, v) => setPickedPo(v)}
            renderInput={(params) => (
              <TextField {...params} label="Purchase Order *" placeholder="Released POs only"
                InputProps={{ ...params.InputProps, endAdornment: (<>{posLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
            )}
          />
        )}
        {summary && (
        <Box sx={{ mb: 2, p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9', display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" fontWeight={700}>{summary.poNumber}</Typography>
          <Typography variant="caption" color="text.secondary">{summary.vendorName}</Typography>
          {summary.followUpStatus && <FuStatusChip status={summary.followUpStatus} />}
          {summary.expectedDeliveryDate && (
            <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 700 }}>Expected: {fmtDate(summary.expectedDeliveryDate)}</Typography>
          )}
          {followUp?.pendingQty != null && (
            <Typography variant="caption" sx={{ fontWeight: 700 }}>Pending: {followUp.pendingQty}{followUp.pendingQtyUnit ? ` ${followUp.pendingQtyUnit}` : ''}</Typography>
          )}
          {!readOnly && <Chip size="small" label="Next date = continue · Final date = ready for GRN" sx={{ fontWeight: 600, ml: { sm: 'auto' } }} />}
        </Box>
        )}

        {/* Full follow-up history for this PO, every cycle. */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.66rem', display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <History size={13} /> Follow-up History ({history.length})
            {historyLoading && <CircularProgress size={11} sx={{ ml: 0.5 }} />}
          </Typography>
          {history.length === 0 ? (
            <Typography variant="body2" color="text.disabled" sx={{ mt: 0.75 }}>
              {poId ? 'No follow-up recorded yet — this will be the first entry.' : 'Select a Purchase Order to see its follow-up history.'}
            </Typography>
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
              error={!actualAt || actualInFuture}
              helperText={!actualAt ? 'Required' : (actualInFuture ? 'Cannot be later than today' : '')} />
          </Grid>
          <Grid item xs={6}>
            <TextField label="Follow-up Type" select fullWidth value={followUpType}
              onChange={(e) => setFollowUpType(e.target.value)}>
              {FOLLOWUP_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
          </Grid>
          {/* The outcome picks which date is asked for — the two are never interchangeable. */}
          <Grid item xs={6}>
            <TextField label="Follow-up Outcome *" select fullWidth value={outcome}
              onChange={(e) => handleOutcomeChange(e.target.value)}
              error={outcomeError && !outcome} helperText={outcomeError && !outcome ? 'Choose an outcome' : ''}>
              {Object.entries(OUTCOMES).map(([k, o]) => <MenuItem key={k} value={k}>{o.label}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={6}>
            <DateInputDDMMYYYY key={outcome || 'none'} fullWidth openOnClick
              label={outcome ? OUTCOMES[outcome].dateLabel : 'Outcome Date'}
              disabled={!outcome}
              value={outcomeDate} onChange={handleOutcomeDateChange}
              error={(outcomeError && Boolean(outcome) && !outcomeDate) || nextBeforeActual}
              helperText={nextBeforeActual ? 'Cannot be before the Actual Date' : (outcome ? OUTCOMES[outcome].helper : 'Choose the outcome first.')} />
          </Grid>
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
          // Without a passed-in follow-up, wait for the PO's records so an open cycle is continued, not duplicated.
          onClick={handleSubmit} disabled={isLoading || (!followUp && historyLoading)}>
          {outcome === 'FINAL' ? 'Confirm & Ready for GRN' : 'Save Follow-up'}
        </Button>}
      </DialogActions>
    </Dialog>
  );
};

export default FollowUpDoneDialog;
