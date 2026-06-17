import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import { ApprovalChip, OverallChip, QuoteChip, QuotationChip, fileHref } from './indentMeta';
import IndentFormDrawer from './IndentFormDrawer';
import IndentApprovalDialog from './IndentApprovalDialog';
import QuoteComparativeDialog from './QuoteComparativeDialog';
import QuotationApprovalDialog from './QuotationApprovalDialog';
import PurchaseOrderFormDrawer from '../purchase-orders/PurchaseOrderFormDrawer';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const Field = ({ label, value }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', color: 'text.secondary', mb: 0.25 }}>{label}</Typography>
    <Typography sx={{ fontWeight: 600, color: 'text.primary', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
  </Box>
);

const SectionCard = ({ icon, title, action, children }) => (
  <Paper sx={{ p: 3, borderRadius: '18px' }}>
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

const ITEM_COLS = '2fr 1fr 0.8fr 0.7fr 0.9fr 0.9fr 1.3fr';
const ItemsTable = ({ items }) => (
  <Box>
    <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: ITEM_COLS, gap: 1, px: 1, mb: 0.5 }}>
      {['Product', 'SKU', 'Qty', 'Unit', 'Revised', 'Approved', 'Remarks'].map((h, i) => (
        <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.62rem', textAlign: ['Qty', 'Revised', 'Approved'].includes(h) ? 'right' : 'left' }}>{h}</Typography>
      ))}
    </Box>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {items.map((it, idx) => (
        <Box key={it._id || idx} sx={{
          display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: ITEM_COLS }, gap: 1, alignItems: 'center',
          p: 1, borderRadius: '10px', border: '1px solid', borderColor: 'divider',
        }}>
          <Typography variant="body2" fontWeight={600} noWrap>{it.itemName}</Typography>
          <Typography variant="body2" color="primary.main" fontWeight={700}>{it.skuCode || '—'}</Typography>
          <Typography variant="body2" sx={{ textAlign: { md: 'right' } }}>{it.quantity ?? '—'}</Typography>
          <Typography variant="body2" color="text.secondary">{it.unit || '—'}</Typography>
          <Typography variant="body2" sx={{ textAlign: { md: 'right' } }}>{it.revisedQuantity || '—'}</Typography>
          <Typography variant="body2" sx={{ textAlign: { md: 'right' }, fontWeight: 700, color: '#0f766e' }}>{it.approvedQuantity || '—'}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>{it.remarks || '—'}</Typography>
        </Box>
      ))}
    </Box>
  </Box>
);

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
  const { enqueueSnackbar } = useSnackbar();

  const { data, isLoading } = useGetIndentQuery(id);
  const indent = data?.data;

  const [submitIndent] = useSubmitIndentMutation();
  const [formOpen, setFormOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [comparativeOpen, setComparativeOpen] = useState(false);
  const [quotationOpen, setQuotationOpen] = useState(false);
  const [poDrawerOpen, setPoDrawerOpen] = useState(false);

  if (isLoading) {
    return <Box sx={{ display: 'grid', placeItems: 'center', height: '70vh' }}><CircularProgress /></Box>;
  }
  if (!indent) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6">Indent not found</Typography>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/procurement/indents')}>Back to list</Button>
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
  const detailItems = itemsOf(indent);

  return (
    <Box sx={{ p: { xs: 2, sm: 4 }, bgcolor: '#f8fafc', minHeight: '100vh' }}>
      {/* Hero */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <IconButton onClick={() => navigate('/procurement/indents')} sx={{ bgcolor: '#fff', boxShadow: 1 }}>
          <ArrowLeft size={20} />
        </IconButton>
        <Box sx={{ width: 46, height: 46, borderRadius: '12px', display: 'grid', placeItems: 'center', bgcolor: alpha('#2563eb', 0.1), color: 'primary.main' }}>
          <ClipboardList size={24} />
        </Box>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h5" fontWeight={800}>{indent.indentNumber}</Typography>
            <ApprovalChip status={indent.approvalStatus} />
            <OverallChip status={indent.overallStatus} />
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
          {step12Done && !quotationDone && <Button variant="contained" color="success" startIcon={<FileCheck2 size={16} />} onClick={() => setQuotationOpen(true)}>Approved Quotation 1.03</Button>}
        </Box>
      </Box>

      <Grid container spacing={3}>
        {/* Header + items */}
        <Grid item xs={12}>
          <SectionCard icon={<Hash size={18} />} title="Indent Details">
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={6} sm={3}><Field label="Raised On" value={fmtDate(indent.timestamp)} /></Grid>
              <Grid item xs={6} sm={3}><Field label={<><User size={12} /> Raised By</>} value={indent.raisedBy || '—'} /></Grid>
              <Grid item xs={6} sm={3}><Field label={<><Building2 size={12} /> Department</>} value={indent.department || '—'} /></Grid>
              <Grid item xs={6} sm={3}><Field label="Remarks" value={indent.remarks || '—'} /></Grid>
            </Grid>
            <ItemsTable items={detailItems} />
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
          <SectionCard icon={<FileText size={18} />} title="Quote Step">
            <StepBlock step={indent.quoteStep} />
            {indent.quoteComparativeStep?.quotationUploaded?.fileUrl ? (
              <Box sx={{ mt: 2 }}>
                <Field label="Quotation Uploaded" value={
                  <Tooltip title={indent.quoteComparativeStep.quotationUploaded.fileName || 'View file'}>
                    <IconButton size="small" color="primary" component="a"
                      href={fileHref(indent.quoteComparativeStep.quotationUploaded.fileUrl)} target="_blank" rel="noopener">
                      <FileText size={18} />
                    </IconButton>
                  </Tooltip>
                } />
              </Box>
            ) : null}
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
                <Field label="Status" value={<QuotationChip status={indent.quotationApprovalStep?.statusDone || 'PENDING'} />} />
              </Grid>
              <Grid item xs={6} sm={4}><Field label="Actual Date" value={fmtDate(indent.quotationApprovalStep?.actualAt)} /></Grid>
              <Grid item xs={12} sm={4}>
                <Field label="Approved Quotation File" value={
                  indent.quotationApprovalStep?.approvedQuotation?.fileUrl
                    ? (
                      <Tooltip title={indent.quotationApprovalStep.approvedQuotation.fileName || 'View file'}>
                        <IconButton size="small" color="primary" component="a"
                          href={fileHref(indent.quotationApprovalStep.approvedQuotation.fileUrl)} target="_blank" rel="noopener">
                          <FileText size={18} />
                        </IconButton>
                      </Tooltip>
                    )
                    : '—'
                } />
              </Grid>
              {indent.quotationApprovalStep?.remarks ? (
                <Grid item xs={12}><Field label="Remarks" value={indent.quotationApprovalStep.remarks} /></Grid>
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
