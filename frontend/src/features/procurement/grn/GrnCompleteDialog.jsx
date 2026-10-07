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

/**
 * Complete a GRN: posts received quantities to stock (via inventoryService)
 * and updates the PO/PI received quantities. This action is irreversible.
 *
 * Raw Material lines are posted only when "Add to RM Stock" is ticked. Every
 * other item type posts regardless — the opt-in gates RM and nothing else.
 */
const GrnCompleteDialog = ({ open, onClose, grn }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [allowOverReceipt, setAllowOverReceipt] = useState(false);
  // Opt-in, and deliberately off by default: adding to RM stock is a decision
  // the operator makes, never one the dialog makes for them.
  const [addToRmStock, setAddToRmStock] = useState(false);
  const [rmReceivedAtLocation, setRmReceivedAtLocation] = useState(DEFAULT_RECEIVED_AT);
  const [remarks, setRemarks] = useState('');
  const [completeGrn, { isLoading }] = useCompleteGrnMutation();

  // Seed from the GRN, not from a fixed default: both can now be chosen when
  // the GRN is raised, and this dialog confirms that choice rather than asking
  // again from scratch. A GRN saved before those fields existed simply falls
  // back to off / PLG01.
  useEffect(() => {
    if (!open) return;
    setAllowOverReceipt(false);
    setAddToRmStock(!!grn?.addToRmStock);
    setRmReceivedAtLocation(grn?.rmReceivedAtLocation || DEFAULT_RECEIVED_AT);
    setRemarks('');
  }, [open, grn]);

  const handleComplete = async () => {
    try {
      const res = await completeGrn({
        id: grn._id,
        allowOverReceipt,
        addToRmStock,
        // Always sent. Only the POSTING depends on the checkbox — the location
        // itself is recorded on the GRN either way, so omitting it here would
        // throw away a choice the operator made.
        rmReceivedAtLocation,
        remarks: remarks.trim(),
      }).unwrap();

      // What the SERVER says actually happened, never what the form hoped for.
      // A GRN with no Raw Material line on it must not report that RM stock was
      // updated just because the box was ticked.
      const posted = res?.data?.rmSummary?.rmPostedCount || 0;
      const where = res?.data?.rmSummary?.rmReceivedAtLocation;
      enqueueSnackbar(
        posted
          ? `GRN saved and RM stock updated successfully — ${posted} item(s) at ${where}.`
          : 'GRN saved successfully.',
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

        <FormControlLabel
          control={<Checkbox checked={allowOverReceipt} onChange={(e) => setAllowOverReceipt(e.target.checked)} />}
          label="Allow over-receipt (received qty may exceed pending PO qty)"
        />

        {/* ── Raw Material opt-in ───────────────────────────────────────────
            Off unless the operator ticks it. Untick and the Raw Material lines
            are still received against the PO — they simply do not move stock. */}
        <Box sx={{ mt: 1, p: 1.25, borderRadius: '10px', border: `1px solid ${PFMS.border || '#e4e1d9'}` }}>
          <FormControlLabel
            control={<Checkbox checked={addToRmStock} onChange={(e) => setAddToRmStock(e.target.checked)} />}
            label={<Typography sx={{ fontWeight: 700, fontSize: '0.88rem' }}>Add to RM Stock</Typography>}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 4, mt: -0.5 }}>
            When checked, the received Raw Material quantity will automatically be added to RM stock.
            Other item types are added either way.
          </Typography>

          {/* Always shown, like the GRN form: where the goods landed is a fact
              about the receipt, not a consequence of the opt-in. It is carried
              on the GRN either way; only the posting depends on the checkbox. */}
          <TextField
            select size="small" fullWidth label="Received At" sx={{ mt: 1.5 }}
            value={rmReceivedAtLocation}
            onChange={(e) => setRmReceivedAtLocation(e.target.value)}
            helperText="Where the material physically landed. Same list the RM Stock In screen uses."
          >
            {RECEIVED_AT_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </TextField>
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
