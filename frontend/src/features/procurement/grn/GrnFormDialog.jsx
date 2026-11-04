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
import { useSnackbar } from 'notistack';
import {
  useGetPurchaseOrdersQuery,
  useGetGrnByIdQuery,
  useGetIncomingQcsByGrnQuery,
  useCreateGrnMutation,
  useUpdateGrnMutation,
  useCorrectGrnMutation,
  useGetGrnChangeCheckQuery,
  usePreviewGrnPdfMutation,
} from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { useGetVendorsQuery } from '../../../store/api/vendorApi';
import { useGetSkusQuery, useGetSkuLookupQuery } from '../../../store/api/skuApi';
import {
  conversionRule, purchaseUnitOf, reversedRuleWarning, sameUnit, skuConversion, stockEquivalent,
} from '../../../utils/unitConversion';
// The RM module's own classification of its SKUs (kind COIL / CIRCLE, derived
// from SKU.itemType). Reused rather than re-deriving "is this a coil?" here, so
// the form and the server can never disagree about what counts as RM.
import { useGetRmOverviewQuery } from '../../../store/api/rmImsApi';
import { fileHref } from '../indents/indentMeta';
import { fmtINR, HOW_ITEM_RECEIVED, howReceivedLabel, isGrnCompleted } from './grnMeta';
import { DEFAULT_HOW_ITEM_RECEIVED, lineReceiptType } from './grnReceiptType';
import { resolveGrnQcStage } from './grnQcStage';
import GrnQcStatusChip from './GrnQcStatusChip';
import { GrnQcSections } from './GrnQcSection';
import StatusChip, { TONES } from '../components/StatusChip';
import { pickGrnQc } from '../incoming-qc/qcForm';
import { destinationOf, routingProblemOf, destinationText, DESTINATION_META } from './inventoryDestination';
import PdfPreviewSubmitModal from '../common/PdfPreviewSubmitModal';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { PFMS, pfmsCardSx } from '../pfmsTheme';
// The SAME two values and default the RM Stock In screen uses, so "Received At"
// has one definition across both modules.
import { RECEIVED_AT_OPTIONS } from '../../rm-ims/receivedAt';

const ACCEPT = '.pdf,image/*';

/**
 * Create / edit a Goods Receipt Note (Step 1.8).
 * Only POs that are READY_FOR_GRN with an approved / paid / not-required PI are selectable —
 * no direct/standalone GRN. Lines + quantities auto-load from the PO.
 */
const todayStr = () => new Date().toISOString().slice(0, 10);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const SECTION = { p: 2, ...pfmsCardSx };
// The read-only GRN No. / Incoming QC boxes in the dialog header.
const META_PILL_SX = { px: 1.25, py: 0.5, borderRadius: '8px', border: `1px solid ${PFMS.line}`, bgcolor: PFMS.surfaceAlt, display: 'flex', flexDirection: 'column', minWidth: 0 };
const META_LABEL_SX = { fontSize: '0.62rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: PFMS.sub, lineHeight: 1.2 };

// A W/O PO line has no PO to source ordered/pending qty from — always 0/N-A,
// never fabricated. Only itemName + receivedQty are required (mirrors the
// server's grn.model.js grnItemSchema).
const emptyWopoItem = () => ({
  itemName: '', skuCode: '', skuId: '', unit: 'Pcs',
  orderedQty: 0, previouslyReceivedQty: 0, pendingBefore: 0,
  invoiceQty: '', receivedQty: '', rate: '', batchNo: '', remarks: '',
  howItemReceived: DEFAULT_HOW_ITEM_RECEIVED,
});

// Row grids — minmax(0, …) so every row lines up with its header row and a
// long value can never push the table wider than the dialog. The Material
// Receipt Type column keeps 140px so its longest word always fits.
const PO_ROW_COLS = 'minmax(0,1.5fr) minmax(0,0.65fr) minmax(0,0.65fr) minmax(0,0.8fr) minmax(0,0.75fr) minmax(0,0.95fr) minmax(0,0.95fr) minmax(140px,1.45fr) minmax(0,1fr) minmax(0,1fr)';
const WOPO_ROW_COLS = 'minmax(0,1.5fr) minmax(0,0.7fr) minmax(0,0.9fr) minmax(0,0.85fr) minmax(140px,1.4fr) minmax(0,0.95fr) minmax(0,1fr) minmax(0,0.4fr)';

// Material Receipt Type of ONE material row — the same options and labels the
// GRN header dropdown used. The selected label wraps instead of being cut off
// in a narrow column.
const ReceiptTypeSelect = ({ value, onChange, error, lineKey }) => (
  <TextField size="small" select label="Material Receipt Type" value={value || ''}
    onChange={(e) => onChange(e.target.value)} error={error} helperText={error ? 'Required' : undefined}
    SelectProps={{ SelectDisplayProps: { 'data-testid': 'grn-line-receipt-type', 'data-line': lineKey, style: { whiteSpace: 'normal', lineHeight: 1.3, fontSize: '0.85rem' } } }}>
    {HOW_ITEM_RECEIVED.map((v) => <MenuItem key={v} value={v}>{howReceivedLabel(v)}</MenuItem>)}
  </TextField>
);

// A later step resting on a completed GRN, as the correction panel names it.
const LATER_STEP_LABEL = { QC: 'Incoming QC', INVOICE: 'Vendor Invoice' };
const laterStepText = (s) => (s.type === 'STOCK'
  ? `stock already posted (${s.count} entr${s.count === 1 ? 'y' : 'ies'})`
  : `${LATER_STEP_LABEL[s.type] || s.type} ${s.number || ''}`.trim());

// Read-only qty display — the mobile-only caption keeps each stacked row legible
// once the column headers (desktop-only) are hidden.
const QtyCell = ({ label, value, color }) => (
  <Box sx={{ textAlign: { xs: 'left', md: 'right' } }}>
    <Typography variant="caption" color="text.disabled" sx={{ display: { xs: 'block', md: 'none' } }}>{label}</Typography>
    <Typography variant="body2" sx={{ fontWeight: 700, color: color || 'text.secondary' }}>{value}</Typography>
  </Box>
);

// `correct`: opened to correct a COMPLETED GRN (procurement.editGrn) rather than view it.
const GrnFormDialog = ({ open, onClose, grn: grnProp = null, presetPo = null, correct = false }) => {
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

  // The saved GRN as the server has it now (it moves on as the user completes it,
  // and QC is done — all without leaving this form).
  const { data: savedFreshRes } = useGetGrnByIdQuery(savedGrn?._id, { skip: !open || !savedGrn?._id || Boolean(grnProp) });
  const liveGrn = grnProp ? grn : (savedFreshRes?.data || savedGrn);
  const { data: qcRes } = useGetIncomingQcsByGrnQuery(liveGrn?._id, { skip: !open || !isGrnCompleted(liveGrn) });
  const qcStage = resolveGrnQcStage(liveGrn, pickGrnQc(qcRes?.data || []));
  // Once completed or MD-signed, the GRN is read-only for good —
  // the server refuses edits; here the fields stop accepting them and Save goes.
  // Correcting a completed GRN: its header always; its items only while no
  // later step (QC / invoice / stock) rests on them — the server decides, the
  // change check says which.
  // Correction mode is decided when the form OPENS. A draft completed from this very
  // form (Complete GRN + QC) stays in QC mode so the QC can be finished there, instead
  // of flipping into "Editing a completed GRN" because the parent's `correct` followed
  // the live record.
  const openKey = open ? (grnProp?._id || 'new') : null;
  const [opened, setOpened] = useState({ key: null, completed: false });
  if (opened.key !== openKey) setOpened({ key: openKey, completed: Boolean(grnProp && isGrnCompleted(grnProp)) });
  const startedCompleted = opened.key === openKey ? opened.completed : Boolean(grnProp && isGrnCompleted(grnProp));
  const correcting = Boolean(correct) && startedCompleted && isGrnCompleted(liveGrn);
  const { data: checkRes } = useGetGrnChangeCheckQuery(liveGrn?._id, { skip: !open || !correcting, refetchOnMountOrArgChange: true });
  const changeCheck = checkRes?.data || null;
  const itemsLocked = correcting && (!changeCheck || changeCheck.itemsLocked);
  const [reason, setReason] = useState('');
  const grnLocked = !correcting && Boolean(liveGrn?._id) && (isGrnCompleted(liveGrn) || liveGrn.approvalStatus === 'MD_APPROVED' || liveGrn.grnStatus === 'CANCELLED');

  // One or more compatible (same-vendor) POs — a GRN can now cover several at once.
  const [pos, setPos] = useState([]);
  // 'PO' | 'WITHOUT_PO' — chosen only when creating; an existing GRN's mode is
  // fixed by its own isWithoutPo and never switches mid-edit.
  const [mode, setMode] = useState('PO');
  const [wopoVendor, setWopoVendor] = useState(null);
  const [header, setHeader] = useState({
    grnDate: todayStr(), challanNumber: '', invoiceNumber: '', invoiceDate: '',
    vehicleNumber: '', receivedBy: '', preparedBy: '', remarks: '',
    // Where the Raw Material landed — asked for (and required) only when a Raw
    // Material line is received, and never pre-filled: it must be chosen.
    // Every line's inventory destination comes from its SKU master Item Type.
    rmReceivedAtLocation: '',
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
    setPos([]);
    setWopoVendor(null);
    setHeader((h) => ({ ...h, vendorId: '', vendorName: '', vendorGST: '', vendorAddress: '', vendorPhone: '' }));
    setItems(val === 'WITHOUT_PO' ? [emptyWopoItem()] : []);
  };

  const addWopoItem = () => setItems((cur) => [...cur, emptyWopoItem()]);
  const removeWopoItem = (idx) => setItems((cur) => cur.filter((_, i) => i !== idx));

  const [createGrn, { isLoading: creating }] = useCreateGrnMutation();
  const [updateGrn, { isLoading: updating }] = useUpdateGrnMutation();
  const [previewGrnPdf, { isLoading: previewing }] = usePreviewGrnPdfMutation();
  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();
  const saving = creating || updating;
  const [correctGrn, { isLoading: correctSaving }] = useCorrectGrnMutation();
  const busy = saving || previewing || uploading || correctSaving;
  // 'correct' — the save the over-receipt consent is for.
  const [overReceiptFor, setOverReceiptFor] = useState(null);
  // The footer node the Incoming QC panel renders its buttons into.
  const [footerSlot, setFooterSlot] = useState(null);

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

  // READY_FOR_GRN POs whose PI step is settled — no PI (PI is optional), PI
  // approved (the advance and its MD approval never hold GRN back), paid, or
  // marked Not Required: the server's PI_SETTLED_FOR_GRN (comma list → server
  // $in). We drop fully-received below.
  const { data: posRes, isLoading: posLoading } = useGetPurchaseOrdersQuery(
    { limit: 200, sort: '-releasedAt', followUpStatus: 'READY_FOR_GRN', piStatus: 'NOT_RECEIVED,PI_APPROVED,READY_FOR_ADVANCE_PAYMENT,PAYMENT_COMPLETED,PI_NOT_REQUIRED' },
    { skip: !open || isEdit },
  );
  // Material delivery must be confirmed (Final Material Date present). A PO that
  // already started receiving (PARTIAL_RECEIVED) keeps showing for back-compat.
  const poOptions = (posRes?.data || []).filter((p) =>
    p.poStatus !== 'FULLY_RECEIVED' && p.poStatus !== 'CANCELLED'
    && (Boolean(p.finalMaterialDate) || p.poStatus === 'PARTIAL_RECEIVED'));

  // Lines for ONE PO, tagged with that PO's own identity so a multi-PO GRN
  // never loses which line came from where.
  const linesFromOnePo = (p) => (p?.items || [])
    .map((it) => {
      const pending = round2((it.quantity || 0) - (it.receivedQty || 0));
      return {
        // For JSL, itemName is the "Grade Width Finish" label that should be
        // shown as the Item Description; itemDescription only holds the raw
        // indent item name and is not used for display.
        poItemId: it._id, poId: p._id, poNumber: p.poNumber,
        itemName: it.itemName, skuCode: it.skuCode || '', skuId: it.skuId || '',
        unit: it.unit || 'Pcs', orderedQty: it.quantity || 0, previouslyReceivedQty: it.receivedQty || 0,
        pendingBefore: pending, invoiceQty: pending, receivedQty: pending, rate: it.rate || 0, batchNo: '', remarks: '',
        howItemReceived: DEFAULT_HOW_ITEM_RECEIVED,
        allowOverReceipt: false,
      };
    })
    .filter((l) => l.pendingBefore > 0);

  // Lines across every selected PO, concatenated in selection order.
  const linesFromPos = (list) => (list || []).flatMap((p) => linesFromOnePo(p));

  useEffect(() => {
    if (!open) return;
    setSavedGrn(null);
    setReason('');
    if (grn) {
      // A multi-PO GRN carries poIds/poNumbers; a legacy single-PO GRN only has
      // the primary poId/poNumber — both resolve to the same shape here.
      const grnPoIds = grn.poIds?.length ? grn.poIds : (grn.poId ? [grn.poId] : []);
      const grnPoNumbers = grn.poNumbers?.length ? grn.poNumbers : (grn.poNumber ? [grn.poNumber] : []);
      setPos(grn.isWithoutPo ? [] : grnPoIds.map((id, i) => ({ _id: id, poNumber: grnPoNumbers[i] || grn.poNumber, vendorName: grn.vendorName })));
      setMode(grn.isWithoutPo ? 'WITHOUT_PO' : 'PO');
      setWopoVendor(grn.isWithoutPo
        ? { _id: grn.vendorId, name: grn.vendorName, gstNo: grn.vendorGST, location: grn.vendorAddress, phone: grn.vendorPhone }
        : null);
      setHeader({
        grnDate: grn.grnDate ? grn.grnDate.slice(0, 10) : todayStr(),
        challanNumber: grn.challanNumber || '', invoiceNumber: grn.invoiceNumber || '',
        invoiceDate: grn.invoiceDate ? grn.invoiceDate.slice(0, 10) : '',
        vehicleNumber: grn.vehicleNumber || '', receivedBy: grn.receivedBy || '', preparedBy: grn.preparedBy || '',
        remarks: grn.remarks || '',
        rmReceivedAtLocation: grn.rmReceivedAtLocation || '',
        vendorId: grn.vendorId || '', vendorName: grn.vendorName || '', vendorGST: grn.vendorGST || '',
        vendorAddress: grn.vendorAddress || '', vendorPhone: grn.vendorPhone || '',
      });
      setDoc(grn.challanDocument?.fileUrl ? { ...grn.challanDocument } : null);
      setItems((grn.items || []).map((it) => ({
        _id: it._id, poItemId: it.poItemId, poId: it.poId || grn.poId, poNumber: it.poNumber || grn.poNumber,
        itemName: it.itemName, skuCode: it.skuCode || '', skuId: it.skuId || '',
        unit: it.unit || 'Pcs', orderedQty: it.orderedQty, previouslyReceivedQty: it.previouslyReceivedQty,
        pendingBefore: round2((it.orderedQty || 0) - (it.previouslyReceivedQty || 0)),
        invoiceQty: it.invoiceQty, receivedQty: it.receivedQty, rate: it.rate, batchNo: it.batchNo || '', remarks: it.remarks || '',
        // The line's own type; a draft saved before the type moved onto lines
        // shows its header value on every row (and saves it per line).
        howItemReceived: lineReceiptType(it, grn) || DEFAULT_HOW_ITEM_RECEIVED,
        // Saved consent; setItem/buildPayload drop it while the line is not over pending.
        allowOverReceipt: it.allowOverReceipt === true,
      })));
    } else {
      setMode('PO');
      setHeader({
        grnDate: todayStr(), challanNumber: '', invoiceNumber: '', invoiceDate: '', vehicleNumber: '', receivedBy: '', preparedBy: '',
        remarks: '', rmReceivedAtLocation: '',
        vendorId: '', vendorName: '', vendorGST: '', vendorAddress: '', vendorPhone: '',
      });
      setDoc(null);
      setWopoVendor(null);
      if (presetPo) { setPos([presetPo]); setItems(linesFromOnePo(presetPo)); }
      else { setPos([]); setItems([]); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, grn, presetPo]);

  // Changing the PO selection rebuilds the rows. A row whose PO line is still
  // selected keeps the Material Receipt Type chosen for it — matched by its own
  // PO + PO line, never by position, so one SKU's choice can't land on another.
  const applyPos = (list) => {
    setPos(list || []);
    setItems((cur) => {
      const typeByLine = new Map(cur.map((it) => [`${it.poId}|${it.poItemId}`, it.howItemReceived]));
      return linesFromPos(list).map((l) => {
        const kept = typeByLine.get(`${l.poId}|${l.poItemId}`);
        return kept ? { ...l, howItemReceived: kept } : l;
      });
    });
  };
  // Over-receipt consent only lives while the line exceeds its pending qty: the
  // moment Received Qty drops back within it the tick is cleared, so a later
  // increase must be confirmed afresh.
  const isOver = (it) => round2(it.receivedQty) > round2(it.pendingBefore);
  const setItem = (idx, patch) => setItems((cur) => cur.map((it, i) => {
    if (i !== idx) return it;
    const next = { ...it, ...patch };
    return isOver(next) ? next : { ...next, allowOverReceipt: false };
  }));

  const totals = useMemo(() => items.reduce((acc, it) => {
    const recv = round2(it.receivedQty);
    return {
      invoice: round2(acc.invoice + round2(it.invoiceQty)),
      received: round2(acc.received + recv),
      value: round2(acc.value + recv * round2(it.rate)),
    };
  }, { invoice: 0, received: 0, value: 0 }), [items]);

  const validItems = items.filter((it) => round2(it.receivedQty) > 0);

  // Group PO-sourced rows by their own PO, keeping the flat index for edits —
  // only rendered with a visible header when there's more than one PO.
  const itemGroups = useMemo(() => {
    const map = new Map();
    items.forEach((it, idx) => {
      const key = it.poId || it.poNumber || '—';
      if (!map.has(key)) map.set(key, { poNumber: it.poNumber || '—', rows: [] });
      map.get(key).rows.push({ it, idx });
    });
    return [...map.values()];
  }, [items]);

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

  // ── Inventory destination per line (display; the server decides) ───────────
  // Item Types of the lines' SKUs, so each row can show where its stock will
  // land before the GRN is saved. W/O PO picks already carry their Item Type.
  const lineSkuIds = useMemo(() => [...new Set(items.map((it) => String(it.skuId || '')).filter(Boolean))].sort(), [items]);
  const { data: lineSkusRes } = useGetSkuLookupQuery(
    { ids: lineSkuIds.join(','), limit: 2000 }, { skip: !open || !lineSkuIds.length },
  );
  const itemTypeBySku = useMemo(() => {
    const m = new Map();
    [...(lineSkusRes?.data || []), ...(skusRes?.data || [])].forEach((s) => s?._id && m.set(String(s._id), s.itemType));
    return m;
  }, [lineSkusRes, skusRes]);
  const itemTypeOf = (it) => itemTypeBySku.get(String(it.skuId || '')) || '';
  // Purchase unit → stock unit (display; the server stamps and freezes it):
  // "1 BOX = 25 PCS · stocks as 125 PCS" under a line received in BOX.
  const skuById = useMemo(() => {
    const m = new Map();
    [...(lineSkusRes?.data || []), ...(skusRes?.data || [])].forEach((s) => s?._id && m.set(String(s._id), s));
    return m;
  }, [lineSkusRes, skusRes]);
  const conversionHint = (it) => {
    const sku = skuById.get(String(it.skuId || ''));
    const rule = conversionRule(sku);
    if (!rule) return null;
    const eq = stockEquivalent(sku, it.unit, it.receivedQty);
    const c = skuConversion(sku);
    const reversed = reversedRuleWarning(sku);
    if (reversed) {
      return (
        <Typography variant="caption" data-testid="grn-line-conversion" sx={{ display: 'block', fontWeight: 700, color: '#b91c1c' }}>
          {reversed}
        </Typography>
      );
    }
    const compatible = !!eq || sameUnit(it.unit, c.stockUnit);
    return (
      <Typography variant="caption" data-testid="grn-line-conversion" data-line={`${it.poNumber || ''}|${it.skuCode || it.itemName}`}
        sx={{ display: 'block', fontWeight: 700, color: compatible ? '#0f766e' : '#b91c1c' }}>
        {compatible
          ? `${rule}${eq ? ` · stocks as ${eq.qty} ${eq.unit}` : ''}`
          : `${rule} — ${it.unit || 'this unit'} cannot be converted; use ${c.purchaseUnit} or ${c.stockUnit}`}
      </Typography>
    );
  };
  const isRmLine = (it) => !!rmKindOf(it) || destinationOf(itemTypeOf(it)) === 'RM_IMS';
  const hasRmLine = validItems.some(isRmLine);
  /** Destination chip for one row: where it goes, or why it cannot be received. */
  const destinationTag = (it) => {
    const t = itemTypeOf(it);
    const problem = routingProblemOf(t);
    const dest = destinationOf(t) || (rmKindOf(it) ? 'RM_IMS' : null);
    if (!problem && !dest) return null;
    const where = dest === 'RM_IMS' ? (header.rmReceivedAtLocation || 'Received At?') : 'MAIN';
    return (
      <Chip size="small" variant="outlined" data-testid="grn-line-destination"
        label={problem || `→ ${destinationText(dest, where)}`}
        color={problem ? 'error' : 'default'}
        sx={{ mt: 0.5, height: 20, fontSize: '0.68rem', fontWeight: 700, maxWidth: '100%',
          ...(problem ? {} : { color: DESTINATION_META[dest].color, borderColor: DESTINATION_META[dest].color }) }} />
    );
  };
  const batchMissing = (it) => !!rmKindOf(it) && !it.batchNo?.trim();

  // Highlight the header Remarks field — and escalate it to a required/warning
  // state when an over-pending (extra) receipt has no remark of its own. Not
  // applicable to a W/O PO GRN — there is no "pending" to receive extra against.
  const extraNeedsRemark = !isWithoutPo && validItems.some((it) => round2(it.receivedQty) > round2(it.pendingBefore) && !it.remarks?.trim());
  const remarksRequired = extraNeedsRemark && !header.remarks.trim();

  const validateForm = () => {
    if (isWithoutPo) {
      if (!header.vendorName?.trim()) { enqueueSnackbar('Select a vendor first', { variant: 'warning' }); return false; }
    } else if (!isEdit && pos.length === 0) { enqueueSnackbar('Select at least one eligible PO', { variant: 'warning' }); return false; }
    if (validItems.length === 0) { enqueueSnackbar('Enter a received quantity on at least one item', { variant: 'warning' }); return false; }
    if (isWithoutPo) {
      const noName = validItems.find((it) => !it.itemName?.trim());
      if (noName) { enqueueSnackbar('Every item needs a description', { variant: 'warning' }); return false; }
      // A free-typed (not picked from the SKU list) item is allowed on a draft;
      // complete() (server-side) requires every line to resolve to a real SKU.
    } else {
      // Extra-receive needs remarks (mirror backend rule). No "pending qty" exists
      // for a W/O PO line, so this never applies there.
      const extra = validItems.find((it) => round2(it.receivedQty) > round2(it.pendingBefore));
      if (extra && !(extra.remarks?.trim() || header.remarks.trim())) {
        enqueueSnackbar(`"${extra.itemName}" exceeds pending qty — add remarks for the extra receipt`, { variant: 'warning' }); return false;
      }
      const unconfirmed = validItems.find((it) => isOver(it) && !it.allowOverReceipt);
      if (unconfirmed) {
        enqueueSnackbar(`"${unconfirmed.itemName}" exceeds pending qty by ${round2(unconfirmed.receivedQty - unconfirmed.pendingBefore)} — tick Allow Over-Receipt on that line or reduce Received Qty`, { variant: 'warning' }); return false;
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
    // Every received row carries its own Material Receipt Type.
    const noReceiptType = validItems.find((it) => !it.howItemReceived);
    if (noReceiptType) {
      const sku = noReceiptType.skuCode ? ` (${noReceiptType.skuCode})` : '';
      enqueueSnackbar(`Select the Material Receipt Type for "${noReceiptType.itemName || 'item'}"${sku}`, { variant: 'warning' });
      return false;
    }
    // Lines the SKU master says cannot be received (the server refuses them too).
    const blocked = validItems.find((it) => routingProblemOf(itemTypeOf(it)));
    if (blocked) {
      enqueueSnackbar(`"${blocked.itemName}": ${routingProblemOf(itemTypeOf(blocked))}. Set its received qty to 0.`, { variant: 'warning' }); return false;
    }
    // Raw Material must say where it landed (its stock posts there) — chosen, never assumed.
    if (hasRmLine && !header.rmReceivedAtLocation) {
      enqueueSnackbar('Select Received At — this GRN has Raw Material lines', { variant: 'warning' }); return false;
    }
    return true;
  };

  const buildPayload = () => ({
    ...header,
    isWithoutPo,
    // Received At belongs to Raw Material only; every other line posts at the GRN's store.
    rmReceivedAtLocation: hasRmLine ? header.rmReceivedAtLocation : null,
    invoiceDate: header.invoiceDate || undefined,
    challanDocument: doc ? { fileName: doc.fileName, fileUrl: doc.fileUrl, fileType: doc.fileType } : undefined,
    // A correction sends every stored line (a 0-qty line too) so unchanged
    // items read as unchanged; each line keeps its own id.
    items: (correcting ? items : validItems).map((it) => (isWithoutPo ? {
      _id: it._id || undefined,
      itemName: it.itemName.trim(), skuCode: it.skuCode?.trim() || '', skuId: it.skuId || undefined,
      unit: it.unit || 'Pcs', invoiceQty: round2(it.invoiceQty || it.receivedQty), receivedQty: round2(it.receivedQty),
      rate: round2(it.rate), batchNo: it.batchNo?.trim() || '', remarks: it.remarks?.trim() || '',
      howItemReceived: it.howItemReceived,
    } : {
      // poId isn't required by the server (it resolves each line's PO itself
      // from poItemId/skuCode), but passing it through keeps the preview PDF
      // and any client-side grouping accurate.
      _id: it._id || undefined,
      poItemId: it.poItemId, poId: it.poId || undefined, poNumber: it.poNumber || undefined,
      itemName: it.itemName.trim(), skuCode: it.skuCode?.trim() || '',
      skuId: it.skuId || undefined, unit: it.unit || 'Pcs',
      orderedQty: it.orderedQty, previouslyReceivedQty: it.previouslyReceivedQty,
      invoiceQty: round2(it.invoiceQty), receivedQty: round2(it.receivedQty),
      rate: round2(it.rate), batchNo: it.batchNo?.trim() || '', remarks: it.remarks?.trim() || '',
      howItemReceived: it.howItemReceived,
      allowOverReceipt: isOver(it) && it.allowOverReceipt === true,
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
        const res = await createGrn(isWithoutPo ? payload : { ...payload, poIds: pos.map((p) => p._id) }).unwrap();
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

  // Finalizing is NOT done from this footer: the GRN is completed from the Incoming
  // QC panel's "Complete GRN + QC" (which saves pending GRN edits first, then asks
  // for over-receipt consent / Received At in the Complete GRN dialog).

  // ── Save the correction of a completed GRN (procurement.editGrn). With the
  // items locked only the header goes, so nothing a later step uses can move.
  const runCorrect = async (allowOverReceipt) => {
    const payload = buildPayload();
    const body = itemsLocked
      ? {
        grnDate: header.grnDate, challanNumber: header.challanNumber, invoiceNumber: header.invoiceNumber,
        invoiceDate: header.invoiceDate || '', vehicleNumber: header.vehicleNumber, receivedBy: header.receivedBy,
        preparedBy: header.preparedBy, remarks: header.remarks, challanDocument: payload.challanDocument,
      }
      : { ...payload, invoiceDate: header.invoiceDate || '' };
    try {
      await correctGrn({ id: current._id, reason: reason.trim(), allowOverReceipt, ...body }).unwrap();
      enqueueSnackbar(`GRN ${current.grnNumber} corrected`, { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      const msg = err?.data?.message || 'Failed to save the changes';
      // The server measures "pending" against today's PO; it asks for the same consent.
      if (err?.status === 409 && /over-receipt/i.test(msg) && !allowOverReceipt) { setOverReceiptFor('correct'); return; }
      enqueueSnackbar(msg, { variant: 'error' });
    }
  };

  const handleCorrect = () => {
    if (reason.trim().length < 3) { enqueueSnackbar('Give the reason for the change', { variant: 'warning' }); return; }
    if (!itemsLocked && !validateForm()) return;
    const hasExtra = !itemsLocked && !isWithoutPo && validItems.some((it) => isOver(it) && !it.allowOverReceipt);
    if (hasExtra) { setOverReceiptFor('correct'); return; }
    runCorrect(false);
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
        poIds: pos.map((p) => p._id),
        poNumber: pos[0]?.poNumber || undefined,
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

  // Shown once, at the top: the vendor, and what this GRN receives against.
  const vendorName = isWithoutPo ? header.vendorName : (pos[0]?.vendorName || grn?.vendorName || '');
  const indentNumber = pos[0]?.indentNumber || grn?.indentNumber;
  const piNumber = pos[0]?.piNumber || grn?.piNumber;
  const vendorRefs = (isWithoutPo
    ? [header.vendorGST && `GST ${header.vendorGST}`, header.vendorAddress, header.vendorPhone && `📞 ${header.vendorPhone}`]
    : [pos.length > 0 && `PO ${pos.map((p) => p.poNumber).join(', ')}`, indentNumber && `Indent ${indentNumber}`, piNumber && `PI ${piNumber}`]
  ).filter(Boolean);

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: { xs: '100%', md: '92vh' }, display: 'flex', flexDirection: 'column', borderRadius: { xs: 0, md: '8px' }, overflow: 'hidden' } }}>
      {/* Header — white with a thin brand line on top: what this is, its GRN No.
          and QC state, then the vendor it is for and the GRN Date. */}
      <Box sx={{ flexShrink: 0, bgcolor: PFMS.surface, borderTop: `4px solid ${PFMS.brand}`, borderBottom: `1px solid ${PFMS.line}` }}>
        <Box sx={{ px: 3, pt: 1.5, pb: 1.25, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Box sx={{ width: 36, height: 36, borderRadius: '8px', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: alpha(PFMS.brand, 0.08), color: PFMS.brand }}>
            <PackageCheck size={20} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: PFMS.ink, lineHeight: 1.25 }}>
              {grn ? 'Edit GRN' : 'Create GRN'}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: PFMS.sub }}>
              {correcting ? 'Step 1.8 · Correcting a completed GRN' : 'Step 1.8 · Receive material — stock posts when Incoming QC is completed'}
            </Typography>
          </Box>
          {/* System-generated identifier — read-only, styled apart from form fields. */}
          <Box
            title={current?.grnNumber ? 'System-generated GRN No. — stays the same through draft edits and completion' : 'The GRN No. is generated by the system when this GRN is first saved'}
            sx={META_PILL_SX}>
            <Typography sx={META_LABEL_SX}>GRN No.</Typography>
            {current?.grnNumber ? (
              <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', color: PFMS.ink, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
                {current.grnNumber}
              </Typography>
            ) : (
              <Typography sx={{ fontWeight: 600, fontSize: '0.8rem', fontStyle: 'italic', color: PFMS.sub, lineHeight: 1.3 }}>
                Assigned on save
              </Typography>
            )}
          </Box>
          {/* Incoming QC status — always in view; details in the Incoming QC panel below. */}
          <Box data-testid="grn-form-qc-badge" title={qcStage.desc} sx={{ ...META_PILL_SX, display: { xs: 'none', sm: 'flex' } }}>
            <Typography sx={META_LABEL_SX}>Incoming QC</Typography>
            <Typography sx={{ fontWeight: 800, fontSize: '0.85rem', color: (TONES[qcStage.tone] || TONES.neutral).fg, lineHeight: 1.3 }}>{qcStage.label}</Typography>
          </Box>
          <IconButton onClick={() => onClose?.(Boolean(savedGrn), savedGrn)} sx={{ color: PFMS.sub }}><X size={20} /></IconButton>
        </Box>

        {/* The vendor (with the PO / indent / PI it receives against) and the GRN Date. */}
        <Box data-testid="grn-form-vendor-bar"
          sx={{ px: 3, py: 1.25, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', borderTop: `1px solid ${PFMS.lineSoft}` }}>
          <Building2 size={18} color={vendorName ? PFMS.brand : PFMS.faint} style={{ flexShrink: 0 }} />
          <Box sx={{ flex: 1, minWidth: 220 }}>
            <Typography noWrap title={vendorName || undefined}
              sx={{ fontWeight: 800, fontSize: '0.98rem', lineHeight: 1.3, color: vendorName ? PFMS.ink : PFMS.faint }}>
              {vendorName || (isWithoutPo ? 'No vendor yet — select one below' : 'No vendor yet — pick a PO below')}
            </Typography>
            {vendorRefs.length > 0 && (
              <Typography variant="caption" sx={{ display: 'block', color: PFMS.sub, overflowWrap: 'anywhere' }}>
                {vendorRefs.join(' · ')}
              </Typography>
            )}
          </Box>
          {isWithoutPo && <Chip size="small" color="warning" variant="outlined" label="Without PO" sx={{ fontWeight: 700 }} />}
          <DateInputDDMMYYYY label="GRN Date" value={header.grnDate} disabled={grnLocked} sx={{ width: 200 }}
            onChange={(val) => setHeader((h) => ({ ...h, grnDate: val }))} />
        </Box>
      </Box>

      {/* Body */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', px: 3, py: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5, bgcolor: PFMS.surfaceAlt }}>
        {/* The GRN part. Read-only once completed / signed (the server refuses edits). */}
        {correcting && (
          <Paper elevation={0} data-testid="grn-correction-panel"
            sx={{ ...SECTION, borderColor: alpha('#d97706', 0.45), bgcolor: alpha('#f59e0b', 0.05) }}>
            <Typography sx={{ fontWeight: 800, color: '#92400e', mb: 0.5 }}>Editing a completed GRN</Typography>
            <Typography variant="body2" sx={{ color: '#475569' }}>
              {!changeCheck ? 'Checking what this GRN is linked to…'
                : itemsLocked
                  ? <>Items are locked — <b>{changeCheck.laterSteps.map(laterStepText).join(', ')}</b> already {changeCheck.laterSteps.length === 1 ? 'uses' : 'use'} them. Remove that first to change quantities. Dates, challan, invoice, vehicle, people and remarks can be corrected now.</>
                  : "Nothing after this GRN uses its items yet, so quantities can be corrected too — the PO's received and pending quantity follow."}
              {changeCheck?.mdSigned ? " The MD's signature is removed when you save — the MD signs the corrected GRN again." : ''}
            </Typography>
            <TextField label="Reason for the change *" size="small" fullWidth value={reason} sx={{ mt: 1.5, bgcolor: '#fff' }}
              onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong challan number entered"
              inputProps={{ maxLength: 500, 'data-testid': 'grn-correction-reason' }} />
          </Paper>
        )}
        <Box data-testid="grn-form-grn-part" aria-disabled={grnLocked || undefined}
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, ...(grnLocked ? { pointerEvents: 'none', opacity: 0.8 } : {}) }}>
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, fontWeight: 700, color: 'primary.main' }}>
            <FileText size={18} /> GRN Header
          </Typography>
          {/* Receipt type — fixed once a GRN exists; chosen only when creating one. */}
          {!isEdit && !presetPo && (
            <ToggleButtonGroup
              exclusive size="small" value={mode} onChange={handleModeChange}
              sx={{ mb: 2 }} data-testid="grn-mode-toggle"
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
            {/* Picking what to receive — only while creating. The chosen vendor,
                PO(s) and indent then show at the top of the form. */}
            {!isEdit && !presetPo && (
              <Grid item xs={12}>
                {isWithoutPo ? (
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
                ) : (
                  <Autocomplete
                    multiple
                    options={poOptions}
                    loading={posLoading}
                    value={pos}
                    getOptionLabel={(o) => (o ? `${o.poNumber} — ${o.vendorName}` : '')}
                    isOptionEqualToValue={(o, v) => o._id === v._id}
                    // Once one PO is picked, only the same vendor's other POs stay
                    // selectable (server re-enforces this regardless).
                    getOptionDisabled={(o) => pos.length > 0 && pos[0].vendorId && o.vendorId
                      && String(o.vendorId) !== String(pos[0].vendorId)}
                    onChange={(_e, v) => applyPos(v)}
                    noOptionsText="No PO is ready for GRN (needs READY_FOR_GRN + payment completed)"
                    renderInput={(params) => (
                      <TextField {...params} label="Purchase Order(s) *" placeholder="Same vendor — READY_FOR_GRN + Payment Completed only"
                        helperText="Pick one or more compatible POs of the same vendor"
                        InputProps={{ ...params.InputProps, endAdornment: (<>{posLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
                    )}
                  />
                )}
              </Grid>
            )}
            {/* One row on a laptop screen (the date column a little wider so a
                full date fits); GRN Date sits at the top with the vendor. */}
            <Grid item xs={12}>
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, minmax(0, 1fr))', lg: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.25fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)' } }}>
                <TextField label="Challan No" fullWidth value={header.challanNumber} onChange={(e) => setHeader((h) => ({ ...h, challanNumber: e.target.value }))} />
                <TextField label="Invoice No" fullWidth value={header.invoiceNumber} onChange={(e) => setHeader((h) => ({ ...h, invoiceNumber: e.target.value }))} />
                <DateInputDDMMYYYY label="Invoice Date" fullWidth value={header.invoiceDate} onChange={(val) => setHeader((h) => ({ ...h, invoiceDate: val }))} />
                <TextField label="Vehicle No" fullWidth value={header.vehicleNumber} onChange={(e) => setHeader((h) => ({ ...h, vehicleNumber: e.target.value }))} />
                <TextField label="Received By" fullWidth value={header.receivedBy} onChange={(e) => setHeader((h) => ({ ...h, receivedBy: e.target.value }))} />
                <TextField label="Prepared By" fullWidth value={header.preparedBy} onChange={(e) => setHeader((h) => ({ ...h, preparedBy: e.target.value }))} />
              </Box>
            </Grid>
            {/* Material Receipt Type is chosen per SKU, on each Material Receipt row. */}

            {/* Inventory destination is automatic: each line goes where its SKU
                master Item Type says (shown on the line). Only Raw Material
                needs one more answer — where it physically landed. */}
            {hasRmLine && (
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Received At *" select fullWidth required
                  value={header.rmReceivedAtLocation}
                  onChange={(e) => setHeader((h) => ({ ...h, rmReceivedAtLocation: e.target.value }))}
                  error={!header.rmReceivedAtLocation}
                  helperText="Where the Raw Material physically landed — its RM stock posts here after QC."
                  inputProps={{ 'data-testid': 'grn-received-at' }}
                >
                  {RECEIVED_AT_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                </TextField>
              </Grid>
            )}
          </Grid>
        </Paper>

        {/* Items */}
        <Paper elevation={0} data-testid="grn-form-items" aria-disabled={itemsLocked || undefined}
          sx={{ ...SECTION, ...(itemsLocked ? { pointerEvents: 'none', opacity: 0.7 } : {}) }}>
          <Typography component="div" sx={{ fontWeight: 700, color: '#b45309', mb: 1.5, display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <PackageCheck size={18} /> Material Receipt
              {itemsLocked && <Chip size="small" icon={<Lock size={12} />} label="Locked" variant="outlined" sx={{ fontWeight: 700, height: 22 }} />}
            </Box>
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
                gridTemplateColumns: WOPO_ROW_COLS,
                gap: 1, px: 1, mb: 0.5,
              }}>
                {['Description / SKU', 'Unit', 'Received Qty', 'Rate', 'Material Receipt Type', 'Batch No', 'Remarks', ''].map((h, i) => (
                  <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.62rem' }}>{h}</Typography>
                ))}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {items.map((it, idx) => {
                  const skuMatch = skuOptions.find((s) => s._id === it.skuId) || null;
                  return (
                    <Box key={idx} sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: WOPO_ROW_COLS },
                      gap: 1, alignItems: 'flex-start', p: { xs: 1.5, md: 0.5 }, px: { md: 1 },
                      borderRadius: '10px', border: { xs: '1px solid', md: 'none' }, borderColor: 'divider',
                      '&:hover': { bgcolor: alpha('#2563eb', 0.03) },
                    }}>
                      <Box sx={{ minWidth: 0 }}>
                      <Autocomplete
                        freeSolo
                        options={skuOptions}
                        value={skuMatch || it.itemName}
                        getOptionLabel={(o) => (typeof o === 'string' ? o : (o?.name || ''))}
                        isOptionEqualToValue={(o, v) => o._id === v?._id}
                        onChange={(_e, v) => {
                          // The unit it is bought in: the SKU's Purchase Unit when it has one.
                          if (v && typeof v === 'object') setItem(idx, { itemName: v.name, skuCode: v.code || '', skuId: v._id, unit: purchaseUnitOf(v) || 'Pcs' });
                        }}
                        onInputChange={(_e, v, reason) => { if (reason === 'input') setItem(idx, { itemName: v, skuId: '' }); }}
                        renderInput={(params) => (
                          <TextField {...params} size="small" label="Description *" placeholder="Pick a SKU or type a name" />
                        )}
                      />
                      {destinationTag(it)}
                      {conversionHint(it)}
                      </Box>
                      <TextField size="small" label="Unit" value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })} />
                      <TextField size="small" type="number" label="Received Qty" value={it.receivedQty}
                        onChange={(e) => setItem(idx, { receivedQty: e.target.value })}
                        inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} />
                      <TextField size="small" type="number" label="Rate" value={it.rate}
                        onChange={(e) => setItem(idx, { rate: e.target.value })}
                        inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} />
                      <ReceiptTypeSelect value={it.howItemReceived} lineKey={`${it.poNumber || ''}|${it.skuCode || it.itemName}`}
                        error={!it.howItemReceived && round2(it.receivedQty) > 0}
                        onChange={(v) => setItem(idx, { howItemReceived: v })} />
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
              {pos.length > 0 ? 'Nothing pending to receive on the selected PO(s).' : 'Select one or more eligible POs to load their items.'}
            </Typography>
          ) : (
            <>
              <Box sx={{
                display: { xs: 'none', md: 'grid' },
                gridTemplateColumns: PO_ROW_COLS,
                gap: 1, px: 1, mb: 0.5,
              }}>
                {['Description', 'SKU', 'Ordered Qty', 'Already Received', 'Pending Qty', 'Invoice Qty', 'Received Qty', 'Material Receipt Type', 'Batch No', 'Remarks'].map((h, i) => (
                  <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.62rem' }}>{h}</Typography>
                ))}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {itemGroups.map((g, gi) => (
                  <Box key={gi}>
                    {pos.length > 1 && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5, mb: 0.5, bgcolor: alpha('#0b2545', 0.06), borderRadius: '8px' }}>
                        <ShoppingBag size={13} color="#0b2545" />
                        <Typography variant="caption" sx={{ fontWeight: 800 }}>PO {g.poNumber}</Typography>
                      </Box>
                    )}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1 }}>
                      {g.rows.map(({ it, idx }) => {
                        // Pending Qty is fixed (orderedQty − alreadyReceived), computed from the
                        // PO — read-only and never recalculated off the in-progress receivedQty.
                        const pendingBefore = round2(it.pendingBefore);
                        const extra = round2(it.receivedQty) > pendingBefore;
                        const extraQty = extra ? round2(it.receivedQty - pendingBefore) : 0;
                        return (
                          <Box key={idx} sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: '1fr', md: PO_ROW_COLS },
                            gap: 1, alignItems: 'flex-start', p: { xs: 1.5, md: 0.5 }, px: { md: 1 },
                            borderRadius: '10px', border: { xs: '1px solid', md: 'none' }, borderColor: 'divider',
                            '&:hover': { bgcolor: alpha('#2563eb', 0.03) },
                          }}>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" fontWeight={600} noWrap>{it.itemName}</Typography>
                              <Typography variant="caption" color="text.disabled">{it.unit}</Typography>
                              {conversionHint(it)}
                              <Box>{destinationTag(it)}</Box>
                            </Box>
                            <Typography variant="body2" color="primary.main" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{it.skuCode || '—'}</Typography>
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
                            <ReceiptTypeSelect value={it.howItemReceived} lineKey={`${it.poNumber || ''}|${it.skuCode || it.itemName}`}
                              error={!it.howItemReceived && round2(it.receivedQty) > 0}
                              onChange={(v) => setItem(idx, { howItemReceived: v })} />
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
                            {/* Only a line that really exceeds its pending qty can be
                                over-received; the tick is per line and is dropped as soon
                                as Received Qty comes back within pending. */}
                            {extra && (
                              <Box data-testid="grn-over-receipt" data-line={`${it.poNumber || ''}|${it.skuCode || it.itemName}`}
                                sx={{ gridColumn: { md: '1 / -1' }, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', px: 1, py: 0.25, borderRadius: '8px', bgcolor: alpha('#b45309', 0.08), border: '1px solid', borderColor: alpha('#b45309', 0.35) }}>
                                <FormControlLabel sx={{ m: 0 }}
                                  control={<Checkbox size="small" checked={Boolean(it.allowOverReceipt)} inputProps={{ 'data-testid': 'grn-allow-over-receipt' }}
                                    onChange={(e) => setItem(idx, { allowOverReceipt: e.target.checked })} />}
                                  label={<Typography variant="body2" fontWeight={700}>Allow Over-Receipt</Typography>} />
                                <Typography variant="caption" data-testid="grn-over-receipt-warning" sx={{ color: '#b45309', fontWeight: 700 }}>
                                  Warning: receiving {it.receivedQty} against {pendingBefore} pending — {extraQty} {it.unit || ''} over the PO.
                                  {it.allowOverReceipt ? '' : ' Tick to confirm, or reduce Received Qty.'}
                                </Typography>
                              </Box>
                            )}
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                ))}
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
        {correcting ? null : !liveGrn?._id ? (
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
            <GrnQcSections grn={liveGrn} footerSlot={footerSlot} prepareGrn={grnLocked ? undefined : () => handleSubmit({ stay: true })} />
          </Box>
        )}
      </Box>

      {/* Footer */}
      <Divider />
      {/* One line on a laptop (the summary text wraps first); stacks only on a phone. */}
      <Box sx={{ px: 3, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: { xs: 'wrap', md: 'nowrap' }, gap: 1.5, bgcolor: '#fff' }}>
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }}>
          {correcting
            ? `Editing ${current?.grnNumber || 'GRN'} · ${validItems.length} item(s) · received ${totals.received} · ${fmtINR(totals.value)}`
            : grnLocked
              ? 'GRN completed — read-only'
              : `${validItems.length} item(s) · received ${totals.received} · ${fmtINR(totals.value)} · stock posts when QC completes`}
          {' · '}Incoming QC: <b>{qcStage.label}</b>
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, flexShrink: { xs: 1, md: 0 }, flexWrap: { xs: 'wrap', md: 'nowrap' }, justifyContent: 'flex-end' }}>
          {/* Second arg = the draft created in this session, so the caller can open it. */}
          <Button variant="outlined" onClick={() => onClose?.(Boolean(savedGrn), savedGrn)} disabled={busy}>
            {savedGrn ? 'Close' : 'Cancel'}
          </Button>
          {correcting && (
            <Button variant="contained" data-testid="grn-correction-save"
              startIcon={correctSaving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
              onClick={handleCorrect} disabled={busy || !changeCheck}>
              Save Changes
            </Button>
          )}
          {!grnLocked && !correcting && (
            <Button variant="outlined" startIcon={previewing ? <CircularProgress size={16} color="inherit" /> : <Eye size={16} />}
              onClick={handlePreview} disabled={busy}>
              Preview PDF
            </Button>
          )}
          {!grnLocked && !correcting && (
            <Button variant="outlined" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
              onClick={() => handleSubmit()} disabled={busy}>
              Save as Draft
            </Button>
          )}
          {/* Incoming QC actions (Save QC Draft, Complete GRN + QC) render here. */}
          <Box ref={setFooterSlot} sx={{ display: 'contents' }} />
          {!correcting && !liveGrn?._id && (
            <Button variant="contained" color="success" disabled startIcon={<ClipboardCheck size={16} />}
              title="Save as Draft first — the QC is entered on the saved GRN">
              Complete GRN + QC
            </Button>
          )}
        </Box>
      </Box>

      {/* Over-receipt consent — mirrors the same checkbox/confirmation the
          separate "Complete GRN" dialog already asks for; the server
          re-validates this against the PO's live pending quantity regardless. */}
      <Dialog open={Boolean(overReceiptFor)} onClose={() => setOverReceiptFor(null)} maxWidth="xs" fullWidth>
        <Box sx={{ p: 3 }}>
          <Typography sx={{ fontWeight: 800, mb: 1 }}>Allow Over-Receipt?</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            One or more items now receive more than their pending quantity. Saving counts the extra quantity as received on the PO — confirm this is intentional before continuing.
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button onClick={() => setOverReceiptFor(null)} disabled={busy}>Cancel</Button>
            <Button variant="contained" color="success" disabled={busy}
              startIcon={correctSaving ? <CircularProgress size={16} color="inherit" /> : <PackageCheck size={16} />}
              onClick={() => { setOverReceiptFor(null); runCorrect(true); }}>
              Allow &amp; Save
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
        showSaveDraft={false}
        approveLabel="Save as Draft"
      />
    </Dialog>
  );
};

export default GrnFormDialog;
