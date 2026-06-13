import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  IconButton, Menu, ListItemIcon, ListItemText, Grid, Card, Tooltip, Autocomplete,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Plus, MoreVertical, Eye, Pencil, CheckCircle2, Send, FileDown,
  Ban, ShoppingBag, BadgeCheck, Truck, PackageOpen, PackageCheck,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import {
  useGetPurchaseOrdersQuery,
  useGetPurchaseOrderStatsQuery,
  useCancelPurchaseOrderMutation,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import { PoStatusChip, PoReleaseChip, PO_STATUSES, fmtINR, fmtDate } from './poMeta';
import PurchaseOrderFormDrawer from './PurchaseOrderFormDrawer';
import PurchaseOrderApprovalDialog from './PurchaseOrderApprovalDialog';
import PurchaseOrderReleaseDialog from './PurchaseOrderReleaseDialog';
import PurchaseOrderPdfPreview from './PurchaseOrderPdfPreview';

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

const PurchaseOrderList = () => {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editPo, setEditPo] = useState(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [activePo, setActivePo] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);

  const queryArgs = {
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    sort: '-createdAt',
    search: search || undefined,
    vendorId: vendorFilter?._id || undefined,
    poStatus: statusFilter || undefined,
    ...(from ? { 'poDate[gte]': `${from}T00:00:00` } : {}),
    ...(to ? { 'poDate[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching } = useGetPurchaseOrdersQuery(queryArgs);
  const { data: statsRes } = useGetPurchaseOrderStatsQuery();
  const stats = statsRes?.data || {};
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' });
  const [cancelPo] = useCancelPurchaseOrderMutation();

  const openMenu = (e, row) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); setMenuRow(row); };
  const closeMenu = () => { setMenuAnchor(null); setMenuRow(null); };

  const onView = (r) => { navigate(`/procurement/purchase-orders/${r._id}`); closeMenu(); };
  const onEdit = (r) => { setEditPo(r); setFormOpen(true); closeMenu(); };
  const onApprove = (r) => { setActivePo(r); setApprovalOpen(true); closeMenu(); };
  const onRelease = (r) => { setActivePo(r); setReleaseOpen(true); closeMenu(); };
  const onPdf = (r) => { setActivePo(r); setPdfOpen(true); closeMenu(); };
  const onCancel = async (r) => {
    closeMenu();
    try { await cancelPo({ id: r._id }).unwrap(); enqueueSnackbar('PO cancelled', { variant: 'info' }); }
    catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to cancel', { variant: 'error' }); }
  };

  const actionsFor = (r) => {
    const a = [{ key: 'view', label: 'View', icon: <Eye size={16} />, fn: () => onView(r) }];
    if (r.approvalStatus === 'DRAFT') {
      a.push({ key: 'edit', label: 'Edit Draft', icon: <Pencil size={16} />, fn: () => onEdit(r) });
      a.push({ key: 'approve', label: 'Approve / Reject', icon: <CheckCircle2 size={16} />, fn: () => onApprove(r) });
    }
    if (r.approvalStatus === 'APPROVED' && r.releaseStatus !== 'RELEASED') {
      a.push({ key: 'release', label: 'Release to Supplier', icon: <Send size={16} />, fn: () => onRelease(r) });
    }
    if (r.poPdfUrl) {
      a.push({ key: 'pdf', label: 'Download PDF', icon: <FileDown size={16} />, fn: () => onPdf(r) });
    }
    if (!['FULLY_RECEIVED', 'CLOSED', 'CANCELLED'].includes(r.poStatus)) {
      a.push({ key: 'cancel', label: 'Cancel', icon: <Ban size={16} />, fn: () => onCancel(r) });
    }
    return a;
  };

  const columns = [
    { field: 'poNumber', headerName: 'PO NUMBER', width: 145,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'poDate', headerName: 'PO DATE', width: 100,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'indentNumber', headerName: 'INDENT NO', width: 115,
      renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value || '—'}</Typography> },
    { field: 'vendorName', headerName: 'VENDOR', flex: 1, minWidth: 170,
      renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    { field: 'leadTime', headerName: 'LEAD TIME', width: 100,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value || '—'}</Typography> },
    { field: 'grandTotal', headerName: 'GRAND TOTAL', width: 130, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtINR(p.value)}</Typography> },
    { field: 'poStatus', headerName: 'STATUS', width: 160,
      renderCell: (p) => <PoStatusChip status={p.value} /> },
    { field: 'releaseStatus', headerName: 'RELEASE', width: 120,
      renderCell: (p) => <PoReleaseChip status={p.value} /> },
    { field: 'createdBy', headerName: 'CREATED BY', width: 120, sortable: false,
      valueGetter: (_v, row) => row.createdBy?.name || '',
      renderCell: (p) => <Typography variant="body2" color="text.secondary" noWrap>{p.value || '—'}</Typography> },
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
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, color: '#0b2545' }}>Purchase Orders</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', fontWeight: 500 }}>
            Step 1.4 · Create PO &amp; release to supplier — only from approved quotations
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => { setEditPo(null); setFormOpen(true); }}>
          Create Purchase Order
        </Button>
      </Box>

      {/* KPIs */}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<ShoppingBag size={20} />}  label="Total POs"        value={stats.total}           color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<BadgeCheck size={20} />}   label="Approved"         value={stats.approved}        color="#0f766e" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<Truck size={20} />}        label="Released"         value={stats.released}        color="#7c3aed" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<PackageOpen size={20} />}  label="Partial Received" value={stats.partialReceived} color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<PackageCheck size={20} />} label="Fully Received"   value={stats.fullyReceived}   color="#16a34a" /></Grid>
      </Grid>

      {/* Filters */}
      <Paper sx={{ p: 1.5, borderRadius: '14px', display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField size="small" placeholder="Search PO / indent / vendor…" value={search} onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 250 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color="#94a3b8" /></InputAdornment> }} />
        <Autocomplete
          size="small" sx={{ minWidth: 200 }}
          options={partiesRes?.data || []}
          value={vendorFilter}
          getOptionLabel={(o) => o?.name || ''}
          isOptionEqualToValue={(o, v) => o._id === v._id}
          onChange={(_e, v) => setVendorFilter(v)}
          renderInput={(params) => <TextField {...params} label="Vendor" />}
        />
        <TextField size="small" select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">All</MenuItem>
          {PO_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
        </TextField>
        <TextField size="small" type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField size="small" type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
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
          onRowClick={(p) => navigate(`/procurement/purchase-orders/${p.id}`)}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          rowHeight={50}
          columnHeaderHeight={44}
          sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Paper>

      {/* Row actions */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuRow && actionsFor(menuRow).map((a) => (
          <MenuItem key={a.key} onClick={a.fn}>
            <ListItemIcon>{a.icon}</ListItemIcon>
            <ListItemText>{a.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      {/* Drawer + dialogs */}
      <PurchaseOrderFormDrawer open={formOpen} po={editPo} onClose={() => { setFormOpen(false); setEditPo(null); }} />
      <PurchaseOrderApprovalDialog open={approvalOpen} po={activePo} onClose={() => { setApprovalOpen(false); setActivePo(null); }} />
      <PurchaseOrderReleaseDialog open={releaseOpen} po={activePo} onClose={() => { setReleaseOpen(false); setActivePo(null); }} />
      <PurchaseOrderPdfPreview open={pdfOpen} po={activePo} onClose={() => { setPdfOpen(false); setActivePo(null); }} />
    </Box>
  );
};

export default PurchaseOrderList;
