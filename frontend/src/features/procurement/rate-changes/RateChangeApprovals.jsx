import React, { useState } from 'react';
import { Box, Typography, Tabs, Tab } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { pfmsPageSx, PFMS } from '../pfmsTheme';
import RateChangeRequestList from './RateChangeRequestList';
import RateChangeHistoryList from './RateChangeHistoryList';
import RateChangeDetailDrawer from './RateChangeDetailDrawer';

/**
 * Purchase Approval — PO rates that differ from the vendor's Vendor Master
 * rate. Requests are raised by saving a PO; an approval updates the vendor's
 * rate and the PO line together. Two tabs: Requests (decide) and Rate Change
 * History (append-only audit).
 *
 * A page of its own at /purchase-fms/rate-change-approvals (App.jsx) — it does
 * not sit inside the Purchase FMS hub, so none of the hub's header, step rail
 * or Quick Actions appear here. `?tab=history` opens the history;
 * `?request=<id>` opens one request.
 */
const RateChangeApprovals = () => {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'history' ? 'history' : 'requests';
  const openId = params.get('request') || null;
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
          Review and approve vendor rate changes.
        </Typography>
      </Box>

      <Tabs value={tab} onChange={(_e, v) => setParam({ tab: v === 'history' ? 'history' : '' })}
        variant="scrollable" scrollButtons={false}
        sx={{ minHeight: 40, borderBottom: '1px solid #e2e8f0', '& .MuiTab-root': { minHeight: 40, fontWeight: 700, textTransform: 'none' } }}>
        <Tab value="requests" label="Requests" data-testid="rc-tab-requests" />
        <Tab value="history" label="Rate Change History" data-testid="rc-tab-history" />
      </Tabs>

      {tab === 'requests' ? (
        <RateChangeRequestList onOpen={(id) => setParam({ request: id })} />
      ) : (
        <RateChangeHistoryList key={historyPreset ? `${historyPreset.vendorId}|${historyPreset.skuCode}` : 'all'}
          preset={historyPreset} onClearPreset={() => setHistoryPreset(null)}
          onOpenRequest={(id) => setParam({ request: id })} />
      )}

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
