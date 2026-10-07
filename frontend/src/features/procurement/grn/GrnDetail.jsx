import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
} from '../../../store/api/procurementApi';
import { GrnStatusChip, QcStatusChip, howReceivedLabel, fmtINR, fmtDate, isGrnDraft, isGrnCompleted } from './grnMeta';
import GrnFormDialog from './GrnFormDialog';
import GrnCompleteDialog from './GrnCompleteDialog';
import GrnDeleteDialog from './GrnDeleteDialog';
import GrnPdfPreview from './GrnPdfPreview';
import { QcResultChip } from '../incoming-qc/qcMeta';
import IncomingQCFormDialog from '../incoming-qc/IncomingQCFormDialog';
import MdApprovalCard from '../approvals/MdApprovalCard';
import { Eye, ClipboardCheck } from 'lucide-react';
import WorkflowStepper from '../components/WorkflowStepper';
import { resolveWorkflowSteps } from '../components/purchaseFmsWorkflow';
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

  const [formOpen, setFormOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [qcFormOpen, setQcFormOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
  const qcDone = ['PASSED', 'FAILED', 'PARTIAL'].includes(grn.qcStatus);
  const nextStep = (() => {
    if (isDraft) {
      return { tone: 'info', title: 'Next: complete the GRN & post stock',
        desc: 'Confirm the received quantities and post the goods into inventory.',
        primary: { label: 'Complete & Post Stock', icon: <PackageCheck size={16} />, onClick: () => setCompleteOpen(true) },
        secondary: { label: 'Edit', onClick: () => setFormOpen(true) } };
    }
    if (grn.grnStatus === 'CANCELLED') return null;
    if (isCompleted && grn.qcStatus === 'PENDING' && grn.qcId) {
      // QC created but not completed — send the user to finish it.
      return { tone: 'info', title: 'QC created — next: complete the inspection (Step 1.9)',
        desc: 'Open the QC to record accepted / rejected quantities and complete it.',
        primary: { label: 'Open QC', icon: <ClipboardCheck size={16} />, onClick: () => navigate(`/procurement/incoming-qc/${grn.qcId}`) } };
    }
    if (isCompleted && grn.qcStatus === 'PENDING' && grn.approvalStatus !== 'MD_APPROVED') {
      // MD Digital Approval gate — QC cannot start until this GRN is signed.
      return { tone: 'info', title: 'Awaiting MD Approval',
        desc: 'Incoming QC can only start once the Managing Director has digitally signed this GRN — see the MD Approval card below.',
        primary: null };
    }
    if (isCompleted && grn.qcStatus === 'PENDING') {
      return { tone: 'success', title: 'Goods received — next: run Incoming QC (Step 1.9)',
        desc: 'Inspect the received material and record the QC result.',
        primary: { label: 'Create QC', icon: <ClipboardCheck size={16} />, onClick: () => setQcFormOpen(true) },
        secondary: grn.poId ? { label: 'View PO', onClick: () => navigate(`/procurement/purchase-orders/${grn.poId}`) } : null };
    }
    if (isCompleted && qcDone) {
      return { tone: 'success', title: 'QC complete — next: record the Vendor Invoice',
        desc: 'Capture the vendor’s tax invoice to proceed to payment & accounting.',
        primary: { label: 'Go to Vendor Invoices', icon: <ReceiptText size={16} />, onClick: () => navigate('/purchase-fms/vendor-invoices') },
        secondary: grn.qcId ? { label: 'View QC', onClick: () => navigate(`/procurement/incoming-qc/${grn.qcId}`) } : null };
    }
    return null;
  })();

  const NEXT_TONE = {
    info:    { bg: alpha('#2563eb', 0.07), border: alpha('#2563eb', 0.35), fg: '#1d4ed8' },
    success: { bg: alpha('#16a34a', 0.08), border: alpha('#16a34a', 0.35), fg: '#15803d' },
  };

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
            {grn.stockPosted && <QcStatusChip status={grn.qcStatus} />}
            {isCompleted && (
              <Chip size="small" variant="outlined" icon={<Lock size={13} />} label="Completed · Read-only"
                title="Stock has been posted — this GRN can no longer be edited or deleted"
                sx={{ fontWeight: 700, color: PFMS.sub, borderColor: PFMS.line, '& .MuiChip-icon': { color: PFMS.sub } }} />
            )}
          </Box>
          <Typography variant="body2" color="text.secondary">
            {grn.vendorName} · PO {grn.poNumber || '—'} · {fmtDate(grn.grnDate)}
          </Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {grn.poId && <Button variant="outlined" startIcon={<ShoppingBag size={16} />} onClick={() => navigate(`/procurement/purchase-orders/${grn.poId}`)}>View PO</Button>}
          {isDraft && !isLocked && <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setFormOpen(true)}>Edit</Button>}
          {isDraft && !isLocked && <Button variant="contained" color="success" startIcon={<PackageCheck size={16} />} onClick={() => setCompleteOpen(true)}>Complete &amp; Post Stock</Button>}
          {grn.grnPdfUrl && <Button variant="outlined" startIcon={<FileDown size={16} />} onClick={() => setPdfOpen(true)}>{isLocked ? 'View Signed PDF' : 'GRN PDF'}</Button>}
          {isDraft && !isLocked && <Button variant="outlined" color="error" startIcon={<Ban size={16} />} onClick={handleCancel}>Cancel</Button>}
          {isDraft && !isLocked && canDeleteGrn && <Button variant="outlined" color="error" startIcon={<Trash2 size={16} />} onClick={() => setDeleteOpen(true)}>Delete</Button>}
        </Box>
      </Box>

      {/* What's next — adaptive, prominent call-to-action for the current stage */}
      {nextStep && (() => {
        const t = NEXT_TONE[nextStep.tone] || NEXT_TONE.info;
        return (
          <Paper elevation={0} sx={{
            mb: 2.5, p: 2.5, borderRadius: '8px', border: '1px solid', borderColor: t.border, bgcolor: t.bg,
            display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
          }}>
            <Box sx={{ width: 42, height: 42, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: PFMS.surface, color: t.fg, flexShrink: 0 }}>
              <ArrowRight size={22} />
            </Box>
            <Box sx={{ minWidth: 220, flexGrow: 1 }}>
              <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: t.fg }}>Next Step</Typography>
              <Typography sx={{ fontWeight: 800, color: 'text.primary' }}>{nextStep.title}</Typography>
              <Typography variant="body2" color="text.secondary">{nextStep.desc}</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              {nextStep.secondary && (
                <Button variant="outlined" onClick={nextStep.secondary.onClick}>{nextStep.secondary.label}</Button>
              )}
              {nextStep.primary && (
                <Button variant="contained" startIcon={nextStep.primary.icon} onClick={nextStep.primary.onClick}>
                  {nextStep.primary.label}
                </Button>
              )}
            </Box>
          </Paper>
        );
      })()}

      <FmsDoerCard entityType="GRN" entityId={id} />
      <WorkflowStepper steps={wfSteps} sx={{ mb: 3 }} />
      <Grid container spacing={3}>
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
              <Grid item xs={6} sm={4}><Field label="PO Number" value={grn.poNumber || '—'} /></Grid>
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
                    const itemStatus = (it.extraQty || 0) > 0
                      ? { label: 'Extra Received', color: '#c2410c' }
                      : (it.pendingQty || 0) > 0
                        ? { label: 'Partially Received', color: '#b45309' }
                        : { label: 'Fully Received', color: '#0f766e' };
                    return (
                      <TableRow key={it._id || i} hover>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{it.itemName}</TableCell>
                        <TableCell><Typography variant="body2" color="primary.main" fontWeight={700}>{it.skuCode || '—'}</Typography></TableCell>
                        <TableCell align="right">{it.orderedQty}</TableCell>
                        <TableCell align="right">{it.previouslyReceivedQty || 0}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: pendingBeforeGrn > 0 ? '#b45309' : '#0f766e' }}>{pendingBeforeGrn}</TableCell>
                        <TableCell align="right">{it.invoiceQty}</TableCell>
                        <TableCell align="right" sx={{ color: '#0f766e', fontWeight: 700 }}>{it.receivedQty}</TableCell>
                        <TableCell align="right" sx={{ color: it.shortQty > 0 ? '#b45309' : 'text.secondary' }}>{it.shortQty || 0}</TableCell>
                        <TableCell align="right" sx={{ color: it.pendingQty > 0 ? '#b45309' : '#0f766e' }}>{it.pendingQty || 0}</TableCell>
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
          <Grid item xs={12}>
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

        {/* Step 1.9 — Incoming QC */}
        {isCompleted && (
          <Grid item xs={12}>
            <Paper sx={{ ...pfmsCardSx, p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, color: 'primary.main' }}>
                  <ClipboardCheck size={18} /> Incoming QC
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {grn.qcStatus === 'PENDING' && grn.approvalStatus === 'MD_APPROVED' && (
                    <Button size="small" variant="contained" startIcon={<ClipboardCheck size={14} />} onClick={() => setQcFormOpen(true)}>Create QC</Button>
                  )}
                  {grn.qcId && (
                    <Button size="small" variant="outlined" startIcon={<Eye size={14} />} onClick={() => navigate(`/procurement/incoming-qc/${grn.qcId}`)}>View QC</Button>
                  )}
                </Box>
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}><Field label="QC Status" value={<QcStatusChip status={grn.qcStatus} />} /></Grid>
                <Grid item xs={6} sm={3}><Field label="QC Number" value={grn.qcNumber || '—'} /></Grid>
                <Grid item xs={6} sm={3}><Field label="QC Result" value={grn.qcStatus === 'PENDING' ? '—' : <QcResultChip result={grn.qcStatus === 'PASSED' ? 'PASS' : grn.qcStatus === 'FAILED' ? 'FAIL' : grn.qcStatus === 'PARTIAL' ? 'PARTIAL_PASS' : ''} />} /></Grid>
                <Grid item xs={6} sm={3}><Field label="QC Completed" value={fmtDate(grn.qcCompletedAt)} /></Grid>
              </Grid>
            </Paper>
          </Grid>
        )}

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
      <IncomingQCFormDialog open={qcFormOpen} presetGrn={grn} onClose={() => setQcFormOpen(false)} />
    </Box>
  );
};

export default GrnDetail;
