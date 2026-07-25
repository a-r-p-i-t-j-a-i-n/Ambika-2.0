import React, { useEffect, useState } from 'react';
import {
  Box, Stack, Typography, Button, TextField, MenuItem,
  Chip, CircularProgress, alpha,
} from '@mui/material';
import { IndianRupee, Check, X, Clock } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useSetConsignmentPaymentMutation } from '../../../store/api/o2dFmsApi';
import { O2D } from '../o2dTheme';

const inr = (n) => `₹ ${Number(n || 0).toLocaleString('en-IN')}`;

const OUTCOME = {
  RECEIVED:     { label: 'Received',     color: '#15803d', Icon: Check },
  NOT_RECEIVED: { label: 'Not received', color: '#b45309', Icon: X },
  PENDING:      { label: 'Not set',      color: O2D.faint, Icon: Clock },
};

/**
 * Step 2.11 — record THIS challan's payment status right on the task. The doer can
 * immediately mark "Not received" (so the flow isn't stuck waiting for the money),
 * then come back later and flip it to "Received" + the amount. Saved to the challan's
 * payment record (master data) and always editable.
 */
const PaymentStatusCard = ({ processId, consignment, canAct }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [save, { isLoading }] = useSetConsignmentPaymentMutation();
  const pay = consignment?.payment || {};
  const current = pay.outcome || 'PENDING';

  const [outcome, setOutcome] = useState(current);
  const [amount, setAmount] = useState(pay.received || '');
  const [note, setNote] = useState(pay.note || '');

  // Re-seed from the record whenever the challan (or its saved status) changes.
  useEffect(() => {
    setOutcome(pay.outcome || 'PENDING');
    setAmount(pay.received || '');
    setNote(pay.note || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consignment?.dcId, pay.outcome, pay.received, pay.note]);

  const dirty = outcome !== current
    || (outcome === 'RECEIVED' && Number(amount || 0) !== Number(pay.received || 0))
    || (note || '') !== (pay.note || '');

  const submit = async () => {
    if (outcome === 'PENDING') return enqueueSnackbar('Pick Received or Not received.', { variant: 'warning' });
    if (outcome === 'RECEIVED' && !(Number(amount) > 0)) return enqueueSnackbar('Enter the amount received.', { variant: 'warning' });
    try {
      await save({
        id: processId,
        dcId: consignment.dcId,
        dcNumber: consignment.dcNumber,
        outcome,
        receivedAmount: outcome === 'RECEIVED' ? Number(amount) : 0,
        note: note.trim(),
      }).unwrap();
      enqueueSnackbar(outcome === 'RECEIVED' ? `Payment recorded — ${inr(amount)}.` : 'Marked as not received.', { variant: 'success' });
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not save the payment status.', { variant: 'error' });
    }
  };

  const cur = OUTCOME[current] || OUTCOME.PENDING;
  const CurIcon = cur.Icon;

  return (
    <Box sx={{ border: `1px solid ${alpha('#15803d', 0.3)}`, borderRadius: '8px', p: 1.25, bgcolor: alpha('#15803d', 0.03) }}>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1 }}>
        <IndianRupee size={15} color="#15803d" />
        <Typography sx={{ fontWeight: 800, fontSize: '0.8rem', color: '#0f5132' }}>Payment status — this challan</Typography>
        <Box sx={{ flex: 1 }} />
        <Chip size="small" icon={<CurIcon size={12} />} label={current === 'RECEIVED' ? `Received · ${inr(pay.received)}` : cur.label}
          sx={{ height: 20, fontSize: '0.64rem', fontWeight: 800, borderRadius: '4px', bgcolor: alpha(cur.color, 0.12), color: cur.color, '& .MuiChip-icon': { color: cur.color } }} />
      </Stack>

      {!canAct ? (
        <Typography variant="caption" color="text.secondary">
          {current === 'PENDING' ? 'No payment status recorded yet.' : `Recorded as ${cur.label.toLowerCase()}${current === 'RECEIVED' ? ` (${inr(pay.received)})` : ''}${pay.note ? ` — ${pay.note}` : ''}.`}
        </Typography>
      ) : (
        <Stack spacing={1}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
            <TextField
              select size="small" label="Payment status" value={outcome}
              onChange={(e) => setOutcome(e.target.value)} sx={{ minWidth: 180 }}
            >
              <MenuItem value="PENDING" disabled>Select…</MenuItem>
              <MenuItem value="RECEIVED">Received</MenuItem>
              <MenuItem value="NOT_RECEIVED">Not received</MenuItem>
            </TextField>
            {outcome === 'RECEIVED' && (
              <TextField size="small" type="number" label="Amount received" value={amount}
                onChange={(e) => setAmount(e.target.value)} InputProps={{ startAdornment: <Typography sx={{ mr: 0.5, color: 'text.disabled' }}>₹</Typography> }}
                sx={{ width: 200 }} />
            )}
          </Stack>
          <TextField size="small" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={outcome === 'NOT_RECEIVED' ? 'e.g. cheque due next week' : 'e.g. NEFT ref 1234'} fullWidth />

          <Stack direction="row" spacing={1} alignItems="center">
            <Button size="small" variant="contained" disableElevation onClick={submit}
              disabled={isLoading || !dirty || outcome === 'PENDING'}
              startIcon={isLoading ? <CircularProgress size={13} color="inherit" /> : <Check size={14} />}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: '#15803d', '&:hover': { bgcolor: '#116234' } }}>
              {current === 'PENDING' ? 'Save status' : 'Update status'}
            </Button>
            <Typography variant="caption" color="text.secondary">
              {outcome === 'NOT_RECEIVED' ? 'Recorded now — revisit later to mark received.' : 'Saved to the payment record (master data).'}
            </Typography>
          </Stack>
        </Stack>
      )}
    </Box>
  );
};

export default PaymentStatusCard;
