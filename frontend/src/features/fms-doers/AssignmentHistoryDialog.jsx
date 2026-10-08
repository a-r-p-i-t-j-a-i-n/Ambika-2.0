import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, CircularProgress,
} from '@mui/material';
import { useGetAssignmentHistoryQuery } from '../../store/api/fmsDoerApi';
import { fmtDateTime } from './fmsDoerMeta';
import { PFMS } from '../procurement/pfmsTheme';

const ACTION_LABEL = { ASSIGNED: 'Assigned', REASSIGNED: 'Changed', UNASSIGNED: 'Unassigned' };

/** Audit history of one step's doer assignment (who changed it, from → to, when, why). */
const AssignmentHistoryDialog = ({ open, onClose, fmsKey, step }) => {
  const { data, isLoading } = useGetAssignmentHistoryQuery(
    { fmsKey, stepKey: step?.stepKey }, { skip: !open || !step },
  );
  const rows = data?.data || [];
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Doer history
        <Typography variant="body2" color="text.secondary">{step ? `${step.code} · ${step.label}` : ''}</Typography>
      </DialogTitle>
      <DialogContent dividers>
        {isLoading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}><CircularProgress size={22} /></Box> : null}
        {!isLoading && !rows.length && <Typography color="text.secondary">No changes recorded yet.</Typography>}
        {rows.map((h, i) => (
          <Box key={i} sx={{ py: 1.25, borderBottom: i < rows.length - 1 ? `1px solid ${PFMS.lineSoft}` : 'none' }}>
            <Typography sx={{ fontWeight: 700, color: PFMS.ink }}>
              {ACTION_LABEL[h.action] || h.action}: {h.from?.name || '—'} → {h.to?.name || 'Unassigned'}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block">
              by {h.by?.name || '—'} · {fmtDateTime(h.at)}
            </Typography>
            {h.reason && <Typography variant="body2" sx={{ mt: 0.5 }}>Reason: {h.reason}</Typography>}
            {h.note && <Typography variant="caption" sx={{ color: '#b45309', display: 'block', mt: 0.25 }}>{h.note}</Typography>}
          </Box>
        ))}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  );
};

export default AssignmentHistoryDialog;
