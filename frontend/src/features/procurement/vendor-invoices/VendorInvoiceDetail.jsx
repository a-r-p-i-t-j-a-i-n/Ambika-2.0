import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import {
  Box, Typography, Paper, Button, IconButton, CircularProgress, Chip, Tooltip,
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
import VoucherPanel from '../vouchers/VoucherPanel';
import WorkflowStepper from '../components/WorkflowStepper';
import { resolveWorkflowSteps } from '../components/purchaseFmsWorkflow';
import NextStepBanner from '../components/NextStepBanner';
import { PFMS, pfmsPageSx, pfmsCardSx } from '../pfmsTheme';
import FmsDoerCard from '../../fms-doers/FmsDoerCard';

const INV_ITEM_COLS = '2fr 0.8fr 0.8fr 0.6fr 0.9fr 0.9fr 0.95fr 1.4fr';
const CMP_COLS = '1.8fr 1fr 0.5fr 0.85fr 0.85fr 0.85fr 0.85fr 0.85fr 0.85fr 0.95fr';
const CMP_HEAD = ['Item Name', 'SKU', 'Unit', 'PO Ordered', 'GRN Recv', 'QC Accepted', 'QC Rejected', 'Invoice Qty', 'Variance', 'Status'];

// ── Same spacing/typography scale as Indent, PO, GRN and Final Payment Detail
// and the embedded VoucherPanel (SECTION_GAP/CARD_PAD/Field/FieldGrid/
// SectionCard), replacing the older p:3 cards and the md=6 Grid whose cards
// ended at different heights. ──
const SECTION_GAP = 2;
const CARD_PAD = 2;

const Field = ({ label, value, sx }) => (
  <Box sx={{ minWidth: 0, ...sx }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: PFMS.sub, mb: 0.4 }}>{label}</Typography>
    {/* div, not p: several values are chips / a link button */}
    <Typography component="div" sx={{ fontSize: '0.86rem', fontWeight: 600, color: PFMS.ink, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);

// Explicit column counts per breakpoint (not auto-fill, which leaves a lone
// field on its own row).
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
const SectionCard = ({ icon, title, action, children }) => (
  <Paper sx={{ ...pfmsCardSx, p: CARD_PAD, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
      <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, fontSize: '0.92rem', color: 'primary.main' }}>{icon} {title}</Typography>
      {action}
    </Box>
    {children}
  </Paper>
);

const VendorInvoiceDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack('/purchase-fms/vendor-invoices');
  const { data, isLoading } = useGetVendorInvoiceByIdQuery(id);
  const inv = data?.data;
  const wfSteps = resolveWorkflowSteps({ invoice: inv });

  const voucherRelevant = inv && ['PAYMENT_PENDING', 'PAYMENT_COMPLETED'].includes(inv.invoiceStatus);
  const { data: vouRes } = useGetVouchersByInvoiceQuery(id, { skip: !voucherRelevant });
  const liveVoucher = (vouRes?.data || []).find((v) => v.voucherStatus !== 'CANCELLED') || null;
  const cancelledVouchers = (vouRes?.data || []).filter((v) => v.voucherStatus === 'CANCELLED');

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

  // ── "What's next?" — single, obvious call-to-action for the current stage. ──
  const nextStep = (() => {
    if (inv.invoiceStatus === 'REJECTED') return null;
    if (canApproveReject) {
      return { tone: 'info', title: 'Next: approve this Vendor Invoice (Step 1.10)',
        desc: 'Review the invoice and its linked GRN/QC, then approve it to raise a payment voucher.',
        primary: { label: 'Approve / Reject', icon: <CheckCircle2 size={16} />, onClick: () => setApprovalOpen(true) },
        secondary: { label: 'Edit', onClick: () => setFormOpen(true) } };
    }
    if (canCreateVoucher) {
      return { tone: 'success', title: 'Invoice approved — next: create the Payment Voucher (Step 1.11)',
        desc: 'Raise a voucher for this invoice to move it toward MD approval and payment.',
        primary: { label: 'Create Voucher', icon: <Banknote size={16} />, onClick: () => setVoucherFormOpen(true) } };
    }
    if (inv.invoiceStatus === 'PAYMENT_COMPLETED') {
      return { tone: 'success', title: 'Payment complete — workflow finished for this invoice',
        desc: 'This invoice has been fully paid.',
        primary: liveVoucher ? { label: 'View Voucher', icon: <Banknote size={16} />, onClick: () => navigate(`/procurement/vouchers/${liveVoucher._id}`) } : null };
    }
    // PAYMENT_PENDING with a live voucher — its own panel (below) is the next step.
    return null;
  })();

  return (
    <Box sx={{ ...pfmsPageSx }}>
      {/* Hero — same sizes as the other detail pages; the identity block has an
          explicit flex basis so long names wrap inside it. */}
      <Box sx={{ mb: SECTION_GAP, display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1.5, flexWrap: 'wrap' }}>
        <Tooltip title="Back">
          <IconButton onClick={goBack} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}`, width: 38, height: 38 }}><ArrowLeft size={18} /></IconButton>
        </Tooltip>
        <Box sx={{ width: 38, height: 38, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main', flexShrink: 0 }}><ReceiptText size={20} /></Box>
        <Box sx={{ flex: { xs: '1 1 200px', md: '1 1 360px' }, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: PFMS.ink }}>{inv.invoiceNumber}</Typography>
            <InvoiceStatusChip status={inv.invoiceStatus} />
            {inv.debitNoteRequired && <Chip size="small" color="warning" variant="outlined" label="Debit Note" sx={{ fontWeight: 700 }} />}
          </Box>
          <Typography variant="body2" sx={{ color: PFMS.sub, overflowWrap: 'anywhere' }}>
            {inv.vendorName} · GRN {(inv.grnNumbers?.length ? inv.grnNumbers : [inv.grnNumber]).filter(Boolean).join(', ') || '—'} · {fmtDate(inv.invoiceDate)}
          </Typography>
        </Box>
        <Box sx={{
          display: 'flex', gap: 1, flexWrap: 'wrap', width: { xs: '100%', sm: 'auto' },
          '& .MuiButtonBase-root': { flex: { xs: '1 1 auto', sm: '0 0 auto' } },
        }}>
          {inv.qcId && <Button variant="outlined" startIcon={<ClipboardCheck size={16} />} onClick={() => navigate(`/procurement/incoming-qc/${inv.qcId}`)}>View QC</Button>}
          {canEdit && <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setFormOpen(true)}>Edit</Button>}
          {canApproveReject && <Button variant="contained" color="success" startIcon={<CheckCircle2 size={16} />} onClick={() => setApprovalOpen(true)}>Approve / Reject</Button>}
          {canCreateVoucher && <Button variant="contained" startIcon={<Banknote size={16} />} onClick={() => setVoucherFormOpen(true)}>Create Voucher</Button>}
          {liveVoucher && <Button variant="outlined" startIcon={<Banknote size={16} />} onClick={() => navigate(`/procurement/vouchers/${liveVoucher._id}`)}>View Voucher</Button>}
        </Box>
      </Box>

      <NextStepBanner step={nextStep} />

      <FmsDoerCard entityType="INVOICE" entityId={id} sx={{ mb: SECTION_GAP }} />
      <WorkflowStepper steps={wfSteps} sx={{ mb: SECTION_GAP }} />
      {/* One grid: Invoice & Linkage | Vendor side by side from lg (3:2, as on
          GRN Detail — the invoice card carries 8 fields to the vendor's 2–5),
          every other section a full-width row. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 3fr) minmax(0, 2fr)' }, gap: SECTION_GAP }}>
        <SectionCard icon={<FileText size={18} />} title="Invoice & Linkage">
          <FieldGrid cols={{ xs: 2, sm: 4, lg: 3, xl: 4 }}>
            <Field label="Invoice No" value={inv.invoiceNumber} />
            <Field label="Invoice Date" value={fmtDate(inv.invoiceDate)} />
            <Field label="Received" value={fmtDate(inv.invoiceReceivedDate)} />
            <Field label={`GRNs (${(inv.grnNumbers?.length || (inv.grnNumber ? 1 : 0))})`} value={
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {(inv.grnNumbers?.length ? inv.grnNumbers : [inv.grnNumber]).filter(Boolean).map((g, i) => <Chip key={i} size="small" label={g} sx={{ maxWidth: '100%' }} />)}
              </Box>
            } />
            <Field label={`QCs (${(inv.qcNumbers?.length || (inv.qcNumber ? 1 : 0))})`} value={
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {(inv.qcNumbers?.length ? inv.qcNumbers : [inv.qcNumber]).filter(Boolean).map((q, i) => <Chip key={i} size="small" variant="outlined" label={q} sx={{ maxWidth: '100%' }} />)}
              </Box>
            } />
            <Field label="PO" value={inv.poNumber || '—'} />
            <Field label="PI" value={inv.piNumber || '—'} />
            <Field label="Document" value={inv.invoiceDocument?.fileUrl
              ? <Button size="small" startIcon={<ExternalLink size={13} />} href={fileHref(inv.invoiceDocument.fileUrl)} target="_blank" rel="noopener" sx={{ ml: -0.6, textAlign: 'left', overflowWrap: 'anywhere' }}>{inv.invoiceDocument.fileName || 'View'}</Button>
              : '—'} />
          </FieldGrid>
        </SectionCard>

        <SectionCard icon={<Building2 size={18} />} title="Vendor">
          <FieldGrid cols={{ xs: 2, sm: 3, lg: 2 }}>
            <Field label="Vendor" value={inv.vendorName || '—'} />
            <Field label="GST" value={inv.vendorGST || '—'} />
            {inv.debitNoteRequired ? (
              <>
                <Field label="Debit Note No" value={inv.debitNoteNumber || '—'} />
                <Field label="Debit Note Amt" value={fmtINR(inv.debitNoteAmount)} />
                <Field label="Reason" value={inv.debitNoteReason || '—'} sx={{ gridColumn: 'span 2' }} />
              </>
            ) : null}
          </FieldGrid>
        </SectionCard>

        {/* Order vs Received comparison */}
        {inv.items?.length ? (
          <Box sx={{ ...FULL_ROW, minWidth: 0 }}>
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
                          {it.grnNumber || it.batchNo ? <Typography variant="caption" color="text.secondary">{[it.grnNumber && `GRN ${it.grnNumber}`, it.batchNo && `Batch ${it.batchNo}`].filter(Boolean).join(' · ')}</Typography> : null}
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
          </Box>
        ) : null}

        {/* Invoice items */}
        {inv.items?.length ? (
          <Box sx={{ ...FULL_ROW, minWidth: 0 }}>
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
          </Box>
        ) : null}

        {/* Financials */}
        {/* Compact: the totals sit beside the fields from lg (fields 3-up there,
            one row of 6 from xl) instead of a full-width band underneath. */}
        <Box sx={{ ...FULL_ROW, minWidth: 0 }}>
          <SectionCard icon={<ReceiptText size={18} />} title="Financials">
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) auto' }, gap: 2, alignItems: 'center' }}>
              <FieldGrid cols={{ xs: 2, sm: 3, xl: 6 }}>
                <Field label="Invoice Amount" value={fmtINR(inv.invoiceAmount)} />
                <Field label="Taxable" value={fmtINR(inv.taxableAmount)} />
                <Field label="GST" value={fmtINR(inv.gstAmount)} />
                <Field label="TDS" value={fmtINR(inv.tdsAmount)} />
                <Field label="Other" value={fmtINR(inv.otherCharges)} />
                <Field label="Debit Note" value={fmtINR(inv.debitNoteAmount)} />
              </FieldGrid>
              <Box sx={{ px: 2, py: 1.25, borderRadius: '8px', bgcolor: alpha('#1d4ed8', 0.04), display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
                <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>ADVANCE PAID</Typography><Typography fontWeight={700} sx={{ color: '#0f766e' }}>{fmtINR(inv.advancePaid)}</Typography></Box>
                <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="primary.main" fontWeight={700}>NET PAYABLE</Typography><Typography variant="h6" fontWeight={800} color="primary.dark" sx={{ lineHeight: 1.3 }}>{fmtINR(inv.netPayableAmount)}</Typography></Box>
              </Box>
            </Box>
          </SectionCard>
        </Box>

        {/* Payment Voucher — master-detail: the invoice's voucher managed in place */}
        <Box sx={{ ...FULL_ROW, minWidth: 0 }}>
          <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 800, color: PFMS.ink, mb: 1.5 }}>
            <Banknote size={18} /> Payment Voucher
          </Typography>
          {liveVoucher ? (
            <VoucherPanel
              voucherId={liveVoucher._id}
              embedded
              showBackButton={false}
              showWorkflowStepper={false}
              showInvoiceLink={false}
            />
          ) : (
            <Paper sx={{ ...pfmsCardSx, p: CARD_PAD }}>
              {inv.invoiceStatus === 'REJECTED' ? (
                <Typography color="text.secondary">Invoice rejected — no voucher can be created.</Typography>
              ) : inv.invoiceStatus === 'PAYMENT_COMPLETED' ? (
                <Typography color="text.secondary">Invoice payment completed.</Typography>
              ) : inv.invoiceStatus === 'PAYMENT_PENDING' ? (
                <Box>
                  <Chip label="Voucher Not Created" variant="outlined" sx={{ fontWeight: 700, mb: 1.5 }} />
                  <Typography color="text.secondary">
                    This invoice is approved and awaiting a payment voucher. Use <b>Create Voucher</b> above to raise one.
                  </Typography>
                </Box>
              ) : (
                <Typography color="text.secondary">Approve this invoice to enable voucher creation.</Typography>
              )}
              {cancelledVouchers.length > 0 && (
                <Box sx={{ mt: 2, pt: 2, borderTop: '1px dashed', borderColor: 'divider' }}>
                  <Typography variant="caption" fontWeight={700} color="text.secondary">PREVIOUS (CANCELLED) VOUCHERS</Typography>
                  {cancelledVouchers.map((cv) => (
                    <Box key={cv._id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
                      <Typography variant="body2" sx={{ color: 'primary.main', cursor: 'pointer', fontWeight: 600 }} onClick={() => navigate(`/procurement/vouchers/${cv._id}`)}>{cv.voucherNumber}</Typography>
                      <VoucherStatusChip status={cv.voucherStatus} />
                    </Box>
                  ))}
                </Box>
              )}
            </Paper>
          )}
        </Box>

        {/* Approval + remarks */}
        {/* Same 3:2 column line as Invoice & Linkage | Vendor; full row when
            there is no timeline, so it never sits beside a hole. */}
        <Box sx={{ minWidth: 0, ...(inv.activityTimeline?.length ? {} : FULL_ROW) }}>
          <SectionCard icon={<CheckCircle2 size={18} />} title="Approval">
            <FieldGrid cols={{ xs: 2, sm: 3 }}>
              <Field label="Status" value={<InvoiceStatusChip status={inv.invoiceStatus} />} />
              <Field label="Approved By" value={inv.approvedBy || '—'} />
              <Field label="Approved At" value={fmtDate(inv.approvedAt)} />
              {inv.rejectedBy ? <Field label="Rejection" value={inv.rejectionRemarks || inv.rejectedBy} sx={FULL_ROW} /> : null}
              {inv.voucherNumber ? <Field label="Voucher" sx={FULL_ROW} value={<Box component="span" sx={{ color: 'primary.main', cursor: 'pointer', fontWeight: 700 }} onClick={() => liveVoucher && navigate(`/procurement/vouchers/${liveVoucher._id}`)}>{inv.voucherNumber} {liveVoucher && <VoucherStatusChip status={liveVoucher.voucherStatus} />}</Box>} /> : null}
            </FieldGrid>
          </SectionCard>
        </Box>

        {inv.activityTimeline?.length ? (
          <SectionCard icon={<FileText size={18} />} title="Timeline">
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {[...inv.activityTimeline].reverse().map((ev, i) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Chip size="small" label={ev.action} sx={{ fontWeight: 700, minWidth: 90, flexShrink: 0 }} />
                  {/* flex 1 + minWidth 0: long descriptions wrap, the date stays put */}
                  <Typography variant="body2" color="text.secondary" sx={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' }}>{ev.description}</Typography>
                  <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>{fmtDate(ev.timestamp)}</Typography>
                </Box>
              ))}
            </Box>
          </SectionCard>
        ) : null}
      </Box>

      <VendorInvoiceFormDialog open={formOpen} invoice={inv} onClose={() => setFormOpen(false)} />
      <VendorInvoiceApprovalDialog open={approvalOpen} invoice={inv} onClose={() => setApprovalOpen(false)} />
      <VoucherFormDialog open={voucherFormOpen} presetInvoice={inv} onClose={() => setVoucherFormOpen(false)} />
    </Box>
  );
};

export default VendorInvoiceDetail;
