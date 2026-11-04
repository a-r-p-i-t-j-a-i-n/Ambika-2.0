import React, { useState } from 'react';
import { Box, Typography, Card, TextField, MenuItem, Grid, IconButton, Tooltip, Chip } from '@mui/material';
import { DataGrid, GridToolbar } from '@mui/x-data-grid';
import { useDispatch } from '../../hooks/DispatchContext';
import dayjs from 'dayjs';
import { Download } from 'lucide-react';
import { exportToExcel, exportToPDF } from '../../utils/exportUtils';

export default function DispatchLedger() {
  const { getLedger, state } = useDispatch();
  const fullLedger = getLedger();
  const [orderFilter, setOrderFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  const filtered = fullLedger.filter(row => {
    if (orderFilter !== 'ALL' && row.orderId !== orderFilter) return false;
    if (statusFilter !== 'ALL' && row.status !== statusFilter) return false;
    return true;
  });

  const columns = [
    { field: 'date', headerName: 'Schedule Date', width: 120, renderCell: (p) => dayjs(p.value).format('DD MMM YY') },
    { field: 'orderId', headerName: 'Order Ref', width: 110 },
    { field: 'plannedQty', headerName: 'Planned', width: 100, type: 'number', renderCell: (p) => p.value.toLocaleString() },
    { field: 'inheritedCarry', headerName: 'Rollover', width: 100, renderCell: (p) => p.value > 0 ? `+${p.value.toLocaleString()}` : '-' },
    { field: 'expectedTotal', headerName: 'Target', width: 110, type: 'number', renderCell: (p) => p.value.toLocaleString() },
    { field: 'actualQty', headerName: 'Actual', width: 100, renderCell: (p) => p.value > 0 ? p.value.toLocaleString() : '-' },
    { field: 'referenceNumber', headerName: 'Challan #', width: 130 },
    { field: 'status', headerName: 'Status', width: 100, renderCell: (p) => <Chip label={p.value} size="small" color={p.row.statusColor} /> },
  ];

  const handleExportExcel = () => {
    const exportData = filtered.map(r => ({ 'Date': dayjs(r.date).format('YYYY-MM-DD'), 'Order': r.orderId, 'Planned': r.plannedQty, 'Rollover': r.inheritedCarry, 'Target': r.expectedTotal, 'Actual': r.actualQty, 'Ref#': r.referenceNumber, 'Status': r.status }));
    exportToExcel(exportData, 'dispatch_ledger');
  };

  const handleExportPDF = async () => {
    const exportData = filtered.map(r => ({ date: dayjs(r.date).format('YYYY-MM-DD'), orderId: r.orderId, plannedQty: r.plannedQty, expectedTotal: r.expectedTotal, actualQty: r.actualQty, status: r.status }));
    await exportToPDF(exportData, 'Dispatch_Ledger', columns);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box><Typography variant="h4" fontWeight={800}>Dispatch Ledger</Typography><Typography variant="body1" color="text.secondary">Archival log of all planned and executed shipment cycles</Typography></Box>
        <Box><Tooltip title="Export Excel"><IconButton onClick={handleExportExcel}><Download /></IconButton></Tooltip><Tooltip title="Export PDF"><IconButton onClick={handleExportPDF}><Download /></IconButton></Tooltip></Box>
      </Box>
      <Card sx={{ p: 2 }}>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={4}><TextField select fullWidth label="Order" value={orderFilter} onChange={(e) => setOrderFilter(e.target.value)}><MenuItem value="ALL">All Orders</MenuItem>{state.orders.map(o => <MenuItem key={o.id} value={o.id}>{o.id}</MenuItem>)}</TextField></Grid>
          <Grid item xs={12} md={4}><TextField select fullWidth label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><MenuItem value="ALL">All</MenuItem><MenuItem value="Pending">Pending</MenuItem><MenuItem value="WIP">WIP</MenuItem><MenuItem value="Done">Done</MenuItem><MenuItem value="Delayed">Delayed</MenuItem></TextField></Grid>
        </Grid>
        <Box sx={{ height: 500, width: '100%' }}>
          <DataGrid rows={filtered} columns={columns} getRowId={(row) => row.id} slots={{ toolbar: GridToolbar }} sx={{ border: 'none' }} />
        </Box>
      </Card>
    </Box>
  );
}