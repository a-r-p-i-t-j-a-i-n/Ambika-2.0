import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  IconButton, Menu, ListItemIcon, ListItemText, Grid, Card, Tooltip, Autocomplete, LinearProgress,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Plus, MoreVertical, Eye, Pencil, CheckCircle2, Ban,
  FileSpreadsheet, Hourglass, CheckCheck, XCircle,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import {
  useGetTallyEntriesQuery,
  useGetTallyEntryStatsQuery,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { TallyStatusChip, TALLY_STATUSES, CHECKLIST_TOTAL, checklistProgress, fmtDate } from './tallyMeta';
import TallyEntryFormDialog from './TallyEntryFormDialog';
import TallyEntryCompleteDialog from './TallyEntryCompleteDialog';

const KpiCard = ({ icon, label, value, color }) => (
  <Card sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5, borderRadius: '14px' }}>
    <Box sx={{ width: 42, height: 42, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.1), color }}>{icon}</Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1.1 }} noWrap>{value ?? 0}</Typography>
      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>{label}</Typography>
    </Box>
  </Card>
);

const TallyEntryList = () => {
  const navigate = useNavigate();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [activeEntry, setActiveEntry] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);

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
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="caption" fontWeight={700}>{done}/{CHECKLIST_TOTAL}</Typography></Box>
        <LinearProgress variant="determinate" value={pct} sx={{ height: 6, borderRadius: 3, mt: 0.25 }} color={pct === 100 ? 'success' : 'warning'} />
      </Box>
    );
  };

  const columns = [
    { field: 'entryNumber', headerName: 'ENTRY NO', width: 135, renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'voucherNumber', headerName: 'VOUCHER', width: 130, renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value || '—'}</Typography> },
    { field: 'invoiceNumber', headerName: 'INVOICE', width: 130, renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value || '—'}</Typography> },
    { field: 'vendorName', headerName: 'VENDOR', flex: 1, minWidth: 150, renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    { field: 'plannedAt', headerName: 'PLANNED', width: 95, renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'actualAt', headerName: 'ACTUAL', width: 95, renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: '__progress', headerName: 'CHECKLIST', width: 110, sortable: false, renderCell: (p) => <ProgressCell row={p.row} /> },
    { field: 'tallyEntryStatus', headerName: 'STATUS', width: 130, renderCell: (p) => <TallyStatusChip status={p.value} /> },
    { field: 'performedByName', headerName: 'PERFORMED BY', width: 130, renderCell: (p) => <Typography variant="body2" color="text.secondary" noWrap>{p.value || '—'}</Typography> },
    { field: '__actions', headerName: '', width: 60, sortable: false, filterable: false, align: 'center', renderCell: (p) => <Tooltip title="Actions"><IconButton size="small" onClick={(e) => openMenu(e, p.row)}><MoreVertical size={16} /></IconButton></Tooltip> },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: 2, sm: 3 }, minHeight: '100vh', bgcolor: '#f8fafc' }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, color: '#0b2545' }}>Tally Entries (13)</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', fontWeight: 500 }}>Step 1.12 · Purchase Entry in Tally — checklist verified, then payment</Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => { setEditEntry(null); setFormOpen(true); }}>New Tally Entry</Button>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}><KpiCard icon={<FileSpreadsheet size={20} />} label="Total"     value={stats.total}     color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={3}><KpiCard icon={<Hourglass size={20} />}      label="Pending"   value={stats.pending}   color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={3}><KpiCard icon={<CheckCheck size={20} />}     label="Completed" value={stats.completed} color="#16a34a" /></Grid>
        <Grid item xs={12} sm={6} md={3}><KpiCard icon={<XCircle size={20} />}        label="Cancelled" value={stats.cancelled} color="#dc2626" /></Grid>
      </Grid>

      <Paper sx={{ p: 1.5, borderRadius: '14px', display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField size="small" placeholder="Search entry / voucher / vendor…" value={search} onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 240 } }} InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color="#94a3b8" /></InputAdornment> }} />
        <Autocomplete size="small" sx={{ minWidth: 190 }} options={partiesRes?.data || []} value={vendorFilter}
          getOptionLabel={(o) => o?.name || ''} isOptionEqualToValue={(o, v) => o._id === v._id} onChange={(_e, v) => setVendorFilter(v)} renderInput={(params) => <TextField {...params} label="Vendor" />} />
        <TextField size="small" select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          {TALLY_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
        </TextField>
        <DateInputDDMMYYYY size="small" label="From" value={from} onChange={setFrom} />
        <DateInputDDMMYYYY size="small" label="To" value={to} onChange={setTo} />
      </Paper>

      <Paper sx={{ flexGrow: 1, minHeight: 420, borderRadius: '16px', overflow: 'hidden' }}>
        <DataGrid rows={data?.data || []} columns={columns} getRowId={(r) => r._id} loading={isLoading || isFetching}
          paginationMode="server" rowCount={data?.meta?.total || 0} paginationModel={paginationModel} onPaginationModelChange={setPaginationModel}
          onRowClick={(p) => navigate(`/procurement/tally-entries/${p.id}`)} pageSizeOptions={[10, 25, 50, 100]} disableRowSelectionOnClick
          rowHeight={52} columnHeaderHeight={44} sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }} />
      </Paper>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuRow && actionsFor(menuRow).map((a) => (
          <MenuItem key={a.key} onClick={a.fn}><ListItemIcon>{a.icon}</ListItemIcon><ListItemText>{a.label}</ListItemText></MenuItem>
        ))}
      </Menu>

      <TallyEntryFormDialog open={formOpen} entry={editEntry} onClose={() => { setFormOpen(false); setEditEntry(null); }} />
      <TallyEntryCompleteDialog open={completeOpen} entry={activeEntry} onClose={() => { setCompleteOpen(false); setActiveEntry(null); }} />
    </Box>
  );
};

export default TallyEntryList;
