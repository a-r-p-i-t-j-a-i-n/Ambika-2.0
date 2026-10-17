import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import {
  Box, Typography, Paper, Grid, Button, IconButton, CircularProgress, Chip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer, Divider,
} from '@mui/material';
import {
  ArrowLeft, Pencil, CheckCircle2, Send, FileDown, Ban, ShoppingBag,
  Building2, FileText, Truck, Mail, PhoneCall, PackageCheck, Eye, CircleSlash,
  MapPin, Wallet, Clock, CalendarClock, User, RotateCcw, GitBranch,
  Compass, AlertTriangle, ClipboardCheck,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useSnackbar } from 'notistack';
import {
  useGetPurchaseOrderQuery,
  useCancelPurchaseOrderMutation,
  useGetFollowUpsByPoQuery,
  useGetProformaInvoicesByPoQuery,

  useGetGrnsByPoQuery,
  useGeneratePurchaseOrderPdfMutation,

} from '../../../store/api/procurementApi';
import { PoStatusChip, PoApprovalChip, PoReleaseChip, fmtINR, fmtDate, poDisplayNumber } from './poMeta';
import { PFMS, pfmsPageSx, pfmsCardSx } from '../pfmsTheme';
import PurchaseOrderFormDrawer from './PurchaseOrderFormDrawer';
import PurchaseOrderApprovalDialog from './PurchaseOrderApprovalDialog';
import PurchaseOrderReleaseDialog from './PurchaseOrderReleaseDialog';
import PurchaseOrderPdfPreview from './PurchaseOrderPdfPreview';
import { PoFollowUpChip, FuStatusChip, fmtDate as fmtFuDate } from '../follow-ups/fuMeta';
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


const TONE_COLOR = { info: '#2563eb', warning: '#b45309', success: '#16a34a', error: '#dc2626' };

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary', mb: 0.25 }}>{label}</Typography>
    {/* overflowWrap:anywhere lets long unbroken tokens (GST/PAN/emails) wrap inside their column */}
    {/* div, not p: some values are chips (block elements), which may not sit inside a <p> */}
    <Typography component="div" sx={{ fontWeight: 600, color: 'text.primary', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);

const SectionCard = ({ icon, title, children }) => (
  <Paper sx={{ ...pfmsCardSx, p: 3, height: '100%' }}>
    <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2.5, fontWeight: 700, color: 'primary.main' }}>
      <Box component="span" sx={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: '9px', bgcolor: (t) => alpha(t.palette.primary.main, 0.08) }}>{icon}</Box>
      {title}
    </Typography>
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

// Icon-led contact row; becomes a tel:/mailto: link when href is provided.
const ContactRow = ({ icon, text, href }) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
    <Box sx={{ flexShrink: 0, mt: 0.25, display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: '9px', bgcolor: (t) => alpha(t.palette.primary.main, 0.06), color: 'primary.main' }}>{icon}</Box>
    {href && text ? (
      <Typography component="a" href={href} sx={{ fontWeight: 600, color: 'text.primary', textDecoration: 'none', overflowWrap: 'anywhere', '&:hover': { color: 'primary.main', textDecoration: 'underline' } }}>{text}</Typography>
    ) : (
      <Typography sx={{ fontWeight: 600, color: text ? 'text.primary' : 'text.disabled', overflowWrap: 'anywhere' }}>{text || '—'}</Typography>
    )}
  </Box>
);

// Icon-led label/value pair for terms & release fields.
const TermItem = ({ icon, label, value, accent }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
    <Box sx={{ flexShrink: 0, display: 'grid', placeItems: 'center', width: 34, height: 34, borderRadius: '10px', bgcolor: (t) => alpha(t.palette.primary.main, 0.06), color: 'primary.main' }}>{icon}</Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.64rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'text.secondary' }}>{label}</Typography>
      <Typography sx={{ fontWeight: 700, color: value ? (accent ? 'primary.main' : 'text.primary') : 'text.disabled', overflowWrap: 'anywhere' }}>{value || '—'}</Typography>
    </Box>
  </Box>
);

const PurchaseOrderDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack('/purchase-fms/purchase-orders');
  const { enqueueSnackbar } = useSnackbar();

  const { data, isLoading } = useGetPurchaseOrderQuery(id);
  const po = data?.data;
  const [cancelPo] = useCancelPurchaseOrderMutation();
  const [generatePoPdf, { isLoading: pdfGenerating }] = useGeneratePurchaseOrderPdfMutation();

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
  // GRN gate: material confirmed (READY_FOR_GRN + Final Material Date) and PI settled.
  const grnGateMet = data?.data?.followUpStatus === 'READY_FOR_GRN'
    && Boolean(data?.data?.finalMaterialDate)
    && ['PAYMENT_COMPLETED', 'PI_NOT_REQUIRED'].includes(data?.data?.piStatus);
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
        tone: 'warning', text: 'A GRN has been created for this PO — complete it to post stock and update inventory.',
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
    // MD Digital Approval gate: Incoming QC cannot start until this GRN is
    // signed — the sign action itself lives on GRN Detail's MD Approval card.
    if (activeGrn.approvalStatus !== 'MD_APPROVED') {
      return {
        tone: 'warning', text: 'Goods received — awaiting MD Approval before Incoming QC can start.',
        primary: { label: 'View GRN', icon: <Eye size={16} />, onClick: () => navigate(`/procurement/grns/${activeGrn._id}`) },
      };
    }
    // QC is entered on the GRN page, directly under the GRN (one combined step).
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

  // ── Unified follow-up action (Issue 1 — one button, not two entry points) ──
  // - no follow-up yet              → Create Follow-up
  // - open cycle (pending/resched)  → Update Follow-up / Follow-up Again
  // - DONE + final date but the PO mirror hasn't flipped yet (legacy edge case)
  //   → Mark Ready for GRN
  // - material confirmed            → done (chip, no button)
  const activeFollowUp = lastFollowUp && ['PENDING', 'RESCHEDULED'].includes(lastFollowUp.followUpStatus) ? lastFollowUp : null;
  const followUpPrimary = po.followUpStatus === 'READY_FOR_GRN'
    ? { label: 'Ready for GRN', done: true }
    : readyFollowUp
      ? { label: 'Mark Ready for GRN', icon: <PackageCheck size={14} />, onClick: () => setFuReadyOpen(true) }
      : activeFollowUp
        ? {
            label: activeFollowUp.followUpStatus === 'RESCHEDULED' ? 'Follow-up Again' : 'Update Follow-up',
            icon: <PhoneCall size={14} />,
            onClick: () => { setFuActiveTarget(activeFollowUp); setFuDoneOpen(true); },
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
          primary: { label: followUpPrimary.label, icon: followUpPrimary.icon, onClick: followUpPrimary.onClick },
        };
      }
      if (canCreatePi) {
        return {
          tone: 'warning', text: 'Material delivery is confirmed — complete the Proforma Invoice before creating a GRN.',
          primary: { label: 'Create PI', icon: <FileText size={16} />, onClick: () => setPiFormOpen(true) },
          secondary: canMarkPiNotRequired ? { label: 'Mark PI Not Required', onClick: () => setPiNotReqOpen(true) } : null,
        };
      }
      if (livePi && canApprovePi) {
        return {
          tone: 'warning', text: 'The Proforma Invoice is waiting for approval.',
          primary: { label: 'Approve PI', icon: <CheckCircle2 size={16} />, onClick: () => setPiApprovalOpen(true) },
        };
      }
      if (livePi && livePi.piStatus === 'READY_FOR_ADVANCE_PAYMENT') {
        return {
          tone: 'warning', text: 'The PI is approved — record the advance payment to complete it.',
          primary: { label: 'Open PI', icon: <Eye size={16} />, onClick: () => navigate(`/procurement/proforma-invoices/${livePi._id}`) },
        };
      }
      if (livePi && livePi.piStatus !== 'PAYMENT_COMPLETED') {
        return {
          tone: 'warning', text: 'The Proforma Invoice is still in progress.',
          primary: { label: 'Open PI', icon: <Eye size={16} />, onClick: () => navigate(`/procurement/proforma-invoices/${livePi._id}`) },
        };
      }
      if (grnGate) return grnGate;
      if (canCreateGrn) {
        return {
          tone: 'success',
          text: isPiNotRequired ? 'PI was marked Not Required — create the GRN to receive stock.' : 'Payment is complete — create the GRN to receive stock.',
          primary: { label: 'Create GRN', icon: <PackageCheck size={16} />, onClick: () => setGrnFormOpen(true) },
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
        button: { label: followUpPrimary.label, onClick: followUpPrimary.onClick },
      };
    }
    if (!po.finalMaterialDate) {
      return {
        text: 'GRN is blocked because the Final Material Date is missing.',
        button: { label: 'Mark Ready for GRN', onClick: () => setFuReadyOpen(true) },
      };
    }
    return {
      text: 'GRN is blocked because PI is not completed.',
      button: canCreatePi
        ? { label: 'Create PI', onClick: () => setPiFormOpen(true) }
        : livePi ? { label: 'Open PI', onClick: () => navigate(`/procurement/proforma-invoices/${livePi._id}`) } : null,
    };
  })() : null;

  const hasQuickActions = (fuRelevant && !followUpPrimary.done) || canCreatePi || livePi || canMarkPiNotRequired || canCreateGrn || Boolean(grnGate);

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
    <Box sx={{ ...pfmsPageSx, p: { xs: 1.5, md: 2.5 } }}>
      {/* Hero */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={goBack} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}` }}>
          <ArrowLeft size={20} />
        </IconButton>
        <Box sx={{ width: 46, height: 46, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main' }}>
          <ShoppingBag size={24} />
        </Box>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: PFMS.ink }}>{poDisplayNumber(po)}</Typography>
            <PoStatusChip status={po.poStatus} />
            <PoApprovalChip status={po.approvalStatus} />
            <PoReleaseChip status={po.releaseStatus} />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {po.vendorName} · Indent {po.indentNumber || '—'} · {fmtDate(po.poDate)}
          </Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {isDraft && <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setFormOpen(true)}>Edit</Button>}
          {isDraft && <Button variant="contained" color="success" startIcon={<CheckCircle2 size={16} />} onClick={() => setApprovalOpen(true)}>Approve / Reject</Button>}
          {canRelease && <Button variant="contained" startIcon={<Send size={16} />} onClick={() => setReleaseOpen(true)}>Release to Supplier</Button>}
          <Button variant="outlined" startIcon={pdfGenerating ? <CircularProgress size={16} /> : <FileDown size={16} />} onClick={doPreviewPdf} disabled={pdfGenerating}>{po.poPdfUrl ? 'PO PDF' : 'Preview PDF'}</Button>
          {canCancel && <Button variant="outlined" color="error" startIcon={<Ban size={16} />} onClick={handleCancel}>Cancel</Button>}
          {po.poStatus === 'CANCELLED' && (
            <Button variant="contained" startIcon={<RotateCcw size={16} />} onClick={() => setReviseOpen(true)}>Revise PO</Button>
          )}
        </Box>
      </Box>

      {/* Next Action — guides the user through Follow-up → PI → GRN without
          back-and-forth navigation (backend gating rules are unchanged). */}
      {nextAction && (
        <Paper sx={{
          mb: 3, p: 2.5, borderRadius: '8px', border: '1px solid',
          borderColor: alpha(TONE_COLOR[nextAction.tone], 0.3),
          bgcolor: alpha(TONE_COLOR[nextAction.tone], 0.05),
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, flexGrow: 1 }}>
              <Box sx={{
                flexShrink: 0, width: 36, height: 36, borderRadius: '10px', display: 'grid', placeItems: 'center',
                bgcolor: alpha(TONE_COLOR[nextAction.tone], 0.15), color: TONE_COLOR[nextAction.tone],
              }}>
                <Compass size={18} />
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: TONE_COLOR[nextAction.tone] }}>
                  Next Action
                </Typography>
                <Typography sx={{ fontWeight: 600 }}>{nextAction.text}</Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {nextAction.secondary && (
                <Button size="small" variant="outlined" color="warning" onClick={nextAction.secondary.onClick}>{nextAction.secondary.label}</Button>
              )}
              {nextAction.primary && (
                <Button variant="contained" size="small" startIcon={nextAction.primary.icon} onClick={nextAction.primary.onClick}
                  sx={{ bgcolor: TONE_COLOR[nextAction.tone], '&:hover': { bgcolor: TONE_COLOR[nextAction.tone] } }}>
                  {nextAction.primary.label}
                </Button>
              )}
            </Box>
          </Box>

          {/* Quick actions — jump straight to any available step without scrolling */}
          {hasQuickActions && (
            <Box sx={{ mt: 2, pt: 2, borderTop: '1px dashed', borderColor: 'divider', display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', mr: 0.5 }}>Quick actions:</Typography>
              {fuRelevant && !followUpPrimary.done && (
                <Button size="small" variant="text" startIcon={<PhoneCall size={13} />} onClick={followUpPrimary.onClick}>
                  {followUpPrimary.label}
                </Button>
              )}
              {canCreatePi && (
                <Button size="small" variant="text" startIcon={<FileText size={13} />} onClick={() => setPiFormOpen(true)}>Create PI</Button>
              )}
              {livePi && (
                <Button size="small" variant="text" startIcon={<Eye size={13} />}
                  onClick={() => navigate(`/procurement/proforma-invoices/${livePi._id}`)}>Open PI</Button>
              )}
              {canMarkPiNotRequired && (
                <Button size="small" variant="text" color="warning" startIcon={<CircleSlash size={13} />} onClick={() => setPiNotReqOpen(true)}>
                  Mark PI Not Required
                </Button>
              )}
              {canCreateGrn && (
                <Button size="small" variant="text" color="success" startIcon={<PackageCheck size={13} />} onClick={() => setGrnFormOpen(true)}>
                  Create GRN
                </Button>
              )}
              {grnGate && (
                <Button size="small" variant="text" color={grnGate.tone === 'success' ? 'success' : 'warning'}
                  startIcon={grnGate.primary.icon} onClick={grnGate.primary.onClick}>
                  {grnGate.primary.label}
                </Button>
              )}
            </Box>
          )}
        </Paper>
      )}

      {/* Revision linkage badges */}
      {(po.revisedFromPoId || po.revisedToPoNumber) && (
        <Box sx={{ mb: 3, display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
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
      <Grid container spacing={3}>
        {/* Vendor */}
        <Grid item xs={12} md={6}>
          <SectionCard icon={<Building2 size={17} />} title="Vendor / Supplier">
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Name + tax identifiers */}
              <Box>
                <Typography sx={{ fontSize: '1.2rem', fontWeight: 800, lineHeight: 1.25, color: 'text.primary' }}>
                  {po.vendorName || '—'}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.25 }}>
                  <TaxBadge label="GST" value={po.vendorGST} />
                  <TaxBadge label="PAN" value={po.vendorPAN} />
                </Box>
              </Box>
              <Divider sx={{ borderStyle: 'dashed' }} />
              {/* Contact details */}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <ContactRow icon={<MapPin size={15} />} text={po.vendorAddress} />
                <ContactRow icon={<PhoneCall size={15} />} text={po.vendorPhone} href={po.vendorPhone ? `tel:${po.vendorPhone}` : undefined} />
                <ContactRow icon={<Mail size={15} />} text={po.vendorEmail} href={po.vendorEmail ? `mailto:${po.vendorEmail}` : undefined} />
              </Box>
            </Box>
          </SectionCard>
        </Grid>

        {/* Terms + release */}
        <Grid item xs={12} md={6}>
          <SectionCard icon={<Truck size={17} />} title="Terms & Release">
            <Grid container spacing={2.5}>
              <Grid item xs={12} sm={6}><TermItem icon={<Truck size={15} />} label="Delivery Terms" value={po.deliveryTerms} /></Grid>
              <Grid item xs={12} sm={6}><TermItem icon={<Wallet size={15} />} label="Payment Terms" value={po.paymentTerms} accent /></Grid>
              <Grid item xs={12} sm={6}><TermItem icon={<Clock size={15} />} label="Lead Time" value={po.leadTime} /></Grid>
              <Grid item xs={12} sm={6}><TermItem icon={<CalendarClock size={15} />} label="Credit Period" value={po.creditPeriod ? `${po.creditPeriod} days` : ''} accent /></Grid>
              <Grid item xs={12} sm={6}><TermItem icon={<User size={15} />} label="Released By" value={po.releasedBy} /></Grid>
              <Grid item xs={12} sm={6}><TermItem icon={<CheckCircle2 size={15} />} label="Released At" value={po.releasedAt ? fmtDate(po.releasedAt) : ''} /></Grid>
              {po.supplierEmailSent ? (
                <Grid item xs={12}>
                  <Chip size="small" icon={<Mail size={13} />} color="info"
                    label={`Supplier email sent · ${fmtDate(po.supplierEmailSentAt)}`} sx={{ fontWeight: 700 }} />
                </Grid>
              ) : null}
            </Grid>
          </SectionCard>
        </Grid>

        {/* Step 1.5 — Material Follow-up (only meaningful for released POs) */}
        {(po.poStatus === 'RELEASED_TO_VENDOR' || po.followUpStatus !== 'NOT_STARTED') && (
          <Grid item xs={12}>
            <Paper sx={{ ...pfmsCardSx, p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, color: 'primary.main' }}>
                  <PhoneCall size={18} /> Material Follow-up
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {/* One primary follow-up action — label/target adapts to the current cycle. */}
                  {followUpPrimary.done ? (
                    <Chip size="small" color="success" icon={<CheckCircle2 size={14} />} label="Ready for GRN" sx={{ fontWeight: 700 }} />
                  ) : (
                    <Button size="small" variant="contained" startIcon={followUpPrimary.icon} onClick={followUpPrimary.onClick}>
                      {followUpPrimary.label}
                    </Button>
                  )}
                  <Button size="small" variant="outlined" startIcon={<Eye size={14} />}
                    onClick={() => navigate('/purchase-fms/material-follow-ups')}>
                    View Follow-ups
                  </Button>
                </Box>
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={2.4}><Field label="Follow-up Status" value={<PoFollowUpChip status={po.followUpStatus} />} /></Grid>
                <Grid item xs={6} sm={2.4}><Field label="Expected Delivery" value={fmtFuDate(po.expectedDeliveryDate)} /></Grid>
                <Grid item xs={6} sm={2.4}><Field label="Ready For GRN" value={fmtFuDate(po.readyForGrnAt)} /></Grid>
                <Grid item xs={6} sm={2.4}>
                  <Field label="Last Follow-up" value={lastFollowUp
                    ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}><FuStatusChip status={lastFollowUp.followUpStatus} /><Typography variant="caption" color="text.secondary">{fmtFuDate(lastFollowUp.actualAt || lastFollowUp.plannedAt)}</Typography></Box>
                    : '—'} />
                </Grid>
                <Grid item xs={6} sm={2.4}><Field label="Next Follow-up" value={fmtFuDate(nextFollowUpDate)} /></Grid>
              </Grid>
            </Paper>
          </Grid>
        )}

        {/* Step 1.6 — Proforma Invoice */}
        {(po.poStatus === 'RELEASED_TO_VENDOR' || po.piStatus !== 'NOT_RECEIVED') && (
          <Grid item xs={12}>
            <Paper sx={{ ...pfmsCardSx, p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, color: 'primary.main' }}>
                  <FileText size={18} /> Proforma Invoice
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {canCreatePi && (
                    <Button size="small" variant="contained" startIcon={<FileText size={14} />} onClick={() => setPiFormOpen(true)}>
                      Create PI
                    </Button>
                  )}
                  {livePi && (
                    <Button size="small" variant="outlined" startIcon={<Eye size={14} />}
                      onClick={() => navigate(`/procurement/proforma-invoices/${livePi._id}`)}>
                      View PI
                    </Button>
                  )}
                  {canApprovePi && (
                    <Button size="small" variant="outlined" color="success" startIcon={<CheckCircle2 size={14} />}
                      onClick={() => setPiApprovalOpen(true)}>
                      Approve PI
                    </Button>
                  )}
                  {canMarkPiNotRequired && (
                    <Button size="small" variant="outlined" color="warning" startIcon={<CircleSlash size={14} />}
                      onClick={() => setPiNotReqOpen(true)}>
                      Mark PI Not Required
                    </Button>
                  )}
                </Box>
              </Box>
              {isPiNotRequired ? (
                <Grid container spacing={2}>
                  <Grid item xs={6} sm={2.4}><Field label="PI Status" value={<PoPiChip status={po.piStatus} />} /></Grid>
                  <Grid item xs={6} sm={3}><Field label="Reason" value={po.piNotRequiredReason || '—'} /></Grid>
                  <Grid item xs={6} sm={3}><Field label="Remarks" value={po.piNotRequiredRemarks || '—'} /></Grid>
                  <Grid item xs={6} sm={2}><Field label="Marked By" value={po.piNotRequiredByName || '—'} /></Grid>
                  <Grid item xs={6} sm={1.6}><Field label="Marked Date" value={fmtDate(po.piNotRequiredAt)} /></Grid>
                </Grid>
              ) : (
                <Grid container spacing={2}>
                  <Grid item xs={6} sm={2.4}><Field label="PI Status" value={<PoPiChip status={po.piStatus} />} /></Grid>
                  <Grid item xs={6} sm={2.4}><Field label="PI Number" value={po.piNumber || livePi?.piNumber || '—'} /></Grid>
                  <Grid item xs={6} sm={2.4}><Field label="PI Date" value={fmtFuDate(livePi?.piDate || po.piReceivedAt)} /></Grid>
                  <Grid item xs={6} sm={2.4}><Field label="Paid Amount" value={livePi ? fmtPiINR(livePi.paidAmount) : '—'} /></Grid>
                  <Grid item xs={6} sm={2.4}><Field label="Balance Amount" value={livePi ? fmtPiINR(livePi.balanceAmount) : '—'} /></Grid>
                </Grid>
              )}
            </Paper>
          </Grid>
        )}

        {/* Step 1.8 — Goods Receipt Notes */}
        {grnRelevant && (
          <Grid item xs={12}>
            <Paper sx={{ ...pfmsCardSx, p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, color: 'primary.main' }}>
                  <PackageCheck size={18} /> Goods Receipt ({grns.length})
                </Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                  {canCreateGrn && (
                    <Button size="small" variant="contained" startIcon={<PackageCheck size={14} />} onClick={() => setGrnFormOpen(true)}>
                      Create GRN
                    </Button>
                  )}
                  {grnGate && (
                    <Button size="small" variant="contained" color={grnGate.tone === 'success' ? 'success' : 'warning'}
                      startIcon={grnGate.primary.icon} onClick={grnGate.primary.onClick}>
                      {grnGate.primary.label}
                    </Button>
                  )}
                  <Button size="small" variant="outlined" startIcon={<Eye size={14} />} onClick={() => navigate('/purchase-fms/grn')}>
                    View GRNs
                  </Button>
                </Box>
              </Box>
              {grnBlock && (
                <Box sx={{
                  mb: 2, p: 1.5, borderRadius: '10px', bgcolor: alpha('#dc2626', 0.06),
                  border: '1px solid', borderColor: alpha('#dc2626', 0.2),
                  display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
                }}>
                  <AlertTriangle size={16} color="#dc2626" />
                  <Typography variant="body2" sx={{ fontWeight: 600, color: '#991b1b', flexGrow: 1 }}>{grnBlock.text}</Typography>
                  {grnBlock.button && (
                    <Button size="small" variant="contained" color="error" onClick={grnBlock.button.onClick}>{grnBlock.button.label}</Button>
                  )}
                </Box>
              )}
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}><Field label="Receipt Status" value={<PoStatusChip status={po.poStatus} />} /></Grid>
                <Grid item xs={6} sm={3}><Field label="Ordered Qty" value={totalOrdered} /></Grid>
                <Grid item xs={6} sm={3}><Field label="Received Qty" value={totalReceived} /></Grid>
                <Grid item xs={6} sm={3}><Field label="Pending Qty" value={Math.max(0, totalOrdered - totalReceived)} /></Grid>
              </Grid>
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
            </Paper>
          </Grid>
        )}

        {/* Items */}
        <Grid item xs={12}>
          <SectionCard icon={<FileText size={18} />} title={`Items (${po.items?.length || 0})`}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Item Ref</TableCell>
                    <TableCell>Item</TableCell>
                    <TableCell>SKU</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell>Unit</TableCell>
                    <TableCell align="right">Rate</TableCell>
                    <TableCell align="right">Taxable</TableCell>
                    <TableCell align="center">GST %</TableCell>
                    <TableCell align="right">Tax</TableCell>
                    <TableCell align="right">Total</TableCell>
                    <TableCell align="right">Received</TableCell>
                    <TableCell align="right">Pending</TableCell>
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
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={700}>TOTAL TAXABLE VALUE</Typography>
                <Typography fontWeight={700}>{fmtINR(po.totalTaxableValue)}</Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={700}>GST</Typography>
                <Typography fontWeight={700}>{fmtINR(po.totalGSTAmount)}</Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="primary.main" fontWeight={700}>GRAND TOTAL</Typography>
                <Typography variant="h6" fontWeight={800} color="primary.dark">{fmtINR(po.grandTotal)}</Typography>
              </Box>
            </Box>
          </SectionCard>
        </Grid>

        {/* Approval + remarks */}
        <Grid item xs={12} md={6}>
          <SectionCard icon={<CheckCircle2 size={18} />} title="Approval">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}><Field label="Status" value={<PoApprovalChip status={po.approvalStatus} />} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Decided By" value={po.approval?.decidedBy || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Decided At" value={fmtDate(po.approval?.decidedAt)} /></Grid>
              {po.approval?.remarks ? <Grid item xs={12}><Field label="Remarks" value={po.approval.remarks} /></Grid> : null}
            </Grid>
          </SectionCard>
        </Grid>

        {po.remarks ? (
          <Grid item xs={12} md={6}>
            <SectionCard icon={<FileText size={18} />} title="Remarks">
              <Typography variant="body2">{po.remarks}</Typography>
            </SectionCard>
          </Grid>
        ) : null}

        {/* Activity */}
        {po.activityTimeline?.length ? (
          <Grid item xs={12}>
            <SectionCard icon={<ShoppingBag size={18} />} title="Activity">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[...po.activityTimeline].reverse().map((ev, i) => (
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
