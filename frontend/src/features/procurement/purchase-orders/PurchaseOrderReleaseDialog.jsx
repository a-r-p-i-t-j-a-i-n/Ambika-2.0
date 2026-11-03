import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Autocomplete, Chip,
  Box, Stack, Typography, CircularProgress, IconButton, Tooltip, Skeleton,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Send, X, Mail, Paperclip, FileText, Eye, Info, Building2, MailX } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useSelector } from 'react-redux';
import {
  useReleasePurchaseOrderMutation, useGetPoReleasePreviewMutation, useGeneratePurchaseOrderPdfMutation,
} from '../../../store/api/procurementApi';
import { fmtINR, fmtDate, poDisplayNumber } from './poMeta';
import PurchaseOrderPdfPreview from './PurchaseOrderPdfPreview';

/**
 * Release an approved PO to the supplier (Step 1.4).
 * On release the backend sets RELEASED_TO_VENDOR and generates the PO PDF.
 *
 * The supplier email is laid out here — To / CC / BCC, subject, message and the
 * PO PDF as its attachment — but emailing is switched off: Release always sends
 * sendEmail: false, so nothing is mailed to the supplier. Recipients and subject
 * come from the read-only release preview (Vendor Master + the server's subject).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLUE = '#1d4ed8';
const LINE = '#e2e8f0';
const MAX_LINES = 8;

const pdfNameOf = (po) => `${String(po?.poNumber || 'PO').replace(/[^\w.-]/g, '_')}.pdf`;

// The message the supplier would get — order summary, delivery, payment terms.
const defaultBody = (po, senderName) => {
  const items = po?.items || [];
  const lines = items.slice(0, MAX_LINES).map((it) =>
    `  • ${it.itemName || it.skuCode || 'Item'} — ${Number(it.quantity || 0).toLocaleString('en-IN')} ${it.unit || ''}`.trimEnd());
  if (items.length > MAX_LINES) lines.push(`  • …and ${items.length - MAX_LINES} more item(s) — see the attached PO`);
  return [
    `Dear ${po?.vendorName || 'Sir/Madam'},`,
    '',
    `Please find attached our Purchase Order ${po?.poNumber || ''}${po?.poDate ? ` dated ${fmtDate(po.poDate)}` : ''}.`,
    '',
    'Order summary:',
    ...lines,
    `Total value: ${fmtINR(po?.grandTotal)}`,
    po?.expectedDeliveryDate ? `Expected delivery: ${fmtDate(po.expectedDeliveryDate)}` : null,
    po?.paymentTerms ? `Payment terms: ${po.paymentTerms}` : null,
    '',
    'Kindly acknowledge this order and confirm the delivery date.',
    '',
    'Regards,',
    senderName || null,
    'Ambika Global',
  ].filter((l) => l !== null).join('\n');
};

const splitEmails = (text) => String(text || '').split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
const dedupe = (list) => [...new Set(list.map((e) => e.toLowerCase()))];

// To / CC / BCC — one chip per address; type or paste, then Enter, comma or
// leave the field. A chip that is not a valid address shows red.
const EmailField = ({ label, value, onChange, loading, placeholder, autoFocus }) => {
  const [input, setInput] = useState('');
  const commit = (text) => {
    const added = splitEmails(text);
    if (added.length) onChange(dedupe([...value, ...added]));
    setInput('');
  };
  return (
    <Stack direction="row" alignItems="flex-start" spacing={1.5} sx={{ py: 0.75, borderBottom: `1px solid ${LINE}` }}>
      <Typography sx={{ width: 52, flexShrink: 0, pt: 0.75, fontSize: '0.8rem', fontWeight: 700, color: 'text.secondary' }}>{label}</Typography>
      {loading ? <Skeleton width="60%" height={30} /> : (
        <Autocomplete
          multiple freeSolo fullWidth options={[]} value={value}
          inputValue={input}
          onInputChange={(_e, v) => { if (/[\s,;]$/.test(v)) commit(v); else setInput(v); }}
          onChange={(_e, v) => onChange(dedupe(v.flatMap(splitEmails)))}
          onBlur={() => input.trim() && commit(input)}
          renderTags={(list, getTagProps) => list.map((email, i) => {
            const ok = EMAIL_RE.test(email);
            const { key, ...tagProps } = getTagProps({ index: i });
            return (
              <Chip key={key ?? email} {...tagProps} size="small" label={email} title={ok ? email : 'Not a valid email address'}
                color={ok ? 'default' : 'error'} variant={ok ? 'filled' : 'outlined'}
                sx={{ fontWeight: 600, height: 24, ...(ok ? { bgcolor: alpha(BLUE, 0.08), color: '#1e3a8a' } : {}) }} />
            );
          })}
          renderInput={(params) => (
            <TextField {...params} variant="standard" autoFocus={autoFocus} placeholder={value.length ? '' : placeholder}
              InputProps={{ ...params.InputProps, disableUnderline: true, sx: { fontSize: '0.86rem', minHeight: 32 } }} />
          )}
        />
      )}
    </Stack>
  );
};

const ReleaseForm = ({ po, releasePo, releasing, onClose }) => {
  const { enqueueSnackbar } = useSnackbar();
  const senderName = useSelector((s) => s.auth?.user?.name || '');
  const [to, setTo] = useState(() => splitEmails(po.vendorEmail));
  const [cc, setCc] = useState([]);
  const [bcc, setBcc] = useState([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState(`Purchase Order ${po.poNumber || ''} — Ambika Global`);
  const [body, setBody] = useState(() => defaultBody(po, senderName));
  const [remarks, setRemarks] = useState('');
  const [attachmentName, setAttachmentName] = useState(() => po.poPdfFileName || pdfNameOf(po));
  const [loadingRecipients, setLoadingRecipients] = useState(true);
  const [pdfPo, setPdfPo] = useState(null);

  // Recipients + subject exactly as the server resolves them (read-only call).
  const [fetchPreview] = useGetPoReleasePreviewMutation();
  useEffect(() => {
    let live = true;
    fetchPreview({ poIds: [po._id] }).unwrap()
      .then((res) => {
        const row = res?.data?.items?.[0];
        if (!live || !row) return;
        if (row.to?.length) setTo(row.to);
        if (row.cc?.length) { setCc(row.cc); setShowCc(true); }
        if (row.bcc?.length) { setBcc(row.bcc); setShowBcc(true); }
        if (row.subject) setSubject(row.subject);
        if (row.attachmentName) setAttachmentName(row.attachmentName);
      })
      .catch(() => { /* keep the PO's own vendor email */ })
      .finally(() => { if (live) setLoadingRecipients(false); });
    return () => { live = false; };
  }, [po._id, fetchPreview]);

  // The attachment: the PO PDF (the same file Release makes for the supplier).
  const [generatePdf, { isLoading: pdfLoading }] = useGeneratePurchaseOrderPdfMutation();
  const previewPdf = async () => {
    if (po.poPdfUrl) { setPdfPo(po); return; }
    try {
      const res = await generatePdf({ id: po._id }).unwrap();
      setPdfPo({ ...po, poPdfUrl: res?.data?.poPdfUrl, poPdfFileName: res?.data?.poPdfFileName });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not make the PO PDF', { variant: 'error' });
    }
  };

  const handleRelease = async () => {
    try {
      // Emailing is switched off — the supplier is never mailed from here.
      const res = await releasePo({ id: po._id, sendEmail: false, remarks: remarks.trim() }).unwrap();
      enqueueSnackbar(
        `${po.poNumber || 'PO'} released${res?.data?.poPdfUrl ? ' — PO PDF ready' : ''}. No email was sent to the supplier.`,
        { variant: 'success' },
      );
      onClose(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to release PO', { variant: 'error' });
    }
  };

  const itemCount = po.items?.length || 0;

  return (
    <>
      <DialogTitle component="div" sx={{ px: 2.5, py: 1.75, display: 'flex', alignItems: 'center', gap: 1.25, borderBottom: `1px solid ${LINE}` }}>
        <Box sx={{ width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: alpha('#059669', 0.12), color: '#047857', flexShrink: 0 }}>
          <Send size={17} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: '1rem', lineHeight: 1.25 }}>
            Release PO to Supplier
            <Typography component="span" sx={{ ml: 1, color: BLUE, fontWeight: 700, fontSize: '0.85rem' }}>{poDisplayNumber(po)}</Typography>
          </Typography>
          <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary' }}>Step 1.4 · Releasing makes the official PO PDF and opens Material Follow-up</Typography>
        </Box>
        <IconButton size="small" onClick={() => onClose(false)} disabled={releasing}><X size={18} /></IconButton>
      </DialogTitle>

      <DialogContent sx={{ px: 2.5, py: 2, bgcolor: '#f8fafc' }}>
        {/* Order */}
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mt: 1, p: 1.5, borderRadius: 2, bgcolor: '#fff', border: `1px solid ${LINE}` }}>
          <Building2 size={18} color={BLUE} style={{ flexShrink: 0 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap sx={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>{po.vendorName}</Typography>
            <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
              {[`${itemCount} item${itemCount === 1 ? '' : 's'}`, po.expectedDeliveryDate && `Delivery ${fmtDate(po.expectedDeliveryDate)}`, po.paymentTerms]
                .filter(Boolean).join(' · ')}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
            <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', fontWeight: 600 }}>PO value</Typography>
            <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', color: '#0f172a' }}>{fmtINR(po.grandTotal)}</Typography>
          </Box>
        </Stack>

        {/* Email to the supplier */}
        <Box sx={{ mt: 1.75, borderRadius: 2, bgcolor: '#fff', border: `1px solid ${LINE}`, overflow: 'hidden' }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.75, py: 1.1, bgcolor: alpha(BLUE, 0.04), borderBottom: `1px solid ${LINE}` }}>
            <Mail size={16} color={BLUE} />
            <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', flex: 1 }}>Email to supplier</Typography>
            <Tooltip title="Emailing is switched off — releasing does not send this email.">
              <Chip size="small" icon={<MailX size={13} />} label="Not sent — email is off"
                sx={{ height: 22, fontSize: '0.68rem', fontWeight: 700, bgcolor: '#fff7e6', color: '#b45309', '& .MuiChip-icon': { color: '#b45309' } }} />
            </Tooltip>
          </Stack>

          <Box sx={{ px: 1.75 }}>
            <Stack direction="row" alignItems="flex-start">
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <EmailField label="To" value={to} onChange={setTo} loading={loadingRecipients} placeholder="supplier@email.com" />
              </Box>
              {!(showCc && showBcc) && (
                <Stack direction="row" spacing={0.25} sx={{ pt: 0.9, pl: 1, borderBottom: `1px solid ${LINE}`, alignSelf: 'stretch' }}>
                  {!showCc && <Button size="small" onClick={() => setShowCc(true)} sx={{ minWidth: 0, px: 0.75, fontWeight: 700, textTransform: 'none' }}>Cc</Button>}
                  {!showBcc && <Button size="small" onClick={() => setShowBcc(true)} sx={{ minWidth: 0, px: 0.75, fontWeight: 700, textTransform: 'none' }}>Bcc</Button>}
                </Stack>
              )}
            </Stack>
            {showCc && <EmailField label="Cc" value={cc} onChange={setCc} loading={loadingRecipients} placeholder="Add CC addresses" autoFocus={!cc.length} />}
            {showBcc && <EmailField label="Bcc" value={bcc} onChange={setBcc} loading={loadingRecipients} placeholder="Add BCC addresses" autoFocus={!bcc.length} />}
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ py: 0.5, borderBottom: `1px solid ${LINE}` }}>
              <Typography sx={{ width: 52, flexShrink: 0, fontSize: '0.8rem', fontWeight: 700, color: 'text.secondary' }}>Subject</Typography>
              <TextField variant="standard" fullWidth value={subject} onChange={(e) => setSubject(e.target.value)}
                InputProps={{ disableUnderline: true, sx: { fontSize: '0.88rem', fontWeight: 700, minHeight: 34 } }} />
            </Stack>
            <TextField variant="standard" fullWidth multiline minRows={8} maxRows={14} value={body} onChange={(e) => setBody(e.target.value)}
              InputProps={{ disableUnderline: true, sx: { fontSize: '0.85rem', lineHeight: 1.55, py: 1.25 } }} />
          </Box>

          {/* Attachment — the PO PDF, made on release */}
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.75, py: 1.1, borderTop: `1px solid ${LINE}`, bgcolor: '#fbfcfe', flexWrap: 'wrap', rowGap: 1 }}>
            <Paperclip size={15} color="#64748b" />
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, pl: 1, pr: 0.5, py: 0.4, borderRadius: 1.5, border: `1px solid ${LINE}`, bgcolor: '#fff', minWidth: 0 }}>
              <Box sx={{ width: 26, height: 26, borderRadius: 1, display: 'grid', placeItems: 'center', bgcolor: '#fdecec', color: '#dc2626', flexShrink: 0 }}>
                <FileText size={15} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: '0.8rem', fontWeight: 700, color: '#0f172a', maxWidth: 260 }}>{attachmentName}</Typography>
                <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>PO PDF · attached automatically</Typography>
              </Box>
              <Button size="small" onClick={previewPdf} disabled={pdfLoading}
                startIcon={pdfLoading ? <CircularProgress size={12} /> : <Eye size={14} />}
                sx={{ ml: 0.5, textTransform: 'none', fontWeight: 700, minWidth: 0 }}>
                Preview
              </Button>
            </Box>
          </Stack>
        </Box>

        <TextField label="Remarks (internal, optional)" fullWidth size="small" multiline minRows={1} maxRows={4}
          value={remarks} onChange={(e) => setRemarks(e.target.value)} sx={{ mt: 1.75, bgcolor: '#fff' }} />
      </DialogContent>

      <DialogActions sx={{ px: 2.5, py: 1.5, gap: 1, borderTop: `1px solid ${LINE}` }}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mr: 'auto', color: 'text.secondary', minWidth: 0 }}>
          <Info size={14} style={{ flexShrink: 0 }} />
          <Typography sx={{ fontSize: '0.74rem' }}>The PO is released and its PDF made — no email goes to the supplier.</Typography>
        </Stack>
        <Button onClick={() => onClose(false)} disabled={releasing} sx={{ fontWeight: 700 }}>Cancel</Button>
        <Button variant="contained" color="success" disableElevation
          startIcon={releasing ? <CircularProgress size={16} color="inherit" /> : <Send size={16} />}
          onClick={handleRelease} disabled={releasing} sx={{ fontWeight: 800, px: 2.5 }}>
          Release PO
        </Button>
      </DialogActions>

      <PurchaseOrderPdfPreview open={Boolean(pdfPo)} po={pdfPo} onClose={() => setPdfPo(null)} />
    </>
  );
};

// The form lives inside the Dialog, so it starts fresh each time the dialog opens.
const PurchaseOrderReleaseDialog = ({ open, onClose, po }) => {
  const [releasePo, { isLoading }] = useReleasePurchaseOrderMutation();
  return (
    <Dialog open={open} onClose={() => !isLoading && onClose?.(false)} maxWidth="md" fullWidth scroll="paper"
      PaperProps={{ sx: { borderRadius: 3, maxWidth: 760 } }}>
      {po ? <ReleaseForm po={po} releasePo={releasePo} releasing={isLoading} onClose={(done) => onClose?.(done)} /> : null}
    </Dialog>
  );
};

export default PurchaseOrderReleaseDialog;
