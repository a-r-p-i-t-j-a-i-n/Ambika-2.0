import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Box, Typography, CircularProgress, Divider, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useApproveIndentMutation,
  useRejectIndentMutation,
} from '../../../store/api/procurementApi';

/**
 * Approve / reject an indent, item by item. Each row gets an Approved/Rejected
 * decision (defaults to Approved); Revised Qty is the only editable quantity
 * for approved rows — Approved Qty always mirrors it (read-only, shown for
 * transparency). Rejected rows require a reason and carry no quantity. The
 * indent header is approved (→ Quote Pending) if at least one item is
 * approved, or rejected (→ Closed) if every item ends up rejected.
 */
// Map an indent (new items[] or legacy single-product) → approval rows.
const rowsFromIndent = (indent) => {
  if (indent?.items?.length) {
    return indent.items.map((it) => ({
      _id: it._id,
      itemName: it.itemName, skuCode: it.skuCode || '', unit: it.unit || 'Pcs', quantity: it.quantity || 0,
      revisedQuantity: it.revisedQuantity || it.quantity || '',
      approvalStatus: 'APPROVED',
      rejectionReason: '',
    }));
  }
  return [{
    itemName: indent?.productNameRevised || '—', skuCode: indent?.skuCode || '', unit: indent?.unit || 'Pcs', quantity: indent?.quantity || 0,
    revisedQuantity: indent?.revisedQuantity || indent?.quantity || '',
    approvalStatus: 'APPROVED',
    rejectionReason: '',
  }];
};

// Approved Qty auto-syncs from Revised Qty; falls back to the requested
// quantity when Revised Qty is left blank.
const approvedQtyOf = (row) => (row.revisedQuantity === '' ? Number(row.quantity) || 0 : Number(row.revisedQuantity) || 0);

const COLS = '1.7fr 0.8fr 1.1fr 0.9fr 0.9fr';

const IndentApprovalDialog = ({ open, onClose, indent }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [rows, setRows] = useState([]);
  const [remarks, setRemarks] = useState('');

  const [approve, { isLoading: approving }] = useApproveIndentMutation();
  const [reject, { isLoading: rejecting }] = useRejectIndentMutation();
  const busy = approving || rejecting;

  useEffect(() => {
    if (open && indent) {
      setRows(rowsFromIndent(indent));
      setRemarks('');
    }
  }, [open, indent]);

  const setRow = (idx, patch) => setRows((cur) => cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const approvedCount = rows.filter((r) => r.approvalStatus !== 'REJECTED').length;
  const rejectedCount = rows.length - approvedCount;

  const handleApprove = async () => {
    // Approved rows: Revised Qty must be > 0 (it may be lower than, equal to,
    // or greater than the requested quantity). Rejected rows: a reason is required instead.
    const invalidApproved = rows.find((r) => r.approvalStatus !== 'REJECTED' && (() => {
      const approvedQty = approvedQtyOf(r);
      return !(approvedQty > 0);
    })());
    if (invalidApproved) {
      enqueueSnackbar(
        `Revised qty for "${invalidApproved.itemName}" must be greater than 0`,
        { variant: 'warning' },
      );
      return;
    }
    const missingReason = rows.find((r) => r.approvalStatus === 'REJECTED' && !r.rejectionReason.trim());
    if (missingReason) {
      enqueueSnackbar(`Rejection reason is required for "${missingReason.itemName}"`, { variant: 'warning' });
      return;
    }
    try {
      await approve({
        id: indent._id,
        items: rows.map((r) => ({
          _id: r._id,
          itemName: r.itemName,
          skuCode: r.skuCode,
          approvalStatus: r.approvalStatus,
          ...(r.approvalStatus === 'REJECTED'
            ? { rejectionReason: r.rejectionReason.trim(), revisedQuantity: 0, approvedQuantity: 0 }
            : {
              revisedQuantity: approvedQtyOf(r),
              // Mirrors Revised Qty — the backend re-derives this itself either way.
              approvedQuantity: approvedQtyOf(r),
            }),
        })),
        remarks: remarks.trim(),
      }).unwrap();
      enqueueSnackbar(
        rejectedCount > 0 ? `${approvedCount} approved, ${rejectedCount} rejected` : 'Indent approved',
        { variant: 'success' },
      );
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to approve', { variant: 'error' });
    }
  };

  const handleReject = async () => {
    try {
      await reject({ id: indent._id, remarks: remarks.trim() }).unwrap();
      enqueueSnackbar('Indent rejected', { variant: 'info' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to reject', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        Approve Indent
        {indent?.indentNumber && (
          <Typography component="span" sx={{ ml: 1, color: 'text.secondary', fontWeight: 600, fontSize: '0.85rem' }}>
            {indent.indentNumber}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            {indent?.department || '—'} · raised by {indent?.raisedBy || '—'} · {rows.length} item(s)
          </Typography>
          {rows.length > 1 && (
            <Typography variant="caption" sx={{ fontWeight: 700, color: rejectedCount ? 'warning.main' : 'success.main' }}>
              {approvedCount} approved{rejectedCount ? `, ${rejectedCount} rejected` : ''}
            </Typography>
          )}
        </Box>

        {/* Column heads (desktop) */}
        <Box sx={{ display: { xs: 'none', sm: 'grid' }, gridTemplateColumns: COLS, gap: 1.5, px: 1, mb: 0.5 }}>
          {['Product', 'Requested', 'Decision', 'Revised Qty', 'Approved Qty (auto)'].map((h, i) => (
            <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.62rem', textAlign: i === 0 ? 'left' : (i === 2 ? 'center' : 'right') }}>{h}</Typography>
          ))}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {rows.map((r, idx) => {
            const isRejected = r.approvalStatus === 'REJECTED';
            return (
              <Box key={r._id || idx} sx={{
                p: { xs: 1.5, sm: 0.75 }, px: { sm: 1 }, borderRadius: '10px',
                border: '1px solid', borderColor: isRejected ? alpha('#dc2626', 0.3) : 'divider',
                bgcolor: isRejected ? alpha('#dc2626', 0.03) : 'transparent',
              }}>
                <Box sx={{
                  display: 'grid', gridTemplateColumns: { xs: '1fr', sm: COLS }, gap: 1.5, alignItems: 'center',
                }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>{r.itemName}</Typography>
                    {r.skuCode ? <Typography variant="caption" color="primary.main" fontWeight={700}>{r.skuCode}</Typography> : null}
                  </Box>
                  <Typography variant="body2" sx={{ textAlign: { sm: 'right' }, color: 'text.secondary' }}>{r.quantity} {r.unit}</Typography>
                  <Box sx={{ display: 'flex', justifyContent: { sm: 'center' } }}>
                    <ToggleButtonGroup size="small" exclusive value={r.approvalStatus}
                      onChange={(e, val) => val && setRow(idx, { approvalStatus: val })}>
                      <ToggleButton value="APPROVED" color="success" sx={{ py: 0.25, px: 1, textTransform: 'none', fontSize: '0.72rem' }}>Approve</ToggleButton>
                      <ToggleButton value="REJECTED" color="error" sx={{ py: 0.25, px: 1, textTransform: 'none', fontSize: '0.72rem' }}>Reject</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>
                  <TextField size="small" type="number" value={r.revisedQuantity} disabled={isRejected}
                    onChange={(e) => setRow(idx, { revisedQuantity: e.target.value })} inputProps={{ min: 0, style: { textAlign: 'right' } }} />
                  {/* Read-only — always mirrors Revised Qty, shown for transparency. */}
                  <TextField size="small" type="number" value={isRejected ? 0 : approvedQtyOf(r)} disabled
                    inputProps={{ style: { textAlign: 'right' } }} />
                </Box>
                {isRejected && (
                  <TextField size="small" fullWidth required sx={{ mt: 1 }} placeholder="Rejection reason…"
                    value={r.rejectionReason} onChange={(e) => setRow(idx, { rejectionReason: e.target.value })}
                    error={!r.rejectionReason.trim()} />
                )}
              </Box>
            );
          })}
        </Box>

        <Divider sx={{ my: 2 }} />
        <TextField label="Remarks" fullWidth multiline minRows={2} value={remarks}
          onChange={(e) => setRemarks(e.target.value)} placeholder="Optional note for the requester" />
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={busy}>Cancel</Button>
        <Button color="error" variant="outlined" startIcon={<XCircle size={16} />} onClick={handleReject} disabled={busy}>
          Reject All
        </Button>
        <Button color="success" variant="contained" startIcon={approving ? <CircularProgress size={16} color="inherit" /> : <CheckCircle2 size={16} />}
          onClick={handleApprove} disabled={busy}>
          Submit Decision{rows.length > 1 ? 's' : ''}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default IndentApprovalDialog;
