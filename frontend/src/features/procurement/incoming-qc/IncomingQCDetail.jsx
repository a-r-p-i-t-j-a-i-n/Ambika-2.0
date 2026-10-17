import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import {
  Box, Typography, Paper, Grid, Button, IconButton, CircularProgress, Chip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
} from '@mui/material';
import {
  ArrowLeft, Pencil, ClipboardCheck, Ban, Boxes, Building2, FileText, PackageCheck, FileDown, ArrowRight,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useSnackbar } from 'notistack';
import {
  useGetIncomingQcByIdQuery,
  useCancelIncomingQcMutation,
  useGetInventoryMovementsByRefQuery,
  useGetVendorInvoicesByQcQuery,
} from '../../../store/api/procurementApi';
import { QcStatusChip, QcResultChip, fmtDate } from './qcMeta';
import { fileHref } from '../indents/indentMeta';
import IncomingQCFormDialog from './IncomingQCFormDialog';
import IncomingQCCompleteDialog from './IncomingQCCompleteDialog';
import IncomingQCPdfPreview from './IncomingQCPdfPreview';
import VendorInvoiceFormDialog from '../vendor-invoices/VendorInvoiceFormDialog';
import { ReceiptText } from 'lucide-react';
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
    <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: 'primary.main' }}>{icon} {title}</Typography>
    {children}
  </Paper>
);

const IncomingQCDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack('/purchase-fms/grn?view=qc');
  const { enqueueSnackbar } = useSnackbar();

  const { data, isLoading } = useGetIncomingQcByIdQuery(id);
  const qc = data?.data;
  const wfSteps = resolveWorkflowSteps({ qc });
  const [cancelQc] = useCancelIncomingQcMutation();

  const isCompleted = qc && ['PASSED', 'FAILED', 'PARTIAL'].includes(qc.qcStatus);
  const isService = qc?.sourceType === 'SERVICE';
  const { data: movRes } = useGetInventoryMovementsByRefQuery({ refType: 'INCOMING_QC', refId: id }, { skip: !isCompleted || isService });
  const movements = movRes?.data || [];

  const [formOpen, setFormOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  const qcPassed = qc && ['PASSED', 'PARTIAL'].includes(qc.qcStatus);
  const { data: invByQcRes } = useGetVendorInvoicesByQcQuery(id, { skip: !qcPassed });
  const existingInvoice = (invByQcRes?.data || [])[0] || null;

  if (isLoading) return <Box sx={{ display: 'grid', placeItems: 'center', height: '70vh' }}><CircularProgress /></Box>;
  if (!qc) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6">Incoming QC not found</Typography>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/purchase-fms/grn?view=qc')}>Back to list</Button>
      </Box>
    );
  }

  const editable = ['DRAFT', 'IN_PROGRESS'].includes(qc.qcStatus);
  const handleCancel = async () => {
    try { await cancelQc({ id: qc._id }).unwrap(); enqueueSnackbar('QC cancelled', { variant: 'info' }); }
    catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to cancel', { variant: 'error' }); }
  };

  // ── "What's next?" — single, obvious call-to-action for the current stage. ──
  const goGrn = () => qc.grnId && navigate(`/procurement/grns/${qc.grnId}`);
  // A GRN's QC is entered on the GRN page, directly under the GRN.
  const onGrnPage = editable && Boolean(qc.grnId);
  const openGrnQc = () => navigate(`/procurement/grns/${qc.grnId}#qc`);
  const nextStep = (() => {
    if (onGrnPage) {
      return { tone: 'info', title: 'Next: complete this QC on the GRN page',
        desc: 'Incoming QC is recorded directly under its GRN — open the GRN to resume this draft.',
        primary: { label: 'Open GRN & QC', icon: <ClipboardCheck size={16} />, onClick: openGrnQc } };
    }
    if (editable) {
      return { tone: 'info', title: 'Next: complete the QC inspection (Step 1.9)',
        desc: 'Record accepted / rejected quantities and the overall result, then complete the QC.',
        primary: { label: 'Complete QC', icon: <ClipboardCheck size={16} />, onClick: () => setCompleteOpen(true) },
        secondary: { label: 'Edit', onClick: () => setFormOpen(true) } };
    }
    if (qc.qcStatus === 'CANCELLED') return null;
    if (qcPassed && !existingInvoice) {
      return { tone: 'success', title: 'QC passed — next: record the Vendor Invoice (Step 1.10)',
        desc: 'Capture the vendor’s tax invoice for the accepted material to proceed to payment.',
        primary: { label: 'Create Invoice', icon: <ReceiptText size={16} />, onClick: () => setInvoiceOpen(true) },
        secondary: qc.grnId ? { label: 'View GRN', onClick: goGrn } : null };
    }
    if (qcPassed && existingInvoice) {
      return { tone: 'success', title: 'Vendor Invoice recorded — track payment & accounting',
        desc: 'The invoice exists. Follow it through advance/payment and voucher in Vendor Invoices.',
        primary: { label: 'View Invoice', icon: <ReceiptText size={16} />, onClick: () => navigate(`/procurement/vendor-invoices/${existingInvoice._id}`) },
        secondary: { label: 'All Vendor Invoices', onClick: () => navigate('/purchase-fms/vendor-invoices') } };
    }
    if (qc.qcStatus === 'FAILED') {
      return { tone: 'warn', title: 'QC failed — rejected quantity returned to stock',
        desc: 'No vendor invoice is needed for rejected material. Review the GRN if a replacement is required.',
        primary: qc.grnId ? { label: 'View GRN', icon: <PackageCheck size={16} />, onClick: goGrn } : null };
    }
    return null;
  })();

  const NEXT_TONE = {
    info:    { bg: alpha('#2563eb', 0.07), border: alpha('#2563eb', 0.35), fg: '#1d4ed8' },
    success: { bg: alpha('#16a34a', 0.08), border: alpha('#16a34a', 0.35), fg: '#15803d' },
    warn:    { bg: alpha('#f59e0b', 0.1),  border: alpha('#f59e0b', 0.45), fg: '#b45309' },
  };

  return (
    <Box sx={{ ...pfmsPageSx, p: { xs: 1.5, md: 2.5 } }}>
      <Box sx={{ mb: 2.5, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={goBack} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}` }}><ArrowLeft size={20} /></IconButton>
        <Box sx={{ width: 46, height: 46, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main' }}><ClipboardCheck size={24} /></Box>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: PFMS.ink }}>{qc.qcNumber}</Typography>
            <QcStatusChip status={qc.qcStatus} />
            <QcResultChip result={qc.overallResult} />
          </Box>
          <Typography variant="body2" color="text.secondary">{qc.vendorName} · {isService ? `Indent ${qc.indentNumber || '—'}` : `GRN ${qc.grnNumber || '—'}`} · {fmtDate(qc.qcDate)}</Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {qc.grnId && <Button variant="outlined" startIcon={<PackageCheck size={16} />} onClick={() => navigate(`/procurement/grns/${qc.grnId}`)}>View GRN</Button>}
          {onGrnPage && <Button variant="contained" startIcon={<ClipboardCheck size={16} />} onClick={openGrnQc}>Open GRN &amp; QC</Button>}
          {editable && !onGrnPage && <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setFormOpen(true)}>Edit</Button>}
          {editable && !onGrnPage && <Button variant="contained" color="success" startIcon={<ClipboardCheck size={16} />} onClick={() => setCompleteOpen(true)}>Complete QC</Button>}
          {qc.qcPdfUrl && <Button variant="outlined" startIcon={<FileDown size={16} />} onClick={() => setPdfOpen(true)}>QC Report</Button>}
          {qcPassed && existingInvoice && <Button variant="outlined" startIcon={<ReceiptText size={16} />} onClick={() => navigate(`/procurement/vendor-invoices/${existingInvoice._id}`)}>View Invoice</Button>}
          {qcPassed && !existingInvoice && <Button variant="contained" startIcon={<ReceiptText size={16} />} onClick={() => setInvoiceOpen(true)}>Create Invoice</Button>}
          {editable && <Button variant="outlined" color="error" startIcon={<Ban size={16} />} onClick={handleCancel}>Cancel</Button>}
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

      <FmsDoerCard entityType="QC" entityId={id} />
      <WorkflowStepper steps={wfSteps} sx={{ mb: 3 }} />
      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <SectionCard icon={<FileText size={18} />} title="QC Information">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}><Field label="QC Date" value={fmtDate(qc.qcDate)} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Result" value={<QcResultChip result={qc.overallResult} />} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Completed At" value={fmtDate(qc.completedAt)} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Checked By" value={qc.checkedByName || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Prepared By" value={qc.preparedBy || '—'} /></Grid>
              {isService
                ? <Grid item xs={6} sm={4}><Field label="Source" value="Service" /></Grid>
                : <Grid item xs={6} sm={4}><Field label="Warehouse" value={qc.warehouse || 'MAIN'} /></Grid>}
              {qc.remarks ? <Grid item xs={12}><Field label="Remarks" value={qc.remarks} /></Grid> : null}
            </Grid>
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={6}>
          {isService ? (
            <SectionCard icon={<Building2 size={18} />} title="Service · Indent · Vendor">
              <Grid container spacing={2}>
                <Grid item xs={6} sm={4}><Field label="Vendor / Provider" value={qc.vendorName || '—'} /></Grid>
                {/* Legacy QCs raised through the retired Service Completion step */}
                {qc.serviceCompletionNumber ? <Grid item xs={6} sm={4}><Field label="Service Completion" value={qc.serviceCompletionNumber} /></Grid> : null}
                <Grid item xs={6} sm={4}>
                  <Field label="Indent" value={qc.indentId
                    ? <Box component="span" sx={{ color: 'primary.main', cursor: 'pointer', fontWeight: 700 }} onClick={() => navigate(`/procurement/indents/${qc.indentId}`)}>{qc.indentNumber || 'View'}</Box>
                    : (qc.indentNumber || '—')} />
                </Grid>
                {qc.qcReportDocument?.fileUrl ? (
                  <Grid item xs={6} sm={4}>
                    <Field label="Service Report" value={<Box component="a" href={fileHref(qc.qcReportDocument.fileUrl)} target="_blank" rel="noopener" sx={{ color: 'primary.main', fontWeight: 700 }}>{qc.qcReportDocument.fileName || 'View'}</Box>} />
                  </Grid>
                ) : null}
                <Grid item xs={6} sm={4}><Field label="Requested / Accepted / Rejected" value={`${qc.totalReceived} / ${qc.totalAccepted} / ${qc.totalRejected}`} /></Grid>
              </Grid>
            </SectionCard>
          ) : (
            <SectionCard icon={<Building2 size={18} />} title="GRN · PO · PI · Vendor">
              <Grid container spacing={2}>
                <Grid item xs={6} sm={4}><Field label="Vendor" value={qc.vendorName || '—'} /></Grid>
                <Grid item xs={6} sm={4}><Field label="GRN" value={qc.grnNumber || '—'} /></Grid>
                <Grid item xs={6} sm={4}><Field label="PO" value={qc.poNumber || '—'} /></Grid>
                <Grid item xs={6} sm={4}>
                  <Field label="PI" value={qc.piId
                    ? <Box component="span" sx={{ color: 'primary.main', cursor: 'pointer', fontWeight: 700 }} onClick={() => navigate(`/procurement/proforma-invoices/${qc.piId}`)}>{qc.piNumber || 'View'}</Box>
                    : (qc.piNumber || '—')} />
                </Grid>
                <Grid item xs={6} sm={4}><Field label="Indent" value={qc.indentNumber || '—'} /></Grid>
                <Grid item xs={6} sm={4}><Field label="Received / Accepted / Rejected" value={`${qc.totalReceived} / ${qc.totalAccepted} / ${qc.totalRejected}`} /></Grid>
                {qc.totalRework > 0 ? <Grid item xs={6} sm={4}><Field label="Rework (earlier form)" value={qc.totalRework} /></Grid> : null}
                {qc.qcReportDocument?.fileUrl ? (
                  <Grid item xs={6} sm={4}>
                    <Field label="QC Report / Photo" value={<Box component="a" href={fileHref(qc.qcReportDocument.fileUrl)} target="_blank" rel="noopener" sx={{ color: 'primary.main', fontWeight: 700 }}>{qc.qcReportDocument.fileName || 'View'}</Box>} />
                  </Grid>
                ) : null}
              </Grid>
            </SectionCard>
          )}
        </Grid>

        {/* QC item table */}
        <Grid item xs={12}>
          <SectionCard icon={<ClipboardCheck size={18} />} title={`Inspection (${qc.items?.length || 0})`}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Item</TableCell>
                    <TableCell>SKU</TableCell>
                    <TableCell align="right">{isService ? 'Requested' : 'Received'}</TableCell>
                    <TableCell align="right">Accepted</TableCell>
                    <TableCell align="right">Rejected</TableCell>
                    <TableCell align="right">Rework</TableCell>
                    {isService ? (
                      <TableCell>Remarks</TableCell>
                    ) : (
                      <>
                        <TableCell>Remark</TableCell>
                        <TableCell>Defect</TableCell>
                        <TableCell>Severity</TableCell>
                        <TableCell>Reject Movement</TableCell>
                      </>
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(qc.items || []).map((it, i) => (
                    <TableRow key={it._id || i} hover>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{it.itemName}{!isService && it.batchNo ? <Typography variant="caption" color="text.disabled" sx={{ display: 'block' }}>Batch {it.batchNo}</Typography> : null}</TableCell>
                      <TableCell><Typography variant="body2" color="primary.main" fontWeight={700}>{it.skuCode || '—'}</Typography></TableCell>
                      <TableCell align="right">{it.receivedQty}</TableCell>
                      <TableCell align="right" sx={{ color: '#0f766e', fontWeight: 700 }}>{it.acceptedQty}</TableCell>
                      <TableCell align="right" sx={{ color: it.rejectedQty > 0 ? '#be123c' : 'text.secondary', fontWeight: it.rejectedQty > 0 ? 700 : 400 }}>{it.rejectedQty}</TableCell>
                      <TableCell align="right" sx={{ color: it.reworkQty > 0 ? '#b45309' : 'text.secondary' }}>{it.reworkQty}</TableCell>
                      {isService ? (
                        <TableCell><Typography variant="body2" color="text.secondary">{it.qcRemarks || '—'}</Typography></TableCell>
                      ) : (
                        <>
                          <TableCell><Typography variant="body2" color="text.secondary">{it.qcRemarks || '—'}</Typography></TableCell>
                          <TableCell>{it.defectType || '—'}</TableCell>
                          <TableCell>{it.defectSeverity ? <Chip size="small" variant="outlined" label={it.defectSeverity} /> : '—'}</TableCell>
                          <TableCell><Typography variant="body2" color="text.secondary">{it.inventoryMovementNumber || '—'}</Typography></TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </SectionCard>
        </Grid>

        {/* Inventory movements for rejected qty */}
        {isCompleted && (
          <Grid item xs={12}>
            <SectionCard icon={<Boxes size={18} />} title={`Inventory Movements — Rejected Qty (${movements.length})`}>
              {movements.length ? (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Movement No</TableCell>
                        <TableCell>SKU</TableCell>
                        <TableCell>Txn</TableCell>
                        <TableCell align="right">Qty Out</TableCell>
                        <TableCell align="right">Balance After</TableCell>
                        <TableCell>Warehouse</TableCell>
                        <TableCell>Batch</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {movements.map((m) => (
                        <TableRow key={m._id} hover>
                          <TableCell><Typography variant="body2" fontWeight={700} color="primary.main">{m.movementNumber}</Typography></TableCell>
                          <TableCell>{m.skuCode || m.skuName || '—'}</TableCell>
                          <TableCell><Chip size="small" color="error" variant="outlined" label={m.txnType} sx={{ fontWeight: 700 }} /></TableCell>
                          <TableCell align="right" sx={{ color: '#be123c', fontWeight: 700 }}>-{m.quantity}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>{m.balanceAfter}</TableCell>
                          <TableCell>{m.warehouse}</TableCell>
                          <TableCell>{m.batchNo || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" color="text.disabled">No rejected-qty movements (nothing rejected).</Typography>
              )}
            </SectionCard>
          </Grid>
        )}

        {qc.activityTimeline?.length ? (
          <Grid item xs={12}>
            <SectionCard icon={<FileText size={18} />} title="Timeline">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[...qc.activityTimeline].reverse().map((ev, i) => (
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

      <IncomingQCFormDialog open={formOpen} qc={qc} onClose={() => setFormOpen(false)} />
      <IncomingQCCompleteDialog open={completeOpen} qc={qc} onClose={() => setCompleteOpen(false)} />
      <IncomingQCPdfPreview open={pdfOpen} qc={qc} onClose={() => setPdfOpen(false)} />
      <VendorInvoiceFormDialog open={invoiceOpen} presetQc={qc ? { _id: qc._id, qcNumber: qc.qcNumber, vendorName: qc.vendorName, grnNumber: qc.grnNumber, poNumber: qc.poNumber, piId: qc.piId } : null} onClose={() => setInvoiceOpen(false)} />
    </Box>
  );
};

export default IncomingQCDetail;
