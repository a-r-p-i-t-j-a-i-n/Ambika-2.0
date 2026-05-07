import React, { useState } from 'react';
import { Box, Typography, Paper, TextField, InputAdornment, Button } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, Plus } from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useGetSkusQuery } from '../../store/api/skuApi';

const SkusList = () => {
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchTerm, setSearchTerm] = useState('');

  const { data, isLoading } = useGetSkusQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: searchTerm || undefined,
  });

  const columns = [
    { field: 'code', headerName: 'SKU CODE', width: 170,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography>
    },
    { field: 'name', headerName: 'DESCRIPTION', flex: 1, minWidth: 250,
      renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value}</Typography>
    },
    { field: 'category', headerName: 'CATEGORY', width: 140,
      renderCell: (p) => (
        <Box sx={{ px: 1.5, py: 0.5, borderRadius: '8px', bgcolor: alpha('#7c3aed', 0.06), color: '#7c3aed', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>
          {p.value || 'General'}
        </Box>
      )
    },
    { field: 'pcsPerBox', headerName: 'PCS/BOX', width: 100, align: 'center', headerAlign: 'center',
      renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value || '-'}</Typography>
    },
    { field: 'weightPerPc', headerName: 'WEIGHT (KG)', width: 120, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value ? p.value.toFixed(3) : '-'}</Typography>
    },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: 2, sm: 3 }, minHeight: '100vh', bgcolor: '#f8fafc' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={800} color="text.primary" sx={{ fontSize: { xs: '1.5rem', sm: '2.125rem' } }}>SKU Master</Typography>
          <Typography variant="body2" color="text.secondary">Catalog of stock keeping units and packing norms</Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'center', gap: 1.5, width: { xs: '100%', md: 'auto' } }}>
          <TextField size="small" placeholder="Search SKUs..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ width: { xs: '100%', sm: 260 }, '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color="#94a3b8" /></InputAdornment> }}
          />
          <Button variant="contained" startIcon={<Plus size={16} />} sx={{ width: { xs: '100%', sm: 'auto' } }}>Add SKU</Button>
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
          pageSizeOptions={[10, 25, 50]}
          disableRowSelectionOnClick
          rowHeight={48}
          columnHeaderHeight={44}
          sx={{ border: 0 }}
        />
      </Paper>
    </Box>
  );
};

export default SkusList;
