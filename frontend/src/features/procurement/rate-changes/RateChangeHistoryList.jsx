import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, MenuItem, Chip, Tooltip, Button,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, ArrowDownUp } from 'lucide-react';
import { useGetRateChangeHistoryQuery } from '../../../store/api/procurementApi';
import { serialColumn } from '../components/serialNumber';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import { PFMS, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';
import { fmtDate, fmtTime } from '../approvals/approvalMeta';
import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
import { RATE_STATUS, RATE_STATUSES, fmtRate } from './rateChangeMeta';

const cellText = (v, sx = {}) => <Typography noWrap sx={{ fontSize: '0.8rem', ...sx }}>{v ?? '—'}</Typography>;
const DECIDED = new Set(['APPROVED', 'REJECTED']);

/**
 * Rate Change History — the append-only audit (one row per request / decision /
 * refused approval), NEWEST FIRST by default. The UI filters by one search box
 * and one status dropdown (the status the request was left in); the server
 * still takes vendor / SKU / event / requester / date filters. `preset`
 * ({ vendorId, skuCode, label }) comes from a request's "View history" and
 * narrows the list to that vendor + SKU.
 */
const RateChangeHistoryList = ({ preset, onClearPreset, onOpenRequest }) => {
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 50 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [statusFilter, setStatusFilter] = useState('');
  const [order, setOrder] = useState('desc');
  const rowNav = useRowNavigation({ onOpen: (row) => onOpenRequest?.(row.requestId) });

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };
  const anyFilterActive = Boolean(search || statusFilter || preset);
  const clearAll = () => { resetSearch(); onFilterChange(setStatusFilter)(''); onClearPreset?.(); };

  const { data, isLoading, isFetching } = useGetRateChangeHistoryQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    order,
    search: search || undefined,
    status: statusFilter || undefined,
    vendorId: preset?.vendorId || undefined,
    skuCode: preset?.skuCode || undefined,
  }, { refetchOnMountOrArgChange: true });
  const rows = data?.data?.rows || [];

  const columns = [
    serialColumn({ width: 64 }),
    { field: 'at', headerName: 'Date', width: 150,
      renderCell: (p) => (
        <Box sx={{ lineHeight: 1.2 }}>
          {cellText(fmtDate(p.value))}
          {cellText(fmtTime(p.value), { fontSize: '0.7rem', color: PFMS.sub })}
        </Box>
      ) },
    { field: 'requestNumber', headerName: 'Request ID', width: 130, renderCell: (p) => cellText(p.value, { fontWeight: 700, color: 'primary.main' }) },
    { field: 'vendorName', headerName: 'Vendor', flex: 1, minWidth: 150, renderCell: (p) => cellText(p.value) },
    { field: 'itemName', headerName: 'Item / SKU', flex: 1, minWidth: 170,
      renderCell: (p) => (
        <Box sx={{ lineHeight: 1.2, minWidth: 0 }}>
          {cellText(p.value, { fontWeight: 600 })}
          {cellText(`${p.row.skuCode || '—'} · ${p.row.unit || ''} · ${p.row.currency || 'INR'}`, { fontSize: '0.7rem', color: PFMS.sub })}
        </Box>
      ) },
    { field: 'poRef', headerName: 'PO Reference', width: 170,
      renderCell: (p) => (
        <Box sx={{ lineHeight: 1.2, minWidth: 0 }}>
          {cellText(p.value)}
          {cellText(p.row.indentItemDisplayNumber || p.row.indentNumber, { fontSize: '0.7rem', color: PFMS.sub })}
        </Box>
      ) },
    { field: 'previousRate', headerName: 'Old Rate', width: 105, align: 'right', headerAlign: 'right', renderCell: (p) => cellText(fmtRate(p.value)) },
    { field: 'newRate', headerName: 'New Rate', width: 105, align: 'right', headerAlign: 'right', renderCell: (p) => cellText(fmtRate(p.value), { fontWeight: 800 }) },
    { field: 'requestedByName', headerName: 'Requested By', width: 150, renderCell: (p) => cellText(p.value) },
    // Only a decision has an approver — a request / withdrawal / refusal row shows "—".
    { field: 'actorName', headerName: 'Approved / Rejected By', width: 175,
      renderCell: (p) => (DECIDED.has(p.row.event) ? cellText(p.value || 'System') : cellText('—', { color: PFMS.faint })) },
    { field: 'status', headerName: 'Status', width: 125,
      renderCell: (p) => (p.row.event === 'APPROVAL_CONFLICT'
        ? cellText('Refused', { color: '#c2410c', fontWeight: 700 })
        : cellText(RATE_STATUS[p.value]?.label || p.value, { color: RATE_STATUS[p.value]?.color, fontWeight: 700 })) },
    { field: 'message', headerName: 'Reason', flex: 1.3, minWidth: 220,
      renderCell: (p) => {
        const text = [p.row.event === 'REQUESTED' ? p.row.reason : '', p.row.rejectionReason, p.value].filter(Boolean).join(' · ');
        return <Tooltip title={text}>{cellText(text || '—', { color: p.row.outcome === 'CONFLICT' ? '#c2410c' : PFMS.sub })}</Tooltip>;
      } },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {preset && (
        <Box>
          <Chip size="small" color="primary" variant="outlined" label={`History of ${preset.label}`} onDelete={() => onClearPreset?.()} data-testid="rc-history-preset" />
        </Box>
      )}
      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 1.25 }}>
          <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 260px' }, minWidth: 0 }}>
            <Typography component="label" htmlFor="rch-search" sx={pfmsFieldLabelSx}>Search</Typography>
            <TextField id="rch-search" size="small" fullWidth placeholder="Request ID, PO, vendor, item, SKU or person"
              value={searchInput} onChange={(e) => { setSearchInput(e.target.value); resetPage(); }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
          </Box>
          <Box sx={{ flex: { xs: '1 1 100%', sm: '0 1 190px' }, minWidth: 140 }}>
            <Typography component="label" htmlFor="rch-status" sx={pfmsFieldLabelSx}>Status</Typography>
            <TextField id="rch-status" size="small" select fullWidth value={statusFilter} SelectProps={ALL_WHEN_UNSET}
              inputProps={{ 'data-testid': 'rc-history-status-filter' }}
              onChange={(e) => onFilterChange(setStatusFilter)(e.target.value)}>
              <MenuItem value="">All</MenuItem>
              {RATE_STATUSES.map((s) => <MenuItem key={s} value={s}>{RATE_STATUS[s].label}</MenuItem>)}
            </TextField>
          </Box>
          <Box sx={{ flex: { xs: '1 1 100%', sm: '0 1 170px' }, minWidth: 140 }}>
            <Typography component="label" htmlFor="rch-order" sx={pfmsFieldLabelSx}>Order</Typography>
            <TextField id="rch-order" size="small" select fullWidth value={order}
              onChange={(e) => onFilterChange(setOrder)(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><ArrowDownUp size={14} color={PFMS.faint} /></InputAdornment> }}>
              <MenuItem value="desc">Newest first</MenuItem>
              <MenuItem value="asc">Oldest first</MenuItem>
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
          rowCount={data?.data?.pagination?.total || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          {...rowNav.gridProps}
          pageSizeOptions={[25, 50, 100]}
          disableRowSelectionOnClick
          disableColumnMenu
          rowHeight={50}
          columnHeaderHeight={44}
          localeText={{ noRowsLabel: anyFilterActive ? 'No history matches these filters' : 'No rate change history yet' }}
          sx={[{ border: 0 }, rowNavigationGridSx]}
        />
      </Paper>
    </Box>
  );
};

export default RateChangeHistoryList;
