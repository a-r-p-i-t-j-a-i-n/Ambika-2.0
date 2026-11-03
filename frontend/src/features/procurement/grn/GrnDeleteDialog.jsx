import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, TextField, Box, Alert, CircularProgress,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import { useDeleteGrnMutation, useGetGrnChangeCheckQuery } from '../../../store/api/procurementApi';
import { isGrnCompleted } from './grnMeta';

const LATER_STEP_LABEL = { QC: 'Incoming QC', INVOICE: 'Vendor Invoice' };
const laterStepText = (s) => (s.type === 'STOCK'
  ? `Stock already posted (${s.count} entr${s.count === 1 ? 'y' : 'ies'})`
  : `${LATER_STEP_LABEL[s.type] || s.type} ${s.number || ''}`.trim());

/**
 * Confirm + delete a GRN. A draft (or a cancelled GRN) posted nothing, so it
 * simply goes. A completed GRN asks why; its received qty comes off the PO, so
 * the PO is back to awaiting it — refused while a later step (QC, invoice,
 * stock) rests on it, and those are listed so the user knows what to remove.
 */
const GrnDeleteDialog = ({ open, grn, onClose }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [deleteGrn, { isLoading }] = useDeleteGrnMutation();
  const [reason, setReason] = useState('');
  const completed = isGrnCompleted(grn);
  const { data: checkRes, isFetching: checking } = useGetGrnChangeCheckQuery(grn?._id, {
    skip: !open || !grn?._id || !completed, refetchOnMountOrArgChange: true,
  });
  const laterSteps = checkRes?.data?.laterSteps || [];
  const blocked = completed && laterSteps.length > 0;

  const close = (done) => { setReason(''); onClose?.(done); };

  const handleDelete = async () => {
    try {
      await deleteGrn(completed ? { id: grn._id, reason: reason.trim() } : grn._id).unwrap();
      enqueueSnackbar(`GRN ${grn.grnNumber} deleted`, { variant: 'success' });
      close(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to delete GRN', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => (isLoading ? null : close(false))} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Delete {completed ? 'GRN' : 'draft GRN'} {grn?.grnNumber || ''}?</DialogTitle>
      <DialogContent>
        {!completed ? (
          <Typography variant="body2" color="text.secondary">
            Nothing was received on this GRN, so no PO or stock is affected. This cannot be undone from here.
          </Typography>
        ) : checking && !checkRes ? (
          <Box sx={{ py: 2, display: 'grid', placeItems: 'center' }}><CircularProgress size={22} /></Box>
        ) : blocked ? (
          <Alert severity="warning" sx={{ '& .MuiAlert-message': { width: '100%' } }}>
            <Typography variant="body2" fontWeight={700} sx={{ mb: 0.5 }}>This GRN cannot be deleted yet — these later steps rest on it:</Typography>
            {laterSteps.map((s, i) => <Typography key={i} variant="body2" data-testid="grn-delete-blocker">• {laterStepText(s)}</Typography>)}
            <Typography variant="body2" sx={{ mt: 0.75 }}>Remove them first (the latest step first), then delete the GRN.</Typography>
          </Alert>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              The quantity received on this GRN comes off its PO, so the PO goes back to awaiting it.
              No QC, invoice or stock rests on it. This cannot be undone from here.
            </Typography>
            <TextField label="Reason for deleting *" fullWidth size="small" value={reason} autoFocus
              onChange={(e) => setReason(e.target.value)} inputProps={{ maxLength: 500 }}
              placeholder="e.g. GRN entered twice" />
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => close(false)} disabled={isLoading}>{blocked ? 'Close' : 'Cancel'}</Button>
        {!blocked && (
          <Button onClick={handleDelete} color="error" variant="contained"
            disabled={isLoading || (completed && (checking || reason.trim().length < 3))}>
            {isLoading ? 'Deleting…' : 'Delete'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default GrnDeleteDialog;
