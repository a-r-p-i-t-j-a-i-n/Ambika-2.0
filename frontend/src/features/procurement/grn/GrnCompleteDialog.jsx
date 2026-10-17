import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Typography, CircularProgress, Alert, FormControlLabel, Checkbox, MenuItem,
} from '@mui/material';
import { PackageCheck } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useCompleteGrnMutation } from '../../../store/api/procurementApi';
import { fmtINR } from './grnMeta';
import { PFMS } from '../pfmsTheme';
// The SAME two values and the same default the RM Stock In screen uses, so
// "Received At" has one definition across both modules.
import { RECEIVED_AT_OPTIONS, DEFAULT_RECEIVED_AT } from '../../rm-ims/receivedAt';
import { INVENTORY_TYPE_OPTIONS, INVENTORY_TYPE_HELP, inventoryTypeLabel } from './inventoryType';

/**
 * Complete a GRN: posts received quantities to stock (via inventoryService)
 * and updates the PO/PI received quantities. This action is irreversible.
 *
 * The Inventory Type (chosen on the GRN, confirmed here) decides where the
 * stock lands: Raw Material → RM IMS at "Received At"; Consumable & Packaging →
 * the GRN's store. One type per GRN — the server refuses a mismatched line
 * before anything posts. A GRN raised before Inventory Type existed opens with
 * none chosen, and the operator picks it here.
 */
const GrnCompleteDialog = ({ open, onClose, grn }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [allowOverReceipt, setAllowOverReceipt] = useState(false);
  const [inventoryType, setInventoryType] = useState('');
  const [rmReceivedAtLocation, setRmReceivedAtLocation] = useState(DEFAULT_RECEIVED_AT);
  const [remarks, setRemarks] = useState('');
  const [completeGrn, { isLoading }] = useCompleteGrnMutation();

  // Seed from the GRN: this dialog confirms the choice made on the GRN rather
  // than asking again from scratch.
  useEffect(() => {
    if (!open) return;
    setAllowOverReceipt(false);
    setInventoryType(grn?.inventoryType || '');
    setRmReceivedAtLocation(grn?.rmReceivedAtLocation || DEFAULT_RECEIVED_AT);
    setRemarks('');
  }, [open, grn]);

  // Lines received beyond the pending qty (figures are server-derived; the
  // server re-validates against the PO's current state on completion).
  const extraLines = (grn?.items || []).filter((l) => Number(l.extraQty) > 0);

  const handleComplete = async () => {
    if (!inventoryType) {
      enqueueSnackbar('Select the Inventory Type for the received material', { variant: 'warning' });
      return;
    }
    try {
      const res = await completeGrn({
        id: grn._id,
        allowOverReceipt,
        inventoryType,
        ...(inventoryType === 'RM' ? { rmReceivedAtLocation } : {}),
        remarks: remarks.trim(),
      }).unwrap();

      // What the SERVER says actually happened, never what the form hoped for.
      const summary = res?.data?.rmSummary || {};
      const posted = summary.rmPostedCount || 0;
      enqueueSnackbar(
        posted
          ? `GRN saved and RM stock updated successfully — ${posted} item(s) at ${summary.rmReceivedAtLocation}.`
          : `GRN saved successfully — stock added to ${inventoryTypeLabel(summary.inventoryType || inventoryType)}.`,
        { variant: 'success' },
      );
      onClose?.(true);
    } catch (err) {
      // Nothing is claimed on failure: the completion is one all-or-nothing
      // unit, so there is no half-posted state to warn about here.
      enqueueSnackbar(err?.data?.message || 'Failed to complete GRN — nothing was posted', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Complete GRN
        {grn?.grnNumber && <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>{grn.grnNumber}</Typography>}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2, p: 1.5, borderRadius: '10px', bgcolor: PFMS.surfaceAlt }}>
          <Typography variant="body2" fontWeight={700}>{grn?.vendorName}</Typography>
          <Typography variant="caption" color="text.secondary">
            PO {grn?.poNumber || '—'} · {grn?.items?.length || 0} item(s) · qty {grn?.totalReceivedQty} · {fmtINR(grn?.totalValue)}
          </Typography>
        </Box>
        <Alert severity="warning" sx={{ mb: 2 }}>
          This will <b>increase stock</b> by the received quantities and update the PO. It cannot be undone.
        </Alert>
        {extraLines.length > 0 && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            Received qty exceeds the PO&apos;s current pending qty for:{' '}
            {extraLines.map((l) => `${l.itemName} (+${l.extraQty})`).join(', ')}.
            Tick &quot;Allow over-receipt&quot; and add remarks to receive the extra.
          </Alert>
        )}
        <FormControlLabel
          control={<Checkbox checked={allowOverReceipt} onChange={(e) => setAllowOverReceipt(e.target.checked)} />}
          label="Allow over-receipt (received qty may exceed pending PO qty)"
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          Pending qty is re-checked against the PO when you complete. Without this, any
          excess over the current pending qty is rejected.
        </Typography>

        {/* ── Inventory Type — where the received stock lands ── */}
        <Box sx={{ mt: 1.5, p: 1.25, borderRadius: '10px', border: `1px solid ${PFMS.border || '#e4e1d9'}` }}>
          <TextField
            select size="small" fullWidth required label="Inventory Type"
            value={inventoryType}
            onChange={(e) => setInventoryType(e.target.value)}
            helperText={INVENTORY_TYPE_HELP}
          >
            {INVENTORY_TYPE_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
          {inventoryType === 'RM' && (
            <TextField
              select size="small" fullWidth label="Received At" sx={{ mt: 1.5 }}
              value={rmReceivedAtLocation}
              onChange={(e) => setRmReceivedAtLocation(e.target.value)}
              helperText="Where the Raw Material physically landed — its RM stock posts here."
            >
              {RECEIVED_AT_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </TextField>
          )}
        </Box>

        <TextField label="Remarks" fullWidth multiline minRows={2} value={remarks}
          onChange={(e) => setRemarks(e.target.value)} sx={{ mt: 1.5 }} />
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={isLoading}>Cancel</Button>
        <Button variant="contained" color="success"
          startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <PackageCheck size={16} />}
          onClick={handleComplete} disabled={isLoading}>
          Complete &amp; Post Stock
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default GrnCompleteDialog;
