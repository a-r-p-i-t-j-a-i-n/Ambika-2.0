import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import { useSelector } from 'react-redux';
import {
  Box, Typography, Paper, Grid, Button, IconButton, CircularProgress, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from '@mui/material';
import {
  ArrowLeft, Pencil, Send, Ban, Banknote, Building2, FileText, ReceiptText,
  FileSpreadsheet, Wallet, Info, Download, Eye,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useSnackbar } from 'notistack';
import {
  useGetVoucherByIdQuery,
  usePostVoucherMutation,
  useCancelVoucherMutation,
  useGenerateVoucherPdfMutation,
  useGetTallyEntriesByVoucherQuery,
  useGetFinalPaymentsByVoucherQuery,
} from '../../../store/api/procurementApi';
import { VoucherStatusChip, VoucherTypeChip, fmtINR, fmtDate } from './voucherMeta';
import { resolveFileUrl } from '../../../utils/fileUrl';
import StatusChip from '../components/StatusChip';
import { PFMS, pfmsPageSx, pfmsCardSx } from '../pfmsTheme';
import VoucherFormDialog from './VoucherFormDialog';
import VoucherPdfPreview from './VoucherPdfPreview';
import TallyEntryFormDialog from '../tally-entry/TallyEntryFormDialog';
import { TallyStatusChip, CHECKLIST_TOTAL, checklistProgress } from '../tally-entry/tallyMeta';
import FinalPaymentFormDialog from '../final-payments/FinalPaymentFormDialog';
import { PaymentStatusChip } from '../final-payments/paymentMeta';
import WorkflowStepper from '../components/WorkflowStepper';
import { resolveWorkflowSteps } from '../components/purchaseFmsWorkflow';
import MdApprovalCard from '../approvals/MdApprovalCard';
import FmsDoerCard from '../../fms-doers/FmsDoerCard';

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

const VoucherDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack('/purchase-fms/payment-vouchers');
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading } = useGetVoucherByIdQuery(id);
  const v = data?.data;
  const wfSteps = resolveWorkflowSteps({ voucher: v });
  const isMd = useSelector((s) => s.auth.isRoot);

  const [formOpen, setFormOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [previewVoucher, setPreviewVoucher] = useState(null);

  const [postVoucher, { isLoading: posting }] = usePostVoucherMutation();
  const [cancelVoucher, { isLoading: cancelling }] = useCancelVoucherMutation();
  const [generatePdf, { isLoading: pdfLoading }] = useGenerateVoucherPdfMutation();

  const [cancelRemarks, setCancelRemarks] = useState('');

  const [tallyFormOpen, setTallyFormOpen] = useState(false);
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);

  const posted = v && ['POSTED', 'PARTIALLY_PAID', 'FULLY_PAID', 'SHORT_CLOSED'].includes(v.voucherStatus);
  const { data: tallyRes } = useGetTallyEntriesByVoucherQuery(id, { skip: !posted });
  const tallyEntry = (tallyRes?.data || [])[0] || null;
  const tallyCompleted = v?.tallyEntryStatus === 'COMPLETED';
  const { data: payRes } = useGetFinalPaymentsByVoucherQuery(id, { skip: !tallyCompleted });
  const payments = (payRes?.data || []).filter((x) => x.paymentStatus !== 'CANCELLED');
  const totalPaid = payments.reduce((s, x) => s + Number(x.paidAmount || 0), 0);
  const lastPayment = payments[0] || null;

  if (isLoading) return <Box sx={{ display: 'grid', placeItems: 'center', height: '70vh' }}><CircularProgress /></Box>;
  if (!v) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6">Voucher not found</Typography>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/purchase-fms/payment-vouchers')}>Back to list</Button>
      </Box>
    );
  }

  const isDraft = v.voucherStatus === 'DRAFT';
  const isExpense = v.voucherType === 'EXPENSE';
  // MD-signed vouchers are locked — editing/cancelling/posting is blocked here
  // (mirrors the backend guard in voucher.service.js).
  const isLocked = v.approvalStatus === 'MD_APPROVED';

  const doDownloadPdf = async () => {
    try {
      const url = (await generatePdf({ id: v._id }).unwrap())?.data?.voucherPdfUrl;
      if (url) window.open(resolveFileUrl(url), '_blank', 'noopener');
      else enqueueSnackbar('PDF not available', { variant: 'warning' });
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to generate PDF', { variant: 'error' }); }
  };

  // Preview must work before MD signature too. The voucher's own `voucherPdfUrl`
  // is only populated once a PDF has actually been generated (via Download, or
  // by the MD-signing step) — an unsigned voucher previewed for the first time
  // would otherwise show "not available", which looks like preview requires a
  // signature. Generating first (same call Download makes) fixes that; the
  // backend's generatePdf is safe to call pre-signature — it never signs, never
  // changes approval/financial state, and for an already MD-approved voucher it
  // just returns the existing signed PDF untouched instead of re-rendering it.
  const doPreviewPdf = async () => {
    try {
      const res = await generatePdf({ id: v._id }).unwrap();
      setPreviewVoucher({
        ...v,
        voucherPdfUrl: res?.data?.voucherPdfUrl || v.voucherPdfUrl,
        voucherPdfFileName: res?.data?.voucherPdfFileName || v.voucherPdfFileName,
      });
      setPdfPreviewOpen(true);
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to generate PDF', { variant: 'error' }); }
  };

  // Step 1.11 = passing / approval only (no payment). Moves DRAFT → POSTED so the
  // Tally Entry can be raised; payment is recorded later in Step 1.13.
  const doApprove = async () => {
    try {
      await postVoucher({ id: v._id }).unwrap();
      enqueueSnackbar('Voucher posted — pending final payment', { variant: 'success' });
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to post voucher', { variant: 'error' }); }
  };

  const doCancel = async () => {
    try {
      await cancelVoucher({ id: v._id, remarks: cancelRemarks.trim() || undefined }).unwrap();
      enqueueSnackbar('Voucher cancelled', { variant: 'info' });
      setCancelOpen(false);
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to cancel', { variant: 'error' }); }
  };

  return (
    <Box sx={{ ...pfmsPageSx, p: { xs: 1.5, md: 2.5 } }}>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={goBack} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}` }}><ArrowLeft size={20} /></IconButton>
        <Box sx={{ width: 46, height: 46, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main' }}><Banknote size={24} /></Box>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="h5" fontWeight={800}>{v.voucherNumber}</Typography>
            <VoucherTypeChip type={v.voucherType} />
            <VoucherStatusChip status={v.voucherStatus} />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {isExpense
              ? `${v.expenseCategory || 'Expense'} · ${v.partyName || v.vendorName || '—'} · ${fmtDate(v.voucherDate)}`
              : `${v.vendorName} · Invoice ${v.invoiceNumber || '—'} · ${fmtDate(v.voucherDate)}`}
          </Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={pdfLoading ? <CircularProgress size={16} /> : <Eye size={16} />} onClick={doPreviewPdf} disabled={pdfLoading}>{isLocked ? 'View Signed PDF' : 'Preview PDF'}</Button>
          <Button variant="outlined" startIcon={pdfLoading ? <CircularProgress size={16} /> : <Download size={16} />} onClick={doDownloadPdf} disabled={pdfLoading}>Download PDF</Button>
          {v.invoiceId && <Button variant="outlined" startIcon={<ReceiptText size={16} />} onClick={() => navigate(`/procurement/vendor-invoices/${v.invoiceId}`)}>View Invoice</Button>}
          {isDraft && !isLocked && <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setFormOpen(true)}>Edit</Button>}
          {isDraft && !isLocked && <Button variant="outlined" color="error" startIcon={<Ban size={16} />} onClick={() => setCancelOpen(true)}>Cancel</Button>}
          {isDraft && !isLocked && <Button variant="contained" color="success" startIcon={posting ? <CircularProgress size={16} color="inherit" /> : <Send size={16} />} onClick={doApprove} disabled={posting}>Post Voucher</Button>}
        </Box>
      </Box>

      <FmsDoerCard entityType="VOUCHER" entityId={id} />
      <WorkflowStepper steps={wfSteps} sx={{ mb: 3 }} />
      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <SectionCard icon={<Wallet size={18} />} title="Payment Status">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
              {v.finalPaymentStatus && v.finalPaymentStatus !== 'PENDING'
                ? <PaymentStatusChip status={v.finalPaymentStatus} />
                : <StatusChip status="PENDING" label="Pending Final Payment" />}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, p: 1.5, borderRadius: '10px', bgcolor: alpha('#1d4ed8', 0.05) }}>
              <Info size={16} color="#1d4ed8" style={{ marginTop: 2, flexShrink: 0 }} />
              <Typography variant="body2" color="text.secondary">
                This step only passes / approves the voucher — no payment is recorded here.
                The actual vendor payment will be recorded in <b>Step 1.13 — Final Payment</b>.
              </Typography>
            </Box>
            {v.remarks ? <Box sx={{ mt: 1.5 }}><Field label="Remarks" value={v.remarks} /></Box> : null}
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={5}>
          <SectionCard icon={<Building2 size={18} />} title={isExpense ? 'Expense & Party' : 'Vendor & Linkage'}>
            <Grid container spacing={2}>
              {isExpense ? (
                <>
                  <Grid item xs={6}><Field label="Party" value={v.partyName || v.vendorName || '—'} /></Grid>
                  <Grid item xs={6}><Field label="Category" value={v.expenseCategory || '—'} /></Grid>
                  <Grid item xs={6}><Field label="Invoice No" value={v.expenseInvoiceNo || '—'} /></Grid>
                  <Grid item xs={6}><Field label="Invoice Date" value={fmtDate(v.expenseInvoiceDate)} /></Grid>
                  <Grid item xs={6}><Field label="Payment Terms" value={v.paymentTerms || '—'} /></Grid>
                  <Grid item xs={6}><Field label="Due Date" value={fmtDate(v.dueDate)} /></Grid>
                  {v.invoiceDocument?.fileUrl && (
                    <Grid item xs={12}>
                      <Button size="small" variant="outlined" startIcon={<FileText size={15} />} href={resolveFileUrl(v.invoiceDocument.fileUrl)} target="_blank" rel="noopener">View Invoice File</Button>
                    </Grid>
                  )}
                </>
              ) : (
                <>
                  <Grid item xs={6}><Field label="Vendor" value={v.vendorName || '—'} /></Grid>
                  <Grid item xs={6}><Field label="Invoice" value={v.invoiceNumber || '—'} /></Grid>
                  <Grid item xs={6}><Field label="PO" value={v.poNumber || '—'} /></Grid>
                  <Grid item xs={6}><Field label="Status" value={<VoucherStatusChip status={v.voucherStatus} />} /></Grid>
                  <Grid item xs={12}><Field label={`GRN${(v.grnNumbers || []).length > 1 ? 's' : ''}`} value={(v.grnNumbers || []).join(', ') || '—'} /></Grid>
                </>
              )}
            </Grid>
          </SectionCard>
        </Grid>

        <Grid item xs={12}>
          <SectionCard icon={<ReceiptText size={18} />} title="Financials">
            {isExpense ? (
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}><Field label="Basic Value" value={fmtINR(v.basicValue)} /></Grid>
                <Grid item xs={6} sm={3}><Field label="Freight" value={fmtINR(v.freightCharges)} /></Grid>
                <Grid item xs={6} sm={3}><Field label="Packing & Fwd" value={fmtINR(v.packingForwardingCharges)} /></Grid>
                <Grid item xs={6} sm={3}><Field label="Other Charges" value={fmtINR(v.otherCharges)} /></Grid>
                <Grid item xs={6} sm={3}><Field label="Tax Amount" value={fmtINR(v.taxAmount)} /></Grid>
                <Grid item xs={6} sm={3}><Field label="TCS (+)" value={fmtINR(v.tcsAmount)} /></Grid>
                <Grid item xs={6} sm={3}><Field label="TDS (−)" value={fmtINR(v.tdsAmount)} /></Grid>
                <Grid item xs={6} sm={3}><Field label="Advance (−)" value={fmtINR(v.advanceAmount)} /></Grid>
              </Grid>
            ) : (
              <Grid container spacing={2}>
                <Grid item xs={6} sm={2}><Field label="Invoice Amount" value={fmtINR(v.invoiceAmount)} /></Grid>
                <Grid item xs={6} sm={2}><Field label="Advance" value={fmtINR(v.advancePaid)} /></Grid>
                <Grid item xs={6} sm={2}><Field label="Debit Note" value={fmtINR(v.debitNoteAmount)} /></Grid>
                <Grid item xs={6} sm={2}><Field label="Net Payable" value={fmtINR(v.netPayableAmount)} /></Grid>
                <Grid item xs={6} sm={2}><Field label="Paid" value={fmtINR(v.paidAmount)} /></Grid>
                <Grid item xs={6} sm={2}><Field label="Balance" value={fmtINR(v.balanceAmount)} /></Grid>
              </Grid>
            )}
            <Box sx={{ mt: 2, p: 2, borderRadius: '12px', bgcolor: alpha('#16a34a', 0.05), display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
              <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>PAID</Typography><Typography variant="h6" fontWeight={800} sx={{ color: '#16a34a' }}>{fmtINR(v.paidAmount)}</Typography></Box>
              <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>BALANCE</Typography><Typography variant="h6" fontWeight={800} sx={{ color: v.balanceAmount > 0 ? '#b45309' : '#16a34a' }}>{fmtINR(v.balanceAmount)}</Typography></Box>
            </Box>
          </SectionCard>
        </Grid>

        {/* MD Digital Approval & Signature */}
        <Grid item xs={12}>
          <MdApprovalCard
            documentType="VOUCHER"
            documentId={v._id}
            documentTitle={v.voucherNumber}
            isMd={isMd}
            onPreviewPdf={doPreviewPdf}
            skip={v.approvalStatus === 'NOT_REQUIRED'}
          />
        </Grid>

        {/* Step 1.12 — Purchase Entry in Tally */}
        <Grid item xs={12} md={6}>
          <SectionCard icon={<FileSpreadsheet size={18} />} title="Purchase Entry in Tally (1.12)">
            {tallyEntry ? (
              <Grid container spacing={2} alignItems="center">
                <Grid item xs={6}><Field label="Entry No" value={tallyEntry.entryNumber} /></Grid>
                <Grid item xs={6}><Field label="Status" value={<TallyStatusChip status={tallyEntry.tallyEntryStatus} />} /></Grid>
                <Grid item xs={6}><Field label="Checklist" value={`${checklistProgress(tallyEntry.checklist)}/${CHECKLIST_TOTAL}`} /></Grid>
                <Grid item xs={6}><Field label="Actual Date" value={fmtDate(tallyEntry.actualAt)} /></Grid>
                <Grid item xs={12}>
                  <Button size="small" variant="outlined" startIcon={<FileSpreadsheet size={15} />} onClick={() => navigate(`/procurement/tally-entries/${tallyEntry._id}`)}>View Tally Entry</Button>
                </Grid>
              </Grid>
            ) : (
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {!posted ? 'Post the voucher first to enable a Tally Entry.'
                    : v.approvalStatus !== 'MD_APPROVED' ? 'Awaiting MD Approval before a Tally Entry can be raised.'
                    : 'No Tally Entry yet. Record the purchase entry to enable final payment.'}
                </Typography>
                <Button size="small" variant="contained" startIcon={<FileSpreadsheet size={15} />}
                  disabled={!posted || v.approvalStatus !== 'MD_APPROVED'} onClick={() => setTallyFormOpen(true)}>Create Tally Entry</Button>
              </Box>
            )}
          </SectionCard>
        </Grid>

        {/* Step 1.13 — Make Payment */}
        <Grid item xs={12} md={6}>
          <SectionCard icon={<Wallet size={18} />} title="Final Payment (1.13)">
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={6}><Field label="Payment Status" value={v.finalPaymentStatus && v.finalPaymentStatus !== 'PENDING' ? <PaymentStatusChip status={v.finalPaymentStatus} /> : 'Pending'} /></Grid>
              <Grid item xs={6}><Field label="Paid Amount" value={fmtINR(totalPaid)} /></Grid>
              <Grid item xs={6}><Field label="Pending Amount" value={fmtINR(v.balanceAmount)} /></Grid>
              <Grid item xs={6}><Field label="Last Payment" value={fmtDate(lastPayment?.paymentDate || v.lastPaymentDate)} /></Grid>
              <Grid item xs={12}>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  <Button size="small" variant="contained" color="success" startIcon={<Wallet size={15} />}
                    disabled={!tallyCompleted || Number(v.balanceAmount) <= 0} onClick={() => setPaymentFormOpen(true)}>Make Payment</Button>
                  {payments.length > 0 && <Button size="small" variant="outlined" onClick={() => navigate(`/procurement/final-payments/${lastPayment._id}`)}>View Payments</Button>}
                </Box>
                {!tallyCompleted && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Complete the Tally Entry before making payment.</Typography>}
              </Grid>
            </Grid>
          </SectionCard>
        </Grid>

        {v.activityTimeline?.length ? (
          <Grid item xs={12}>
            <SectionCard icon={<FileText size={18} />} title="Timeline">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[...v.activityTimeline].reverse().map((ev, i) => (
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

      <VoucherFormDialog open={formOpen} voucher={v} onClose={() => setFormOpen(false)} />
      <VoucherPdfPreview open={pdfPreviewOpen} voucher={previewVoucher || v} onClose={() => { setPdfPreviewOpen(false); setPreviewVoucher(null); }} />
      <TallyEntryFormDialog open={tallyFormOpen} presetVoucher={v} onClose={() => setTallyFormOpen(false)} />
      <FinalPaymentFormDialog open={paymentFormOpen} presetVoucher={v} onClose={() => setPaymentFormOpen(false)} />

      {/* Cancel dialog */}
      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Cancel Voucher</DialogTitle>
        <DialogContent dividers>
          <TextField fullWidth size="small" multiline minRows={2} label="Reason (optional)" value={cancelRemarks} onChange={(e) => setCancelRemarks(e.target.value)} />
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button onClick={() => setCancelOpen(false)} disabled={cancelling}>Back</Button>
          <Button variant="contained" color="error" onClick={doCancel} disabled={cancelling} startIcon={cancelling ? <CircularProgress size={16} color="inherit" /> : <Ban size={16} />}>Cancel Voucher</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VoucherDetail;
