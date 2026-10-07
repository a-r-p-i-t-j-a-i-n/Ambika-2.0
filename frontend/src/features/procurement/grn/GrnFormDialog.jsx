import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog, Box, Typography, TextField, Button, IconButton, Divider,
  Grid, Autocomplete, CircularProgress, Paper, Chip, MenuItem,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { X, Save, PackageCheck, Building2, FileText, Eye, Upload, ExternalLink } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetPurchaseOrdersQuery,
  useCreateGrnMutation,
  useUpdateGrnMutation,
  usePreviewGrnPdfMutation,
} from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { fileHref } from '../indents/indentMeta';
import { fmtINR, HOW_ITEM_RECEIVED, howReceivedLabel } from './grnMeta';
import PdfPreviewSubmitModal from '../common/PdfPreviewSubmitModal';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { PFMS, pfmsCardSx } from '../pfmsTheme';

const ACCEPT = '.pdf,image/*';

/**
 * Create / edit a Goods Receipt Note (Step 1.8).
 * Only POs that are READY_FOR_GRN AND have PAYMENT_COMPLETED are selectable —
 * no direct/standalone GRN. Lines + quantities auto-load from the PO.
 */
const todayStr = () => new Date().toISOString().slice(0, 10);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const SECTION = { p: 2.5, ...pfmsCardSx };

// Read-only qty display — the mobile-only caption keeps each stacked row legible
// once the column headers (desktop-only) are hidden.
const QtyCell = ({ label, value, color }) => (
  <Box sx={{ textAlign: { xs: 'left', md: 'right' } }}>
    <Typography variant="caption" color="text.disabled" sx={{ display: { xs: 'block', md: 'none' } }}>{label}</Typography>
    <Typography variant="body2" sx={{ fontWeight: 700, color: color || 'text.secondary' }}>{value}</Typography>
  </Box>
);

const GrnFormDialog = ({ open, onClose, grn = null, presetPo = null }) => {
  const { enqueueSnackbar } = useSnackbar();
  // The server assigns the GRN No. when the draft is first saved (POST create).
  // After that first save the dialog stays open on the saved draft so the user
  // keeps seeing its real number, and further saves update it (never re-create).
  const [savedGrn, setSavedGrn] = useState(null);
  const current = grn || savedGrn;
  const isEdit = Boolean(current?._id);

  const [po, setPo] = useState(null);
  const [header, setHeader] = useState({
    grnDate: todayStr(), challanNumber: '', invoiceNumber: '', invoiceDate: '',
    vehicleNumber: '', receivedBy: '', preparedBy: '', howItemReceived: 'FULL_MATERIAL_RECEIVED', remarks: '',
  });
  const [items, setItems] = useState([]);
  const [doc, setDoc] = useState(null);
  const fileRef = useRef(null);

  const [createGrn, { isLoading: creating }] = useCreateGrnMutation();
  const [updateGrn, { isLoading: updating }] = useUpdateGrnMutation();
  const [previewGrnPdf, { isLoading: previewing }] = usePreviewGrnPdfMutation();
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

  // PDF preview-before-submit state.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewError, setPreviewError] = useState('');

  // READY_FOR_GRN POs whose PI step is settled — payment completed OR PI marked
  // Not Required (comma list → server $in). We drop fully-received below.
  const { data: posRes, isLoading: posLoading } = useGetPurchaseOrdersQuery(
    { limit: 200, sort: '-releasedAt', followUpStatus: 'READY_FOR_GRN', piStatus: 'PAYMENT_COMPLETED,PI_NOT_REQUIRED' },
    { skip: !open || isEdit },
  );
  // Material delivery must be confirmed (Final Material Date present). A PO that
  // already started receiving (PARTIAL_RECEIVED) keeps showing for back-compat.
  const poOptions = (posRes?.data || []).filter((p) =>
    p.poStatus !== 'FULLY_RECEIVED' && p.poStatus !== 'CANCELLED'
    && (Boolean(p.finalMaterialDate) || p.poStatus === 'PARTIAL_RECEIVED'));

  const linesFromPo = (p) => (p?.items || [])
    .map((it) => {
      const pending = round2((it.quantity || 0) - (it.receivedQty || 0));
      return {
        // For JSL, itemName is the "Grade Width Finish" label that should be
        // shown as the Item Description; itemDescription only holds the raw
        // indent item name and is not used for display.
        poItemId: it._id, itemName: it.itemName, skuCode: it.skuCode || '', skuId: it.skuId || '',
        unit: it.unit || 'Pcs', orderedQty: it.quantity || 0, previouslyReceivedQty: it.receivedQty || 0,
        pendingBefore: pending, invoiceQty: pending, receivedQty: pending, rate: it.rate || 0, batchNo: '', remarks: '',
      };
    })
    .filter((l) => l.pendingBefore > 0);

  useEffect(() => {
    if (!open) return;
    setSavedGrn(null);
    if (grn) {
      setPo({ _id: grn.poId, poNumber: grn.poNumber, vendorName: grn.vendorName });
      setHeader({
        grnDate: grn.grnDate ? grn.grnDate.slice(0, 10) : todayStr(),
        challanNumber: grn.challanNumber || '', invoiceNumber: grn.invoiceNumber || '',
        invoiceDate: grn.invoiceDate ? grn.invoiceDate.slice(0, 10) : '',
        vehicleNumber: grn.vehicleNumber || '', receivedBy: grn.receivedBy || '', preparedBy: grn.preparedBy || '',
        howItemReceived: grn.howItemReceived || 'FULL_MATERIAL_RECEIVED', remarks: grn.remarks || '',
      });
      setDoc(grn.challanDocument?.fileUrl ? { ...grn.challanDocument } : null);
      setItems((grn.items || []).map((it) => ({
        poItemId: it.poItemId, itemName: it.itemName, skuCode: it.skuCode || '', skuId: it.skuId || '',
        unit: it.unit || 'Pcs', orderedQty: it.orderedQty, previouslyReceivedQty: it.previouslyReceivedQty,
        pendingBefore: round2((it.orderedQty || 0) - (it.previouslyReceivedQty || 0)),
        invoiceQty: it.invoiceQty, receivedQty: it.receivedQty, rate: it.rate, batchNo: it.batchNo || '', remarks: it.remarks || '',
      })));
    } else {
      setHeader({ grnDate: todayStr(), challanNumber: '', invoiceNumber: '', invoiceDate: '', vehicleNumber: '', receivedBy: '', preparedBy: '', howItemReceived: 'FULL_MATERIAL_RECEIVED', remarks: '' });
      setDoc(null);
      if (presetPo) { setPo(presetPo); setItems(linesFromPo(presetPo)); }
      else { setPo(null); setItems([]); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, grn, presetPo]);

  const applyPo = (p) => { setPo(p); setItems(p ? linesFromPo(p) : []); };
  const setItem = (idx, patch) => setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const totals = useMemo(() => items.reduce((acc, it) => {
    const recv = round2(it.receivedQty);
    return {
      invoice: round2(acc.invoice + round2(it.invoiceQty)),
      received: round2(acc.received + recv),
      value: round2(acc.value + recv * round2(it.rate)),
    };
  }, { invoice: 0, received: 0, value: 0 }), [items]);

  const validItems = items.filter((it) => round2(it.receivedQty) > 0);

  // Highlight the header Remarks field — and escalate it to a required/warning
  // state when an over-pending (extra) receipt has no remark of its own.
  const extraNeedsRemark = validItems.some((it) => round2(it.receivedQty) > round2(it.pendingBefore) && !it.remarks?.trim());
  const remarksRequired = extraNeedsRemark && !header.remarks.trim();

  const validateForm = () => {
    if (!isEdit && !po?._id) { enqueueSnackbar('Select an eligible PO first', { variant: 'warning' }); return false; }
    if (validItems.length === 0) { enqueueSnackbar('Enter a received quantity on at least one item', { variant: 'warning' }); return false; }
    // Extra-receive needs remarks (mirror backend rule).
    const extra = validItems.find((it) => round2(it.receivedQty) > round2(it.pendingBefore));
    if (extra && !(extra.remarks?.trim() || header.remarks.trim())) {
      enqueueSnackbar(`"${extra.itemName}" exceeds pending qty — add remarks for the extra receipt`, { variant: 'warning' }); return false;
    }
    return true;
  };

  const buildPayload = () => ({
    ...header,
    invoiceDate: header.invoiceDate || undefined,
    challanDocument: doc ? { fileName: doc.fileName, fileUrl: doc.fileUrl, fileType: doc.fileType } : undefined,
    items: validItems.map((it) => ({
      poItemId: it.poItemId, itemName: it.itemName.trim(), skuCode: it.skuCode?.trim() || '',
      skuId: it.skuId || undefined, unit: it.unit || 'Pcs',
      orderedQty: it.orderedQty, previouslyReceivedQty: it.previouslyReceivedQty,
      invoiceQty: round2(it.invoiceQty), receivedQty: round2(it.receivedQty),
      rate: round2(it.rate), batchNo: it.batchNo?.trim() || '', remarks: it.remarks?.trim() || '',
    })),
  });

  const handleSubmit = async () => {
    if (!validateForm()) return false;
    const payload = buildPayload();
    try {
      if (isEdit) {
        const res = await updateGrn({ id: current._id, ...payload }).unwrap();
        if (savedGrn) {
          // Draft created in this session — stay on it so its GRN No. stays in view.
          setSavedGrn(res?.data || savedGrn);
          enqueueSnackbar(`Draft ${current.grnNumber} saved`, { variant: 'success' });
          return true;
        }
        enqueueSnackbar('GRN updated', { variant: 'success' });
      } else {
        const res = await createGrn({ ...payload, poId: po._id }).unwrap();
        setSavedGrn(res?.data || null);
        enqueueSnackbar(`GRN ${res?.data?.grnNumber || ''} created (draft)`, { variant: 'success' });
        return true;
      }
      onClose?.(true);
      return true;
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save GRN', { variant: 'error' });
      return false;
    }
  };

  // ── Preview PDF (no save): render the GRN from current form data on the server. ──
  const revokePreview = () => setPreviewUrl((u) => { if (u) URL.revokeObjectURL(u); return ''; });

  const handlePreview = async () => {
    if (!validateForm()) return;
    setPreviewError('');
    revokePreview();
    setPreviewOpen(true);
    try {
      const blob = await previewGrnPdf({
        ...buildPayload(),
        poId: po?._id || undefined,
        poNumber: po?.poNumber || undefined,
        grnNumber: current?.grnNumber || undefined,
      }).unwrap();
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      setPreviewError(err?.data?.message || 'Failed to generate preview');
    }
  };

  const closePreview = () => { setPreviewOpen(false); setPreviewError(''); revokePreview(); };

  // Both Save Draft and Approve & Submit persist the GRN as a draft — the
  // separate "Complete & Post Stock" action remains the finalize step.
  const confirmFromPreview = async () => { const ok = await handleSubmit(); if (ok) closePreview(); };

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: { xs: '100%', md: '92vh' }, display: 'flex', flexDirection: 'column', borderRadius: { xs: 0, md: '8px' }, overflow: 'hidden' } }}>
      {/* Header */}
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)', color: '#fff' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <PackageCheck size={22} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: '#fff' }}>
              {grn ? 'Edit GRN' : 'Create GRN'}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)' }}>
              Step 1.8 · Receive material — stock posts on Complete
            </Typography>
          </Box>
          {/* System-generated identifier — read-only, styled apart from form fields. */}
          <Box
            title={current?.grnNumber ? 'System-generated GRN No. — stays the same through draft edits and completion' : 'The GRN No. is generated by the system when this GRN is first saved'}
            sx={{
              ml: { xs: 0.5, sm: 1.5 }, px: 1.25, py: 0.5, borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.35)', bgcolor: 'rgba(255,255,255,0.12)',
              display: 'flex', flexDirection: 'column', minWidth: 0,
            }}>
            <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)', lineHeight: 1.2 }}>
              GRN No.
            </Typography>
            {current?.grnNumber ? (
              <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', color: '#fff', lineHeight: 1.3, overflowWrap: 'anywhere' }}>
                {current.grnNumber}
              </Typography>
            ) : (
              <Typography sx={{ fontWeight: 600, fontSize: '0.8rem', fontStyle: 'italic', color: 'rgba(255,255,255,0.8)', lineHeight: 1.3 }}>
                Assigned on save
              </Typography>
            )}
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(false)} sx={{ color: '#fff' }}><X size={20} /></IconButton>
      </Box>

      {/* Body */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, bgcolor: PFMS.surfaceAlt }}>
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: 'primary.main' }}>
            <FileText size={18} /> GRN Header
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={5}>
              {isEdit || presetPo ? (
                <TextField label="PO Number" fullWidth value={po?.poNumber || ''} disabled />
              ) : (
                <Autocomplete
                  options={poOptions}
                  loading={posLoading}
                  value={po}
                  getOptionLabel={(o) => (o ? `${o.poNumber} — ${o.vendorName}` : '')}
                  isOptionEqualToValue={(o, v) => o._id === v._id}
                  onChange={(_e, v) => applyPo(v)}
                  noOptionsText="No PO is ready for GRN (needs READY_FOR_GRN + payment completed)"
                  renderInput={(params) => (
                    <TextField {...params} label="Purchase Order *" placeholder="READY_FOR_GRN + Payment Completed only"
                      InputProps={{ ...params.InputProps, endAdornment: (<>{posLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
                  )}
                />
              )}
            </Grid>
            <Grid item xs={6} sm={3.5}>
              <DateInputDDMMYYYY label="GRN Date" fullWidth value={header.grnDate}
                onChange={(val) => setHeader((h) => ({ ...h, grnDate: val }))} />
            </Grid>
            <Grid item xs={6} sm={3.5}>
              <TextField label="How Item Received" select fullWidth value={header.howItemReceived}
                onChange={(e) => setHeader((h) => ({ ...h, howItemReceived: e.target.value }))}>
                {HOW_ITEM_RECEIVED.map((v) => <MenuItem key={v} value={v}>{howReceivedLabel(v)}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={6} sm={3}><TextField label="Challan No" fullWidth value={header.challanNumber} onChange={(e) => setHeader((h) => ({ ...h, challanNumber: e.target.value }))} /></Grid>
            <Grid item xs={6} sm={3}><TextField label="Invoice No" fullWidth value={header.invoiceNumber} onChange={(e) => setHeader((h) => ({ ...h, invoiceNumber: e.target.value }))} /></Grid>
            <Grid item xs={6} sm={3}><DateInputDDMMYYYY label="Invoice Date" fullWidth value={header.invoiceDate} onChange={(val) => setHeader((h) => ({ ...h, invoiceDate: val }))} /></Grid>
            <Grid item xs={6} sm={3}><TextField label="Vehicle No" fullWidth value={header.vehicleNumber} onChange={(e) => setHeader((h) => ({ ...h, vehicleNumber: e.target.value }))} /></Grid>
            <Grid item xs={6} sm={3}><TextField label="Received By" fullWidth value={header.receivedBy} onChange={(e) => setHeader((h) => ({ ...h, receivedBy: e.target.value }))} /></Grid>
            <Grid item xs={6} sm={3}><TextField label="Prepared By" fullWidth value={header.preparedBy} onChange={(e) => setHeader((h) => ({ ...h, preparedBy: e.target.value }))} /></Grid>
          </Grid>

          {po ? (
            <Box sx={{ mt: 2, p: 1.5, borderRadius: '10px', bgcolor: alpha('#2563eb', 0.04), display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'center' }}>
              <Building2 size={16} color="#1d4ed8" />
              <Typography variant="caption" fontWeight={700}>{po.vendorName || grn?.vendorName || '—'}</Typography>
              {(po.piNumber || grn?.piNumber) && <Chip size="small" variant="outlined" label={`PI ${po.piNumber || grn?.piNumber}`} sx={{ fontWeight: 700 }} />}
              {(po.indentNumber || grn?.indentNumber) && <Chip size="small" variant="outlined" label={`Indent ${po.indentNumber || grn?.indentNumber}`} sx={{ fontWeight: 700 }} />}
            </Box>
          ) : null}
        </Paper>

        {/* Items */}
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ fontWeight: 700, color: '#b45309', mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <PackageCheck size={18} /> Material Receipt
          </Typography>
          {items.length === 0 ? (
            <Typography variant="body2" color="text.disabled" sx={{ py: 2 }}>
              {po ? 'Nothing pending to receive on this PO.' : 'Select an eligible PO to load its items.'}
            </Typography>
          ) : (
            <>
              <Box sx={{
                display: { xs: 'none', md: 'grid' },
                gridTemplateColumns: '1.7fr 0.7fr 0.75fr 0.95fr 0.85fr 1.05fr 1.05fr 0.9fr 1.3fr',
                gap: 1, px: 1, mb: 0.5,
              }}>
                {['Description', 'SKU', 'Ordered Qty', 'Already Received', 'Pending Qty', 'Invoice Qty', 'Received Qty', 'Batch No', 'Remarks'].map((h, i) => (
                  <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.62rem' }}>{h}</Typography>
                ))}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {items.map((it, idx) => {
                  // Pending Qty is fixed (orderedQty − alreadyReceived), computed from the
                  // PO — read-only and never recalculated off the in-progress receivedQty.
                  const pendingBefore = round2(it.pendingBefore);
                  const extra = round2(it.receivedQty) > pendingBefore;
                  const extraQty = extra ? round2(it.receivedQty - pendingBefore) : 0;
                  return (
                    <Box key={idx} sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: '1.7fr 0.7fr 0.75fr 0.95fr 0.85fr 1.05fr 1.05fr 0.9fr 1.3fr' },
                      gap: 1, alignItems: 'flex-start', p: { xs: 1.5, md: 0.5 }, px: { md: 1 },
                      borderRadius: '10px', border: { xs: '1px solid', md: 'none' }, borderColor: 'divider',
                      '&:hover': { bgcolor: alpha('#2563eb', 0.03) },
                    }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>{it.itemName}</Typography>
                        <Typography variant="caption" color="text.disabled">{it.unit}</Typography>
                      </Box>
                      <Typography variant="body2" color="primary.main" fontWeight={700}>{it.skuCode || '—'}</Typography>
                      <QtyCell label="Ordered Qty" value={it.orderedQty} />
                      <QtyCell label="Already Received" value={it.previouslyReceivedQty} />
                      <QtyCell label="Pending Qty" value={pendingBefore} color={pendingBefore > 0 ? '#b45309' : '#0f766e'} />
                      <TextField size="small" type="number" label="Invoice Qty" value={it.invoiceQty}
                        onChange={(e) => setItem(idx, { invoiceQty: e.target.value })}
                        helperText={`Pending: ${pendingBefore}`}
                        inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} />
                      <TextField size="small" type="number" label="Received Qty" value={it.receivedQty} error={extra}
                        onChange={(e) => setItem(idx, { receivedQty: e.target.value })}
                        helperText={extra ? `Pending: ${pendingBefore} · Extra ${extraQty}` : `Pending: ${pendingBefore}`}
                        inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} />
                      <TextField size="small" label="Batch No" placeholder="optional" value={it.batchNo}
                        onChange={(e) => setItem(idx, { batchNo: e.target.value })} />
                      <TextField size="small" label="Remarks" placeholder={extra ? 'required (extra)' : 'optional'} value={it.remarks}
                        onChange={(e) => setItem(idx, { remarks: e.target.value })} error={extra && !it.remarks?.trim() && !header.remarks.trim()} />
                    </Box>
                  );
                })}
              </Box>
              <Divider sx={{ my: 2 }} />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={700}>INVOICE QTY</Typography>
                  <Typography fontWeight={700}>{totals.invoice}</Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={700}>RECEIVED QTY</Typography>
                  <Typography variant="h6" fontWeight={800} color="primary.dark">{totals.received}</Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={700}>RECEIPT VALUE</Typography>
                  <Typography variant="h6" fontWeight={800}>{fmtINR(totals.value)}</Typography>
                </Box>
              </Box>
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
          error={remarksRequired}
          placeholder="Add any notes about this receipt…"
          helperText={remarksRequired
            ? 'Remarks are required when receiving more than the pending quantity'
            : 'Required for extra receipts'}
          sx={{
            bgcolor: remarksRequired ? alpha('#b45309', 0.06) : alpha('#2563eb', 0.05),
            borderRadius: '12px',
            '& .MuiOutlinedInput-root fieldset': {
              borderColor: remarksRequired ? '#b45309' : '#2563eb',
              borderWidth: 2,
            },
            '& .MuiInputLabel-root': {
              fontWeight: 700,
              color: remarksRequired ? '#b45309' : 'primary.main',
            },
          }} />

        {/* Attachment (challan / invoice copy / photo) */}
        <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={handleUpload} />
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 0.75 }}>
            ATTACHMENT (challan / invoice copy — optional)
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

      {/* Footer */}
      <Divider />
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#fff' }}>
        <Typography variant="caption" color="text.secondary">
          {validItems.length} item(s) · received {totals.received} · {fmtINR(totals.value)} · stock posts on Complete
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button variant="outlined" onClick={() => onClose?.(Boolean(savedGrn))} disabled={saving || previewing || uploading}>
            {savedGrn ? 'Close' : 'Cancel'}
          </Button>
          <Button variant="outlined" startIcon={previewing ? <CircularProgress size={16} color="inherit" /> : <Eye size={16} />}
            onClick={handlePreview} disabled={saving || previewing || uploading}>
            Preview PDF
          </Button>
          <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
            onClick={handleSubmit} disabled={saving || previewing || uploading}>
            {isEdit ? 'Save Changes' : 'Create GRN'}
          </Button>
        </Box>
      </Box>

      <PdfPreviewSubmitModal
        open={previewOpen}
        title="Goods Receipt Note"
        docNumber={current?.grnNumber || ''}
        pdfUrl={previewUrl}
        loading={previewing}
        error={previewError}
        saving={saving}
        onClose={closePreview}
        onSaveDraft={confirmFromPreview}
        onApproveSubmit={confirmFromPreview}
        approveLabel={isEdit ? 'Save Changes' : 'Create GRN'}
      />
    </Dialog>
  );
};

export default GrnFormDialog;
