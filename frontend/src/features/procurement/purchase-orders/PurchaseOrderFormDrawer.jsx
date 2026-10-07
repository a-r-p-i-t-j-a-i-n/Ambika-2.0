import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog, Box, Typography, TextField, Button, IconButton, Divider,
  Grid, MenuItem, Autocomplete, CircularProgress, Paper, Tooltip, Chip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { X, Save, ShoppingBag, Plus, Trash2, Building2, FileText, AlertTriangle, Eye, CheckCircle2 } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { usePermissions } from '../../../hooks/usePermission';
import {
  useGetIndentsQuery,
  useGetAllApprovedItemsQuery,
  useCreatePurchaseOrderMutation,
  useCreatePurchaseOrderFromItemsMutation,
  useUpdatePurchaseOrderMutation,
  useRevisePurchaseOrderMutation,
  usePreviewPurchaseOrderPdfMutation,
} from '../../../store/api/procurementApi';
import { useGetVendorsQuery, useGetVendorByIdQuery } from '../../../store/api/vendorApi';
import { fmtINR, poDisplayNumber } from './poMeta';
import { PFMS, pfmsCardSx } from '../pfmsTheme';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import PurchaseOrderPdfPreview from './PurchaseOrderPdfPreview';
import AddVendorForItemModal from './AddVendorForItemModal';
import { norm, matchVendorProduct, fillOtherRates } from './vendorRateMatch';
import { itemRef } from '../indents/indentMeta';

/**
 * Create / edit a Vendor Purchase Order (Step 1.4).
 *
 * Business rule: POs are NEVER standalone — an indent with an approved
 * quotation (QUOTATION_APPROVED / PO_READY) must be selected first.
 * Vendors come from the Vendor Master (GET /api/v1/vendors); selecting a vendor
 * auto-fills GST/PAN/address/terms and product rates from `vendor.products`.
 * Legacy POs created from the Party master still display & resolve correctly —
 * the backend (resolveVendor) accepts either a Vendor or a Party id.
 */
const UNITS = ['Pcs', 'Kg', 'Meter', 'Roll', 'Box', 'Set', 'Litre', 'Dozen'];
const JSL_UNITS = ['Kgs', 'MT', 'Pcs', 'Nos', 'Meter'];

// Hide the native number-input spinner arrows so the digits use the full cell width.
const NO_SPIN = {
  '& input[type=number]': { MozAppearance: 'textfield' },
  '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': {
    WebkitAppearance: 'none', margin: 0,
  },
};
const GST_PRESETS = [0, 5, 12, 18, 28];
const todayStr = () => new Date().toISOString().slice(0, 10);

// Origin of an OTHER line's rate — only a user edit (MANUAL) is written back to
// the Vendor Master / Pricing History when the PO is approved.
const rateSourceOf = (it) => {
  if (it.rateEdited) return 'MANUAL';
  if (it.fromQuotation) return 'APPROVED_QUOTATION';
  if (it.autoRate != null) return 'VENDOR_MASTER';
  return it.rateSource || '';
};

const emptyItem = () => ({ itemName: '', skuCode: '', skuId: '', quantity: '', unit: 'Pcs', rate: '', gstRate: 18, hsn: '', indentId: '', indentNumber: '', indentItemId: '', indentItemDisplayNumber: '', approvedQuantity: 0, fromApprovedItem: false, rateMatched: undefined, manual: false });
const emptyJslItem = () => ({ grade: '', width: '1250', finish: '2B/ME', quantity: '', unit: 'Kgs', baseRate: '', upfrontDiscount: '', bonanzaDiscount: '' });
const emptyItemFor = (fmt) => (fmt === 'JSL' ? emptyJslItem() : emptyItem());

// ── JSL auto-vendor + rate fetch helpers (Step 1.4) ──────────────────────────
// JSL POs are always raised on Jindal Stainless Ltd; rates/specs are pulled from
// that vendor's catalog in the Vendor Master.
const JSL_VENDOR_NAME = 'Jindal Stainless Ltd';

// Locate the Jindal vendor in the Vendor-Master list (tolerant of naming variants).
const findJslVendor = (vendors = []) =>
  vendors.find((v) => norm(v.name) === norm(JSL_VENDOR_NAME)) ||
  vendors.find((v) => norm(v.name).includes('jindal'));

// Best-effort parse of grade / width / finish out of an item name + vendor notes.
const JSL_FINISHES = ['No.1', 'No.4', 'No.8', '2B', '2D', '1D', 'BA', 'HR', 'CR', 'Mirror', 'Matt'];
const parseJslSpec = (...texts) => {
  const text = texts.filter(Boolean).join(' ');
  const out = { grade: '', width: '', finish: '' };
  if (!text) return out;
  for (const f of JSL_FINISHES) {
    const re = new RegExp(`(^|[\\s\\-_/(])${f.replace('.', '\\.')}([\\s\\-_/)]|$)`, 'i');
    if (re.test(text)) { out.finish = f; break; }
  }
  const w = text.match(/(\d{2,4}(?:\.\d+)?)\s*mm\b/i) || text.match(/\bW[:\-]?\s*(\d{2,4})\b/i) || text.match(/[x×]\s*(\d{2,4})\b/i);
  if (w) out.width = w[1];
  const g = text.match(/\b(?:SS\s*)?(\d{3}[A-Z]?|J\d|2205|2507|DUPLEX|JSLU?\w*)\b/i);
  if (g) out.grade = (g[1] || '').toUpperCase();
  return out;
};

const JSL_GST = 18;
const lineCalc = (it) => {
  const taxable = (Number(it.quantity) || 0) * (Number(it.rate) || 0);
  const tax = taxable * (Number(it.gstRate) || 0) / 100;
  return { taxable, tax, total: taxable + tax };
};
const jslLineCalc = (it) => {
  const finalPrice = (Number(it.baseRate) || 0) - (Number(it.upfrontDiscount) || 0) - (Number(it.bonanzaDiscount) || 0);
  const value = (Number(it.quantity) || 0) * finalPrice;
  return { finalPrice, value };
};

const SECTION = { p: 2.5, ...pfmsCardSx };
const OTHER_GRID = '1.7fr 0.85fr 0.7fr 0.95fr 0.7fr 0.8fr 0.8fr 0.65fr 0.85fr 36px';
const JSL_GRID = '1.1fr 0.7fr 0.9fr 0.8fr 0.6fr 0.85fr 0.85fr 0.9fr 0.9fr 0.8fr 0.85fr 36px';

const PurchaseOrderFormDrawer = ({ open, onClose, po = null, presetIndent = null, reviseFrom = null }) => {
  const { enqueueSnackbar } = useSnackbar();
  const isEdit = Boolean(po?._id);
  const isRevise = Boolean(reviseFrom?._id);
  // The PO whose data prefills the form (edit target or the cancelled PO to revise).
  const sourcePo = po || reviseFrom;
  const isCreate = !isEdit && !isRevise;

  // "Save PO Directly" skips the approval step, so it's only offered when PO
  // approval isn't required — the creator already holds PO approval authority
  // (procurement.approve). The server enforces the same rule.
  const { can } = usePermissions();
  const canDirectSave = can('procurement.approve');
  const [pendingMode, setPendingMode] = useState(''); // which create button is saving

  // Tracks which indent the JSL rows were last auto-built for, so a late-loading
  // vendor catalog re-matches rates without wiping manual edits or rebuilding.
  const builtJslIndentRef = useRef('__none__');

  const [indent, setIndent] = useState(null);
  const [selectedApprovedItems, setSelectedApprovedItems] = useState([]); // New PO item-picker (OTHER create)
  const [vendor, setVendor] = useState(null);
  const [poFormatType, setPoFormatType] = useState('OTHER'); // 'JSL' | 'OTHER'
  const [approvedVendors, setApprovedVendors] = useState([]); // from Step 1.3 (multi-vendor)
  const [approvedVendorId, setApprovedVendorId] = useState('');
  const [header, setHeader] = useState({
    poDate: todayStr(), leadTime: '', deliveryTerms: '', paymentTerms: '', creditPeriod: 0, remarks: '',
  });
  const [items, setItems] = useState([emptyItem()]);

  // Draft PDF preview (no save) — holds the temporary blob URL.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');

  const [createPo, { isLoading: creating }] = useCreatePurchaseOrderMutation();
  const [createFromItems, { isLoading: creatingItems }] = useCreatePurchaseOrderFromItemsMutation();
  const [updatePo, { isLoading: updating }] = useUpdatePurchaseOrderMutation();
  const [revisePo, { isLoading: revising }] = useRevisePurchaseOrderMutation();
  const [previewPdf, { isLoading: previewing }] = usePreviewPurchaseOrderPdfMutation();
  const saving = creating || creatingItems || updating || revising;

  // Edit + revise prefill from an existing PO and keep their copied rates (no
  // catalog auto-fill clobbering). Revise still produces a NEW record on save.
  const lockRates = isEdit || isRevise;

  // New PO (create) selects approved ITEMS individually (item-wise PO across
  // indents), not a whole indent — for BOTH OTHER and JSL formats. Edit/revise keep
  // the prefilled-item flow; multi-vendor (Step 1.3) preset indents keep the vendor flow.
  const approvedItemMode = !isEdit && !isRevise && approvedVendors.length === 0;

  // PO-eligible indents: QUOTATION_APPROVED (not yet PO'd) plus PO_READY indents
  // that still have an approved vendor awaiting a PO (multi-vendor — one PO per vendor).
  const { data: approvedRes, isLoading: approvedLoading } = useGetIndentsQuery(
    { limit: 200, sort: '-createdAt', overallStatus: 'QUOTATION_APPROVED' },
    { skip: !open || isEdit },
  );
  const { data: poReadyRes, isLoading: poReadyLoading } = useGetIndentsQuery(
    { limit: 200, sort: '-createdAt', overallStatus: 'PO_READY' },
    { skip: !open || isEdit },
  );
  // Global approved-item options for the New PO item-picker (OTHER create only).
  const { data: approvedItemsRes, isLoading: approvedItemsLoading } = useGetAllApprovedItemsQuery(
    undefined,
    { skip: !open || !approvedItemMode },
  );
  const approvedItemOptions = approvedItemsRes?.data?.items || [];

  const indentsLoading = approvedLoading || poReadyLoading;
  const indentOptions = useMemo(() => {
    const approved = approvedRes?.data || [];
    // PO_READY only when ≥1 approved vendor has no PO yet (else it's fully done).
    const poReady = (poReadyRes?.data || []).filter(
      (ind) => (ind.quotationApprovalStep?.approvedVendors || []).some((v) => !v.poId),
    );
    return [...approved, ...poReady];
  }, [approvedRes, poReadyRes]);

  const { data: vendorsRes, isLoading: vendorsLoading } = useGetVendorsQuery(
    { limit: 500, sort: 'name' },
    { skip: !open },
  );
  const vendorOptions = vendorsRes?.data || [];

  // Authoritative catalog: fetch the selected vendor by id (GET /api/v1/vendors/:id)
  // so rate/GST/HSN come straight from the Vendor Master, not a possibly-trimmed
  // list payload. Falls back to the list record while the detail request loads.
  const { data: vendorByIdRes } = useGetVendorByIdQuery(vendor?._id, { skip: !open || !vendor?._id });
  const vendorFull = vendorByIdRes?.data;
  const vendorProducts = useMemo(
    () => vendorFull?.products || vendor?.products || [],
    [vendorFull, vendor],
  );

  // Hydrate on open.
  useEffect(() => {
    if (!open) return;
    builtJslIndentRef.current = '__none__';
    if (sourcePo) {
      // Prefill from the edit target OR the cancelled PO being revised.
      setIndent({ _id: sourcePo.indentId, indentNumber: sourcePo.indentNumber });
      const v = vendorOptions.find((p) => p._id === (sourcePo.vendorId?._id || sourcePo.vendorId));
      setVendor(v || { _id: sourcePo.vendorId?._id || sourcePo.vendorId, name: sourcePo.vendorName });
      setHeader({
        poDate: isRevise ? todayStr() : (sourcePo.poDate ? sourcePo.poDate.slice(0, 10) : todayStr()),
        leadTime: sourcePo.leadTime || '', deliveryTerms: sourcePo.deliveryTerms || '',
        paymentTerms: sourcePo.paymentTerms || '', creditPeriod: sourcePo.creditPeriod || 0,
        remarks: sourcePo.remarks || '',
      });
      const fmt = sourcePo.poFormatType === 'JSL' ? 'JSL' : 'OTHER';
      setPoFormatType(fmt);
      setItems(sourcePo.items?.length ? sourcePo.items.map((it) => (fmt === 'JSL' ? {
        grade: it.grade || '', width: it.width || '', finish: it.finish || '',
        skuCode: it.skuCode || '', skuId: it.skuId || '', itemName: it.itemName || '',
        quantity: it.quantity, unit: it.unit || 'Kgs',
        baseRate: it.baseRate ?? '', upfrontDiscount: it.upfrontDiscount ?? '', bonanzaDiscount: it.bonanzaDiscount ?? '',
        indentId: it.indentId || '', indentNumber: it.indentNumber || '',
        indentItemId: it.indentItemId || '', indentItemDisplayNumber: it.indentItemDisplayNumber || '',
        manual: true, rateMatched: true,
      } : {
        itemName: it.itemName, skuCode: it.skuCode || '', skuId: it.skuId || '',
        quantity: it.quantity, unit: it.unit || 'Pcs', rate: it.rate, gstRate: it.gstRate,
        hsn: it.hsn || '',
        indentId: it.indentId || '', indentNumber: it.indentNumber || '',
        indentItemId: it.indentItemId || '', indentItemDisplayNumber: it.indentItemDisplayNumber || '',
        manual: true, rateMatched: true,
        rateSource: it.rateSource || '', rateEdited: it.rateSource === 'MANUAL',
      })) : [emptyItemFor(fmt)]);
    } else {
      setIndent(null); setVendor(null); setApprovedVendors([]); setApprovedVendorId('');
      setSelectedApprovedItems([]);
      setPoFormatType('OTHER');
      setHeader({ poDate: todayStr(), leadTime: '', deliveryTerms: '', paymentTerms: '', creditPeriod: 0, remarks: '' });
      setItems([emptyItem()]);
      // Preset multi-vendor (Step 1.3) indents keep the legacy approved-vendor path;
      // simple/item-level preset indents are pre-selected in the item-picker once the
      // global approved-items list loads (handled by the preset effect below).
      if (presetIndent && (presetIndent?.quotationApprovalStep?.approvedVendors?.length || 0) > 0) {
        applyIndent(presetIndent);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po, presetIndent, reviseFrom]);

  // JSL auto-flow (create): force Jindal Stainless Ltd as the vendor and fill any
  // missing base rates from its catalog as the catalog (or selection) loads. Rows
  // themselves come from the shared Approved Item(s) picker — JSL no longer builds
  // from a whole indent. Never runs in edit/revise mode so copied POs are left as-is.
  useEffect(() => {
    if (!open || lockRates || poFormatType !== 'JSL') return;
    const jindal = findJslVendor(vendorOptions);
    if (!jindal) return; // catalog list not loaded yet — effect re-runs when it arrives
    if (vendor?._id !== jindal._id) applyJslVendorTerms(jindal);
    // Fill missing rates from the (possibly late-loaded) catalog, keeping manual edits.
    const products = vendorProducts.length ? vendorProducts : (jindal.products || []);
    setItems((cur) => fillJslRates(cur, { products }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lockRates, poFormatType, vendorOptions, vendorProducts, selectedApprovedItems]);

  // The indent's source line items (multi-item, with a legacy single-product fallback).
  const indentSourceItems = (ind) => {
    if (!ind) return [];
    return ind.items?.length
      ? ind.items
      : (ind.productNameRevised
        ? [{ itemName: ind.productNameRevised, skuCode: ind.skuCode, skuId: ind.skuId, unit: ind.unit, approvedQuantity: ind.approvedQuantity, quantity: ind.quantity }]
        : []);
  };

  // The Jindal catalog used for JSL rate matching — prefer the full fetched catalog
  // (when Jindal is the selected vendor), else the list record's products.
  const jslProducts = () => {
    const jindal = findJslVendor(vendorOptions);
    if (vendor?._id && jindal && String(vendor._id) === String(jindal._id) && vendorProducts.length) return vendorProducts;
    return jindal?.products || [];
  };

  // Map one approved-item option → an OTHER PO row (name/SKU read-only downstream).
  const buildOtherRowFromApproved = (o) => ({
    ...emptyItem(),
    itemName: o.itemName || '',
    skuCode: o.skuCode || '',
    skuId: o.skuId || '',
    quantity: o.approvedQuantity || '',
    unit: o.unit || 'Pcs',
    indentId: o.indentId || '',
    indentNumber: o.indentNumber || '',
    indentItemId: o.indentItemId || '',
    indentItemDisplayNumber: o.indentItemDisplayNumber || o.itemDisplayNumber || '',
    approvedQuantity: o.approvedQuantity || 0,
    fromApprovedItem: true,
  });

  // Map one approved-item option → a JSL PO row: parse grade/width/finish from the
  // item name + vendor notes, auto-fill base rate/unit from the Jindal catalog.
  const buildJslRowFromApproved = (o, products = []) => {
    const match = matchVendorProduct(products, { skuCode: o.skuCode, itemName: o.itemName });
    const spec = parseJslSpec(o.itemName, match?.notes);
    return {
      ...emptyJslItem(),
      grade:  spec.grade || o.itemName || '',
      width:  spec.width || '1250',
      finish: spec.finish || '2B/ME',
      quantity: o.approvedQuantity || '',
      // Prefer the Jindal vendor-catalog unit (the actual master data for JSL
      // items) over the indent's unit — the indent's generic Unit dropdown
      // (Pcs/Kg/Meter/...) doesn't cover JSL-specific units (Kgs/MT/Nos), so it
      // silently normalizes those to "Pcs" at indent-creation time.
      unit: match?.unit || o.unit || 'Kgs',
      baseRate: match ? (match.rate ?? 0) : 0,
      gstRate: JSL_GST,
      itemName: o.itemName || '',
      skuCode: o.skuCode || match?.skuCode || '',
      skuId: o.skuId || match?.skuId || '',
      indentId: o.indentId || '',
      indentNumber: o.indentNumber || '',
      indentItemId: o.indentItemId || '',
      indentItemDisplayNumber: o.indentItemDisplayNumber || o.itemDisplayNumber || '',
      approvedQuantity: o.approvedQuantity || 0,
      fromApprovedItem: true,
      rateMatched: !!match,
      manual: false,
    };
  };

  // Build PO rows from the selected approved items in the current format's shape.
  const buildRowsFromApproved = (vals, fmt) => {
    if (!vals.length) return [emptyItemFor(fmt)];
    return fmt === 'JSL'
      ? vals.map((o) => buildJslRowFromApproved(o, jslProducts()))
      : vals.map(buildOtherRowFromApproved);
  };

  // Re-fill rates from the (possibly late-loaded) catalog WITHOUT touching rows
  // the user manually edited or rows that already have a rate.
  const fillJslRates = (rows, vendorObj) => {
    const products = vendorObj?.products || [];
    return rows.map((it) => {
      if (it.manual) return it;
      const match = matchVendorProduct(products, { skuCode: it.skuCode, itemName: it.itemName });
      if (!match) return { ...it, rateMatched: it.rateMatched ?? false };
      const hasRate = it.baseRate !== '' && Number(it.baseRate) > 0;
      return {
        ...it,
        baseRate: hasRate ? it.baseRate : (match.rate ?? it.baseRate),
        unit: it.unit || match.unit || 'Kgs',
        rateMatched: true,
      };
    });
  };

  // JSL vendor terms — snapshot Jindal's credit/lead/payment defaults.
  const applyJslVendorTerms = (v) => {
    setVendor(v);
    setHeader((h) => ({
      ...h,
      creditPeriod: v.creditPeriodDays ?? h.creditPeriod,
      leadTime: h.leadTime || (v.leadTimeDays ? `${v.leadTimeDays} days` : ''),
      paymentTerms: h.paymentTerms || (v.creditPeriodDays ? `${v.creditPeriodDays} days credit` : ''),
    }));
  };

  // Seed PO lines from the indent's approved items (multi-item, with a
  // legacy single-product fallback). Uses approved → revised → requested qty.
  const applyIndent = (ind) => {
    setIndent(ind);
    // JSL: vendor stays Jindal; items + rates are rebuilt by the auto-vendor effect.
    if (poFormatType === 'JSL') {
      builtJslIndentRef.current = '__none__';
      return;
    }
    // Multi-vendor (Step 1.3) approved vendors drive the vendor picker when present.
    const avs = ind?.quotationApprovalStep?.approvedVendors || [];
    setApprovedVendors(avs);
    setApprovedVendorId('');
    if (avs.length) {
      // Auto-select the only vendor still awaiting a PO, if there is exactly one.
      const pending = avs.filter((v) => !v.poId);
      if (pending.length === 1) applyApprovedVendor(pending[0]);
      return; // items are set by applyApprovedVendor; skip the indent-item seeding
    }
    if (!ind) return;
    setItems((cur) => {
      const hasContent = cur.some((it) => it.itemName);
      if (hasContent) return cur;
      const lines = indentSourceItems(ind).map((it, idx) => ({
        ...emptyItem(),
        itemName: it.itemName || '',
        skuCode: it.skuCode || '',
        skuId: it.skuId || '',
        quantity: it.approvedQuantity || it.revisedQuantity || it.quantity || '',
        unit: it.unit || 'Pcs',
        indentItemId: it._id || '',
        indentItemDisplayNumber: itemRef(ind.indentNumber, it, idx),
      }));
      return lines.length ? lines : cur;
    });
  };

  // Multi-vendor: select one approved vendor (Step 1.3) → prefill that vendor's
  // approved items (qty/rate/gst). One PO is created per approved vendor.
  const applyApprovedVendor = (av) => {
    if (!av) { setApprovedVendorId(''); setVendor(null); setItems([emptyItem()]); return; }
    const vid = av.vendorId?._id || av.vendorId || '';
    setApprovedVendorId(vid);
    const party = vendorOptions.find((p) => p._id === vid);
    const v = party || { _id: vid, name: av.vendorName };
    setVendor(v);
    if (party) {
      setHeader((h) => ({
        ...h,
        creditPeriod: party.creditPeriodDays ?? h.creditPeriod,
        leadTime: h.leadTime || (party.leadTimeDays ? `${party.leadTimeDays} days` : ''),
        paymentTerms: h.paymentTerms || (party.creditPeriodDays ? `${party.creditPeriodDays} days credit` : ''),
      }));
    }
    const lines = (av.items || []).map((it) => ({
      ...emptyItem(),
      itemName: it.itemName || '',
      skuCode: it.skuCode || '',
      skuId: it.skuId?._id || it.skuId || '',
      quantity: it.approvedQty || '',
      unit: it.unit || 'Pcs',
      rate: it.approvedRate ?? '',
      gstRate: it.gstRate ?? 18,
      // Approved-quotation rates are negotiated — keep them; don't overwrite from
      // the Vendor Master catalog (and don't treat them as a user rate edit).
      manual: true,
      fromQuotation: true,
    }));
    setItems(lines.length ? lines : [emptyItem()]);
  };

  // Vendor select: snapshot terms only. Item rate/GST/HSN auto-fill is handled
  // reactively by the OTHER auto-fill effect below (re-runs on vendor / item /
  // SKU change), so the catalog match logic lives in one place.
  const applyVendor = (v) => {
    setVendor(v);
    if (!v) return;
    setHeader((h) => ({
      ...h,
      creditPeriod: v.creditPeriodDays ?? h.creditPeriod,
      leadTime: h.leadTime || (v.leadTimeDays ? `${v.leadTimeDays} days` : ''),
      paymentTerms: h.paymentTerms || (v.creditPeriodDays ? `${v.creditPeriodDays} days credit` : ''),
    }));
  };

  // New PO item-picker (OTHER + JSL create): selecting approved items builds the PO
  // item table directly — one read-only row per selected item, qty preset to the
  // approved quantity, rows shaped to the current format. Rates auto-fill from the
  // Vendor Master (OTHER) / Jindal catalog (JSL). The same indent's other items stay
  // available for separate POs.
  const applyApprovedItems = (vals) => {
    setSelectedApprovedItems(vals);
    setItems(buildRowsFromApproved(vals, poFormatType));
  };

  // Preset indent (opened from Indent Detail / list): pre-select that indent's
  // approved items in the picker once the global list loads. Runs once per open.
  const presetAppliedRef = useRef(false);
  useEffect(() => {
    if (!open) { presetAppliedRef.current = false; return; }
    if (!approvedItemMode || !presetIndent?._id || presetAppliedRef.current) return;
    if (!approvedItemOptions.length) return;
    const mine = approvedItemOptions.filter((o) => String(o.indentId) === String(presetIndent._id));
    if (mine.length) { applyApprovedItems(mine); presetAppliedRef.current = true; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, approvedItemMode, presetIndent, approvedItemOptions]);

  // Log exactly why a rate couldn't be auto-fetched — pinpoints whether it's a
  // wrong vendor, a missing SKU, a SKU/case mismatch, or a product absent from
  // the Vendor Master.
  const logNoRate = (line, reason) => {
    // eslint-disable-next-line no-console
    console.warn('[PO rate auto-fill] Rate not fetched from Vendor Master', {
      vendorId: vendor?._id || '(none)',
      vendorName: vendor?.name || '(none)',
      itemSku: line.skuCode || '(none)',
      itemName: line.itemName || '(none)',
      matchedVendorProduct: null,
      reason,
    });
  };

  // Signature of the matchable fields — drives re-matching when items / SKUs change.
  const otherMatchKey = useMemo(
    () => (poFormatType === 'JSL' ? '' : items.map((it) => `${it.skuCode || ''}|${it.skuId || ''}|${norm(it.itemName)}`).join('§')),
    [items, poFormatType],
  );

  // OTHER auto-fill: re-run vendor-catalog matching whenever the vendor, its
  // catalog, the indent, the items, or a SKU changes. Skipped in edit/revise mode
  // so copied PO rates are never clobbered. No page refresh — pure state update.
  useEffect(() => {
    if (!open || lockRates || poFormatType === 'JSL') return;
    if (!vendorProducts.length) return;
    setItems((cur) => fillOtherRates(cur, vendorProducts, logNoRate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lockRates, poFormatType, vendorProducts, otherMatchKey]);

  const setItem = (idx, patch) => setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const addItem = () => setItems((cur) => [...cur, emptyItemFor(poFormatType)]);
  const removeItem = (idx) => setItems((cur) => (cur.length > 1 ? cur.filter((_, i) => i !== idx) : [emptyItemFor(poFormatType)]));
  // Approved-item rows: drop the row AND its picker selection (preserve other edits).
  const removeApprovedRow = (idx) => {
    const target = items[idx];
    setSelectedApprovedItems((cur) => cur.filter((o) => String(o.indentItemId) !== String(target?.indentItemId)));
    setItems((cur) => cur.filter((_, i) => i !== idx));
  };

  // Switching format keeps the selected approved items and just remaps the rows to
  // the new shape (OTHER ⇄ JSL) — no reset, no page reload. JSL also drops any
  // multi-vendor approved selection (JSL always uses Jindal, auto-selected by the
  // JSL effect). In edit mode this control isn't shown.
  const handleFormatChange = (next) => {
    if (next === poFormatType) return;
    builtJslIndentRef.current = '__none__';
    setIndent(null);
    if (next === 'JSL') {
      setApprovedVendors([]); setApprovedVendorId('');
    }
    setPoFormatType(next);
    setItems(buildRowsFromApproved(selectedApprovedItems, next));
  };

  const isJsl = poFormatType === 'JSL';

  // Vendor filter (New PO item-picker): the vendor dropdown is limited to Vendor
  // Master records whose catalog (products[]) carries EVERY selected item's SKU —
  // i.e. vendors we can actually buy all the chosen items from. JSL is exempt (it
  // is always Jindal). `null` = no restriction (no items selected yet, or JSL).
  const selectedSkuCodes = useMemo(
    () => [...new Set(selectedApprovedItems.map((it) => String(it.skuCode || '').toUpperCase()).filter(Boolean))],
    [selectedApprovedItems],
  );
  const skuFilteredVendors = useMemo(() => {
    if (!approvedItemMode || isJsl || !selectedSkuCodes.length) return null;
    const hasSku = (v, sku) => (v.products || []).some((p) => String(p.skuCode || '').toUpperCase() === sku);
    return vendorOptions.filter((v) => selectedSkuCodes.every((sku) => hasSku(v, sku)));
  }, [approvedItemMode, isJsl, selectedSkuCodes, vendorOptions]);

  const vendorOptionsFiltered = skuFilteredVendors || vendorOptions;
  // No Vendor Master record carries the selected SKU(s) → prompt to add one.
  const noVendorForSku = skuFilteredVendors !== null && skuFilteredVendors.length === 0;

  const [addVendorOpen, setAddVendorOpen] = useState(false);

  // Auto-select when exactly one vendor matches; drop a vendor that no longer
  // covers the selected SKUs once the item selection changes.
  useEffect(() => {
    if (isJsl || !skuFilteredVendors) return;
    if (skuFilteredVendors.length === 1) {
      if (vendor?._id !== skuFilteredVendors[0]._id) applyVendor(skuFilteredVendors[0]);
    } else if (vendor?._id && !skuFilteredVendors.some((v) => v._id === vendor._id)) {
      setVendor(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuFilteredVendors]);

  // After adding a vendor for the selected item(s): select it and auto-fill rates.
  const handleVendorAdded = (added) => {
    if (added?._id) applyVendor(added);
  };

  const totals = useMemo(() => {
    if (isJsl) {
      const taxable = items.reduce((s, it) => s + jslLineCalc(it).value, 0);
      const tax = taxable * JSL_GST / 100;
      return { taxable, tax, grand: taxable + tax };
    }
    const t = items.reduce((acc, it) => {
      const { taxable, tax } = lineCalc(it);
      return { taxable: acc.taxable + taxable, tax: acc.tax + tax };
    }, { taxable: 0, tax: 0 });
    return { ...t, grand: t.taxable + t.tax };
  }, [items, isJsl]);

  const validItems = isJsl
    ? items.filter((it) => Number(it.quantity) > 0 && (it.grade?.trim() || it.finish?.trim() || it.width?.trim()))
    : items.filter((it) => it.itemName?.trim() && Number(it.quantity) > 0);

  // Shared PO payload (vendor snapshot + terms + items) used by save AND preview.
  const buildPayload = () => ({
    vendorId: vendor?._id,
    poFormatType,
    poDate: header.poDate,
    vendorName: vendor?.name || '',
    vendorGST: vendor?.gstNo || '',
    vendorPAN: vendor?.panNo || '',
    vendorAddress: vendor?.location || vendor?.address || '',
    vendorEmail: vendor?.email || '',
    vendorPhone: vendor?.phone || '',
    deliveryTerms: header.deliveryTerms.trim(),
    paymentTerms: header.paymentTerms.trim(),
    leadTime: header.leadTime.trim(),
    creditPeriod: Number(header.creditPeriod) || 0,
    remarks: header.remarks.trim(),
    items: validItems.map((it) => (isJsl ? {
      grade: it.grade?.trim() || '', width: it.width?.trim() || '', finish: it.finish?.trim() || '',
      itemName: it.itemName?.trim() || '',
      skuCode: it.skuCode?.trim() || '', skuId: it.skuId || undefined,
      indentId: it.indentId || undefined, indentNumber: it.indentNumber || '',
      indentItemId: it.indentItemId || undefined,
      indentItemDisplayNumber: it.indentItemDisplayNumber || '',
      quantity: Number(it.quantity), unit: it.unit || 'Kgs',
      baseRate: Number(it.baseRate) || 0,
      upfrontDiscount: Number(it.upfrontDiscount) || 0,
      bonanzaDiscount: Number(it.bonanzaDiscount) || 0,
    } : {
      itemName: it.itemName.trim(), skuCode: it.skuCode?.trim() || '',
      skuId: it.skuId || undefined, hsn: it.hsn?.trim() || '',
      indentId: it.indentId || undefined, indentNumber: it.indentNumber || '',
      indentItemId: it.indentItemId || undefined,
      indentItemDisplayNumber: it.indentItemDisplayNumber || '',
      quantity: Number(it.quantity), unit: it.unit || 'Pcs',
      rate: Number(it.rate) || 0, gstRate: Number(it.gstRate) || 0,
      rateSource: rateSourceOf(it),
    })),
  });

  // Preview PDF — render a temporary PDF from the current form, no DB save.
  const handlePreview = async () => {
    if (validItems.length === 0) {
      enqueueSnackbar(isJsl ? 'Add at least one item with grade and quantity to preview' : 'Add at least one item to preview', { variant: 'warning' });
      return;
    }
    try {
      const blob = await previewPdf(buildPayload()).unwrap();
      // Guard against an error body that slipped through as JSON instead of a PDF.
      if (!(blob instanceof Blob) || blob.type === 'application/json') {
        throw new Error('Preview did not return a PDF');
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPreviewOpen(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || err?.message || 'Failed to generate PDF preview', { variant: 'error' });
    }
  };

  const closePreview = () => {
    setPreviewOpen(false);
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(''); }
  };

  // saveMode: 'DRAFT' (default) | 'DIRECT' — only meaningful for a new PO.
  const handleSubmit = async (saveMode = 'DRAFT') => {
    if (!vendor?._id) { enqueueSnackbar('Vendor is mandatory', { variant: 'warning' }); return; }
    if (approvedItemMode) {
      if (!selectedApprovedItems.length) { enqueueSnackbar('Select at least one approved item', { variant: 'warning' }); return; }
    } else if (!isEdit && !isRevise && !indent?._id) {
      enqueueSnackbar('Select an approved indent first', { variant: 'warning' }); return;
    }
    if (validItems.length === 0) {
      enqueueSnackbar(isJsl ? 'Add at least one item with grade and quantity' : 'Add at least one item with quantity', { variant: 'warning' });
      return;
    }
    // Item-picker qty must stay within the approved quantity.
    if (approvedItemMode) {
      const badQty = validItems.find((it) => Number(it.quantity) > Number(it.approvedQuantity || 0));
      if (badQty) {
        enqueueSnackbar(`Qty for "${badQty.itemName}" cannot exceed approved ${badQty.approvedQuantity}`, { variant: 'warning' });
        return;
      }
    }

    const payload = buildPayload();
    const direct = isCreate && saveMode === 'DIRECT' && canDirectSave;
    // A direct save comes back APPROVED with its final number; if the server's
    // approval step didn't go through, the PO is still saved as a draft.
    const notifyCreated = (saved) => {
      if (saved?.approvalStatus === 'APPROVED') {
        enqueueSnackbar(`PO ${poDisplayNumber(saved)} created — approved and ready to release`, { variant: 'success' });
      } else if (direct) {
        enqueueSnackbar(`PO ${poDisplayNumber(saved)} saved as draft — approve it from the PO detail`, { variant: 'warning' });
      } else {
        enqueueSnackbar(`PO ${poDisplayNumber(saved)} saved as draft`, { variant: 'success' });
      }
    };

    setPendingMode(saveMode);
    try {
      if (isRevise) {
        // New draft PO from the cancelled one — source indents derived server-side.
        const res = await revisePo({ id: reviseFrom._id, ...payload }).unwrap();
        enqueueSnackbar(`Revised PO ${poDisplayNumber(res?.data)} saved as draft`, { variant: 'success' });
      } else if (isEdit) {
        await updatePo({ id: po._id, ...payload }).unwrap();
        enqueueSnackbar('Purchase order updated', { variant: 'success' });
      } else if (approvedItemMode) {
        // Item-wise: one vendor, hand-picked approved items (source indents derived).
        const res = await createFromItems({ ...payload, saveMode: direct ? 'DIRECT' : 'DRAFT' }).unwrap();
        notifyCreated(res?.data);
      } else {
        const res = await createPo({ ...payload, indentId: indent._id, saveMode: direct ? 'DIRECT' : 'DRAFT' }).unwrap();
        notifyCreated(res?.data);
      }
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save purchase order', { variant: 'error' });
    } finally {
      setPendingMode('');
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: { xs: '100%', md: '92vh' }, display: 'flex', flexDirection: 'column', borderRadius: { xs: 0, md: '8px' }, overflow: 'hidden' } }}>
      {/* Header */}
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)', color: '#fff' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <ShoppingBag size={22} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: '#fff' }}>
              {isEdit ? `Edit ${poDisplayNumber(po)}` : isRevise ? `Revise ${poDisplayNumber(reviseFrom)}` : 'New Purchase Order'}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)' }}>
              {isRevise ? 'Create a new PO from the cancelled one — edit, then Save as Draft' : 'Step 1.4 · Create PO & Release to Supplier'}
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(false)} sx={{ color: '#fff' }}><X size={20} /></IconButton>
      </Box>

      {/* Body */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, bgcolor: PFMS.canvas }}>
        {/* Source + vendor */}
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: 'primary.main' }}>
            <FileText size={18} /> {approvedItemMode ? 'Approved Item(s) & Vendor' : isRevise ? 'Revised Items & Vendor' : 'Source Indent & Vendor'}
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <TextField select fullWidth required label="PO Format Type" value={poFormatType}
                onChange={(e) => handleFormatChange(e.target.value)} disabled={isEdit || isRevise}
                helperText={isJsl ? 'JSL — grade/width/finish + discount pricing' : 'Other — standard item / rate'}>
                <MenuItem value="OTHER">Other</MenuItem>
                <MenuItem value="JSL">JSL</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={8} />
            <Grid item xs={12} sm={6}>
              {isEdit ? (
                <TextField label="Indent Number" fullWidth value={indent?.indentNumber || ''} disabled />
              ) : isRevise ? (
                <TextField label="Revised From" fullWidth value={poDisplayNumber(reviseFrom)} disabled
                  helperText="A new PO will be created — the cancelled PO is left unchanged" />
              ) : approvedItemMode ? (
                <Autocomplete
                  multiple
                  disableCloseOnSelect
                  options={approvedItemOptions}
                  loading={approvedItemsLoading}
                  value={selectedApprovedItems}
                  getOptionLabel={(o) => (o ? `${o.indentItemDisplayNumber || o.itemDisplayNumber || o.indentNumber} — ${o.itemName}` : '')}
                  isOptionEqualToValue={(o, v) => String(o.indentItemId) === String(v.indentItemId)}
                  onChange={(_e, vals) => applyApprovedItems(vals)}
                  filterOptions={(opts, { inputValue }) => {
                    const q = inputValue.trim().toLowerCase();
                    if (!q) return opts;
                    return opts.filter((o) => [o.indentItemDisplayNumber, o.itemDisplayNumber, o.itemName, o.skuCode, o.indentNumber]
                      .some((f) => String(f || '').toLowerCase().includes(q)));
                  }}
                  renderOption={(props, o) => (
                    <Box component="li" {...props} key={o.indentItemId} sx={{ display: 'block !important', py: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" fontWeight={700} color="primary.main">{o.indentItemDisplayNumber || o.itemDisplayNumber}</Typography>
                        {o.quoteNotRequired ? (
                          <Chip label="Quote Not Required" size="small"
                            sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, bgcolor: '#eef2f6', color: '#475569' }} />
                        ) : null}
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {[o.itemName, o.skuCode && `SKU: ${o.skuCode}`, `Approved: ${o.approvedQuantity}`].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                  )}
                  renderInput={(params) => (
                    <TextField {...params} label="Approved Item(s) *" placeholder="Select one or more approved items"
                      helperText="Item-wise PO — only approved, not-yet-PO'd items are listed"
                      InputProps={{ ...params.InputProps, endAdornment: (<>{approvedItemsLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
                  )}
                />
              ) : (
                <TextField label="Indent Number" fullWidth value={indent?.indentNumber || ''} disabled
                  helperText="Multi-vendor approved indent (Step 1.3)" />
              )}
            </Grid>
            <Grid item xs={12} sm={6}>
              {!isEdit && approvedVendors.length > 0 ? (
                <TextField select fullWidth label="Approved Vendor *" value={approvedVendorId}
                  onChange={(e) => applyApprovedVendor(approvedVendors.find((v) => (v.vendorId?._id || v.vendorId) === e.target.value))}
                  helperText="From Step 1.3 — one PO is created per approved vendor">
                  {approvedVendors.map((v) => {
                    const vid = v.vendorId?._id || v.vendorId;
                    return (
                      <MenuItem key={vid} value={vid} disabled={!!v.poId}>
                        {v.vendorName}{v.poId ? ` · PO ${v.poNumber || 'created'}` : ''}
                      </MenuItem>
                    );
                  })}
                </TextField>
              ) : (
                <Autocomplete
                  options={vendorOptionsFiltered}
                  loading={vendorsLoading}
                  value={vendor}
                  getOptionLabel={(o) => (o?.name || '')}
                  isOptionEqualToValue={(o, v) => o._id === v._id}
                  onChange={(_e, v) => applyVendor(v)}
                  noOptionsText={noVendorForSku
                    ? 'No vendor found for selected SKU'
                    : 'No matching vendor'}
                  filterOptions={(opts, { inputValue }) => {
                    const q = inputValue.trim().toLowerCase();
                    if (!q) return opts;
                    return opts.filter((o) => [o.name, o.contactPerson, o.phone, o.email, o.gstNo, o.panNo]
                      .some((f) => String(f || '').toLowerCase().includes(q)));
                  }}
                  renderOption={(props, o) => (
                    <Box component="li" {...props} key={o._id} sx={{ display: 'block !important', py: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                        <Typography variant="body2" fontWeight={700}>{o.name}</Typography>
                        {(o.products?.length > 0) && (
                          <Typography variant="caption" sx={{ color: '#0f766e', fontWeight: 700, whiteSpace: 'nowrap' }}>
                            {o.products.length} product(s)
                          </Typography>
                        )}
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {[o.contactPerson, o.phone, o.email].filter(Boolean).join(' · ') || '—'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {[
                          o.gstNo && `GST: ${o.gstNo}`,
                          o.panNo && `PAN: ${o.panNo}`,
                          (o.creditPeriodDays != null) && `Credit: ${o.creditPeriodDays}d`,
                        ].filter(Boolean).join(' · ') || '—'}
                      </Typography>
                      {(o.location || o.address) && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {o.location || o.address}
                        </Typography>
                      )}
                    </Box>
                  )}
                  renderInput={(params) => (
                    <TextField {...params} label="Vendor *" placeholder="Select from Vendor Master"
                      error={noVendorForSku}
                      helperText={
                        noVendorForSku
                          ? 'No vendor found for selected SKU. Add vendor for this item.'
                          : (skuFilteredVendors
                            ? 'Filtered to vendors whose catalog carries the selected SKU(s).'
                            : ' ')
                      }
                      InputProps={{ ...params.InputProps, endAdornment: (<>{vendorsLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
                  )}
                />
              )}
              {approvedItemMode && !isJsl && selectedApprovedItems.length > 0 && (
                <Button size="small" startIcon={<Plus size={15} />} onClick={() => setAddVendorOpen(true)}
                  sx={{ mt: 0.5, textTransform: 'none' }}>
                  Add Vendor for this Item
                </Button>
              )}
            </Grid>
          </Grid>

          {/* Vendor snapshot preview */}
          {vendor ? (
            <Box sx={{ mt: 2, p: 1.5, borderRadius: '10px', bgcolor: alpha('#2563eb', 0.04), display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'center' }}>
              <Building2 size={16} color="#1d4ed8" />
              <Typography variant="caption" fontWeight={700}>{vendor.name}</Typography>
              <Typography variant="caption" color="text.secondary">GST: {vendor.gstNo || '—'}</Typography>
              <Typography variant="caption" color="text.secondary">PAN: {vendor.panNo || '—'}</Typography>
              <Typography variant="caption" color="text.secondary">{vendor.location || vendor.address || '—'}</Typography>
              <Typography variant="caption" color="text.secondary">📞 {vendor.phone || '—'}</Typography>
              <Typography variant="caption" color="text.secondary">✉ {vendor.email || '—'}</Typography>
              {vendorProducts.length > 0 && (
                <Typography variant="caption" sx={{ color: '#0f766e', fontWeight: 700 }}>{vendorProducts.length} catalog product(s)</Typography>
              )}
            </Box>
          ) : null}
        </Paper>

        {/* Header / terms */}
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: '#0f766e' }}>
            <ShoppingBag size={18} /> PO Terms
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <DateInputDDMMYYYY label="PO Date" fullWidth value={header.poDate}
                onChange={(val) => setHeader((h) => ({ ...h, poDate: val }))} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField label="Lead Time" fullWidth value={header.leadTime} placeholder="e.g. 7 days"
                onChange={(e) => setHeader((h) => ({ ...h, leadTime: e.target.value }))} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField label="Credit Period (Days)" type="number" fullWidth value={header.creditPeriod}
                onChange={(e) => setHeader((h) => ({ ...h, creditPeriod: e.target.value }))} inputProps={{ min: 0 }} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField label="Payment Terms" fullWidth value={header.paymentTerms}
                onChange={(e) => setHeader((h) => ({ ...h, paymentTerms: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Delivery Terms" fullWidth value={header.deliveryTerms}
                onChange={(e) => setHeader((h) => ({ ...h, deliveryTerms: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Remarks" fullWidth value={header.remarks}
                onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))} />
            </Grid>
          </Grid>
        </Paper>

        {/* Items */}
        <Paper elevation={0} sx={SECTION}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Typography sx={{ fontWeight: 700, color: '#b45309', display: 'flex', alignItems: 'center', gap: 1 }}>
              <Plus size={18} /> Items{approvedItemMode ? ' (from selected approved items)' : ''}
            </Typography>
            {/* In approved-item mode the rows are driven by the picker, so no manual add. */}
            {!approvedItemMode && (
              <Button size="small" startIcon={<Plus size={15} />} onClick={addItem} variant="outlined">Add Item</Button>
            )}
          </Box>

          {approvedItemMode && !selectedApprovedItems.length ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              Select approved item(s) above to load them here.
            </Typography>
          ) : isJsl ? (
            <>
              {/* JSL header row */}
              <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: JSL_GRID, gap: 1, px: 1, mb: 0.5 }}>
                {['Grade', 'Width', 'Finish', 'SKU', 'Qty', 'Unit', 'Base Rate', 'Upfront Disc.', 'Bonanza Disc.', 'Final Price', 'Value', ''].map((h, i) => (
                  <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.6rem' }}>{h}</Typography>
                ))}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {items.map((it, idx) => {
                  const { finalPrice, value } = jslLineCalc(it);
                  // Came from the indent but no Jindal catalog rate matched, and no rate entered yet.
                  const rateMissing = it.rateMatched === false && Boolean(it.itemName) && !(Number(it.baseRate) > 0);
                  return (
                    <Box key={idx} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                      {/* Read-only item ref + name for rows from the approved-item picker. */}
                      {it.fromApprovedItem && (it.indentItemDisplayNumber || it.itemName) ? (
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap', pl: { md: 1 } }}>
                          <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700 }}>{it.indentItemDisplayNumber}</Typography>
                          <Typography variant="caption" color="text.secondary">— {it.itemName}{it.skuCode ? ` · SKU: ${it.skuCode}` : ''}</Typography>
                        </Box>
                      ) : null}
                      <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: JSL_GRID },
                        gap: 1, alignItems: 'center', p: { xs: 1.5, md: 0.5 }, px: { md: 1 },
                        borderRadius: '10px',
                        border: rateMissing ? '1px solid' : { xs: '1px solid', md: 'none' },
                        borderColor: rateMissing ? 'warning.main' : 'divider',
                        bgcolor: rateMissing ? alpha('#f59e0b', 0.06) : 'transparent',
                        '&:hover': { bgcolor: rateMissing ? alpha('#f59e0b', 0.1) : alpha('#2563eb', 0.03) },
                      }}>
                        <TextField size="small" placeholder="Grade" value={it.grade}
                          onChange={(e) => setItem(idx, { grade: e.target.value })} />
                        <TextField size="small" placeholder="Width" value={it.width}
                          onChange={(e) => setItem(idx, { width: e.target.value })} />
                        <TextField size="small" placeholder="Finish" value={it.finish}
                          onChange={(e) => setItem(idx, { finish: e.target.value })} />
                        {it.fromApprovedItem ? (
                          <Typography variant="body2" color="primary.main" fontWeight={700} sx={{ overflowWrap: 'anywhere' }}>{it.skuCode || '—'}</Typography>
                        ) : (
                          <TextField size="small" placeholder="SKU" value={it.skuCode || ''}
                            onChange={(e) => setItem(idx, { skuCode: e.target.value.toUpperCase() })} />
                        )}
                        <TextField size="small" type="number" placeholder="0" value={it.quantity}
                          onChange={(e) => setItem(idx, { quantity: e.target.value })} inputProps={{ min: 0, style: { textAlign: 'right' } }} sx={NO_SPIN} />
                        <TextField size="small" select value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })}>
                          {/* Always include the row's current unit even if it isn't one of the
                              standard options — vendor-master unit spellings vary (e.g. "MT",
                              "Kg"), and a value with no matching MenuItem would otherwise render
                              blank, hiding a unit that was actually fetched correctly. */}
                          {(JSL_UNITS.includes(it.unit) || !it.unit ? JSL_UNITS : [it.unit, ...JSL_UNITS]).map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                        </TextField>
                        <TextField size="small" type="number" placeholder="0.00" value={it.baseRate}
                          onChange={(e) => setItem(idx, { baseRate: e.target.value, manual: true })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} sx={NO_SPIN} />
                        <TextField size="small" type="number" placeholder="0.00" value={it.upfrontDiscount}
                          onChange={(e) => setItem(idx, { upfrontDiscount: e.target.value })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} sx={NO_SPIN} />
                        <TextField size="small" type="number" placeholder="0.00" value={it.bonanzaDiscount}
                          onChange={(e) => setItem(idx, { bonanzaDiscount: e.target.value })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} sx={NO_SPIN} />
                        <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{finalPrice.toFixed(2)}</Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value.toFixed(2)}</Typography>
                        <Tooltip title="Remove">
                          <span>
                            <IconButton size="small" color="error" onClick={() => (it.fromApprovedItem ? removeApprovedRow(idx) : removeItem(idx))}
                              disabled={!it.fromApprovedItem && items.length === 1 && !it.grade && !it.quantity}>
                              <Trash2 size={15} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Box>
                      {rateMissing && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: { md: 1 } }}>
                          <AlertTriangle size={13} color="#b45309" />
                          <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 600 }}>
                            Rate not found in {JSL_VENDOR_NAME} vendor master — enter base rate manually
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </>
          ) : (
            <>
              {/* OTHER header row */}
              <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: OTHER_GRID, gap: 1, px: 1, mb: 0.5 }}>
                {['Item Name', 'SKU', 'Qty', 'Unit', 'Rate', 'GST %', 'Taxable', 'Tax', 'Total', ''].map((h, i) => (
                  <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.62rem' }}>{h}</Typography>
                ))}
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {items.map((it, idx) => {
                  const { taxable, tax, total } = lineCalc(it);
                  // Came from an indent / has an item, but no Vendor-Master rate matched and none entered yet.
                  const rateMissing = it.rateMatched === false && Boolean(it.itemName) && !(Number(it.rate) > 0);
                  // Item Name & SKU are read-only for any known item (approved-item / indent / edit / revise);
                  // only a brand-new blank "Add Item" row lets you type a name.
                  const nameLocked = Boolean(it.fromApprovedItem || it.itemName);
                  // Flag a user override of the auto-filled Vendor-Master rate/GST.
                  const rateModified = (it.autoRate != null && Number(it.rate) !== Number(it.autoRate))
                    || (it.autoGst != null && Number(it.gstRate) !== Number(it.autoGst));
                  return (
                    <Box key={idx} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    <Box sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: OTHER_GRID },
                      gap: 1, alignItems: 'center', p: { xs: 1.5, md: 0.5 }, px: { md: 1 },
                      borderRadius: '10px',
                      border: rateMissing ? '1px solid' : { xs: '1px solid', md: 'none' },
                      borderColor: rateMissing ? 'warning.main' : 'divider',
                      bgcolor: rateMissing ? alpha('#f59e0b', 0.06) : 'transparent',
                      '&:hover': { bgcolor: rateMissing ? alpha('#f59e0b', 0.1) : alpha('#2563eb', 0.03) },
                    }}>
                      <Box sx={{ minWidth: 0 }}>
                        {nameLocked ? (
                          // Known item — name is read-only (no dropdown).
                          <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{it.itemName || '—'}</Typography>
                        ) : (
                          <Autocomplete
                            freeSolo
                            options={vendorProducts}
                            getOptionLabel={(o) => (typeof o === 'string' ? o : o.productName || '')}
                            value={it.itemName}
                            onInputChange={(_e, v, reason) => { if (reason === 'input') setItem(idx, { itemName: v }); }}
                            onChange={(_e, val) => {
                              if (val && typeof val === 'object') {
                                setItem(idx, {
                                  itemName: val.productName, skuCode: val.skuCode || '',
                                  skuId: val.skuId || '', rate: val.rate ?? it.rate, unit: val.unit || it.unit,
                                  gstRate: val.gstRate ?? it.gstRate, hsn: val.hsn || '',
                                  rateMatched: true, manual: false, rateEdited: false, autoRate: val.rate ?? undefined, autoGst: val.gstRate ?? undefined,
                                });
                              }
                            }}
                            renderInput={(params) => <TextField {...params} size="small" placeholder="Item / vendor product" />}
                          />
                        )}
                        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap' }}>
                          {it.indentItemDisplayNumber ? (
                            <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700, pl: 0.5 }}>{it.indentItemDisplayNumber}</Typography>
                          ) : null}
                          {rateModified && (
                            <Chip size="small" label="Rate Modified" sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, bgcolor: alpha('#f59e0b', 0.15), color: '#b45309' }} />
                          )}
                        </Box>
                      </Box>
                      {nameLocked ? (
                        <Typography variant="body2" color="primary.main" fontWeight={700}>{it.skuCode || '—'}</Typography>
                      ) : (
                        <TextField size="small" placeholder="SKU" value={it.skuCode}
                          onChange={(e) => setItem(idx, { skuCode: e.target.value.toUpperCase() })} />
                      )}
                      <TextField size="small" type="number" placeholder="0" value={it.quantity}
                        onChange={(e) => setItem(idx, { quantity: e.target.value })} inputProps={{ min: 0, style: { textAlign: 'right' } }} sx={NO_SPIN} />
                      <TextField size="small" select value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })}>
                        {UNITS.map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                      </TextField>
                      <TextField size="small" type="number" placeholder="0.00" value={it.rate}
                        onChange={(e) => setItem(idx, { rate: e.target.value, manual: true, rateEdited: true })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} sx={NO_SPIN} />
                      <Autocomplete
                        freeSolo disableClearable size="small"
                        options={GST_PRESETS.map(String)}
                        value={it.gstRate === '' || it.gstRate == null ? '' : String(it.gstRate)}
                        onInputChange={(_e, v, reason) => {
                          const cleaned = v.replace(/[^\d.]/g, '');
                          // Only a genuine keystroke marks the row manual. MUI also fires
                          // 'reset'/'clear' on mount and on programmatic value changes (e.g.
                          // when the vendor-master auto-fill sets the GST); those must NOT
                          // flag the row, or auto-fill would be permanently blocked.
                          const patch = { gstRate: cleaned === '' ? '' : Number(cleaned) };
                          if (reason === 'input') { patch.manual = true; patch.rateEdited = true; }
                          setItem(idx, patch);
                        }}
                        renderInput={(params) => (
                          <TextField {...params} size="small" placeholder="GST %" inputProps={{ ...params.inputProps, inputMode: 'decimal', style: { textAlign: 'right' } }}
                            InputProps={{ ...params.InputProps, endAdornment: <Typography variant="caption" sx={{ pr: 0.5, color: 'text.secondary' }}>%</Typography> }} />
                        )}
                      />
                      <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{taxable.toFixed(2)}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>{tax.toFixed(2)}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{total.toFixed(2)}</Typography>
                      <Tooltip title="Remove">
                        <span>
                          <IconButton size="small" color="error" onClick={() => (it.fromApprovedItem ? removeApprovedRow(idx) : removeItem(idx))}
                            disabled={!it.fromApprovedItem && items.length === 1 && !it.itemName}>
                            <Trash2 size={15} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>
                      {rateMissing && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: { md: 1 } }}>
                          <AlertTriangle size={13} color="#b45309" />
                          <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 600 }}>
                            Rate not found in Vendor Master for SKU: {it.skuCode || it.itemName || '—'} — enter rate manually
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </>
          )}

          {/* Totals */}
          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>TOTAL TAXABLE VALUE</Typography>
              <Typography fontWeight={700}>{fmtINR(totals.taxable)}</Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>{isJsl ? 'GST @ 18%' : 'GST'}</Typography>
              <Typography fontWeight={700}>{fmtINR(totals.tax)}</Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="primary.main" fontWeight={700}>GRAND TOTAL</Typography>
              <Typography variant="h6" fontWeight={800} color="primary.dark">{fmtINR(totals.grand)}</Typography>
            </Box>
          </Box>
        </Paper>
      </Box>

      {/* Footer */}
      <Divider />
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#fff' }}>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">
            {validItems.length} item(s) · {fmtINR(totals.grand)}
          </Typography>
          {isCreate && (
            <Typography variant="caption" color="text.secondary" display="block">
              {canDirectSave
                ? 'Draft stays editable and needs approval · Save PO Directly approves it now with the final PO number'
                : 'PO approval is required for your role — save as draft and send it for approval'}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button variant="outlined" onClick={() => onClose?.(false)} disabled={saving || previewing}>Cancel</Button>
          <Button variant="outlined" color="secondary"
            startIcon={previewing ? <CircularProgress size={16} color="inherit" /> : <Eye size={16} />}
            onClick={handlePreview} disabled={saving || previewing}>
            Preview PDF
          </Button>
          {isCreate ? (
            <>
              <Tooltip title="Creates an editable draft PO with a temporary DRAFT number. It must be approved before release.">
                <span>
                  <Button variant={canDirectSave ? 'outlined' : 'contained'}
                    startIcon={pendingMode === 'DRAFT' ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
                    onClick={() => handleSubmit('DRAFT')} disabled={saving || previewing}>
                    Save as Draft
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title={canDirectSave
                ? 'Creates the PO as approved with its final PO number — ready to release. No separate approval step.'
                : 'Not available — PO approval is required for your role (needs PO approval rights).'}>
                <span>
                  <Button variant="contained" color="success"
                    startIcon={pendingMode === 'DIRECT' ? <CircularProgress size={16} color="inherit" /> : <CheckCircle2 size={16} />}
                    onClick={() => handleSubmit('DIRECT')} disabled={!canDirectSave || saving || previewing}>
                    Save PO Directly
                  </Button>
                </span>
              </Tooltip>
            </>
          ) : (
            <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
              onClick={() => handleSubmit()} disabled={saving || previewing}>
              {isEdit ? 'Save Changes' : 'Save as Draft'}
            </Button>
          )}
        </Box>
      </Box>

      {/* Draft PDF preview — temporary, never saved */}
      <PurchaseOrderPdfPreview open={previewOpen} onClose={closePreview} previewUrl={previewUrl} />

      {/* Add a Vendor Master record (or product) for the selected approved item(s) */}
      <AddVendorForItemModal
        open={addVendorOpen}
        onClose={() => setAddVendorOpen(false)}
        items={selectedApprovedItems}
        vendorOptions={vendorOptions}
        onAdded={handleVendorAdded}
      />
    </Dialog>
  );
};

export default PurchaseOrderFormDrawer;
