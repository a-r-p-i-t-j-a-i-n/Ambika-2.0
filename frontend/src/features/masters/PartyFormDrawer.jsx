import React, { useState, useEffect, useMemo } from 'react';
import {
  Drawer, Box, Typography, TextField, Button, IconButton, Divider,
  Grid, Paper, Tooltip, Autocomplete, CircularProgress, MenuItem,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  X, Plus, Trash2, User, Receipt, Mail, Package, Save, Building2,
} from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useCreatePartyMutation,
  useUpdatePartyMutation,
} from '../../store/api/partyApi';
import { useGetSkuLookupQuery } from '../../store/api/skuApi';

/**
 * Party (= Vendor in Purchase FMS) create / edit drawer.
 *
 * Reuses the existing Party model + Party APIs. No separate Vendor entity.
 * Required (enforced here on the client — the backend keeps only `name`
 * required so existing auto-created parties stay valid):
 *   • Vendor Name • Contact Person • Phone • at least one supplied product
 */

const SECTION = {
  p: 2.5, borderRadius: '16px', border: '1px solid', borderColor: 'divider',
};
const sectionTitle = (color = 'primary.main') => ({
  display: 'flex', alignItems: 'center', gap: 1, mb: 2,
  fontWeight: 700, color,
});

const emptyProduct = () => ({ skuId: '', productName: '', skuCode: '', rate: '', unit: 'Pcs' });

// arrays <-> comma-separated text for the email inputs
const arrToCsv = (a) => (Array.isArray(a) ? a.join(', ') : '');
const csvToArr = (s) =>
  String(s || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

const blankForm = () => ({
  code: '', name: '', contactPerson: '', phone: '', email: '', location: '', address: '',
  gstNo: '', panNo: '', gstRate: '', creditPeriodDays: 30, tdsRate: '',
  toEmails: '', ccEmails: '', bccEmails: '',
  suppliedProducts: [emptyProduct()],
});

const PartyFormDrawer = ({ open, onClose, party = null }) => {
  const { enqueueSnackbar } = useSnackbar();
  const isEdit = Boolean(party?._id);

  const [form, setForm] = useState(blankForm());
  const [errors, setErrors] = useState({});

  const [createParty, { isLoading: isCreating }] = useCreatePartyMutation();
  const [updateParty, { isLoading: isUpdating }] = useUpdatePartyMutation();
  const isSaving = isCreating || isUpdating;

  // SKU master for the product autocomplete (auto-fills code + unit).
  const { data: skuRes, isLoading: skusLoading } = useGetSkuLookupQuery(
    { limit: 2000 },
    { skip: !open },
  );
  // Vendors supply purchasable materials only — Finished Goods are sell-side
  // (Purchase FMS restriction) and are excluded from the catalog picker.
  const FG_BLOCKED = new Set(['FINISHED_GOOD', 'FG', 'SALE_PRODUCT', 'READY_STOCK_PRODUCT']);
  const skuOptions = (skuRes?.data || []).filter((s) => !FG_BLOCKED.has(String(s?.itemType || '').toUpperCase()));

  // Hydrate on open / when the target party changes.
  useEffect(() => {
    if (!open) return;
    if (party) {
      setForm({
        code: party.code || '',
        name: party.name || '',
        contactPerson: party.contactPerson || '',
        phone: party.phone || '',
        email: party.email || '',
        location: party.location || '', // "Place" (city/region)
        address: party.address || '',   // full postal address (from the sheet)
        gstNo: party.gstNo || '',
        panNo: party.panNo || '',
        gstRate: party.gstRate ?? '',
        creditPeriodDays: party.creditPeriodDays ?? 30,
        tdsRate: party.tdsRate ?? '',
        toEmails: arrToCsv(party.toEmails),
        ccEmails: arrToCsv(party.ccEmails),
        bccEmails: arrToCsv(party.bccEmails),
        suppliedProducts:
          party.suppliedProducts?.length
            ? party.suppliedProducts.map((p) => ({
                skuId: p.skuId || '',
                productName: p.productName || '',
                skuCode: p.skuCode || '',
                rate: p.rate ?? '',
                unit: p.unit || 'Pcs',
              }))
            : [emptyProduct()],
      });
    } else {
      setForm(blankForm());
    }
    setErrors({});
  }, [open, party]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // ── Product rows ──────────────────────────────────────────────
  const setProduct = (idx, patch) =>
    setForm((f) => ({
      ...f,
      suppliedProducts: f.suppliedProducts.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    }));
  const addProduct = () =>
    setForm((f) => ({ ...f, suppliedProducts: [...f.suppliedProducts, emptyProduct()] }));
  const removeProduct = (idx) =>
    setForm((f) => ({
      ...f,
      suppliedProducts:
        f.suppliedProducts.length > 1
          ? f.suppliedProducts.filter((_, i) => i !== idx)
          : [emptyProduct()],
    }));

  const validProducts = useMemo(
    () => form.suppliedProducts.filter((p) => p.productName?.trim() || p.skuCode?.trim()),
    [form.suppliedProducts],
  );

  // ── Validation (vendor-level, client-side) ────────────────────
  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Vendor name is required';
    if (!form.contactPerson.trim()) e.contactPerson = 'Contact person is required';
    if (!form.phone.trim()) e.phone = 'Phone number is required';
    if (validProducts.length === 0) e.products = 'Add at least one supplied product';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      enqueueSnackbar('Please fix the highlighted fields', { variant: 'warning' });
      return;
    }

    const payload = {
      code: form.code?.trim() || undefined,
      name: form.name.trim(),
      contactPerson: form.contactPerson.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      location: form.location.trim(),
      address: form.address.trim(),
      gstNo: form.gstNo.trim(),
      panNo: form.panNo.trim(),
      gstRate: form.gstRate === '' ? 0 : Number(form.gstRate),
      tdsRate: form.tdsRate === '' ? 0 : Number(form.tdsRate),
      creditPeriodDays: form.creditPeriodDays === '' ? 0 : Number(form.creditPeriodDays),
      toEmails: csvToArr(form.toEmails),
      ccEmails: csvToArr(form.ccEmails),
      bccEmails: csvToArr(form.bccEmails),
      suppliedProducts: validProducts.map((p) => ({
        skuId: p.skuId || undefined,
        productName: p.productName?.trim() || '',
        skuCode: p.skuCode?.trim() || '',
        rate: p.rate === '' ? 0 : Number(p.rate),
        unit: p.unit?.trim() || 'Pcs',
      })),
    };

    try {
      if (isEdit) {
        await updateParty({ id: party._id, ...payload }).unwrap();
        enqueueSnackbar('Vendor updated', { variant: 'success' });
      } else {
        await createParty(payload).unwrap();
        enqueueSnackbar('Vendor created', { variant: 'success' });
      }
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save vendor', { variant: 'error' });
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={() => onClose?.(false)}
      PaperProps={{ sx: { width: { xs: '100%', md: 760 }, display: 'flex', flexDirection: 'column' } }}
    >
      {/* Header */}
      <Box
        sx={{
          px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)',
          color: '#fff',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Building2 size={22} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: '#fff' }}>
              {isEdit ? 'Edit Vendor / Party' : 'New Vendor / Party'}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)' }}>
              Party Master · used as Vendor in Purchase FMS
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(false)} sx={{ color: '#fff' }}>
          <X size={20} />
        </IconButton>
      </Box>

      {/* Body */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, bgcolor: '#f8fafc' }}>
        {/* Section 1 — Vendor Information */}
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={sectionTitle()}><User size={18} /> Vendor Information</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={8}>
              <TextField label="Vendor Name *" fullWidth value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                error={!!errors.name} helperText={errors.name} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField label="Vendor Code" fullWidth value={form.code}
                onChange={(e) => setField('code', e.target.value.toUpperCase())}
                placeholder="Optional" />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Contact Person *" fullWidth value={form.contactPerson}
                onChange={(e) => setField('contactPerson', e.target.value)}
                error={!!errors.contactPerson} helperText={errors.contactPerson} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Phone Number *" fullWidth value={form.phone}
                onChange={(e) => setField('phone', e.target.value)}
                error={!!errors.phone} helperText={errors.phone} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Email ID" type="email" fullWidth value={form.email}
                onChange={(e) => setField('email', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Place / City" fullWidth value={form.location}
                onChange={(e) => setField('location', e.target.value)}
                placeholder="e.g. Delhi" />
            </Grid>
            <Grid item xs={12}>
              <TextField label="Full Address" fullWidth value={form.address}
                onChange={(e) => setField('address', e.target.value)}
                multiline minRows={2}
                placeholder="Complete postal address (street, area, city, state, PIN)" />
            </Grid>
          </Grid>
        </Paper>

        {/* Section 2 — Tax Information */}
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={sectionTitle('#0f766e')}><Receipt size={18} /> Tax Information</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField label="GST Number" fullWidth value={form.gstNo}
                onChange={(e) => setField('gstNo', e.target.value.toUpperCase())} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="PAN Number" fullWidth value={form.panNo}
                onChange={(e) => setField('panNo', e.target.value.toUpperCase())} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField label="GST Rate (%)" type="number" fullWidth value={form.gstRate}
                onChange={(e) => setField('gstRate', e.target.value)}
                inputProps={{ min: 0, max: 100, step: 0.01 }} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField label="Credit Period (Days)" type="number" fullWidth value={form.creditPeriodDays}
                onChange={(e) => setField('creditPeriodDays', e.target.value)}
                inputProps={{ min: 0, max: 365 }} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField label="TDS Rate (%)" type="number" fullWidth value={form.tdsRate}
                onChange={(e) => setField('tdsRate', e.target.value)}
                inputProps={{ min: 0, max: 100, step: 0.01 }} />
            </Grid>
          </Grid>
        </Paper>

        {/* Section 3 — Email Configuration */}
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={sectionTitle('#7c3aed')}><Mail size={18} /> Email Configuration</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
            Separate multiple addresses with commas.
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <TextField label="TO Email" fullWidth value={form.toEmails}
                onChange={(e) => setField('toEmails', e.target.value)} placeholder="a@x.com, b@x.com" />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField label="CC Email" fullWidth value={form.ccEmails}
                onChange={(e) => setField('ccEmails', e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField label="BCC Email" fullWidth value={form.bccEmails}
                onChange={(e) => setField('bccEmails', e.target.value)} />
            </Grid>
          </Grid>
        </Paper>

        {/* Section 4 — Products Supplied */}
        <Paper elevation={0} sx={{ ...SECTION, borderColor: errors.products ? 'error.main' : 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Typography sx={{ ...sectionTitle('#b45309'), mb: 0 }}><Package size={18} /> Products Supplied *</Typography>
            <Button size="small" startIcon={<Plus size={15} />} onClick={addProduct} variant="outlined">
              Add Product
            </Button>
          </Box>
          {errors.products && (
            <Typography variant="caption" color="error" sx={{ mb: 1, display: 'block' }}>{errors.products}</Typography>
          )}

          {/* Column headers */}
          <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: '2.2fr 1.2fr 0.9fr 0.8fr 40px', gap: 1, px: 1, mb: 0.5 }}>
            {['Product Name', 'Item SKU Code', 'Rate', 'Unit', ''].map((h) => (
              <Typography key={h} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.65rem' }}>{h}</Typography>
            ))}
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {form.suppliedProducts.map((row, idx) => (
              <Box key={idx}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: '2.2fr 1.2fr 0.9fr 0.8fr 40px' },
                  gap: 1, alignItems: 'center',
                  p: { xs: 1.5, md: 0.5 }, px: { md: 1 },
                  borderRadius: '10px',
                  border: { xs: '1px solid', md: 'none' }, borderColor: 'divider',
                  '&:hover': { bgcolor: alpha('#2563eb', 0.03) },
                }}
              >
                <Autocomplete
                  freeSolo
                  options={skuOptions}
                  loading={skusLoading}
                  getOptionLabel={(o) => (typeof o === 'string' ? o : `${o.name}`)}
                  value={row.productName}
                  onInputChange={(_e, v, reason) => { if (reason === 'input') setProduct(idx, { productName: v }); }}
                  onChange={(_e, val) => {
                    if (val && typeof val === 'object') {
                      setProduct(idx, {
                        skuId: val._id, productName: val.name, skuCode: val.code,
                        unit: val.unit || 'Pcs',
                      });
                    }
                  }}
                  renderInput={(params) => (
                    <TextField {...params} size="small" placeholder="Product name / pick SKU"
                      InputProps={{ ...params.InputProps, endAdornment: (<>{skusLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
                  )}
                />
                <TextField size="small" placeholder="SKU code" value={row.skuCode}
                  onChange={(e) => setProduct(idx, { skuCode: e.target.value.toUpperCase() })} />
                <TextField size="small" type="number" placeholder="0.00" value={row.rate}
                  onChange={(e) => setProduct(idx, { rate: e.target.value })}
                  inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} />
                <TextField size="small" value={row.unit}
                  onChange={(e) => setProduct(idx, { unit: e.target.value })} />
                <Tooltip title="Remove">
                  <span>
                    <IconButton size="small" color="error"
                      onClick={() => removeProduct(idx)}
                      disabled={form.suppliedProducts.length === 1 && !row.productName && !row.skuCode}>
                      <Trash2 size={16} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            ))}
          </Box>
        </Paper>
      </Box>

      {/* Footer */}
      <Divider />
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#fff' }}>
        <Typography variant="caption" color="text.secondary">
          {validProducts.length} product(s) · Party = Vendor
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button variant="outlined" onClick={() => onClose?.(false)} disabled={isSaving}>Cancel</Button>
          <Button variant="contained" startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
            onClick={handleSubmit} disabled={isSaving}>
            {isEdit ? 'Save Changes' : 'Create Vendor'}
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
};

export default PartyFormDrawer;
