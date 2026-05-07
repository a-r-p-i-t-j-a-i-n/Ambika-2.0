import React from 'react';
import { Box, Typography, Card, Chip, Button, Stack } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { useDispatch } from '../../hooks/DispatchContext';
import { useNavigate } from 'react-router-dom';

export default function OrdersList() {
  const { state } = useDispatch();
  const navigate = useNavigate();

  const columns = [
    { field: 'id', headerName: 'Order Ref', flex: 1, renderCell: (p) => <Typography fontWeight={700}>{p.value}</Typography> },
    { field: 'customer', headerName: 'Customer', flex: 1.5 },
    { field: 'item', headerName: 'Product', flex: 1 },
    { field: 'totalQty', headerName: 'Commitment', flex: 1, type: 'number', renderCell: (p) => p.value.toLocaleString() },
    { field: 'orderDate', headerName: 'Order Date', flex: 1 },
    { field: 'status', headerName: 'Status', flex: 0.8, renderCell: () => <Chip label="Active" size="small" color="success" variant="outlined" /> },
    { field: 'action', headerName: 'Actions', flex: 0.8, renderCell: (params) => <Button variant="contained" size="small" onClick={() => navigate(`/orders/${params.row.id}`)}>Execute</Button> }
  ];

  return (
    <Box>
      <Typography variant="h4" fontWeight={800} mb={0.5}>Execution Tracking</Typography>
      <Typography variant="body1" color="text.secondary" mb={3}>Full portfolio of active orders and logistics fulfillment</Typography>
      <Card sx={{ p: 0, overflow: 'hidden' }}>
        <Box sx={{ height: 500, width: '100%' }}>
          <DataGrid rows={state.orders} columns={columns} disableRowSelectionOnClick sx={{ border: 'none' }} />
        </Box>
      </Card>
    </Box>
  );
}