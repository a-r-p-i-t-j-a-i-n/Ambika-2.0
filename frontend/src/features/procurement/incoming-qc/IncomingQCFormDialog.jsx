import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog, Box, Typography, TextField, Button, IconButton, Divider,
  Grid, Autocomplete, CircularProgress, Paper, Chip, MenuItem,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { X, Save, ClipboardCheck, Building2, FileText, Upload, ExternalLink } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetGrnsQuery,
  useCreateIncomingQcMutation,
  useUpdateIncomingQcMutation,
} from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { fileHref } from '../indents/indentMeta';
import { DEFECT_SEVERITIES } from './qcMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { PFMS, pfmsCardSx } from '../pfmsTheme';

const ACCEPT = '.pdf,image/*';

/**
 * Create / edit an Incoming QC (Step 1.9). Only completed GRNs that are still
 * QC-pending are selectable; lines auto-load from the GRN. Per item:
 *   acceptedQty + rejectedQty + reworkQty must equal receivedQty.
 */
const todayStr = () => new Date().toISOString().slice(0, 10);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const SECTION = { p: 2.5, ...pfmsCardSx };

const IncomingQCFormDialog = ({ open, onClose, qc = null, presetGrn = null }) => {
  const { enqueueSnackbar } = useSnackbar();
  const navigate = useNavigate();
  const isEdit = Boolean(qc?._id);

  const [grn, setGrn] = useState(null);
  const [header, setHeader] = useState({ qcDate: todayStr(), checkedByName: '', preparedBy: '', remarks: '' });
  const [items, setItems] = useState([]);
  const [doc, setDoc] = useState(null);
  const fileRef = useRef(null);

  const [createQc, { isLoading: creating }] = useCreateIncomingQcMutation();
  const [updateQc, { isLoading: updating }] = useUpdateIncomingQcMutation();
  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();
  const saving = creating || updating;

  const handleUpload = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try {
      const res = await uploadDoc(f).unwrap();
      const d = res?.data || {};
      setDoc({ fileName: d.fileName || f.name, fileUrl: d.url, fileType: d.mimeType || f.type });
      enqueueSnackbar('Attachment uploaded', { variant: 'success' });
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Upload failed', { variant: 'error' }); }
  };

  // GRNs eligible for QC: completed + qcStatus PENDING + MD Approved.
  const { data: grnRes, isLoading: grnLoading } = useGetGrnsQuery(
    { limit: 200, sort: '-createdAt', qcStatus: 'PENDING' },
    { skip: !open || isEdit },
  );
  const grnOptions = (grnRes?.data || []).filter(
    (g) => ['RECEIVED', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED'].includes(g.grnStatus)
      && g.qcStatus === 'PENDING' && g.approvalStatus === 'MD_APPROVED',
  );

  const linesFromGrn = (g) => (g?.items || [])
    .filter((it) => round2(it.receivedQty) > 0)
    .map((it) => ({
      grnItemId: it._id, skuId: it.skuId || '', skuCode: it.skuCode || '', itemName: it.itemName,
      unit: it.unit || 'Pcs', batchNo: it.batchNo || '', receivedQty: round2(it.receivedQty),
      acceptedQty: round2(it.receivedQty), rejectedQty: 0, reworkQty: 0,
      defectType: '', defectSeverity: '', qcRemarks: '',
    }));

  useEffect(() => {
    if (!open) return;
    if (qc) {
      setGrn({ _id: qc.grnId, grnNumber: qc.grnNumber, vendorName: qc.vendorName });
      setHeader({ qcDate: qc.qcDate ? qc.qcDate.slice(0, 10) : todayStr(), checkedByName: qc.checkedByName || '', preparedBy: qc.preparedBy || '', remarks: qc.remarks || '' });
      setDoc(qc.qcReportDocument?.fileUrl ? { ...qc.qcReportDocument } : null);
      setItems((qc.items || []).map((it) => ({
        grnItemId: it.grnItemId, skuId: it.skuId || '', skuCode: it.skuCode || '', itemName: it.itemName,
        unit: it.unit || 'Pcs', batchNo: it.batchNo || '', receivedQty: it.receivedQty,
        acceptedQty: it.acceptedQty, rejectedQty: it.rejectedQty, reworkQty: it.reworkQty,
        defectType: it.defectType || '', defectSeverity: it.defectSeverity || '', qcRemarks: it.qcRemarks || '',
      })));
    } else {
      setHeader({ qcDate: todayStr(), checkedByName: '', preparedBy: '', remarks: '' });
      setDoc(null);
      if (presetGrn) { setGrn(presetGrn); setItems(linesFromGrn(presetGrn)); }
      else { setGrn(null); setItems([]); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, qc, presetGrn]);

  const applyGrn = (g) => { setGrn(g); setItems(g ? linesFromGrn(g) : []); };
  const setItem = (idx, patch) => setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const totals = useMemo(() => items.reduce((a, it) => ({
    received: round2(a.received + round2(it.receivedQty)),
    accepted: round2(a.accepted + round2(it.acceptedQty)),
    rejected: round2(a.rejected + round2(it.rejectedQty)),
    rework: round2(a.rework + round2(it.reworkQty)),
  }), { received: 0, accepted: 0, rejected: 0, rework: 0 }), [items]);

  const lineBalanced = (it) => round2(round2(it.acceptedQty) + round2(it.rejectedQty) + round2(it.reworkQty)) === round2(it.receivedQty);
  const allBalanced = items.length > 0 && items.every(lineBalanced);

  // Highlight the Remarks field — escalate to amber when there are rejected /
  // rework quantities and no overall remark explaining them.
  const hasDefects = totals.rejected > 0 || totals.rework > 0;
  const remarksSuggested = hasDefects && !header.remarks.trim();

  const handleSubmit = async (markComplete = false) => {
    if (!isEdit && !grn?._id) { enqueueSnackbar('Select a GRN first', { variant: 'warning' }); return; }
    if (items.length === 0) { enqueueSnackbar('No items to inspect', { variant: 'warning' }); return; }
    const payload = {
      ...header,
      qcReportDocument: doc ? { fileName: doc.fileName, fileUrl: doc.fileUrl, fileType: doc.fileType } : undefined,
      items: items.map((it) => ({
        grnItemId: it.grnItemId, skuId: it.skuId || undefined, skuCode: it.skuCode || '', itemName: it.itemName,
        unit: it.unit, batchNo: it.batchNo, receivedQty: round2(it.receivedQty),
        acceptedQty: round2(it.acceptedQty), rejectedQty: round2(it.rejectedQty), reworkQty: round2(it.reworkQty),
        defectType: it.defectType?.trim() || '', defectSeverity: it.defectSeverity || '', qcRemarks: it.qcRemarks?.trim() || '',
      })),
    };
    try {
      if (isEdit) {
        await updateQc({ id: qc._id, ...payload }).unwrap();
        enqueueSnackbar('QC updated', { variant: 'success' });
        onClose?.(true);
      } else {
        const res = await createQc({ ...payload, grnId: grn._id }).unwrap();
        const newId = res?.data?._id;
        enqueueSnackbar(`QC ${res?.data?.qcNumber || ''} created — complete the inspection to continue`, { variant: 'success' });
        onClose?.(true);
        // Take the user straight to the new QC, where "Complete QC" + the Next Step
        // banner are shown — no hunting for where to go next.
        if (newId) navigate(`/procurement/incoming-qc/${newId}`);
      }
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save QC', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: { xs: '100%', md: '92vh' }, display: 'flex', flexDirection: 'column', borderRadius: { xs: 0, md: '8px' }, overflow: 'hidden' } }}>
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)', color: '#fff' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <ClipboardCheck size={22} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: '#fff' }}>
              {isEdit ? `Edit ${qc.qcNumber}` : 'New Incoming QC Check'}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)' }}>
              Step 1.9 · Inspect received material — rejected qty moves out of stock on Complete
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(false)} sx={{ color: '#fff' }}><X size={20} /></IconButton>
      </Box>

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, bgcolor: PFMS.canvas }}>
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: 'primary.main' }}>
            <FileText size={18} /> QC Header
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={5}>
              {isEdit || presetGrn ? (
                <TextField label="GRN Number" fullWidth value={grn?.grnNumber || ''} disabled />
              ) : (
                <Autocomplete
                  options={grnOptions}
                  loading={grnLoading}
                  value={grn}
                  getOptionLabel={(o) => (o ? `${o.grnNumber} — ${o.vendorName}` : '')}
                  isOptionEqualToValue={(o, v) => o._id === v._id}
                  onChange={(_e, v) => applyGrn(v)}
                  noOptionsText="No GRN is pending QC (must be MD Approved)"
                  renderInput={(params) => (
                    <TextField {...params} label="GRN *" placeholder="Completed + MD Approved GRNs pending QC"
                      InputProps={{ ...params.InputProps, endAdornment: (<>{grnLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
                  )}
                />
              )}
            </Grid>
            <Grid item xs={6} sm={2.4}><DateInputDDMMYYYY label="QC Date" fullWidth value={header.qcDate} onChange={(val) => setHeader((h) => ({ ...h, qcDate: val }))} /></Grid>
            <Grid item xs={6} sm={2.3}><TextField label="Checked By" fullWidth value={header.checkedByName} onChange={(e) => setHeader((h) => ({ ...h, checkedByName: e.target.value }))} /></Grid>
            <Grid item xs={6} sm={2.3}><TextField label="Prepared By" fullWidth value={header.preparedBy} onChange={(e) => setHeader((h) => ({ ...h, preparedBy: e.target.value }))} /></Grid>
          </Grid>
          {grn ? (
            <Box sx={{ mt: 2, p: 1.5, borderRadius: '10px', bgcolor: alpha('#2563eb', 0.04), display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'center' }}>
              <Building2 size={16} color="#1d4ed8" />
              <Typography variant="caption" fontWeight={700}>{grn.vendorName || qc?.vendorName || '—'}</Typography>
              {(grn.poNumber || qc?.poNumber) && <Chip size="small" variant="outlined" label={`PO ${grn.poNumber || qc?.poNumber}`} sx={{ fontWeight: 700 }} />}
              {(grn.piNumber || qc?.piNumber) && <Chip size="small" variant="outlined" label={`PI ${grn.piNumber || qc?.piNumber}`} sx={{ fontWeight: 700 }} />}
            </Box>
          ) : null}
        </Paper>

        {/* QC item table */}
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ fontWeight: 700, color: '#b45309', mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <ClipboardCheck size={18} /> Inspection
          </Typography>
          {items.length === 0 ? (
            <Typography variant="body2" color="text.disabled" sx={{ py: 2 }}>Select a GRN to load its received items.</Typography>
          ) : (
            <>
              <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: '1.7fr 0.8fr 0.7fr 0.75fr 0.75fr 0.7fr 1fr 0.85fr', gap: 1, px: 1, mb: 0.5 }}>
                {['Item', 'SKU', 'Received', 'Accepted', 'Rejected', 'Rework', 'Defect', 'Severity'].map((h, i) => (
                  <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.62rem' }}>{h}</Typography>
                ))}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {items.map((it, idx) => {
                  const bad = !lineBalanced(it);
                  return (
                    <Box key={idx} sx={{
                      display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.7fr 0.8fr 0.7fr 0.75fr 0.75fr 0.7fr 1fr 0.85fr' },
                      gap: 1, alignItems: 'center', p: { xs: 1.5, md: 0.5 }, px: { md: 1 },
                      borderRadius: '10px', border: { xs: '1px solid', md: bad ? '1px solid' : 'none' }, borderColor: bad ? 'error.main' : 'divider',
                      '&:hover': { bgcolor: alpha('#2563eb', 0.03) },
                    }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>{it.itemName}</Typography>
                        {it.batchNo ? <Typography variant="caption" color="text.disabled">Batch {it.batchNo}</Typography> : null}
                      </Box>
                      <Typography variant="body2" color="primary.main" fontWeight={700}>{it.skuCode || '—'}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700 }}>{it.receivedQty}</Typography>
                      <TextField size="small" type="number" value={it.acceptedQty} error={bad}
                        onChange={(e) => setItem(idx, { acceptedQty: e.target.value })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} />
                      <TextField size="small" type="number" value={it.rejectedQty} error={bad}
                        onChange={(e) => setItem(idx, { rejectedQty: e.target.value })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} />
                      <TextField size="small" type="number" value={it.reworkQty} error={bad}
                        onChange={(e) => setItem(idx, { reworkQty: e.target.value })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} />
                      <TextField size="small" placeholder="defect" value={it.defectType}
                        onChange={(e) => setItem(idx, { defectType: e.target.value })} />
                      <TextField size="small" select value={it.defectSeverity}
                        onChange={(e) => setItem(idx, { defectSeverity: e.target.value })}>
                        <MenuItem value="">—</MenuItem>
                        {DEFECT_SEVERITIES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                      </TextField>
                    </Box>
                  );
                })}
              </Box>
              <Divider sx={{ my: 2 }} />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
                <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>RECEIVED</Typography><Typography fontWeight={700}>{totals.received}</Typography></Box>
                <Box sx={{ textAlign: 'right' }}><Typography variant="caption" sx={{ color: '#0f766e' }} fontWeight={700}>ACCEPTED</Typography><Typography fontWeight={800} sx={{ color: '#0f766e' }}>{totals.accepted}</Typography></Box>
                <Box sx={{ textAlign: 'right' }}><Typography variant="caption" sx={{ color: '#be123c' }} fontWeight={700}>REJECTED</Typography><Typography fontWeight={800} sx={{ color: '#be123c' }}>{totals.rejected}</Typography></Box>
                <Box sx={{ textAlign: 'right' }}><Typography variant="caption" sx={{ color: '#b45309' }} fontWeight={700}>REWORK</Typography><Typography fontWeight={800} sx={{ color: '#b45309' }}>{totals.rework}</Typography></Box>
              </Box>
              {!allBalanced && (
                <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1, textAlign: 'right', fontWeight: 700 }}>
                  Each row must satisfy: Accepted + Rejected + Rework = Received
                </Typography>
              )}
            </>
          )}
        </Paper>

        <TextField
          label="Remarks"
          fullWidth
          multiline
          minRows={2}
          value={header.remarks}
          onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))}
          placeholder="Add inspection notes…"
          helperText={remarksSuggested
            ? 'Recommended: note the reason for rejected / rework quantities'
            : 'Inspection remarks'}
          sx={{
            bgcolor: remarksSuggested ? alpha('#b45309', 0.06) : alpha('#2563eb', 0.05),
            borderRadius: '12px',
            '& .MuiOutlinedInput-root fieldset': {
              borderColor: remarksSuggested ? '#b45309' : '#2563eb',
              borderWidth: 2,
            },
            '& .MuiInputLabel-root': {
              fontWeight: 700,
              color: remarksSuggested ? '#b45309' : 'primary.main',
            },
            '& .MuiFormHelperText-root': remarksSuggested ? { color: '#b45309' } : {},
          }} />

        {/* Attachment (QC report / photo / inspection document) */}
        <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={handleUpload} />
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 0.75 }}>
            ATTACHMENT (QC report / photo — optional)
          </Typography>
          {doc?.fileUrl ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: '10px', bgcolor: '#fff' }}>
              <FileText size={16} />
              <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>{doc.fileName}</Typography>
              <Button size="small" startIcon={<ExternalLink size={13} />} href={fileHref(doc.fileUrl)} target="_blank" rel="noopener">View</Button>
              <Chip size="small" label="Remove" onDelete={() => setDoc(null)} onClick={() => setDoc(null)} deleteIcon={<X size={13} />} />
            </Box>
          ) : (
            <Button variant="outlined" size="small" startIcon={uploading ? <CircularProgress size={14} /> : <Upload size={14} />}
              onClick={() => fileRef.current?.click()} disabled={uploading}>
              Upload PDF / Image
            </Button>
          )}
        </Box>
      </Box>

      <Divider />
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#fff' }}>
        <Typography variant="caption" color={allBalanced ? 'text.secondary' : 'error'}>
          {items.length} item(s) · {allBalanced ? 'quantities balanced' : 'quantities not balanced'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button variant="outlined" onClick={() => onClose?.(false)} disabled={saving || uploading}>Cancel</Button>
          <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
            onClick={() => handleSubmit()} disabled={saving || uploading}>
            {isEdit ? 'Save Changes' : 'Create QC'}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};

export default IncomingQCFormDialog;
