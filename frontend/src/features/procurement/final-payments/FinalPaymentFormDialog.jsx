import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem,
  Box, Typography, Grid, CircularProgress, Alert, InputAdornment, IconButton, Tooltip,
} from '@mui/material';
import { Wallet, Upload, FileCheck2, X } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetVouchersQuery,
  useCreateFinalPaymentMutation,
} from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { PAYMENT_MODES, fmtINR } from './paymentMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { PFMS } from '../pfmsTheme';

const STATUS_OPTIONS = [
  { value: 'PART_PAYMENT', label: 'Part Payment' },
  { value: 'FULL_PAYMENT', label: 'Full Payment' },
  { value: 'SHORT_PAYMENT_COMPLETED', label: 'Short Payment & Completed' },
];

const emptyForm = {
  voucherId: '', paymentStatus: 'FULL_PAYMENT', paymentDate: '', paidAmount: '',
  paymentMode: 'NEFT', paymentReferenceNumber: '', remarks: '',
};

/**
 * Record a Vendor Final Payment (Step 1.13). Source vouchers must have a
 * completed Tally Entry and a remaining balance. Full payment auto-fills the
 * balance; short payment requires remarks.
 */
const FinalPaymentFormDialog = ({ open, onClose, presetVoucher }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [form, setForm] = useState(emptyForm);
  const [proof, setProof] = useState(null);

  // Eligibility is enforced server-side: Tally completed + remaining balance,
  // excluding cancelled vouchers. (See voucher.service getAll.)
  const { data: vouRes } = useGetVouchersQuery(
    { limit: 300, sort: '-createdAt', tallyEntryStatus: 'COMPLETED', minBalance: 1, excludeStatus: 'CANCELLED' },
    { skip: !open || Boolean(presetVoucher) },
  );
  const voucherOptions = useMemo(() => {
    if (presetVoucher) return [presetVoucher];
    return vouRes?.data || [];
  }, [vouRes, presetVoucher]);

  // Diagnostics: surface WHY the dropdown may be empty (counts via meta.total).
  const { data: tallyRes } = useGetVouchersQuery(
    { limit: 1, tallyEntryStatus: 'COMPLETED' },
    { skip: !open || Boolean(presetVoucher) },
  );
  const { data: balRes } = useGetVouchersQuery(
    { limit: 1, minBalance: 1, excludeStatus: 'CANCELLED' },
    { skip: !open || Boolean(presetVoucher) },
  );
  const eligibleCount = vouRes?.meta?.total ?? voucherOptions.length;
  const tallyCompletedCount = tallyRes?.meta?.total ?? 0;
  const balanceCount = balRes?.meta?.total ?? 0;

  const [createPayment, { isLoading: creating }] = useCreateFinalPaymentMutation();
  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();

  const selectedVoucher = useMemo(
    () => voucherOptions.find((v) => v._id === form.voucherId) || presetVoucher || null,
    [voucherOptions, form.voucherId, presetVoucher],
  );
  const balance = Number(selectedVoucher?.balanceAmount || 0);

  useEffect(() => {
    if (!open) return;
    const v = presetVoucher;
    setForm({ ...emptyForm, voucherId: v?._id || '', paidAmount: v ? Number(v.balanceAmount || 0) : '' });
    setProof(null);
  }, [open, presetVoucher]);

  const onVoucherChange = (id) => {
    const v = voucherOptions.find((x) => x._id === id);
    setForm((f) => ({ ...f, voucherId: id, paidAmount: v ? Number(v.balanceAmount || 0) : f.paidAmount }));
  };

  const onStatusChange = (status) => {
    // Full payment auto-fills the remaining balance.
    setForm((f) => ({ ...f, paymentStatus: status, paidAmount: status === 'FULL_PAYMENT' && selectedVoucher ? balance : f.paidAmount }));
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try {
      const res = await uploadDoc(file).unwrap();
      const d = res?.data || {};
      setProof({ fileUrl: d.url || d.fileUrl, fileName: d.fileName || file.name, fileType: d.mimeType || file.type });
      enqueueSnackbar('Proof uploaded', { variant: 'success' });
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Upload failed', { variant: 'error' }); }
  };

  const paid = Number(form.paidAmount || 0);
  const balanceAfter = balance - paid;
  const isShort = form.paymentStatus === 'SHORT_PAYMENT_COMPLETED';

  const submit = async () => {
    if (!form.voucherId) return enqueueSnackbar('Select a voucher', { variant: 'warning' });
    if (!(paid > 0)) return enqueueSnackbar('Enter a valid paid amount', { variant: 'warning' });
    if (paid > balance + 0.01) return enqueueSnackbar('Paid amount exceeds the voucher balance', { variant: 'warning' });
    if (form.paymentStatus === 'FULL_PAYMENT' && balanceAfter > 0.01) return enqueueSnackbar('Full payment must clear the balance', { variant: 'warning' });
    if (form.paymentStatus === 'PART_PAYMENT' && balanceAfter <= 0.01) return enqueueSnackbar('Part payment must leave a balance — use Full Payment', { variant: 'warning' });
    if (isShort && !form.remarks.trim()) return enqueueSnackbar('Remarks are required for Short Payment & Completed', { variant: 'warning' });

    const payload = {
      voucherId: form.voucherId,
      paymentStatus: form.paymentStatus,
      paymentDate: form.paymentDate || undefined,
      paidAmount: paid,
      paymentMode: form.paymentMode,
      paymentReferenceNumber: form.paymentReferenceNumber.trim() || undefined,
      remarks: form.remarks.trim() || undefined,
      proofDocument: proof || undefined,
    };
    try {
      await createPayment(payload).unwrap();
      enqueueSnackbar('Payment recorded', { variant: 'success' });
      onClose?.(true);
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to record payment', { variant: 'error' }); }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '8px' } }}>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Wallet size={20} /> Make Payment
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField select fullWidth size="small" label="Voucher (Tally completed)" value={form.voucherId}
              onChange={(e) => onVoucherChange(e.target.value)} disabled={Boolean(presetVoucher)}>
              {voucherOptions.length === 0 && <MenuItem value="" disabled>No voucher ready for payment</MenuItem>}
              {voucherOptions.map((v) => (
                <MenuItem key={v._id} value={v._id}>{v.voucherNumber} · {v.vendorName} · bal {fmtINR(v.balanceAmount)}</MenuItem>
              ))}
            </TextField>
          </Grid>

          {!presetVoucher && voucherOptions.length === 0 && (
            <Grid item xs={12}>
              <Alert severity="info" icon={false} sx={{ borderRadius: '10px' }}>
                <Typography variant="body2" fontWeight={700}>No voucher ready for payment.</Typography>
                <Typography variant="caption" color="text.secondary">
                  A voucher must have <b>Tally Completed</b> and <b>Balance Amount &gt; 0</b>. A voucher already fully paid at the Voucher stage has a zero balance and won't appear here.
                </Typography>
                <Box sx={{ mt: 1, display: 'flex', gap: 2.5, flexWrap: 'wrap' }}>
                  <Typography variant="caption" color="text.secondary">Tally completed: <b>{tallyCompletedCount}</b></Typography>
                  <Typography variant="caption" color="text.secondary">With balance &gt; 0: <b>{balanceCount}</b></Typography>
                  <Typography variant="caption" color="text.secondary">Ready (both): <b>{eligibleCount}</b></Typography>
                </Box>
              </Alert>
            </Grid>
          )}

          {selectedVoucher && (
            <Grid item xs={12}>
              <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: PFMS.surfaceAlt, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">Vendor <b>{selectedVoucher.vendorName}</b></Typography>
                <Typography variant="caption" color="text.secondary">Net Payable <b>{fmtINR(selectedVoucher.netPayableAmount)}</b></Typography>
                <Typography variant="caption" color="text.secondary">Balance <b>{fmtINR(balance)}</b></Typography>
              </Box>
            </Grid>
          )}

          <Grid item xs={12}>
            <TextField select fullWidth size="small" label="Payment Status" value={form.paymentStatus} onChange={(e) => onStatusChange(e.target.value)}>
              {STATUS_OPTIONS.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
            </TextField>
          </Grid>

          <Grid item xs={6}><DateInputDDMMYYYY fullWidth size="small" label="Amount Date" value={form.paymentDate} onChange={(val) => setForm((f) => ({ ...f, paymentDate: val }))} /></Grid>
          <Grid item xs={6}><TextField fullWidth size="small" type="number" label="Paid Amount" value={form.paidAmount} onChange={set('paidAmount')} disabled={form.paymentStatus === 'FULL_PAYMENT'} InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} /></Grid>

          <Grid item xs={6}>
            <TextField select fullWidth size="small" label="Payment Mode" value={form.paymentMode} onChange={set('paymentMode')}>
              {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{m.replace(/_/g, ' ')}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={6}><TextField fullWidth size="small" label="Reference No" value={form.paymentReferenceNumber} onChange={set('paymentReferenceNumber')} /></Grid>

          <Grid item xs={12}><TextField fullWidth size="small" multiline minRows={2} label={isShort ? 'Remarks (required)' : 'Remarks'} value={form.remarks} onChange={set('remarks')} /></Grid>

          <Grid item xs={12}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button component="label" variant="outlined" size="small" startIcon={uploading ? <CircularProgress size={14} /> : <Upload size={15} />} disabled={uploading}>
                Proof Upload
                <input hidden type="file" onChange={handleUpload} />
              </Button>
              {proof?.fileUrl && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'success.main' }}>
                  <FileCheck2 size={16} /><Typography variant="caption" fontWeight={600} noWrap sx={{ maxWidth: 160 }}>{proof.fileName || 'Uploaded'}</Typography>
                  <Tooltip title="Remove"><IconButton size="small" onClick={() => setProof(null)}><X size={13} /></IconButton></Tooltip>
                </Box>
              )}
            </Box>
          </Grid>

          <Grid item xs={12}>
            <Alert severity={balanceAfter <= 0.01 ? 'success' : 'warning'} icon={false} sx={{ borderRadius: '10px' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                <span>Paying: <b>{fmtINR(paid)}</b></span>
                <span>Balance after: <b>{fmtINR(balanceAfter > 0 ? balanceAfter : 0)}</b></span>
                <span>{isShort ? 'Short closed' : balanceAfter <= 0.01 ? 'Fully paid' : 'Partially paid'}</span>
              </Box>
            </Alert>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={creating}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={creating} startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <Wallet size={16} />}>Record Payment</Button>
      </DialogActions>
    </Dialog>
  );
};

export default FinalPaymentFormDialog;
