import React, { useState } from 'react';
import { serialColumn } from '../components/serialNumber';
import { stepTimingColumns } from '../components/stepTimingColumns';
import {
  Box, Typography, Paper, TextField, InputAdornment, MenuItem, Button,
  Grid, Autocomplete, Chip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, Wallet, IndianRupee, Hourglass, AlertTriangle, CircleSlash } from 'lucide-react';
import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
import {
  useGetAdvancePaymentsQuery,
  useGetAdvancePaymentStatsQuery,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import AdaptiveFilterBar from '../components/AdaptiveFilterBar';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import { PaymentStatusChip, PAYMENT_STATUSES, PAYMENT_MODES, modeLabel, fmtINR, fmtDate } from './apMeta';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';

const AdvancePaymentList = () => {
  // No standalone advance-payment detail page — a row opens its PI, and rows
  // without one are not clickable.
  const rowNav = useRowNavigation({ to: (r) => (r.piId ? `/procurement/proforma-invoices/${r.piId}` : null) });

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };

  // "Filters" covers Vendor, Payment Mode and the date range — Status stays
  // always visible.
  const secondaryCount = [vendorFilter, modeFilter, from, to].filter(Boolean).length;
  const clearSecondary = () => { setVendorFilter(null); setModeFilter(''); setFrom(''); setTo(''); resetPage(); };
  const anyFilterActive = Boolean(search || statusFilter || secondaryCount);
  const clearAll = () => { resetSearch(); setStatusFilter(''); clearSecondary(); };

  const queryArgs = {
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    sort: '-createdAt',
    search: search || undefined,
    vendorId: vendorFilter?._id || undefined,
    paymentStatus: statusFilter || undefined,
    // paymentMode has no dedicated Joi rule in the list schema, but the schema
    // is `.unknown(true)` and `paymentMode` is a real, indexed enum field on
    // the model — ApiFeatures.filter() exact-matches it with no backend change.
    paymentMode: modeFilter || undefined,
    ...(from ? { 'paymentDate[gte]': `${from}T00:00:00` } : {}),
    ...(to ? { 'paymentDate[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching } = useGetAdvancePaymentsQuery(queryArgs);
  const { data: statsRes } = useGetAdvancePaymentStatsQuery();
  const stats = statsRes?.data || {};
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' });

  const columns = [
    serialColumn(),
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
    ...stepTimingColumns(),
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, ...pfmsPageSx }}>
      {/* Header */}
      <Box>
        <Typography sx={pfmsTitleSx}>Advance Payments ({stats.totalPayments || 0})</Typography>
        <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>
          Step 1.7 · Payments recorded against approved PIs — record from the PI detail page
        </Typography>
      </Box>

      {/* KPIs */}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Wallet size={20} />}        label="Total Payments"      value={stats.totalPayments}             color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<IndianRupee size={20} />}   label="Paid Amount"         value={fmtINR(stats.paidAmount)}        color="#0f766e" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Hourglass size={20} />}     label="Pending Amount"      value={fmtINR(stats.pendingAmount)}     color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<AlertTriangle size={20} />} label="Outstanding (Short)" value={fmtINR(stats.outstandingAmount)} color="#be123c" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<CircleSlash size={20} />}   label="Cancelled Entries"   value={stats.cancelled}                 color="#64748b" /></Grid>
      </Grid>

      {/* Filters — Search + Status stay visible; Vendor, Payment Mode and the
          date range move into Filters, which only counts those as active. */}
      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <AdaptiveFilterBar
          pinned={[
            { key: 'search', minWidth: 230, node: (
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 230px' }, minWidth: 0 }}>
                <Typography component="label" htmlFor="ap-search" sx={pfmsFieldLabelSx}>Search</Typography>
                <TextField id="ap-search" size="small" fullWidth placeholder="Search payment / PI / PO / ref…"
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
              </Box>
            ) },
            { key: 'status', minWidth: 190, node: (
              <Box sx={{ flex: '0 1 190px', minWidth: 160 }}>
                <Typography component="label" htmlFor="ap-status" sx={pfmsFieldLabelSx}>Status</Typography>
                <TextField id="ap-status" size="small" select fullWidth value={statusFilter}
                  SelectProps={ALL_WHEN_UNSET} onChange={(e) => onFilterChange(setStatusFilter)(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {PAYMENT_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
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
              key: 'mode', width: 160, active: Boolean(modeFilter),
              node: (
                <Box sx={{ flex: '0 1 160px', minWidth: 140 }}>
                  <TextField size="small" select fullWidth label="Payment Mode" value={modeFilter}
                    InputLabelProps={{ shrink: true }}
                    SelectProps={ALL_WHEN_UNSET} onChange={(e) => onFilterChange(setModeFilter)(e.target.value)}>
                    <MenuItem value="">All</MenuItem>
                    {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{modeLabel(m)}</MenuItem>)}
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
    </Box>
  );
};

export default AdvancePaymentList;
