import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, Grid, Button, IconButton, CircularProgress, Chip,
} from '@mui/material';
import {
  ArrowLeft, CheckCircle2, CalendarClock, PackageCheck, PhoneCall,
  Building2, FileText, MessageSquare, ExternalLink, ShoppingBag, ArrowRight,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useGetFollowUpByIdQuery } from '../../../store/api/procurementApi';
import { FuStatusChip, FuTypeChip, fmtDate, fmtDelay } from './fuMeta';
import FollowUpDoneDialog from './FollowUpDoneDialog';
import FollowUpRescheduleDialog from './FollowUpRescheduleDialog';
import FollowUpReadyForGrnDialog from './FollowUpReadyForGrnDialog';

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary', mb: 0.25 }}>{label}</Typography>
    <Typography sx={{ fontWeight: 600, color: 'text.primary', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);

const SectionCard = ({ icon, title, children }) => (
  <Paper sx={{ p: 3, borderRadius: '18px' }}>
    <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: 'primary.main' }}>
      {icon} {title}
    </Typography>
    {children}
  </Paper>
);

const FollowUpDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data, isLoading } = useGetFollowUpByIdQuery(id);
  const fu = data?.data;

  const [doneOpen, setDoneOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [readyOpen, setReadyOpen] = useState(false);

  if (isLoading) return <Box sx={{ display: 'grid', placeItems: 'center', height: '70vh' }}><CircularProgress /></Box>;
  if (!fu) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6">Follow-up not found</Typography>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/purchase-fms/material-follow-ups')}>Back to list</Button>
      </Box>
    );
  }

  const isPending = fu.followUpStatus === 'PENDING';
  const isRescheduled = fu.followUpStatus === 'RESCHEDULED';
  const isDone = fu.followUpStatus === 'DONE';
  const isActive = isPending || isRescheduled; // still chasing — can record a cycle
  // Ready For GRN requires a confirmed Final Material Date. A follow-up with only
  // a Next Follow-up Date stays active (RESCHEDULED) and cannot move to GRN.
  const canReadyForGrn = isDone && !!fu.finalMaterialDate; // legacy DONE records

  // ── "What's next?" — single, obvious call-to-action for the current stage. ──
  const goPO = () => fu.poId && navigate(`/procurement/purchase-orders/${fu.poId}`);
  const nextStep = (() => {
    if (fu.followUpStatus === 'READY_FOR_GRN') {
      return { tone: 'success', title: 'Material ready — next: receive goods (GRN)',
        desc: 'Open the Purchase Order to create the Goods Receipt Note. If a PI/advance is required, settle it first; then receive the goods.',
        primary: fu.poId ? { label: 'Open Purchase Order', icon: <ShoppingBag size={16} />, onClick: goPO } : null,
        secondary: { label: 'Go to GRNs', onClick: () => navigate('/purchase-fms/grn') } };
    }
    if (isActive) {
      return { tone: 'info', title: 'Next: record the follow-up & confirm material',
        desc: 'Call/email the vendor, mark this follow-up done, and set the final material date to move toward GRN.',
        primary: { label: isRescheduled ? 'Follow-up Again' : 'Mark Done', icon: <CheckCircle2 size={16} />, onClick: () => setDoneOpen(true) },
        secondary: { label: 'Reschedule', onClick: () => setRescheduleOpen(true) } };
    }
    if (canReadyForGrn) {
      return { tone: 'success', title: 'Material confirmed — mark Ready For GRN',
        desc: 'The final material date is set. Mark this follow-up Ready For GRN to enable goods receipt.',
        primary: { label: 'Mark Ready For GRN', icon: <PackageCheck size={16} />, onClick: () => setReadyOpen(true) } };
    }
    if (isDone) {
      return { tone: 'info', title: 'Confirm the final material date',
        desc: 'Record the final material delivery date so this follow-up can proceed to GRN.',
        primary: { label: 'Update Follow-up', icon: <CheckCircle2 size={16} />, onClick: () => setDoneOpen(true) } };
    }
    return null;
  })();

  const NEXT_TONE = {
    info:    { bg: alpha('#2563eb', 0.07), border: alpha('#2563eb', 0.35), fg: '#1d4ed8' },
    success: { bg: alpha('#16a34a', 0.08), border: alpha('#16a34a', 0.35), fg: '#15803d' },
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, bgcolor: '#f8fafc', minHeight: '100vh' }}>
      {/* Hero */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={() => navigate('/purchase-fms/material-follow-ups')} sx={{ bgcolor: '#fff', boxShadow: 1 }}>
          <ArrowLeft size={20} />
        </IconButton>
        <Box sx={{ width: 46, height: 46, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main' }}>
          <PhoneCall size={24} />
        </Box>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="h5" fontWeight={800}>{fu.followUpNumber}</Typography>
            <FuStatusChip status={fu.followUpStatus} />
            <FuTypeChip type={fu.followUpType} />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {fu.vendorName} · PO {fu.poNumber || '—'} · Indent {fu.indentNumber || '—'}
          </Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {fu.poId && (
            <Button variant="outlined" startIcon={<ShoppingBag size={16} />}
              onClick={() => navigate(`/procurement/purchase-orders/${fu.poId}`)}>
              View PO
            </Button>
          )}
          {isActive && (
            <Button variant="contained" color="success" startIcon={<CheckCircle2 size={16} />} onClick={() => setDoneOpen(true)}>
              {isRescheduled ? 'Follow-up Again' : 'Mark Done'}
            </Button>
          )}
          {isActive && <Button variant="outlined" startIcon={<CalendarClock size={16} />} onClick={() => setRescheduleOpen(true)}>Reschedule</Button>}
          {canReadyForGrn && <Button variant="contained" startIcon={<PackageCheck size={16} />} onClick={() => setReadyOpen(true)}>Mark Ready For GRN</Button>}
        </Box>
      </Box>

      {/* What's next — adaptive, prominent call-to-action for the current stage */}
      {nextStep && (() => {
        const t = NEXT_TONE[nextStep.tone] || NEXT_TONE.info;
        return (
          <Paper elevation={0} sx={{
            mb: 3, p: 2.5, borderRadius: '16px', border: '1px solid', borderColor: t.border, bgcolor: t.bg,
            display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
          }}>
            <Box sx={{ width: 42, height: 42, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: '#fff', color: t.fg, flexShrink: 0 }}>
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

      <Grid container spacing={3}>
        {/* Plan vs actual */}
        <Grid item xs={12} md={6}>
          <SectionCard icon={<CalendarClock size={18} />} title="Plan vs Actual">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}><Field label="Planned" value={fmtDate(fu.plannedAt)} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Actual" value={fmtDate(fu.actualAt)} /></Grid>
              <Grid item xs={6} sm={4}>
                <Field label="Time Delay" value={fu.actualAt
                  ? <Chip size="small" label={fmtDelay(fu.timeDelayMinutes)} color={fu.timeDelayMinutes > 0 ? 'warning' : 'success'} sx={{ fontWeight: 700 }} />
                  : '—'} />
              </Grid>
              <Grid item xs={6} sm={4}><Field label="Status Done?" value={fu.statusDone === 'YES' ? 'Yes' : 'No'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Next Follow-up" value={fmtDate(fu.nextFollowUpDate)} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Final Material Date" value={fmtDate(fu.finalMaterialDate)} /></Grid>
              {fu.formLink ? (
                <Grid item xs={12}>
                  <Button size="small" variant="outlined" startIcon={<ExternalLink size={14} />} href={fu.formLink} target="_blank" rel="noopener">
                    Form Link
                  </Button>
                </Grid>
              ) : null}
              {fu.remarks ? <Grid item xs={12}><Field label="Remarks" value={fu.remarks} /></Grid> : null}
            </Grid>
          </SectionCard>
        </Grid>

        {/* Vendor + linkage */}
        <Grid item xs={12} md={6}>
          <SectionCard icon={<Building2 size={18} />} title="Vendor & Linkage">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}><Field label="Vendor" value={fu.vendorName || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Phone" value={fu.vendorPhone || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Email" value={fu.vendorEmail || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="PO Number" value={fu.poNumber || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Indent Number" value={fu.indentNumber || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Performed By" value={fu.performedByName || fu.performedBy?.name || '—'} /></Grid>
            </Grid>
          </SectionCard>
        </Grid>

        {/* Communication log */}
        <Grid item xs={12}>
          <SectionCard icon={<MessageSquare size={18} />} title={`Communication Log (${fu.communicationLog?.length || 0})`}>
            {fu.communicationLog?.length ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                {[...fu.communicationLog].reverse().map((c, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, p: 1.25, borderRadius: '10px', bgcolor: '#f8fafc', border: '1px solid', borderColor: 'divider' }}>
                    <FuTypeChip type={c.type} />
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography variant="body2">{c.message || '—'}</Typography>
                      <Typography variant="caption" color="text.disabled">{c.byName || '—'} · {fmtDate(c.timestamp)}</Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="text.disabled">No communication recorded yet.</Typography>
            )}
          </SectionCard>
        </Grid>

        {/* Activity */}
        {fu.activityTimeline?.length ? (
          <Grid item xs={12}>
            <SectionCard icon={<FileText size={18} />} title="Activity">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[...fu.activityTimeline].reverse().map((ev, i) => (
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
      <FollowUpDoneDialog open={doneOpen} followUp={fu} onClose={() => setDoneOpen(false)} />
      <FollowUpRescheduleDialog open={rescheduleOpen} followUp={fu} onClose={() => setRescheduleOpen(false)} />
      <FollowUpReadyForGrnDialog open={readyOpen} followUp={fu} onClose={() => setReadyOpen(false)} />
    </Box>
  );
};

export default FollowUpDetail;
