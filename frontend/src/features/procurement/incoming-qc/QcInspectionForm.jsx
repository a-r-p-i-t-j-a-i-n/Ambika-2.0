import React, { useRef, useEffect } from 'react';
import {
  Box, Typography, TextField, Button, Grid, CircularProgress, Paper, Chip, Alert, useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { X, ClipboardCheck, FileText, Upload, ExternalLink } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { fileHref } from '../indents/indentMeta';
import { lineBalanced, legacyLineDetail, round2 } from './qcForm';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { pfmsCardSx } from '../pfmsTheme';

const ACCEPT = '.pdf,image/*';
const COLS = '1.8fr 0.9fr 0.7fr 0.85fr 0.85fr 1.7fr';
const HEAD = ['Item', 'SKU', 'Received', 'Accepted', 'Rejected', 'Remark'];
const NUMERIC = ['Received', 'Accepted', 'Rejected'];

/**
 * The Incoming QC inspection form body (Step 1.9): QC header, the inspection
 * table — Item · SKU · Received (from the saved GRN, read-only) · Accepted ·
 * Rejected · Remark (optional) — and the optional QC report / photo.
 * Every received unit is Accepted or Rejected (Accepted + Rejected = Received).
 *
 * Rework / defect / severity are no longer entered, but anything the earlier
 * form stored stays on the line (it is sent back unchanged and shown as a note);
 * the full record page lists it. Controlled — the parent owns the state and the
 * save / complete actions. Used by the GRN page / GRN form and the QC dialog.
 *
 *   sourceField    node in the header's first slot (GRN picker / GRN number)
 *   sourceSummary  node under the header (vendor / PO / PI chips)
 *   readOnly       render values only (completed QC)
 *   onUploadingChange  told when an attachment upload starts / ends (to hold the parent's actions)
 */
const QcInspectionForm = ({
  header, onHeaderChange, items, onItemChange, doc, onDocChange,
  readOnly = false, sourceField = null, sourceSummary = null, onUploadingChange,
  emptyText = 'Select a GRN to load its received items.',
}) => {
  const { enqueueSnackbar } = useSnackbar();
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('md'));
  const fileRef = useRef(null);
  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();
  useEffect(() => { onUploadingChange?.(uploading); }, [uploading, onUploadingChange]);

  const unbalanced = readOnly ? [] : items.filter((it) => !lineBalanced(it));

  const handleUpload = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try {
      const d = (await uploadDoc(f).unwrap())?.data || {};
      onDocChange({ fileName: d.fileName || f.name, fileUrl: d.url, fileType: d.mimeType || f.type });
      enqueueSnackbar('Attachment uploaded', { variant: 'success' });
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Upload failed', { variant: 'error' }); }
  };

  // Entering Accepted / Rejected on a line that still carries rework from the
  // earlier form re-splits it two-way: the rework is cleared only by that edit.
  const setQty = (idx, it, key, value) => onItemChange(idx, {
    [key]: value,
    ...(round2(it.reworkQty) > 0 ? { reworkQty: 0 } : {}),
  });

  const qtyField = (idx, it, key, label) => (readOnly
    ? <Typography variant="body2" sx={{ textAlign: { md: 'right' } }}>{narrow ? `${label}: ` : ''}{it[key]}</Typography>
    : (
      <TextField size="small" type="number" value={it[key]} error={!lineBalanced(it)} label={narrow ? label : undefined}
        onChange={(e) => setQty(idx, it, key, e.target.value)}
        // No up/down spinner arrows, and the mouse wheel can't nudge the value.
        onWheel={(e) => e.target.blur()}
        sx={{
          '& input[type=number]': { MozAppearance: 'textfield' },
          '& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
        }}
        inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' }, 'aria-label': `${label} — ${it.itemName}` }} />
    ));

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Header */}
      <Paper elevation={0} sx={{ p: 2.5, ...pfmsCardSx }}>
        <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: 'primary.main' }}>
          <FileText size={18} /> QC Header
        </Typography>
        <Grid container spacing={2}>
          {sourceField ? <Grid item xs={12} sm={5}>{sourceField}</Grid> : null}
          <Grid item xs={6} sm={sourceField ? 2.4 : 4}>
            <DateInputDDMMYYYY label="QC Date" fullWidth value={header.qcDate} disabled={readOnly}
              onChange={(val) => onHeaderChange({ qcDate: val })} />
          </Grid>
          <Grid item xs={6} sm={sourceField ? 2.3 : 4}>
            <TextField label="Checked By" fullWidth value={header.checkedByName} disabled={readOnly}
              onChange={(e) => onHeaderChange({ checkedByName: e.target.value })} />
          </Grid>
          <Grid item xs={12} sm={sourceField ? 2.3 : 4}>
            <TextField label="Prepared By" fullWidth value={header.preparedBy} disabled={readOnly}
              onChange={(e) => onHeaderChange({ preparedBy: e.target.value })} />
          </Grid>
        </Grid>
        {sourceSummary}
      </Paper>

      {/* Inspection */}
      <Paper elevation={0} sx={{ p: 2.5, ...pfmsCardSx }}>
        <Typography sx={{ fontWeight: 700, color: '#b45309', mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <ClipboardCheck size={18} /> Inspection
        </Typography>
        {items.length === 0 ? (
          <Typography variant="body2" color="text.disabled" sx={{ py: 2 }}>{emptyText}</Typography>
        ) : (
          <>
            <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: COLS, gap: 1.5, px: 1, mb: 0.5 }}>
              {HEAD.map((h) => (
                <Typography key={h} variant="caption" sx={{
                  fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.62rem',
                  textAlign: NUMERIC.includes(h) ? 'right' : 'left', pl: h === 'Remark' ? 1.5 : 0,
                }}>{h}</Typography>
              ))}
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {items.map((it, idx) => {
                const bad = !readOnly && !lineBalanced(it);
                const legacy = legacyLineDetail(it);
                return (
                  <Box key={it.grnItemId || idx} data-testid="qc-line" sx={{
                    display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: COLS },
                    gap: { xs: 1, md: 1.5 }, alignItems: 'center', p: { xs: 1.5, md: 0.5 }, px: { md: 1 },
                    borderRadius: '10px', border: { xs: '1px solid', md: bad ? '1px solid' : 'none' }, borderColor: bad ? 'error.main' : 'divider',
                    '&:hover': { bgcolor: alpha('#2563eb', 0.03) },
                  }}>
                    <Box sx={{ minWidth: 0, gridColumn: { xs: '1 / -1', md: 'auto' } }}>
                      <Typography variant="body2" fontWeight={600} noWrap title={it.itemName}>{it.itemName}</Typography>
                      {it.batchNo ? <Typography variant="caption" color="text.disabled" sx={{ display: 'block' }}>Batch {it.batchNo}</Typography> : null}
                      {legacy ? (
                        <Typography variant="caption" data-testid="qc-line-legacy" sx={{ display: 'block', color: round2(it.reworkQty) > 0 && !readOnly ? 'warning.dark' : 'text.secondary' }}>
                          {round2(it.reworkQty) > 0 && !readOnly
                            ? `Earlier form recorded rework ${round2(it.reworkQty)} — enter it as Accepted or Rejected`
                            : `Also recorded: ${legacy}`}
                        </Typography>
                      ) : null}
                    </Box>
                    <Typography variant="body2" color="primary.main" fontWeight={700}>{it.skuCode || '—'}</Typography>
                    <Typography variant="body2" sx={{ textAlign: { md: 'right' }, fontWeight: 700 }}>
                      {narrow ? 'Received: ' : ''}{it.receivedQty}
                    </Typography>
                    {qtyField(idx, it, 'acceptedQty', 'Accepted')}
                    {qtyField(idx, it, 'rejectedQty', 'Rejected')}
                    <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' }, minWidth: 0, pl: { md: 1.5 } }}>
                      {readOnly ? (
                        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{it.qcRemarks || '—'}</Typography>
                      ) : (
                        <TextField size="small" fullWidth placeholder="Remark (optional)" label={narrow ? 'Remark' : undefined}
                          value={it.qcRemarks || ''} onChange={(e) => onItemChange(idx, { qcRemarks: e.target.value })}
                          inputProps={{ maxLength: 500, 'aria-label': `Remark — ${it.itemName}` }} />
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
            {unbalanced.length > 0 && (
              <Alert severity="error" sx={{ mt: 1.5 }} data-testid="qc-balance">
                Accepted + Rejected must equal Received for:{' '}
                {unbalanced.map((it) => `${it.itemName} (${round2(it.acceptedQty)} + ${round2(it.rejectedQty)} ≠ ${round2(it.receivedQty)})`).join(', ')}
              </Alert>
            )}
          </>
        )}
      </Paper>

      {/* A completed / historical QC's overall remark, kept on the record. */}
      {readOnly && header.remarks ? (
        <Typography variant="body2" color="text.secondary"><b>Remarks:</b> {header.remarks}</Typography>
      ) : null}

      {/* Attachment (QC report / photo) — the existing QC attachment */}
      <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={handleUpload} data-testid="qc-attachment-input" />
      <Box>
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 0.75 }}>
          ATTACHMENT (QC report / photo — optional)
        </Typography>
        {doc?.fileUrl ? (
          <Box data-testid="qc-attachment" sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: '10px', bgcolor: '#fff' }}>
            <FileText size={16} />
            <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>{doc.fileName}</Typography>
            <Button size="small" startIcon={<ExternalLink size={13} />} href={fileHref(doc.fileUrl)} target="_blank" rel="noopener">View</Button>
            {!readOnly && <Chip size="small" label="Remove" onDelete={() => onDocChange(null)} onClick={() => onDocChange(null)} deleteIcon={<X size={13} />} />}
          </Box>
        ) : readOnly ? (
          <Typography variant="body2" color="text.disabled">No attachment</Typography>
        ) : (
          <Button variant="outlined" size="small" startIcon={uploading ? <CircularProgress size={14} /> : <Upload size={14} />}
            onClick={() => fileRef.current?.click()} disabled={uploading}>
            Upload PDF / Image
          </Button>
        )}
      </Box>
    </Box>
  );
};

export default QcInspectionForm;
