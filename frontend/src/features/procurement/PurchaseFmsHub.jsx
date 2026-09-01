import React, { Suspense } from 'react';
import { Box, Typography } from '@mui/material';
import { useNavigate, useParams, Navigate } from 'react-router-dom';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import AppLoader from '../../components/AppLoader';
import PurchaseFmsStepper from './components/PurchaseFmsStepper';

// Each step reuses the existing, fully-functional screen for that module —
// same components, APIs, tables, forms, filters and actions as before. This
// hub only adds the shared header + step rail around them.
const PurchaseMasterData    = lazyWithRetry(() => import('./PurchaseMasterData'));
const VendorMaster          = lazyWithRetry(() => import('./vendors/VendorMaster'));
const IndentList            = lazyWithRetry(() => import('./indents/IndentList'));
const PurchaseOrderList     = lazyWithRetry(() => import('./purchase-orders/PurchaseOrderList'));
const FollowUpList          = lazyWithRetry(() => import('./follow-ups/FollowUpList'));
const ProformaInvoiceList   = lazyWithRetry(() => import('./proforma-invoices/ProformaInvoiceList'));
const AdvancePaymentList    = lazyWithRetry(() => import('./advance-payments/AdvancePaymentList'));
const GrnList                = lazyWithRetry(() => import('./grn/GrnList'));
const ServiceCompletionList = lazyWithRetry(() => import('./service-completions/ServiceCompletionList'));
const IncomingQCList        = lazyWithRetry(() => import('./incoming-qc/IncomingQCList'));
const VendorInvoiceList     = lazyWithRetry(() => import('./vendor-invoices/VendorInvoiceList'));
const VoucherList           = lazyWithRetry(() => import('./vouchers/VoucherList'));
const TallyEntryList        = lazyWithRetry(() => import('./tally-entry/TallyEntryList'));
const FinalPaymentList      = lazyWithRetry(() => import('./final-payments/FinalPaymentList'));

// The 9 steps the workflow was scoped around, plus the remaining procurement
// screens (10-14) that already lived under the old sidebar dropdown — kept
// reachable here so nothing that existed before becomes orphaned.
export const PURCHASE_FMS_STEPS = [
  { slug: 'master-data',         label: 'Master Data',         Component: PurchaseMasterData },
  { slug: 'vendor-details',      label: 'Vendor Details',      Component: VendorMaster },
  { slug: 'purchase-indents',    label: 'Purchase Indents',    Component: IndentList },
  { slug: 'purchase-orders',     label: 'Purchase Orders',     Component: PurchaseOrderList },
  { slug: 'material-follow-ups', label: 'Material Follow-ups', Component: FollowUpList },
  { slug: 'pi-forms',            label: 'PI Forms',            Component: ProformaInvoiceList },
  { slug: 'advance-payments',    label: 'Advance Payments',    Component: AdvancePaymentList },
  { slug: 'grn',                 label: 'Goods Receipt (GRN)', Component: GrnList },
  { slug: 'service-completion',  label: 'Service Completion',  Component: ServiceCompletionList },
  { slug: 'incoming-qc',         label: 'Incoming QC',         Component: IncomingQCList },
  { slug: 'vendor-invoices',     label: 'Vendor Invoices',     Component: VendorInvoiceList },
  { slug: 'payment-vouchers',    label: 'Payment Vouchers',    Component: VoucherList },
  { slug: 'tally-entries',       label: 'Tally Entries',       Component: TallyEntryList },
  { slug: 'final-payments',      label: 'Final Payments',      Component: FinalPaymentList },
];

const PurchaseFmsHub = () => {
  const { step } = useParams();
  const navigate = useNavigate();
  const activeIndex = PURCHASE_FMS_STEPS.findIndex((s) => s.slug === step);

  // Unknown/missing step (e.g. a stale bookmark) — land on the first step
  // rather than rendering nothing.
  if (activeIndex === -1) {
    return <Navigate to={`/purchase-fms/${PURCHASE_FMS_STEPS[0].slug}`} replace />;
  }

  const ActiveComponent = PURCHASE_FMS_STEPS[activeIndex].Component;

  return (
    <Box>
      <Box sx={{ px: { xs: 2, md: 3 }, pt: { xs: 2, md: 3 }, pb: 1.5 }}>
        <Typography sx={{ fontSize: { xs: '1.2rem', md: '1.4rem' }, fontWeight: 800, color: 'text.primary' }}>
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
