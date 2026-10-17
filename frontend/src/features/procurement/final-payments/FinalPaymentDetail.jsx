import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import {
  Box, Typography, Paper, Grid, Button, IconButton, CircularProgress, Chip,
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

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary', mb: 0.25 }}>{label}</Typography>
    <Typography sx={{ fontWeight: 600, color: 'text.primary', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);
const SectionCard = ({ icon, title, children }) => (
  <Paper sx={{ ...pfmsCardSx, p: 3 }}>
    <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, color: 'primary.main', mb: 2 }}>{icon} {title}</Typography>
    {children}
  </Paper>
);

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
    <Box sx={{ ...pfmsPageSx, p: { xs: 1.5, md: 2.5 } }}>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={goBack} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}` }}><ArrowLeft size={20} /></IconButton>
        <Box sx={{ width: 46, height: 46, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main' }}><Wallet size={24} /></Box>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: PFMS.ink }}>{p.paymentNumber}</Typography>
            <PaymentStatusChip status={p.paymentStatus} />
          </Box>
          <Typography variant="body2" color="text.secondary">{p.vendorName} · Voucher {p.voucherNumber || '—'} · {fmtDate(p.paymentDate)}</Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <FileDown size={16} />} onClick={handleReceipt} disabled={generating}>
            {p.paymentPdfUrl ? 'Receipt PDF' : 'Generate Receipt'}
          </Button>
          {p.voucherId && <Button variant="outlined" startIcon={<Banknote size={16} />} onClick={() => navigate(`/procurement/vouchers/${p.voucherId}`)}>View Voucher</Button>}
          {p.proofDocument?.fileUrl && <Button variant="outlined" startIcon={<ExternalLink size={16} />} href={fileHref(p.proofDocument.fileUrl)} target="_blank" rel="noopener">Proof</Button>}
          {p.paymentStatus !== 'CANCELLED' && <Button variant="outlined" color="error" startIcon={<Ban size={16} />} onClick={handleCancel} disabled={cancelling}>Cancel</Button>}
        </Box>
      </Box>

      <NextStepBanner step={nextStep} />

      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <SectionCard icon={<Wallet size={18} />} title="Payment">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}><Field label="Status" value={<PaymentStatusChip status={p.paymentStatus} />} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Payment Date" value={fmtDate(p.paymentDate)} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Mode" value={paymentModeLabel(p.paymentMode)} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Reference No" value={p.paymentReferenceNumber || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Performed By" value={p.performedByName || '—'} /></Grid>
              <Grid item xs={12} sm={4}>
                <Field label="Proof" value={p.proofDocument?.fileUrl
                  ? <Button size="small" startIcon={<ExternalLink size={13} />} href={fileHref(p.proofDocument.fileUrl)} target="_blank" rel="noopener">{p.proofDocument.fileName || 'View'}</Button>
                  : '—'} />
              </Grid>
              {p.remarks ? <Grid item xs={12}><Field label="Remarks" value={p.remarks} /></Grid> : null}
            </Grid>
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={5}>
          <SectionCard icon={<ReceiptText size={18} />} title="Settlement">
            <Grid container spacing={2}>
              <Grid item xs={6}><Field label="Previous Balance" value={fmtINR(p.previousBalance)} /></Grid>
              <Grid item xs={6}><Field label="Paid Amount" value={fmtINR(p.paidAmount)} /></Grid>
              <Grid item xs={6}><Field label="Balance After" value={fmtINR(p.balanceAfterPayment)} /></Grid>
              <Grid item xs={6}><Field label="Invoice" value={p.invoiceNumber || '—'} /></Grid>
            </Grid>
            <Box sx={{ mt: 2, p: 2, borderRadius: '12px', bgcolor: alpha('#16a34a', 0.05), display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
              <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>PAID</Typography><Typography variant="h6" fontWeight={800} sx={{ color: '#16a34a' }}>{fmtINR(p.paidAmount)}</Typography></Box>
              <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>BALANCE</Typography><Typography variant="h6" fontWeight={800} sx={{ color: p.balanceAfterPayment > 0 ? '#b45309' : '#16a34a' }}>{fmtINR(p.balanceAfterPayment)}</Typography></Box>
            </Box>
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={5}>
          <SectionCard icon={<Building2 size={18} />} title="Vendor & Linkage">
            <Grid container spacing={2}>
              <Grid item xs={6}><Field label="Vendor" value={p.vendorName || '—'} /></Grid>
              <Grid item xs={6}><Field label="Voucher" value={p.voucherNumber || '—'} /></Grid>
              <Grid item xs={6}><Field label="Invoice" value={p.invoiceNumber || '—'} /></Grid>
              <Grid item xs={6}><Field label="PO" value={p.poNumber || '—'} /></Grid>
            </Grid>
          </SectionCard>
        </Grid>

        {p.activityTimeline?.length ? (
          <Grid item xs={12} md={7}>
            <SectionCard icon={<FileText size={18} />} title="Timeline">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[...p.activityTimeline].reverse().map((ev, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Chip size="small" label={ev.action} sx={{ fontWeight: 700, minWidth: 90 }} />
                    <Typography variant="body2" color="text.secondary">{ev.description}</Typography>
                    <Box sx={{ flexGrow: 1 }} />
                    <Typography variant="caption" color="text.disabled">{fmtDate(ev.timestamp)}</Typography>
                  </Box>
                ))}
              </Box>
            </SectionCard>
          </Grid>
        ) : null}
      </Grid>

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
