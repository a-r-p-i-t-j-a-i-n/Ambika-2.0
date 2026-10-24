import React, { useState } from 'react';
import { serialColumn } from '../components/serialNumber';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  IconButton, Menu, ListItemIcon, ListItemText, Grid, Tooltip, Autocomplete,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Plus, MoreVertical, Eye, Pencil, Send, Ban,
  Banknote, FileStack, Coins, CheckCheck, Wallet,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useGetVouchersQuery,
  useGetVoucherStatsQuery,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import AdaptiveFilterBar from '../components/AdaptiveFilterBar';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import { VoucherStatusChip, VoucherTypeChip, VOUCHER_STATUSES, VOUCHER_TYPES, EXPENSE_CATEGORIES, PAYMENT_MODES, fmtINR, fmtDate } from './voucherMeta';
import VoucherFormDialog from './VoucherFormDialog';
import PfmsKpiCard from '../components/PfmsKpiCard';
import PurchaseFmsStepper from '../components/PurchaseFmsStepper';
import { PURCHASE_FMS_STEPS } from '../PurchaseFmsHub';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';

import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
// This standalone page (also reachable outside the Purchase FMS hub, e.g. for
// Expense vouchers, which have no invoice) still belongs under the hub's
// unified "Vendor Invoices & Payments" step — show the same step rail here
// for workflow context/navigation, same as pages opened through the hub.
const PFMS_STEP_INDEX = PURCHASE_FMS_STEPS.findIndex((s) => s.slug === 'invoices-payments');

const VoucherList = () => {
  const navigate = useNavigate();
  const rowNav = useRowNavigation({ to: (r) => `/procurement/vouchers/${r._id}` });
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };

  // "Filters" covers Vendor, Type, Category, Payment Mode and the date range —
  // Status stays always visible.
  const secondaryCount = [vendorFilter, typeFilter, categoryFilter, modeFilter, from, to].filter(Boolean).length;
  const clearSecondary = () => {
    setVendorFilter(null); setTypeFilter(''); setCategoryFilter(''); setModeFilter(''); setFrom(''); setTo(''); resetPage();
  };
  const anyFilterActive = Boolean(search || statusFilter || secondaryCount);
  const clearAll = () => { resetSearch(); setStatusFilter(''); clearSecondary(); };

  const [formOpen, setFormOpen] = useState(false);
  const [editVoucher, setEditVoucher] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);

  const queryArgs = {
    page: paginationModel.page + 1, limit: paginationModel.pageSize, sort: '-createdAt',
    search: search || undefined, vendorId: vendorFilter?._id || undefined, voucherStatus: statusFilter || undefined,
    voucherType: typeFilter || undefined, expenseCategory: categoryFilter || undefined,
    // No dedicated Joi rule for paymentMode in the list schema, but it's
    // `.unknown(true)` and paymentMode is a real, indexed enum field on the
    // model — ApiFeatures.filter() exact-matches it with no backend change.
    paymentMode: modeFilter || undefined,
    ...(from ? { 'voucherDate[gte]': `${from}T00:00:00` } : {}), ...(to ? { 'voucherDate[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching } = useGetVouchersQuery(queryArgs);
  const { data: statsRes } = useGetVoucherStatsQuery();
  const stats = statsRes?.data || {};
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' });

  const openMenu = (e, row) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); setMenuRow(row); };
  const closeMenu = () => { setMenuAnchor(null); setMenuRow(null); };
  const onView = (r) => { navigate(`/procurement/vouchers/${r._id}`); closeMenu(); };
  const onEdit = (r) => { setEditVoucher(r); setFormOpen(true); closeMenu(); };

  const actionsFor = (r) => {
    const a = [{ key: 'view', label: 'View', icon: <Eye size={16} />, fn: () => onView(r) }];
    if (r.voucherStatus === 'DRAFT') {
      a.push({ key: 'edit', label: 'Edit', icon: <Pencil size={16} />, fn: () => onEdit(r) });
      a.push({ key: 'post', label: 'Post Voucher', icon: <Send size={16} />, fn: () => onView(r) });
      a.push({ key: 'cancel', label: 'Cancel', icon: <Ban size={16} />, fn: () => onView(r) });
    }
    return a;
  };

  const columns = [
    serialColumn(),
    { field: 'voucherNumber', headerName: 'VOUCHER NO', width: 145, renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'voucherType', headerName: 'TYPE', width: 80, sortable: false, renderCell: (p) => <VoucherTypeChip type={p.value} /> },
    { field: 'voucherDate', headerName: 'DATE', width: 95, renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'invoiceNumber', headerName: 'INVOICE / CATEGORY', width: 160, sortable: false,
      valueGetter: (_v, row) => (row.voucherType === 'EXPENSE' ? (row.expenseCategory || '—') : (row.invoiceNumber || '—')),
      renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value}</Typography> },
    { field: 'vendorName', headerName: 'VENDOR / PARTY', flex: 1, minWidth: 150, renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    { field: 'netPayableAmount', headerName: 'NET PAYABLE', width: 120, align: 'right', headerAlign: 'right', renderCell: (p) => fmtINR(p.value) },
    { field: 'paidAmount', headerName: 'PAID', width: 110, align: 'right', headerAlign: 'right', renderCell: (p) => <Typography variant="body2" fontWeight={700} sx={{ color: '#16a34a' }}>{fmtINR(p.value)}</Typography> },
    { field: 'balanceAmount', headerName: 'BALANCE', width: 110, align: 'right', headerAlign: 'right', renderCell: (p) => <Typography variant="body2" sx={{ color: p.value > 0 ? '#b45309' : '#16a34a', fontWeight: 600 }}>{fmtINR(p.value)}</Typography> },
    { field: 'voucherStatus', headerName: 'STATUS', width: 150, renderCell: (p) => <VoucherStatusChip status={p.value} /> },
    { field: '__actions', headerName: '', width: 60, sortable: false, filterable: false, align: 'center', renderCell: (p) => <Tooltip title="Actions"><IconButton size="small" onClick={(e) => openMenu(e, p.row)}><MoreVertical size={16} /></IconButton></Tooltip> },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, ...pfmsPageSx }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={pfmsTitleSx}>Payment Vouchers ({stats.total || 0})</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>Step 1.11 · Voucher processing — posting marks the invoice Accounts Ready</Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => { setEditVoucher(null); setFormOpen(true); }}>New Voucher</Button>
      </Box>

      <PurchaseFmsStepper
        steps={PURCHASE_FMS_STEPS}
        activeIndex={PFMS_STEP_INDEX}
        onStepClick={(slug) => navigate(`/purchase-fms/${slug}`)}
      />

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<FileStack size={20} />} label="Total"          value={stats.total}         color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Send size={20} />}      label="Posted"         value={stats.posted}        color="#0ea5e9" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Coins size={20} />}     label="Partially Paid" value={stats.partiallyPaid} color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<CheckCheck size={20} />} label="Fully Paid"     value={stats.fullyPaid}     color="#16a34a" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Wallet size={20} />}    label="Outstanding"    value={fmtINR(stats.outstanding)} color="#dc2626" /></Grid>
      </Grid>

      {/* Filters — Search + Status stay visible; Vendor, Type (+ its
          type-gated Category), Payment Mode and the date range move into
          Filters, which only counts those as active. */}
      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <AdaptiveFilterBar
          pinned={[
            { key: 'search', minWidth: 220, node: (
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 220px' }, minWidth: 0 }}>
                <Typography component="label" htmlFor="vo-search" sx={pfmsFieldLabelSx}>Search</Typography>
                <TextField id="vo-search" size="small" fullWidth placeholder="Search voucher / invoice / vendor…"
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
              </Box>
            ) },
            { key: 'status', minWidth: 160, node: (
              <Box sx={{ flex: '0 1 160px', minWidth: 140 }}>
                <Typography component="label" htmlFor="vo-status" sx={pfmsFieldLabelSx}>Status</Typography>
                <TextField id="vo-status" size="small" select fullWidth value={statusFilter}
                  SelectProps={ALL_WHEN_UNSET} onChange={(e) => onFilterChange(setStatusFilter)(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {VOUCHER_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
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
              key: 'type', width: 150, active: Boolean(typeFilter),
              node: (
                <Box sx={{ flex: '0 1 150px', minWidth: 130 }}>
                  <TextField size="small" select fullWidth label="Type" value={typeFilter}
                    InputLabelProps={{ shrink: true }}
                    SelectProps={ALL_WHEN_UNSET}
                    onChange={(e) => { onFilterChange(setTypeFilter)(e.target.value); if (e.target.value !== 'EXPENSE') setCategoryFilter(''); }}>
                    <MenuItem value="">All</MenuItem>
                    {VOUCHER_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
                  </TextField>
                </Box>
              ),
            },
            // Category is gated on Type === EXPENSE — when not applicable it is
            // simply absent from `items`, not just visually hidden, so the
            // adaptive fit calculation never reserves space for a field that
            // can't be set right now (matches the old FilterPopover behaviour,
            // which also only rendered it conditionally).
            typeFilter === 'EXPENSE' && {
              key: 'category', width: 160, active: Boolean(categoryFilter),
              node: (
                <Box sx={{ flex: '0 1 160px', minWidth: 140 }}>
                  <TextField size="small" select fullWidth label="Category" value={categoryFilter}
                    InputLabelProps={{ shrink: true }}
                    SelectProps={ALL_WHEN_UNSET} onChange={(e) => onFilterChange(setCategoryFilter)(e.target.value)}>
                    <MenuItem value="">All</MenuItem>
                    {EXPENSE_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                  </TextField>
                </Box>
              ),
            },
            {
              key: 'mode', width: 160, active: Boolean(modeFilter),
              node: (
                <Box sx={{ flex: '0 1 160px', minWidth: 140 }}>
                  <TextField size="small" select fullWidth label="Payment Mode" value={modeFilter}
                    InputLabelProps={{ shrink: true }}
                    SelectProps={ALL_WHEN_UNSET} onChange={(e) => onFilterChange(setModeFilter)(e.target.value)}>
                    <MenuItem value="">All</MenuItem>
                    {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{m.replace(/_/g, ' ')}</MenuItem>)}
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
          ].filter(Boolean)}
          onClearSecondary={clearSecondary}
          onClearAll={clearAll}
          anyActive={anyFilterActive}
        />
      </Paper>

      <Paper sx={{ ...pfmsCardSx, flexGrow: 1, minHeight: 420, overflow: 'hidden' }}>
        <DataGrid rows={data?.data || []} columns={columns} getRowId={(r) => r._id} loading={isLoading || isFetching}
          paginationMode="server" rowCount={data?.meta?.total || 0} paginationModel={paginationModel} onPaginationModelChange={setPaginationModel}
          {...rowNav.gridProps} pageSizeOptions={[10, 25, 50, 100]} disableRowSelectionOnClick
          rowHeight={50} columnHeaderHeight={44} sx={[{ border: 0 }, rowNavigationGridSx]} />
      </Paper>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuRow && actionsFor(menuRow).map((a) => (
          <MenuItem key={a.key} onClick={a.fn}><ListItemIcon>{a.icon}</ListItemIcon><ListItemText>{a.label}</ListItemText></MenuItem>
        ))}
      </Menu>

      <VoucherFormDialog open={formOpen} voucher={editVoucher} onClose={() => { setFormOpen(false); setEditVoucher(null); }} />
    </Box>
  );
};

export default VoucherList;
