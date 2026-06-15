import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, MenuItem, FormControl, FormLabel, RadioGroup, FormControlLabel, Radio,
  Box, Typography, CircularProgress, Chip,
} from '@mui/material';
import { Upload, FileText, X, Save, ExternalLink } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useApproveQuotationMutation } from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { fileHref } from './indentMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

/**
 * Step 1.3 — Approved Quotation 1.03.
 * Uploads the approved quotation (PDF / image / Excel) via the shared upload
 * endpoint, then records the step. Requires Step 1.2 to be complete.
 */
const ACCEPT = '.pdf,image/*,.xls,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
const todayStr = () => new Date().toISOString().slice(0, 10);

const QuotationApprovalDialog = ({ open, onClose, indent }) => {
  const { enqueueSnackbar } = useSnackbar();
  const fileRef = useRef(null);

  const [statusDone, setStatusDone] = useState('YES');
  const [actualAt, setActualAt] = useState(todayStr());
  const [remarks, setRemarks] = useState('');
  const [file, setFile] = useState(null); // { fileName, fileUrl, fileType }

  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();
  const [approveQuotation, { isLoading: saving }] = useApproveQuotationMutation();

  useEffect(() => {
    if (!open) return;
    const existing = indent?.quotationApprovalStep;
    setStatusDone(existing?.statusDone || 'YES');
    setActualAt(existing?.actualAt ? existing.actualAt.slice(0, 10) : todayStr());
    setRemarks(existing?.remarks || '');
    setFile(existing?.approvedQuotation?.fileUrl ? {
      fileName: existing.approvedQuotation.fileName,
      fileUrl: existing.approvedQuotation.fileUrl,
      fileType: existing.approvedQuotation.fileType,
    } : null);
  }, [open, indent]);

  const handlePick = () => fileRef.current?.click();

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      enqueueSnackbar('File exceeds 10 MB', { variant: 'warning' });
      return;
    }
    try {
      const res = await uploadDoc(f).unwrap();
      const d = res?.data || {};
      setFile({ fileName: d.fileName || f.name, fileUrl: d.url, fileType: d.mimeType || f.type });
      enqueueSnackbar('Approved quotation uploaded', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Upload failed', { variant: 'error' });
    }
  };

  const handleSubmit = async () => {
    if (statusDone === 'YES' && !file?.fileUrl) {
      enqueueSnackbar('Approved quotation upload is required when status is Yes', { variant: 'warning' });
      return;
    }
    try {
      await approveQuotation({
        id: indent._id,
        statusDone,
        approvedQuotation: file
          ? { fileName: file.fileName, fileUrl: file.fileUrl, fileType: file.fileType }
          : undefined,
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
            <input ref={fileRef} type="file" accept={ACCEPT} onChange={handleFile} hidden />
            {file?.fileUrl ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: '10px', bgcolor: '#f8fafc' }}>
                <FileText size={18} />
                <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>{file.fileName}</Typography>
                <Button size="small" startIcon={<ExternalLink size={14} />} href={fileHref(file.fileUrl)} target="_blank" rel="noopener">View</Button>
                <Chip size="small" label="Remove" onDelete={() => setFile(null)} deleteIcon={<X size={14} />} onClick={() => setFile(null)} />
              </Box>
            ) : (
              <Button variant="outlined" startIcon={uploading ? <CircularProgress size={16} /> : <Upload size={16} />}
                onClick={handlePick} disabled={uploading}>
                {uploading ? 'Uploading…' : 'Upload PDF / Image / Excel'}
              </Button>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              Allowed: PDF, PNG, JPG, XLSX · max 10 MB
            </Typography>
          </Grid>

          <Grid item xs={12} sm={5}>
            <DateInputDDMMYYYY label="Actual Date" fullWidth value={actualAt}
              onChange={setActualAt} />
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
