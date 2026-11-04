import React from 'react';
import { Box, Typography, Chip, Link } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import { useGetRateChangesQuery } from '../../../store/api/procurementApi';
import { RATE_STATUS, RATE_LINE_LABEL, RATE_CHANGE_PATH, fmtRate, fmtDiff, diffColor } from '../rate-changes/rateChangeMeta';

/**
 * The rate changes raised on this PO: vendor rate → proposed rate and the
 * difference, the doer's reason, and the decision (with the approver's reason
 * when it was rejected). Reads the same requests Purchase Approval decides.
 * Renders nothing when the PO has none.
 */
const PoRateChangesPanel = ({ poId }) => {
  const { data } = useGetRateChangesQuery({ poId, limit: 50 }, { skip: !poId });
  const rows = data?.data?.rows || [];
  if (!rows.length) return null;
  return (
    <Box data-testid="po-rate-changes-panel" sx={{ mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: '8px', overflow: 'hidden' }}>
      <Typography variant="caption" sx={{ display: 'block', px: 1.5, py: 0.75, fontWeight: 800, letterSpacing: 0.4, bgcolor: alpha('#2563eb', 0.05) }}>
        RATE CHANGES ON THIS PO
      </Typography>
      {rows.map((r) => {
        const st = RATE_STATUS[r.status] || RATE_STATUS.PENDING;
        const note = r.status === 'REJECTED' ? `Rejected${r.decidedByName ? ` by ${r.decidedByName}` : ''}: ${r.rejectionReason}`
          : r.status === 'WITHDRAWN' ? r.withdrawnReason
            : r.status === 'APPROVED' ? (r.decisionRemarks ? `Approved: ${r.decisionRemarks}` : `Approved${r.decidedByName ? ` by ${r.decidedByName}` : ''}`)
              : '';
        return (
          <Box key={r._id} data-testid="po-rate-change-row" data-status={r.status}
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
            <Chip size="small" label={RATE_LINE_LABEL[r.status] || st.label}
              sx={{ height: 20, fontSize: '0.64rem', fontWeight: 800, bgcolor: st.bg, color: st.color }} />
            <Box sx={{ minWidth: 180, flex: '1 1 200px' }}>
              <Typography variant="body2" fontWeight={700}>{r.itemName || r.skuCode}</Typography>
              <Typography variant="caption" color="text.secondary">{r.skuCode} · {r.unit} · {r.vendorName}</Typography>
            </Box>
            <Typography variant="body2" data-testid="po-rate-change-numbers" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              Vendor {fmtRate(r.existingVendorRate)} → <b>{fmtRate(r.requestedRate)}</b>{' '}
              <Box component="span" sx={{ color: diffColor(r.diffAmount), fontWeight: 700 }}>({fmtDiff(r.diffAmount, r.diffPercent)})</Box>
            </Typography>
            <Link component={RouterLink} to={`${RATE_CHANGE_PATH}?request=${r._id}`} underline="hover" sx={{ fontWeight: 700, fontSize: '0.78rem' }}>
              {r.requestNumber}
            </Link>
            <Box sx={{ flex: '1 1 100%', pl: 0.25 }}>
              <Typography variant="caption" color="text.secondary" data-testid="po-rate-change-reason">Reason: {r.reason || '—'}</Typography>
              {note ? (
                <Typography variant="caption" data-testid="po-rate-change-note"
                  sx={{ display: 'block', fontWeight: 600, color: r.status === 'REJECTED' ? '#b91c1c' : 'text.secondary' }}>{note}</Typography>
              ) : null}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

export default PoRateChangesPanel;
