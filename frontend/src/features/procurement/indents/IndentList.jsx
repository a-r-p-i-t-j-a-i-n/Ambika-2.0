import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  IconButton, Menu, ListItemIcon, ListItemText, Grid, Card, Tooltip, Chip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Plus, MoreVertical, Eye, Pencil, Send, CheckCircle2, CheckCheck,
  FileText, FileCheck2, ClipboardList, Hourglass, BadgeCheck, Quote, ExternalLink, ShoppingBag,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import {
  useGetIndentsQuery,
  useGetIndentStatsQuery,
  useSubmitIndentMutation,
} from '../../../store/api/procurementApi';
import {
  ApprovalChip, QuoteChip, QuotationChip, APPROVAL_STATUSES, DEPARTMENTS, fileHref,
} from './indentMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import IndentFormDrawer from './IndentFormDrawer';
import IndentApprovalDialog from './IndentApprovalDialog';
import QuoteComparativeDialog from './QuoteComparativeDialog';
import QuotationApprovalDialog from './QuotationApprovalDialog';
import BulkIndentApprovalDialog from './BulkIndentApprovalDialog';
import ServiceCompletionDialog from '../service-completions/ServiceCompletionDialog';
import PurchaseOrderFormDrawer from '../purchase-orders/PurchaseOrderFormDrawer';

// Map the Step-1.2 statusDone (or legacy quoteStep) to a chip state.
const quoteStateOf = (row) => {
  const sd = row.quoteComparativeStep?.statusDone;
  if (sd === 'YES') return 'RECEIVED';
  if (sd === 'QUOTE_NOT_REQUIRED') return 'NOT_REQUIRED';
  return row.quoteStep?.status || 'PENDING';
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

// Human summary of an indent's items (falls back to the legacy single product).
const itemsSummary = (row) => {
  const items = row.items || [];
  if (!items.length) return row.productNameRevised || '—';
  const first = items[0]?.itemName || '—';
  return items.length > 1 ? `${first} +${items.length - 1} more` : first;
};

const KpiCard = ({ icon, label, value, color }) => (
  <Card sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5, borderRadius: '14px' }}>
    <Box sx={{ width: 42, height: 42, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.1), color }}>
      {icon}
    </Box>
    <Box>
      <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1.1, color: 'text.primary' }}>{value ?? 0}</Typography>
      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>{label}</Typography>
    </Box>
  </Card>
);

const IndentList = () => {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [search, setSearch] = useState('');
  const [approvalStatus, setApprovalStatus] = useState('');
  const [department, setDepartment] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Dialog / drawer state
  const [formOpen, setFormOpen] = useState(false);
  const [editIndent, setEditIndent] = useState(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [comparativeOpen, setComparativeOpen] = useState(false);
  const [quotationOpen, setQuotationOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [poDrawerOpen, setPoDrawerOpen] = useState(false);
  const [poPresetIndent, setPoPresetIndent] = useState(null);
  const [activeIndent, setActiveIndent] = useState(null);

  // Row action menu
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);

  const queryArgs = {
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    sort: '-createdAt',
    search: search || undefined,
    approvalStatus: approvalStatus || undefined,
    department: department || undefined,
    ...(from ? { 'timestamp[gte]': `${from}T00:00:00` } : {}),
    ...(to ? { 'timestamp[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching } = useGetIndentsQuery(queryArgs);
  const { data: statsRes } = useGetIndentStatsQuery();
  const stats = statsRes?.data || {};

  const [submitIndent] = useSubmitIndentMutation();

  const openMenu = (e, row) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); setMenuRow(row); };
  const closeMenu = () => { setMenuAnchor(null); setMenuRow(null); };

  const onCreate = () => { setEditIndent(null); setFormOpen(true); };
  const onEdit = (row) => { setEditIndent(row); setFormOpen(true); closeMenu(); };
  const onApprove = (row) => { setActiveIndent(row); setApprovalOpen(true); closeMenu(); };
  const onReceiveQuote = (row) => { setActiveIndent(row); setComparativeOpen(true); closeMenu(); };
  const onApproveQuotation = (row) => { setActiveIndent(row); setQuotationOpen(true); closeMenu(); };
  const onView = (row) => { navigate(`/procurement/indents/${row._id}`); closeMenu(); };

  const onSubmit = async (row) => {
    closeMenu();
    try {
      await submitIndent(row._id).unwrap();
      enqueueSnackbar('Indent submitted for approval', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to submit', { variant: 'error' });
    }
  };

  // Which actions apply to this row's state.
  const actionsFor = (r) => {
    const a = [{ key: 'view', label: 'View Detail', icon: <Eye size={16} />, fn: () => onView(r) }];
    if (r.approvalStatus === 'DRAFT') {
      a.push({ key: 'edit', label: 'Edit Draft', icon: <Pencil size={16} />, fn: () => onEdit(r) });
      a.push({ key: 'submit', label: 'Submit', icon: <Send size={16} />, fn: () => onSubmit(r) });
    }
    if (r.approvalStatus === 'PENDING_APPROVAL') {
      a.push({ key: 'approve', label: 'Approve / Reject', icon: <CheckCircle2 size={16} />, fn: () => onApprove(r) });
    }
    if (r.approvalStatus === 'APPROVED' && r.quoteStep?.status === 'PENDING') {
      a.push({ key: 'quote', label: 'Receive Quote / Comparative', icon: <FileText size={16} />, fn: () => onReceiveQuote(r) });
    }
    // Approved Quotation (Step 1.3) — hidden once the step was skipped via
    // "Quote Not Required" (which moves the indent straight to QUOTATION_APPROVED).
    if (['QUOTE_RECEIVED', 'QUOTE_NOT_REQUIRED'].includes(r.overallStatus) && !r.quotationApprovalStep?.skipped) {
      a.push({ key: 'approveQuote', label: 'Approved Quotation 1.03', icon: <FileCheck2 size={16} />, fn: () => onApproveQuotation(r) });
    }
    // PO-ready material indents can raise a Vendor PO directly (covers both the
    // normal approved-quotation flow and the Quote-Not-Required skip path).
    if (r.overallStatus === 'QUOTATION_APPROVED' && r.requestType !== 'INTERNAL_SERVICE') {
      a.push({ key: 'createPo', label: 'Create Vendor PO', icon: <ShoppingBag size={16} />, fn: () => { setPoPresetIndent(r); setPoDrawerOpen(true); closeMenu(); } });
    }
    // Internal-service indents: mark the service done (Step 1.8A) once approved.
    if (r.requestType === 'INTERNAL_SERVICE' && r.overallStatus === 'SERVICE_PENDING') {
      a.push({ key: 'service', label: 'Mark Service Completed', icon: <CheckCircle2 size={16} />, fn: () => { setActiveIndent(r); setServiceOpen(true); closeMenu(); } });
    }
    return a;
  };

  const columns = [
    { field: 'timestamp', headerName: 'TIMESTAMP', width: 110,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'indentNumber', headerName: 'INDENT NO', width: 130,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'requestType', headerName: 'TYPE', width: 130, sortable: false,
      renderCell: (p) => (p.value === 'INTERNAL_SERVICE'
        ? <Chip size="small" label="Service" sx={{ bgcolor: alpha('#7c3aed', 0.12), color: '#6d28d9', fontWeight: 700 }} />
        : <Chip size="small" label="Material" sx={{ bgcolor: alpha('#2563eb', 0.1), color: '#1d4ed8', fontWeight: 700 }} />) },
    { field: 'products', headerName: 'PRODUCTS', flex: 1, minWidth: 220, sortable: false,
      valueGetter: (_v, row) => itemsSummary(row),
      renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value}</Typography> },
    { field: 'itemsCount', headerName: 'ITEMS', width: 80, align: 'right', headerAlign: 'right', sortable: false,
      valueGetter: (_v, row) => (row.items?.length || (row.productNameRevised ? 1 : 0)) },
    { field: 'raisedBy', headerName: 'RAISED BY', width: 130,
      renderCell: (p) => <Typography variant="body2" color="text.secondary" noWrap>{p.value || '—'}</Typography> },
    { field: 'department', headerName: 'DEPT', width: 120,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value || '—'}</Typography> },
    { field: 'revisedQuantity', headerName: 'REVISED QTY', width: 110, align: 'right', headerAlign: 'right',
      renderCell: (p) => p.value || '—' },
    { field: 'approvedQuantity', headerName: 'APPROVED QTY', width: 120, align: 'right', headerAlign: 'right',
      renderCell: (p) => p.value || '—' },
    { field: 'approvalStatus', headerName: 'APPROVAL', width: 150,
      renderCell: (p) => <ApprovalChip status={p.value} /> },
    { field: 'quoteStatus', headerName: 'QUOTE STATUS', width: 130, sortable: false,
      valueGetter: (_v, row) => quoteStateOf(row),
      renderCell: (p) => <QuoteChip status={p.value} /> },
    { field: 'quotationUploaded', headerName: 'QUOTATION UPLOADED', width: 180, sortable: false,
      renderCell: (p) => {
        const step = p.row.quoteComparativeStep;
        const docs = step?.quotationDocuments?.length
          ? step.quotationDocuments
          : (step?.quotationUploaded?.fileUrl ? [step.quotationUploaded] : []);
        if (!docs.length) return <Typography variant="caption" color="text.disabled">—</Typography>;
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Button size="small" startIcon={<ExternalLink size={14} />} href={fileHref(docs[0].fileUrl)} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
              {docs.length > 1 ? `${docs.length} files` : 'View'}
            </Button>
            {docs.length > 1 && <Typography variant="caption" color="text.secondary">+{docs.length - 1} more</Typography>}
          </Box>
        );
      } },
    { field: 'quoteActualDate', headerName: 'QUOTE ACTUAL DATE', width: 150, sortable: false,
      valueGetter: (_v, row) => row.quoteComparativeStep?.actualAt || row.quoteStep?.actualAt || '',
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value ? fmtDate(p.value) : '—'}</Typography> },
    { field: 'approvedQuotationStatus', headerName: 'APPROVED QUOTATION STATUS', width: 200, sortable: false,
      valueGetter: (_v, row) => row.quotationApprovalStep?.statusDone
        || (row.quotationApprovalStep?.skipped ? 'NOT_REQUIRED' : 'PENDING'),
      renderCell: (p) => <QuotationChip status={p.value} /> },
    { field: 'approvedQuotationFile', headerName: 'APPROVED QUOTATION FILE', width: 190, sortable: false,
      renderCell: (p) => {
        const step = p.row.quotationApprovalStep;
        const docs = step?.approvedQuotationDocuments?.length
          ? step.approvedQuotationDocuments
          : (step?.approvedQuotation?.fileUrl ? [step.approvedQuotation] : []);
        if (!docs.length) return <Typography variant="caption" color="text.disabled">—</Typography>;
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Button size="small" startIcon={<ExternalLink size={14} />} href={fileHref(docs[0].fileUrl)} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
              {docs.length > 1 ? `${docs.length} files` : 'View'}
            </Button>
            {docs.length > 1 && <Typography variant="caption" color="text.secondary">+{docs.length - 1} more</Typography>}
          </Box>
        );
      } },
    { field: 'approvedQuotationDate', headerName: 'APPROVED QUOTATION DATE', width: 190, sortable: false,
      valueGetter: (_v, row) => row.quotationApprovalStep?.actualAt || '',
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value ? fmtDate(p.value) : '—'}</Typography> },
    { field: '__actions', headerName: '', width: 60, sortable: false, filterable: false, align: 'center',
      renderCell: (p) => (
        <Tooltip title="Actions">
          <IconButton size="small" onClick={(e) => openMenu(e, p.row)}><MoreVertical size={16} /></IconButton>
        </Tooltip>
      ) },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: 2, sm: 3 }, minHeight: '100vh', bgcolor: '#f8fafc' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, color: '#0b2545' }}>Purchase Indents</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', fontWeight: 500 }}>Raise, approve and track purchase requirements</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <Button variant="outlined" color="success" startIcon={<CheckCheck size={16} />} onClick={() => setBulkOpen(true)}>
            Bulk Approve
          </Button>
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={onCreate}>Create Indent</Button>
        </Box>
      </Box>

      {/* KPI cards */}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<ClipboardList size={20} />} label="Total Indents"      value={stats.total}             color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<Hourglass size={20} />}     label="Pending Approval"   value={stats.pendingApproval}   color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<BadgeCheck size={20} />}    label="Approved"           value={stats.approved}          color="#0f766e" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<Quote size={20} />}         label="Quote Pending"      value={stats.quotePending}      color="#7c3aed" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<FileCheck2 size={20} />}    label="Quotation Approved" value={stats.quotationApproved} color="#16a34a" /></Grid>
      </Grid>

      {/* Filters */}
      <Paper sx={{ p: 1.5, borderRadius: '14px', display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField size="small" placeholder="Search indents…" value={search} onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 240 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color="#94a3b8" /></InputAdornment> }} />
        <TextField size="small" select label="Approval" value={approvalStatus} onChange={(e) => setApprovalStatus(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          {APPROVAL_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace('_', ' ')}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value="">All</MenuItem>
          {DEPARTMENTS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
        </TextField>
        <DateInputDDMMYYYY label="From" value={from} onChange={setFrom} sx={{ width: 160 }} />
        <DateInputDDMMYYYY label="To" value={to} onChange={setTo} sx={{ width: 160 }} />
      </Paper>

      {/* Grid */}
      <Paper sx={{ flexGrow: 1, minHeight: 420, borderRadius: '16px', overflow: 'hidden' }}>
        <DataGrid
          rows={data?.data || []}
          columns={columns}
          getRowId={(r) => r._id}
          loading={isLoading || isFetching}
          paginationMode="server"
          rowCount={data?.meta?.total || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          onRowClick={(p) => navigate(`/procurement/indents/${p.id}`)}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          rowHeight={50}
          columnHeaderHeight={44}
          sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Paper>

      {/* Row actions menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuRow && actionsFor(menuRow).map((a) => (
          <MenuItem key={a.key} onClick={a.fn}>
            <ListItemIcon>{a.icon}</ListItemIcon>
            <ListItemText>{a.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      {/* Drawer + dialogs */}
      <IndentFormDrawer open={formOpen} indent={editIndent} onClose={() => { setFormOpen(false); setEditIndent(null); }} />
      <IndentApprovalDialog open={approvalOpen} indent={activeIndent} onClose={() => { setApprovalOpen(false); setActiveIndent(null); }} />
      <QuoteComparativeDialog open={comparativeOpen} indent={activeIndent} onClose={() => { setComparativeOpen(false); setActiveIndent(null); }} />
      <QuotationApprovalDialog open={quotationOpen} indent={activeIndent} onClose={() => { setQuotationOpen(false); setActiveIndent(null); }} />
      <BulkIndentApprovalDialog open={bulkOpen} onClose={() => setBulkOpen(false)}
        onReceiveQuote={(ind) => { setBulkOpen(false); setActiveIndent(ind); setComparativeOpen(true); }} />
      <ServiceCompletionDialog open={serviceOpen} indent={activeIndent} onClose={() => { setServiceOpen(false); setActiveIndent(null); }} />
      <PurchaseOrderFormDrawer open={poDrawerOpen} presetIndent={poPresetIndent} onClose={() => { setPoDrawerOpen(false); setPoPresetIndent(null); }} />
    </Box>
  );
};

export default IndentList;
