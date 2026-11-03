import React, { Suspense, lazy, useState } from 'react';
import { Box, Typography, Button, Stack, ToggleButtonGroup, ToggleButton } from '@mui/material';
import { FilePlus2, ShoppingCart, Truck } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { usePermissions } from '../../hooks/usePermission';
import { pfmsPageSx, pfmsTitleSx } from '../procurement/pfmsTheme';
import FmsTaskList from './FmsTaskList';
import { useHiddenSteps, useO2dRights, stepKey } from '../../utils/embed';

/**
 * My FMS Tasks — O2D FMS and Purchase FMS work in one list (FmsTaskList, with
 * a Source filter). Each row's buttons do the work: O2D rows open the step's
 * screen, Purchase rows open the record's form right here. A Purchase record
 * page opened from a task still carries ?fmsTask=<id> (see FmsDoerCard).
 */

// Quick actions — open the form right here (the same drawers their own pages
// use), so starting a piece of work never needs a trip through the menus.
const IndentFormDrawer = lazy(() => import('../procurement/indents/IndentFormDrawer'));
const OrderEntryDrawer = lazy(() => import('../orders/OrderEntryDrawer'));
const DispatchEntry = lazy(() => import('../execution/DispatchEntry'));

const QUICK_ACTIONS = [
  { key: 'indent', label: 'Indent Form', icon: FilePlus2 },
  { key: 'order', label: 'Sales Order', icon: ShoppingCart },
  { key: 'dispatch', label: 'Actual Dispatch', icon: Truck },
];

const FmsTasksPage = () => {
  const { can, isRoot } = usePermissions();
  const canManage = can('fms.manageDoers');
  // Who may see everybody's tasks, per source (the server checks the same).
  const canSeeAllO2d = isRoot || can('o2dfms.manage') || canManage;
  const canSeeAll = canSeeAllO2d || canManage;
  // My / All lives in the address (?scope=all, and FmsTaskList keeps its
  // filters there too), so coming Back from a task's screen — or a refresh —
  // lands on exactly the same view. Changes replace the entry instead of
  // adding one, so Back still goes to the previous page.
  const [params, setParams] = useSearchParams();
  const scope = canSeeAll && params.get('scope') === 'all' ? 'all' : 'mine';
  // A new scope starts on page 1 and forgets "Assigned By" (its list differs).
  const setScope = (v) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (v === 'all') next.set('scope', 'all'); else next.delete('scope');
    next.delete('page');
    next.delete('by');
    return next;
  }, { replace: true });
  const [quick, setQuick] = useState(null);

  // A quick action leaves with its step when the MD switches that step off
  // in the Delegation Suite (lock icon) — as the Purchase hub's Quick Actions do;
  // Sales Order follows the Step Board's "New Sales Order" switch.
  const hiddenPurchase = useHiddenSteps('purchase');
  const hiddenO2d = useHiddenSteps('o2d');
  const o2dRights = useO2dRights();
  const quickActions = QUICK_ACTIONS.filter((a) => (
    a.key === 'indent' ? !hiddenPurchase.has(stepKey('purchase-indents'))
      : a.key === 'order' ? o2dRights.canAdd
        : !hiddenO2d.has(stepKey('2.06'))
  ));
  const closeQuick = () => setQuick(null);

  const toggleSx = { px: 1.5, py: 0.5, textTransform: 'none', fontWeight: 700 };
  return (
    <Box sx={{ ...pfmsPageSx, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* One line: what you are looking at (left), quick actions (right). */}
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <Typography sx={{ ...pfmsTitleSx, whiteSpace: 'nowrap' }}>My FMS Tasks</Typography>
        {canSeeAll && (
          <ToggleButtonGroup size="small" exclusive value={scope} onChange={(_e, v) => { if (v) setScope(v); }}>
            <ToggleButton value="mine" sx={toggleSx}>My tasks</ToggleButton>
            <ToggleButton value="all" sx={toggleSx}>All tasks</ToggleButton>
          </ToggleButtonGroup>
        )}
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {quickActions.map((a) => {
            const Icon = a.icon;
            return (
              <Button key={a.key} variant="contained" disableElevation size="small" startIcon={<Icon size={15} />}
                onClick={() => setQuick(a.key)}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: 2, px: 1.75, whiteSpace: 'nowrap' }}>
                {a.label}
              </Button>
            );
          })}
        </Stack>
      </Stack>

      {/* All tasks: each source shows everybody's only to those allowed it,
          otherwise still your own. Reassign is the doer manager's (Purchase). */}
      <FmsTaskList
        o2dScope={canSeeAllO2d ? scope : 'mine'}
        purchaseScope={canManage ? scope : 'mine'}
        canReassign={canManage && scope === 'all'}
      />

      <Suspense fallback={null}>
        {quick === 'indent' && <IndentFormDrawer open onClose={closeQuick} />}
        {quick === 'order' && <OrderEntryDrawer open onClose={closeQuick} />}
        {quick === 'dispatch' && <DispatchEntry open onClose={closeQuick} />}
      </Suspense>
    </Box>
  );
};

export default FmsTasksPage;
