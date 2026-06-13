import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, Grid, Button, IconButton, CircularProgress, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem, InputAdornment, Alert,
} from '@mui/material';
import {
  ArrowLeft, Pencil, Send, Ban, Banknote, Building2, FileText, ReceiptText,
  ExternalLink, CheckCircle2, FileSpreadsheet, Wallet,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useSnackbar } from 'notistack';
import {
  useGetVoucherByIdQuery,
  usePostVoucherMutation,
  useCancelVoucherMutation,
  useGetTallyEntriesByVoucherQuery,
  useGetFinalPaymentsByVoucherQuery,
} from '../../../store/api/procurementApi';
import { VoucherStatusChip, PAYMENT_MODES, fmtINR, fmtDate } from './voucherMeta';
import { fileHref } from '../indents/indentMeta';
import VoucherFormDialog from './VoucherFormDialog';
import TallyEntryFormDialog from '../tally-entry/TallyEntryFormDialog';
import { TallyStatusChip, CHECKLIST_TOTAL, checklistProgress } from '../tally-entry/tallyMeta';
import FinalPaymentFormDialog from '../final-payments/FinalPaymentFormDialog';
import { PaymentStatusChip } from '../final-payments/paymentMeta';

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary', mb: 0.25 }}>{label}</Typography>
    <Typography sx={{ fontWeight: 600, color: 'text.primary', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);
const SectionCard = ({ icon, title, children }) => (
  <Paper sx={{ p: 3, borderRadius: '18px' }}>
    <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, color: 'primary.main', mb: 2 }}>{icon} {title}</Typography>
    {children}
  </Paper>
);

const VoucherDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading } = useGetVoucherByIdQuery(id);
  const v = data?.data;

  const [formOpen, setFormOpen] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const [postVoucher, { isLoading: posting }] = usePostVoucherMutation();
  const [cancelVoucher, { isLoading: cancelling }] = useCancelVoucherMutation();

  const [postForm, setPostForm] = useState({ paidAmount: '', paymentMode: 'NEFT', referenceNumber: '', paymentDate: '', remarks: '' });
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

  useEffect(() => {
    if (v && postOpen) setPostForm({
      paidAmount: v.paidAmount || v.netPayableAmount || '', paymentMode: v.paymentMode || 'NEFT',
      referenceNumber: v.referenceNumber || '', paymentDate: '', remarks: '',
    });
  }, [v, postOpen]);

  if (isLoading) return <Box sx={{ display: 'grid', placeItems: 'center', height: '70vh' }}><CircularProgress /></Box>;
  if (!v) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6">Voucher not found</Typography>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/procurement/vouchers')}>Back to list</Button>
      </Box>
    );
  }

  const isDraft = v.voucherStatus === 'DRAFT';
  const netPayable = Number(v.netPayableAmount || 0);
  const postPaid = Number(postForm.paidAmount || 0);
  const postBalance = netPayable - postPaid;

  const doPost = async () => {
    if (!postPaid || postPaid <= 0) return enqueueSnackbar('Enter a valid paid amount', { variant: 'warning' });
    try {
      await postVoucher({ id: v._id, paidAmount: postPaid, paymentMode: postForm.paymentMode, referenceNumber: postForm.referenceNumber.trim() || undefined, paymentDate: postForm.paymentDate || undefined, remarks: postForm.remarks.trim() || undefined }).unwrap();
      enqueueSnackbar(postBalance <= 0 ? 'Voucher fully paid — invoice marked Accounts Ready' : 'Voucher posted — partially paid', { variant: 'success' });
      setPostOpen(false);
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
    <Box sx={{ p: { xs: 2, sm: 4 }, bgcolor: '#f8fafc', minHeight: '100vh' }}>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={() => navigate('/procurement/vouchers')} sx={{ bgcolor: '#fff', boxShadow: 1 }}><ArrowLeft size={20} /></IconButton>
        <Box sx={{ width: 46, height: 46, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main' }}><Banknote size={24} /></Box>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="h5" fontWeight={800}>{v.voucherNumber}</Typography>
            <VoucherStatusChip status={v.voucherStatus} />
          </Box>
          <Typography variant="body2" color="text.secondary">{v.vendorName} · Invoice {v.invoiceNumber || '—'} · {fmtDate(v.voucherDate)}</Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {v.invoiceId && <Button variant="outlined" startIcon={<ReceiptText size={16} />} onClick={() => navigate(`/procurement/vendor-invoices/${v.invoiceId}`)}>View Invoice</Button>}
          {isDraft && <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setFormOpen(true)}>Edit</Button>}
          {isDraft && <Button variant="outlined" color="error" startIcon={<Ban size={16} />} onClick={() => setCancelOpen(true)}>Cancel</Button>}
          {isDraft && <Button variant="contained" color="success" startIcon={<Send size={16} />} onClick={() => setPostOpen(true)}>Post Payment</Button>}
        </Box>
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <SectionCard icon={<Banknote size={18} />} title="Payment">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}><Field label="Payment Mode" value={v.paymentMode} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Payment Date" value={fmtDate(v.paymentDate)} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Reference No" value={v.referenceNumber || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Bank" value={v.bankName || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="UTR No" value={v.utrNumber || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Cheque No" value={v.chequeNumber || '—'} /></Grid>
              <Grid item xs={12} sm={4}>
                <Field label="Proof" value={v.paymentProof?.fileUrl
                  ? <Button size="small" startIcon={<ExternalLink size={13} />} href={fileHref(v.paymentProof.fileUrl)} target="_blank" rel="noopener">{v.paymentProof.fileName || 'View'}</Button>
                  : '—'} />
              </Grid>
              {v.remarks ? <Grid item xs={12}><Field label="Remarks" value={v.remarks} /></Grid> : null}
            </Grid>
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={5}>
          <SectionCard icon={<Building2 size={18} />} title="Vendor & Linkage">
            <Grid container spacing={2}>
              <Grid item xs={6}><Field label="Vendor" value={v.vendorName || '—'} /></Grid>
              <Grid item xs={6}><Field label="Invoice" value={v.invoiceNumber || '—'} /></Grid>
              <Grid item xs={6}><Field label="PO" value={v.poNumber || '—'} /></Grid>
              <Grid item xs={6}><Field label="Status" value={<VoucherStatusChip status={v.voucherStatus} />} /></Grid>
            </Grid>
          </SectionCard>
        </Grid>

        <Grid item xs={12}>
          <SectionCard icon={<ReceiptText size={18} />} title="Financials">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={2}><Field label="Invoice Amount" value={fmtINR(v.invoiceAmount)} /></Grid>
              <Grid item xs={6} sm={2}><Field label="Advance" value={fmtINR(v.advancePaid)} /></Grid>
              <Grid item xs={6} sm={2}><Field label="Debit Note" value={fmtINR(v.debitNoteAmount)} /></Grid>
              <Grid item xs={6} sm={2}><Field label="Net Payable" value={fmtINR(v.netPayableAmount)} /></Grid>
              <Grid item xs={6} sm={2}><Field label="Paid" value={fmtINR(v.paidAmount)} /></Grid>
              <Grid item xs={6} sm={2}><Field label="Balance" value={fmtINR(v.balanceAmount)} /></Grid>
            </Grid>
            <Box sx={{ mt: 2, p: 2, borderRadius: '12px', bgcolor: alpha('#16a34a', 0.05), display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
              <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>PAID</Typography><Typography variant="h6" fontWeight={800} sx={{ color: '#16a34a' }}>{fmtINR(v.paidAmount)}</Typography></Box>
              <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>BALANCE</Typography><Typography variant="h6" fontWeight={800} sx={{ color: v.balanceAmount > 0 ? '#b45309' : '#16a34a' }}>{fmtINR(v.balanceAmount)}</Typography></Box>
            </Box>
          </SectionCard>
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
                  {posted ? 'No Tally Entry yet. Record the purchase entry to enable final payment.' : 'Post the voucher first to enable a Tally Entry.'}
                </Typography>
                <Button size="small" variant="contained" startIcon={<FileSpreadsheet size={15} />} disabled={!posted} onClick={() => setTallyFormOpen(true)}>Create Tally Entry</Button>
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
      <TallyEntryFormDialog open={tallyFormOpen} presetVoucher={v} onClose={() => setTallyFormOpen(false)} />
      <FinalPaymentFormDialog open={paymentFormOpen} presetVoucher={v} onClose={() => setPaymentFormOpen(false)} />

      {/* Post payment dialog */}
      <Dialog open={postOpen} onClose={() => setPostOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
        <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}><Send size={18} /> Post Payment</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ mb: 2, p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9' }}>
            <Typography variant="body2" fontWeight={700}>{v.vendorName}</Typography>
            <Typography variant="caption" color="text.secondary">Net Payable {fmtINR(netPayable)}</Typography>
          </Box>
          <Grid container spacing={2}>
            <Grid item xs={6}><TextField fullWidth size="small" type="number" label="Paid Amount" value={postForm.paidAmount} onChange={(e) => setPostForm((f) => ({ ...f, paidAmount: e.target.value }))} InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }} /></Grid>
            <Grid item xs={6}><TextField select fullWidth size="small" label="Mode" value={postForm.paymentMode} onChange={(e) => setPostForm((f) => ({ ...f, paymentMode: e.target.value }))}>{PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}</TextField></Grid>
            <Grid item xs={6}><TextField fullWidth size="small" type="date" label="Payment Date" InputLabelProps={{ shrink: true }} value={postForm.paymentDate} onChange={(e) => setPostForm((f) => ({ ...f, paymentDate: e.target.value }))} /></Grid>
            <Grid item xs={6}><TextField fullWidth size="small" label="Reference No" value={postForm.referenceNumber} onChange={(e) => setPostForm((f) => ({ ...f, referenceNumber: e.target.value }))} /></Grid>
            <Grid item xs={12}><TextField fullWidth size="small" multiline minRows={2} label="Remarks" value={postForm.remarks} onChange={(e) => setPostForm((f) => ({ ...f, remarks: e.target.value }))} /></Grid>
            <Grid item xs={12}>
              <Alert severity={postBalance <= 0 ? 'success' : 'warning'} icon={false} sx={{ borderRadius: '10px' }}>
                Balance after: <b>{fmtINR(postBalance > 0 ? postBalance : 0)}</b> — {postBalance <= 0 ? 'Fully Paid (invoice → Accounts Ready)' : 'Partially Paid'}
              </Alert>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button onClick={() => setPostOpen(false)} disabled={posting}>Cancel</Button>
          <Button variant="contained" color="success" onClick={doPost} disabled={posting} startIcon={posting ? <CircularProgress size={16} color="inherit" /> : <CheckCircle2 size={16} />}>Post</Button>
        </DialogActions>
      </Dialog>

      {/* Cancel dialog */}
      <Dialog open={cancelOpen} onClose={() => setCancelOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '16px' } }}>
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
