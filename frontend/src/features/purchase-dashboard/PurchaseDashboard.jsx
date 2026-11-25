/**
 * FMS → Purchase → Purchase Dashboard (the O2D Dashboard, for Purchase FMS).
 *
 * Who sees what:
 *   - MD / Admin, and anyone who may see every Purchase doer's tasks (ERP
 *     permission fms.manageDoers — the one the all-tasks API already checks):
 *     the whole company's indents, with a switch to their own tasks;
 *   - everybody else: their own Purchase tasks and KPIs only.
 */
import React, { useState } from 'react';
import { usePermission } from '../../hooks/usePermission';
import { ViewSwitch } from '../o2d-dashboard/components/DashUi';
import PurchaseCompanyDashboard from './PurchaseCompanyDashboard';
import PurchaseMyDashboard from './PurchaseMyDashboard';

const PurchaseDashboard = () => {
  const canSeeAll = usePermission('fms.manageDoers');
  const [view, setView] = useState('company');
  const [denied, setDenied] = useState(false);
  const full = canSeeAll && !denied;
  const showCompany = full && view === 'company';
  const switcher = full ? <ViewSwitch value={showCompany ? 'company' : 'mine'} onChange={setView} /> : null;

  return showCompany
    ? <PurchaseCompanyDashboard switcher={switcher} onDenied={() => setDenied(true)} />
    : <PurchaseMyDashboard switcher={switcher} />;
};

export default PurchaseDashboard;
