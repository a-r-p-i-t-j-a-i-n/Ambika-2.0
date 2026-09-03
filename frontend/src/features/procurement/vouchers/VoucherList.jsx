import React, { useState } from 'react';
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
import { VoucherStatusChip, VoucherTypeChip, VOUCHER_STATUSES, VOUCHER_TYPES, EXPENSE_CATEGORIES, fmtINR, fmtDate } from './voucherMeta';
import VoucherFormDialog from './VoucherFormDialog';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx } from '../pfmsTheme';

const VoucherList = () => {
  const navigate = useNavigate();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editVoucher, setEditVoucher] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);

  const queryArgs = {
    page: paginationModel.page + 1, limit: paginationModel.pageSize, sort: '-createdAt',
    search: search || undefined, vendorId: vendorFilter?._id || undefined, voucherStatus: statusFilter || undefined,
    voucherType: typeFilter || undefined, expenseCategory: categoryFilter || undefined,
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

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<FileStack size={20} />} label="Total"          value={stats.total}         color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Send size={20} />}      label="Posted"         value={stats.posted}        color="#0ea5e9" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Coins size={20} />}     label="Partially Paid" value={stats.partiallyPaid} color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<CheckCheck size={20} />} label="Fully Paid"     value={stats.fullyPaid}     color="#16a34a" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Wallet size={20} />}    label="Outstanding"    value={fmtINR(stats.outstanding)} color="#dc2626" /></Grid>
      </Grid>

      <Paper sx={{ ...pfmsCardSx, p: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField size="small" placeholder="Search voucher / invoice / vendor…" value={search} onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 240 } }} InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
        <Autocomplete size="small" sx={{ minWidth: 190 }} options={partiesRes?.data || []} value={vendorFilter}
          getOptionLabel={(o) => o?.name || ''} isOptionEqualToValue={(o, v) => o._id === v._id} onChange={(_e, v) => setVendorFilter(v)} renderInput={(params) => <TextField {...params} label="Vendor" />} />
        <TextField size="small" select label="Type" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); if (e.target.value !== 'EXPENSE') setCategoryFilter(''); }} sx={{ minWidth: 150 }}>
          <MenuItem value="">All</MenuItem>
          {VOUCHER_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
        </TextField>
        {typeFilter === 'EXPENSE' && (
          <TextField size="small" select label="Category" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} sx={{ minWidth: 170 }}>
            <MenuItem value="">All</MenuItem>
            {EXPENSE_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </TextField>
        )}
        <TextField size="small" select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          {VOUCHER_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
        </TextField>
        <DateInputDDMMYYYY size="small" label="From" value={from} onChange={setFrom} />
        <DateInputDDMMYYYY size="small" label="To" value={to} onChange={setTo} />
      </Paper>

      <Paper sx={{ ...pfmsCardSx, flexGrow: 1, minHeight: 420, overflow: 'hidden' }}>
        <DataGrid rows={data?.data || []} columns={columns} getRowId={(r) => r._id} loading={isLoading || isFetching}
          paginationMode="server" rowCount={data?.meta?.total || 0} paginationModel={paginationModel} onPaginationModelChange={setPaginationModel}
          onRowClick={(p) => navigate(`/procurement/vouchers/${p.id}`)} pageSizeOptions={[10, 25, 50, 100]} disableRowSelectionOnClick
          rowHeight={50} columnHeaderHeight={44} sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }} />
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
