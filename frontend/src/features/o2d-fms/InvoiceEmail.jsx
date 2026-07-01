import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
  Paper, Stack, Typography, Autocomplete, TextField, Button, Chip, alpha, useTheme,
  CircularProgress, Divider, Link, Box, Checkbox, IconButton,
} from '@mui/material';
import { Mail, Send, Paperclip, FileText, ShieldCheck, ClipboardList, CheckCircle2, UploadCloud, X } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { useSearchParams } from 'react-router-dom';
import O2dStepShell from './components/O2dStepShell';
import { useGetSalesInvoicesQuery, useSendSalesInvoiceMutation } from '../../store/api/salesInvoiceApi';
import { useUploadFileMutation } from '../../store/api/o2dFmsApi';
import { useReturnToTask } from './useReturnToTask';
import { useFmsGate } from './FmsGate';

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
  const [searchParams] = useSearchParams();
  const soParam = searchParams.get('so') || '';

  const [uploadFile] = useUploadFileMutation();
  const [inv, setInv] = useState(null);
  const gate = useFmsGate({ soNumber: inv?.soNumber || soParam, action: 'INVOICE_EMAIL' });
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sentInfo, setSentInfo] = useState(null); // { to, at } after a successful send this session

  // Attachment control: which of the invoice's stored docs are ticked + local uploads.
  const [selectedUrls, setSelectedUrls] = useState(() => new Set());
  const [uploads, setUploads] = useState([]); // { fileName, url }
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);

  // The invoice's stored documents, flattened + labelled (Invoice / Eway / PDIR).
  const docList = useMemo(() => [
    ...(inv?.invoiceUrls || []).map((u, i) => ({ url: u, label: 'Invoice', name: `Invoice ${i + 1}` })),
    ...(inv?.ewayBillUrls || []).map((u, i) => ({ url: u, label: 'Eway Bill', name: `Eway Bill ${i + 1}` })),
    ...(inv?.pdirUrls || []).map((u, i) => ({ url: u, label: 'PDIR', name: `PDIR ${i + 1}` })),
  ].filter((d) => d.url), [inv]);

  const totalToSend = selectedUrls.size + uploads.length;

  const toggleUrl = (url) => setSelectedUrls((s) => {
    const n = new Set(s);
    if (n.has(url)) n.delete(url); else n.add(url);
    return n;
  });

  const uploadFiles = async (files) => {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    setUploading(true);
    try {
      const out = [];
      for (const f of arr) {
        const res = await uploadFile({ file: f, folder: 'o2d-fms' }).unwrap();
        const d = res.data || res;
        out.push({ fileName: d.fileName || f.name, url: d.url });
      }
      setUploads((u) => [...u, ...out]);
    } catch (e) { enqueueSnackbar(e?.data?.message || 'Upload failed.', { variant: 'error' }); }
    finally { setUploading(false); }
  };

  // Came from an FMS "Do it now" with ?so=… → auto-select that order's invoice.
  useEffect(() => {
    if (inv || !soParam || !invoices.length) return;
    const match = invoices.find((i) => i.soNumber === soParam);
    if (match) setInv(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soParam, invoices]);

  useEffect(() => {
    if (!inv) return;
    setSentInfo(null);
    // Default: every stored document ticked; fresh (no) local uploads.
    setSelectedUrls(new Set([...(inv.invoiceUrls || []), ...(inv.ewayBillUrls || []), ...(inv.pdirUrls || [])].filter(Boolean)));
    setUploads([]);
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
      // The exact set the user chose: ticked invoice docs + local uploads.
      const attachments = [
        ...docList.filter((d) => selectedUrls.has(d.url)).map((d) => ({ url: d.url, name: d.name, label: d.label })),
        ...uploads.map((u) => ({ url: u.url, name: u.fileName, label: 'Attachment' })),
      ];
      const res = await send({ id: inv._id, to: to.trim(), subject, message: message.replace(/\n/g, '<br/>'), attachments }).unwrap();
      const st = res.data?.emailStatus;
      if (st === 'SENT') {
        setSentInfo({ to: res.data.recipient || to.trim(), at: new Date() });
        enqueueSnackbar(`Email sent to ${res.data.recipient}.`, { variant: 'success' });
      } else {
        enqueueSnackbar(`Email could not be sent (${st}). Check SMTP settings.`, { variant: 'warning' });
      }
      setTimeout(() => finishToTask({ soNumber: inv.soNumber, action: 'INVOICE_EMAIL' }), 800);
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Failed to send.', { variant: 'error' });
    }
  };

  return (
    <O2dStepShell icon={Mail} step="Step 2.8" title="Email Invoice & Eway Bill" subtitle="Pick an invoice — its full details & attachments load for preview, then send to the client." gate={gate}>
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
              {/* The documents created in step 2.7 (read-only reference). They're
                  auto-listed & attached in the email section below. */}
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

              {/* Attachments that go WITH this mail — the 2.7 documents auto-listed &
                  ticked, plus anything the sender adds from their computer. */}
              <Box sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 2, p: 1.5, bgcolor: alpha(theme.palette.primary.main, 0.02) }}>
                <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
                  <Paperclip size={15} color={theme.palette.primary.main} />
                  <Typography sx={{ fontWeight: 800, fontSize: '0.85rem' }}>Attachments</Typography>
                  <Chip size="small" label={`${totalToSend} to send`} sx={{ height: 20, fontWeight: 700, bgcolor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.dark }} />
                  <Box sx={{ flex: 1 }} />
                  {docList.length > 0 && (
                    <>
                      <Button size="small" variant="text" onClick={() => setSelectedUrls(new Set(docList.map((d) => d.url)))}>Select all</Button>
                      <Button size="small" variant="text" color="inherit" onClick={() => setSelectedUrls(new Set())}>Clear</Button>
                    </>
                  )}
                </Stack>

                {docList.length === 0 ? (
                  <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 1 }}>No documents from step 2.7 — attach files below.</Typography>
                ) : (
                  <Stack sx={{ mb: 1.5 }}>
                    {docList.map((d) => (
                      <Stack key={d.url} direction="row" alignItems="center" spacing={0.5} sx={{ py: 0.15 }}>
                        <Checkbox size="small" checked={selectedUrls.has(d.url)} onChange={() => toggleUrl(d.url)} sx={{ p: 0.5 }} />
                        <Chip size="small" variant="outlined" label={d.label} sx={{ height: 18, fontSize: '0.58rem', fontWeight: 700, flexShrink: 0 }} />
                        <Link href={d.url} target="_blank" rel="noopener" sx={{ fontSize: '0.78rem', flex: 1 }} noWrap>{d.name}</Link>
                      </Stack>
                    ))}
                  </Stack>
                )}

                {/* Local upload — drag & drop or click to browse */}
                <Box
                  onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => { e.preventDefault(); setDrag(false); uploadFiles(e.dataTransfer.files); }}
                  onClick={() => fileRef.current?.click()}
                  sx={{
                    cursor: uploading ? 'wait' : 'pointer', border: '1.5px dashed',
                    borderColor: drag ? 'primary.main' : alpha(theme.palette.primary.main, 0.35), borderRadius: 2, p: 1.5,
                    display: 'flex', alignItems: 'center', gap: 1.25, transition: 'all .15s',
                    bgcolor: drag ? alpha(theme.palette.primary.main, 0.06) : 'transparent',
                    '&:hover': { borderColor: 'primary.main' },
                  }}
                >
                  <input ref={fileRef} type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.doc,.docx" onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />
                  <Box sx={{ width: 34, height: 34, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(theme.palette.primary.main, 0.1), color: 'primary.main', flexShrink: 0 }}>
                    {uploading ? <CircularProgress size={15} /> : <UploadCloud size={17} />}
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{uploading ? 'Uploading…' : 'Drag & drop files here, or click to browse'}</Typography>
                    <Typography variant="caption" color="text.secondary">Attach extra files from your computer — PDF, images, Excel, Word…</Typography>
                  </Box>
                </Box>

                {uploads.length > 0 && (
                  <Stack sx={{ mt: 1 }} spacing={0.25}>
                    {uploads.map((u, i) => (
                      <Stack key={i} direction="row" alignItems="center" spacing={0.75} sx={{ py: 0.15, px: 0.5, borderRadius: 1, bgcolor: alpha(theme.palette.success.main, 0.06) }}>
                        <Paperclip size={12} color={theme.palette.success.dark} />
                        <Link href={u.url} target="_blank" rel="noopener" sx={{ fontSize: '0.78rem', flex: 1 }} noWrap>{u.fileName}</Link>
                        <IconButton size="small" onClick={() => setUploads((x) => x.filter((_, j) => j !== i))}><X size={13} /></IconButton>
                      </Stack>
                    ))}
                  </Stack>
                )}
              </Box>

              <Typography variant="caption" color="text.secondary">
                {totalToSend} attachment{totalToSend === 1 ? '' : 's'} will be sent{totalToSend === 0 ? ' — none selected' : ''} (ticked invoice docs + your uploads).
              </Typography>
              <Divider />
              <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={1.5}>
                <Chip size="small" variant="outlined" label="Sends to the “To” address via the configured SMTP relay" sx={{ fontSize: '0.62rem' }} />
                <Button variant="contained" startIcon={isLoading ? <CircularProgress size={16} color="inherit" /> : <Send size={16} />}
                  disabled={isLoading || gate.blocked} onClick={handleSend} sx={{ fontWeight: 700, px: 3 }}>
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
