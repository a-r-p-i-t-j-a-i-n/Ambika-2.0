import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, Paper, Stack, Typography, Button, TextField, InputAdornment, IconButton,
  Chip, Tooltip, alpha, useTheme, MenuItem,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Plus, Search, Truck, ExternalLink, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import dayjs from 'dayjs';
import { useGetChallansQuery } from '../../store/api/dispatchControlApi';
import { useGetPartiesQuery } from '../../store/api/partyApi';
import DispatchEntry from './DispatchEntry';
import { resolveFileUrl } from '../../utils/fileUrl';
import { O2D } from '../o2d-fms/o2dTheme';

const STATUS_OPTS = ['CREATED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];
// Stable empty array so the DataGrid never sees a fresh `rows` reference while the
// challans query is still loading (a new [] each render can spin the grid).
const EMPTY_ROWS = [];

const STATUS_COLOR = (theme, value) => ({
  CREATED:    theme.palette.info.main,
  DISPATCHED: theme.palette.primary.main,
  DELIVERED:  theme.palette.success.main,
  CANCELLED:  theme.palette.error.main,
}[value] || theme.palette.text.secondary);

const StatusBadge = ({ value }) => {
  const theme = useTheme();
  const color = STATUS_COLOR(theme, value);
  return (
    <Box sx={{
      px: 1.25, py: 0.4, borderRadius: '8px',
      bgcolor: alpha(color, 0.08), color, fontSize: '0.65rem', fontWeight: 800,
      textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 0.5,
    }}>
      {value || 'CREATED'}
    </Box>
  );
};

const ChallansList = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  // Deep-link support: ?so=AGL/SO-… (from an FMS task) pre-filters to that order.
  const soParam = searchParams.get('so') || '';
  // Came from an FMS "Do it now" (ACTUAL_DISPATCH) → auto-open the dispatch entry
  // pre-selected to that SO, so the doer only fills the loadout.
  const cameFromTask = !!(searchParams.get('fromTask') && searchParams.get('fromStep'));
  const [searchTerm, setSearchTerm] = useState(soParam);
  const [status, setStatus] = useState('');
  const [party, setParty] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [entryOpen, setEntryOpen] = useState(false);
  const resetPage = () => setPaginationModel((p) => ({ ...p, page: 0 }));

  useEffect(() => {
    if (cameFromTask && soParam) setEntryOpen(true);
  }, [cameFromTask, soParam]);

  const { data: partiesRes } = useGetPartiesQuery({ limit: 500 });
  const parties = partiesRes?.data || [];

  const activeFilters = (status ? 1 : 0) + (party ? 1 : 0) + (from || to ? 1 : 0) + (searchTerm ? 1 : 0);
  const clearAll = () => { setSearchTerm(''); setStatus(''); setParty(''); setFrom(''); setTo(''); resetPage(); };

  const { data: challansRes, isLoading } = useGetChallansQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: searchTerm || undefined,
    status: status || undefined,
    partyName: party || undefined,
    ...(from ? { 'dcDate[gte]': from } : {}),
    ...(to ? { 'dcDate[lte]': to } : {}),
    sort: '-dcDate',
  });

  const columns = useMemo(() => [
    {
      field: 'dcNumber', headerName: 'DC #', width: 160,
      renderCell: (p) => (
        <Typography variant="body2" fontWeight={800} color="primary.main">{p.value}</Typography>
      ),
    },
    { field: 'soNumber', headerName: 'SO #', width: 150, renderCell: (p) => <Typography variant="body2" fontWeight={700}>{p.value}</Typography> },
    { field: 'partyName', headerName: 'Customer', flex: 1, minWidth: 200, renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value}</Typography> },
    {
      field: 'phaseRef', headerName: 'Phase', width: 110,
      renderCell: (p) => {
        if (p.row.isUnplanned) {
          return (
            <Chip
              size="small"
              icon={<AlertTriangle size={11} />}
              label="Unplanned"
              sx={{ height: 22, fontSize: '0.65rem', bgcolor: alpha(theme.palette.warning.main, 0.10), color: 'warning.main', fontWeight: 700 }}
            />
          );
        }
        const phaseNo = p.value?.phaseNo;
        return phaseNo
          ? <Chip size="small" icon={<CheckCircle2 size={11} />} label={phaseNo} sx={{ height: 22, fontSize: '0.7rem', bgcolor: alpha(theme.palette.success.main, 0.10), color: 'success.main', fontWeight: 700 }} />
          : <Typography variant="caption" color="text.secondary">—</Typography>;
      },
    },
    {
      field: 'dcDate', headerName: 'Date', width: 120,
      renderCell: (p) => <Typography variant="body2" color="text.secondary">{dayjs(p.value).format('DD MMM YYYY')}</Typography>,
    },
    {
      field: 'totalQuantityPcs', headerName: 'Qty', width: 105, type: 'number', align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }}>{Number(p.value || 0).toLocaleString('en-IN')}</Typography>,
    },
    { field: 'vehicleNo', headerName: 'Vehicle', width: 130 },
    { field: 'transporterName', headerName: 'Transporter', width: 170, renderCell: (p) => p.value || <Typography variant="caption" color="text.secondary">—</Typography> },
    { field: 'status', headerName: 'Status', width: 120, renderCell: (p) => <StatusBadge value={p.value} /> },
    {
      field: 'pdfUrl', headerName: '', width: 50, align: 'center', sortable: false,
      renderCell: (p) => p.value ? (
        <Tooltip title="Open document"><IconButton size="small" onClick={(e) => { e.stopPropagation(); window.open(resolveFileUrl(p.value), '_blank'); }}><ExternalLink size={13} /></IconButton></Tooltip>
      ) : null,
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [theme]);

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5, bgcolor: O2D.canvas, minHeight: '100vh' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
        <Box>
          <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, color: O2D.ink }}>
            Actual Dispatch
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.78rem' }}>
            Every dispatch is recorded against a plan phase — the link drives Plan vs Actual.
          </Typography>
        </Box>
        <Button variant="contained" disableElevation startIcon={<Plus size={14} />} onClick={() => setEntryOpen(true)}
          sx={{ whiteSpace: 'nowrap', fontWeight: 700, textTransform: 'none', borderRadius: '6px', bgcolor: O2D.brand }}>
          Record Dispatch
        </Button>
      </Stack>

      {/* ── Filters — everything on ONE line ── */}
      <Paper elevation={0} sx={{ p: 1, borderRadius: '8px', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField
            size="small" placeholder="Search DC / SO / party…" value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); resetPage(); }}
            sx={{ minWidth: 210, flex: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment> }}
          />
          <TextField select size="small" label="Status" value={status} onChange={(e) => { setStatus(e.target.value); resetPage(); }} sx={{ minWidth: 140 }}>
            <MenuItem value="">All statuses</MenuItem>
            {STATUS_OPTS.map((s) => <MenuItem key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Party" value={party} onChange={(e) => { setParty(e.target.value); resetPage(); }} sx={{ minWidth: 150, flex: 1 }}>
            <MenuItem value="">All parties</MenuItem>
            {parties.map((p) => <MenuItem key={p._id} value={p.name}>{p.name}</MenuItem>)}
          </TextField>
          <TextField size="small" type="date" label="From" value={from} onChange={(e) => { setFrom(e.target.value); resetPage(); }}
            InputLabelProps={{ shrink: true }} inputProps={{ max: to || undefined }} sx={{ width: 150 }} />
          <TextField size="small" type="date" label="To" value={to} onChange={(e) => { setTo(e.target.value); resetPage(); }}
            InputLabelProps={{ shrink: true }} inputProps={{ min: from || undefined }} sx={{ width: 150 }} />
          {activeFilters > 0 && (
            <Button size="small" color="inherit" startIcon={<X size={12} />} onClick={clearAll}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', flexShrink: 0 }}>
              Clear ({activeFilters})
            </Button>
          )}
        </Stack>
      </Paper>

      <Paper elevation={0} sx={{ borderRadius: '8px', overflow: 'hidden', border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1, borderBottom: `1px solid ${O2D.line}` }}>
          <Truck size={15} color={O2D.brand} />
          <Typography variant="subtitle2" fontWeight={800} sx={{ fontSize: '0.82rem' }}>Delivery Challans</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>
            · Each row shows its phase link (or Unplanned)
          </Typography>
        </Box>
        <DataGrid
          rows={challansRes?.data || EMPTY_ROWS}
          columns={columns}
          getRowId={(row) => row._id}
          loading={isLoading}
          paginationMode="server"
          rowCount={challansRes?.meta?.total || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          onRowClick={(p) => navigate(`/challans/${p.row._id}`)}
          rowHeight={48}
          columnHeaderHeight={42}
          sx={{
            border: 0,
            '& .MuiDataGrid-row': { cursor: 'pointer' },
            '& .MuiDataGrid-columnHeaders': { bgcolor: O2D.surfaceAlt, borderBottom: `1px solid ${O2D.line}` },
            '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: O2D.sub },
            '& .MuiDataGrid-cell': { borderColor: O2D.lineSoft },
            '& .MuiDataGrid-row:hover': { bgcolor: O2D.surfaceAlt },
            '& .MuiDataGrid-footerContainer': { borderTop: `1px solid ${O2D.line}`, bgcolor: O2D.surfaceAlt },
          }}
        />
      </Paper>

      <DispatchEntry open={entryOpen} onClose={() => setEntryOpen(false)} presetSoNumber={cameFromTask ? soParam : null} />
    </Box>
  );
};

export default ChallansList;
