import React, { useState } from 'react';
import { serialColumn } from '../components/serialNumber';
import { stepTimingColumns } from '../components/stepTimingColumns';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  IconButton, Menu, ListItemIcon, ListItemText, Grid, Tooltip, Autocomplete, Tabs, Tab,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Plus, MoreVertical, Eye, Pencil, CheckCircle2, Send, FileDown,
  Ban, ShoppingBag, BadgeCheck, Truck, PackageOpen, PackageCheck, RotateCcw, SendHorizontal,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import {
  useGetPurchaseOrdersQuery,
  useGetPurchaseOrderStatsQuery,
  useCancelPurchaseOrderMutation,
  useGeneratePurchaseOrderPdfMutation,
  useGetAllApprovedItemsQuery,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import AdaptiveFilterBar from '../components/AdaptiveFilterBar';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import { PoStatusChip, PoReleaseChip, PO_STATUSES, fmtINR, fmtDate, poDisplayNumber } from './poMeta';
import { PoPiChip } from '../proforma-invoices/piMeta';
import PurchaseOrderFormDrawer from './PurchaseOrderFormDrawer';
import PurchaseOrderApprovalDialog from './PurchaseOrderApprovalDialog';
import PurchaseOrderReleaseDialog from './PurchaseOrderReleaseDialog';
import PurchaseOrderPdfPreview from './PurchaseOrderPdfPreview';
import BulkReleasePoDialog from './BulkReleasePoDialog';
import PoItemsQuickViewDialog from './PoItemsQuickViewDialog';
import PendingForPoGrid from './PendingForPoGrid';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';

import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
const PurchaseOrderList = () => {
  const navigate = useNavigate();
  const rowNav = useRowNavigation({ to: (r) => `/procurement/purchase-orders/${r._id}` });
  const { enqueueSnackbar } = useSnackbar();

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };

  // "Filters" covers Vendor, From and To — Status stays always visible.
  const secondaryCount = [vendorFilter, from, to].filter(Boolean).length;
  const clearSecondary = () => { setVendorFilter(null); setFrom(''); setTo(''); resetPage(); };
  const anyFilterActive = Boolean(search || statusFilter || secondaryCount);
  const clearAll = () => { resetSearch(); setStatusFilter(''); clearSecondary(); };

  // 'orders' = the PO list; 'pending' = approved indent items not yet on an
  // active PO (same source as the Create PO drawer's item picker).
  const [view, setView] = useState('orders');
  const { data: pendingRes, isFetching: pendingFetching } = useGetAllApprovedItemsQuery();
  const pendingItems = pendingRes?.data?.items || [];
  // Create PO from a pending row — the drawer pre-selects just that item.
  const [presetIndent, setPresetIndent] = useState(null);
  const [presetItemIds, setPresetItemIds] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editPo, setEditPo] = useState(null);
  const [reviseFromPo, setReviseFromPo] = useState(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [bulkReleaseOpen, setBulkReleaseOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [itemsPo, setItemsPo] = useState(null); // row whose item quick view is open
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
  const [generatePoPdf] = useGeneratePurchaseOrderPdfMutation();

  const openMenu = (e, row) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); setMenuRow(row); };
  const closeMenu = () => { setMenuAnchor(null); setMenuRow(null); };

  const onView = (r) => { navigate(`/procurement/purchase-orders/${r._id}`); closeMenu(); };
  const onEdit = (r) => { setReviseFromPo(null); setEditPo(r); setFormOpen(true); closeMenu(); };
  const onRevise = (r) => { setEditPo(null); setReviseFromPo(r); setFormOpen(true); closeMenu(); };
  const onCreateFromPending = (item) => {
    setEditPo(null); setReviseFromPo(null);
    setPresetIndent({ _id: item.indentId, indentNumber: item.indentNumber });
    setPresetItemIds([item.indentItemId]);
    setFormOpen(true);
  };
  const onApprove = (r) => { setActivePo(r); setApprovalOpen(true); closeMenu(); };
  const onRelease = (r) => { setActivePo(r); setReleaseOpen(true); closeMenu(); };
  // A DRAFT/APPROVED (not yet released) PO has no stored poPdfUrl — release()
  // is the only place that generates one. Generate on demand here so Preview
  // works at any stage, reusing the same generatePdf() release() itself calls.
  const onPdf = async (r) => {
    closeMenu();
    if (r.poPdfUrl) { setActivePo(r); setPdfOpen(true); return; }
    try {
      const res = await generatePoPdf({ id: r._id }).unwrap();
      setActivePo({ ...r, poPdfUrl: res?.data?.poPdfUrl, poPdfFileName: res?.data?.poPdfFileName });
      setPdfOpen(true);
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to generate PDF', { variant: 'error' }); }
  };
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
    a.push({ key: 'pdf', label: r.poPdfUrl ? 'Download PDF' : 'Preview PDF', icon: <FileDown size={16} />, fn: () => onPdf(r) });
    if (!['FULLY_RECEIVED', 'CLOSED', 'CANCELLED'].includes(r.poStatus)) {
      a.push({ key: 'cancel', label: 'Cancel', icon: <Ban size={16} />, fn: () => onCancel(r) });
    }
    if (r.poStatus === 'CANCELLED') {
      a.push({ key: 'revise', label: 'Revise PO', icon: <RotateCcw size={16} />, fn: () => onRevise(r) });
    }
    return a;
  };

  const columns = [
    serialColumn(),
    // The eye opens the item quick view (popup — the list stays put); the
    // full PO page stays on row click and the menu's View. It sits right after
    // the number (not in the far-right actions column) so it is on screen
    // without scrolling the wide grid sideways; tinted + outlined so it reads
    // as a button. Width fits "AGL/PO-1234/26-27" + the button without ellipsis.
    { field: 'poNumber', headerName: 'PO NUMBER', width: 215,
      renderCell: (p) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%', minWidth: 0 }}>
          <Typography variant="body2" fontWeight={700} color={p.value ? 'primary.main' : 'text.secondary'} noWrap sx={{ minWidth: 0 }}>
            {poDisplayNumber(p.row)}
          </Typography>
          <Tooltip title="View Item Details">
            <IconButton size="small" aria-label={`View item details for ${poDisplayNumber(p.row)}`}
              data-testid="po-row-view"
              onClick={(e) => { e.stopPropagation(); setItemsPo(p.row); }}
              sx={(t) => ({
                flexShrink: 0, width: 26, height: 26, borderRadius: '6px', color: 'primary.main',
                bgcolor: alpha(t.palette.primary.main, 0.08), border: `1px solid ${alpha(t.palette.primary.main, 0.3)}`,
                '&:hover': { bgcolor: alpha(t.palette.primary.main, 0.16) },
              })}>
              <Eye size={16} strokeWidth={2.2} />
            </IconButton>
          </Tooltip>
        </Box>
      ) },
    { field: 'poDate', headerName: 'PO DATE', width: 100,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'expectedDeliveryDate', headerName: 'EXPECTED DELIVERY', width: 140,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'indentNumber', headerName: 'INDENT / ITEM REF', width: 165, sortable: false,
      renderCell: (p) => {
        // Prefer item-level references stamped on the PO lines; fall back to the
        // header indent number for legacy POs without per-line refs.
        const refs = [...new Set((p.row.items || []).map((it) => it.indentItemDisplayNumber).filter(Boolean))];
        if (!refs.length) return <Typography variant="body2" fontWeight={600}>{p.value || '—'}</Typography>;
        const extra = refs.length > 1 ? ` +${refs.length - 1} more` : '';
        return (
          <Tooltip title={refs.join(', ')}>
            <Typography variant="body2" fontWeight={600} color="primary.main" noWrap>{refs[0]}{extra}</Typography>
          </Tooltip>
        );
      } },
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
    { field: 'piStatus', headerName: 'PI', width: 150, sortable: false,
      renderCell: (p) => <PoPiChip status={p.value} /> },
    { field: 'createdBy', headerName: 'CREATED BY', width: 120, sortable: false,
      valueGetter: (_v, row) => row.createdBy?.name || '',
      renderCell: (p) => <Typography variant="body2" color="text.secondary" noWrap>{p.value || '—'}</Typography> },
    ...stepTimingColumns(),
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
          <Typography sx={pfmsTitleSx}>Purchase Orders ({stats.total || 0})</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>
            Step 1.4 · Create PO &amp; release to supplier — only from approved quotations
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<SendHorizontal size={16} />} onClick={() => setBulkReleaseOpen(true)}>
            Bulk Release PO
          </Button>
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => { setEditPo(null); setFormOpen(true); }}>
            Create Purchase Order
          </Button>
        </Box>
      </Box>

      {/* KPIs */}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<ShoppingBag size={20} />}  label="Total POs"        value={stats.total}           color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<BadgeCheck size={20} />}   label="Approved"         value={stats.approved}        color="#0f766e" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Truck size={20} />}        label="Released"         value={stats.released}        color="#0f766e" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<PackageOpen size={20} />}  label="Partial Received" value={stats.partialReceived} color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<PackageCheck size={20} />} label="Fully Received"   value={stats.fullyReceived}   color="#16a34a" /></Grid>
      </Grid>

      <Tabs value={view} onChange={(_e, v) => setView(v)}
        sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, fontWeight: 700, textTransform: 'none' } }}>
        <Tab value="orders" label="Purchase Orders" />
        <Tab value="pending" label={`Pending for PO (${pendingItems.length})`} />
      </Tabs>

      {view === 'pending' ? (
        <PendingForPoGrid items={pendingItems} loading={pendingFetching} onCreatePo={onCreateFromPending} />
      ) : (<>
      {/* Filters — Search + Status stay visible; Vendor and the date range
          move into Filters, which only counts those as active. */}
      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <AdaptiveFilterBar
          pinned={[
            { key: 'search', minWidth: 220, node: (
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 220px' }, minWidth: 0 }}>
                <Typography component="label" htmlFor="po-search" sx={pfmsFieldLabelSx}>Search</Typography>
                <TextField id="po-search" size="small" fullWidth placeholder="Search PO / indent / vendor…"
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
              </Box>
            ) },
            { key: 'status', minWidth: 180, node: (
              <Box sx={{ flex: '0 1 180px', minWidth: 150 }}>
                <Typography component="label" htmlFor="po-status" sx={pfmsFieldLabelSx}>Status</Typography>
                <TextField id="po-status" size="small" select fullWidth value={statusFilter}
                  SelectProps={ALL_WHEN_UNSET} onChange={(e) => onFilterChange(setStatusFilter)(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {PO_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
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
      </>)}

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
      <PurchaseOrderFormDrawer open={formOpen} po={editPo} reviseFrom={reviseFromPo}
        presetIndent={presetIndent} presetItemIds={presetItemIds}
        onClose={() => { setFormOpen(false); setEditPo(null); setReviseFromPo(null); setPresetIndent(null); setPresetItemIds(null); }} />
      <PurchaseOrderApprovalDialog open={approvalOpen} po={activePo} onClose={() => { setApprovalOpen(false); setActivePo(null); }} />
      <PurchaseOrderReleaseDialog open={releaseOpen} po={activePo} onClose={() => { setReleaseOpen(false); setActivePo(null); }} />
      <PurchaseOrderPdfPreview open={pdfOpen} po={activePo} onClose={() => { setPdfOpen(false); setActivePo(null); }} />
      <BulkReleasePoDialog open={bulkReleaseOpen} onClose={() => setBulkReleaseOpen(false)} />
      <PoItemsQuickViewDialog po={itemsPo} onClose={() => setItemsPo(null)} />
    </Box>
  );
};

export default PurchaseOrderList;
