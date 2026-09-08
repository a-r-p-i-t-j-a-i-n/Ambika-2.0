import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import PurchaseFmsThemeScope from './features/procurement/PurchaseFmsThemeScope';
import ProtectedRoute from './components/ProtectedRoute';
import AppLoader from './components/AppLoader';
import RequirePermission from './components/RequirePermission';
import UpdateBanner from './components/UpdateBanner';
import { RouteErrorBoundary } from './components/ErrorBoundary';
import { lazyWithRetry } from './utils/lazyWithRetry';

// ─── Eager: shell, auth, and the post-login landing page ───────────────────
// Dashboard is loaded eagerly because it's the default route after login —
// lazy-loading it would force an extra round trip on every sign-in.
import Login from './features/auth/Login';
import Dashboard from './features/dashboard/Dashboard';

// ─── Lazy: every other authenticated screen ────────────────────────────────
// lazyWithRetry handles transient network failures and stale-deploy
// hash mismatches without dumping the user into the ErrorBoundary.
const DispatchControlTower = lazyWithRetry(() => import('./features/dashboard/DispatchControlTower'));
const Profile              = lazyWithRetry(() => import('./features/profile/Profile'));
const EmployeesList        = lazyWithRetry(() => import('./features/employees/EmployeesList'));
const OrdersList           = lazyWithRetry(() => import('./features/orders/OrdersList'));
const OrderDetails         = lazyWithRetry(() => import('./features/orders/OrderDetails'));
const PlanWorkspace        = lazyWithRetry(() => import('./features/planning/PlanWorkspace'));
const GenerateDispatchPlanPdf = lazyWithRetry(() => import('./features/planning/GenerateDispatchPlanPdf'));
const DispatchCalendar     = lazyWithRetry(() => import('./features/planning/DispatchCalendar'));
const PlanVsActualMaster   = lazyWithRetry(() => import('./features/planning/PlanVsActualMaster'));
const PPCPlanning          = lazyWithRetry(() => import('./features/ppc/PPCPlanning'));
const ChallansList         = lazyWithRetry(() => import('./features/execution/ChallansList'));
const GenerateChallanPdf   = lazyWithRetry(() => import('./features/execution/GenerateChallanPdf'));
const ChallanDetail        = lazyWithRetry(() => import('./features/execution/ChallanDetail'));
const PhaseDetail          = lazyWithRetry(() => import('./features/execution/PhaseDetail'));
const InvoicesList         = lazyWithRetry(() => import('./features/ledger/InvoicesList'));
const SkusList             = lazyWithRetry(() => import('./features/masters/SkusList'));
const PartiesList          = lazyWithRetry(() => import('./features/masters/PartiesList'));
const PartyDetails         = lazyWithRetry(() => import('./features/masters/PartyDetails'));
const AccessControl        = lazyWithRetry(() => import('./features/access-control/AccessControl'));
const PricingHub           = lazyWithRetry(() => import('./features/pricing/PricingHub'));
const ApprovalInbox        = lazyWithRetry(() => import('./features/pricing/ApprovalInbox'));
const TurnoverCalculator   = lazyWithRetry(() => import('./features/pricing/TurnoverCalculator'));
const PricingDocuments     = lazyWithRetry(() => import('./features/pricing/PricingDocuments'));
const PricingAnalytics     = lazyWithRetry(() => import('./features/pricing/PricingAnalytics'));
const QuotesList           = lazyWithRetry(() => import('./features/quotes/QuotesList'));
const QuoteDetail          = lazyWithRetry(() => import('./features/quotes/QuoteDetail'));
const FmsMyTasks           = lazyWithRetry(() => import('./features/o2d-fms/MyTasksWorkspace'));
const InvoiceEntryForm     = lazyWithRetry(() => import('./features/o2d-fms/InvoiceEntryForm'));
const InvoiceEmail         = lazyWithRetry(() => import('./features/o2d-fms/InvoiceEmail'));
const DispatchScheduleEmail = lazyWithRetry(() => import('./features/o2d-fms/DispatchScheduleEmail'));
const TrackDelivery        = lazyWithRetry(() => import('./features/o2d-fms/TrackDelivery'));
const PaymentSteps         = lazyWithRetry(() => import('./features/o2d-fms/PaymentSteps'));
const TransportBill        = lazyWithRetry(() => import('./features/o2d-fms/TransportBill'));
// IMS — Packaging & Consumables inventory
const ImsDashboard         = lazyWithRetry(() => import('./features/ims/ImsDashboard'));
const ImsStockList         = lazyWithRetry(() => import('./features/ims/ImsStockList'));
const ImsItemDetail        = lazyWithRetry(() => import('./features/ims/ImsItemDetail'));
const ImsStockIn           = lazyWithRetry(() => import('./features/ims/ImsStockIn'));
const ImsStockOut          = lazyWithRetry(() => import('./features/ims/ImsStockOut'));
const ImsReorder           = lazyWithRetry(() => import('./features/ims/ImsReorder'));
const ImsMovements         = lazyWithRetry(() => import('./features/ims/ImsMovements'));
// RM IMS — Raw Material (Coil + Circle) inventory
const RmImsDashboard       = lazyWithRetry(() => import('./features/rm-ims/RmImsDashboard'));
const RmImsStockList       = lazyWithRetry(() => import('./features/rm-ims/RmImsStockList'));
const RmImsStockIn         = lazyWithRetry(() => import('./features/rm-ims/RmImsStockIn'));
const RmImsStockOut        = lazyWithRetry(() => import('./features/rm-ims/RmImsStockOut'));
const RmImsConversion      = lazyWithRetry(() => import('./features/rm-ims/RmImsConversion'));
const RmImsReorder         = lazyWithRetry(() => import('./features/rm-ims/RmImsReorder'));
const RmImsMovements       = lazyWithRetry(() => import('./features/rm-ims/RmImsMovements'));
// FG IMS — Finished Goods inventory (Production In / Dispatch Out)
const FgImsDashboard       = lazyWithRetry(() => import('./features/fg-ims/FgImsDashboard'));
const FgImsStockList       = lazyWithRetry(() => import('./features/fg-ims/FgImsStockList'));
const FgImsItemDetail      = lazyWithRetry(() => import('./features/fg-ims/FgImsItemDetail'));
const FgImsProductionIn    = lazyWithRetry(() => import('./features/fg-ims/FgImsProductionIn'));
const FgImsDispatchOut     = lazyWithRetry(() => import('./features/fg-ims/FgImsDispatchOut'));
const FgImsPlanning        = lazyWithRetry(() => import('./features/fg-ims/FgImsPlanning'));
const FgImsMovements       = lazyWithRetry(() => import('./features/fg-ims/FgImsMovements'));

// PPC — DPR / OEE (shop-floor Daily Production Report + dashboards)
const DprEntry             = lazyWithRetry(() => import('./features/ppc/dpr/DprEntry'));
const DprRegister          = lazyWithRetry(() => import('./features/ppc/dpr/DprRegister'));
const DprMachineDashboard  = lazyWithRetry(() => import('./features/ppc/dpr/MachineDashboard'));
const DprProductionDashboard = lazyWithRetry(() => import('./features/ppc/dpr/ProductionDashboard'));
const DprOperatorDashboard = lazyWithRetry(() => import('./features/ppc/dpr/OperatorDashboard'));
const DprMisScoring        = lazyWithRetry(() => import('./features/ppc/dpr/DprMisScoring'));
const DprMasters           = lazyWithRetry(() => import('./features/ppc/dpr/DprMasters'));
const FmsProcessList       = lazyWithRetry(() => import('./features/o2d-fms/ProcessList'));
const O2dStepBoard         = lazyWithRetry(() => import('./features/o2d-fms/O2dStepBoard'));
const FmsProcessDetail     = lazyWithRetry(() => import('./features/o2d-fms/ProcessDetail'));
const FmsDashboard         = lazyWithRetry(() => import('./features/o2d-fms/FmsDashboard'));
const FmsStepConfig        = lazyWithRetry(() => import('./features/o2d-fms/StepDefinitionsConfig'));
const FmsTaskTemplates     = lazyWithRetry(() => import('./features/o2d-fms/TaskTemplates'));
const FmsScoreboard        = lazyWithRetry(() => import('./features/o2d-fms/Scoreboard'));
const MisScoring           = lazyWithRetry(() => import('./features/o2d-fms/MisScoring'));
const DoerProfile          = lazyWithRetry(() => import('./features/o2d-fms/DoerProfile'));
// Purchase FMS
const IndentList           = lazyWithRetry(() => import('./features/procurement/indents/IndentList'));
const IndentDetail         = lazyWithRetry(() => import('./features/procurement/indents/IndentDetail'));
const PurchaseOrderList    = lazyWithRetry(() => import('./features/procurement/purchase-orders/PurchaseOrderList'));
const PurchaseOrderDetail  = lazyWithRetry(() => import('./features/procurement/purchase-orders/PurchaseOrderDetail'));
const FollowUpList         = lazyWithRetry(() => import('./features/procurement/follow-ups/FollowUpList'));
const FollowUpDetail       = lazyWithRetry(() => import('./features/procurement/follow-ups/FollowUpDetail'));
const ProformaInvoiceList  = lazyWithRetry(() => import('./features/procurement/proforma-invoices/ProformaInvoiceList'));
const ProformaInvoiceDetail = lazyWithRetry(() => import('./features/procurement/proforma-invoices/ProformaInvoiceDetail'));
const AdvancePaymentList   = lazyWithRetry(() => import('./features/procurement/advance-payments/AdvancePaymentList'));

const GrnList              = lazyWithRetry(() => import('./features/procurement/grn/GrnList'));
const GrnDetail            = lazyWithRetry(() => import('./features/procurement/grn/GrnDetail'));
const ServiceCompletionList = lazyWithRetry(() => import('./features/procurement/service-completions/ServiceCompletionList'));
const IncomingQCList       = lazyWithRetry(() => import('./features/procurement/incoming-qc/IncomingQCList'));
const IncomingQCDetail     = lazyWithRetry(() => import('./features/procurement/incoming-qc/IncomingQCDetail'));
const VendorInvoiceList    = lazyWithRetry(() => import('./features/procurement/vendor-invoices/VendorInvoiceList'));
const VendorInvoiceDetail  = lazyWithRetry(() => import('./features/procurement/vendor-invoices/VendorInvoiceDetail'));
const VoucherList          = lazyWithRetry(() => import('./features/procurement/vouchers/VoucherList'));
const VoucherDetail        = lazyWithRetry(() => import('./features/procurement/vouchers/VoucherDetail'));
const TallyEntryList       = lazyWithRetry(() => import('./features/procurement/tally-entry/TallyEntryList'));
const TallyEntryDetail     = lazyWithRetry(() => import('./features/procurement/tally-entry/TallyEntryDetail'));
const FinalPaymentList     = lazyWithRetry(() => import('./features/procurement/final-payments/FinalPaymentList'));
const FinalPaymentDetail   = lazyWithRetry(() => import('./features/procurement/final-payments/FinalPaymentDetail'));
const PurchaseMasterData   = lazyWithRetry(() => import('./features/procurement/PurchaseMasterData'));
const PurchaseFmsHub       = lazyWithRetry(() => import('./features/procurement/PurchaseFmsHub'));
const VendorMaster         = lazyWithRetry(() => import('./features/procurement/vendors/VendorMaster'));
const VendorDetail         = lazyWithRetry(() => import('./features/procurement/vendors/VendorDetail'));

const FmsTaskPage          = lazyWithRetry(() => import('./features/o2d-fms/TaskPage'));
const FmsAllTasks          = lazyWithRetry(() => import('./features/o2d-fms/AllTasks'));
const FmsMasterBoard       = lazyWithRetry(() => import('./features/o2d-fms/MasterFms'));
const O2dMasterData        = lazyWithRetry(() => import('./features/o2d-fms/O2dMasterData'));
const TransporterMaster    = lazyWithRetry(() => import('./features/o2d-fms/TransporterMaster'));
const OrderIntakeList      = lazyWithRetry(() => import('./features/order-intake/OrderIntakeList'));
const NotFound             = lazyWithRetry(() => import('./components/NotFound'));

function App() {
  return (
    <>
      <UpdateBanner />
      {/* Route-aware boundary: a render error in any screen recovers on its own —
          silently retried once, and always cleared the instant the user navigates. */}
      <RouteErrorBoundary>
      <Suspense fallback={<AppLoader />}>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          <Route element={<MainLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/dispatch-control-tower" element={<DispatchControlTower />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/employees" element={<EmployeesList />} />
            <Route path="/orders" element={<OrdersList />} />
            <Route path="/orders/:id" element={<OrderDetails />} />
            <Route path="/orders/:id/phase/:phaseNo" element={<PhaseDetail />} />
            <Route path="/dispatch-planning" element={<PlanWorkspace />} />
            <Route path="/dispatch-planning/calendar" element={<DispatchCalendar />} />
            <Route path="/dispatch-planning/plan-vs-actual" element={<PlanVsActualMaster />} />
            <Route path="/dispatch-planning/generate-pdf" element={<GenerateDispatchPlanPdf />} />
            <Route path="/ppc-planning" element={<PPCPlanning />} />
            <Route path="/challans" element={<ChallansList />} />
            <Route path="/challans/generate-pdf" element={<GenerateChallanPdf />} />
            <Route path="/o2d/invoice-entry" element={<RequirePermission slug="o2dfms.view" fallback="inline"><InvoiceEntryForm /></RequirePermission>} />
            <Route path="/o2d/invoice-email" element={<RequirePermission slug="o2dfms.view" fallback="inline"><InvoiceEmail /></RequirePermission>} />
            <Route path="/o2d/dispatch-schedule-email" element={<RequirePermission slug="o2dfms.view" fallback="inline"><DispatchScheduleEmail /></RequirePermission>} />
            <Route path="/o2d/track-delivery" element={<RequirePermission slug="o2dfms.view" fallback="inline"><TrackDelivery /></RequirePermission>} />
            <Route path="/o2d/payments" element={<RequirePermission slug="o2dfms.view" fallback="inline"><PaymentSteps /></RequirePermission>} />
            <Route path="/o2d/transport-bill" element={<RequirePermission slug="o2dfms.view" fallback="inline"><TransportBill /></RequirePermission>} />

            {/* IMS — Packaging & Consumables inventory */}
            <Route path="/ims" element={<ImsDashboard />} />
            <Route path="/ims/stock" element={<ImsStockList />} />
            <Route path="/ims/item/:skuId" element={<ImsItemDetail />} />
            <Route path="/ims/stock-in" element={<ImsStockIn />} />
            <Route path="/ims/stock-out" element={<ImsStockOut />} />
            <Route path="/ims/reorder" element={<ImsReorder />} />
            <Route path="/ims/movements" element={<ImsMovements />} />

            {/* RM IMS — Raw Material (Coil + Circle) inventory */}
            <Route path="/rm-ims" element={<RmImsDashboard />} />
            <Route path="/rm-ims/stock" element={<RmImsStockList />} />
            <Route path="/rm-ims/stock-in" element={<RmImsStockIn />} />
            <Route path="/rm-ims/stock-out" element={<RmImsStockOut />} />
            <Route path="/rm-ims/conversion" element={<RmImsConversion />} />
            <Route path="/rm-ims/reorder" element={<RmImsReorder />} />
            <Route path="/rm-ims/movements" element={<RmImsMovements />} />

            {/* FG IMS — Finished Goods inventory (Production In / Dispatch Out) */}
            <Route path="/fg-ims" element={<FgImsDashboard />} />
            <Route path="/fg-ims/stock" element={<FgImsStockList />} />
            <Route path="/fg-ims/item/:skuId" element={<FgImsItemDetail />} />
            <Route path="/fg-ims/production-in" element={<FgImsProductionIn />} />
            <Route path="/fg-ims/dispatch-out" element={<FgImsDispatchOut />} />
            <Route path="/fg-ims/planning" element={<FgImsPlanning />} />
            <Route path="/fg-ims/movements" element={<FgImsMovements />} />

            {/* PPC — DPR / OEE (shop-floor daily production report + dashboards) */}
            <Route path="/ppc/dpr" element={<Navigate to="/ppc/dpr/register" replace />} />
            <Route path="/ppc/dpr/register" element={<DprRegister />} />
            <Route path="/ppc/dpr/new" element={<DprEntry />} />
            <Route path="/ppc/dpr/:id/edit" element={<DprEntry />} />
            <Route path="/ppc/dpr/machine" element={<DprMachineDashboard />} />
            <Route path="/ppc/dpr/production" element={<DprProductionDashboard />} />
            <Route path="/ppc/dpr/operator" element={<DprOperatorDashboard />} />
            <Route path="/ppc/dpr/mis" element={<DprMisScoring />} />
            <Route path="/ppc/dpr/masters" element={<DprMasters />} />

            <Route path="/challans/:id" element={<ChallanDetail />} />
            <Route path="/invoices" element={<InvoicesList />} />
            <Route path="/skus" element={<SkusList />} />
            <Route path="/parties" element={<PartiesList />} />
            <Route path="/parties/:id" element={<PartyDetails />} />

            <Route
              path="/access-control"
              element={
                <RequirePermission slugs={['accessControl.manageUsers', 'accessControl.manageRoles', 'accessControl.viewAuditLog']} fallback="inline">
                  <AccessControl />
                </RequirePermission>
              }
            />
            <Route
              path="/pricing"
              element={
                <RequirePermission slug="pricing.view" fallback="inline">
                  <PricingHub />
                </RequirePermission>
              }
            />
            <Route
              path="/pricing/approvals"
              element={
                <RequirePermission slug="pricing.approve" fallback="inline">
                  <ApprovalInbox />
                </RequirePermission>
              }
            />
            <Route
              path="/pricing/calculator"
              element={
                <RequirePermission slug="pricing.view" fallback="inline">
                  <TurnoverCalculator />
                </RequirePermission>
              }
            />
            <Route
              path="/pricing/documents"
              element={
                <RequirePermission slug="pricing.view" fallback="inline">
                  <PricingDocuments />
                </RequirePermission>
              }
            />
            <Route
              path="/pricing/analytics"
              element={
                <RequirePermission slug="pricing.view" fallback="inline">
                  <PricingAnalytics />
                </RequirePermission>
              }
            />
            <Route
              path="/quotes"
              element={
                <RequirePermission slug="quotes.view" fallback="inline">
                  <QuotesList />
                </RequirePermission>
              }
            />
            <Route
              path="/quotes/drafts"
              element={
                <RequirePermission slug="quotes.view" fallback="inline">
                  <QuotesList initialStatus="DRAFT" lockStatus title="Saved Drafts" />
                </RequirePermission>
              }
            />
            <Route
              path="/quotes/:id"
              element={
                <RequirePermission slug="quotes.view" fallback="inline">
                  <QuoteDetail />
                </RequirePermission>
              }
            />

            {/* O2D FMS — Flow Management System */}
            <Route path="/o2d-fms" element={<RequirePermission slug="o2dfms.view" fallback="inline"><FmsMyTasks /></RequirePermission>} />
            <Route path="/o2d-fms/all-tasks" element={<RequirePermission slug="o2dfms.manage" fallback="inline"><FmsAllTasks /></RequirePermission>} />
            <Route path="/o2d-fms/processes" element={<RequirePermission slug="o2dfms.view" fallback="inline"><FmsProcessList /></RequirePermission>} />
            <Route path="/o2d-fms/steps" element={<RequirePermission slug="o2dfms.view" fallback="inline"><O2dStepBoard /></RequirePermission>} />
            <Route path="/o2d-fms/steps/:stepCode" element={<RequirePermission slug="o2dfms.view" fallback="inline"><O2dStepBoard /></RequirePermission>} />
            <Route path="/o2d-fms/master" element={<RequirePermission slug="o2dfms.view" fallback="inline"><FmsMasterBoard /></RequirePermission>} />
            <Route path="/o2d-fms/master-data" element={<RequirePermission slug="o2dfms.view" fallback="inline"><O2dMasterData /></RequirePermission>} />
            <Route path="/o2d-fms/transporters" element={<RequirePermission slug="o2dfms.view" fallback="inline"><TransporterMaster /></RequirePermission>} />
            <Route path="/o2d-fms/process/:id" element={<RequirePermission slug="o2dfms.view" fallback="inline"><FmsProcessDetail /></RequirePermission>} />
            <Route path="/o2d-fms/task/:processId/:stepCode" element={<RequirePermission slug="o2dfms.view" fallback="inline"><FmsTaskPage /></RequirePermission>} />
            <Route path="/order-intake" element={<RequirePermission slug="orders.view" fallback="inline"><OrderIntakeList /></RequirePermission>} />
            <Route path="/o2d-fms/dashboard" element={<RequirePermission slug="o2dfms.view" fallback="inline"><FmsDashboard /></RequirePermission>} />
            <Route path="/o2d-fms/config" element={<RequirePermission slug="o2dfms.config" fallback="inline"><FmsStepConfig /></RequirePermission>} />
            <Route path="/o2d-fms/templates" element={<RequirePermission slug="o2dfms.config" fallback="inline"><FmsTaskTemplates /></RequirePermission>} />
            <Route path="/o2d-fms/scores" element={<RequirePermission slug="o2dfms.view" fallback="inline"><MisScoring /></RequirePermission>} />
            <Route path="/o2d-fms/scores/:userId" element={<RequirePermission slug="o2dfms.view" fallback="inline"><DoerProfile /></RequirePermission>} />

            {/* Purchase FMS — visually scoped to the O2D FMS design language */}
            <Route element={<PurchaseFmsThemeScope />}>
              {/* Purchase FMS — unified workflow page with step navigation */}
              <Route path="/purchase-fms" element={<Navigate to="/purchase-fms/purchase-indents" replace />} />
              <Route path="/purchase-fms/:step" element={<PurchaseFmsHub />} />

              {/* Purchase FMS — Purchase Indents */}
              <Route path="/procurement/indents" element={<IndentList />} />
              <Route path="/procurement/indents/:id" element={<IndentDetail />} />
              <Route path="/procurement/purchase-orders" element={<PurchaseOrderList />} />
              <Route path="/procurement/purchase-orders/:id" element={<PurchaseOrderDetail />} />
              <Route path="/procurement/follow-ups" element={<FollowUpList />} />
              <Route path="/procurement/follow-ups/:id" element={<FollowUpDetail />} />
              <Route path="/procurement/proforma-invoices" element={<ProformaInvoiceList />} />
              <Route path="/procurement/proforma-invoices/:id" element={<ProformaInvoiceDetail />} />
              <Route path="/procurement/advance-payments" element={<AdvancePaymentList />} />

              <Route path="/procurement/grns" element={<GrnList />} />
              <Route path="/procurement/grns/:id" element={<GrnDetail />} />
              <Route path="/procurement/service-completions" element={<ServiceCompletionList />} />
              <Route path="/procurement/incoming-qc" element={<IncomingQCList />} />
              <Route path="/procurement/incoming-qc/:id" element={<IncomingQCDetail />} />
              <Route path="/procurement/vendor-invoices" element={<VendorInvoiceList />} />
              <Route path="/procurement/vendor-invoices/:id" element={<VendorInvoiceDetail />} />
              <Route path="/procurement/vouchers" element={<VoucherList />} />
              <Route path="/procurement/vouchers/:id" element={<VoucherDetail />} />
              <Route path="/procurement/tally-entries" element={<TallyEntryList />} />
              <Route path="/procurement/tally-entries/:id" element={<TallyEntryDetail />} />
              <Route path="/procurement/final-payments" element={<FinalPaymentList />} />
              <Route path="/procurement/final-payments/:id" element={<FinalPaymentDetail />} />
              <Route path="/procurement/master-data" element={<PurchaseMasterData />} />
              <Route path="/procurement/vendors" element={<VendorMaster />} />
              <Route path="/procurement/vendors/:id" element={<VendorDetail />} />
            </Route>

          </Route>
        </Route>

        {/* 404 — branded, no silent redirect */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
      </RouteErrorBoundary>
    </>
  );
}

export default App;
