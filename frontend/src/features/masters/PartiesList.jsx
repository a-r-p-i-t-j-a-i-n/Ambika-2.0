import React, { useState } from 'react';
import { Box, Typography, Paper, TextField, InputAdornment, Button, IconButton, Tooltip } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, Plus, Pencil, Package } from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { useGetPartiesQuery } from '../../store/api/partyApi';
import PartyFormDrawer from './PartyFormDrawer';

const PartiesList = () => {
  const navigate = useNavigate();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchTerm, setSearchTerm] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editParty, setEditParty] = useState(null);

  const { data, isLoading } = useGetPartiesQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: searchTerm || undefined,
  });

  const openCreate = () => { setEditParty(null); setDrawerOpen(true); };
  const openEdit = (party) => { setEditParty(party); setDrawerOpen(true); };

  const columns = [
    { field: 'code', headerName: 'CODE', width: 140,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography>
    },
    { field: 'name', headerName: 'PARTY NAME', flex: 1, minWidth: 250,
      renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value}</Typography>
    },
    { field: 'location', headerName: 'LOCATION', width: 180,
      renderCell: (p) => <Typography variant="body2" color="text.secondary" fontWeight={500}>{p.value || p.row.address || '-'}</Typography>
    },
    { field: 'creditPeriodDays', headerName: 'CREDIT PERIOD', width: 130, align: 'center', headerAlign: 'center',
      renderCell: (p) => (
        <Box sx={{ px: 1.5, py: 0.5, borderRadius: '8px', bgcolor: alpha('#2563eb', 0.06), color: '#2563eb', fontSize: '0.75rem', fontWeight: 700 }}>
          {p.value || 0} days
        </Box>
      )
    },
    { field: 'approxDays', headerName: 'APPROX DAYS', width: 130, align: 'center', headerAlign: 'center',
      renderCell: (p) => {
        const d = p.value || p.row.leadTimeDays || 0;
        return d ? (
          <Box sx={{ px: 1.5, py: 0.5, borderRadius: '8px', bgcolor: alpha('#7c3aed', 0.06), color: '#7c3aed', fontSize: '0.75rem', fontWeight: 700 }}>
            {d} days
          </Box>
        ) : <Typography variant="caption" color="text.disabled">—</Typography>;
      }
    },
    { field: 'orderedSkus', headerName: 'SKUs', width: 110, align: 'center', headerAlign: 'center', sortable: false,
      renderCell: (p) => {
        const ordered = Array.isArray(p.row.orderedSkus) ? p.row.orderedSkus.length : 0;
        const supplied = Array.isArray(p.row.suppliedProducts) ? p.row.suppliedProducts.length : 0;
        const n = ordered || supplied;
        return n > 0 ? (
          <Tooltip title={ordered ? `${ordered} ordered SKU(s)` : `${supplied} supplied product(s)`}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.5, borderRadius: '8px', bgcolor: alpha('#b45309', 0.08), color: '#b45309', fontSize: '0.72rem', fontWeight: 700 }}>
              <Package size={13} /> {n}
            </Box>
          </Tooltip>
        ) : <Typography variant="caption" color="text.disabled">—</Typography>;
      }
    },
    { field: '__actions', headerName: '', width: 70, align: 'center', headerAlign: 'center', sortable: false, filterable: false,
      renderCell: (p) => (
        <Tooltip title="Edit vendor / party">
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); openEdit(p.row); }}>
            <Pencil size={16} />
          </IconButton>
        </Tooltip>
      )
    },
  ];

  const handleRowClick = (params) => {
    navigate(`/parties/${params.id}`);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: 2, sm: 3 }, minHeight: '100vh', bgcolor: '#f8fafc' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: { xs: '1.15rem', sm: '1.25rem' }, fontWeight: 700, color: '#0b2545', letterSpacing: '-0.015em', lineHeight: 1.25 }}>Parties Master</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', fontWeight: 500, mt: 0.25 }}>Manage customer directory and credit terms</Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'center', gap: 1.5, width: { xs: '100%', md: 'auto' } }}>
          <TextField size="small" placeholder="Search parties..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ width: { xs: '100%', sm: 260 }, '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color="#94a3b8" /></InputAdornment> }}
          />
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={openCreate} sx={{ width: { xs: '100%', sm: 'auto' } }}>Add Party</Button>
        </Box>
      </Box>

      {/* Data Grid */}
      <Paper sx={{ flexGrow: 1, borderRadius: '16px', overflow: 'hidden' }}>
        <DataGrid
          rows={data?.data || []}
          columns={columns}
          getRowId={(row) => row._id}
          loading={isLoading}
          paginationMode="server"
          rowCount={data?.meta?.total || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          onRowClick={handleRowClick}
          pageSizeOptions={[10, 25, 50]}
          disableRowSelectionOnClick
          rowHeight={48}
          columnHeaderHeight={44}
          sx={{
            border: 0,
            '& .MuiDataGrid-row': { cursor: 'pointer' }
          }}
        />
      </Paper>

      <PartyFormDrawer
        open={drawerOpen}
        party={editParty}
        onClose={() => { setDrawerOpen(false); setEditParty(null); }}
      />
    </Box>
  );
};

export default PartiesList;
