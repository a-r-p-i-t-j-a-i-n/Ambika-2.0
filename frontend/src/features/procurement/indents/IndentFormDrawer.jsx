import React, { useState, useEffect } from 'react';
import {
  Box, Typography, TextField, Button, IconButton, Divider,
  Grid, MenuItem, Autocomplete, CircularProgress, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import { X, Save, ClipboardList, Plus } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useCreateIndentMutation,
  useUpdateIndentMutation,
} from '../../../store/api/procurementApi';
import { useGetSkuLookupQuery, useCreateSkuMutation } from '../../../store/api/skuApi';
import { useGetEmployeesQuery } from '../../../store/api/authApi';
import { UNITS, DEPARTMENTS, normalizeUnit } from './indentMeta';

// Purchase FMS rule: Finished Goods are sell-side only — never purchasable.
const FG_BLOCKED = new Set(['FINISHED_GOOD', 'FG', 'SALE_PRODUCT', 'READY_STOCK_PRODUCT']);
export const isPurchasableSku = (s) => !FG_BLOCKED.has(String(s?.itemType || '').toUpperCase());
const ITEM_TYPES = [
  'RAW_MATERIAL', 'CONSUMABLE', 'PACKING', 'PACKAGING', 'CIRCLE', 'CHEMICAL', 'INK',
  'BUTTER_PAPER', 'SUBLIMATION_PAPER', 'STATIONERY', 'SERVICE', 'SPARE_PART', 'JOB_WORK', 'WIP_MATERIAL',
];

/**
 * Create / edit a Purchase Indent.
 * Editing is only allowed while the indent is a DRAFT (backend enforces this).
 */
const blankForm = () => ({
  productNameRevised: '', skuCode: '', skuId: '', quantity: '', unit: 'Pcs',
  raisedBy: '', department: 'Stores',
});

const IndentFormDrawer = ({ open, onClose, indent = null }) => {
  const { enqueueSnackbar } = useSnackbar();
  const isEdit = Boolean(indent?._id);

  const [form, setForm] = useState(blankForm());
  const [errors, setErrors] = useState({});

  const [createIndent, { isLoading: creating }] = useCreateIndentMutation();
  const [updateIndent, { isLoading: updating }] = useUpdateIndentMutation();
  const saving = creating || updating;

  const { data: skuRes, isLoading: skusLoading } = useGetSkuLookupQuery({ limit: 2000 }, { skip: !open });
  // Purchase FMS: exclude Finished Goods from the product picker.
  const skuOptions = (skuRes?.data || []).filter(isPurchasableSku);

  // Employee directory for the "Raised By" picker.
  const { data: empRes, isLoading: empLoading } = useGetEmployeesQuery(undefined, { skip: !open });
  const employeeNames = (empRes?.data || []).map((e) => e.name).filter(Boolean);

  // ── Quick "add product" (creates a real SKU so it's reusable) ──
  const [createSku, { isLoading: creatingSku }] = useCreateSkuMutation();
  const [addOpen, setAddOpen] = useState(false);
  const [newSku, setNewSku] = useState({ name: '', code: '', unit: 'Pcs', itemType: 'RAW_MATERIAL' });

  const openAddProduct = () => {
    setNewSku({ name: form.productNameRevised || '', code: '', unit: form.unit || 'Pcs', itemType: 'RAW_MATERIAL' });
    setAddOpen(true);
  };

  const handleCreateProduct = async () => {
    if (!newSku.name.trim() || !newSku.code.trim()) {
      enqueueSnackbar('Product name and SKU code are required', { variant: 'warning' });
      return;
    }
    try {
      const res = await createSku({
        name: newSku.name.trim(),
        code: newSku.code.trim().toUpperCase(),
        unit: newSku.unit.trim() || 'Pcs',
        itemType: newSku.itemType,
      }).unwrap();
      const sku = res?.data || {};
      // Auto-select the freshly created product on the indent form.
      setForm((f) => ({
        ...f,
        productNameRevised: sku.name || newSku.name.trim(),
        skuCode: sku.code || newSku.code.trim().toUpperCase(),
        skuId: sku._id || '',
        unit: normalizeUnit(sku.unit) || newSku.unit || f.unit,
      }));
      enqueueSnackbar('Product added to SKU master', { variant: 'success' });
      setAddOpen(false);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to add product', { variant: 'error' });
    }
  };

  useEffect(() => {
    if (!open) return;
    if (indent) {
      setForm({
        productNameRevised: indent.productNameRevised || '',
        skuCode: indent.skuCode || '',
        skuId: indent.skuId || '',
        quantity: indent.quantity ?? '',
        unit: normalizeUnit(indent.unit) || 'Pcs',
        raisedBy: indent.raisedBy || '',
        department: indent.department || 'Stores',
      });
    } else {
      setForm(blankForm());
    }
    setErrors({});
  }, [open, indent]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const validate = () => {
    const e = {};
    if (!form.productNameRevised.trim()) e.productNameRevised = 'Product name is required';
    if (form.quantity === '' || Number(form.quantity) <= 0) e.quantity = 'Enter a quantity';
    if (!form.unit.trim()) e.unit = 'Unit is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) { enqueueSnackbar('Please fix the highlighted fields', { variant: 'warning' }); return; }
    const payload = {
      productNameRevised: form.productNameRevised.trim(),
      skuCode: form.skuCode.trim(),
      skuId: form.skuId || undefined,
      quantity: Number(form.quantity),
      unit: form.unit.trim(),
      raisedBy: form.raisedBy.trim(),
      department: form.department.trim(),
    };
    try {
      if (isEdit) {
        await updateIndent({ id: indent._id, ...payload }).unwrap();
        enqueueSnackbar('Indent updated', { variant: 'success' });
      } else {
        await createIndent(payload).unwrap();
        enqueueSnackbar('Indent created', { variant: 'success' });
      }
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save indent', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="sm" fullWidth
      PaperProps={{ sx: { borderRadius: { xs: 0, sm: '18px' }, display: 'flex', flexDirection: 'column', maxHeight: '92vh', overflow: 'hidden' } }}>
      {/* Header */}
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)', color: '#fff' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <ClipboardList size={22} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: '#fff' }}>
              {isEdit ? 'Edit Indent' : 'New Purchase Indent'}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)' }}>
              {isEdit ? indent.indentNumber : 'Purchase FMS · raise a requirement'}
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(false)} sx={{ color: '#fff' }}><X size={20} /></IconButton>
      </Box>

      {/* Body */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, bgcolor: '#f8fafc' }}>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <Autocomplete
                sx={{ flexGrow: 1 }}
                freeSolo
                options={skuOptions}
                loading={skusLoading}
                getOptionLabel={(o) => (typeof o === 'string' ? o : o.name || '')}
                value={form.productNameRevised}
                onInputChange={(_e, v, reason) => { if (reason === 'input') setField('productNameRevised', v); }}
                onChange={(_e, val) => {
                  if (val && typeof val === 'object') {
                    setForm((f) => ({ ...f, productNameRevised: val.name, skuCode: val.code, skuId: val._id, unit: normalizeUnit(val.unit) || f.unit }));
                  }
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Product Name (Revised) *" error={!!errors.productNameRevised}
                    helperText={errors.productNameRevised || "Pick from SKU master, type freely, or click + to add a new product"}
                    InputProps={{ ...params.InputProps, endAdornment: (<>{skusLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
                )}
              />
              <Tooltip title="Add a new product to SKU master">
                <Button variant="outlined" onClick={openAddProduct} sx={{ minWidth: 0, px: 1.5, height: 40, mt: 0.25 }}>
                  <Plus size={18} />
                </Button>
              </Tooltip>
            </Box>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="SKU Code" fullWidth value={form.skuCode}
              onChange={(e) => setField('skuCode', e.target.value.toUpperCase())} placeholder="Optional" />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField label="Quantity *" type="number" fullWidth value={form.quantity}
              onChange={(e) => setField('quantity', e.target.value)} error={!!errors.quantity} helperText={errors.quantity}
              inputProps={{ min: 0 }} />
          </Grid>
          <Grid item xs={6} sm={3}>
            <TextField label="Unit *" select fullWidth value={form.unit}
              onChange={(e) => setField('unit', e.target.value)} error={!!errors.unit}>
              {UNITS.map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <Autocomplete
              freeSolo
              options={employeeNames}
              loading={empLoading}
              value={form.raisedBy}
              onInputChange={(_e, v) => setField('raisedBy', v)}
              renderInput={(params) => (
                <TextField {...params} label="Raised By" placeholder="Select employee or type"
                  InputProps={{ ...params.InputProps, endAdornment: (<>{empLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
              )}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField label="Department" select fullWidth value={form.department}
              onChange={(e) => setField('department', e.target.value)}>
              {DEPARTMENTS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
            </TextField>
          </Grid>
        </Grid>
      </Box>

      {/* Footer */}
      <Divider />
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end', gap: 1.5, bgcolor: '#fff' }}>
        <Button variant="outlined" onClick={() => onClose?.(false)} disabled={saving}>Cancel</Button>
        <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
          onClick={handleSubmit} disabled={saving}>
          {isEdit ? 'Save Changes' : 'Create Indent'}
        </Button>
      </Box>

      {/* Quick add product → SKU master */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Add New Product</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField label="Product Name *" fullWidth value={newSku.name}
                onChange={(e) => setNewSku((s) => ({ ...s, name: e.target.value }))} autoFocus />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="SKU Code *" fullWidth value={newSku.code}
                onChange={(e) => setNewSku((s) => ({ ...s, code: e.target.value.toUpperCase() }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Unit" select fullWidth value={newSku.unit}
                onChange={(e) => setNewSku((s) => ({ ...s, unit: e.target.value }))}>
                {UNITS.map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField label="Item Type" select fullWidth value={newSku.itemType}
                onChange={(e) => setNewSku((s) => ({ ...s, itemType: e.target.value }))}>
                {ITEM_TYPES.map((t) => <MenuItem key={t} value={t}>{t.replace('_', ' ')}</MenuItem>)}
              </TextField>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button onClick={() => setAddOpen(false)} disabled={creatingSku}>Cancel</Button>
          <Button variant="contained" startIcon={creatingSku ? <CircularProgress size={16} color="inherit" /> : <Plus size={16} />}
            onClick={handleCreateProduct} disabled={creatingSku}>
            Add Product
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};

export default IndentFormDrawer;
