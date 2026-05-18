import React, { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
import AppLoader from './components/AppLoader';
import RequirePermission from './components/RequirePermission';

// ─── Eager: shell + auth (needed before any route renders) ──────────────────
import Login from './features/auth/Login';

// ─── Lazy: every authenticated screen ───────────────────────────────────────
// Each import() becomes its own chunk thanks to vite's manualChunks config.
const Dashboard            = lazy(() => import('./features/dashboard/Dashboard'));
const DispatchControlTower = lazy(() => import('./features/dashboard/DispatchControlTower'));
const Profile              = lazy(() => import('./features/profile/Profile'));
const EmployeesList        = lazy(() => import('./features/employees/EmployeesList'));
const OrdersList           = lazy(() => import('./features/orders/OrdersList'));
const OrderDetails         = lazy(() => import('./features/orders/OrderDetails'));
const PlanWorkspace        = lazy(() => import('./features/planning/PlanWorkspace'));
const PPCPlanning          = lazy(() => import('./features/ppc/PPCPlanning'));
const ChallansList         = lazy(() => import('./features/execution/ChallansList'));
const InvoicesList         = lazy(() => import('./features/ledger/InvoicesList'));
const SkusList             = lazy(() => import('./features/masters/SkusList'));
const PartiesList          = lazy(() => import('./features/masters/PartiesList'));
const PartyDetails         = lazy(() => import('./features/masters/PartyDetails'));
const AccessControl        = lazy(() => import('./features/access-control/AccessControl'));
const PricingHub           = lazy(() => import('./features/pricing/PricingHub'));
const ApprovalInbox        = lazy(() => import('./features/pricing/ApprovalInbox'));
const TurnoverCalculator   = lazy(() => import('./features/pricing/TurnoverCalculator'));
const PricingDocuments     = lazy(() => import('./features/pricing/PricingDocuments'));
const PricingAnalytics     = lazy(() => import('./features/pricing/PricingAnalytics'));
const QuotesList           = lazy(() => import('./features/quotes/QuotesList'));
const QuoteDetail          = lazy(() => import('./features/quotes/QuoteDetail'));
const NotFound             = lazy(() => import('./components/NotFound'));

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
