import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, MenuItem, Alert, Button, Tooltip, Chip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, Store, Clock, BadgeCheck, XCircle } from 'lucide-react';
import { useGetPoApprovalsQuery } from '../../../store/api/procurementApi';
import { serialColumn } from '../components/serialNumber';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { rowActionsColumn, rowActionsGridProps, rowActionsGridSx } from '../components/rowActionsColumn';
import { PFMS, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET, pfmsKpiRowSx } from '../pfmsTheme';
import { fmtDate } from '../approvals/approvalMeta';
import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
import RateChangeStatusChip from './RateChangeStatusChip';
import { RATE_STATUS, fmtRate } from './rateChangeMeta';

const cellText = (v, sx = {}) => <Typography noWrap sx={{ fontSize: '0.8rem', ...sx }}>{v ?? '—'}</Typography>;
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

/**
 * New-vendor POs — a PO raised on a vendor created in the Vendor Master after the
 * rule went live, and not yet vetted by an approved PO. The MD or the purchase
 * approver decides it (either one is enough; the first decision stands, so it
 * leaves the other's pending list at once). The list is the same for everyone
 * signed in; Review opens the PO with the decision, when the viewer may take it.
 */
const NewVendorPoList = ({ onOpen }) => {
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [statusFilter, setStatusFilter] = useState('');
  const rowNav = useRowNavigation({ onOpen: (row) => onOpen?.(row._id) });

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onStatusChange = (value) => { setStatusFilter(value); resetPage(); };
  const anyFilterActive = Boolean(search || statusFilter);
  const clearAll = () => { resetSearch(); onStatusChange(''); };

  const { data, isLoading, isFetching } = useGetPoApprovalsQuery({
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
    { field: 'poRef', headerName: 'PO', width: 170,
      renderCell: (p) => (
        <Box sx={{ lineHeight: 1.2, minWidth: 0 }}>
          {cellText(p.value, { fontWeight: 700, color: 'primary.main' })}
          {cellText((p.row.indentNumbers || []).join(', ') || '—', { fontSize: '0.7rem', color: PFMS.sub })}
        </Box>
      ) },
    { field: 'vendorName', headerName: 'New Vendor', flex: 1, minWidth: 210,
      renderCell: (p) => (
        <Box sx={{ lineHeight: 1.2, minWidth: 0 }}>
          {cellText(p.value, { fontWeight: 600 })}
          {cellText(p.row.vendorCreatedAt ? `Added to Vendor Master ${fmtDate(p.row.vendorCreatedAt)}` : 'New vendor', { fontSize: '0.7rem', color: PFMS.sub })}
        </Box>
      ) },
    { field: 'itemCount', headerName: 'Items', width: 80, align: 'right', headerAlign: 'right', renderCell: (p) => cellText(p.value) },
    { field: 'grandTotal', headerName: 'PO Value', width: 130, align: 'right', headerAlign: 'right', renderCell: (p) => cellText(fmtRate(p.value), { fontWeight: 800 }) },
    { field: 'status', headerName: 'Status', width: 115, renderCell: (p) => <RateChangeStatusChip status={p.value} /> },
    { field: 'submittedBy', headerName: 'Submitted By', width: 160,
      renderCell: (p) => (
        <Box sx={{ lineHeight: 1.2, minWidth: 0 }}>
          {cellText(p.value)}
          {cellText(fmtDate(p.row.submittedAt), { fontSize: '0.7rem', color: PFMS.sub })}
        </Box>
      ) },
    { field: 'decidedBy', headerName: 'Decided By', width: 160,
      renderCell: (p) => (p.row.status === 'PENDING'
        ? cellText('Awaiting decision', { fontSize: '0.72rem', color: PFMS.sub })
        : (
          <Box sx={{ lineHeight: 1.2, minWidth: 0 }} data-testid="nv-decided-by">
            {cellText(p.value)}
            {cellText(fmtDate(p.row.decidedAt), { fontSize: '0.7rem', color: PFMS.sub })}
          </Box>
        )) },
    rowActionsColumn((p) => (
      <Button size="small" variant={p.row.status === 'PENDING' ? 'contained' : 'outlined'} disableElevation
        data-testid="nv-row-action" aria-label={`${p.row.status === 'PENDING' ? 'Review' : 'View'} ${p.row.poRef}`}
        onClick={(e) => { e.stopPropagation(); onOpen?.(p.row._id); }}
        sx={{ fontWeight: 700, textTransform: 'none', py: 0.25, minWidth: 0 }}>
        {p.row.status === 'PENDING' ? 'Review' : 'View'}
      </Button>
    ), { headerName: 'Action', width: 100, align: 'center', headerAlign: 'center' }),
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-testid="nv-list">
      <Box sx={pfmsKpiRowSx(4)}>
        <PfmsKpiCard icon={<Store size={20} />} label="All New-Vendor POs" value={summary.total || 0} color="#2563eb"
          active={!statusFilter} onClick={() => onStatusChange('')} />
        <PfmsKpiCard icon={<Clock size={20} />} label="Pending" value={summary.PENDING || 0} color={RATE_STATUS.PENDING.color}
          active={statusFilter === 'PENDING'} onClick={() => toggleStatus('PENDING')} />
        <PfmsKpiCard icon={<BadgeCheck size={20} />} label="Approved" value={summary.APPROVED || 0} color={RATE_STATUS.APPROVED.color}
          active={statusFilter === 'APPROVED'} onClick={() => toggleStatus('APPROVED')} />
        <PfmsKpiCard icon={<XCircle size={20} />} label="Rejected" value={summary.REJECTED || 0} color={RATE_STATUS.REJECTED.color}
          active={statusFilter === 'REJECTED'} onClick={() => toggleStatus('REJECTED')} />
      </Box>

      <Alert severity="info" sx={{ borderRadius: '8px', py: 0.25 }} data-testid="nv-note">
        A PO for a vendor added to the Vendor Master recently, before any PO of it was approved, is decided by the MD or the purchase
        approver — either one is enough, and the first decision stands.
        {payload.canApprove === false && (summary.PENDING || 0) > 0 ? ' You can follow these here; deciding is for those two.' : ''}
      </Alert>

      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 1.25 }}>
          <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 260px' }, minWidth: 0 }}>
            <Typography component="label" htmlFor="nv-search" sx={pfmsFieldLabelSx}>Search</Typography>
            <TextField id="nv-search" size="small" fullWidth placeholder="PO, vendor, indent or submitted by"
              value={searchInput} onChange={(e) => { setSearchInput(e.target.value); resetPage(); }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
          </Box>
          <Box sx={{ flex: { xs: '1 1 100%', sm: '0 1 190px' }, minWidth: 140 }}>
            <Typography component="label" htmlFor="nv-status" sx={pfmsFieldLabelSx}>Status</Typography>
            <TextField id="nv-status" size="small" select fullWidth value={statusFilter} SelectProps={ALL_WHEN_UNSET}
              inputProps={{ 'data-testid': 'nv-status-filter' }}
              onChange={(e) => onStatusChange(e.target.value)}>
              <MenuItem value="">All</MenuItem>
              {STATUSES.map((s) => <MenuItem key={s} value={s}>{RATE_STATUS[s].label}</MenuItem>)}
            </TextField>
          </Box>
          {anyFilterActive && (
            <Button size="small" onClick={clearAll} data-testid="nv-clear-filters" sx={{ textTransform: 'none', fontWeight: 700, height: 40 }}>
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
          localeText={{ noRowsLabel: anyFilterActive ? 'No new-vendor POs match these filters' : 'No new-vendor POs yet — a PO on a freshly created vendor appears here when it is submitted' }}
          getRowClassName={(p) => `nv-row-${String(p.row.status).toLowerCase()} ${rowNav.gridProps.getRowClassName(p)}`}
          sx={[{
            border: 0,
            '& .nv-row-pending': { boxShadow: `inset 3px 0 0 ${RATE_STATUS.PENDING.color}` },
            '& .nv-row-approved': { boxShadow: `inset 3px 0 0 ${RATE_STATUS.APPROVED.color}` },
            '& .nv-row-rejected': { boxShadow: `inset 3px 0 0 ${RATE_STATUS.REJECTED.color}` },
          }, rowNavigationGridSx, rowActionsGridSx]}
        />
      </Paper>
      <Typography sx={{ fontSize: '0.72rem', color: PFMS.sub }}>
        <Tooltip title="A vendor stops being new once a PO of it is approved">
          <Chip size="small" label="New vendor" sx={{ height: 18, fontSize: '0.64rem', mr: 0.75 }} />
        </Tooltip>
        vendors created in the Vendor Master after this rule started, until their first PO is approved.
      </Typography>
    </Box>
  );
};

export default NewVendorPoList;
