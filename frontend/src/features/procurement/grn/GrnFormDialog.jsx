import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog, Box, Typography, TextField, Button, IconButton, Divider,
  Grid, Autocomplete, CircularProgress, Paper, Chip, MenuItem,
  Checkbox, FormControlLabel, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  X, Save, PackageCheck, Building2, FileText, Eye, Upload, ExternalLink, ClipboardCheck, Lock,
  Plus, Trash2, ShoppingBag, Ban,
} from 'lucide-react';
import { useSelector } from 'react-redux';
import { useSnackbar } from 'notistack';
import {
  useGetPurchaseOrdersQuery,
  useGetGrnByIdQuery,
  useGetIncomingQcsByGrnQuery,
  useCreateGrnMutation,
  useUpdateGrnMutation,
  useCompleteGrnMutation,
  usePreviewGrnPdfMutation,
} from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { useGetVendorsQuery } from '../../../store/api/vendorApi';
import { useGetSkusQuery } from '../../../store/api/skuApi';
// The RM module's own classification of its SKUs (kind COIL / CIRCLE, derived
// from SKU.itemType). Reused rather than re-deriving "is this a coil?" here, so
// the form and the server can never disagree about what counts as RM.
import { useGetRmOverviewQuery } from '../../../store/api/rmImsApi';
import { fileHref } from '../indents/indentMeta';
import { fmtINR, HOW_ITEM_RECEIVED, howReceivedLabel, isGrnCompleted } from './grnMeta';
import { resolveGrnQcStage } from './grnQcStage';
import GrnQcStatusChip from './GrnQcStatusChip';
import GrnQcSection from './GrnQcSection';
import StatusChip from '../components/StatusChip';
import { pickGrnQc } from '../incoming-qc/qcForm';
import {
  INVENTORY_TYPE_OPTIONS, INVENTORY_TYPE_HELP, inventoryTypeConflicts, inventoryTypeConflictText,
} from './inventoryType';
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

// A W/O PO line has no PO to source ordered/pending qty from — always 0/N-A,
// never fabricated. Only itemName + receivedQty are required (mirrors the
// server's grn.model.js grnItemSchema).
const emptyWopoItem = () => ({
  itemName: '', skuCode: '', skuId: '', unit: 'Pcs',
  orderedQty: 0, previouslyReceivedQty: 0, pendingBefore: 0,
  invoiceQty: '', receivedQty: '', rate: '', batchNo: '', remarks: '',
});

// Read-only qty display — the mobile-only caption keeps each stacked row legible
// once the column headers (desktop-only) are hidden.
const QtyCell = ({ label, value, color }) => (
  <Box sx={{ textAlign: { xs: 'left', md: 'right' } }}>
    <Typography variant="caption" color="text.disabled" sx={{ display: { xs: 'block', md: 'none' } }}>{label}</Typography>
    <Typography variant="body2" sx={{ fontWeight: 700, color: color || 'text.secondary' }}>{value}</Typography>
  </Box>
);

const GrnFormDialog = ({ open, onClose, grn: grnProp = null, presetPo = null }) => {
  const { enqueueSnackbar } = useSnackbar();
  // Editing: load the draft fresh — the server re-derives its "already received /
  // pending" figures against the PO's current state (a list row may be stale).
  const { data: freshGrnRes } = useGetGrnByIdQuery(grnProp?._id, { skip: !open || !grnProp?._id });
  const grn = grnProp ? (freshGrnRes?.data || grnProp) : null;
  // The server assigns the GRN No. when the draft is first saved (POST create).
  // After that first save the dialog stays open on the saved draft so the user
  // keeps seeing its real number, and further saves update it (never re-create).
  const [savedGrn, setSavedGrn] = useState(null);
  const current = grn || savedGrn;
  const isEdit = Boolean(current?._id);
  const isMd = useSelector((s) => s.auth.isRoot);

  // The saved GRN as the server has it now (it moves on as the user completes it,
  // the MD signs it and QC is done — all without leaving this form).
  const { data: savedFreshRes } = useGetGrnByIdQuery(savedGrn?._id, { skip: !open || !savedGrn?._id || Boolean(grnProp) });
  const liveGrn = grnProp ? grn : (savedFreshRes?.data || savedGrn);
  const { data: qcRes } = useGetIncomingQcsByGrnQuery(liveGrn?._id, { skip: !open || !isGrnCompleted(liveGrn) });
  const qcStage = resolveGrnQcStage(liveGrn, pickGrnQc(qcRes?.data || []));
  // Once completed (stock posted) or MD-signed, the GRN is read-only for good —
  // the server refuses edits; here the fields stop accepting them and Save goes.
  const grnLocked = Boolean(liveGrn?._id) && (isGrnCompleted(liveGrn) || liveGrn.approvalStatus === 'MD_APPROVED' || liveGrn.grnStatus === 'CANCELLED');

  const [po, setPo] = useState(null);
  // 'PO' | 'WITHOUT_PO' — chosen only when creating; an existing GRN's mode is
  // fixed by its own isWithoutPo and never switches mid-edit.
  const [mode, setMode] = useState('PO');
  const [wopoVendor, setWopoVendor] = useState(null);
  const [header, setHeader] = useState({
    grnDate: todayStr(), challanNumber: '', invoiceNumber: '', invoiceDate: '',
    vehicleNumber: '', receivedBy: '', preparedBy: '', howItemReceived: 'FULL_MATERIAL_RECEIVED', remarks: '',
    // Inventory Type (required — decides the IMS module) and, for Raw Material,
    // where it landed. Both ride along in buildPayload()'s `...header` spread.
    inventoryType: '', rmReceivedAtLocation: DEFAULT_RECEIVED_AT,
    // Vendor snapshot — only used (and only editable) for a W/O PO GRN; on a
    // PO-backed GRN this always mirrors the PO and is never sent by the form.
    vendorId: '', vendorName: '', vendorGST: '', vendorAddress: '', vendorPhone: '',
  });
  const [items, setItems] = useState([]);
  const [doc, setDoc] = useState(null);
  const fileRef = useRef(null);

  const isWithoutPo = isEdit ? Boolean(current?.isWithoutPo) : mode === 'WITHOUT_PO';

  // Vendor + SKU masters — only needed for the W/O PO manual-entry path.
  const { data: vendorsRes, isLoading: vendorsLoading } = useGetVendorsQuery(
    { limit: 500, sort: 'name' }, { skip: !open || !isWithoutPo },
  );
  const vendorOptions = vendorsRes?.data || [];
  const { data: skusRes } = useGetSkusQuery({ limit: 500, sort: 'name' }, { skip: !open || !isWithoutPo });
  const skuOptions = skusRes?.data || [];

  const applyWopoVendor = (v) => {
    setWopoVendor(v);
    setHeader((h) => ({
      ...h,
      vendorId: v?._id || '', vendorName: v?.name || '',
      vendorGST: v?.gstNo || '', vendorAddress: v?.location || v?.address || '', vendorPhone: v?.phone || '',
    }));
  };

  const handleModeChange = (_e, val) => {
    if (!val || val === mode || isEdit) return;
    setMode(val);
    setPo(null);
    setWopoVendor(null);
    setHeader((h) => ({ ...h, vendorId: '', vendorName: '', vendorGST: '', vendorAddress: '', vendorPhone: '' }));
    setItems(val === 'WITHOUT_PO' ? [emptyWopoItem()] : []);
  };

  const addWopoItem = () => setItems((cur) => [...cur, emptyWopoItem()]);
  const removeWopoItem = (idx) => setItems((cur) => cur.filter((_, i) => i !== idx));

  const [createGrn, { isLoading: creating }] = useCreateGrnMutation();
  const [updateGrn, { isLoading: updating }] = useUpdateGrnMutation();
  const [completeGrn, { isLoading: finalizing }] = useCompleteGrnMutation();
  const [previewGrnPdf, { isLoading: previewing }] = usePreviewGrnPdfMutation();
  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();
  const saving = creating || updating;
  const busy = saving || previewing || uploading || finalizing;
  const [overReceiptConfirmOpen, setOverReceiptConfirmOpen] = useState(false);

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
      setPo(grn.isWithoutPo ? null : { _id: grn.poId, poNumber: grn.poNumber, vendorName: grn.vendorName });
      setMode(grn.isWithoutPo ? 'WITHOUT_PO' : 'PO');
      setWopoVendor(grn.isWithoutPo
        ? { _id: grn.vendorId, name: grn.vendorName, gstNo: grn.vendorGST, location: grn.vendorAddress, phone: grn.vendorPhone }
        : null);
      setHeader({
        grnDate: grn.grnDate ? grn.grnDate.slice(0, 10) : todayStr(),
        challanNumber: grn.challanNumber || '', invoiceNumber: grn.invoiceNumber || '',
        invoiceDate: grn.invoiceDate ? grn.invoiceDate.slice(0, 10) : '',
        vehicleNumber: grn.vehicleNumber || '', receivedBy: grn.receivedBy || '', preparedBy: grn.preparedBy || '',
        howItemReceived: grn.howItemReceived || 'FULL_MATERIAL_RECEIVED', remarks: grn.remarks || '',
        // A draft raised before Inventory Type existed opens with none chosen —
        // its old checkbox is not reinterpreted; the operator picks the type.
        inventoryType: grn.inventoryType || '',
        rmReceivedAtLocation: grn.rmReceivedAtLocation || DEFAULT_RECEIVED_AT,
        vendorId: grn.vendorId || '', vendorName: grn.vendorName || '', vendorGST: grn.vendorGST || '',
        vendorAddress: grn.vendorAddress || '', vendorPhone: grn.vendorPhone || '',
      });
      setDoc(grn.challanDocument?.fileUrl ? { ...grn.challanDocument } : null);
      setItems((grn.items || []).map((it) => ({
        poItemId: it.poItemId, itemName: it.itemName, skuCode: it.skuCode || '', skuId: it.skuId || '',
        unit: it.unit || 'Pcs', orderedQty: it.orderedQty, previouslyReceivedQty: it.previouslyReceivedQty,
        pendingBefore: round2((it.orderedQty || 0) - (it.previouslyReceivedQty || 0)),
        invoiceQty: it.invoiceQty, receivedQty: it.receivedQty, rate: it.rate, batchNo: it.batchNo || '', remarks: it.remarks || '',
      })));
    } else {
      setMode('PO');
      setHeader({
        grnDate: todayStr(), challanNumber: '', invoiceNumber: '', invoiceDate: '', vehicleNumber: '', receivedBy: '', preparedBy: '',
        howItemReceived: 'FULL_MATERIAL_RECEIVED', remarks: '', inventoryType: '', rmReceivedAtLocation: DEFAULT_RECEIVED_AT,
        vendorId: '', vendorName: '', vendorGST: '', vendorAddress: '', vendorPhone: '',
      });
      setDoc(null);
      setWopoVendor(null);
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
  // state when an over-pending (extra) receipt has no remark of its own. Not
  // applicable to a W/O PO GRN — there is no "pending" to receive extra against.
  const extraNeedsRemark = !isWithoutPo && validItems.some((it) => round2(it.receivedQty) > round2(it.pendingBefore) && !it.remarks?.trim());
  const remarksRequired = extraNeedsRemark && !header.remarks.trim();

  const validateForm = () => {
    if (isWithoutPo) {
      if (!header.vendorName?.trim()) { enqueueSnackbar('Select a vendor first', { variant: 'warning' }); return false; }
    } else if (!isEdit && !po?._id) { enqueueSnackbar('Select an eligible PO first', { variant: 'warning' }); return false; }
    if (validItems.length === 0) { enqueueSnackbar('Enter a received quantity on at least one item', { variant: 'warning' }); return false; }
    if (isWithoutPo) {
      const noName = validItems.find((it) => !it.itemName?.trim());
      if (noName) { enqueueSnackbar('Every item needs a description', { variant: 'warning' }); return false; }
    } else {
      // Extra-receive needs remarks (mirror backend rule). No "pending qty" exists
      // for a W/O PO line, so this never applies there.
      const extra = validItems.find((it) => round2(it.receivedQty) > round2(it.pendingBefore));
      if (extra && !(extra.remarks?.trim() || header.remarks.trim())) {
        enqueueSnackbar(`"${extra.itemName}" exceeds pending qty — add remarks for the extra receipt`, { variant: 'warning' }); return false;
      }
    }
    // Coil / Circle must be identifiable by batch. Checked against the received
    // lines only — a row with nothing received is not a receipt. Independent of
    // "Add to RM Stock": a Coil GRN needs the batch either way.
    const noBatch = validItems.find(batchMissing);
    if (noBatch) {
      enqueueSnackbar(`Batch Number is required for ${rmKindOf(noBatch)}.`, { variant: 'warning' });
      return false;
    }
    // Inventory Type: required, and one per GRN (the server enforces both too).
    if (!header.inventoryType) {
      enqueueSnackbar('Select the Inventory Type for the received material', { variant: 'warning' }); return false;
    }
    const conflicts = inventoryTypeConflicts(validItems, header.inventoryType, (it) => Boolean(rmKindOf(it)));
    if (conflicts.length) {
      enqueueSnackbar(inventoryTypeConflictText(conflicts, header.inventoryType), { variant: 'warning' }); return false;
    }
    // An RM receipt must say where the material landed (its stock posts there).
    if (header.inventoryType === 'RM' && !header.rmReceivedAtLocation) {
      enqueueSnackbar('Choose a Received At location for the Raw Material', { variant: 'warning' }); return false;
    }
    return true;
  };

  const buildPayload = () => ({
    ...header,
    isWithoutPo,
    // Received At belongs to Raw Material only; Consumable & Packaging posts at the GRN's store.
    rmReceivedAtLocation: header.inventoryType === 'RM' ? header.rmReceivedAtLocation : null,
    invoiceDate: header.invoiceDate || undefined,
    challanDocument: doc ? { fileName: doc.fileName, fileUrl: doc.fileUrl, fileType: doc.fileType } : undefined,
    items: validItems.map((it) => (isWithoutPo ? {
      itemName: it.itemName.trim(), skuCode: it.skuCode?.trim() || '', skuId: it.skuId || undefined,
      unit: it.unit || 'Pcs', invoiceQty: round2(it.invoiceQty || it.receivedQty), receivedQty: round2(it.receivedQty),
      rate: round2(it.rate), batchNo: it.batchNo?.trim() || '', remarks: it.remarks?.trim() || '',
    } : {
      poItemId: it.poItemId, itemName: it.itemName.trim(), skuCode: it.skuCode?.trim() || '',
      skuId: it.skuId || undefined, unit: it.unit || 'Pcs',
      orderedQty: it.orderedQty, previouslyReceivedQty: it.previouslyReceivedQty,
      invoiceQty: round2(it.invoiceQty), receivedQty: round2(it.receivedQty),
      rate: round2(it.rate), batchNo: it.batchNo?.trim() || '', remarks: it.remarks?.trim() || '',
    })),
  });

  // `stay`: save without closing (used before "Complete GRN + QC" posts stock).
  const handleSubmit = async ({ stay = false } = {}) => {
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
        if (stay) return true;
      } else {
        const res = await createGrn(isWithoutPo ? payload : { ...payload, poId: po._id }).unwrap();
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

  // ── Save & Finalize GRN — chains the SAME create/update + complete() calls
  // the two-step flow already uses (this form, then the separate "Complete &
  // Post Stock" dialog on the GRN detail page); it does not duplicate or
  // shortcut any of that logic. complete() still independently re-validates
  // everything server-side (over-receipt, batch numbers, inventory-type
  // conflicts, atomic posting lock) against the PO's live state — nothing
  // here lets the client's numbers decide what actually posts to inventory.
  const runSaveAndFinalize = async (allowOverReceipt) => {
    if (!validateForm()) return;
    const payload = buildPayload();
    let savedId;
    try {
      if (isEdit) {
        const res = await updateGrn({ id: current._id, ...payload }).unwrap();
        savedId = (res?.data || current)._id;
      } else {
        const res = await createGrn(isWithoutPo ? payload : { ...payload, poId: po._id }).unwrap();
        savedId = res?.data?._id;
        setSavedGrn(res?.data || null);
      }
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save GRN', { variant: 'error' });
      return;
    }
    try {
      await completeGrn({ id: savedId, allowOverReceipt, remarks: header.remarks?.trim() || undefined }).unwrap();
      enqueueSnackbar('GRN saved and finalized — stock posted', { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      // The GRN is already saved as a draft at this point — only finalization
      // failed (e.g. the PO's live pending quantity shifted between opening
      // this form and completing it, because another GRN against the same PO
      // completed in between). Never silently drop the user's entry: leave
      // the saved draft in place so they can retry here or finish it from the
      // GRN detail page's own Complete & Post Stock dialog.
      enqueueSnackbar(err?.data?.message || 'Saved as a draft, but finalizing failed — complete it from the GRN detail page', { variant: 'error' });
    }
  };

  const handleSaveAndFinalize = () => {
    if (!validateForm()) return;
    // No "pending qty" exists on a W/O PO line, so over-receipt never applies.
    const hasExtra = !isWithoutPo && validItems.some((it) => round2(it.receivedQty) > round2(it.pendingBefore));
    if (hasExtra) { setOverReceiptConfirmOpen(true); return; }
    runSaveAndFinalize(false);
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
          {/* Incoming QC status — always in view; details in the Incoming QC panel below. */}
          <Box data-testid="grn-form-qc-badge" title={qcStage.desc}
            sx={{
              ml: 1, px: 1.25, py: 0.5, borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.35)', bgcolor: 'rgba(255,255,255,0.12)',
              display: { xs: 'none', sm: 'flex' }, flexDirection: 'column',
            }}>
            <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)', lineHeight: 1.2 }}>
              Incoming QC
            </Typography>
            <Typography sx={{ fontWeight: 800, fontSize: '0.85rem', color: '#fff', lineHeight: 1.3 }}>{qcStage.label}</Typography>
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(Boolean(savedGrn), savedGrn)} sx={{ color: '#fff' }}><X size={20} /></IconButton>
      </Box>

      {/* Body */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, bgcolor: PFMS.surfaceAlt }}>
        {/* The GRN part. Read-only once completed / signed (the server refuses edits). */}
        <Box data-testid="grn-form-grn-part" aria-disabled={grnLocked || undefined}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, ...(grnLocked ? { pointerEvents: 'none', opacity: 0.8 } : {}) }}>
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: 'primary.main' }}>
            <FileText size={18} /> GRN Header
          </Typography>
          {/* Receipt type — fixed once a GRN exists; chosen only when creating one. */}
          {!isEdit && !presetPo && (
            <ToggleButtonGroup
              exclusive size="small" value={mode} onChange={handleModeChange}
              sx={{ mb: 2.5 }} data-testid="grn-mode-toggle"
            >
              <ToggleButton value="PO" sx={{ textTransform: 'none', gap: 0.75, px: 1.5 }}>
                <ShoppingBag size={15} /> Against Purchase Order
              </ToggleButton>
              <ToggleButton value="WITHOUT_PO" sx={{ textTransform: 'none', gap: 0.75, px: 1.5 }}>
                <Ban size={15} /> Without PO (W/O PO)
              </ToggleButton>
            </ToggleButtonGroup>
          )}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={5}>
              {isWithoutPo ? (
                isEdit ? (
                  <TextField label="Vendor" fullWidth value={header.vendorName || ''} disabled />
                ) : (
                  <Autocomplete
                    options={vendorOptions}
                    loading={vendorsLoading}
                    value={wopoVendor}
                    getOptionLabel={(o) => (o?.name || '')}
                    isOptionEqualToValue={(o, v) => o._id === v._id}
                    onChange={(_e, v) => applyWopoVendor(v)}
                    noOptionsText="No matching vendor"
                    renderInput={(params) => (
                      <TextField {...params} label="Vendor *" placeholder="Select from Vendor Master"
                        InputProps={{ ...params.InputProps, endAdornment: (<>{vendorsLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
                    )}
                  />
                )
              ) : isEdit || presetPo ? (
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

            {/* ── Inventory Type (replaces the "Add to RM Stock" checkbox) ──
                Required, one per GRN. It decides where the stock lands when the
                GRN is completed: Raw Material → RM IMS at "Received At";
                Consumable & Packaging → the GRN's store, as before. */}
            <Grid item xs={12} sm={6}>
              <TextField
                label="Inventory Type *" select fullWidth required
                value={header.inventoryType}
                onChange={(e) => setHeader((h) => ({ ...h, inventoryType: e.target.value }))}
                helperText={INVENTORY_TYPE_HELP}
                error={!header.inventoryType && validItems.length > 0 && Boolean(po)}
                inputProps={{ 'data-testid': 'grn-inventory-type' }}
              >
                {INVENTORY_TYPE_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
              </TextField>
            </Grid>
            {header.inventoryType === 'RM' && (
              <Grid item xs={6} sm={3}>
                <TextField
                  label="Received At *" select fullWidth
                  value={header.rmReceivedAtLocation}
                  onChange={(e) => setHeader((h) => ({ ...h, rmReceivedAtLocation: e.target.value }))}
                  helperText="Where the Raw Material physically landed — its RM stock posts here."
                >
                  {RECEIVED_AT_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                </TextField>
              </Grid>
            )}
          </Grid>

          {isWithoutPo && wopoVendor ? (
            <Box sx={{ mt: 2, p: 1.5, borderRadius: '10px', bgcolor: alpha('#2563eb', 0.04), display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'center' }}>
              <Building2 size={16} color="#1d4ed8" />
              <Typography variant="caption" fontWeight={700}>{header.vendorName || '—'}</Typography>
              <Typography variant="caption" color="text.secondary">GST: {header.vendorGST || '—'}</Typography>
              <Typography variant="caption" color="text.secondary">{header.vendorAddress || '—'}</Typography>
              <Typography variant="caption" color="text.secondary">📞 {header.vendorPhone || '—'}</Typography>
              <Chip size="small" color="warning" variant="outlined" label="Without PO" sx={{ fontWeight: 700 }} />
            </Box>
          ) : po ? (
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
          <Typography sx={{ fontWeight: 700, color: '#b45309', mb: 1.5, display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><PackageCheck size={18} /> Material Receipt</Box>
            {isWithoutPo && !grnLocked && (
              <Button size="small" startIcon={<Plus size={14} />} onClick={addWopoItem} sx={{ textTransform: 'none' }}>
                Add Item
              </Button>
            )}
          </Typography>
          {isWithoutPo ? (
            <>
              <Box sx={{
                display: { xs: 'none', md: 'grid' },
                gridTemplateColumns: '1.6fr 0.9fr 1fr 0.9fr 0.95fr 1.05fr 0.4fr',
                gap: 1, px: 1, mb: 0.5,
              }}>
                {['Description / SKU', 'Unit', 'Received Qty', 'Rate', 'Batch No', 'Remarks', ''].map((h, i) => (
                  <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.62rem' }}>{h}</Typography>
                ))}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {items.map((it, idx) => {
                  const skuMatch = skuOptions.find((s) => s._id === it.skuId) || null;
                  return (
                    <Box key={idx} sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: '1.6fr 0.9fr 1fr 0.9fr 0.95fr 1.05fr 0.4fr' },
                      gap: 1, alignItems: 'flex-start', p: { xs: 1.5, md: 0.5 }, px: { md: 1 },
                      borderRadius: '10px', border: { xs: '1px solid', md: 'none' }, borderColor: 'divider',
                      '&:hover': { bgcolor: alpha('#2563eb', 0.03) },
                    }}>
                      <Autocomplete
                        freeSolo
                        options={skuOptions}
                        value={skuMatch || it.itemName}
                        getOptionLabel={(o) => (typeof o === 'string' ? o : (o?.name || ''))}
                        isOptionEqualToValue={(o, v) => o._id === v?._id}
                        onChange={(_e, v) => {
                          if (v && typeof v === 'object') setItem(idx, { itemName: v.name, skuCode: v.code || '', skuId: v._id, unit: v.unit || 'Pcs' });
                        }}
                        onInputChange={(_e, v, reason) => { if (reason === 'input') setItem(idx, { itemName: v, skuId: '' }); }}
                        renderInput={(params) => (
                          <TextField {...params} size="small" label="Description *" placeholder="Pick a SKU or type a name" />
                        )}
                      />
                      <TextField size="small" label="Unit" value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })} />
                      <TextField size="small" type="number" label="Received Qty" value={it.receivedQty}
                        onChange={(e) => setItem(idx, { receivedQty: e.target.value })}
                        inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} />
                      <TextField size="small" type="number" label="Rate" value={it.rate}
                        onChange={(e) => setItem(idx, { rate: e.target.value })}
                        inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} />
                      <TextField size="small"
                        label={rmKindOf(it) ? 'Batch No *' : 'Batch No'}
                        placeholder={rmKindOf(it) ? `required for ${rmKindOf(it)}` : 'optional'}
                        value={it.batchNo}
                        error={batchMissing(it) && round2(it.receivedQty) > 0}
                        onChange={(e) => setItem(idx, { batchNo: e.target.value })} />
                      <TextField size="small" label="Remarks" value={it.remarks} onChange={(e) => setItem(idx, { remarks: e.target.value })} />
                      <IconButton size="small" onClick={() => removeWopoItem(idx)} disabled={items.length <= 1} title="Remove item">
                        <Trash2 size={15} />
                      </IconButton>
                    </Box>
                  );
                })}
              </Box>
              <Divider sx={{ my: 2 }} />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
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
          ) : items.length === 0 ? (
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

        {/* Incoming QC — directly under the GRN, on this same form. Before the GRN
            exists there is nothing to inspect; once saved, the real QC form. */}
        {!liveGrn?._id ? (
          <Paper elevation={0} sx={SECTION} data-testid="grn-form-qc-placeholder">
            <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, color: 'primary.main', mb: 1 }}>
              <ClipboardCheck size={18} /> Incoming QC
            </Typography>
            <Typography variant="body2" color="text.secondary">Save GRN first to enter QC details.</Typography>
          </Paper>
        ) : (
          <Box>
            <Box data-testid="grn-form-saved-summary" sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
              <Typography variant="body2" fontWeight={800}>{liveGrn.grnNumber}</Typography>
              <StatusChip status={liveGrn.grnStatus} />
              <GrnQcStatusChip stage={qcStage} />
              {grnLocked && <Chip size="small" variant="outlined" icon={<Lock size={12} />} label="GRN read-only" sx={{ fontWeight: 700 }} />}
            </Box>
            <GrnQcSection grn={liveGrn} isMd={isMd} prepareGrn={grnLocked ? undefined : () => handleSubmit({ stay: true })} />
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Divider />
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#fff' }}>
        <Typography variant="caption" color="text.secondary">
          {grnLocked
            ? 'GRN completed — read-only'
            : `${validItems.length} item(s) · received ${totals.received} · ${fmtINR(totals.value)} · stock posts on Complete`}
          {' · '}Incoming QC: <b>{qcStage.label}</b>
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {/* Second arg = the draft created in this session, so the caller can open it. */}
          <Button variant="outlined" onClick={() => onClose?.(Boolean(savedGrn), savedGrn)} disabled={busy}>
            {savedGrn ? 'Close' : 'Cancel'}
          </Button>
          {!grnLocked && (
            <Button variant="outlined" startIcon={previewing ? <CircularProgress size={16} color="inherit" /> : <Eye size={16} />}
              onClick={handlePreview} disabled={busy}>
              Preview PDF
            </Button>
          )}
          {!grnLocked && (
            <Button variant="outlined" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
              onClick={() => handleSubmit()} disabled={busy}>
              Save as Draft
            </Button>
          )}
          {!grnLocked && (
            <Button variant="contained" color="success" startIcon={finalizing ? <CircularProgress size={16} color="inherit" /> : <PackageCheck size={16} />}
              onClick={handleSaveAndFinalize} disabled={busy}>
              Save &amp; Finalize GRN
            </Button>
          )}
        </Box>
      </Box>

      {/* Over-receipt consent — mirrors the same checkbox/confirmation the
          separate "Complete & Post Stock" dialog already asks for; the server
          re-validates this against the PO's live pending quantity regardless. */}
      <Dialog open={overReceiptConfirmOpen} onClose={() => setOverReceiptConfirmOpen(false)} maxWidth="xs" fullWidth>
        <Box sx={{ p: 3 }}>
          <Typography sx={{ fontWeight: 800, mb: 1 }}>Allow Over-Receipt?</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            One or more items receive more than their pending quantity. Finalizing will post the extra quantity to inventory — confirm this is intentional before continuing.
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button onClick={() => setOverReceiptConfirmOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="contained" color="success" disabled={busy}
              startIcon={finalizing ? <CircularProgress size={16} color="inherit" /> : <PackageCheck size={16} />}
              onClick={() => { setOverReceiptConfirmOpen(false); runSaveAndFinalize(true); }}>
              Allow &amp; Finalize
            </Button>
          </Box>
        </Box>
      </Dialog>

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
        approveLabel="Save as Draft"
      />
    </Dialog>
  );
};

export default GrnFormDialog;
