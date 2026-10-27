import React, { useState, useEffect, useMemo } from 'react';
import {
  Box, Typography, TextField, Button, IconButton, Divider,
  Grid, MenuItem, Autocomplete, createFilterOptions, CircularProgress, Tooltip, Paper,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { X, Save, ClipboardList, Plus, Trash2 } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useCreateIndentMutation,
  useUpdateIndentMutation,
} from '../../../store/api/procurementApi';
import { useGetSkuLookupQuery, useCreateSkuMutation } from '../../../store/api/skuApi';
import { useGetEmployeesQuery } from '../../../store/api/authApi';
import { UNITS, DEPARTMENTS, normalizeUnit } from './indentMeta';
import { PFMS, pfmsCardSx } from '../pfmsTheme';
import { TYPE_META, typeDestinationHint } from '../../masters/itemTypeMeta';

// Purchase FMS rule: Finished Goods are sell-side only — never purchasable.
const FG_BLOCKED = new Set(['FINISHED_GOOD', 'FG', 'SALE_PRODUCT', 'READY_STOCK_PRODUCT']);
export const isPurchasableSku = (s) => !FG_BLOCKED.has(String(s?.itemType || '').toUpperCase());
const ITEM_TYPES = [
  'RAW_MATERIAL', 'CONSUMABLE', 'PACKING', 'PACKAGING', 'CIRCLE', 'CHEMICAL', 'INK',
  'BUTTER_PAPER', 'SUBLIMATION_PAPER', 'STATIONERY', 'SERVICE', 'SPARE_PART', 'JOB_WORK', 'WIP_MATERIAL',
];

/**
 * Create / edit a Purchase Indent (multi-item).
 * Editing is only allowed while the indent is a DRAFT (backend enforces this).
 */
const emptyItem = () => ({ itemName: '', skuCode: '', skuId: '', unit: 'Pcs', quantity: '', remarks: '' });
// The lookup endpoint builds a RegExp from `search`, so typed text is escaped.
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Match the typed text against name OR code; cap the rendered list.
const filterSkuOptions = createFilterOptions({ limit: 200, stringify: (o) => `${o.name || ''} ${o.code || ''}` });
const blankHeader = () => ({ raisedBy: '', department: 'Stores', requestType: 'MATERIAL_PURCHASE', remarks: '' });

// Map an existing indent (new items[] or legacy single-product) → editable rows.
const rowsFromIndent = (indent) => {
  if (indent?.items?.length) {
    return indent.items.map((it) => ({
      itemName: it.itemName || '', skuCode: it.skuCode || '', skuId: it.skuId || '',
      unit: normalizeUnit(it.unit) || 'Pcs', quantity: it.quantity ?? '', remarks: it.remarks || '',
    }));
  }
  if (indent?.productNameRevised) {
    return [{
      itemName: indent.productNameRevised, skuCode: indent.skuCode || '', skuId: indent.skuId || '',
      unit: normalizeUnit(indent.unit) || 'Pcs', quantity: indent.quantity ?? '', remarks: '',
    }];
  }
  return [emptyItem()];
};

const HEAD = ['Product *', 'SKU', 'Qty *', 'Unit *', 'Remarks', ''];
const COLS = { xs: '1fr', md: '2fr 1fr 0.8fr 0.9fr 1.5fr 40px' };

const IndentFormDrawer = ({ open, onClose, indent = null }) => {
  const { enqueueSnackbar } = useSnackbar();
  const isEdit = Boolean(indent?._id);

  const [header, setHeader] = useState(blankHeader());
  const [items, setItems] = useState([emptyItem()]);
  const [errors, setErrors] = useState({});

  const [createIndent, { isLoading: creating }] = useCreateIndentMutation();
  const [updateIndent, { isLoading: updating }] = useUpdateIndentMutation();
  const saving = creating || updating;

  // Products come from the SKU Master only (the server re-reads name + code
  // from the SKU record on save). The first 2000 load up front; typing also
  // searches the master, so a larger catalogue is still fully reachable.
  const { data: skuRes, isLoading: skusLoading } = useGetSkuLookupQuery({ limit: 2000 }, { skip: !open });
  const [skuSearch, setSkuSearch] = useState('');
  const [skuTerm, setSkuTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSkuTerm(skuSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [skuSearch]);
  const { data: skuSearchRes, isFetching: skuSearching } = useGetSkuLookupQuery(
    { search: escapeRegex(skuTerm), limit: 50 }, { skip: !open || skuTerm.length < 2 },
  );
  // Purchase FMS: exclude Finished Goods from the product picker.
  const skuOptions = useMemo(() => {
    const byId = new Map();
    [...(skuRes?.data || []), ...(skuSearchRes?.data || [])]
      .filter(isPurchasableSku)
      .forEach((s) => byId.set(String(s._id), s));
    // A row's saved SKU stays selectable even if it is outside the loaded list.
    items.forEach((it) => {
      if (it.skuId && !byId.has(String(it.skuId))) byId.set(String(it.skuId), { _id: it.skuId, name: it.itemName, code: it.skuCode, unit: it.unit });
    });
    return [...byId.values()];
  }, [skuRes, skuSearchRes, items]);
  const skuById = useMemo(() => new Map(skuOptions.map((s) => [String(s._id), s])), [skuOptions]);

  // Employee directory for the "Raised By" picker.
  const { data: empRes, isLoading: empLoading } = useGetEmployeesQuery(undefined, { skip: !open });
  const employeeNames = (empRes?.data || []).map((e) => e.name).filter(Boolean);

  // ── Quick "add product" (creates a real SKU so it's reusable) ──
  const [createSku, { isLoading: creatingSku }] = useCreateSkuMutation();
  const [addOpen, setAddOpen] = useState(false);
  // No Item Type is pre-selected: it decides which inventory module the item's
  // purchased stock is posted to (RM IMS / C&P IMS / main store), so a buyer who
  // skipped the field used to create a Raw Material SKU by accident.
  const [newSku, setNewSku] = useState({ name: '', code: '', unit: 'Pcs', itemType: '' });

  const openAddProduct = () => {
    setNewSku({ name: '', code: '', unit: 'Pcs', itemType: '' });
    setAddOpen(true);
  };

  const handleCreateProduct = async () => {
    if (!newSku.name.trim() || !newSku.code.trim()) {
      enqueueSnackbar('Product name and SKU code are required', { variant: 'warning' });
      return;
    }
    if (!newSku.itemType) {
      enqueueSnackbar('Select the Item Type — it decides where the purchased stock is posted', { variant: 'warning' });
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
      // Append the freshly created product as a new indent row.
      setItems((cur) => {
        const row = {
          ...emptyItem(),
          itemName: sku.name || newSku.name.trim(),
          skuCode: sku.code || newSku.code.trim().toUpperCase(),
          skuId: sku._id || '',
          unit: normalizeUnit(sku.unit) || newSku.unit || 'Pcs',
        };
        // Reuse a trailing empty row if present, else append.
        const onlyTrailingEmpty = cur.length && !cur[cur.length - 1].itemName?.trim();
        return onlyTrailingEmpty ? [...cur.slice(0, -1), row] : [...cur, row];
      });
      enqueueSnackbar('Product added to SKU master', { variant: 'success' });
      setAddOpen(false);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to add product', { variant: 'error' });
    }
  };

  useEffect(() => {
    if (!open) return;
    if (indent) {
      setHeader({ raisedBy: indent.raisedBy || '', department: indent.department || 'Stores', requestType: indent.requestType || 'MATERIAL_PURCHASE', remarks: indent.remarks || '' });
      setItems(rowsFromIndent(indent));
    } else {
      setHeader(blankHeader());
      setItems([emptyItem()]);
    }
    setErrors({});
  }, [open, indent]);

  const setHead = (k, v) => setHeader((h) => ({ ...h, [k]: v }));
  const setItem = (idx, patch) => setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const addRow = () => setItems((cur) => [...cur, emptyItem()]);
  const removeRow = (idx) => setItems((cur) => (cur.length > 1 ? cur.filter((_, i) => i !== idx) : cur));

  // A row that names a product but has no SKU — only an older draft typed by
  // hand can be in this state; it must be re-picked from the SKU Master.
  const unlinked = (it) => Boolean(it.itemName.trim()) && !it.skuId;

  const validate = () => {
    const e = {};
    const valid = items.filter((it) => it.skuId && Number(it.quantity) > 0);
    if (!valid.length) e.items = 'Add at least one product with a quantity';
    items.forEach((it, i) => {
      if (it.itemName.trim() && !(Number(it.quantity) > 0)) e[`qty_${i}`] = true;
      if (unlinked(it)) e[`sku_${i}`] = true;
    });
    const firstUnlinked = items.find(unlinked);
    if (firstUnlinked) e.items = `"${firstUnlinked.itemName.trim()}" is not in SKU Master — pick the product from the SKU list`;
    setErrors(e);
    return !e.items;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      const first = items.find(unlinked);
      enqueueSnackbar(first ? `"${first.itemName.trim()}" is not in SKU Master — pick the product from the SKU list` : 'Add at least one product with a quantity', { variant: 'warning' });
      return;
    }
    const payload = {
      items: items
        .filter((it) => it.skuId && Number(it.quantity) > 0)
        .map((it) => ({
          itemName: it.itemName.trim(),
          skuCode: it.skuCode.trim(),
          skuId: it.skuId || undefined,
          quantity: Number(it.quantity),
          unit: it.unit.trim() || 'Pcs',
          remarks: it.remarks.trim(),
        })),
      raisedBy: header.raisedBy.trim(),
      department: header.department.trim(),
      requestType: header.requestType || 'MATERIAL_PURCHASE',
      remarks: header.remarks.trim(),
    };
    try {
      if (isEdit) {
        await updateIndent({ id: indent._id, ...payload }).unwrap();
        enqueueSnackbar('Indent updated', { variant: 'success' });
        onClose?.(true);
      } else {
        const res = await createIndent(payload).unwrap();
        enqueueSnackbar('Indent created', { variant: 'success' });
        // Second arg = the newly created indent, so a caller that isn't
        // already on the indent list (e.g. a Quick Action) can open it.
        onClose?.(true, res?.data);
      }
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save indent', { variant: 'error' });
    }
  };

  const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="lg" fullWidth
      PaperProps={{ sx: { borderRadius: { xs: 0, sm: '8px' }, display: 'flex', flexDirection: 'column', maxHeight: '92vh', overflow: 'hidden' } }}>
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
              {isEdit ? indent.indentNumber : 'Purchase FMS · raise a multi-item requirement'}
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(false)} sx={{ color: '#fff' }}><X size={20} /></IconButton>
      </Box>

      {/* Body */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, bgcolor: PFMS.canvas, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* Indent header */}
        <Paper elevation={0} sx={{ p: 2.5, ...pfmsCardSx }}>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={5}>
              <Autocomplete
                freeSolo
                options={employeeNames}
                loading={empLoading}
                value={header.raisedBy}
                onInputChange={(_e, v) => setHead('raisedBy', v)}
                renderInput={(params) => (
                  <TextField {...params} label="Raised By" placeholder="Select employee or type"
                    InputProps={{ ...params.InputProps, endAdornment: (<>{empLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField label="Department" select fullWidth value={header.department}
                onChange={(e) => setHead('department', e.target.value)}>
                {DEPARTMENTS.map((d) => <MenuItem key={d} value={d}>{d}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField label="Request Type *" select fullWidth value={header.requestType}
                onChange={(e) => setHead('requestType', e.target.value)}
                helperText={header.requestType === 'INTERNAL_SERVICE' ? 'No PO / PI / GRN — service flow' : 'Standard material purchase flow'}>
                <MenuItem value="MATERIAL_PURCHASE">Material Purchase</MenuItem>
                <MenuItem value="INTERNAL_SERVICE">Internal Service</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12}>
              <TextField label="Remarks" fullWidth value={header.remarks}
                onChange={(e) => setHead('remarks', e.target.value)} placeholder="Optional" />
            </Grid>
          </Grid>
        </Paper>

        {/* Items */}
        <Paper elevation={0} sx={{ p: 2.5, ...pfmsCardSx }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Typography sx={{ fontWeight: 700, color: 'primary.main', display: 'flex', alignItems: 'center', gap: 1 }}>
              <ClipboardList size={18} /> Indent Items
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" variant="outlined" startIcon={<Plus size={15} />} onClick={openAddProduct}>New Product</Button>
              <Button size="small" variant="contained" startIcon={<Plus size={15} />} onClick={addRow}>Add Item</Button>
            </Box>
          </Box>

          {/* Column heads (desktop) */}
          <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: COLS.md, gap: 1, px: 1, mb: 0.5 }}>
            {HEAD.map((h, i) => (
              <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.62rem' }}>{h}</Typography>
            ))}
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {items.map((it, idx) => (
              <Box key={idx} sx={{
                display: 'grid', gridTemplateColumns: COLS, gap: 1, alignItems: 'center',
                p: { xs: 1.5, md: 0.5 }, px: { md: 1 }, borderRadius: '10px',
                border: { xs: '1px solid', md: 'none' }, borderColor: 'divider',
                '&:hover': { bgcolor: { md: alpha('#2563eb', 0.03) } },
              }}>
                {/* SKU Master only — typing searches, it never creates a free-text item. */}
                <Autocomplete
                  size="small"
                  options={skuOptions}
                  loading={skusLoading || skuSearching}
                  filterOptions={filterSkuOptions}
                  getOptionLabel={(o) => o?.name || ''}
                  isOptionEqualToValue={(o, v) => String(o._id) === String(v._id)}
                  value={it.skuId ? (skuById.get(String(it.skuId)) || null) : null}
                  onInputChange={(_e, v, reason) => { if (reason === 'input') setSkuSearch(v); }}
                  onChange={(_e, val) => {
                    // Auto-fetch the unit from the SKU master on selection; if the
                    // SKU has no unit, default to Pcs. Re-runs every time the item is
                    // changed, so picking a different SKU always refreshes the unit.
                    if (val) setItem(idx, { itemName: val.name, skuCode: val.code || '', skuId: val._id, unit: normalizeUnit(val.unit) || 'Pcs' });
                    else setItem(idx, { itemName: '', skuCode: '', skuId: '' });
                  }}
                  renderOption={(props, o) => (
                    <li {...props} key={o._id}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, color: PFMS.ink }}>{o.name}</Typography>
                        <Typography variant="caption" sx={{ color: PFMS.sub }}>{o.code}{o.unit ? ` · ${o.unit}` : ''}</Typography>
                      </Box>
                    </li>
                  )}
                  noOptionsText="No matching SKU in SKU Master — use “New Product” to add it"
                  renderInput={(params) => (
                    <TextField {...params} placeholder="Product name — search SKU Master" error={!!errors[`sku_${idx}`]}
                      helperText={unlinked(it) ? `Not in SKU Master: "${it.itemName.trim()}" — pick the SKU` : undefined}
                      inputProps={{ ...params.inputProps, 'data-testid': 'indent-sku-picker' }} />
                  )}
                />
                <TextField size="small" placeholder="SKU" value={it.skuCode}
                  InputProps={{ readOnly: true }} inputProps={{ 'data-testid': 'indent-sku-code', 'aria-label': 'SKU code (from SKU Master)' }} />
                <TextField size="small" type="number" placeholder="0" value={it.quantity} error={!!errors[`qty_${idx}`]}
                  onChange={(e) => setItem(idx, { quantity: e.target.value })} inputProps={{ min: 0, style: { textAlign: 'right' } }} />
                <TextField size="small" select value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })}>
                  {UNITS.map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                </TextField>
                <TextField size="small" placeholder="Optional" value={it.remarks}
                  onChange={(e) => setItem(idx, { remarks: e.target.value })} />
                <Tooltip title={items.length > 1 ? 'Remove item' : 'At least one item required'}>
                  <span>
                    <IconButton size="small" color="error" onClick={() => removeRow(idx)} disabled={items.length <= 1}>
                      <Trash2 size={16} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            ))}
          </Box>

          {errors.items && <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>{errors.items}</Typography>}

          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>ITEMS</Typography>
              <Typography fontWeight={800}>{items.filter((it) => it.itemName.trim()).length}</Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>TOTAL QTY</Typography>
              <Typography variant="h6" fontWeight={800} color="primary.dark">{totalQty}</Typography>
            </Box>
          </Box>
        </Paper>
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
              <TextField label="Item Type *" select fullWidth required value={newSku.itemType}
                onChange={(e) => setNewSku((s) => ({ ...s, itemType: e.target.value }))}
                error={!newSku.itemType}
                helperText={newSku.itemType ? typeDestinationHint(newSku.itemType) : 'Required — decides which inventory module receives this item.'}
                inputProps={{ 'data-testid': 'indent-new-sku-type' }}>
                {ITEM_TYPES.map((t) => <MenuItem key={t} value={t}>{TYPE_META[t]?.label || t}</MenuItem>)}
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
