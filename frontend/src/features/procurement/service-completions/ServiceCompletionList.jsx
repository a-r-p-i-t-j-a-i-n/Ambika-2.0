import React, { useState } from 'react';
import {
  Box, Typography, Paper, TextField, InputAdornment, MenuItem, Button,
  Grid, Chip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { alpha } from '@mui/material/styles';
import { Search, Wrench, CheckCircle2, Clock, ClipboardCheck, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import {
  useGetServiceCompletionsQuery,
  useGetServiceCompletionStatsQuery,
  useCreateIncomingQcMutation,
} from '../../../store/api/procurementApi';
import PfmsKpiCard from '../components/PfmsKpiCard';
import { pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx, pfmsCardSx } from '../pfmsTheme';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

const StatusChip = ({ value }) => {
  const map = {
    COMPLETED: { bg: '#16a34a', label: 'Completed' },
    PENDING:   { bg: '#b45309', label: 'Pending' },
    CANCELLED: { bg: '#dc2626', label: 'Cancelled' },
  };
  const c = map[value] || { bg: '#64748b', label: value || '—' };
  return <Chip size="small" label={c.label} sx={{ bgcolor: alpha(c.bg, 0.12), color: c.bg, fontWeight: 700 }} />;
};

const QcChip = ({ value }) => {
  const map = {
    PASSED:  { bg: '#16a34a', label: 'Passed' },
    FAILED:  { bg: '#dc2626', label: 'Failed' },
    PARTIAL: { bg: '#b45309', label: 'Partial' },
    PENDING: { bg: '#64748b', label: 'Pending' },
  };
  const c = map[value] || map.PENDING;
  return <Chip size="small" label={c.label} sx={{ bgcolor: alpha(c.bg, 0.12), color: c.bg, fontWeight: 700 }} />;
};

const ServiceCompletionList = () => {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const { data, isLoading, isFetching } = useGetServiceCompletionsQuery({
    page: paginationModel.page + 1, limit: paginationModel.pageSize, sort: '-createdAt',
    search: search || undefined, status: status || undefined,
  });
  const { data: statsRes } = useGetServiceCompletionStatsQuery();
  const stats = statsRes?.data || {};
  const [createQc, { isLoading: creatingQc }] = useCreateIncomingQcMutation();

  const onCreateQc = async (row) => {
    try {
      await createQc({ serviceCompletionId: row._id }).unwrap();
      enqueueSnackbar('Service QC created', { variant: 'success' });
      navigate('/purchase-fms/incoming-qc');
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to create QC', { variant: 'error' });
    }
  };

  const columns = [
    { field: 'scNumber', headerName: 'SC NO', width: 150,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography> },
    { field: 'indentNumber', headerName: 'INDENT', width: 130 },
    { field: 'vendorName', headerName: 'SERVICE PROVIDER', flex: 1, minWidth: 180,
      renderCell: (p) => p.value || '—' },
    { field: 'department', headerName: 'DEPT', width: 110, renderCell: (p) => p.value || '—' },
    { field: 'serviceCompletionDate', headerName: 'COMPLETED ON', width: 130,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{fmtDate(p.value)}</Typography> },
    { field: 'status', headerName: 'STATUS', width: 120, renderCell: (p) => <StatusChip value={p.value} /> },
    { field: 'qcStatus', headerName: 'QC RESULT', width: 120,
      renderCell: (p) => <QcChip value={p.value} /> },
    { field: '__qc', headerName: 'ACTION', width: 160, sortable: false, filterable: false,
      renderCell: (p) => {
        if (p.row.qcId) {
          return (
            <Button size="small" variant="text" startIcon={<ExternalLink size={14} />}
              onClick={(e) => { e.stopPropagation(); navigate(`/procurement/incoming-qc/${p.row.qcId}`); }}>
              View QC
            </Button>
          );
        }
        if (p.row.status === 'COMPLETED' && p.row.qcStatus === 'PENDING') {
          return (
            <Button size="small" variant="outlined" startIcon={<ClipboardCheck size={14} />} disabled={creatingQc}
              onClick={(e) => { e.stopPropagation(); onCreateQc(p.row); }}>Create QC</Button>
          );
        }
        return <Typography variant="caption" color="text.disabled">—</Typography>;
      } },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, ...pfmsPageSx }}>
      <Box>
        <Typography sx={pfmsTitleSx}>Service Completions (9)</Typography>
        <Typography sx={pfmsSubtitleSx}>Step 1.8A · Internal service / repair / maintenance completion</Typography>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}><PfmsKpiCard icon={<Wrench size={20} />} label="Total" value={stats.total} color="#2563eb" /></Grid>
        <Grid item xs={12} sm={6} md={3}><PfmsKpiCard icon={<Clock size={20} />} label="Pending" value={stats.pending} color="#b45309" /></Grid>
        <Grid item xs={12} sm={6} md={3}><PfmsKpiCard icon={<CheckCircle2 size={20} />} label="Completed" value={stats.completed} color="#16a34a" /></Grid>
        <Grid item xs={12} sm={6} md={3}><PfmsKpiCard icon={<ClipboardCheck size={20} />} label="QC Pending" value={stats.qcPending} color="#0e7490" /></Grid>
      </Grid>

      <Paper sx={{ ...pfmsCardSx, p: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
        <TextField size="small" placeholder="Search service completions…" value={search} onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', sm: 280 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color="#94a3b8" /></InputAdornment> }} />
        <TextField size="small" select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          <MenuItem value="PENDING">Pending</MenuItem>
          <MenuItem value="COMPLETED">Completed</MenuItem>
          <MenuItem value="CANCELLED">Cancelled</MenuItem>
        </TextField>
      </Paper>

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
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          rowHeight={52}
          columnHeaderHeight={44}
          sx={{ border: 0 }}
        />
      </Paper>
    </Box>
  );
};

export default ServiceCompletionList;
