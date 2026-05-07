import React, { useState } from 'react';
import { Box, Typography, Card, CardContent, Grid, TextField, Button, MenuItem, Stack, Divider, IconButton, Tooltip } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { useDispatch } from '../../hooks/DispatchContext';
import { useSnackbar } from 'notistack';
import { Plus, Download } from 'lucide-react';
import dayjs from 'dayjs';
import { exportToExcel, exportToPDF } from '../../utils/exportUtils';

export default function PlanCreation() {
  const { state, addPlan } = useDispatch();
  const { enqueueSnackbar } = useSnackbar();
  const [selectedOrder, setSelectedOrder] = useState('');
  const [planDate, setPlanDate] = useState('');
  const [plannedQty, setPlannedQty] = useState('');

  const order = state.orders.find(o => o.id === selectedOrder);
  const existingPlans = state.plans.filter(p => p.orderId === selectedOrder);
  const totalPlannedSoFar = existingPlans.reduce((sum, p) => sum + p.plannedQty, 0);
  const remainingToPlan = order ? order.totalQty - totalPlannedSoFar : 0;

  const handleAddPlan = () => {
    if (!selectedOrder || !planDate || !plannedQty) {
      enqueueSnackbar('Please fill all fields', { variant: 'error' });
      return;
    }
    const qty = Number(plannedQty);
    if (qty <= 0 || qty > remainingToPlan) {
      enqueueSnackbar(`Quantity must be between 1 and ${remainingToPlan}`, { variant: 'warning' });
      return;
    }
    addPlan(selectedOrder, planDate, qty);
    enqueueSnackbar('Plan created successfully', { variant: 'success' });
    setPlanDate('');
    setPlannedQty('');
  };

  const columns = [
    { field: 'date', headerName: 'Scheduled Date', flex: 1, renderCell: (p) => dayjs(p.value).format('DD MMM YYYY') },
    { field: 'plannedQty', headerName: 'Target Units', flex: 1, type: 'number', renderCell: (p) => p.value.toLocaleString() },
  ];

  const handleExportExcel = () => {
    const exportData = existingPlans.map(p => ({ 'Plan ID': p.id, 'Date': dayjs(p.date).format('YYYY-MM-DD'), 'Planned Qty': p.plannedQty }));
    exportToExcel(exportData, `plans_${selectedOrder || 'all'}`);
  };

  const handleExportPDF = async () => {
    const exportData = existingPlans.map(p => ({ id: p.id, date: dayjs(p.date).format('YYYY-MM-DD'), plannedQty: p.plannedQty }));
    const columns = [{ field: 'id', headerName: 'Plan ID' }, { field: 'date', headerName: 'Date' }, { field: 'plannedQty', headerName: 'Planned Qty' }];
    await exportToPDF(exportData, `Plans_${selectedOrder || 'all'}`, columns);
  };

  return (
    <Box>
      <Typography variant="h4" fontWeight={800} mb={0.5}>Dispatch Planning</Typography>
      <Typography variant="body1" color="text.secondary" mb={3}>Allocate future fulfillment capacity against master orders</Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <TextField select fullWidth label="Select Order" value={selectedOrder} onChange={(e) => setSelectedOrder(e.target.value)} sx={{ mb: 2 }}>
                {state.orders.map(o => <MenuItem key={o.id} value={o.id}>{o.id} - {o.customer}</MenuItem>)}
              </TextField>
              {order && (
                <Box sx={{ bgcolor: 'background.default', p: 2, borderRadius: 2, mb: 3 }}>
                  <Stack direction="row" justifyContent="space-between"><Typography variant="body2">Contract Qty:</Typography><Typography fontWeight={700}>{order.totalQty.toLocaleString()}</Typography></Stack>
                  <Divider sx={{ my: 1 }} />
                  <Stack direction="row" justifyContent="space-between"><Typography variant="body2" color="primary.main">Available:</Typography><Typography fontWeight={700} color="primary.main">{remainingToPlan.toLocaleString()}</Typography></Stack>
                </Box>
              )}
              <Stack spacing={2}>
                <TextField type="date" label="Plan Date" InputLabelProps={{ shrink: true }} value={planDate} onChange={(e) => setPlanDate(e.target.value)} disabled={!order || remainingToPlan <= 0} />
                <TextField type="number" label="Allocation Units" value={plannedQty} onChange={(e) => setPlannedQty(e.target.value)} disabled={!order || remainingToPlan <= 0} />
                <Button variant="contained" startIcon={<Plus size={16} />} onClick={handleAddPlan} disabled={!order || remainingToPlan <= 0}>Confirm Allocation</Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={8}>
          <Card>
            <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6" fontWeight={700}>Planned Schedules</Typography>
              <Stack direction="row" spacing={1}>
                <Tooltip title="Export Excel"><IconButton onClick={handleExportExcel} disabled={!selectedOrder}><Download size={18} /></IconButton></Tooltip>
                <Tooltip title="Export PDF"><IconButton onClick={handleExportPDF} disabled={!selectedOrder}><Download size={18} /></IconButton></Tooltip>
              </Stack>
            </Box>
            <Box sx={{ height: 400, width: '100%' }}>
              <DataGrid rows={existingPlans} columns={columns} getRowId={(row) => row.id} disableRowSelectionOnClick sx={{ border: 'none' }} />
            </Box>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}