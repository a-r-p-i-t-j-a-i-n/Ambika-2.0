import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem,
  Box, Typography, Grid, CircularProgress, FormControlLabel, Checkbox, Divider, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { FileSpreadsheet } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetVouchersQuery,
  useCreateTallyEntryMutation,
  useUpdateTallyEntryMutation,
  useCompleteTallyEntryMutation,
} from '../../../store/api/procurementApi';
import { CHECKLIST_ITEMS } from './tallyMeta';
import { fmtINR, fmtDate } from '../vouchers/voucherMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

const emptyChecklist = CHECKLIST_ITEMS.reduce((a, i) => ({ ...a, [i.key]: false }), {});
const emptyForm = { voucherId: '', statusDone: 'NO', remarks: '' };

// Vouchers eligible for a Tally Entry: posted and not already tally-completed.
const ELIGIBLE = ['POSTED', 'PARTIALLY_PAID', 'FULLY_PAID', 'SHORT_CLOSED'];

/**
 * Create / edit a Purchase Tally Entry (Step 1.12).
 * Source vouchers are restricted to posted vouchers without a completed entry.
 */
const TallyEntryFormDialog = ({ open, onClose, entry, presetVoucher }) => {
  const { enqueueSnackbar } = useSnackbar();
  const isEdit = Boolean(entry?._id);

  const [form, setForm] = useState(emptyForm);
  const [checklist, setChecklist] = useState(emptyChecklist);

  const { data: vouRes } = useGetVouchersQuery(
    { limit: 300, sort: '-createdAt' },
    { skip: !open || Boolean(presetVoucher) || isEdit },
  );
  const voucherOptions = useMemo(() => {
    const list = (vouRes?.data || []).filter(
      (v) => ELIGIBLE.includes(v.voucherStatus) && v.tallyEntryStatus !== 'COMPLETED',
    );
    if (presetVoucher) return [presetVoucher];
    return list;
  }, [vouRes, presetVoucher]);

  const [createEntry, { isLoading: creating }] = useCreateTallyEntryMutation();
  const [updateEntry, { isLoading: updating }] = useUpdateTallyEntryMutation();
  const [completeEntry, { isLoading: completing }] = useCompleteTallyEntryMutation();
  const busy = creating || updating || completing;

  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      setForm({ voucherId: entry.voucherId || '', statusDone: entry.statusDone || 'NO', remarks: entry.remarks || '' });
      setChecklist({ ...emptyChecklist, ...(entry.checklist || {}) });
    } else {
      setForm({ ...emptyForm, voucherId: presetVoucher?._id || '' });
      setChecklist(emptyChecklist);
    }
  }, [open, isEdit, entry, presetVoucher]);

  const selectedVoucher = useMemo(
    () => voucherOptions.find((v) => v._id === form.voucherId) || presetVoucher || null,
    [voucherOptions, form.voucherId, presetVoucher],
  );

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (k) => (e) => setChecklist((c) => ({ ...c, [k]: e.target.checked }));

  const markingDone = form.statusDone === 'YES';

  const submit = async () => {
    if (!form.voucherId) return enqueueSnackbar('Select a voucher', { variant: 'warning' });
    if (!markingDone && !form.remarks.trim()) return enqueueSnackbar('Remarks are required when status is "No"', { variant: 'warning' });
    // Completing requires the full checklist (mirror the backend rule for a clear message).
    if (markingDone && !CHECKLIST_ITEMS.every((i) => checklist[i.key])) {
      return enqueueSnackbar('Verify all checklist items to mark the Tally entry as done', { variant: 'warning' });
    }
    // Planned Date, Tally Voucher No. and Tally Ledger Name are server-derived
    // from the source voucher (see tallyEntry.service.js) — not sent from here.
    const payload = {
      statusDone: form.statusDone,
      checklist,
      remarks: form.remarks.trim() || undefined,
    };
    try {
      // "Yes" must COMPLETE the entry — that's what marks the voucher tally-complete
      // and makes it eligible for Final Payment (Step 1.13). Otherwise it stays a draft.
      if (isEdit) {
        if (markingDone) await completeEntry({ id: entry._id, ...payload }).unwrap();
        else await updateEntry({ id: entry._id, ...payload }).unwrap();
      } else {
        const res = await createEntry({ voucherId: form.voucherId, ...payload }).unwrap();
        const newId = res?.data?._id;
        if (markingDone && newId) await completeEntry({ id: newId, ...payload }).unwrap();
      }
      enqueueSnackbar(markingDone ? 'Tally entry completed — voucher ready for Final Payment' : (isEdit ? 'Tally entry updated' : 'Tally entry saved (pending)'), { variant: 'success' });
      onClose?.(true);
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to save tally entry', { variant: 'error' }); }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
        <FileSpreadsheet size={20} /> {isEdit ? 'Edit Tally Entry' : 'New Tally Entry'}
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField select fullWidth size="small" label="Voucher (posted)" value={form.voucherId}
              onChange={set('voucherId')} disabled={Boolean(presetVoucher) || isEdit}>
              {voucherOptions.length === 0 && <MenuItem value="" disabled>No eligible vouchers</MenuItem>}
              {voucherOptions.map((v) => (
                <MenuItem key={v._id} value={v._id}>{v.voucherNumber} · {v.vendorName} · {fmtINR(v.netPayableAmount)}</MenuItem>
              ))}
            </TextField>
          </Grid>

          {selectedVoucher && (
            <Grid item xs={12}>
              <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">Vendor <b>{selectedVoucher.vendorName}</b></Typography>
                <Typography variant="caption" color="text.secondary">Invoice <b>{selectedVoucher.invoiceNumber || '—'}</b></Typography>
                <Typography variant="caption" color="text.secondary">Net Payable <b>{fmtINR(selectedVoucher.netPayableAmount)}</b></Typography>
              </Box>
            </Grid>
          )}

          <Grid item xs={6}>
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 0.5 }}>ENTRY DONE IN TALLY?</Typography>
              <ToggleButtonGroup size="small" exclusive value={form.statusDone} onChange={(_e, val) => val && setForm((f) => ({ ...f, statusDone: val }))}>
                <ToggleButton value="YES" color="success">Yes</ToggleButton>
                <ToggleButton value="NO" color="warning">No</ToggleButton>
              </ToggleButtonGroup>
            </Box>
          </Grid>
          {/* Planned Date / Tally Voucher No. / Tally Ledger Name are all derived
              server-side from the source voucher — read-only here, never typed. */}
          <Grid item xs={6}>
            <TextField fullWidth size="small" label="Planned Date" disabled
              value={isEdit ? fmtDate(entry?.plannedAt) : fmtDate(selectedVoucher?.postedAt || selectedVoucher?.voucherDate) || '—'} />
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth size="small" label="Tally Voucher No" disabled
              value={isEdit ? (entry?.tallyVoucherNumber || '—') : (selectedVoucher?.voucherNumber || '—')} />
          </Grid>
          <Grid item xs={6}>
            <TextField fullWidth size="small" label="Tally Ledger Name" disabled
              value={isEdit ? (entry?.tallyLedgerName || '—') : (selectedVoucher?.vendorName || '—')} />
          </Grid>

          <Grid item xs={12}><Divider sx={{ mt: 0.5 }}><Typography variant="caption" fontWeight={700} color="text.secondary">INVOICE CHECKLIST</Typography></Divider></Grid>
          {CHECKLIST_ITEMS.map((i) => (
            <Grid item xs={12} sm={6} key={i.key}>
              <FormControlLabel control={<Checkbox size="small" checked={!!checklist[i.key]} onChange={toggle(i.key)} />}
                label={<Typography variant="body2">{i.label}</Typography>} />
            </Grid>
          ))}

          <Grid item xs={12}><TextField fullWidth size="small" multiline minRows={2} label={form.statusDone === 'NO' ? 'Remarks (required for No)' : 'Remarks'} value={form.remarks} onChange={set('remarks')} /></Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={busy}>Cancel</Button>
        <Button variant="contained" color={markingDone ? 'success' : 'primary'} onClick={submit} disabled={busy} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <FileSpreadsheet size={16} />}>
          {markingDone ? (isEdit ? 'Complete Entry' : 'Create & Complete') : (isEdit ? 'Save' : 'Create Entry')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TallyEntryFormDialog;
