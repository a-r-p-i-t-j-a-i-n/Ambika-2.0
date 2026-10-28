import React, { useState, useMemo } from 'react';
import { serialColumn } from '../components/serialNumber';
import { stepTimingColumns } from '../components/stepTimingColumns';
import {
  Box, Typography, Paper, TextField, InputAdornment, MenuItem, Button,
  Menu, ListItemIcon, ListItemText, Grid, Tooltip,
  Autocomplete, FormControlLabel, Switch, Chip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Eye, Pencil, CheckCircle2,
  PackageCheck, PhoneCall, Hourglass, BadgeCheck, AlarmClock, Plus,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useGetFollowUpsQuery,
  useGetFollowUpStatsQuery,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import AdaptiveFilterBar from '../components/AdaptiveFilterBar';
import { useDebouncedSearch } from '../components/useDebouncedSearch';
import { FuStatusChip, FuTypeChip, FOLLOWUP_STATUSES, FU_STATUS_LABEL, fmtDate, fmtDelay, isDelayed } from './fuMeta';
import FollowUpFormDrawer from './FollowUpFormDrawer';
import FollowUpDoneDialog from './FollowUpDoneDialog';
import FollowUpReadyForGrnDialog from './FollowUpReadyForGrnDialog';
import PfmsKpiCard from '../components/PfmsKpiCard';
import useRowNavigation, { rowNavigationGridSx } from '../common/useRowNavigation';
import RowQuickViewDialog from '../common/RowQuickViewDialog';
import RowActionsCell from '../components/RowActionsCell';
import { rowActionsColumn, rowActionsGridProps, rowActionsGridSx } from '../components/rowActionsColumn';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx, pfmsFieldLabelSx, ALL_WHEN_UNSET } from '../pfmsTheme';

const FollowUpList = () => {
  const navigate = useNavigate();

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchInput, setSearchInput, search, resetSearch] = useDebouncedSearch('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [delayedOnly, setDelayedOnly] = useState(false);

  const resetPage = () => setPaginationModel((m) => ({ ...m, page: 0 }));
  const onFilterChange = (setter) => (value) => { setter(value); resetPage(); };

  // "Filters" covers Vendor, the date range and the Delayed-only toggle —
  // Status stays always visible (disabled while Delayed-only is on, same as
  // before: that toggle already implies its own status set).
  const secondaryCount = [vendorFilter, from, to, delayedOnly].filter(Boolean).length;
  const clearSecondary = () => { setVendorFilter(null); setFrom(''); setTo(''); setDelayedOnly(false); resetPage(); };
  const anyFilterActive = Boolean(search || statusFilter || secondaryCount);
  const clearAll = () => { resetSearch(); setStatusFilter(''); clearSecondary(); };

  const [formOpen, setFormOpen] = useState(false);
  const [editFu, setEditFu] = useState(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [readyOpen, setReadyOpen] = useState(false);
  const [activeFu, setActiveFu] = useState(null);
  const rowNav = useRowNavigation({ to: (r) => `/procurement/follow-ups/${r._id}` });
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);
  const [quickRow, setQuickRow] = useState(null); // row whose quick view is open

  const queryArgs = useMemo(() => ({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    sort: '-createdAt',
    search: search || undefined,
    vendorId: vendorFilter?._id || undefined,
    // Delayed = pending/rescheduled with plannedAt already past.
    followUpStatus: delayedOnly ? 'PENDING,RESCHEDULED' : (statusFilter || undefined),
    ...(delayedOnly ? { 'plannedAt[lte]': new Date().toISOString() } : {}),
    ...(from ? { 'plannedAt[gte]': `${from}T00:00:00` } : {}),
    ...(to && !delayedOnly ? { 'plannedAt[lte]': `${to}T23:59:59` } : {}),
  }), [paginationModel, search, vendorFilter, statusFilter, from, to, delayedOnly]);

  const { data, isLoading, isFetching } = useGetFollowUpsQuery(queryArgs);
  const { data: statsRes } = useGetFollowUpStatsQuery();
  const stats = statsRes?.data || {};
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' });

  const openMenu = (e, row) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); setMenuRow(row); };
  const closeMenu = () => { setMenuAnchor(null); setMenuRow(null); };

  const onView = (r) => { navigate(`/procurement/follow-ups/${r._id}`); closeMenu(); };
  const onEdit = (r) => { setEditFu(r); setFormOpen(true); closeMenu(); };
  const onDone = (r) => { setActiveFu(r); setDoneOpen(true); closeMenu(); };
  const onReady = (r) => { setActiveFu(r); setReadyOpen(true); closeMenu(); };

  const actionsFor = (r) => {
    const a = [{ key: 'view', label: 'View', icon: <Eye size={16} />, fn: () => onView(r) }];
    const isActive = ['PENDING', 'RESCHEDULED'].includes(r.followUpStatus);
    if (isActive) {
      a.push({ key: 'edit', label: 'Edit Pending', icon: <Pencil size={16} />, fn: () => onEdit(r) });
      // One action for every cycle — its outcome (next date / final date) decides what happens.
      a.push({ key: 'done', label: 'Update Follow-up', icon: <CheckCircle2 size={16} />, fn: () => onDone(r) });
    }
    // Ready For GRN only once delivery is confirmed via a Final Material Date.
    if (r.followUpStatus === 'DONE' && r.finalMaterialDate) {
      a.push({ key: 'ready', label: 'Mark Ready For GRN', icon: <PackageCheck size={16} />, fn: () => onReady(r) });
    }
    return a;
  };

  const columns = [
    serialColumn(),
    { field: 'followUpNumber', headerName: 'FOLLOW-UP NO', width: 125,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'poNumber', headerName: 'PO NUMBER', width: 140,
      renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value || '—'}</Typography> },
    { field: 'expectedDeliveryDate', headerName: 'EXPECTED DELIVERY', width: 140,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'pendingQty', headerName: 'PENDING QTY', width: 115, type: 'number', sortable: false,
      renderCell: (p) => (p.value == null
        ? <Typography variant="caption" color="text.disabled">—</Typography>
        : <Typography variant="body2" fontWeight={700} color={p.value > 0 ? 'warning.main' : 'success.main'}>
            {p.value}{p.row.pendingQtyUnit ? ` ${p.row.pendingQtyUnit}` : ''}
          </Typography>) },
    { field: 'lastFollowUpAt', headerName: 'LAST FOLLOW-UP', width: 125, sortable: false,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'indentNumber', headerName: 'INDENT NO', width: 110,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value || '—'}</Typography> },
    { field: 'vendorName', headerName: 'VENDOR', flex: 1, minWidth: 160,
      renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    ...stepTimingColumns(),
    { field: 'followUpStatus', headerName: 'STATUS', width: 135,
      renderCell: (p) => <FuStatusChip status={p.value} /> },
    // Next contact: the saved next date, else (while active) the planned date.
    { field: 'nextFollowUpDate', headerName: 'NEXT FOLLOW-UP', width: 130,
      renderCell: (p) => {
        const active = ['PENDING', 'RESCHEDULED'].includes(p.row.followUpStatus);
        const next = p.value || (active ? p.row.plannedAt : null);
        return (
          <Typography variant="body2" sx={{ color: isDelayed(p.row) ? 'error.main' : 'text.secondary', fontWeight: isDelayed(p.row) ? 700 : 400 }}>
            {fmtDate(next)}
          </Typography>
        );
      } },
    { field: 'contactPerson', headerName: 'CONTACT', width: 140, sortable: false,
      renderCell: (p) => (
        <Box sx={{ minWidth: 0, lineHeight: 1.2 }}>
          <Typography variant="body2" noWrap>{p.value || '—'}</Typography>
          {p.row.vendorPhone ? <Typography variant="caption" color="text.secondary" noWrap>{p.row.vendorPhone}</Typography> : null}
        </Box>
      ) },
    { field: 'remarks', headerName: 'REMARKS', flex: 1, minWidth: 160, sortable: false,
      renderCell: (p) => (
        <Tooltip title={p.value || ''} disableHoverListener={!p.value}>
          <Typography variant="body2" color="text.secondary" noWrap>{p.value || '—'}</Typography>
        </Tooltip>
      ) },
    { field: 'finalMaterialDate', headerName: 'FINAL MATERIAL', width: 125,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'timeDelayMinutes', headerName: 'TIME DELAY', width: 110, sortable: false,
      renderCell: (p) => (p.row.actualAt
        ? <Chip size="small" label={fmtDelay(p.value)} color={p.value > 0 ? 'warning' : 'success'} variant="outlined" sx={{ fontWeight: 700 }} />
        : <Typography variant="caption" color="text.disabled">—</Typography>) },
    { field: 'followUpType', headerName: 'TYPE', width: 105,
      renderCell: (p) => <FuTypeChip type={p.value} /> },
    // Eye = quick view (popup, the list stays put); ⋮ holds View (the full page,
    // also the row click) and the row's other actions. Pinned to the right.
    rowActionsColumn((p) => (
      <RowActionsCell rowId={p.row._id} label={p.row.followUpNumber}
        onQuickView={() => setQuickRow(p.row)} onMenu={(e) => openMenu(e, p.row)} />
    )),
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, ...pfmsPageSx }}>
      {/* Header — follow-ups can be started here for any released PO, or from
          a Purchase Order's detail page; both use the same create rules.
          "Add Follow-up" opens the Update Follow-up form with a PO picker. */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={pfmsTitleSx}>Follow-ups ({stats.total || 0})</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>
            Step 1.5 · Track vendor delivery follow-ups for released POs — expected delivery, pending qty and contact history
          </Typography>
        </Box>
        <Button variant="contained" disableElevation startIcon={<Plus size={17} />}
          onClick={() => { setActiveFu(null); setDoneOpen(true); }}
          sx={{ fontWeight: 700, borderRadius: '8px', whiteSpace: 'nowrap' }}>
          Add Follow-up
        </Button>
      </Box>

      {/* KPIs */}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<PhoneCall size={20} />}   label="Total Follow-ups" value={stats.total}       color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Hourglass size={20} />}   label="Pending"          value={stats.pending}     color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<BadgeCheck size={20} />}  label="Done"             value={stats.done}        color="#0f766e" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<AlarmClock size={20} />}  label="Delayed"          value={stats.delayed}     color="#be123c" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<PackageCheck size={20} />} label="Ready For GRN"   value={stats.readyForGrn} color="#16a34a" /></Grid>
      </Grid>

      {/* Filters — Search + Status stay visible (Status disables while
          Delayed-only is on, same as before — that toggle implies its own
          status set); Vendor, the date range and the toggle move into
          Filters, which only counts those as active. */}
      <Paper sx={{ ...pfmsCardSx, p: 1.25 }}>
        <AdaptiveFilterBar
          pinned={[
            { key: 'search', minWidth: 220, node: (
              <Box sx={{ flex: { xs: '1 1 100%', sm: '1 1 220px' }, minWidth: 0 }}>
                <Typography component="label" htmlFor="fu-search" sx={pfmsFieldLabelSx}>Search</Typography>
                <TextField id="fu-search" size="small" fullWidth placeholder="Search FU / PO / vendor…"
                  value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
              </Box>
            ) },
            { key: 'status', minWidth: 160, node: (
              <Box sx={{ flex: '0 1 160px', minWidth: 140 }}>
                <Typography component="label" htmlFor="fu-status" sx={pfmsFieldLabelSx}>Status</Typography>
                <TextField id="fu-status" size="small" select fullWidth value={statusFilter} disabled={delayedOnly}
                  SelectProps={ALL_WHEN_UNSET} onChange={(e) => onFilterChange(setStatusFilter)(e.target.value)}>
                  <MenuItem value="">All</MenuItem>
                  {FOLLOWUP_STATUSES.map((s) => <MenuItem key={s} value={s}>{(FU_STATUS_LABEL[s] || s).replace(/_/g, ' ').toUpperCase()}</MenuItem>)}
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
                  <DateInputDDMMYYYY size="small" label="To" fullWidth value={to} onChange={onFilterChange(setTo)} disabled={delayedOnly} sx={{ width: '100%' }} />
                </Box>
              ),
            },
            {
              key: 'delayedOnly', width: 150, active: delayedOnly,
              node: (
                <Box sx={{ flex: '0 0 150px', minWidth: 140, pb: 0.5 }}>
                  <FormControlLabel
                    control={<Switch size="small" checked={delayedOnly} onChange={(e) => onFilterChange(setDelayedOnly)(e.target.checked)} />}
                    label={<Typography variant="caption" fontWeight={700}>Delayed only</Typography>}
                    sx={{ ml: 0 }}
                  />
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
          // Row click opens Follow-up Details; Mark Done / Edit stay in the actions menu.
          {...rowNav.gridProps} {...rowActionsGridProps}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          // Secondary fields stay available from the column menu.
          initialState={{ columns: { columnVisibilityModel: {
            indentNumber: false, finalMaterialDate: false,
          } } }}
          rowHeight={50}
          columnHeaderHeight={44}
          sx={[{ border: 0 }, rowNavigationGridSx, rowActionsGridSx]}
        />
      </Paper>

      {/* Row actions */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuRow && actionsFor(menuRow).map((a) => (
          <MenuItem key={a.key} onClick={a.fn}>
            <ListItemIcon>{a.icon}</ListItemIcon>
            <ListItemText>{a.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      {/* Form + dialogs */}
      <FollowUpFormDrawer open={formOpen} followUp={editFu} onClose={() => { setFormOpen(false); setEditFu(null); }} />
      <FollowUpDoneDialog open={doneOpen} followUp={activeFu} onClose={() => { setDoneOpen(false); setActiveFu(null); }} />
      <FollowUpReadyForGrnDialog open={readyOpen} followUp={activeFu} onClose={() => { setReadyOpen(false); setActiveFu(null); }} />
      <RowQuickViewDialog open={Boolean(quickRow)} onClose={() => setQuickRow(null)}
        title="Follow-up Details" number={quickRow?.followUpNumber}
        status={quickRow ? <FuStatusChip status={quickRow.followUpStatus} /> : null}
        subtitle={quickRow?.vendorName}
        fields={quickRow ? [
          { label: 'PO Number', value: quickRow.poNumber },
          { label: 'Indent No', value: quickRow.indentNumber },
          { label: 'Type', value: <FuTypeChip type={quickRow.followUpType} /> },
          { label: 'Expected Delivery', value: fmtDate(quickRow.expectedDeliveryDate) },
          { label: 'Pending Qty', value: quickRow.pendingQty == null ? '' : `${quickRow.pendingQty}${quickRow.pendingQtyUnit ? ` ${quickRow.pendingQtyUnit}` : ''}` },
          { label: 'Last Follow-up', value: fmtDate(quickRow.lastFollowUpAt) },
          { label: 'Next Follow-up', value: fmtDate(quickRow.nextFollowUpDate || (['PENDING', 'RESCHEDULED'].includes(quickRow.followUpStatus) ? quickRow.plannedAt : null)) },
          { label: 'Final Material', value: fmtDate(quickRow.finalMaterialDate) },
          { label: 'Contact', value: [quickRow.contactPerson, quickRow.vendorPhone].filter(Boolean).join(' · ') },
          { label: 'Remarks', value: quickRow.remarks, span: 2 },
        ] : []}
        openFullLabel="Open full follow-up" onOpenFull={quickRow ? () => onView(quickRow) : undefined} />
    </Box>
  );
};

export default FollowUpList;
