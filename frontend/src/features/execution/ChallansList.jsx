import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, Paper, Stack, Typography, Button, TextField, InputAdornment, IconButton,
  Chip, Tooltip, alpha, useTheme,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Plus, Search, Truck, ExternalLink, AlertTriangle, CheckCircle2 } from 'lucide-react';
import dayjs from 'dayjs';
import { useGetChallansQuery } from '../../store/api/dispatchControlApi';
import DispatchEntry from './DispatchEntry';
import { resolveFileUrl } from '../../utils/fileUrl';

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
  const [searchTerm, setSearchTerm] = useState(searchParams.get('so') || '');
  const [entryOpen, setEntryOpen] = useState(false);

  const { data: challansRes, isLoading } = useGetChallansQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: searchTerm || undefined,
    sort: '-dcDate',
  });

  const columns = [
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
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
        <Box>
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: 'text.primary', letterSpacing: '-0.015em' }}>
            Actual Dispatch
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Every dispatch is recorded against a plan phase — the link drives Plan vs Actual.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5} sx={{ width: { xs: '100%', sm: 'auto' } }}>
          <TextField
            size="small"
            placeholder="Search DC, SO or party..."
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setPaginationModel((p) => ({ ...p, page: 0 })); }}
            sx={{ width: { xs: '100%', sm: 280 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment> }}
          />
          <Button variant="contained" startIcon={<Plus size={14} />} onClick={() => setEntryOpen(true)} sx={{ whiteSpace: 'nowrap' }}>
            Record Dispatch
          </Button>
        </Stack>
      </Stack>

      <Paper sx={{ borderRadius: '14px', overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Truck size={16} color={theme.palette.primary.main} />
          <Typography variant="subtitle1" fontWeight={800}>Delivery Challans</Typography>
          <Typography variant="caption" color="text.secondary">
            · Each row shows its phase link (or Unplanned)
          </Typography>
        </Box>
        <DataGrid
          rows={challansRes?.data || []}
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
          sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }}
        />
      </Paper>

      <DispatchEntry open={entryOpen} onClose={() => setEntryOpen(false)} />
    </Box>
  );
};

export default ChallansList;
