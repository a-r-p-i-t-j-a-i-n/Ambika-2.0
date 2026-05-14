import React, { useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Plus, Save, Trash2, TrendingUp } from 'lucide-react';
import dayjs from 'dayjs';
import { useSnackbar } from 'notistack';
import { useGetOrdersQuery } from '../../store/api/orderApi';
import { useCreateDispatchPlanMutation, useGetOrderComparisonQuery } from '../../store/api/dispatchControlApi';

const BRAND = { primary: '#1d4ed8', success: '#0f766e', warning: '#b45309', error: '#be123c', ink: '#0b2545' };

const emptyPlanLine = () => ({
  _tempId: Date.now() + Math.random(),
  orderItemId: '',
  skuCode: '',
  skuName: '',
  phaseNo: 'P1',
  plannedDate: dayjs().format('YYYY-MM-DD'),
  plannedQty: '',
});

const Metric = ({ label, value, color = BRAND.ink }) => (
  <Paper sx={{ p: 1.5, borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: 'none', minWidth: 130 }}>
    <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{label}</Typography>
    <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color }}>{value}</Typography>
  </Paper>
);

export default function PlanCreation() {
  const { enqueueSnackbar } = useSnackbar();
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [lines, setLines] = useState([emptyPlanLine()]);
  const [allowOverPlan, setAllowOverPlan] = useState(false);

  const { data: ordersRes, isLoading: ordersLoading } = useGetOrdersQuery({ limit: 250, sort: '-orderDate' });
  const [createDispatchPlan, { isLoading: isSaving }] = useCreateDispatchPlanMutation();
  const { data: comparisonRes, isFetching: isComparisonLoading } = useGetOrderComparisonQuery(selectedOrder?.soNumber, {
    skip: !selectedOrder?.soNumber,
  });

  const orders = ordersRes?.data || [];
  const orderItems = selectedOrder?.items || [];
  const comparison = comparisonRes?.data;

  const planTotal = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.plannedQty) || 0), 0), [lines]);

  const updateLine = (index, patch) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const handleSkuChange = (index, item) => {
    updateLine(index, {
      orderItemId: item?._id || '',
      skuCode: item?.skuCode || '',
      skuName: item?.skuName || '',
    });
  };

  const addLine = () => setLines((prev) => [...prev, emptyPlanLine()]);
  const removeLine = (index) => setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));

  const handleSave = async () => {
    if (!selectedOrder?.soNumber) return enqueueSnackbar('Select a sales order', { variant: 'warning' });

    const planLines = lines
      .filter((line) => line.skuCode && line.plannedDate && Number(line.plannedQty) > 0)
      .map(({ _tempId, ...line }) => ({ ...line, plannedQty: Number(line.plannedQty) }));

    if (!planLines.length) return enqueueSnackbar('Add at least one valid dispatch plan line', { variant: 'warning' });

    try {
      await createDispatchPlan({ soNumber: selectedOrder.soNumber, allowOverPlan, planLines }).unwrap();
      enqueueSnackbar('Dispatch plan saved', { variant: 'success' });
      setLines([emptyPlanLine()]);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to save dispatch plan', { variant: 'error' });
    }
  };

  const comparisonColumns = [
    { field: 'skuCode', headerName: 'SKU Code', width: 130, renderCell: (p) => <Typography fontWeight={700} color="primary.main" variant="body2">{p.value}</Typography> },
    { field: 'skuName', headerName: 'SKU Name', flex: 1, minWidth: 180, renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value}</Typography> },
    { field: 'orderQty', headerName: 'Order', width: 105, type: 'number', valueFormatter: (v) => Number(v || 0).toLocaleString('en-IN') },
    { field: 'plannedQty', headerName: 'Planned', width: 105, type: 'number', valueFormatter: (v) => Number(v || 0).toLocaleString('en-IN') },
    { field: 'actualQty', headerName: 'Actual', width: 105, type: 'number', valueFormatter: (v) => Number(v || 0).toLocaleString('en-IN') },
    { field: 'balanceQty', headerName: 'Balance', width: 105, type: 'number', valueFormatter: (v) => Number(v || 0).toLocaleString('en-IN') },
    { field: 'carryForwardSuggestionQty', headerName: 'Next Plan', width: 110, type: 'number', valueFormatter: (v) => Number(v || 0).toLocaleString('en-IN') },
    {
      field: 'risk',
      headerName: 'Risk',
      width: 130,
      sortable: false,
      renderCell: (p) => {
        const count = p.row.risks?.length || 0;
        const color = count ? BRAND.error : BRAND.success;
        return (
          <Box sx={{ px: 1, py: 0.4, borderRadius: '8px', bgcolor: alpha(color, 0.08), color, fontSize: '0.72rem', fontWeight: 800 }}>
            {count ? `${count} Alert${count > 1 ? 's' : ''}` : 'Clear'}
          </Box>
        );
      },
    },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: 2, sm: 3 }, minHeight: '100vh', bgcolor: '#f8fafc' }}>
      <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', md: 'center' }, justifyContent: 'space-between', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box>
          <Typography sx={{ fontSize: { xs: '1.15rem', sm: '1.25rem' }, fontWeight: 700, color: '#0b2545', letterSpacing: '-0.015em', lineHeight: 1.25 }}>Dispatch Planning</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', fontWeight: 500, mt: 0.25 }}>Plan quantity by SO, SKU, phase and date</Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ width: { xs: '100%', md: 'auto' } }}>
          <Metric label="Plan Qty" value={planTotal.toLocaleString('en-IN')} color={BRAND.primary} />
          <Metric label="Balance" value={(comparison?.totals?.balanceQty || selectedOrder?.totalBalanceQty || 0).toLocaleString('en-IN')} color={BRAND.error} />
          <Metric label="Achievement" value={`${comparison?.totals?.planAchievementPct || 0}%`} color={BRAND.success} />
        </Stack>
      </Box>

      <Paper sx={{ borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: 'none', overflow: 'hidden' }}>
        <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 420px) 1fr auto' }, gap: 1.5, alignItems: 'center' }}>
          <Autocomplete
            options={orders}
            loading={ordersLoading}
            getOptionLabel={(order) => order ? `${order.soNumber} - ${order.partyName || ''}` : ''}
            value={selectedOrder}
            onChange={(_, order) => {
              setSelectedOrder(order);
              setLines([emptyPlanLine()]);
            }}
            isOptionEqualToValue={(opt, val) => opt._id === val?._id}
            renderInput={(params) => <TextField {...params} label="Sales Order" size="small" />}
          />
          <TextField
            select
            size="small"
            label="Planning Rule"
            value={allowOverPlan ? 'allow' : 'strict'}
            onChange={(e) => setAllowOverPlan(e.target.value === 'allow')}
          >
            <MenuItem value="strict">Do not allow over-plan</MenuItem>
            <MenuItem value="allow">Allow over-plan</MenuItem>
          </TextField>
          <Button variant="contained" startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} onClick={handleSave} disabled={isSaving}>
            Save Plan
          </Button>
        </Box>
        <Divider />

        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {lines.map((line, index) => (
            <Box key={line._tempId} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 0.8fr 1fr 1fr auto' }, gap: 1, alignItems: 'center' }}>
              <Autocomplete
                options={orderItems}
                disabled={!selectedOrder}
                getOptionLabel={(item) => item ? `${item.skuName} (${item.skuCode})` : ''}
                value={orderItems.find((item) => item._id === line.orderItemId) || null}
                onChange={(_, item) => handleSkuChange(index, item)}
                isOptionEqualToValue={(opt, val) => opt._id === val?._id}
                renderInput={(params) => <TextField {...params} label="SKU Line" size="small" />}
              />
              <TextField
                select
                label="Phase"
                size="small"
                value={line.phaseNo}
                onChange={(e) => updateLine(index, { phaseNo: e.target.value })}
              >
                {Array.from({ length: 10 }).map((_, i) => <MenuItem key={i + 1} value={`P${i + 1}`}>Dispatch Plan {i + 1}</MenuItem>)}
              </TextField>
              <TextField
                label="Plan Date"
                size="small"
                type="date"
                value={line.plannedDate}
                onChange={(e) => updateLine(index, { plannedDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Plan Qty"
                size="small"
                type="number"
                value={line.plannedQty}
                onChange={(e) => updateLine(index, { plannedQty: e.target.value })}
              />
              <Stack direction="row" spacing={0.5}>
                <Tooltip title="Add line"><IconButton onClick={addLine} sx={{ color: BRAND.primary }}><Plus size={18} /></IconButton></Tooltip>
                <Tooltip title="Remove line"><span><IconButton onClick={() => removeLine(index)} disabled={lines.length === 1} sx={{ color: BRAND.error }}><Trash2 size={18} /></IconButton></span></Tooltip>
              </Stack>
            </Box>
          ))}
        </Box>
      </Paper>

      <Paper sx={{ borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: 'none', overflow: 'hidden' }}>
        <Box sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
          <TrendingUp size={18} color={BRAND.primary} />
          <Typography variant="h6" fontWeight={800}>Plan vs Actual</Typography>
        </Box>
        <DataGrid
          rows={comparison?.rows || []}
          columns={comparisonColumns}
          getRowId={(row) => row.orderItemId || row.skuCode}
          loading={isComparisonLoading}
          disableRowSelectionOnClick
          autoHeight
          rowHeight={46}
          columnHeaderHeight={42}
          sx={{ border: 0 }}
        />
      </Paper>
    </Box>
  );
}
