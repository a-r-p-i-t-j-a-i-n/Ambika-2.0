import React, { Suspense, useState } from 'react';
import { Box, Typography, Paper, Button } from '@mui/material';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { ClipboardList, ShoppingBag, PackageCheck, Banknote } from 'lucide-react';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import AppLoader from '../../components/AppLoader';
import PurchaseFmsStepper from './components/PurchaseFmsStepper';
import { PFMS, pfmsCardSx } from './pfmsTheme';
import {
  useGetIndentStatsQuery, useGetPurchaseOrderStatsQuery,
  useGetProformaInvoiceStatsQuery, useGetAdvancePaymentStatsQuery, useGetGrnStatsQuery,
  useGetVendorInvoiceStatsQuery,
  useGetTallyEntryStatsQuery, useGetFinalPaymentStatsQuery,
} from '../../store/api/procurementApi';
// Quick Actions reuse the exact same creation dialogs each module's own list
// page already uses — same form, same validation, same mutations, same
// Draft/Direct behaviour. No separate creation logic exists here.
import IndentFormDrawer from './indents/IndentFormDrawer';
import PurchaseOrderFormDrawer from './purchase-orders/PurchaseOrderFormDrawer';
import GrnFormDialog from './grn/GrnFormDialog';
import VoucherFormDialog from './vouchers/VoucherFormDialog';

// Each step reuses the existing, fully-functional screen for that module —
// same components, APIs, tables, forms, filters and actions as before. This
// hub only adds the shared header + step rail around them.
// Master Data and Vendor Details moved to their own sidebar entries under
// Purchase (see MainLayout) and are no longer part of this stepper.
const IndentList            = lazyWithRetry(() => import('./indents/IndentList'));
const PurchaseOrderList     = lazyWithRetry(() => import('./purchase-orders/PurchaseOrderList'));
const ProformaInvoiceList   = lazyWithRetry(() => import('./proforma-invoices/ProformaInvoiceList'));
const AdvancePaymentList    = lazyWithRetry(() => import('./advance-payments/AdvancePaymentList'));
const GrnQcStep             = lazyWithRetry(() => import('./grn/GrnQcStep'));
const VendorInvoiceList     = lazyWithRetry(() => import('./vendor-invoices/VendorInvoiceList'));
const TallyEntryList        = lazyWithRetry(() => import('./tally-entry/TallyEntryList'));
const FinalPaymentList      = lazyWithRetry(() => import('./final-payments/FinalPaymentList'));

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
// Material Follow-ups (former step 1.5) is no longer its own hub entry —
// vendor delivery follow-ups are now managed directly on the Purchase Order
// detail page (see PurchaseOrderDetail.jsx's "Vendor Delivery Follow-ups"
// panel), which is the UI/presentation-layer home for them now. This is a
// navigation change only: the PurchaseFollowUp model, its APIs, and the
// standalone /procurement/follow-ups routes are all unchanged, and the
// backend FMS-doer catalog's MATERIAL_FOLLOWUP step (fmsCatalog.js) is
// untouched — it is a task-assignment concern, not a UI navigation one.
export const PURCHASE_FMS_STEPS = [
  { slug: 'purchase-indents',       label: 'Purchase Indents',        Component: IndentList },
  { slug: 'purchase-orders',        label: 'Purchase Orders',         Component: PurchaseOrderList },
  { slug: 'pi-forms',               label: 'PI Forms',                Component: ProformaInvoiceList },
  { slug: 'advance-payments',       label: 'Advance Payments',        Component: AdvancePaymentList },
  { slug: 'grn',                    label: 'GRN & QC',                Component: GrnQcStep },
  { slug: 'invoices-payments',      label: 'Vendor Invoices & Payments', Component: VendorInvoiceList },
  { slug: 'tally-entries',          label: 'Tally Entries',           Component: TallyEntryList },
  { slug: 'final-payments',         label: 'Final Payments',          Component: FinalPaymentList },
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

  return {
    'purchase-indents':    indentStats?.data?.total,
    'purchase-orders':     poStats?.data?.total,
    'pi-forms':            piStats?.data?.total,
    'advance-payments':    advanceStats?.data?.totalPayments,
    'grn':                 grnStats?.data?.total,
    // Represents the unified Vendor Invoices & Payments step by invoice
    // count — the list itself is invoice-rows-first (see VendorInvoiceList),
    // with each invoice's voucher shown/managed inline.
    'invoices-payments':   invoiceStats?.data?.total,
    'tally-entries':       tallyStats?.data?.total,
    'final-payments':      finalStats?.data?.total,
  };
};

// ── Quick Actions — create a record from anywhere in Purchase FMS without
// first navigating to its step. Each button opens the EXACT SAME dialog the
// module's own list page uses, with no preset source record — every one of
// these dialogs already supports picking its own eligible source (approved
// indent, eligible PO, payment-pending invoice) or an empty state explaining
// why none exist, so no new selection UI or validation is introduced here.
// None of the four creation endpoints carry a dedicated permission today
// (confirmed earlier this session — only each module's DELETE route does),
// so these buttons are shown to any authenticated Purchase FMS user, exactly
// matching each list page's own "New X" button today. The backend remains
// authoritative regardless of what's shown here.
const QUICK_ACTIONS = [
  { key: 'indent',  label: 'Create Indent',          icon: ClipboardList },
  { key: 'po',      label: 'Create Purchase Order',  icon: ShoppingBag },
  { key: 'grn',     label: 'Create GRN',             icon: PackageCheck },
  { key: 'voucher', label: 'Create Passing Voucher', icon: Banknote },
];

const QuickActions = ({ open, onOpen }) => (
  <Paper sx={{ ...pfmsCardSx, p: { xs: 1.5, md: 2 }, mb: 2 }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: 'text.secondary', mb: 1 }}>
      Quick Actions
    </Typography>
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25 }}>
      {QUICK_ACTIONS.map((action) => (
        <Button key={action.key} variant="outlined" startIcon={<action.icon size={16} />}
          onClick={() => onOpen(action.key)} disabled={open === action.key}
          sx={{ flex: { xs: '1 1 calc(50% - 10px)', sm: '0 1 auto' }, fontWeight: 700 }}>
          + {action.label}
        </Button>
      ))}
    </Box>
  </Paper>
);

const PurchaseFmsHub = () => {
  const { step } = useParams();
  const navigate = useNavigate();
  const activeIndex = PURCHASE_FMS_STEPS.findIndex((s) => s.slug === step);
  const counts = useStepCounts();
  // Which Quick Action dialog is open, if any — null | 'indent' | 'po' | 'grn' | 'voucher'.
  const [openQuick, setOpenQuick] = useState(null);

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
  if (step === 'incoming-qc') return <Navigate to="/purchase-fms/grn?view=qc" replace />;

  // The former separate Vendor Invoices (step 7) and Payment Vouchers (step 8)
  // hub slugs → the merged Vendor Invoices & Payments step, so old bookmarks
  // and links keep working. The standalone /procurement/vouchers... routes
  // are unaffected — this only redirects the Purchase FMS hub slug.
  if (step === 'vendor-invoices' || step === 'payment-vouchers') {
    return <Navigate to="/purchase-fms/invoices-payments" replace />;
  }

  // The former separate Material Follow-ups hub slug → Purchase Orders, which
  // is now the primary place to manage delivery follow-ups (see comment above
  // PURCHASE_FMS_STEPS). The standalone /procurement/follow-ups list/detail
  // routes are unaffected — this only redirects the Purchase FMS hub slug.
  if (step === 'material-follow-ups') {
    return <Navigate to="/purchase-fms/purchase-orders" replace />;
  }

  // Unknown/missing step (e.g. a stale bookmark) — land on the first step
  // rather than rendering nothing.
  if (activeIndex === -1) {
    return <Navigate to={`/purchase-fms/${PURCHASE_FMS_STEPS[0].slug}`} replace />;
  }

  const ActiveComponent = PURCHASE_FMS_STEPS[activeIndex].Component;

  return (
    <Box>
      <Box sx={{ px: { xs: 2, md: 3 }, pt: { xs: 2, md: 3 }, pb: 1.5 }}>
        <Typography sx={{ fontSize: { xs: '1.2rem', md: '1.4rem' }, fontWeight: 800, color: PFMS.ink }}>
          Purchase FMS
        </Typography>
        <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', mt: 0.25 }}>
          Manage the complete purchase workflow
        </Typography>
      </Box>

      <Box sx={{ px: { xs: 1.5, md: 3 } }}>
        <QuickActions open={openQuick} onOpen={setOpenQuick} />
        <PurchaseFmsStepper
          steps={PURCHASE_FMS_STEPS}
          activeIndex={activeIndex}
          counts={counts}
          onStepClick={(slug) => navigate(`/purchase-fms/${slug}`)}
        />
      </Box>

      <Box sx={{ mt: 2 }}>
        <Suspense fallback={<AppLoader />}>
          <ActiveComponent />
        </Suspense>
      </Box>

      {/* Quick Action dialogs — the exact same components each module's own
          list page renders, with no preset source record. */}
      <IndentFormDrawer open={openQuick === 'indent'} onClose={closeQuick('indents')} />
      <PurchaseOrderFormDrawer open={openQuick === 'po'} onClose={closeQuick('purchase-orders')} />
      <GrnFormDialog open={openQuick === 'grn'} onClose={closeQuick('grns')} />
      <VoucherFormDialog open={openQuick === 'voucher'} onClose={closeQuick('vouchers')} />
    </Box>
  );
};

export default PurchaseFmsHub;
