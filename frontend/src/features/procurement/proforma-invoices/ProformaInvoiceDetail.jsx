import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import {
  Box, Typography, Paper, Grid, Button, IconButton, CircularProgress, Chip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Divider,
} from '@mui/material';
import {
  ArrowLeft, Pencil, CheckCircle2, Ban, ReceiptText, Building2, FileText,
  ShoppingBag, Wallet, FileDown,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useSnackbar } from 'notistack';
import {
  useGetProformaInvoiceByIdQuery,
  useCancelProformaInvoiceMutation,
  useGetAdvancePaymentsByPiQuery,
} from '../../../store/api/procurementApi';
import { PiStatusChip, PiApprovalChip, fmtINR, fmtDate } from './piMeta';
import ProformaInvoiceFormDrawer from './ProformaInvoiceFormDrawer';
import ProformaInvoiceApprovalDialog from './ProformaInvoiceApprovalDialog';
import ProformaInvoicePdfPreview from './ProformaInvoicePdfPreview';
import { PaymentStatusChip, modeLabel } from '../advance-payments/apMeta';
import AdvancePaymentFormDialog from '../advance-payments/AdvancePaymentFormDialog';
import { PFMS, pfmsPageSx, pfmsCardSx } from '../pfmsTheme';
import FmsDoerCard from '../../fms-doers/FmsDoerCard';

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary', mb: 0.25 }}>{label}</Typography>
    <Typography sx={{ fontWeight: 600, color: 'text.primary', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);

const SectionCard = ({ icon, title, children }) => (
  <Paper sx={{ ...pfmsCardSx, p: 3 }}>
    <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: 'primary.main' }}>
      {icon} {title}
    </Typography>
    {children}
  </Paper>
);

const ProformaInvoiceDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack('/purchase-fms/pi-forms');
  const { enqueueSnackbar } = useSnackbar();

  const { data, isLoading } = useGetProformaInvoiceByIdQuery(id);
  const pi = data?.data;
  const [cancelPi] = useCancelProformaInvoiceMutation();

  const [formOpen, setFormOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  // Step 1.7 — payments recorded against this PI.
  const piPayable = ['READY_FOR_ADVANCE_PAYMENT', 'PAYMENT_COMPLETED'].includes(data?.data?.piStatus);
  const { data: payRes } = useGetAdvancePaymentsByPiQuery(id, { skip: !piPayable });
  const payments = payRes?.data || [];

  if (isLoading) return <Box sx={{ display: 'grid', placeItems: 'center', height: '70vh' }}><CircularProgress /></Box>;
  if (!pi) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6">Proforma Invoice not found</Typography>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/purchase-fms/pi-forms')}>Back to list</Button>
      </Box>
    );
  }

  const editable = ['DRAFT', 'RECEIVED'].includes(pi.piStatus) && pi.approvalStatus !== 'APPROVED';
  const cancellable = pi.piStatus !== 'CANCELLED';

  const handleCancel = async () => {
    try { await cancelPi({ id: pi._id }).unwrap(); enqueueSnackbar('PI cancelled', { variant: 'info' }); }
    catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to cancel', { variant: 'error' }); }
  };

  return (
    <Box sx={{ ...pfmsPageSx, p: { xs: 1.5, md: 2.5 } }}>
      {/* Hero */}
      <Box sx={{ mb: 2.5, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={goBack} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}` }}>
          <ArrowLeft size={20} />
        </IconButton>
        <Box sx={{ width: 46, height: 46, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main' }}>
          <ReceiptText size={24} />
        </Box>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: PFMS.ink }}>{pi.piNumber}</Typography>
            <Chip size="small" label={pi.uniqueCode} variant="outlined" sx={{ fontWeight: 700 }} />
            <PiStatusChip status={pi.piStatus} />
            <PiApprovalChip status={pi.approvalStatus} />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {pi.vendorName} · PO {pi.poNumber || '—'} · {fmtDate(pi.piDate)}
          </Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {pi.poId && (
            <Button variant="outlined" startIcon={<ShoppingBag size={16} />}
              onClick={() => navigate(`/procurement/purchase-orders/${pi.poId}`)}>
              View PO
            </Button>
          )}
          {editable && <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setFormOpen(true)}>Edit</Button>}
          {editable && <Button variant="contained" color="success" startIcon={<CheckCircle2 size={16} />} onClick={() => setApprovalOpen(true)}>Approve / Reject</Button>}
          {pi.piStatus === 'READY_FOR_ADVANCE_PAYMENT' && (
            <Button variant="contained" startIcon={<Wallet size={16} />} onClick={() => setPaymentOpen(true)}>
              Record Advance Payment
            </Button>
          )}
          {pi.piDocument?.fileUrl && <Button variant="outlined" startIcon={<FileDown size={16} />} onClick={() => setPdfOpen(true)}>PI Document</Button>}
          {cancellable && <Button variant="outlined" color="error" startIcon={<Ban size={16} />} onClick={handleCancel}>Cancel</Button>}
        </Box>
      </Box>

      <FmsDoerCard entityType="PI" entityId={id} />
      <Grid container spacing={3}>
        {/* PI + PO info */}
        <Grid item xs={12} md={6}>
          <SectionCard icon={<FileText size={18} />} title="PI Information">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}><Field label="PI Number" value={pi.piNumber} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Unique Code" value={pi.uniqueCode} /></Grid>
              <Grid item xs={6} sm={4}><Field label="PI Date" value={fmtDate(pi.piDate)} /></Grid>
              <Grid item xs={6} sm={4}><Field label="PO Number" value={pi.poNumber || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Indent Number" value={pi.indentNumber || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Received At" value={fmtDate(pi.receivedAt)} /></Grid>
              {pi.remarks ? <Grid item xs={12}><Field label="Remarks" value={pi.remarks} /></Grid> : null}
            </Grid>
          </SectionCard>
        </Grid>

        {/* Vendor */}
        <Grid item xs={12} md={6}>
          <SectionCard icon={<Building2 size={18} />} title="Vendor Information">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}><Field label="Vendor" value={pi.vendorName || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="GST" value={pi.vendorGST || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="PAN" value={pi.vendorPAN || '—'} /></Grid>
              <Grid item xs={12} sm={4}><Field label="Address" value={pi.vendorAddress || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Phone" value={pi.vendorPhone || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Email" value={pi.vendorEmail || '—'} /></Grid>
            </Grid>
          </SectionCard>
        </Grid>

        {/* Items */}
        <Grid item xs={12}>
          <SectionCard icon={<ReceiptText size={18} />} title={`Items (${pi.items?.length || 0})`}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell>SKU</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell>Unit</TableCell>
                    <TableCell align="right">Received</TableCell>
                    <TableCell align="right">Balance</TableCell>
                    <TableCell align="right">Rate</TableCell>
                    <TableCell align="center">GST %</TableCell>
                    <TableCell align="right">Line Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(pi.items || []).map((it, i) => (
                    <TableRow key={it._id || i} hover>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{it.itemName}</TableCell>
                      <TableCell><Typography variant="body2" color="primary.main" fontWeight={700}>{it.skuCode || '—'}</Typography></TableCell>
                      <TableCell align="right">{it.quantity}</TableCell>
                      <TableCell>{it.unit}</TableCell>
                      <TableCell align="right" sx={{ color: '#0f766e' }}>{it.receivedQty || 0}</TableCell>
                      <TableCell align="right" sx={{ color: it.balanceQty > 0 ? '#b45309' : '#0f766e' }}>{it.balanceQty || 0}</TableCell>
                      <TableCell align="right">{Number(it.rate || 0).toFixed(2)}</TableCell>
                      <TableCell align="center">{it.gstRate || 0}%</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{Number(it.lineAmount || 0).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Divider sx={{ my: 2 }} />
            {/* Financial summary */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={700}>TOTAL VALUE</Typography>
                <Typography variant="h6" fontWeight={800} color="primary.dark">{fmtINR(pi.totalValue)}</Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={700}>PAID AMOUNT</Typography>
                <Typography fontWeight={700} sx={{ color: '#0f766e' }}>{fmtINR(pi.paidAmount)}</Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" sx={{ color: '#b45309' }} fontWeight={700}>BALANCE AMOUNT</Typography>
                <Typography fontWeight={800} sx={{ color: '#b45309' }}>{fmtINR(pi.balanceAmount)}</Typography>
              </Box>
            </Box>
          </SectionCard>
        </Grid>

        {/* Approval history */}
        <Grid item xs={12} md={6}>
          <SectionCard icon={<CheckCircle2 size={18} />} title="Approval History">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}><Field label="Status" value={<PiApprovalChip status={pi.approvalStatus} />} /></Grid>
              {pi.approvedBy ? (
                <>
                  <Grid item xs={6} sm={4}><Field label="Approved By" value={pi.approvedBy} /></Grid>
                  <Grid item xs={6} sm={4}><Field label="Approved At" value={fmtDate(pi.approvedAt)} /></Grid>
                  {pi.approvalRemarks ? <Grid item xs={12}><Field label="Approval Remarks" value={pi.approvalRemarks} /></Grid> : null}
                </>
              ) : null}
              {pi.rejectedBy ? (
                <>
                  <Grid item xs={6} sm={4}><Field label="Rejected By" value={pi.rejectedBy} /></Grid>
                  <Grid item xs={6} sm={4}><Field label="Rejected At" value={fmtDate(pi.rejectedAt)} /></Grid>
                  {pi.rejectionRemarks ? <Grid item xs={12}><Field label="Rejection Remarks" value={pi.rejectionRemarks} /></Grid> : null}
                </>
              ) : null}
            </Grid>
          </SectionCard>
        </Grid>

        {/* Document */}
        <Grid item xs={12} md={6}>
          <SectionCard icon={<Wallet size={18} />} title="PI Document">
            {pi.piDocument?.fileUrl ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <FileText size={20} />
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} noWrap>{pi.piDocument.fileName || 'PI document'}</Typography>
                  <Typography variant="caption" color="text.disabled">Uploaded {fmtDate(pi.piDocument.uploadedAt)}</Typography>
                </Box>
                <Button size="small" variant="outlined" onClick={() => setPdfOpen(true)}>Preview</Button>
              </Box>
            ) : (
              <Typography variant="body2" color="text.disabled">
                No document uploaded yet — required before this PI can be approved.
              </Typography>
            )}
          </SectionCard>
        </Grid>

        {/* Step 1.7 — Advance payment history */}
        {piPayable && (
          <Grid item xs={12}>
            <SectionCard icon={<Wallet size={18} />} title={`Advance Payments (${payments.length})`}>
              {payments.length ? (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Payment No</TableCell>
                        <TableCell>Date</TableCell>
                        <TableCell align="right">Paid</TableCell>
                        <TableCell align="right">Balance After</TableCell>
                        <TableCell>Mode</TableCell>
                        <TableCell>Reference</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>By</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {payments.map((p) => (
                        <TableRow key={p._id} hover>
                          <TableCell><Typography variant="body2" fontWeight={700} color="primary.main">{p.paymentNumber}</Typography></TableCell>
                          <TableCell>{fmtDate(p.paymentDate)}</TableCell>
                          <TableCell align="right" sx={{ color: '#0f766e', fontWeight: 700 }}>{fmtINR(p.paidAmount)}</TableCell>
                          <TableCell align="right" sx={{ color: p.balanceAmount > 0 ? '#b45309' : '#0f766e', fontWeight: 700 }}>{fmtINR(p.balanceAmount)}</TableCell>
                          <TableCell>{modeLabel(p.paymentMode)}</TableCell>
                          <TableCell><Typography variant="body2" color="text.secondary" noWrap>{p.paymentReferenceNumber || '—'}</Typography></TableCell>
                          <TableCell><PaymentStatusChip status={p.paymentStatus} /></TableCell>
                          <TableCell><Typography variant="body2" color="text.secondary" noWrap>{p.performedByName || '—'}</Typography></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" color="text.disabled">No payments recorded yet.</Typography>
              )}
            </SectionCard>
          </Grid>
        )}

        {/* Timeline */}
        {pi.activityTimeline?.length ? (
          <Grid item xs={12}>
            <SectionCard icon={<FileText size={18} />} title="Timeline">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[...pi.activityTimeline].reverse().map((ev, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Chip size="small" label={ev.action} sx={{ fontWeight: 700, minWidth: 100 }} />
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

      {/* Form + dialogs */}
      <ProformaInvoiceFormDrawer open={formOpen} pi={pi} onClose={() => setFormOpen(false)} />
      <ProformaInvoiceApprovalDialog open={approvalOpen} pi={pi} onClose={() => setApprovalOpen(false)} />
      <ProformaInvoicePdfPreview open={pdfOpen} pi={pi} onClose={() => setPdfOpen(false)} />
      <AdvancePaymentFormDialog open={paymentOpen} pi={pi} onClose={() => setPaymentOpen(false)} />
    </Box>
  );
};

export default ProformaInvoiceDetail;
