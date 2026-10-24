import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import {
  Box, Typography, Paper, Button, IconButton, CircularProgress, Chip, Tooltip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Divider,
} from '@mui/material';
import {
  ArrowLeft, Pencil, CheckCircle2, Send, FileDown, Ban, ShoppingBag,
  Building2, FileText, Truck, PhoneCall, PackageCheck, Eye, CircleSlash,
  RotateCcw, GitBranch, AlertTriangle, ClipboardCheck,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useSnackbar } from 'notistack';
import {
  useGetPurchaseOrderQuery,
  useCancelPurchaseOrderMutation,
  useGetFollowUpsByPoQuery,
  useCreateFollowUpMutation,
  useGetProformaInvoicesByPoQuery,

  useGetGrnsByPoQuery,
  useGeneratePurchaseOrderPdfMutation,

} from '../../../store/api/procurementApi';
import { PoStatusChip, PoApprovalChip, PoReleaseChip, fmtINR, fmtDate, poDisplayNumber } from './poMeta';
import { PFMS, pfmsPageSx, pfmsCardSx, pfmsTableHeadSx } from '../pfmsTheme';
import useRowNavigation, { rowNavigationTableSx } from '../common/useRowNavigation';
import StatusChip from '../components/StatusChip';
import NextStepBanner from '../components/NextStepBanner';
import PurchaseOrderFormDrawer from './PurchaseOrderFormDrawer';
import PurchaseOrderApprovalDialog from './PurchaseOrderApprovalDialog';
import PurchaseOrderReleaseDialog from './PurchaseOrderReleaseDialog';
import PurchaseOrderPdfPreview from './PurchaseOrderPdfPreview';
import { PoFollowUpChip, FuStatusChip, FuTypeChip, fmtDate as fmtFuDate } from '../follow-ups/fuMeta';
import FollowUpFormDrawer from '../follow-ups/FollowUpFormDrawer';
import FollowUpDoneDialog from '../follow-ups/FollowUpDoneDialog';
import FollowUpReadyForGrnDialog from '../follow-ups/FollowUpReadyForGrnDialog';
import { PoPiChip, fmtINR as fmtPiINR } from '../proforma-invoices/piMeta';
import ProformaInvoiceFormDrawer from '../proforma-invoices/ProformaInvoiceFormDrawer';
import ProformaInvoiceApprovalDialog from '../proforma-invoices/ProformaInvoiceApprovalDialog';
import PurchaseOrderPiNotRequiredDialog from './PurchaseOrderPiNotRequiredDialog';

import { GrnStatusChip } from '../grn/grnMeta';
import GrnFormDialog from '../grn/GrnFormDialog';
import GrnCompleteDialog from '../grn/GrnCompleteDialog';
import FmsDoerCard from '../../fms-doers/FmsDoerCard';

// ── Page-wide design tokens — same spacing/typography scale as Indent Detail
// (SECTION_GAP/CARD_PAD/Field/FieldGrid/SectionCard), so the two most-used
// Purchase FMS detail pages read as one system. ──
const SECTION_GAP = 2;
const CARD_PAD = 2;

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: PFMS.sub, mb: 0.4 }}>{label}</Typography>
    {/* div, not p: some values are chips (block elements), which may not sit inside a <p> */}
    <Typography component="div" sx={{ fontSize: '0.86rem', fontWeight: 600, color: PFMS.ink, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);

// A row of Fields that aligns to common columns and reflows at any width
// without hand-picked breakpoints — one grid rule instead of a different
// xs/sm split per section.
const FieldGrid = ({ children, sx }) => (
  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 210px))', gap: 2, ...sx }}>
    {children}
  </Box>
);

// Every section is a full-width card, stacked in one column. A paired md=6
// layout (the previous Vendor/Terms and Approval/Remarks arrangement) leaves
// half a row blank the moment its partner is short or absent — on real data
// that happened constantly (no Remarks, a short Approval card) — and a wide
// table forced into half the content width wraps cells it doesn't need to.
// Full width removes both failure modes at the root.
// Action rows on this page carry several chips/buttons at once (unlike a
// single lone button), so the title needs more room than Indent Detail's
// sm breakpoint gives before pairing side-by-side — at sm a longer title
// ("Vendor Delivery Follow-ups") wraps and squeezes the action row instead
// of sitting cleanly above it.
const SectionCard = ({ icon, title, action, children }) => (
  <Paper sx={{ ...pfmsCardSx, p: CARD_PAD }}>
    <Box sx={{
      display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'stretch', md: 'center' },
      justifyContent: 'space-between', gap: 1.25, mb: 1.5,
    }}>
      <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, fontSize: '0.92rem', color: 'primary.main' }}>
        {icon} {title}
      </Typography>
      {action && (
        <Box sx={{ width: { xs: '100%', md: 'auto' }, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', '& .MuiButtonBase-root': { width: { xs: '100%', sm: 'auto' } } }}>
          {action}
        </Box>
      )}
    </Box>
    {children}
  </Paper>
);

// Monospace badge for tax identifiers (GST / PAN).
const TaxBadge = ({ label, value }) => (
  <Box sx={{
    display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.6, borderRadius: '9px',
    bgcolor: (t) => alpha(t.palette.primary.main, 0.06), border: '1px solid', borderColor: (t) => alpha(t.palette.primary.main, 0.16),
  }}>
    <Typography component="span" sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '.05em', color: 'primary.main' }}>{label}</Typography>
    <Typography component="span" sx={{ fontSize: '0.8rem', fontWeight: 700, fontFamily: 'ui-monospace, monospace', letterSpacing: '.02em', color: value ? 'text.primary' : 'text.disabled' }}>
      {value || '—'}
    </Typography>
  </Box>
);

// tel:/mailto: link styled as a plain Field value (no icon avatar).
const LinkValue = ({ text, href }) => {
  if (!text) return '—';
  if (!href) return text;
  return (
    <Typography component="a" href={href} sx={{ fontSize: 'inherit', fontWeight: 'inherit', color: 'inherit', textDecoration: 'none', '&:hover': { color: 'primary.main', textDecoration: 'underline' } }}>
      {text}
    </Typography>
  );
};

// Activity event type → semantic tone, reusing StatusChip's own tone set
// (not a new color vocabulary) so failures stand out without the whole
// timeline looking alarming.
const activityTone = (action) => {
  const a = String(action || '').toUpperCase();
  if (a.includes('FAIL')) return 'red';
  if (a.includes('CANCEL') || a.includes('REJECT')) return 'red';
  if (a.includes('APPROVE')) return 'green';
  if (a.includes('RELEASE')) return 'teal';
  if (a.includes('CREATE')) return 'blue';
  return 'neutral';
};

const PurchaseOrderDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const followUpRowNav = useRowNavigation({ to: (fu) => `/procurement/follow-ups/${fu._id}` });
  const goBack = useSmartBack('/purchase-fms/purchase-orders');
  const { enqueueSnackbar } = useSnackbar();

  const { data, isLoading } = useGetPurchaseOrderQuery(id);
  const po = data?.data;
  const [cancelPo] = useCancelPurchaseOrderMutation();
  const [generatePoPdf, { isLoading: pdfGenerating }] = useGeneratePurchaseOrderPdfMutation();
  const [createFollowUp, { isLoading: startingFollowUp }] = useCreateFollowUpMutation();

  const [formOpen, setFormOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [previewPo, setPreviewPo] = useState(null);
  const [fuFormOpen, setFuFormOpen] = useState(false);
  const [fuDoneOpen, setFuDoneOpen] = useState(false);
  const [fuActiveTarget, setFuActiveTarget] = useState(null);
  const [fuReadyOpen, setFuReadyOpen] = useState(false);

  // Step 1.5 — follow-ups linked to this PO (relevant once released or beyond).
  const fuRelevant = Boolean(data?.data) &&
    (data.data.poStatus === 'RELEASED_TO_VENDOR' || data.data.followUpStatus !== 'NOT_STARTED');
  const { data: fuRes } = useGetFollowUpsByPoQuery(id, { skip: !fuRelevant });
  const followUps = fuRes?.data || [];
  const lastFollowUp = followUps[0] || null; // sorted -createdAt by the API
  const lastDoneFollowUp = followUps.find((f) => f.followUpStatus === 'DONE') || null;
  // Ready For GRN is only offered once a DONE follow-up has a confirmed Final
  // Material Date — a pending Next Follow-up Date keeps the follow-up active.
  const readyFollowUp = followUps.find((f) => f.followUpStatus === 'DONE' && f.finalMaterialDate) || null;
  const nextFollowUpDate = followUps
    .map((f) => f.nextFollowUpDate)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0] || null;

  // Step 1.6 — proforma invoice linked to this PO.
  const [piFormOpen, setPiFormOpen] = useState(false);
  const [piApprovalOpen, setPiApprovalOpen] = useState(false);
  const [piNotReqOpen, setPiNotReqOpen] = useState(false);
  const { data: piRes } = useGetProformaInvoicesByPoQuery(id, { skip: !fuRelevant });
  const livePi = (piRes?.data || []).find((p) => p.piStatus !== 'CANCELLED') || null;
  // PI is optional: once marked Not Required, all PI / advance-payment actions are disabled.
  const isPiNotRequired = data?.data?.piStatus === 'PI_NOT_REQUIRED';
  const canCreatePi = data?.data?.poStatus === 'RELEASED_TO_VENDOR' && !livePi && !isPiNotRequired;
  const canApprovePi = !isPiNotRequired && livePi && ['DRAFT', 'RECEIVED'].includes(livePi.piStatus) && livePi.approvalStatus !== 'APPROVED';


  // Step 1.8 — goods receipt notes against this PO.
  const [grnFormOpen, setGrnFormOpen] = useState(false);
  const [grnCompleteOpen, setGrnCompleteOpen] = useState(false);
  const grnRelevant = Boolean(data?.data) &&
    ['RELEASED_TO_VENDOR', 'PARTIAL_RECEIVED', 'FULLY_RECEIVED'].includes(data.data.poStatus);
  const { data: grnRes } = useGetGrnsByPoQuery(id, { skip: !grnRelevant });
  const grns = grnRes?.data || [];
  // The GRN currently in progress for this PO (sorted -createdAt by the API) —
  // its own lifecycle (Draft → complete → QC) must resolve before a fresh
  // "Create GRN" is offered again.
  const activeGrn = grns.find((g) => g.grnStatus !== 'CANCELLED') || null;
  // GRN gate: material confirmed (READY_FOR_GRN + Final Material Date) and PI
  // settled — same list as the backend's isPiSettledForGrn (grn.service.js).
  // An approved PI is settled: its advance payment / MD approval never blocks GRN.
  const grnGateMet = data?.data?.followUpStatus === 'READY_FOR_GRN'
    && Boolean(data?.data?.finalMaterialDate)
    && ['NOT_RECEIVED', 'PI_NOT_REQUIRED', 'PI_APPROVED', 'READY_FOR_ADVANCE_PAYMENT', 'PAYMENT_COMPLETED'].includes(data?.data?.piStatus);
  // A new PO needs the full gate; one already partially received keeps receiving (back-compat).
  // Blocked while the active GRN is still a draft — it must be completed first.
  const canCreateGrn = activeGrn?.grnStatus !== 'DRAFT' && (
    data?.data?.poStatus === 'PARTIAL_RECEIVED'
    || (data?.data?.poStatus === 'RELEASED_TO_VENDOR' && grnGateMet)
  );
  const totalReceived = (po?.items || []).reduce((s, it) => s + (it.receivedQty || 0), 0);
  const totalOrdered = (po?.items || []).reduce((s, it) => s + (it.quantity || 0), 0);
  // GRN-state gate — drives the Next Action / Quick Actions once a GRN exists:
  // Draft → Complete GRN; Partial-received with pending qty → Create Next GRN;
  // Partial/Fully received with QC still pending → Open GRN & QC (QC sits on the GRN page).
  const grnGate = (() => {
    if (!activeGrn) return null;
    if (activeGrn.grnStatus === 'DRAFT') {
      return {
        tone: 'warning', text: 'A GRN has been created for this PO — complete it, then Incoming QC posts the accepted stock.',
        primary: { label: 'Complete GRN', icon: <PackageCheck size={16} />, onClick: () => setGrnCompleteOpen(true) },
      };
    }
    if (activeGrn.qcStatus !== 'PENDING') return null; // this GRN's QC is already resolved
    if (activeGrn.grnStatus === 'PARTIAL_RECEIVED' && totalOrdered > totalReceived) {
      return {
        tone: 'warning', text: 'Some items are still pending receipt — create the next GRN.',
        primary: { label: 'Create Next GRN', icon: <PackageCheck size={16} />, onClick: () => setGrnFormOpen(true) },
      };
    }
    // QC is entered on the GRN page, directly under the GRN (one combined step).
    // The GRN's MD approval is tracked separately and never holds QC back.
    return {
      tone: 'success', text: 'Goods received — run Incoming QC on the GRN page.',
      primary: { label: 'Open GRN & QC', icon: <ClipboardCheck size={16} />, onClick: () => navigate(`/procurement/grns/${activeGrn._id}#qc`) },
    };
  })();

  // PI optional: offer "Mark PI Not Required" only for a released PO with no PI
  // in progress and no GRN yet (server enforces the same rules + permission).
  const canMarkPiNotRequired = data?.data?.poStatus === 'RELEASED_TO_VENDOR'
    && data?.data?.piStatus === 'NOT_RECEIVED' && !livePi && grns.length === 0;


  if (isLoading) return <Box sx={{ display: 'grid', placeItems: 'center', height: '70vh' }}><CircularProgress /></Box>;
  if (!po) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6">Purchase Order not found</Typography>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/purchase-fms/purchase-orders')}>Back to list</Button>
      </Box>
    );
  }

  const isDraft = po.approvalStatus === 'DRAFT';
  const canRelease = po.approvalStatus === 'APPROVED' && po.releaseStatus !== 'RELEASED';
  const canCancel = !['FULLY_RECEIVED', 'CLOSED', 'CANCELLED'].includes(po.poStatus);

  // ── Delivery indicator — derived only from PO status + the currently
  // effective expected date (final commitment > revised/next > original),
  // never from follow-up notes or a new status enum. ──
  const effectiveExpectedDate = po.finalMaterialDate || nextFollowUpDate || po.expectedDeliveryDate || null;
  const deliveryStatus = (() => {
    if (po.poStatus === 'FULLY_RECEIVED') return { label: 'Fully Received', tone: 'green' };
    if (po.poStatus === 'PARTIAL_RECEIVED') return { label: 'Partially Received', tone: 'orange' };
    if (po.poStatus !== 'RELEASED_TO_VENDOR' || !effectiveExpectedDate) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const exp = new Date(effectiveExpectedDate); exp.setHours(0, 0, 0, 0);
    if (exp.getTime() === today.getTime()) return { label: 'Due Today', tone: 'amber' };
    if (exp.getTime() < today.getTime()) return { label: 'Overdue', tone: 'red' };
    return { label: 'Upcoming', tone: 'blue' };
  })();
  // Routine delivery follow-ups close once the PO is fully received — matches
  // the backend's own eligibility gate (followUpService.create), not a new rule.
  const deliveryFollowUpsClosed = po.poStatus === 'FULLY_RECEIVED';

  // ── Unified follow-up action (Issue 1 — one button, not two entry points) ──
  // - open cycle (pending/resched)        → Update Follow-up / Follow-up Again
  // - no active record, PO already has an
  //   Expected Delivery Date              → Update Follow-up (the first record
  //   is created transparently, skipping the bare "New Material Follow-up"
  //   form — the PO already carries the vendor's delivery commitment, so
  //   there's nothing that form would ask for that isn't already known)
  // - no active record AND no Expected
  //   Delivery Date (legacy PO predating
  //   the mandatory field)                → Create Follow-up (asks for a
  //   Planned Date explicitly, since there is nothing to default it from)
  // - DONE + final date but the PO mirror hasn't flipped yet (legacy edge case)
  //   → Mark Ready for GRN
  // - material confirmed                  → done (chip, no button)
  //
  // "Current" record = the one PENDING/RESCHEDULED follow-up, found by scanning
  // every record for this PO (same pattern as `readyFollowUp` above), NOT just
  // the most-recently-created one — in normal operation there is at most one
  // active record at a time (the backend now rejects creating a second), but
  // this stays correct even against stale/legacy data where that invariant
  // didn't hold.
  const activeFollowUp = followUps.find((f) => ['PENDING', 'RESCHEDULED'].includes(f.followUpStatus)) || null;

  const startOrContinueFollowUp = async () => {
    if (activeFollowUp) { setFuActiveTarget(activeFollowUp); setFuDoneOpen(true); return; }
    try {
      const res = await createFollowUp({ poId: po._id, plannedAt: po.expectedDeliveryDate }).unwrap();
      setFuActiveTarget(res?.data);
      setFuDoneOpen(true);
    } catch (err) {
      // The backend's own duplicate guard is the actual race-safety net — if
      // two clicks/tabs both land here, the loser gets this message rather
      // than a second active follow-up ever existing.
      enqueueSnackbar(err?.data?.message || 'Failed to start the follow-up', { variant: 'error' });
    }
  };

  const followUpPrimary = po.followUpStatus === 'READY_FOR_GRN'
    ? { label: 'Ready for GRN', done: true }
    : readyFollowUp
      ? { label: 'Mark Ready for GRN', icon: <PackageCheck size={14} />, onClick: () => setFuReadyOpen(true) }
      : (activeFollowUp || po.expectedDeliveryDate)
        ? {
            label: activeFollowUp?.followUpStatus === 'RESCHEDULED' ? 'Follow-up Again' : 'Update Follow-up',
            icon: startingFollowUp ? <CircularProgress size={14} color="inherit" /> : <PhoneCall size={14} />,
            onClick: startOrContinueFollowUp,
            disabled: startingFollowUp,
          }
        : { label: 'Create Follow-up', icon: <PhoneCall size={14} />, onClick: () => setFuFormOpen(true) };

  // ── Guided "Next Action" (Issue 2 — no back-and-forth between PO/PI/GRN) ──
  const nextAction = (() => {
    if (isDraft) {
      return {
        tone: 'info', text: 'Approve or reject this draft to move it forward.',
        primary: { label: 'Approve / Reject', icon: <CheckCircle2 size={16} />, onClick: () => setApprovalOpen(true) },
      };
    }
    if (canRelease) {
      return {
        tone: 'info', text: 'This PO is approved — release it to the vendor to start the delivery process.',
        primary: { label: 'Release to Supplier', icon: <Send size={16} />, onClick: () => setReleaseOpen(true) },
      };
    }
    if (po.poStatus === 'RELEASED_TO_VENDOR') {
      if (po.followUpStatus !== 'READY_FOR_GRN') {
        return {
          tone: 'warning',
          text: activeFollowUp || readyFollowUp
            ? 'Continue chasing the vendor for a confirmed delivery date.'
            : 'Start tracking the vendor delivery with a material follow-up.',
          primary: { label: followUpPrimary.label, icon: followUpPrimary.icon, onClick: followUpPrimary.onClick, disabled: followUpPrimary.disabled },
        };
      }
      // A created PI still awaiting its ordinary approval is the only PI state
      // that blocks GRN (see grnGateMet / isPiSettledForGrn). An approved PI's
      // advance payment waits for the MD on its own and never holds GRN back.
      if (livePi && canApprovePi) {
        return {
          tone: 'warning', text: 'The Proforma Invoice is waiting for approval.',
          primary: { label: 'Approve PI', icon: <CheckCircle2 size={16} />, onClick: () => setPiApprovalOpen(true) },
        };
      }
      const advancePending = livePi?.piStatus === 'READY_FOR_ADVANCE_PAYMENT';
      if (livePi && !advancePending && livePi.piStatus !== 'PAYMENT_COMPLETED') {
        return {
          tone: 'warning', text: 'The Proforma Invoice is still in progress.',
          primary: { label: 'Open PI', icon: <Eye size={16} />, onClick: () => navigate(`/procurement/proforma-invoices/${livePi._id}`) },
        };
      }
      if (grnGate) return grnGate;
      // No PI in progress (none created, explicitly skipped, or already paid)
      // — GRN can proceed. A PI remains available as an optional action, not a gate.
      if (canCreateGrn) {
        return {
          tone: 'success',
          text: livePi?.piStatus === 'PAYMENT_COMPLETED'
            ? 'Payment is complete — create the GRN to receive stock.'
            : advancePending
              ? 'Material delivery is confirmed — create the GRN to receive stock. The PI advance payment is recorded separately and does not hold the GRN.'
            : isPiNotRequired
              ? 'PI was marked Not Required — create the GRN to receive stock.'
              : 'Material delivery is confirmed — create the GRN to receive stock. A Proforma Invoice is optional and can still be added later.',
          primary: { label: 'Create GRN', icon: <PackageCheck size={16} />, onClick: () => setGrnFormOpen(true) },
          secondary: canCreatePi ? { label: 'Create PI', onClick: () => setPiFormOpen(true) }
            : advancePending ? { label: 'Open PI', onClick: () => navigate(`/procurement/proforma-invoices/${livePi._id}`) } : null,
        };
      }
      if (advancePending) {
        return {
          tone: 'warning', text: 'The PI is approved — record the advance payment to complete it.',
          primary: { label: 'Open PI', icon: <Eye size={16} />, onClick: () => navigate(`/procurement/proforma-invoices/${livePi._id}`) },
        };
      }
      if (canCreatePi) {
        return {
          tone: 'info',
          text: 'Material delivery is confirmed. A Proforma Invoice is optional — create one only if this vendor needs it.',
          primary: { label: 'Create PI', icon: <FileText size={16} />, onClick: () => setPiFormOpen(true) },
          secondary: canMarkPiNotRequired ? { label: 'Mark PI Not Required', onClick: () => setPiNotReqOpen(true) } : null,
        };
      }
      return { tone: 'info', text: 'Waiting on the next step.', primary: null };
    }
    if (po.poStatus === 'PARTIAL_RECEIVED') {
      if (grnGate) return grnGate;
      return {
        tone: 'warning', text: 'Some items are still pending receipt.',
        primary: { label: 'Create GRN', icon: <PackageCheck size={16} />, onClick: () => setGrnFormOpen(true) },
      };
    }
    if (po.poStatus === 'FULLY_RECEIVED') {
      if (grnGate) return grnGate;
      return { tone: 'success', text: 'All items have been received for this PO.', primary: null };
    }
    if (po.poStatus === 'CANCELLED') {
      return po.revisedToPoNumber
        ? { tone: 'info', text: `This PO was cancelled and revised as ${po.revisedToPoNumber}.`, primary: null }
        : {
            tone: 'error', text: 'This PO was cancelled — revise it to create a fresh draft.',
            primary: { label: 'Revise PO', icon: <RotateCcw size={16} />, onClick: () => setReviseOpen(true) },
          };
    }
    return null;
  })();

  // Why GRN is blocked, shown inline in the Goods Receipt card — backend rules
  // are unchanged, this only explains the existing `canCreateGrn` gate. Skipped
  // once an active GRN exists — `grnGate` already covers that case with its own
  // (Complete GRN / Create Next GRN / Create Incoming QC) call to action.
  const grnBlock = (po.poStatus === 'RELEASED_TO_VENDOR' && !canCreateGrn && !grnGate) ? (() => {
    if (po.followUpStatus !== 'READY_FOR_GRN') {
      return {
        text: 'GRN is blocked because material delivery has not been confirmed yet.',
        button: { label: followUpPrimary.label, onClick: followUpPrimary.onClick, disabled: followUpPrimary.disabled },
      };
    }
    if (!po.finalMaterialDate) {
      return {
        text: 'GRN is blocked because the Final Material Date is missing.',
        button: { label: 'Mark Ready for GRN', onClick: () => setFuReadyOpen(true) },
      };
    }
    return {
      text: 'GRN is blocked because the Proforma Invoice is not approved yet.',
      button: canCreatePi
        ? { label: 'Create PI', onClick: () => setPiFormOpen(true) }
        : livePi ? { label: 'Open PI', onClick: () => navigate(`/procurement/proforma-invoices/${livePi._id}`) } : null,
    };
  })() : null;

  // Quick actions jump straight to any OTHER available step without
  // scrolling — "other" meaning not already the Next Action's own primary/
  // secondary button, so the same action is never offered twice in the same
  // screen region.
  const nextActionLabels = new Set([nextAction?.primary?.label, nextAction?.secondary?.label].filter(Boolean));
  const quickActions = [
    fuRelevant && !followUpPrimary.done && { key: 'followup', label: followUpPrimary.label, icon: <PhoneCall size={13} />, onClick: followUpPrimary.onClick, disabled: followUpPrimary.disabled },
    canCreatePi && { key: 'createPi', label: 'Create PI', icon: <FileText size={13} />, onClick: () => setPiFormOpen(true) },
    livePi && { key: 'openPi', label: 'Open PI', icon: <Eye size={13} />, onClick: () => navigate(`/procurement/proforma-invoices/${livePi._id}`) },
    canMarkPiNotRequired && { key: 'markPiNotReq', label: 'Mark PI Not Required', icon: <CircleSlash size={13} />, color: 'warning', onClick: () => setPiNotReqOpen(true) },
    canCreateGrn && { key: 'createGrn', label: 'Create GRN', icon: <PackageCheck size={13} />, color: 'success', onClick: () => setGrnFormOpen(true) },
    grnGate && { key: 'grnGate', label: grnGate.primary.label, icon: grnGate.primary.icon, color: grnGate.tone === 'success' ? 'success' : 'warning', onClick: grnGate.primary.onClick },
  ].filter((a) => a && !nextActionLabels.has(a.label));

  const handleCancel = async () => {
    try { await cancelPo({ id: po._id }).unwrap(); enqueueSnackbar('PO cancelled', { variant: 'info' }); }
    catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to cancel', { variant: 'error' }); }
  };

  // A DRAFT/APPROVED (not yet released) PO has no stored poPdfUrl — release()
  // is the only place that generates one. Generate on demand here so Preview
  // works at any stage, reusing the same generatePdf() release() itself calls.
  const doPreviewPdf = async () => {
    if (po.poPdfUrl) { setPreviewPo(po); setPdfOpen(true); return; }
    try {
      const res = await generatePoPdf({ id: po._id }).unwrap();
      setPreviewPo({ ...po, poPdfUrl: res?.data?.poPdfUrl, poPdfFileName: res?.data?.poPdfFileName });
      setPdfOpen(true);
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to generate PDF', { variant: 'error' }); }
  };

  return (
    <Box sx={{ ...pfmsPageSx }}>
      {/* Hero — status + identity only; the workflow action lives in the Next
          Action banner below, not duplicated up here. */}
      <Box sx={{ mb: SECTION_GAP, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Tooltip title="Back">
          <IconButton onClick={goBack} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}`, width: 38, height: 38 }}>
            <ArrowLeft size={18} />
          </IconButton>
        </Tooltip>
        <Box sx={{ width: 38, height: 38, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main', flexShrink: 0 }}>
          <ShoppingBag size={20} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: PFMS.ink }}>{poDisplayNumber(po)}</Typography>
            <PoStatusChip status={po.poStatus} />
            <PoApprovalChip status={po.approvalStatus} />
            <PoReleaseChip status={po.releaseStatus} />
          </Box>
          <Typography variant="body2" sx={{ color: PFMS.sub }}>
            {po.vendorName} · Indent {po.indentNumber || '—'} · {fmtDate(po.poDate)}
          </Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {isDraft && <Button variant="outlined" size="small" startIcon={<Pencil size={15} />} onClick={() => setFormOpen(true)}>Edit</Button>}
          <Button variant="outlined" size="small" startIcon={pdfGenerating ? <CircularProgress size={15} /> : <FileDown size={15} />} onClick={doPreviewPdf} disabled={pdfGenerating}>
            {po.poPdfUrl ? 'PO PDF' : 'Preview PDF'}
          </Button>
          {canCancel && <Button variant="outlined" size="small" color="error" startIcon={<Ban size={15} />} onClick={handleCancel}>Cancel</Button>}
          {po.poStatus === 'CANCELLED' && (
            <Button variant="contained" size="small" startIcon={<RotateCcw size={15} />} onClick={() => setReviseOpen(true)}>Revise PO</Button>
          )}
        </Box>
      </Box>

      {/* Next Action — the one guided call-to-action (Follow-up → PI → GRN),
          shared presentation with every other Purchase FMS detail page. */}
      <NextStepBanner step={nextAction ? {
        tone: nextAction.tone === 'warning' ? 'warn' : nextAction.tone,
        title: nextAction.text,
        primary: nextAction.primary,
        secondary: nextAction.secondary,
      } : null} />

      {/* Quick actions — a single compact row, never repeating whatever the
          Next Action banner already offers. */}
      {quickActions.length > 0 && (
        <Box sx={{ mb: SECTION_GAP, mt: -1, display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: PFMS.sub, mr: 0.5 }}>Quick actions:</Typography>
          {quickActions.map((a) => (
            <Button key={a.key} size="small" variant="text" color={a.color} startIcon={a.icon} onClick={a.onClick} disabled={a.disabled}>
              {a.label}
            </Button>
          ))}
        </Box>
      )}

      {/* Revision linkage badges */}
      {(po.revisedFromPoId || po.revisedToPoNumber) && (
        <Box sx={{ mb: SECTION_GAP, display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          {po.revisedFromPoId && (
            <Chip icon={<GitBranch size={14} />} variant="outlined" color="primary"
              label={`Revised from ${po.revisedFromPoNumber || 'previous PO'}${po.revisionNo ? ` · revision ${po.revisionNo}` : ''}`}
              onClick={po.revisedFromPoId ? () => navigate(`/procurement/purchase-orders/${po.revisedFromPoId}`) : undefined}
              sx={{ fontWeight: 700 }} />
          )}
          {po.revisedToPoNumber && (
            <Chip icon={<RotateCcw size={14} />} variant="outlined" color="success"
              label={`Revised as ${po.revisedToPoNumber}`}
              onClick={po.revisedToPoId ? () => navigate(`/procurement/purchase-orders/${po.revisedToPoId}`) : undefined}
              sx={{ fontWeight: 700 }} />
          )}
        </Box>
      )}

      <FmsDoerCard entityType="PO" entityId={id} />

      {/* Every remaining section is a full-width card in one vertical stack
          — see the comment on SectionCard for why. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: SECTION_GAP }}>
        <SectionCard icon={<Building2 size={18} />} title="Vendor / Supplier">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Typography sx={{ fontSize: '1.05rem', fontWeight: 800, lineHeight: 1.25, color: PFMS.ink }}>
                {po.vendorName || '—'}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                <TaxBadge label="GST" value={po.vendorGST} />
                <TaxBadge label="PAN" value={po.vendorPAN} />
              </Box>
            </Box>
            <FieldGrid>
              <Field label="Address" value={po.vendorAddress} />
              <Field label="Phone" value={<LinkValue text={po.vendorPhone} href={po.vendorPhone ? `tel:${po.vendorPhone}` : undefined} />} />
              <Field label="Email" value={<LinkValue text={po.vendorEmail} href={po.vendorEmail ? `mailto:${po.vendorEmail}` : undefined} />} />
            </FieldGrid>
          </Box>
        </SectionCard>

        <SectionCard icon={<Truck size={18} />} title="Terms & Release">
          <FieldGrid>
            <Field label="Delivery Terms" value={po.deliveryTerms} />
            <Field label="Payment Terms" value={po.paymentTerms} />
            <Field label="Lead Time" value={po.leadTime} />
            <Field label="Credit Period" value={po.creditPeriod ? `${po.creditPeriod} days` : null} />
            <Field label="Released By" value={po.releasedBy} />
            <Field label="Released At" value={po.releasedAt ? fmtDate(po.releasedAt) : null} />
          </FieldGrid>
          {po.supplierEmailSent ? (
            <Box sx={{ mt: 2 }}>
              <StatusChip tone="blue" label={`Supplier email sent · ${fmtDate(po.supplierEmailSentAt)}`} />
            </Box>
          ) : null}
        </SectionCard>

        {/* Step 1.5 — Vendor Delivery Follow-ups (only meaningful for released POs).
            This replaces the former standalone "Material Follow-ups" hub step —
            PO detail is now the primary place to record and review them. */}
        {(po.poStatus === 'RELEASED_TO_VENDOR' || po.followUpStatus !== 'NOT_STARTED') && (
          <SectionCard
            icon={<PhoneCall size={18} />}
            title="Vendor Delivery Follow-ups"
            action={(
              <>
                {deliveryStatus && <StatusChip tone={deliveryStatus.tone} label={deliveryStatus.label} />}
                {/* One primary follow-up action — label/target adapts to the current cycle. */}
                {deliveryFollowUpsClosed ? (
                  <StatusChip tone="neutral" label="Follow-ups closed — fully received" />
                ) : followUpPrimary.done ? (
                  <StatusChip tone="green" label="Ready for GRN" />
                ) : (
                  <Button size="small" variant="contained" startIcon={followUpPrimary.icon} onClick={followUpPrimary.onClick} disabled={followUpPrimary.disabled}>
                    {followUpPrimary.label}
                  </Button>
                )}
                <Button size="small" variant="outlined" startIcon={<Eye size={14} />} onClick={() => navigate('/procurement/follow-ups')}>
                  All Follow-ups
                </Button>
              </>
            )}
          >
            <FieldGrid sx={{ mb: followUps.length ? 2 : 0 }}>
              <Field label="Follow-up Status" value={<PoFollowUpChip status={po.followUpStatus} />} />
              <Field label="Original Expected" value={fmtFuDate(po.expectedDeliveryDate)} />
              <Field label="Revised / Next Expected" value={nextFollowUpDate ? fmtFuDate(nextFollowUpDate) : 'Not revised'} />
              <Field label="Final Committed" value={po.finalMaterialDate ? fmtFuDate(po.finalMaterialDate) : 'Not committed yet'} />
              <Field label="Last Follow-up" value={lastFollowUp
                ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}><FuStatusChip status={lastFollowUp.followUpStatus} /><Typography variant="caption" color="text.secondary">{fmtFuDate(lastFollowUp.actualAt || lastFollowUp.plannedAt)}</Typography></Box>
                : null} />
              <Field label="Next Scheduled" value={activeFollowUp?.plannedAt ? fmtFuDate(activeFollowUp.plannedAt) : null} />
            </FieldGrid>

            {/* Full delivery commitment history — every follow-up cycle recorded
                against this PO, newest first (already sorted -createdAt by the API). */}
            {followUps.length > 0 && (
              <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '10px' }}>
                <Table size="small" sx={rowNavigationTableSx}>
                  <TableHead>
                    <TableRow>
                      {['Follow-up No', 'Type', 'Status', 'Planned', 'Actual', 'Next / Final Date', 'Remarks', 'By'].map((h) => (
                        <TableCell key={h} sx={pfmsTableHeadSx}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {followUps.map((fu) => (
                      <TableRow key={fu._id} hover {...followUpRowNav.getTableRowProps(fu)}>
                        <TableCell><Typography variant="body2" fontWeight={700} color="primary.main">{fu.followUpNumber}</Typography></TableCell>
                        <TableCell><FuTypeChip type={fu.followUpType} /></TableCell>
                        <TableCell><FuStatusChip status={fu.followUpStatus} /></TableCell>
                        <TableCell>{fmtFuDate(fu.plannedAt)}</TableCell>
                        <TableCell>{fmtFuDate(fu.actualAt)}</TableCell>
                        <TableCell>
                          {fu.finalMaterialDate
                            ? <Typography variant="body2" sx={{ color: '#15803d', fontWeight: 600 }}>Final: {fmtFuDate(fu.finalMaterialDate)}</Typography>
                            : fu.nextFollowUpDate
                              ? <Typography variant="body2" sx={{ color: '#b45309' }}>Next: {fmtFuDate(fu.nextFollowUpDate)}</Typography>
                              : '—'}
                        </TableCell>
                        <TableCell><Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 180 }}>{fu.remarks || '—'}</Typography></TableCell>
                        <TableCell><Typography variant="body2" color="text.secondary" noWrap>{fu.performedByName || '—'}</Typography></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </SectionCard>
        )}

        {/* Step 1.6 — Proforma Invoice */}
        {(po.poStatus === 'RELEASED_TO_VENDOR' || po.piStatus !== 'NOT_RECEIVED') && (
          <SectionCard
            icon={<FileText size={18} />}
            title="Proforma Invoice"
            action={(
              <>
                {canCreatePi && (
                  <Button size="small" variant="contained" startIcon={<FileText size={14} />} onClick={() => setPiFormOpen(true)}>Create PI</Button>
                )}
                {livePi && (
                  <Button size="small" variant="outlined" startIcon={<Eye size={14} />} onClick={() => navigate(`/procurement/proforma-invoices/${livePi._id}`)}>View PI</Button>
                )}
                {canApprovePi && (
                  <Button size="small" variant="outlined" color="success" startIcon={<CheckCircle2 size={14} />} onClick={() => setPiApprovalOpen(true)}>Approve PI</Button>
                )}
                {canMarkPiNotRequired && (
                  <Button size="small" variant="outlined" color="warning" startIcon={<CircleSlash size={14} />} onClick={() => setPiNotReqOpen(true)}>Mark PI Not Required</Button>
                )}
              </>
            )}
          >
            {isPiNotRequired ? (
              <FieldGrid>
                <Field label="PI Status" value={<PoPiChip status={po.piStatus} />} />
                <Field label="Reason" value={po.piNotRequiredReason} />
                <Field label="Remarks" value={po.piNotRequiredRemarks} />
                <Field label="Marked By" value={po.piNotRequiredByName} />
                <Field label="Marked Date" value={fmtDate(po.piNotRequiredAt)} />
              </FieldGrid>
            ) : (
              <FieldGrid>
                <Field label="PI Status" value={<PoPiChip status={po.piStatus} />} />
                <Field label="PI Number" value={po.piNumber || livePi?.piNumber} />
                <Field label="PI Date" value={fmtFuDate(livePi?.piDate || po.piReceivedAt)} />
                <Field label="Paid Amount" value={livePi ? fmtPiINR(livePi.paidAmount) : null} />
                <Field label="Balance Amount" value={livePi ? fmtPiINR(livePi.balanceAmount) : null} />
              </FieldGrid>
            )}
          </SectionCard>
        )}

        {/* Step 1.8 — Goods Receipt Notes */}
        {grnRelevant && (
          <SectionCard
            icon={<PackageCheck size={18} />}
            title={`Goods Receipt (${grns.length})`}
            action={(
              <>
                {canCreateGrn && (
                  <Button size="small" variant="contained" startIcon={<PackageCheck size={14} />} onClick={() => setGrnFormOpen(true)}>Create GRN</Button>
                )}
                {grnGate && (
                  <Button size="small" variant="contained" color={grnGate.tone === 'success' ? 'success' : 'warning'} startIcon={grnGate.primary.icon} onClick={grnGate.primary.onClick}>
                    {grnGate.primary.label}
                  </Button>
                )}
                <Button size="small" variant="outlined" startIcon={<Eye size={14} />} onClick={() => navigate('/purchase-fms/grn')}>View GRNs</Button>
              </>
            )}
          >
            {grnBlock && (
              <Box sx={{
                mb: 2, p: 1.5, borderRadius: '10px', bgcolor: alpha('#dc2626', 0.06),
                border: '1px solid', borderColor: alpha('#dc2626', 0.2),
                display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
              }}>
                <AlertTriangle size={16} color="#dc2626" />
                <Typography variant="body2" sx={{ fontWeight: 600, color: '#991b1b', flexGrow: 1 }}>{grnBlock.text}</Typography>
                {grnBlock.button && (
                  <Button size="small" variant="contained" color="error" onClick={grnBlock.button.onClick} disabled={grnBlock.button.disabled}>{grnBlock.button.label}</Button>
                )}
              </Box>
            )}
            <FieldGrid>
              <Field label="Receipt Status" value={<PoStatusChip status={po.poStatus} />} />
              <Field label="Ordered Qty" value={totalOrdered} />
              <Field label="Received Qty" value={totalReceived} />
              <Field label="Pending Qty" value={Math.max(0, totalOrdered - totalReceived)} />
            </FieldGrid>
            {grns.length > 0 && (
              <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {grns.map((g) => (
                  <Box key={g._id} onClick={() => navigate(`/procurement/grns/${g._id}`)}
                    sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, borderRadius: '10px', border: '1px solid', borderColor: 'divider', '&:hover': { borderColor: 'primary.main' } }}>
                    <Typography variant="body2" fontWeight={700} color="primary.main">{g.grnNumber}</Typography>
                    <Typography variant="caption" color="text.secondary">qty {g.totalReceivedQty}</Typography>
                    <GrnStatusChip status={g.grnStatus} />
                  </Box>
                ))}
              </Box>
            )}
          </SectionCard>
        )}

        {/* Items + financial summary */}
        <SectionCard icon={<FileText size={18} />} title={`Items (${po.items?.length || 0})`}>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {['#', 'Item Ref', 'Item', 'SKU'].map((h) => <TableCell key={h} sx={pfmsTableHeadSx}>{h}</TableCell>)}
                  <TableCell align="right" sx={pfmsTableHeadSx}>Qty</TableCell>
                  <TableCell sx={pfmsTableHeadSx}>Unit</TableCell>
                  <TableCell align="right" sx={pfmsTableHeadSx}>Rate</TableCell>
                  <TableCell align="right" sx={pfmsTableHeadSx}>Taxable</TableCell>
                  <TableCell align="center" sx={pfmsTableHeadSx}>GST %</TableCell>
                  <TableCell align="right" sx={pfmsTableHeadSx}>Tax</TableCell>
                  <TableCell align="right" sx={pfmsTableHeadSx}>Total</TableCell>
                  <TableCell align="right" sx={pfmsTableHeadSx}>Received</TableCell>
                  <TableCell align="right" sx={pfmsTableHeadSx}>Pending</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(po.items || []).map((it, i) => (
                  <TableRow key={it._id || i} hover>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell>
                      <Typography variant="body2" color="primary.main" fontWeight={700}>
                        {it.indentItemDisplayNumber || it.indentNumber || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{it.itemName}</TableCell>
                    <TableCell><Typography variant="body2" color="primary.main" fontWeight={700}>{it.skuCode || '—'}</Typography></TableCell>
                    <TableCell align="right">{it.quantity}</TableCell>
                    <TableCell>{it.unit}</TableCell>
                    <TableCell align="right">{Number(it.rate || 0).toFixed(2)}</TableCell>
                    <TableCell align="right">{Number(it.taxableAmount || 0).toFixed(2)}</TableCell>
                    <TableCell align="center">{it.gstRate || 0}%</TableCell>
                    <TableCell align="right">{Number(it.taxAmount || 0).toFixed(2)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{Number(it.totalAmount || 0).toFixed(2)}</TableCell>
                    <TableCell align="right" sx={{ color: '#0f766e' }}>{it.receivedQty || 0}</TableCell>
                    <TableCell align="right" sx={{ color: it.pendingQty > 0 ? '#b45309' : '#0f766e' }}>{it.pendingQty || 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>TOTAL TAXABLE VALUE</Typography>
              <Typography fontWeight={700}>{fmtINR(po.totalTaxableValue)}</Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>GST</Typography>
              <Typography fontWeight={700}>{fmtINR(po.totalGSTAmount)}</Typography>
            </Box>
            <Box sx={{ textAlign: 'right', px: 2, py: 1, borderRadius: '10px', bgcolor: alpha('#2563eb', 0.06) }}>
              <Typography variant="caption" color="primary.main" fontWeight={700}>GRAND TOTAL</Typography>
              <Typography variant="h6" fontWeight={800} color="primary.dark">{fmtINR(po.grandTotal)}</Typography>
            </Box>
          </Box>
        </SectionCard>

        <SectionCard icon={<CheckCircle2 size={18} />} title="Approval">
          <FieldGrid>
            <Field label="Status" value={<PoApprovalChip status={po.approvalStatus} />} />
            <Field label="Decided By" value={po.approval?.decidedBy} />
            <Field label="Decided At" value={fmtDate(po.approval?.decidedAt)} />
            {po.approval?.remarks ? <Field label="Remarks" value={po.approval.remarks} /> : null}
          </FieldGrid>
        </SectionCard>

        {po.remarks ? (
          <SectionCard icon={<FileText size={18} />} title="Remarks">
            <Typography variant="body2" sx={{ color: PFMS.ink }}>{po.remarks}</Typography>
          </SectionCard>
        ) : null}

        {/* Activity */}
        {po.activityTimeline?.length ? (
          <SectionCard icon={<ShoppingBag size={18} />} title="Activity">
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {[...po.activityTimeline].reverse().map((ev, i, arr) => (
                <Box key={i} sx={{
                  display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' },
                  gap: { xs: 0.5, sm: 1.5 }, py: 1, borderBottom: i === arr.length - 1 ? 'none' : `1px solid ${PFMS.lineSoft}`,
                }}>
                  <Box sx={{ flexShrink: 0, minWidth: 108 }}><StatusChip tone={activityTone(ev.action)} label={ev.action.replace(/_/g, ' ')} /></Box>
                  <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>{ev.description}</Typography>
                  <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>{fmtDate(ev.timestamp)}</Typography>
                </Box>
              ))}
            </Box>
          </SectionCard>
        ) : null}
      </Box>

      {/* Drawer + dialogs */}
      <PurchaseOrderFormDrawer open={formOpen} po={po} onClose={() => setFormOpen(false)} />
      <PurchaseOrderFormDrawer open={reviseOpen} reviseFrom={po}
        onClose={(created) => { setReviseOpen(false); if (created) navigate('/purchase-fms/purchase-orders'); }} />
      <PurchaseOrderApprovalDialog open={approvalOpen} po={po} onClose={() => setApprovalOpen(false)} />
      <PurchaseOrderReleaseDialog open={releaseOpen} po={po} onClose={() => setReleaseOpen(false)} />
      <PurchaseOrderPdfPreview open={pdfOpen} po={previewPo || po} onClose={() => { setPdfOpen(false); setPreviewPo(null); }} />
      <FollowUpFormDrawer open={fuFormOpen} presetPo={po} onClose={() => setFuFormOpen(false)} />
      <FollowUpDoneDialog open={fuDoneOpen} followUp={fuActiveTarget}
        onClose={() => { setFuDoneOpen(false); setFuActiveTarget(null); }} />
      <FollowUpReadyForGrnDialog open={fuReadyOpen} followUp={readyFollowUp || lastDoneFollowUp} onClose={() => setFuReadyOpen(false)} />
      <ProformaInvoiceFormDrawer open={piFormOpen} presetPo={po} onClose={() => setPiFormOpen(false)} />
      <ProformaInvoiceApprovalDialog open={piApprovalOpen} pi={livePi} onClose={() => setPiApprovalOpen(false)} />
      <PurchaseOrderPiNotRequiredDialog open={piNotReqOpen} po={po} onClose={() => setPiNotReqOpen(false)} />

      <GrnFormDialog open={grnFormOpen} presetPo={po} onClose={() => setGrnFormOpen(false)} />
      <GrnCompleteDialog open={grnCompleteOpen} grn={activeGrn} onClose={() => setGrnCompleteOpen(false)} />

    </Box>
  );
};

export default PurchaseOrderDetail;
