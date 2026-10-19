import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, Paper, Button, Chip, Alert, CircularProgress, Grid } from '@mui/material';
import { ClipboardCheck, Save, FileDown, ExternalLink } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useCreateIncomingQcMutation, useUpdateIncomingQcMutation, useGetIncomingQcsByGrnQuery,
} from '../../../store/api/procurementApi';
import QcInspectionForm from '../incoming-qc/QcInspectionForm';
import IncomingQCCompleteDialog from '../incoming-qc/IncomingQCCompleteDialog';
import IncomingQCPdfPreview from '../incoming-qc/IncomingQCPdfPreview';
import { QcStatusChip, QcResultChip, fmtDate } from '../incoming-qc/qcMeta';
import {
  emptyHeader, headerFromQc, linesFromGrn, linesFromQc, allLinesBalanced, buildQcPayload, expectedQcResult,
  mergeEnteredLines, lineKey, pickGrnQc,
} from '../incoming-qc/qcForm';
import { pfmsCardSx } from '../pfmsTheme';
import GrnQcStatusChip from './GrnQcStatusChip';
import GrnCompleteDialog from './GrnCompleteDialog';
import SignDocumentDialog from '../approvals/SignDocumentDialog';
import { resolveGrnQcStage } from './grnQcStage';
import { isGrnCompleted } from './grnMeta';

const noop = () => {};

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary', mb: 0.25 }}>{label}</Typography>
    <Typography component="div" sx={{ fontWeight: 600, color: 'text.primary' }}>{value ?? '—'}</Typography>
  </Box>
);

// QC typed in before the QC record may exist (GRN not yet completed / MD-signed)
// is kept on this device so it is not lost between the steps. Cleared as soon as
// the QC is saved to the server, which from then on is the only copy.
const localKey = (grnId) => `grnQcDraft:${grnId}`;
const readLocal = (grnId) => {
  try { return JSON.parse(localStorage.getItem(localKey(grnId)) || 'null') || {}; } catch { return {}; }
};
const writeLocal = (grnId, v) => { try { localStorage.setItem(localKey(grnId), JSON.stringify(v)); } catch { /* storage unavailable */ } };
const clearLocal = (grnId) => { try { localStorage.removeItem(localKey(grnId)); } catch { /* storage unavailable */ } };

const ENTERED = ['receivedQty', 'acceptedQty', 'rejectedQty', 'reworkQty', 'defectType', 'defectSeverity', 'qcRemarks'];
const pick = (it) => Object.fromEntries(ENTERED.map((f) => [f, it[f]]));

/**
 * The Incoming QC form for a saved GRN, with the one combined action
 * "Complete GRN + QC". Each click performs the NEXT step the existing rules
 * allow, each through its existing confirmation:
 *
 *   GRN draft     → Complete & Post Stock (GrnCompleteDialog — stock posts once)
 *   awaiting MD   → MD signs the GRN (SignDocumentDialog — MD users only)
 *   signed        → save the QC and complete it (IncomingQCCompleteDialog)
 *
 * Nothing is skipped: the server still refuses a QC for an unsigned GRN. A QC
 * draft can be saved to the server once the GRN is signed; before that the
 * entries are kept on this device. Keyed by the QC id, so it re-seeds only when
 * the QC record itself appears — never on a refetch.
 */
const GrnQcEditor = ({ grn, qc, poId, stage, isMd, prepareGrn, onCompleteGrn, onSign, onRequestComplete, onConflict }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [local] = useState(() => (qc ? {} : readLocal(grn._id)));
  const [header, setHeader] = useState(() => (qc ? headerFromQc(qc) : { ...emptyHeader(), ...(local.header || {}) }));
  const [doc, setDoc] = useState(() => (qc?.qcReportDocument?.fileUrl ? { ...qc.qcReportDocument } : (local.doc || null)));
  const [serverItems, setServerItems] = useState(() => (qc ? linesFromQc(qc) : []));
  const [entered, setEntered] = useState(() => (qc ? {} : (local.entered || {})));
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  // Set as soon as Save creates the QC, so a second click updates it instead of
  // trying to create another one before the list refetches.
  const [createdId, setCreatedId] = useState(null);
  const qcId = qc?._id || createdId;

  const [createQc, { isLoading: creating }] = useCreateIncomingQcMutation();
  const [updateQc, { isLoading: updating }] = useUpdateIncomingQcMutation();
  const working = creating || updating || uploading || busy;

  // Before a QC record exists the lines follow the GRN (scoped to this PO on a
  // multi-PO GRN); typed values ride on top.
  const items = qc ? serverItems : mergeEnteredLines(linesFromGrn(grn, poId), entered);
  const setItem = (idx, patch) => {
    if (qc) { setServerItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it))); return; }
    const line = items[idx];
    setEntered((cur) => ({ ...cur, [lineKey(line)]: { ...pick(line), ...patch } }));
  };
  const balanced = allLinesBalanced(items);

  useEffect(() => {
    if (qcId) return;
    writeLocal(grn._id, { header, doc, entered });
  }, [grn._id, qcId, header, doc, entered]);

  const canSaveDraft = stage.editable;
  const canSign = stage.key === 'AWAITING_MD' && grn.approvalStatus === 'READY_FOR_MD_APPROVAL' && isMd;
  const waitingForMd = stage.key === 'AWAITING_MD' && !canSign;

  /** Create (first time) or update the QC; returns the saved record or null. */
  const save = async () => {
    if (!items.length) { enqueueSnackbar('No received items to inspect', { variant: 'warning' }); return null; }
    const payload = buildQcPayload({ header, items, doc });
    try {
      if (qcId) return (await updateQc({ id: qcId, ...payload }).unwrap())?.data || null;
      const saved = (await createQc({ ...payload, grnId: grn._id, poId: poId || undefined }).unwrap())?.data || null;
      if (saved?._id) { setCreatedId(saved._id); clearLocal(grn._id); }
      return saved;
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save QC', { variant: 'error' });
      // Another request already created this GRN's QC — reload so it is resumed here.
      if (err?.status === 409) onConflict?.();
      return null;
    }
  };

  const onSaveDraft = async () => {
    const saved = await save();
    if (saved) enqueueSnackbar(`QC ${saved.qcNumber || ''} saved as draft`, { variant: 'success' });
  };

  const onCompleteAll = async () => {
    if (!items.length) { enqueueSnackbar('No received items to inspect', { variant: 'warning' }); return; }
    if (!balanced) {
      enqueueSnackbar('Accepted + Rejected must equal Received on every line', { variant: 'warning' });
      return;
    }
    if (stage.key === 'GRN_DRAFT') {
      setBusy(true);
      try {
        // Unsaved GRN edits (Create / Edit GRN form) are saved first, so the stock
        // posted is exactly what is on screen.
        if (prepareGrn && !(await prepareGrn())) return;
        onCompleteGrn();
      } finally { setBusy(false); }
      return;
    }
    if (canSign) { onSign(); return; }
    if (stage.editable) {
      const saved = await save();
      if (saved) onRequestComplete(saved);
    }
  };

  const nextText = (() => {
    if (stage.key === 'GRN_DRAFT') return 'Next: complete the GRN and post stock, then the MD signs the GRN, then the QC is completed.';
    if (canSign) return 'GRN completed. Next: sign the GRN as MD, then complete the QC.';
    if (waitingForMd && grn.approvalStatus === 'READY_FOR_MD_APPROVAL') return 'GRN completed — waiting for the MD to sign it. Your QC entries are kept on this device until then.';
    if (waitingForMd) return stage.desc;
    return 'Next: confirm and complete the QC — rejected quantities move out of stock.';
  })();

  return (
    <>
      {stage.key === 'QC_DRAFT' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Resuming draft {qc.qcNumber} — saved {fmtDate(qc.updatedAt)}.
        </Alert>
      )}
      <QcInspectionForm
        header={header} onHeaderChange={(patch) => setHeader((h) => ({ ...h, ...patch }))}
        items={items} onItemChange={setItem}
        doc={doc} onDocChange={setDoc} onUploadingChange={setUploading}
        sourceField={null}
        emptyText="Enter received quantities on the GRN and save it to inspect its lines."
      />
      <Box data-testid="grn-qc-actions" sx={{
        mt: 2, p: 1.5, borderRadius: '10px', border: '1px solid', borderColor: 'divider', bgcolor: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap',
      }}>
        <Box sx={{ minWidth: 220, flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary" fontWeight={700}>Expected result</Typography>
            <QcResultChip result={items.length ? expectedQcResult(items) : ''} />
            <Typography variant="caption" color={balanced ? 'text.secondary' : 'error'}>
              · {items.length} line(s) · {balanced ? 'balanced' : 'not balanced'}
            </Typography>
          </Box>
          <Typography variant="body2" data-testid="grn-qc-next" sx={{ mt: 0.5, color: waitingForMd ? 'warning.dark' : 'text.secondary' }}>{nextText}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={onSaveDraft} disabled={working || !canSaveDraft}
            title={canSaveDraft ? '' : 'A QC draft can be saved once the GRN is completed and MD-signed'}
            startIcon={creating || updating ? <CircularProgress size={14} color="inherit" /> : <Save size={16} />}>
            Save QC Draft
          </Button>
          <Button variant="contained" color="success" onClick={onCompleteAll} disabled={working || !items.length || waitingForMd}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <ClipboardCheck size={16} />}>
            Complete GRN + QC
          </Button>
        </Box>
      </Box>
    </>
  );
};

/**
 * The Incoming QC part of a GRN — shown directly under the GRN, on the GRN page
 * and in the Create / Edit GRN form once the GRN is saved. Same QC record, APIs
 * and rules as before; it loads the GRN's QC itself, so both places behave alike.
 *
 * A multi-PO GRN gets one QC per PO (see incomingQc.service.js) — the caller
 * renders one <GrnQcSection poId poNumber /> per PO in that case (see
 * GrnQcSections below); a single-PO / W/O PO GRN renders exactly one,
 * unscoped, identical to before.
 *
 *   grn         the saved GRN (live from the API)
 *   isMd        may sign the GRN (the server still enforces the MD role)
 *   prepareGrn  optional async () => boolean — save unsaved GRN edits first
 *   poId        scope to one PO's QC on a multi-PO GRN (omit for single-PO/W-O-PO)
 *   poNumber    that PO's number, for the section title
 */
const GrnQcSection = ({ grn, isMd = false, prepareGrn, poId, poNumber }) => {
  const navigate = useNavigate();
  const completedGrn = isGrnCompleted(grn);
  const { data: qcRes, isLoading: qcLoading, refetch } = useGetIncomingQcsByGrnQuery(grn._id, { skip: !completedGrn });
  const qc = pickGrnQc(qcRes?.data || [], poId);
  const stage = resolveGrnQcStage(grn, qc);

  const [grnCompleteOpen, setGrnCompleteOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [completeTarget, setCompleteTarget] = useState(null);
  const [pdfOpen, setPdfOpen] = useState(false);

  const editing = ['GRN_DRAFT', 'AWAITING_MD', 'QC_READY', 'QC_DRAFT'].includes(stage.key);

  return (
    <Paper id={poId ? `grn-qc-section-${poId}` : 'grn-qc-section'} sx={{ ...pfmsCardSx, p: { xs: 2, md: 3 }, scrollMarginTop: 80 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, color: 'primary.main' }}>
            <ClipboardCheck size={18} /> Incoming QC{poNumber ? ` — PO ${poNumber}` : ''}
          </Typography>
          {qc?.qcNumber && <Chip size="small" variant="outlined" label={qc.qcNumber} sx={{ fontWeight: 700 }} />}
          <span data-testid="grn-qc-status"><GrnQcStatusChip stage={stage} /></span>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {qc?.qcPdfUrl && (
            <Button size="small" variant="outlined" startIcon={<FileDown size={14} />} onClick={() => setPdfOpen(true)}>QC Report</Button>
          )}
          {/* Full saved record: every stored field (incl. earlier rework / defect /
              severity), the timeline and attachments. Viewing only — QC is still
              entered and completed here. */}
          {qc?._id && (
            <Button size="small" variant="text" startIcon={<ExternalLink size={14} />}
              onClick={() => navigate(`/procurement/incoming-qc/${qc._id}`)}>
              View full QC record
            </Button>
          )}
        </Box>
      </Box>

      {/* No spinner while awaiting the MD: no QC can exist yet, and keeping the
          form mounted keeps what was typed across the GRN-completion step. */}
      {completedGrn && qcLoading && !qc && stage.key !== 'AWAITING_MD' ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}><CircularProgress size={22} /></Box>
      ) : (
        <>
          {stage.key === 'CANCELLED' && <Alert severity="info">{stage.desc}</Alert>}

          {editing && (
            <GrnQcEditor key={qc?._id || 'new'} grn={grn} qc={stage.key === 'QC_DRAFT' ? qc : null} poId={poId} stage={stage} isMd={isMd}
              prepareGrn={prepareGrn}
              onCompleteGrn={() => setGrnCompleteOpen(true)}
              onSign={() => setSignOpen(true)}
              onRequestComplete={setCompleteTarget}
              onConflict={refetch} />
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

      <GrnCompleteDialog open={grnCompleteOpen} grn={grn} onClose={() => setGrnCompleteOpen(false)} />
      <SignDocumentDialog open={signOpen} documentType="GRN" documentId={grn._id} documentTitle={grn.grnNumber}
        onClose={() => setSignOpen(false)} />
      <IncomingQCCompleteDialog open={Boolean(completeTarget)} qc={completeTarget} onClose={() => setCompleteTarget(null)} />
      {qc && <IncomingQCPdfPreview open={pdfOpen} qc={qc} onClose={() => setPdfOpen(false)} />}
    </Paper>
  );
};

/**
 * Renders the GRN's Incoming QC section(s) — one per PO on a multi-PO GRN
 * (`grn.poIds.length > 1`), or exactly one, unscoped, for every single-PO or
 * W/O PO GRN (identical to always rendering `<GrnQcSection grn={grn} />`,
 * the only thing every pre-existing GRN ever does).
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
