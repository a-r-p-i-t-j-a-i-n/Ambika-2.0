import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Typography, Grid, CircularProgress, Alert, FormControlLabel, Checkbox,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { CheckCircle2 } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useCompleteTallyEntryMutation } from '../../../store/api/procurementApi';
import { CHECKLIST_ITEMS } from './tallyMeta';

const buildChecklist = (entry) => CHECKLIST_ITEMS.reduce((a, i) => ({ ...a, [i.key]: !!entry?.checklist?.[i.key] }), {});

/**
 * Complete a Tally Entry (Step 1.12). Requires statusDone = YES and every
 * checklist item ticked. If statusDone = NO the entry stays PENDING (remarks
 * required). Completion marks the linked voucher tallyEntryStatus = COMPLETED.
 */
const TallyEntryCompleteDialog = ({ open, onClose, entry }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [statusDone, setStatusDone] = useState('YES');
  const [checklist, setChecklist] = useState({});
  const [remarks, setRemarks] = useState('');
  const [complete, { isLoading }] = useCompleteTallyEntryMutation();

  useEffect(() => {
    if (!open || !entry) return;
    setStatusDone(entry.statusDone === 'NO' ? 'YES' : (entry.statusDone || 'YES'));
    setChecklist(buildChecklist(entry));
    setRemarks(entry.remarks || '');
  }, [open, entry]);

  const allChecked = CHECKLIST_ITEMS.every((i) => checklist[i.key]);
  const canComplete = statusDone === 'YES' ? allChecked : remarks.trim().length > 0;
  const toggle = (k) => (e) => setChecklist((c) => ({ ...c, [k]: e.target.checked }));

  const submit = async () => {
    if (statusDone === 'YES' && !allChecked) return enqueueSnackbar('Tick every checklist item to complete', { variant: 'warning' });
    if (statusDone === 'NO' && !remarks.trim()) return enqueueSnackbar('Remarks are required when status is "No"', { variant: 'warning' });
    try {
      // Planned Date, Tally Voucher No. and Tally Ledger Name are server-derived
      // from the source voucher at entry creation — not editable here.
      await complete({
        id: entry._id, statusDone, checklist,
        remarks: remarks.trim() || undefined,
      }).unwrap();
      enqueueSnackbar(statusDone === 'YES' ? 'Tally entry completed' : 'Saved — kept pending (status No)', { variant: statusDone === 'YES' ? 'success' : 'info' });
      onClose?.(true);
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to complete', { variant: 'error' }); }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
        <CheckCircle2 size={20} /> Complete Tally Entry
        {entry?.entryNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{entry.entryNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2, p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9' }}>
          <Typography variant="body2" fontWeight={700}>{entry?.vendorName}</Typography>
          <Typography variant="caption" color="text.secondary">Voucher {entry?.voucherNumber || '—'} · Invoice {entry?.invoiceNumber || '—'}</Typography>
        </Box>

        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 0.5 }}>ENTRY DONE IN TALLY?</Typography>
          <ToggleButtonGroup size="small" exclusive value={statusDone} onChange={(_e, v) => v && setStatusDone(v)}>
            <ToggleButton value="YES" color="success">Yes</ToggleButton>
            <ToggleButton value="NO" color="warning">No</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        <Grid container spacing={1}>
          <Grid item xs={6}><TextField fullWidth size="small" label="Tally Voucher No" disabled value={entry?.tallyVoucherNumber || '—'} /></Grid>
          <Grid item xs={6}><TextField fullWidth size="small" label="Tally Ledger Name" disabled value={entry?.tallyLedgerName || '—'} /></Grid>
        </Grid>

        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mt: 2, mb: 0.5 }}>INVOICE CHECKLIST</Typography>
        <Grid container>
          {CHECKLIST_ITEMS.map((i) => (
            <Grid item xs={12} key={i.key}>
              <FormControlLabel control={<Checkbox size="small" checked={!!checklist[i.key]} onChange={toggle(i.key)} />}
                label={<Typography variant="body2">{i.label}</Typography>} />
            </Grid>
          ))}
        </Grid>

        <TextField sx={{ mt: 1 }} label={statusDone === 'NO' ? 'Remarks (required)' : 'Remarks'} fullWidth multiline minRows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />

        {statusDone === 'YES' && !allChecked && <Alert severity="warning" sx={{ mt: 2 }}>All six checklist items must be ticked to complete.</Alert>}
        {statusDone === 'NO' && <Alert severity="info" sx={{ mt: 2 }}>Status “No” keeps the entry pending — remarks required.</Alert>}
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={isLoading}>Cancel</Button>
        <Button variant="contained" color={statusDone === 'YES' ? 'success' : 'primary'} onClick={submit} disabled={isLoading || !canComplete}
          startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <CheckCircle2 size={16} />}>
          {statusDone === 'YES' ? 'Complete' : 'Save (Pending)'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TallyEntryCompleteDialog;
