import React, { useState } from 'react';
import { serialColumn } from '../components/serialNumber';
import { stepTimingColumns } from '../components/stepTimingColumns';
import {
  Box, Typography, Paper, TextField, InputAdornment, MenuItem, Grid, Autocomplete, Alert, Chip, Tooltip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, ShieldCheck, Clock, BadgeCheck, CheckCheck, Wallet } from 'lucide-react';
import { useGetMdApprovalsQuery } from '../../../store/api/procurementApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import AdaptiveFilterBar from '../components/AdaptiveFilterBar';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';
import { fmtDate } from './approvalMeta';
import {
  MD_VIEW_STATUS, MD_VIEW_STATUSES, MD_APPROVAL_MODULES, fmtINR,
} from './mdApprovalMeta';
import MdApprovalDetailDrawer from './MdApprovalDetailDrawer';
import MdViewStatusChip from './MdViewStatusChip';
import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';

/**
 * MD Approval — the MD's own queue across Purchase FMS, built on the existing
 * Digital Approval engine (one row per DocumentApproval; no second approval
 * system). Approval is tracked independently of each document's workflow:
 * GRN & QC and every other step keep moving while the MD's approval is
 * pending. Payment is the one step that waits for it (vouchers are flagged).
 *
 * Rendered by the Purchase FMS hub at /purchase-fms/md-approvals, for MD users
 * only; GET /approvals is MD-only on the server as well.
 */
const MdApprovalList = () => {
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [statusFilter, setStatusFilter] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState(null);
  const rowNav = useRowNavigation({ onOpen: setSelected });

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };

  // "Filters" covers Module, Vendor, From and To — Search and Status stay visible.
  const secondaryCount = [moduleFilter, vendorFilter, from, to].filter(Boolean).length;
  const clearSecondary = () => { setModuleFilter(''); setVendorFilter(null); setFrom(''); setTo(''); resetPage(); };
  const anyFilterActive = Boolean(search || statusFilter || secondaryCount);
  const clearAll = () => { resetSearch(); setStatusFilter(''); clearSecondary(); };

  const { data, isLoading, isFetching } = useGetMdApprovalsQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: search || undefined,
    status: statusFilter || undefined,
    documentType: moduleFilter || undefined,
    vendor: vendorFilter || undefined,
    ...(from ? { from: `${from}T00:00:00` } : {}),
    ...(to ? { to: `${to}T23:59:59` } : {}),
  }, { refetchOnMountOrArgChange: true });
  // The MD's signature is this step's completion (signedAt / signedByName).
  const rows = (data?.data?.rows || []).map((r) => ({
    ...r, stepTiming: { done: !!r.signedAt, actualAt: r.signedAt, doneByName: r.signedByName },
  }));
  const summary = data?.data?.summary || {};
  const vendors = data?.data?.vendors || [];

  const toggleStatus = (s) => onFilterChange(setStatusFilter)(statusFilter === s ? '' : s);

  const columns = [
    serialColumn({ width: 70 }),
    { field: 'documentNumber', headerName: 'Reference No.', flex: 1, minWidth: 170,
      renderCell: (p) => (
        <Box sx={{ lineHeight: 1.25, minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 700, fontSize: '0.82rem', color: 'primary.main' }}>{p.value || '—'}</Typography>
          <Typography noWrap sx={{ fontSize: '0.7rem', color: PFMS.sub }}>{p.row.documentLabel}</Typography>
        </Box>
      ) },
    { field: 'module', headerName: 'Module / Step', flex: 1.2, minWidth: 250,
      renderCell: (p) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: '0.8rem' }}>{p.value}</Typography>
          {p.row.gatesPayment && p.row.approvalStatus === 'PENDING' && (
            <Tooltip title="Payment for this document waits for MD approval">
              <Chip size="small" icon={<Wallet size={12} />} label="Payment on hold"
                sx={{ height: 20, fontSize: '0.64rem', fontWeight: 700, bgcolor: '#fee2e2', color: '#b91c1c', '& .MuiChip-icon': { color: '#b91c1c' } }} />
            </Tooltip>
          )}
        </Box>
      ) },
    { field: 'vendorName', headerName: 'Vendor', flex: 1, minWidth: 160,
      renderCell: (p) => <Typography noWrap sx={{ fontSize: '0.8rem' }}>{p.value || '—'}</Typography> },
    { field: 'amount', headerName: 'Amount', width: 130, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography sx={{ fontSize: '0.8rem', fontWeight: 700 }}>{fmtINR(p.value)}</Typography> },
    { field: 'requestedByName', headerName: 'Requested By', width: 140,
      renderCell: (p) => <Typography noWrap sx={{ fontSize: '0.8rem' }}>{p.value || '—'}</Typography> },
    { field: 'requestedAt', headerName: 'Date', width: 115, valueFormatter: (v) => fmtDate(v) },
    { field: 'workflowLabel', headerName: 'Workflow', width: 175,
      renderCell: (p) => <Typography noWrap sx={{ fontSize: '0.76rem', color: PFMS.sub }}>{p.value}</Typography> },
    { field: 'approvalStatus', headerName: 'Approval Status', width: 140,
      renderCell: (p) => <MdViewStatusChip status={p.value} /> },
    ...stepTimingColumns({ planned: false, doer: false, titleCase: true }),
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, ...pfmsPageSx }}>
      {/* Header */}
      <Box>
        <Typography sx={{ ...pfmsTitleSx, display: 'flex', alignItems: 'center', gap: 1 }}>
          <ShieldCheck size={18} color="#b45309" /> MD Approval ({summary.total || 0})
        </Typography>
        <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>
          Every MD approval across Purchase FMS. Work continues while an approval is pending — only payment waits for it.
        </Typography>
      </Box>

      {/* KPIs — each card filters the table by its status. */}
      <Grid container spacing={2}>
        <Grid item xs={6} md={3}>
          <PfmsKpiCard icon={<ShieldCheck size={20} />} label="Total Approvals" value={summary.total} color="#2563eb"
            active={!statusFilter} onClick={() => onFilterChange(setStatusFilter)('')} />
        </Grid>
        <Grid item xs={6} md={3}>
          <PfmsKpiCard icon={<Clock size={20} />} label="Pending" value={summary.pending} color={MD_VIEW_STATUS.PENDING.color}
            active={statusFilter === 'PENDING'} onClick={() => toggleStatus('PENDING')} />
        </Grid>
        <Grid item xs={6} md={3}>
          <PfmsKpiCard icon={<BadgeCheck size={20} />} label="Approved" value={summary.approved} color={MD_VIEW_STATUS.APPROVED.color}
            active={statusFilter === 'APPROVED'} onClick={() => toggleStatus('APPROVED')} />
        </Grid>
        <Grid item xs={6} md={3}>
          <PfmsKpiCard icon={<CheckCheck size={20} />} label="Completed" value={summary.completed} color={MD_VIEW_STATUS.COMPLETED.color}
            active={statusFilter === 'COMPLETED'} onClick={() => toggleStatus('COMPLETED')} />
        </Grid>
      </Grid>

      {summary.paymentBlocked > 0 && (
        <Alert severity="warning" icon={<Wallet size={18} />} sx={{ borderRadius: '8px', py: 0.25 }}>
          <b>{summary.paymentBlocked}</b> payment{summary.paymentBlocked === 1 ? '' : 's'} cannot be made until you approve {summary.paymentBlocked === 1 ? 'it' : 'them'}.
        </Alert>
      )}

      {/* Filters */}
      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <AdaptiveFilterBar
          pinned={[
            { key: 'search', minWidth: 220, node: (
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 220px' }, minWidth: 0 }}>
                <Typography component="label" htmlFor="mda-search" sx={pfmsFieldLabelSx}>Search</Typography>
                <TextField id="mda-search" size="small" fullWidth placeholder="Search reference / vendor / requested by…"
                  value={searchInput} onChange={(e) => { setSearchInput(e.target.value); resetPage(); }}
                  InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
              </Box>
            ) },
            { key: 'status', minWidth: 170, node: (
              <Box sx={{ flex: '0 1 170px', minWidth: 140 }}>
                <Typography component="label" htmlFor="mda-status" sx={pfmsFieldLabelSx}>Status</Typography>
                <TextField id="mda-status" size="small" select fullWidth value={statusFilter}
                  SelectProps={ALL_WHEN_UNSET} onChange={(e) => onFilterChange(setStatusFilter)(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {MD_VIEW_STATUSES.map((s) => <MenuItem key={s} value={s}>{MD_VIEW_STATUS[s].label}</MenuItem>)}
                </TextField>
              </Box>
            ) },
          ]}
          items={[
            {
              key: 'module', width: 210, active: Boolean(moduleFilter),
              node: (
                <Box sx={{ flex: '0 1 210px', minWidth: 180 }}>
                  <TextField size="small" select fullWidth label="Module" value={moduleFilter}
                    SelectProps={ALL_WHEN_UNSET} InputLabelProps={{ shrink: true }}
                    onChange={(e) => onFilterChange(setModuleFilter)(e.target.value)}>
                    <MenuItem value="">All</MenuItem>
                    {MD_APPROVAL_MODULES.map((m) => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
                  </TextField>
                </Box>
              ),
            },
            {
              key: 'vendor', width: 200, active: Boolean(vendorFilter),
              node: (
                <Box sx={{ flex: '0 1 200px', minWidth: 180 }}>
                  <Autocomplete size="small" fullWidth options={vendors} value={vendorFilter}
                    onChange={(_e, v) => onFilterChange(setVendorFilter)(v)}
                    renderInput={(params) => <TextField {...params} label="Vendor" />} />
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
          rows={rows}
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
          disableColumnMenu
          rowHeight={52}
          columnHeaderHeight={44}
          localeText={{ noRowsLabel: anyFilterActive ? 'No approvals match these filters' : 'No MD approvals yet' }}
          getRowClassName={(p) => `mda-row-${String(p.row.approvalStatus).toLowerCase()} ${rowNav.gridProps.getRowClassName(p)}`}
          sx={[{
            border: 0,
            // Status colour runs down the row's left edge as well as in its chip.
            '& .mda-row-pending': { boxShadow: `inset 3px 0 0 ${MD_VIEW_STATUS.PENDING.color}` },
            '& .mda-row-approved': { boxShadow: `inset 3px 0 0 ${MD_VIEW_STATUS.APPROVED.color}` },
            '& .mda-row-completed': { boxShadow: `inset 3px 0 0 ${MD_VIEW_STATUS.COMPLETED.color}` },
          }, rowNavigationGridSx]}
        />
      </Paper>

      <MdApprovalDetailDrawer
        row={selected ? (rows.find((r) => r._id === selected._id) || selected) : null}
        onClose={() => setSelected(null)}
      />
    </Box>
  );
};

export default MdApprovalList;
