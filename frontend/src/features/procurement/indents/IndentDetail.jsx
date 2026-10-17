import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import {
  Box, Typography, Paper, Grid, Button, IconButton, CircularProgress, Divider, Chip, Tooltip,
} from '@mui/material';
import {
  ArrowLeft, Pencil, Send, CheckCircle2, FileText, FileCheck2,
  ClipboardList, User, Building2, Hash, ExternalLink, ShoppingBag,
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

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary', mb: 0.25 }}>{label}</Typography>
    {/* div, not p: some values are chips (block elements), which may not sit inside a <p> */}
    <Typography component="div" sx={{ fontWeight: 600, color: 'text.primary', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);

const SectionCard = ({ icon, title, action, children }) => (
  <Paper sx={{ ...pfmsCardSx, p: 3 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
      <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 700, color: 'primary.main' }}>
        {icon} {title}
      </Typography>
      {action}
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

const ITEM_COLS = '1.8fr 1fr 0.8fr 0.7fr 0.9fr 0.9fr 0.9fr 1.2fr';
const ItemsTable = ({ items, indentNumber }) => (
  <Box>
    <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: ITEM_COLS, gap: 1, px: 1, mb: 0.5 }}>
      {['Product', 'SKU', 'Qty', 'Unit', 'Revised', 'Approved', 'Status', 'Remarks'].map((h, i) => (
        <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.62rem', textAlign: ['Qty', 'Revised', 'Approved'].includes(h) ? 'right' : 'left' }}>{h}</Typography>
      ))}
    </Box>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {items.map((it, idx) => (
        <Box key={it._id || idx} sx={{
          display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: ITEM_COLS }, gap: 1, alignItems: 'center',
          p: 1, borderRadius: '10px', border: '1px solid', borderColor: 'divider',
        }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap>{it.itemName}</Typography>
            <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700 }}>{itemRef(indentNumber, it, idx)}</Typography>
          </Box>
          <Typography variant="body2" color="primary.main" fontWeight={700}>{it.skuCode || '—'}</Typography>
          <Typography variant="body2" sx={{ textAlign: { md: 'right' } }}>{it.quantity ?? '—'}</Typography>
          <Typography variant="body2" color="text.secondary">{it.unit || '—'}</Typography>
          <Typography variant="body2" sx={{ textAlign: { md: 'right' } }}>{it.revisedQuantity || '—'}</Typography>
          <Typography variant="body2" sx={{ textAlign: { md: 'right' }, fontWeight: 700, color: '#0f766e' }}>{it.approvedQuantity || '—'}</Typography>
          <Box sx={{ minWidth: 0 }}>
            <StatusChip status={it.approvalStatus || 'PENDING'} />
            {it.approvalStatus === 'REJECTED' && it.rejectionReason ? (
              <Tooltip title={it.rejectionReason}>
                <Typography variant="caption" color="error.main" noWrap sx={{ display: 'block', mt: 0.25 }}>{it.rejectionReason}</Typography>
              </Tooltip>
            ) : null}
          </Box>
          <Typography variant="body2" color="text.secondary" noWrap>{it.remarks || '—'}</Typography>
        </Box>
      ))}
    </Box>
  </Box>
);

// Human-readable per-item status label for the detail display.
const STATUS_LABEL = {
  YES: 'Yes',
  QUOTE_NOT_REQUIRED: 'Quote Not Required',
  QUOTATION_NOT_APPROVED: 'Quotation Not Approved',
};

// Item-wise uploaded-files table for Step 1.2 / 1.3 detail display.
const FILE_COLS = '1.6fr 0.9fr 1.2fr 2.4fr 1.1fr 1.4fr';
const ItemFilesTable = ({ rows, fileKey }) => {
  if (!rows?.length) return null;
  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: FILE_COLS, gap: 1, px: 1, mb: 0.5 }}>
        {['Item', 'SKU', 'Status', 'Files', 'Actual Date', 'Remarks'].map((h, i) => (
          <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.6rem' }}>{h}</Typography>
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {rows.map((row, idx) => {
          const files = (row[fileKey] || []).filter((d) => d?.fileUrl);
          return (
            <Box key={row.itemId || idx} sx={{
              display: 'grid', gridTemplateColumns: { xs: '1fr', md: FILE_COLS }, gap: 1, alignItems: 'center',
              p: 1, borderRadius: '10px', border: '1px solid', borderColor: 'divider',
            }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{row.itemName || '—'}</Typography>
                {row.itemDisplayNumber ? <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700 }}>{row.itemDisplayNumber}</Typography> : null}
              </Box>
              <Typography variant="body2" color="primary.main" fontWeight={700}>{row.skuCode || '—'}</Typography>
              <Typography variant="body2" color="text.secondary">{STATUS_LABEL[row.statusDone] || row.statusDone || '—'}</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {files.length ? files.map((d, i) => (
                  <Tooltip key={i} title={d.fileName || 'View file'}>
                    <Button size="small" variant="outlined" startIcon={<FileText size={13} />}
                      href={fileHref(d.fileUrl)} target="_blank" rel="noopener" sx={{ textTransform: 'none' }}>
                      {d.fileName ? (d.fileName.length > 16 ? `${d.fileName.slice(0, 14)}…` : d.fileName) : `File ${i + 1}`}
                    </Button>
                  </Tooltip>
                )) : <Typography variant="body2" color="text.secondary">—</Typography>}
              </Box>
              <Typography variant="body2" color="text.secondary">{fmtDate(row.actualAt)}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{row.remarks || '—'}</Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

const StepBlock = ({ step }) => (
  <Grid container spacing={2}>
    <Grid item xs={6} sm={3}><Field label="Status" value={<QuoteChip status={step?.status || 'PENDING'} />} /></Grid>
    <Grid item xs={6} sm={3}><Field label="Planned" value={fmtDate(step?.plannedAt)} /></Grid>
    <Grid item xs={6} sm={3}><Field label="Actual" value={fmtDate(step?.actualAt)} /></Grid>
    <Grid item xs={6} sm={3}><Field label="Time Delay" value={step?.timeDelay || '—'} /></Grid>
    {step?.remarks ? <Grid item xs={12}><Field label="Remarks" value={step.remarks} /></Grid> : null}
  </Grid>
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

  return (
    <Box sx={{ ...pfmsPageSx, p: { xs: 1.5, md: 2.5 } }}>
      {/* Hero */}
      <Box sx={{ mb: 2.5, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={goBack} sx={{ bgcolor: PFMS.surface, border: `1px solid ${PFMS.line}` }}>
          <ArrowLeft size={20} />
        </IconButton>
        <Box sx={{ width: 46, height: 46, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main' }}>
          <ClipboardList size={24} />
        </Box>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: PFMS.ink }}>{indent.indentNumber}</Typography>
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
          <Typography variant="body2" color="text.secondary">{indent.productNameRevised}</Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        {/* Contextual actions */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {isDraft && <Button variant="outlined" startIcon={<Pencil size={16} />} onClick={() => setFormOpen(true)}>Edit</Button>}
          {isDraft && <Button variant="contained" startIcon={<Send size={16} />} onClick={onSubmit}>Submit</Button>}
          {isPending && <Button variant="contained" color="success" startIcon={<CheckCircle2 size={16} />} onClick={() => setApprovalOpen(true)}>Approve / Reject</Button>}
          {isApproved && !quoteDone && <Button variant="contained" startIcon={<FileText size={16} />} onClick={() => setComparativeOpen(true)}>Receive Quote / Comparative</Button>}
          {step12Done && !quotationDone && !quoteSkipped && <Button variant="contained" color="success" startIcon={<FileCheck2 size={16} />} onClick={() => setQuotationOpen(true)}>Approved Quotation 1.03</Button>}
          {canStartServiceQc(indent) && (
            <Button variant="contained" color="success" startIcon={<CheckCircle2 size={16} />} disabled={startingServiceQc} onClick={() => startServiceQc(indent)}>Start Service QC</Button>
          )}
        </Box>
      </Box>

      <NextStepBanner step={nextStep} />

      <FmsDoerCard entityType="INDENT" entityId={id} />
      <Grid container spacing={2}>
        {/* Header + items */}
        <Grid item xs={12}>
          <SectionCard icon={<Hash size={18} />} title="Indent Details">
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={6} sm={3}><Field label="Raised On" value={fmtDate(indent.timestamp)} /></Grid>
              <Grid item xs={6} sm={3}><Field label={<><User size={12} /> Raised By</>} value={indent.raisedBy || '—'} /></Grid>
              <Grid item xs={6} sm={3}><Field label={<><Building2 size={12} /> Department</>} value={indent.department || '—'} /></Grid>
              <Grid item xs={6} sm={3}><Field label="Remarks" value={indent.remarks || '—'} /></Grid>
            </Grid>
            <ItemsTable items={detailItems} indentNumber={indent.indentNumber} />
          </SectionCard>
        </Grid>

        {/* Approval */}
        <Grid item xs={12} md={6}>
          <SectionCard icon={<CheckCircle2 size={18} />} title="Approval">
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}><Field label="Status" value={<ApprovalChip status={indent.approvalStatus} />} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Approved By" value={indent.approval?.approvedBy || '—'} /></Grid>
              <Grid item xs={6} sm={4}><Field label="Approved On" value={fmtDate(indent.approval?.approvedAt)} /></Grid>
              {indent.approval?.remarks ? <Grid item xs={12}><Field label="Remarks" value={indent.approval.remarks} /></Grid> : null}
            </Grid>
          </SectionCard>
        </Grid>

        {/* Quote step */}
        <Grid item xs={12} md={6}>
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
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>Item-wise Quotation Files</Typography>
                    <ItemFilesTable rows={step.itemQuotations} fileKey="quotationDocuments" />
                    {step.legacyQuotationDocuments?.length > 0 && (
                      <Box sx={{ mt: 1.5 }}>
                        <Field label={`Earlier quotation files — not linked to an item (${step.legacyQuotationDocuments.length})`} value={
                          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                            {step.legacyQuotationDocuments.map((d, i) => (
                              <Tooltip key={d.fileUrl || i} title={d.fileName || 'View file'}>
                                <Button size="small" variant="outlined" startIcon={<FileText size={14} />}
                                  href={fileHref(d.fileUrl)} target="_blank" rel="noopener" sx={{ textTransform: 'none' }}>
                                  {d.fileName ? (d.fileName.length > 18 ? `${d.fileName.slice(0, 16)}…` : d.fileName) : `File ${i + 1}`}
                                </Button>
                              </Tooltip>
                            ))}
                          </Box>
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
                  <Field label={`Quotation Uploaded (${docs.length})`} value={
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {docs.map((d, i) => (
                        <Tooltip key={i} title={d.fileName || 'View file'}>
                          <Button size="small" variant="outlined" startIcon={<FileText size={14} />}
                            href={fileHref(d.fileUrl)} target="_blank" rel="noopener" sx={{ textTransform: 'none' }}>
                            {d.fileName ? (d.fileName.length > 18 ? `${d.fileName.slice(0, 16)}…` : d.fileName) : `File ${i + 1}`}
                          </Button>
                        </Tooltip>
                      ))}
                    </Box>
                  } />
                </Box>
              );
            })()}
          </SectionCard>
        </Grid>

        {/* Quotation approval step — Step 1.3 */}
        <Grid item xs={12} md={6}>
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
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4}>
                <Field label="Status" value={<QuotationChip status={indent.quotationApprovalStep?.statusDone || (quoteSkipped ? 'NOT_REQUIRED' : 'PENDING')} />} />
              </Grid>
              <Grid item xs={6} sm={4}><Field label="Actual Date" value={fmtDate(indent.quotationApprovalStep?.actualAt)} /></Grid>
              <Grid item xs={12} sm={4}>
                {(() => {
                  const step = indent.quotationApprovalStep;
                  const docs = step?.approvedQuotationDocuments?.length
                    ? step.approvedQuotationDocuments
                    : (step?.approvedQuotation?.fileUrl ? [step.approvedQuotation] : []);
                  return (
                    <Field label={`Approved Quotation File${docs.length ? ` (${docs.length})` : ''}`} value={
                      docs.length ? (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {docs.map((d, i) => (
                            <Tooltip key={i} title={d.fileName || 'View file'}>
                              <Button size="small" variant="outlined" startIcon={<FileText size={14} />}
                                href={fileHref(d.fileUrl)} target="_blank" rel="noopener" sx={{ textTransform: 'none' }}>
                                {d.fileName ? (d.fileName.length > 18 ? `${d.fileName.slice(0, 16)}…` : d.fileName) : `File ${i + 1}`}
                              </Button>
                            </Tooltip>
                          ))}
                        </Box>
                      ) : '—'
                    } />
                  );
                })()}
              </Grid>
              {indent.quotationApprovalStep?.remarks ? (
                <Grid item xs={12}><Field label="Remarks" value={indent.quotationApprovalStep.remarks} /></Grid>
              ) : null}
              {indent.quotationApprovalStep?.itemApprovedQuotations?.length ? (
                <Grid item xs={12}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase' }}>Item-wise Approved Quotation Files</Typography>
                  <ItemFilesTable rows={indent.quotationApprovalStep.itemApprovedQuotations} fileKey="approvedQuotationDocuments" />
                </Grid>
              ) : null}
            </Grid>
          </SectionCard>
        </Grid>

        {/* Activity timeline */}
        {indent.activityTimeline?.length ? (
          <Grid item xs={12}>
            <SectionCard icon={<ClipboardList size={18} />} title="Activity">
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {[...indent.activityTimeline].reverse().map((ev, i) => (
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
