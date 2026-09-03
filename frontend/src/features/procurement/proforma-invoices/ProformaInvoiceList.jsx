import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  IconButton, Menu, ListItemIcon, ListItemText, Grid, Tooltip, Autocomplete,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Plus, MoreVertical, Eye, Pencil, CheckCircle2, XCircle, Ban,
  FileDown, ReceiptText, Hourglass, BadgeCheck, Wallet, CircleSlash,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import {
  useGetProformaInvoicesQuery,
  useGetProformaInvoiceStatsQuery,
  useCancelProformaInvoiceMutation,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { PiStatusChip, PI_STATUSES, fmtINR, fmtDate } from './piMeta';
import ProformaInvoiceFormDrawer from './ProformaInvoiceFormDrawer';
import ProformaInvoiceApprovalDialog from './ProformaInvoiceApprovalDialog';
import ProformaInvoicePdfPreview from './ProformaInvoicePdfPreview';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx } from '../pfmsTheme';

const sumQty = (items, key) => (items || []).reduce((s, it) => s + (Number(it[key]) || 0), 0);

const ProformaInvoiceList = () => {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editPi, setEditPi] = useState(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [activePi, setActivePi] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);

  const queryArgs = {
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    sort: '-createdAt',
    search: search || undefined,
    vendorId: vendorFilter?._id || undefined,
    piStatus: statusFilter || undefined,
    ...(from ? { 'piDate[gte]': `${from}T00:00:00` } : {}),
    ...(to ? { 'piDate[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching } = useGetProformaInvoicesQuery(queryArgs);
  const { data: statsRes } = useGetProformaInvoiceStatsQuery();
  const stats = statsRes?.data || {};
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' });
  const [cancelPi] = useCancelProformaInvoiceMutation();

  const openMenu = (e, row) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); setMenuRow(row); };
  const closeMenu = () => { setMenuAnchor(null); setMenuRow(null); };

  const onView = (r) => { navigate(`/procurement/proforma-invoices/${r._id}`); closeMenu(); };
  const onEdit = (r) => { setEditPi(r); setFormOpen(true); closeMenu(); };
  const onApprove = (r) => { setActivePi(r); setApprovalOpen(true); closeMenu(); };
  const onPdf = (r) => { setActivePi(r); setPdfOpen(true); closeMenu(); };
  const onCancel = async (r) => {
    closeMenu();
    try { await cancelPi({ id: r._id }).unwrap(); enqueueSnackbar('PI cancelled', { variant: 'info' }); }
    catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to cancel', { variant: 'error' }); }
  };

  const actionsFor = (r) => {
    const a = [{ key: 'view', label: 'View', icon: <Eye size={16} />, fn: () => onView(r) }];
    const editable = ['DRAFT', 'RECEIVED'].includes(r.piStatus) && r.approvalStatus !== 'APPROVED';
    if (editable) {
      a.push({ key: 'edit', label: 'Edit Draft', icon: <Pencil size={16} />, fn: () => onEdit(r) });
      a.push({ key: 'approve', label: 'Approve / Reject', icon: <CheckCircle2 size={16} />, fn: () => onApprove(r) });
    }
    if (r.piDocument?.fileUrl) {
      a.push({ key: 'pdf', label: 'Download PI', icon: <FileDown size={16} />, fn: () => onPdf(r) });
    }
    if (r.piStatus !== 'CANCELLED') {
      a.push({ key: 'cancel', label: 'Cancel', icon: <Ban size={16} />, fn: () => onCancel(r) });
    }
    return a;
  };

  const columns = [
    { field: 'piDate', headerName: 'PI DATE', width: 95,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'piNumber', headerName: 'PI NUMBER', width: 120,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'poNumber', headerName: 'PO NUMBER', width: 140,
      renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value || '—'}</Typography> },
    { field: 'vendorName', headerName: 'VENDOR', flex: 1, minWidth: 150,
      renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    { field: 'description', headerName: 'DESCRIPTION', flex: 1, minWidth: 160, sortable: false,
      valueGetter: (_v, row) => {
        const items = row.items || [];
        if (!items.length) return '—';
        return items.length === 1 ? items[0].itemName : `${items[0].itemName} +${items.length - 1} more`;
      },
      renderCell: (p) => <Typography variant="body2" color="text.secondary" noWrap>{p.value}</Typography> },
    { field: 'qty', headerName: 'QTY', width: 75, align: 'right', headerAlign: 'right', sortable: false,
      valueGetter: (_v, row) => sumQty(row.items, 'quantity') },
    { field: 'receivedQty', headerName: 'RECEIVED', width: 90, align: 'right', headerAlign: 'right', sortable: false,
      valueGetter: (_v, row) => sumQty(row.items, 'receivedQty') },
    { field: 'balanceQty', headerName: 'BALANCE QTY', width: 105, align: 'right', headerAlign: 'right', sortable: false,
      valueGetter: (_v, row) => sumQty(row.items, 'balanceQty') },
    { field: 'totalValue', headerName: 'TOTAL VALUE', width: 120, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtINR(p.value)}</Typography> },
    { field: 'paidAmount', headerName: 'PAID', width: 100, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" sx={{ color: '#0f766e', fontVariantNumeric: 'tabular-nums' }}>{fmtINR(p.value)}</Typography> },
    { field: 'balanceAmount', headerName: 'BALANCE AMT', width: 115, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" sx={{ color: p.value > 0 ? '#b45309' : '#0f766e', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtINR(p.value)}</Typography> },
    { field: 'piStatus', headerName: 'STATUS', width: 150,
      renderCell: (p) => <PiStatusChip status={p.value} /> },
    { field: '__actions', headerName: '', width: 60, sortable: false, filterable: false, align: 'center',
      renderCell: (p) => (
        <Tooltip title="Actions">
          <IconButton size="small" onClick={(e) => openMenu(e, p.row)}><MoreVertical size={16} /></IconButton>
        </Tooltip>
      ) },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, ...pfmsPageSx }}>
      {/* Header */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={pfmsTitleSx}>PI Forms ({stats.total || 0})</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>
            Step 1.6 · Proforma Invoice management — prerequisite for advance payment
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => { setEditPi(null); setFormOpen(true); }}>
          New PI
        </Button>
      </Box>

      {/* KPIs */}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<ReceiptText size={20} />} label="Total PI"          value={stats.total}           color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Hourglass size={20} />}   label="Pending Approval"  value={stats.pendingApproval} color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<BadgeCheck size={20} />}  label="Approved"          value={stats.approved}        color="#0f766e" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Wallet size={20} />}      label="Ready For Payment" value={stats.readyForPayment} color="#16a34a" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<CircleSlash size={20} />} label="Cancelled"         value={stats.cancelled}       color="#be123c" /></Grid>
      </Grid>

      {/* Filters */}
      <Paper sx={{ ...pfmsCardSx, p: 1, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField size="small" placeholder="Search PI / PO / vendor…" value={search} onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 240 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
        <Autocomplete
          size="small" sx={{ minWidth: 190 }}
          options={partiesRes?.data || []}
          value={vendorFilter}
          getOptionLabel={(o) => o?.name || ''}
          isOptionEqualToValue={(o, v) => o._id === v._id}
          onChange={(_e, v) => setVendorFilter(v)}
          renderInput={(params) => <TextField {...params} label="Vendor" />}
        />
        <TextField size="small" select label="PI Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 190 }}>
          <MenuItem value="">All</MenuItem>
          {PI_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
        </TextField>
        <DateInputDDMMYYYY size="small" label="From" value={from} onChange={setFrom} />
        <DateInputDDMMYYYY size="small" label="To" value={to} onChange={setTo} />
      </Paper>

      {/* Grid */}
      <Paper sx={{ ...pfmsCardSx, flexGrow: 1, minHeight: 420, overflow: 'hidden' }}>
        <DataGrid
          rows={data?.data || []}
          columns={columns}
          getRowId={(r) => r._id}
          loading={isLoading || isFetching}
          paginationMode="server"
          rowCount={data?.meta?.total || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          onRowClick={(p) => navigate(`/procurement/proforma-invoices/${p.id}`)}
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

      {/* Form + dialogs */}
      <ProformaInvoiceFormDrawer open={formOpen} pi={editPi} onClose={() => { setFormOpen(false); setEditPi(null); }} />
      <ProformaInvoiceApprovalDialog open={approvalOpen} pi={activePi} onClose={() => { setApprovalOpen(false); setActivePi(null); }} />
      <ProformaInvoicePdfPreview open={pdfOpen} pi={activePi} onClose={() => { setPdfOpen(false); setActivePi(null); }} />
    </Box>
  );
};

export default ProformaInvoiceList;
