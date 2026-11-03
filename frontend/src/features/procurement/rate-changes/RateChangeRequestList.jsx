import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, MenuItem, Grid, Chip, Tooltip, Alert, Button,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, Scale, Clock, BadgeCheck, XCircle, AlertTriangle } from 'lucide-react';
import { useGetRateChangesQuery } from '../../../store/api/procurementApi';
import { serialColumn } from '../components/serialNumber';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { rowActionsColumn, rowActionsGridProps, rowActionsGridSx } from '../components/rowActionsColumn';
import { PFMS, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';
import { fmtDate } from '../approvals/approvalMeta';
import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
import RateChangeStatusChip from './RateChangeStatusChip';
import { RATE_STATUS, RATE_STATUSES, fmtRate, fmtDiff, diffColor } from './rateChangeMeta';

const cellText = (v, sx = {}) => <Typography noWrap sx={{ fontSize: '0.8rem', ...sx }}>{v ?? '—'}</Typography>;

/**
 * Rate change requests — pending, approved, rejected and withdrawn. The UI
 * filters by one search box and one status dropdown (the four summary cards set
 * the same status); the server still accepts vendor / SKU / requester / date
 * filters for other callers. A row (or its action button) opens the request
 * (onOpen) with the approve / reject actions.
 */
const RateChangeRequestList = ({ onOpen }) => {
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [statusFilter, setStatusFilter] = useState('');
  const rowNav = useRowNavigation({ onOpen: (row) => onOpen?.(row._id) });

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onStatusChange = (value) => { setStatusFilter(value); resetPage(); };
  const anyFilterActive = Boolean(search || statusFilter);
  const clearAll = () => { resetSearch(); onStatusChange(''); };

  const { data, isLoading, isFetching } = useGetRateChangesQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: search || undefined,
    status: statusFilter || undefined,
  }, { refetchOnMountOrArgChange: true });
  const payload = data?.data || {};
  const rows = payload.rows || [];
  const summary = payload.summary || {};
  const toggleStatus = (s) => onStatusChange(statusFilter === s ? '' : s);

  const columns = [
    serialColumn({ width: 64 }),
    { field: 'requestNumber', headerName: 'Request ID', width: 140,
      renderCell: (p) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
          {cellText(p.value, { fontWeight: 700, color: 'primary.main' })}
          {p.row.stale && (
            <Tooltip title={`Vendor rate is now ${fmtRate(p.row.currentVendorRate)} — changed since the request`}>
              <AlertTriangle size={14} color="#c2410c" data-testid="rc-row-stale" />
            </Tooltip>
          )}
        </Box>
      ) },
    { field: 'vendorName', headerName: 'Vendor', flex: 1, minWidth: 160, renderCell: (p) => cellText(p.value) },
    { field: 'itemName', headerName: 'Item / SKU', flex: 1.1, minWidth: 190,
      renderCell: (p) => (
        <Box sx={{ lineHeight: 1.2, minWidth: 0 }}>
          {cellText(p.value, { fontWeight: 600 })}
          {cellText(`${p.row.skuCode || '—'} · ${p.row.unit || ''}`, { fontSize: '0.7rem', color: PFMS.sub })}
        </Box>
      ) },
    { field: 'poRef', headerName: 'PO / Indent', width: 170,
      renderCell: (p) => (
        <Box sx={{ lineHeight: 1.2, minWidth: 0 }}>
          {cellText(p.value)}
          {cellText(p.row.indentItemDisplayNumber || p.row.indentNumber, { fontSize: '0.7rem', color: PFMS.sub })}
        </Box>
      ) },
    { field: 'existingVendorRate', headerName: 'Vendor Rate', width: 115, align: 'right', headerAlign: 'right', renderCell: (p) => cellText(fmtRate(p.value)) },
    { field: 'originalPoRate', headerName: 'Original PO Rate', width: 140, align: 'right', headerAlign: 'right', renderCell: (p) => cellText(fmtRate(p.value)) },
    { field: 'requestedRate', headerName: 'Requested Rate', width: 135, align: 'right', headerAlign: 'right', renderCell: (p) => cellText(fmtRate(p.value), { fontWeight: 800 }) },
    { field: 'diffAmount', headerName: 'Difference', width: 150, align: 'right', headerAlign: 'right',
      renderCell: (p) => cellText(fmtDiff(p.value, p.row.diffPercent), { fontWeight: 700, color: diffColor(p.value) }) },
    { field: 'status', headerName: 'Status', width: 115, renderCell: (p) => <RateChangeStatusChip status={p.value} /> },
    { field: 'requestedByName', headerName: 'Requested By', width: 150,
      renderCell: (p) => (
        <Box sx={{ lineHeight: 1.2, minWidth: 0 }}>
          {cellText(p.value)}
          {cellText(fmtDate(p.row.requestedAt), { fontSize: '0.7rem', color: PFMS.sub })}
        </Box>
      ) },
    // Opens the request drawer — approve / reject / history live there.
    rowActionsColumn((p) => (
      <Button size="small" variant={p.row.status === 'PENDING' ? 'contained' : 'outlined'} disableElevation
        data-testid="rc-row-action" aria-label={`${p.row.status === 'PENDING' ? 'Review' : 'View'} ${p.row.requestNumber}`}
        onClick={(e) => { e.stopPropagation(); onOpen?.(p.row._id); }}
        sx={{ fontWeight: 700, textTransform: 'none', py: 0.25, minWidth: 0 }}>
        {p.row.status === 'PENDING' ? 'Review' : 'View'}
      </Button>
    ), { headerName: 'Action', width: 100, align: 'center', headerAlign: 'center' }),
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Grid container spacing={2}>
        <Grid item xs={6} md={3}>
          <PfmsKpiCard icon={<Scale size={20} />} label="All Requests" value={summary.total || 0} color="#2563eb"
            active={!statusFilter} onClick={() => onStatusChange('')} />
        </Grid>
        <Grid item xs={6} md={3}>
          <PfmsKpiCard icon={<Clock size={20} />} label="Pending" value={summary.PENDING || 0} color={RATE_STATUS.PENDING.color}
            active={statusFilter === 'PENDING'} onClick={() => toggleStatus('PENDING')} />
        </Grid>
        <Grid item xs={6} md={3}>
          <PfmsKpiCard icon={<BadgeCheck size={20} />} label="Approved" value={summary.APPROVED || 0} color={RATE_STATUS.APPROVED.color}
            active={statusFilter === 'APPROVED'} onClick={() => toggleStatus('APPROVED')} />
        </Grid>
        <Grid item xs={6} md={3}>
          <PfmsKpiCard icon={<XCircle size={20} />} label="Rejected" value={summary.REJECTED || 0} color={RATE_STATUS.REJECTED.color}
            active={statusFilter === 'REJECTED'} onClick={() => toggleStatus('REJECTED')} />
        </Grid>
      </Grid>

      {payload.canApprove === false && (summary.PENDING || 0) > 0 && (
        <Alert severity="info" sx={{ borderRadius: '8px', py: 0.25 }}>
          You can follow these requests here. Approving needs the "Approve / reject PO rate changes" or "Approve procurement documents" permission.
        </Alert>
      )}

      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 1.25 }}>
          <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 260px' }, minWidth: 0 }}>
            <Typography component="label" htmlFor="rc-search" sx={pfmsFieldLabelSx}>Search</Typography>
            <TextField id="rc-search" size="small" fullWidth placeholder="Request ID, PO, vendor, item or SKU"
              value={searchInput} onChange={(e) => { setSearchInput(e.target.value); resetPage(); }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
          </Box>
          <Box sx={{ flex: { xs: '1 1 100%', sm: '0 1 190px' }, minWidth: 140 }}>
            <Typography component="label" htmlFor="rc-status" sx={pfmsFieldLabelSx}>Status</Typography>
            <TextField id="rc-status" size="small" select fullWidth value={statusFilter} SelectProps={ALL_WHEN_UNSET}
              inputProps={{ 'data-testid': 'rc-status-filter' }}
              onChange={(e) => onStatusChange(e.target.value)}>
              <MenuItem value="">All</MenuItem>
              {RATE_STATUSES.filter((s) => s !== 'WITHDRAWN').map((s) => <MenuItem key={s} value={s}>{RATE_STATUS[s].label}</MenuItem>)}
            </TextField>
          </Box>
          {anyFilterActive && (
            <Button size="small" onClick={clearAll} data-testid="rc-clear-filters" sx={{ textTransform: 'none', fontWeight: 700, height: 40 }}>
              Clear
            </Button>
          )}
        </Box>
      </Paper>

      <Paper sx={{ ...pfmsCardSx, flexGrow: 1, minHeight: 420, overflow: 'hidden' }}>
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(r) => r._id}
          loading={isLoading || isFetching}
          paginationMode="server"
          rowCount={payload.pagination?.total || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          {...rowNav.gridProps}
          {...rowActionsGridProps}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          disableColumnMenu
          rowHeight={50}
          columnHeaderHeight={44}
          localeText={{ noRowsLabel: anyFilterActive ? 'No rate changes match these filters' : 'No rate changes yet — they appear here when a PO is saved at a rate other than the vendor\'s' }}
          getRowClassName={(p) => `rc-row-${String(p.row.status).toLowerCase()} ${rowNav.gridProps.getRowClassName(p)}`}
          sx={[{
            border: 0,
            '& .rc-row-pending': { boxShadow: `inset 3px 0 0 ${RATE_STATUS.PENDING.color}` },
            '& .rc-row-approved': { boxShadow: `inset 3px 0 0 ${RATE_STATUS.APPROVED.color}` },
            '& .rc-row-rejected': { boxShadow: `inset 3px 0 0 ${RATE_STATUS.REJECTED.color}` },
          }, rowNavigationGridSx, rowActionsGridSx]}
        />
      </Paper>
      {summary.WITHDRAWN > 0 && !statusFilter && (
        <Typography sx={{ fontSize: '0.72rem', color: PFMS.sub }}>
          <Chip size="small" label={`${summary.WITHDRAWN} withdrawn`} sx={{ height: 18, fontSize: '0.64rem', mr: 0.75 }} />
          requests closed because their PO line changed or the PO was deleted, cancelled or rejected.
        </Typography>
      )}
    </Box>
  );
};

export default RateChangeRequestList;
