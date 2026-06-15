import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  IconButton, Menu, ListItemIcon, ListItemText, Grid, Card, Tooltip, Autocomplete,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Plus, MoreVertical, Eye, Ban, FileDown,
  Wallet, Coins, Hourglass, SplitSquareHorizontal, CheckCheck, Scissors,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import {
  useGetFinalPaymentsQuery,
  useGetFinalPaymentStatsQuery,
  useCancelFinalPaymentMutation,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { fileHref } from '../indents/indentMeta';
import { PaymentStatusChip, PAYMENT_STATUSES, paymentModeLabel, fmtINR, fmtDate } from './paymentMeta';
import FinalPaymentFormDialog from './FinalPaymentFormDialog';

const KpiCard = ({ icon, label, value, color, money }) => (
  <Card sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5, borderRadius: '14px' }}>
    <Box sx={{ width: 42, height: 42, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.1), color }}>{icon}</Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: money ? '1.05rem' : '1.35rem', fontWeight: 800, lineHeight: 1.1 }} noWrap>{money ? fmtINR(value) : (value ?? 0)}</Typography>
      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>{label}</Typography>
    </Box>
  </Card>
);

const FinalPaymentList = () => {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);

  const [cancelPayment] = useCancelFinalPaymentMutation();

  const queryArgs = {
    page: paginationModel.page + 1, limit: paginationModel.pageSize, sort: '-createdAt',
    search: search || undefined, vendorId: vendorFilter?._id || undefined, paymentStatus: statusFilter || undefined,
    ...(from ? { 'paymentDate[gte]': `${from}T00:00:00` } : {}), ...(to ? { 'paymentDate[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching } = useGetFinalPaymentsQuery(queryArgs);
  const { data: statsRes } = useGetFinalPaymentStatsQuery();
  const stats = statsRes?.data || {};
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' });

  const openMenu = (e, row) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); setMenuRow(row); };
  const closeMenu = () => { setMenuAnchor(null); setMenuRow(null); };
  const onView = (r) => { navigate(`/procurement/final-payments/${r._id}`); closeMenu(); };
  const onProof = (r) => { window.open(fileHref(r.proofDocument?.fileUrl), '_blank'); closeMenu(); };
  const onCancel = async (r) => {
    closeMenu();
    try { await cancelPayment({ id: r._id }).unwrap(); enqueueSnackbar('Payment cancelled — amount reversed', { variant: 'info' }); }
    catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to cancel', { variant: 'error' }); }
  };

  const actionsFor = (r) => {
    const a = [{ key: 'view', label: 'View', icon: <Eye size={16} />, fn: () => onView(r) }];
    if (r.proofDocument?.fileUrl) a.push({ key: 'proof', label: 'View Proof', icon: <FileDown size={16} />, fn: () => onProof(r) });
    if (r.paymentStatus !== 'CANCELLED') a.push({ key: 'cancel', label: 'Cancel Payment', icon: <Ban size={16} />, fn: () => onCancel(r) });
    return a;
  };

  const columns = [
    { field: 'paymentNumber', headerName: 'PAYMENT NO', width: 135, renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'voucherNumber', headerName: 'VOUCHER', width: 125, renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value || '—'}</Typography> },
    { field: 'invoiceNumber', headerName: 'INVOICE', width: 125, renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value || '—'}</Typography> },
    { field: 'vendorName', headerName: 'VENDOR', flex: 1, minWidth: 140, renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    { field: 'paymentDate', headerName: 'DATE', width: 95, renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'paidAmount', headerName: 'PAID', width: 115, align: 'right', headerAlign: 'right', renderCell: (p) => <Typography variant="body2" fontWeight={700} sx={{ color: '#16a34a' }}>{fmtINR(p.value)}</Typography> },
    { field: 'balanceAfterPayment', headerName: 'BALANCE', width: 110, align: 'right', headerAlign: 'right', renderCell: (p) => <Typography variant="body2" sx={{ color: p.value > 0 ? '#b45309' : '#16a34a', fontWeight: 600 }}>{fmtINR(p.value)}</Typography> },
    { field: 'paymentMode', headerName: 'MODE', width: 110, renderCell: (p) => <Typography variant="body2" color="text.secondary">{paymentModeLabel(p.value)}</Typography> },
    { field: 'paymentReferenceNumber', headerName: 'REF NO', width: 110, renderCell: (p) => <Typography variant="body2" color="text.secondary" noWrap>{p.value || '—'}</Typography> },
    { field: 'paymentStatus', headerName: 'STATUS', width: 140, renderCell: (p) => <PaymentStatusChip status={p.value} /> },
    { field: '__actions', headerName: '', width: 60, sortable: false, filterable: false, align: 'center', renderCell: (p) => <Tooltip title="Actions"><IconButton size="small" onClick={(e) => openMenu(e, p.row)}><MoreVertical size={16} /></IconButton></Tooltip> },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: 2, sm: 3 }, minHeight: '100vh', bgcolor: '#f8fafc' }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, color: '#0b2545' }}>Final Payments</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', fontWeight: 500 }}>Step 1.13 · Make Payment — final settlement after Tally Entry → Accounts Closed</Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setFormOpen(true)}>Make Payment</Button>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2}><KpiCard icon={<Wallet size={20} />}                 label="Total Payments" value={stats.total}         color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2}><KpiCard icon={<Coins size={20} />}                  label="Paid Amount"    value={stats.paidAmount}    color="#16a34a" money /></Grid>
        <Grid item xs={12} sm={6} md={2}><KpiCard icon={<Hourglass size={20} />}              label="Pending Amount" value={stats.pendingAmount} color="#dc2626" money /></Grid>
        <Grid item xs={12} sm={6} md={2}><KpiCard icon={<SplitSquareHorizontal size={20} />} label="Part Payments"  value={stats.part}          color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2}><KpiCard icon={<CheckCheck size={20} />}             label="Full Payments"  value={stats.full}          color="#0f766e" /></Grid>
        <Grid item xs={12} sm={6} md={2}><KpiCard icon={<Scissors size={20} />}               label="Short Closed"   value={stats.shortClosed}   color="#7c3aed" /></Grid>
      </Grid>

      <Paper sx={{ p: 1.5, borderRadius: '14px', display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField size="small" placeholder="Search payment / voucher / vendor…" value={search} onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 240 } }} InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color="#94a3b8" /></InputAdornment> }} />
        <Autocomplete size="small" sx={{ minWidth: 190 }} options={partiesRes?.data || []} value={vendorFilter}
          getOptionLabel={(o) => o?.name || ''} isOptionEqualToValue={(o, v) => o._id === v._id} onChange={(_e, v) => setVendorFilter(v)} renderInput={(params) => <TextField {...params} label="Vendor" />} />
        <TextField size="small" select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">All</MenuItem>
          {PAYMENT_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
        </TextField>
        <DateInputDDMMYYYY size="small" label="From" value={from} onChange={setFrom} />
        <DateInputDDMMYYYY size="small" label="To" value={to} onChange={setTo} />
      </Paper>

      <Paper sx={{ flexGrow: 1, minHeight: 420, borderRadius: '16px', overflow: 'hidden' }}>
        <DataGrid rows={data?.data || []} columns={columns} getRowId={(r) => r._id} loading={isLoading || isFetching}
          paginationMode="server" rowCount={data?.meta?.total || 0} paginationModel={paginationModel} onPaginationModelChange={setPaginationModel}
          onRowClick={(p) => navigate(`/procurement/final-payments/${p.id}`)} pageSizeOptions={[10, 25, 50, 100]} disableRowSelectionOnClick
          rowHeight={50} columnHeaderHeight={44} sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }} />
      </Paper>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuRow && actionsFor(menuRow).map((a) => (
          <MenuItem key={a.key} onClick={a.fn}><ListItemIcon>{a.icon}</ListItemIcon><ListItemText>{a.label}</ListItemText></MenuItem>
        ))}
      </Menu>

      <FinalPaymentFormDialog open={formOpen} onClose={() => setFormOpen(false)} />
    </Box>
  );
};

export default FinalPaymentList;
