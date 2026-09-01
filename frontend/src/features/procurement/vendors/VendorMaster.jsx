import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Paper, Stack, Typography, alpha, useTheme, ToggleButtonGroup, ToggleButton,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, InputAdornment, Chip,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, Grid, IconButton, Divider, Tooltip,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Store, Table as TableIcon, Rows3, Search, Package, Plus, X, Trash2, IndianRupee } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useGetVendorsQuery, useCreateVendorMutation } from '../../../store/api/vendorApi';

const emptyRow = () => ({ productName: '', skuCode: '', unit: 'Pcs', rate: '', gstRate: '', notes: '' });
const emptyVendor = () => ({
  name: '', contactPerson: '', phone: '', email: '', address: '', gstNo: '', panNo: '',
  gstRate: '', tdsRate: '', creditPeriodDays: '', toEmails: '', ccEmails: '', bccEmails: '',
  products: [emptyRow()],
});

const BRAND = '#1d4ed8';
const BRAND_DK = '#1e3a8a';
const num = (n) => Number(n || 0).toLocaleString('en-IN');

// Flatten vendor × product into spreadsheet rows for the Excel view.
const EXCEL_COLS = [
  'Vendor', 'Contact', 'Phone', 'Email', 'Product', 'Unit', 'Rate', 'GST %',
  'GST No', 'PAN', 'Credit', 'TDS %', 'Address',
];

const VendorMaster = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const [view, setView] = useState('vendors');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(null); // new-vendor dialog draft (null = closed)

  const { data, isLoading } = useGetVendorsQuery({ limit: 1000, sort: 'name' });
  const [createVendor, { isLoading: creating }] = useCreateVendorMutation();
  const vendors = useMemo(() => data?.data || [], [data]);

  const setField = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setRow = (i, k, v) => setDraft((d) => ({ ...d, products: d.products.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)) }));
  const addRow = () => setDraft((d) => ({ ...d, products: [...d.products, emptyRow()] }));
  const removeRow = (i) => setDraft((d) => ({ ...d, products: d.products.filter((_, idx) => idx !== i) }));

  const submitVendor = async () => {
    if (!draft.name.trim()) { enqueueSnackbar('Vendor name is required', { variant: 'warning' }); return; }
    const splitEmails = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
    const payload = {
      name: draft.name.trim(),
      contactPerson: draft.contactPerson, phone: draft.phone, email: draft.email, address: draft.address,
      gstNo: draft.gstNo, panNo: draft.panNo,
      gstRate: Number(draft.gstRate || 0), tdsRate: Number(draft.tdsRate || 0),
      creditPeriodDays: Number(draft.creditPeriodDays || 0),
      toEmails: splitEmails(draft.toEmails), ccEmails: splitEmails(draft.ccEmails), bccEmails: splitEmails(draft.bccEmails),
      products: draft.products
        .filter((r) => r.productName.trim())
        .map((r) => ({ productName: r.productName.trim(), skuCode: (r.skuCode || '').trim(), unit: r.unit || 'Pcs', rate: Number(r.rate || 0), gstRate: Number(r.gstRate || 0), notes: (r.notes || '').trim() })),
    };
    try {
      const res = await createVendor(payload).unwrap();
      enqueueSnackbar('Vendor created', { variant: 'success' });
      setDraft(null);
      const newId = res?.data?._id;
      if (newId) navigate(`/procurement/vendors/${newId}`);
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not create vendor', { variant: 'error' });
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter((v) => (
      `${v.name} ${v.contactPerson || ''} ${v.phone || ''} ${v.gstNo || ''} ${(v.products || []).map((p) => p.productName).join(' ')}`
        .toLowerCase().includes(q)
    ));
  }, [vendors, search]);

  // Excel rows — one line per supplied product (vendors with none still show once).
  const excelRows = useMemo(() => {
    const out = [];
    filtered.forEach((v) => {
      const base = {
        Vendor: v.name, Contact: v.contactPerson || '—', Phone: v.phone || '—', Email: v.email || '—',
        'GST No': v.gstNo || '—', PAN: v.panNo || '—', Credit: `${v.creditPeriodDays || 0}d`,
        'TDS %': `${v.tdsRate || 0}%`, Address: v.address || v.location || '—',
      };
      const prods = v.products || [];
      if (!prods.length) { out.push({ ...base, Product: '—', Unit: '—', Rate: '—', 'GST %': '—' }); return; }
      prods.forEach((p) => out.push({
        ...base, Product: p.productName || '—', Unit: p.unit || '—',
        Rate: p.rate != null ? num(p.rate) : '—', 'GST %': `${p.gstRate || 0}%`,
      }));
    });
    return out;
  }, [filtered]);

  const columns = [
    { field: 'name', headerName: 'Vendor', flex: 1.4, minWidth: 200,
      renderCell: (p) => <Typography variant="body2" fontWeight={700} color={BRAND_DK}>{p.value}</Typography> },
    { field: 'contactPerson', headerName: 'Contact Person', flex: 1, minWidth: 150,
      valueGetter: (v, r) => r.contactPerson || '—' },
    { field: 'phone', headerName: 'Phone', width: 130, valueGetter: (v, r) => r.phone || '—' },
    { field: 'products', headerName: 'Products', width: 110, align: 'center', headerAlign: 'center', sortable: false,
      renderCell: (p) => {
        const n = (p.row.products || []).length;
        return n ? (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.4, borderRadius: '8px', bgcolor: alpha(BRAND, 0.08), color: BRAND, fontSize: '0.72rem', fontWeight: 700 }}>
            <Package size={13} /> {n}
          </Box>
        ) : <Typography variant="caption" color="text.disabled">—</Typography>;
      } },
    { field: 'gstNo', headerName: 'GST No', flex: 1, minWidth: 160, valueGetter: (v, r) => r.gstNo || '—' },
    { field: 'creditPeriodDays', headerName: 'Credit', width: 100, align: 'center', headerAlign: 'center',
      valueGetter: (v, r) => `${r.creditPeriodDays || 0} d` },
  ];

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2.5 }, minHeight: '100vh' }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5} sx={{ mb: 2, px: 0.5, flexWrap: 'wrap', rowGap: 1 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(BRAND, 0.1), color: BRAND, border: `1px solid ${alpha(BRAND, 0.2)}` }}>
            <Store size={21} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: { xs: '1.15rem', sm: '1.35rem' }, fontWeight: 800, color: BRAND_DK, lineHeight: 1.1 }}>Master Vendor (2)</Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
              Every vendor with their products, rates, GST &amp; contact — grouped per vendor.
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Chip label={`${filtered.length} vendor${filtered.length === 1 ? '' : 's'}`} sx={{ fontWeight: 700, bgcolor: alpha(BRAND, 0.08), color: BRAND_DK }} />
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setDraft(emptyVendor())}>
            Add Vendor
          </Button>
        </Stack>
      </Stack>

      <Paper sx={{ borderRadius: 2.5, overflow: 'hidden', border: `1px solid ${theme.palette.divider}` }}>
        {/* Toolbar */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.5, py: 1, flexWrap: 'wrap', rowGap: 1, borderBottom: `1px solid ${theme.palette.divider}` }}>
          <TextField
            size="small" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendor / product / GST…"
            sx={{ width: { xs: '100%', sm: 300 }, '& .MuiInputBase-root': { height: 36 } }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search size={15} /></InputAdornment> }}
          />
          <Box sx={{ flex: 1 }} />
          <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
            <ToggleButton value="vendors" sx={{ px: 1.25, py: 0.4, textTransform: 'none', gap: 0.5, fontWeight: 700 }}>
              <TableIcon size={15} /> Vendors
            </ToggleButton>
            <ToggleButton value="excel" sx={{ px: 1.25, py: 0.4, textTransform: 'none', gap: 0.5, fontWeight: 700 }}>
              <Rows3 size={15} /> Excel
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        {/* Vendors table */}
        {view === 'vendors' && (
          <Box sx={{ px: 1.5, pb: 1.5 }}>
            <DataGrid
              rows={filtered} columns={columns} getRowId={(r) => r._id} loading={isLoading}
              autoHeight density="compact" onRowClick={(p) => navigate(`/procurement/vendors/${p.id}`)}
              initialState={{ pagination: { paginationModel: { pageSize: 25 } } }}
              pageSizeOptions={[25, 50, 100]} disableRowSelectionOnClick
              sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' }, '& .MuiDataGrid-columnHeaders': { bgcolor: alpha(BRAND, 0.04) } }}
            />
          </Box>
        )}

        {/* Excel view */}
        {view === 'excel' && (
          <Box sx={{ px: 1.5, pb: 1.5, overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 1100, '& td, & th': { border: `1px solid ${theme.palette.divider}`, fontSize: '0.76rem', px: 1, py: 0.55, whiteSpace: 'nowrap' } }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(BRAND, 0.06) }}>
                  <TableCell sx={{ fontWeight: 800 }}>#</TableCell>
                  {EXCEL_COLS.map((c) => <TableCell key={c} sx={{ fontWeight: 800 }}>{c}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {excelRows.map((row, i) => (
                  <TableRow key={i} hover>
                    <TableCell sx={{ color: 'text.disabled' }}>{i + 1}</TableCell>
                    {EXCEL_COLS.map((c) => (
                      <TableCell key={c} sx={c === 'Address' ? { whiteSpace: 'normal', minWidth: 220, maxWidth: 320 } : undefined}>
                        {row[c]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {excelRows.length === 0 && <TableRow><TableCell colSpan={EXCEL_COLS.length + 1} sx={{ textAlign: 'center', color: 'text.disabled', py: 3 }}>No vendors.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>

      {/* ── Add Vendor dialog ── */}
      <Dialog open={Boolean(draft)} onClose={() => setDraft(null)} fullWidth maxWidth="md">
        <DialogTitle>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Stack direction="row" spacing={1} alignItems="center">
              <Store size={20} color={BRAND} />
              <Typography sx={{ fontWeight: 800 }}>Add Vendor</Typography>
            </Stack>
            <IconButton size="small" onClick={() => setDraft(null)}><X size={18} /></IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {draft && (
            <>
              <Grid container spacing={1.5}>
                <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="Vendor Name *" value={draft.name} onChange={(e) => setField('name', e.target.value)} /></Grid>
                <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="Contact Person" value={draft.contactPerson} onChange={(e) => setField('contactPerson', e.target.value)} /></Grid>
                <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="Phone" value={draft.phone} onChange={(e) => setField('phone', e.target.value)} /></Grid>
                <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="Email" value={draft.email} onChange={(e) => setField('email', e.target.value)} /></Grid>
                <Grid item xs={12}><TextField fullWidth size="small" multiline minRows={2} label="Address" value={draft.address} onChange={(e) => setField('address', e.target.value)} /></Grid>
                <Grid item xs={6} sm={3}><TextField fullWidth size="small" label="GST No" value={draft.gstNo} onChange={(e) => setField('gstNo', e.target.value)} /></Grid>
                <Grid item xs={6} sm={3}><TextField fullWidth size="small" label="PAN No" value={draft.panNo} onChange={(e) => setField('panNo', e.target.value)} /></Grid>
                <Grid item xs={4} sm={2}><TextField fullWidth size="small" type="number" label="GST %" value={draft.gstRate} onChange={(e) => setField('gstRate', e.target.value)} /></Grid>
                <Grid item xs={4} sm={2}><TextField fullWidth size="small" type="number" label="TDS %" value={draft.tdsRate} onChange={(e) => setField('tdsRate', e.target.value)} /></Grid>
                <Grid item xs={4} sm={2}><TextField fullWidth size="small" type="number" label="Credit (days)" value={draft.creditPeriodDays} onChange={(e) => setField('creditPeriodDays', e.target.value)} /></Grid>
                <Grid item xs={12} sm={6}><TextField fullWidth size="small" label="To Emails (comma-separated)" value={draft.toEmails} onChange={(e) => setField('toEmails', e.target.value)} /></Grid>
                <Grid item xs={6} sm={3}><TextField fullWidth size="small" label="CC Emails" value={draft.ccEmails} onChange={(e) => setField('ccEmails', e.target.value)} /></Grid>
                <Grid item xs={6} sm={3}><TextField fullWidth size="small" label="BCC Emails" value={draft.bccEmails} onChange={(e) => setField('bccEmails', e.target.value)} /></Grid>
              </Grid>

              <Divider sx={{ my: 2 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>SUPPLIED PRODUCTS</Typography>
              </Divider>

              <Stack spacing={1}>
                {draft.products.map((r, i) => (
                  <Grid container spacing={1} key={i} alignItems="center">
                    <Grid item xs={12} sm={3.5}><TextField fullWidth size="small" placeholder="Product name" value={r.productName} onChange={(e) => setRow(i, 'productName', e.target.value)} /></Grid>
                    <Grid item xs={6} sm={2}><TextField fullWidth size="small" placeholder="SKU code" value={r.skuCode} onChange={(e) => setRow(i, 'skuCode', e.target.value)} /></Grid>
                    <Grid item xs={6} sm={1.5}><TextField fullWidth size="small" placeholder="Unit" value={r.unit} onChange={(e) => setRow(i, 'unit', e.target.value)} /></Grid>
                    <Grid item xs={4} sm={1.5}><TextField fullWidth size="small" type="number" placeholder="Rate" value={r.rate} onChange={(e) => setRow(i, 'rate', e.target.value)} InputProps={{ startAdornment: <IndianRupee size={12} style={{ marginRight: 3 }} /> }} /></Grid>
                    <Grid item xs={4} sm={1.5}><TextField fullWidth size="small" type="number" placeholder="GST %" value={r.gstRate} onChange={(e) => setRow(i, 'gstRate', e.target.value)} /></Grid>
                    <Grid item xs={3} sm={1.5}><TextField fullWidth size="small" placeholder="Notes" value={r.notes} onChange={(e) => setRow(i, 'notes', e.target.value)} /></Grid>
                    <Grid item xs={1} sm={0.5}>
                      <Tooltip title="Remove"><span><IconButton size="small" color="error" onClick={() => removeRow(i)} disabled={draft.products.length === 1}><Trash2 size={15} /></IconButton></span></Tooltip>
                    </Grid>
                  </Grid>
                ))}
                <Button size="small" startIcon={<Plus size={14} />} onClick={addRow} sx={{ alignSelf: 'flex-start', fontWeight: 700 }}>
                  Add product row
                </Button>
              </Stack>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>Cancel</Button>
          <Button variant="contained" onClick={submitVendor} disabled={creating}>{creating ? 'Creating…' : 'Create Vendor'}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VendorMaster;
