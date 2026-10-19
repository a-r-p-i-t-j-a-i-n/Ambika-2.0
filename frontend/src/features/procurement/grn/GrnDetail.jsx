import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import { useSelector } from 'react-redux';
import {
  Box, Typography, Paper, Grid, Button, IconButton, CircularProgress, Chip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import {
  ArrowLeft, Pencil, PackageCheck, Ban, Boxes, Building2, FileText, ShoppingBag,
  Warehouse, ReceiptText, FileDown, ArrowRight, Trash2, Lock,
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
import GrnFormDialog from './GrnFormDialog';
import GrnCompleteDialog from './GrnCompleteDialog';
import GrnDeleteDialog from './GrnDeleteDialog';
import GrnPdfPreview from './GrnPdfPreview';
import { GrnQcSections } from './GrnQcSection';
import GrnQcStatusChip from './GrnQcStatusChip';
import { inventoryTypeLabel } from './inventoryType';
import { resolveGrnQcStage } from './grnQcStage';
import { pickGrnQc } from '../incoming-qc/qcForm';
import VendorInvoiceFormDialog from '../vendor-invoices/VendorInvoiceFormDialog';
import MdApprovalCard from '../approvals/MdApprovalCard';
import { ClipboardCheck } from 'lucide-react';
import WorkflowStepper from '../components/WorkflowStepper';
import { resolveWorkflowSteps } from '../components/purchaseFmsWorkflow';
import NextStepBanner from '../components/NextStepBanner';
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

// Divides the page into its two parts: the GRN (A) and its Incoming QC (B).
const PageSection = ({ letter, title, subtitle }) => (
  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap', borderBottom: `2px solid ${PFMS.line}`, pb: 1 }}>
    <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: PFMS.ink }}>
      <Box component="span" sx={{ color: 'primary.main', mr: 1 }}>{letter}</Box>{title}
    </Typography>
    {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
  </Box>
);

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

  // Draft = editable / deletable / completable. Once completed (stock posted)
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
      return { tone: 'info', title: 'Next: complete the GRN & post stock',
        desc: 'Confirm the received quantities and post the goods into inventory. Incoming QC (below) opens after the MD signs the GRN.',
        primary: { label: 'Complete & Post Stock', icon: <PackageCheck size={16} />, onClick: () => setCompleteOpen(true) },
        secondary: { label: 'Edit', onClick: () => setFormOpen(true) } };
    }
    if (qcStage.key === 'CANCELLED') return null;
    if (qcStage.key === 'AWAITING_MD') {
      // MD Digital Approval gate — QC cannot start until this GRN is signed.
      return { tone: 'info', title: 'Awaiting MD Approval',
        desc: 'Incoming QC (section B) unlocks once the Managing Director has digitally signed this GRN.',
        primary: { label: 'Go to MD Approval', icon: <ArrowRight size={16} />, onClick: () => scrollToId('grn-md-approval') } };
    }
    if (qcStage.key === 'QC_DRAFT') {
      return { tone: 'info', title: `QC draft ${qc.qcNumber} saved — finish the inspection below`,
        desc: 'Record accepted / rejected / rework quantities and complete the QC.',
        primary: { label: 'Resume QC', icon: <ClipboardCheck size={16} />, onClick: toQcSection } };
    }
    if (qcStage.key === 'QC_READY') {
      return { tone: 'success', title: 'Goods received & signed — next: Incoming QC (below)',
        desc: 'Inspect the received material and record the QC result in section B.',
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
    <Box sx={{ ...pfmsPageSx, p: { xs: 1.5, md: 2.5 } }}>
      {/* Hero */}
      <Box sx={{ mb: 2.5, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={goBack} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}` }}>
          <ArrowLeft size={20} />
        </IconButton>
        <Box sx={{ width: 46, height: 46, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main' }}>
          <PackageCheck size={24} />
        </Box>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: PFMS.ink }}>{grn.grnNumber}</Typography>
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
          <Typography variant="body2" color="text.secondary">
            {grn.vendorName} · {grn.isWithoutPo ? 'Without PO' : `PO ${(grn.poNumbers?.length ? grn.poNumbers : [grn.poNumber]).filter(Boolean).join(', ') || '—'}`} · {fmtDate(grn.grnDate)}
          </Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {(grn.poIds?.length ? grn.poIds : (grn.poId ? [grn.poId] : [])).map((pid, i) => (
            <Button key={pid} variant="outlined" startIcon={<ShoppingBag size={16} />} onClick={() => navigate(`/procurement/purchase-orders/${pid}`)}>
              View PO{(grn.poNumbers?.length > 1) ? ` ${grn.poNumbers[i] || ''}` : ''}
            </Button>
          ))}
          {isDraft && !isLocked && <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setFormOpen(true)}>Edit</Button>}
          {isDraft && !isLocked && <Button variant="contained" color="success" startIcon={<PackageCheck size={16} />} onClick={() => setCompleteOpen(true)}>Complete &amp; Post Stock</Button>}
          {grn.grnPdfUrl && <Button variant="outlined" startIcon={<FileDown size={16} />} onClick={() => setPdfOpen(true)}>{isLocked ? 'View Signed PDF' : 'GRN PDF'}</Button>}
          {isDraft && !isLocked && <Button variant="outlined" color="error" startIcon={<Ban size={16} />} onClick={handleCancel}>Cancel</Button>}
          {isDraft && !isLocked && canDeleteGrn && <Button variant="outlined" color="error" startIcon={<Trash2 size={16} />} onClick={() => setDeleteOpen(true)}>Delete</Button>}
        </Box>
      </Box>

      <NextStepBanner step={nextStep} />

      <FmsDoerCard entityType="GRN" entityId={id} />
      <WorkflowStepper steps={wfSteps} sx={{ mb: 3 }} />
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <PageSection letter="A" title="GRN Details" subtitle="Goods received against the PO · stock · MD approval" />
        </Grid>

        {/* GRN + PO info */}
        <Grid item xs={12} md={6}>
          <SectionCard icon={<FileText size={18} />} title="GRN Information">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}><Field label="GRN Date" value={fmtDate(grn.grnDate)} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Unique Id" value={grn.uniqueId || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="How Received" value={howReceivedLabel(grn.howItemReceived)} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Challan No" value={grn.challanNumber || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Invoice No" value={grn.invoiceNumber || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Invoice Date" value={fmtDate(grn.invoiceDate)} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Vehicle No" value={grn.vehicleNumber || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Received By" value={grn.receivedBy || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Prepared By" value={grn.preparedBy || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label={<><Warehouse size={12} /> Warehouse</>} value={grn.warehouse || 'MAIN'} /></Grid>
              {/* Shown beside Warehouse on purpose: they are different things.
                  Warehouse is the GRN's own store (MAIN); Received At is where
                  the Raw Material landed, and is what the RM movement uses. */}
              {/* GRNs raised before Inventory Type existed show their recorded
                  "Add to RM Stock" choice as it was — never reinterpreted. */}
              <Grid item xs={6} sm={4}>
                <Field label="Inventory Type" value={grn.inventoryType
                  ? inventoryTypeLabel(grn.inventoryType)
                  : `— (earlier GRN · Add to RM Stock: ${grn.addToRmStock ? 'Yes' : 'No'})`} />
              </Grid>
              <Grid item xs={6} sm={4}><Field label="Received At" value={grn.rmReceivedAtLocation || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Completed At" value={fmtDate(grn.completedAt)} /></Grid>
              {grn.remarks ? <Grid item xs={12}><Field label="Remarks" value={grn.remarks} /></Grid> : null}
            </Grid>
          </SectionCard>
        </Grid>

        {/* Vendor + PO/PI linkage */}
        <Grid item xs={12} md={6}>
          <SectionCard icon={<Building2 size={18} />} title="Vendor · PO · PI">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}><Field label="Vendor" value={grn.vendorName || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="GST" value={grn.vendorGST || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Phone" value={grn.vendorPhone || '—'} /></Grid>
              <Grid item xs={12} sm={4}><Field label="Address" value={grn.vendorAddress || '—'} /></Grid>
              <Grid item xs={6} sm={4}>
                <Field label={`PO Number${(grn.poNumbers?.length || 0) > 1 ? 's' : ''}`}
                  value={grn.isWithoutPo ? 'Without PO' : ((grn.poNumbers?.length ? grn.poNumbers : [grn.poNumber]).filter(Boolean).join(', ') || '—')} />
              </Grid>
              <Grid item xs={6} sm={4}>
                <Field label="PI Number" value={grn.piId
                  ? <Box component="span" sx={{ color: 'primary.main', cursor: 'pointer', fontWeight: 700 }} onClick={() => navigate(`/procurement/proforma-invoices/${grn.piId}`)}>{grn.piNumber || 'View PI'}</Box>
                  : (grn.piNumber || '—')} />
              </Grid>
              <Grid item xs={6} sm={4}><Field label="Indent" value={grn.indentNumber || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Received Qty" value={grn.totalReceivedQty} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Receipt Value" value={fmtINR(grn.totalValue)} /></Grid>
            </Grid>
          </SectionCard>
        </Grid>

        {/* Material receipt table */}
        <Grid item xs={12}>
          <SectionCard icon={<ReceiptText size={18} />} title={`Material Receipt (${grn.items?.length || 0})`}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    {(grn.poNumbers?.length || 0) > 1 && <TableCell>PO</TableCell>}
                    <TableCell>Description</TableCell>
                    <TableCell>SKU</TableCell>
                    <TableCell align="right">Ordered</TableCell>
                    <TableCell align="right">Already Received</TableCell>
                    <TableCell align="right">Pending Before GRN</TableCell>
                    <TableCell align="right">Invoice</TableCell>
                    <TableCell align="right">Received</TableCell>
                    <TableCell align="right">Short</TableCell>
                    <TableCell align="right">Pending After GRN</TableCell>
                    <TableCell>Item Status</TableCell>
                    <TableCell>Batch</TableCell>
                    <TableCell>Movement</TableCell>
                    <TableCell>Remarks</TableCell>
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
                          <TableCell><Typography variant="body2" color="text.secondary">{it.poNumber || '—'}</Typography></TableCell>
                        )}
                        <TableCell sx={{ fontWeight: 600 }}>{it.itemName}</TableCell>
                        <TableCell><Typography variant="body2" color="primary.main" fontWeight={700}>{it.skuCode || '—'}</Typography></TableCell>
                        <TableCell align="right">{grn.isWithoutPo ? 'N/A' : it.orderedQty}</TableCell>
                        <TableCell align="right">{grn.isWithoutPo ? 'N/A' : (it.previouslyReceivedQty || 0)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: pendingBeforeGrn > 0 ? '#b45309' : '#0f766e' }}>{grn.isWithoutPo ? 'N/A' : pendingBeforeGrn}</TableCell>
                        <TableCell align="right">{it.invoiceQty}</TableCell>
                        <TableCell align="right" sx={{ color: '#0f766e', fontWeight: 700 }}>{it.receivedQty}</TableCell>
                        <TableCell align="right" sx={{ color: it.shortQty > 0 ? '#b45309' : 'text.secondary' }}>{it.shortQty || 0}</TableCell>
                        <TableCell align="right" sx={{ color: it.pendingQty > 0 ? '#b45309' : '#0f766e' }}>{grn.isWithoutPo ? 'N/A' : (it.pendingQty || 0)}</TableCell>
                        <TableCell>
                          <Chip size="small" label={itemStatus.label} sx={{ fontWeight: 700, color: itemStatus.color, bgcolor: alpha(itemStatus.color, 0.1) }} />
                        </TableCell>
                        <TableCell>{it.batchNo || '—'}</TableCell>
                        <TableCell><Typography variant="body2" color="text.secondary">{it.movementNumber || '—'}</Typography></TableCell>
                        <TableCell><Typography variant="body2" color="text.secondary" noWrap>{it.remarks || '—'}</Typography></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </SectionCard>
        </Grid>

        {/* Inventory updates (traceability) */}
        {isCompleted && (
          <Grid item xs={12}>
            <SectionCard icon={<Boxes size={18} />} title={`Inventory Updates (${movements.length})`}>
              {movements.length ? (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Movement No</TableCell>
                        <TableCell>SKU</TableCell>
                        <TableCell>Txn</TableCell>
                        <TableCell align="right">Qty In</TableCell>
                        <TableCell align="right">Balance After</TableCell>
                        <TableCell>Warehouse</TableCell>
                        <TableCell>Batch</TableCell>
                        <TableCell align="right">Unit Cost</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {movements.map((m) => (
                        <TableRow key={m._id} hover>
                          <TableCell><Typography variant="body2" fontWeight={700} color="primary.main">{m.movementNumber}</Typography></TableCell>
                          <TableCell>{m.skuCode || m.skuName || '—'}</TableCell>
                          <TableCell><Chip size="small" color="success" variant="outlined" label={m.txnType} sx={{ fontWeight: 700 }} /></TableCell>
                          <TableCell align="right" sx={{ color: '#0f766e', fontWeight: 700 }}>+{m.quantity}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>{m.balanceAfter}</TableCell>
                          <TableCell>{m.warehouse}</TableCell>
                          <TableCell>{m.batchNo || '—'}</TableCell>
                          <TableCell align="right">{Number(m.unitCost || 0).toFixed(2)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" color="text.disabled">No stock movements found for this GRN.</Typography>
              )}
            </SectionCard>
          </Grid>
        )}

        {/* MD Digital Approval & Signature */}
        {isCompleted && (
          <Grid item xs={12} id="grn-md-approval" sx={{ scrollMarginTop: 80 }}>
            <MdApprovalCard
              documentType="GRN"
              documentId={grn._id}
              documentTitle={grn.grnNumber}
              isMd={isMd}
              onPreviewPdf={() => setPdfOpen(true)}
              skip={grn.approvalStatus === 'NOT_REQUIRED'}
            />
          </Grid>
        )}

        {/* Section B — Step 1.9 Incoming QC, directly under the GRN */}
        <Grid item xs={12} sx={{ mt: 1 }}>
          <PageSection letter="B" title="Incoming QC" subtitle="Step 1.9 · Accepted / rejected / rework against the received quantity" />
        </Grid>
        <Grid item xs={12}>
          <GrnQcSections grn={grn} isMd={isMd} />
        </Grid>

        {/* Timeline */}
        {grn.activityTimeline?.length ? (
          <Grid item xs={12}>
            <SectionCard icon={<FileText size={18} />} title="Timeline">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[...grn.activityTimeline].reverse().map((ev, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Chip size="small" label={ev.action} sx={{ fontWeight: 700, minWidth: 110 }} />
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
