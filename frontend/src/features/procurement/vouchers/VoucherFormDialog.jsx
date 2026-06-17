import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem,
  Box, Typography, Grid, CircularProgress, Alert,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Banknote, Info } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetVendorInvoicesQuery,
  useCreateVoucherMutation,
  useUpdateVoucherMutation,
} from '../../../store/api/procurementApi';
import { fmtINR } from './voucherMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

const emptyForm = { invoiceId: '', voucherDate: '', remarks: '' };

/**
 * Create / edit a Vendor Voucher (Step 1.11 — voucher passing / approval ONLY).
 * No payment is recorded here: balance stays = net payable. The actual vendor
 * payment is recorded in Step 1.13 (Final Payment). Source invoices must be
 * PAYMENT_PENDING.
 */
const VoucherFormDialog = ({ open, onClose, voucher, presetInvoice }) => {
  const { enqueueSnackbar } = useSnackbar();
  const isEdit = Boolean(voucher?._id);

  const [form, setForm] = useState(emptyForm);

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
  const busy = creating || updating;

  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      setForm({
        invoiceId: voucher.invoiceId || '',
        voucherDate: voucher.voucherDate ? voucher.voucherDate.slice(0, 10) : '',
        remarks: voucher.remarks || '',
      });
    } else {
      setForm({ ...emptyForm, invoiceId: presetInvoice?._id || '' });
    }
  }, [open, isEdit, voucher, presetInvoice]);

  const selectedInvoice = useMemo(
    () => invoiceOptions.find((i) => i._id === form.invoiceId) || presetInvoice || null,
    [invoiceOptions, form.invoiceId, presetInvoice],
  );

  // Financial snapshot — read from the invoice (or the voucher itself when editing).
  const src = isEdit ? voucher : selectedInvoice;
  const invoiceAmount = Number(src?.invoiceAmount || 0);
  const advancePaid = Number(src?.advancePaid || 0);
  const debitNoteAmount = Number(src?.debitNoteAmount || 0);
  const netPayable = Number(src?.netPayableAmount || 0);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.invoiceId) return enqueueSnackbar('Select an invoice', { variant: 'warning' });
    const payload = {
      invoiceId: form.invoiceId,
      voucherDate: form.voucherDate || undefined,
      remarks: form.remarks.trim() || undefined,
    };
    try {
      if (isEdit) await updateVoucher({ id: voucher._id, ...payload }).unwrap();
      else await createVoucher(payload).unwrap();
      enqueueSnackbar(isEdit ? 'Voucher updated' : 'Voucher created', { variant: 'success' });
      onClose?.(true);
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to save voucher', { variant: 'error' }); }
  };

  const Amt = ({ label, value, strong }) => (
    <Box sx={{ textAlign: 'right' }}>
      <Typography variant="caption" color="text.secondary" fontWeight={700}>{label}</Typography>
      <Typography fontWeight={strong ? 800 : 700} color={strong ? 'primary.dark' : 'text.primary'}>{fmtINR(value)}</Typography>
    </Box>
  );

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Banknote size={20} /> {isEdit ? 'Edit Voucher' : 'New Payment Voucher'}
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField select fullWidth size="small" label="Invoice (Payment Pending)" value={form.invoiceId}
              onChange={set('invoiceId')} disabled={Boolean(presetInvoice) || isEdit}>
              {invoiceOptions.length === 0 && <MenuItem value="" disabled>No payment-pending invoices</MenuItem>}
              {invoiceOptions.map((i) => (
                <MenuItem key={i._id} value={i._id}>{i.invoiceNumber} · {i.vendorName} · {fmtINR(i.netPayableAmount)}</MenuItem>
              ))}
            </TextField>
          </Grid>

          {src && (
            <Grid item xs={12}>
              <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">Vendor <b>{src.vendorName}</b></Typography>
                <Typography variant="caption" color="text.secondary">GRN <b>{src.grnNumber || '—'}</b></Typography>
                <Typography variant="caption" color="text.secondary">PO <b>{src.poNumber || '—'}</b></Typography>
              </Box>
            </Grid>
          )}

          {/* Financials (verification only — no payment captured here) */}
          {src && (
            <Grid item xs={12}>
              <Box sx={{ p: 2, borderRadius: '12px', border: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end', gap: 3.5, flexWrap: 'wrap' }}>
                <Amt label="INVOICE" value={invoiceAmount} />
                <Amt label="− ADVANCE" value={advancePaid} />
                <Amt label="− DEBIT NOTE" value={debitNoteAmount} />
                <Amt label="NET PAYABLE" value={netPayable} strong />
                <Amt label="BALANCE" value={netPayable} strong />
              </Box>
            </Grid>
          )}

          <Grid item xs={6}>
            <DateInputDDMMYYYY fullWidth size="small" label="Voucher Date" value={form.voucherDate}
              onChange={(val) => setForm((f) => ({ ...f, voucherDate: val }))} />
          </Grid>
          <Grid item xs={6} />

          <Grid item xs={12}>
            <TextField fullWidth size="small" multiline minRows={2} label="Remarks" value={form.remarks} onChange={set('remarks')} />
          </Grid>

          <Grid item xs={12}>
            <Alert severity="info" icon={<Info size={18} />} sx={{ borderRadius: '10px', bgcolor: alpha('#1d4ed8', 0.06) }}>
              No payment is recorded here. This step only passes / approves the voucher.
              The actual payment is recorded in <b>Step 1.13 — Final Payment</b>, after the Tally Entry.
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
