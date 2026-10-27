import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import {
  Box, Typography, Paper, Button, IconButton, CircularProgress, Chip, Tooltip,
} from '@mui/material';
import {
  ArrowLeft, Pencil, Send, CheckCircle2, FileText, FileCheck2,
  ClipboardList, User, Building2, Hash, ShoppingBag,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useSnackbar } from 'notistack';
import {
  useGetIndentQuery,
  useSubmitIndentMutation,
} from '../../../store/api/procurementApi';
import { ApprovalChip, OverallChip, QuoteChip, QuotationChip, fileHref, itemRef } from './indentMeta';
import StatusChip from '../components/StatusChip';
import { PFMS, pfmsPageSx, pfmsCardSx } from '../pfmsTheme';
import IndentFormDrawer from './IndentFormDrawer';
import IndentApprovalDialog from './IndentApprovalDialog';
import QuoteComparativeDialog from './QuoteComparativeDialog';
import QuotationApprovalDialog from './QuotationApprovalDialog';
import { useStartServiceQc, canStartServiceQc } from './useStartServiceQc';
import PurchaseOrderFormDrawer from '../purchase-orders/PurchaseOrderFormDrawer';
import FmsDoerCard from '../../fms-doers/FmsDoerCard';
import NextStepBanner from '../components/NextStepBanner';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// ── Page-wide design tokens ──────────────────────────────────────────────────
// One spacing/typography scale, reused by every section on this page, instead
// of each section card picking its own padding/gap/icon-size. SECTION_GAP is
// the single vertical rhythm between Hero → cards → cards (8/12/16/24px scale,
// i.e. MUI units 1 / 1.5 / 2 / 3).
const SECTION_GAP = 2;
const CARD_PAD = 2;
const TABLE_HEAD_SX = {
  fontWeight: 700, color: PFMS.sub, textTransform: 'uppercase',
  fontSize: '0.64rem', letterSpacing: '0.04em', whiteSpace: 'nowrap',
};

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em', color: PFMS.sub, mb: 0.4 }}>{label}</Typography>
    {/* div, not p: some values are chips (block elements), which may not sit inside a <p> */}
    <Typography component="div" sx={{ fontSize: '0.86rem', fontWeight: 600, color: PFMS.ink, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);

// A row of Fields that aligns to common columns and reflows at any width
// without hand-picked breakpoints. Each field is capped at a comfortable
// reading width (not stretched to fill the card) so a short row of fields on
// a full-width card reads as a tidy info strip, not as content straining to
// occupy space it doesn't need.
const FieldGrid = ({ children, sx }) => (
  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 210px))', gap: 2, ...sx }}>
    {children}
  </Box>
);

// Every section on the page is a full-width card. Earlier this page paired
// Approval/Quote Step/Approved Quotation two-up (md=6 each); on real data that
// produced two concrete defects, visible in a before/after comparison: (1)
// whichever of the three landed alone in a row left roughly half the row as
// blank page background, and (2) the Quote Step / Approved Quotation
// item-wise file tables — six columns each — were squeezed into ~half the
// content width, which is what was wrapping SKUs and cramping the file
// buttons. Full-width cards fix both at the root: nothing is ever short a
// partner to pair with, and a table gets the page's full width to lay out its
// columns before falling back to its own horizontal scroll.
const SectionCard = ({ icon, title, action, children }) => (
  <Paper sx={{ ...pfmsCardSx, p: CARD_PAD }}>
    <Box sx={{
      display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' },
      justifyContent: 'space-between', gap: 1.25, mb: 1.5,
    }}>
      <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, fontSize: '0.92rem', color: 'primary.main' }}>
        {icon} {title}
      </Typography>
      {action && (
        <Box sx={{ width: { xs: '100%', sm: 'auto' }, '& .MuiButtonBase-root': { width: { xs: '100%', sm: 'auto' } } }}>
          {action}
        </Box>
      )}
    </Box>
    {children}
  </Paper>
);

// Indent items table — multi-item, with legacy single-product fallback.
const itemsOf = (indent) => {
  if (indent?.items?.length) return indent.items;
  if (indent?.productNameRevised) {
    return [{
      itemName: indent.productNameRevised, skuCode: indent.skuCode, quantity: indent.quantity,
      unit: indent.unit, revisedQuantity: indent.revisedQuantity, approvedQuantity: indent.approvedQuantity,
    }];
  }
  return [];
};

// One compact file button — icon + CSS-ellipsised name, consistent height
// regardless of filename length. The full name is always available via the
// tooltip, and the button still opens/downloads the file exactly as before
// (same href/target/rel); only the truncation moved from a hand-rolled
// character slice (inconsistent across the page — 16 chars in one place, 18
// in another) to one CSS rule everyone shares.
const FileChip = ({ doc, index }) => {
  const label = doc.fileName || `File ${index + 1}`;
  return (
    <Tooltip title={label}>
      <Button
        size="small" variant="outlined" startIcon={<FileText size={13} />}
        href={fileHref(doc.fileUrl)} target="_blank" rel="noopener"
        sx={{
          textTransform: 'none', height: 30, px: 1.1, maxWidth: 190, minWidth: 0,
          justifyContent: 'flex-start', fontWeight: 600, fontSize: '0.76rem',
          '& .MuiButton-startIcon': { mr: 0.6, flexShrink: 0 },
        }}
      >
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Box>
      </Button>
    </Tooltip>
  );
};

const FileChipRow = ({ docs }) => {
  if (!docs?.length) return <Typography variant="body2" color="text.disabled">—</Typography>;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
      {docs.map((d, i) => <FileChip key={d.fileUrl || i} doc={d} index={i} />)}
    </Box>
  );
};

// Fixed pixel/minmax column tracks (not fr-only) so the table never collapses
// into an unlabeled stack on a narrow screen — on tablet/mobile the HEADER
// stays visible and aligned with its data; the whole table scrolls sideways
// inside its own container instead, which keeps every field reachable without
// hiding any of them. This is also what fixes "wrapped SKU" — SKU keeps a
// fixed 110px column regardless of viewport, it no longer gets squeezed.
const ITEM_COLS = 'minmax(200px,1.6fr) 110px 80px 70px 90px 90px 140px minmax(170px,1fr) minmax(150px,1fr)';
const ITEM_HEADERS = ['Product', 'SKU', 'Qty', 'Unit', 'Revised', 'Approved', 'Status', 'Vendor', 'Remarks'];
// Where the item's vendor came from (backend indent/itemVendor.js).
const VENDOR_SOURCE_CAPTION = { APPROVED_QUOTATION: 'Approved quotation', PO_PREPARATION: 'Selected on Pending for PO' };
const NUMERIC_ITEM_COLS = new Set(['Qty', 'Revised', 'Approved']);

const ItemsTable = ({ items, indentNumber }) => (
  <Box sx={{ overflowX: 'auto' }}>
    <Box sx={{ display: 'grid', gridTemplateColumns: ITEM_COLS, gap: 1.5, px: 1, pb: 1, borderBottom: `1px solid ${PFMS.line}` }}>
      {ITEM_HEADERS.map((h) => (
        <Typography key={h} sx={{ ...TABLE_HEAD_SX, textAlign: NUMERIC_ITEM_COLS.has(h) ? 'right' : 'left' }}>{h}</Typography>
      ))}
    </Box>
    {items.map((it, idx) => (
      <Box key={it._id || idx} sx={{
        display: 'grid', gridTemplateColumns: ITEM_COLS, gap: 1.5, alignItems: 'center',
        px: 1, py: 1.25, borderBottom: idx === items.length - 1 ? 'none' : `1px solid ${PFMS.lineSoft}`,
      }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} noWrap>{it.itemName}</Typography>
          <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700 }}>{itemRef(indentNumber, it, idx)}</Typography>
        </Box>
        <Typography variant="body2" color="primary.main" fontWeight={700} noWrap>{it.skuCode || '—'}</Typography>
        <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{it.quantity ?? '—'}</Typography>
        <Typography variant="body2" color="text.secondary" noWrap>{it.unit || '—'}</Typography>
        <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{it.revisedQuantity || '—'}</Typography>
        <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#0f766e' }}>{it.approvedQuantity || '—'}</Typography>
        <Box sx={{ minWidth: 0 }}>
          <StatusChip status={it.approvalStatus || 'PENDING'} />
          {it.approvalStatus === 'REJECTED' && it.rejectionReason ? (
            <Tooltip title={it.rejectionReason}>
              <Typography variant="caption" color="error.main" noWrap sx={{ display: 'block', mt: 0.25 }}>{it.rejectionReason}</Typography>
            </Tooltip>
          ) : null}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontWeight={it.vendorName ? 600 : 400} color={it.vendorName ? 'text.primary' : 'text.secondary'} noWrap title={it.vendorName || ''}>
            {it.vendorName || '—'}
          </Typography>
          {it.vendorName && VENDOR_SOURCE_CAPTION[it.vendorSource] ? (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>{VENDOR_SOURCE_CAPTION[it.vendorSource]}</Typography>
          ) : null}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{it.remarks || '—'}</Typography>
      </Box>
    ))}
  </Box>
);

// Per-item status for the Quote Step vs. Approved Quotation file tables —
// the SAME raw value (statusDone: 'YES') means two different things
// depending which step it's read from ("the quote was received" vs. "the
// quotation was approved"), so each context gets its own label — still
// through the one shared StatusChip component and its existing semantic
// tones (blue = received/in-hand, green = approved, red = not approved,
// neutral = not required), not a new badge or a new color.
const itemFileStatusChip = (statusDone, context) => {
  if (context === 'approval') {
    if (statusDone === 'YES') return <StatusChip status="APPROVED" />;
    if (statusDone === 'QUOTATION_NOT_APPROVED') return <StatusChip status={statusDone} />;
    return <StatusChip status={statusDone || 'PENDING'} />;
  }
  if (statusDone === 'YES') return <StatusChip status="RECEIVED" label="Received" tone="blue" />;
  if (statusDone === 'QUOTE_NOT_REQUIRED') return <StatusChip status={statusDone} />;
  return <StatusChip status={statusDone || 'PENDING'} />;
};

// Item-wise uploaded-files table for Step 1.2 / 1.3 detail display.
const FILE_COLS = 'minmax(190px,1.4fr) 100px 150px minmax(220px,1.6fr) 100px minmax(140px,1fr)';
const FILE_HEADERS = ['Item', 'SKU', 'Status', 'Files', 'Actual Date', 'Remarks'];

const ItemFilesTable = ({ rows, fileKey, context }) => {
  if (!rows?.length) return null;
  return (
    <Box sx={{ mt: 1.5, overflowX: 'auto' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: FILE_COLS, gap: 1.5, px: 1, pb: 1, borderBottom: `1px solid ${PFMS.line}` }}>
        {FILE_HEADERS.map((h) => <Typography key={h} sx={TABLE_HEAD_SX}>{h}</Typography>)}
      </Box>
      {rows.map((row, idx) => {
        const files = (row[fileKey] || []).filter((d) => d?.fileUrl);
        return (
          <Box key={row.itemId || idx} sx={{
            display: 'grid', gridTemplateColumns: FILE_COLS, gap: 1.5, alignItems: 'center',
            px: 1, py: 1.25, borderBottom: idx === rows.length - 1 ? 'none' : `1px solid ${PFMS.lineSoft}`,
          }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{row.itemName || '—'}</Typography>
              {row.itemDisplayNumber ? <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700 }}>{row.itemDisplayNumber}</Typography> : null}
            </Box>
            <Typography variant="body2" color="primary.main" fontWeight={700} noWrap>{row.skuCode || '—'}</Typography>
            <Box>{itemFileStatusChip(row.statusDone, context)}</Box>
            <FileChipRow docs={files} />
            <Typography variant="body2" color="text.secondary">{fmtDate(row.actualAt)}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{row.remarks || '—'}</Typography>
          </Box>
        );
      })}
    </Box>
  );
};

const StepBlock = ({ step }) => (
  <FieldGrid>
    <Field label="Status" value={<QuoteChip status={step?.status || 'PENDING'} />} />
    <Field label="Planned" value={fmtDate(step?.plannedAt)} />
    <Field label="Actual" value={fmtDate(step?.actualAt)} />
    <Field label="Time Delay" value={step?.timeDelay || '—'} />
    {step?.remarks ? <Field label="Remarks" value={step.remarks} /> : null}
  </FieldGrid>
);

const IndentDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack('/purchase-fms/purchase-indents');
  const { enqueueSnackbar } = useSnackbar();

  const { data, isLoading } = useGetIndentQuery(id);
  const indent = data?.data;

  const [submitIndent] = useSubmitIndentMutation();
  const [formOpen, setFormOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [comparativeOpen, setComparativeOpen] = useState(false);
  const [quotationOpen, setQuotationOpen] = useState(false);
  const [poDrawerOpen, setPoDrawerOpen] = useState(false);
  const { startServiceQc, starting: startingServiceQc } = useStartServiceQc();

  if (isLoading) {
    return <Box sx={{ display: 'grid', placeItems: 'center', height: '70vh' }}><CircularProgress /></Box>;
  }
  if (!indent) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6">Indent not found</Typography>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/purchase-fms/purchase-indents')}>Back to list</Button>
      </Box>
    );
  }

  const onSubmit = async () => {
    try {
      await submitIndent(indent._id).unwrap();
      enqueueSnackbar('Submitted for approval', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to submit', { variant: 'error' });
    }
  };

  const isDraft = indent.approvalStatus === 'DRAFT';
  const isPending = indent.approvalStatus === 'PENDING_APPROVAL';
  const isApproved = indent.approvalStatus === 'APPROVED';
  const quoteDone = ['RECEIVED', 'NOT_REQUIRED'].includes(indent.quoteStep?.status);
  const step12Done = ['QUOTE_RECEIVED', 'QUOTE_NOT_REQUIRED'].includes(indent.overallStatus);
  const quotationDone = !!indent.quotationApprovalStep?.statusDone;
  const isQuotationApproved = indent.overallStatus === 'QUOTATION_APPROVED';
  // Step 1.3 was skipped because Step 1.2 was marked "Quote Not Required".
  const quoteSkipped = !!indent.quotationApprovalStep?.skipped;
  const isService = indent.requestType === 'INTERNAL_SERVICE';
  const isRejected = indent.approvalStatus === 'REJECTED';
  const detailItems = itemsOf(indent);
  // Whether any PO has been raised from this indent — once it has, Step 1.2 must
  // not be re-edited (it would desync the downstream approval / PO chain).
  const hasPo = ['PARTIAL_PO_CREATED', 'PO_READY'].includes(indent.overallStatus)
    || detailItems.some((it) => it.procurementStatus === 'PO_CREATED' || it.poId);

  // ── "What's next?" — single, obvious call-to-action for the current stage. ──
  const goToPOs = () => navigate('/purchase-fms/purchase-orders');
  const nextStep = (() => {
    if (isDraft) {
      return { tone: 'info', title: 'Submit this indent for approval',
        desc: 'Review the items, then send it to the approver.',
        primary: { label: 'Submit for Approval', icon: <Send size={16} />, onClick: onSubmit },
        secondary: { label: 'Edit', onClick: () => setFormOpen(true) } };
    }
    if (isPending) {
      return { tone: 'warn', title: 'Waiting for approval',
        desc: 'This indent needs to be approved before quotations can be raised.',
        primary: { label: 'Approve / Reject', icon: <CheckCircle2 size={16} />, onClick: () => setApprovalOpen(true) } };
    }
    if (isRejected) return null;
    if (isApproved && !quoteDone) {
      return { tone: 'info', title: 'Next: Receive Quote & Make Comparative (Step 1.2)',
        desc: 'Upload vendor quotations for the approved items.',
        primary: { label: 'Receive Quote / Comparative', icon: <FileText size={16} />, onClick: () => setComparativeOpen(true) } };
    }
    if (step12Done && !quotationDone && !quoteSkipped) {
      return { tone: 'info', title: 'Next: Approve the Quotation (Step 1.3)',
        desc: 'Mark the approved quotation for each item.',
        primary: { label: 'Approved Quotation 1.03', icon: <FileCheck2 size={16} />, onClick: () => setQuotationOpen(true) } };
    }
    if (canStartServiceQc(indent)) {
      return { tone: 'info', title: 'Next: Service QC (Step 1.9)',
        desc: 'This is an internal-service indent — once the work is done, check it in Incoming QC (attach the service report there).',
        primary: { label: 'Start Service QC', icon: <CheckCircle2 size={16} />, onClick: () => startServiceQc(indent) } };
    }
    if (!isService && indent.overallStatus === 'QUOTATION_APPROVED') {
      return { tone: 'success', title: 'Quotation approved — create a Purchase Order',
        desc: 'Pick the approved items and raise a vendor PO (Step 1.4). The same indent can feed multiple POs.',
        primary: { label: 'Create Vendor PO', icon: <ShoppingBag size={16} />, onClick: () => setPoDrawerOpen(true) },
        secondary: { label: 'Go to Purchase Orders', onClick: goToPOs } };
    }
    if (!isService && indent.overallStatus === 'PARTIAL_PO_CREATED') {
      return { tone: 'warn', title: 'Some approved items still need a Purchase Order',
        desc: 'Part of this indent is already on a PO. Create POs for the remaining approved items.',
        primary: { label: 'Create Vendor PO', icon: <ShoppingBag size={16} />, onClick: () => setPoDrawerOpen(true) },
        secondary: { label: 'View Purchase Orders', onClick: goToPOs } };
    }
    if (!isService && indent.overallStatus === 'PO_READY') {
      return { tone: 'success', title: 'All approved items are on purchase orders',
        desc: 'Track approval, release, follow-up and GRN from the Purchase Orders screen.',
        primary: { label: 'Go to Purchase Orders', icon: <ShoppingBag size={16} />, onClick: goToPOs } };
    }
    return null;
  })();

  const approvedQuotationDocs = (() => {
    const step = indent.quotationApprovalStep;
    return step?.approvedQuotationDocuments?.length
      ? step.approvedQuotationDocuments
      : (step?.approvedQuotation?.fileUrl ? [step.approvedQuotation] : []);
  })();

  return (
    <Box sx={{ ...pfmsPageSx }}>
      {/* Hero */}
      <Box sx={{ mb: SECTION_GAP, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Tooltip title="Back">
          <IconButton onClick={goBack} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}`, width: 38, height: 38 }}>
            <ArrowLeft size={18} />
          </IconButton>
        </Tooltip>
        <Box sx={{ width: 38, height: 38, borderRadius: '8px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main', flexShrink: 0 }}>
          <ClipboardList size={20} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: PFMS.ink }}>{indent.indentNumber}</Typography>
            <ApprovalChip status={indent.approvalStatus} />
            {quoteSkipped ? (
              <>
                <StatusChip label="Quote Not Required" tone="neutral" />
                <StatusChip status={isService ? indent.overallStatus : 'PO_READY'} />
              </>
            ) : (
              <OverallChip status={indent.overallStatus} />
            )}
          </Box>
          <Typography variant="body2" sx={{ color: PFMS.sub }}>{indent.productNameRevised}</Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        {/* Contextual actions */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {isDraft && <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setFormOpen(true)}>Edit</Button>}
          {isDraft && <Button variant="contained" startIcon={<Send size={16} />} onClick={onSubmit}>Submit</Button>}
          {isPending && <Button variant="contained" color="success" startIcon={<CheckCircle2 size={16} />} onClick={() => setApprovalOpen(true)}>Approve / Reject</Button>}
          {/* Receive Quote / Comparative (Step 1.2) lives only in the Next Step banner, which shows it under the same condition. */}
          {step12Done && !quotationDone && !quoteSkipped && <Button variant="contained" color="success" startIcon={<FileCheck2 size={16} />} onClick={() => setQuotationOpen(true)}>Approved Quotation 1.03</Button>}
          {canStartServiceQc(indent) && (
            <Button variant="contained" color="success" startIcon={<CheckCircle2 size={16} />} disabled={startingServiceQc} onClick={() => startServiceQc(indent)}>Start Service QC</Button>
          )}
        </Box>
      </Box>

      <NextStepBanner step={nextStep} />

      <FmsDoerCard entityType="INDENT" entityId={id} />

      {/* Every remaining section is a full-width card in one vertical stack —
          see the comment on SectionCard for why this replaced the earlier
          two-column (md=6) pairing. */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: SECTION_GAP }}>
        <SectionCard icon={<Hash size={18} />} title="Indent Details">
          <FieldGrid sx={{ mb: 2 }}>
            <Field label="Raised On" value={fmtDate(indent.timestamp)} />
            <Field label={<><User size={12} /> Raised By</>} value={indent.raisedBy || '—'} />
            <Field label={<><Building2 size={12} /> Department</>} value={indent.department || '—'} />
            <Field label="Remarks" value={indent.remarks || '—'} />
          </FieldGrid>
          <ItemsTable items={detailItems} indentNumber={indent.indentNumber} />
        </SectionCard>

        <SectionCard icon={<CheckCircle2 size={18} />} title="Approval">
          <FieldGrid>
            <Field label="Status" value={<ApprovalChip status={indent.approvalStatus} />} />
            <Field label="Approved By" value={indent.approval?.approvedBy || '—'} />
            <Field label="Approved On" value={fmtDate(indent.approval?.approvedAt)} />
            {indent.approval?.remarks ? <Field label="Remarks" value={indent.approval.remarks} /> : null}
          </FieldGrid>
        </SectionCard>

        <SectionCard
          icon={<FileText size={18} />}
          title="Quote Step"
          action={isApproved && quoteDone && !hasPo ? (
            <Tooltip title={quoteSkipped ? 'Change Step 1.2 back to "Quote Received" to require quotation approval again' : 'Edit the received quote / comparative'}>
              <Button size="small" variant="outlined" startIcon={<Pencil size={14} />} onClick={() => setComparativeOpen(true)}>
                Edit
              </Button>
            </Tooltip>
          ) : null}
        >
          <StepBlock step={indent.quoteStep} />
          {(() => {
            const step = indent.quoteComparativeStep;
            // Prefer item-wise quotation files; fall back to legacy flat docs.
            if (step?.itemQuotations?.length) {
              return (
                <Box sx={{ mt: 2 }}>
                  <Typography sx={TABLE_HEAD_SX}>Item-wise Quotation Files</Typography>
                  <ItemFilesTable rows={step.itemQuotations} fileKey="quotationDocuments" context="quote" />
                  {step.legacyQuotationDocuments?.length > 0 && (
                    <Box sx={{ mt: 2 }}>
                      <Field label={`Earlier quotation files — not linked to an item (${step.legacyQuotationDocuments.length})`} value={
                        <FileChipRow docs={step.legacyQuotationDocuments} />
                      } />
                    </Box>
                  )}
                </Box>
              );
            }
            const docs = step?.quotationDocuments?.length
              ? step.quotationDocuments
              : (step?.quotationUploaded?.fileUrl ? [step.quotationUploaded] : []);
            if (!docs.length) return null;
            return (
              <Box sx={{ mt: 2 }}>
                <Field label={`Quotation Uploaded (${docs.length})`} value={<FileChipRow docs={docs} />} />
              </Box>
            );
          })()}
        </SectionCard>

        <SectionCard
          icon={<FileCheck2 size={18} />}
          title="Approved Quotation"
          action={
            <Tooltip title={isQuotationApproved ? 'Create a Purchase Order from this indent' : 'Available after quotation is approved'}>
              <span>
                <Button size="small" variant={isQuotationApproved ? 'contained' : 'outlined'} startIcon={<ShoppingBag size={14} />}
                  disabled={!isQuotationApproved} onClick={() => setPoDrawerOpen(true)}>
                  Create Vendor PO
                </Button>
              </span>
            </Tooltip>
          }
        >
          <FieldGrid>
            <Field label="Status" value={<QuotationChip status={indent.quotationApprovalStep?.statusDone || (quoteSkipped ? 'NOT_REQUIRED' : 'PENDING')} />} />
            <Field label="Actual Date" value={fmtDate(indent.quotationApprovalStep?.actualAt)} />
            <Field label={`Approved Quotation File${approvedQuotationDocs.length ? ` (${approvedQuotationDocs.length})` : ''}`} value={<FileChipRow docs={approvedQuotationDocs} />} />
            {indent.quotationApprovalStep?.remarks ? <Field label="Remarks" value={indent.quotationApprovalStep.remarks} /> : null}
          </FieldGrid>
          {indent.quotationApprovalStep?.itemApprovedQuotations?.length ? (
            <Box sx={{ mt: 2 }}>
              <Typography sx={TABLE_HEAD_SX}>Item-wise Approved Quotation Files</Typography>
              <ItemFilesTable rows={indent.quotationApprovalStep.itemApprovedQuotations} fileKey="approvedQuotationDocuments" context="approval" />
            </Box>
          ) : null}
        </SectionCard>

        {/* Activity timeline */}
        {indent.activityTimeline?.length ? (
          <SectionCard icon={<ClipboardList size={18} />} title="Activity">
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {[...indent.activityTimeline].reverse().map((ev, i, arr) => (
                <Box key={i} sx={{
                  display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'flex-start', sm: 'center' },
                  gap: { xs: 0.5, sm: 1.5 }, py: 1, borderBottom: i === arr.length - 1 ? 'none' : `1px solid ${PFMS.lineSoft}`,
                }}>
                  <Chip size="small" label={ev.action.replace(/_/g, ' ')} sx={{ fontWeight: 700, fontSize: '0.68rem', height: 22, flexShrink: 0 }} />
                  <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>{ev.description}</Typography>
                  <Typography variant="caption" color="text.disabled" sx={{ flexShrink: 0 }}>{fmtDate(ev.timestamp)}</Typography>
                </Box>
              ))}
            </Box>
          </SectionCard>
        ) : null}
      </Box>

      {/* Drawer + dialogs */}
      <IndentFormDrawer open={formOpen} indent={indent} onClose={() => setFormOpen(false)} />
      <IndentApprovalDialog open={approvalOpen} indent={indent} onClose={() => setApprovalOpen(false)} />
      <QuoteComparativeDialog open={comparativeOpen} indent={indent} onClose={() => setComparativeOpen(false)} />
      <QuotationApprovalDialog open={quotationOpen} indent={indent} onClose={() => setQuotationOpen(false)} />
      <PurchaseOrderFormDrawer open={poDrawerOpen} presetIndent={indent} onClose={() => setPoDrawerOpen(false)} />
    </Box>
  );
};

export default IndentDetail;
