import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import {
  Box, Typography, Paper, Button, IconButton, CircularProgress, Chip, Tooltip,
} from '@mui/material';
import {
  ArrowLeft, CheckCircle2, CalendarClock, PackageCheck, PhoneCall,
  Building2, FileText, MessageSquare, ExternalLink, ShoppingBag,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useGetFollowUpByIdQuery } from '../../../store/api/procurementApi';
import { FuStatusChip, FuTypeChip, fmtDate, fmtDelay, fuActivityLabel } from './fuMeta';
import FollowUpDoneDialog from './FollowUpDoneDialog';
import FollowUpReadyForGrnDialog from './FollowUpReadyForGrnDialog';
import NextStepBanner from '../components/NextStepBanner';
import StatusChip from '../components/StatusChip';
import { PFMS, pfmsPageSx, pfmsCardSx } from '../pfmsTheme';

// ── Same spacing/typography scale as Indent Detail and PO Detail
// (SECTION_GAP/CARD_PAD/Field/FieldGrid/SectionCard), so this page reads as
// part of the same system instead of the older p:3 / 1rem-value variant. ──
const SECTION_GAP = 2;
const CARD_PAD = 2;

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: PFMS.sub, mb: 0.4 }}>{label}</Typography>
    {/* div, not p: the Time Delay value is a chip (block element), which may not sit inside a <p> */}
    <Typography component="div" sx={{ fontSize: '0.86rem', fontWeight: 600, color: PFMS.ink, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);

// Fields on common columns that reflow at any width. The previous xs=6/sm=4
// grid inside a half-width card squeezed each field to ~100px at 1024px,
// breaking phone and PO numbers mid-value and wrapping labels. Phones get an
// explicit two-up: auto-fill counts columns with the 210px MAX track, so any
// card narrower than ~452px collapsed to one long column.
const FieldGrid = ({ children, sx }) => (
  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(auto-fill, minmax(150px, 210px))' }, gap: 2, ...sx }}>
    {children}
  </Box>
);

// Full-width cards in one stack (as on Indent/PO Detail): the former md=6
// Plan vs Actual / Vendor & Linkage pair had different field counts, so the
// shorter card always left a blank block beside its taller partner.
const SectionCard = ({ icon, title, children }) => (
  <Paper sx={{ ...pfmsCardSx, p: CARD_PAD }}>
    <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, fontWeight: 700, fontSize: '0.92rem', color: 'primary.main' }}>
      {icon} {title}
    </Typography>
    {children}
  </Paper>
);

const FollowUpDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack('/purchase-fms/follow-ups');

  const { data, isLoading } = useGetFollowUpByIdQuery(id);
  const fu = data?.data;

  const [doneOpen, setDoneOpen] = useState(false);
  const [readyOpen, setReadyOpen] = useState(false);

  if (isLoading) return <Box sx={{ display: 'grid', placeItems: 'center', height: '70vh' }}><CircularProgress /></Box>;
  if (!fu) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6">Follow-up not found</Typography>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/purchase-fms/follow-ups')}>Back to list</Button>
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
        desc: 'Call/email the vendor and update this follow-up: a next follow-up date keeps chasing, a final material date moves the PO toward GRN.',
        primary: { label: 'Update Follow-up', icon: <CheckCircle2 size={16} />, onClick: () => setDoneOpen(true) } };
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

  return (
    <Box sx={{ ...pfmsPageSx }}>
      {/* Hero — same sizes as Indent/PO Detail. The identity block has an
          explicit flex basis (it used to be sized by its one-line subtitle, so
          on a phone it dropped under the back button): small enough on phones
          to stay beside it, large enough from md up that on a tablet the
          actions move to their own row rather than squeezing the ID and chips
          into a ~300px column. */}
      <Box sx={{ mb: SECTION_GAP, display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, gap: 1.5, flexWrap: 'wrap' }}>
        <Tooltip title="Back">
          <IconButton onClick={goBack} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}`, width: 38, height: 38 }}>
            <ArrowLeft size={18} />
          </IconButton>
        </Tooltip>
        <Box sx={{ width: 38, height: 38, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main', flexShrink: 0 }}>
          <PhoneCall size={20} />
        </Box>
        <Box sx={{ flex: { xs: '1 1 200px', md: '1 1 420px' }, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: PFMS.ink }}>{fu.followUpNumber}</Typography>
            <FuStatusChip status={fu.followUpStatus} />
            <FuTypeChip type={fu.followUpType} />
          </Box>
          <Typography variant="body2" sx={{ color: PFMS.sub }}>
            {fu.vendorName} · PO {fu.poNumber || '—'} · Indent {fu.indentNumber || '—'}
          </Typography>
        </Box>
        <Box sx={{
          display: 'flex', gap: 1, flexWrap: 'wrap', width: { xs: '100%', sm: 'auto' },
          '& .MuiButtonBase-root': { flex: { xs: '1 1 auto', sm: '0 0 auto' } },
        }}>
          {fu.poId && (
            <Button variant="outlined" startIcon={<ShoppingBag size={16} />}
              onClick={() => navigate(`/procurement/purchase-orders/${fu.poId}`)}>
              View PO
            </Button>
          )}
          {isActive && (
            <Button variant="contained" color="success" startIcon={<CheckCircle2 size={16} />} onClick={() => setDoneOpen(true)}>
              Update Follow-up
            </Button>
          )}
          {canReadyForGrn && <Button variant="contained" startIcon={<PackageCheck size={16} />} onClick={() => setReadyOpen(true)}>Mark Ready For GRN</Button>}
        </Box>
      </Box>

      <NextStepBanner step={nextStep} />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: SECTION_GAP }}>
        {/* Plan vs actual */}
        <SectionCard icon={<CalendarClock size={18} />} title="Plan vs Actual">
          <FieldGrid>
            <Field label="Planned" value={fmtDate(fu.plannedAt)} />
            <Field label="Actual" value={fmtDate(fu.actualAt)} />
            <Field label="Time Delay" value={fu.actualAt
              ? <StatusChip status="TIME_DELAY" tone={fu.timeDelayMinutes > 0 ? 'amber' : 'green'} label={fmtDelay(fu.timeDelayMinutes)} />
              : '—'} />
            <Field label="Status Done?" value={fu.statusDone === 'YES' ? 'Yes' : 'No'} />
            <Field label="Next Follow-up" value={fmtDate(fu.nextFollowUpDate)} />
            <Field label="Final Material Date" value={fmtDate(fu.finalMaterialDate)} />
          </FieldGrid>
          {fu.formLink ? (
            <Box sx={{ mt: 2 }}>
              <Button size="small" variant="outlined" startIcon={<ExternalLink size={14} />} href={fu.formLink} target="_blank" rel="noopener">
                Form Link
              </Button>
            </Box>
          ) : null}
          {fu.remarks ? <Box sx={{ mt: 2 }}><Field label="Remarks" value={fu.remarks} /></Box> : null}
        </SectionCard>

        {/* Vendor + linkage */}
        <SectionCard icon={<Building2 size={18} />} title="Vendor & Linkage">
          <FieldGrid>
            <Field label="Vendor" value={fu.vendorName || '—'} />
            <Field label="Phone" value={fu.vendorPhone || '—'} />
            <Field label="Email" value={fu.vendorEmail || '—'} />
            <Field label="Contact Person" value={fu.contactPerson || '—'} />
            <Field label="PO Number" value={fu.poNumber || '—'} />
            <Field label="Indent Number" value={fu.indentNumber || '—'} />
            <Field label="Performed By" value={fu.performedByName || fu.performedBy?.name || '—'} />
          </FieldGrid>
        </SectionCard>

        {/* Communication log */}
        <SectionCard icon={<MessageSquare size={18} />} title={`Communication Log (${fu.communicationLog?.length || 0})`}>
          {fu.communicationLog?.length ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {[...fu.communicationLog].reverse().map((c, i) => (
                <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, p: 1.25, borderRadius: '8px', bgcolor: PFMS.surfaceAlt, border: `1px solid ${PFMS.line}` }}>
                  <FuTypeChip type={c.type} />
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    {/* explicit ink: the app theme paints un-coloured body2 blue, which made messages read as links */}
                    <Typography variant="body2" sx={{ color: PFMS.ink, overflowWrap: 'anywhere' }}>{c.message || '—'}</Typography>
                    <Typography variant="caption" sx={{ color: PFMS.sub }}>{c.byName || '—'} · {fmtDate(c.timestamp)}{c.contactPerson ? ` · spoke to ${c.contactPerson}` : ''}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          ) : (
            <Typography variant="body2" sx={{ color: PFMS.sub }}>No communication recorded yet.</Typography>
          )}
        </SectionCard>

        {/* Activity — one grid per entry with a fixed label column, so every
            description starts at the same x whatever the label's length; on
            phones the date moves up beside the label and the description takes
            the full width underneath (it used to be squeezed into a ~120px
            column with the date broken over three lines). */}
        {fu.activityTimeline?.length ? (
          <SectionCard icon={<FileText size={18} />} title="Activity">
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
              {[...fu.activityTimeline].reverse().map((ev, i) => (
                <Box key={i} sx={{
                  display: 'grid', alignItems: 'center', columnGap: 1.5, rowGap: 0.5,
                  gridTemplateColumns: { xs: 'minmax(0, auto) 1fr', sm: '160px minmax(0, 1fr) auto' },
                  gridTemplateAreas: { xs: '"label date" "desc desc"', sm: '"label desc date"' },
                }}>
                  <Chip size="small" label={fuActivityLabel(ev)} sx={{ gridArea: 'label', justifySelf: 'start', maxWidth: '100%', fontWeight: 700 }} />
                  <Typography variant="body2" sx={{ gridArea: 'desc', color: PFMS.sub, minWidth: 0, overflowWrap: 'anywhere' }}>{ev.description}</Typography>
                  <Typography variant="caption" sx={{ gridArea: 'date', justifySelf: 'end', whiteSpace: 'nowrap', color: PFMS.faint }}>{fmtDate(ev.timestamp)}</Typography>
                </Box>
              ))}
            </Box>
          </SectionCard>
        ) : null}
      </Box>

      {/* Dialogs */}
      <FollowUpDoneDialog open={doneOpen} followUp={fu} onClose={() => setDoneOpen(false)} />
      <FollowUpReadyForGrnDialog open={readyOpen} followUp={fu} onClose={() => setReadyOpen(false)} />
    </Box>
  );
};

export default FollowUpDetail;
