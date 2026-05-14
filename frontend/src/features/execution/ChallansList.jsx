import React, { useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Plus, Save, Search, Trash2, Truck } from 'lucide-react';
import { useSnackbar } from 'notistack';
import dayjs from 'dayjs';
import { useGetOrdersQuery } from '../../store/api/orderApi';
import { useCreateActualDispatchMutation, useGetChallansQuery, useGetOrderComparisonQuery } from '../../store/api/dispatchControlApi';

const BRAND = { primary: '#2563eb', success: '#059669', warning: '#d97706', error: '#dc2626', info: '#0891b2' };
const TRANSPORT_OPTIONS = ['Road', 'Rail', 'Air', 'Sea', 'Courier'];

const emptyDispatchLine = () => ({
  _tempId: Date.now() + Math.random(),
  orderItemId: '',
  skuCode: '',
  skuName: '',
  quantityPcs: '',
  noOfBoxes: '',
  pcsPerBox: '',
  weightKg: '',
});

const StatusBadge = ({ value }) => {
  const map = { CREATED: BRAND.info, DISPATCHED: BRAND.primary, DELIVERED: BRAND.success, CANCELLED: BRAND.error };
  const color = map[value] || '#64748b';
  return (
    <Box sx={{ px: 1.2, py: 0.45, borderRadius: '8px', bgcolor: alpha(color, 0.08), color, fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase' }}>
      {value || 'CREATED'}
    </Box>
  );
};

export default function ChallansList() {
  const { enqueueSnackbar } = useSnackbar();
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [header, setHeader] = useState({
    dcDate: dayjs().format('YYYY-MM-DD'),
    vehicleNo: '',
    transportMode: 'Road',
    transporterName: '',
    clientEmail: '',
    invoiceNo: '',
    deliveryAddress: '',
    pdfUrl: '',
  });
  const [lines, setLines] = useState([emptyDispatchLine()]);

  const { data: ordersRes, isLoading: ordersLoading } = useGetOrdersQuery({ limit: 250, sort: '-orderDate', status: 'RECEIVED,PLANNING,IN_PROGRESS' });
  const { data: challansRes, isLoading: challansLoading } = useGetChallansQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: searchTerm || undefined,
    sort: '-dcDate',
  });
  const { data: comparisonRes } = useGetOrderComparisonQuery(selectedOrder?.soNumber, { skip: !selectedOrder?.soNumber });
  const [createActualDispatch, { isLoading: isSaving }] = useCreateActualDispatchMutation();

  const orders = ordersRes?.data || [];
  const orderItems = selectedOrder?.items || [];
  const comparisonRows = comparisonRes?.data?.rows || [];
  const dispatchTotal = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.quantityPcs) || 0), 0), [lines]);

  const updateHeader = (field, value) => setHeader((prev) => ({ ...prev, [field]: value }));
  const updateLine = (index, patch) => setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const handleOrderChange = (_, order) => {
    setSelectedOrder(order);
    setLines([emptyDispatchLine()]);
    setHeader((prev) => ({ ...prev, clientEmail: order?.partyId?.email || '' }));
  };

  const handleSkuChange = (index, item) => {
    const comparison = comparisonRows.find((row) => row.skuCode === item?.skuCode);
    updateLine(index, {
      orderItemId: item?._id || '',
      skuCode: item?.skuCode || '',
      skuName: item?.skuName || '',
      quantityPcs: comparison?.carryForwardSuggestionQty || '',
      pcsPerBox: item?.skuId?.pcsPerBox || '',
    });
  };

  const addLine = () => setLines((prev) => [...prev, emptyDispatchLine()]);
  const removeLine = (index) => setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));

  const handleSave = async () => {
    if (!selectedOrder?.soNumber) return enqueueSnackbar('Select a sales order', { variant: 'warning' });

    const items = lines
      .filter((line) => line.skuCode && Number(line.quantityPcs) > 0)
      .map(({ _tempId, ...line }) => ({
        ...line,
        quantityPcs: Number(line.quantityPcs),
        noOfBoxes: line.noOfBoxes ? Number(line.noOfBoxes) : undefined,
        pcsPerBox: line.pcsPerBox ? Number(line.pcsPerBox) : undefined,
        weightKg: line.weightKg ? Number(line.weightKg) : undefined,
      }));

    if (!items.length) return enqueueSnackbar('Add at least one dispatch item', { variant: 'warning' });

    try {
      await createActualDispatch({
        soNumber: selectedOrder.soNumber,
        ...header,
        dcDate: new Date(header.dcDate),
        items,
      }).unwrap();
      enqueueSnackbar('Actual dispatch saved and challan created', { variant: 'success' });
      setLines([emptyDispatchLine()]);
      setHeader((prev) => ({ ...prev, vehicleNo: '', invoiceNo: '', pdfUrl: '' }));
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to save actual dispatch', { variant: 'error' });
    }
  };

  const columns = [
    { field: 'dcNumber', headerName: 'DC #', width: 150, renderCell: (p) => <Typography variant="body2" fontWeight={800} color="primary.main">{p.value}</Typography> },
    { field: 'soNumber', headerName: 'SO #', width: 145, renderCell: (p) => <Typography variant="body2" fontWeight={700}>{p.value}</Typography> },
    { field: 'partyName', headerName: 'Customer', flex: 1, minWidth: 190, renderCell: (p) => <Typography variant="body2" fontWeight={600} noWrap>{p.value}</Typography> },
    { field: 'dcDate', headerName: 'Date', width: 115, renderCell: (p) => <Typography variant="body2">{dayjs(p.value).format('DD MMM YYYY')}</Typography> },
    { field: 'totalQuantityPcs', headerName: 'Qty', width: 100, type: 'number', renderCell: (p) => <Typography variant="body2" fontWeight={800}>{Number(p.value || 0).toLocaleString('en-IN')}</Typography> },
    { field: 'vehicleNo', headerName: 'Vehicle', width: 130, renderCell: (p) => <Typography variant="body2" fontWeight={600}>{p.value || '-'}</Typography> },
    { field: 'transporterName', headerName: 'Transporter', width: 170, renderCell: (p) => <Typography variant="body2" noWrap>{p.value || '-'}</Typography> },
    { field: 'status', headerName: 'Status', width: 125, renderCell: (p) => <StatusBadge value={p.value} /> },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: 2, sm: 3 }, minHeight: '100vh', bgcolor: '#f8fafc' }}>
      <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', md: 'center' }, justifyContent: 'space-between', gap: 2, flexDirection: { xs: 'column', md: 'row' } }}>
        <Box>
          <Typography sx={{ fontSize: { xs: '1.15rem', sm: '1.25rem' }, fontWeight: 700, color: '#0b2545', letterSpacing: '-0.015em', lineHeight: 1.25 }}>Actual Dispatch</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', fontWeight: 500, mt: 0.25 }}>Delivery challan entry and dispatched quantity posting</Typography>
        </Box>
        <Paper sx={{ p: 1.5, borderRadius: '10px', border: '1px solid #e2e8f0', boxShadow: 'none', minWidth: 180 }}>
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Dispatch Qty</Typography>
          <Typography sx={{ fontSize: '1.4rem', fontWeight: 900, color: BRAND.primary }}>{dispatchTotal.toLocaleString('en-IN')}</Typography>
        </Paper>
      </Box>

      <Paper sx={{ borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: 'none', overflow: 'hidden' }}>
        <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr 1fr 1fr' }, gap: 1.5 }}>
          <Autocomplete
            options={orders}
            loading={ordersLoading}
            value={selectedOrder}
            onChange={handleOrderChange}
            getOptionLabel={(order) => order ? `${order.soNumber} - ${order.partyName || ''}` : ''}
            isOptionEqualToValue={(opt, val) => opt._id === val?._id}
            renderInput={(params) => <TextField {...params} size="small" label="Sales Order" />}
          />
          <TextField size="small" type="date" label="Challan Date" value={header.dcDate} onChange={(e) => updateHeader('dcDate', e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField size="small" label="Vehicle No" value={header.vehicleNo} onChange={(e) => updateHeader('vehicleNo', e.target.value.toUpperCase())} />
          <TextField size="small" select label="Mode" value={header.transportMode} onChange={(e) => updateHeader('transportMode', e.target.value)}>
            {TRANSPORT_OPTIONS.map((mode) => <MenuItem key={mode} value={mode}>{mode}</MenuItem>)}
          </TextField>
          <TextField size="small" label="Transporter" value={header.transporterName} onChange={(e) => updateHeader('transporterName', e.target.value)} />
          <TextField size="small" label="Client Email" value={header.clientEmail} onChange={(e) => updateHeader('clientEmail', e.target.value)} />
          <TextField size="small" label="Invoice No" value={header.invoiceNo} onChange={(e) => updateHeader('invoiceNo', e.target.value)} />
          <TextField size="small" label="PDF Link" value={header.pdfUrl} onChange={(e) => updateHeader('pdfUrl', e.target.value)} />
          <TextField size="small" label="Delivery Address" value={header.deliveryAddress} onChange={(e) => updateHeader('deliveryAddress', e.target.value)} sx={{ gridColumn: { xs: 'auto', md: 'span 4' } }} />
        </Box>
        <Divider />

        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {lines.map((line, index) => (
            <Box key={line._tempId} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr 1fr 1fr 1fr auto' }, gap: 1, alignItems: 'center' }}>
              <Autocomplete
                options={orderItems}
                disabled={!selectedOrder}
                value={orderItems.find((item) => item._id === line.orderItemId) || null}
                onChange={(_, item) => handleSkuChange(index, item)}
                getOptionLabel={(item) => item ? `${item.skuName} (${item.skuCode})` : ''}
                isOptionEqualToValue={(opt, val) => opt._id === val?._id}
                renderInput={(params) => <TextField {...params} label="SKU Line" size="small" />}
              />
              <TextField size="small" label="Qty Pcs" type="number" value={line.quantityPcs} onChange={(e) => updateLine(index, { quantityPcs: e.target.value })} />
              <TextField size="small" label="Boxes" type="number" value={line.noOfBoxes} onChange={(e) => updateLine(index, { noOfBoxes: e.target.value })} />
              <TextField size="small" label="Pcs/Box" type="number" value={line.pcsPerBox} onChange={(e) => updateLine(index, { pcsPerBox: e.target.value })} />
              <TextField size="small" label="Weight Kg" type="number" value={line.weightKg} onChange={(e) => updateLine(index, { weightKg: e.target.value })} />
              <Stack direction="row" spacing={0.5}>
                <Tooltip title="Add line"><IconButton onClick={addLine} sx={{ color: BRAND.primary }}><Plus size={18} /></IconButton></Tooltip>
                <Tooltip title="Remove line"><span><IconButton onClick={() => removeLine(index)} disabled={lines.length === 1} sx={{ color: BRAND.error }}><Trash2 size={18} /></IconButton></span></Tooltip>
              </Stack>
            </Box>
          ))}
        </Box>

        <Box sx={{ p: 2, borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} onClick={handleSave} disabled={isSaving}>
            Save Dispatch
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: 'none', overflow: 'hidden' }}>
        <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: { xs: 'stretch', md: 'center' }, gap: 1.5, flexDirection: { xs: 'column', md: 'row' } }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Truck size={18} color={BRAND.primary} />
            <Typography variant="h6" fontWeight={800}>Delivery Challans</Typography>
          </Stack>
          <TextField
            size="small"
            placeholder="Search challans"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ width: { xs: '100%', md: 280 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color="#94a3b8" /></InputAdornment> }}
          />
        </Box>
        <DataGrid
          rows={challansRes?.data || []}
          columns={columns}
          getRowId={(row) => row._id}
          loading={challansLoading}
          paginationMode="server"
          rowCount={challansRes?.meta?.total || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          rowHeight={48}
          columnHeaderHeight={42}
          sx={{ border: 0 }}
        />
      </Paper>
    </Box>
  );
}
