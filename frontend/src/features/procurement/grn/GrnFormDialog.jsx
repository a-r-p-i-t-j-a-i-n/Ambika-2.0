import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog, Box, Typography, TextField, Button, IconButton, Alert,
  Autocomplete, CircularProgress, Paper, Chip, MenuItem,
  Checkbox, FormControlLabel, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Save, PackageCheck, FileText, Eye, ClipboardCheck, Lock,
  Plus, Trash2, ShoppingBag, Ban, MessageSquareText, Boxes,
} from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetPurchaseOrdersQuery,
  useGetGrnByIdQuery,
  useGetIncomingQcsByGrnQuery,
  useSaveGrnWithQcMutation,
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
import GrnQcSection from './GrnQcSection';
import StatusChip, { TONES } from '../components/StatusChip';
import {
  pickGrnQc, emptyHeader, headerFromQc, linesFromGrn, mergeEnteredLines, lineKey, allLinesBalanced,
  expectedQcResult, qcTotals,
} from '../incoming-qc/qcForm';
import QcInspectionForm from '../incoming-qc/QcInspectionForm';
import { QcResultChip, fmtDate } from '../incoming-qc/qcMeta';
import { destinationOf, routingProblemOf, destinationText, DESTINATION_META } from './inventoryDestination';
import PdfPreviewSubmitModal from '../common/PdfPreviewSubmitModal';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { PFMS, pfmsCardSx, pfmsNoSpinSx } from '../pfmsTheme';
import {
  PfmsFormDialog, FormDialogHeader, MetaPill, FormVendorBar, FormDialogBody, FormSection, LabeledField,
  FormTableHead, CellCaption, FormTotals, RemarksField, AttachmentDrop, FormDialogFooter,
} from '../components/PfmsFormDialog';
import { useElementWidth } from '../components/useElementWidth';
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
// The server's limit for the GRN's own remarks (grn.validation.js).
const REMARKS_MAX = 1000;

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
// long value can never push the table wider than the dialog. The qty inputs
// keep 84px and the Material Receipt Type column 140px so its longest word fits.
const PO_ROW_COLS = '28px minmax(0,1.4fr) minmax(0,0.85fr) minmax(0,0.55fr) minmax(0,0.65fr) minmax(0,0.55fr) minmax(84px,0.75fr) minmax(84px,0.75fr) minmax(140px,1.25fr) minmax(0,1.1fr) minmax(0,1.1fr)';
const PO_HEAD = ['#', 'Description', 'SKU', 'Ordered Qty', 'Already Received', 'Pending Qty', 'Invoice Qty', 'Received Qty', 'Material Receipt Type', 'Batch No', 'Remarks'];
const PO_ALIGN = ['center', 'left', 'left', 'center', 'center', 'center', 'center', 'center', 'left', 'left', 'left'];
const WOPO_ROW_COLS = '28px minmax(0,1.7fr) minmax(0,0.6fr) minmax(84px,0.8fr) minmax(84px,0.8fr) minmax(140px,1.3fr) minmax(0,0.95fr) minmax(0,1fr) 34px';
const WOPO_HEAD = ['#', 'Description / SKU', 'Unit', 'Received Qty', 'Rate', 'Material Receipt Type', 'Batch No', 'Remarks', ''];
const WOPO_ALIGN = ['center', 'left', 'left', 'center', 'center', 'left', 'left', 'left', 'left'];
// Below this width (the Material Receipt card's own, which follows the sidebar,
// not the viewport) each line becomes a stacked card with captions.
const TABLE_MIN = 900;
const QTY_INPUT = { min: 0, step: 0.01, style: { textAlign: 'center', fontWeight: 700 } };

// Material Receipt Type of ONE material row — the same options and labels the
// GRN header dropdown used. The selected label wraps instead of being cut off
// in a narrow column. Its column head (or the row caption) names it.
const ReceiptTypeSelect = ({ value, onChange, error, lineKey }) => (
  <TextField size="small" select fullWidth value={value || ''}
    onChange={(e) => onChange(e.target.value)} error={error} helperText={error ? 'Required' : undefined}
    SelectProps={{ SelectDisplayProps: {
      'data-testid': 'grn-line-receipt-type', 'data-line': lineKey, 'aria-label': 'Material Receipt Type', 'aria-labelledby': undefined,
      style: { whiteSpace: 'normal', lineHeight: 1.3, fontSize: '0.8rem', fontWeight: 700 },
    } }}>
    {HOW_ITEM_RECEIVED.map((v) => <MenuItem key={v} value={v}>{howReceivedLabel(v)}</MenuItem>)}
  </TextField>
);

/** One cell of a Material Receipt row; stacked rows caption it (the table head does on a wide one). */
const Cell = ({ caption, wide, children, sx }) => (
  <Box sx={{ minWidth: 0, ...sx }}>
    {!wide && caption ? <CellCaption>{caption}</CellCaption> : null}
    {children}
  </Box>
);

// A later step resting on a completed GRN, as the correction panel names it.
const LATER_STEP_LABEL = { QC: 'Incoming QC', INVOICE: 'Vendor Invoice' };
const laterStepText = (s) => (s.type === 'STOCK'
  ? `stock already posted (${s.count} entr${s.count === 1 ? 'y' : 'ies'})`
  : `${LATER_STEP_LABEL[s.type] || s.type} ${s.number || ''}`.trim());

// Read-only qty display — centred under its column head; a stacked row captions it.
const QtyCell = ({ label, value, color, wide }) => (
  <Box sx={{ textAlign: wide ? 'center' : 'left', minWidth: 0 }}>
    {!wide && <CellCaption>{label}</CellCaption>}
    <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', lineHeight: wide ? '40px' : 1.4, color: color || PFMS.ink }}>{value}</Typography>
  </Box>
);

// QC typed before this form saved QC with the GRN was kept on the device under
// this key; such a draft is still picked up once, then the server copy wins.
const localQcKey = (grnId) => `grnQcDraft:${grnId}`;
const readLocalQc = (grnId) => {
  try { return JSON.parse(localStorage.getItem(localQcKey(grnId)) || 'null') || {}; } catch { return {}; }
};
const clearLocalQc = (grnId) => { try { localStorage.removeItem(localQcKey(grnId)); } catch { /* storage unavailable */ } };
const QC_ENTERED = ['receivedQty', 'acceptedQty', 'rejectedQty', 'reworkQty', 'defectType', 'defectSeverity', 'qcRemarks'];
const pickQcEntered = (it) => Object.fromEntries(QC_ENTERED.map((f) => [f, it[f]]));

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

  // Jump links in the header: the GRN part and the Incoming QC part are one form.
  const bodyRef = useRef(null);
  const jumpTo = (id) => bodyRef.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

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
  // Incoming QC typed on this form, per QC (one per PO on a multi-PO GRN):
  // { [scopeKey]: { header, entered, doc } }. Only what the user changed — the
  // rest is seeded from the saved QC / the GRN's saved QC draft (see qcSeedFor).
  const [qcEdits, setQcEdits] = useState({});
  // The Material Receipt card's width decides table vs stacked rows.
  const [itemsEl, setItemsEl] = useState(null);
  const itemsWidth = useElementWidth(itemsEl);
  const wide = itemsWidth >= TABLE_MIN;
  const stackCols = itemsWidth >= 560 ? 3 : 2;

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

  // GRN and its Incoming QC are saved together, by ONE request (grnQcSave.service).
  const [saveGrnWithQc, { isLoading: saving, originalArgs: saveArgs }] = useSaveGrnWithQcMutation();
  const completing = saving && saveArgs?.complete === true;
  const [previewGrnPdf, { isLoading: previewing }] = usePreviewGrnPdfMutation();
  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();
  const [correctGrn, { isLoading: correctSaving }] = useCorrectGrnMutation();
  const [qcUploading, setQcUploading] = useState(false);
  const busy = saving || previewing || uploading || correctSaving || qcUploading;
  // 'correct' — the save the over-receipt consent is for.
  const [overReceiptFor, setOverReceiptFor] = useState(null);

  const handleUpload = async (f) => {
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
    setQcEdits({});
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

  // ── Incoming QC, on this same form ─────────────────────────────────────────
  // One QC per PO on a multi-PO GRN, else one. Its lines follow the GRN lines AS
  // TYPED here (nothing has to be saved first); the server re-anchors them on
  // the saved GRN and checks the split again when completing.
  const qcRecords = qcRes?.data || [];
  const qcScopes = useMemo(() => {
    const ids = liveGrn?.poIds?.length ? liveGrn.poIds.map(String) : pos.map((p) => String(p._id));
    const nums = liveGrn?.poNumbers?.length ? liveGrn.poNumbers : pos.map((p) => p.poNumber);
    return ids.length > 1
      ? ids.map((poId, i) => ({ key: poId, poId, poNumber: nums[i] || '' }))
      : [{ key: 'all', poId: null, poNumber: '' }];
  }, [liveGrn, pos]);
  const qcLinesOf = (scope) => linesFromGrn({ items }, scope.poId);
  const qcRecordOf = (scope) => pickGrnQc(qcRecords, scope.poId || undefined);
  const qcStageOf = (scope) => resolveGrnQcStage(liveGrn, qcRecordOf(scope));
  const QC_FINAL = ['QC_DONE', 'QC_DONE_LEGACY', 'CANCELLED'];
  const qcEditable = (scope) => !QC_FINAL.includes(qcStageOf(scope).key);

  /** Where a scope's QC starts from: its saved QC record, else the QC kept on the draft GRN, else this device (older drafts), else blank. */
  const qcSeedFor = (scope) => {
    const lines = qcLinesOf(scope);
    const rec = qcRecordOf(scope);
    if (rec && ['DRAFT', 'IN_PROGRESS'].includes(rec.qcStatus)) {
      const entered = {};
      lines.forEach((l) => {
        const qi = (rec.items || []).find((q) => l.grnItemId && String(q.grnItemId) === String(l.grnItemId));
        if (qi) entered[lineKey(l)] = { receivedQty: qi.receivedQty, acceptedQty: qi.acceptedQty, rejectedQty: qi.rejectedQty, reworkQty: qi.reworkQty, defectType: qi.defectType || '', defectSeverity: qi.defectSeverity || '', qcRemarks: qi.qcRemarks || '' };
      });
      return { header: headerFromQc(rec), entered, doc: rec.qcReportDocument?.fileUrl ? { ...rec.qcReportDocument } : null };
    }
    const kept = (liveGrn?.qcDraft || []).find((q) => (scope.poId ? String(q.poId) === String(scope.poId) : true));
    if (kept) {
      return {
        header: { ...emptyHeader(), qcDate: kept.qcDate ? String(kept.qcDate).slice(0, 10) : emptyHeader().qcDate, checkedByName: kept.checkedByName || '', preparedBy: kept.preparedBy || '', remarks: kept.remarks || '' },
        entered: Object.fromEntries((kept.items || []).map((it) => [it.lineKey, it])),
        doc: kept.qcReportDocument?.fileUrl ? { ...kept.qcReportDocument } : null,
      };
    }
    const local = !scope.poId && liveGrn?._id ? readLocalQc(liveGrn._id) : {};
    return { header: { ...emptyHeader(), ...(local.header || {}) }, entered: local.entered || {}, doc: local.doc || null };
  };
  const qcOf = (scope) => qcEdits[scope.key] || qcSeedFor(scope);
  const setQc = (scope, patch) => setQcEdits((cur) => ({ ...cur, [scope.key]: { ...(cur[scope.key] || qcSeedFor(scope)), ...patch } }));
  const qcItemsOf = (scope) => mergeEnteredLines(qcLinesOf(scope), qcOf(scope).entered);
  const setQcItem = (scope, idx, patch) => {
    const line = qcItemsOf(scope)[idx];
    const entered = { ...qcOf(scope).entered, [lineKey(line)]: { ...pickQcEntered(line), ...patch } };
    setQc(scope, { entered });
  };
  const editableScopes = correcting ? [] : qcScopes.filter(qcEditable);
  const allQcDone = !correcting && Boolean(liveGrn?._id) && editableScopes.length === 0;
  const qcPayload = () => editableScopes.map((scope) => {
    const q = qcOf(scope);
    return {
      poId: scope.poId || null,
      qcDate: q.header.qcDate || null,
      checkedByName: q.header.checkedByName || '', preparedBy: q.header.preparedBy || '', remarks: q.header.remarks || '',
      qcReportDocument: q.doc?.fileUrl ? { fileName: q.doc.fileName, fileUrl: q.doc.fileUrl, fileType: q.doc.fileType } : null,
      items: qcItemsOf(scope).map((l) => ({
        lineKey: lineKey(l), grnItemId: l.grnItemId ? String(l.grnItemId) : '', poItemId: l.poItemId ? String(l.poItemId) : '',
        itemName: l.itemName, receivedQty: round2(l.receivedQty),
        acceptedQty: Math.max(0, round2(l.acceptedQty)), rejectedQty: Math.max(0, round2(l.rejectedQty)), reworkQty: Math.max(0, round2(l.reworkQty)),
        defectType: l.defectType || '', defectSeverity: l.defectSeverity || '', qcRemarks: l.qcRemarks || '',
      })),
    };
  });
  const qcFooterTotals = qcTotals(editableScopes.flatMap(qcItemsOf));

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

  /**
   * The one Save: GRN and Incoming QC together, in one request.
   *   complete = false  a draft of both — incomplete is fine; never posts stock
   *   complete = true   GRN completed + QC completed (accepted qty posts to
   *                     stock) — only once everything below checks out; the
   *                     server checks all of it again and decides
   */
  const saveAll = async (complete) => {
    if (!grnLocked && !validateForm()) return false;
    if (complete) {
      const empty = editableScopes.find((s) => qcItemsOf(s).length === 0);
      if (empty) { enqueueSnackbar('Enter a received quantity on at least one item — there is nothing to inspect', { variant: 'warning' }); return false; }
      const off = editableScopes.find((s) => !allLinesBalanced(qcItemsOf(s)));
      if (off) {
        enqueueSnackbar(`Incoming QC${off.poNumber ? ` (PO ${off.poNumber})` : ''}: Accepted + Rejected must equal Received on every line`, { variant: 'warning' });
        jumpTo(off.poId ? `grn-qc-section-${off.poId}` : 'grn-qc-section');
        return false;
      }
    }
    const payload = buildPayload();
    const grnBody = grnLocked ? null : (isEdit || isWithoutPo ? payload : { ...payload, poIds: pos.map((p) => p._id) });
    try {
      const res = await saveGrnWithQc({ id: current?._id, complete, grn: grnBody, qcs: qcPayload() }).unwrap();
      const saved = res?.data?.grn;
      if (!grnProp && saved) setSavedGrn(saved);
      if (saved?._id) clearLocalQc(saved._id);
      setQcEdits({});
      const no = saved?.grnNumber || current?.grnNumber || '';
      if (complete) {
        const done = (res?.data?.qcs || []).filter((q) => ['PASSED', 'PARTIAL', 'FAILED'].includes(q.qcStatus));
        const acc = done.reduce((s, q) => s + (Number(q.totalAccepted) || 0), 0);
        const rej = done.reduce((s, q) => s + (Number(q.totalRejected) || 0), 0);
        enqueueSnackbar(`GRN ${no} and Incoming QC completed — accepted ${acc} posted to stock${rej ? `, rejected ${rej} kept out` : ''}`, { variant: 'success' });
      } else {
        enqueueSnackbar(isEdit ? `GRN ${no} updated — draft saved with its QC` : `GRN ${no} created (draft) — GRN and QC saved`, { variant: 'success' });
      }
      return true;
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save — nothing was completed', { variant: 'error' });
      return false;
    }
  };

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

  // The preview's own action is the same draft Save (GRN + QC).
  const confirmFromPreview = async () => { const ok = await saveAll(false); if (ok) closePreview(); };

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  // Shown once, at the top: the vendor, and what this GRN receives against.
  const vendorName = isWithoutPo ? header.vendorName : (pos[0]?.vendorName || grn?.vendorName || '');
  const indentNumber = pos[0]?.indentNumber || grn?.indentNumber;
  const piNumber = pos[0]?.piNumber || grn?.piNumber;
  const vendorRefs = (isWithoutPo
    ? [header.vendorGST && { label: 'GST', value: header.vendorGST }, header.vendorAddress && { value: header.vendorAddress }, header.vendorPhone && { label: 'Ph', value: header.vendorPhone }]
    : [pos.length > 0 && { label: 'PO', value: pos.map((p) => p.poNumber).join(', ') }, indentNumber && { label: 'Indent', value: indentNumber }, piNumber && { label: 'PI', value: piNumber }]
  ).filter(Boolean);

  const closeForm = () => onClose?.(Boolean(savedGrn), savedGrn);
  const grnTitle = grn ? 'Edit GRN' : 'Create GRN';
  const setHeaderField = (key) => (e) => setHeader((h) => ({ ...h, [key]: e.target.value }));
  const qcStageTone = TONES[qcStage.tone] || TONES.neutral;
  // Lines received beyond their PO's pending qty — named once above the table.
  const overLines = isWithoutPo ? [] : items.filter((it) => isOver(it));

  // Read-only Description cell: name (wraps), unit, conversion and destination.
  const descriptionCell = (it) => (
    <>
      <Typography sx={{ fontWeight: 700, fontSize: '0.92rem', color: PFMS.brand, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{it.itemName}</Typography>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: PFMS.sub, textTransform: 'uppercase' }}>{it.unit}</Typography>
      {conversionHint(it)}
      <Box>{destinationTag(it)}</Box>
    </>
  );
  const rowSx = (wideRow) => ({
    display: 'grid', gap: wideRow ? 1 : 1.25, alignItems: 'flex-start', minWidth: 0,
    gridTemplateColumns: wideRow ? undefined : `repeat(${stackCols}, minmax(0,1fr))`,
    px: 1.5, py: wideRow ? 1 : 1.5, borderRadius: '8px',
    border: '1px solid', borderColor: wideRow ? 'transparent' : PFMS.line, borderBottomColor: PFMS.lineSoft,
    '&:hover': { bgcolor: alpha('#2563eb', 0.03) },
  });
  const fullRow = { gridColumn: '1 / -1' };
  const remarksSpan = { gridColumn: stackCols === 3 ? 'span 2' : '1 / -1' };

  return (
    <PfmsFormDialog open={open} onClose={() => onClose?.(false)}>
      {/* Header — the GRN and its Incoming QC as ONE form: GRN No., QC state,
          the vendor it is for and the GRN Date. */}
      <FormDialogHeader
        icon={<PackageCheck size={22} />}
        title={grnTitle}
        subtitle={correcting ? 'Step 1.8 · Correcting a completed GRN' : 'Steps 1.8 + 1.9 · Receive and inspect material — stock posts when the QC is completed'}
        onClose={closeForm}
        nav={correcting ? null : (
          <Box data-testid="grn-form-jump" sx={{ display: 'flex', gap: 0.75, order: { xs: 10, md: 0 }, flex: { xs: '1 1 100%', md: '0 0 auto' } }}>
            <Button size="small" variant="outlined" startIcon={<PackageCheck size={14} />} onClick={() => jumpTo('grn-form-grn-part')}
              sx={{ textTransform: 'none', fontWeight: 700, flex: { xs: 1, md: 'none' } }}>GRN</Button>
            <Button size="small" variant="outlined" startIcon={<ClipboardCheck size={14} />} onClick={() => jumpTo('grn-form-qc')}
              sx={{ textTransform: 'none', fontWeight: 700, flex: { xs: 1, md: 'none' } }}>Incoming QC</Button>
          </Box>
        )}
        meta={(
          <>
            {/* System-generated identifier — read-only, styled apart from form fields. */}
            <MetaPill label="GRN No." value={current?.grnNumber} placeholder="Assigned on save"
              title={current?.grnNumber ? 'System-generated GRN No. — stays the same through draft edits and completion' : 'The GRN No. is generated by the system when this GRN is first saved'} />
            {/* Incoming QC status — always in view; details in the Incoming QC part. */}
            <MetaPill data-testid="grn-form-qc-badge" title={qcStage.desc} hideXs
              label="Incoming QC" value={qcStage.label} tone={qcStage.tone} />
          </>
        )}>
        {/* The vendor (with the PO / indent / PI it receives against) and the GRN Date. */}
        <FormVendorBar data-testid="grn-form-vendor-bar" name={vendorName} refs={vendorRefs}
          emptyText={isWithoutPo ? 'No vendor yet — select one below' : 'No vendor yet — pick a PO below'}
          extra={isWithoutPo ? <Chip size="small" color="warning" variant="outlined" label="Without PO" sx={{ fontWeight: 700 }} /> : null}
          aside={(
            <LabeledField label="GRN Date" htmlFor="grn-f-date">
              <DateInputDDMMYYYY id="grn-f-date" fullWidth value={header.grnDate} disabled={grnLocked}
                onChange={(val) => setHeader((h) => ({ ...h, grnDate: val }))} />
            </LabeledField>
          )} />
      </FormDialogHeader>

      {/* Body — scrolls on its own between the fixed header and footer. */}
      <FormDialogBody ref={bodyRef}>
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
        <Box id="grn-form-grn-part" data-testid="grn-form-grn-part" aria-disabled={grnLocked || undefined}
          sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, scrollMarginTop: 8, ...(grnLocked ? { pointerEvents: 'none', opacity: 0.8 } : {}) }}>
        <FormSection icon={<FileText size={20} />} title="GRN Header">
          {/* Receipt type — fixed once a GRN exists; chosen only when creating one. */}
          {!isEdit && !presetPo && (
            <ToggleButtonGroup
              exclusive size="small" value={mode} onChange={handleModeChange}
              sx={{ mb: 2, flexWrap: 'wrap' }} data-testid="grn-mode-toggle"
            >
              <ToggleButton value="PO" sx={{ textTransform: 'none', gap: 0.75, px: 1.5 }}>
                <ShoppingBag size={15} /> Against Purchase Order
              </ToggleButton>
              <ToggleButton value="WITHOUT_PO" sx={{ textTransform: 'none', gap: 0.75, px: 1.5 }}>
                <Ban size={15} /> Without PO (W/O PO)
              </ToggleButton>
            </ToggleButtonGroup>
          )}
          {/* Picking what to receive — only while creating. The chosen vendor,
              PO(s) and indent then show at the top of the form. */}
          {!isEdit && !presetPo && (
            <Box sx={{ mb: 2 }}>
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
            </Box>
          )}
          {/* One row when the form is wide enough (measured, so it follows the
              sidebar), else 3 or 2 a row; GRN Date sits at the top with the vendor. */}
          <Box sx={{ display: 'grid', columnGap: 2, rowGap: 1.75, gridTemplateColumns: `repeat(${itemsWidth >= 1040 ? 6 : stackCols}, minmax(0,1fr))` }}>
            <LabeledField label="Challan No" htmlFor="grn-f-challan">
              <TextField id="grn-f-challan" fullWidth placeholder="Enter challan no." value={header.challanNumber} onChange={setHeaderField('challanNumber')} />
            </LabeledField>
            <LabeledField label="Invoice No" htmlFor="grn-f-invoice">
              <TextField id="grn-f-invoice" fullWidth placeholder="Enter invoice no." value={header.invoiceNumber} onChange={setHeaderField('invoiceNumber')} />
            </LabeledField>
            <LabeledField label="Invoice Date" htmlFor="grn-f-invoice-date">
              <DateInputDDMMYYYY id="grn-f-invoice-date" fullWidth value={header.invoiceDate} onChange={(val) => setHeader((h) => ({ ...h, invoiceDate: val }))} />
            </LabeledField>
            <LabeledField label="Vehicle No" htmlFor="grn-f-vehicle">
              <TextField id="grn-f-vehicle" fullWidth placeholder="Enter vehicle no." value={header.vehicleNumber} onChange={setHeaderField('vehicleNumber')} />
            </LabeledField>
            <LabeledField label="Received By" htmlFor="grn-f-received-by">
              <TextField id="grn-f-received-by" fullWidth placeholder="Enter received by" value={header.receivedBy} onChange={setHeaderField('receivedBy')} />
            </LabeledField>
            <LabeledField label="Prepared By" htmlFor="grn-f-prepared-by">
              <TextField id="grn-f-prepared-by" fullWidth placeholder="Enter prepared by" value={header.preparedBy} onChange={setHeaderField('preparedBy')} />
            </LabeledField>
            {/* Material Receipt Type is chosen per SKU, on each Material Receipt row. */}

            {/* Inventory destination is automatic: each line goes where its SKU
                master Item Type says (shown on the line). Only Raw Material
                needs one more answer — where it physically landed. */}
            {hasRmLine && (
              <LabeledField label="Received At *" htmlFor="grn-f-received-at" id="grn-f-received-at-label" sx={{ gridColumn: { xs: '1 / -1', sm: 'span 2' } }}>
                <TextField
                  id="grn-f-received-at" select fullWidth required
                  value={header.rmReceivedAtLocation}
                  onChange={setHeaderField('rmReceivedAtLocation')}
                  error={!header.rmReceivedAtLocation}
                  helperText="Where the Raw Material physically landed — its RM stock posts here after QC."
                  SelectProps={{ labelId: 'grn-f-received-at-label' }}
                  inputProps={{ 'data-testid': 'grn-received-at' }}
                >
                  {RECEIVED_AT_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                </TextField>
              </LabeledField>
            )}
          </Box>
        </FormSection>

        {/* Items */}
        <FormSection ref={setItemsEl} data-testid="grn-form-items" aria-disabled={itemsLocked || undefined}
          icon={<Boxes size={20} />} title="Material Receipt" tone="amber"
          badge={itemsLocked ? <Chip size="small" icon={<Lock size={12} />} label="Locked" variant="outlined" sx={{ fontWeight: 700, height: 22 }} /> : null}
          actions={isWithoutPo && !grnLocked ? (
            <Button size="small" variant="outlined" startIcon={<Plus size={14} />} onClick={addWopoItem} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Add Item
            </Button>
          ) : null}
          sx={itemsLocked ? { pointerEvents: 'none', opacity: 0.7 } : undefined}>
          {isWithoutPo ? (
            <>
              {wide && <FormTableHead columns={WOPO_HEAD} template={WOPO_ROW_COLS} align={WOPO_ALIGN} />}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: wide ? 0.5 : 1 }}>
                {items.map((it, idx) => {
                  const skuMatch = skuOptions.find((s) => s._id === it.skuId) || null;
                  return (
                    <Box key={idx} sx={{ ...rowSx(wide), ...(wide ? { gridTemplateColumns: WOPO_ROW_COLS } : {}) }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', color: PFMS.sub, lineHeight: wide ? '40px' : 1.4, textAlign: wide ? 'center' : 'left', ...(wide ? {} : fullRow) }}>
                        {wide ? idx + 1 : `Item ${idx + 1}`}
                      </Typography>
                      <Cell wide={wide} caption="Description / SKU" sx={wide ? undefined : fullRow}>
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
                            <TextField {...params} size="small" placeholder="Pick a SKU or type a name *"
                              inputProps={{ ...params.inputProps, 'aria-label': 'Description *' }} />
                          )}
                        />
                        {destinationTag(it)}
                        {conversionHint(it)}
                      </Cell>
                      <Cell wide={wide} caption="Unit">
                        <TextField size="small" fullWidth value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })} inputProps={{ 'aria-label': 'Unit' }} />
                      </Cell>
                      <Cell wide={wide} caption="Received Qty">
                        <TextField size="small" type="number" fullWidth value={it.receivedQty} sx={pfmsNoSpinSx}
                          onChange={(e) => setItem(idx, { receivedQty: e.target.value })}
                          inputProps={{ ...QTY_INPUT, 'aria-label': 'Received Qty' }} />
                      </Cell>
                      <Cell wide={wide} caption="Rate">
                        <TextField size="small" type="number" fullWidth value={it.rate} sx={pfmsNoSpinSx}
                          onChange={(e) => setItem(idx, { rate: e.target.value })}
                          inputProps={{ ...QTY_INPUT, 'aria-label': 'Rate' }} />
                      </Cell>
                      <Cell wide={wide} caption="Material Receipt Type">
                        <ReceiptTypeSelect value={it.howItemReceived} lineKey={`${it.poNumber || ''}|${it.skuCode || it.itemName}`}
                          error={!it.howItemReceived && round2(it.receivedQty) > 0}
                          onChange={(v) => setItem(idx, { howItemReceived: v })} />
                      </Cell>
                      <Cell wide={wide} caption={rmKindOf(it) ? 'Batch No *' : 'Batch No'}>
                        <TextField size="small" fullWidth
                          placeholder={rmKindOf(it) ? `required for ${rmKindOf(it)}` : 'optional'}
                          value={it.batchNo}
                          error={batchMissing(it) && round2(it.receivedQty) > 0}
                          onChange={(e) => setItem(idx, { batchNo: e.target.value })}
                          inputProps={{ 'aria-label': rmKindOf(it) ? 'Batch No *' : 'Batch No' }} />
                      </Cell>
                      <Cell wide={wide} caption="Remarks">
                        <TextField size="small" fullWidth placeholder="optional" value={it.remarks} onChange={(e) => setItem(idx, { remarks: e.target.value })}
                          inputProps={{ 'aria-label': 'Remarks' }} />
                      </Cell>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: wide ? 'center' : 'flex-end', height: wide ? 40 : 'auto', ...(wide ? {} : fullRow) }}>
                        <IconButton size="small" onClick={() => removeWopoItem(idx)} disabled={items.length <= 1} title="Remove item">
                          <Trash2 size={15} />
                        </IconButton>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
              <FormTotals items={[
                { label: 'Received Qty', value: totals.received, color: PFMS.brand },
                { label: 'Receipt Value', value: fmtINR(totals.value) },
              ]} />
            </>
          ) : items.length === 0 ? (
            <Typography sx={{ py: 2, fontSize: '0.86rem', color: PFMS.faint }}>
              {pos.length > 0 ? 'Nothing pending to receive on the selected PO(s).' : 'Select one or more eligible POs to load their items.'}
            </Typography>
          ) : (
            <>
              {/* Shown only while a line receives MORE than its PO's pending qty
                  (excess = received − pending > 0); each such line asks for its
                  own Allow Over-Receipt tick below, which the server re-checks. */}
              {overLines.length > 0 && (
                <Alert severity="warning" data-testid="grn-over-receipt-summary" sx={{ mb: 1.5 }}>
                  <b>{overLines.length === 1 ? '1 line exceeds' : `${overLines.length} lines exceed`} its pending PO quantity</b> — tick Allow Over-Receipt on {overLines.length === 1 ? 'it' : 'each'} to save:
                  {overLines.map((it) => (
                    <Box key={`${it.poId}|${it.poItemId}`} component="span" sx={{ display: 'block', mt: 0.25 }}>
                      {it.itemName}{it.skuCode ? ` (${it.skuCode})` : ''}: pending {round2(it.pendingBefore)} · received {round2(it.receivedQty)} · excess {round2(it.receivedQty - it.pendingBefore)} {it.unit || ''}
                      {it.allowOverReceipt ? ' — allowed' : ''}
                    </Box>
                  ))}
                </Alert>
              )}
              {wide && <FormTableHead columns={PO_HEAD} template={PO_ROW_COLS} align={PO_ALIGN} />}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {itemGroups.map((g, gi) => (
                  <Box key={gi}>
                    {pos.length > 1 && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.5, mb: 0.5, bgcolor: alpha('#0b2545', 0.06), borderRadius: '8px' }}>
                        <ShoppingBag size={13} color="#0b2545" />
                        <Typography variant="caption" sx={{ fontWeight: 800, color: PFMS.ink }}>PO {g.poNumber}</Typography>
                      </Box>
                    )}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: wide ? 0.5 : 1, mb: 1 }}>
                      {g.rows.map(({ it, idx }) => {
                        // Pending Qty is fixed (orderedQty − alreadyReceived), computed from the
                        // PO — read-only and never recalculated off the in-progress receivedQty.
                        const pendingBefore = round2(it.pendingBefore);
                        const extra = round2(it.receivedQty) > pendingBefore;
                        const extraQty = extra ? round2(it.receivedQty - pendingBefore) : 0;
                        return (
                          <Box key={idx} sx={{ ...rowSx(wide), ...(wide ? { gridTemplateColumns: PO_ROW_COLS } : {}) }}>
                            {wide ? (
                              <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', color: PFMS.ink, lineHeight: '24px', textAlign: 'center' }}>{idx + 1}</Typography>
                            ) : null}
                            <Box sx={{ minWidth: 0, ...(wide ? {} : fullRow) }}>
                              {!wide && <CellCaption>Item {idx + 1}</CellCaption>}
                              {descriptionCell(it)}
                              {!wide && it.skuCode ? <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: PFMS.brand, overflowWrap: 'anywhere', mt: 0.25 }}>SKU {it.skuCode}</Typography> : null}
                            </Box>
                            {wide && (
                              <Typography sx={{ fontWeight: 700, fontSize: '0.88rem', color: PFMS.brand, overflowWrap: 'anywhere', lineHeight: 1.35, pt: '2px', minWidth: 0 }}>{it.skuCode || '—'}</Typography>
                            )}
                            {wide ? (
                              <>
                                <QtyCell wide label="Ordered Qty" value={it.orderedQty} />
                                <QtyCell wide label="Already Received" value={it.previouslyReceivedQty} />
                                <QtyCell wide label="Pending Qty" value={pendingBefore} color={pendingBefore > 0 ? '#c2410c' : '#0f766e'} />
                              </>
                            ) : (
                              <Box sx={{ ...fullRow, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 1, p: 1, borderRadius: '8px', bgcolor: PFMS.surfaceAlt }}>
                                <QtyCell label="Ordered Qty" value={it.orderedQty} />
                                <QtyCell label="Already Received" value={it.previouslyReceivedQty} />
                                <QtyCell label="Pending Qty" value={pendingBefore} color={pendingBefore > 0 ? '#c2410c' : '#0f766e'} />
                              </Box>
                            )}
                            <Cell wide={wide} caption="Invoice Qty">
                              <TextField size="small" type="number" fullWidth value={it.invoiceQty} sx={pfmsNoSpinSx}
                                onChange={(e) => setItem(idx, { invoiceQty: e.target.value })}
                                helperText={`Pending: ${pendingBefore}`}
                                FormHelperTextProps={{ sx: { textAlign: 'center', mx: 0 } }}
                                inputProps={{ ...QTY_INPUT, 'aria-label': 'Invoice Qty' }} />
                            </Cell>
                            <Cell wide={wide} caption="Received Qty">
                              <TextField size="small" type="number" fullWidth value={it.receivedQty} error={extra} sx={pfmsNoSpinSx}
                                onChange={(e) => setItem(idx, { receivedQty: e.target.value })}
                                helperText={extra ? `Pending: ${pendingBefore} · Extra ${extraQty}` : `Pending: ${pendingBefore}`}
                                FormHelperTextProps={{ sx: { textAlign: 'center', mx: 0 } }}
                                inputProps={{ ...QTY_INPUT, 'aria-label': 'Received Qty' }} />
                            </Cell>
                            <Cell wide={wide} caption="Material Receipt Type">
                              <ReceiptTypeSelect value={it.howItemReceived} lineKey={`${it.poNumber || ''}|${it.skuCode || it.itemName}`}
                                error={!it.howItemReceived && round2(it.receivedQty) > 0}
                                onChange={(v) => setItem(idx, { howItemReceived: v })} />
                            </Cell>
                            {/* Required for Coil and Circle only — every other item
                                keeps the original optional field untouched. */}
                            <Cell wide={wide} caption={rmKindOf(it) ? 'Batch No *' : 'Batch No'}>
                              <TextField size="small" fullWidth
                                placeholder={rmKindOf(it) ? `required for ${rmKindOf(it)}` : 'Batch No'}
                                value={it.batchNo}
                                error={batchMissing(it) && round2(it.receivedQty) > 0}
                                onChange={(e) => setItem(idx, { batchNo: e.target.value })}
                                inputProps={{ 'aria-label': rmKindOf(it) ? 'Batch No *' : 'Batch No' }} />
                            </Cell>
                            <Cell wide={wide} caption="Remarks" sx={wide ? undefined : remarksSpan}>
                              <TextField size="small" fullWidth placeholder={extra ? 'required (extra)' : 'Remarks'} value={it.remarks}
                                onChange={(e) => setItem(idx, { remarks: e.target.value })} error={extra && !it.remarks?.trim() && !header.remarks.trim()}
                                inputProps={{ 'aria-label': 'Remarks' }} />
                            </Cell>
                            {/* Only a line that really exceeds its pending qty can be
                                over-received; the tick is per line and is dropped as soon
                                as Received Qty comes back within pending. */}
                            {extra && (
                              <Box data-testid="grn-over-receipt" data-line={`${it.poNumber || ''}|${it.skuCode || it.itemName}`}
                                sx={{ ...fullRow, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', px: 1, py: 0.25, borderRadius: '8px', bgcolor: alpha('#b45309', 0.08), border: '1px solid', borderColor: alpha('#b45309', 0.35) }}>
                                <FormControlLabel sx={{ m: 0 }}
                                  control={<Checkbox size="small" checked={Boolean(it.allowOverReceipt)} inputProps={{ 'data-testid': 'grn-allow-over-receipt' }}
                                    onChange={(e) => setItem(idx, { allowOverReceipt: e.target.checked })} />}
                                  label={<Typography variant="body2" fontWeight={700} sx={{ color: PFMS.ink }}>Allow Over-Receipt</Typography>} />
                                <Typography variant="caption" data-testid="grn-over-receipt-warning" sx={{ color: '#b45309', fontWeight: 700 }}>
                                  Warning: {it.itemName} — receiving {it.receivedQty} against {pendingBefore} pending — excess {extraQty} {it.unit || ''} over the PO.
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
              <FormTotals items={[
                { label: 'Invoice Qty', value: totals.invoice, color: PFMS.brand },
                { label: 'Received Qty', value: totals.received, color: PFMS.brand },
                { label: 'Receipt Value', value: fmtINR(totals.value) },
              ]} />
            </>
          )}
        </FormSection>

        <FormSection icon={<MessageSquareText size={20} />} title="Remarks"
          sx={remarksRequired ? { borderColor: '#b45309', bgcolor: alpha('#b45309', 0.03) } : undefined}>
          <RemarksField id="grn-f-remarks" value={header.remarks} max={REMARKS_MAX}
            onChange={(v) => setHeader((h) => ({ ...h, remarks: v }))}
            error={remarksRequired}
            placeholder="Enter remarks (optional) — add any notes about this receipt"
            helperText={remarksRequired
              ? 'Remarks are required when receiving more than the pending quantity'
              : 'Required for extra receipts'}
            inputProps={{ 'aria-label': 'GRN Remarks' }} />
        </FormSection>

        {/* Attachment (challan / invoice copy / photo) */}
        <AttachmentDrop label="Attachment (challan / invoice copy — optional)" accept={ACCEPT}
          doc={doc} uploading={uploading} hrefOf={fileHref}
          onFile={handleUpload} onRemove={() => setDoc(null)}
          onReject={() => enqueueSnackbar('Attach a PDF or an image', { variant: 'warning' })} />
        </Box>

        {/* Incoming QC — the second part of the SAME form: entered beside the GRN
            (nothing has to be saved first), saved by the same Save and completed
            together with it. A completed QC shows read-only. */}
        {!correcting && (
          <Box id="grn-form-qc" sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, scrollMarginTop: 8 }}>
            <Box data-testid="grn-form-saved-summary"
              sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', px: 2, py: 1.25, borderRadius: '10px', bgcolor: alpha(PFMS.brand, 0.06), border: `1px solid ${alpha(PFMS.brand, 0.18)}` }}>
              <ClipboardCheck size={18} color={PFMS.brand} />
              <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', color: PFMS.ink }}>Step 1.9 · Incoming QC</Typography>
              <Typography sx={{ fontSize: '0.78rem', color: PFMS.sub, flex: '1 1 200px' }}>inspect what was received above — saved with the GRN</Typography>
              {liveGrn?._id && <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', color: PFMS.ink }}>{liveGrn.grnNumber}</Typography>}
              {liveGrn?._id && <StatusChip status={liveGrn.grnStatus} />}
              {grnLocked && <Chip size="small" variant="outlined" icon={<Lock size={12} />} label="GRN read-only" sx={{ fontWeight: 700 }} />}
            </Box>
            {qcScopes.map((scope) => {
              if (!qcEditable(scope)) {
                return <GrnQcSection key={scope.key} grn={liveGrn} poId={scope.poId || undefined} poNumber={scope.poNumber} />;
              }
              const stage = qcStageOf(scope);
              const rec = qcRecordOf(scope);
              const q = qcOf(scope);
              const lines = qcItemsOf(scope);
              const balanced = allLinesBalanced(lines);
              const t = qcTotals(lines);
              const legacyStock = Boolean(liveGrn?.stockPosted) && !liveGrn?.stockPostingStage && isGrnCompleted(liveGrn);
              const nextText = !lines.length
                ? 'Enter received quantities above — every received line is inspected here.'
                : !balanced
                  ? 'Accepted + Rejected must equal Received on every line before completing.'
                  : legacyStock
                    ? `On Save & Complete: this earlier GRN already added its stock, so rejected ${t.rejected} move out of stock.`
                    : `On Save & Complete: the GRN is finalised and accepted ${t.accepted} posts to stock${t.rejected ? `; rejected ${t.rejected} never enters it` : ''}. Save as Draft keeps everything without posting.`;
              return (
                <FormSection key={scope.key} id={scope.poId ? `grn-qc-section-${scope.poId}` : 'grn-qc-section'} sx={{ scrollMarginTop: 8 }}
                  icon={<ClipboardCheck size={20} />} title={scope.poNumber ? `QC entry — PO ${scope.poNumber}` : 'QC entry'}
                  badge={(
                    <>
                      <span data-testid="grn-qc-status"><GrnQcStatusChip stage={stage} /></span>
                      {rec?.qcNumber && <Chip size="small" variant="outlined" label={rec.qcNumber} sx={{ fontWeight: 700 }} />}
                    </>
                  )}>
                  {stage.key === 'QC_DRAFT' && rec && (
                    <Alert severity="info" sx={{ mb: 2 }}>Resuming draft {rec.qcNumber} — saved {fmtDate(rec.updatedAt)}.</Alert>
                  )}
                  <QcInspectionForm
                    header={q.header} onHeaderChange={(patch) => setQc(scope, { header: { ...q.header, ...patch } })}
                    items={lines} onItemChange={(idx, patch) => setQcItem(scope, idx, patch)}
                    doc={q.doc} onDocChange={(d) => setQc(scope, { doc: d })} onUploadingChange={setQcUploading}
                    emptyText="Enter received quantities in Material Receipt above to inspect them."
                    summary={(
                      <Box data-testid="grn-qc-actions" sx={{ p: 1.5, px: 2, borderRadius: '10px', border: `1px solid ${PFMS.line}`, bgcolor: PFMS.surface }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
                          <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', color: PFMS.ink }}>Expected result</Typography>
                          <QcResultChip result={lines.length ? expectedQcResult(lines) : ''} />
                          <Typography sx={{ fontSize: '0.86rem', fontWeight: 600, color: balanced ? PFMS.ink : 'error.main' }}>
                            · {lines.length} line(s) · {balanced ? 'balanced' : 'not balanced'}
                          </Typography>
                        </Box>
                        <Typography data-testid="grn-qc-next" sx={{ mt: 0.5, fontSize: '0.8rem', color: PFMS.sub }}>{nextText}</Typography>
                      </Box>
                    )} />
                </FormSection>
              );
            })}
          </Box>
        )}
      </FormDialogBody>

      {/* Footer — fixed. ONE Save path: a draft of GRN + QC, or both completed. */}
      <FormDialogFooter summary={correcting
        ? <>Editing {current?.grnNumber || 'GRN'} · {validItems.length} item(s) · received {totals.received} · {fmtINR(totals.value)} · Incoming QC: <b>{qcStage.label}</b></>
        : (
          <>
            {grnLocked
              ? `GRN ${current?.grnNumber || ''} completed`
              : `${validItems.length} item(s) · received ${totals.received} · ${fmtINR(totals.value)}`}
            {editableScopes.length > 0 ? ` · accepted ${qcFooterTotals.accepted} · rejected ${qcFooterTotals.rejected}` : ''}
            {' · '}Incoming QC: <Box component="b" sx={{ color: qcStageTone.fg }}>{qcStage.label}</Box>
          </>
        )}>
        {/* Second arg = the draft created in this session, so the caller can open it. */}
        <Button variant="outlined" onClick={closeForm} disabled={busy}>
          {savedGrn || allQcDone ? 'Close' : 'Cancel'}
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
        {!correcting && !allQcDone && (
          <Button variant="outlined" data-testid="grn-save-draft"
            startIcon={saving && !completing ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
            onClick={() => saveAll(false)} disabled={busy}
            title="Saves the GRN and its QC as they are — nothing is completed and no stock is posted">
            Save as Draft
          </Button>
        )}
        {!correcting && !allQcDone && (
          <Button variant="contained" color="success" data-testid="grn-save-complete"
            startIcon={completing ? <CircularProgress size={16} color="inherit" /> : <ClipboardCheck size={16} />}
            onClick={() => saveAll(true)} disabled={busy}
            title="Saves, completes the GRN and completes its Incoming QC — accepted quantities are posted to stock">
            {grnLocked ? 'Save & Complete QC' : 'Save & Complete GRN + QC'}
          </Button>
        )}
      </FormDialogFooter>

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
    </PfmsFormDialog>
  );
};

export default GrnFormDialog;
