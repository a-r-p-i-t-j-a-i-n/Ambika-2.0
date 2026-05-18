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
            <Route path="/dispatch-planning" element={<PlanWorkspace />} />
            <Route path="/ppc-planning" element={<PPCPlanning />} />
            <Route path="/challans" element={<ChallansList />} />
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
              path="/quotes/:id"
              element={
                <RequirePermission slug="quotes.view" fallback="inline">
                  <QuoteDetail />
                </RequirePermission>
              }
            />
          </Route>
        </Route>

        {/* 404 — branded, no silent redirect */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export default App;
