import React, { useState } from 'react';
import { Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem, Tooltip } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, Hourglass, Loader, ShieldAlert, ListChecks, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGetStepQueueQuery } from '../../../store/api/procurementApi';
import { serialColumn } from './serialNumber';
import StatusChip from './StatusChip';
import PfmsKpiCard from './PfmsKpiCard';
import AdaptiveFilterBar from './AdaptiveFilterBar';
import DateInputDDMMYYYY from './DateInputDDMMYYYY';
import { useDebouncedSearch } from './useDebouncedSearch';
import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
import { rowActionsColumn, rowActionsGridProps, rowActionsGridSx } from './rowActionsColumn';
import { PFMS, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';

/**
 * "Awaiting this step" table — the upstream records waiting at a Purchase FMS
 * step that has no record of its own for them yet (a released PO with no
 * follow-up, a QC-accepted GRN with no invoice, …). Rows, their status and the
 * filters/paging all come from GET /procurement/step-queues/:queue (backend
 * procurement/stepQueue.js); nothing is created to fill the table.
 *
 * `actionFor(row)` → { label, icon, onClick } | null — the step's own create
 * action, opened with the row's record preset. The server only marks a row
 * actionable when that step's guards would accept it (e.g. never while it is
 * waiting for the MD).
 */

// State tiles — also the filter. READY = actionable now; IN_PROGRESS = started;
// WAITING = blocked on someone else first.
const TILES = [
  { key: 'READY', label: 'Ready for action', icon: <Hourglass size={18} />, color: '#b45309' },
  { key: 'IN_PROGRESS', label: 'In progress', icon: <Loader size={18} />, color: '#4338ca' },
  { key: 'WAITING', label: 'Waiting (MD / prerequisite)', icon: <ShieldAlert size={18} />, color: '#64748b' },
  { key: 'ALL', label: 'All awaiting', icon: <ListChecks size={18} />, color: '#2563eb' },
];
const STATE_TONE = { READY: 'amber', IN_PROGRESS: 'indigo', WAITING: 'neutral' };

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
const fmtINR = (n) => (n === null || n === undefined ? '—'
  : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

const StepQueueGrid = ({ queue, numberHeader = 'Ref No', dateHeader = 'Date', amountHeader = 'Amount', showDue = false, showAmount = true, actionFor, emptyText }) => {
  const navigate = useNavigate();
  const rowNav = useRowNavigation({ to: (r) => r.link });
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [state, setState] = useState('ALL');
  const [vendor, setVendor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };
  const secondaryCount = [vendor, from, to].filter(Boolean).length;
  const clearSecondary = () => { setVendor(''); setFrom(''); setTo(''); resetPage(); };
  const anyFilterActive = Boolean(search || secondaryCount || state !== 'ALL');
  const clearAll = () => { resetSearch(); setState('ALL'); clearSecondary(); };

  const { data, isLoading, isFetching, isError } = useGetStepQueueQuery({
    queue,
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: search || undefined,
    vendor: vendor || undefined,
    state: state === 'ALL' ? undefined : state,
    from: from || undefined,
    to: to || undefined,
  });
  const rows = data?.data?.rows || [];
  const counts = data?.data?.stateCounts || {};
  const allCount = Object.values(counts).reduce((s, n) => s + (n || 0), 0);
  const vendors = data?.data?.vendors || [];
  const total = data?.meta?.total || 0;

  const columns = [
    serialColumn(),
    { field: 'number', headerName: numberHeader, width: 150, sortable: false,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main" noWrap>{p.value || '—'}</Typography> },
    // Status straight after the number, so it is always in view.
    { field: 'statusLabel', headerName: 'Current Status', width: 220, sortable: false,
      renderCell: (p) => <StatusChip status={p.row.state} label={p.value} tone={STATE_TONE[p.row.state]} /> },
    { field: 'refs', headerName: 'Linked To', width: 170, sortable: false,
      renderCell: (p) => <Typography variant="body2" sx={{ color: PFMS.sub }} noWrap>{(p.value || []).join(' · ') || '—'}</Typography> },
    { field: 'vendorName', headerName: 'Vendor', flex: 1, minWidth: 160, sortable: false,
      renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    { field: 'date', headerName: dateHeader, width: 110, sortable: false,
      renderCell: (p) => <Typography variant="body2" sx={{ color: PFMS.sub }}>{fmtDate(p.value)}</Typography> },
    ...(showDue ? [{ field: 'dueDate', headerName: 'Expected Delivery', width: 140, sortable: false,
      renderCell: (p) => <Typography variant="body2" sx={{ color: PFMS.sub }}>{fmtDate(p.value)}</Typography> }] : []),
    ...(showAmount ? [{ field: 'amount', headerName: amountHeader, width: 130, align: 'right', headerAlign: 'right', sortable: false,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>{fmtINR(p.value)}</Typography> }] : []),
    // Pinned right like every Purchase list's action column, so the step's
    // action never scrolls out of view on a narrower screen.
    rowActionsColumn((p) => {
        const a = actionFor?.(p.row);
        return (
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', justifyContent: 'flex-end', width: '100%' }}>
            {a && (
              <Button size="small" variant="contained" disableElevation startIcon={a.icon}
                onClick={(e) => { e.stopPropagation(); a.onClick(p.row); }}
                aria-label={`${a.label} for ${p.row.number}`}
                sx={{ px: 1, py: 0.25, minHeight: 30, fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {a.label}
              </Button>
            )}
            <Tooltip title="Open record">
              <Button size="small" variant="outlined" aria-label={`Open ${p.row.number}`}
                onClick={(e) => { e.stopPropagation(); navigate(p.row.link); }}
                sx={{ minWidth: 0, px: 0.75, minHeight: 30 }}>
                <ExternalLink size={14} />
              </Button>
            </Tooltip>
          </Box>
        );
      }, { width: actionFor ? 190 : 70 }),
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, flexGrow: 1, minHeight: 0 }}>
      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' } }}>
        {TILES.map((t) => (
          <PfmsKpiCard key={t.key} icon={t.icon} label={t.label} color={t.color}
            value={t.key === 'ALL' ? allCount : (counts[t.key] || 0)}
            active={state === t.key}
            onClick={() => { setState(t.key); resetPage(); }} />
        ))}
      </Box>

      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <AdaptiveFilterBar
          pinned={[
            { key: 'search', minWidth: 200, node: (
              <Box sx={{ flex: { xs: '1 1 100%', md: '1 1 220px' }, minWidth: 0 }}>
                <Typography component="label" htmlFor={`${queue}-queue-search`} sx={pfmsFieldLabelSx}>Search</Typography>
                <TextField id={`${queue}-queue-search`} size="small" fullWidth placeholder="Search number / vendor…" value={searchInput}
                  onChange={(e) => { setSearchInput(e.target.value); resetPage(); }}
                  InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
              </Box>
            ) },
          ]}
          items={[
            { key: 'vendor', width: 200, active: Boolean(vendor), node: (
              <Box sx={{ flex: '0 1 200px', minWidth: 170 }}>
                <Typography component="label" htmlFor={`${queue}-queue-vendor`} sx={pfmsFieldLabelSx}>Vendor</Typography>
                <TextField id={`${queue}-queue-vendor`} size="small" select fullWidth value={vendor} SelectProps={ALL_WHEN_UNSET}
                  onChange={(e) => onFilterChange(setVendor)(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {vendors.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                </TextField>
              </Box>
            ) },
            { key: 'from', width: 146, active: Boolean(from), node: (
              <Box sx={{ flex: '0 1 142px', minWidth: 132 }}>
                <Typography component="span" sx={pfmsFieldLabelSx}>From</Typography>
                <DateInputDDMMYYYY value={from} onChange={onFilterChange(setFrom)} sx={{ width: '100%' }} />
              </Box>
            ) },
            { key: 'to', width: 146, active: Boolean(to), node: (
              <Box sx={{ flex: '0 1 142px', minWidth: 132 }}>
                <Typography component="span" sx={pfmsFieldLabelSx}>To</Typography>
                <DateInputDDMMYYYY value={to} onChange={onFilterChange(setTo)} sx={{ width: '100%' }} />
              </Box>
            ) },
          ]}
          onClearSecondary={clearSecondary}
          onClearAll={clearAll}
          anyActive={anyFilterActive}
        />
      </Paper>

      <Paper sx={{ ...pfmsCardSx, flexGrow: 1, minHeight: 360, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(r) => `${r.entityType}-${r._id}`}
          loading={isLoading || isFetching}
          paginationMode="server"
          rowCount={total}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 25, 50, 100]}
          {...rowNav.gridProps}
          {...rowActionsGridProps}
          disableRowSelectionOnClick
          rowHeight={50}
          columnHeaderHeight={42}
          localeText={{ noRowsLabel: isError ? 'Could not load this list — try again' : (anyFilterActive ? 'No records match these filters' : (emptyText || 'Nothing is waiting at this step')) }}
          sx={[{ border: 0, flexGrow: 1 }, rowNavigationGridSx, rowActionsGridSx]}
        />
      </Paper>
    </Box>
  );
};

export default StepQueueGrid;
