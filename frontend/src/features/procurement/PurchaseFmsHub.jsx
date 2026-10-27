import React, { Suspense, useState, useRef, useLayoutEffect } from "react";
import {
  Box,
  Typography,
  Button,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import { useNavigate, useParams, Navigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  ClipboardList,
  ShoppingBag,
  PackageCheck,
  Banknote,
  Plus,
  ChevronDown,
} from "lucide-react";
import { lazyWithRetry } from "../../utils/lazyWithRetry";
import AppLoader from "../../components/AppLoader";
import PurchaseFmsStepper from "./components/PurchaseFmsStepper";
import { PFMS } from "./pfmsTheme";
import {
  useGetIndentStatsQuery,
  useGetPurchaseOrderStatsQuery,
  useGetProformaInvoiceStatsQuery,
  useGetAdvancePaymentStatsQuery,
  useGetGrnStatsQuery,
  useGetVendorInvoiceStatsQuery,
  useGetTallyEntryStatsQuery,
  useGetFinalPaymentStatsQuery,
  useGetFollowUpStatsQuery,
} from "../../store/api/procurementApi";
// Quick Actions reuse the exact same creation dialogs each module's own list
// page already uses — same form, same validation, same mutations, same
// Draft/Direct behaviour. No separate creation logic exists here.
import IndentFormDrawer from "./indents/IndentFormDrawer";
import PurchaseOrderFormDrawer from "./purchase-orders/PurchaseOrderFormDrawer";
import GrnFormDialog from "./grn/GrnFormDialog";
import VoucherFormDialog from "./vouchers/VoucherFormDialog";
import { useHiddenSteps, stepKey } from "../../utils/embed";
import { isMdUser } from "./approvals/mdApprovalMeta";
import MdApprovalButton from "./approvals/MdApprovalButton";

// Each step reuses the existing, fully-functional screen for that module —
// same components, APIs, tables, forms, filters and actions as before. This
// hub only adds the shared header + step rail around them.
// Master Data and Vendor Details moved to their own sidebar entries under
// Purchase (see MainLayout) and are no longer part of this stepper.
const IndentList = lazyWithRetry(() => import("./indents/IndentList"));
// Steps 1.02 / 1.03 — one list component, one step each.
const QuotationStepList = lazyWithRetry(
  () => import("./indents/QuotationStepList"),
);
const QuoteComparativeStep = () => (
  <QuotationStepList step="QUOTE_COMPARATIVE" />
);
const QuotationApprovalStep = () => (
  <QuotationStepList step="QUOTATION_APPROVAL" />
);
const PurchaseOrderList = lazyWithRetry(
  () => import("./purchase-orders/PurchaseOrderList"),
);
const FollowUpList = lazyWithRetry(() => import("./follow-ups/FollowUpList"));
const ProformaInvoiceList = lazyWithRetry(
  () => import("./proforma-invoices/ProformaInvoiceList"),
);
const AdvancePaymentList = lazyWithRetry(
  () => import("./advance-payments/AdvancePaymentList"),
);
const GrnQcStep = lazyWithRetry(() => import("./grn/GrnQcStep"));
const VendorInvoiceList = lazyWithRetry(
  () => import("./vendor-invoices/VendorInvoiceList"),
);
const TallyEntryList = lazyWithRetry(
  () => import("./tally-entry/TallyEntryList"),
);
const FinalPaymentList = lazyWithRetry(
  () => import("./final-payments/FinalPaymentList"),
);
// MD Approval is not a workflow step (it never holds the steps back), so it
// lives at its own hub slug outside the step rail — MD users only.
const MdApprovalList = lazyWithRetry(() => import("./approvals/MdApprovalList"));
const MD_APPROVAL_SLUG = "md-approvals";

// The 9 steps the workflow was scoped around, plus the remaining procurement
// screens (10-14) that already lived under the old sidebar dropdown — kept
// reachable here so nothing that existed before becomes orphaned.
// Service Completion (former 1.8A) was removed: internal-service indents go
// straight to Incoming QC. Its history stays at /procurement/service-completions.
// GRN and Incoming QC are ONE step: the QC form sits on the GRN page, under the
// GRN. The QC records list (history, drafts, service QCs) is a tab inside it.
// Vendor Invoices (former step 7) and Payment Vouchers (former step 8) are
// now ONE hub step: Vendor Invoices & Payments. This is a UI/presentation
// merge only — VendorInvoice and VendorVoucher remain separate backend
// models, statuses, routes and permissions, unchanged. The invoice list
// (VendorInvoiceList) is the unified list, with a Voucher column and
// workflow filter chips added; a given invoice's voucher is then managed
// in place on VendorInvoiceDetail via the shared VoucherPanel. Standalone
// Voucher screens (incl. Expense vouchers, which have no invoice) keep
// their own routes — see the 'payment-vouchers' redirect below.
//
// Receive Quote & Comparative (1.02) and Approved Quotation (1.03) are their
// own steps between the indent and the PO. Both live on the indent record and
// reuse the indent's Step 1.2 / 1.3 dialogs and APIs (also still reachable
// from the Purchase Indents screen and Indent Detail). "Quote Not Required"
// at 1.02 skips 1.03 and makes the indent PO-ready.
//
// Follow-ups is the vendor-delivery tracker across all released POs — the
// same FollowUpList the standalone /procurement/follow-ups route renders.
// Per-PO follow-ups are still also driven from the Purchase Order detail
// page's "Vendor Delivery Follow-ups" panel; both use the same APIs.
export const PURCHASE_FMS_STEPS = [
  {
    slug: "purchase-indents",
    label: "Purchase Indents",
    Component: IndentList,
  },
  {
    slug: "receive-quotes",
    label: "Receive Quote & Comparative",
    Component: QuoteComparativeStep,
  },
  {
    slug: "approved-quotations",
    label: "Approved Quotation",
    Component: QuotationApprovalStep,
  },
  {
    slug: "purchase-orders",
    label: "Purchase Orders",
    Component: PurchaseOrderList,
  },
  { slug: "follow-ups", label: "Follow-ups", Component: FollowUpList },
  { slug: "pi-forms", label: "PI Forms", Component: ProformaInvoiceList },
  {
    slug: "advance-payments",
    label: "Advance Payments",
    Component: AdvancePaymentList,
  },
  { slug: "grn", label: "GRN & QC", Component: GrnQcStep },
  {
    slug: "invoices-payments",
    label: "Vendor Invoices & Payments",
    Component: VendorInvoiceList,
  },
  { slug: "tally-entries", label: "Tally Entries", Component: TallyEntryList },
  {
    slug: "final-payments",
    label: "Final Payments",
    Component: FinalPaymentList,
  },
];

// Each step's own stats endpoint (already used by that step's KPI cards) —
// fetched once here so the step rail can show a live total next to every
// step, not just the active one. Lightweight aggregate queries, cached by
// RTK Query, so this doesn't duplicate the row-level fetch each screen does.
const useStepCounts = () => {
  const { data: indentStats } = useGetIndentStatsQuery();
  const { data: poStats } = useGetPurchaseOrderStatsQuery();
  const { data: piStats } = useGetProformaInvoiceStatsQuery();
  const { data: advanceStats } = useGetAdvancePaymentStatsQuery();
  const { data: grnStats } = useGetGrnStatsQuery();
  const { data: invoiceStats } = useGetVendorInvoiceStatsQuery();
  const { data: tallyStats } = useGetTallyEntryStatsQuery();
  const { data: finalStats } = useGetFinalPaymentStatsQuery();
  const { data: fuStats } = useGetFollowUpStatsQuery();

  return {
    "purchase-indents": indentStats?.data?.total,
    // The quotation steps count what is waiting there (pending) — their
    // indents are already in the Purchase Indents total.
    "receive-quotes": indentStats?.data?.quotationSteps?.QUOTE_COMPARATIVE?.PENDING,
    "approved-quotations": indentStats?.data?.quotationSteps?.QUOTATION_APPROVAL?.PENDING,
    "purchase-orders": poStats?.data?.total,
    "follow-ups": fuStats?.data?.total,
    "pi-forms": piStats?.data?.total,
    "advance-payments": advanceStats?.data?.totalPayments,
    grn: grnStats?.data?.total,
    // Represents the unified Vendor Invoices & Payments step by invoice
    // count — the list itself is invoice-rows-first (see VendorInvoiceList),
    // with each invoice's voucher shown/managed inline.
    "invoices-payments": invoiceStats?.data?.total,
    "tally-entries": tallyStats?.data?.total,
    "final-payments": finalStats?.data?.total,
  };
};

// ── Quick Actions — create a record from anywhere in Purchase FMS without
// first navigating to its step. Each item opens the EXACT SAME dialog the
// module's own list page uses, with no preset source record — every one of
// these dialogs already supports picking its own eligible source (approved
// indent, eligible PO, payment-pending invoice) or an empty state explaining
// why none exist, so no new selection UI or validation is introduced here.
// None of the four creation endpoints carry a dedicated permission today
// (only each module's DELETE route does), so these items are shown to any
// authenticated Purchase FMS user, exactly matching each list page's own
// "New X" button today. The backend remains authoritative regardless of what
// is shown here.
//
// Presentation note: this used to be a full-width panel of four outlined
// buttons sitting above the step rail on every one of the 8 steps. It is now
// a single "Quick Actions" dropdown in the page header — same four actions,
// same dialogs, same destinations, a fraction of the vertical space. The
// trigger keeps the feature's own name rather than borrowing "Create": each
// list page has its own exact-named primary button (e.g. "Create Indent"), and
// two buttons sharing an accessible name would be ambiguous for users and
// tests alike.
const QUICK_ACTIONS = [
  { key: "indent", label: "Create Indent", icon: ClipboardList },
  { key: "po", label: "Create Purchase Order", icon: ShoppingBag },
  { key: "grn", label: "Create GRN", icon: PackageCheck },
  { key: "voucher", label: "Create Passing Voucher", icon: Banknote },
];
// The step each Quick Action belongs to — an action is hidden along with its
// step when the MD switches that step off in the Delegation Suite.
const QUICK_ACTION_STEP = {
  indent: "purchase-indents",
  po: "purchase-orders",
  grn: "grn",
  voucher: "invoices-payments",
};

const QuickActionsMenu = ({ onOpen, actions = QUICK_ACTIONS }) => {
  const [anchor, setAnchor] = useState(null);
  const open = Boolean(anchor);
  return (
    <>
      <Button
        id="pfms-create-button"
        data-testid="pfms-quick-actions"
        variant="contained"
        disableElevation
        onClick={(e) => setAnchor(e.currentTarget)}
        startIcon={<Plus size={17} />}
        endIcon={
          <ChevronDown
            size={16}
            style={{
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform 150ms ease",
            }}
          />
        }
        aria-haspopup="menu"
        aria-expanded={open || undefined}
        aria-controls={open ? "pfms-create-menu" : undefined}
        sx={{
          fontWeight: 700,
          px: 2,
          py: 1,
          borderRadius: "8px",
          whiteSpace: "nowrap",
        }}
      >
        Quick Actions
      </Button>
      <Menu
        id="pfms-create-menu"
        anchorEl={anchor}
        open={open}
        onClose={() => setAnchor(null)}
        MenuListProps={{ "aria-labelledby": "pfms-create-button", dense: true }}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: { sx: { mt: 0.75, minWidth: 234, borderRadius: "10px" } },
        }}
      >
        {actions.map((action) => (
          <MenuItem
            key={action.key}
            onClick={() => {
              setAnchor(null);
              onOpen(action.key);
            }}
            sx={{ py: 1, px: 1.5 }}
          >
            <ListItemIcon sx={{ minWidth: 30, color: "primary.main" }}>
              <action.icon size={17} />
            </ListItemIcon>
            <ListItemText
              primaryTypographyProps={{ fontSize: "0.84rem", fontWeight: 600 }}
            >
              {action.label}
            </ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

const PurchaseFmsHub = () => {
  const { step } = useParams();
  const navigate = useNavigate();
  // Steps the MD switched off for this employee in the Delegation Suite
  // (empty when Ambika 2.0 is used on its own).
  const hiddenSteps = useHiddenSteps("purchase");
  const visibleSteps = hiddenSteps.size
    ? PURCHASE_FMS_STEPS.filter((s) => !hiddenSteps.has(stepKey(s.slug)))
    : PURCHASE_FMS_STEPS;
  const visibleActions = hiddenSteps.size
    ? QUICK_ACTIONS.filter(
        (a) => !hiddenSteps.has(stepKey(QUICK_ACTION_STEP[a.key])),
      )
    : QUICK_ACTIONS;
  const activeIndex = visibleSteps.findIndex((s) => s.slug === step);
  const isMdView = step === MD_APPROVAL_SLUG;
  const isMd = useSelector((s) => isMdUser(s.auth.user));
  // On a fresh load (refresh / bookmark) the user is restored a render after
  // the app mounts — decide MD access only once it is there.
  const userLoaded = useSelector((s) => Boolean(s.auth.user));
  const counts = useStepCounts();
  // Which Quick Action dialog is open, if any — null | 'indent' | 'po' | 'grn' | 'voucher'.
  const [openQuick, setOpenQuick] = useState(null);

  // The hub's own chrome (header + step rail) is published to the active step
  // page as --pfms-chrome, so that page's pfmsPageSx minHeight can subtract it
  // instead of claiming a full 100vh underneath us — see pfmsTheme.js. Without
  // this the page is always taller than the window by the height of the hub
  // chrome, which is what produced the permanent vertical scrollbar and the
  // large empty canvas band below every table. Measured rather than hardcoded
  // because the header wraps at narrow widths.
  const chromeRef = useRef(null);
  const [chromeHeight, setChromeHeight] = useState(0);
  useLayoutEffect(() => {
    const el = chromeRef.current;
    if (!el) return undefined;
    const measure = () => setChromeHeight(el.offsetHeight || 0);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeIndex]);

  // Closing a Quick Action dialog: if it created a new record, open that
  // record's own detail page — the same "go straight to what you just made"
  // behaviour the GRN list's own "New GRN" button already has, extended
  // consistently to all four, since from the hub there's no list on screen
  // that would otherwise show the new row.
  const closeQuick = (detailPath) => (_saved, created) => {
    setOpenQuick(null);
    if (created?._id) navigate(`/procurement/${detailPath}/${created._id}`);
  };

  // The former separate Incoming QC step (bookmarks, back-links) → its records tab.
  if (step === "incoming-qc")
    return <Navigate to="/purchase-fms/grn?view=qc" replace />;

  // The former separate Vendor Invoices (step 7) and Payment Vouchers (step 8)
  // hub slugs → the merged Vendor Invoices & Payments step, so old bookmarks
  // and links keep working. The standalone /procurement/vouchers... routes
  // are unaffected — this only redirects the Purchase FMS hub slug.
  if (step === "vendor-invoices" || step === "payment-vouchers") {
    return <Navigate to="/purchase-fms/invoices-payments" replace />;
  }

  // The former Material Follow-ups hub slug → the Follow-ups step.
  if (step === "material-follow-ups") {
    return <Navigate to="/purchase-fms/follow-ups" replace />;
  }

  if (isMdView && !userLoaded) return <AppLoader />;

  // Every step is switched off for this employee in the Delegation Suite
  // (the MD Approval view is not a step, so an MD can still open it).
  if (visibleSteps.length === 0 && !(isMdView && isMd)) {
    return (
      <Box sx={{ px: 3, py: 6, textAlign: "center" }}>
        <Typography sx={{ fontWeight: 800, color: PFMS.ink }}>
          No Purchase FMS steps are switched on for you.
        </Typography>
        <Typography
          sx={{ fontSize: "0.85rem", color: "text.secondary", mt: 0.5 }}
        >
          Ask your MD to switch them on in Employees → lock icon.
        </Typography>
      </Box>
    );
  }

  // Unknown/missing step (e.g. a stale bookmark) or a hidden one — land on the
  // first visible step rather than rendering nothing. The MD Approval view is
  // for MD users only.
  if ((activeIndex === -1 && !isMdView) || (isMdView && !isMd)) {
    return <Navigate to={`/purchase-fms/${visibleSteps[0].slug}`} replace />;
  }

  const ActiveComponent = isMdView
    ? MdApprovalList
    : visibleSteps[activeIndex].Component;

  return (
    <Box sx={{ bgcolor: PFMS.canvas }}>
      <Box
        ref={chromeRef}
        sx={{ px: { xs: 1.5, md: 2 }, pt: { xs: 1.5, md: 2 } }}
      >
        {/* Page header — title/subtitle left, primary page actions right. */}
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "space-between",
            gap: 1.5,
            mb: 1.5,
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              component="h1"
              sx={{
                fontSize: { xs: "1.15rem", md: "1.35rem" },
                fontWeight: 800,
                color: PFMS.ink,
                lineHeight: 1.2,
              }}
            >
              Purchase FMS
            </Typography>
            <Typography sx={{ fontSize: "0.8rem", color: PFMS.sub, mt: 0.25 }}>
              Manage the complete purchase workflow
            </Typography>
          </Box>
          <Box
            sx={{
              display: "flex",
              justifyContent: { xs: "flex-start", sm: "flex-end" },
              flexShrink: 0,
              gap: 1,
              flexWrap: "wrap",
            }}
          >
            {/* MD users only (renders nothing for anyone else) — on every step. */}
            <MdApprovalButton />
            {visibleActions.length > 0 && (
              <QuickActionsMenu actions={visibleActions} onOpen={setOpenQuick} />
            )}
          </Box>
        </Box>

        <PurchaseFmsStepper
          steps={visibleSteps}
          activeIndex={activeIndex}
          counts={counts}
          onStepClick={(slug) => navigate(`/purchase-fms/${slug}`)}
        />
      </Box>

      <Box style={{ "--pfms-chrome": `${chromeHeight}px` }}>
        <Suspense fallback={<AppLoader />}>
          <ActiveComponent />
        </Suspense>
      </Box>

      {/* Quick Action dialogs — the exact same components each module's own
          list page renders, with no preset source record. */}
      <IndentFormDrawer
        open={openQuick === "indent"}
        onClose={closeQuick("indents")}
      />
      <PurchaseOrderFormDrawer
        open={openQuick === "po"}
        onClose={closeQuick("purchase-orders")}
      />
      <GrnFormDialog open={openQuick === "grn"} onClose={closeQuick("grns")} />
      <VoucherFormDialog
        open={openQuick === "voucher"}
        onClose={closeQuick("vouchers")}
      />
    </Box>
  );
};

export default PurchaseFmsHub;
