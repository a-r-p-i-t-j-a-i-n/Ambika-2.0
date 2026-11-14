import React, { useState, useRef } from 'react';
import { serialColumn } from '../components/serialNumber';
import { stepTimingColumns } from '../components/stepTimingColumns';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem, Tooltip,
  Autocomplete, Tabs, Tab,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Plus, Eye, Pencil, CheckCircle2, Send, FileText,
  Ban, ShoppingBag, BadgeCheck, Truck, PackageOpen, PackageCheck, RotateCcw, SendHorizontal,
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import {
  useGetPurchaseOrdersQuery,
  useGetPurchaseOrderStatsQuery,
  useCancelPurchaseOrderMutation,
  useGeneratePurchaseOrderPdfMutation,
  useGetAllApprovedItemsQuery,
  useDeletePurchaseOrderMutation,
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
import { useKpiFilter, listEmptyLabel } from '../components/useKpiFilter';
import RowActionsCell from '../components/RowActionsCell';
import RowActionsMenu from '../components/RowActionsMenu';
import { usePermissions } from '../../../hooks/usePermission';
import useRecordDelete from '../components/useRecordDelete';
import { rowActionsColumn, rowActionsGridProps, rowActionsGridSx } from '../components/rowActionsColumn';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET, pfmsKpiRowSx } from '../pfmsTheme';

import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
// Open POs still awaiting material: what GRN › Pending Qty sums over.
const OPEN_FOR_RECEIPT = 'RELEASED_TO_VENDOR,PARTIAL_RECEIVED';

const PurchaseOrderList = () => {
  const navigate = useNavigate();
  const rowNav = useRowNavigation({ to: (r) => `/procurement/purchase-orders/${r._id}` });
  const { enqueueSnackbar } = useSnackbar();

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [vendorFilter, setVendorFilter] = useState(null);
  // GRN › "Pending Qty" opens this list with ?poStatus=RELEASED_TO_VENDOR,PARTIAL_RECEIVED
  // — the POs whose open lines that card sums. Only that exact preset is
  // honoured; the first status change drops it from the address.
  const [params, setParams] = useSearchParams();
  const [statusFilter, setStatusFilterState] = useState(() => (params.get('poStatus') === OPEN_FOR_RECEIPT ? OPEN_FOR_RECEIPT : ''));
  const setStatusFilter = (v) => {
    setStatusFilterState(v);
    if (params.has('poStatus')) {
      const next = new URLSearchParams(params);
      next.delete('poStatus');
      setParams(next, { replace: true });
    }
  };
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };

  // "Filters" covers Vendor, From and To — Status stays always visible.
  const secondaryCount = [vendorFilter, from, to].filter(Boolean).length;
  const clearSecondary = () => { setVendorFilter(null); setFrom(''); setTo(''); resetPage(); };
  // KPI cards filter by exactly what they count (purchaseOrder.service getStats).
  const kpi = useKpiFilter({
    statusFilter, setStatusFilter, resetPage,
    defs: {
      total:    {},
      approved: { params: { approvalStatus: 'APPROVED' }, label: 'ALL APPROVED POs' },
      released: { params: { releaseStatus: 'RELEASED' }, label: 'ALL RELEASED POs' },
      partial:  { status: 'PARTIAL_RECEIVED' },
      full:     { status: 'FULLY_RECEIVED' },
      // No card here — GRN › Pending Qty's preset, named in the Status dropdown.
      openForReceipt: { status: OPEN_FOR_RECEIPT, label: 'OPEN FOR RECEIPT (RELEASED + PARTIAL)' },
    },
  });
  const anyFilterActive = Boolean(search || statusFilter || kpi.key || secondaryCount);
  const clearAll = () => { resetSearch(); setStatusFilter(''); kpi.clear(); clearSecondary(); };

  // 'orders' = the PO list; 'pending' = approved indent items not yet on an
  // active PO (same source as the Create PO drawer's item picker).
  const [view, setView] = useState('orders');
  // A card filters the Purchase Orders tab, so it brings that tab forward.
  const kpiCard = (k) => ({ active: kpi.isActive(k), onClick: () => { setView('orders'); kpi.select(k); } });
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
  const menuRef = useRef(null); // the ⋮ menu — RowActionsMenu owns its open state

  const queryArgs = {
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    sort: '-createdAt',
    search: search || undefined,
    vendorId: vendorFilter?._id || undefined,
    poStatus: statusFilter || undefined,
    ...kpi.params,
    ...(from ? { 'poDate[gte]': `${from}T00:00:00` } : {}),
    ...(to ? { 'poDate[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching, isError } = useGetPurchaseOrdersQuery(queryArgs);
  const { data: statsRes } = useGetPurchaseOrderStatsQuery();
  const stats = statsRes?.data || {};
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' });
  const [cancelPo] = useCancelPurchaseOrderMutation();
  const [generatePoPdf] = useGeneratePurchaseOrderPdfMutation();

  const openMenu = (e, row) => { e.stopPropagation(); menuRef.current?.open(e.currentTarget, row); };
  const closeMenu = () => menuRef.current?.close();

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

  // Delete — any status, with the step's delete permission (MD has all). The
  // server refuses while a later step rests on the record, and names it.
  const [removePo] = useDeletePurchaseOrderMutation();
  const canDeleteRecord = usePermissions().can('procurement.deletePurchaseOrder');
  const del = useRecordDelete({
    type: 'PO', what: 'PO', numberOf: (r) => r.poNumber || r.draftNumber, remove: removePo,
    needsReason: (r) => r.approvalStatus !== 'DRAFT',
    consequence: () => 'The PO is removed and the indent items it held are free again. Not allowed while a follow-up, PI, advance, GRN, invoice or voucher uses it — if so, it is named here.',
  });

  const actionsFor = (r) => {
    const a = [{ key: 'view', label: 'View', icon: <Eye size={16} />, fn: () => onView(r) }];
    if (r.approvalStatus === 'DRAFT') {
      a.push({ key: 'edit', label: 'Edit Draft', icon: <Pencil size={16} />, fn: () => onEdit(r) });
      a.push({ key: 'approve', label: 'Approve / Reject', icon: <CheckCircle2 size={16} />, fn: () => onApprove(r) });
    }
    if (r.approvalStatus === 'APPROVED' && r.releaseStatus !== 'RELEASED') {
      a.push({ key: 'release', label: 'Release to Supplier', icon: <Send size={16} />, fn: () => onRelease(r) });
    }
    if (!['FULLY_RECEIVED', 'CLOSED', 'CANCELLED'].includes(r.poStatus)) {
      a.push({ key: 'cancel', label: 'Cancel', icon: <Ban size={16} />, fn: () => onCancel(r) });
    }
    if (r.poStatus === 'CANCELLED') {
      a.push({ key: 'revise', label: 'Revise PO', icon: <RotateCcw size={16} />, fn: () => onRevise(r) });
    }
    // Always last: previews this row's PDF (the stored one, or generated on demand).
    a.push({ key: 'pdf', label: 'Preview PDF', icon: <FileText size={16} />, fn: () => onPdf(r) });
    if (canDeleteRecord) a.push(del.action(r));
    return a;
  };

  const columns = [
    serialColumn(),
    { field: 'poNumber', headerName: 'PO NUMBER', width: 180,
      renderCell: (p) => (
        <Typography variant="body2" fontWeight={700} color={p.value ? 'primary.main' : 'text.secondary'} noWrap>
          {poDisplayNumber(p.row)}
        </Typography>
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
    // Eye = item quick view (popup, the list stays put); ⋮ holds View (the full
    // PO page, also the row click) and, last, Preview PDF. Pinned to the right.
    rowActionsColumn((p) => (
      <RowActionsCell rowId={p.row._id} label={poDisplayNumber(p.row)}
        onQuickView={() => setItemsPo(p.row)} quickViewLabel="View item details" quickViewTestId="po-row-view"
        onMenu={(e) => openMenu(e, p.row)} />
    )),
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
      <Box sx={pfmsKpiRowSx(5)}>
        <PfmsKpiCard icon={<ShoppingBag size={20} />}  label="Total POs"        value={stats.total}           color="#2563eb" {...kpiCard('total')} />
        <PfmsKpiCard icon={<BadgeCheck size={20} />}   label="Approved"         value={stats.approved}        color="#0f766e" {...kpiCard('approved')} />
        <PfmsKpiCard icon={<Truck size={20} />}        label="Released"         value={stats.released}        color="#0e7490" {...kpiCard('released')} />
        <PfmsKpiCard icon={<PackageOpen size={20} />}  label="Partial Received" value={stats.partialReceived} color="#c2410c" {...kpiCard('partial')} />
        <PfmsKpiCard icon={<PackageCheck size={20} />} label="Fully Received"   value={stats.fullyReceived}   color="#16a34a" {...kpiCard('full')} />
      </Box>

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
                <TextField id="po-status" size="small" select fullWidth value={kpi.menuValue}
                  SelectProps={ALL_WHEN_UNSET} onChange={(e) => kpi.onMenuChange(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {kpi.menuOptions.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
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
          localeText={{ noRowsLabel: listEmptyLabel({ isError, filtered: anyFilterActive, empty: 'No purchase orders yet' }) }}
          paginationMode="server"
          rowCount={data?.meta?.total || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          {...rowNav.gridProps}
          {...rowActionsGridProps}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          rowHeight={50}
          columnHeaderHeight={44}
          sx={[{ border: 0 }, rowNavigationGridSx, rowActionsGridSx]}
        />
      </Paper>
      </>)}

      {/* Row actions */}
      <RowActionsMenu ref={menuRef} actionsFor={actionsFor} />
      {del.dialog}

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
