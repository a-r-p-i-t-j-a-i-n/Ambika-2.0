import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, Grid, Button, IconButton, CircularProgress, Chip,
} from '@mui/material';
import {
  ArrowLeft, Pencil, CheckCircle2, ReceiptText, Building2, FileText, ClipboardCheck,
  ExternalLink, Banknote,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import {
  useGetVendorInvoiceByIdQuery,
  useGetVouchersByInvoiceQuery,
} from '../../../store/api/procurementApi';
import { InvoiceStatusChip, VarianceChip, varianceRowBg, fmtINR, fmtDate } from './invoiceMeta';
import { fileHref } from '../indents/indentMeta';
import { VoucherStatusChip } from '../vouchers/voucherMeta';
import VendorInvoiceFormDialog from './VendorInvoiceFormDialog';
import VendorInvoiceApprovalDialog from './VendorInvoiceApprovalDialog';
import VoucherFormDialog from '../vouchers/VoucherFormDialog';
import WorkflowStepper from '../components/WorkflowStepper';
import { resolveWorkflowSteps } from '../components/purchaseFmsWorkflow';
import { PFMS, pfmsPageSx, pfmsCardSx } from '../pfmsTheme';

const INV_ITEM_COLS = '2fr 0.8fr 0.8fr 0.6fr 0.9fr 0.9fr 0.95fr 1.4fr';
const CMP_COLS = '1.8fr 1fr 0.5fr 0.85fr 0.85fr 0.85fr 0.85fr 0.85fr 0.85fr 0.95fr';
const CMP_HEAD = ['Item Name', 'SKU', 'Unit', 'PO Ordered', 'GRN Recv', 'QC Accepted', 'QC Rejected', 'Invoice Qty', 'Variance', 'Status'];

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary', mb: 0.25 }}>{label}</Typography>
    <Typography sx={{ fontWeight: 600, color: 'text.primary', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);
const SectionCard = ({ icon, title, action, children }) => (
  <Paper sx={{ ...pfmsCardSx, p: 3 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
      <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, color: 'primary.main' }}>{icon} {title}</Typography>
      {action}
    </Box>
    {children}
  </Paper>
);

const VendorInvoiceDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useGetVendorInvoiceByIdQuery(id);
  const inv = data?.data;
  const wfSteps = resolveWorkflowSteps({ invoice: inv });

  const voucherRelevant = inv && ['PAYMENT_PENDING', 'PAYMENT_COMPLETED'].includes(inv.invoiceStatus);
  const { data: vouRes } = useGetVouchersByInvoiceQuery(id, { skip: !voucherRelevant });
  const liveVoucher = (vouRes?.data || []).find((v) => v.voucherStatus !== 'CANCELLED') || null;

  const [formOpen, setFormOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [voucherFormOpen, setVoucherFormOpen] = useState(false);

  if (isLoading) return <Box sx={{ display: 'grid', placeItems: 'center', height: '70vh' }}><CircularProgress /></Box>;
  if (!inv) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6">Vendor invoice not found</Typography>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/purchase-fms/vendor-invoices')}>Back to list</Button>
      </Box>
    );
  }

  const canEdit = ['DRAFT', 'RECEIVED', 'APPROVED', 'PAYMENT_PENDING'].includes(inv.invoiceStatus);
  const canApproveReject = ['DRAFT', 'RECEIVED'].includes(inv.invoiceStatus);
  const canCreateVoucher = inv.invoiceStatus === 'PAYMENT_PENDING' && !liveVoucher;

  return (
    <Box sx={{ ...pfmsPageSx, p: { xs: 1.5, md: 2.5 } }}>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={() => navigate('/purchase-fms/vendor-invoices')} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}` }}><ArrowLeft size={20} /></IconButton>
        <Box sx={{ width: 46, height: 46, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main' }}><ReceiptText size={24} /></Box>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: PFMS.ink }}>{inv.invoiceNumber}</Typography>
            <InvoiceStatusChip status={inv.invoiceStatus} />
            {inv.debitNoteRequired && <Chip size="small" color="warning" variant="outlined" label="Debit Note" sx={{ fontWeight: 700 }} />}
          </Box>
          <Typography variant="body2" color="text.secondary">{inv.vendorName} · GRN {inv.grnNumber || '—'} · {fmtDate(inv.invoiceDate)}</Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {inv.qcId && <Button variant="outlined" startIcon={<ClipboardCheck size={16} />} onClick={() => navigate(`/procurement/incoming-qc/${inv.qcId}`)}>View QC</Button>}
          {canEdit && <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setFormOpen(true)}>Edit</Button>}
          {canApproveReject && <Button variant="contained" color="success" startIcon={<CheckCircle2 size={16} />} onClick={() => setApprovalOpen(true)}>Approve / Reject</Button>}
          {canCreateVoucher && <Button variant="contained" startIcon={<Banknote size={16} />} onClick={() => setVoucherFormOpen(true)}>Create Voucher</Button>}
          {liveVoucher && <Button variant="outlined" startIcon={<Banknote size={16} />} onClick={() => navigate(`/procurement/vouchers/${liveVoucher._id}`)}>View Voucher</Button>}
        </Box>
      </Box>

      <WorkflowStepper steps={wfSteps} sx={{ mb: 3 }} />
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <SectionCard icon={<FileText size={18} />} title="Invoice & Linkage">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}><Field label="Invoice No" value={inv.invoiceNumber} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Invoice Date" value={fmtDate(inv.invoiceDate)} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Received" value={fmtDate(inv.invoiceReceivedDate)} /></Grid>
              <Grid item xs={12} sm={4}>
                <Field label={`GRNs (${(inv.grnNumbers?.length || (inv.grnNumber ? 1 : 0))})`} value={
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {(inv.grnNumbers?.length ? inv.grnNumbers : [inv.grnNumber]).filter(Boolean).map((g, i) => <Chip key={i} size="small" label={g} />)}
                  </Box>
                } />
              </Grid>
              <Grid item xs={12} sm={4}>
                <Field label={`QCs (${(inv.qcNumbers?.length || (inv.qcNumber ? 1 : 0))})`} value={
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {(inv.qcNumbers?.length ? inv.qcNumbers : [inv.qcNumber]).filter(Boolean).map((q, i) => <Chip key={i} size="small" variant="outlined" label={q} />)}
                  </Box>
                } />
              </Grid>
              <Grid item xs={6} sm={4}><Field label="PO" value={inv.poNumber || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="PI" value={inv.piNumber || '—'} /></Grid>
              <Grid item xs={6} sm={4}>
                <Field label="Document" value={inv.invoiceDocument?.fileUrl
                  ? <Button size="small" startIcon={<ExternalLink size={13} />} href={fileHref(inv.invoiceDocument.fileUrl)} target="_blank" rel="noopener">{inv.invoiceDocument.fileName || 'View'}</Button>
                  : '—'} />
              </Grid>
            </Grid>
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={6}>
          <SectionCard icon={<Building2 size={18} />} title="Vendor">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={6}><Field label="Vendor" value={inv.vendorName || '—'} /></Grid>
              <Grid item xs={6} sm={6}><Field label="GST" value={inv.vendorGST || '—'} /></Grid>
              {inv.debitNoteRequired ? (
                <>
                  <Grid item xs={6} sm={4}><Field label="Debit Note No" value={inv.debitNoteNumber || '—'} /></Grid>
                  <Grid item xs={6} sm={4}><Field label="Debit Note Amt" value={fmtINR(inv.debitNoteAmount)} /></Grid>
                  <Grid item xs={12} sm={4}><Field label="Reason" value={inv.debitNoteReason || '—'} /></Grid>
                </>
              ) : null}
            </Grid>
          </SectionCard>
        </Grid>

        {/* Order vs Received comparison */}
        {inv.items?.length ? (
          <Grid item xs={12}>
            <SectionCard icon={<FileText size={18} />} title="Order vs Received Comparison">
              <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: 940 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: CMP_COLS, gap: 1, px: 1.25, py: 1, background: 'linear-gradient(90deg,#0b2545,#1d4ed8)', borderRadius: '8px 8px 0 0' }}>
                    {CMP_HEAD.map((h, i) => (
                      <Typography key={i} variant="caption" sx={{ fontWeight: 800, color: '#fff', textTransform: 'uppercase', fontSize: '0.55rem', letterSpacing: '0.03em', textAlign: i <= 1 ? 'left' : (i === 9 ? 'center' : 'right') }}>{h}</Typography>
                    ))}
                  </Box>
                  {inv.items.map((it, i) => {
                    const variance = Number(it.varianceQty ?? ((it.invoiceQty || 0) - (it.acceptedQty || 0)));
                    const status = it.varianceStatus || (variance === 0 ? 'MATCHED' : (variance < 0 ? 'SHORT' : 'EXCESS'));
                    return (
                      <Box key={it._id || i} sx={{ display: 'grid', gridTemplateColumns: CMP_COLS, gap: 1, alignItems: 'center', px: 1.25, py: 0.85, borderTop: '1px solid', borderColor: 'divider', bgcolor: varianceRowBg(status) }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={600} noWrap>{it.itemName}</Typography>
                          {it.grnNumber ? <Typography variant="caption" color="text.secondary">GRN {it.grnNumber}</Typography> : null}
                        </Box>
                        <Typography variant="body2" color="primary.main" fontWeight={700} noWrap>{it.skuCode || '—'}</Typography>
                        <Typography variant="body2" color="text.secondary">{it.unit}</Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right' }}>{it.orderedQty ?? '—'}</Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right' }}>{it.grnReceivedQty ?? it.receivedQty ?? '—'}</Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right', color: '#0f766e', fontWeight: 700 }}>{it.acceptedQty}</Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right', color: it.rejectedQty > 0 ? '#b45309' : 'text.disabled' }}>{it.rejectedQty}</Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700 }}>{it.invoiceQty}</Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700, color: variance === 0 ? 'text.secondary' : (variance < 0 ? '#b45309' : '#be123c') }}>{variance > 0 ? `+${variance}` : variance}</Typography>
                        <Box sx={{ display: 'flex', justifyContent: 'center' }}><VarianceChip status={status} /></Box>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            </SectionCard>
          </Grid>
        ) : null}

        {/* Invoice items */}
        {inv.items?.length ? (
          <Grid item xs={12}>
            <SectionCard icon={<FileText size={18} />} title={`Invoice Items (${inv.items.length})`}>
              <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: 820 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: INV_ITEM_COLS, gap: 1, px: 1, mb: 0.5 }}>
                    {['Item / SKU', 'Inv Qty', 'Rate', 'GST %', 'Taxable', 'GST', 'Total', 'Remarks'].map((h, i) => (
                      <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.6rem', textAlign: i === 0 || i === 7 ? 'left' : 'right' }}>{h}</Typography>
                    ))}
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                    {inv.items.map((it, i) => (
                      <Box key={it._id || i} sx={{ display: 'grid', gridTemplateColumns: INV_ITEM_COLS, gap: 1, alignItems: 'center', px: 1, py: 0.75, borderRadius: '8px', border: '1px solid', borderColor: 'divider' }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={600} noWrap>{it.itemName}</Typography>
                          {it.skuCode ? <Typography variant="caption" color="primary.main" fontWeight={700}>{it.skuCode}</Typography> : null}
                        </Box>
                        <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700 }}>{it.invoiceQty}</Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right' }}>{Number(it.rate || 0).toFixed(2)}</Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right' }}>{it.gstRate || 0}%</Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right' }}>{Number(it.taxableAmount || 0).toFixed(2)}</Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right' }}>{Number(it.gstAmount || 0).toFixed(2)}</Typography>
                        <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700 }}>{Number(it.totalAmount || 0).toFixed(2)}</Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>{it.remarks || '—'}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Box>
            </SectionCard>
          </Grid>
        ) : null}

        {/* Financials */}
        <Grid item xs={12}>
          <SectionCard icon={<ReceiptText size={18} />} title="Financials">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={2}><Field label="Invoice Amount" value={fmtINR(inv.invoiceAmount)} /></Grid>
              <Grid item xs={6} sm={2}><Field label="Taxable" value={fmtINR(inv.taxableAmount)} /></Grid>
              <Grid item xs={6} sm={2}><Field label="GST" value={fmtINR(inv.gstAmount)} /></Grid>
              <Grid item xs={6} sm={2}><Field label="TDS" value={fmtINR(inv.tdsAmount)} /></Grid>
              <Grid item xs={6} sm={2}><Field label="Other" value={fmtINR(inv.otherCharges)} /></Grid>
              <Grid item xs={6} sm={2}><Field label="Debit Note" value={fmtINR(inv.debitNoteAmount)} /></Grid>
            </Grid>
            <Box sx={{ mt: 2, p: 2, borderRadius: '12px', bgcolor: alpha('#1d4ed8', 0.04), display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
              <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>ADVANCE PAID</Typography><Typography fontWeight={700} sx={{ color: '#0f766e' }}>{fmtINR(inv.advancePaid)}</Typography></Box>
              <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="primary.main" fontWeight={700}>NET PAYABLE</Typography><Typography variant="h6" fontWeight={800} color="primary.dark">{fmtINR(inv.netPayableAmount)}</Typography></Box>
            </Box>
          </SectionCard>
        </Grid>

        {/* Approval + remarks */}
        <Grid item xs={12} md={6}>
          <SectionCard icon={<CheckCircle2 size={18} />} title="Approval">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}><Field label="Status" value={<InvoiceStatusChip status={inv.invoiceStatus} />} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Approved By" value={inv.approvedBy || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Approved At" value={fmtDate(inv.approvedAt)} /></Grid>
              {inv.rejectedBy ? <Grid item xs={12}><Field label="Rejection" value={inv.rejectionRemarks || inv.rejectedBy} /></Grid> : null}
              {inv.voucherNumber ? <Grid item xs={12}><Field label="Voucher" value={<Box component="span" sx={{ color: 'primary.main', cursor: 'pointer', fontWeight: 700 }} onClick={() => liveVoucher && navigate(`/procurement/vouchers/${liveVoucher._id}`)}>{inv.voucherNumber} {liveVoucher && <VoucherStatusChip status={liveVoucher.voucherStatus} />}</Box>} /></Grid> : null}
            </Grid>
          </SectionCard>
        </Grid>

        {inv.activityTimeline?.length ? (
          <Grid item xs={12} md={6}>
            <SectionCard icon={<FileText size={18} />} title="Timeline">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[...inv.activityTimeline].reverse().map((ev, i) => (
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

      <VendorInvoiceFormDialog open={formOpen} invoice={inv} onClose={() => setFormOpen(false)} />
      <VendorInvoiceApprovalDialog open={approvalOpen} invoice={inv} onClose={() => setApprovalOpen(false)} />
      <VoucherFormDialog open={voucherFormOpen} presetInvoice={inv} onClose={() => setVoucherFormOpen(false)} />
    </Box>
  );
};

export default VendorInvoiceDetail;
