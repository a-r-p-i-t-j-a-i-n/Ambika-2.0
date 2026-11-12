import React, { useState, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Button, Chip, Alert, CircularProgress, Grid } from '@mui/material';
import { ClipboardCheck, FileDown, ExternalLink, Lock, PencilLine } from 'lucide-react';
import { useGetIncomingQcsByGrnQuery } from '../../../store/api/procurementApi';
import QcInspectionForm from '../incoming-qc/QcInspectionForm';
import IncomingQCPdfPreview from '../incoming-qc/IncomingQCPdfPreview';
import { QcStatusChip, QcResultChip, fmtDate } from '../incoming-qc/qcMeta';
import { headerFromQc, linesFromQc, pickGrnQc } from '../incoming-qc/qcForm';
import { PFMS } from '../pfmsTheme';
import { FormSection } from '../components/PfmsFormDialog';
import { lazyWithRetry } from '../../../utils/lazyWithRetry';
import GrnQcStatusChip from './GrnQcStatusChip';
import { resolveGrnQcStage } from './grnQcStage';
import { isGrnCompleted } from './grnMeta';

// The combined GRN + QC form. Lazy: it renders this section itself (for a
// completed QC), so a static import would be a cycle.
const GrnFormDialog = lazyWithRetry(() => import('./GrnFormDialog'));

const noop = () => {};

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', color: PFMS.sub, mb: 0.25 }}>{label}</Typography>
    <Typography component="div" sx={{ fontWeight: 700, fontSize: '0.9rem', color: PFMS.ink }}>{value ?? '—'}</Typography>
  </Box>
);

const NEXT_TEXT = {
  GRN_DRAFT: 'The GRN is a draft. Its Incoming QC is entered on the same GRN + QC form and both are completed by one Save — stock posts only when the QC is completed.',
  QC_READY: 'The GRN is completed and its Incoming QC is pending — open the GRN + QC form to inspect and complete it. Accepted quantities post to stock then.',
  QC_DRAFT: 'A QC draft is saved — open the GRN + QC form to finish it. Accepted quantities post to stock when it is completed.',
};

/**
 * The Incoming QC of a GRN as shown on the GRN page and in the task runner —
 * and, for a completed QC, inside the GRN + QC form. A completed QC is shown
 * read-only. A QC still to be done is NOT entered here: there is one place to
 * enter and save GRN + QC (GrnFormDialog), and this opens it.
 *
 * A multi-PO GRN gets one QC per PO (see incomingQc.service.js) — the caller
 * renders one <GrnQcSection poId poNumber /> per PO (GrnQcSections below); a
 * single-PO / W/O PO GRN renders exactly one, unscoped.
 *
 *   grn          the saved GRN (live from the API)
 *   poId         scope to one PO's QC on a multi-PO GRN
 *   poNumber     that PO's number, for the section title
 *   readOnlyGrn  show the "GRN read-only" mark (inside the form)
 */
const GrnQcSection = ({ grn, poId, poNumber, readOnlyGrn = false }) => {
  const navigate = useNavigate();
  const completedGrn = isGrnCompleted(grn);
  const { data: qcRes, isLoading: qcLoading } = useGetIncomingQcsByGrnQuery(grn._id, { skip: !completedGrn });
  const qc = pickGrnQc(qcRes?.data || [], poId);
  const stage = resolveGrnQcStage(grn, qc);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const open = ['GRN_DRAFT', 'QC_READY', 'QC_DRAFT'].includes(stage.key);

  return (
    <FormSection id={poId ? `grn-qc-section-${poId}` : 'grn-qc-section'} sx={{ scrollMarginTop: 80 }}
      icon={<ClipboardCheck size={20} />} title={`Incoming QC${poNumber ? ` — PO ${poNumber}` : ''}`}
      badge={(
        <>
          <span data-testid="grn-qc-status"><GrnQcStatusChip stage={stage} /></span>
          {qc?.qcNumber && <Chip size="small" variant="outlined" label={qc.qcNumber} sx={{ fontWeight: 700 }} />}
          {readOnlyGrn && <Chip size="small" variant="outlined" icon={<Lock size={12} />} label="GRN read-only" sx={{ fontWeight: 700 }} />}
        </>
      )}
      actions={(qc?.qcPdfUrl || qc?._id) ? (
        <>
          {qc?.qcPdfUrl && (
            <Button size="small" variant="outlined" startIcon={<FileDown size={14} />} onClick={() => setPdfOpen(true)}>QC Report</Button>
          )}
          {/* Full saved record: every stored field (incl. earlier rework / defect /
              severity), the timeline and attachments. Viewing only. */}
          {qc?._id && (
            <Button size="small" variant="text" startIcon={<ExternalLink size={14} />}
              onClick={() => navigate(`/procurement/incoming-qc/${qc._id}`)}>
              View full QC record
            </Button>
          )}
        </>
      ) : null}>
      {completedGrn && qcLoading && !qc ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}><CircularProgress size={22} /></Box>
      ) : (
        <>
          {stage.key === 'CANCELLED' && <Alert severity="info">{stage.desc}</Alert>}

          {open && (
            <Box data-testid="grn-qc-actions" sx={{
              p: 1.5, px: 2, borderRadius: '10px', border: `1px solid ${PFMS.line}`, bgcolor: PFMS.surfaceAlt,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap',
            }}>
              <Box sx={{ minWidth: 220, flex: 1 }}>
                {stage.key === 'QC_DRAFT' && (
                  <Typography sx={{ fontSize: '0.86rem', fontWeight: 700, color: PFMS.ink, mb: 0.25 }}>
                    Draft {qc.qcNumber} saved {fmtDate(qc.updatedAt)} · accepted {qc.totalAccepted ?? '—'} · rejected {qc.totalRejected ?? '—'}
                  </Typography>
                )}
                <Typography data-testid="grn-qc-next" sx={{ fontSize: '0.84rem', color: PFMS.sub }}>{NEXT_TEXT[stage.key]}</Typography>
              </Box>
              <Button variant="contained" color="success" startIcon={<PencilLine size={16} />} onClick={() => setFormOpen(true)}
                data-testid="grn-qc-open-form" sx={{ fontWeight: 700 }}>
                Open GRN + QC form
              </Button>
            </Box>
          )}

          {stage.key === 'QC_DONE' && (
            <>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={6} sm={3}><Field label="Result" value={<QcResultChip result={qc.overallResult} />} /></Grid>
                <Grid item xs={6} sm={3}><Field label="Completed" value={fmtDate(qc.completedAt)} /></Grid>
                <Grid item xs={6} sm={3}><Field label="Accepted / Received" value={`${qc.totalAccepted} / ${qc.totalReceived}`} /></Grid>
                {/* Rework only where an earlier QC recorded it. */}
                <Grid item xs={6} sm={3}><Field label="Rejected" value={qc.totalRework > 0 ? `${qc.totalRejected} (rework ${qc.totalRework})` : qc.totalRejected} /></Grid>
              </Grid>
              <QcInspectionForm readOnly header={headerFromQc(qc)} onHeaderChange={noop}
                items={linesFromQc(qc)} onItemChange={noop}
                doc={qc.qcReportDocument?.fileUrl ? qc.qcReportDocument : null} onDocChange={noop} />
            </>
          )}

          {stage.key === 'QC_DONE_LEGACY' && (
            <Grid container spacing={2}>
              <Grid item xs={6} sm={3}><Field label="QC Status" value={<QcStatusChip status={grn.qcStatus} />} /></Grid>
              <Grid item xs={6} sm={3}><Field label="QC Number" value={grn.qcNumber || '—'} /></Grid>
              <Grid item xs={6} sm={3}><Field label="QC Completed" value={fmtDate(grn.qcCompletedAt)} /></Grid>
            </Grid>
          )}
        </>
      )}

      {qc && <IncomingQCPdfPreview open={pdfOpen} qc={qc} onClose={() => setPdfOpen(false)} />}
      {formOpen && (
        <Suspense fallback={null}>
          <GrnFormDialog open grn={grn} onClose={() => setFormOpen(false)} />
        </Suspense>
      )}
    </FormSection>
  );
};

/**
 * Renders the GRN's Incoming QC section(s) — one per PO on a multi-PO GRN
 * (`grn.poIds.length > 1`), or exactly one, unscoped, for every single-PO or
 * W/O PO GRN.
 */
export const GrnQcSections = ({ grn, ...rest }) => {
  const poIds = grn?.poIds || [];
  if (poIds.length <= 1) return <GrnQcSection grn={grn} {...rest} />;
  const poNumbers = grn?.poNumbers || [];
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {poIds.map((poId, i) => (
        <GrnQcSection key={poId} grn={grn} poId={poId} poNumber={poNumbers[i] || ''} {...rest} />
      ))}
    </Box>
  );
};

export default GrnQcSection;
