import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Edit3, PackagePlus, Plus, Save, Search, Upload, X } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useBulkUpsertSkusMutation, useCreateSkuMutation, useGetSkusQuery, useUpdateSkuMutation } from '../../store/api/skuApi';

const BRAND = { primary: '#2563eb', success: '#059669', warning: '#d97706', error: '#dc2626', wip: '#7c3aed' };

const sheetSkuItems = [
  { name: 'Dome Jar', code: 'DJ1500-204', category: 'Jar', pcsPerBox: 105, weightPerPc: 0.3307 },
  { name: 'Bowl 2.0 Ltr', code: 'BO2000-202', category: 'Bowl', pcsPerBox: 100 },
  { name: 'MG 1.1 Wet Jar Celum', code: 'MG1650-304', category: 'MG Jar', pcsPerBox: 120, aliases: ['MG 1.1 Wet Jar'] },
  { name: 'Value Flat Wet', code: 'VF1500-202', category: 'Value Flat', pcsPerBox: 120, weightPerPc: 0.266 },
  { name: 'Taper Jar - Patti 1.0 Ltr', code: 'TP1000-202', category: 'Mixer Jar', pcsPerBox: 100 },
  { name: 'Taper Jar - Bidding 1.0 Ltr', code: 'TB1000-204', category: 'Mixer Jar', pcsPerBox: 100 },
  { name: 'Taper Jar - Patti 1.5 Ltr', code: 'TP1500-202', category: 'Mixer Jar', pcsPerBox: 100 },
  { name: 'Steele 1.5 Ltr', code: 'ST1500-202', category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.27 },
  { name: 'Steele 1.0 Ltr', code: 'ST1000-202', category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.187 },
  { name: 'Galaxy 1.5 Ltr', code: 'GX1500-202', category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.27 },
  { name: 'Galaxy 1.0 Ltr', code: 'GX1000-202', category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.187 },
  { name: 'Taper Jar - Bidding 1.5 Ltr', code: 'TB1500-204', category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.25 },
  { name: 'Taper Jar - Patti 0.750 Ltr', code: 'TP0750-202', category: 'Mixer Jar', pcsPerBox: 100, weightPerPc: 0.15 },
  { name: 'PP Chutney', code: 'PP0400-202', category: 'PP Jar', pcsPerBox: 180, weightPerPc: 0.1317 },
  { name: 'Grinder Jar', code: 'GJ1000-204', category: 'Jar', pcsPerBox: 126, weightPerPc: 0.2445 },
  { name: 'Chutney Katori', code: 'CK0600-204', category: 'Katori', pcsPerBox: 144, weightPerPc: 0.1514 },
  { name: 'Flat Jar', code: 'FJ1000-204', category: 'Jar', pcsPerBox: 120, weightPerPc: 0.275 },
];

const emptyForm = {
  name: '',
  code: '',
  category: '',
  unit: 'PCS',
  pcsPerBox: 1,
  weightPerPc: 0,
  weightPerBox: 0,
  leadDays: 7,
  aliasesText: '',
  packingDetails: '',
};

const SkuDrawer = ({ open, onClose, sku }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [form, setForm] = useState(emptyForm);
  const [createSku, { isLoading: isCreating }] = useCreateSkuMutation();
  const [updateSku, { isLoading: isUpdating }] = useUpdateSkuMutation();
  const isSaving = isCreating || isUpdating;

  useEffect(() => {
    if (!open) return;
    setForm(sku ? {
      name: sku.name || '',
      code: sku.code || '',
      category: sku.category || '',
      unit: sku.unit || 'PCS',
      pcsPerBox: sku.pcsPerBox || 1,
      weightPerPc: sku.weightPerPc || 0,
      weightPerBox: sku.weightPerBox || 0,
      leadDays: sku.leadDays || 7,
      aliasesText: (sku.aliases || []).join(', '),
      packingDetails: sku.packingDetails || '',
    } : emptyForm);
  }, [open, sku]);

  const updateField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    if (!form.name.trim()) return enqueueSnackbar('SKU item name is required', { variant: 'warning' });
    if (!form.code.trim()) return enqueueSnackbar('SKU code is required', { variant: 'warning' });

    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      category: form.category.trim(),
      unit: form.unit || 'PCS',
      pcsPerBox: Number(form.pcsPerBox) || 1,
      weightPerPc: Number(form.weightPerPc) || 0,
      weightPerBox: Number(form.weightPerBox) || 0,
      leadDays: Number(form.leadDays) || 0,
      aliases: form.aliasesText.split(',').map((item) => item.trim()).filter(Boolean),
      packingDetails: form.packingDetails,
    };

    try {
      if (sku?._id) await updateSku({ id: sku._id, ...payload }).unwrap();
      else await createSku(payload).unwrap();
      enqueueSnackbar(sku?._id ? 'SKU updated' : 'SKU added', { variant: 'success' });
      onClose();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to save SKU', { variant: 'error' });
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 520 }, display: 'flex', flexDirection: 'column' } }}>
      <Box sx={{ p: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0' }}>
        <Stack direction="row" spacing={1.3} alignItems="center">
          <Box sx={{ p: 1, borderRadius: '10px', bgcolor: alpha(BRAND.primary, 0.08), display: 'flex', color: BRAND.primary }}>
            <PackagePlus size={20} />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={900}>{sku?._id ? 'Edit SKU Item' : 'Add SKU Item'}</Typography>
            <Typography variant="caption" color="text.secondary">Item name and SKU code master</Typography>
          </Box>
        </Stack>
        <IconButton onClick={onClose}><X size={18} /></IconButton>
      </Box>

      <Box sx={{ p: 2.5, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField label="SKU Item Name" value={form.name} onChange={(e) => updateField('name', e.target.value)} fullWidth />
        <TextField label="SKU Code" value={form.code} onChange={(e) => updateField('code', e.target.value.toUpperCase())} fullWidth />
        <TextField label="Category" value={form.category} onChange={(e) => updateField('category', e.target.value)} fullWidth />
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
          <TextField label="Unit" value={form.unit} onChange={(e) => updateField('unit', e.target.value.toUpperCase())} />
          <TextField label="Lead Days" type="number" value={form.leadDays} onChange={(e) => updateField('leadDays', e.target.value)} />
          <TextField label="Pcs Per Box" type="number" value={form.pcsPerBox} onChange={(e) => updateField('pcsPerBox', e.target.value)} />
          <TextField label="Weight Per Pc" type="number" value={form.weightPerPc} onChange={(e) => updateField('weightPerPc', e.target.value)} />
          <TextField label="Weight Per Box" type="number" value={form.weightPerBox} onChange={(e) => updateField('weightPerBox', e.target.value)} />
        </Box>
        <TextField label="Aliases" value={form.aliasesText} onChange={(e) => updateField('aliasesText', e.target.value)} helperText="Comma separated old names or alternate spellings" fullWidth />
        <TextField label="Packing Details" value={form.packingDetails} onChange={(e) => updateField('packingDetails', e.target.value)} minRows={3} multiline fullWidth />
      </Box>

      <Box sx={{ p: 2.5, borderTop: '1px solid #e2e8f0', display: 'flex', gap: 1.5, bgcolor: '#f8fafc' }}>
        <Button variant="outlined" onClick={onClose} fullWidth>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={isSaving} startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} fullWidth>
          Save SKU
        </Button>
      </Box>
    </Drawer>
  );
};

const SkusList = () => {
  const { enqueueSnackbar } = useSnackbar();
  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 25 });
  const [searchTerm, setSearchTerm] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedSku, setSelectedSku] = useState(null);
  const [bulkUpsertSkus, { isLoading: isImporting }] = useBulkUpsertSkusMutation();

  const { data, isLoading } = useGetSkusQuery({
    page: paginationModel.page + 1,
    limit: paginationModel.pageSize,
    search: searchTerm || undefined,
    sort: 'name',
  });

  const handleAdd = () => {
    setSelectedSku(null);
    setDrawerOpen(true);
  };

  const handleEdit = (sku) => {
    setSelectedSku(sku);
    setDrawerOpen(true);
  };

  const handleImportSheetItems = async () => {
    try {
      await bulkUpsertSkus({ items: sheetSkuItems }).unwrap();
      enqueueSnackbar('Sheet SKU items loaded into master', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to load SKU items', { variant: 'error' });
    }
  };

  const columns = [
    { field: 'name', headerName: 'SKU ITEM NAME', flex: 1, minWidth: 240,
      renderCell: (p) => <Typography variant="body2" fontWeight={800}>{p.value}</Typography>
    },
    { field: 'code', headerName: 'SKU CODE', width: 160,
      renderCell: (p) => <Typography variant="body2" fontWeight={900} color="primary.main">{p.value}</Typography>
    },
    { field: 'category', headerName: 'CATEGORY', width: 150,
      renderCell: (p) => (
        <Box sx={{ px: 1.3, py: 0.45, borderRadius: '8px', bgcolor: alpha(BRAND.wip, 0.07), color: BRAND.wip, fontSize: '0.7rem', fontWeight: 800 }}>
          {p.value || 'General'}
        </Box>
      )
    },
    { field: 'pcsPerBox', headerName: 'PCS/BOX', width: 100, align: 'center', headerAlign: 'center',
      renderCell: (p) => <Typography variant="body2" fontWeight={700}>{p.value || '-'}</Typography>
    },
    { field: 'weightPerPc', headerName: 'WT/PC', width: 95, align: 'right', headerAlign: 'right',
      renderCell: (p) => <Typography variant="body2" fontWeight={700}>{p.value ? Number(p.value).toFixed(3) : '-'}</Typography>
    },
    { field: 'actions', headerName: '', width: 70, sortable: false, align: 'center',
      renderCell: (p) => (
        <Tooltip title="Edit SKU">
          <IconButton size="small" onClick={() => handleEdit(p.row)} sx={{ color: BRAND.primary }}>
            <Edit3 size={15} />
          </IconButton>
        </Tooltip>
      )
    },
  ];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: { xs: 2, sm: 3 }, minHeight: '100vh', bgcolor: '#f8fafc' }}>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' }, gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: { xs: '1.15rem', sm: '1.25rem' }, fontWeight: 700, color: '#0b2545', letterSpacing: '-0.015em', lineHeight: 1.25 }}>SKU Master</Typography>
          <Typography sx={{ fontSize: '0.8125rem', color: 'text.secondary', fontWeight: 500, mt: 0.25 }}>Item names and SKU codes used in order entry</Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ width: { xs: '100%', md: 'auto' } }}>
          <TextField size="small" placeholder="Search SKU item or code" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ width: { xs: '100%', sm: 270 }, '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} color="#94a3b8" /></InputAdornment> }}
          />
          <Button variant="outlined" startIcon={isImporting ? <CircularProgress size={16} /> : <Upload size={16} />} disabled={isImporting} onClick={handleImportSheetItems} sx={{ bgcolor: '#fff' }}>
            Load Sheet SKUs
          </Button>
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={handleAdd}>
            Add SKU
          </Button>
        </Stack>
      </Box>

      <Paper sx={{ flexGrow: 1, borderRadius: '14px', overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
        <DataGrid
          rows={data?.data || []}
          columns={columns}
          getRowId={(row) => row._id}
          loading={isLoading}
          paginationMode="server"
          rowCount={data?.meta?.total || 0}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 25, 50, 100]}
          disableRowSelectionOnClick
          rowHeight={48}
          columnHeaderHeight={44}
          sx={{ border: 0 }}
        />
      </Paper>

      <Divider sx={{ display: 'none' }} />
      <SkuDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} sku={selectedSku} />
    </Box>
  );
};

export default SkusList;
