import React, { useState } from 'react';
import { Box, Typography, Paper, IconButton, Tooltip, Button, TextField, InputAdornment } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, Plus, Eye, Printer } from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useGetShipmentsQuery } from '../../store/api/fmsApi';
import dayjs from 'dayjs';

const BRAND = { primary: '#2563eb', success: '#059669', warning: '#d97706', error: '#dc2626', info: '#0891b2' };

const StatusBadge = ({ value }) => {
  const map = { DISPATCHED: BRAND.info, IN_TRANSIT: BRAND.warning, DELIVERED: BRAND.success, CANCELLED: BRAND.error };
  const color = map[value] || '#64748b';
  return (
    <Box sx={{ px: 1.5, py: 0.5, borderRadius: '8px', bgcolor: alpha(color, 0.08), color, fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
      {value?.replace('_', ' ')}
    </Box>
  );
};

const ChallansList = () => {
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchTerm, setSearchTerm] = useState('');

  const { data, isLoading } = useGetShipmentsQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: searchTerm || undefined,
  });

  const columns = [
    { field: 'dcNumber', headerName: 'DC #', width: 150,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color="primary.main">{p.value}</Typography>
    },
    { field: 'partyName', headerName: 'CUSTOMER', flex: 1, minWidth: 180,
      renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value}</Typography>
    },
    { field: 'dispatchDate', headerName: 'DISPATCH DATE', width: 130,
      renderCell: (p) => <Typography variant="body2" color="text.secondary" fontWeight={500}>{dayjs(p.value).format('DD MMM YYYY')}</Typography>
    },
    { field: 'vehicleNumber', headerName: 'VEHICLE', width: 130,
      renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value || '-'}</Typography>
    },
    { field: 'transporterName', headerName: 'TRANSPORTER', width: 170,
      renderCell: (p) => <Typography variant="body2" fontWeight={500} noWrap>{p.value || '-'}</Typography>
    },
    { field: 'status', headerName: 'STATUS', width: 130,
      renderCell: (p) => <StatusBadge value={p.value} />
    },
    { field: 'actions', headerName: '', width: 80, sortable: false, align: 'center',
      renderCell: (p) => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title="View"><IconButton size="small" sx={{ color: BRAND.primary }}><Eye size={15} /></IconButton></Tooltip>
          <Tooltip title="Print"><IconButton size="small" sx={{ color: '#94a3b8' }}><Printer size={15} /></IconButton></Tooltip>
        </Box>
      )
    }
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: 2, sm: 3 }, minHeight: '100vh', bgcolor: '#f8fafc' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography variant="h4" fontWeight={800} color="text.primary" sx={{ fontSize: { xs: '1.5rem', sm: '2.125rem' } }}>Delivery Challans</Typography>
          <Typography variant="body2" color="text.secondary">Track and manage dispatch shipments</Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'center', gap: 1.5, width: { xs: '100%', md: 'auto' } }}>
          <TextField size="small" placeholder="Search challans..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ width: { xs: '100%', sm: 260 }, '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color="#94a3b8" /></InputAdornment> }}
          />
          <Button variant="contained" startIcon={<Plus size={16} />} sx={{ width: { xs: '100%', sm: 'auto' } }}>Create DC</Button>
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

export default ChallansList;
