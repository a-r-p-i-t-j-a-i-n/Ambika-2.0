import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, MenuItem,
  Grid, Card, Autocomplete, Chip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, Wallet, IndianRupee, Hourglass, AlertTriangle, CircleSlash } from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import {
  useGetAdvancePaymentsQuery,
  useGetAdvancePaymentStatsQuery,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { PaymentStatusChip, PAYMENT_STATUSES, modeLabel, fmtINR, fmtDate } from './apMeta';

const KpiCard = ({ icon, label, value, color, money = false }) => (
  <Card sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5, borderRadius: '14px' }}>
    <Box sx={{ width: 42, height: 42, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.1), color }}>
      {icon}
    </Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: money ? '1.05rem' : '1.35rem', fontWeight: 800, lineHeight: 1.1, color: 'text.primary' }} noWrap>
        {money ? fmtINR(value) : (value ?? 0)}
      </Typography>
      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>{label}</Typography>
    </Box>
  </Card>
);

const AdvancePaymentList = () => {
  const navigate = useNavigate();

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const queryArgs = {
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    sort: '-createdAt',
    search: search || undefined,
    vendorId: vendorFilter?._id || undefined,
    paymentStatus: statusFilter || undefined,
    ...(from ? { 'paymentDate[gte]': `${from}T00:00:00` } : {}),
    ...(to ? { 'paymentDate[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching } = useGetAdvancePaymentsQuery(queryArgs);
  const { data: statsRes } = useGetAdvancePaymentStatsQuery();
  const stats = statsRes?.data || {};
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' });

  const columns = [
    { field: 'paymentDate', headerName: 'DATE', width: 95,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'paymentNumber', headerName: 'PAYMENT NO', width: 130,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'piNumber', headerName: 'PI NUMBER', width: 115,
      renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value || '—'}</Typography> },
    { field: 'poNumber', headerName: 'PO NUMBER', width: 140,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value || '—'}</Typography> },
    { field: 'vendorName', headerName: 'VENDOR', flex: 1, minWidth: 150,
      renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    { field: 'paidAmount', headerName: 'PAID', width: 115, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" fontWeight={700} sx={{ color: '#0f766e', fontVariantNumeric: 'tabular-nums' }}>{fmtINR(p.value)}</Typography> },
    { field: 'balanceAmount', headerName: 'BALANCE AFTER', width: 125, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" sx={{ color: p.value > 0 ? '#b45309' : '#0f766e', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtINR(p.value)}</Typography> },
    { field: 'paymentMode', headerName: 'MODE', width: 130,
      renderCell: (p) => <Chip size="small" variant="outlined" label={modeLabel(p.value)} sx={{ fontWeight: 700 }} /> },
    { field: 'paymentReferenceNumber', headerName: 'REFERENCE', width: 160,
      renderCell: (p) => <Typography variant="body2" color="text.secondary" noWrap>{p.value || '—'}</Typography> },
    { field: 'paymentStatus', headerName: 'STATUS', width: 140,
      renderCell: (p) => <PaymentStatusChip status={p.value} /> },
    { field: 'performedByName', headerName: 'BY', width: 110,
      renderCell: (p) => <Typography variant="body2" color="text.secondary" noWrap>{p.value || '—'}</Typography> },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: 2, sm: 3 }, minHeight: '100vh', bgcolor: '#f8fafc' }}>
      {/* Header */}
      <Box>
        <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, color: '#0b2545' }}>Advance Payments (7)</Typography>
        <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', fontWeight: 500 }}>
          Step 1.7 · Payments recorded against approved PIs — record from the PI detail page
        </Typography>
      </Box>

      {/* KPIs */}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<Wallet size={20} />}        label="Total Payments"     value={stats.totalPayments}     color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<IndianRupee size={20} />}   label="Paid Amount"        value={stats.paidAmount}        color="#0f766e" money /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<Hourglass size={20} />}     label="Pending Amount"     value={stats.pendingAmount}     color="#b45309" money /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<AlertTriangle size={20} />} label="Outstanding (Short)" value={stats.outstandingAmount} color="#be123c" money /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<CircleSlash size={20} />}   label="Cancelled Entries"  value={stats.cancelled}         color="#64748b" /></Grid>
      </Grid>

      {/* Filters */}
      <Paper sx={{ p: 1.5, borderRadius: '14px', display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField size="small" placeholder="Search payment / PI / PO / ref…" value={search} onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 260 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color="#94a3b8" /></InputAdornment> }} />
        <Autocomplete
          size="small" sx={{ minWidth: 190 }}
          options={partiesRes?.data || []}
          value={vendorFilter}
          getOptionLabel={(o) => o?.name || ''}
          isOptionEqualToValue={(o, v) => o._id === v._id}
          onChange={(_e, v) => setVendorFilter(v)}
          renderInput={(params) => <TextField {...params} label="Vendor" />}
        />
        <TextField size="small" select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 190 }}>
          <MenuItem value="">All</MenuItem>
          {PAYMENT_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
        </TextField>
        <DateInputDDMMYYYY size="small" label="From" value={from} onChange={setFrom} />
        <DateInputDDMMYYYY size="small" label="To" value={to} onChange={setTo} />
      </Paper>

      {/* Grid */}
      <Paper sx={{ flexGrow: 1, minHeight: 420, borderRadius: '16px', overflow: 'hidden' }}>
        <DataGrid
          rows={data?.data || []}
          columns={columns}
          getRowId={(r) => r._id}
          loading={isLoading || isFetching}
          paginationMode="server"
          rowCount={data?.meta?.total || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          onRowClick={(p) => p.row.piId && navigate(`/procurement/proforma-invoices/${p.row.piId}`)}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          rowHeight={50}
          columnHeaderHeight={44}
          sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Paper>
    </Box>
  );
};

export default AdvancePaymentList;
