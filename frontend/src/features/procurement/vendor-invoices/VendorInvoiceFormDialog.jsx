import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog, Box, Typography, TextField, Button, IconButton, Divider,
  Grid, Autocomplete, CircularProgress, Paper, Chip, FormControlLabel, Switch,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { X, Save, ReceiptText, Building2, FileText, Upload, ExternalLink } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetIncomingQcsQuery,
  useCreateVendorInvoiceMutation,
  useUpdateVendorInvoiceMutation,
  useGetProformaInvoiceByIdQuery,
} from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { fileHref } from '../indents/indentMeta';
import { fmtINR } from './invoiceMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

/**
 * Create / edit a Vendor Invoice (Step 1.10). Only QC PASSED/PARTIAL is
 * selectable. Net payable = invoiceAmount − debitNote − advancePaid (advance
 * pulled from the PI). Invoice document is required to approve.
 */
const todayStr = () => new Date().toISOString().slice(0, 10);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ACCEPT = '.pdf,image/*';
const SECTION = { p: 2.5, borderRadius: '16px', border: '1px solid', borderColor: 'divider' };

const VendorInvoiceFormDialog = ({ open, onClose, invoice = null, presetQc = null }) => {
  const { enqueueSnackbar } = useSnackbar();
  const fileRef = useRef(null);
  const dnFileRef = useRef(null);
  const isEdit = Boolean(invoice?._id);

  const [qc, setQc] = useState(null);
  const [form, setForm] = useState({
    invoiceNumber: '', invoiceDate: todayStr(), invoiceReceivedDate: todayStr(),
    invoiceAmount: '', taxableAmount: '', gstAmount: '', tdsAmount: '', otherCharges: '',
    debitNoteRequired: false, debitNoteNumber: '', debitNoteAmount: '', debitNoteReason: '', remarks: '',
  });
  const [doc, setDoc] = useState(null);
  const [dnDoc, setDnDoc] = useState(null);

  const [createInv, { isLoading: creating }] = useCreateVendorInvoiceMutation();
  const [updateInv, { isLoading: updating }] = useUpdateVendorInvoiceMutation();
  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();
  const saving = creating || updating;

  const { data: qcRes, isLoading: qcLoading } = useGetIncomingQcsQuery(
    { limit: 200, sort: '-createdAt' },
    { skip: !open || isEdit },
  );
  // Only PASSED / PARTIAL QC qualifies.
  const qcOptions = (qcRes?.data || []).filter((q) => ['PASSED', 'PARTIAL'].includes(q.qcStatus));

  // Advance paid for the selected QC's PI (for net-payable preview).
  const piId = qc?.piId || invoice?.piId;
  const { data: piRes } = useGetProformaInvoiceByIdQuery(piId, { skip: !piId });
  const advancePaid = round2(invoice?.advancePaid ?? piRes?.data?.paidAmount ?? 0);

  useEffect(() => {
    if (!open) return;
    if (invoice) {
      setQc({ _id: invoice.qcId, qcNumber: invoice.qcNumber, vendorName: invoice.vendorName });
      setForm({
        invoiceNumber: invoice.invoiceNumber || '', invoiceDate: invoice.invoiceDate ? invoice.invoiceDate.slice(0, 10) : todayStr(),
        invoiceReceivedDate: invoice.invoiceReceivedDate ? invoice.invoiceReceivedDate.slice(0, 10) : todayStr(),
        invoiceAmount: invoice.invoiceAmount ?? '', taxableAmount: invoice.taxableAmount ?? '', gstAmount: invoice.gstAmount ?? '',
        tdsAmount: invoice.tdsAmount ?? '', otherCharges: invoice.otherCharges ?? '',
        debitNoteRequired: !!invoice.debitNoteRequired, debitNoteNumber: invoice.debitNoteNumber || '',
        debitNoteAmount: invoice.debitNoteAmount ?? '', debitNoteReason: invoice.debitNoteReason || '', remarks: invoice.remarks || '',
      });
      setDoc(invoice.invoiceDocument?.fileUrl ? { ...invoice.invoiceDocument } : null);
      setDnDoc(invoice.debitNoteDocument?.fileUrl ? { ...invoice.debitNoteDocument } : null);
    } else {
      setForm({ invoiceNumber: '', invoiceDate: todayStr(), invoiceReceivedDate: todayStr(), invoiceAmount: '', taxableAmount: '', gstAmount: '', tdsAmount: '', otherCharges: '', debitNoteRequired: false, debitNoteNumber: '', debitNoteAmount: '', debitNoteReason: '', remarks: '' });
      setDoc(null); setDnDoc(null);
      setQc(presetQc || null);
    }
  }, [open, invoice, presetQc]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const netPayable = useMemo(() => round2(
    (Number(form.invoiceAmount) || 0) - (form.debitNoteRequired ? (Number(form.debitNoteAmount) || 0) : 0) - advancePaid,
  ), [form.invoiceAmount, form.debitNoteRequired, form.debitNoteAmount, advancePaid]);

  const upload = (setter) => async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try {
      const res = await uploadDoc(f).unwrap();
      const d = res?.data || {};
      setter({ fileName: d.fileName || f.name, fileUrl: d.url, fileType: d.mimeType || f.type });
      enqueueSnackbar('Document uploaded', { variant: 'success' });
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Upload failed', { variant: 'error' }); }
  };

  const handleSubmit = async () => {
    if (!isEdit && !qc?._id) { enqueueSnackbar('Select a QC (PASSED/PARTIAL) first', { variant: 'warning' }); return; }
    if (!form.invoiceNumber.trim()) { enqueueSnackbar('Enter the vendor invoice number', { variant: 'warning' }); return; }
    if (!(Number(form.invoiceAmount) > 0)) { enqueueSnackbar('Enter the invoice amount', { variant: 'warning' }); return; }

    const payload = {
      invoiceNumber: form.invoiceNumber.trim(),
      invoiceDate: form.invoiceDate || undefined,
      invoiceReceivedDate: form.invoiceReceivedDate || undefined,
      invoiceAmount: round2(form.invoiceAmount),
      taxableAmount: round2(form.taxableAmount), gstAmount: round2(form.gstAmount),
      tdsAmount: round2(form.tdsAmount), otherCharges: round2(form.otherCharges),
      debitNoteRequired: form.debitNoteRequired,
      debitNoteNumber: form.debitNoteNumber.trim(),
      debitNoteAmount: form.debitNoteRequired ? round2(form.debitNoteAmount) : 0,
      debitNoteReason: form.debitNoteReason.trim(),
      invoiceDocument: doc ? { fileName: doc.fileName, fileUrl: doc.fileUrl, fileType: doc.fileType } : undefined,
      debitNoteDocument: dnDoc ? { fileName: dnDoc.fileName, fileUrl: dnDoc.fileUrl, fileType: dnDoc.fileType } : undefined,
      remarks: form.remarks.trim(),
    };
    try {
      if (isEdit) {
        await updateInv({ id: invoice._id, ...payload }).unwrap();
        enqueueSnackbar('Invoice updated', { variant: 'success' });
      } else {
        const res = await createInv({ ...payload, qcId: qc._id }).unwrap();
        enqueueSnackbar(`Invoice ${res?.data?.invoiceNumber || ''} saved`, { variant: 'success' });
      }
      onClose?.(true);
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to save invoice', { variant: 'error' }); }
  };

  const DocBox = ({ value, onPick, onClear, label }) => (
    <Box>
      <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 0.75 }}>{label}</Typography>
      {value?.fileUrl ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: '10px', bgcolor: '#fff' }}>
          <FileText size={16} />
          <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>{value.fileName}</Typography>
          <Button size="small" startIcon={<ExternalLink size={13} />} href={fileHref(value.fileUrl)} target="_blank" rel="noopener">View</Button>
          <Chip size="small" label="Remove" onDelete={onClear} deleteIcon={<X size={13} />} onClick={onClear} />
        </Box>
      ) : (
        <Button variant="outlined" size="small" startIcon={uploading ? <CircularProgress size={14} /> : <Upload size={14} />} onClick={onPick} disabled={uploading}>Upload PDF / Image</Button>
      )}
    </Box>
  );

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="md" fullWidth
      PaperProps={{ sx: { height: { xs: '100%', md: '92vh' }, display: 'flex', flexDirection: 'column', borderRadius: { xs: 0, md: '18px' }, overflow: 'hidden' } }}>
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)', color: '#fff' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <ReceiptText size={22} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: '#fff' }}>{isEdit ? `Edit ${invoice.invoiceNumber}` : 'New Vendor Invoice'}</Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)' }}>Step 1.10 · Invoice / Debit Note received</Typography>
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(false)} sx={{ color: '#fff' }}><X size={20} /></IconButton>
      </Box>

      <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => upload(setDoc)(e)} />
      <input ref={dnFileRef} type="file" accept={ACCEPT} hidden onChange={(e) => upload(setDnDoc)(e)} />

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, bgcolor: '#f8fafc' }}>
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: 'primary.main' }}><FileText size={18} /> Invoice Header</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={5}>
              {isEdit || presetQc ? (
                <TextField label="QC Number" fullWidth value={qc?.qcNumber || ''} disabled />
              ) : (
                <Autocomplete options={qcOptions} loading={qcLoading} value={qc}
                  getOptionLabel={(o) => (o ? `${o.qcNumber} — ${o.vendorName}` : '')}
                  isOptionEqualToValue={(o, v) => o._id === v._id} onChange={(_e, v) => setQc(v)}
                  noOptionsText="No QC is passed/partial yet"
                  renderInput={(params) => <TextField {...params} label="Incoming QC *" placeholder="QC PASSED / PARTIAL"
                    InputProps={{ ...params.InputProps, endAdornment: (<>{qcLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />} />
              )}
            </Grid>
            <Grid item xs={12} sm={4}><TextField label="Vendor Invoice No *" fullWidth value={form.invoiceNumber} onChange={(e) => set('invoiceNumber', e.target.value)} /></Grid>
            <Grid item xs={6} sm={3}><DateInputDDMMYYYY label="Invoice Date" fullWidth value={form.invoiceDate} onChange={(val) => set('invoiceDate', val)} /></Grid>
          </Grid>
          {qc ? (
            <Box sx={{ mt: 2, p: 1.5, borderRadius: '10px', bgcolor: alpha('#2563eb', 0.04), display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'center' }}>
              <Building2 size={16} color="#1d4ed8" />
              <Typography variant="caption" fontWeight={700}>{qc.vendorName || invoice?.vendorName || '—'}</Typography>
              {(qc.grnNumber || invoice?.grnNumber) && <Chip size="small" variant="outlined" label={`GRN ${qc.grnNumber || invoice?.grnNumber}`} sx={{ fontWeight: 700 }} />}
              {(qc.poNumber || invoice?.poNumber) && <Chip size="small" variant="outlined" label={`PO ${qc.poNumber || invoice?.poNumber}`} sx={{ fontWeight: 700 }} />}
              <Chip size="small" color="info" variant="outlined" label={`Advance paid ${fmtINR(advancePaid)}`} sx={{ fontWeight: 700 }} />
            </Box>
          ) : null}
        </Paper>

        {/* Financials */}
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ fontWeight: 700, color: '#0f766e', mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}><ReceiptText size={18} /> Financials</Typography>
          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}><TextField label="Invoice Amount *" type="number" fullWidth value={form.invoiceAmount} onChange={(e) => set('invoiceAmount', e.target.value)} inputProps={{ min: 0, step: 0.01 }} /></Grid>
            <Grid item xs={6} sm={3}><TextField label="Taxable Amount" type="number" fullWidth value={form.taxableAmount} onChange={(e) => set('taxableAmount', e.target.value)} inputProps={{ min: 0, step: 0.01 }} /></Grid>
            <Grid item xs={6} sm={3}><TextField label="GST Amount" type="number" fullWidth value={form.gstAmount} onChange={(e) => set('gstAmount', e.target.value)} inputProps={{ min: 0, step: 0.01 }} /></Grid>
            <Grid item xs={6} sm={3}><TextField label="TDS Amount" type="number" fullWidth value={form.tdsAmount} onChange={(e) => set('tdsAmount', e.target.value)} inputProps={{ min: 0, step: 0.01 }} /></Grid>
            <Grid item xs={6} sm={3}><TextField label="Other Charges" type="number" fullWidth value={form.otherCharges} onChange={(e) => set('otherCharges', e.target.value)} inputProps={{ step: 0.01 }} /></Grid>
            <Grid item xs={12} sm={9}><DocBox value={doc} onPick={() => fileRef.current?.click()} onClear={() => setDoc(null)} label="INVOICE DOCUMENT (required to approve)" /></Grid>
          </Grid>
        </Paper>

        {/* Debit note */}
        <Paper elevation={0} sx={SECTION}>
          <FormControlLabel control={<Switch checked={form.debitNoteRequired} onChange={(e) => set('debitNoteRequired', e.target.checked)} />} label={<Typography fontWeight={700} color="#b45309">Debit Note Required</Typography>} />
          {form.debitNoteRequired && (
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid item xs={6} sm={3}><TextField label="Debit Note No" fullWidth value={form.debitNoteNumber} onChange={(e) => set('debitNoteNumber', e.target.value)} /></Grid>
              <Grid item xs={6} sm={3}><TextField label="Debit Note Amount" type="number" fullWidth value={form.debitNoteAmount} onChange={(e) => set('debitNoteAmount', e.target.value)} inputProps={{ min: 0, step: 0.01 }} /></Grid>
              <Grid item xs={12} sm={6}><TextField label="Reason" fullWidth value={form.debitNoteReason} onChange={(e) => set('debitNoteReason', e.target.value)} /></Grid>
              <Grid item xs={12}><DocBox value={dnDoc} onPick={() => dnFileRef.current?.click()} onClear={() => setDnDoc(null)} label="DEBIT NOTE DOCUMENT" /></Grid>
            </Grid>
          )}
        </Paper>

        {/* Net payable */}
        <Paper elevation={0} sx={{ ...SECTION, bgcolor: alpha('#1d4ed8', 0.03) }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>INVOICE</Typography><Typography fontWeight={700}>{fmtINR(form.invoiceAmount)}</Typography></Box>
            <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>− DEBIT NOTE</Typography><Typography fontWeight={700}>{fmtINR(form.debitNoteRequired ? form.debitNoteAmount : 0)}</Typography></Box>
            <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>− ADVANCE PAID</Typography><Typography fontWeight={700}>{fmtINR(advancePaid)}</Typography></Box>
            <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="primary.main" fontWeight={700}>NET PAYABLE</Typography><Typography variant="h6" fontWeight={800} color="primary.dark">{fmtINR(netPayable)}</Typography></Box>
          </Box>
        </Paper>

        <TextField label="Remarks" fullWidth value={form.remarks} onChange={(e) => set('remarks', e.target.value)} sx={{ bgcolor: '#fff' }} />
      </Box>

      <Divider />
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end', gap: 1.5, bgcolor: '#fff' }}>
        <Button variant="outlined" onClick={() => onClose?.(false)} disabled={saving}>Cancel</Button>
        <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} onClick={handleSubmit} disabled={saving || uploading}>
          {isEdit ? 'Save Changes' : 'Create Invoice'}
        </Button>
      </Box>
    </Dialog>
  );
};

export default VendorInvoiceFormDialog;
