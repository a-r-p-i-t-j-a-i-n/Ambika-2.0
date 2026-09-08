import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import {
  Box, Typography, Paper, Grid, Button, IconButton, CircularProgress, Chip,
} from '@mui/material';
import {
  ArrowLeft, Pencil, CheckCircle2, Ban, FileSpreadsheet, Building2, FileText,
  Banknote, ListChecks, X, Check,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useSnackbar } from 'notistack';
import {
  useGetTallyEntryByIdQuery,
  useCancelTallyEntryMutation,
} from '../../../store/api/procurementApi';
import { TallyStatusChip, CHECKLIST_ITEMS, CHECKLIST_TOTAL, checklistProgress, fmtDate } from './tallyMeta';
import TallyEntryFormDialog from './TallyEntryFormDialog';
import TallyEntryCompleteDialog from './TallyEntryCompleteDialog';
import WorkflowStepper from '../components/WorkflowStepper';
import { resolveWorkflowSteps } from '../components/purchaseFmsWorkflow';
import { PFMS, pfmsPageSx, pfmsCardSx } from '../pfmsTheme';

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary', mb: 0.25 }}>{label}</Typography>
    <Typography sx={{ fontWeight: 600, color: 'text.primary', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);
const SectionCard = ({ icon, title, children }) => (
  <Paper sx={{ ...pfmsCardSx, p: 3 }}>
    <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, color: 'primary.main', mb: 2 }}>{icon} {title}</Typography>
    {children}
  </Paper>
);

const TallyEntryDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack('/purchase-fms/tally-entries');
  const { enqueueSnackbar } = useSnackbar();
  const { data, isLoading } = useGetTallyEntryByIdQuery(id);
  const t = data?.data;
  const wfSteps = resolveWorkflowSteps({ tallyEntry: t });

  const [formOpen, setFormOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [cancelEntry, { isLoading: cancelling }] = useCancelTallyEntryMutation();

  if (isLoading) return <Box sx={{ display: 'grid', placeItems: 'center', height: '70vh' }}><CircularProgress /></Box>;
  if (!t) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6">Tally entry not found</Typography>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/purchase-fms/tally-entries')}>Back to list</Button>
      </Box>
    );
  }

  const isPending = t.tallyEntryStatus === 'PENDING';
  const done = checklistProgress(t.checklist);

  const handleCancel = async () => {
    try { await cancelEntry({ id: t._id }).unwrap(); enqueueSnackbar('Tally entry cancelled', { variant: 'info' }); }
    catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to cancel', { variant: 'error' }); }
  };

  return (
    <Box sx={{ ...pfmsPageSx, p: { xs: 1.5, md: 2.5 } }}>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={goBack} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}` }}><ArrowLeft size={20} /></IconButton>
        <Box sx={{ width: 46, height: 46, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main' }}><FileSpreadsheet size={24} /></Box>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="h5" fontWeight={800} sx={{ color: PFMS.ink }}>{t.entryNumber}</Typography>
            <TallyStatusChip status={t.tallyEntryStatus} />
            <Chip size="small" variant="outlined" label={`Done in Tally: ${t.statusDone}`} sx={{ fontWeight: 700 }} color={t.statusDone === 'YES' ? 'success' : 'warning'} />
          </Box>
          <Typography variant="body2" color="text.secondary">{t.vendorName} · Voucher {t.voucherNumber || '—'} · {t.stepName}</Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {t.voucherId && <Button variant="outlined" startIcon={<Banknote size={16} />} onClick={() => navigate(`/procurement/vouchers/${t.voucherId}`)}>View Voucher</Button>}
          {isPending && <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setFormOpen(true)}>Edit</Button>}
          {isPending && <Button variant="outlined" color="error" startIcon={<Ban size={16} />} onClick={handleCancel} disabled={cancelling}>Cancel</Button>}
          {isPending && <Button variant="contained" color="success" startIcon={<CheckCircle2 size={16} />} onClick={() => setCompleteOpen(true)}>Complete</Button>}
        </Box>
      </Box>

      <WorkflowStepper steps={wfSteps} sx={{ mb: 3 }} />
      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <SectionCard icon={<ListChecks size={18} />} title={`Invoice Checklist — ${done}/${CHECKLIST_TOTAL}`}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {CHECKLIST_ITEMS.map((i) => {
                const ok = !!t.checklist?.[i.key];
                return (
                  <Box key={i.key} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, borderRadius: '8px', bgcolor: ok ? alpha('#16a34a', 0.06) : alpha('#94a3b8', 0.06) }}>
                    <Box sx={{ width: 22, height: 22, borderRadius: '6px', display: 'grid', placeItems: 'center', bgcolor: ok ? '#16a34a' : '#cbd5e1', color: '#fff' }}>
                      {ok ? <Check size={14} /> : <X size={14} />}
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: ok ? 600 : 500, color: ok ? 'text.primary' : 'text.secondary' }}>{i.label}</Typography>
                  </Box>
                );
              })}
            </Box>
          </SectionCard>
        </Grid>

        <Grid item xs={12} md={5}>
          <SectionCard icon={<Building2 size={18} />} title="Linkage & Tally">
            <Grid container spacing={2}>
              <Grid item xs={6}><Field label="Vendor" value={t.vendorName || '—'} /></Grid>
              <Grid item xs={6}><Field label="Voucher" value={t.voucherNumber || '—'} /></Grid>
              <Grid item xs={6}><Field label="Invoice" value={t.invoiceNumber || '—'} /></Grid>
              <Grid item xs={6}><Field label="PO" value={t.poNumber || '—'} /></Grid>
              <Grid item xs={6}><Field label="Planned" value={fmtDate(t.plannedAt)} /></Grid>
              <Grid item xs={6}><Field label="Actual" value={fmtDate(t.actualAt)} /></Grid>
              <Grid item xs={6}><Field label="Tally Voucher No" value={t.tallyVoucherNumber || '—'} /></Grid>
              <Grid item xs={6}><Field label="Tally Ledger" value={t.tallyLedgerName || '—'} /></Grid>
              <Grid item xs={6}><Field label="Performed By" value={t.performedByName || '—'} /></Grid>
              {t.remarks ? <Grid item xs={12}><Field label="Remarks" value={t.remarks} /></Grid> : null}
            </Grid>
          </SectionCard>
        </Grid>

        {t.activityTimeline?.length ? (
          <Grid item xs={12}>
            <SectionCard icon={<FileText size={18} />} title="Timeline">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[...t.activityTimeline].reverse().map((ev, i) => (
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

      <TallyEntryFormDialog open={formOpen} entry={t} onClose={() => setFormOpen(false)} />
      <TallyEntryCompleteDialog open={completeOpen} entry={t} onClose={() => setCompleteOpen(false)} />
    </Box>
  );
};

export default TallyEntryDetail;
