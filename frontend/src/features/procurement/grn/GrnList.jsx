import React, { useState } from 'react';
import { serialColumn } from '../components/serialNumber';
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
import AdaptiveFilterBar from '../components/AdaptiveFilterBar';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import { GrnStatusChip, GRN_STATUSES, fmtDate, isGrnDraft, isGrnCompleted } from './grnMeta';
import GrnQcStatusChip from './GrnQcStatusChip';
import { resolveGrnQcStage } from './grnQcStage';
import GrnFormDialog from './GrnFormDialog';
import GrnCompleteDialog from './GrnCompleteDialog';
import GrnDeleteDialog from './GrnDeleteDialog';
import { resolveFileUrl } from '../../../utils/fileUrl';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';

import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
const GrnList = () => {
  const navigate = useNavigate();
  const rowNav = useRowNavigation({ to: (r) => `/procurement/grns/${r._id}` });
  const { enqueueSnackbar } = useSnackbar();

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [poNumber, setPoNumber] = useState('');
  const [poTypeFilter, setPoTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };

  // "Filters" covers Vendor, PO Number, PO Type and the date range — Status
  // stays always visible (the field most GRN lookups start from).
  const secondaryCount = [vendorFilter, poNumber, poTypeFilter, from, to].filter(Boolean).length;
  const clearSecondary = () => { setVendorFilter(null); setPoNumber(''); setPoTypeFilter(''); setFrom(''); setTo(''); resetPage(); };
  const anyFilterActive = Boolean(search || statusFilter || secondaryCount);
  const clearAll = () => { resetSearch(); setStatusFilter(''); clearSecondary(); };

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
      a.push({ key: 'complete', label: 'Complete GRN', icon: <PackageCheck size={16} />, fn: () => onComplete(r) });
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
    serialColumn(),
    { field: 'grnNumber', headerName: 'GRN NUMBER', width: 150,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'grnDate', headerName: 'GRN DATE', width: 100,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'poNumber', headerName: 'PO NUMBER', width: 150, sortable: false,
      renderCell: (p) => {
        if (p.row.isWithoutPo) return <Chip size="small" variant="outlined" color="warning" label="Without PO" sx={{ fontWeight: 700 }} />;
        const nums = p.row.poNumbers?.length ? p.row.poNumbers : [p.value];
        const [first, ...rest] = nums.filter(Boolean);
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap>{first || '—'}</Typography>
            {rest.length > 0 && <Chip size="small" label={`+${rest.length} more`} title={rest.join(', ')} sx={{ fontWeight: 700, height: 18 }} />}
          </Box>
        );
      } },
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
            <Tooltip title={p.row.stockPostingStage ? 'Completed — stock posts at QC. Read-only: cannot be edited or deleted.' : 'Completed — stock posted. Read-only: cannot be edited or deleted.'}>
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

      {/* Filters — Search + Status stay visible; Vendor, PO Number, PO Type
          and the date range move into Filters, which only counts those as
          active. PO Number stays a separate EXACT filter (not a duplicate of
          Search) — Search fuzzy-matches poNumber by substring, this isolates
          one PO's GRNs precisely even when PO numbers share a prefix. */}
      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <AdaptiveFilterBar
          pinned={[
            { key: 'search', minWidth: 220, node: (
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 220px' }, minWidth: 0 }}>
                <Typography component="label" htmlFor="grn-search" sx={pfmsFieldLabelSx}>Search</Typography>
                <TextField id="grn-search" size="small" fullWidth placeholder="Search GRN / vendor / invoice…"
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
              </Box>
            ) },
            { key: 'status', minWidth: 160, node: (
              <Box sx={{ flex: '0 1 160px', minWidth: 140 }}>
                <Typography component="label" htmlFor="grn-status" sx={pfmsFieldLabelSx}>Status</Typography>
                <TextField id="grn-status" size="small" select fullWidth value={statusFilter}
                  SelectProps={ALL_WHEN_UNSET} onChange={(e) => onFilterChange(setStatusFilter)(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {GRN_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
                </TextField>
              </Box>
            ) },
          ]}
          items={[
            {
              key: 'vendor', width: 200, active: Boolean(vendorFilter),
              node: (
                <Box sx={{ flex: '0 1 200px', minWidth: 180 }}>
                  <Autocomplete
                    size="small" fullWidth
                    options={partiesRes?.data || []}
                    value={vendorFilter}
                    getOptionLabel={(o) => o?.name || ''}
                    isOptionEqualToValue={(o, v) => o._id === v._id}
                    onChange={(_e, v) => onFilterChange(setVendorFilter)(v)}
                    renderInput={(params) => <TextField {...params} label="Vendor" />}
                  />
                </Box>
              ),
            },
            {
              key: 'poNumber', width: 150, active: Boolean(poNumber),
              node: (
                <Box sx={{ flex: '0 1 150px', minWidth: 130 }}>
                  <TextField size="small" fullWidth label="PO Number" value={poNumber} onChange={(e) => onFilterChange(setPoNumber)(e.target.value)} />
                </Box>
              ),
            },
            {
              key: 'poType', width: 150, active: Boolean(poTypeFilter),
              node: (
                <Box sx={{ flex: '0 1 150px', minWidth: 130 }}>
                  <TextField size="small" select fullWidth label="PO Type" value={poTypeFilter}
                    InputLabelProps={{ shrink: true }}
                    SelectProps={ALL_WHEN_UNSET} onChange={(e) => onFilterChange(setPoTypeFilter)(e.target.value)}>
                    <MenuItem value="">All</MenuItem>
                    <MenuItem value="false">Against PO</MenuItem>
                    <MenuItem value="true">Without PO</MenuItem>
                  </TextField>
                </Box>
              ),
            },
            {
              key: 'from', width: 150, active: Boolean(from),
              node: (
                <Box sx={{ flex: '0 1 150px', minWidth: 132 }}>
                  <DateInputDDMMYYYY size="small" label="From" fullWidth value={from} onChange={onFilterChange(setFrom)} sx={{ width: '100%' }} />
                </Box>
              ),
            },
            {
              key: 'to', width: 150, active: Boolean(to),
              node: (
                <Box sx={{ flex: '0 1 150px', minWidth: 132 }}>
                  <DateInputDDMMYYYY size="small" label="To" fullWidth value={to} onChange={onFilterChange(setTo)} sx={{ width: '100%' }} />
                </Box>
              ),
            },
          ]}
          onClearSecondary={clearSecondary}
          onClearAll={clearAll}
          anyActive={anyFilterActive}
        />
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
          {...rowNav.gridProps}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          rowHeight={50}
          columnHeaderHeight={44}
          sx={[{ border: 0 }, rowNavigationGridSx]}
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
