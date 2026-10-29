import React, { useState } from 'react';
import { serialColumn } from '../components/serialNumber';
import { stepTimingColumns } from '../components/stepTimingColumns';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  Menu, ListItemIcon, ListItemText, Grid, Autocomplete,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Plus, Eye, Ban, FileDown, ReceiptText,
  Wallet, Coins, Hourglass, SplitSquareHorizontal, CheckCheck, Scissors,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import {
  useGetFinalPaymentsQuery,
  useGetFinalPaymentStatsQuery,
  useCancelFinalPaymentMutation,
  useGenerateFinalPaymentPdfMutation,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import AdaptiveFilterBar from '../components/AdaptiveFilterBar';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import { fileHref } from '../indents/indentMeta';
import { PaymentStatusChip, PAYMENT_STATUSES, PAYMENT_MODES, paymentModeLabel, fmtINR, fmtDate } from './paymentMeta';
import FinalPaymentFormDialog from './FinalPaymentFormDialog';
import PdfViewerModal from '../common/PdfViewerModal';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';

import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
import RowQuickViewDialog from '../common/RowQuickViewDialog';
import RowActionsCell from '../components/RowActionsCell';
import { rowActionsColumn, rowActionsGridProps, rowActionsGridSx } from '../components/rowActionsColumn';
const FinalPaymentList = () => {
  const navigate = useNavigate();
  const rowNav = useRowNavigation({ to: (r) => `/procurement/final-payments/${r._id}` });
  const { enqueueSnackbar } = useSnackbar();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };
  const secondaryCount = [vendorFilter, modeFilter, from, to].filter(Boolean).length;
  const clearSecondary = () => { setVendorFilter(null); setModeFilter(''); setFrom(''); setTo(''); resetPage(); };
  const anyFilterActive = Boolean(search || statusFilter || secondaryCount);
  const clearAll = () => { resetSearch(); setStatusFilter(''); clearSecondary(); };

  const [formOpen, setFormOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);
  const [quickRow, setQuickRow] = useState(null); // row whose quick view is open
  const [receipt, setReceipt] = useState({ open: false, url: '', title: '', fileName: '', loading: false });

  const [cancelPayment] = useCancelFinalPaymentMutation();
  const [genPdf] = useGenerateFinalPaymentPdfMutation();

  const queryArgs = {
    page: paginationModel.page + 1, limit: paginationModel.pageSize, sort: '-createdAt',
    search: search || undefined, vendorId: vendorFilter?._id || undefined, paymentStatus: statusFilter || undefined,
    // No dedicated Joi rule for paymentMode in the list schema, but it's
    // `.unknown(true)` and paymentMode is a real, indexed enum field on the
    // model — ApiFeatures.filter() exact-matches it with no backend change.
    paymentMode: modeFilter || undefined,
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
  const onReceipt = async (r) => {
    closeMenu();
    const title = `Payment Receipt — ${r.paymentNumber}`;
    if (r.paymentPdfUrl) { setReceipt({ open: true, url: r.paymentPdfUrl, title, fileName: r.paymentPdfFileName, loading: false }); return; }
    setReceipt({ open: true, url: '', title, fileName: '', loading: true });
    try {
      const res = await genPdf({ id: r._id }).unwrap();
      const url = res?.data?.paymentPdfUrl;
      setReceipt((s) => ({ ...s, url: url || '', loading: false }));
      if (!url) { setReceipt({ open: false, url: '', title: '', fileName: '', loading: false }); enqueueSnackbar('Receipt generated', { variant: 'success' }); }
    } catch (err) {
      setReceipt({ open: false, url: '', title: '', fileName: '', loading: false });
      enqueueSnackbar(err?.data?.message || 'Failed to generate receipt', { variant: 'error' });
    }
  };
  const onCancel = async (r) => {
    closeMenu();
    try { await cancelPayment({ id: r._id }).unwrap(); enqueueSnackbar('Payment cancelled — amount reversed', { variant: 'info' }); }
    catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to cancel', { variant: 'error' }); }
  };

  const actionsFor = (r) => {
    const a = [{ key: 'view', label: 'View', icon: <Eye size={16} />, fn: () => onView(r) }];
    if (r.proofDocument?.fileUrl) a.push({ key: 'proof', label: 'View Proof', icon: <FileDown size={16} />, fn: () => onProof(r) });
    if (r.paymentStatus !== 'CANCELLED') a.push({ key: 'cancel', label: 'Cancel Payment', icon: <Ban size={16} />, fn: () => onCancel(r) });
    // The receipt PDF is always the last item.
    a.push({ key: 'receipt', label: r.paymentPdfUrl ? 'Receipt PDF' : 'Generate Receipt', icon: <ReceiptText size={16} />, fn: () => onReceipt(r) });
    return a;
  };

  const columns = [
    serialColumn(),
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
    ...stepTimingColumns(),
    // Eye = quick view (popup, the list stays put); ⋮ holds View (the full page,
    // also the row click) and the row's other actions. Pinned to the right.
    rowActionsColumn((p) => (
      <RowActionsCell rowId={p.row._id} label={p.row.paymentNumber}
        onQuickView={() => setQuickRow(p.row)} onMenu={(e) => openMenu(e, p.row)} />
    )),
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, ...pfmsPageSx }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={pfmsTitleSx}>Final Payments ({stats.total || 0})</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>Step 1.13 · Make Payment — final settlement after Tally Entry → Accounts Closed</Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setFormOpen(true)}>Make Payment</Button>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2}><PfmsKpiCard icon={<Wallet size={20} />}                 label="Total Payments" value={stats.total}                 color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2}><PfmsKpiCard icon={<Coins size={20} />}                  label="Paid Amount"    value={fmtINR(stats.paidAmount)}    color="#16a34a" /></Grid>
        <Grid item xs={12} sm={6} md={2}><PfmsKpiCard icon={<Hourglass size={20} />}              label="Pending Amount" value={fmtINR(stats.pendingAmount)} color="#dc2626" /></Grid>
        <Grid item xs={12} sm={6} md={2}><PfmsKpiCard icon={<SplitSquareHorizontal size={20} />} label="Part Payments"  value={stats.part}                  color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2}><PfmsKpiCard icon={<CheckCheck size={20} />}             label="Full Payments"  value={stats.full}                  color="#0f766e" /></Grid>
        <Grid item xs={12} sm={6} md={2}><PfmsKpiCard icon={<Scissors size={20} />}               label="Short Closed"   value={stats.shortClosed}           color="#7e22ce" /></Grid>
      </Grid>

      {/* Filters — Search + Status stay visible; Vendor, Payment Mode and the
          date range move into Filters, which only counts those as active. */}
      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <AdaptiveFilterBar
          pinned={[
            { key: 'search', minWidth: 220, node: (
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 220px' }, minWidth: 0 }}>
                <Typography component="label" htmlFor="fp-search" sx={pfmsFieldLabelSx}>Search</Typography>
                <TextField id="fp-search" size="small" fullWidth placeholder="Search payment / voucher / vendor…"
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
              </Box>
            ) },
            { key: 'status', minWidth: 180, node: (
              <Box sx={{ flex: '0 1 180px', minWidth: 150 }}>
                <Typography component="label" htmlFor="fp-status" sx={pfmsFieldLabelSx}>Status</Typography>
                <TextField id="fp-status" size="small" select fullWidth value={statusFilter}
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
                    {PAYMENT_MODES.map((m) => <MenuItem key={m} value={m}>{paymentModeLabel(m)}</MenuItem>)}
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

      <Paper sx={{ ...pfmsCardSx, flexGrow: 1, minHeight: 420, overflow: 'hidden' }}>
        <DataGrid rows={data?.data || []} columns={columns} getRowId={(r) => r._id} loading={isLoading || isFetching}
          paginationMode="server" rowCount={data?.meta?.total || 0} paginationModel={paginationModel} onPaginationModelChange={setPaginationModel}
          {...rowNav.gridProps} {...rowActionsGridProps} pageSizeOptions={[10, 25, 50, 100]} disableRowSelectionOnClick
          rowHeight={50} columnHeaderHeight={44} sx={[{ border: 0 }, rowNavigationGridSx, rowActionsGridSx]} />
      </Paper>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuRow && actionsFor(menuRow).map((a) => (
          <MenuItem key={a.key} onClick={a.fn}><ListItemIcon>{a.icon}</ListItemIcon><ListItemText>{a.label}</ListItemText></MenuItem>
        ))}
      </Menu>

      <FinalPaymentFormDialog open={formOpen} onClose={() => setFormOpen(false)} />
      <PdfViewerModal
        open={receipt.open}
        onClose={() => setReceipt((s) => ({ ...s, open: false }))}
        url={receipt.url}
        loading={receipt.loading}
        title={receipt.title}
        fileName={receipt.fileName}
      />
      <RowQuickViewDialog open={Boolean(quickRow)} onClose={() => setQuickRow(null)}
        title="Payment Details" number={quickRow?.paymentNumber}
        status={quickRow ? <PaymentStatusChip status={quickRow.paymentStatus} /> : null}
        subtitle={quickRow?.vendorName}
        fields={quickRow ? [
          { label: 'Voucher', value: quickRow.voucherNumber },
          { label: 'Invoice', value: quickRow.invoiceNumber },
          { label: 'Date', value: fmtDate(quickRow.paymentDate) },
          { label: 'Paid', value: fmtINR(quickRow.paidAmount) },
          { label: 'Balance', value: fmtINR(quickRow.balanceAfterPayment) },
          { label: 'Mode', value: paymentModeLabel(quickRow.paymentMode) },
          { label: 'Ref No', value: quickRow.paymentReferenceNumber },
        ] : []}
        openFullLabel="Open full payment" onOpenFull={quickRow ? () => onView(quickRow) : undefined} />
    </Box>
  );
};

export default FinalPaymentList;
