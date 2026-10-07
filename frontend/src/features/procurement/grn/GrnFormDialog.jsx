import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog, Box, Typography, TextField, Button, IconButton, Divider,
  Grid, Autocomplete, CircularProgress, Paper, Chip, MenuItem,
  Checkbox, FormControlLabel,
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
// The RM module's own classification of its SKUs (kind COIL / CIRCLE, derived
// from SKU.itemType). Reused rather than re-deriving "is this a coil?" here, so
// the form and the server can never disagree about what counts as RM.
import { useGetRmOverviewQuery } from '../../../store/api/rmImsApi';
import { fileHref } from '../indents/indentMeta';
import { fmtINR, HOW_ITEM_RECEIVED, howReceivedLabel } from './grnMeta';
import PdfPreviewSubmitModal from '../common/PdfPreviewSubmitModal';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { PFMS, pfmsCardSx } from '../pfmsTheme';
// The SAME two values and default the RM Stock In screen uses, so "Received At"
// has one definition across both modules.
import { RECEIVED_AT_OPTIONS, DEFAULT_RECEIVED_AT } from '../../rm-ims/receivedAt';

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
  const isEdit = Boolean(grn?._id);

  const [po, setPo] = useState(null);
  const [header, setHeader] = useState({
    grnDate: todayStr(), challanNumber: '', invoiceNumber: '', invoiceDate: '',
    vehicleNumber: '', receivedBy: '', preparedBy: '', howItemReceived: 'FULL_MATERIAL_RECEIVED', remarks: '',
    // Raw Material opt-in and the location it lands at. Both ride along in
    // buildPayload()'s `...header` spread, so create, update and preview all
    // carry them without a second code path.
    addToRmStock: false, rmReceivedAtLocation: DEFAULT_RECEIVED_AT,
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
    if (grn) {
      setPo({ _id: grn.poId, poNumber: grn.poNumber, vendorName: grn.vendorName });
      setHeader({
        grnDate: grn.grnDate ? grn.grnDate.slice(0, 10) : todayStr(),
        challanNumber: grn.challanNumber || '', invoiceNumber: grn.invoiceNumber || '',
        invoiceDate: grn.invoiceDate ? grn.invoiceDate.slice(0, 10) : '',
        vehicleNumber: grn.vehicleNumber || '', receivedBy: grn.receivedBy || '', preparedBy: grn.preparedBy || '',
        howItemReceived: grn.howItemReceived || 'FULL_MATERIAL_RECEIVED', remarks: grn.remarks || '',
        addToRmStock: !!grn.addToRmStock,
        rmReceivedAtLocation: grn.rmReceivedAtLocation || DEFAULT_RECEIVED_AT,
      });
      setDoc(grn.challanDocument?.fileUrl ? { ...grn.challanDocument } : null);
      setItems((grn.items || []).map((it) => ({
        poItemId: it.poItemId, itemName: it.itemName, skuCode: it.skuCode || '', skuId: it.skuId || '',
        unit: it.unit || 'Pcs', orderedQty: it.orderedQty, previouslyReceivedQty: it.previouslyReceivedQty,
        pendingBefore: round2((it.orderedQty || 0) - (it.previouslyReceivedQty || 0)),
        invoiceQty: it.invoiceQty, receivedQty: it.receivedQty, rate: it.rate, batchNo: it.batchNo || '', remarks: it.remarks || '',
      })));
    } else {
      setHeader({ grnDate: todayStr(), challanNumber: '', invoiceNumber: '', invoiceDate: '', vehicleNumber: '', receivedBy: '', preparedBy: '', howItemReceived: 'FULL_MATERIAL_RECEIVED', remarks: '', addToRmStock: false, rmReceivedAtLocation: DEFAULT_RECEIVED_AT });
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

  // ── Coil / Circle need a batch number ──────────────────────────────────────
  // Only these two. Every other purchased item keeps Batch No optional. The
  // server enforces the same rule from the SKU master; this is the operator-
  // facing half so the asterisk and the block appear before they hit Save.
  const { data: rmRes } = useGetRmOverviewQuery({}, { skip: !open });
  const rmKindBySku = useMemo(() => {
    const m = new Map();
    (rmRes?.data || []).forEach((r) => m.set(String(r.skuId), r.kind === 'CIRCLE' ? 'Circle' : 'Coil'));
    return m;
  }, [rmRes]);
  /** 'Coil' | 'Circle' | '' — '' means "not RM", so leave the row alone. */
  const rmKindOf = (it) => rmKindBySku.get(String(it.skuId || '')) || '';
  const batchMissing = (it) => !!rmKindOf(it) && !it.batchNo?.trim();

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
    // Coil / Circle must be identifiable by batch. Checked against the received
    // lines only — a row with nothing received is not a receipt. Independent of
    // "Add to RM Stock": a Coil GRN needs the batch either way.
    const noBatch = validItems.find(batchMissing);
    if (noBatch) {
      enqueueSnackbar(`Batch Number is required for ${rmKindOf(noBatch)}.`, { variant: 'warning' });
      return false;
    }
    // Mirrors the server rule: opting a GRN in to RM stock without saying where
    // the material landed would leave the movement with no location.
    if (header.addToRmStock && !header.rmReceivedAtLocation) {
      enqueueSnackbar('Choose a Received At location for "Add to RM Stock"', { variant: 'warning' }); return false;
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
        await updateGrn({ id: grn._id, ...payload }).unwrap();
        enqueueSnackbar('GRN updated', { variant: 'success' });
      } else {
        const res = await createGrn({ ...payload, poId: po._id }).unwrap();
        enqueueSnackbar(`GRN ${res?.data?.grnNumber || ''} created (draft)`, { variant: 'success' });
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
        grnNumber: grn?.grnNumber || undefined,
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
              {isEdit ? `Edit ${grn.grnNumber}` : 'New Goods Receipt Note'}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)' }}>
              Step 1.8 · Receive material — stock posts on Complete
            </Typography>
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

            {/* ── Raw Material opt-in ──────────────────────────────────────
                Off unless the operator ticks it. Unticked, Raw Material lines
                are still received against the PO — they simply post no stock.
                Every other item type is unaffected either way.

                Received At is a SEPARATE decision and is always shown: it
                records where the material physically landed, which is true of
                the receipt whether or not the stock is posted. It used to be
                hidden until the box was ticked, which wrongly implied the two
                were one choice and threw away a location the operator had
                already picked. */}
            <Grid item xs={12} sm={6}>
              <FormControlLabel
                control={(
                  <Checkbox
                    checked={header.addToRmStock}
                    onChange={(e) => setHeader((h) => ({ ...h, addToRmStock: e.target.checked }))}
                  />
                )}
                label={<Typography sx={{ fontWeight: 700, fontSize: '0.88rem' }}>Add to RM Stock</Typography>}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 4, mt: -0.5 }}>
                When checked, the received Raw Material quantity is added to RM stock as this GRN is completed.
              </Typography>
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField
                label="Received At *" select fullWidth
                value={header.rmReceivedAtLocation}
                onChange={(e) => setHeader((h) => ({ ...h, rmReceivedAtLocation: e.target.value }))}
                helperText="Where the material physically landed. Recorded whether or not RM stock is posted."
              >
                {RECEIVED_AT_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
            </Grid>
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
                gridTemplateColumns: '1.7fr 0.7fr 0.75fr 0.95fr 0.85fr 1.05fr 1.05fr 1.12fr 1.08fr',
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
                      gridTemplateColumns: { xs: '1fr', md: '1.7fr 0.7fr 0.75fr 0.95fr 0.85fr 1.05fr 1.05fr 1.12fr 1.08fr' },
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
                      {/* Required for Coil and Circle only — every other item
                          keeps the original optional field untouched. */}
                      <TextField size="small"
                        label={rmKindOf(it) ? 'Batch No *' : 'Batch No'}
                        placeholder={rmKindOf(it) ? `required for ${rmKindOf(it)}` : 'optional'}
                        value={it.batchNo}
                        error={batchMissing(it) && round2(it.receivedQty) > 0}
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
          <Button variant="outlined" onClick={() => onClose?.(false)} disabled={saving || previewing || uploading}>Cancel</Button>
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
        docNumber={isEdit ? grn?.grnNumber : ''}
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
