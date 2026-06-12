import React, { Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
import AppLoader from './components/AppLoader';
import RequirePermission from './components/RequirePermission';
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
const PPCPlanning          = lazyWithRetry(() => import('./features/ppc/PPCPlanning'));
const ChallansList         = lazyWithRetry(() => import('./features/execution/ChallansList'));
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
const FmsProcessList       = lazyWithRetry(() => import('./features/o2d-fms/ProcessList'));
const FmsProcessDetail     = lazyWithRetry(() => import('./features/o2d-fms/ProcessDetail'));
const FmsDashboard         = lazyWithRetry(() => import('./features/o2d-fms/FmsDashboard'));
const FmsStepConfig        = lazyWithRetry(() => import('./features/o2d-fms/StepDefinitionsConfig'));
const FmsTaskTemplates     = lazyWithRetry(() => import('./features/o2d-fms/TaskTemplates'));
const FmsScoreboard        = lazyWithRetry(() => import('./features/o2d-fms/Scoreboard'));
const FmsTaskPage          = lazyWithRetry(() => import('./features/o2d-fms/TaskPage'));
const FmsAllTasks          = lazyWithRetry(() => import('./features/o2d-fms/AllTasks'));
const FmsMasterBoard       = lazyWithRetry(() => import('./features/o2d-fms/MasterFms'));
const OrderIntakeList      = lazyWithRetry(() => import('./features/order-intake/OrderIntakeList'));
const NotFound             = lazyWithRetry(() => import('./components/NotFound'));

function App() {
  return (
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
            <Route path="/ppc-planning" element={<PPCPlanning />} />
            <Route path="/challans" element={<ChallansList />} />
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
            <Route path="/o2d-fms/master" element={<RequirePermission slug="o2dfms.view" fallback="inline"><FmsMasterBoard /></RequirePermission>} />
            <Route path="/o2d-fms/process/:id" element={<RequirePermission slug="o2dfms.view" fallback="inline"><FmsProcessDetail /></RequirePermission>} />
            <Route path="/o2d-fms/task/:processId/:stepCode" element={<RequirePermission slug="o2dfms.view" fallback="inline"><FmsTaskPage /></RequirePermission>} />
            <Route path="/order-intake" element={<RequirePermission slug="orders.view" fallback="inline"><OrderIntakeList /></RequirePermission>} />
            <Route path="/o2d-fms/dashboard" element={<RequirePermission slug="o2dfms.view" fallback="inline"><FmsDashboard /></RequirePermission>} />
            <Route path="/o2d-fms/config" element={<RequirePermission slug="o2dfms.config" fallback="inline"><FmsStepConfig /></RequirePermission>} />
            <Route path="/o2d-fms/templates" element={<RequirePermission slug="o2dfms.config" fallback="inline"><FmsTaskTemplates /></RequirePermission>} />
            <Route path="/o2d-fms/scores" element={<RequirePermission slug="o2dfms.view" fallback="inline"><FmsScoreboard /></RequirePermission>} />
          </Route>
        </Route>

        {/* 404 — branded, no silent redirect */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export default App;
