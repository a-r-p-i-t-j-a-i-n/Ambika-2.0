import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import { useSelector } from 'react-redux';
import {
  Box, Typography, Paper, Button, IconButton, CircularProgress, Chip, Tooltip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import {
  ArrowLeft, Pencil, PackageCheck, Ban, Boxes, Building2, FileText, ShoppingBag,
  Warehouse, ReceiptText, FileDown, Trash2, Lock,
} from 'lucide-react';
import { usePermissions } from '../../../hooks/usePermission';
import { alpha } from '@mui/material/styles';
import { useSnackbar } from 'notistack';
import {
  useGetGrnByIdQuery,
  useCancelGrnMutation,
  useGetInventoryMovementsByRefQuery,
  useGetIncomingQcsByGrnQuery,
  useGetVendorInvoicesByQcQuery,
} from '../../../store/api/procurementApi';
import { GrnStatusChip, howReceivedLabel, fmtINR, fmtDate, isGrnDraft, isGrnCompleted } from './grnMeta';
import { lineReceiptType, receiptTypeSummaryLabel } from './grnReceiptType';
import GrnFormDialog from './GrnFormDialog';
import GrnCompleteDialog from './GrnCompleteDialog';
import GrnDeleteDialog from './GrnDeleteDialog';
import GrnPdfPreview from './GrnPdfPreview';
import { GrnQcSections } from './GrnQcSection';
import GrnQcStatusChip from './GrnQcStatusChip';
import { inventoryTypeLabel } from './inventoryType';
import { destinationText } from './inventoryDestination';

/** Where a QC-gated line's stock stands (legacy lines have no status). */
const STOCK_STATUS = {
  AWAITING_QC: { label: 'Awaiting QC', color: '#b45309' },
  POSTED: { label: 'Posted', color: '#0f766e' },
  NOT_POSTED: { label: 'Not posted', color: '#64748b' },
};
import { resolveGrnQcStage } from './grnQcStage';
import { pickGrnQc } from '../incoming-qc/qcForm';
import VendorInvoiceFormDialog from '../vendor-invoices/VendorInvoiceFormDialog';
import MdApprovalCard from '../approvals/MdApprovalCard';
import { ClipboardCheck } from 'lucide-react';
import WorkflowStepper from '../components/WorkflowStepper';
import { resolveWorkflowSteps } from '../components/purchaseFmsWorkflow';
import NextStepBanner from '../components/NextStepBanner';
import { PFMS, pfmsPageSx, pfmsCardSx, pfmsTableHeadSx } from '../pfmsTheme';
import FmsDoerCard from '../../fms-doers/FmsDoerCard';

// ── Same spacing/typography scale as Indent, PO and Follow-up Detail
// (SECTION_GAP/CARD_PAD/Field/FieldGrid/SectionCard), replacing the older
// p:3 cards and the xs=6/sm=4 field grid. ──
const SECTION_GAP = 2;
const CARD_PAD = 2;

const Field = ({ label, value, sx }) => (
  <Box sx={{ minWidth: 0, ...sx }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: PFMS.sub, mb: 0.4 }}>{label}</Typography>
    {/* div, not p: the PI Number value is a link span and may grow into richer content */}
    <Typography component="div" sx={{ fontSize: '0.86rem', fontWeight: 600, color: PFMS.ink, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);

// Fields on common columns. The fixed 3-up grid squeezed every field to ~140px
// in a half-width card (4-line values, a card twice as tall as its partner).
// Columns are counted from the 150px minimum and share the remaining width, so
// both cards fill their width evenly; phones keep an explicit two-up.
const FieldGrid = ({ children, sx }) => (
  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(auto-fill, minmax(150px, 1fr))' }, gap: 2, ...sx }}>
    {children}
  </Box>
);
const SPAN_2 = { gridColumn: 'span 2' };
const FULL_ROW = { gridColumn: '1 / -1' };

const SectionCard = ({ icon, title, children }) => (
  <Paper sx={{ ...pfmsCardSx, p: CARD_PAD, minWidth: 0 }}>
    <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, fontWeight: 700, fontSize: '0.92rem', color: 'primary.main' }}>
      {icon} {title}
    </Typography>
    {children}
  </Paper>
);

// Divides the page into its two parts: the GRN (A) and its Incoming QC (B).
const PageSection = ({ letter, title, subtitle, sx }) => (
  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap', borderBottom: `2px solid ${PFMS.line}`, pb: 1, ...sx }}>
    <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: PFMS.ink }}>
      <Box component="span" sx={{ color: 'primary.main', mr: 1 }}>{letter}</Box>{title}
    </Typography>
    {subtitle && <Typography variant="body2" sx={{ color: PFMS.sub }}>{subtitle}</Typography>}
  </Box>
);

// Material Receipt table. Headings may wrap (bottom-aligned so the row stays
// even); numeric columns get a floor so a heading never breaks into a
// one-word-per-line tower, and identifiers (PO, SKU, movement) stay on one
// line. Remarks wraps inside a capped width — as a noWrap cell its full text
// used to set the table's minimum width and squeeze every other column.
// 16 columns: 12px cell padding instead of 16 lets the whole table fit at 1920.
const receiptTableSx = { '& .MuiTableCell-root': { px: 1.5 } };
const headSx = { ...pfmsTableHeadSx, whiteSpace: 'normal', lineHeight: 1.3, verticalAlign: 'bottom' };
const numCellSx = { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
const NUM_COLS = [
  ['Ordered', 72], ['Already Received', 88], ['Pending Before GRN', 88], ['Invoice', 72],
  ['Received', 76], ['Short', 64], ['Pending After GRN', 88],
];

const scrollToId = (elId) => document.getElementById(elId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

const GrnDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack('/purchase-fms/grn');
  const { enqueueSnackbar } = useSnackbar();

  const { data, isLoading } = useGetGrnByIdQuery(id);
  const grn = data?.data;
  const wfSteps = resolveWorkflowSteps({ grn });
  const [cancelGrn] = useCancelGrnMutation();
  const isMd = useSelector((s) => s.auth.isRoot);
  const canDeleteGrn = usePermissions().can('procurement.deleteGrn');

  const isCompleted = grn && isGrnCompleted(grn);
  const { data: movRes } = useGetInventoryMovementsByRefQuery({ refType: 'GRN', refId: id }, { skip: !isCompleted });
  const movements = movRes?.data || [];
  // The GRN's QC records — the open draft (to resume) or the completed QC. The
  // GRN itself only learns its qcId on completion, so drafts are found here.
  const { data: qcRes } = useGetIncomingQcsByGrnQuery(id, { skip: !isCompleted });
  const qc = pickGrnQc(qcRes?.data || []);
  const qcPassed = qc && ['PASSED', 'PARTIAL'].includes(qc.qcStatus);
  const { data: invByQcRes } = useGetVendorInvoicesByQcQuery(qc?._id, { skip: !qcPassed || !qc?._id });
  const existingInvoice = (invByQcRes?.data || [])[0] || null;

  const [formOpen, setFormOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  // Links into the QC (e.g. from the PO page or the QC list) use #qc.
  const { hash } = useLocation();
  const loaded = Boolean(grn);
  useEffect(() => {
    if (hash !== '#qc' || !loaded) return undefined;
    const t = setTimeout(() => scrollToId('grn-qc-section'), 300);
    return () => clearTimeout(t);
  }, [hash, loaded]);

  if (isLoading) return <Box sx={{ display: 'grid', placeItems: 'center', height: '70vh' }}><CircularProgress /></Box>;
  if (!grn) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6">GRN not found</Typography>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/purchase-fms/grn')}>Back to list</Button>
      </Box>
    );
  }

  // Draft = editable / deletable / completable. Once completed (receipt final)
  // the GRN is read-only for good — the server enforces the same rule.
  const isDraft = isGrnDraft(grn);
  // MD-signed GRNs are locked — editing/cancelling is blocked here (mirrors the
  // backend guard in grn.service.js) even if grnStatus were somehow still DRAFT.
  const isLocked = grn.approvalStatus === 'MD_APPROVED';
  const handleCancel = async () => {
    try { await cancelGrn({ id: grn._id }).unwrap(); enqueueSnackbar('GRN cancelled', { variant: 'info' }); }
    catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to cancel', { variant: 'error' }); }
  };

  // ── "What's next?" — single, obvious call-to-action for the current stage. ──
  const qcStage = resolveGrnQcStage(grn, qc);
  const toQcSection = () => scrollToId('grn-qc-section');
  const nextStep = (() => {
    if (isDraft) {
      return { tone: 'info', title: 'Next action: Complete GRN',
        desc: 'Confirm the received quantities. Incoming QC (below) opens once the GRN is completed; accepted quantities are posted to stock when the QC is completed.',
        primary: { label: 'Complete GRN', icon: <PackageCheck size={16} />, onClick: () => setCompleteOpen(true) },
        secondary: { label: 'Edit', onClick: () => setFormOpen(true) } };
    }
    if (qcStage.key === 'CANCELLED') return null;
    if (qcStage.key === 'QC_DRAFT') {
      return { tone: 'info', title: `QC draft ${qc.qcNumber} saved — finish the inspection below`,
        desc: 'Record accepted / rejected / rework quantities and complete the QC.',
        primary: { label: 'Resume QC', icon: <ClipboardCheck size={16} />, onClick: toQcSection } };
    }
    if (qcStage.key === 'QC_READY') {
      return { tone: 'success', title: 'Goods received — next: Incoming QC (below)',
        desc: grn.approvalStatus === 'MD_APPROVED'
          ? 'Inspect the received material and record the QC result in section B.'
          : 'Inspect the received material and record the QC result in section B. MD approval of this GRN is tracked separately and does not hold the QC back.',
        primary: { label: 'Start QC', icon: <ClipboardCheck size={16} />, onClick: toQcSection },
        secondary: grn.poId ? { label: 'View PO', onClick: () => navigate(`/procurement/purchase-orders/${grn.poId}`) } : null };
    }
    if (qcStage.key === 'QC_DONE') {
      // Vendor Invoice pricing (rate/GST) comes from the PO line — a W/O PO GRN
      // has none, so invoicing is not yet supported for it (see
      // vendorInvoiceService.loadAndValidateQcs). Said plainly rather than
      // letting the user open the invoice form and hit a server error.
      if (grn.isWithoutPo) {
        return { tone: 'info', title: 'QC complete — Vendor Invoice is not yet supported for a W/O PO GRN',
          desc: 'Invoice pricing is sourced from the Purchase Order line, and this GRN has none. Contact an administrator if this material still needs to be invoiced.',
          secondary: { label: 'View QC', onClick: () => navigate(`/procurement/incoming-qc/${qc._id}`) } };
      }
      // Preset the invoice creation flow from this QC — same pattern as
      // Incoming QC Detail's own "Create Invoice" entry point, rather than
      // dropping the user onto the generic Vendor Invoices list.
      if (existingInvoice) {
        return { tone: 'success', title: 'Vendor Invoice recorded — track payment & accounting',
          desc: 'Follow it through approval and the payment voucher in Vendor Invoices & Payments.',
          primary: { label: 'View Invoice', icon: <ReceiptText size={16} />, onClick: () => navigate(`/procurement/vendor-invoices/${existingInvoice._id}`) },
          secondary: { label: 'View QC', onClick: () => navigate(`/procurement/incoming-qc/${qc._id}`) } };
      }
      return { tone: 'success', title: 'QC complete — next: record the Vendor Invoice',
        desc: 'Capture the vendor’s tax invoice for the accepted material to proceed to payment.',
        primary: { label: 'Create Invoice', icon: <ReceiptText size={16} />, onClick: () => setInvoiceOpen(true) },
        secondary: { label: 'View QC', onClick: () => navigate(`/procurement/incoming-qc/${qc._id}`) } };
    }
    if (qcStage.key === 'QC_DONE_LEGACY') {
      const qcId = grn.qcId;
      return { tone: 'success', title: 'QC complete — next: record the Vendor Invoice',
        desc: 'Capture the vendor’s tax invoice to proceed to payment & accounting.',
        primary: { label: 'Go to Vendor Invoices', icon: <ReceiptText size={16} />, onClick: () => navigate('/purchase-fms/vendor-invoices') },
        secondary: qcId ? { label: 'View QC', onClick: () => navigate(`/procurement/incoming-qc/${qcId}`) } : null };
    }
    return null;
  })();

  return (
    <Box sx={{ ...pfmsPageSx }}>
      {/* Hero — same sizes as Indent/PO/Follow-up Detail. The identity block has
          an explicit flex basis so long vendor names wrap inside it instead of
          pushing the actions around unpredictably. */}
      <Box sx={{ mb: SECTION_GAP, display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1.5, flexWrap: 'wrap' }}>
        <Tooltip title="Back">
          <IconButton onClick={goBack} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}`, width: 38, height: 38 }}>
            <ArrowLeft size={18} />
          </IconButton>
        </Tooltip>
        <Box sx={{ width: 38, height: 38, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main', flexShrink: 0 }}>
          <PackageCheck size={20} />
        </Box>
        <Box sx={{ flex: { xs: '1 1 200px', md: '1 1 420px' }, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: PFMS.ink }}>{grn.grnNumber}</Typography>
            {grn.uniqueId && <Chip size="small" variant="outlined" label={grn.uniqueId} sx={{ fontWeight: 700 }} />}
            <GrnStatusChip status={grn.grnStatus} />
            <span data-testid="grn-hero-qc-status"><GrnQcStatusChip stage={qcStage} /></span>
            {isCompleted && (
              <Chip size="small" variant="outlined" icon={<Lock size={13} />} label="Completed · Read-only"
                title="Stock has been posted — this GRN can no longer be edited or deleted"
                sx={{ fontWeight: 700, color: PFMS.sub, borderColor: PFMS.line, '& .MuiChip-icon': { color: PFMS.sub } }} />
            )}
            {grn.isWithoutPo && (
              <Chip size="small" variant="outlined" color="warning" label="Without PO" sx={{ fontWeight: 700 }} />
            )}
          </Box>
          <Typography variant="body2" sx={{ color: PFMS.sub, overflowWrap: 'anywhere' }}>
            {grn.vendorName} · {grn.isWithoutPo ? 'Without PO' : `PO ${(grn.poNumbers?.length ? grn.poNumbers : [grn.poNumber]).filter(Boolean).join(', ') || '—'}`} · {fmtDate(grn.grnDate)}
          </Typography>
        </Box>
        <Box sx={{
          display: 'flex', gap: 1, flexWrap: 'wrap', width: { xs: '100%', sm: 'auto' },
          '& .MuiButtonBase-root': { flex: { xs: '1 1 auto', sm: '0 0 auto' } },
        }}>
          {(grn.poIds?.length ? grn.poIds : (grn.poId ? [grn.poId] : [])).map((pid, i) => (
            <Button key={pid} variant="outlined" startIcon={<ShoppingBag size={16} />} onClick={() => navigate(`/procurement/purchase-orders/${pid}`)}>
              View PO{(grn.poNumbers?.length > 1) ? ` ${grn.poNumbers[i] || ''}` : ''}
            </Button>
          ))}
          {isDraft && !isLocked && <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setFormOpen(true)}>Edit</Button>}
          {isDraft && !isLocked && <Button variant="contained" color="success" startIcon={<PackageCheck size={16} />} onClick={() => setCompleteOpen(true)}>Complete GRN</Button>}
          {grn.grnPdfUrl && <Button variant="outlined" startIcon={<FileDown size={16} />} onClick={() => setPdfOpen(true)}>{isLocked ? 'View Signed PDF' : 'GRN PDF'}</Button>}
          {isDraft && !isLocked && <Button variant="outlined" color="error" startIcon={<Ban size={16} />} onClick={handleCancel}>Cancel</Button>}
          {isDraft && !isLocked && canDeleteGrn && <Button variant="outlined" color="error" startIcon={<Trash2 size={16} />} onClick={() => setDeleteOpen(true)}>Delete</Button>}
        </Box>
      </Box>

      <NextStepBanner step={nextStep} />

      <FmsDoerCard entityType="GRN" entityId={id} sx={{ mb: SECTION_GAP }} />
      <WorkflowStepper steps={wfSteps} sx={{ mb: SECTION_GAP }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: SECTION_GAP }}>
        <PageSection letter="A" title="GRN Details" subtitle="Goods received against the PO · stock · MD approval" />

        {/* GRN + Vendor/PO info. Side by side only from lg; below that they
            stack full width. Split 3:2 because GRN Information carries ~13
            fields to the vendor card's 9, so both end up with about the same
            number of rows. Top-aligned rather than stretched, so a long Remarks
            block never pads its partner with an empty band. */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 3fr) minmax(0, 2fr)' }, gap: SECTION_GAP, alignItems: 'start' }}>
          <SectionCard icon={<FileText size={18} />} title="GRN Information">
            <FieldGrid>
              <Field label="GRN Date" value={fmtDate(grn.grnDate)} />
              <Field label="Unique Id" value={grn.uniqueId || '—'} />
              <Field label="Material Receipt Type" value={receiptTypeSummaryLabel(grn)} />
              <Field label="Challan No" value={grn.challanNumber || '—'} />
              <Field label="Invoice No" value={grn.invoiceNumber || '—'} />
              <Field label="Invoice Date" value={fmtDate(grn.invoiceDate)} />
              <Field label="Vehicle No" value={grn.vehicleNumber || '—'} />
              <Field label="Received By" value={grn.receivedBy || '—'} />
              <Field label="Prepared By" value={grn.preparedBy || '—'} />
              <Field label={<Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}><Warehouse size={12} /> Warehouse</Box>} value={grn.warehouse || 'MAIN'} />
              {/* Shown beside Warehouse on purpose: they are different things.
                  Warehouse is the GRN's own store (MAIN); Received At is where
                  the Raw Material landed, and is what the RM movement uses. */}
              {/* GRNs completed before automatic routing keep showing the manual
                  choice they were posted under — never reinterpreted. Every other
                  GRN routes each line from its SKU master and posts after QC. */}
              {isGrnCompleted(grn) && !grn.stockPostingStage ? (
                <Field label="Inventory Type (earlier GRN)" value={grn.inventoryType
                  ? inventoryTypeLabel(grn.inventoryType)
                  : `— (Add to RM Stock: ${grn.addToRmStock ? 'Yes' : 'No'})`} />
              ) : (
                <Field label="Stock Posting" value="After QC · destination per line from SKU master" />
              )}
              <Field label="Received At" value={grn.rmReceivedAtLocation || '—'} />
              <Field label="Completed At" value={fmtDate(grn.completedAt)} />
              {grn.remarks ? <Field label="Remarks" value={grn.remarks} sx={FULL_ROW} /> : null}
            </FieldGrid>
          </SectionCard>

          {/* Vendor + PO/PI linkage */}
          <SectionCard icon={<Building2 size={18} />} title="Vendor · PO · PI">
            {/* dense: when the two-column Address can't fit beside Phone, the
                next field fills that gap instead of leaving a hole. */}
            <FieldGrid sx={{ gridAutoFlow: 'row dense' }}>
              <Field label="Vendor" value={grn.vendorName || '—'} />
              <Field label="GST" value={grn.vendorGST || '—'} />
              <Field label="Phone" value={grn.vendorPhone || '—'} />
              {/* Two columns: an address is the one long free-text value here. */}
              <Field label="Address" value={grn.vendorAddress || '—'} sx={SPAN_2} />
              <Field label={`PO Number${(grn.poNumbers?.length || 0) > 1 ? 's' : ''}`}
                value={grn.isWithoutPo ? 'Without PO' : ((grn.poNumbers?.length ? grn.poNumbers : [grn.poNumber]).filter(Boolean).join(', ') || '—')} />
              <Field label="PI Number" value={grn.piId
                ? <Box component="span" sx={{ color: 'primary.main', cursor: 'pointer', fontWeight: 700 }} onClick={() => navigate(`/procurement/proforma-invoices/${grn.piId}`)}>{grn.piNumber || 'View PI'}</Box>
                : (grn.piNumber || '—')} />
              <Field label="Indent" value={grn.indentNumber || '—'} />
              <Field label="Received Qty" value={grn.totalReceivedQty} />
              <Field label="Receipt Value" value={fmtINR(grn.totalValue)} />
            </FieldGrid>
          </SectionCard>
        </Box>

        {/* Material receipt table — scrolls sideways inside the card when
            narrower than its columns; the page itself never scrolls. */}
        <SectionCard icon={<ReceiptText size={18} />} title={`Material Receipt (${grn.items?.length || 0})`}>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={receiptTableSx}>
              <TableHead>
                <TableRow>
                  <TableCell sx={headSx}>#</TableCell>
                  {(grn.poNumbers?.length || 0) > 1 && <TableCell sx={headSx}>PO</TableCell>}
                  <TableCell sx={{ ...headSx, minWidth: 160 }}>Description</TableCell>
                  <TableCell sx={headSx}>SKU</TableCell>
                  {NUM_COLS.map(([h, w]) => <TableCell key={h} align="right" sx={{ ...headSx, minWidth: w }}>{h}</TableCell>)}
                  <TableCell sx={{ ...headSx, minWidth: 120 }}>Receipt Type</TableCell>
                  <TableCell sx={headSx}>Item Status</TableCell>
                  <TableCell sx={{ ...headSx, minWidth: 120 }}>Batch</TableCell>
                  <TableCell sx={{ ...headSx, minWidth: 130 }}>Stock</TableCell>
                  <TableCell sx={{ ...headSx, minWidth: 130 }}>Remarks</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(grn.items || []).map((it, i) => {
                  // Legacy GRNs predate the persisted pendingBeforeGrn field — derive
                  // it the same way the backend does so old records stay readable.
                  const pendingBeforeGrn = it.pendingBeforeGrn ?? Math.max(0, (it.orderedQty || 0) - (it.previouslyReceivedQty || 0));
                  // Item-wise receipt status, derived from this line's own pending/extra
                  // qty (never from the PO or GRN as a whole) — an item is only "Fully
                  // Received" once ITS pending-after-GRN qty is zero.
                  // A W/O PO line has no PO to compare against — ordered/already
                  // received/pending are not applicable, never fabricated as 0.
                  const itemStatus = grn.isWithoutPo
                    ? { label: 'Received', color: '#0f766e' }
                    : (it.extraQty || 0) > 0
                      ? { label: 'Extra Received', color: '#c2410c' }
                      : (it.pendingQty || 0) > 0
                        ? { label: 'Partially Received', color: '#b45309' }
                        : { label: 'Fully Received', color: '#0f766e' };
                  return (
                    <TableRow key={it._id || i} hover>
                      <TableCell>{i + 1}</TableCell>
                      {(grn.poNumbers?.length || 0) > 1 && (
                        <TableCell sx={{ whiteSpace: 'nowrap' }}><Typography variant="body2" color="text.secondary">{it.poNumber || '—'}</Typography></TableCell>
                      )}
                      <TableCell sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{it.itemName}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}><Typography variant="body2" color="primary.main" fontWeight={700}>{it.skuCode || '—'}</Typography></TableCell>
                      <TableCell align="right" sx={numCellSx}>{grn.isWithoutPo ? 'N/A' : it.orderedQty}</TableCell>
                      <TableCell align="right" sx={numCellSx}>{grn.isWithoutPo ? 'N/A' : (it.previouslyReceivedQty || 0)}</TableCell>
                      <TableCell align="right" sx={{ ...numCellSx, fontWeight: 700, color: pendingBeforeGrn > 0 ? '#b45309' : '#0f766e' }}>{grn.isWithoutPo ? 'N/A' : pendingBeforeGrn}</TableCell>
                      <TableCell align="right" sx={numCellSx}>{it.invoiceQty}</TableCell>
                      <TableCell align="right" sx={{ ...numCellSx, color: '#0f766e', fontWeight: 700 }}>{it.receivedQty}</TableCell>
                      <TableCell align="right" sx={{ ...numCellSx, color: it.shortQty > 0 ? '#b45309' : 'text.secondary' }}>{it.shortQty || 0}</TableCell>
                      <TableCell align="right" sx={{ ...numCellSx, color: it.pendingQty > 0 ? '#b45309' : '#0f766e' }}>{grn.isWithoutPo ? 'N/A' : (it.pendingQty || 0)}</TableCell>
                      <TableCell data-testid="grn-line-receipt-type-value">{howReceivedLabel(lineReceiptType(it, grn))}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Chip size="small" label={itemStatus.label} sx={{ fontWeight: 700, color: itemStatus.color, bgcolor: alpha(itemStatus.color, 0.1) }} />
                      </TableCell>
                      <TableCell sx={{ overflowWrap: 'anywhere' }}>{it.batchNo || '—'}</TableCell>
                      <TableCell data-testid="grn-line-stock">
                        {it.inventoryDestination && (
                          <Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>
                            {destinationText(it.inventoryDestination, it.stockWarehouse)}
                          </Typography>
                        )}
                        {STOCK_STATUS[it.stockStatus] && (
                          <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, color: STOCK_STATUS[it.stockStatus].color }}>
                            {STOCK_STATUS[it.stockStatus].label}{it.stockStatus === 'POSTED' ? ` ${it.postedQty}` : ''}
                          </Typography>
                        )}
                        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{it.movementNumber || (it.inventoryDestination ? '' : '—')}</Typography>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 280 }}><Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{it.remarks || '—'}</Typography></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </SectionCard>

        {/* Inventory updates (traceability) */}
        {isCompleted && (
          <SectionCard icon={<Boxes size={18} />} title={`Inventory Updates (${movements.length})`}>
            {movements.length ? (
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={headSx}>Movement No</TableCell>
                      <TableCell sx={headSx}>SKU</TableCell>
                      <TableCell sx={headSx}>Txn</TableCell>
                      <TableCell align="right" sx={headSx}>Qty In</TableCell>
                      <TableCell align="right" sx={headSx}>Balance After</TableCell>
                      <TableCell sx={headSx}>Warehouse</TableCell>
                      <TableCell sx={headSx}>Batch</TableCell>
                      <TableCell align="right" sx={headSx}>Unit Cost</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {movements.map((m) => (
                      <TableRow key={m._id} hover>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}><Typography variant="body2" fontWeight={700} color="primary.main">{m.movementNumber}</Typography></TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{m.skuCode || m.skuName || '—'}</TableCell>
                        <TableCell><Chip size="small" color="success" variant="outlined" label={m.txnType} sx={{ fontWeight: 700 }} /></TableCell>
                        <TableCell align="right" sx={{ ...numCellSx, color: '#0f766e', fontWeight: 700 }}>+{m.quantity}</TableCell>
                        <TableCell align="right" sx={{ ...numCellSx, fontWeight: 700 }}>{m.balanceAfter}</TableCell>
                        <TableCell>{m.warehouse}</TableCell>
                        <TableCell sx={{ overflowWrap: 'anywhere' }}>{m.batchNo || '—'}</TableCell>
                        <TableCell align="right" sx={numCellSx}>{Number(m.unitCost || 0).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Typography variant="body2" color="text.disabled">{grn.stockPostingStage ? 'Nothing posted yet — accepted quantities are posted when the MD has signed and Incoming QC is completed.' : 'No stock movements found for this GRN.'}</Typography>
            )}
          </SectionCard>
        )}

        {/* MD Digital Approval & Signature */}
        {isCompleted && (
          <Box id="grn-md-approval" sx={{ scrollMarginTop: 80 }}>
            <MdApprovalCard
              documentType="GRN"
              documentId={grn._id}
              documentTitle={grn.grnNumber}
              isMd={isMd}
              onPreviewPdf={() => setPdfOpen(true)}
              skip={grn.approvalStatus === 'NOT_REQUIRED'}
            />
          </Box>
        )}

        {/* Section B — Step 1.9 Incoming QC, directly under the GRN */}
        <PageSection letter="B" title="Incoming QC" subtitle="Step 1.9 · Accepted / rejected / rework against the received quantity" sx={{ mt: 1 }} />
        <GrnQcSections grn={grn} />

        {/* Timeline — one grid per entry with a fixed label column (as on
            Follow-up Detail), so descriptions line up; on phones the date sits
            beside the label and the description takes the full width. */}
        {grn.activityTimeline?.length ? (
          <SectionCard icon={<FileText size={18} />} title="Timeline">
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {[...grn.activityTimeline].reverse().map((ev, i) => (
                <Box key={i} sx={{
                  display: 'grid', alignItems: 'center', columnGap: 1.5, rowGap: 0.5,
                  gridTemplateColumns: { xs: 'minmax(0, auto) 1fr', sm: '110px minmax(0, 1fr) auto' },
                  gridTemplateAreas: { xs: '"label date" "desc desc"', sm: '"label desc date"' },
                }}>
                  <Chip size="small" label={ev.action} sx={{ gridArea: 'label', justifySelf: 'start', maxWidth: '100%', minWidth: { sm: 110 }, fontWeight: 700 }} />
                  <Typography variant="body2" sx={{ gridArea: 'desc', color: PFMS.sub, minWidth: 0, overflowWrap: 'anywhere' }}>{ev.description}</Typography>
                  <Typography variant="caption" sx={{ gridArea: 'date', justifySelf: 'end', whiteSpace: 'nowrap', color: PFMS.faint }}>{fmtDate(ev.timestamp)}</Typography>
                </Box>
              ))}
            </Box>
          </SectionCard>
        ) : null}
      </Box>

      {/* Dialogs */}
      <GrnFormDialog open={formOpen} grn={grn} onClose={() => setFormOpen(false)} />
      <GrnCompleteDialog open={completeOpen} grn={grn} onClose={() => setCompleteOpen(false)} />
      <GrnDeleteDialog open={deleteOpen} grn={grn}
        onClose={(deleted) => { setDeleteOpen(false); if (deleted) navigate('/purchase-fms/grn'); }} />
      <GrnPdfPreview open={pdfOpen} grn={grn} onClose={() => setPdfOpen(false)} />
      <VendorInvoiceFormDialog
        open={invoiceOpen}
        presetQc={qc ? { _id: qc._id, qcNumber: qc.qcNumber, vendorName: qc.vendorName || grn.vendorName, grnNumber: qc.grnNumber || grn.grnNumber, poNumber: qc.poNumber || grn.poNumber, piId: qc.piId } : null}
        onClose={() => setInvoiceOpen(false)}
      />
    </Box>
  );
};

export default GrnDetail;
