import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Dialog,
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  Divider,
  Grid,
  MenuItem,
  Autocomplete,
  CircularProgress,
  Paper,
  Tooltip,
  Chip,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import {
  X,
  Save,
  ShoppingBag,
  Plus,
  Trash2,
  Building2,
  FileText,
  AlertTriangle,
  Eye,
  CheckCircle2,
} from "lucide-react";
import { useSnackbar } from "notistack";
import { useSelector, useDispatch } from "react-redux";
import {
  useGetAllApprovedItemsQuery,
  useCreatePurchaseOrderMutation,
  useCreatePurchaseOrderFromItemsMutation,
  useUpdatePurchaseOrderMutation,
  useRevisePurchaseOrderMutation,
  usePreviewPurchaseOrderPdfMutation,
  useGetPoTermsDefaultsQuery,
} from "../../../store/api/procurementApi";
import {
  useGetVendorsQuery,
  useGetVendorByIdQuery,
} from "../../../store/api/vendorApi";
import { useGetSkuLookupQuery } from "../../../store/api/skuApi";
import {
  conversionRule,
  reversedRuleWarning,
  sameUnit,
  skuConversion,
} from "../../../utils/unitConversion";
import { fmtINR, poDisplayNumber } from "./poMeta";
import { PFMS, pfmsCardSx } from "../pfmsTheme";
import DateInputDDMMYYYY from "../components/DateInputDDMMYYYY";
import PurchaseOrderPdfPreview from "./PurchaseOrderPdfPreview";
import AddVendorForItemModal from "./AddVendorForItemModal";
import { norm, matchVendorProduct } from "./vendorRateMatch";
import {
  LOOKUP,
  newRowId,
  lookupKeyOf,
  lookupParams,
  answerOf,
  startLookup,
  applyAnswer,
  awaitsRate,
  lookupBlock,
  rateChangeOf,
  isFirstRate,
  resetLookup,
} from "./poRateLookup";
import { procurementApi } from "../../../store/api/procurementApi";
import { itemRef, UNITS, toKgsUnit } from "../indents/indentMeta";
import {
  VENDOR_SOURCE_LABEL,
  fixedVendorOf,
  itemVendorBlock,
  assignedVendorsOf,
} from "./itemVendor";
import { isMdForDirectSave } from "./poDirectSave";
import PoTermsDialog from "./PoTermsDialog";
import {
  RATE_STATUS,
  RATE_LINE_LABEL,
  fmtRate,
  fmtDiff,
} from "../rate-changes/rateChangeMeta";
import { effectivePoTerms, PO_FORMAT_LABEL } from "./poTerms";
import {
  EMPTY_DELIVERY,
  setLeadTime,
  setDeliveryDate,
  setPoDate,
  inheritVendorLead,
  vendorLeadDays,
  deliveryFromSavedPo,
  deliveryErrors,
  parseLeadDays,
} from "./poLeadTime";

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
const JSL_UNITS = ["Kgs", "MT", "Pcs", "Nos", "Meter"];

// Hide the native number-input spinner arrows so the digits use the full cell width.
const NO_SPIN = {
  "& input[type=number]": { MozAppearance: "textfield" },
  "& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button": {
    WebkitAppearance: "none",
    margin: 0,
  },
};
const GST_PRESETS = [0, 5, 12, 18, 28];
// The user's local calendar date (toISOString would give yesterday before 05:30 IST).
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Origin of an OTHER line's rate — only a user edit (MANUAL) is written back to
// the Vendor Master / Pricing History when the PO is approved.
const rateSourceOf = (it) => {
  if (it.rateEdited) return "MANUAL";
  if (it.fromQuotation) return "APPROVED_QUOTATION";
  if (it.autoRate != null) return "VENDOR_MASTER";
  return it.rateSource || "";
};

// Rate Change Approvals: a rate that differs from the rate fetched from the
// vendor's Vendor Master (poRateLookup.js — rateChangeOf) needs a reason; saving
// raises the request (server-side) and the vendor's rate only changes once it is
// approved.

// `rid` identifies the row while its vendor-rate lookup is out (poRateLookup.js).
const emptyItem = () => ({
  rid: newRowId(),
  itemName: "",
  skuCode: "",
  skuId: "",
  quantity: "",
  unit: "Pcs",
  rate: "",
  gstRate: 18,
  hsn: "",
  indentId: "",
  indentNumber: "",
  indentItemId: "",
  indentItemDisplayNumber: "",
  approvedQuantity: 0,
  fromApprovedItem: false,
  rateMatched: undefined,
  manual: false,
});
const emptyJslItem = () => ({
  grade: "",
  width: "1250",
  finish: "2B/ME",
  quantity: "",
  unit: "Kgs",
  baseRate: "",
  upfrontDiscount: "",
  bonanzaDiscount: "",
});
const emptyItemFor = (fmt) => (fmt === "JSL" ? emptyJslItem() : emptyItem());

// ── JSL auto-vendor + rate fetch helpers (Step 1.4) ──────────────────────────
// JSL POs are always raised on Jindal Stainless Ltd; rates/specs are pulled from
// that vendor's catalog in the Vendor Master.
const JSL_VENDOR_NAME = "Jindal Stainless Ltd";

// Locate the Jindal vendor in the Vendor-Master list (tolerant of naming variants).
const findJslVendor = (vendors = []) =>
  vendors.find((v) => norm(v.name) === norm(JSL_VENDOR_NAME)) ||
  vendors.find((v) => norm(v.name).includes("jindal"));

// Best-effort parse of grade / width / finish out of an item name + vendor notes.
const JSL_FINISHES = [
  "No.1",
  "No.4",
  "No.8",
  "2B",
  "2D",
  "1D",
  "BA",
  "HR",
  "CR",
  "Mirror",
  "Matt",
];
const parseJslSpec = (...texts) => {
  const text = texts.filter(Boolean).join(" ");
  const out = { grade: "", width: "", finish: "" };
  if (!text) return out;
  for (const f of JSL_FINISHES) {
    const re = new RegExp(
      `(^|[\\s\\-_/(])${f.replace(".", "\\.")}([\\s\\-_/)]|$)`,
      "i",
    );
    if (re.test(text)) {
      out.finish = f;
      break;
    }
  }
  const w =
    text.match(/(\d{2,4}(?:\.\d+)?)\s*mm\b/i) ||
    text.match(/\bW[:\-]?\s*(\d{2,4})\b/i) ||
    text.match(/[x×]\s*(\d{2,4})\b/i);
  if (w) out.width = w[1];
  const g = text.match(
    /\b(?:SS\s*)?(\d{3}[A-Z]?|J\d|2205|2507|DUPLEX|JSLU?\w*)\b/i,
  );
  if (g) out.grade = (g[1] || "").toUpperCase();
  return out;
};

const JSL_GST = 18;
const lineCalc = (it) => {
  const taxable = (Number(it.quantity) || 0) * (Number(it.rate) || 0);
  const tax = (taxable * (Number(it.gstRate) || 0)) / 100;
  return { taxable, tax, total: taxable + tax };
};
const jslLineCalc = (it) => {
  const finalPrice =
    (Number(it.baseRate) || 0) -
    (Number(it.upfrontDiscount) || 0) -
    (Number(it.bonanzaDiscount) || 0);
  const value = (Number(it.quantity) || 0) * finalPrice;
  return { finalPrice, value };
};

const SECTION = { p: 2.5, ...pfmsCardSx };
const OTHER_GRID =
  "1.7fr 0.85fr 0.7fr 0.95fr 0.7fr 0.8fr 0.8fr 0.65fr 0.85fr 36px";
const JSL_GRID =
  "1.1fr 0.7fr 0.9fr 0.8fr 0.6fr 0.85fr 0.85fr 0.9fr 0.9fr 0.8fr 0.85fr 36px";

const PurchaseOrderFormDrawer = ({
  open,
  onClose,
  po = null,
  presetIndent = null,
  presetItemIds = null,
  reviseFrom = null,
}) => {
  const { enqueueSnackbar } = useSnackbar();
  const isEdit = Boolean(po?._id);
  const isRevise = Boolean(reviseFrom?._id);
  // The PO whose data prefills the form (edit target or the cancelled PO to revise).
  const sourcePo = po || reviseFrom;
  const isCreate = !isEdit && !isRevise;

  // "Save PO Directly" skips the approval step, so it's offered to the MD only;
  // everyone else saves a draft for PO Approval. The server enforces the same rule.
  const canDirectSave = useSelector((s) => isMdForDirectSave(s.auth.user));
  const [pendingMode, setPendingMode] = useState(""); // which create button is saving

  // Tracks which indent the JSL rows were last auto-built for, so a late-loading
  // vendor catalog re-matches rates without wiping manual edits or rebuilding.
  const builtJslIndentRef = useRef("__none__");

  const [indent, setIndent] = useState(null);
  const [selectedApprovedItems, setSelectedApprovedItems] = useState([]); // New PO item-picker (OTHER create)
  // Assigned Vendor dropdown (New PO): '' = choose approved items manually.
  const [assignedVendorId, setAssignedVendorId] = useState("");
  // New PO by vendor (groupMode): the vendor picked here for an item that has
  // none ({ indentItemId: vendorId }) — kept on the form only, the PO records it —
  // and each vendor's own delivery / payment terms once edited ({ vendorId: terms }).
  const [itemVendorPicks, setItemVendorPicks] = useState({});
  const [vendorTerms, setVendorTerms] = useState({});
  const [vendor, setVendor] = useState(null);
  const [poFormatType, setPoFormatType] = useState("OTHER"); // 'JSL' | 'OTHER'
  const [approvedVendors, setApprovedVendors] = useState([]); // from Step 1.3 (multi-vendor)
  const [approvedVendorId, setApprovedVendorId] = useState("");
  // expectedDeliveryDate / leadTime / leadAnchor / leadSource follow poLeadTime.js.
  const [header, setHeader] = useState({
    poDate: todayStr(),
    ...EMPTY_DELIVERY,
    deliveryTerms: "",
    paymentTerms: "",
    creditPeriod: 0,
    remarks: "",
  });
  const [items, setItems] = useState([emptyItem()]);
  // Terms & Conditions printed on the PDF. Until edited they follow the
  // format's default (Company Settings); the server stores the default then.
  const [terms, setTerms] = useState({ text: "", edited: false });
  const [termsOpen, setTermsOpen] = useState(false);

  // Draft PDF preview (no save) — holds the temporary blob URL.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");

  const [createPo, { isLoading: creating }] = useCreatePurchaseOrderMutation();
  const [createFromItems, { isLoading: creatingItems }] =
    useCreatePurchaseOrderFromItemsMutation();
  const [updatePo, { isLoading: updating }] = useUpdatePurchaseOrderMutation();
  const [revisePo, { isLoading: revising }] = useRevisePurchaseOrderMutation();
  const [previewPdf, { isLoading: previewing }] =
    usePreviewPurchaseOrderPdfMutation();
  const { data: termsDefaultsRes } = useGetPoTermsDefaultsQuery(undefined, {
    skip: !open,
  });
  const termsDefaults = termsDefaultsRes?.data;
  const saving = creating || creatingItems || updating || revising;

  // Edit + revise prefill from an existing PO and keep their copied rates (no
  // catalog auto-fill clobbering). Revise still produces a NEW record on save.
  const lockRates = isEdit || isRevise;

  // New PO (create) selects approved ITEMS individually (item-wise PO across
  // indents), not a whole indent — for BOTH OTHER and JSL formats. Edit/revise keep
  // the prefilled-item flow; multi-vendor (Step 1.3) preset indents keep the vendor flow.
  const approvedItemMode = !isEdit && !isRevise && approvedVendors.length === 0;
  // New PO, Other format: the items are grouped by vendor and one Save raises one
  // PO per vendor (each with its own delivery date and payment terms). JSL is
  // always Jindal, so it stays a single-vendor PO.
  const groupMode = approvedItemMode && poFormatType !== "JSL";

  // Global approved-item options for the New PO item-picker. Loaded fresh on every
  // open — an earlier copy can be out of date (an item since PO'd or given a vendor).
  const {
    data: approvedItemsRes,
    isLoading: approvedItemsLoading,
    isFetching: approvedItemsFetching,
  } = useGetAllApprovedItemsQuery(undefined, {
    skip: !open || !approvedItemMode,
    refetchOnMountOrArgChange: true,
  });
  const approvedItemOptions = useMemo(
    () => approvedItemsRes?.data?.items || [],
    [approvedItemsRes],
  );

  // Vendor fixed for the selected items (approved quotation / Pending-for-PO pick):
  // the PO must use it, so the Vendor field is filled from it and locked.
  // Assigned Vendor dropdown: the vendors already fixed for approved items (approved
  // quotation / Pending-for-PO pick) — of the indent the form was opened from, else
  // of every approved item. Picking one fills its items; the item picker then lists
  // only that vendor's items (plus whatever is already selected).
  const assignedVendors = useMemo(
    () =>
      assignedVendorsOf(
        presetIndent?._id
          ? approvedItemOptions.filter(
              (o) => String(o.indentId) === String(presetIndent._id),
            )
          : approvedItemOptions,
      ),
    [approvedItemOptions, presetIndent],
  );
  const pickerOptions = useMemo(() => {
    if (!assignedVendorId) return approvedItemOptions;
    const picked = new Set(
      selectedApprovedItems.map((o) => String(o.indentItemId)),
    );
    return approvedItemOptions.filter(
      (o) =>
        picked.has(String(o.indentItemId)) ||
        (o.vendorState === "SET" && String(o.vendorId) === assignedVendorId),
    );
  }, [approvedItemOptions, assignedVendorId, selectedApprovedItems]);

  // (By vendor there is no single PO vendor to fix — each group is its own PO.)
  const fixedVendor = useMemo(
    () =>
      approvedItemMode && !groupMode
        ? fixedVendorOf(selectedApprovedItems)
        : null,
    [approvedItemMode, groupMode, selectedApprovedItems],
  );

  const { data: vendorsRes, isLoading: vendorsLoading } = useGetVendorsQuery(
    { limit: 500, sort: "name" },
    { skip: !open },
  );
  const vendorOptions = useMemo(() => vendorsRes?.data || [], [vendorsRes]);

  // Authoritative catalog: fetch the selected vendor by id (GET /api/v1/vendors/:id)
  // so rate/GST/HSN come straight from the Vendor Master, not a possibly-trimmed
  // list payload. Falls back to the list record while the detail request loads.
  const { data: vendorByIdRes } = useGetVendorByIdQuery(vendor?._id, {
    skip: !open || !vendor?._id,
  });
  const vendorFull = vendorByIdRes?.data;

  // SKU Master purchase-unit conversions of the lines on the form ("1 BOX = 25
  // PCS"), shown under the Unit so the buyer sees what the PO will stock as.
  // Quantities, rates and totals stay in the line's own unit.
  const lineSkuIds = useMemo(
    () =>
      [
        ...new Set(
          items
            .map((it) => it.skuId)
            .filter(Boolean)
            .map(String),
        ),
      ].sort(),
    [items],
  );
  const { data: lineSkusRes } = useGetSkuLookupQuery(
    { ids: lineSkuIds.join(","), limit: 2000 },
    { skip: !open || !lineSkuIds.length },
  );
  const lineSkuById = useMemo(
    () => new Map((lineSkusRes?.data || []).map((s) => [String(s._id), s])),
    [lineSkusRes],
  );
  const vendorProducts = useMemo(
    () => vendorFull?.products || vendor?.products || [],
    [vendorFull, vendor],
  );

  // Hydrate on open.
  useEffect(() => {
    if (!open) return;
    builtJslIndentRef.current = "__none__";
    if (sourcePo) {
      // Prefill from the edit target OR the cancelled PO being revised.
      setIndent({
        _id: sourcePo.indentId,
        indentNumber: sourcePo.indentNumber,
      });
      const v = vendorOptions.find(
        (p) => p._id === (sourcePo.vendorId?._id || sourcePo.vendorId),
      );
      setVendor(
        v || {
          _id: sourcePo.vendorId?._id || sourcePo.vendorId,
          name: sourcePo.vendorName,
        },
      );
      const poDate = isRevise
        ? todayStr()
        : sourcePo.poDate
          ? sourcePo.poDate.slice(0, 10)
          : todayStr();
      setHeader({
        ...deliveryFromSavedPo(sourcePo, poDate, { revise: isRevise }),
        deliveryTerms: sourcePo.deliveryTerms || "",
        paymentTerms: sourcePo.paymentTerms || "",
        creditPeriod: sourcePo.creditPeriod || 0,
        remarks: sourcePo.remarks || "",
      });
      const fmt = sourcePo.poFormatType === "JSL" ? "JSL" : "OTHER";
      setPoFormatType(fmt);
      // Edit: the terms this PO prints now (an older PO prints its Remarks).
      // Revise: the cancelled PO's own terms, else the current default.
      const ownTerms = isRevise
        ? (sourcePo.termsAndConditions || "").trim()
        : effectivePoTerms(sourcePo, null);
      setTerms({ text: ownTerms, edited: Boolean(ownTerms) });
      setItems(
        sourcePo.items?.length
          ? sourcePo.items.map((it) =>
              fmt === "JSL"
                ? {
                    grade: it.grade || "",
                    width: it.width || "",
                    finish: it.finish || "",
                    skuCode: it.skuCode || "",
                    skuId: it.skuId || "",
                    itemName: it.itemName || "",
                    quantity: it.quantity,
                    unit: it.unit || "Kgs",
                    baseRate: it.baseRate ?? "",
                    upfrontDiscount: it.upfrontDiscount ?? "",
                    bonanzaDiscount: it.bonanzaDiscount ?? "",
                    indentId: it.indentId || "",
                    indentNumber: it.indentNumber || "",
                    indentItemId: it.indentItemId || "",
                    indentItemDisplayNumber: it.indentItemDisplayNumber || "",
                    manual: true,
                    rateMatched: true,
                  }
                : {
                    rid: newRowId(),
                    itemName: it.itemName,
                    skuCode: it.skuCode || "",
                    skuId: it.skuId || "",
                    quantity: it.quantity,
                    unit: it.unit || "Pcs",
                    rate: it.rate,
                    gstRate: it.gstRate,
                    hsn: it.hsn || "",
                    indentId: it.indentId || "",
                    indentNumber: it.indentNumber || "",
                    indentItemId: it.indentItemId || "",
                    indentItemDisplayNumber: it.indentItemDisplayNumber || "",
                    manual: true,
                    rateMatched: true,
                    rateSource: it.rateSource || "",
                    rateEdited: it.rateSource === "MANUAL",
                    // The vendor rate the line was saved against, and its rate change request.
                    autoRate: it.fetchedRate ?? undefined,
                    savedRate: it.rate,
                    rateChangeStatus: it.rateChangeStatus || "",
                    rateChangeRequestNumber: it.rateChangeRequestNumber || "",
                  },
            )
          : [emptyItemFor(fmt)],
      );
    } else {
      setIndent(null);
      setVendor(null);
      setApprovedVendors([]);
      setApprovedVendorId("");
      setAssignedVendorId("");
      setSelectedApprovedItems([]);
      setItemVendorPicks({});
      setVendorTerms({});
      setPoFormatType("OTHER");
      setHeader({
        poDate: todayStr(),
        ...EMPTY_DELIVERY,
        deliveryTerms: "",
        paymentTerms: "",
        creditPeriod: 0,
        remarks: "",
      });
      setTerms({ text: "", edited: false });
      setItems([emptyItem()]);
      // Preset multi-vendor (Step 1.3) indents keep the legacy approved-vendor path;
      // simple/item-level preset indents are pre-selected in the item-picker once the
      // global approved-items list loads (handled by the preset effect below).
      if (
        presetIndent &&
        (presetIndent?.quotationApprovalStep?.approvedVendors?.length || 0) > 0
      ) {
        applyIndent(presetIndent);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po, presetIndent, reviseFrom]);

  // The selected vendor's default Lead Time (Vendor Master) starts the Lead Time /
  // Expected Delivery Date pair — however the vendor got picked (Vendor field,
  // assigned/approved vendor, JSL's Jindal). Values the user entered or the
  // saved PO's are kept. Uses the fetched record once it is this vendor's.
  const vendorDefaultLead = vendorLeadDays(
    vendorFull && String(vendorFull._id) === String(vendor?._id || "")
      ? vendorFull
      : vendor,
  );
  useEffect(() => {
    if (!open) return;
    setHeader((h) => inheritVendorLead(h, vendorDefaultLead));
  }, [open, vendor?._id, vendorDefaultLead]);

  // JSL auto-flow (create): force Jindal Stainless Ltd as the vendor and fill any
  // missing base rates from its catalog as the catalog (or selection) loads. Rows
  // themselves come from the shared Approved Item(s) picker — JSL no longer builds
  // from a whole indent. Never runs in edit/revise mode so copied POs are left as-is.
  useEffect(() => {
    if (!open || lockRates || poFormatType !== "JSL") return;
    const jindal = findJslVendor(vendorOptions);
    if (!jindal) return; // catalog list not loaded yet — effect re-runs when it arrives
    // A vendor fixed for the items wins — a mismatch is reported, never overridden.
    if (vendor?._id !== jindal._id && !fixedVendor) applyJslVendorTerms(jindal);
    // Fill missing rates from the (possibly late-loaded) catalog, keeping manual edits.
    const products = vendorProducts.length
      ? vendorProducts
      : jindal.products || [];
    setItems((cur) => fillJslRates(cur, { products }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    lockRates,
    poFormatType,
    vendorOptions,
    vendorProducts,
    selectedApprovedItems,
    fixedVendor,
  ]);

  // The indent's source line items (multi-item, with a legacy single-product fallback).
  const indentSourceItems = (ind) => {
    if (!ind) return [];
    return ind.items?.length
      ? ind.items
      : ind.productNameRevised
        ? [
            {
              itemName: ind.productNameRevised,
              skuCode: ind.skuCode,
              skuId: ind.skuId,
              unit: ind.unit,
              approvedQuantity: ind.approvedQuantity,
              quantity: ind.quantity,
            },
          ]
        : [];
  };

  // The Jindal catalog used for JSL rate matching — prefer the full fetched catalog
  // (when Jindal is the selected vendor), else the list record's products.
  const jslProducts = () => {
    const jindal = findJslVendor(vendorOptions);
    if (
      vendor?._id &&
      jindal &&
      String(vendor._id) === String(jindal._id) &&
      vendorProducts.length
    )
      return vendorProducts;
    return jindal?.products || [];
  };

  // Map one approved-item option → an OTHER PO row (name/SKU read-only downstream).
  const buildOtherRowFromApproved = (o) => ({
    ...emptyItem(),
    itemName: o.itemName || "",
    skuCode: o.skuCode || "",
    skuId: o.skuId || "",
    quantity: o.approvedQuantity || "",
    unit: o.unit || "Pcs",
    indentId: o.indentId || "",
    indentNumber: o.indentNumber || "",
    indentItemId: o.indentItemId || "",
    indentItemDisplayNumber:
      o.indentItemDisplayNumber || o.itemDisplayNumber || "",
    approvedQuantity: o.approvedQuantity || 0,
    fromApprovedItem: true,
  });

  // Map one approved-item option → a JSL PO row: parse grade/width/finish from the
  // item name + vendor notes, auto-fill base rate/unit from the Jindal catalog.
  const buildJslRowFromApproved = (o, products = []) => {
    const match = matchVendorProduct(products, {
      skuCode: o.skuCode,
      itemName: o.itemName,
    });
    const spec = parseJslSpec(o.itemName, match?.notes);
    return {
      ...emptyJslItem(),
      grade: spec.grade || o.itemName || "",
      width: spec.width || "1250",
      finish: spec.finish || "2B/ME",
      quantity: o.approvedQuantity || "",
      // Prefer the Jindal vendor-catalog unit (the actual master data for JSL
      // items) over the indent's unit — the indent's generic Unit dropdown
      // (Pcs/KGS/Meter/...) doesn't cover JSL-specific units (Kgs/MT/Nos), so it
      // silently normalizes those to "Pcs" at indent-creation time.
      unit: match?.unit || o.unit || "Kgs",
      baseRate: match ? (match.rate ?? 0) : 0,
      gstRate: JSL_GST,
      itemName: o.itemName || "",
      skuCode: o.skuCode || match?.skuCode || "",
      skuId: o.skuId || match?.skuId || "",
      indentId: o.indentId || "",
      indentNumber: o.indentNumber || "",
      indentItemId: o.indentItemId || "",
      indentItemDisplayNumber:
        o.indentItemDisplayNumber || o.itemDisplayNumber || "",
      approvedQuantity: o.approvedQuantity || 0,
      fromApprovedItem: true,
      rateMatched: !!match,
      manual: false,
    };
  };

  // Build PO rows from the selected approved items in the current format's shape.
  const buildRowsFromApproved = (vals, fmt) => {
    if (!vals.length) return [emptyItemFor(fmt)];
    return fmt === "JSL"
      ? vals.map((o) => buildJslRowFromApproved(o, jslProducts()))
      : vals.map(buildOtherRowFromApproved);
  };

  // Re-fill rates from the (possibly late-loaded) catalog WITHOUT touching rows
  // the user manually edited or rows that already have a rate.
  const fillJslRates = (rows, vendorObj) => {
    const products = vendorObj?.products || [];
    return rows.map((it) => {
      if (it.manual) return it;
      const match = matchVendorProduct(products, {
        skuCode: it.skuCode,
        itemName: it.itemName,
      });
      if (!match) return { ...it, rateMatched: it.rateMatched ?? false };
      const hasRate = it.baseRate !== "" && Number(it.baseRate) > 0;
      return {
        ...it,
        baseRate: hasRate ? it.baseRate : (match.rate ?? it.baseRate),
        unit: it.unit || match.unit || "Kgs",
        rateMatched: true,
      };
    });
  };

  // JSL vendor terms — snapshot Jindal's credit/payment defaults (its lead time
  // comes from the vendor-default effect).
  const applyJslVendorTerms = (v) => {
    setVendor(v);
    setHeader((h) => ({
      ...h,
      creditPeriod: v.creditPeriodDays ?? h.creditPeriod,
      paymentTerms:
        h.paymentTerms ||
        (v.creditPeriodDays ? `${v.creditPeriodDays} days credit` : ""),
    }));
  };

  // Seed PO lines from the indent's approved items (multi-item, with a
  // legacy single-product fallback). Uses approved → revised → requested qty.
  const applyIndent = (ind) => {
    setIndent(ind);
    // JSL: vendor stays Jindal; items + rates are rebuilt by the auto-vendor effect.
    if (poFormatType === "JSL") {
      builtJslIndentRef.current = "__none__";
      return;
    }
    // Multi-vendor (Step 1.3) approved vendors drive the vendor picker when present.
    const avs = ind?.quotationApprovalStep?.approvedVendors || [];
    setApprovedVendors(avs);
    setApprovedVendorId("");
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
        itemName: it.itemName || "",
        skuCode: it.skuCode || "",
        skuId: it.skuId || "",
        quantity:
          it.approvedQuantity || it.revisedQuantity || it.quantity || "",
        unit: it.unit || "Pcs",
        indentItemId: it._id || "",
        indentItemDisplayNumber: itemRef(ind.indentNumber, it, idx),
      }));
      return lines.length ? lines : cur;
    });
  };

  // Multi-vendor: select one approved vendor (Step 1.3) → prefill that vendor's
  // approved items (qty/rate/gst). One PO is created per approved vendor.
  const applyApprovedVendor = (av) => {
    if (!av) {
      setApprovedVendorId("");
      setVendor(null);
      setItems([emptyItem()]);
      return;
    }
    const vid = av.vendorId?._id || av.vendorId || "";
    setApprovedVendorId(vid);
    const party = vendorOptions.find((p) => p._id === vid);
    const v = party || { _id: vid, name: av.vendorName };
    setVendor(v);
    if (party) {
      setHeader((h) => ({
        ...h,
        creditPeriod: party.creditPeriodDays ?? h.creditPeriod,
        paymentTerms:
          h.paymentTerms ||
          (party.creditPeriodDays
            ? `${party.creditPeriodDays} days credit`
            : ""),
      }));
    }
    const lines = (av.items || []).map((it) => ({
      ...emptyItem(),
      itemName: it.itemName || "",
      skuCode: it.skuCode || "",
      skuId: it.skuId?._id || it.skuId || "",
      quantity: it.approvedQty || "",
      unit: it.unit || "Pcs",
      rate: it.approvedRate ?? "",
      gstRate: it.gstRate ?? 18,
      // Approved-quotation rates are negotiated — keep them; don't overwrite from
      // the Vendor Master catalog (and don't treat them as a user rate edit). The
      // lookup still shows the vendor's catalog rate; a rate other than the
      // quotation's AND the vendor's is the doer's change.
      manual: true,
      fromQuotation: true,
      quotationRate: it.approvedRate ?? undefined,
    }));
    setItems(lines.length ? lines : [emptyItem()]);
  };

  // Vendor select: snapshot terms only. Item rate/GST/HSN auto-fill is handled
  // reactively by the OTHER auto-fill effect below (re-runs on vendor / item /
  // SKU change), so the catalog match logic lives in one place; the default
  // Lead Time by the vendor-default effect above.
  const applyVendor = (v) => {
    setVendor(v);
    if (!v) return;
    setHeader((h) => ({
      ...h,
      creditPeriod: v.creditPeriodDays ?? h.creditPeriod,
      paymentTerms:
        h.paymentTerms ||
        (v.creditPeriodDays ? `${v.creditPeriodDays} days credit` : ""),
    }));
  };

  // New PO item-picker (OTHER + JSL create): selecting approved items builds the PO
  // item table directly — one read-only row per selected item, qty preset to the
  // approved quantity, rows shaped to the current format. Rates auto-fill from the
  // Vendor Master (OTHER) / Jindal catalog (JSL). The same indent's other items stay
  // available for separate POs.
  // `assigned` (optional) sets the Assigned Vendor dropdown along with the items.
  const applyApprovedItems = (vals, assigned) => {
    if (assigned !== undefined) setAssignedVendorId(assigned);
    setSelectedApprovedItems(vals);
    // Rows of items that stay selected keep their edits (qty, rate, reason).
    const kept = new Map(
      items
        .filter((it) => it.indentItemId)
        .map((it) => [String(it.indentItemId), it]),
    );
    const fresh = buildRowsFromApproved(vals, poFormatType);
    setItems(
      vals.length
        ? fresh.map((row, i) => kept.get(String(vals[i].indentItemId)) || row)
        : fresh,
    );
    // By vendor: each item keeps its own vendor — there is no single PO vendor.
    if (groupMode) return;
    // Items fixed to one vendor (approved quotation / Pending-for-PO pick) fill the
    // Vendor field with it; the field stays locked while they are selected.
    const fixed = fixedVendorOf(vals);
    if (
      fixed &&
      !fixed.conflict &&
      String(vendor?._id || "") !== fixed.vendorId
    ) {
      applyVendor(
        vendorOptions.find((o) => String(o._id) === fixed.vendorId) || {
          _id: fixed.vendorId,
          name: fixed.vendorName,
        },
      );
    }
  };

  // Assigned Vendor picked: carry that vendor and all its eligible items (in the
  // dropdown's scope) into the form. '' goes back to choosing items manually and
  // keeps the current selection.
  const chooseAssignedVendor = (id) => {
    if (!id) {
      setAssignedVendorId("");
      return;
    }
    applyApprovedItems(
      assignedVendors.find((g) => g.vendorId === id)?.items || [],
      id,
    );
  };

  // Preset indent (opened from Indent Detail / list / My FMS Tasks): pre-select all
  // of that indent's approved items once the fresh list loads — every vendor's,
  // each grouped under its vendor below. Runs once per open.
  // `presetItemIds` (PO list's Pending for PO row) narrows it to those items.
  const presetAppliedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      presetAppliedRef.current = false;
      return;
    }
    if (!approvedItemMode || !presetIndent?._id || presetAppliedRef.current)
      return;
    if (!approvedItemOptions.length || approvedItemsFetching) return;
    const wanted = presetItemIds?.length
      ? new Set(presetItemIds.map(String))
      : null;
    const mine = approvedItemOptions.filter(
      (o) =>
        String(o.indentId) === String(presetIndent._id) &&
        (!wanted || wanted.has(String(o.indentItemId))) &&
        !itemVendorBlock(o),
    );
    presetAppliedRef.current = true;
    if (mine.length) applyApprovedItems(mine, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    approvedItemMode,
    presetIndent,
    presetItemIds,
    approvedItemOptions,
    approvedItemsFetching,
  ]);

  // OTHER format: the vendor rate of every line, from the server's own lookup
  // (vendor + SKU + name + unit — never another vendor's, unit's or item's rate).
  // Re-asked whenever the vendor, the item or its unit changes; no page refresh.
  // Answers are applied by row id and only while the row still asks that question.
  // One independent request per line (not one lazy-query trigger: calling that again
  // supersedes the call before it, which would drop all but the last line's answer).
  const dispatch = useDispatch();
  const lookupRate = (params) =>
    dispatch(
      procurementApi.endpoints.getVendorRate.initiate(params, {
        subscribe: false,
        forceRefetch: true,
      }),
    );
  const [rateRetry, setRateRetry] = useState(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const lookupSig = useMemo(
    () =>
      poFormatType === "JSL"
        ? ""
        : items
            .map((it) => `${it.rid || ""}:${lookupKeyOf(vendor?._id, it)}`)
            .join("§"),
    [items, vendor?._id, poFormatType],
  );
  const sentRates = useRef(new Set()); // rid:key of the requests already out
  useEffect(() => {
    if (!open || poFormatType === "JSL") return undefined;
    const vendorId = vendor?._id ? String(vendor._id) : "";
    // 1) At once: a row whose vendor / item / unit changed gives up the old answer
    //    (never show or keep the previous vendor's rate while the new one loads).
    const ask = new Set();
    const reset = new Set();
    itemsRef.current.forEach((it) => {
      if (!it.rid) return;
      const key = lookupKeyOf(vendorId, it);
      if (!key) {
        if (it.rateLookup) reset.add(it.rid);
        return;
      }
      if (it.rateLookup?.key !== key) ask.add(it.rid);
    });
    if (ask.size || reset.size) {
      setItems((cur) =>
        cur.map((it) => {
          if (ask.has(it.rid))
            return startLookup(it, lookupKeyOf(vendorId, it), { lockRates });
          if (reset.has(it.rid)) return resetLookup(it, { lockRates });
          return it;
        }),
      );
    }
    // 2) After a short pause (a SKU typed by hand is asked once, not per keystroke):
    //    send the request of every row still waiting for its answer.
    const timer = setTimeout(() => {
      itemsRef.current.forEach((it) => {
        const key = lookupKeyOf(vendorId, it);
        if (
          !it.rid ||
          !key ||
          it.rateLookup?.key !== key ||
          it.rateLookup.status !== LOOKUP.LOADING
        )
          return;
        const tag = `${it.rid}:${key}`;
        if (sentRates.current.has(tag)) return;
        sentRates.current.add(tag);
        (async () => {
          let res = null;
          let err = null;
          try {
            res = await lookupRate(lookupParams(vendorId, it)).unwrap();
          } catch (e) {
            err = e;
          }
          sentRates.current.delete(tag);
          setItems((cur) =>
            cur.map((row) =>
              row.rid === it.rid
                ? applyAnswer(row, key, answerOf(res?.data, err), res?.data)
                : row,
            ),
          );
        })();
      });
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, poFormatType, lockRates, lookupSig, rateRetry]);
  const retryRates = () => {
    setItems((cur) =>
      cur.map((it) =>
        it.rateLookup?.status === LOOKUP.ERROR
          ? { ...it, rateLookup: undefined }
          : it,
      ),
    );
    setRateRetry((n) => n + 1);
  };

  const setItem = (idx, patch) =>
    setItems((cur) =>
      cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)),
    );
  const addItem = () => setItems((cur) => [...cur, emptyItemFor(poFormatType)]);
  const removeItem = (idx) =>
    setItems((cur) =>
      cur.length > 1
        ? cur.filter((_, i) => i !== idx)
        : [emptyItemFor(poFormatType)],
    );
  // Approved-item rows: drop the row AND its picker selection (preserve other edits).
  const removeApprovedRow = (idx) => {
    const target = items[idx];
    setSelectedApprovedItems((cur) =>
      cur.filter(
        (o) => String(o.indentItemId) !== String(target?.indentItemId),
      ),
    );
    setItems((cur) => cur.filter((_, i) => i !== idx));
  };
  // ── New PO by vendor (groupMode) ───────────────────────────────────────────
  // Every item goes on its vendor's PO: the vendor fixed for it (approved
  // quotation / Pending for PO — locked here), or the one picked here for an item
  // that has none. A pick stays on the form; the PO records it, nothing else is saved.
  const vendorById = useMemo(
    () => new Map(vendorOptions.map((v) => [String(v._id), v])),
    [vendorOptions],
  );
  const approvedById = useMemo(
    () =>
      new Map(selectedApprovedItems.map((o) => [String(o.indentItemId), o])),
    [selectedApprovedItems],
  );
  const isFixedItem = (row) => {
    const o = approvedById.get(String(row.indentItemId));
    return o?.vendorState === "SET" && Boolean(o.vendorId);
  };
  const vendorKeyOf = (row) => {
    const o = approvedById.get(String(row.indentItemId));
    if (o?.vendorState === "SET" && o.vendorId) return String(o.vendorId);
    return itemVendorPicks[String(row.indentItemId)] || "";
  };
  // One group (= one PO) per vendor, by name; items with no vendor yet come last.
  const vendorGroups = (() => {
    if (!groupMode) return [];
    const byKey = new Map();
    items.forEach((it, idx) => {
      if (!it.indentItemId) return;
      const key = vendorKeyOf(it);
      if (!byKey.has(key)) {
        const o = approvedById.get(String(it.indentItemId));
        const v = key
          ? vendorById.get(key) || { _id: key, name: o?.vendorName || "" }
          : null;
        byKey.set(key, { key, vendor: v, rows: [] });
      }
      byKey.get(key).rows.push({ it, idx });
    });
    return [...byKey.values()].sort(
      (a, b) =>
        (a.key ? 0 : 1) - (b.key ? 0 : 1) ||
        String(a.vendor?.name || "").localeCompare(
          String(b.vendor?.name || ""),
        ),
    );
  })();
  const poGroups = vendorGroups.filter((g) => g.key);
  const unassignedGroup = vendorGroups.find((g) => !g.key) || null;

  // A vendor's delivery / payment terms: its own once edited, else from the
  // Vendor Master (default lead time → delivery date, credit period → payment terms).
  const vendorTermsDefault = (v) => ({
    ...inheritVendorLead(
      { poDate: header.poDate, ...EMPTY_DELIVERY },
      vendorLeadDays(v),
    ),
    creditPeriod: v?.creditPeriodDays ?? 0,
    paymentTerms: v?.creditPeriodDays
      ? `${v.creditPeriodDays} days credit`
      : "",
  });
  const termsOfGroup = (g) => ({
    ...(vendorTerms[g.key] || vendorTermsDefault(g.vendor)),
    poDate: header.poDate,
  });
  const setGroupTerms = (g, change) =>
    setVendorTerms((m) => ({
      ...m,
      [g.key]: change({
        ...(m[g.key] || vendorTermsDefault(g.vendor)),
        poDate: header.poDate,
      }),
    }));
  // The PO Date is shared: each vendor's own dates follow it.
  const changePoDate = (val) => {
    setHeader((h) => setPoDate(h, val));
    if (groupMode)
      setVendorTerms((m) =>
        Object.fromEntries(
          Object.entries(m).map(([k, t]) => [k, setPoDate(t, val)]),
        ),
      );
  };

  // Pick (or clear) the vendor of an item that has none; its rate then comes from
  // that vendor's catalog.
  const pickItemVendor = (row, vendorId) => {
    const id = String(row.indentItemId);
    setItemVendorPicks((m) => ({ ...m, [id]: vendorId || "" }));
    setItems((cur) =>
      cur.map((it) =>
        String(it.indentItemId) === id
          ? {
              ...it,
              rate: "",
              autoRate: undefined,
              autoGst: undefined,
              rateMatched: undefined,
              manual: false,
              rateEdited: false,
              rateChangeReason: "",
            }
          : it,
      ),
    );
  };
  // "Add vendor" for an item no vendor carries yet: the new vendor is picked for it.
  const [addVendorFor, setAddVendorFor] = useState(null);

  // By vendor: rate / GST / HSN from each item's own vendor's catalog — filled
  // while rendering whenever the items, their vendors or the catalogs change
  // (rows already matched or edited by hand are left as they are).
  const fillKey =
    open && groupMode
      ? `${items.map((it) => `${it.indentItemId}|${vendorKeyOf(it)}`).join("§")}#${otherMatchKey}`
      : "";
  const [filledFor, setFilledFor] = useState({ key: "", vendors: null });
  if (fillKey !== filledFor.key || vendorOptions !== filledFor.vendors) {
    setFilledFor({ key: fillKey, vendors: vendorOptions });
    const next = items.map((it) => {
      const products = vendorById.get(vendorKeyOf(it))?.products || [];
      if (!fillKey || !it.indentItemId || !products.length) return it;
      return fillOtherRates([it], products)[0];
    });
    if (next.some((row, i) => row !== items[i])) setItems(next);
  }

  // Switching format keeps the selected approved items and just remaps the rows to
  // the new shape (OTHER ⇄ JSL) — no reset, no page reload. JSL also drops any
  // multi-vendor approved selection (JSL always uses Jindal, auto-selected by the
  // JSL effect). In edit mode this control isn't shown.
  const handleFormatChange = (next) => {
    if (next === poFormatType) return;
    builtJslIndentRef.current = "__none__";
    setIndent(null);
    if (next === "JSL") {
      setApprovedVendors([]);
      setApprovedVendorId("");
    }
    setPoFormatType(next);
    setItems(buildRowsFromApproved(selectedApprovedItems, next));
    // Terms left at the old format's default follow the new format's default.
    if (terms.edited && terms.text === termsDefaults?.[poFormatType])
      setTerms({ text: "", edited: false });
  };

  const isJsl = poFormatType === "JSL";
  const defaultTerms = termsDefaults?.[poFormatType] || "";
  const effectiveTerms = terms.edited ? terms.text : defaultTerms;
  const saveTerms = (text) => {
    setTerms({ text, edited: text !== defaultTerms });
    setTermsOpen(false);
  };

  // Vendor filter (New PO item-picker): the vendor dropdown is limited to Vendor
  // Master records whose catalog (products[]) carries EVERY selected item's SKU —
  // i.e. vendors we can actually buy all the chosen items from. JSL is exempt (it
  // is always Jindal). `null` = no restriction (no items selected yet, or JSL).
  const selectedSkuCodes = useMemo(
    () => [
      ...new Set(
        selectedApprovedItems
          .map((it) => String(it.skuCode || "").toUpperCase())
          .filter(Boolean),
      ),
    ],
    [selectedApprovedItems],
  );
  const skuFilteredVendors = useMemo(() => {
    if (!approvedItemMode || isJsl || !selectedSkuCodes.length) return null;
    const hasSku = (v, sku) =>
      (v.products || []).some(
        (p) => String(p.skuCode || "").toUpperCase() === sku,
      );
    return vendorOptions.filter((v) =>
      selectedSkuCodes.every((sku) => hasSku(v, sku)),
    );
  }, [approvedItemMode, isJsl, selectedSkuCodes, vendorOptions]);

  const vendorOptionsFiltered = skuFilteredVendors || vendorOptions;
  // No Vendor Master record carries the selected SKU(s) → prompt to add one.
  const noVendorForSku =
    skuFilteredVendors !== null && skuFilteredVendors.length === 0;

  const [addVendorOpen, setAddVendorOpen] = useState(false);

  // Auto-select when exactly one vendor matches; drop a vendor that no longer
  // covers the selected SKUs once the item selection changes.
  useEffect(() => {
    if (isJsl || groupMode || !skuFilteredVendors || fixedVendor) return;
    if (skuFilteredVendors.length === 1) {
      if (vendor?._id !== skuFilteredVendors[0]._id)
        applyVendor(skuFilteredVendors[0]);
    } else if (
      vendor?._id &&
      !skuFilteredVendors.some((v) => v._id === vendor._id)
    ) {
      setVendor(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skuFilteredVendors]);

  // Why the selected items can't go on this PO's vendor ('' = they can).
  const vendorConflict = (() => {
    if (!fixedVendor) return "";
    if (fixedVendor.conflict)
      return `The selected items are fixed to different vendors (${fixedVendor.vendors.join(", ")}) — raise one PO per vendor.`;
    const jindal = isJsl ? findJslVendor(vendorOptions) : null;
    if (jindal && String(jindal._id) !== fixedVendor.vendorId) {
      return `The selected item(s) must be bought from "${fixedVendor.vendorName}" — a JSL PO is always ${JSL_VENDOR_NAME}. Use the Other format.`;
    }
    return "";
  })();

  // After adding a vendor for the selected item(s): select it and auto-fill rates.
  const handleVendorAdded = (added) => {
    if (added?._id) applyVendor(added);
  };

  const totals = useMemo(() => {
    if (isJsl) {
      const taxable = items.reduce((s, it) => s + jslLineCalc(it).value, 0);
      const tax = (taxable * JSL_GST) / 100;
      return { taxable, tax, grand: taxable + tax };
    }
    const t = items.reduce(
      (acc, it) => {
        const { taxable, tax } = lineCalc(it);
        return { taxable: acc.taxable + taxable, tax: acc.tax + tax };
      },
      { taxable: 0, tax: 0 },
    );
    return { ...t, grand: t.taxable + t.tax };
  }, [items, isJsl]);

  const deliveryError = deliveryErrors(header);
  // Says when the Lead Time is the vendor's default, or what that default is
  // when the user's own value differs from it.
  const leadHint =
    header.leadSource === "VENDOR"
      ? "From vendor master"
      : vendorDefaultLead != null &&
          parseLeadDays(header.leadTime) !== vendorDefaultLead
        ? `Vendor default: ${vendorDefaultLead} day${vendorDefaultLead === 1 ? "" : "s"}`
        : "";

  const validItems = isJsl
    ? items.filter(
        (it) =>
          Number(it.quantity) > 0 &&
          (it.grade?.trim() || it.finish?.trim() || it.width?.trim()),
      )
    : items.filter((it) => it.itemName?.trim() && Number(it.quantity) > 0);

  const rateChangeCount = isJsl
    ? 0
    : validItems.filter((it) => rateChangeOf(it).needsReason).length;

  // One OTHER line as the server takes it.
  const otherLinePayload = (it) => ({
    itemName: it.itemName.trim(),
    skuCode: it.skuCode?.trim() || "",
    skuId: it.skuId || undefined,
    hsn: it.hsn?.trim() || "",
    indentId: it.indentId || undefined,
    indentNumber: it.indentNumber || "",
    indentItemId: it.indentItemId || undefined,
    indentItemDisplayNumber: it.indentItemDisplayNumber || "",
    quantity: Number(it.quantity),
    unit: toKgsUnit(it.unit) || "Pcs",
    rate: Number(it.rate) || 0,
    gstRate: Number(it.gstRate) || 0,
    rateSource: rateSourceOf(it),
    rateChangeReason: String(it.rateChangeReason || "").trim(),
  });

  // Shared PO payload (vendor snapshot + terms + items) used by save AND preview.
  const buildPayload = () => ({
    vendorId: vendor?._id,
    poFormatType,
    poDate: header.poDate,
    expectedDeliveryDate: header.expectedDeliveryDate,
    vendorName: vendor?.name || "",
    vendorGST: vendor?.gstNo || "",
    vendorPAN: vendor?.panNo || "",
    vendorAddress: vendor?.location || vendor?.address || "",
    vendorEmail: vendor?.email || "",
    vendorPhone: vendor?.phone || "",
    deliveryTerms: header.deliveryTerms.trim(),
    paymentTerms: header.paymentTerms.trim(),
    // Days only — the server checks it against the dates and stores its text.
    leadTimeDays: parseLeadDays(header.leadTime),
    creditPeriod: Number(header.creditPeriod) || 0,
    remarks: header.remarks.trim(),
    // Blank = the format's default (the server stores it on save).
    termsAndConditions: terms.edited ? terms.text : "",
    items: validItems.map((it) =>
      isJsl
        ? {
            grade: it.grade?.trim() || "",
            width: it.width?.trim() || "",
            finish: it.finish?.trim() || "",
            itemName: it.itemName?.trim() || "",
            skuCode: it.skuCode?.trim() || "",
            skuId: it.skuId || undefined,
            indentId: it.indentId || undefined,
            indentNumber: it.indentNumber || "",
            indentItemId: it.indentItemId || undefined,
            indentItemDisplayNumber: it.indentItemDisplayNumber || "",
            quantity: Number(it.quantity),
            unit: it.unit || "Kgs",
            baseRate: Number(it.baseRate) || 0,
            upfrontDiscount: Number(it.upfrontDiscount) || 0,
            bonanzaDiscount: Number(it.bonanzaDiscount) || 0,
          }
        : otherLinePayload(it),
    ),
  });

  // By vendor: one vendor's PO — its own vendor, delivery and payment terms and
  // items; PO Date, Delivery Terms, Remarks and Terms & Conditions are shared.
  const groupPayload = (g) => {
    const t = termsOfGroup(g);
    const v = g.vendor || {};
    return {
      vendorId: v._id,
      poFormatType: "OTHER",
      poDate: header.poDate,
      expectedDeliveryDate: t.expectedDeliveryDate,
      vendorName: v.name || "",
      vendorGST: v.gstNo || "",
      vendorPAN: v.panNo || "",
      vendorAddress: v.location || v.address || "",
      vendorEmail: v.email || "",
      vendorPhone: v.phone || "",
      deliveryTerms: header.deliveryTerms.trim(),
      paymentTerms: String(t.paymentTerms || "").trim(),
      leadTimeDays: parseLeadDays(t.leadTime),
      creditPeriod: Number(t.creditPeriod) || 0,
      remarks: header.remarks.trim(),
      termsAndConditions: terms.edited ? terms.text : "",
      items: g.rows
        .map(({ it }) => it)
        .filter((it) => it.itemName?.trim() && Number(it.quantity) > 0)
        .map(otherLinePayload),
    };
  };

  // Why a vendor's PO can't be saved yet ('' = it can).
  const groupProblem = (g) => {
    const t = termsOfGroup(g);
    const name = g.vendor?.name || "Vendor";
    const rows = g.rows.map(({ it }) => it);
    const de = deliveryErrors(t);
    if (de.edd) return `${name}: Expected Delivery Date — ${de.edd}`;
    if (de.lead) return `${name}: Lead Time — ${de.lead}`;
    if (!rows.some((it) => it.itemName?.trim() && Number(it.quantity) > 0))
      return `${name}: add a quantity`;
    const noReason = rows.find(
      (it) =>
        Number(it.quantity) > 0 &&
        rateChangeOf(it).needsReason &&
        !String(it.rateChangeReason || "").trim(),
    );
    if (noReason)
      return `Give a reason for changing the rate of "${noReason.itemName}" — it goes to Rate Change Approvals`;
    const badQty = rows.find(
      (it) => Number(it.quantity) > Number(it.approvedQuantity || 0),
    );
    if (badQty)
      return `Qty for "${badQty.itemName}" cannot exceed approved ${badQty.approvedQuantity}`;
    return "";
  };

  // Preview PDF — render a temporary PDF from the current form (or, by vendor, one
  // vendor's PO), no DB save.
  const handlePreview = async (group = null) => {
    const body = group ? groupPayload(group) : buildPayload();
    if (body.items.length === 0) {
      enqueueSnackbar(
        isJsl
          ? "Add at least one item with grade and quantity to preview"
          : "Add at least one item to preview",
        { variant: "warning" },
      );
      return;
    }
    try {
      const blob = await previewPdf(body).unwrap();
      // Guard against an error body that slipped through as JSON instead of a PDF.
      if (!(blob instanceof Blob) || blob.type === "application/json") {
        throw new Error("Preview did not return a PDF");
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPreviewOpen(true);
    } catch (err) {
      enqueueSnackbar(
        err?.data?.message || err?.message || "Failed to generate PDF preview",
        { variant: "error" },
      );
    }
  };

  const closePreview = () => {
    setPreviewOpen(false);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl("");
    }
  };

  // By vendor: one PO per vendor, created one after another. A vendor whose PO is
  // refused keeps its items on the form (with the reason); created ones leave it.
  const submitByVendor = async (saveMode) => {
    const warn = (msg) => enqueueSnackbar(msg, { variant: "warning" });
    if (!selectedApprovedItems.length || !vendorGroups.length) {
      warn("Select at least one approved item");
      return;
    }
    const blocked = selectedApprovedItems.find((o) => itemVendorBlock(o));
    if (blocked) {
      warn(`${blocked.indentItemDisplayNumber}: ${itemVendorBlock(blocked)}`);
      return;
    }
    if (unassignedGroup) {
      warn(
        `Pick a vendor for "${unassignedGroup.rows[0].it.itemName}" — or remove it`,
      );
      return;
    }
    const problem = poGroups.map(groupProblem).find(Boolean);
    if (problem) {
      warn(problem);
      return;
    }

    const direct = saveMode === "DIRECT" && canDirectSave;
    const created = [];
    const failed = [];
    setPendingMode(saveMode);
    for (const g of poGroups) {
      try {
        const res = await createFromItems({
          ...groupPayload(g),
          saveMode: direct ? "DIRECT" : "DRAFT",
        }).unwrap();
        created.push({ g, po: res?.data });
      } catch (err) {
        failed.push({
          g,
          message: err?.data?.message || "Failed to save purchase order",
        });
      }
    }
    setPendingMode("");

    if (created.length) {
      const list = created
        .map(
          ({ g, po: saved }) => `${poDisplayNumber(saved)} (${g.vendor?.name})`,
        )
        .join(", ");
      const approved = created.every(
        ({ po: saved }) => saved?.approvalStatus === "APPROVED",
      );
      enqueueSnackbar(
        approved
          ? `${created.length === 1 ? "PO" : `${created.length} POs`} created — approved and ready to release: ${list}`
          : `${created.length === 1 ? "PO" : `${created.length} POs`} saved as draft — waiting for PO Approval: ${list}`,
        { variant: direct && !approved ? "warning" : "success" },
      );
      const rateChanges = created
        .flatMap(({ g }) => g.rows)
        .filter(({ it }) => rateChangeOf(it).needsReason).length;
      if (rateChanges && !approved) {
        enqueueSnackbar(
          `${rateChanges} rate change${rateChanges === 1 ? "" : "s"} sent to Rate Change Approvals`,
          { variant: "info" },
        );
      }
    }
    failed.forEach(({ g, message }) =>
      enqueueSnackbar(`${g.vendor?.name}: ${message}`, { variant: "error" }),
    );
    if (!failed.length) {
      onClose?.(true, created.length === 1 ? created[0].po : undefined);
      return;
    }
    if (created.length) {
      const done = new Set(
        created.flatMap(({ g }) =>
          g.rows.map(({ it }) => String(it.indentItemId)),
        ),
      );
      setSelectedApprovedItems((cur) =>
        cur.filter((o) => !done.has(String(o.indentItemId))),
      );
      setItems((cur) => cur.filter((it) => !done.has(String(it.indentItemId))));
    }
  };

  // saveMode: 'DRAFT' (default) | 'DIRECT' — only meaningful for a new PO.
  const handleSubmit = async (saveMode = "DRAFT") => {
    if (groupMode) {
      await submitByVendor(saveMode);
      return;
    }
    if (!vendor?._id) {
      enqueueSnackbar("Vendor is mandatory", { variant: "warning" });
      return;
    }
    if (!header.expectedDeliveryDate) {
      enqueueSnackbar("Expected Delivery Date is required", {
        variant: "warning",
      });
      return;
    }
    if (deliveryError.edd) {
      enqueueSnackbar(`Expected Delivery Date: ${deliveryError.edd}`, {
        variant: "warning",
      });
      return;
    }
    if (deliveryError.lead) {
      enqueueSnackbar(`Lead Time: ${deliveryError.lead}`, {
        variant: "warning",
      });
      return;
    }
    if (vendorConflict) {
      enqueueSnackbar(vendorConflict, { variant: "warning" });
      return;
    }
    if (approvedItemMode) {
      if (!selectedApprovedItems.length) {
        enqueueSnackbar("Select at least one approved item", {
          variant: "warning",
        });
        return;
      }
      const blocked = selectedApprovedItems.find((o) => itemVendorBlock(o));
      if (blocked) {
        enqueueSnackbar(
          `${blocked.indentItemDisplayNumber}: ${itemVendorBlock(blocked)}`,
          { variant: "warning" },
        );
        return;
      }
    } else if (!isEdit && !isRevise && !indent?._id) {
      enqueueSnackbar("Select an approved indent first", {
        variant: "warning",
      });
      return;
    }
    if (validItems.length === 0) {
      enqueueSnackbar(
        isJsl
          ? "Add at least one item with grade and quantity"
          : "Add at least one item with quantity",
        { variant: "warning" },
      );
      return;
    }
    // The vendor rates must be in before saving: a rate fetched late would be
    // compared against nothing, and a line the vendor prices in another unit /
    // twice cannot be saved at all (the server refuses it with the same words).
    if (!isJsl) {
      if (validItems.some((it) => awaitsRate(it, vendor?._id))) {
        enqueueSnackbar(
          "Still fetching the vendor rates — try again in a moment",
          { variant: "info" },
        );
        return;
      }
      const blockedLine = validItems.find((it) => lookupBlock(it));
      if (blockedLine) {
        enqueueSnackbar(lookupBlock(blockedLine), { variant: "warning" });
        return;
      }
    }
    // A changed rate goes to Rate Change Approvals and needs a reason.
    if (!isJsl) {
      const noReason = validItems.find(
        (it) =>
          rateChangeOf(it).needsReason &&
          !String(it.rateChangeReason || "").trim(),
      );
      if (noReason) {
        enqueueSnackbar(
          `Give a reason for changing the rate of "${noReason.itemName}" — it goes to Rate Change Approvals`,
          { variant: "warning" },
        );
        return;
      }
    }
    // Item-picker qty must stay within the approved quantity.
    if (approvedItemMode) {
      const badQty = validItems.find(
        (it) => Number(it.quantity) > Number(it.approvedQuantity || 0),
      );
      if (badQty) {
        enqueueSnackbar(
          `Qty for "${badQty.itemName}" cannot exceed approved ${badQty.approvedQuantity}`,
          { variant: "warning" },
        );
        return;
      }
    }

    const payload = buildPayload();
    const direct = isCreate && saveMode === "DIRECT" && canDirectSave;
    // A direct save comes back APPROVED with its final number; if the server's
    // approval step didn't go through, the PO is still saved as a draft.
    const notifyCreated = (saved) => {
      if (saved?.approvalStatus === "APPROVED") {
        enqueueSnackbar(
          `PO ${poDisplayNumber(saved)} created — approved and ready to release`,
          { variant: "success" },
        );
      } else if (direct) {
        enqueueSnackbar(
          `PO ${poDisplayNumber(saved)} saved as draft — approve it from the PO detail`,
          { variant: "warning" },
        );
      } else {
        enqueueSnackbar(
          `PO ${poDisplayNumber(saved)} saved as draft — it now waits for approval in PO Approval`,
          { variant: "success" },
        );
      }
    };

    setPendingMode(saveMode);
    try {
      let created;
      if (isRevise) {
        // New draft PO from the cancelled one — source indents derived server-side.
        const res = await revisePo({ id: reviseFrom._id, ...payload }).unwrap();
        enqueueSnackbar(
          `Revised PO ${poDisplayNumber(res?.data)} saved as draft`,
          { variant: "success" },
        );
        created = res?.data;
      } else if (isEdit) {
        await updatePo({ id: po._id, ...payload }).unwrap();
        enqueueSnackbar("Purchase order updated", { variant: "success" });
      } else if (approvedItemMode) {
        // Item-wise: one vendor, hand-picked approved items (source indents derived).
        const res = await createFromItems({
          ...payload,
          saveMode: direct ? "DIRECT" : "DRAFT",
        }).unwrap();
        notifyCreated(res?.data);
        created = res?.data;
      } else {
        const res = await createPo({
          ...payload,
          indentId: indent._id,
          saveMode: direct ? "DIRECT" : "DRAFT",
        }).unwrap();
        notifyCreated(res?.data);
        created = res?.data;
      }
      if (rateChangeCount > 0 && !(created?.approvalStatus === "APPROVED")) {
        enqueueSnackbar(
          `${rateChangeCount} rate change${rateChangeCount === 1 ? "" : "s"} sent to Rate Change Approvals`,
          { variant: "info" },
        );
      }
      // Second arg = the newly created/revised PO, so a caller that isn't
      // already on the PO list (e.g. a Quick Action) can open it.
      onClose?.(true, created);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || "Failed to save purchase order", {
        variant: "error",
      });
    } finally {
      setPendingMode("");
    }
  };

  // One OTHER item row (Items table; by vendor, inside its vendor's group).
  // `extra` shows next to the item reference.
  const renderOtherRow = (it, idx, extra = null) => {
    const { taxable, tax, total } = lineCalc(it);
    // Came from an indent / has an item, but no Vendor-Master rate matched and none entered yet.
    const rateMissing =
      it.rateMatched === false &&
      Boolean(it.itemName) &&
      !(Number(it.rate) > 0);
    // Item Name & SKU are read-only for any known item (approved-item / indent / edit / revise);
    // only a brand-new blank "Add Item" row lets you type a name.
    const nameLocked = Boolean(it.fromApprovedItem || it.itemName);
    // Flag a user override of the auto-filled Vendor-Master rate/GST.
    const rateModified =
      (it.autoRate != null && Number(it.rate) !== Number(it.autoRate)) ||
      (it.autoGst != null && Number(it.gstRate) !== Number(it.autoGst));
    const rc = rateChangeOf(it);
    const rcStatus =
      !rc.needsReason && it.rateChangeRequestNumber
        ? RATE_STATUS[it.rateChangeStatus]
        : null;
    return (
      <Box
        key={idx}
        sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: OTHER_GRID },
            gap: 1,
            alignItems: "center",
            p: { xs: 1.5, md: 0.5 },
            px: { md: 1 },
            borderRadius: "10px",
            border: rateMissing ? "1px solid" : { xs: "1px solid", md: "none" },
            borderColor: rateMissing ? "warning.main" : "divider",
            bgcolor: rateMissing ? alpha("#f59e0b", 0.06) : "transparent",
            "&:hover": {
              bgcolor: rateMissing
                ? alpha("#f59e0b", 0.1)
                : alpha("#2563eb", 0.03),
            },
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            {nameLocked ? (
              // Known item — name is read-only (no dropdown).
              <Typography
                variant="body2"
                fontWeight={600}
                sx={{ overflowWrap: "anywhere" }}
              >
                {it.itemName || "—"}
              </Typography>
            ) : (
              <Autocomplete
                freeSolo
                options={vendorProducts}
                getOptionLabel={(o) =>
                  typeof o === "string" ? o : o.productName || ""
                }
                value={it.itemName}
                onInputChange={(_e, v, reason) => {
                  if (reason === "input") setItem(idx, { itemName: v });
                }}
                onChange={(_e, val) => {
                  if (val && typeof val === "object") {
                    setItem(idx, {
                      itemName: val.productName,
                      skuCode: val.skuCode || "",
                      skuId: val.skuId || "",
                      rate: val.rate ?? it.rate,
                      unit: val.unit || it.unit,
                      gstRate: val.gstRate ?? it.gstRate,
                      hsn: val.hsn || "",
                      rateMatched: true,
                      manual: false,
                      rateEdited: false,
                      autoRate: val.rate ?? undefined,
                      autoGst: val.gstRate ?? undefined,
                    });
                  }
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    placeholder="Item / vendor product"
                  />
                )}
              />
            )}
            <Box
              sx={{
                display: "flex",
                gap: 0.75,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              {it.indentItemDisplayNumber ? (
                <Typography
                  variant="caption"
                  sx={{ color: "primary.main", fontWeight: 700, pl: 0.5 }}
                >
                  {it.indentItemDisplayNumber}
                </Typography>
              ) : null}
              {extra}
              {rc.needsReason ? (
                <Chip
                  size="small"
                  label="Needs approval"
                  data-testid="po-rate-needs-approval"
                  sx={{
                    height: 18,
                    fontSize: "0.6rem",
                    fontWeight: 800,
                    bgcolor: alpha("#dc2626", 0.12),
                    color: "#b91c1c",
                  }}
                />
              ) : (
                rateModified && (
                  <Chip
                    size="small"
                    label="Rate Modified"
                    sx={{
                      height: 18,
                      fontSize: "0.6rem",
                      fontWeight: 700,
                      bgcolor: alpha("#f59e0b", 0.15),
                      color: "#b45309",
                    }}
                  />
                )
              )}
              {rcStatus && (
                <Chip
                  size="small"
                  label={`Rate ${rcStatus.label.toLowerCase()} · ${it.rateChangeRequestNumber}`}
                  data-testid="po-rate-change-status"
                  sx={{
                    height: 18,
                    fontSize: "0.6rem",
                    fontWeight: 800,
                    bgcolor: rcStatus.bg,
                    color: rcStatus.color,
                  }}
                />
              )}
            </Box>
          </Box>
          {nameLocked ? (
            <Typography variant="body2" color="primary.main" fontWeight={700}>
              {it.skuCode || "—"}
            </Typography>
          ) : (
            <TextField
              size="small"
              placeholder="SKU"
              value={it.skuCode}
              onChange={(e) =>
                setItem(idx, { skuCode: e.target.value.toUpperCase() })
              }
            />
          )}
          <TextField
            size="small"
            type="number"
            placeholder="0"
            value={it.quantity}
            onChange={(e) => setItem(idx, { quantity: e.target.value })}
            inputProps={{ min: 0, style: { textAlign: "right" } }}
            sx={NO_SPIN}
          />
          {/* A line filled from an indent, vendor product or saved PO may say "Kg" —
            shown and saved as KGS, the dropdown's spelling. */}
          {/* The row's own unit is always an option (an indent bound to a
            SKU's purchase unit says "BOX", not the list's "Box"), so the
            select never shows blank for a unit it was actually given. */}
          <TextField
            size="small"
            select
            value={toKgsUnit(it.unit)}
            onChange={(e) => setItem(idx, { unit: e.target.value })}
            inputProps={{ "data-testid": "po-line-unit" }}
          >
            {(UNITS.includes(toKgsUnit(it.unit)) || !it.unit
              ? UNITS
              : [toKgsUnit(it.unit), ...UNITS]
            ).map((u) => (
              <MenuItem key={u} value={u}>
                {u}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="number"
            placeholder="0.00"
            value={it.rate}
            onChange={(e) =>
              setItem(idx, {
                rate: e.target.value,
                manual: true,
                rateEdited: true,
              })
            }
            inputProps={{ min: 0, step: 0.01, style: { textAlign: "right" } }}
            sx={NO_SPIN}
          />
          <Autocomplete
            freeSolo
            disableClearable
            size="small"
            options={GST_PRESETS.map(String)}
            value={
              it.gstRate === "" || it.gstRate == null ? "" : String(it.gstRate)
            }
            onInputChange={(_e, v, reason) => {
              const cleaned = v.replace(/[^\d.]/g, "");
              // Only a genuine keystroke marks the row manual. MUI also fires
              // 'reset'/'clear' on mount and on programmatic value changes (e.g.
              // when the vendor-master auto-fill sets the GST); those must NOT
              // flag the row, or auto-fill would be permanently blocked.
              const patch = { gstRate: cleaned === "" ? "" : Number(cleaned) };
              if (reason === "input") {
                patch.manual = true;
                patch.rateEdited = true;
              }
              setItem(idx, patch);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                placeholder="GST %"
                inputProps={{
                  ...params.inputProps,
                  inputMode: "decimal",
                  style: { textAlign: "right" },
                }}
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <Typography
                      variant="caption"
                      sx={{ pr: 0.5, color: "text.secondary" }}
                    >
                      %
                    </Typography>
                  ),
                }}
              />
            )}
          />
          <Typography
            variant="body2"
            sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}
          >
            {taxable.toFixed(2)}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              textAlign: "right",
              fontVariantNumeric: "tabular-nums",
              color: "text.secondary",
            }}
          >
            {tax.toFixed(2)}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              textAlign: "right",
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {total.toFixed(2)}
          </Typography>
          <Tooltip title="Remove">
            <span>
              <IconButton
                size="small"
                color="error"
                onClick={() =>
                  it.fromApprovedItem ? removeApprovedRow(idx) : removeItem(idx)
                }
                disabled={
                  !it.fromApprovedItem && items.length === 1 && !it.itemName
                }
              >
                <Trash2 size={15} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
        {rateMissing && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              pl: { md: 1 },
            }}
          >
            <AlertTriangle size={13} color="#b45309" />
            <Typography
              variant="caption"
              sx={{ color: "#b45309", fontWeight: 600 }}
            >
              Rate not found in Vendor Master for SKU:{" "}
              {it.skuCode || it.itemName || "—"} — enter rate manually
            </Typography>
          </Box>
        )}
        {rc.needsReason && (
          <Box
            sx={{
              display: "flex",
              flexDirection: { xs: "column", md: "row" },
              alignItems: { md: "center" },
              gap: 1,
              pl: { md: 1 },
            }}
          >
            <Typography
              variant="caption"
              data-testid="po-rate-change-hint"
              sx={{ color: "#b91c1c", fontWeight: 600, flex: "1 1 50%" }}
            >
              Vendor rate {fmtRate(rc.fetched)} → {fmtRate(it.rate)} (
              {fmtDiff(
                Number(it.rate) - rc.fetched,
                rc.fetched > 0
                  ? ((Number(it.rate) - rc.fetched) / rc.fetched) * 100
                  : null,
              )}
              ). Goes to Rate Change Approvals — the PO can be approved, and the
              vendor's rate changes, only once it is approved.
            </Typography>
            <TextField
              size="small"
              required
              label="Reason for rate change"
              value={it.rateChangeReason || ""}
              onChange={(e) =>
                setItem(idx, { rateChangeReason: e.target.value })
              }
              error={!String(it.rateChangeReason || "").trim()}
              inputProps={{ maxLength: 500, "data-testid": "po-rate-reason" }}
              sx={{ flex: "1 1 50%" }}
            />
          </Box>
        )}
        {(() => {
          // Purchase unit → stock unit for this line's SKU, when it has one.
          const sku = it.skuId ? lineSkuById.get(String(it.skuId)) : null;
          const rule = conversionRule(sku);
          if (!rule) return null;
          const c = skuConversion(sku);
          const reversed = reversedRuleWarning(sku);
          if (reversed) {
            return (
              <Typography
                variant="caption"
                data-testid="po-line-conversion"
                sx={{ pl: { md: 1 }, fontWeight: 600, color: "#b91c1c" }}
              >
                {reversed}
              </Typography>
            );
          }
          const ok =
            sameUnit(it.unit, c.purchaseUnit) || sameUnit(it.unit, c.stockUnit);
          const qty = Number(it.quantity) || 0;
          return (
            <Typography
              variant="caption"
              data-testid="po-line-conversion"
              sx={{
                pl: { md: 1 },
                fontWeight: 600,
                color: ok ? "text.secondary" : "#b91c1c",
              }}
            >
              {ok
                ? `${rule}${sameUnit(it.unit, c.purchaseUnit) && qty > 0 ? ` · ${qty} ${it.unit} will stock as ${Math.round(qty * c.factor * 100) / 100} ${c.stockUnit}` : ""}`
                : `${rule} — choose ${c.purchaseUnit} or ${c.stockUnit}; ${it.unit} cannot be converted`}
            </Typography>
          );
        })()}
      </Box>
    );
  };

  // Column titles of the OTHER item rows.
  const otherHeaderRow = (
    <Box
      sx={{
        display: { xs: "none", md: "grid" },
        gridTemplateColumns: OTHER_GRID,
        gap: 1,
        px: 1,
        mb: 0.5,
      }}
    >
      {[
        "Item Name",
        "SKU",
        "Qty",
        "Unit",
        "Rate",
        "GST %",
        "Taxable",
        "Tax",
        "Total",
        "",
      ].map((h, i) => (
        <Typography
          key={i}
          variant="caption"
          sx={{
            fontWeight: 700,
            color: "text.secondary",
            textTransform: "uppercase",
            fontSize: "0.62rem",
          }}
        >
          {h}
        </Typography>
      ))}
    </Box>
  );

  // By vendor: one card per vendor (= one PO) — the vendor, its delivery and
  // payment terms, its items and total — then the items that still need a vendor.
  const activeVendors = vendorOptions.filter((v) => v.isActive !== false);
  // Saving several POs runs one request after another — stay busy until all are done.
  const busy = saving || previewing || Boolean(pendingMode);
  const manyPos = groupMode && poGroups.length > 1;
  const renderVendorGroups = () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {poGroups.map((g, gi) => {
        const t = termsOfGroup(g);
        const de = deliveryErrors(t);
        const v = g.vendor || {};
        const poTotal = g.rows.reduce(
          (sum, { it }) => sum + lineCalc(it).total,
          0,
        );
        const defaultLead = vendorLeadDays(v);
        const leadNote =
          t.leadSource === "VENDOR"
            ? "From vendor master"
            : defaultLead != null && parseLeadDays(t.leadTime) !== defaultLead
              ? `Vendor default: ${defaultLead} day${defaultLead === 1 ? "" : "s"}`
              : "";
        return (
          <Box
            key={g.key}
            data-testid="po-vendor-group"
            sx={{
              border: `1px solid ${alpha("#2563eb", 0.25)}`,
              borderRadius: "10px",
              overflow: "hidden",
            }}
          >
            <Box
              sx={{
                px: 2,
                py: 1.25,
                display: "flex",
                alignItems: "center",
                gap: 1.5,
                flexWrap: "wrap",
                bgcolor: alpha("#2563eb", 0.05),
                borderBottom: `1px solid ${alpha("#2563eb", 0.15)}`,
              }}
            >
              <Building2 size={18} color="#1d4ed8" />
              <Box sx={{ flex: 1, minWidth: 220 }}>
                <Typography
                  sx={{ fontWeight: 800, fontSize: "0.95rem", color: PFMS.ink }}
                >
                  {v.name}
                  {poGroups.length > 1 && (
                    <Typography
                      component="span"
                      sx={{
                        ml: 1,
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        color: "text.secondary",
                      }}
                    >
                      PO {gi + 1} of {poGroups.length}
                    </Typography>
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {[
                    v.gstNo && `GST ${v.gstNo}`,
                    v.location || v.address,
                    v.phone,
                    v.email,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </Typography>
              </Box>
              <Box sx={{ textAlign: "right" }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  fontWeight={700}
                >
                  PO TOTAL
                </Typography>
                <Typography
                  sx={{
                    fontWeight: 800,
                    color: "primary.dark",
                    lineHeight: 1.2,
                  }}
                >
                  {fmtINR(poTotal)}
                </Typography>
              </Box>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Eye size={15} />}
                onClick={() => handlePreview(g)}
                disabled={busy}
              >
                Preview PDF
              </Button>
            </Box>

            {/* This vendor's delivery and payment terms */}
            <Grid container spacing={1.5} sx={{ px: 2, pt: 2 }}>
              <Grid item xs={6} sm={3}>
                <DateInputDDMMYYYY
                  label="Expected Delivery Date"
                  fullWidth
                  required
                  value={t.expectedDeliveryDate}
                  onChange={(val) =>
                    setGroupTerms(g, (h) => setDeliveryDate(h, val))
                  }
                  error={Boolean(de.edd)}
                  helperText={de.edd}
                  inputProps={{ "data-testid": "po-expected-delivery" }}
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField
                  label="Lead Time (Days)"
                  fullWidth
                  size="small"
                  value={t.leadTime}
                  placeholder="e.g. 7"
                  inputProps={{
                    inputMode: "numeric",
                    "data-testid": "po-lead-time",
                  }}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (/^\d{0,3}$/.test(raw))
                      setGroupTerms(g, (h) => setLeadTime(h, raw));
                  }}
                  error={Boolean(de.lead)}
                  helperText={de.lead || leadNote}
                  FormHelperTextProps={{ "data-testid": "po-lead-time-hint" }}
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField
                  label="Credit Period (Days)"
                  type="number"
                  fullWidth
                  size="small"
                  value={t.creditPeriod}
                  onChange={(e) =>
                    setGroupTerms(g, (h) => ({
                      ...h,
                      creditPeriod: e.target.value,
                    }))
                  }
                  inputProps={{ min: 0 }}
                />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField
                  label="Payment Terms"
                  fullWidth
                  size="small"
                  value={t.paymentTerms}
                  onChange={(e) =>
                    setGroupTerms(g, (h) => ({
                      ...h,
                      paymentTerms: e.target.value,
                    }))
                  }
                />
              </Grid>
            </Grid>

            <Box sx={{ px: 1, pt: 1.5, pb: 1.5 }}>
              {otherHeaderRow}
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {g.rows.map(({ it, idx }) =>
                  renderOtherRow(
                    it,
                    idx,
                    isFixedItem(it) ? (
                      <Typography
                        variant="caption"
                        sx={{ color: "#0f766e", fontWeight: 600 }}
                      >
                        {VENDOR_SOURCE_LABEL[
                          approvedById.get(String(it.indentItemId))
                            ?.vendorSource
                        ] || "Vendor fixed"}
                      </Typography>
                    ) : (
                      <Button
                        size="small"
                        onClick={() => pickItemVendor(it, "")}
                        sx={{
                          minWidth: 0,
                          py: 0,
                          px: 0.5,
                          fontSize: "0.68rem",
                          fontWeight: 700,
                          textTransform: "none",
                        }}
                      >
                        Change vendor
                      </Button>
                    ),
                  ),
                )}
              </Box>
            </Box>
          </Box>
        );
      })}

      {unassignedGroup && (
        <Box
          data-testid="po-no-vendor-group"
          sx={{
            border: `1px dashed ${alpha("#f59e0b", 0.8)}`,
            borderRadius: "10px",
            overflow: "hidden",
          }}
        >
          <Box
            sx={{
              px: 2,
              py: 1.25,
              display: "flex",
              alignItems: "center",
              gap: 1,
              flexWrap: "wrap",
              bgcolor: alpha("#f59e0b", 0.07),
            }}
          >
            <AlertTriangle size={17} color="#b45309" />
            <Typography
              sx={{
                fontWeight: 800,
                fontSize: "0.92rem",
                color: "#92400e",
                flex: 1,
              }}
            >
              No vendor yet ({unassignedGroup.rows.length})
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Pick a vendor — the item joins that vendor&apos;s PO
            </Typography>
          </Box>
          {unassignedGroup.rows.map(({ it, idx }) => {
            const sku = String(it.skuCode || "").toUpperCase();
            const carries = (o) =>
              Boolean(sku) &&
              (o.products || []).some(
                (p) => String(p.skuCode || "").toUpperCase() === sku,
              );
            const options = [...activeVendors].sort(
              (a, b) => Number(carries(b)) - Number(carries(a)),
            );
            return (
              <Box
                key={it.indentItemId}
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    md: "minmax(0, 1fr) 340px auto 36px",
                  },
                  gap: 1.5,
                  alignItems: "center",
                  px: 2,
                  py: 1.25,
                  borderTop: `1px solid ${alpha("#f59e0b", 0.25)}`,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={700}>
                    {it.itemName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {[
                      it.indentItemDisplayNumber,
                      it.skuCode && `SKU ${it.skuCode}`,
                      `Qty ${it.quantity} ${it.unit || ""}`.trim(),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                </Box>
                <Autocomplete
                  size="small"
                  options={options}
                  value={null}
                  loading={vendorsLoading}
                  onChange={(_e, o) => {
                    if (o) pickItemVendor(it, String(o._id));
                  }}
                  getOptionLabel={(o) => o?.name || ""}
                  isOptionEqualToValue={(o, val) =>
                    String(o._id) === String(val._id)
                  }
                  noOptionsText={
                    vendorsLoading
                      ? "Loading vendors…"
                      : "No active vendor found"
                  }
                  renderOption={(props, o) => (
                    <Box
                      component="li"
                      {...props}
                      key={o._id}
                      sx={{ display: "block !important", py: 0.75 }}
                    >
                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 1,
                        }}
                      >
                        <Typography variant="body2" fontWeight={700}>
                          {o.name}
                        </Typography>
                        {carries(o) && (
                          <Typography
                            variant="caption"
                            sx={{
                              color: "#0f766e",
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                            }}
                          >
                            Has this item
                          </Typography>
                        )}
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {[o.gstNo && `GST: ${o.gstNo}`, o.phone, o.email]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </Typography>
                    </Box>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      placeholder="Select vendor from Vendor Master"
                    />
                  )}
                />
                <Button
                  size="small"
                  startIcon={<Plus size={14} />}
                  sx={{ textTransform: "none", whiteSpace: "nowrap" }}
                  onClick={() =>
                    setAddVendorFor(
                      approvedById.get(String(it.indentItemId)) || it,
                    )
                  }
                >
                  Add vendor
                </Button>
                <Tooltip title="Remove from this PO">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => removeApprovedRow(idx)}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </Tooltip>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );

  return (
    <Dialog
      open={open}
      onClose={() => onClose?.(false)}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          height: { xs: "100%", md: "92vh" },
          display: "flex",
          flexDirection: "column",
          borderRadius: { xs: 0, md: "8px" },
          overflow: "hidden",
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 3,
          py: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background:
            "linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)",
          color: "#fff",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <ShoppingBag size={22} />
          <Box>
            <Typography
              sx={{ fontWeight: 800, fontSize: "1.05rem", color: "#fff" }}
            >
              {isEdit
                ? `Edit ${poDisplayNumber(po)}`
                : isRevise
                  ? `Revise ${poDisplayNumber(reviseFrom)}`
                  : "New Purchase Order"}
            </Typography>
            <Typography
              sx={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.8)" }}
            >
              {isRevise
                ? "Create a new PO from the cancelled one — edit, then Save as Draft"
                : "Step 1.4 · Create PO & Release to Supplier"}
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(false)} sx={{ color: "#fff" }}>
          <X size={20} />
        </IconButton>
      </Box>

      {/* Body */}
      <Box
        sx={{
          flexGrow: 1,
          overflowY: "auto",
          p: 3,
          display: "flex",
          flexDirection: "column",
          gap: 2.5,
          bgcolor: PFMS.canvas,
        }}
      >
        {/* Source + vendor */}
        <Paper elevation={0} sx={SECTION}>
          <Typography
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              mb: 2,
              fontWeight: 700,
              color: "primary.main",
            }}
          >
            <FileText size={18} />{" "}
            {groupMode
              ? "Items & Vendors"
              : approvedItemMode
                ? "Approved Item(s) & Vendor"
                : isRevise
                  ? "Revised Items & Vendor"
                  : "Source Indent & Vendor"}
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={groupMode ? 3 : 4}>
              <TextField
                select
                fullWidth
                required
                label="PO Format Type"
                value={poFormatType}
                onChange={(e) => handleFormatChange(e.target.value)}
                disabled={isEdit || isRevise}
                helperText={
                  isJsl
                    ? "JSL — grade/width/finish + discount pricing"
                    : "Other — standard item / rate"
                }
              >
                <MenuItem value="OTHER">Other</MenuItem>
                <MenuItem value="JSL">JSL</MenuItem>
              </TextField>
            </Grid>
            {/* By vendor every item is listed under its vendor — no single vendor to pick. */}
            {!groupMode && (
              <Grid item xs={12} sm={8}>
                {approvedItemMode && assignedVendors.length > 0 ? (
                  <TextField
                    select
                    fullWidth
                    label="Assigned Vendor"
                    value={assignedVendorId}
                    onChange={(e) => chooseAssignedVendor(e.target.value)}
                    inputProps={{ "data-testid": "assigned-vendor" }}
                    helperText="Vendors already fixed for approved items — picking one adds its items"
                  >
                    <MenuItem value="">
                      <em>All approved items — choose manually</em>
                    </MenuItem>
                    {assignedVendors.map((g) => (
                      <MenuItem key={g.vendorId} value={g.vendorId}>
                        {g.vendorName} — {g.items.length} item
                        {g.items.length === 1 ? "" : "s"}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : null}
              </Grid>
            )}
            <Grid item xs={12} sm={groupMode ? 9 : 6}>
              {isEdit ? (
                <TextField
                  label="Indent Number"
                  fullWidth
                  value={indent?.indentNumber || ""}
                  disabled
                />
              ) : isRevise ? (
                <TextField
                  label="Revised From"
                  fullWidth
                  value={poDisplayNumber(reviseFrom)}
                  disabled
                  helperText="A new PO will be created — the cancelled PO is left unchanged"
                />
              ) : approvedItemMode ? (
                <Autocomplete
                  multiple
                  disableCloseOnSelect
                  options={pickerOptions}
                  loading={approvedItemsLoading}
                  value={selectedApprovedItems}
                  getOptionLabel={(o) =>
                    o
                      ? `${o.indentItemDisplayNumber || o.itemDisplayNumber || o.indentNumber} — ${o.itemName}`
                      : ""
                  }
                  isOptionEqualToValue={(o, v) =>
                    String(o.indentItemId) === String(v.indentItemId)
                  }
                  getOptionDisabled={(o) => !!itemVendorBlock(o)}
                  onChange={(_e, vals) => applyApprovedItems(vals)}
                  // The picked items are listed below, each with its vendor.
                  renderTags={(vals) => (
                    <Typography
                      sx={{
                        pl: 0.75,
                        fontSize: "0.86rem",
                        fontWeight: 700,
                        color: "primary.main",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {vals.length} item{vals.length === 1 ? "" : "s"} selected
                    </Typography>
                  )}
                  filterOptions={(opts, { inputValue }) => {
                    const q = inputValue.trim().toLowerCase();
                    if (!q) return opts;
                    return opts.filter((o) =>
                      [
                        o.indentItemDisplayNumber,
                        o.itemDisplayNumber,
                        o.itemName,
                        o.skuCode,
                        o.indentNumber,
                        o.vendorName,
                      ].some((f) =>
                        String(f || "")
                          .toLowerCase()
                          .includes(q),
                      ),
                    );
                  }}
                  renderOption={(props, o) => (
                    <Box
                      component="li"
                      {...props}
                      key={o.indentItemId}
                      sx={{ display: "block !important", py: 1 }}
                    >
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1 }}
                      >
                        <Typography
                          variant="body2"
                          fontWeight={700}
                          color="primary.main"
                        >
                          {o.indentItemDisplayNumber || o.itemDisplayNumber}
                        </Typography>
                        {o.quoteNotRequired ? (
                          <Chip
                            label="Quote Not Required"
                            size="small"
                            sx={{
                              height: 18,
                              fontSize: "0.6rem",
                              fontWeight: 700,
                              bgcolor: "#eef2f6",
                              color: "#475569",
                            }}
                          />
                        ) : null}
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {[
                          o.itemName,
                          o.skuCode && `SKU: ${o.skuCode}`,
                          `Approved: ${o.approvedQuantity}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Typography>
                      {itemVendorBlock(o) ? (
                        <Typography
                          variant="caption"
                          sx={{
                            display: "block",
                            color: "error.main",
                            fontWeight: 600,
                          }}
                        >
                          {itemVendorBlock(o)}
                        </Typography>
                      ) : o.vendorState === "SET" ? (
                        <Typography
                          variant="caption"
                          sx={{
                            display: "block",
                            color: "#0f766e",
                            fontWeight: 600,
                          }}
                        >
                          Vendor: {o.vendorName} ·{" "}
                          {VENDOR_SOURCE_LABEL[o.vendorSource]}
                        </Typography>
                      ) : null}
                    </Box>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Approved Item(s) *"
                      placeholder="Select one or more approved items"
                      helperText={
                        groupMode
                          ? "Items of different vendors can go together — one PO is made for each vendor"
                          : assignedVendorId
                            ? `Showing the items assigned to ${assignedVendors.find((g) => g.vendorId === assignedVendorId)?.vendorName || "this vendor"}`
                            : "Item-wise PO — only approved, not-yet-PO'd items are listed"
                      }
                      InputProps={{
                        ...params.InputProps,
                        endAdornment: (
                          <>
                            {approvedItemsLoading ? (
                              <CircularProgress size={14} />
                            ) : null}
                            {params.InputProps.endAdornment}
                          </>
                        ),
                      }}
                    />
                  )}
                />
              ) : (
                <TextField
                  label="Indent Number"
                  fullWidth
                  value={indent?.indentNumber || ""}
                  disabled
                  helperText="Multi-vendor approved indent (Step 1.3)"
                />
              )}
            </Grid>
            {!groupMode && (
              <Grid item xs={12} sm={6}>
                {!isEdit && approvedVendors.length > 0 ? (
                  <TextField
                    select
                    fullWidth
                    label="Approved Vendor *"
                    value={approvedVendorId}
                    onChange={(e) =>
                      applyApprovedVendor(
                        approvedVendors.find(
                          (v) =>
                            (v.vendorId?._id || v.vendorId) === e.target.value,
                        ),
                      )
                    }
                    helperText="From Step 1.3 — one PO is created per approved vendor"
                  >
                    {approvedVendors.map((v) => {
                      const vid = v.vendorId?._id || v.vendorId;
                      return (
                        <MenuItem key={vid} value={vid} disabled={!!v.poId}>
                          {v.vendorName}
                          {v.poId ? ` · PO ${v.poNumber || "created"}` : ""}
                        </MenuItem>
                      );
                    })}
                  </TextField>
                ) : (
                  <Autocomplete
                    options={
                      fixedVendor ? vendorOptions : vendorOptionsFiltered
                    }
                    loading={vendorsLoading}
                    value={vendor}
                    disabled={!!fixedVendor && !fixedVendor.conflict}
                    getOptionLabel={(o) => o?.name || ""}
                    isOptionEqualToValue={(o, v) => o._id === v._id}
                    onChange={(_e, v) => applyVendor(v)}
                    noOptionsText={
                      noVendorForSku
                        ? "No vendor found for selected SKU"
                        : "No matching vendor"
                    }
                    filterOptions={(opts, { inputValue }) => {
                      const q = inputValue.trim().toLowerCase();
                      if (!q) return opts;
                      return opts.filter((o) =>
                        [
                          o.name,
                          o.contactPerson,
                          o.phone,
                          o.email,
                          o.gstNo,
                          o.panNo,
                        ].some((f) =>
                          String(f || "")
                            .toLowerCase()
                            .includes(q),
                        ),
                      );
                    }}
                    renderOption={(props, o) => (
                      <Box
                        component="li"
                        {...props}
                        key={o._id}
                        sx={{ display: "block !important", py: 1 }}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 1,
                          }}
                        >
                          <Typography variant="body2" fontWeight={700}>
                            {o.name}
                          </Typography>
                          {o.products?.length > 0 && (
                            <Typography
                              variant="caption"
                              sx={{
                                color: "#0f766e",
                                fontWeight: 700,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {o.products.length} product(s)
                            </Typography>
                          )}
                        </Box>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block" }}
                        >
                          {[o.contactPerson, o.phone, o.email]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block" }}
                        >
                          {[
                            o.gstNo && `GST: ${o.gstNo}`,
                            o.panNo && `PAN: ${o.panNo}`,
                            o.creditPeriodDays != null &&
                              `Credit: ${o.creditPeriodDays}d`,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </Typography>
                        {(o.location || o.address) && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block" }}
                          >
                            {o.location || o.address}
                          </Typography>
                        )}
                      </Box>
                    )}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Vendor *"
                        placeholder="Select from Vendor Master"
                        error={
                          !!vendorConflict || (!fixedVendor && noVendorForSku)
                        }
                        helperText={
                          vendorConflict ||
                          (fixedVendor
                            ? `${VENDOR_SOURCE_LABEL[fixedVendor.vendorSource]} — the PO must use this vendor`
                            : null) ||
                          (noVendorForSku
                            ? "No vendor found for selected SKU. Add vendor for this item."
                            : skuFilteredVendors
                              ? "Filtered to vendors whose catalog carries the selected SKU(s)."
                              : " ")
                        }
                        InputProps={{
                          ...params.InputProps,
                          endAdornment: (
                            <>
                              {vendorsLoading ? (
                                <CircularProgress size={14} />
                              ) : null}
                              {params.InputProps.endAdornment}
                            </>
                          ),
                        }}
                      />
                    )}
                  />
                )}
                {approvedItemMode &&
                  !isJsl &&
                  selectedApprovedItems.length > 0 &&
                  !fixedVendor && (
                    <Button
                      size="small"
                      startIcon={<Plus size={15} />}
                      onClick={() => setAddVendorOpen(true)}
                      sx={{ mt: 0.5, textTransform: "none" }}
                    >
                      Add Vendor for this Item
                    </Button>
                  )}
              </Grid>
            )}
          </Grid>

          {/* Vendor snapshot preview (by vendor, each vendor's card shows it) */}
          {vendor && !groupMode ? (
            <Box
              sx={{
                mt: 2,
                p: 1.5,
                borderRadius: "10px",
                bgcolor: alpha("#2563eb", 0.04),
                display: "flex",
                flexWrap: "wrap",
                gap: 2.5,
                alignItems: "center",
              }}
            >
              <Building2 size={16} color="#1d4ed8" />
              <Typography variant="caption" fontWeight={700}>
                {vendor.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                GST: {vendor.gstNo || "—"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                PAN: {vendor.panNo || "—"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {vendor.location || vendor.address || "—"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                📞 {vendor.phone || "—"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                ✉ {vendor.email || "—"}
              </Typography>
              {vendorProducts.length > 0 && (
                <Typography
                  variant="caption"
                  sx={{ color: "#0f766e", fontWeight: 700 }}
                >
                  {vendorProducts.length} catalog product(s)
                </Typography>
              )}
            </Box>
          ) : null}
        </Paper>

        {/* Header / terms — by vendor it follows the items and holds only what all
            the POs share; each vendor's dates and payment terms sit in its card. */}
        <Paper elevation={0} sx={{ ...SECTION, order: groupMode ? 2 : 0 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
              mb: 2,
              flexWrap: "wrap",
            }}
          >
            <Typography
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                fontWeight: 700,
                color: "#0f766e",
              }}
            >
              <ShoppingBag size={18} />{" "}
              {groupMode && poGroups.length > 1
                ? "PO Terms — for all POs"
                : "PO Terms"}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<FileText size={15} />}
              onClick={() => setTermsOpen(true)}
              data-testid="po-edit-terms"
            >
              Edit Terms &amp; Conditions
            </Button>
          </Box>
          <Grid container spacing={2}>
            {/* Lead Time and Expected Delivery Date fill each other (poLeadTime.js). */}
            <Grid item xs={groupMode ? 12 : 6} sm={groupMode ? 3 : 2.4}>
              <DateInputDDMMYYYY
                label="PO Date"
                fullWidth
                value={header.poDate}
                onChange={changePoDate}
              />
            </Grid>
            {!groupMode && (
              <>
                <Grid item xs={6} sm={2.4}>
                  <DateInputDDMMYYYY
                    label="Expected Delivery Date *"
                    fullWidth
                    required
                    value={header.expectedDeliveryDate}
                    onChange={(val) =>
                      setHeader((h) => setDeliveryDate(h, val))
                    }
                    error={Boolean(deliveryError.edd)}
                    helperText={deliveryError.edd}
                    inputProps={{ "data-testid": "po-expected-delivery" }}
                  />
                </Grid>
                <Grid item xs={6} sm={2.4}>
                  <TextField
                    label="Lead Time (Days)"
                    fullWidth
                    value={header.leadTime}
                    placeholder="e.g. 7"
                    inputProps={{
                      inputMode: "numeric",
                      "data-testid": "po-lead-time",
                    }}
                    onChange={(e) => {
                      const raw = e.target.value.trim();
                      if (/^\d{0,3}$/.test(raw))
                        setHeader((h) => setLeadTime(h, raw));
                    }}
                    error={Boolean(deliveryError.lead)}
                    helperText={deliveryError.lead || leadHint}
                    FormHelperTextProps={{ "data-testid": "po-lead-time-hint" }}
                  />
                </Grid>
                <Grid item xs={6} sm={2.4}>
                  <TextField
                    label="Credit Period (Days)"
                    type="number"
                    fullWidth
                    value={header.creditPeriod}
                    onChange={(e) =>
                      setHeader((h) => ({ ...h, creditPeriod: e.target.value }))
                    }
                    inputProps={{ min: 0 }}
                  />
                </Grid>
                <Grid item xs={6} sm={2.4}>
                  <TextField
                    label="Payment Terms"
                    fullWidth
                    value={header.paymentTerms}
                    onChange={(e) =>
                      setHeader((h) => ({ ...h, paymentTerms: e.target.value }))
                    }
                  />
                </Grid>
              </>
            )}
            <Grid item xs={12} sm={groupMode ? 4.5 : 6}>
              <TextField
                label="Delivery Terms"
                fullWidth
                value={header.deliveryTerms}
                onChange={(e) =>
                  setHeader((h) => ({ ...h, deliveryTerms: e.target.value }))
                }
              />
            </Grid>
            <Grid item xs={12} sm={groupMode ? 4.5 : 6}>
              <TextField
                label="Remarks"
                fullWidth
                value={header.remarks}
                helperText="Internal note — not printed on the PO PDF"
                onChange={(e) =>
                  setHeader((h) => ({ ...h, remarks: e.target.value }))
                }
              />
            </Grid>
            <Grid item xs={12}>
              {/* What the PDF will print — so a date in the terms is checked before saving. */}
              <Box
                sx={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  px: 1.5,
                  py: 1,
                  bgcolor: "#f8fafc",
                }}
                data-testid="po-terms-summary"
              >
                <Typography
                  variant="caption"
                  sx={{ fontWeight: 700, color: "text.secondary" }}
                >
                  Terms &amp; Conditions ·{" "}
                  {terms.edited
                    ? "edited for this PO"
                    : `default ${PO_FORMAT_LABEL[poFormatType]} terms`}
                </Typography>
                <Typography
                  variant="body2"
                  data-testid="po-terms-text"
                  sx={{
                    whiteSpace: "pre-line",
                    color: PFMS.ink,
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {effectiveTerms || "—"}
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </Paper>

        {/* Items — by vendor, one card per vendor (one PO each) */}
        <Paper elevation={0} sx={{ ...SECTION, order: groupMode ? 1 : 0 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mb: 1.5,
            }}
          >
            <Typography
              sx={{
                fontWeight: 700,
                color: "#b45309",
                display: "flex",
                alignItems: "center",
                gap: 1,
              }}
            >
              <Plus size={18} />{" "}
              {groupMode
                ? `Items by Vendor${poGroups.length > 1 ? ` — ${poGroups.length} POs` : ""}`
                : `Items${approvedItemMode ? " (from selected approved items)" : ""}`}
            </Typography>
            {/* In approved-item mode the rows are driven by the picker, so no manual add. */}
            {!approvedItemMode && (
              <Button
                size="small"
                startIcon={<Plus size={15} />}
                onClick={addItem}
                variant="outlined"
              >
                Add Item
              </Button>
            )}
          </Box>

          {approvedItemMode && !selectedApprovedItems.length ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ py: 3, textAlign: "center" }}
            >
              Select approved item(s) above to load them here.
            </Typography>
          ) : groupMode ? (
            renderVendorGroups()
          ) : isJsl ? (
            <>
              {/* JSL header row */}
              <Box
                sx={{
                  display: { xs: "none", md: "grid" },
                  gridTemplateColumns: JSL_GRID,
                  gap: 1,
                  px: 1,
                  mb: 0.5,
                }}
              >
                {[
                  "Grade",
                  "Width",
                  "Finish",
                  "SKU",
                  "Qty",
                  "Unit",
                  "Base Rate",
                  "Upfront Disc.",
                  "Bonanza Disc.",
                  "Final Price",
                  "Value",
                  "",
                ].map((h, i) => (
                  <Typography
                    key={i}
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      color: "text.secondary",
                      textTransform: "uppercase",
                      fontSize: "0.6rem",
                    }}
                  >
                    {h}
                  </Typography>
                ))}
              </Box>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {items.map((it, idx) => {
                  const { finalPrice, value } = jslLineCalc(it);
                  // Came from the indent but no Jindal catalog rate matched, and no rate entered yet.
                  const rateMissing =
                    it.rateMatched === false &&
                    Boolean(it.itemName) &&
                    !(Number(it.baseRate) > 0);
                  return (
                    <Box
                      key={idx}
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 0.5,
                      }}
                    >
                      {/* Read-only item ref + name for rows from the approved-item picker. */}
                      {it.fromApprovedItem &&
                      (it.indentItemDisplayNumber || it.itemName) ? (
                        <Box
                          sx={{
                            display: "flex",
                            gap: 1,
                            alignItems: "baseline",
                            flexWrap: "wrap",
                            pl: { md: 1 },
                          }}
                        >
                          <Typography
                            variant="caption"
                            sx={{ color: "primary.main", fontWeight: 700 }}
                          >
                            {it.indentItemDisplayNumber}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            — {it.itemName}
                            {it.skuCode ? ` · SKU: ${it.skuCode}` : ""}
                          </Typography>
                        </Box>
                      ) : null}
                      <Box
                        sx={{
                          display: "grid",
                          gridTemplateColumns: { xs: "1fr", md: JSL_GRID },
                          gap: 1,
                          alignItems: "center",
                          p: { xs: 1.5, md: 0.5 },
                          px: { md: 1 },
                          borderRadius: "10px",
                          border: rateMissing
                            ? "1px solid"
                            : { xs: "1px solid", md: "none" },
                          borderColor: rateMissing ? "warning.main" : "divider",
                          bgcolor: rateMissing
                            ? alpha("#f59e0b", 0.06)
                            : "transparent",
                          "&:hover": {
                            bgcolor: rateMissing
                              ? alpha("#f59e0b", 0.1)
                              : alpha("#2563eb", 0.03),
                          },
                        }}
                      >
                        <TextField
                          size="small"
                          placeholder="Grade"
                          value={it.grade}
                          onChange={(e) =>
                            setItem(idx, { grade: e.target.value })
                          }
                        />
                        <TextField
                          size="small"
                          placeholder="Width"
                          value={it.width}
                          onChange={(e) =>
                            setItem(idx, { width: e.target.value })
                          }
                        />
                        <TextField
                          size="small"
                          placeholder="Finish"
                          value={it.finish}
                          onChange={(e) =>
                            setItem(idx, { finish: e.target.value })
                          }
                        />
                        {it.fromApprovedItem ? (
                          <Typography
                            variant="body2"
                            color="primary.main"
                            fontWeight={700}
                            sx={{ overflowWrap: "anywhere" }}
                          >
                            {it.skuCode || "—"}
                          </Typography>
                        ) : (
                          <TextField
                            size="small"
                            placeholder="SKU"
                            value={it.skuCode || ""}
                            onChange={(e) =>
                              setItem(idx, {
                                skuCode: e.target.value.toUpperCase(),
                              })
                            }
                          />
                        )}
                        <TextField
                          size="small"
                          type="number"
                          placeholder="0"
                          value={it.quantity}
                          onChange={(e) =>
                            setItem(idx, { quantity: e.target.value })
                          }
                          inputProps={{ min: 0, style: { textAlign: "right" } }}
                          sx={NO_SPIN}
                        />
                        <TextField
                          size="small"
                          select
                          value={it.unit}
                          onChange={(e) =>
                            setItem(idx, { unit: e.target.value })
                          }
                        >
                          {/* Always include the row's current unit even if it isn't one of the
                              standard options — vendor-master unit spellings vary (e.g. "MT",
                              "Kg"), and a value with no matching MenuItem would otherwise render
                              blank, hiding a unit that was actually fetched correctly. */}
                          {(JSL_UNITS.includes(it.unit) || !it.unit
                            ? JSL_UNITS
                            : [it.unit, ...JSL_UNITS]
                          ).map((u) => (
                            <MenuItem key={u} value={u}>
                              {u}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          size="small"
                          type="number"
                          placeholder="0.00"
                          value={it.baseRate}
                          onChange={(e) =>
                            setItem(idx, {
                              baseRate: e.target.value,
                              manual: true,
                            })
                          }
                          inputProps={{
                            min: 0,
                            step: 0.01,
                            style: { textAlign: "right" },
                          }}
                          sx={NO_SPIN}
                        />
                        <TextField
                          size="small"
                          type="number"
                          placeholder="0.00"
                          value={it.upfrontDiscount}
                          onChange={(e) =>
                            setItem(idx, { upfrontDiscount: e.target.value })
                          }
                          inputProps={{
                            min: 0,
                            step: 0.01,
                            style: { textAlign: "right" },
                          }}
                          sx={NO_SPIN}
                        />
                        <TextField
                          size="small"
                          type="number"
                          placeholder="0.00"
                          value={it.bonanzaDiscount}
                          onChange={(e) =>
                            setItem(idx, { bonanzaDiscount: e.target.value })
                          }
                          inputProps={{
                            min: 0,
                            step: 0.01,
                            style: { textAlign: "right" },
                          }}
                          sx={NO_SPIN}
                        />
                        <Typography
                          variant="body2"
                          sx={{
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {finalPrice.toFixed(2)}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            textAlign: "right",
                            fontWeight: 700,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {value.toFixed(2)}
                        </Typography>
                        <Tooltip title="Remove">
                          <span>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() =>
                                it.fromApprovedItem
                                  ? removeApprovedRow(idx)
                                  : removeItem(idx)
                              }
                              disabled={
                                !it.fromApprovedItem &&
                                items.length === 1 &&
                                !it.grade &&
                                !it.quantity
                              }
                            >
                              <Trash2 size={15} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Box>
                      {rateMissing && (
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                            pl: { md: 1 },
                          }}
                        >
                          <AlertTriangle size={13} color="#b45309" />
                          <Typography
                            variant="caption"
                            sx={{ color: "#b45309", fontWeight: 600 }}
                          >
                            Rate not found in {JSL_VENDOR_NAME} vendor master —
                            enter base rate manually
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
              <Box
                sx={{
                  display: { xs: "none", md: "grid" },
                  gridTemplateColumns: OTHER_GRID,
                  gap: 1,
                  px: 1,
                  mb: 0.5,
                }}
              >
                {[
                  "Item Name",
                  "SKU",
                  "Qty",
                  "Unit",
                  "Rate",
                  "GST %",
                  "Taxable",
                  "Tax",
                  "Total",
                  "",
                ].map((h, i) => (
                  <Typography
                    key={i}
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      color: "text.secondary",
                      textTransform: "uppercase",
                      fontSize: "0.62rem",
                    }}
                  >
                    {h}
                  </Typography>
                ))}
              </Box>

              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {items.map((it, idx) => {
                  const { taxable, tax, total } = lineCalc(it);
                  // Came from an indent / has an item, but no Vendor-Master rate matched and none entered yet.
                  const lk = it.rateLookup;
                  const lkStatus = lk?.status;
                  // The vendor has no usable rate for this item (none / no rate / other unit / duplicates).
                  const rateMissing =
                    [
                      LOOKUP.NONE,
                      LOOKUP.NO_RATE,
                      LOOKUP.UNIT_MISMATCH,
                      LOOKUP.AMBIGUOUS,
                    ].includes(lkStatus) &&
                    Boolean(it.itemName) &&
                    !(Number(it.rate) > 0);
                  // Item Name & SKU are read-only for any known item (approved-item / indent / edit / revise);
                  // only a brand-new blank "Add Item" row lets you type a name.
                  const nameLocked = Boolean(
                    it.fromApprovedItem || it.itemName,
                  );
                  // Flag a user override of the auto-filled Vendor-Master rate/GST.
                  const rateModified =
                    (it.autoRate != null &&
                      Number(it.rate) !== Number(it.autoRate)) ||
                    (it.autoGst != null &&
                      Number(it.gstRate) !== Number(it.autoGst));
                  const rc = rateChangeOf(it);
                  const rcStatus =
                    !rc.needsReason && it.rateChangeRequestNumber
                      ? RATE_STATUS[it.rateChangeStatus]
                      : null;
                  return (
                    <Box
                      key={it.rid || idx}
                      data-testid="po-line"
                      data-sku={it.skuCode || ""}
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 0.5,
                      }}
                    >
                      <Box
                        sx={{
                          display: "grid",
                          gridTemplateColumns: { xs: "1fr", md: OTHER_GRID },
                          gap: 1,
                          alignItems: "center",
                          p: { xs: 1.5, md: 0.5 },
                          px: { md: 1 },
                          borderRadius: "10px",
                          border: rateMissing
                            ? "1px solid"
                            : { xs: "1px solid", md: "none" },
                          borderColor: rateMissing ? "warning.main" : "divider",
                          bgcolor: rateMissing
                            ? alpha("#f59e0b", 0.06)
                            : "transparent",
                          "&:hover": {
                            bgcolor: rateMissing
                              ? alpha("#f59e0b", 0.1)
                              : alpha("#2563eb", 0.03),
                          },
                        }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          {nameLocked ? (
                            // Known item — name is read-only (no dropdown).
                            <Typography
                              variant="body2"
                              fontWeight={600}
                              sx={{ overflowWrap: "anywhere" }}
                            >
                              {it.itemName || "—"}
                            </Typography>
                          ) : (
                            <Autocomplete
                              freeSolo
                              options={vendorProducts}
                              getOptionLabel={(o) =>
                                typeof o === "string" ? o : o.productName || ""
                              }
                              value={it.itemName}
                              onInputChange={(_e, v, reason) => {
                                if (reason === "input")
                                  setItem(idx, { itemName: v });
                              }}
                              onChange={(_e, val) => {
                                if (val && typeof val === "object") {
                                  // The rate itself is fetched by the vendor-rate lookup (this row's
                                  // new SKU + unit is a new question) — never copied from the list.
                                  setItem(idx, {
                                    itemName: val.productName,
                                    skuCode: val.skuCode || "",
                                    skuId: val.skuId || "",
                                    unit: val.unit || it.unit,
                                    gstRate: val.gstRate ?? it.gstRate,
                                    hsn: val.hsn || "",
                                    manual: false,
                                    rateEdited: false,
                                    rateTyped: false,
                                    gstTyped: false,
                                  });
                                }
                              }}
                              renderInput={(params) => (
                                <TextField
                                  {...params}
                                  size="small"
                                  placeholder="Item / vendor product"
                                />
                              )}
                            />
                          )}
                          <Box
                            sx={{
                              display: "flex",
                              gap: 0.75,
                              alignItems: "center",
                              flexWrap: "wrap",
                            }}
                          >
                            {it.indentItemDisplayNumber ? (
                              <Typography
                                variant="caption"
                                sx={{
                                  color: "primary.main",
                                  fontWeight: 700,
                                  pl: 0.5,
                                }}
                              >
                                {it.indentItemDisplayNumber}
                              </Typography>
                            ) : null}
                            {rc.needsReason ? (
                              <Chip
                                size="small"
                                label="Needs approval"
                                data-testid="po-rate-needs-approval"
                                sx={{
                                  height: 18,
                                  fontSize: "0.6rem",
                                  fontWeight: 800,
                                  bgcolor: alpha("#dc2626", 0.12),
                                  color: "#b91c1c",
                                }}
                              />
                            ) : (
                              rateModified && (
                                <Chip
                                  size="small"
                                  label="Rate Modified"
                                  sx={{
                                    height: 18,
                                    fontSize: "0.6rem",
                                    fontWeight: 700,
                                    bgcolor: alpha("#f59e0b", 0.15),
                                    color: "#b45309",
                                  }}
                                />
                              )
                            )}
                            {isFirstRate(it) && (
                              <Chip
                                size="small"
                                label="New vendor rate"
                                data-testid="po-rate-new"
                                sx={{
                                  height: 18,
                                  fontSize: "0.6rem",
                                  fontWeight: 800,
                                  bgcolor: alpha("#2563eb", 0.1),
                                  color: "#1d4ed8",
                                }}
                              />
                            )}
                            {rcStatus && (
                              <Chip
                                size="small"
                                label={`${RATE_LINE_LABEL[it.rateChangeStatus] || rcStatus.label} · ${it.rateChangeRequestNumber}`}
                                data-testid="po-rate-change-status"
                                sx={{
                                  height: 18,
                                  fontSize: "0.6rem",
                                  fontWeight: 800,
                                  bgcolor: rcStatus.bg,
                                  color: rcStatus.color,
                                }}
                              />
                            )}
                          </Box>
                        </Box>
                        {nameLocked ? (
                          <Typography
                            variant="body2"
                            color="primary.main"
                            fontWeight={700}
                          >
                            {it.skuCode || "—"}
                          </Typography>
                        ) : (
                          <TextField
                            size="small"
                            placeholder="SKU"
                            value={it.skuCode}
                            onChange={(e) =>
                              setItem(idx, {
                                skuCode: e.target.value.toUpperCase(),
                              })
                            }
                          />
                        )}
                        <TextField
                          size="small"
                          type="number"
                          placeholder="0"
                          value={it.quantity}
                          onChange={(e) =>
                            setItem(idx, { quantity: e.target.value })
                          }
                          inputProps={{ min: 0, style: { textAlign: "right" } }}
                          sx={NO_SPIN}
                        />
                        {/* A line filled from an indent, vendor product or saved PO may say "Kg" —
                          shown and saved as KGS, the dropdown's spelling. */}
                        {/* The row's own unit is always an option (an indent bound to a
                          SKU's purchase unit says "BOX", not the list's "Box"), so the
                          select never shows blank for a unit it was actually given. */}
                        <TextField
                          size="small"
                          select
                          value={toKgsUnit(it.unit)}
                          onChange={(e) =>
                            setItem(idx, { unit: e.target.value })
                          }
                          inputProps={{ "data-testid": "po-line-unit" }}
                        >
                          {(UNITS.includes(toKgsUnit(it.unit)) || !it.unit
                            ? UNITS
                            : [toKgsUnit(it.unit), ...UNITS]
                          ).map((u) => (
                            <MenuItem key={u} value={u}>
                              {u}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          size="small"
                          type="number"
                          placeholder="0.00"
                          value={it.rate}
                          onChange={(e) =>
                            setItem(idx, {
                              rate: e.target.value,
                              manual: true,
                              rateEdited: true,
                              rateTyped: true,
                            })
                          }
                          inputProps={{
                            min: 0,
                            step: 0.01,
                            style: { textAlign: "right" },
                            "data-testid": "po-line-rate",
                          }}
                          sx={NO_SPIN}
                        />
                        <Autocomplete
                          freeSolo
                          disableClearable
                          size="small"
                          options={GST_PRESETS.map(String)}
                          value={
                            it.gstRate === "" || it.gstRate == null
                              ? ""
                              : String(it.gstRate)
                          }
                          onInputChange={(_e, v, reason) => {
                            const cleaned = v.replace(/[^\d.]/g, "");
                            // Only a genuine keystroke marks the row manual. MUI also fires
                            // 'reset'/'clear' on mount and on programmatic value changes (e.g.
                            // when the vendor-master auto-fill sets the GST); those must NOT
                            // flag the row, or auto-fill would be permanently blocked.
                            const patch = {
                              gstRate: cleaned === "" ? "" : Number(cleaned),
                            };
                            if (reason === "input") {
                              patch.manual = true;
                              patch.rateEdited = true;
                              patch.gstTyped = true;
                            }
                            setItem(idx, patch);
                          }}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              size="small"
                              placeholder="GST %"
                              inputProps={{
                                ...params.inputProps,
                                inputMode: "decimal",
                                style: { textAlign: "right" },
                              }}
                              InputProps={{
                                ...params.InputProps,
                                endAdornment: (
                                  <Typography
                                    variant="caption"
                                    sx={{ pr: 0.5, color: "text.secondary" }}
                                  >
                                    %
                                  </Typography>
                                ),
                              }}
                            />
                          )}
                        />
                        <Typography
                          variant="body2"
                          sx={{
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {taxable.toFixed(2)}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            textAlign: "right",
                            fontVariantNumeric: "tabular-nums",
                            color: "text.secondary",
                          }}
                        >
                          {tax.toFixed(2)}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{
                            textAlign: "right",
                            fontWeight: 700,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {total.toFixed(2)}
                        </Typography>
                        <Tooltip title="Remove">
                          <span>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() =>
                                it.fromApprovedItem
                                  ? removeApprovedRow(idx)
                                  : removeItem(idx)
                              }
                              disabled={
                                !it.fromApprovedItem &&
                                items.length === 1 &&
                                !it.itemName
                              }
                            >
                              <Trash2 size={15} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Box>
                      {lkStatus === LOOKUP.LOADING && (
                        <Typography
                          variant="caption"
                          data-testid="po-vendor-rate-loading"
                          sx={{
                            pl: { md: 1 },
                            color: "text.secondary",
                            fontWeight: 600,
                          }}
                        >
                          Fetching {vendor?.name || "the vendor"}'s rate…
                        </Typography>
                      )}
                      {lkStatus === LOOKUP.FOUND && (
                        <Typography
                          variant="caption"
                          data-testid="po-vendor-rate"
                          data-rate={lk.vendorRate}
                          sx={{
                            pl: { md: 1 },
                            color: "#0f766e",
                            fontWeight: 700,
                          }}
                        >
                          Vendor rate {fmtRate(lk.vendorRate)} /{" "}
                          {lk.unit || it.unit} — fetched from{" "}
                          {vendor?.name || "the Vendor Master"}
                        </Typography>
                      )}
                      {(lkStatus === LOOKUP.NONE ||
                        lkStatus === LOOKUP.NO_RATE) && (
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 0.5,
                            pl: { md: 1 },
                          }}
                        >
                          <AlertTriangle
                            size={13}
                            color="#b45309"
                            style={{ marginTop: 2, flexShrink: 0 }}
                          />
                          <Typography
                            variant="caption"
                            data-testid="po-rate-missing"
                            sx={{ color: "#b45309", fontWeight: 600 }}
                          >
                            No vendor rate configured for this item. Enter the
                            rate — it becomes {vendor?.name || "the vendor"}'s
                            first rate for it when the PO is approved.
                          </Typography>
                        </Box>
                      )}
                      {(lkStatus === LOOKUP.UNIT_MISMATCH ||
                        lkStatus === LOOKUP.AMBIGUOUS) && (
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 0.5,
                            pl: { md: 1 },
                          }}
                        >
                          <AlertTriangle
                            size={13}
                            color="#b91c1c"
                            style={{ marginTop: 2, flexShrink: 0 }}
                          />
                          <Typography
                            variant="caption"
                            data-testid="po-rate-blocked"
                            sx={{ color: "#b91c1c", fontWeight: 600 }}
                          >
                            {lk.message}
                          </Typography>
                        </Box>
                      )}
                      {lkStatus === LOOKUP.ERROR && (
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            pl: { md: 1 },
                          }}
                        >
                          <Typography
                            variant="caption"
                            data-testid="po-rate-error"
                            sx={{ color: "#b91c1c", fontWeight: 600 }}
                          >
                            {lk.message}
                          </Typography>
                          <Button
                            size="small"
                            onClick={retryRates}
                            sx={{ textTransform: "none", py: 0 }}
                          >
                            Retry
                          </Button>
                        </Box>
                      )}
                      {rc.needsReason && (
                        <Box
                          sx={{
                            display: "flex",
                            flexDirection: { xs: "column", md: "row" },
                            alignItems: { md: "center" },
                            gap: 1,
                            pl: { md: 1 },
                          }}
                        >
                          <Typography
                            variant="caption"
                            data-testid="po-rate-change-hint"
                            sx={{
                              color: "#b91c1c",
                              fontWeight: 600,
                              flex: "1 1 50%",
                            }}
                          >
                            Vendor rate {fmtRate(rc.fetched)} →{" "}
                            {fmtRate(it.rate)} (
                            {fmtDiff(
                              Number(it.rate) - rc.fetched,
                              rc.fetched > 0
                                ? ((Number(it.rate) - rc.fetched) /
                                    rc.fetched) *
                                    100
                                : null,
                            )}
                            ). Goes to Rate Change Approvals — the PO can be
                            approved, and the vendor's rate changes, only once
                            it is approved.
                          </Typography>
                          <TextField
                            size="small"
                            required
                            label="Reason for rate change"
                            value={it.rateChangeReason || ""}
                            onChange={(e) =>
                              setItem(idx, { rateChangeReason: e.target.value })
                            }
                            error={!String(it.rateChangeReason || "").trim()}
                            inputProps={{
                              maxLength: 500,
                              "data-testid": "po-rate-reason",
                            }}
                            sx={{ flex: "1 1 50%" }}
                          />
                        </Box>
                      )}
                      {(() => {
                        // Purchase unit → stock unit for this line's SKU, when it has one.
                        const sku = it.skuId
                          ? lineSkuById.get(String(it.skuId))
                          : null;
                        const rule = conversionRule(sku);
                        if (!rule) return null;
                        const c = skuConversion(sku);
                        const reversed = reversedRuleWarning(sku);
                        if (reversed) {
                          return (
                            <Typography
                              variant="caption"
                              data-testid="po-line-conversion"
                              sx={{
                                pl: { md: 1 },
                                fontWeight: 600,
                                color: "#b91c1c",
                              }}
                            >
                              {reversed}
                            </Typography>
                          );
                        }
                        const ok =
                          sameUnit(it.unit, c.purchaseUnit) ||
                          sameUnit(it.unit, c.stockUnit);
                        const qty = Number(it.quantity) || 0;
                        return (
                          <Typography
                            variant="caption"
                            data-testid="po-line-conversion"
                            sx={{
                              pl: { md: 1 },
                              fontWeight: 600,
                              color: ok ? "text.secondary" : "#b91c1c",
                            }}
                          >
                            {ok
                              ? `${rule}${sameUnit(it.unit, c.purchaseUnit) && qty > 0 ? ` · ${qty} ${it.unit} will stock as ${Math.round(qty * c.factor * 100) / 100} ${c.stockUnit}` : ""}`
                              : `${rule} — choose ${c.purchaseUnit} or ${c.stockUnit}; ${it.unit} cannot be converted`}
                          </Typography>
                        );
                      })()}
                    </Box>
                  );
                })}
              </Box>
            </>
          )}

          {/* Totals */}
          <Divider sx={{ my: 2 }} />
          <Box
            sx={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 4,
              flexWrap: "wrap",
            }}
          >
            <Box sx={{ textAlign: "right" }}>
              <Typography
                variant="caption"
                color="text.secondary"
                fontWeight={700}
              >
                TOTAL TAXABLE VALUE
              </Typography>
              <Typography fontWeight={700}>{fmtINR(totals.taxable)}</Typography>
            </Box>
            <Box sx={{ textAlign: "right" }}>
              <Typography
                variant="caption"
                color="text.secondary"
                fontWeight={700}
              >
                {isJsl ? "GST @ 18%" : "GST"}
              </Typography>
              <Typography fontWeight={700}>{fmtINR(totals.tax)}</Typography>
            </Box>
            <Box sx={{ textAlign: "right" }}>
              <Typography
                variant="caption"
                color="primary.main"
                fontWeight={700}
              >
                {groupMode && poGroups.length > 1
                  ? "GRAND TOTAL · ALL POs"
                  : "GRAND TOTAL"}
              </Typography>
              <Typography variant="h6" fontWeight={800} color="primary.dark">
                {fmtINR(totals.grand)}
              </Typography>
            </Box>
          </Box>
        </Paper>
      </Box>

      {/* Footer */}
      <Divider />
      <Box
        sx={{
          p: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          bgcolor: "#fff",
        }}
      >
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">
            {groupMode && poGroups.length > 1
              ? `${poGroups.length} POs · `
              : ""}
            {validItems.length} item(s) · {fmtINR(totals.grand)}
          </Typography>
          {isCreate && (
            <Typography
              variant="caption"
              color={canDirectSave ? "text.secondary" : "warning.dark"}
              display="block"
              data-testid="po-save-mode-note"
            >
              {canDirectSave
                ? "Draft stays editable and needs approval · Save PO Directly approves it now with the final PO number"
                : "Only the MD can save a PO directly — save it as a draft; it stays a draft until approved in PO Approval"}
            </Typography>
          )}
          {rateChangeCount > 0 && (
            <Typography
              variant="caption"
              color="error.main"
              display="block"
              data-testid="po-rate-change-note"
            >
              {rateChangeCount} rate change{rateChangeCount === 1 ? "" : "s"}{" "}
              will go to Rate Change Approvals
              {isCreate && canDirectSave
                ? " (Save PO Directly approves them now)"
                : " — the PO waits for them before it can be approved"}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: "flex", gap: 1.5 }}>
          <Button
            variant="outlined"
            onClick={() => onClose?.(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          {/* By vendor, each vendor's card has its own Preview PDF. */}
          {!groupMode && (
            <Button
              variant="outlined"
              color="secondary"
              startIcon={
                previewing ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <Eye size={16} />
                )
              }
              onClick={() => handlePreview()}
              disabled={busy}
            >
              Preview PDF
            </Button>
          )}
          {isCreate ? (
            <>
              <Tooltip title="Creates an editable draft PO with a temporary DRAFT number. It must be approved before release.">
                <span>
                  <Button
                    variant={canDirectSave ? "outlined" : "contained"}
                    startIcon={
                      pendingMode === "DRAFT" ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : (
                        <Save size={16} />
                      )
                    }
                    onClick={() => handleSubmit("DRAFT")}
                    disabled={busy}
                  >
                    {manyPos
                      ? `Save ${poGroups.length} POs as Draft`
                      : "Save as Draft"}
                  </Button>
                </span>
              </Tooltip>
              {canDirectSave && (
                <Tooltip title="Creates the PO as approved with its final PO number — ready to release. No separate approval step (MD only).">
                  <span>
                    <Button
                      variant="contained"
                      color="success"
                      startIcon={
                        pendingMode === "DIRECT" ? (
                          <CircularProgress size={16} color="inherit" />
                        ) : (
                          <CheckCircle2 size={16} />
                        )
                      }
                      onClick={() => handleSubmit("DIRECT")}
                      disabled={busy}
                    >
                      {manyPos
                        ? `Save ${poGroups.length} POs Directly`
                        : "Save PO Directly"}
                    </Button>
                  </span>
                </Tooltip>
              )}
            </>
          ) : (
            <Button
              variant="contained"
              startIcon={
                saving ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <Save size={16} />
                )
              }
              onClick={() => handleSubmit()}
              disabled={saving || previewing}
            >
              {isEdit ? "Save Changes" : "Save as Draft"}
            </Button>
          )}
        </Box>
      </Box>

      {/* Draft PDF preview — temporary, never saved */}
      <PurchaseOrderPdfPreview
        open={previewOpen}
        onClose={closePreview}
        previewUrl={previewUrl}
      />

      <PoTermsDialog
        open={termsOpen}
        onClose={() => setTermsOpen(false)}
        onSave={saveTerms}
        initialText={effectiveTerms}
        defaultText={defaultTerms}
        formatLabel={PO_FORMAT_LABEL[poFormatType]}
        note="Printed on this PO's PDF — preview, download and release. Kept when you save the PO."
      />

      {/* Add a Vendor Master record (or product) for the selected approved item(s) */}
      {/* …or, by vendor, for the one item it was opened for (the new vendor is picked for it). */}
      <AddVendorForItemModal
        open={addVendorOpen || Boolean(addVendorFor)}
        onClose={() => {
          setAddVendorOpen(false);
          setAddVendorFor(null);
        }}
        items={addVendorFor ? [addVendorFor] : selectedApprovedItems}
        vendorOptions={vendorOptions}
        onAdded={(added) => {
          if (addVendorFor && added?._id)
            pickItemVendor(addVendorFor, String(added._id));
          else handleVendorAdded(added);
        }}
      />
    </Dialog>
  );
};

export default PurchaseOrderFormDrawer;
