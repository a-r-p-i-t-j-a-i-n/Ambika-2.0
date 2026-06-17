import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, Box, Typography, CircularProgress, Divider,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useApproveIndentMutation,
  useRejectIndentMutation,
} from '../../../store/api/procurementApi';

/**
 * Approve / reject an indent. Revised + Approved quantities are captured
 * per item; remarks apply to the whole indent.
 */
// Map an indent (new items[] or legacy single-product) → approval rows.
const rowsFromIndent = (indent) => {
  if (indent?.items?.length) {
    return indent.items.map((it) => ({
      _id: it._id,
      itemName: it.itemName, skuCode: it.skuCode || '', unit: it.unit || 'Pcs', quantity: it.quantity || 0,
      revisedQuantity: it.revisedQuantity || it.quantity || '',
      approvedQuantity: it.approvedQuantity || it.quantity || '',
    }));
  }
  return [{
    itemName: indent?.productNameRevised || '—', skuCode: indent?.skuCode || '', unit: indent?.unit || 'Pcs', quantity: indent?.quantity || 0,
    revisedQuantity: indent?.revisedQuantity || indent?.quantity || '',
    approvedQuantity: indent?.approvedQuantity || indent?.quantity || '',
  }];
};

const COLS = '2fr 0.9fr 1fr 1fr';

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

  const handleApprove = async () => {
    const invalid = rows.find((r) => r.approvedQuantity === '' || Number(r.approvedQuantity) < 0);
    if (invalid) { enqueueSnackbar('Enter an approved quantity for every item', { variant: 'warning' }); return; }
    try {
      await approve({
        id: indent._id,
        items: rows.map((r) => ({
          _id: r._id,
          itemName: r.itemName,
          skuCode: r.skuCode,
          revisedQuantity: r.revisedQuantity === '' ? 0 : Number(r.revisedQuantity),
          approvedQuantity: Number(r.approvedQuantity),
        })),
        remarks: remarks.trim(),
      }).unwrap();
      enqueueSnackbar('Indent approved', { variant: 'success' });
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
        </Box>

        {/* Column heads (desktop) */}
        <Box sx={{ display: { xs: 'none', sm: 'grid' }, gridTemplateColumns: COLS, gap: 1.5, px: 1, mb: 0.5 }}>
          {['Product', 'Requested', 'Revised Qty', 'Approved Qty *'].map((h, i) => (
            <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.62rem', textAlign: i === 0 ? 'left' : 'right' }}>{h}</Typography>
          ))}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {rows.map((r, idx) => (
            <Box key={r._id || idx} sx={{
              display: 'grid', gridTemplateColumns: { xs: '1fr', sm: COLS }, gap: 1.5, alignItems: 'center',
              p: { xs: 1.5, sm: 0.75 }, px: { sm: 1 }, borderRadius: '10px',
              border: { xs: '1px solid', sm: 'none' }, borderColor: 'divider',
              '&:hover': { bgcolor: { sm: alpha('#2563eb', 0.03) } },
            }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} noWrap>{r.itemName}</Typography>
                {r.skuCode ? <Typography variant="caption" color="primary.main" fontWeight={700}>{r.skuCode}</Typography> : null}
              </Box>
              <Typography variant="body2" sx={{ textAlign: { sm: 'right' }, color: 'text.secondary' }}>{r.quantity} {r.unit}</Typography>
              <TextField size="small" type="number" value={r.revisedQuantity}
                onChange={(e) => setRow(idx, { revisedQuantity: e.target.value })} inputProps={{ min: 0, style: { textAlign: 'right' } }} />
              <TextField size="small" type="number" value={r.approvedQuantity} error={r.approvedQuantity === ''}
                onChange={(e) => setRow(idx, { approvedQuantity: e.target.value })} inputProps={{ min: 0, style: { textAlign: 'right' } }} />
            </Box>
          ))}
        </Box>

        <Divider sx={{ my: 2 }} />
        <TextField label="Remarks" fullWidth multiline minRows={2} value={remarks}
          onChange={(e) => setRemarks(e.target.value)} placeholder="Optional note for the requester" />
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={busy}>Cancel</Button>
        <Button color="error" variant="outlined" startIcon={<XCircle size={16} />} onClick={handleReject} disabled={busy}>
          Reject
        </Button>
        <Button color="success" variant="contained" startIcon={approving ? <CircularProgress size={16} color="inherit" /> : <CheckCircle2 size={16} />}
          onClick={handleApprove} disabled={busy}>
          Approve
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default IndentApprovalDialog;
