import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  IconButton, Menu, ListItemIcon, ListItemText, Grid, Tooltip, Autocomplete, Chip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Plus, MoreVertical, Eye, Pencil, PackageCheck, Ban, FileDown,
  FileStack, PackageOpen, Boxes, Hourglass, Trash2, Lock, ClipboardCheck,
} from 'lucide-react';
import { usePermissions } from '../../../hooks/usePermission';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import {
  useGetGrnsQuery,
  useGetGrnStatsQuery,
  useCancelGrnMutation,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { GrnStatusChip, GRN_STATUSES, fmtDate, isGrnDraft, isGrnCompleted } from './grnMeta';
import GrnQcStatusChip from './GrnQcStatusChip';
import { resolveGrnQcStage } from './grnQcStage';
import GrnFormDialog from './GrnFormDialog';
import GrnCompleteDialog from './GrnCompleteDialog';
import GrnDeleteDialog from './GrnDeleteDialog';
import { resolveFileUrl } from '../../../utils/fileUrl';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx } from '../pfmsTheme';

const GrnList = () => {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [poNumber, setPoNumber] = useState('');
  const [poTypeFilter, setPoTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editGrn, setEditGrn] = useState(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [activeGrn, setActiveGrn] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const canDeleteGrn = usePermissions().can('procurement.deleteGrn');

  const queryArgs = {
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    sort: '-createdAt',
    search: search || undefined,
    vendorId: vendorFilter?._id || undefined,
    poNumber: poNumber || undefined,
    isWithoutPo: poTypeFilter || undefined,
    grnStatus: statusFilter || undefined,
    ...(from ? { 'grnDate[gte]': `${from}T00:00:00` } : {}),
    ...(to ? { 'grnDate[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching } = useGetGrnsQuery(queryArgs);
  const { data: statsRes } = useGetGrnStatsQuery();
  const stats = statsRes?.data || {};
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' });
  const [cancelGrn] = useCancelGrnMutation();

  const openMenu = (e, row) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); setMenuRow(row); };
  const closeMenu = () => { setMenuAnchor(null); setMenuRow(null); };

  const onView = (r) => { navigate(`/procurement/grns/${r._id}`); closeMenu(); };
  const onEdit = (r) => { setEditGrn(r); setFormOpen(true); closeMenu(); };
  const onComplete = (r) => { setActiveGrn(r); setCompleteOpen(true); closeMenu(); };
  const onPdf = (r) => { window.open(resolveFileUrl(r.grnPdfUrl), '_blank'); closeMenu(); };
  const onCancel = async (r) => {
    closeMenu();
    try { await cancelGrn({ id: r._id }).unwrap(); enqueueSnackbar('GRN cancelled', { variant: 'info' }); }
    catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to cancel', { variant: 'error' }); }
  };

  const onDelete = (r) => { setDeleteTarget(r); closeMenu(); };

  // DRAFT → Edit | Complete | Cancel | Delete. Completed GRNs are view-only.
  const actionsFor = (r) => {
    const a = [{ key: 'view', label: isGrnCompleted(r) ? 'View (read-only)' : 'View', icon: <Eye size={16} />, fn: () => onView(r) }];
    if (isGrnDraft(r)) {
      a.push({ key: 'edit', label: 'Edit Draft', icon: <Pencil size={16} />, fn: () => onEdit(r) });
      a.push({ key: 'complete', label: 'Complete & Post Stock', icon: <PackageCheck size={16} />, fn: () => onComplete(r) });
      a.push({ key: 'cancel', label: 'Cancel', icon: <Ban size={16} />, fn: () => onCancel(r) });
      if (canDeleteGrn) a.push({ key: 'delete', label: 'Delete Draft', icon: <Trash2 size={16} />, fn: () => onDelete(r), danger: true });
    }
    if (isGrnCompleted(r)) {
      a.push({ key: 'qc', label: 'Incoming QC', icon: <ClipboardCheck size={16} />, fn: () => { navigate(`/procurement/grns/${r._id}#qc`); closeMenu(); } });
    }
    if (r.grnPdfUrl) a.push({ key: 'pdf', label: 'Download GRN PDF', icon: <FileDown size={16} />, fn: () => onPdf(r) });
    return a;
  };

  const columns = [
    { field: 'grnNumber', headerName: 'GRN NUMBER', width: 150,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'grnDate', headerName: 'GRN DATE', width: 100,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'poNumber', headerName: 'PO NUMBER', width: 140,
      renderCell: (p) => (p.row.isWithoutPo
        ? <Chip size="small" variant="outlined" color="warning" label="Without PO" sx={{ fontWeight: 700 }} />
        : <Typography variant="body2" fontWeight={600}>{p.value || '—'}</Typography>) },
    { field: 'vendorName', headerName: 'VENDOR', flex: 1, minWidth: 160,
      renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    // GRN and QC are one step — the QC (done on the GRN page) shows beside its GRN,
    // early in the row so it stays on screen on a laptop-width grid. Same resolver
    // as the GRN page; the list has no QC record loaded, so a GRN whose QC is not
    // completed reads "QC Pending" — never "done".
    { field: 'qcStatus', headerName: 'QC', width: 170, sortable: false,
      renderCell: (p) => <GrnQcStatusChip stage={resolveGrnQcStage(p.row)} /> },
    { field: 'items', headerName: 'ITEMS', width: 75, align: 'right', headerAlign: 'right', sortable: false,
      valueGetter: (_v, row) => (row.items || []).length },
    { field: 'totalInvoiceQty', headerName: 'INVOICE QTY', width: 110, align: 'right', headerAlign: 'right' },
    { field: 'totalReceivedQty', headerName: 'RECEIVED QTY', width: 115, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" sx={{ color: '#0f766e', fontWeight: 700 }}>{p.value}</Typography> },
    { field: 'totalShortQty', headerName: 'SHORT QTY', width: 100, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" sx={{ color: p.value > 0 ? '#b45309' : 'text.secondary', fontWeight: p.value > 0 ? 700 : 400 }}>{p.value || 0}</Typography> },
    { field: 'grnStatus', headerName: 'STATUS', width: 150,
      renderCell: (p) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <GrnStatusChip status={p.value} />
          {isGrnCompleted(p.row) && (
            <Tooltip title="Completed — stock posted. Read-only: cannot be edited or deleted.">
              <Box component="span" sx={{ display: 'inline-flex', color: PFMS.faint }}><Lock size={14} /></Box>
            </Tooltip>
          )}
        </Box>
      ) },
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
          <Typography sx={pfmsTitleSx}>GRN &amp; QC ({stats.total || 0})</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>
            Receive material, then inspect it — the QC form is on each GRN page, under the GRN
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => { setEditGrn(null); setFormOpen(true); }}>
          New GRN
        </Button>
      </Box>

      {/* KPIs */}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<FileStack size={20} />}   label="Total GRNs"       value={stats.total}           color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<PackageOpen size={20} />}  label="Partial Received" value={stats.partialReceived} color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<PackageCheck size={20} />} label="Fully Received"   value={stats.fullyReceived}   color="#0f766e" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Boxes size={20} />}        label="Received Qty"     value={stats.receivedQty}     color="#16a34a" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Hourglass size={20} />}    label="Pending Qty"      value={stats.pendingQty}      color="#be123c" /></Grid>
      </Grid>

      {/* Filters */}
      <Paper sx={{ ...pfmsCardSx, p: 1, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField size="small" placeholder="Search GRN / vendor / invoice…" value={search} onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 230 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
        <Autocomplete
          size="small" sx={{ minWidth: 180 }}
          options={partiesRes?.data || []}
          value={vendorFilter}
          getOptionLabel={(o) => o?.name || ''}
          isOptionEqualToValue={(o, v) => o._id === v._id}
          onChange={(_e, v) => setVendorFilter(v)}
          renderInput={(params) => <TextField {...params} label="Vendor" />}
        />
        <TextField size="small" label="PO Number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} sx={{ minWidth: 150 }} />
        <TextField size="small" select label="PO Type" value={poTypeFilter} onChange={(e) => setPoTypeFilter(e.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value="">All</MenuItem>
          <MenuItem value="false">Against PO</MenuItem>
          <MenuItem value="true">Without PO</MenuItem>
        </TextField>
        <TextField size="small" select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          {GRN_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
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
          onRowClick={(p) => navigate(`/procurement/grns/${p.id}`)}
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
          <MenuItem key={a.key} onClick={a.fn} sx={a.danger ? { color: 'error.main' } : undefined}>
            <ListItemIcon sx={a.danger ? { color: 'error.main' } : undefined}>{a.icon}</ListItemIcon>
            <ListItemText>{a.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      {/* Form + dialogs */}
      <GrnFormDialog open={formOpen} grn={editGrn} onClose={(_saved, created) => {
        setFormOpen(false); setEditGrn(null);
        // A new GRN opens on its page, where Complete, MD approval and the QC section sit together.
        if (created?._id && !editGrn) navigate(`/procurement/grns/${created._id}`);
      }} />
      <GrnCompleteDialog open={completeOpen} grn={activeGrn} onClose={() => { setCompleteOpen(false); setActiveGrn(null); }} />
      <GrnDeleteDialog open={Boolean(deleteTarget)} grn={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </Box>
  );
};

export default GrnList;
