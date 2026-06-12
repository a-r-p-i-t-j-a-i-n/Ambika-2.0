import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Stack, Chip, Button, Paper, alpha, useTheme, IconButton,
  Tooltip, Skeleton, Divider, Menu, MenuItem, ListItemIcon,
} from '@mui/material';
import {
  ArrowLeft, Download, Send, CheckCircle2, ShieldOff, Repeat, Hourglass, Trash2,
  Pencil, Share2, MessageCircle, Mail, Copy,
} from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import {
  useGetQuoteQuery,
  useSendQuoteMutation,
  useAcceptQuoteMutation,
  useRejectQuoteMutation,
  useDeleteQuoteMutation,
} from '../../store/api/quoteApi';
import { fmtINR, fmtInt } from '../../utils/formatters';
import { usePermissions } from '../../hooks/usePermission';

const STATUS_META = (theme) => ({
  DRAFT:           { color: theme.palette.text.secondary, bg: alpha(theme.palette.text.secondary, 0.10), label: 'Draft' },
  SENT:            { color: theme.palette.primary.dark,   bg: alpha(theme.palette.primary.main, 0.10),  label: 'Sent' },
  ACCEPTED:        { color: theme.palette.success.dark,   bg: alpha(theme.palette.success.main, 0.10),  label: 'Accepted' },
  REJECTED:        { color: theme.palette.error.dark,     bg: alpha(theme.palette.error.main, 0.10),    label: 'Rejected' },
  EXPIRED:         { color: theme.palette.warning.dark,   bg: alpha(theme.palette.warning.main, 0.10),  label: 'Expired' },
  CONVERTED_TO_SO: { color: theme.palette.info.dark,      bg: alpha(theme.palette.info.main, 0.10),     label: 'Converted to SO' },
});

const QuoteDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const theme = useTheme();
  const { data, isFetching } = useGetQuoteQuery(id);
  const [sendQuote] = useSendQuoteMutation();
  const [acceptQuote] = useAcceptQuoteMutation();
  const [rejectQuote] = useRejectQuoteMutation();
  const [deleteQuote] = useDeleteQuoteMutation();
  const { can } = usePermissions();

  const q = data?.data;
  const statusMeta = STATUS_META(theme);
  const [shareAnchor, setShareAnchor] = useState(null);

  // Plain-text summary used for WhatsApp / email / clipboard sharing.
  const buildShareText = () => {
    if (!q) return '';
    const total = q.pdfIncludeGst === false ? q.totals.subtotal : q.totals.grandTotal;
    const totalLabel = q.pdfIncludeGst === false ? 'Total' : 'Grand Total (incl. GST)';
    return [
      `*Quotation ${q.quoteNumber}*`,
      q.partyName ? `Customer: ${q.partyName}` : null,
      q.poReference ? `PO Ref: ${q.poReference}` : null,
      `Items: ${q.lines.length}`,
      `${totalLabel}: ${fmtINR(total)}`,
      `Valid until: ${dayjs(q.validUntil).format('DD MMM YYYY')}`,
    ].filter(Boolean).join('\n');
  };

  const shareVia = (channel) => {
    const text = buildShareText();
    if (channel === 'whatsapp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    } else if (channel === 'email') {
      const subject = `Quotation ${q.quoteNumber}`;
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    } else if (channel === 'copy') {
      navigator.clipboard?.writeText(text)
        .then(() => enqueueSnackbar('Quote summary copied — paste it anywhere', { variant: 'success' }))
        .catch(() => enqueueSnackbar('Could not copy', { variant: 'error' }));
    }
    setShareAnchor(null);
  };

  const openPdf = () => {
    const token = localStorage.getItem('token');
    const baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';
    // Use a tab so the browser print dialog works; auth via query token would be cleaner —
    // for now we open in a window and pass the token through fetch+blob.
    fetch(`${baseUrl}/quotes/${q._id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.text())
      .then((html) => {
        const w = window.open('', '_blank');
        if (!w) return enqueueSnackbar('Allow popups to view the PDF.', { variant: 'warning' });
        w.document.write(html);
        w.document.close();
      })
      .catch(() => enqueueSnackbar('Failed to render PDF', { variant: 'error' }));
  };

  const handleAction = async (fn, msg) => {
    try {
      await fn(id).unwrap();
      enqueueSnackbar(msg, { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed', { variant: 'error' });
    }
  };

  const handleReject = async () => {
    const reason = window.prompt('Reason for rejection?');
    if (!reason) return;
    try {
      await rejectQuote({ id, reason }).unwrap();
      enqueueSnackbar('Quote rejected', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed', { variant: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete this quote? This cannot be undone.')) return;
    try {
      await deleteQuote(id).unwrap();
      enqueueSnackbar('Quote deleted', { variant: 'success' });
      navigate('/quotes');
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed', { variant: 'error' });
    }
  };

  if (isFetching || !q) {
    return (
      <Box sx={{ p: 4 }}>
        <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 3, mb: 2 }} />
        <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 3 }} />
      </Box>
    );
  }

  const m = statusMeta[q.status] || statusMeta.DRAFT;
  const daysLeft = dayjs(q.validUntil).diff(dayjs(), 'day');
  const isExpired = daysLeft < 0;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Hero */}
      <Box sx={{
        position: 'relative', overflow: 'hidden', color: '#fff',
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)',
        px: { xs: 3, md: 5 }, pt: { xs: 3, md: 4 }, pb: { xs: 5, md: 6 },
      }}>
        <Box aria-hidden sx={{ position: 'absolute', width: 420, height: 420, borderRadius: '50%', top: -160, right: -120, background: 'radial-gradient(circle, rgba(96,165,250,0.32) 0%, rgba(96,165,250,0) 60%)' }} />
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ position: 'relative', mb: 2 }}>
          <IconButton onClick={() => navigate('/quotes')} sx={{ color: '#fff', '&:hover': { bgcolor: 'rgba(255,255,255,0.15)', color: '#fff' } }}>
            <ArrowLeft size={18} />
          </IconButton>
          <Typography sx={{ color: 'rgba(255,255,255,0.78)', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Quotation
          </Typography>
        </Stack>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ position: 'relative' }} alignItems={{ md: 'flex-end' }}>
          <Box sx={{ flex: 1 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5, flexWrap: 'wrap' }}>
              <Typography sx={{ color: '#fff', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 800, letterSpacing: '-0.02em', fontFamily: 'ui-monospace, monospace' }}>
                {q.quoteNumber}
              </Typography>
              <Chip
                label={m.label}
                sx={{
                  height: 28, fontWeight: 800, fontSize: '0.74rem',
                  bgcolor: 'rgba(255,255,255,0.15)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.25)',
                }}
              />
            </Stack>
            <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '1rem', fontWeight: 600 }}>
              {q.partyName || '—'}{q.poReference ? ` · PO ${q.poReference}` : ''}
            </Typography>
            <Stack direction="row" spacing={2} sx={{ mt: 1.5, color: 'rgba(255,255,255,0.7)', fontSize: '0.82rem', flexWrap: 'wrap' }}>
              <span>As of {dayjs(q.asOfDate).format('DD MMM YYYY')}</span>
              <span>·</span>
              <span style={{ color: isExpired ? '#fca5a5' : '#fff' }}>
                Valid until {dayjs(q.validUntil).format('DD MMM YYYY')} ({isExpired ? `expired ${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`})
              </span>
            </Stack>
          </Box>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Tooltip title="Open PDF in new tab">
              <Button startIcon={<Download size={14} />} onClick={openPdf}
                sx={{ fontWeight: 700, color: '#fff', border: '1px solid rgba(255,255,255,0.25)', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}>
                View PDF
              </Button>
            </Tooltip>

            <Button startIcon={<Share2 size={14} />} onClick={(e) => setShareAnchor(e.currentTarget)}
              sx={{ fontWeight: 700, color: '#fff', border: '1px solid rgba(255,255,255,0.25)', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}>
              Share
            </Button>
            <Menu anchorEl={shareAnchor} open={Boolean(shareAnchor)} onClose={() => setShareAnchor(null)}>
              <MenuItem onClick={() => shareVia('whatsapp')}>
                <ListItemIcon><MessageCircle size={16} color="#25D366" /></ListItemIcon>
                Share on WhatsApp
              </MenuItem>
              <MenuItem onClick={() => shareVia('email')}>
                <ListItemIcon><Mail size={16} /></ListItemIcon>
                Share via Email
              </MenuItem>
              <MenuItem onClick={() => shareVia('copy')}>
                <ListItemIcon><Copy size={16} /></ListItemIcon>
                Copy summary
              </MenuItem>
            </Menu>

            {q.status === 'DRAFT' && can('quotes.edit') && (
              <Button startIcon={<Pencil size={14} />} onClick={() => navigate(`/pricing/calculator?edit=${q._id}`)}
                sx={{ fontWeight: 700, color: '#fff', border: '1px solid rgba(255,255,255,0.25)', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}>
                Edit draft
              </Button>
            )}
            {q.status === 'DRAFT' && (
              <Button startIcon={<Send size={14} />} onClick={() => handleAction(sendQuote, 'Quote marked as sent')}
                sx={{ fontWeight: 700, color: '#fff', bgcolor: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.25)', '&:hover': { bgcolor: 'rgba(255,255,255,0.24)' } }}>
                Mark sent
              </Button>
            )}
            {['SENT', 'DRAFT'].includes(q.status) && (
              <Button startIcon={<CheckCircle2 size={14} />} onClick={() => handleAction(acceptQuote, 'Quote accepted')}
                sx={{ fontWeight: 700, color: '#fff', bgcolor: alpha(theme.palette.success.main, 0.7), '&:hover': { bgcolor: theme.palette.success.main } }}>
                Accept
              </Button>
            )}
            {['SENT', 'DRAFT'].includes(q.status) && (
              <Button startIcon={<ShieldOff size={14} />} onClick={handleReject}
                sx={{ fontWeight: 700, color: '#fff', border: '1px solid rgba(252, 165, 165, 0.4)', '&:hover': { bgcolor: alpha(theme.palette.error.main, 0.2) } }}>
                Reject
              </Button>
            )}
          </Stack>
        </Stack>
      </Box>

      {/* Body */}
      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative' }}>
        <Paper sx={{ borderRadius: 3, overflow: 'hidden', mb: 2 }}>
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: '40px minmax(220px, 2fr) 80px 110px 80px 120px 100px 130px',
            bgcolor: alpha(theme.palette.primary.main, 0.04),
            px: 2, py: 1.25, gap: 1,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}>
            {['#', 'SKU', 'Qty', 'Unit ₹', 'GST', 'Subtotal', 'GST ₹', 'Line Total'].map((h, i) => (
              <Typography key={i} sx={{
                fontSize: '0.7rem', fontWeight: 800, color: 'text.secondary',
                letterSpacing: '0.08em', textTransform: 'uppercase',
                textAlign: i >= 2 ? 'right' : 'left',
              }}>{h}</Typography>
            ))}
          </Box>
          {q.lines.map((l, i) => (
            <Box key={i} sx={{
              display: 'grid',
              gridTemplateColumns: '40px minmax(220px, 2fr) 80px 110px 80px 120px 100px 130px',
              px: 2, py: 1.5, gap: 1,
              borderBottom: `1px solid ${theme.palette.divider}`,
              alignItems: 'center',
              '&:nth-of-type(even)': { bgcolor: '#fbfcff' },
            }}>
              <Typography sx={{ color: 'text.disabled', fontSize: '0.78rem' }}>{i + 1}</Typography>
              <Box>
                <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: '0.82rem', color: theme.palette.primary.dark }}>
                  {l.skuCode}
                </Typography>
                <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary' }}>
                  {l.skuName}
                  {l.source === 'MANUAL' && (
                    <Chip size="small" label="MANUAL" sx={{
                      ml: 1, height: 16, fontSize: '0.6rem', fontWeight: 800,
                      color: theme.palette.warning.dark, bgcolor: alpha(theme.palette.warning.main, 0.10),
                    }} />
                  )}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtInt(l.qty)}</Typography>
              <Typography sx={{ fontSize: '0.86rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtINR(l.unitPrice)}</Typography>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', textAlign: 'right' }}>{l.gstRate}%</Typography>
              <Typography sx={{ fontSize: '0.86rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtINR(l.lineSubtotal)}</Typography>
              <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtINR(l.lineGst)}</Typography>
              <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: theme.palette.primary.dark }}>{fmtINR(l.lineTotal)}</Typography>
            </Box>
          ))}
        </Paper>

        <Paper sx={{ p: 2.5, borderRadius: 3, mb: 4 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
            <Box sx={{ flex: 1 }}>
              {q.notes && (
                <>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: 'text.secondary', letterSpacing: '0.08em', textTransform: 'uppercase', mb: 0.5 }}>
                    Notes
                  </Typography>
                  <Typography sx={{ fontSize: '0.86rem', whiteSpace: 'pre-wrap' }}>{q.notes}</Typography>
                </>
              )}
            </Box>
            <Stack spacing={0.5} sx={{ minWidth: 300 }}>
              <Stack direction="row" justifyContent="space-between">
                <Typography sx={{ fontSize: '0.84rem', color: 'text.secondary' }}>Subtotal</Typography>
                <Typography sx={{ fontSize: '0.94rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtINR(q.totals.subtotal)}</Typography>
              </Stack>
              {Object.entries(q.gstBreakdown || {}).map(([rate, amt]) => (
                <Stack key={rate} direction="row" justifyContent="space-between" sx={{ pl: 1.5 }}>
                  <Typography sx={{ fontSize: '0.76rem', color: 'text.disabled' }}>@ {rate}%</Typography>
                  <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{fmtINR(amt)}</Typography>
                </Stack>
              ))}
              <Stack direction="row" justifyContent="space-between">
                <Typography sx={{ fontSize: '0.84rem', color: 'text.secondary' }}>GST total</Typography>
                <Typography sx={{ fontSize: '0.94rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: theme.palette.warning.dark }}>+ {fmtINR(q.totals.gstTotal)}</Typography>
              </Stack>
              <Divider sx={{ my: 0.75 }} />
              <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                <Typography sx={{ fontSize: '0.86rem', fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Grand Total
                </Typography>
                <Typography sx={{ fontSize: '1.5rem', fontWeight: 800, color: theme.palette.primary.dark, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtINR(q.totals.grandTotal)}
                </Typography>
              </Stack>
            </Stack>
          </Stack>

          {can('quotes.delete') && q.status !== 'CONVERTED_TO_SO' && (
            <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
              <Button size="small" color="error" startIcon={<Trash2 size={14} />} onClick={handleDelete} sx={{ fontWeight: 700, textTransform: 'none' }}>
                Delete quote
              </Button>
            </Stack>
          )}
        </Paper>
      </Box>
    </Box>
  );
};

export default QuoteDetail;
