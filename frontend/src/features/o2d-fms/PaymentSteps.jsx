import React, { useMemo, useState } from 'react';
import {
  Paper, Stack, Typography, Autocomplete, TextField, Button, MenuItem, Chip, CircularProgress, Divider, alpha, useTheme,
} from '@mui/material';
import { IndianRupee, Save, PhoneCall, BadgeCheck } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import O2dStepShell from './components/O2dStepShell';
import { useGetSalesInvoicesQuery } from '../../store/api/salesInvoiceApi';
import { usePaymentFollowUpMutation, usePaymentReceiptMutation } from '../../store/api/o2dFulfillmentApi';
import { useReturnToTask } from './useReturnToTask';

const YNC = ['Yes', 'No', 'Cancelled'];

/** Steps 2.10 (Follow up for payment) + 2.11 (Receive payment & Tally entry). */
const PaymentSteps = () => {
  const theme = useTheme();
  const { data: invRes } = useGetSalesInvoicesQuery({ limit: 300, sort: '-invoiceDate' });
  const invoices = useMemo(() => invRes?.data || [], [invRes]);
  const [followUp, { isLoading: savingFU }] = usePaymentFollowUpMutation();
  const [receipt, { isLoading: savingRC }] = usePaymentReceiptMutation();
  const { active: fromTask, returnToTask } = useReturnToTask();

  const [inv, setInv] = useState(null);
  const [fuStatus, setFuStatus] = useState('Yes');
  const [rcStatus, setRcStatus] = useState('Yes');
  const [rcDate, setRcDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [rcAmount, setRcAmount] = useState('');

  const saveFollowUp = async () => {
    if (!inv) return enqueueSnackbar('Select an invoice first.', { variant: 'warning' });
    try {
      await followUp({ invoiceId: inv._id, dcId: inv.dcId, status: fuStatus }).unwrap();
      enqueueSnackbar('Payment follow-up saved.', { variant: 'success' });
      if (fromTask) setTimeout(returnToTask, 600);
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Failed to save.', { variant: 'error' }); }
  };

  const saveReceipt = async () => {
    if (!inv) return enqueueSnackbar('Select an invoice first.', { variant: 'warning' });
    try {
      await receipt({ invoiceId: inv._id, dcId: inv.dcId, status: rcStatus, receivedDate: rcDate, receivedAmount: Number(rcAmount) || 0 }).unwrap();
      enqueueSnackbar('Payment receipt saved.', { variant: 'success' });
      if (fromTask) setTimeout(returnToTask, 600);
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Failed to save.', { variant: 'error' }); }
  };

  return (
    <O2dStepShell icon={IndianRupee} step="Steps 2.10 – 2.11" title="Payment Follow-up & Receipt" subtitle="Chase the payment, then record what was received.">
      <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Autocomplete
          options={invoices}
          value={inv}
          onChange={(_, v) => setInv(v)}
          getOptionLabel={(o) => (o ? `${o.invoiceNo} — ${o.partyName}` : '')}
          isOptionEqualToValue={(a, b) => a._id === b._id}
          renderInput={(p) => <TextField {...p} label="Select Invoice (Unique ID / Invoice No)" placeholder="Search invoice / party…" size="small" />}
        />
        {inv && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap' }} useFlexGap>
            <Chip size="small" label={`Party: ${inv.partyName || '—'}`} />
            <Chip size="small" label={`Amount: ₹${(inv.invoiceAmount || 0).toLocaleString('en-IN')}`} />
            <Chip size="small" label={`Received: ₹${(inv.amountReceived || 0).toLocaleString('en-IN')}`} />
            <Chip size="small" color={inv.balance > 0 ? 'warning' : 'success'} label={`Balance: ₹${(inv.balance || 0).toLocaleString('en-IN')}`} />
          </Stack>
        )}
      </Paper>

      {inv && (
        <Stack spacing={2}>
          {/* 2.10 */}
          <Paper sx={{ p: 2.5, borderRadius: 3, borderLeft: `4px solid ${theme.palette.info.main}` }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <PhoneCall size={18} color={theme.palette.info.main} />
              <Typography sx={{ fontWeight: 800 }}>2.10 · Follow up for Payment</Typography>
            </Stack>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField select label="Status" value={fuStatus} onChange={(e) => setFuStatus(e.target.value)} size="small" sx={{ minWidth: 200 }} helperText="“Yes” means payment received / done.">
                {YNC.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </TextField>
              <Button variant="contained" startIcon={savingFU ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} disabled={savingFU} onClick={saveFollowUp} sx={{ fontWeight: 700 }}>
                Save Follow-up
              </Button>
            </Stack>
          </Paper>

          {/* 2.11 */}
          <Paper sx={{ p: 2.5, borderRadius: 3, borderLeft: `4px solid ${theme.palette.success.main}` }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <BadgeCheck size={18} color={theme.palette.success.main} />
              <Typography sx={{ fontWeight: 800 }}>2.11 · Receive Payment & Tally Entry</Typography>
            </Stack>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField select label="Status" value={rcStatus} onChange={(e) => setRcStatus(e.target.value)} size="small" sx={{ minWidth: 160 }}>
                  {YNC.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </TextField>
                <TextField label="Invoice Number" value={inv.invoiceNo} size="small" fullWidth disabled />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Received Amount Date" type="date" value={rcDate} onChange={(e) => setRcDate(e.target.value)} size="small" InputLabelProps={{ shrink: true }} sx={{ minWidth: 200 }} />
                <TextField label="Received Amount (₹)" type="number" value={rcAmount} onChange={(e) => setRcAmount(e.target.value)} size="small" fullWidth />
              </Stack>
              <Divider />
              <Stack direction="row" justifyContent="flex-end">
                <Button variant="contained" startIcon={savingRC ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} disabled={savingRC} onClick={saveReceipt} sx={{ fontWeight: 700, px: 3 }}>
                  {savingRC ? 'Saving…' : 'Save Receipt'}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </Stack>
      )}
    </O2dStepShell>
  );
};

export default PaymentSteps;
