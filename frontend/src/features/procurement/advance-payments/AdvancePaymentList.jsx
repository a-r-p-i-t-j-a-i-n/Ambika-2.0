import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { serialColumn } from '../components/serialNumber';
import { stepTimingColumns } from '../components/stepTimingColumns';
import AdvancePaymentDetailDialog from './AdvancePaymentDetailDialog';
import useAdvancePaymentPdf from './useAdvancePaymentPdf';
import {
  Box, Typography, Paper, TextField, InputAdornment, MenuItem, Button,
  Autocomplete, Chip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, Wallet, IndianRupee, Hourglass, AlertTriangle, CircleSlash, FileText, Plus, FileDown, Paperclip, CircleDollarSign, CircleCheck, CircleDashed } from 'lucide-react';
import AdvancePaymentFormDialog from './AdvancePaymentFormDialog';
import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
import {
  useGetAdvancePaymentsQuery,
  useGetAdvancePaymentStatsQuery,
  useDeleteAdvancePaymentMutation,
} from '../../../store/api/procurementApi';
import { usePermissions } from '../../../hooks/usePermission';
import RowActionsCell from '../components/RowActionsCell';
import RowActionsMenu from '../components/RowActionsMenu';
import useRecordDelete from '../components/useRecordDelete';
import { rowActionsColumn, rowActionsGridProps, rowActionsGridSx } from '../components/rowActionsColumn';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import AdaptiveFilterBar from '../components/AdaptiveFilterBar';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import { PaymentStatusChip, PAYMENT_STATUSES, PAYMENT_MODES, PI_PAYMENT_STATES, modeLabel, fmtINR, fmtDate } from './apMeta';
import StatusChip from '../components/StatusChip';
import { fileHref } from '../indents/indentMeta';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { listEmptyLabel } from '../components/useKpiFilter';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET, pfmsKpiRowSx } from '../pfmsTheme';

const AdvancePaymentList = () => {
  // No standalone advance-payment detail page — a row opens its PI, and rows
  // without one are not clickable.
  const rowNav = useRowNavigation({ to: (r) => (r.piId ? `/procurement/proforma-invoices/${r.piId}` : null) });
  const navigate = useNavigate();

  // ⋮: its PI, and Delete (procurement.deleteAdvancePayment — MD has it). The
  // server takes back only a PI's latest payment, and not once invoices use it.
  const menuRef = useRef(null); // RowActionsMenu owns its open state
  const [removeAdvance] = useDeleteAdvancePaymentMutation();
  const canDeleteAdvance = usePermissions().can('procurement.deleteAdvancePayment');
  const del = useRecordDelete({
    type: 'ADVANCE_PAYMENT', what: 'Advance', numberOf: (r) => r.paymentNumber, remove: removeAdvance,
    consequence: () => 'The payment is taken back off its PI (paid and balance amounts go back). Only the latest payment of a PI can be deleted, and not once vendor invoices use the advance.',
  });
  const pdf = useAdvancePaymentPdf();
  const actionsFor = (r) => [
    ...(r.piId ? [{ key: 'pi', label: 'View PI', icon: <FileText size={16} />, fn: () => navigate(`/procurement/proforma-invoices/${r.piId}`) }] : []),
    ...(r.proofDocument?.fileUrl ? [{ key: 'proof', label: 'View Proof', icon: <Paperclip size={16} />, fn: () => window.open(fileHref(r.proofDocument.fileUrl), '_blank') }] : []),
    ...(canDeleteAdvance ? [del.action(r, { divider: true })] : []),
    { key: 'pdf', label: 'Preview PDF', icon: <FileDown size={16} />, fn: () => pdf.preview(r), divider: !canDeleteAdvance },
    { key: 'pdf-dl', label: 'Download PDF', icon: <FileDown size={16} />, fn: () => pdf.download(r) },
  ];

  const [quickRow, setQuickRow] = useState(null); // row whose Eye detail is open
  const [recordOpen, setRecordOpen] = useState(false); // "+ Record Advance Payment" (pick a PO, then pay)
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [sortModel, setSortModel] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };

  // "Filters" covers Vendor, Payment Mode and the date range — Status stays
  // always visible.
  const secondaryCount = [vendorFilter, modeFilter, stateFilter, from, to].filter(Boolean).length;
  const clearSecondary = () => { setVendorFilter(null); setModeFilter(''); setStateFilter(''); setFrom(''); setTo(''); resetPage(); };
  const anyFilterActive = Boolean(search || statusFilter || secondaryCount);
  const clearAll = () => { resetSearch(); setStatusFilter(''); clearSecondary(); };

  // Total Paid sums every payment that is not cancelled (advancePayment.service
  // getStats) — the list API takes those statuses as one comma list.
  const PAID_STATUSES = PAYMENT_STATUSES.filter((s) => s !== 'CANCELLED').join(',');
  const paidActive = statusFilter === PAID_STATUSES && !stateFilter;

  const queryArgs = {
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    // Server-side sort on the payment's own fields; newest first by default.
    sort: sortModel[0] ? `${sortModel[0].sort === 'desc' ? '-' : ''}${sortModel[0].field}` : '-createdAt',
    search: search || undefined,
    piPaymentState: stateFilter || undefined,
    vendorId: vendorFilter?._id || undefined,
    paymentStatus: statusFilter || undefined,
    // paymentMode has no dedicated Joi rule in the list schema, but the schema
    // is `.unknown(true)` and `paymentMode` is a real, indexed enum field on
    // the model — ApiFeatures.filter() exact-matches it with no backend change.
    paymentMode: modeFilter || undefined,
    ...(from ? { 'paymentDate[gte]': `${from}T00:00:00` } : {}),
    ...(to ? { 'paymentDate[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching, isError } = useGetAdvancePaymentsQuery(queryArgs);
  const { data: statsRes } = useGetAdvancePaymentStatsQuery();
  const stats = statsRes?.data || {};
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' });

  const columns = [
    serialColumn(),
    { field: 'paymentDate', headerName: 'DATE', width: 95,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'paymentNumber', headerName: 'PAYMENT NO', width: 130,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'poNumber', headerName: 'PO NUMBER', width: 140,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value || '—'}</Typography> },
    { field: 'piNumber', headerName: 'PI NUMBER', width: 115,
      renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value || '—'}</Typography> },
    { field: 'indentNumber', headerName: 'INDENT NO', width: 125,
      renderCell: (p) => <Typography variant="body2" color="text.secondary" noWrap>{p.value || '—'}</Typography> },
    { field: 'vendorName', headerName: 'VENDOR', flex: 1, minWidth: 150,
      renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    // The PI's whole-advance figures (current), not just this payment — same on every row of one PI.
    { field: 'advanceRequired', headerName: 'ADVANCE REQUIRED', width: 140, align: 'right', headerAlign: 'right', sortable: false,
      renderCell: (p) => <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtINR(p.value)}</Typography> },
    { field: 'totalPaid', headerName: 'TOTAL PAID', width: 120, align: 'right', headerAlign: 'right', sortable: false,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} sx={{ color: '#0f766e', fontVariantNumeric: 'tabular-nums' }}>{fmtINR(p.value)}</Typography> },
    { field: 'remainingBalance', headerName: 'REMAINING', width: 120, align: 'right', headerAlign: 'right', sortable: false,
      renderCell: (p) => <Typography variant="body2" sx={{ color: p.value > 0 ? '#b45309' : '#0f766e', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtINR(p.value)}</Typography> },
    { field: 'paidAmount', headerName: 'THIS PAYMENT', width: 125, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" fontWeight={700} sx={{ color: '#1d4ed8', fontVariantNumeric: 'tabular-nums' }}>{fmtINR(p.value)}</Typography> },
    { field: 'paymentMode', headerName: 'MODE', width: 130,
      renderCell: (p) => <Chip size="small" variant="outlined" label={modeLabel(p.value)} sx={{ fontWeight: 700 }} /> },
    { field: 'paymentReferenceNumber', headerName: 'REFERENCE', width: 160, sortable: false,
      renderCell: (p) => <Typography variant="body2" color="text.secondary" noWrap>{p.value || '—'}</Typography> },
    { field: 'paymentStatus', headerName: 'PAYMENT STATUS', width: 150,
      renderCell: (p) => <PaymentStatusChip status={p.value} /> },
    { field: 'piPaymentState', headerName: 'ADVANCE STATUS', width: 150, sortable: false,
      renderCell: (p) => (p.value ? <StatusChip status={p.value} /> : null) },
    { field: 'performedByName', headerName: 'RECORDED BY', width: 140,
      renderCell: (p) => <Typography variant="body2" color="text.secondary" noWrap>{p.value || '—'}</Typography> },
    ...stepTimingColumns(),
    rowActionsColumn((p) => (
      <RowActionsCell rowId={p.row._id} label={p.row.paymentNumber}
        onQuickView={() => setQuickRow(p.row)} quickViewLabel="View payment" quickViewTestId="ap-row-view"
        onMenu={(e) => { e.stopPropagation(); menuRef.current?.open(e.currentTarget, p.row); }} />
    )),
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, ...pfmsPageSx }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ minWidth: 0, flex: '1 1 320px' }}>
          <Typography sx={pfmsTitleSx}>Advance Payments ({stats.totalPayments || 0})</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>
            Step 1.7 · An advance is paid against a PO&apos;s approved Proforma Invoice (after MD approval) — in parts if needed. Use + Record Advance Payment or Record Payment on the Awaiting Advance tab
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setRecordOpen(true)}
          data-testid="ap-record-advance" sx={{ flexShrink: 0, fontWeight: 700, whiteSpace: 'nowrap', ml: 'auto' }}>
          Record Advance Payment
        </Button>
      </Box>

      {/* KPIs */}
      <Box sx={pfmsKpiRowSx(7)}>
        {/* Cards are shortcuts for this screen's own Advance Status / Status
            filters (advancePayment.service getStats). Total Advance Required
            clears both; Remaining Advance is the balance of the PIs listed on
            the Awaiting Advance tab (same findPayablePis source), so it opens
            that tab. Total Paid lists the non-cancelled payments it sums. */}
        <PfmsKpiCard icon={<Wallet size={20} />}           label="Total Advance Required" value={fmtINR(stats.totalAdvanceRequired)} color="#2563eb"
          onClick={() => { setStateFilter(''); onFilterChange(setStatusFilter)(''); }} active={!stateFilter && !statusFilter} />
        <PfmsKpiCard icon={<IndianRupee size={20} />}      label="Total Paid"             value={fmtINR(stats.totalPaid)}            color="#0f766e"
          onClick={() => { setStateFilter(''); onFilterChange(setStatusFilter)(paidActive ? '' : PAID_STATUSES); }} active={paidActive} />
        <PfmsKpiCard icon={<Hourglass size={20} />}        label="Remaining Advance"      value={fmtINR(stats.remainingAdvance)}     color="#b45309"
          onClick={() => navigate('/purchase-fms/advance-payments?view=awaiting')} />
        <PfmsKpiCard icon={<CircleDashed size={20} />}     label="Partially Paid POs/PIs" value={stats.partiallyPaidCount}           color="#c2410c"
          onClick={() => onFilterChange(setStateFilter)(stateFilter === 'PARTIALLY_PAID' ? '' : 'PARTIALLY_PAID')} active={stateFilter === 'PARTIALLY_PAID'} />
        <PfmsKpiCard icon={<CircleCheck size={20} />}      label="Fully Paid POs/PIs"     value={stats.fullyPaidCount}               color="#15803d"
          onClick={() => onFilterChange(setStateFilter)(stateFilter === 'FULLY_PAID' ? '' : 'FULLY_PAID')} active={stateFilter === 'FULLY_PAID'} />
        <PfmsKpiCard icon={<AlertTriangle size={20} />}    label="Outstanding (Short)"    value={fmtINR(stats.outstandingAmount)}    color="#7e22ce"
          onClick={() => onFilterChange(setStateFilter)(stateFilter === 'SHORT_CLOSED' ? '' : 'SHORT_CLOSED')} active={stateFilter === 'SHORT_CLOSED'} />
        <PfmsKpiCard icon={<CircleSlash size={20} />}      label="Cancelled Entries"      value={stats.cancelled}                    color="#be123c"
          onClick={() => onFilterChange(setStatusFilter)(statusFilter === 'CANCELLED' ? '' : 'CANCELLED')} active={statusFilter === 'CANCELLED'} />
      </Box>

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
                  <MenuItem value={PAID_STATUSES}>ALL PAID (NOT CANCELLED)</MenuItem>
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
              key: 'state', width: 190, active: Boolean(stateFilter),
              node: (
                <Box sx={{ flex: '0 1 190px', minWidth: 160 }}>
                  <TextField size="small" select fullWidth label="Advance Status" value={stateFilter}
                    InputLabelProps={{ shrink: true }} inputProps={{ 'data-testid': 'ap-state-filter' }}
                    SelectProps={ALL_WHEN_UNSET} onChange={(e) => onFilterChange(setStateFilter)(e.target.value)}>
                    <MenuItem value="">All</MenuItem>
                    {PI_PAYMENT_STATES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
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
          localeText={{ noRowsLabel: listEmptyLabel({ isError, filtered: anyFilterActive, empty: 'No advance payments yet' }) }}
          paginationMode="server"
          sortingMode="server"
          sortModel={sortModel}
          onSortModelChange={(m) => { setSortModel(m); resetPage(); }}
          rowCount={data?.meta?.total || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          {...rowNav.gridProps} {...rowActionsGridProps}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          rowHeight={50}
          columnHeaderHeight={44}
          sx={[{ border: 0 }, rowNavigationGridSx, rowActionsGridSx]}
        />
      </Paper>
      <RowActionsMenu ref={menuRef} actionsFor={actionsFor} />
      {/* Same form as the Awaiting Advance "Record Payment" action; with no PI it opens on the PO picker. */}
      {recordOpen && <AdvancePaymentFormDialog open onClose={() => setRecordOpen(false)} />}
      {del.dialog}
      {/* Full payment details: PO / PI / vendor, advance position, every payment on the PI, approvals, PDF. */}
      {quickRow && <AdvancePaymentDetailDialog row={quickRow} onClose={() => setQuickRow(null)} pdf={pdf} />}
      {pdf.modal}
    </Box>
  );
};

export default AdvancePaymentList;
