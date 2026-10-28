import React, { useState } from 'react';
import { serialColumn } from '../components/serialNumber';
import { stepTimingColumns } from '../components/stepTimingColumns';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  Menu, ListItemIcon, ListItemText, Grid, Autocomplete,
  Chip, CircularProgress,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { alpha } from '@mui/material/styles';
import {
  Search, Plus, Eye, Pencil, CheckCircle2, FileDown,
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
import RowQuickViewDialog from '../common/RowQuickViewDialog';
import RowActionsCell from '../components/RowActionsCell';
import { rowActionsColumn, rowActionsGridProps, rowActionsGridSx } from '../components/rowActionsColumn';
// One invoice's live (non-cancelled) voucher, for the list's Voucher column —
// a small self-contained cell so each row fetches only its own voucher via
// the existing by-invoice endpoint (same one the Invoice Detail page already
// uses), no new API surface.
const InvoiceVoucherCell = ({ row }) => {
  const relevant = ['PAYMENT_PENDING', 'PAYMENT_COMPLETED'].includes(row.invoiceStatus);
  const { data, isSuccess } = useGetVouchersByInvoiceQuery(row._id, { skip: !relevant });
  const live = (data?.data || []).find((x) => x.voucherStatus !== 'CANCELLED') || null;

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
// existing server-side invoiceStatus value (no invented statuses). The ones
// that also depend on the invoice's voucher (or on several statuses) are sent
// as `workflow` and resolved by the server (backend vendor-invoice/
// invoiceWorkflow.js), so the page, its pagination and the row count all
// describe the same filtered set — they used to narrow only the current page.
const WORKFLOW_CHIPS = [
  { id: 'ALL', label: 'All', serverStatus: '' },
  { id: 'AWAITING_INVOICE', label: 'Awaiting Invoice Action', serverStatus: '', workflow: 'AWAITING_INVOICE' },
  { id: 'AWAITING_VOUCHER', label: 'Awaiting Voucher', serverStatus: '', workflow: 'AWAITING_VOUCHER' },
  { id: 'AWAITING_MD_APPROVAL', label: 'Awaiting MD Approval', serverStatus: '', workflow: 'AWAITING_MD_APPROVAL' },
  { id: 'VOUCHER_POSTED', label: 'Voucher Posted / MD Approved', serverStatus: '', workflow: 'VOUCHER_POSTED' },
  { id: 'PARTIALLY_PAID', label: 'Partially Paid', serverStatus: '', workflow: 'PARTIALLY_PAID' },
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
  const [quickRow, setQuickRow] = useState(null); // row whose quick view is open

  const activeChip = WORKFLOW_CHIPS.find((c) => c.id === workflowChip);
  const queryArgs = {
    page: paginationModel.page + 1, limit: paginationModel.pageSize, sort: '-createdAt',
    search: search || undefined, vendorId: vendorFilter?._id || undefined, invoiceStatus: statusFilter || undefined,
    workflow: activeChip?.workflow || undefined,
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
      renderCell: (p) => <InvoiceVoucherCell row={p.row} /> },
    ...stepTimingColumns(),
    // Eye = quick view (popup, the list stays put); ⋮ holds View (the full page,
    // also the row click) and the row's other actions. Pinned to the right.
    rowActionsColumn((p) => (
      <RowActionsCell rowId={p.row._id} label={p.row.invoiceNumber}
        onQuickView={() => setQuickRow(p.row)} onMenu={(e) => openMenu(e, p.row)} />
    )),
  ];

  const rows = data?.data || [];

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
      </Paper>

      <Paper sx={{ ...pfmsCardSx, flexGrow: 1, minHeight: 420, overflow: 'hidden' }}>
        <DataGrid rows={rows} columns={columns} getRowId={(r) => r._id} loading={isLoading || isFetching}
          paginationMode="server" rowCount={data?.meta?.total || 0} paginationModel={paginationModel} onPaginationModelChange={setPaginationModel}
          {...rowNav.gridProps} {...rowActionsGridProps} pageSizeOptions={[10, 25, 50, 100]} disableRowSelectionOnClick
          rowHeight={50} columnHeaderHeight={44} sx={[{ border: 0 }, rowNavigationGridSx, rowActionsGridSx]} />
      </Paper>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuRow && actionsFor(menuRow).map((a) => (
          <MenuItem key={a.key} onClick={a.fn}><ListItemIcon>{a.icon}</ListItemIcon><ListItemText>{a.label}</ListItemText></MenuItem>
        ))}
      </Menu>

      <VendorInvoiceFormDialog open={formOpen} invoice={editInv} onClose={() => { setFormOpen(false); setEditInv(null); }} />
      <VendorInvoiceApprovalDialog open={approvalOpen} invoice={activeInv} onClose={() => { setApprovalOpen(false); setActiveInv(null); }} />
      <RowQuickViewDialog open={Boolean(quickRow)} onClose={() => setQuickRow(null)}
        title="Vendor Invoice Details" number={quickRow?.invoiceNumber}
        status={quickRow ? <InvoiceStatusChip status={quickRow.invoiceStatus} /> : null}
        subtitle={quickRow?.vendorName}
        fields={quickRow ? [
          { label: 'Invoice Date', value: fmtDate(quickRow.invoiceDate) },
          { label: 'GRN', value: (quickRow.grnNumbers?.length ? quickRow.grnNumbers : [quickRow.grnNumber]).filter(Boolean).join(', ') },
          { label: 'PO', value: quickRow.poNumber },
          { label: 'Invoice Amt', value: fmtINR(quickRow.invoiceAmount) },
          { label: 'Advance', value: fmtINR(quickRow.advancePaid) },
          { label: 'Net Payable', value: fmtINR(quickRow.netPayableAmount) },
        ] : []}
        openFullLabel="Open full invoice" onOpenFull={quickRow ? () => onView(quickRow) : undefined} />
    </Box>
  );
};

export default VendorInvoiceList;
