import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, MenuItem, FormControl, FormLabel, RadioGroup, FormControlLabel, Radio,
  Box, Typography, CircularProgress, IconButton, Stack,
} from '@mui/material';
import { Upload, FileText, X, Save, ExternalLink } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useApproveQuotationMutation } from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { fileHref } from './indentMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

/**
 * Step 1.3 — Approved Quotation 1.03.
 *
 * Simple Google-Form style: pick Status, upload one or more approved quotation
 * files (PDF / image / Excel), set the actual date and remarks. Submits the
 * `approvedQuotationDocuments[]` payload (backend mirrors the first into the
 * legacy `approvedQuotation` field used by the PO flow). No vendor approval UI
 * here — backend still supports multi-vendor separately. Requires Step 1.2 done.
 */
const ACCEPT = '.pdf,image/*,.xls,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
const todayStr = () => new Date().toISOString().slice(0, 10);

const QuotationApprovalDialog = ({ open, onClose, indent }) => {
  const { enqueueSnackbar } = useSnackbar();
  const fileRef = useRef(null);

  const [statusDone, setStatusDone] = useState('YES');
  const [actualAt, setActualAt] = useState(todayStr());
  const [remarks, setRemarks] = useState('');
  const [files, setFiles] = useState([]); // [{ fileName, fileUrl, fileType }]

  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();
  const [approveQuotation, { isLoading: saving }] = useApproveQuotationMutation();

  useEffect(() => {
    if (!open) return;
    const existing = indent?.quotationApprovalStep;
    setStatusDone(existing?.statusDone || 'YES');
    setActualAt(existing?.actualAt ? existing.actualAt.slice(0, 10) : todayStr());
    setRemarks(existing?.remarks || '');
    // Hydrate from approvedQuotationDocuments[], falling back to the legacy field.
    const docs = existing?.approvedQuotationDocuments?.length
      ? existing.approvedQuotationDocuments
      : (existing?.approvedQuotation?.fileUrl ? [existing.approvedQuotation] : []);
    setFiles(docs.filter((d) => d?.fileUrl).map((d) => ({ fileName: d.fileName, fileUrl: d.fileUrl, fileType: d.fileType })));
  }, [open, indent]);

  const handlePick = () => fileRef.current?.click();

  const handleFiles = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    for (const f of picked) {
      if (f.size > 10 * 1024 * 1024) {
        enqueueSnackbar(`${f.name} exceeds 10 MB`, { variant: 'warning' });
        continue;
      }
      try {
        const res = await uploadDoc(f).unwrap();
        const d = res?.data || {};
        setFiles((cur) => [...cur, { fileName: d.fileName || f.name, fileUrl: d.url, fileType: d.mimeType || f.type }]);
      } catch (err) {
        enqueueSnackbar(err?.data?.message || `Failed to upload ${f.name}`, { variant: 'error' });
      }
    }
  };

  const removeFile = (idx) => setFiles((cur) => cur.filter((_, i) => i !== idx));

  const handleSubmit = async () => {
    if (statusDone === 'YES' && files.length === 0) {
      enqueueSnackbar('At least one approved quotation file is required when status is Yes', { variant: 'warning' });
      return;
    }
    try {
      await approveQuotation({
        id: indent._id,
        statusDone,
        approvedQuotationDocuments: files.map((f) => ({ fileName: f.fileName, fileUrl: f.fileUrl, fileType: f.fileType })),
        actualAt,
        remarks: remarks.trim(),
      }).unwrap();
      enqueueSnackbar('Quotation approval recorded', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Approved Quotation 1.03</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField label="Indent No" fullWidth value={indent?.indentNumber || ''} InputProps={{ readOnly: true }} disabled />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Step No" select fullWidth value="Step 1.3" disabled>
              <MenuItem value="Step 1.3">Step 1.3</MenuItem>
            </TextField>
          </Grid>

          <Grid item xs={12}>
            <FormControl required>
              <FormLabel sx={{ fontSize: '0.8rem', fontWeight: 700 }}>Status Done?</FormLabel>
              <RadioGroup row value={statusDone} onChange={(e) => setStatusDone(e.target.value)}>
                <FormControlLabel value="YES" control={<Radio />} label="Yes" />
                <FormControlLabel value="QUOTATION_NOT_APPROVED" control={<Radio />} label="Quotation Not Approved" />
              </RadioGroup>
            </FormControl>
          </Grid>

          <Grid item xs={12}>
            <FormLabel sx={{ fontSize: '0.8rem', fontWeight: 700, display: 'block', mb: 1 }}>
              Approved Quotation {statusDone === 'YES' ? '*' : '(optional)'}
            </FormLabel>
            <input ref={fileRef} type="file" accept={ACCEPT} multiple onChange={handleFiles} hidden />

            {files.length > 0 && (
              <Stack spacing={1} sx={{ mb: 1.5 }}>
                {files.map((f, idx) => (
                  <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: '10px', bgcolor: '#f8fafc' }}>
                    <FileText size={18} />
                    <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap title={f.fileName}>{f.fileName}</Typography>
                    <Button size="small" startIcon={<ExternalLink size={14} />} href={fileHref(f.fileUrl)} target="_blank" rel="noopener">View</Button>
                    <IconButton size="small" color="error" onClick={() => removeFile(idx)}><X size={15} /></IconButton>
                  </Box>
                ))}
              </Stack>
            )}

            <Button variant="outlined" startIcon={uploading ? <CircularProgress size={16} /> : <Upload size={16} />}
              onClick={handlePick} disabled={uploading}>
              {uploading ? 'Uploading…' : (files.length ? 'Add More Files' : 'Upload PDF / Image / Excel')}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              Multiple files allowed · PDF, PNG, JPG, XLSX · max 10 MB each
            </Typography>
          </Grid>

          <Grid item xs={12} sm={5}>
            <DateInputDDMMYYYY label="Actual Date" fullWidth value={actualAt} onChange={setActualAt} />
          </Grid>
          <Grid item xs={12} sm={7}>
            <TextField label="Remarks" fullWidth value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={saving || uploading}>Cancel</Button>
        <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
          onClick={handleSubmit} disabled={saving || uploading}>
          Submit
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default QuotationApprovalDialog;
