import React, { useMemo, useState, useEffect } from 'react';
import {
  Paper, Stack, Typography, Autocomplete, TextField, Button, Chip, alpha, useTheme,
  CircularProgress, Divider, Link, Box,
} from '@mui/material';
import { Mail, Send, Paperclip, FileText, ShieldCheck, ClipboardList, CheckCircle2 } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import O2dStepShell from './components/O2dStepShell';
import { useGetSalesInvoicesQuery, useSendSalesInvoiceMutation } from '../../store/api/salesInvoiceApi';
import { useReturnToTask } from './useReturnToTask';

const inr = (n) => '₹ ' + (Number(n || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtD = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');

// One read-only detail field.
const Detail = ({ label, value }) => (
  <Box sx={{ minWidth: 150 }}>
    <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.6rem' }}>{label}</Typography>
    <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>{value || '—'}</Typography>
  </Box>
);

// A group of attachment links (Invoice / Eway / PDIR).
const AttachGroup = ({ icon: Icon, label, urls = [], theme }) => (
  <Box>
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
      <Icon size={14} color={theme.palette.primary.main} />
      <Typography variant="caption" sx={{ fontWeight: 800 }}>{label}</Typography>
      <Chip size="small" label={urls.length} sx={{ height: 16, fontSize: '0.6rem' }} />
    </Stack>
    {urls.length === 0 ? (
      <Typography variant="caption" color="text.disabled">None attached</Typography>
    ) : (
      <Stack spacing={0.25}>
        {urls.map((u, i) => (
          <Stack key={i} direction="row" spacing={0.75} alignItems="center">
            <Paperclip size={12} color={theme.palette.text.disabled} />
            <Link href={u} target="_blank" rel="noopener" sx={{ fontSize: '0.76rem' }} noWrap>{label} {i + 1}</Link>
          </Stack>
        ))}
      </Stack>
    )}
  </Box>
);

/** Step 2.8 — Email Invoice & Eway Bill: pick invoice → full preview → send. */
const InvoiceEmail = () => {
  const theme = useTheme();
  const { data: invRes } = useGetSalesInvoicesQuery({ limit: 300, sort: '-invoiceDate' });
  const invoices = useMemo(() => invRes?.data || [], [invRes]);
  const [send, { isLoading }] = useSendSalesInvoiceMutation();
  const { finishToTask } = useReturnToTask();

  const [inv, setInv] = useState(null);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sentInfo, setSentInfo] = useState(null); // { to, at } after a successful send this session

  const allAttachments = useMemo(
    () => [...(inv?.invoiceUrls || []), ...(inv?.ewayBillUrls || []), ...(inv?.pdirUrls || [])].filter(Boolean),
    [inv],
  );

  useEffect(() => {
    if (!inv) return;
    setSentInfo(null);
    setTo(inv.partyId?.email || '');
    setSubject(`Invoice ${inv.invoiceNo} — ${inv.partyName || ''}`);
    setMessage(
      `Dear ${inv.partyName || 'Customer'},\n\n`
      + `Please find attached your tax invoice ${inv.invoiceNo}`
      + (inv.invoiceDate ? ` dated ${dayjs(inv.invoiceDate).format('DD MMM YYYY')}` : '')
      + ` for ${inr(inv.invoiceAmount)}, along with the e-way bill and supporting documents.\n\n`
      + `Regards,\nAmbika Global`,
    );
  }, [inv]);

  const handleSend = async () => {
    if (!inv) return enqueueSnackbar('Select an invoice first.', { variant: 'warning' });
    if (!to.trim()) return enqueueSnackbar('Recipient email is required.', { variant: 'warning' });
    try {
      const res = await send({ id: inv._id, to: to.trim(), subject, message: message.replace(/\n/g, '<br/>') }).unwrap();
      const st = res.data?.emailStatus;
      if (st === 'SENT') {
        setSentInfo({ to: res.data.recipient || to.trim(), at: new Date() });
        enqueueSnackbar(`Email sent to ${res.data.recipient}.`, { variant: 'success' });
      } else {
        enqueueSnackbar(`Email could not be sent (${st}). Check SMTP settings.`, { variant: 'warning' });
      }
      setTimeout(() => finishToTask({ soNumber: inv.soNumber }), 800);
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Failed to send.', { variant: 'error' });
    }
  };

  return (
    <O2dStepShell icon={Mail} step="Step 2.8" title="Email Invoice & Eway Bill" subtitle="Pick an invoice — its full details & attachments load for preview, then send to the client.">
      {/* Invoice number picker */}
      <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Autocomplete
          options={invoices}
          value={inv}
          onChange={(_, v) => setInv(v)}
          getOptionLabel={(o) => (o ? `${o.invoiceNo} — ${o.partyName} (${o.dcNumber || '—'})` : '')}
          isOptionEqualToValue={(a, b) => a._id === b._id}
          renderInput={(p) => <TextField {...p} label="Invoice Number" placeholder="Select an invoice number…" size="small" />}
        />
      </Paper>

      {inv && (
        <>
          {/* Full invoice details */}
          <Paper sx={{ borderRadius: 3, overflow: 'hidden', mb: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 2, bgcolor: alpha(theme.palette.primary.main, 0.05), borderBottom: `1px solid ${theme.palette.divider}` }}>
              <FileText size={16} color={theme.palette.primary.main} />
              <Typography sx={{ fontWeight: 800 }}>{inv.invoiceNo}</Typography>
              <Chip size="small" label={inv.status} sx={{ fontWeight: 700, height: 20 }} />
            </Stack>
            <Box sx={{ p: 2.5 }}>
              <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
                <Detail label="Invoice Date" value={fmtD(inv.invoiceDate)} />
                <Detail label="Invoice Amount" value={inr(inv.invoiceAmount)} />
                <Detail label="Party" value={inv.partyName} />
                <Detail label="PO Number" value={inv.poNumber} />
                <Detail label="DC Number" value={inv.dcNumber} />
                <Detail label="Transport Type" value={inv.transportType} />
                <Detail label="Transporter" value={inv.transporterName} />
                <Detail label="L.R. No" value={inv.lrNo} />
              </Stack>
              <Divider sx={{ mb: 2 }} />
              {/* Attachments grouped by type */}
              <Stack direction="row" spacing={4} flexWrap="wrap" useFlexGap>
                <AttachGroup icon={FileText} label="Invoice" urls={inv.invoiceUrls} theme={theme} />
                <AttachGroup icon={ShieldCheck} label="Eway Bill" urls={inv.ewayBillUrls} theme={theme} />
                <AttachGroup icon={ClipboardList} label="PDIR" urls={inv.pdirUrls} theme={theme} />
              </Stack>
            </Box>
          </Paper>

          {/* Email composer */}
          <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
            <Stack sx={{ p: 2, bgcolor: alpha(theme.palette.primary.main, 0.05), borderBottom: `1px solid ${theme.palette.divider}` }}>
              <Typography sx={{ fontWeight: 800, fontSize: '0.85rem', color: 'text.secondary' }}>EMAIL PREVIEW — sends to the client</Typography>
            </Stack>
            {/* Sent log — this session, or the last recorded send on the invoice. */}
            {(sentInfo || inv.emailToClient?.actual) && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2.5, py: 1, bgcolor: alpha(theme.palette.success.main, 0.08), borderBottom: `1px solid ${theme.palette.divider}` }}>
                <CheckCircle2 size={15} color={theme.palette.success.dark} />
                <Typography variant="caption" sx={{ fontWeight: 700, color: theme.palette.success.dark }}>
                  {sentInfo
                    ? `Emailed to ${sentInfo.to} on ${dayjs(sentInfo.at).format('DD MMM YYYY · hh:mm A')}`
                    : `Last emailed on ${dayjs(inv.emailToClient.actual).format('DD MMM YYYY · hh:mm A')}${inv.emailToClient.emailStatus && inv.emailToClient.emailStatus !== 'SENT' ? ` (${inv.emailToClient.emailStatus})` : ''}`}
                </Typography>
              </Stack>
            )}
            <Stack spacing={2} sx={{ p: 2.5 }}>
              <TextField label="To" value={to} onChange={(e) => setTo(e.target.value)} size="small" fullWidth placeholder="client@email.com" />
              <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} size="small" fullWidth />
              <TextField label="Message" value={message} onChange={(e) => setMessage(e.target.value)} size="small" fullWidth multiline minRows={6} />
              <Typography variant="caption" color="text.secondary">
                {allAttachments.length} document{allAttachments.length === 1 ? '' : 's'} linked (Invoice + Eway + PDIR) will be included.
              </Typography>
              <Divider />
              <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={1.5}>
                <Chip size="small" variant="outlined" label="Delivery needs SMTP configured on the server" sx={{ fontSize: '0.62rem' }} />
                <Button variant="contained" startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <Send size={16} />}
                  disabled={isLoading} onClick={handleSend} sx={{ fontWeight: 700, px: 3 }}>
                  {isLoading ? 'Sending…' : 'Send Email'}
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </>
      )}
    </O2dStepShell>
  );
};

export default InvoiceEmail;
