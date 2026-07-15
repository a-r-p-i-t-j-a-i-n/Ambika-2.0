import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, Button, MenuItem,
  IconButton, Menu, ListItemIcon, ListItemText, Grid, Card, Tooltip, Autocomplete,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Search, Plus, MoreVertical, Eye, Pencil, ClipboardCheck, Ban, FileDown,
  ShieldCheck, Hourglass, BadgeCheck, ShieldX, ShieldAlert,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import {
  useGetIncomingQcsQuery,
  useGetIncomingQcStatsQuery,
  useCancelIncomingQcMutation,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { QcStatusChip, QcResultChip, QC_STATUSES, QC_RESULTS, fmtDate } from './qcMeta';
import IncomingQCFormDialog from './IncomingQCFormDialog';
import IncomingQCCompleteDialog from './IncomingQCCompleteDialog';
import { resolveFileUrl } from '../../../utils/fileUrl';

const KpiCard = ({ icon, label, value, color }) => (
  <Card sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.5, borderRadius: '14px' }}>
    <Box sx={{ width: 42, height: 42, borderRadius: '10px', display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.1), color }}>{icon}</Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '1.35rem', fontWeight: 800, lineHeight: 1.1, color: 'text.primary' }} noWrap>{value ?? 0}</Typography>
      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>{label}</Typography>
    </Box>
  </Card>
);

const sumQty = (items, key) => (items || []).reduce((s, it) => s + (Number(it[key]) || 0), 0);

const IncomingQCList = () => {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [search, setSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editQc, setEditQc] = useState(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [activeQc, setActiveQc] = useState(null);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [menuRow, setMenuRow] = useState(null);

  const queryArgs = {
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    sort: '-createdAt',
    search: search || undefined,
    vendorId: vendorFilter?._id || undefined,
    qcStatus: statusFilter || undefined,
    overallResult: resultFilter || undefined,
    ...(from ? { 'qcDate[gte]': `${from}T00:00:00` } : {}),
    ...(to ? { 'qcDate[lte]': `${to}T23:59:59` } : {}),
  };
  const { data, isLoading, isFetching } = useGetIncomingQcsQuery(queryArgs);
  const { data: statsRes } = useGetIncomingQcStatsQuery();
  const stats = statsRes?.data || {};
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' });
  const [cancelQc] = useCancelIncomingQcMutation();

  const openMenu = (e, row) => { e.stopPropagation(); setMenuAnchor(e.currentTarget); setMenuRow(row); };
  const closeMenu = () => { setMenuAnchor(null); setMenuRow(null); };

  const onView = (r) => { navigate(`/procurement/incoming-qc/${r._id}`); closeMenu(); };
  const onEdit = (r) => { setEditQc(r); setFormOpen(true); closeMenu(); };
  const onComplete = (r) => { setActiveQc(r); setCompleteOpen(true); closeMenu(); };
  const onPdf = (r) => { window.open(resolveFileUrl(r.qcPdfUrl), '_blank'); closeMenu(); };
  const onCancel = async (r) => {
    closeMenu();
    try { await cancelQc({ id: r._id }).unwrap(); enqueueSnackbar('QC cancelled', { variant: 'info' }); }
    catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to cancel', { variant: 'error' }); }
  };

  const actionsFor = (r) => {
    const a = [{ key: 'view', label: 'View', icon: <Eye size={16} />, fn: () => onView(r) }];
    if (['DRAFT', 'IN_PROGRESS'].includes(r.qcStatus)) {
      a.push({ key: 'edit', label: 'Edit', icon: <Pencil size={16} />, fn: () => onEdit(r) });
      a.push({ key: 'complete', label: 'Complete QC', icon: <ClipboardCheck size={16} />, fn: () => onComplete(r) });
      a.push({ key: 'cancel', label: 'Cancel', icon: <Ban size={16} />, fn: () => onCancel(r) });
    }
    if (r.qcPdfUrl) a.push({ key: 'pdf', label: 'Download QC Report', icon: <FileDown size={16} />, fn: () => onPdf(r) });
    return a;
  };

  const columns = [
    { field: 'qcNumber', headerName: 'QC NUMBER', width: 140, renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'qcDate', headerName: 'QC DATE', width: 95, renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'grnNumber', headerName: 'GRN NUMBER', width: 140, renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value || '—'}</Typography> },
    { field: 'poNumber', headerName: 'PO NUMBER', width: 130, renderCell: (p) => <Typography variant="body2" color="text.secondary">{p.value || '—'}</Typography> },
    { field: 'vendorName', headerName: 'VENDOR', flex: 1, minWidth: 150, renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value || '—'}</Typography> },
    { field: 'items', headerName: 'ITEMS', width: 70, align: 'right', headerAlign: 'right', sortable: false, valueGetter: (_v, row) => (row.items || []).length },
    { field: 'totalReceived', headerName: 'RECEIVED', width: 95, align: 'right', headerAlign: 'right' },
    { field: 'totalAccepted', headerName: 'ACCEPTED', width: 95, align: 'right', headerAlign: 'right', renderCell: (p) => <Typography variant="body2" sx={{ color: '#0f766e', fontWeight: 700 }}>{p.value}</Typography> },
    { field: 'totalRejected', headerName: 'REJECTED', width: 95, align: 'right', headerAlign: 'right', renderCell: (p) => <Typography variant="body2" sx={{ color: p.value > 0 ? '#be123c' : 'text.secondary', fontWeight: p.value > 0 ? 700 : 400 }}>{p.value}</Typography> },
    { field: 'overallResult', headerName: 'RESULT', width: 125, renderCell: (p) => <QcResultChip result={p.value} /> },
    { field: 'qcStatus', headerName: 'STATUS', width: 125, renderCell: (p) => <QcStatusChip status={p.value} /> },
    { field: '__actions', headerName: '', width: 60, sortable: false, filterable: false, align: 'center',
      renderCell: (p) => <Tooltip title="Actions"><IconButton size="small" onClick={(e) => openMenu(e, p.row)}><MoreVertical size={16} /></IconButton></Tooltip> },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: 2, sm: 3 }, minHeight: '100vh', bgcolor: '#f8fafc' }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, color: '#0b2545' }}>Incoming QC</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', fontWeight: 500 }}>
            Step 1.9 · Inspect received material — rejected qty moves out of stock
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => { setEditQc(null); setFormOpen(true); }}>New QC</Button>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<ShieldCheck size={20} />} label="Total QC"    value={stats.total}   color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<Hourglass size={20} />}   label="Pending QC"  value={stats.pending} color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<BadgeCheck size={20} />}  label="Passed"      value={stats.passed}  color="#0f766e" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<ShieldX size={20} />}     label="Failed"      value={stats.failed}  color="#be123c" /></Grid>
        <Grid item xs={12} sm={6} md={2.4}><KpiCard icon={<ShieldAlert size={20} />} label="Partial"     value={stats.partial} color="#7c3aed" /></Grid>
      </Grid>

      <Paper sx={{ p: 1.5, borderRadius: '14px', display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField size="small" placeholder="Search QC / GRN / vendor…" value={search} onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 230 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color="#94a3b8" /></InputAdornment> }} />
        <Autocomplete size="small" sx={{ minWidth: 180 }} options={partiesRes?.data || []} value={vendorFilter}
          getOptionLabel={(o) => o?.name || ''} isOptionEqualToValue={(o, v) => o._id === v._id}
          onChange={(_e, v) => setVendorFilter(v)} renderInput={(params) => <TextField {...params} label="Vendor" />} />
        <TextField size="small" select label="QC Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value="">All</MenuItem>
          {QC_STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Result" value={resultFilter} onChange={(e) => setResultFilter(e.target.value)} sx={{ minWidth: 150 }}>
          <MenuItem value="">All</MenuItem>
          {QC_RESULTS.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
        </TextField>
        <DateInputDDMMYYYY size="small" label="From" value={from} onChange={setFrom} />
        <DateInputDDMMYYYY size="small" label="To" value={to} onChange={setTo} />
      </Paper>

      <Paper sx={{ flexGrow: 1, minHeight: 420, borderRadius: '16px', overflow: 'hidden' }}>
        <DataGrid
          rows={data?.data || []}
          columns={columns}
          getRowId={(r) => r._id}
          loading={isLoading || isFetching}
          paginationMode="server"
          rowCount={data?.meta?.total || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          onRowClick={(p) => navigate(`/procurement/incoming-qc/${p.id}`)}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          rowHeight={50}
          columnHeaderHeight={44}
          sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Paper>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuRow && actionsFor(menuRow).map((a) => (
          <MenuItem key={a.key} onClick={a.fn}>
            <ListItemIcon>{a.icon}</ListItemIcon>
            <ListItemText>{a.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>

      <IncomingQCFormDialog open={formOpen} qc={editQc} onClose={() => { setFormOpen(false); setEditQc(null); }} />
      <IncomingQCCompleteDialog open={completeOpen} qc={activeQc} onClose={() => { setCompleteOpen(false); setActiveQc(null); }} />
    </Box>
  );
};

export default IncomingQCList;
