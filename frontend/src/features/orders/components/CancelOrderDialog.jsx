import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Typography,
  Box, Stack, Alert, Chip, alpha, CircularProgress, IconButton,
} from '@mui/material';
import { X, Ban, AlertTriangle, RotateCcw } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useUpdateOrderMutation } from '../../../store/api/orderApi';

const num = (n) => Number(n || 0).toLocaleString('en-IN');

/**
 * Cancel a sales order the customer has pulled — or re-open one cancelled by
 * mistake. Cancelling is a status change (never a delete): the order, its
 * challans and its history stay intact and auditable, it just stops being
 * actionable. A reason is required so the "why" is never lost.
 */
const CancelOrderDialog = ({ open, onClose, order, mode = 'cancel' }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [reason, setReason] = useState('');
  const [updateOrder, { isLoading }] = useUpdateOrderMutation();
  const reopening = mode === 'reopen';

  useEffect(() => { if (open) setReason(''); }, [open]);

  const dispatched = Number(order?.totalDispatchedQty || 0);
  const ordered = Number(order?.totalOrderQty || 0);

  const submit = async () => {
    if (!reopening && !reason.trim()) {
      return enqueueSnackbar('Please give a reason for cancelling.', { variant: 'warning' });
    }
    try {
      await updateOrder({
        id: order._id,
        // Re-open → back to RECEIVED; the order's own rules then re-derive
        // IN_PROGRESS / COMPLETED from what has actually been dispatched.
        status: reopening ? 'RECEIVED' : 'CANCELLED',
        ...(reopening ? {} : { cancelReason: reason.trim() }),
      }).unwrap();
      enqueueSnackbar(
        reopening ? `${order.soNumber} re-opened.` : `${order.soNumber} cancelled.`,
        { variant: reopening ? 'success' : 'info' },
      );
      onClose();
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not update the order.', { variant: 'error' });
    }
  };

  if (!order) return null;
  const accent = reopening ? '#0f766e' : '#dc2626';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ pr: 6, pb: 1 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ width: 34, height: 34, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(accent, 0.12), color: accent, flexShrink: 0 }}>
            {reopening ? <RotateCcw size={17} /> : <Ban size={17} />}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem' }}>
              {reopening ? 'Re-open this order?' : 'Cancel this order?'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {order.soNumber} · {order.partyName}
            </Typography>
          </Box>
        </Stack>
        <IconButton onClick={onClose} size="small" sx={{ position: 'absolute', right: 8, top: 8 }}><X size={17} /></IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ py: 2 }}>
        {reopening ? (
          <Alert severity="info" sx={{ py: 0.5, mb: 1.5 }}>
            The order becomes active again and its status is re-derived from what has actually been dispatched.
          </Alert>
        ) : (
          <>
            <Alert severity="warning" icon={<AlertTriangle size={18} />} sx={{ py: 0.5, mb: 1.5 }}>
              The order is kept for the record — nothing is deleted. It stops being actionable and drops out of the live pipeline.
            </Alert>
            {dispatched > 0 && (
              <Alert severity="error" icon={<AlertTriangle size={18} />} sx={{ py: 0.5, mb: 1.5 }}>
                <b>{num(dispatched)} of {num(ordered)} pcs are already dispatched.</b> Cancelling does <b>not</b> undo those
                delivery challans or their invoices — settle them separately.
              </Alert>
            )}
            <TextField
              label="Reason for cancellation" required autoFocus fullWidth multiline minRows={2}
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer withdrew the PO — revised requirement expected next month"
              helperText="Stored on the order so the why is never lost."
            />
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2.5, py: 1.5 }}>
        <Chip size="small" variant="outlined" label={`Currently: ${order.status}`} sx={{ mr: 'auto', fontSize: '0.65rem', fontWeight: 700 }} />
        <Button onClick={onClose}>Back</Button>
        <Button
          variant="contained" onClick={submit} disableElevation
          color={reopening ? 'success' : 'error'}
          disabled={isLoading || (!reopening && !reason.trim())}
          startIcon={isLoading ? <CircularProgress size={14} color="inherit" /> : (reopening ? <RotateCcw size={14} /> : <Ban size={14} />)}
          sx={{ fontWeight: 700 }}
        >
          {isLoading ? 'Saving…' : (reopening ? 'Re-open order' : 'Cancel order')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default CancelOrderDialog;
