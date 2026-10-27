import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSmartBack } from '../../../hooks/useSmartBack';
import {
  Box, Paper, Stack, Typography, alpha, useTheme, Button, IconButton, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, Skeleton, Grid, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, Tooltip, Autocomplete,
} from '@mui/material';
import {
  ArrowLeft, Store, Plus, Pencil, Trash2, Mail, Phone, MapPin, Package, X,
  Building2, Percent, CalendarClock, IndianRupee, History, ArrowRight,
} from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useGetVendorByIdQuery, useUpdateVendorMutation, useGetVendorPricingHistoryQuery } from '../../../store/api/vendorApi';
import { useGetSkuLookupQuery } from '../../../store/api/skuApi';
import { PFMS, pfmsPageSx, pfmsCardSx } from '../pfmsTheme';
import VendorPoHistory from './VendorPoHistory';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const SOURCE_LABEL = { VENDOR_MASTER: 'Vendor Master', PURCHASE_ORDER: 'Purchase Order' };

// Purchase FMS rule: Finished Goods are sell-side only — a vendor never supplies
// them. Mirrors IndentFormDrawer.jsx's isPurchasableSku so the picker here can't
// offer a product this vendor could never actually be a source for.
const FG_BLOCKED = new Set(['FINISHED_GOOD', 'FG', 'SALE_PRODUCT', 'READY_STOCK_PRODUCT']);
const isPurchasableSku = (s) => !FG_BLOCKED.has(String(s?.itemType || '').toUpperCase());

const BRAND = '#1d4ed8';
const BRAND_DK = '#1e3a8a';
const num = (n) => Number(n || 0).toLocaleString('en-IN');

// Build a COMPLETE vendor payload so the update never wipes fields via Joi defaults.
const buildPayload = (v, overrides = {}) => ({
  name: v.name,
  contactPerson: v.contactPerson || '',
  phone: v.phone || '',
  email: v.email || '',
  address: v.address || '',
  location: v.location || '',
  state: v.state || '',
  gstNo: v.gstNo || '',
  panNo: v.panNo || '',
  gstRate: v.gstRate || 0,
  tdsRate: v.tdsRate || 0,
  creditPeriodDays: v.creditPeriodDays || 0,
  isActive: v.isActive !== false,
  toEmails: v.toEmails || [],
  ccEmails: v.ccEmails || [],
  bccEmails: v.bccEmails || [],
  products: (v.products || []).map((p) => ({
    // Keep the row id so the server can diff a renamed product against its
    // previous rate (pricing history) instead of treating it as a new SKU.
    _id: p._id || undefined,
    skuId: p.skuId || null, productName: p.productName || '', skuCode: p.skuCode || '',
    unit: p.unit || 'Pcs', rate: p.rate || 0, gstRate: p.gstRate || 0, hsn: p.hsn || '', notes: p.notes || '',
  })),
  ...overrides,
});

const Field = ({ icon: Icon, label, value }) => (
  <Stack direction="row" spacing={1} alignItems="flex-start">
    <Box sx={{ color: 'text.secondary', mt: 0.2 }}><Icon size={15} /></Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.85rem', fontWeight: 600, color: 'text.primary', whiteSpace: 'pre-line' }}>{value || '—'}</Typography>
    </Box>
  </Stack>
);

const emptyProduct = { productName: '', skuCode: '', skuId: '', unit: 'Pcs', rate: '', gstRate: '', notes: '' };

const VendorDetail = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const goBack = useSmartBack('/procurement/vendors');
  const { id } = useParams();
  const { enqueueSnackbar } = useSnackbar();

  const { data: res, isLoading } = useGetVendorByIdQuery(id);
  const vendor = res?.data;
  const [updateVendor, { isLoading: saving }] = useUpdateVendorMutation();

  const [prodDialog, setProdDialog] = useState(null);
  const [editVendor, setEditVendor] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // SKU master — source of truth for a product's Unit, same as the Indent
  // form. Only fetched while the Add/Edit Product dialog is actually open.
  const { data: skuRes, isLoading: skusLoading } = useGetSkuLookupQuery({ limit: 2000 }, { skip: !prodDialog });
  const skuOptions = (skuRes?.data || []).filter(isPurchasableSku);

  const { data: historyRes, isFetching: historyLoading } = useGetVendorPricingHistoryQuery({ id }, { skip: !historyOpen });
  const history = historyRes?.data || [];

  const products = vendor?.products || [];

  const saveProducts = async (nextProducts, msg) => {
    try {
      await updateVendor({ id, ...buildPayload(vendor, { products: nextProducts }) }).unwrap();
      enqueueSnackbar(msg, { variant: 'success' });
      setProdDialog(null);
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not save', { variant: 'error' });
    }
  };

  const submitProduct = () => {
    const d = prodDialog.draft;
    if (!d.productName.trim()) { enqueueSnackbar('Product name is required', { variant: 'warning' }); return; }
    const cleanProd = {
      productName: d.productName.trim(), skuCode: (d.skuCode || '').trim(), skuId: d.skuId || null, unit: d.unit || 'Pcs',
      rate: Number(d.rate || 0), gstRate: Number(d.gstRate || 0), notes: (d.notes || '').trim(),
    };
    const list = products.map((p) => ({ ...p }));
    if (prodDialog.mode === 'edit') list[prodDialog.index] = { ...list[prodDialog.index], ...cleanProd };
    else list.push(cleanProd);
    saveProducts(list, prodDialog.mode === 'edit' ? 'Product updated' : 'Product added');
  };

  const deleteProduct = (index) => {
    if (!window.confirm('Remove this product from the vendor?')) return;
    saveProducts(products.filter((_, i) => i !== index), 'Product removed');
  };

  const saveVendor = async () => {
    try {
      const v = editVendor;
      const splitEmails = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
      await updateVendor({ id, ...buildPayload(vendor, {
        contactPerson: v.contactPerson, phone: v.phone, email: v.email, address: v.address,
        gstNo: v.gstNo, panNo: v.panNo, gstRate: Number(v.gstRate || 0), tdsRate: Number(v.tdsRate || 0),
        creditPeriodDays: Number(v.creditPeriodDays || 0),
        toEmails: splitEmails(v.toEmails), ccEmails: splitEmails(v.ccEmails), bccEmails: splitEmails(v.bccEmails),
      }) }).unwrap();
      enqueueSnackbar('Vendor updated', { variant: 'success' });
      setEditVendor(null);
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not save', { variant: 'error' });
    }
  };

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rounded" height={520} /></Box>;
  if (!vendor) return <Box sx={{ p: 3 }}><Typography>Vendor not found.</Typography></Box>;

  return (
    <Box sx={{ ...pfmsPageSx, p: { xs: 1.5, md: 2.5 } }}>
      <Button startIcon={<ArrowLeft size={16} />} onClick={goBack} sx={{ mb: 1.5, fontWeight: 700 }}>
        Back to vendors
      </Button>

      {/* Profile */}
      <Paper sx={{ ...pfmsCardSx, p: { xs: 2, sm: 2.5 }, mb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1.5} sx={{ mb: 2 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box sx={{ width: 44, height: 44, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(BRAND, 0.1), color: BRAND, border: `1px solid ${alpha(BRAND, 0.2)}` }}>
              <Store size={22} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: PFMS.ink, lineHeight: 1.1 }}>{vendor.name}</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 0.4 }}>
                <Chip size="small" icon={<Package size={12} />} label={`${products.length} product${products.length === 1 ? '' : 's'}`} sx={{ fontWeight: 700, bgcolor: alpha(BRAND, 0.08), color: BRAND_DK }} />
                {vendor.gstNo && <Chip size="small" label={vendor.gstNo} variant="outlined" sx={{ fontWeight: 700 }} />}
              </Stack>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<History size={14} />} onClick={() => setHistoryOpen(true)}>
              Pricing History
            </Button>
            <Button variant="outlined" startIcon={<Pencil size={14} />} onClick={() => setEditVendor({
              contactPerson: vendor.contactPerson || '', phone: vendor.phone || '', email: vendor.email || '',
              address: vendor.address || '', gstNo: vendor.gstNo || '', panNo: vendor.panNo || '',
              gstRate: vendor.gstRate || 0, tdsRate: vendor.tdsRate || 0, creditPeriodDays: vendor.creditPeriodDays || 0,
              toEmails: (vendor.toEmails || []).join(', '), ccEmails: (vendor.ccEmails || []).join(', '), bccEmails: (vendor.bccEmails || []).join(', '),
            })}>
              Edit details
            </Button>
          </Stack>
        </Stack>

        <Grid container spacing={2}>
          <Grid item xs={12} sm={6} md={4}><Field icon={Building2} label="Contact Person" value={vendor.contactPerson} /></Grid>
          <Grid item xs={12} sm={6} md={4}><Field icon={Phone} label="Phone" value={vendor.phone} /></Grid>
          <Grid item xs={12} sm={6} md={4}><Field icon={Mail} label="Email" value={vendor.email} /></Grid>
          <Grid item xs={12} sm={6} md={4}><Field icon={MapPin} label="Address" value={vendor.address || vendor.location} /></Grid>
          <Grid item xs={12} sm={6} md={4}><Field icon={Percent} label="GST No / PAN" value={`${vendor.gstNo || '—'}  ·  ${vendor.panNo || '—'}`} /></Grid>
          <Grid item xs={12} sm={6} md={4}><Field icon={CalendarClock} label="Credit / TDS" value={`${vendor.creditPeriodDays || 0} days  ·  TDS ${vendor.tdsRate || 0}%`} /></Grid>
          <Grid item xs={12} sm={6} md={4}><Field icon={Mail} label="To Emails" value={(vendor.toEmails || []).join(', ')} /></Grid>
          <Grid item xs={12} sm={6} md={4}><Field icon={Mail} label="CC Emails" value={(vendor.ccEmails || []).join(', ')} /></Grid>
          <Grid item xs={12} sm={6} md={4}><Field icon={Mail} label="BCC Emails" value={(vendor.bccEmails || []).join(', ')} /></Grid>
        </Grid>
      </Paper>

      {/* Products */}
      <Paper sx={{ ...pfmsCardSx, overflow: 'hidden' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${theme.palette.divider}` }}>
          <Typography sx={{ fontWeight: 800, color: BRAND_DK }}>Supplied Products & Rates</Typography>
          <Button variant="contained" size="small" startIcon={<Plus size={15} />} onClick={() => setProdDialog({ mode: 'add', draft: { ...emptyProduct } })}>
            Add Product
          </Button>
        </Stack>
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 720, '& td, & th': { fontSize: '0.8rem' } }}>
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(BRAND, 0.05) }}>
                <TableCell sx={{ fontWeight: 800 }}>#</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Product</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>SKU Code</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Unit</TableCell>
                <TableCell sx={{ fontWeight: 800 }} align="right">Rate ₹</TableCell>
                <TableCell sx={{ fontWeight: 800 }} align="right">GST %</TableCell>
                <TableCell sx={{ fontWeight: 800 }}>Notes</TableCell>
                <TableCell sx={{ fontWeight: 800 }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {products.map((p, i) => (
                <TableRow key={p._id || i} hover>
                  <TableCell sx={{ color: 'text.disabled' }}>{i + 1}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{p.productName || '—'}</TableCell>
                  <TableCell>{p.skuCode || '—'}</TableCell>
                  <TableCell>{p.unit || '—'}</TableCell>
                  <TableCell align="right">{p.rate != null ? num(p.rate) : '—'}</TableCell>
                  <TableCell align="right">{p.gstRate || 0}%</TableCell>
                  <TableCell sx={{ color: 'text.secondary', maxWidth: 200, whiteSpace: 'normal' }}>{p.notes || '—'}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit"><IconButton size="small" onClick={() => setProdDialog({ mode: 'edit', index: i, draft: { productName: p.productName || '', skuCode: p.skuCode || '', skuId: p.skuId || '', unit: p.unit || 'Pcs', rate: p.rate ?? '', gstRate: p.gstRate ?? '', notes: p.notes || '' } })}><Pencil size={15} /></IconButton></Tooltip>
                    <Tooltip title="Remove"><IconButton size="small" color="error" onClick={() => deleteProduct(i)}><Trash2 size={15} /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {products.length === 0 && (
                <TableRow><TableCell colSpan={8} sx={{ textAlign: 'center', color: 'text.disabled', py: 3 }}>
                  No products yet — click <strong>Add Product</strong> to add what this vendor supplies.
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </Box>
      </Paper>

      {/* Purchase Orders raised against this vendor (derived from the PO records) */}
      <VendorPoHistory vendorId={id} />

      {/* Add / Edit product dialog */}
      <Dialog open={Boolean(prodDialog)} onClose={() => setProdDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography sx={{ fontWeight: 800 }}>{prodDialog?.mode === 'edit' ? 'Edit Product' : 'Add Product'}</Typography>
            <IconButton size="small" onClick={() => setProdDialog(null)}><X size={18} /></IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {prodDialog && (
            <Grid container spacing={1.5} sx={{ mt: 0 }}>
              <Grid item xs={12}>
                <Autocomplete
                  size="small"
                  freeSolo
                  options={skuOptions}
                  loading={skusLoading}
                  getOptionLabel={(o) => (typeof o === 'string' ? o : o.name || '')}
                  value={prodDialog.draft.productName}
                  onInputChange={(_e, v, reason) => {
                    // A free-typed name is no longer the picked SKU — clear the
                    // link so Unit stays whatever the user has, not a stale SKU's.
                    if (reason === 'input') setProdDialog((s) => ({ ...s, draft: { ...s.draft, productName: v, skuId: '' } }));
                  }}
                  onChange={(_e, val) => {
                    if (val && typeof val === 'object') {
                      // Auto-fill SKU Code + Unit from the SKU master on pick — same
                      // source Indent uses — but both stay editable right after.
                      setProdDialog((s) => ({ ...s, draft: {
                        ...s.draft, productName: val.name, skuCode: val.code || '', skuId: val._id || '', unit: val.unit || s.draft.unit,
                      } }));
                    }
                  }}
                  renderInput={(params) => (
                    <TextField {...params} fullWidth label="Product Name *" placeholder="Pick a SKU or type a name" />
                  )}
                />
              </Grid>
              <Grid item xs={6}><TextField fullWidth size="small" label="SKU Code" value={prodDialog.draft.skuCode} onChange={(e) => setProdDialog((s) => ({ ...s, draft: { ...s.draft, skuCode: e.target.value, skuId: '' } }))} /></Grid>
              <Grid item xs={6}><TextField fullWidth size="small" label="Unit" value={prodDialog.draft.unit} onChange={(e) => setProdDialog((s) => ({ ...s, draft: { ...s.draft, unit: e.target.value } }))} /></Grid>
              <Grid item xs={6}><TextField fullWidth size="small" type="number" label="Rate ₹" value={prodDialog.draft.rate} onChange={(e) => setProdDialog((s) => ({ ...s, draft: { ...s.draft, rate: e.target.value } }))} InputProps={{ startAdornment: <IndianRupee size={13} style={{ marginRight: 4 }} /> }} /></Grid>
              <Grid item xs={6}><TextField fullWidth size="small" type="number" label="GST %" value={prodDialog.draft.gstRate} onChange={(e) => setProdDialog((s) => ({ ...s, draft: { ...s.draft, gstRate: e.target.value } }))} /></Grid>
              <Grid item xs={12}><TextField fullWidth size="small" label="Notes (grade / spec)" value={prodDialog.draft.notes} onChange={(e) => setProdDialog((s) => ({ ...s, draft: { ...s.draft, notes: e.target.value } }))} /></Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProdDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={submitProduct} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogActions>
      </Dialog>

      {/* Edit vendor details dialog */}
      <Dialog open={Boolean(editVendor)} onClose={() => setEditVendor(null)} fullWidth maxWidth="sm">
        <DialogTitle>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Typography sx={{ fontWeight: 800 }}>Edit Vendor Details</Typography>
            <IconButton size="small" onClick={() => setEditVendor(null)}><X size={18} /></IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {editVendor && (
            <Grid container spacing={1.5} sx={{ mt: 0 }}>
              <Grid item xs={6}><TextField fullWidth size="small" label="Contact Person" value={editVendor.contactPerson} onChange={(e) => setEditVendor((s) => ({ ...s, contactPerson: e.target.value }))} /></Grid>
              <Grid item xs={6}><TextField fullWidth size="small" label="Phone" value={editVendor.phone} onChange={(e) => setEditVendor((s) => ({ ...s, phone: e.target.value }))} /></Grid>
              <Grid item xs={12}><TextField fullWidth size="small" label="Email" value={editVendor.email} onChange={(e) => setEditVendor((s) => ({ ...s, email: e.target.value }))} /></Grid>
              <Grid item xs={12}><TextField fullWidth size="small" multiline minRows={2} label="Address" value={editVendor.address} onChange={(e) => setEditVendor((s) => ({ ...s, address: e.target.value }))} /></Grid>
              <Grid item xs={6}><TextField fullWidth size="small" label="GST No" value={editVendor.gstNo} onChange={(e) => setEditVendor((s) => ({ ...s, gstNo: e.target.value }))} /></Grid>
              <Grid item xs={6}><TextField fullWidth size="small" label="PAN No" value={editVendor.panNo} onChange={(e) => setEditVendor((s) => ({ ...s, panNo: e.target.value }))} /></Grid>
              <Grid item xs={4}><TextField fullWidth size="small" type="number" label="GST %" value={editVendor.gstRate} onChange={(e) => setEditVendor((s) => ({ ...s, gstRate: e.target.value }))} /></Grid>
              <Grid item xs={4}><TextField fullWidth size="small" type="number" label="TDS %" value={editVendor.tdsRate} onChange={(e) => setEditVendor((s) => ({ ...s, tdsRate: e.target.value }))} /></Grid>
              <Grid item xs={4}><TextField fullWidth size="small" type="number" label="Credit (days)" value={editVendor.creditPeriodDays} onChange={(e) => setEditVendor((s) => ({ ...s, creditPeriodDays: e.target.value }))} /></Grid>
              <Grid item xs={12}><TextField fullWidth size="small" label="To Emails (comma-separated)" value={editVendor.toEmails} onChange={(e) => setEditVendor((s) => ({ ...s, toEmails: e.target.value }))} /></Grid>
              <Grid item xs={6}><TextField fullWidth size="small" label="CC Emails" value={editVendor.ccEmails} onChange={(e) => setEditVendor((s) => ({ ...s, ccEmails: e.target.value }))} /></Grid>
              <Grid item xs={6}><TextField fullWidth size="small" label="BCC Emails" value={editVendor.bccEmails} onChange={(e) => setEditVendor((s) => ({ ...s, bccEmails: e.target.value }))} /></Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditVendor(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveVendor} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogActions>
      </Dialog>

      {/* Pricing history dialog */}
      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} fullWidth maxWidth="lg">
        <DialogTitle>
          <Stack direction="row" alignItems="center" justifyContent="space-between">
            <Stack direction="row" spacing={1} alignItems="center">
              <History size={18} />
              <Typography sx={{ fontWeight: 800 }}>Pricing History — {vendor.name}</Typography>
            </Stack>
            <IconButton size="small" onClick={() => setHistoryOpen(false)}><X size={18} /></IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 860, '& td, & th': { fontSize: '0.8rem' } }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(BRAND, 0.05) }}>
                  {['Date', 'SKU', 'Item', 'Old Rate', 'New Rate', 'GST %', 'Source', 'Reference', 'Updated By', 'Remarks'].map((h) => (
                    <TableCell key={h} sx={{ fontWeight: 800, whiteSpace: 'nowrap' }} align={['Old Rate', 'New Rate', 'GST %'].includes(h) ? 'right' : 'left'}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h._id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDate(h.effectiveDate || h.createdAt)}</TableCell>
                    <TableCell sx={{ fontWeight: 700, color: BRAND_DK }}>{h.skuCode || '—'}</TableCell>
                    <TableCell>{h.itemName || '—'}</TableCell>
                    <TableCell align="right" sx={{ color: 'text.secondary' }}>{num(h.oldRate)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, color: '#15803d' }}>
                      <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end">
                        <ArrowRight size={12} color="#94a3b8" /><span>{num(h.newRate)}</span>
                      </Stack>
                    </TableCell>
                    <TableCell align="right">{h.oldGstRate !== h.newGstRate ? `${h.oldGstRate}→${h.newGstRate}` : `${h.newGstRate}`}%</TableCell>
                    <TableCell>
                      <Chip size="small" label={SOURCE_LABEL[h.source] || h.source}
                        sx={{ fontWeight: 700, height: 20, bgcolor: h.source === 'PURCHASE_ORDER' ? alpha('#0f766e', 0.12) : alpha(BRAND, 0.1), color: h.source === 'PURCHASE_ORDER' ? '#0f766e' : BRAND_DK }} />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{h.referenceNumber || (h.source === 'VENDOR_MASTER' ? 'Vendor Master' : '—')}</TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{h.updatedBy?.name || h.updatedByName || '—'}</TableCell>
                    <TableCell sx={{ color: 'text.secondary', maxWidth: 200, whiteSpace: 'normal' }}>{h.remarks || '—'}</TableCell>
                  </TableRow>
                ))}
                {!historyLoading && history.length === 0 && (
                  <TableRow><TableCell colSpan={10} sx={{ textAlign: 'center', color: 'text.disabled', py: 4 }}>
                    No pricing changes recorded yet. Updating a rate in the Vendor Master or a Purchase Order will appear here.
                  </TableCell></TableRow>
                )}
                {historyLoading && (
                  <TableRow><TableCell colSpan={10} sx={{ textAlign: 'center', py: 4 }}>Loading…</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VendorDetail;
