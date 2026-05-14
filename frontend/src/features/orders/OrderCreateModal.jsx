import React, { useState, useEffect } from 'react';
import {
  Drawer, Box, Typography, IconButton, Divider, Button, TextField,
  MenuItem, Autocomplete, CircularProgress, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, InputAdornment
} from '@mui/material';
import { X, Plus, Trash2, Save, FileText, Package } from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useCreateOrderEntryMutation } from '../../store/api/dispatchControlApi';
import { useGetPartiesQuery } from '../../store/api/partyApi';
import { useGetSkuLookupQuery } from '../../store/api/skuApi';
import { useSnackbar } from 'notistack';
import dayjs from 'dayjs';

const BRAND = { primary: '#2563eb', success: '#059669', error: '#dc2626' };

const TRANSPORT_OPTIONS = ['Road', 'Rail', 'Air', 'Sea', 'Courier'];

const emptyItem = () => ({
  _tempId: Date.now() + Math.random(),
  skuId: '', skuName: '', skuCode: '', orderQty: '', asnCode: '', remark: '',
});

const OrderCreateModal = ({ open, onClose }) => {
  const [createOrderEntry, { isLoading: isCreating }] = useCreateOrderEntryMutation();
  const { data: partiesData } = useGetPartiesQuery({ limit: 200 });
  const { data: skusData } = useGetSkuLookupQuery({ limit: 1000 });
  const { enqueueSnackbar } = useSnackbar();

  const parties = partiesData?.data || [];
  const skus = skusData?.data || [];

  const [form, setForm] = useState({
    poDate: dayjs().format('YYYY-MM-DD'),
    poNumber: '',
    partyId: null,
    partyName: '',
    location: '',
    orderDate: dayjs().format('YYYY-MM-DD'),
    transport: 'Road',
    partyGroup: '',
    orderDocument: '',
    leadTimeDays: 7,
  });

  const [items, setItems] = useState([emptyItem()]);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setForm({
        poDate: dayjs().format('YYYY-MM-DD'),
        poNumber: '',
        partyId: null,
        partyName: '',
        location: '',
        orderDate: dayjs().format('YYYY-MM-DD'),
        transport: 'Road',
        partyGroup: '',
        orderDocument: '',
        leadTimeDays: 7,
      });
      setItems([emptyItem()]);
    }
  }, [open]);

  const handlePartyChange = (_, party) => {
    if (party) {
      setForm(prev => ({
        ...prev,
        partyId: party._id,
        partyName: party.name,
        location: party.location || '',
        leadTimeDays: party.leadTimeDays || 7,
      }));
    } else {
      setForm(prev => ({ ...prev, partyId: null, partyName: '', location: '' }));
    }
  };

  const handleSkuChange = (index, sku) => {
    const updated = [...items];
    if (sku) {
      updated[index] = { ...updated[index], skuId: sku._id, skuName: sku.name, skuCode: sku.code };
    } else {
      updated[index] = { ...updated[index], skuId: '', skuName: '', skuCode: '' };
    }
    setItems(updated);
  };

  const handleItemChange = (index, field, value) => {
    const updated = [...items];
    updated[index] = { ...updated[index], [field]: value };
    setItems(updated);
  };

  const addItem = () => setItems(prev => [...prev, emptyItem()]);

  const removeItem = (index) => {
    if (items.length === 1) return;
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const totalQty = items.reduce((sum, item) => sum + (parseInt(item.orderQty) || 0), 0);
  const validItems = items.filter(i => i.skuId && i.orderQty > 0);

  const handleSubmit = async () => {
    // Validation
    if (!form.poNumber.trim()) {
      return enqueueSnackbar('PO Number is required', { variant: 'warning' });
    }
    if (!form.partyId) {
      return enqueueSnackbar('Please select a Party', { variant: 'warning' });
    }
    if (validItems.length === 0) {
      return enqueueSnackbar('Add at least one SKU line item', { variant: 'warning' });
    }

    try {
      const payload = {
        ...form,
        orderDate: new Date(form.orderDate),
        poDate: form.poDate ? new Date(form.poDate) : null,
        items: validItems.map(({ _tempId, ...item }) => ({
          ...item,
          orderQty: parseInt(item.orderQty),
        })),
      };
      await createOrderEntry(payload).unwrap();
      enqueueSnackbar('Sales Order created successfully!', { variant: 'success' });
      onClose();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to create order', { variant: 'error' });
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} disableEnforceFocus
      PaperProps={{ sx: { width: { xs: '100%', md: 720 }, p: 0, display: 'flex', flexDirection: 'column' } }}>
      
      {/* ── Header ────────────────────────────────────────── */}
      <Box sx={{ p: 3, pb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ p: 1, borderRadius: '10px', bgcolor: alpha(BRAND.primary, 0.08) }}>
            <FileText size={20} color={BRAND.primary} />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={700} color="text.primary">New Sales Order</Typography>
            <Typography variant="caption" color="text.secondary">Order Booking Form — Auto SO# Generated</Typography>
          </Box>
        </Box>
        <IconButton onClick={onClose} size="small"><X size={20} /></IconButton>
      </Box>

      {/* ── Scrollable Form Body ──────────────────────────── */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3 }}>
        
        {/* ── Order Header Fields ─────────────────────────── */}
        <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ mb: 2, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>
          Order Information
        </Typography>
        
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mb: 3 }}>
          <TextField
            label="PO Number *" size="small" value={form.poNumber}
            onChange={(e) => setForm(prev => ({ ...prev, poNumber: e.target.value }))}
            placeholder="e.g. PODM02537/25-26"
          />
          <TextField
            label="PO Date" size="small" type="date" value={form.poDate}
            onChange={(e) => setForm(prev => ({ ...prev, poDate: e.target.value }))}
            InputLabelProps={{ shrink: true }}
          />
          <Autocomplete
            options={parties}
            getOptionLabel={(opt) => opt.name || ''}
            onChange={handlePartyChange}
            renderInput={(params) => <TextField {...params} label="Party Name *" size="small" placeholder="Search parties..." />}
            isOptionEqualToValue={(opt, val) => opt._id === val?._id}
            renderOption={(props, opt) => (
              <li {...props} key={opt._id}>
                <Box>
                  <Typography variant="body2" fontWeight={600}>{opt.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{opt.location} • {opt.code}</Typography>
                </Box>
              </li>
            )}
          />
          <TextField
            label="Order Date *" size="small" type="date" value={form.orderDate}
            onChange={(e) => setForm(prev => ({ ...prev, orderDate: e.target.value }))}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            label="Transport" size="small" select value={form.transport}
            onChange={(e) => setForm(prev => ({ ...prev, transport: e.target.value }))}>
            {TRANSPORT_OPTIONS.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </TextField>
          <TextField
            label="Location" size="small" value={form.location}
            onChange={(e) => setForm(prev => ({ ...prev, location: e.target.value }))}
            placeholder="Auto-filled from party"
          />
          <TextField
            label="Party Group" size="small" value={form.partyGroup}
            onChange={(e) => setForm(prev => ({ ...prev, partyGroup: e.target.value }))}
          />
          <TextField
            label="Lead Time (Days)" size="small" type="number" value={form.leadTimeDays}
            onChange={(e) => setForm(prev => ({ ...prev, leadTimeDays: parseInt(e.target.value) || 7 }))}
          />
        </Box>

        <TextField
          fullWidth label="PO Document Link" size="small" value={form.orderDocument}
          onChange={(e) => setForm(prev => ({ ...prev, orderDocument: e.target.value }))}
          placeholder="Paste Google Drive or document URL"
          sx={{ mb: 3 }}
          InputProps={{
            startAdornment: <InputAdornment position="start"><FileText size={16} color="#94a3b8" /></InputAdornment>,
          }}
        />

        <Divider sx={{ mb: 3 }} />

        {/* ── SKU Line Items ──────────────────────────────── */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Package size={16} color={BRAND.primary} />
            <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem' }}>
              SKU Line Items ({validItems.length})
            </Typography>
          </Box>
          <Button size="small" startIcon={<Plus size={14} />} onClick={addItem}
            sx={{ fontSize: '0.75rem', fontWeight: 700, color: BRAND.primary }}>
            Add Row
          </Button>
        </Box>

        <TableContainer component={Paper} sx={{ borderRadius: '12px', mb: 2, boxShadow: 'none', border: '1px solid #e2e8f0', overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 600 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: '#f8fafc' }}>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', color: '#475569' }}>SKU (Item Name)</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', color: '#475569', width: 100 }}>Code</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', color: '#475569', width: 90 }}>Qty *</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', color: '#475569', width: 110 }}>ASN/FCI</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', color: '#475569', width: 120 }}>Remark</TableCell>
                <TableCell sx={{ width: 40 }}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={item._tempId} sx={{ '&:hover': { bgcolor: '#fafbfc' } }}>
                  <TableCell sx={{ p: 1 }}>
                    <Autocomplete
                      options={skus}
                      getOptionLabel={(opt) => opt.name || ''}
                      onChange={(_, sku) => handleSkuChange(index, sku)}
                      value={skus.find(s => s._id === item.skuId) || null}
                      size="small"
                      renderInput={(params) => <TextField {...params} placeholder="Select SKU..." variant="standard" InputProps={{ ...params.InputProps, disableUnderline: true, sx: { fontSize: '0.8rem' } }} />}
                      isOptionEqualToValue={(opt, val) => opt._id === val?._id}
                      renderOption={(props, opt) => (
                        <li {...props} key={opt._id}>
                          <Box>
                            <Typography variant="body2" fontWeight={600} fontSize="0.8rem">{opt.name}</Typography>
                            <Typography variant="caption" color="text.secondary">{opt.code}</Typography>
                          </Box>
                        </li>
                      )}
                    />
                  </TableCell>
                  <TableCell sx={{ p: 1 }}>
                    <Typography variant="body2" color="text.secondary" fontSize="0.75rem" fontWeight={600}>
                      {item.skuCode || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ p: 1 }}>
                    <TextField
                      variant="standard" type="number" value={item.orderQty}
                      onChange={(e) => handleItemChange(index, 'orderQty', e.target.value)}
                      InputProps={{ disableUnderline: true, sx: { fontSize: '0.8rem', fontWeight: 700 } }}
                      placeholder="0"
                    />
                  </TableCell>
                  <TableCell sx={{ p: 1 }}>
                    <TextField
                      variant="standard" value={item.asnCode}
                      onChange={(e) => handleItemChange(index, 'asnCode', e.target.value)}
                      InputProps={{ disableUnderline: true, sx: { fontSize: '0.75rem' } }}
                      placeholder="—"
                    />
                  </TableCell>
                  <TableCell sx={{ p: 1 }}>
                    <TextField
                      variant="standard" value={item.remark}
                      onChange={(e) => handleItemChange(index, 'remark', e.target.value)}
                      InputProps={{ disableUnderline: true, sx: { fontSize: '0.75rem' } }}
                      placeholder="—"
                    />
                  </TableCell>
                  <TableCell sx={{ p: 0.5 }}>
                    <IconButton size="small" onClick={() => removeItem(index)} disabled={items.length === 1}
                      sx={{ color: '#94a3b8', '&:hover': { color: BRAND.error } }}>
                      <Trash2 size={14} />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {/* ── Summary Bar ─────────────────────────────────── */}
        <Box sx={{ 
          display: 'flex', 
          flexDirection: { xs: 'column', sm: 'row' },
          gap: { xs: 1.5, sm: 3 }, 
          p: 2, 
          bgcolor: alpha(BRAND.primary, 0.04), 
          borderRadius: '12px' 
        }}>
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>TOTAL SKUs</Typography>
            <Typography variant="h6" fontWeight={800} color="text.primary">{validItems.length}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>TOTAL ORDER QTY</Typography>
            <Typography variant="h6" fontWeight={800} color={BRAND.primary}>{totalQty.toLocaleString('en-IN')}</Typography>
          </Box>
        </Box>
      </Box>

      {/* ── Footer Actions ────────────────────────────────── */}
      <Box sx={{ p: 3, borderTop: '2px solid #e2e8f0', display: 'flex', gap: 2, bgcolor: '#f8fafc' }}>
        <Button fullWidth variant="outlined" onClick={onClose}
          sx={{ borderColor: '#e2e8f0', color: '#475569' }}>
          Cancel
        </Button>
        <Button fullWidth variant="contained" onClick={handleSubmit} disabled={isCreating}
          startIcon={isCreating ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}>
          Create Sales Order
        </Button>
      </Box>
    </Drawer>
  );
};

export default OrderCreateModal;
