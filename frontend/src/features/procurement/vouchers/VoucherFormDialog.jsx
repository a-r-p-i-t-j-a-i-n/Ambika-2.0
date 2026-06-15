import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem,
  Box, Typography, Grid, CircularProgress, Alert, InputAdornment, IconButton, Tooltip,
} from '@mui/material';
import { Banknote, Upload, FileCheck2, X } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetVendorInvoicesQuery,
  useCreateVoucherMutation,
  useUpdateVoucherMutation,
} from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { PAYMENT_MODES, fmtINR } from './voucherMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

const emptyForm = {
  invoiceId: '', paymentDate: '', paymentMode: 'NEFT', paidAmount: '',
  bankName: '', referenceNumber: '', utrNumber: '', chequeNumber: '', remarks: '',
};

/**
 * Create / edit a Vendor Voucher (Step 1.11).
 * Source invoices are restricted to PAYMENT_PENDING.
 * If `presetInvoice` is passed (from invoice detail), the invoice dropdown is locked.
 */
const VoucherFormDialog = ({ open, onClose, voucher, presetInvoice }) => {
  const { enqueueSnackbar } = useSnackbar();
  const isEdit = Boolean(voucher?._id);

  const [form, setForm] = useState(emptyForm);
  const [proof, setProof] = useState(null); // { fileUrl, fileName }

  const { data: invRes } = useGetVendorInvoicesQuery(
    { invoiceStatus: 'PAYMENT_PENDING', limit: 200, sort: '-createdAt' },
    { skip: !open || Boolean(presetInvoice) },
  );
  const invoiceOptions = useMemo(() => {
    const list = invRes?.data || [];
    if (presetInvoice && !list.find((i) => i._id === presetInvoice._id)) return [presetInvoice, ...list];
    return presetInvoice ? [presetInvoice] : list;
  }, [invRes, presetInvoice]);

  const [createVoucher, { isLoading: creating }] = useCreateVoucherMutation();
  const [updateVoucher, { isLoading: updating }] = useUpdateVoucherMutation();
  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();
  const busy = creating || updating;

  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      setForm({
        invoiceId: voucher.invoiceId || '', paymentDate: voucher.paymentDate ? voucher.paymentDate.slice(0, 10) : '',
        paymentMode: voucher.paymentMode || 'NEFT', paidAmount: voucher.paidAmount ?? '',
        bankName: voucher.bankName || '', referenceNumber: voucher.referenceNumber || '',
        utrNumber: voucher.utrNumber || '', chequeNumber: voucher.chequeNumber || '', remarks: voucher.remarks || '',
      });
      setProof(voucher.paymentProof?.fileUrl ? voucher.paymentProof : null);
    } else {
      const inv = presetInvoice;
      setForm({ ...emptyForm, invoiceId: inv?._id || '', paidAmount: inv?.netPayableAmount ?? '' });
      setProof(null);
    }
  }, [open, isEdit, voucher, presetInvoice]);

  const selectedInvoice = useMemo(
    () => invoiceOptions.find((i) => i._id === form.invoiceId) || presetInvoice || null,
    [invoiceOptions, form.invoiceId, presetInvoice],
  );

  // when invoice changes (create mode), default paid amount to net payable
  const onInvoiceChange = (id) => {
    const inv = invoiceOptions.find((i) => i._id === id);
    setForm((f) => ({ ...f, invoiceId: id, paidAmount: inv?.netPayableAmount ?? f.paidAmount }));
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const res = await uploadDoc(file).unwrap();
      const d = res?.data || {};
      setProof({ fileUrl: d.url || d.fileUrl, fileName: d.fileName || file.name });
      enqueueSnackbar('Payment proof uploaded', { variant: 'success' });
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Upload failed', { variant: 'error' }); }
  };

  const netPayable = Number(selectedInvoice?.netPayableAmount || 0);
  const paid = Number(form.paidAmount || 0);
  const balance = netPayable - paid;

  const submit = async () => {
    if (!form.invoiceId) return enqueueSnackbar('Select an invoice', { variant: 'warning' });
    if (!paid || paid <= 0) return enqueueSnackbar('Enter a valid paid amount', { variant: 'warning' });
    const payload = {
      invoiceId: form.invoiceId,
      paymentDate: form.paymentDate || undefined,
      paymentMode: form.paymentMode,
      paidAmount: paid,
      bankName: form.bankName.trim() || undefined,
      referenceNumber: form.referenceNumber.trim() || undefined,
      utrNumber: form.utrNumber.trim() || undefined,
      chequeNumber: form.chequeNumber.trim() || undefined,
      remarks: form.remarks.trim() || undefined,
      paymentProof: proof || undefined,
    };
    try {
      if (isEdit) await updateVoucher({ id: voucher._id, ...payload }).unwrap();
      else await createVoucher(payload).unwrap();
      enqueueSnackbar(isEdit ? 'Voucher updated' : 'Voucher created', { variant: 'success' });
      onClose?.(true);
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to save voucher', { variant: 'error' }); }
  };

  const showCheque = form.paymentMode === 'CHEQUE';

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Banknote size={20} /> {isEdit ? 'Edit Voucher' : 'New Payment Voucher'}
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField select fullWidth size="small" label="Invoice (Payment Pending)" value={form.invoiceId}
              onChange={(e) => onInvoiceChange(e.target.value)} disabled={Boolean(presetInvoice) || isEdit}>
              {invoiceOptions.length === 0 && <MenuItem value="" disabled>No payment-pending invoices</MenuItem>}
              {invoiceOptions.map((i) => (
                <MenuItem key={i._id} value={i._id}>{i.invoiceNumber} · {i.vendorName} · {fmtINR(i.netPayableAmount)}</MenuItem>
              ))}
            </TextField>
          </Grid>

          {selectedInvoice && (
            <Grid item xs={12}>
              <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">Vendor <b>{selectedInvoice.vendorName}</b></Typography>
                <Typography variant="caption" color="text.secondary">GRN <b>{selectedInvoice.grnNumber || '—'}</b></Typography>
                <Typography variant="caption" color="text.secondary">Net Payable <b>{fmtINR(netPayable)}</b></Typography>
              </Box>
            </Grid>
          )}

          <Grid item xs={6}><DateInputDDMMYYYY fullWidth size="small" label="Payment Date" value={form.paymentDate} onChange={(val) => setForm((f) => ({ ...f, paymentDate: val }))} /></Grid>
          <Grid item xs={6}>
            <TextField select fullWidth size="small" label="Payment Mode" value={form.paymentMode} onChange={set('paymentMode')}>
              {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
            </TextField>
          </Grid>

          <Grid item xs={6}><TextField fullWidth size="small" type="number" label="Paid Amount" value={form.paidAmount} onChange={set('paidAmount')} InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} /></Grid>
          <Grid item xs={6}><TextField fullWidth size="small" label="Bank Name" value={form.bankName} onChange={set('bankName')} /></Grid>

          <Grid item xs={6}><TextField fullWidth size="small" label={form.paymentMode === 'UPI' ? 'UPI / Ref No' : 'Reference No'} value={form.referenceNumber} onChange={set('referenceNumber')} /></Grid>
          {showCheque
            ? <Grid item xs={6}><TextField fullWidth size="small" label="Cheque No" value={form.chequeNumber} onChange={set('chequeNumber')} /></Grid>
            : <Grid item xs={6}><TextField fullWidth size="small" label="UTR No" value={form.utrNumber} onChange={set('utrNumber')} /></Grid>}

          <Grid item xs={12}><TextField fullWidth size="small" multiline minRows={2} label="Remarks" value={form.remarks} onChange={set('remarks')} /></Grid>

          <Grid item xs={12}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button component="label" variant="outlined" size="small" startIcon={uploading ? <CircularProgress size={14} /> : <Upload size={15} />} disabled={uploading}>
                Payment Proof
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
            <Alert severity={balance <= 0 ? 'success' : 'warning'} icon={false} sx={{ borderRadius: '10px' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                <span>Paid: <b>{fmtINR(paid)}</b></span>
                <span>Balance after payment: <b>{fmtINR(balance > 0 ? balance : 0)}</b></span>
                <span>{balance <= 0 ? 'Fully Paid' : 'Partially Paid'}</span>
              </Box>
            </Alert>
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy} startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <Banknote size={16} />}>
          {isEdit ? 'Save' : 'Create Voucher'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default VoucherFormDialog;
