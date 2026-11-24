/**
 * FMS → O2D → O2D Dashboard.
 *
 * Who sees what (Suite → Employees → lock icon → O2D Dashboard):
 *   - MD / Admin, and anyone with "Full dashboard — what MD sees" switched on
 *     (ERP permission o2dfms.dashboardAll): the whole company's orders, with
 *     a switch to their own tasks;
 *   - everybody else: their own O2D tasks and KPIs only.
 */
import React, { useState } from 'react';
import { usePermission } from '../../hooks/usePermission';
import CompanyDashboard from './CompanyDashboard';
import MyDashboard from './MyDashboard';
import { ViewSwitch } from './components/DashUi';

const O2dDashboard = () => {
  const canSeeAll = usePermission('o2dfms.dashboardAll');
  const [view, setView] = useState('company');
  const [denied, setDenied] = useState(false);
  const full = canSeeAll && !denied;
  const showCompany = full && view === 'company';
  const switcher = full ? <ViewSwitch value={showCompany ? 'company' : 'mine'} onChange={setView} /> : null;

  return showCompany
    ? <CompanyDashboard switcher={switcher} onDenied={() => setDenied(true)} />
    : <MyDashboard switcher={switcher} />;
};

export default O2dDashboard;
