import React, { useState, useMemo } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, MenuItem,
  IconButton, Menu, ListItemIcon, ListItemText, Grid, Tooltip,
  Autocomplete, FormControlLabel, Switch, Chip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, MoreVertical, Eye, Pencil, CheckCircle2, CalendarClock,
  PackageCheck, PhoneCall, Hourglass, BadgeCheck, AlarmClock,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useGetFollowUpsQuery,
  useGetFollowUpStatsQuery,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { FuStatusChip, FuTypeChip, FOLLOWUP_STATUSES, fmtDate, fmtDelay, isDelayed } from './fuMeta';
import FollowUpFormDrawer from './FollowUpFormDrawer';
import FollowUpDoneDialog from './FollowUpDoneDialog';
import FollowUpRescheduleDialog from './FollowUpRescheduleDialog';
import FollowUpReadyForGrnDialog from './FollowUpReadyForGrnDialog';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx } from '../pfmsTheme';

const FollowUpList = () => {
  const navigate = useNavigate();

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [delayedOnly, setDelayedOnly] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editFu, setEditFu] = useState(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [readyOpen, setReadyOpen] = useState(false);
  const [activeFu, setActiveFu] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);

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
  const onReschedule = (r) => { setActiveFu(r); setRescheduleOpen(true); closeMenu(); };
  const onReady = (r) => { setActiveFu(r); setReadyOpen(true); closeMenu(); };

  const actionsFor = (r) => {
    const a = [{ key: 'view', label: 'View', icon: <Eye size={16} />, fn: () => onView(r) }];
    const isRescheduled = r.followUpStatus === 'RESCHEDULED';
    const isActive = ['PENDING', 'RESCHEDULED'].includes(r.followUpStatus);
    if (isActive) {
      a.push({ key: 'edit', label: 'Edit Pending', icon: <Pencil size={16} />, fn: () => onEdit(r) });
      // RESCHEDULED follow-ups stay active — "Follow-up Again" reopens the cycle.
      a.push({ key: 'done', label: isRescheduled ? 'Follow-up Again' : 'Mark Done', icon: <CheckCircle2 size={16} />, fn: () => onDone(r) });
      a.push({ key: 'reschedule', label: 'Reschedule', icon: <CalendarClock size={16} />, fn: () => onReschedule(r) });
    }
    // Ready For GRN only once delivery is confirmed via a Final Material Date.
    if (r.followUpStatus === 'DONE' && r.finalMaterialDate) {
      a.push({ key: 'ready', label: 'Mark Ready For GRN', icon: <PackageCheck size={16} />, fn: () => onReady(r) });
    }
    return a;
  };

  const columns = [
    { field: 'followUpNumber', headerName: 'FOLLOW-UP NO', width: 125,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'poNumber', headerName: 'PO NUMBER', width: 140,
      renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value || '—'}</Typography> },
    { field: 'indentNumber', headerName: 'INDENT NO', width: 110,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value || '—'}</Typography> },
    { field: 'vendorName', headerName: 'VENDOR', flex: 1, minWidth: 160,
      renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    { field: 'plannedAt', headerName: 'PLANNED', width: 105,
      renderCell: (p) => (
        <Typography variant="body2" sx={{ color: isDelayed(p.row) ? 'error.main' : 'text.secondary', fontWeight: isDelayed(p.row) ? 700 : 400 }}>
          {fmtDate(p.value)}
        </Typography>
      ) },
    { field: 'actualAt', headerName: 'ACTUAL', width: 105,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'followUpStatus', headerName: 'STATUS', width: 135,
      renderCell: (p) => <FuStatusChip status={p.value} /> },
    { field: 'nextFollowUpDate', headerName: 'NEXT FOLLOW-UP', width: 130,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'finalMaterialDate', headerName: 'FINAL MATERIAL', width: 125,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'timeDelayMinutes', headerName: 'TIME DELAY', width: 110, sortable: false,
      renderCell: (p) => (p.row.actualAt
        ? <Chip size="small" label={fmtDelay(p.value)} color={p.value > 0 ? 'warning' : 'success'} variant="outlined" sx={{ fontWeight: 700 }} />
        : <Typography variant="caption" color="text.disabled">—</Typography>) },
    { field: 'followUpType', headerName: 'TYPE', width: 105,
      renderCell: (p) => <FuTypeChip type={p.value} /> },
    { field: 'performedByName', headerName: 'PERFORMED BY', width: 125,
      renderCell: (p) => <Typography variant="body2" color="text.secondary" noWrap>{p.value || '—'}</Typography> },
    { field: '__actions', headerName: '', width: 60, sortable: false, filterable: false, align: 'center',
      renderCell: (p) => (
        <Tooltip title="Actions">
          <IconButton size="small" onClick={(e) => openMenu(e, p.row)}><MoreVertical size={16} /></IconButton>
        </Tooltip>
      ) },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, ...pfmsPageSx }}>
      {/* Header — tracking/management only; follow-ups are created and driven
          from a Purchase Order's detail page (single "Continue Follow-up" action). */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={pfmsTitleSx}>Material Follow-ups (5)</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>
            Step 1.5 · Track every vendor delivery follow-up — open a Purchase Order to create or continue one
          </Typography>
        </Box>
      </Box>

      {/* KPIs */}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<PhoneCall size={20} />}   label="Total Follow-ups" value={stats.total}       color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<Hourglass size={20} />}   label="Pending"          value={stats.pending}     color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<BadgeCheck size={20} />}  label="Done"             value={stats.done}        color="#0f766e" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<AlarmClock size={20} />}  label="Delayed"          value={stats.delayed}     color="#be123c" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><PfmsKpiCard icon={<PackageCheck size={20} />} label="Ready For GRN"   value={stats.readyForGrn} color="#16a34a" /></Grid>
      </Grid>

      {/* Filters */}
      <Paper sx={{ ...pfmsCardSx, p: 1, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField size="small" placeholder="Search FU / PO / vendor…" value={search} onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 230 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color={PFMS.faint} /></InputAdornment> }} />
        <Autocomplete
          size="small" sx={{ minWidth: 190 }}
          options={partiesRes?.data || []}
          value={vendorFilter}
          getOptionLabel={(o) => o?.name || ''}
          isOptionEqualToValue={(o, v) => o._id === v._id}
          onChange={(_e, v) => setVendorFilter(v)}
          renderInput={(params) => <TextField {...params} label="Vendor" />}
        />
        <TextField size="small" select label="Status" value={statusFilter} disabled={delayedOnly}
          onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          {FOLLOWUP_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
        </TextField>
        <DateInputDDMMYYYY size="small" label="From" value={from} onChange={setFrom} />
        <DateInputDDMMYYYY size="small" label="To" value={to} onChange={setTo} disabled={delayedOnly} />
        <FormControlLabel
          control={<Switch size="small" checked={delayedOnly} onChange={(e) => setDelayedOnly(e.target.checked)} />}
          label={<Typography variant="caption" fontWeight={700}>Delayed only</Typography>}
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
          onRowClick={(p) => navigate(`/procurement/follow-ups/${p.id}`)}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          rowHeight={50}
          columnHeaderHeight={44}
          sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
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
      <FollowUpRescheduleDialog open={rescheduleOpen} followUp={activeFu} onClose={() => { setRescheduleOpen(false); setActiveFu(null); }} />
      <FollowUpReadyForGrnDialog open={readyOpen} followUp={activeFu} onClose={() => { setReadyOpen(false); setActiveFu(null); }} />
    </Box>
  );
};

export default FollowUpList;
