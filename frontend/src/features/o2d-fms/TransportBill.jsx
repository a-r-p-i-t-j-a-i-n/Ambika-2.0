import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Autocomplete, TextField, Button, MenuItem, Chip, CircularProgress, Divider, alpha, useTheme, Link,
} from '@mui/material';
import { FileSpreadsheet, Save, Upload, Paperclip, X } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import { useSearchParams } from 'react-router-dom';
import O2dStepShell from './components/O2dStepShell';
import { useGetChallansQuery } from '../../store/api/dispatchControlApi';
import { useTransportBillReceiveMutation, useTransportBillPaymentMutation } from '../../store/api/o2dFulfillmentApi';
import { useUploadFileMutation } from '../../store/api/o2dFmsApi';
import { useReturnToTask } from './useReturnToTask';
import { useFmsGate } from './FmsGate';

/** Steps 2.12 (Receive transport bill) + 2.13 (Transport bill payment status). */
const TransportBill = () => {
  const theme = useTheme();
  // 2.12 and 2.13 are separate FMS steps. The opening step passes ?part=receive
  // or ?part=status so we show only that step. No part (menu) shows both.
  const [params] = useSearchParams();
  const part = params.get('part');
  const showReceive = !part || part === 'receive';
  const showStatus = !part || part === 'status';
  const shell = part === 'receive'
    ? { step: 'Step 2.12', title: 'Receive Transportation Bill', subtitle: "Record the transporter's bill and attach the invoice." }
    : part === 'status'
      ? { step: 'Step 2.13', title: 'Transport Bill Payment Status', subtitle: 'Record whether the transporter has been paid.' }
      : { step: 'Steps 2.12 – 2.13', title: 'Transport Bill', subtitle: "Record the transporter's bill and its payment status." };

  const { data: challansRes } = useGetChallansQuery({ limit: 300, sort: '-dcDate' });
  const challans = useMemo(() => challansRes?.data || [], [challansRes]);
  const [receive, { isLoading: savingRcv }] = useTransportBillReceiveMutation();
  const [payStatus, { isLoading: savingPay }] = useTransportBillPaymentMutation();
  const [upload, { isLoading: uploading }] = useUploadFileMutation();
  const { finishToTask } = useReturnToTask();

  const [dc, setDc] = useState(null);
  const gate = useFmsGate({ soNumber: dc?.soNumber, action: part === 'status' ? 'TRANSPORT_BILL_STATUS' : 'TRANSPORT_BILL_RECEIVE' });

  // Auto-select the challan from a "Do it now" / consignment card: exact DC (?dc) first,
  // else the order's latest challan (?so).
  const soParam = params.get('so') || '';
  const dcParam = params.get('dc') || '';
  const presetRef = useRef(false);
  useEffect(() => {
    if (presetRef.current || dc || !challans.length) return;
    const match = (dcParam && challans.find((c) => c.dcNumber === dcParam))
      || (soParam && challans.find((c) => c.soNumber === soParam));
    if (match) { presetRef.current = true; setDc(match); }
  }, [challans, soParam, dcParam, dc]);
  const [rcvStatus, setRcvStatus] = useState('Done');
  const [attachment, setAttachment] = useState(null); // { fileName, url }
  const [payState, setPayState] = useState('Yes');

  const onFile = async (file) => {
    if (!file) return;
    try {
      const res = await upload({ file, folder: 'transport-bills' }).unwrap();
      setAttachment({ fileName: res.data.fileName || file.name, url: res.data.url });
    } catch { enqueueSnackbar('Upload failed.', { variant: 'error' }); }
  };

  const saveReceive = async () => {
    if (!dc) return enqueueSnackbar('Select a challan first.', { variant: 'warning' });
    try {
      await receive({ dcId: dc._id, status: rcvStatus, attachment: attachment?.url }).unwrap();
      enqueueSnackbar('Transport bill receipt saved.', { variant: 'success' });
      setTimeout(() => finishToTask({ soNumber: dc.soNumber, action: 'TRANSPORT_BILL_RECEIVE' }), 600);
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Failed to save.', { variant: 'error' }); }
  };

  const savePayment = async () => {
    if (!dc) return enqueueSnackbar('Select a challan first.', { variant: 'warning' });
    try {
      await payStatus({ dcId: dc._id, status: payState }).unwrap();
      enqueueSnackbar('Transport bill payment status saved.', { variant: 'success' });
      setTimeout(() => finishToTask({ soNumber: dc.soNumber, action: 'TRANSPORT_BILL_STATUS' }), 600);
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Failed to save.', { variant: 'error' }); }
  };

  return (
    <O2dStepShell icon={FileSpreadsheet} step={shell.step} title={shell.title} subtitle={shell.subtitle} gate={gate}>
      <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Autocomplete
          options={challans}
          value={dc}
          onChange={(_, v) => setDc(v)}
          getOptionLabel={(o) => (o ? `${o.dcNumber} — ${o.partyName} (${o.transporterName || 'transporter ?'})` : '')}
          isOptionEqualToValue={(a, b) => a._id === b._id}
          renderInput={(p) => <TextField {...p} label="Delivery Challan" placeholder="Search DC / SO / party…" size="small" />}
        />
        {dc && (
          <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap' }} useFlexGap>
            <Chip size="small" label={`Party: ${dc.partyName || '—'}`} />
            <Chip size="small" label={`Transporter: ${dc.transporterName || '—'}`} />
            <Chip size="small" label={`LR: ${dc.invoiceNo || dc.lrNo || '—'}`} />
          </Stack>
        )}
      </Paper>

      {dc && (
        <Stack spacing={2}>
          {/* 2.12 */}
          {showReceive && (
          <Paper sx={{ p: 2.5, borderRadius: 3, borderLeft: `4px solid ${theme.palette.warning.main}` }}>
            <Typography sx={{ fontWeight: 800, mb: 1.5 }}>2.12 · Receive Transportation Bill</Typography>
            <Stack spacing={2}>
              <TextField select label="Status" value={rcvStatus} onChange={(e) => setRcvStatus(e.target.value)} size="small" sx={{ maxWidth: 220 }}>
                <MenuItem value="Done">Done</MenuItem>
                <MenuItem value="Cancelled">Cancelled</MenuItem>
              </TextField>
              <Box>
                {attachment ? (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1, borderRadius: 1, bgcolor: alpha(theme.palette.success.main, 0.08), maxWidth: 460 }}>
                    <Paperclip size={14} color={theme.palette.success.dark} />
                    <Link href={attachment.url} target="_blank" rel="noopener" sx={{ flex: 1, fontSize: '0.8rem' }} noWrap>{attachment.fileName}</Link>
                    <Button size="small" onClick={() => setAttachment(null)} sx={{ minWidth: 0 }}><X size={14} /></Button>
                  </Stack>
                ) : (
                  <Button component="label" variant="outlined" startIcon={uploading ? <CircularProgress size={14} /> : <Upload size={14} />} disabled={uploading} sx={{ borderStyle: 'dashed' }}>
                    Attach transport invoice
                    <input type="file" hidden accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls" onChange={(e) => onFile(e.target.files?.[0])} />
                  </Button>
                )}
              </Box>
              <Divider />
              <Stack direction="row" justifyContent="flex-end">
                <Button variant="contained" startIcon={savingRcv ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} disabled={savingRcv || gate.blocked} onClick={saveReceive} sx={{ fontWeight: 700 }}>
                  Save Receipt
                </Button>
              </Stack>
            </Stack>
          </Paper>
          )}

          {/* 2.13 */}
          {showStatus && (
          <Paper sx={{ p: 2.5, borderRadius: 3, borderLeft: `4px solid ${theme.palette.success.main}` }}>
            <Typography sx={{ fontWeight: 800, mb: 1.5 }}>2.13 · Transport Bill Payment Status</Typography>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField select label="Status" value={payState} onChange={(e) => setPayState(e.target.value)} size="small" sx={{ minWidth: 200 }} helperText="“Yes” = transporter paid.">
                {['Yes', 'No', 'Cancelled'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </TextField>
              <Button variant="contained" startIcon={savingPay ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} disabled={savingPay || gate.blocked} onClick={savePayment} sx={{ fontWeight: 700 }}>
                Save Payment Status
              </Button>
            </Stack>
          </Paper>
          )}
        </Stack>
      )}
    </O2dStepShell>
  );
};

export default TransportBill;
