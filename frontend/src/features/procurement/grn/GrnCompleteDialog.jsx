import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Typography, CircularProgress, Alert, FormControlLabel, Checkbox, MenuItem,
} from '@mui/material';
import { PackageCheck } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useCompleteGrnMutation } from '../../../store/api/procurementApi';
import { useGetSkuLookupQuery } from '../../../store/api/skuApi';
import { fmtINR } from './grnMeta';
import { PFMS } from '../pfmsTheme';
// The SAME two values the RM Stock In screen uses, so "Received At" has one
// definition across both modules.
import { RECEIVED_AT_OPTIONS } from '../../rm-ims/receivedAt';
import { destinationOf, DESTINATION_META } from './inventoryDestination';

/**
 * Complete a GRN: finalises the receipt and updates the PO/PI received
 * quantities. Irreversible. It does NOT put anything into usable stock: each
 * line waits as "Awaiting QC" and its accepted qty is posted — to the inventory
 * module its SKU master Item Type decides — once the MD has signed the GRN and
 * Incoming QC is completed.
 *
 * Received At is asked for only when the GRN carries Raw Material, and has to
 * be chosen (it is never pre-filled); the server enforces the same.
 */
const GrnCompleteDialog = ({ open, onClose, grn }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [allowOverReceipt, setAllowOverReceipt] = useState(false);
  const [rmReceivedAtLocation, setRmReceivedAtLocation] = useState('');
  const [remarks, setRemarks] = useState('');
  const [completeGrn, { isLoading }] = useCompleteGrnMutation();

  useEffect(() => {
    if (!open) return;
    setAllowOverReceipt(false);
    setRmReceivedAtLocation(grn?.rmReceivedAtLocation || '');
    setRemarks('');
  }, [open, grn]);

  // Where each received line will go — from the SKU master (display only).
  const received = useMemo(() => (grn?.items || []).filter((l) => Number(l.receivedQty) > 0), [grn]);
  const ids = [...new Set(received.map((l) => String(l.skuId || '')).filter(Boolean))].sort().join(',');
  const { data: skusRes } = useGetSkuLookupQuery({ ids, limit: 2000 }, { skip: !open || !ids });
  const typeBySku = useMemo(() => new Map((skusRes?.data || []).map((s) => [String(s._id), s.itemType])), [skusRes]);
  const destOf = (l) => l.inventoryDestination || destinationOf(typeBySku.get(String(l.skuId || '')));
  const counts = received.reduce((acc, l) => { const d = destOf(l); if (d) acc[d] = (acc[d] || 0) + 1; return acc; }, {});
  const hasRm = Boolean(counts.RM_IMS);

  // Lines received beyond the pending qty (figures are server-derived; the
  // server re-validates against the PO's current state on completion).
  const extraLines = (grn?.items || []).filter((l) => Number(l.extraQty) > 0);

  const handleComplete = async () => {
    if (hasRm && !rmReceivedAtLocation) {
      enqueueSnackbar('Select Received At — this GRN has Raw Material lines', { variant: 'warning' });
      return;
    }
    try {
      const res = await completeGrn({
        id: grn._id,
        allowOverReceipt,
        ...(hasRm ? { rmReceivedAtLocation } : {}),
        remarks: remarks.trim(),
      }).unwrap();
      // What the SERVER says actually happened, never what the form hoped for.
      const n = res?.data?.rmSummary?.awaitingQcLineCount ?? received.length;
      enqueueSnackbar(`GRN completed — ${n} line(s) awaiting QC. Stock posts when the QC is completed.`, { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to complete GRN — nothing was changed', { variant: 'error' });
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
            {grn?.isWithoutPo ? 'Without PO' : `PO ${grn?.poNumber || '—'}`} · {grn?.items?.length || 0} item(s) · qty {grn?.totalReceivedQty} · {fmtINR(grn?.totalValue)}
          </Typography>
          {Object.keys(counts).length > 0 && (
            <Typography variant="caption" data-testid="grn-complete-destinations" sx={{ display: 'block', mt: 0.5, fontWeight: 700 }}>
              {Object.entries(counts).map(([d, n]) => `${DESTINATION_META[d]?.label || d}: ${n}`).join(' · ')}
            </Typography>
          )}
        </Box>
        <Alert severity="info" sx={{ mb: 2 }}>
          This finalises the receipt and updates the PO. Stock is <b>not</b> usable yet: accepted quantities are
          posted when Incoming QC is completed. It cannot be undone.
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

        {hasRm && (
          <TextField
            select size="small" fullWidth required label="Received At" sx={{ mt: 1.5 }}
            value={rmReceivedAtLocation}
            onChange={(e) => setRmReceivedAtLocation(e.target.value)}
            error={!rmReceivedAtLocation}
            helperText="Where the Raw Material physically landed — its RM stock posts here after QC."
          >
            {RECEIVED_AT_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </TextField>
        )}

        <TextField label="Remarks" fullWidth multiline minRows={2} value={remarks}
          onChange={(e) => setRemarks(e.target.value)} sx={{ mt: 1.5 }} />
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={isLoading}>Cancel</Button>
        <Button variant="contained" color="success"
          startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <PackageCheck size={16} />}
          onClick={handleComplete} disabled={isLoading}>
          Complete GRN
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default GrnCompleteDialog;
