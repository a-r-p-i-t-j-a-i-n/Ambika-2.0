import React, { useCallback, useState } from 'react';
import { serialColumn } from '../components/serialNumber';
import { stepTimingColumns } from '../components/stepTimingColumns';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  IconButton, Menu, ListItemIcon, ListItemText, Grid, Tooltip, Autocomplete,
  Chip, CircularProgress,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { alpha } from '@mui/material/styles';
import {
  Search, Plus, MoreVertical, Eye, Pencil, CheckCircle2, FileDown,
  ReceiptText, Hourglass, BadgeCheck, Wallet, CheckCheck, Banknote,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useGetVendorInvoicesQuery,
  useGetVendorInvoiceStatsQuery,
  useGetVouchersByInvoiceQuery,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import AdaptiveFilterBar from '../components/AdaptiveFilterBar';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import { InvoiceStatusChip, INVOICE_STATUSES, fmtINR, fmtDate } from './invoiceMeta';
import { VoucherStatusChip } from '../vouchers/voucherMeta';
import VendorInvoiceFormDialog from './VendorInvoiceFormDialog';
import VendorInvoiceApprovalDialog from './VendorInvoiceApprovalDialog';
import { resolveFileUrl } from '../../../utils/fileUrl';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';

import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
// One invoice's live (non-cancelled) voucher, for the list's Voucher column —
// a small self-contained cell so each row fetches only its own voucher via
// the existing by-invoice endpoint (same one the Invoice Detail page already
// uses), no new API surface. Reports the resolved voucher back to the list
// via `onResolved` so the workflow chips below can filter on it too.
const InvoiceVoucherCell = ({ row, onResolved }) => {
  const relevant = ['PAYMENT_PENDING', 'PAYMENT_COMPLETED'].includes(row.invoiceStatus);
  const { data, isSuccess } = useGetVouchersByInvoiceQuery(row._id, { skip: !relevant });
  const live = (data?.data || []).find((x) => x.voucherStatus !== 'CANCELLED') || null;

  React.useEffect(() => {
    if (!relevant) { onResolved(row._id, null); return; }
    if (isSuccess) onResolved(row._id, live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relevant, isSuccess, live?._id, live?.voucherStatus, live?.approvalStatus]);

  if (!relevant) return <Typography variant="body2" color="text.disabled">—</Typography>;
  if (!isSuccess) return <CircularProgress size={14} />;
  if (!live) return <Chip size="small" variant="outlined" label="Voucher Not Created" sx={{ fontStyle: 'italic', color: 'text.secondary', borderColor: 'divider' }} />;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, py: 0.25 }}>
      <Typography variant="caption" fontWeight={700} color="primary.main" noWrap>{live.voucherNumber}</Typography>
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
        <VoucherStatusChip status={live.voucherStatus} />
        {live.approvalStatus === 'MD_APPROVED' && (
          <Chip size="small" label="MD" sx={{ height: 18, fontSize: '0.62rem', fontWeight: 700, bgcolor: alpha('#16a34a', 0.12), color: '#16a34a' }} />
        )}
      </Box>
    </Box>
  );
};

// Combined invoice+voucher workflow quick filters. Each maps to a real,
// existing server-side invoiceStatus value (no invented statuses); the ones
// that need voucher-level detail additionally refine the current page's rows
// using the voucher data the Voucher column cells resolve (see voucherMap
// below) — since PAYMENT_PENDING is the one invoiceStatus a live voucher can
// exist under, that server filter is always exact; the predicate only narrows
// further within it.
const WORKFLOW_CHIPS = [
  { id: 'ALL', label: 'All', serverStatus: '' },
  { id: 'AWAITING_INVOICE', label: 'Awaiting Invoice Action', serverStatus: '', predicate: (r) => ['DRAFT', 'RECEIVED'].includes(r.invoiceStatus) },
  { id: 'AWAITING_VOUCHER', label: 'Awaiting Voucher', serverStatus: 'PAYMENT_PENDING', predicate: (r, vm) => vm[r._id] === null },
  { id: 'AWAITING_MD_APPROVAL', label: 'Awaiting MD Approval', serverStatus: 'PAYMENT_PENDING', predicate: (r, vm) => vm[r._id] && vm[r._id].approvalStatus === 'READY_FOR_MD_APPROVAL' },
  { id: 'VOUCHER_POSTED', label: 'Voucher Posted / MD Approved', serverStatus: 'PAYMENT_PENDING', predicate: (r, vm) => vm[r._id] && vm[r._id].approvalStatus === 'MD_APPROVED' },
  { id: 'PARTIALLY_PAID', label: 'Partially Paid', serverStatus: 'PAYMENT_PENDING', predicate: (r, vm) => vm[r._id]?.voucherStatus === 'PARTIALLY_PAID' },
  { id: 'PAID_SHORT_CLOSED', label: 'Paid / Short Closed', serverStatus: 'PAYMENT_COMPLETED' },
  { id: 'REJECTED', label: 'Rejected', serverStatus: 'REJECTED' },
];

const VendorInvoiceList = () => {
  const navigate = useNavigate();
  const rowNav = useRowNavigation({ to: (r) => `/procurement/vendor-invoices/${r._id}` });
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [workflowChip, setWorkflowChip] = useState('ALL');
  const [voucherMap, setVoucherMap] = useState({}); // invoiceId -> voucher | null (resolved, no live voucher) | undefined (loading)

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };

  // The Workflow Chips row below is already the primary, always-visible status
  // control for this screen (richer than a plain status list — it also
  // distinguishes voucher sub-states a single invoiceStatus can't). The raw
  // Status dropdown is kept — it can isolate e.g. just DRAFT or just APPROVED,
  // which no chip does alone — but as a SECONDARY/precision filter, alongside
  // Vendor and the date range, so it isn't a second always-visible status
  // selector duplicating the chips.
  const secondaryCount = [vendorFilter, statusFilter, from, to].filter(Boolean).length;
  const clearSecondary = () => { setVendorFilter(null); setStatusFilter(''); setWorkflowChip('ALL'); setFrom(''); setTo(''); resetPage(); };
  const anyFilterActive = Boolean(search || secondaryCount || workflowChip !== 'ALL');
  const clearAll = () => { resetSearch(); clearSecondary(); };

  const handleVoucherResolved = useCallback((invoiceId, live) => {
    setVoucherMap((m) => {
      const prev = m[invoiceId];
      if (prev === live) return m;
      if (prev && live && prev._id === live._id && prev.voucherStatus === live.voucherStatus && prev.approvalStatus === live.approvalStatus) return m;
      return { ...m, [invoiceId]: live };
    });
  }, []);

  const selectWorkflowChip = (chip) => {
    setWorkflowChip(chip.id);
    setStatusFilter(chip.serverStatus);
    setPaginationModel((p) => ({ ...p, page: 0 }));
  };

  const [formOpen, setFormOpen] = useState(false);
  const [editInv, setEditInv] = useState(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [activeInv, setActiveInv] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);

  const queryArgs = {
    page: paginationModel.page + 1, limit: paginationModel.pageSize, sort: '-createdAt',
    search: search || undefined, vendorId: vendorFilter?._id || undefined, invoiceStatus: statusFilter || undefined,
    ...(from ? { 'invoiceDate[gte]': `${from}T00:00:00` } : {}), ...(to ? { 'invoiceDate[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching } = useGetVendorInvoicesQuery(queryArgs);
  const { data: statsRes } = useGetVendorInvoiceStatsQuery();
  const stats = statsRes?.data || {};
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' });

  const openMenu = (e, row) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); setMenuRow(row); };
  const closeMenu = () => { setMenuAnchor(null); setMenuRow(null); };
  const onView = (r) => { navigate(`/procurement/vendor-invoices/${r._id}`); closeMenu(); };
  const onEdit = (r) => { setEditInv(r); setFormOpen(true); closeMenu(); };
  const onApprove = (r) => { setActiveInv(r); setApprovalOpen(true); closeMenu(); };
  const onDoc = (r) => { window.open(resolveFileUrl(r.invoiceDocument), '_blank', 'noopener,noreferrer'); closeMenu(); };

  const actionsFor = (r) => {
    const a = [{ key: 'view', label: 'View', icon: <Eye size={16} />, fn: () => onView(r) }];
    if (['DRAFT', 'RECEIVED', 'APPROVED', 'PAYMENT_PENDING'].includes(r.invoiceStatus)) {
      a.push({ key: 'edit', label: 'Edit', icon: <Pencil size={16} />, fn: () => onEdit(r) });
    }
    if (['DRAFT', 'RECEIVED'].includes(r.invoiceStatus)) {
      a.push({ key: 'approve', label: 'Approve / Reject', icon: <CheckCircle2 size={16} />, fn: () => onApprove(r) });
    }
    if (r.invoiceDocument?.fileUrl) a.push({ key: 'doc', label: 'View Document', icon: <FileDown size={16} />, fn: () => onDoc(r) });
    return a;
  };

  const columns = [
    serialColumn(),
    { field: 'invoiceNumber', headerName: 'INVOICE NO', width: 140, renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'invoiceDate', headerName: 'DATE', width: 95, renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'grnNumber', headerName: 'GRN', width: 150, sortable: false,
      renderCell: (p) => {
        const list = (p.row.grnNumbers?.length ? p.row.grnNumbers : [p.row.grnNumber]).filter(Boolean);
        if (!list.length) return <Typography variant="body2" color="text.disabled">—</Typography>;
        return (
          <Typography variant="body2" fontWeight={600} noWrap>
            {list[0]}{list.length > 1 ? <Typography component="span" variant="caption" color="text.secondary"> +{list.length - 1} more</Typography> : null}
          </Typography>
        );
      } },
    { field: 'poNumber', headerName: 'PO', width: 130, renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value || '—'}</Typography> },
    { field: 'vendorName', headerName: 'VENDOR', flex: 1, minWidth: 150, renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    { field: 'invoiceAmount', headerName: 'INVOICE AMT', width: 120, align: 'right', headerAlign: 'right', renderCell: (p) => fmtINR(p.value) },
    { field: 'advancePaid', headerName: 'ADVANCE', width: 110, align: 'right', headerAlign: 'right', renderCell: (p) => <Typography variant="body2" sx={{ color: '#0f766e' }}>{fmtINR(p.value)}</Typography> },
    { field: 'netPayableAmount', headerName: 'NET PAYABLE', width: 125, align: 'right', headerAlign: 'right', renderCell: (p) => <Typography variant="body2" fontWeight={700} sx={{ color: '#b45309' }}>{fmtINR(p.value)}</Typography> },
    { field: 'invoiceStatus', headerName: 'STATUS', width: 160, renderCell: (p) => <InvoiceStatusChip status={p.value} /> },
    { field: 'voucher', headerName: 'VOUCHER', width: 160, sortable: false, filterable: false,
      renderCell: (p) => <InvoiceVoucherCell row={p.row} onResolved={handleVoucherResolved} /> },
    ...stepTimingColumns(),
    { field: '__actions', headerName: '', width: 60, sortable: false, filterable: false, align: 'center', renderCell: (p) => <Tooltip title="Actions"><IconButton size="small" onClick={(e) => openMenu(e, p.row)}><MoreVertical size={16} /></IconButton></Tooltip> },
  ];

  const allRows = data?.data || [];
  const activeChip = WORKFLOW_CHIPS.find((c) => c.id === workflowChip);
  const rows = activeChip?.predicate ? allRows.filter((r) => activeChip.predicate(r, voucherMap)) : allRows;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, ...pfmsPageSx }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={pfmsTitleSx}>Vendor Invoices & Payments ({stats.total || 0})</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>Step 1.10–1.11 · Invoice / Debit Note received, with each invoice's payment voucher managed in place</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" startIcon={<Banknote size={16} />} onClick={() => navigate('/procurement/vouchers')}>Expense / All Vouchers</Button>
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => { setEditInv(null); setFormOpen(true); }}>New Invoice</Button>
        </Box>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<ReceiptText size={20} />} label="Total"            value={stats.total}            color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Hourglass size={20} />}   label="Pending Approval" value={stats.pendingApproval}  color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<BadgeCheck size={20} />}  label="Approved"         value={stats.approved}         color="#0f766e" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Wallet size={20} />}      label="Payment Pending"  value={stats.paymentPending}   color="#0e7490" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<CheckCheck size={20} />}  label="Payment Done"     value={stats.paymentCompleted} color="#16a34a" /></Grid>
      </Grid>

      {/* Search + the Workflow Chips below are the primary filtering surface
          for this screen. Vendor, the precise Status list and the date range
          are secondary — Filters only counts those. */}
      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <AdaptiveFilterBar
          pinned={[
            { key: 'search', minWidth: 260, node: (
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 260px' }, minWidth: 0 }}>
                <Typography component="label" htmlFor="vi-search" sx={pfmsFieldLabelSx}>Search</Typography>
                <TextField id="vi-search" size="small" fullWidth placeholder="Search invoice / GRN / vendor…"
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
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
              key: 'status', width: 170, active: Boolean(statusFilter),
              node: (
                <Box sx={{ flex: '0 1 170px', minWidth: 150 }}>
                  <TextField size="small" select fullWidth label="Status (precise)" value={statusFilter}
                    InputLabelProps={{ shrink: true }}
                    SelectProps={ALL_WHEN_UNSET}
                    onChange={(e) => { onFilterChange(setStatusFilter)(e.target.value); setWorkflowChip('ALL'); }}>
                    <MenuItem value="">All</MenuItem>
                    {INVOICE_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
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

      <Paper sx={{ ...pfmsCardSx, p: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {WORKFLOW_CHIPS.map((chip) => (
          <Chip
            key={chip.id}
            label={chip.label}
            size="small"
            onClick={() => selectWorkflowChip(chip)}
            variant={workflowChip === chip.id ? 'filled' : 'outlined'}
            color={workflowChip === chip.id ? 'primary' : 'default'}
            sx={{ fontWeight: 600 }}
          />
        ))}
        {activeChip?.predicate && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1, alignSelf: 'center' }}>
            Refines the current page by voucher status — widen the page size above to see more matches.
          </Typography>
        )}
      </Paper>

      <Paper sx={{ ...pfmsCardSx, flexGrow: 1, minHeight: 420, overflow: 'hidden' }}>
        <DataGrid rows={rows} columns={columns} getRowId={(r) => r._id} loading={isLoading || isFetching}
          paginationMode="server" rowCount={data?.meta?.total || 0} paginationModel={paginationModel} onPaginationModelChange={setPaginationModel}
          {...rowNav.gridProps} pageSizeOptions={[10, 25, 50, 100]} disableRowSelectionOnClick
          rowHeight={50} columnHeaderHeight={44} sx={[{ border: 0 }, rowNavigationGridSx]} />
      </Paper>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuRow && actionsFor(menuRow).map((a) => (
          <MenuItem key={a.key} onClick={a.fn}><ListItemIcon>{a.icon}</ListItemIcon><ListItemText>{a.label}</ListItemText></MenuItem>
        ))}
      </Menu>

      <VendorInvoiceFormDialog open={formOpen} invoice={editInv} onClose={() => { setFormOpen(false); setEditInv(null); }} />
      <VendorInvoiceApprovalDialog open={approvalOpen} invoice={activeInv} onClose={() => { setApprovalOpen(false); setActiveInv(null); }} />
    </Box>
  );
};

export default VendorInvoiceList;
