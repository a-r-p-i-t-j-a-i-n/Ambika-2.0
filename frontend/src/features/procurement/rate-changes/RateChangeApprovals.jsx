import React, { useEffect, useState } from 'react';
import { Box, Typography, Tabs, Tab } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { pfmsPageSx, PFMS } from '../pfmsTheme';
import RateChangeRequestList from './RateChangeRequestList';
import RateChangeHistoryList from './RateChangeHistoryList';
import RateChangeDetailDrawer from './RateChangeDetailDrawer';
import NewVendorPoList from './NewVendorPoList';
import NewVendorPoDrawer from './NewVendorPoDrawer';
import { useGetRateChangesQuery, useGetPoApprovalsQuery } from '../../../store/api/procurementApi';
import { NEW_VENDOR_TAB } from './rateChangeMeta';

/**
 * Purchase Approval — PO rates / units that differ from the vendor's Vendor
 * Master row, and POs for new vendors. Requests are raised by saving a PO; an
 * approval updates the vendor's rate (and unit) and the PO line together. The MD
 * or the purchase approver decides — either one is enough. Three tabs: Requests
 * (rate / unit changes), New Vendor POs, and Rate Change History (append-only audit).
 *
 * A page of its own at /purchase-fms/rate-change-approvals (App.jsx) — it does
 * not sit inside the Purchase FMS hub, so none of the hub's header, step rail
 * or Quick Actions appear here. `?tab=history` opens the history;
 * `?tab=new-vendor` the new-vendor POs (`&po=<id>` opens one); `?request=<id>` opens one request.
 */
// "Requests  [3]" — the pending count as a small pill inside the tab label (hidden at 0).
const TabLabel = ({ text, count, testId }) => (
  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
    {text}
    {count > 0 && (
      <Box component="span" data-testid={testId}
        sx={{ minWidth: 20, height: 20, px: 0.6, borderRadius: '10px', bgcolor: '#b45309', color: '#fff', fontSize: '0.68rem', fontWeight: 800, lineHeight: '20px', textAlign: 'center' }}>
        {count > 99 ? '99+' : count}
      </Box>
    )}
  </Box>
);

// The tab strip with the pending counts. The counts are shared lists (a decision by the other approver lowers them);
// they live HERE so a count arriving re-renders only these tabs, not the page's grid.
const ApprovalTabs = ({ tab, onChange }) => {
  // The counts are fetched a moment AFTER the page is up, so the list the user came for (and the sidebar drawer
  // closing on a phone) never waits behind two extra requests.
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 1200); return () => clearTimeout(t); }, []);
  const rc = useGetRateChangesQuery({ status: 'PENDING', limit: 1 }, { skip: !ready, pollingInterval: 30000, skipPollingIfUnfocused: true });
  const nv = useGetPoApprovalsQuery({ status: 'PENDING', limit: 1 }, { skip: !ready, pollingInterval: 30000, skipPollingIfUnfocused: true });
  const rcPending = rc.data?.data?.summary?.PENDING || 0;
  const nvPending = nv.data?.data?.summary?.PENDING || 0;
  return (
    <Tabs value={tab} onChange={(_e, v) => onChange(v)}
      variant="scrollable" scrollButtons={false}
      sx={{ minHeight: 40, borderBottom: '1px solid #e2e8f0', '& .MuiTab-root': { minHeight: 40, fontWeight: 700, textTransform: 'none' } }}>
      <Tab value="requests" data-testid="rc-tab-requests"
        label={<TabLabel text="Requests" count={rcPending} testId="rc-tab-requests-count" />} />
      <Tab value={NEW_VENDOR_TAB} data-testid="rc-tab-new-vendor"
        label={<TabLabel text="New Vendor POs" count={nvPending} testId="rc-tab-new-vendor-count" />} />
      <Tab value="history" label="Rate Change History" data-testid="rc-tab-history" />
    </Tabs>
  );
};

const RateChangeApprovals = () => {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab = tabParam === 'history' ? 'history' : tabParam === NEW_VENDOR_TAB ? NEW_VENDOR_TAB : 'requests';
  const openId = params.get('request') || null;
  const openPoId = params.get('po') || null;
  const [historyPreset, setHistoryPreset] = useState(null);

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, ...pfmsPageSx }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography component="h1" data-testid="rc-page-title"
          sx={{ fontSize: { xs: '1.15rem', md: '1.35rem' }, fontWeight: 800, color: PFMS.ink, lineHeight: 1.2 }}>
          Purchase Approval
        </Typography>
        <Typography sx={{ fontSize: '0.8rem', color: PFMS.sub, mt: 0.25 }}>
          Review and approve vendor rate changes. Unit changes and new-vendor POs are decided here too.
        </Typography>
      </Box>

      <ApprovalTabs tab={tab} onChange={(v) => setParam({ tab: v === 'requests' ? '' : v, request: '', po: '' })} />

      {tab === 'requests' ? (
        <RateChangeRequestList onOpen={(id) => setParam({ request: id })} />
      ) : tab === NEW_VENDOR_TAB ? (
        <NewVendorPoList onOpen={(id) => setParam({ po: id })} />
      ) : (
        <RateChangeHistoryList key={historyPreset ? `${historyPreset.vendorId}|${historyPreset.skuCode}` : 'all'}
          preset={historyPreset} onClearPreset={() => setHistoryPreset(null)}
          onOpenRequest={(id) => setParam({ request: id })} />
      )}

      <NewVendorPoDrawer key={`po-${openPoId || 'none'}`} id={openPoId} onClose={() => setParam({ po: '' })} />
      <RateChangeDetailDrawer
        key={openId || 'none'}
        id={openId}
        onClose={() => setParam({ request: '' })}
        onViewHistory={(preset) => { setHistoryPreset(preset); setParam({ request: '', tab: 'history' }); }}
      />
    </Box>
  );
};

export default RateChangeApprovals;
