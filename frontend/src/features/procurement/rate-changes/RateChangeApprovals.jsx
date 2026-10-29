import React, { useState } from 'react';
import { Box, Typography, Tabs, Tab } from '@mui/material';
import { Scale } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx } from '../pfmsTheme';
import RateChangeRequestList from './RateChangeRequestList';
import RateChangeHistoryList from './RateChangeHistoryList';
import RateChangeDetailDrawer from './RateChangeDetailDrawer';

/**
 * Rate Change Approvals — Purchase FMS section for PO rates that differ from
 * the vendor's Vendor Master rate. Requests are raised by saving a PO; an
 * approval updates the vendor's rate and the PO line together. Two tabs:
 * Requests (decide) and Rate Change History (append-only audit).
 *
 * Rendered by the Purchase FMS hub at /purchase-fms/rate-change-approvals.
 * `?tab=history` opens the history; `?request=<id>` opens one request.
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
      <Box>
        <Typography component="h2" sx={{ ...pfmsTitleSx, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Scale size={18} color="#b45309" /> Rate Change Approvals
        </Typography>
        <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>
          A PO saved at a rate other than the vendor's rate waits here. Approving makes it the vendor's rate for future POs and applies it to the PO; rejecting keeps the vendor's rate.
        </Typography>
      </Box>

      <Tabs value={tab} onChange={(_e, v) => setParam({ tab: v === 'history' ? 'history' : '' })}
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
