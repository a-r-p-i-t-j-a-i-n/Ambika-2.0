import React, { Suspense } from 'react';
import { Box, Typography } from '@mui/material';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import AppLoader from '../../components/AppLoader';
import PurchaseFmsStepper from './components/PurchaseFmsStepper';
import { PFMS } from './pfmsTheme';
import {
  useGetIndentStatsQuery, useGetPurchaseOrderStatsQuery, useGetFollowUpStatsQuery,
  useGetProformaInvoiceStatsQuery, useGetAdvancePaymentStatsQuery, useGetGrnStatsQuery,
  useGetVendorInvoiceStatsQuery,
  useGetVoucherStatsQuery, useGetTallyEntryStatsQuery, useGetFinalPaymentStatsQuery,
} from '../../store/api/procurementApi';

// Each step reuses the existing, fully-functional screen for that module —
// same components, APIs, tables, forms, filters and actions as before. This
// hub only adds the shared header + step rail around them.
// Master Data and Vendor Details moved to their own sidebar entries under
// Purchase (see MainLayout) and are no longer part of this stepper.
const IndentList            = lazyWithRetry(() => import('./indents/IndentList'));
const PurchaseOrderList     = lazyWithRetry(() => import('./purchase-orders/PurchaseOrderList'));
const FollowUpList          = lazyWithRetry(() => import('./follow-ups/FollowUpList'));
const ProformaInvoiceList   = lazyWithRetry(() => import('./proforma-invoices/ProformaInvoiceList'));
const AdvancePaymentList    = lazyWithRetry(() => import('./advance-payments/AdvancePaymentList'));
const GrnQcStep             = lazyWithRetry(() => import('./grn/GrnQcStep'));
const VendorInvoiceList     = lazyWithRetry(() => import('./vendor-invoices/VendorInvoiceList'));
const VoucherList           = lazyWithRetry(() => import('./vouchers/VoucherList'));
const TallyEntryList        = lazyWithRetry(() => import('./tally-entry/TallyEntryList'));
const FinalPaymentList      = lazyWithRetry(() => import('./final-payments/FinalPaymentList'));

// The 9 steps the workflow was scoped around, plus the remaining procurement
// screens (10-14) that already lived under the old sidebar dropdown — kept
// reachable here so nothing that existed before becomes orphaned.
// Service Completion (former 1.8A) was removed: internal-service indents go
// straight to Incoming QC. Its history stays at /procurement/service-completions.
// GRN and Incoming QC are ONE step: the QC form sits on the GRN page, under the
// GRN. The QC records list (history, drafts, service QCs) is a tab inside it.
export const PURCHASE_FMS_STEPS = [
  { slug: 'purchase-indents',    label: 'Purchase Indents',    Component: IndentList },
  { slug: 'purchase-orders',     label: 'Purchase Orders',     Component: PurchaseOrderList },
  { slug: 'material-follow-ups', label: 'Material Follow-ups', Component: FollowUpList },
  { slug: 'pi-forms',            label: 'PI Forms',            Component: ProformaInvoiceList },
  { slug: 'advance-payments',    label: 'Advance Payments',    Component: AdvancePaymentList },
  { slug: 'grn',                 label: 'GRN & QC',            Component: GrnQcStep },
  { slug: 'vendor-invoices',     label: 'Vendor Invoices',     Component: VendorInvoiceList },
  { slug: 'payment-vouchers',    label: 'Payment Vouchers',    Component: VoucherList },
  { slug: 'tally-entries',       label: 'Tally Entries',       Component: TallyEntryList },
  { slug: 'final-payments',      label: 'Final Payments',      Component: FinalPaymentList },
];

// Each step's own stats endpoint (already used by that step's KPI cards) —
// fetched once here so the step rail can show a live total next to every
// step, not just the active one. Lightweight aggregate queries, cached by
// RTK Query, so this doesn't duplicate the row-level fetch each screen does.
const useStepCounts = () => {
  const { data: indentStats } = useGetIndentStatsQuery();
  const { data: poStats } = useGetPurchaseOrderStatsQuery();
  const { data: followUpStats } = useGetFollowUpStatsQuery();
  const { data: piStats } = useGetProformaInvoiceStatsQuery();
  const { data: advanceStats } = useGetAdvancePaymentStatsQuery();
  const { data: grnStats } = useGetGrnStatsQuery();
  const { data: invoiceStats } = useGetVendorInvoiceStatsQuery();
  const { data: voucherStats } = useGetVoucherStatsQuery();
  const { data: tallyStats } = useGetTallyEntryStatsQuery();
  const { data: finalStats } = useGetFinalPaymentStatsQuery();

  return {
    'purchase-indents':    indentStats?.data?.total,
    'purchase-orders':     poStats?.data?.total,
    'material-follow-ups': followUpStats?.data?.total,
    'pi-forms':            piStats?.data?.total,
    'advance-payments':    advanceStats?.data?.totalPayments,
    'grn':                 grnStats?.data?.total,
    'vendor-invoices':     invoiceStats?.data?.total,
    'payment-vouchers':    voucherStats?.data?.total,
    'tally-entries':       tallyStats?.data?.total,
    'final-payments':      finalStats?.data?.total,
  };
};

const PurchaseFmsHub = () => {
  const { step } = useParams();
  const navigate = useNavigate();
  const activeIndex = PURCHASE_FMS_STEPS.findIndex((s) => s.slug === step);
  const counts = useStepCounts();

  // The former separate Incoming QC step (bookmarks, back-links) → its records tab.
  if (step === 'incoming-qc') return <Navigate to="/purchase-fms/grn?view=qc" replace />;

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
    </Box>
  );
};

export default PurchaseFmsHub;
