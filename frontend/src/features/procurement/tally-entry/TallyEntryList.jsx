import React, { useState } from 'react';
import { serialColumn } from '../components/serialNumber';
import { stepTimingColumns } from '../components/stepTimingColumns';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  Menu, ListItemIcon, ListItemText, Grid, Autocomplete, LinearProgress,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Plus, Eye, Pencil, CheckCircle2, Ban,
  FileSpreadsheet, Hourglass, CheckCheck, XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useGetTallyEntriesQuery,
  useGetTallyEntryStatsQuery,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import AdaptiveFilterBar from '../components/AdaptiveFilterBar';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import { TallyStatusChip, TALLY_STATUSES, CHECKLIST_TOTAL, checklistProgress } from './tallyMeta';
import TallyEntryFormDialog from './TallyEntryFormDialog';
import TallyEntryCompleteDialog from './TallyEntryCompleteDialog';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';

import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
import RowQuickViewDialog from '../common/RowQuickViewDialog';
import RowActionsCell from '../components/RowActionsCell';
import { rowActionsColumn, rowActionsGridProps, rowActionsGridSx } from '../components/rowActionsColumn';
const TallyEntryList = () => {
  const navigate = useNavigate();
  const rowNav = useRowNavigation({ to: (r) => `/procurement/tally-entries/${r._id}` });
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };
  const secondaryCount = [vendorFilter, from, to].filter(Boolean).length;
  const clearSecondary = () => { setVendorFilter(null); setFrom(''); setTo(''); resetPage(); };
  const anyFilterActive = Boolean(search || statusFilter || secondaryCount);
  const clearAll = () => { resetSearch(); setStatusFilter(''); clearSecondary(); };

  const [formOpen, setFormOpen] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [activeEntry, setActiveEntry] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);
  const [quickRow, setQuickRow] = useState(null); // row whose quick view is open

  const queryArgs = {
    page: paginationModel.page + 1, limit: paginationModel.pageSize, sort: '-createdAt',
    search: search || undefined, vendorId: vendorFilter?._id || undefined, tallyEntryStatus: statusFilter || undefined,
    ...(from ? { 'plannedAt[gte]': `${from}T00:00:00` } : {}), ...(to ? { 'plannedAt[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching } = useGetTallyEntriesQuery(queryArgs);
  const { data: statsRes } = useGetTallyEntryStatsQuery();
  const stats = statsRes?.data || {};
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' });

  const openMenu = (e, row) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); setMenuRow(row); };
  const closeMenu = () => { setMenuAnchor(null); setMenuRow(null); };
  const onView = (r) => { navigate(`/procurement/tally-entries/${r._id}`); closeMenu(); };
  const onEdit = (r) => { setEditEntry(r); setFormOpen(true); closeMenu(); };
  const onComplete = (r) => { setActiveEntry(r); setCompleteOpen(true); closeMenu(); };

  const actionsFor = (r) => {
    const a = [{ key: 'view', label: 'View', icon: <Eye size={16} />, fn: () => onView(r) }];
    if (r.tallyEntryStatus === 'PENDING') {
      a.push({ key: 'edit', label: 'Edit', icon: <Pencil size={16} />, fn: () => onEdit(r) });
      a.push({ key: 'complete', label: 'Complete', icon: <CheckCircle2 size={16} />, fn: () => onComplete(r) });
    }
    return a;
  };

  const ProgressCell = ({ row }) => {
    const done = checklistProgress(row.checklist);
    const pct = (done / CHECKLIST_TOTAL) * 100;
    return (
      <Box sx={{ width: '100%' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="caption" fontWeight={700} lineHeight={1.2}>{done}/{CHECKLIST_TOTAL}</Typography></Box>
        <LinearProgress variant="determinate" value={pct} sx={{ height: 6, borderRadius: 3, mt: 0.5 }} color={pct === 100 ? 'success' : 'warning'} />
      </Box>
    );
  };

  const columns = [
    serialColumn(),
    { field: 'entryNumber', headerName: 'ENTRY NO', width: 135, renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'voucherNumber', headerName: 'VOUCHER', width: 130, renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value || '—'}</Typography> },
    { field: 'invoiceNumber', headerName: 'INVOICE', width: 130, renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value || '—'}</Typography> },
    { field: 'vendorName', headerName: 'VENDOR', flex: 1, minWidth: 150, renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    ...stepTimingColumns(),
    { field: '__progress', headerName: 'CHECKLIST', width: 110, sortable: false, renderCell: (p) => <ProgressCell row={p.row} /> },
    { field: 'tallyEntryStatus', headerName: 'STATUS', width: 130, renderCell: (p) => <TallyStatusChip status={p.value} /> },
    // Eye = quick view (popup, the list stays put); ⋮ holds View (the full page,
    // also the row click) and the row's other actions. Pinned to the right.
    rowActionsColumn((p) => (
      <RowActionsCell rowId={p.row._id} label={p.row.entryNumber}
        onQuickView={() => setQuickRow(p.row)} onMenu={(e) => openMenu(e, p.row)} />
    )),
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, ...pfmsPageSx }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={pfmsTitleSx}>Tally Entries ({stats.total || 0})</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>Step 1.12 · Purchase Entry in Tally — checklist verified, then payment</Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => { setEditEntry(null); setFormOpen(true); }}>New Tally Entry</Button>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}><PfmsKpiCard icon={<FileSpreadsheet size={20} />} label="Total"     value={stats.total}     color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={3}><PfmsKpiCard icon={<Hourglass size={20} />}      label="Pending"   value={stats.pending}   color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={3}><PfmsKpiCard icon={<CheckCheck size={20} />}     label="Completed" value={stats.completed} color="#16a34a" /></Grid>
        <Grid item xs={12} sm={6} md={3}><PfmsKpiCard icon={<XCircle size={20} />}        label="Cancelled" value={stats.cancelled} color="#dc2626" /></Grid>
      </Grid>

      {/* Filters — Search + Status stay visible; Vendor and the date range
          move into Filters, which only counts those as active. */}
      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <AdaptiveFilterBar
          pinned={[
            { key: 'search', minWidth: 220, node: (
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 220px' }, minWidth: 0 }}>
                <Typography component="label" htmlFor="te-search" sx={pfmsFieldLabelSx}>Search</Typography>
                <TextField id="te-search" size="small" fullWidth placeholder="Search entry / voucher / vendor…"
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
              </Box>
            ) },
            { key: 'status', minWidth: 160, node: (
              <Box sx={{ flex: '0 1 160px', minWidth: 140 }}>
                <Typography component="label" htmlFor="te-status" sx={pfmsFieldLabelSx}>Status</Typography>
                <TextField id="te-status" size="small" select fullWidth value={statusFilter}
                  SelectProps={ALL_WHEN_UNSET} onChange={(e) => onFilterChange(setStatusFilter)(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {TALLY_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
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

      <TallyEntryFormDialog open={formOpen} entry={editEntry} onClose={() => { setFormOpen(false); setEditEntry(null); }} />
      <TallyEntryCompleteDialog open={completeOpen} entry={activeEntry} onClose={() => { setCompleteOpen(false); setActiveEntry(null); }} />
      <RowQuickViewDialog open={Boolean(quickRow)} onClose={() => setQuickRow(null)}
        title="Tally Entry Details" number={quickRow?.entryNumber}
        status={quickRow ? <TallyStatusChip status={quickRow.tallyEntryStatus} /> : null}
        subtitle={quickRow?.vendorName}
        fields={quickRow ? [
          { label: 'Voucher', value: quickRow.voucherNumber },
          { label: 'Invoice', value: quickRow.invoiceNumber },
          { label: 'Checklist', value: `${checklistProgress(quickRow.checklist)}/${CHECKLIST_TOTAL}` },
        ] : []}
        openFullLabel="Open full entry" onOpenFull={quickRow ? () => onView(quickRow) : undefined} />
    </Box>
  );
};

export default TallyEntryList;
