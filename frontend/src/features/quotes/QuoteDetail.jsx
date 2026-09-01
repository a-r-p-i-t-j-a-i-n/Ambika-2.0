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
import { PageHero, pageSx, panelSx, btnSx, primaryBtnSx, ghostBtnSx, BRAND, BRAND_DK, NAVY, DANGER, O2D } from '../../components/pageKit';

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
        <Skeleton variant="rectangular" height={200} sx={{ borderRadius: '10px', mb: 2 }} />
        <Skeleton variant="rectangular" height={400} sx={{ borderRadius: '10px' }} />
      </Box>
    );
  }

  const m = statusMeta[q.status] || statusMeta.DRAFT;
  const daysLeft = dayjs(q.validUntil).diff(dayjs(), 'day');
  const isExpired = daysLeft < 0;

  // Lean, professional line table: per-line Subtotal / GST ₹ live in the
  // summary box below, so we don't repeat them per row (that's what made the
  // table overflow). GST column hidden for "basic" (no-GST) quotes.
  const showGst = q.pdfIncludeGst !== false;
  const GRID_COLS = showGst
    ? '40px minmax(200px, 2.2fr) 100px 120px 64px 160px'
    : '40px minmax(220px, 2.4fr) 110px 130px 170px';
  const TABLE_MIN_W = showGst ? 760 : 700;
  const totalQty = q.lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
  const colHeaders = showGst
    ? ['#', 'SKU', 'Qty', 'Unit ₹', 'GST', 'Amount']
    : ['#', 'SKU', 'Qty', 'Unit ₹', 'Amount'];

  return (
    <Box sx={pageSx}>
      {/* Breadcrumb back-link — its own row so the quote number owns the title line. */}
      <Stack direction="row" spacing={0.75} alignItems="center">
        <IconButton onClick={() => navigate('/quotes')} size="small"
          sx={{ color: O2D.sub, border: `1px solid ${O2D.line}`, borderRadius: '6px', bgcolor: O2D.surface, '&:hover': { color: BRAND, borderColor: alpha(BRAND, 0.4) } }}>
          <ArrowLeft size={16} />
        </IconButton>
        <Typography sx={{ color: O2D.sub, fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Quotation
        </Typography>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'flex-end' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.25, flexWrap: 'wrap' }}>
            <Typography sx={{ color: NAVY, fontSize: { xs: '1.25rem', md: '1.5rem' }, fontWeight: 800, letterSpacing: '-0.02em', fontFamily: 'ui-monospace, monospace' }}>
              {q.quoteNumber}
            </Typography>
            <Chip
              label={m.label}
              size="small"
              sx={{
                height: 22, fontWeight: 800, fontSize: '0.68rem',
                bgcolor: alpha(m.color || BRAND, 0.1), color: m.color || BRAND_DK,
                border: `1px solid ${alpha(m.color || BRAND, 0.22)}`,
              }}
            />
          </Stack>
          <Typography sx={{ color: O2D.body, fontSize: '0.88rem', fontWeight: 700 }}>
            {q.partyName || '—'}{q.poReference ? ` · PO ${q.poReference}` : ''}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 0.5, color: O2D.sub, fontSize: '0.74rem', flexWrap: 'wrap' }}>
            <span>As of {dayjs(q.asOfDate).format('DD MMM YYYY')}</span>
            <span>·</span>
            <span style={{ color: isExpired ? DANGER : O2D.sub, fontWeight: isExpired ? 800 : 400 }}>
              Valid until {dayjs(q.validUntil).format('DD MMM YYYY')} ({isExpired ? `expired ${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`})
            </span>
          </Stack>
        </Box>

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Tooltip title="Open PDF in new tab">
            <Button startIcon={<Download size={14} />} onClick={openPdf} variant="outlined" sx={ghostBtnSx}>
              View PDF
            </Button>
          </Tooltip>

          <Button startIcon={<Share2 size={14} />} onClick={(e) => setShareAnchor(e.currentTarget)} variant="outlined" sx={ghostBtnSx}>
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
              variant="outlined" sx={ghostBtnSx}>
              Edit draft
            </Button>
          )}
          {/* Mark sent is the expected next step on a draft, so it carries the
              brand fill; Accept / Reject stay semantic green / red. */}
          {q.status === 'DRAFT' && (
            <Button startIcon={<Send size={14} />} onClick={() => handleAction(sendQuote, 'Quote marked as sent')}
              variant="contained" sx={primaryBtnSx}>
              Mark sent
            </Button>
          )}
          {['SENT', 'DRAFT'].includes(q.status) && (
            <Button startIcon={<CheckCircle2 size={14} />} onClick={() => handleAction(acceptQuote, 'Quote accepted')}
              variant="contained"
              sx={{ ...btnSx, bgcolor: '#15803d', '&:hover': { bgcolor: '#166534', boxShadow: 'none' } }}>
              Accept
            </Button>
          )}
          {['SENT', 'DRAFT'].includes(q.status) && (
            <Button startIcon={<ShieldOff size={14} />} onClick={handleReject}
              variant="outlined"
              sx={{ ...btnSx, color: DANGER, borderColor: alpha(DANGER, 0.35), bgcolor: O2D.surface, '&:hover': { borderColor: DANGER, bgcolor: alpha(DANGER, 0.06) } }}>
              Reject
            </Button>
          )}
        </Stack>
      </Stack>

      {/* Body */}
      <Box sx={{ position: 'relative' }}>
        <Paper sx={{ ...panelSx, mb: 1.5 }}>
          <Box sx={{ overflowX: 'auto' }}>
          <Box sx={{ minWidth: TABLE_MIN_W }}>
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: GRID_COLS,
            bgcolor: alpha(theme.palette.primary.main, 0.04),
            px: 2, py: 1.25, gap: 1,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}>
            {colHeaders.map((h, i) => (
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
              gridTemplateColumns: GRID_COLS,
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
              {showGst && (
                <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', textAlign: 'right' }}>{l.gstRate}%</Typography>
              )}
              <Typography sx={{ fontSize: '0.92rem', fontWeight: 800, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: theme.palette.primary.dark }}>{fmtINR(showGst ? l.lineTotal : l.lineSubtotal)}</Typography>
            </Box>
          ))}

          {/* Column totals — Qty total sits under the QTY column, in bold. */}
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: GRID_COLS,
            px: 2, py: 1.5, gap: 1, alignItems: 'center',
            bgcolor: alpha(theme.palette.primary.main, 0.05),
            borderTop: `2px solid ${theme.palette.primary.main}`,
          }}>
            <Box />
            <Typography sx={{
              fontSize: '0.74rem', fontWeight: 800, color: 'text.secondary',
              letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: 'right',
            }}>
              Total Quantity
            </Typography>
            <Typography sx={{
              fontSize: '0.95rem', fontWeight: 800, textAlign: 'right',
              fontVariantNumeric: 'tabular-nums', color: theme.palette.primary.dark,
            }}>
              {fmtInt(totalQty)}
            </Typography>
            {/* Fill remaining columns so the grid stays single-row. */}
            {Array.from({ length: showGst ? 3 : 2 }).map((_, i) => <Box key={i} />)}
          </Box>
          </Box>
          </Box>
        </Paper>

        <Paper sx={{ ...panelSx, p: 2.5, mb: 2 }}>
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
