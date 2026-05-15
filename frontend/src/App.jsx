import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './features/auth/Login';

import PartiesList from './features/masters/PartiesList';
import SkusList from './features/masters/SkusList';
import OrdersList from './features/orders/OrdersList';
import PPCPlanning from './features/ppc/PPCPlanning';
import Dashboard from './features/dashboard/Dashboard';
import ChallansList from './features/execution/ChallansList';
import InvoicesList from './features/ledger/InvoicesList';
import EmployeesList from './features/employees/EmployeesList';
import PlanWorkspace from './features/planning/PlanWorkspace';
import PartyDetails from './features/masters/PartyDetails';
import OrderDetails from './features/orders/OrderDetails';
import DispatchControlTower from './features/dashboard/DispatchControlTower';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      
      {/* Protected Routes */}
      <Route element={<ProtectedRoute />}>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/dispatch-control-tower" element={<DispatchControlTower />} />
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
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
