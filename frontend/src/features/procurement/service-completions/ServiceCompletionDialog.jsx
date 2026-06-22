import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, Box, Typography, CircularProgress, Autocomplete, FormLabel, Stack, IconButton,
} from '@mui/material';
import { Upload, FileText, X, Save, ExternalLink, CheckCircle2 } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useCreateServiceCompletionMutation } from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import { fileHref } from '../indents/indentMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

const ACCEPT = '.pdf,image/*,.xls,.xlsx,.doc,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
const todayStr = () => new Date().toISOString().slice(0, 10);

/**
 * Step 1.8A — Mark an internal-service indent's work as completed. Creates a
 * Service Completion record (status COMPLETED) which moves the indent to
 * SERVICE_COMPLETED and makes it eligible for Incoming QC (no PO/PI/GRN).
 */
const ServiceCompletionDialog = ({ open, onClose, indent }) => {
  const { enqueueSnackbar } = useSnackbar();
  const reportRef = useRef(null);
  const invoiceRef = useRef(null);
  const docsRef = useRef(null);

  const [vendor, setVendor] = useState(null);
  const [vendorName, setVendorName] = useState('');
  const [completionDate, setCompletionDate] = useState(todayStr());
  const [remarks, setRemarks] = useState('');
  const [docs, setDocs] = useState([]);          // completion documents
  const [report, setReport] = useState(null);    // service report
  const [invoice, setInvoice] = useState(null);  // optional invoice
  const [uploadingKey, setUploadingKey] = useState('');

  const [uploadDoc] = useUploadOrderDocumentMutation();
  const [createSc, { isLoading: saving }] = useCreateServiceCompletionMutation();
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' }, { skip: !open });
  const vendorOptions = partiesRes?.data || [];

  useEffect(() => {
    if (!open) return;
    setVendor(null);
    setVendorName(indent?.vendorName || '');
    setCompletionDate(todayStr());
    setRemarks('');
    setDocs([]);
    setReport(null);
    setInvoice(null);
  }, [open, indent]);

  const uploadOne = async (file, key) => {
    if (file.size > 10 * 1024 * 1024) { enqueueSnackbar(`${file.name} exceeds 10 MB`, { variant: 'warning' }); return null; }
    setUploadingKey(key);
    try {
      const res = await uploadDoc(file).unwrap();
      const d = res?.data || {};
      return { fileName: d.fileName || file.name, fileUrl: d.url, fileType: d.mimeType || file.type };
    } catch (err) {
      enqueueSnackbar(err?.data?.message || `Failed to upload ${file.name}`, { variant: 'error' });
      return null;
    } finally { setUploadingKey(''); }
  };

  const onPickReport = async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { const r = await uploadOne(f, 'report'); if (r) setReport(r); } };
  const onPickInvoice = async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { const r = await uploadOne(f, 'invoice'); if (r) setInvoice(r); } };
  const onPickDocs = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    for (const f of files) { const r = await uploadOne(f, 'docs'); if (r) setDocs((cur) => [...cur, r]); }
  };

  const handleSubmit = async () => {
    try {
      await createSc({
        indentId: indent._id,
        status: 'COMPLETED',
        vendorId: vendor?._id || undefined,
        vendorName: vendor?.name || vendorName.trim(),
        serviceCompletionDate: completionDate,
        completionRemarks: remarks.trim(),
        completionDocuments: docs,
        serviceReportDocument: report || undefined,
        invoiceDocument: invoice || undefined,
      }).unwrap();
      enqueueSnackbar('Service marked completed', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to record service completion', { variant: 'error' });
    }
  };

  const FileRow = ({ file, onRemove }) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: '10px', bgcolor: '#f8fafc' }}>
      <FileText size={18} />
      <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap title={file.fileName}>{file.fileName}</Typography>
      <Button size="small" startIcon={<ExternalLink size={14} />} href={fileHref(file.fileUrl)} target="_blank" rel="noopener">View</Button>
      <IconButton size="small" color="error" onClick={onRemove}><X size={15} /></IconButton>
    </Box>
  );

  const UploadBtn = ({ label, onClick, busy }) => (
    <Button variant="outlined" size="small" startIcon={busy ? <CircularProgress size={14} /> : <Upload size={15} />} onClick={onClick} disabled={!!uploadingKey}>
      {busy ? 'Uploading…' : label}
    </Button>
  );

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
        <CheckCircle2 size={20} color="#16a34a" /> Mark Service Completed
      </DialogTitle>
      <DialogContent dividers>
        <input ref={reportRef} type="file" accept={ACCEPT} onChange={onPickReport} hidden />
        <input ref={invoiceRef} type="file" accept={ACCEPT} onChange={onPickInvoice} hidden />
        <input ref={docsRef} type="file" accept={ACCEPT} multiple onChange={onPickDocs} hidden />
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField label="Indent No" fullWidth value={indent?.indentNumber || ''} InputProps={{ readOnly: true }} disabled />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DateInputDDMMYYYY label="Service Completion Date *" fullWidth openOnClick value={completionDate} onChange={setCompletionDate} />
          </Grid>

          <Grid item xs={12}>
            <Autocomplete
              freeSolo
              options={vendorOptions}
              value={vendor}
              inputValue={vendor?.name ?? vendorName}
              getOptionLabel={(o) => (typeof o === 'string' ? o : o?.name || '')}
              isOptionEqualToValue={(o, v) => o._id === v._id}
              onChange={(_e, v) => { if (v && typeof v === 'object') { setVendor(v); setVendorName(v.name || ''); } else { setVendor(null); setVendorName(v || ''); } }}
              onInputChange={(_e, v, reason) => { if (reason === 'input') { setVendor(null); setVendorName(v); } }}
              renderInput={(params) => <TextField {...params} label="Vendor / Service Provider" placeholder="Select or type provider" />}
            />
          </Grid>

          <Grid item xs={12}>
            <TextField label="Completion Remarks" fullWidth multiline minRows={2} value={remarks}
              onChange={(e) => setRemarks(e.target.value)} placeholder="What was done?" />
          </Grid>

          <Grid item xs={12} sm={6}>
            <FormLabel sx={{ fontSize: '0.75rem', fontWeight: 700, display: 'block', mb: 1 }}>Service Report</FormLabel>
            {report ? <FileRow file={report} onRemove={() => setReport(null)} /> : <UploadBtn label="Upload Report" onClick={() => reportRef.current?.click()} busy={uploadingKey === 'report'} />}
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormLabel sx={{ fontSize: '0.75rem', fontWeight: 700, display: 'block', mb: 1 }}>Invoice (optional)</FormLabel>
            {invoice ? <FileRow file={invoice} onRemove={() => setInvoice(null)} /> : <UploadBtn label="Upload Invoice" onClick={() => invoiceRef.current?.click()} busy={uploadingKey === 'invoice'} />}
          </Grid>

          <Grid item xs={12}>
            <FormLabel sx={{ fontSize: '0.75rem', fontWeight: 700, display: 'block', mb: 1 }}>Completion Documents</FormLabel>
            {docs.length > 0 && (
              <Stack spacing={1} sx={{ mb: 1 }}>
                {docs.map((d, i) => <FileRow key={i} file={d} onRemove={() => setDocs((cur) => cur.filter((_, j) => j !== i))} />)}
              </Stack>
            )}
            <UploadBtn label={docs.length ? 'Add More' : 'Upload Documents'} onClick={() => docsRef.current?.click()} busy={uploadingKey === 'docs'} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={saving || !!uploadingKey}>Cancel</Button>
        <Button variant="contained" color="success" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
          onClick={handleSubmit} disabled={saving || !!uploadingKey}>
          Mark Completed
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ServiceCompletionDialog;
