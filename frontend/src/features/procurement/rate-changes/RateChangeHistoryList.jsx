import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, MenuItem, Autocomplete, Chip, Tooltip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, ArrowDownUp } from 'lucide-react';
import { useGetRateChangeHistoryQuery, useGetRateChangesQuery } from '../../../store/api/procurementApi';
import { serialColumn } from '../components/serialNumber';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import AdaptiveFilterBar from '../components/AdaptiveFilterBar';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import { PFMS, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';
import { fmtDate, fmtTime } from '../approvals/approvalMeta';
import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
import { RATE_EVENT, RATE_EVENTS, RATE_STATUS, RATE_STATUSES, fmtRate } from './rateChangeMeta';

const cellText = (v, sx = {}) => <Typography noWrap sx={{ fontSize: '0.8rem', ...sx }}>{v ?? '—'}</Typography>;
const sourceText = (s) => (s ? `${fmtRate(s.rate)}${s.unit ? `/${s.unit}` : ''}` : '—');

/**
 * Rate Change History — the append-only audit (one row per request / decision /
 * refused approval), chronological by default, with vendor / SKU / event /
 * status / requester / date filters. `preset` ({ vendorId, skuCode, label })
 * comes from a request's "View history".
 */
const RateChangeHistoryList = ({ preset, onClearPreset, onOpenRequest }) => {
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 50 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [eventFilter, setEventFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  // A preset (remounted via `key`) starts the vendor + SKU filters.
  const [vendorFilter, setVendorFilter] = useState(preset ? { _id: preset.vendorId, name: preset.label?.split(' · ')[0] || 'Vendor' } : null);
  const [requesterFilter, setRequesterFilter] = useState(null);
  const [skuFilter, setSkuFilter] = useState(preset?.skuCode || '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [order, setOrder] = useState('asc');
  const rowNav = useRowNavigation({ onOpen: (row) => onOpenRequest?.(row.requestId) });

  // Vendor / requester options come from the requests list (same people and vendors).
  const { data: optsRes } = useGetRateChangesQuery({ limit: 1 });
  const vendorOpts = optsRes?.data?.vendors || [];
  const requesterOpts = optsRes?.data?.requesters || [];

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };
  const secondaryCount = [statusFilter, vendorFilter, requesterFilter, skuFilter, from, to].filter(Boolean).length;
  const clearSecondary = () => {
    setStatusFilter(''); setVendorFilter(null); setRequesterFilter(null); setSkuFilter(''); setFrom(''); setTo(''); resetPage();
    onClearPreset?.();
  };
  const anyFilterActive = Boolean(search || eventFilter || secondaryCount);
  const clearAll = () => { resetSearch(); setEventFilter(''); clearSecondary(); };

  const { data, isLoading, isFetching } = useGetRateChangeHistoryQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    order,
    search: search || undefined,
    event: eventFilter || undefined,
    status: statusFilter || undefined,
    vendorId: vendorFilter?._id || undefined,
    requestedBy: requesterFilter?._id || undefined,
    skuCode: skuFilter.trim() || undefined,
    ...(from ? { from: `${from}T00:00:00` } : {}),
    ...(to ? { to: `${to}T23:59:59` } : {}),
  }, { refetchOnMountOrArgChange: true });
  const rows = data?.data?.rows || [];

  const columns = [
    serialColumn({ width: 64 }),
    { field: 'at', headerName: 'When', width: 150,
      renderCell: (p) => (
        <Box sx={{ lineHeight: 1.2 }}>
          {cellText(fmtDate(p.value))}
          {cellText(fmtTime(p.value), { fontSize: '0.7rem', color: PFMS.sub })}
        </Box>
      ) },
    { field: 'event', headerName: 'Event', width: 140,
      renderCell: (p) => (
        <Chip size="small" label={RATE_EVENT[p.value]?.label || p.value} data-event={p.value}
          sx={{ height: 22, fontSize: '0.68rem', fontWeight: 800, color: RATE_EVENT[p.value]?.color, bgcolor: '#f1f5f9' }} />
      ) },
    { field: 'requestNumber', headerName: 'Request', width: 130, renderCell: (p) => cellText(p.value, { fontWeight: 700, color: 'primary.main' }) },
    { field: 'vendorName', headerName: 'Vendor', flex: 1, minWidth: 150, renderCell: (p) => cellText(p.value) },
    { field: 'itemName', headerName: 'Item / SKU', flex: 1, minWidth: 170,
      renderCell: (p) => (
        <Box sx={{ lineHeight: 1.2, minWidth: 0 }}>
          {cellText(p.value, { fontWeight: 600 })}
          {cellText(`${p.row.skuCode || '—'} · ${p.row.unit || ''} · ${p.row.currency || 'INR'}`, { fontSize: '0.7rem', color: PFMS.sub })}
        </Box>
      ) },
    { field: 'previousRate', headerName: 'Previous', width: 105, align: 'right', headerAlign: 'right', renderCell: (p) => cellText(fmtRate(p.value)) },
    { field: 'newRate', headerName: 'New', width: 105, align: 'right', headerAlign: 'right', renderCell: (p) => cellText(fmtRate(p.value), { fontWeight: 800 }) },
    { field: 'vendorSourceAfter', headerName: 'Vendor Source Before → After', width: 200,
      renderCell: (p) => cellText(p.row.vendorSourceBefore || p.value ? `${sourceText(p.row.vendorSourceBefore)} → ${sourceText(p.value)}` : '—', { color: PFMS.sub }) },
    { field: 'poRef', headerName: 'PO / Indent', width: 170,
      renderCell: (p) => (
        <Box sx={{ lineHeight: 1.2, minWidth: 0 }}>
          {cellText(p.value)}
          {cellText(p.row.indentItemDisplayNumber || p.row.indentNumber, { fontSize: '0.7rem', color: PFMS.sub })}
        </Box>
      ) },
    { field: 'requestedByName', headerName: 'Requester', width: 140, renderCell: (p) => cellText(p.value) },
    { field: 'actorName', headerName: 'By', width: 140, renderCell: (p) => cellText(p.value || 'System') },
    { field: 'status', headerName: 'Status After', width: 115,
      renderCell: (p) => cellText(RATE_STATUS[p.value]?.label || p.value, { color: RATE_STATUS[p.value]?.color, fontWeight: 700 }) },
    { field: 'message', headerName: 'Reason / Outcome', flex: 1.3, minWidth: 220,
      renderCell: (p) => {
        const text = [p.row.event === 'REQUESTED' ? p.row.reason : '', p.row.rejectionReason, p.value].filter(Boolean).join(' · ');
        return <Tooltip title={text}>{cellText(text || '—', { color: p.row.outcome === 'CONFLICT' ? '#c2410c' : PFMS.sub })}</Tooltip>;
      } },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {preset && (
        <Box>
          <Chip size="small" color="primary" variant="outlined" label={`History of ${preset.label}`} onDelete={clearSecondary} data-testid="rc-history-preset" />
        </Box>
      )}
      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <AdaptiveFilterBar
          pinned={[
            { key: 'search', minWidth: 220, node: (
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 220px' }, minWidth: 0 }}>
                <Typography component="label" htmlFor="rch-search" sx={pfmsFieldLabelSx}>Search</Typography>
                <TextField id="rch-search" size="small" fullWidth placeholder="Request / PO / vendor / item / person…"
                  value={searchInput} onChange={(e) => { setSearchInput(e.target.value); resetPage(); }}
                  InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
              </Box>
            ) },
            { key: 'event', minWidth: 170, node: (
              <Box sx={{ flex: '0 1 170px', minWidth: 150 }}>
                <Typography component="label" htmlFor="rch-event" sx={pfmsFieldLabelSx}>Event</Typography>
                <TextField id="rch-event" size="small" select fullWidth value={eventFilter} SelectProps={ALL_WHEN_UNSET}
                  inputProps={{ 'data-testid': 'rc-event-filter' }}
                  onChange={(e) => onFilterChange(setEventFilter)(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {RATE_EVENTS.map((s) => <MenuItem key={s} value={s}>{RATE_EVENT[s].label}</MenuItem>)}
                </TextField>
              </Box>
            ) },
            { key: 'order', minWidth: 150, node: (
              <Box sx={{ flex: '0 1 150px', minWidth: 140 }}>
                <Typography component="label" htmlFor="rch-order" sx={pfmsFieldLabelSx}>Order</Typography>
                <TextField id="rch-order" size="small" select fullWidth value={order}
                  onChange={(e) => onFilterChange(setOrder)(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><ArrowDownUp size={14} color={PFMS.faint} /></InputAdornment> }}>
                  <MenuItem value="asc">Oldest first</MenuItem>
                  <MenuItem value="desc">Newest first</MenuItem>
                </TextField>
              </Box>
            ) },
          ]}
          items={[
            { key: 'vendor', width: 200, active: Boolean(vendorFilter), node: (
              <Box sx={{ flex: '0 1 200px', minWidth: 180 }}>
                <Autocomplete size="small" fullWidth options={vendorOpts} value={vendorFilter}
                  getOptionLabel={(o) => o?.name || ''} isOptionEqualToValue={(a, b) => a._id === b._id}
                  onChange={(_e, v) => onFilterChange(setVendorFilter)(v)}
                  renderInput={(params) => <TextField {...params} label="Vendor" />} />
              </Box>
            ) },
            { key: 'sku', width: 150, active: Boolean(skuFilter), node: (
              <Box sx={{ flex: '0 1 150px', minWidth: 130 }}>
                <TextField size="small" fullWidth label="SKU code" value={skuFilter} inputProps={{ 'data-testid': 'rc-history-sku' }}
                  onChange={(e) => onFilterChange(setSkuFilter)(e.target.value.toUpperCase())} />
              </Box>
            ) },
            { key: 'status', width: 160, active: Boolean(statusFilter), node: (
              <Box sx={{ flex: '0 1 160px', minWidth: 140 }}>
                <TextField size="small" select fullWidth label="Status after" value={statusFilter}
                  SelectProps={ALL_WHEN_UNSET} InputLabelProps={{ shrink: true }}
                  onChange={(e) => onFilterChange(setStatusFilter)(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {RATE_STATUSES.map((s) => <MenuItem key={s} value={s}>{RATE_STATUS[s].label}</MenuItem>)}
                </TextField>
              </Box>
            ) },
            { key: 'requester', width: 190, active: Boolean(requesterFilter), node: (
              <Box sx={{ flex: '0 1 190px', minWidth: 170 }}>
                <Autocomplete size="small" fullWidth options={requesterOpts} value={requesterFilter}
                  getOptionLabel={(o) => o?.name || ''} isOptionEqualToValue={(a, b) => a._id === b._id}
                  onChange={(_e, v) => onFilterChange(setRequesterFilter)(v)}
                  renderInput={(params) => <TextField {...params} label="Requested by" />} />
              </Box>
            ) },
            { key: 'from', width: 150, active: Boolean(from), node: (
              <Box sx={{ flex: '0 1 150px', minWidth: 132 }}>
                <DateInputDDMMYYYY size="small" label="From" fullWidth value={from} onChange={onFilterChange(setFrom)} sx={{ width: '100%' }} />
              </Box>
            ) },
            { key: 'to', width: 150, active: Boolean(to), node: (
              <Box sx={{ flex: '0 1 150px', minWidth: 132 }}>
                <DateInputDDMMYYYY size="small" label="To" fullWidth value={to} onChange={onFilterChange(setTo)} sx={{ width: '100%' }} />
              </Box>
            ) },
          ]}
          onClearSecondary={clearSecondary}
          onClearAll={clearAll}
          anyActive={anyFilterActive}
        />
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
