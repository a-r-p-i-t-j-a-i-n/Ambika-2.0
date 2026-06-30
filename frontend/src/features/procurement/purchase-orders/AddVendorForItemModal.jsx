import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Grid, Autocomplete, Typography, CircularProgress, Divider, Box,
  FormControlLabel, Switch,
} from '@mui/material';
import { Plus, Building2 } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useCreateVendorMutation, useAddVendorProductMutation } from '../../../store/api/vendorApi';

/**
 * "Add Vendor for Selected Item" — used by the New PO form when no Vendor Master
 * record carries the selected SKU(s). The user either picks an existing vendor or
 * creates a new one, and supplies the rate / GST / unit / HSN for each selected
 * item. On save, every SKU is upserted onto the vendor's catalog (which records
 * pricing history server-side) and the vendor is handed back to the PO form so it
 * can be auto-selected and the rows auto-filled.
 */
const AddVendorForItemModal = ({ open, onClose, items = [], vendorOptions = [], onAdded }) => {
  const { enqueueSnackbar } = useSnackbar();

  const [createNew, setCreateNew] = useState(false);
  const [vendor, setVendor] = useState(null);            // existing vendor
  const [newVendor, setNewVendor] = useState({ name: '', gstNo: '', phone: '', email: '' });
  const [rows, setRows] = useState([]);                  // per-item rate/gst/unit/hsn/notes

  const [createVendor, { isLoading: creating }] = useCreateVendorMutation();
  const [addVendorProduct, { isLoading: adding }] = useAddVendorProductMutation();
  const saving = creating || adding;

  useEffect(() => {
    if (!open) return;
    setCreateNew(false);
    setVendor(null);
    setNewVendor({ name: '', gstNo: '', phone: '', email: '' });
    setRows((items || []).map((it) => ({
      itemName: it.itemName || '',
      skuCode: it.skuCode || '',
      skuId: it.skuId || undefined,
      unit: it.unit || 'Pcs',
      rate: '',
      gstRate: 18,
      hsn: '',
      notes: '',
    })));
  }, [open, items]);

  const patchRow = (idx, patch) => setRows((cur) => cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const validate = () => {
    if (createNew) {
      if (!newVendor.name.trim()) { enqueueSnackbar('Vendor name is required', { variant: 'warning' }); return false; }
    } else if (!vendor?._id) {
      enqueueSnackbar('Select a vendor or create a new one', { variant: 'warning' });
      return false;
    }
    const bad = rows.find((r) => !(Number(r.rate) >= 0 && r.rate !== '') || r.gstRate === '' || !r.unit.trim());
    if (bad) { enqueueSnackbar(`Rate, GST % and Unit are required for "${bad.itemName}"`, { variant: 'warning' }); return false; }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    try {
      // 1) Ensure the vendor (existing or freshly created).
      let target = vendor;
      if (createNew) {
        const res = await createVendor({
          name: newVendor.name.trim(),
          gstNo: newVendor.gstNo.trim().toUpperCase(),
          phone: newVendor.phone.trim(),
          email: newVendor.email.trim(),
        }).unwrap();
        target = res?.data;
      }
      if (!target?._id) throw new Error('Vendor could not be resolved');

      // 2) Upsert every selected item's SKU onto the vendor catalog. The last
      //    response carries the fully-updated vendor (with all new products).
      let updated = target;
      for (const r of rows) {
        const res = await addVendorProduct({
          id: target._id,
          skuCode: r.skuCode.trim().toUpperCase(),
          productName: r.itemName.trim() || r.skuCode.trim().toUpperCase(),
          skuId: r.skuId,
          unit: r.unit.trim() || 'Pcs',
          rate: Number(r.rate) || 0,
          gstRate: Number(r.gstRate) || 0,
          hsn: r.hsn.trim(),
          notes: r.notes.trim(),
          remarks: 'Vendor product added during PO creation',
        }).unwrap();
        if (res?.data) updated = res.data;
      }

      enqueueSnackbar('Vendor product saved to Vendor Master', { variant: 'success' });
      onAdded?.(updated);
      onClose?.();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || err?.message || 'Failed to add vendor for item', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.()} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Building2 size={20} /> Add Vendor for Selected Item
      </DialogTitle>
      <DialogContent dividers>
        <FormControlLabel
          control={<Switch checked={createNew} onChange={(e) => setCreateNew(e.target.checked)} />}
          label="Create a new vendor"
        />
        {createNew ? (
          <Grid container spacing={2} sx={{ mt: 0 }}>
            <Grid item xs={12} sm={6}>
              <TextField label="Vendor Name *" fullWidth value={newVendor.name}
                onChange={(e) => setNewVendor((s) => ({ ...s, name: e.target.value }))} autoFocus />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="GST No" fullWidth value={newVendor.gstNo}
                onChange={(e) => setNewVendor((s) => ({ ...s, gstNo: e.target.value.toUpperCase() }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Phone" fullWidth value={newVendor.phone}
                onChange={(e) => setNewVendor((s) => ({ ...s, phone: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Email" fullWidth value={newVendor.email}
                onChange={(e) => setNewVendor((s) => ({ ...s, email: e.target.value }))} />
            </Grid>
          </Grid>
        ) : (
          <Autocomplete
            options={vendorOptions}
            value={vendor}
            getOptionLabel={(o) => (o?.name || '')}
            isOptionEqualToValue={(o, v) => o._id === v._id}
            onChange={(_e, v) => setVendor(v)}
            renderInput={(params) => (
              <TextField {...params} label="Vendor *" placeholder="Select an existing vendor" sx={{ mt: 1 }} />
            )}
          />
        )}

        <Divider sx={{ my: 2 }} />
        <Typography sx={{ fontWeight: 700, mb: 1 }}>Item Rate(s)</Typography>
        {rows.map((r, idx) => (
          <Box key={idx} sx={{ p: 1.5, mb: 1.25, borderRadius: '12px', border: '1px solid', borderColor: 'divider' }}>
            <Grid container spacing={1.5} alignItems="center">
              <Grid item xs={12} sm={4}>
                <TextField label="Item Name" fullWidth size="small" value={r.itemName} InputProps={{ readOnly: true }} disabled />
              </Grid>
              <Grid item xs={6} sm={2}>
                <TextField label="SKU" fullWidth size="small" value={r.skuCode} InputProps={{ readOnly: true }} disabled />
              </Grid>
              <Grid item xs={6} sm={2}>
                <TextField label="Unit *" fullWidth size="small" value={r.unit}
                  onChange={(e) => patchRow(idx, { unit: e.target.value })} />
              </Grid>
              <Grid item xs={4} sm={2}>
                <TextField label="Rate *" type="number" fullWidth size="small" value={r.rate}
                  onChange={(e) => patchRow(idx, { rate: e.target.value })} inputProps={{ min: 0 }} />
              </Grid>
              <Grid item xs={4} sm={2}>
                <TextField label="GST % *" type="number" fullWidth size="small" value={r.gstRate}
                  onChange={(e) => patchRow(idx, { gstRate: e.target.value })} inputProps={{ min: 0, max: 100 }} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField label="HSN" fullWidth size="small" value={r.hsn}
                  onChange={(e) => patchRow(idx, { hsn: e.target.value })} />
              </Grid>
              <Grid item xs={12} sm={9}>
                <TextField label="Notes" fullWidth size="small" value={r.notes}
                  onChange={(e) => patchRow(idx, { notes: e.target.value })} placeholder="Grade / spec mapping (optional)" />
              </Grid>
            </Grid>
          </Box>
        ))}
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.()} disabled={saving}>Cancel</Button>
        <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Plus size={16} />}
          onClick={handleSave} disabled={saving}>
          Save Vendor &amp; Rate
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AddVendorForItemModal;
