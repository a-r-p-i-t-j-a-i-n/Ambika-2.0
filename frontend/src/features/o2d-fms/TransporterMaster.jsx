import React, { useState, useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, alpha, useTheme, TextField, InputAdornment, Chip,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, Grid, IconButton, Tooltip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Truck, Search, Plus, X, Pencil, Trash2 } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetTransportersQuery, useCreateTransporterMutation,
  useUpdateTransporterMutation, useDeleteTransporterMutation,
} from '../../store/api/transporterApi';

const BRAND = '#1d4ed8';
const BRAND_DK = '#1e3a8a';

const emptyDraft = () => ({
  name: '', contactPerson: '', phone: '', altPhone: '', email: '', address: '',
  city: '', state: '', gstNo: '', panNo: '', modes: '', serviceArea: '', remarks: '',
});

const fromDoc = (t) => ({
  name: t.name || '', contactPerson: t.contactPerson || '', phone: t.phone || '', altPhone: t.altPhone || '',
  email: t.email || '', address: t.address || '', city: t.city || '', state: t.state || '',
  gstNo: t.gstNo || '', panNo: t.panNo || '', modes: (t.modes || []).join(', '),
  serviceArea: t.serviceArea || '', remarks: t.remarks || '',
});

const TransporterMaster = () => {
  const theme = useTheme();
  const { enqueueSnackbar } = useSnackbar();
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(null); // { id?, draft }

  const { data, isLoading } = useGetTransportersQuery({ limit: 1000, sort: 'name' });
  const [createTransporter, { isLoading: creating }] = useCreateTransporterMutation();
  const [updateTransporter, { isLoading: updating }] = useUpdateTransporterMutation();
  const [deleteTransporter] = useDeleteTransporterMutation();
  const saving = creating || updating;

  const rows = useMemo(() => data?.data || [], [data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((t) => `${t.name} ${t.contactPerson || ''} ${t.phone || ''} ${t.gstNo || ''} ${t.city || ''}`.toLowerCase().includes(q));
  }, [rows, search]);

  const setField = (k, v) => setDialog((d) => ({ ...d, draft: { ...d.draft, [k]: v } }));

  const submit = async () => {
    const d = dialog.draft;
    if (!d.name.trim()) { enqueueSnackbar('Transporter name is required', { variant: 'warning' }); return; }
    const payload = {
      name: d.name.trim(), contactPerson: d.contactPerson, phone: d.phone, altPhone: d.altPhone,
      email: d.email, address: d.address, city: d.city, state: d.state, gstNo: d.gstNo, panNo: d.panNo,
      serviceArea: d.serviceArea, remarks: d.remarks,
      modes: String(d.modes || '').split(',').map((x) => x.trim()).filter(Boolean),
    };
    try {
      if (dialog.id) await updateTransporter({ id: dialog.id, ...payload }).unwrap();
      else await createTransporter(payload).unwrap();
      enqueueSnackbar(dialog.id ? 'Transporter updated' : 'Transporter added', { variant: 'success' });
      setDialog(null);
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not save', { variant: 'error' });
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this transporter?')) return;
    try { await deleteTransporter(id).unwrap(); enqueueSnackbar('Transporter deleted', { variant: 'success' }); }
    catch (e) { enqueueSnackbar(e?.data?.message || 'Could not delete', { variant: 'error' }); }
  };

  const columns = [
    { field: 'name', headerName: 'Transporter', flex: 1.4, minWidth: 220,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color={BRAND_DK}>{p.value}</Typography> },
    { field: 'contactPerson', headerName: 'Contact', flex: 1, minWidth: 140, valueGetter: (v, r) => r.contactPerson || '—' },
    { field: 'phone', headerName: 'Mobile', width: 140, valueGetter: (v, r) => r.phone || '—' },
    { field: 'email', headerName: 'Email', flex: 1, minWidth: 180, valueGetter: (v, r) => r.email || '—' },
    { field: 'city', headerName: 'City / State', width: 160, valueGetter: (v, r) => [r.city, r.state].filter(Boolean).join(', ') || '—' },
    { field: 'gstNo', headerName: 'GST No', flex: 1, minWidth: 160, valueGetter: (v, r) => r.gstNo || '—' },
    { field: '__actions', headerName: '', width: 90, sortable: false, filterable: false, align: 'center', headerAlign: 'center',
      renderCell: (p) => (
        <>
          <Tooltip title="Edit"><IconButton size="small" onClick={() => setDialog({ id: p.row._id, draft: fromDoc(p.row) })}><Pencil size={15} /></IconButton></Tooltip>
          <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => remove(p.row._id)}><Trash2 size={15} /></IconButton></Tooltip>
        </>
      ) },
  ];

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2.5 }, minHeight: '100vh' }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5} sx={{ mb: 2, px: 0.5, flexWrap: 'wrap', rowGap: 1 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(BRAND, 0.1), color: BRAND, border: `1px solid ${alpha(BRAND, 0.2)}` }}>
            <Truck size={21} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: { xs: '1.15rem', sm: '1.35rem' }, fontWeight: 800, color: BRAND_DK, lineHeight: 1.1 }}>Transporter Master</Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>Logistics partners used on dispatch, challan &amp; e-way.</Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Chip label={`${filtered.length} transporter${filtered.length === 1 ? '' : 's'}`} sx={{ fontWeight: 700, bgcolor: alpha(BRAND, 0.08), color: BRAND_DK }} />
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setDialog({ draft: emptyDraft() })}>Add Transporter</Button>
        </Stack>
      </Stack>

      <Paper sx={{ borderRadius: 2.5, overflow: 'hidden', border: `1px solid ${theme.palette.divider}` }}>
        <Stack direction="row" alignItems="center" sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${theme.palette.divider}` }}>
          <TextField
            size="small" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search transporter / phone / GST…"
            sx={{ width: { xs: '100%', sm: 320 }, '& .MuiInputBase-root': { height: 36 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }}
          />
        </Stack>
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <DataGrid
            rows={filtered} columns={columns} getRowId={(r) => r._id} loading={isLoading}
            autoHeight density="compact" disableRowSelectionOnClick
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }} pageSizeOptions={[25, 50, 100]}
            sx={{ border: 0, '& .MuiDataGrid-columnHeaders': { bgcolor: alpha(BRAND, 0.04) } }}
          />
        </Box>
      </Paper>

      {/* Add / Edit dialog */}
      <Dialog open={Boolean(dialog)} onClose={() => setDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Stack direction="row" spacing={1} alignItems="center">
              <Truck size={20} color={BRAND} />
              <Typography sx={{ fontWeight: 800 }}>{dialog?.id ? 'Edit Transporter' : 'Add Transporter'}</Typography>
            </Stack>
            <IconButton size="small" onClick={() => setDialog(null)}><X size={18} /></IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {dialog && (
            <Grid container spacing={1.5}>
              <Grid item xs={12}><TextField fullWidth size="small" label="Transporter Name *" value={dialog.draft.name} onChange={(e) => setField('name', e.target.value)} /></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="Contact Person" value={dialog.draft.contactPerson} onChange={(e) => setField('contactPerson', e.target.value)} /></Grid>
              <Grid item xs={6} sm={3}><TextField fullWidth size="small" label="Mobile" value={dialog.draft.phone} onChange={(e) => setField('phone', e.target.value)} /></Grid>
              <Grid item xs={6} sm={3}><TextField fullWidth size="small" label="Alt Phone" value={dialog.draft.altPhone} onChange={(e) => setField('altPhone', e.target.value)} /></Grid>
              <Grid item xs={12}><TextField fullWidth size="small" label="Email" value={dialog.draft.email} onChange={(e) => setField('email', e.target.value)} /></Grid>
              <Grid item xs={12}><TextField fullWidth size="small" multiline minRows={2} label="Address" value={dialog.draft.address} onChange={(e) => setField('address', e.target.value)} /></Grid>
              <Grid item xs={6} sm={6}><TextField fullWidth size="small" label="City" value={dialog.draft.city} onChange={(e) => setField('city', e.target.value)} /></Grid>
              <Grid item xs={6} sm={6}><TextField fullWidth size="small" label="State" value={dialog.draft.state} onChange={(e) => setField('state', e.target.value)} /></Grid>
              <Grid item xs={6}><TextField fullWidth size="small" label="GST No" value={dialog.draft.gstNo} onChange={(e) => setField('gstNo', e.target.value)} /></Grid>
              <Grid item xs={6}><TextField fullWidth size="small" label="PAN No" value={dialog.draft.panNo} onChange={(e) => setField('panNo', e.target.value)} /></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="Modes (Road, Rail, Courier…)" value={dialog.draft.modes} onChange={(e) => setField('modes', e.target.value)} /></Grid>
              <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="Service Area" value={dialog.draft.serviceArea} onChange={(e) => setField('serviceArea', e.target.value)} /></Grid>
              <Grid item xs={12}><TextField fullWidth size="small" label="Remarks" value={dialog.draft.remarks} onChange={(e) => setField('remarks', e.target.value)} /></Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={saving}>{saving ? 'Saving…' : (dialog?.id ? 'Save' : 'Add Transporter')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TransporterMaster;
