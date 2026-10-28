import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import { useSelector } from 'react-redux';
import {
  Box, Typography, Paper, Button, IconButton, CircularProgress, Chip, Link,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from '@mui/material';
import {
  ArrowLeft, Pencil, Send, Ban, Banknote, Building2, FileText, ReceiptText,
  FileSpreadsheet, Wallet, Info, Download, Eye, ArrowRight,
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
import { VoucherStatusChip, VoucherTypeChip, fmtINR, fmtDate, expenseTypeOf, expenseTypeMeta } from './voucherMeta';
import { resolveFileUrl } from '../../../utils/fileUrl';
import StatusChip from '../components/StatusChip';
import { PFMS, pfmsCardSx } from '../pfmsTheme';
import VoucherFormDialog from './VoucherFormDialog';
import VoucherPdfPreview from './VoucherPdfPreview';
import TallyEntryFormDialog from '../tally-entry/TallyEntryFormDialog';
import { TallyStatusChip, CHECKLIST_TOTAL, checklistProgress } from '../tally-entry/tallyMeta';
import FinalPaymentFormDialog from '../final-payments/FinalPaymentFormDialog';
import { PaymentStatusChip } from '../final-payments/paymentMeta';
import WorkflowStepper from '../components/WorkflowStepper';
import { resolveWorkflowSteps } from '../components/purchaseFmsWorkflow';
import NextStepBanner from '../components/NextStepBanner';
import MdApprovalCard from '../approvals/MdApprovalCard';
import FmsDoerCard from '../../fms-doers/FmsDoerCard';

const scrollToId = (elId) => document.getElementById(elId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

// ── Same spacing/typography scale as Indent, PO, GRN and Final Payment Detail
// (SECTION_GAP/CARD_PAD/Field/FieldGrid/SectionCard), replacing the older
// p:3 cards and the 7/5 Grid whose cards ended at different heights. ──
const SECTION_GAP = 2;
const CARD_PAD = 2;

const Field = ({ label, value, sx }) => (
  <Box sx={{ minWidth: 0, ...sx }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: PFMS.sub, mb: 0.4 }}>{label}</Typography>
    {/* div, not p: several values are chips */}
    <Typography component="div" sx={{ fontSize: '0.86rem', fontWeight: 600, color: PFMS.ink, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);

// Explicit column counts per breakpoint (not auto-fill, which leaves a lone
// field on its own row): 2 in a half-width card, more when full width.
const FieldGrid = ({ cols, children }) => (
  <Box sx={{
    display: 'grid', gap: 2,
    gridTemplateColumns: Object.fromEntries(Object.entries(cols).map(([bp, n]) => [bp, `repeat(${n}, minmax(0, 1fr))`])),
  }}>
    {children}
  </Box>
);
const HALF_CARD_COLS = { xs: 2, md: 4, lg: 2, xl: 4 };
const FULL_ROW = { gridColumn: '1 / -1' };
const SPAN_2 = { gridColumn: 'span 2' };

// Column flex + height 100%: cards sharing a grid row end on the same line.
const SectionCard = ({ icon, title, children }) => (
  <Paper sx={{ ...pfmsCardSx, p: CARD_PAD, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
    <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, fontWeight: 700, fontSize: '0.92rem', color: 'primary.main' }}>{icon} {title}</Typography>
    {children}
  </Paper>
);

/**
 * All Voucher (Step 1.11) business logic and UI, as a standalone panel.
 * Shared by the standalone `/procurement/vouchers/:id` route (VoucherDetail)
 * and the embedded "Payment Voucher" section on the Vendor Invoice detail
 * page — one implementation, so the two surfaces can never drift apart.
 *
 * `embedded` trims only navigation chrome that would be redundant inside
 * another page (back button, the invoice-detail stepper already shown by the
 * host page, and the "View Invoice" link back to the page the user is
 * already on). All voucher actions, lifecycle state and cards are identical
 * in both contexts — only valid-for-current-status actions are ever shown,
 * same as before this component existed.
 */
const VoucherPanel = ({
  voucherId,
  embedded = false,
  showBackButton = !embedded,
  showWorkflowStepper = !embedded,
  showInvoiceLink = !embedded,
  backTo = '/purchase-fms/payment-vouchers',
  notFoundMessage = 'Voucher not found',
}) => {
  const navigate = useNavigate();
  const goBack = useSmartBack(backTo);
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading } = useGetVoucherByIdQuery(voucherId, { skip: !voucherId });
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
  const { data: tallyRes } = useGetTallyEntriesByVoucherQuery(voucherId, { skip: !posted });
  const tallyEntry = (tallyRes?.data || [])[0] || null;
  const tallyCompleted = v?.tallyEntryStatus === 'COMPLETED';
  const { data: payRes } = useGetFinalPaymentsByVoucherQuery(voucherId, { skip: !tallyCompleted });
  const payments = (payRes?.data || []).filter((x) => x.paymentStatus !== 'CANCELLED');
  const totalPaid = payments.reduce((s, x) => s + Number(x.paidAmount || 0), 0);
  const lastPayment = payments[0] || null;

  if (!voucherId) return null;

  if (isLoading) return <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}><CircularProgress /></Box>;
  if (!v) {
    return (
      <Box sx={{ p: embedded ? 2 : 4, textAlign: 'center' }}>
        <Typography variant="h6">{notFoundMessage}</Typography>
        {showBackButton && <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate(backTo)}>Back to list</Button>}
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

  // ── "What's next?" — single, obvious call-to-action for the current stage. ──
  const mdRequired = posted && v.approvalStatus === 'READY_FOR_MD_APPROVAL';
  // MD approval never holds the Tally Entry back — it gates the Final Payment
  // only, and requires EXACTLY approvalStatus === 'MD_APPROVED' there. This
  // must match the backend's own hard gate (finalPayment.service.js create())
  // and the Final Payment card's disabled check further down. NOT_REQUIRED is
  // NOT a stand-in for MD_APPROVED (see approvalSetupStuck below).
  const mdCleared = v.approvalStatus === 'MD_APPROVED';
  // post() always calls the approval engine's ensureReady() to move a voucher
  // from its NOT_REQUIRED default to READY_FOR_MD_APPROVAL. That call builds
  // and stores the unsigned approval PDF, and is deliberately non-fatal — if
  // it throws (e.g. a PDF-generation or file-storage failure), posting still
  // succeeds but approvalStatus is left stuck at NOT_REQUIRED forever, with
  // no automatic retry. The MD Approval card has nothing to show in this
  // state (no DocumentApproval row exists yet to sign), so without this
  // branch the voucher would silently show no next step at all.
  const approvalSetupStuck = posted && v.approvalStatus === 'NOT_REQUIRED';
  const nextStep = (() => {
    if (v.voucherStatus === 'CANCELLED') return null;
    if (isDraft && !isLocked) {
      return { tone: 'info', title: 'Next: post this voucher (Step 1.11)',
        desc: 'Posting passes the voucher for MD approval — no payment is recorded here.',
        primary: { label: 'Post Voucher', icon: <Send size={16} />, onClick: doApprove, loading: posting },
        secondary: { label: 'Edit', onClick: () => setFormOpen(true) } };
    }
    // MD approval is tracked on its own and does not hold the Tally Entry back.
    if (posted && !tallyEntry) {
      return { tone: 'success', title: 'Next: record the Tally Entry (Step 1.12)',
        desc: mdCleared ? 'MD approved. Record the purchase entry in Tally to enable Final Payment.'
          : 'MD approval is tracked separately and does not hold the Tally Entry back — only the Final Payment waits for it.',
        primary: { label: 'Create Tally Entry', icon: <FileSpreadsheet size={16} />, onClick: () => setTallyFormOpen(true) },
        ...(mdRequired ? { secondary: { label: 'Go to MD Approval', onClick: () => scrollToId('voucher-md-approval') } } : {}) };
    }
    if (tallyEntry && tallyEntry.tallyEntryStatus === 'PENDING') {
      return { tone: 'info', title: 'Tally Entry raised — complete it to enable Final Payment',
        desc: 'Finish the Tally Entry checklist on its own page.',
        primary: { label: 'View Tally Entry', icon: <FileSpreadsheet size={16} />, onClick: () => navigate(`/procurement/tally-entries/${tallyEntry._id}`) } };
    }
    if (tallyCompleted && Number(v.balanceAmount) > 0 && approvalSetupStuck) {
      return { tone: 'error', title: 'MD approval could not be prepared for this voucher',
        desc: 'The voucher posted successfully, but setting it up for MD approval failed (likely while generating its approval PDF). Final Payment needs MD approval, so it cannot be made until this is resolved — contact an administrator.' };
    }
    if (tallyCompleted && Number(v.balanceAmount) > 0 && !mdCleared) {
      return { tone: 'warn', title: 'Tally complete — payment waits for MD approval',
        desc: `Final Payment (1.13) is the one step that needs the Managing Director's approval. Balance of ${fmtINR(v.balanceAmount)} is pending.`,
        primary: { label: 'Go to MD Approval', icon: <ArrowRight size={16} />, onClick: () => scrollToId('voucher-md-approval') } };
    }
    if (tallyCompleted && Number(v.balanceAmount) > 0) {
      return { tone: 'success', title: 'Tally complete — next: record the Final Payment (Step 1.13)',
        desc: `Balance of ${fmtINR(v.balanceAmount)} is pending.`,
        primary: { label: 'Make Payment', icon: <Wallet size={16} />, onClick: () => setPaymentFormOpen(true) } };
    }
    if (['FULLY_PAID', 'SHORT_CLOSED'].includes(v.voucherStatus)) {
      return { tone: 'success', title: 'Workflow complete — voucher fully settled',
        desc: 'No further action is needed for this voucher.' };
    }
    return null;
  })();

  return (
    <Box>
      {/* Hero — same sizes as the other detail pages; the identity block has an
          explicit flex basis so long names wrap inside it. */}
      <Box sx={{ mb: SECTION_GAP, display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1.5, flexWrap: 'wrap' }}>
        {showBackButton && (
          <IconButton onClick={goBack} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}`, width: 38, height: 38 }}><ArrowLeft size={18} /></IconButton>
        )}
        <Box sx={{ width: 38, height: 38, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main', flexShrink: 0 }}><Banknote size={20} /></Box>
        <Box sx={{ flex: { xs: '1 1 200px', md: '1 1 360px' }, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: PFMS.ink }}>{v.voucherNumber}</Typography>
            <VoucherTypeChip type={v.voucherType} />
            <VoucherStatusChip status={v.voucherStatus} />
          </Box>
          <Typography variant="body2" sx={{ color: PFMS.sub, overflowWrap: 'anywhere' }}>
            {isExpense
              ? `${v.expenseCategory || 'Expense'} · ${v.partyName || v.vendorName || '—'} · ${fmtDate(v.voucherDate)}`
              : `${v.vendorName} · Invoice ${v.invoiceNumber || '—'} · ${fmtDate(v.voucherDate)}`}
          </Typography>
        </Box>
        <Box sx={{
          display: 'flex', gap: 1, flexWrap: 'wrap', width: { xs: '100%', sm: 'auto' },
          '& .MuiButtonBase-root': { flex: { xs: '1 1 auto', sm: '0 0 auto' } },
        }}>
          <Button variant="outlined" startIcon={pdfLoading ? <CircularProgress size={16} /> : <Eye size={16} />} onClick={doPreviewPdf} disabled={pdfLoading}>{isLocked ? 'View Signed PDF' : 'Preview PDF'}</Button>
          <Button variant="outlined" startIcon={pdfLoading ? <CircularProgress size={16} /> : <Download size={16} />} onClick={doDownloadPdf} disabled={pdfLoading}>Download PDF</Button>
          {showInvoiceLink && v.invoiceId && <Button variant="outlined" startIcon={<ReceiptText size={16} />} onClick={() => navigate(`/procurement/vendor-invoices/${v.invoiceId}`)}>View Invoice</Button>}
          {isDraft && !isLocked && <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setFormOpen(true)}>Edit</Button>}
          {isDraft && !isLocked && <Button variant="outlined" color="error" startIcon={<Ban size={16} />} onClick={() => setCancelOpen(true)}>Cancel</Button>}
          {isDraft && !isLocked && <Button variant="contained" color="success" startIcon={posting ? <CircularProgress size={16} color="inherit" /> : <Send size={16} />} onClick={doApprove} disabled={posting}>Post Voucher</Button>}
        </Box>
      </Box>

      <NextStepBanner step={nextStep} />

      <FmsDoerCard entityType="VOUCHER" entityId={voucherId} sx={{ mb: SECTION_GAP }} />
      {showWorkflowStepper && <WorkflowStepper steps={wfSteps} sx={{ mb: SECTION_GAP }} />}
      {/* One grid: two equal columns from lg (pairs share top and height),
          full-width rows for Financials / MD Approval / Timeline. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'repeat(2, minmax(0, 1fr))' }, gap: SECTION_GAP }}>
        <SectionCard icon={<Wallet size={18} />} title="Payment Status">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
            {v.finalPaymentStatus && v.finalPaymentStatus !== 'PENDING'
              ? <PaymentStatusChip status={v.finalPaymentStatus} />
              : <StatusChip status="PENDING" label="Pending Final Payment" />}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, p: 1.5, borderRadius: '8px', bgcolor: alpha('#1d4ed8', 0.05) }}>
            <Info size={16} color="#1d4ed8" style={{ marginTop: 2, flexShrink: 0 }} />
            <Typography variant="body2" color="text.secondary">
              This step only passes / approves the voucher — no payment is recorded here.
              The actual vendor payment will be recorded in <b>Step 1.13 — Final Payment</b>.
            </Typography>
          </Box>
          {v.remarks ? <Box sx={{ mt: 1.5 }}><Field label="Remarks" value={v.remarks} /></Box> : null}
        </SectionCard>

        <SectionCard icon={<Building2 size={18} />} title={isExpense ? 'Expense & Party' : 'Vendor & Linkage'}>
          {isExpense ? (
            <FieldGrid cols={HALF_CARD_COLS}>
              <Box sx={FULL_ROW}><Chip size="small" label={expenseTypeMeta(expenseTypeOf(v)).label} sx={{ fontWeight: 700 }} data-testid="voucher-expense-type" /></Box>
              {expenseTypeOf(v) === 'AGAINST_PO' && (
                <Field label="Purchase Order" value={v.poId
                  ? <Link component="button" type="button" onClick={() => navigate(`/procurement/purchase-orders/${v.poId}`)} sx={{ fontWeight: 700 }}>{v.poNumber || '—'}</Link>
                  : (v.poNumber || '—')} />
              )}
              {expenseTypeOf(v) === 'AGAINST_GRN' && (
                <Field label="GRN" value={v.grnId
                  ? <Link component="button" type="button" onClick={() => navigate(`/procurement/grns/${v.grnId}`)} sx={{ fontWeight: 700 }}>{(v.grnNumbers || []).join(', ') || '—'}</Link>
                  : ((v.grnNumbers || []).join(', ') || '—')} />
              )}
              <Field label="Party" value={v.partyName || v.vendorName || '—'} />
              {v.vendorId && <Field label="Vendor (Master)" value={v.vendorName || '—'} />}
              <Field label="Category" value={v.expenseCategory || '—'} />
              <Field label="Vendor Bill/Invoice No" value={v.expenseInvoiceNo || '—'} />
              <Field label="Bill Date" value={fmtDate(v.expenseInvoiceDate)} />
              <Field label="Payment Terms" value={v.paymentTerms || '—'} />
              <Field label="Due Date" value={fmtDate(v.dueDate)} />
              {v.invoiceDocument?.fileUrl && (
                <Box sx={FULL_ROW}>
                  <Button size="small" variant="outlined" startIcon={<FileText size={15} />} href={resolveFileUrl(v.invoiceDocument.fileUrl)} target="_blank" rel="noopener">View Invoice File</Button>
                </Box>
              )}
            </FieldGrid>
          ) : (
            // 3-up when there is room (Vendor · Invoice · PO / Status · GRNs),
            // 2-up in a half-width card; GRNs always take two columns.
            <FieldGrid cols={{ xs: 2, sm: 3, lg: 2, xl: 3 }}>
              <Field label="Vendor" value={v.vendorName || '—'} />
              <Field label="Invoice" value={v.invoiceNumber || '—'} />
              <Field label="PO" value={v.poNumber || '—'} />
              <Field label="Status" value={<VoucherStatusChip status={v.voucherStatus} />} />
              <Field label={`GRN${(v.grnNumbers || []).length > 1 ? 's' : ''}`} value={(v.grnNumbers || []).join(', ') || '—'} sx={SPAN_2} />
            </FieldGrid>
          )}
        </SectionCard>

        {/* Financials — compact: the Paid/Balance totals sit beside the fields from
            lg (fields 3-up there, one row of 6 from xl) instead of a full-width band. */}
        <Box sx={{ ...FULL_ROW, minWidth: 0 }}>
          <SectionCard icon={<ReceiptText size={18} />} title="Financials">
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) auto' }, gap: 2, alignItems: 'center' }}>
              {isExpense ? (
                <FieldGrid cols={{ xs: 2, sm: 3, xl: 5 }}>
                  <Field label="Basic Value" value={fmtINR(v.basicValue)} />
                  <Field label="Freight" value={fmtINR(v.freightCharges)} />
                  <Field label="Packing & Fwd" value={fmtINR(v.packingForwardingCharges)} />
                  <Field label="Other Charges" value={fmtINR(v.otherCharges)} />
                  {v.gstRatePercent ? (
                    <>
                      <Field label="Taxable Amount" value={fmtINR(v.taxableAmount)} />
                      <Field label={`GST @ ${v.gstRatePercent}%`} value={fmtINR(v.taxAmount)} />
                    </>
                  ) : (
                    <Field label="Tax Amount" value={fmtINR(v.taxAmount)} />
                  )}
                  <Field label="TCS (+)" value={fmtINR(v.tcsAmount)} />
                  <Field label="TDS (−)" value={fmtINR(v.tdsAmount)} />
                  <Field label="Advance (−)" value={fmtINR(v.advanceAmount)} />
                </FieldGrid>
              ) : (
                <FieldGrid cols={{ xs: 2, sm: 3, xl: 6 }}>
                  <Field label="Invoice Amount" value={fmtINR(v.invoiceAmount)} />
                  <Field label="Advance" value={fmtINR(v.advancePaid)} />
                  <Field label="Debit Note" value={fmtINR(v.debitNoteAmount)} />
                  <Field label="Net Payable" value={fmtINR(v.netPayableAmount)} />
                  <Field label="Paid" value={fmtINR(v.paidAmount)} />
                  <Field label="Balance" value={fmtINR(v.balanceAmount)} />
                </FieldGrid>
              )}
              <Box sx={{ px: 2, py: 1.25, borderRadius: '8px', bgcolor: alpha('#16a34a', 0.05), display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
                <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>PAID</Typography><Typography variant="h6" fontWeight={800} sx={{ color: '#16a34a', lineHeight: 1.3 }}>{fmtINR(v.paidAmount)}</Typography></Box>
                <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="text.secondary" fontWeight={700}>BALANCE</Typography><Typography variant="h6" fontWeight={800} sx={{ color: v.balanceAmount > 0 ? '#b45309' : '#16a34a', lineHeight: 1.3 }}>{fmtINR(v.balanceAmount)}</Typography></Box>
              </Box>
            </Box>
          </SectionCard>
        </Box>

        {/* MD Digital Approval & Signature. :empty — the card renders nothing
            until the voucher is ready for MD approval; don't leave a gap. */}
        <Box id="voucher-md-approval" sx={{ ...FULL_ROW, minWidth: 0, '&:empty': { display: 'none' } }}>
          <MdApprovalCard
            documentType="VOUCHER"
            documentId={v._id}
            documentTitle={v.voucherNumber}
            isMd={isMd}
            onPreviewPdf={doPreviewPdf}
            skip={v.approvalStatus === 'NOT_REQUIRED'}
            dense
          />
        </Box>

        {/* Step 1.12 — Purchase Entry in Tally */}
        <SectionCard icon={<FileSpreadsheet size={18} />} title="Purchase Entry in Tally (1.12)">
          {tallyEntry ? (
            <FieldGrid cols={HALF_CARD_COLS}>
              <Field label="Entry No" value={tallyEntry.entryNumber} />
              <Field label="Status" value={<TallyStatusChip status={tallyEntry.tallyEntryStatus} />} />
              <Field label="Checklist" value={`${checklistProgress(tallyEntry.checklist)}/${CHECKLIST_TOTAL}`} />
              <Field label="Actual Date" value={fmtDate(tallyEntry.actualAt)} />
              <Box sx={FULL_ROW}>
                <Button size="small" variant="outlined" startIcon={<FileSpreadsheet size={15} />} onClick={() => navigate(`/procurement/tally-entries/${tallyEntry._id}`)}>View Tally Entry</Button>
              </Box>
            </FieldGrid>
          ) : (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {!posted ? 'Post the voucher first to enable a Tally Entry.'
                  : 'No Tally Entry yet. Record the purchase entry to enable final payment.'}
              </Typography>
              <Button size="small" variant="contained" startIcon={<FileSpreadsheet size={15} />}
                disabled={!posted} onClick={() => setTallyFormOpen(true)}>Create Tally Entry</Button>
            </Box>
          )}
        </SectionCard>

        {/* Step 1.13 — Make Payment */}
        <SectionCard icon={<Wallet size={18} />} title="Final Payment (1.13)">
          <FieldGrid cols={HALF_CARD_COLS}>
            <Field label="Payment Status" value={v.finalPaymentStatus && v.finalPaymentStatus !== 'PENDING' ? <PaymentStatusChip status={v.finalPaymentStatus} /> : 'Pending'} />
            <Field label="Paid Amount" value={fmtINR(totalPaid)} />
            <Field label="Pending Amount" value={fmtINR(v.balanceAmount)} />
            <Field label="Last Payment" value={fmtDate(lastPayment?.paymentDate || v.lastPaymentDate)} />
            <Box sx={FULL_ROW}>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button size="small" variant="contained" color="success" startIcon={<Wallet size={15} />}
                  disabled={!tallyCompleted || !mdCleared || Number(v.balanceAmount) <= 0} onClick={() => setPaymentFormOpen(true)}>Make Payment</Button>
                {payments.length > 0 && <Button size="small" variant="outlined" onClick={() => navigate(`/procurement/final-payments/${lastPayment._id}`)}>View Payments</Button>}
              </Box>
              {!tallyCompleted && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Complete the Tally Entry before making payment.</Typography>}
              {tallyCompleted && !mdCleared && Number(v.balanceAmount) > 0 && <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'warning.dark' }}>Payment unlocks once the MD approves this voucher.</Typography>}
            </Box>
          </FieldGrid>
        </SectionCard>

        {v.activityTimeline?.length ? (
          <Box sx={{ ...FULL_ROW, minWidth: 0 }}>
            <SectionCard icon={<FileText size={18} />} title="Timeline">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[...v.activityTimeline].reverse().map((ev, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Chip size="small" label={ev.action} sx={{ fontWeight: 700, minWidth: 90, flexShrink: 0 }} />
                    {/* flex 1 + minWidth 0: long descriptions wrap, the date stays put */}
                    <Typography variant="body2" color="text.secondary" sx={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' }}>{ev.description}</Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>{fmtDate(ev.timestamp)}</Typography>
                  </Box>
                ))}
              </Box>
            </SectionCard>
          </Box>
        ) : null}
      </Box>

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

export default VoucherPanel;
