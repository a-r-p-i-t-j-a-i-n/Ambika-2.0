import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import {
  Box, Typography, Paper, Button, IconButton, CircularProgress, Chip, Tooltip,
} from '@mui/material';
import {
  ArrowLeft, Ban, Wallet, Building2, FileText, Banknote, ReceiptText, ExternalLink, FileDown,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useSnackbar } from 'notistack';
import {
  useGetFinalPaymentByIdQuery,
  useCancelFinalPaymentMutation,
  useGenerateFinalPaymentPdfMutation,
} from '../../../store/api/procurementApi';
import { fileHref } from '../indents/indentMeta';
import { PaymentStatusChip, paymentModeLabel, fmtINR, fmtDate } from './paymentMeta';
import PdfViewerModal from '../common/PdfViewerModal';
import NextStepBanner from '../components/NextStepBanner';
import { PFMS, pfmsPageSx, pfmsCardSx } from '../pfmsTheme';

// ── Same spacing/typography scale as Indent, PO, Follow-up and GRN Detail
// (SECTION_GAP/CARD_PAD/Field/FieldGrid/SectionCard), replacing the older
// p:3 cards and the 7/5 then 5/7 Grid that zig-zagged the card edges. ──
const SECTION_GAP = 2;
const CARD_PAD = 2;

const Field = ({ label, value, sx }) => (
  <Box sx={{ minWidth: 0, ...sx }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: PFMS.sub, mb: 0.4 }}>{label}</Typography>
    {/* div, not p: Status and Proof values are a chip / a button */}
    <Typography component="div" sx={{ fontSize: '0.86rem', fontWeight: 600, color: PFMS.ink, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);

// Explicit column counts per breakpoint instead of auto-fill: with 6 / 4
// fields auto-fill left a lone field on a second row (3+1) at laptop widths.
// The counts divide each card's fields evenly and keep the paired cards'
// heights close (Payment 2-up at lg ≈ Settlement 2-up + its totals band).
const PAYMENT_COLS = { xs: 2, sm: 3, lg: 2, xl: 3 };
const FOUR_FIELD_COLS = { xs: 2, md: 4, lg: 2, xl: 4 };
const FieldGrid = ({ cols, children }) => (
  <Box sx={{
    display: 'grid', gap: 2,
    gridTemplateColumns: Object.fromEntries(Object.entries(cols).map(([bp, n]) => [bp, `repeat(${n}, minmax(0, 1fr))`])),
  }}>
    {children}
  </Box>
);
const FULL_ROW = { gridColumn: '1 / -1' };

// Column flex + height 100%: cards sharing a grid row end on the same line.
const SectionCard = ({ icon, title, children }) => (
  <Paper sx={{ ...pfmsCardSx, p: CARD_PAD, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
    <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, fontWeight: 700, fontSize: '0.92rem', color: 'primary.main' }}>
      {icon} {title}
    </Typography>
    {children}
  </Paper>
);

// Two equal columns from lg (same breakpoint as GRN Detail), stacked below.
// Payment | Settlement, then Vendor & Linkage | Timeline, so both rows share
// one column line.
const cardGridSx = { display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' }, gap: SECTION_GAP };

const FinalPaymentDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack('/purchase-fms/final-payments');
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading } = useGetFinalPaymentByIdQuery(id);
  const p = data?.data;
  const [cancelPayment, { isLoading: cancelling }] = useCancelFinalPaymentMutation();
  const [genPdf, { isLoading: generating }] = useGenerateFinalPaymentPdfMutation();
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptUrl, setReceiptUrl] = useState('');

  if (isLoading) return <Box sx={{ display: 'grid', placeItems: 'center', height: '70vh' }}><CircularProgress /></Box>;
  if (!p) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6">Payment not found</Typography>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/purchase-fms/final-payments')}>Back to list</Button>
      </Box>
    );
  }

  const handleCancel = async () => {
    try { await cancelPayment({ id: p._id }).unwrap(); enqueueSnackbar('Payment cancelled — amount reversed', { variant: 'info' }); }
    catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to cancel', { variant: 'error' }); }
  };

  // ── "What's next?" — Final Payment is the last Purchase FMS step: there is
  // no further entity to create. A remaining balance loops back to the
  // Voucher (where the next payment is recorded); no balance means the
  // workflow is finished for this voucher. ──
  const nextStep = (() => {
    if (!p.voucherId) return null;
    if (p.paymentStatus === 'CANCELLED') {
      return { tone: 'info', title: 'Payment cancelled — amount reversed',
        desc: 'The balance has been restored on the voucher. Record a new payment there if needed.',
        primary: { label: 'View Voucher', icon: <Banknote size={16} />, onClick: () => navigate(`/procurement/vouchers/${p.voucherId}`) } };
    }
    if (Number(p.balanceAfterPayment) > 0) {
      return { tone: 'warn', title: 'Balance remains — continue on the voucher',
        desc: `${fmtINR(p.balanceAfterPayment)} is still pending. Record the next payment from the voucher.`,
        primary: { label: 'Go to Voucher', icon: <Banknote size={16} />, onClick: () => navigate(`/procurement/vouchers/${p.voucherId}`) } };
    }
    return { tone: 'success', title: 'Workflow complete — voucher fully settled',
      desc: 'No further payment is due for this voucher.',
      primary: { label: 'View Voucher', icon: <Banknote size={16} />, onClick: () => navigate(`/procurement/vouchers/${p.voucherId}`) } };
  })();

  // Open the stored receipt in the modal, or generate one on demand (e.g. older payments).
  const handleReceipt = async () => {
    if (p.paymentPdfUrl) { setReceiptUrl(p.paymentPdfUrl); setReceiptOpen(true); return; }
    setReceiptUrl('');
    setReceiptOpen(true);
    try {
      const res = await genPdf({ id: p._id }).unwrap();
      const url = res?.data?.paymentPdfUrl;
      if (url) setReceiptUrl(url);
      else { setReceiptOpen(false); enqueueSnackbar('Receipt generated', { variant: 'success' }); }
    } catch (err) {
      setReceiptOpen(false);
      enqueueSnackbar(err?.data?.message || 'Failed to generate receipt', { variant: 'error' });
    }
  };

  return (
    <Box sx={{ ...pfmsPageSx }}>
      {/* Hero — same sizes as the other detail pages. The identity block has an
          explicit flex basis so a long vendor name wraps inside it instead of
          pushing the actions around. */}
      <Box sx={{ mb: SECTION_GAP, display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1.5, flexWrap: 'wrap' }}>
        <Tooltip title="Back">
          <IconButton onClick={goBack} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}`, width: 38, height: 38 }}><ArrowLeft size={18} /></IconButton>
        </Tooltip>
        <Box sx={{ width: 38, height: 38, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main', flexShrink: 0 }}><Wallet size={20} /></Box>
        <Box sx={{ flex: { xs: '1 1 200px', md: '1 1 360px' }, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: PFMS.ink }}>{p.paymentNumber}</Typography>
            <PaymentStatusChip status={p.paymentStatus} />
          </Box>
          <Typography variant="body2" sx={{ color: PFMS.sub, overflowWrap: 'anywhere' }}>{p.vendorName} · Voucher {p.voucherNumber || '—'} · {fmtDate(p.paymentDate)}</Typography>
        </Box>
        <Box sx={{
          display: 'flex', gap: 1, flexWrap: 'wrap', width: { xs: '100%', sm: 'auto' },
          '& .MuiButtonBase-root': { flex: { xs: '1 1 auto', sm: '0 0 auto' } },
        }}>
          <Button variant="contained" startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <FileDown size={16} />} onClick={handleReceipt} disabled={generating}>
            {p.paymentPdfUrl ? 'Receipt PDF' : 'Generate Receipt'}
          </Button>
          {p.voucherId && <Button variant="outlined" startIcon={<Banknote size={16} />} onClick={() => navigate(`/procurement/vouchers/${p.voucherId}`)}>View Voucher</Button>}
          {p.proofDocument?.fileUrl && <Button variant="outlined" startIcon={<ExternalLink size={16} />} href={fileHref(p.proofDocument.fileUrl)} target="_blank" rel="noopener">Proof</Button>}
          {p.paymentStatus !== 'CANCELLED' && <Button variant="outlined" color="error" startIcon={<Ban size={16} />} onClick={handleCancel} disabled={cancelling}>Cancel</Button>}
        </Box>
      </Box>

      <NextStepBanner step={nextStep} />

      <Box sx={cardGridSx}>
        <SectionCard icon={<Wallet size={18} />} title="Payment">
          <FieldGrid cols={PAYMENT_COLS}>
            <Field label="Status" value={<PaymentStatusChip status={p.paymentStatus} />} />
            <Field label="Payment Date" value={fmtDate(p.paymentDate)} />
            <Field label="Mode" value={paymentModeLabel(p.paymentMode)} />
            <Field label="Reference No" value={p.paymentReferenceNumber || '—'} />
            <Field label="Performed By" value={p.performedByName || '—'} />
            <Field label="Proof" value={p.proofDocument?.fileUrl
              ? <Button size="small" startIcon={<ExternalLink size={13} />} href={fileHref(p.proofDocument.fileUrl)} target="_blank" rel="noopener">{p.proofDocument.fileName || 'View'}</Button>
              : '—'} />
            {p.remarks ? <Field label="Remarks" value={p.remarks} sx={FULL_ROW} /> : null}
          </FieldGrid>
        </SectionCard>

        <SectionCard icon={<ReceiptText size={18} />} title="Settlement">
          <FieldGrid cols={FOUR_FIELD_COLS}>
            <Field label="Previous Balance" value={fmtINR(p.previousBalance)} />
            <Field label="Paid Amount" value={fmtINR(p.paidAmount)} />
            <Field label="Balance After" value={fmtINR(p.balanceAfterPayment)} />
            <Field label="Invoice" value={p.invoiceNumber || '—'} />
          </FieldGrid>
          {/* mt auto: the totals band sits on the card's bottom edge when the
              row is stretched by a taller Payment card (e.g. long remarks). */}
          <Box sx={{ mt: 'auto', pt: 1.5 }}>
            <Box sx={{ px: 2, py: 1.25, borderRadius: '8px', bgcolor: alpha('#16a34a', 0.05), display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
              <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>PAID</Typography><Typography variant="h6" fontWeight={800} sx={{ color: '#16a34a', lineHeight: 1.3 }}>{fmtINR(p.paidAmount)}</Typography></Box>
              <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>BALANCE</Typography><Typography variant="h6" fontWeight={800} sx={{ color: p.balanceAfterPayment > 0 ? '#b45309' : '#16a34a', lineHeight: 1.3 }}>{fmtINR(p.balanceAfterPayment)}</Typography></Box>
            </Box>
          </Box>
        </SectionCard>

        {/* Full row when there is no timeline, so it never sits beside a hole. */}
        <Box sx={{ minWidth: 0, ...(p.activityTimeline?.length ? {} : FULL_ROW) }}>
          <SectionCard icon={<Building2 size={18} />} title="Vendor & Linkage">
            <FieldGrid cols={FOUR_FIELD_COLS}>
              <Field label="Vendor" value={p.vendorName || '—'} />
              <Field label="Voucher" value={p.voucherNumber || '—'} />
              <Field label="Invoice" value={p.invoiceNumber || '—'} />
              <Field label="PO" value={p.poNumber || '—'} />
            </FieldGrid>
          </SectionCard>
        </Box>

        {p.activityTimeline?.length ? (
          <SectionCard icon={<FileText size={18} />} title="Timeline">
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {[...p.activityTimeline].reverse().map((ev, i) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Chip size="small" label={ev.action} sx={{ fontWeight: 700, minWidth: 90, flexShrink: 0 }} />
                  {/* flex 1 + minWidth 0: a long description wraps instead of
                      pushing the date out of the half-width card */}
                  <Typography variant="body2" color="text.secondary" sx={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' }}>{ev.description}</Typography>
                  <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>{fmtDate(ev.timestamp)}</Typography>
                </Box>
              ))}
            </Box>
          </SectionCard>
        ) : null}
      </Box>

      <PdfViewerModal
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        url={receiptUrl}
        loading={generating && !receiptUrl}
        title={`Payment Receipt — ${p.paymentNumber}`}
        fileName={p.paymentPdfFileName}
      />
    </Box>
  );
};

export default FinalPaymentDetail;
