import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog, Box, Typography, TextField, Button, IconButton, Divider,
  Grid, MenuItem, Autocomplete, CircularProgress, Paper, Tooltip, Chip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { X, Save, ReceiptText, Plus, Trash2, Building2, Upload, FileText, ExternalLink } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetPurchaseOrdersQuery,
  useCreateProformaInvoiceMutation,
  useUpdateProformaInvoiceMutation,
} from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { fileHref } from '../indents/indentMeta';
import { fmtINR } from './piMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

/**
 * Create / edit a Proforma Invoice (Step 1.6).
 * PIs are never standalone — pick a released PO and the vendor + items are
 * pulled from it automatically (editable). PI/unique numbers are generated
 * server-side. Approving later requires the PI document.
 */
const UNITS = ['Pcs', 'Kg', 'Meter', 'Roll', 'Box', 'Set', 'Litre', 'Dozen'];
const GST_PRESETS = [0, 5, 12, 18, 28];
const ACCEPT = '.pdf,image/*';
const todayStr = () => new Date().toISOString().slice(0, 10);

const lineCalc = (it) =>
  (Number(it.quantity) || 0) * (Number(it.rate) || 0) * (1 + (Number(it.gstRate) || 0) / 100);

const emptyItem = () => ({ itemName: '', skuCode: '', skuId: '', quantity: '', unit: 'Pcs', rate: '', gstRate: 18 });

const SECTION = { p: 2.5, borderRadius: '16px', border: '1px solid', borderColor: 'divider' };

const ProformaInvoiceFormDrawer = ({ open, onClose, pi = null, presetPo = null }) => {
  const { enqueueSnackbar } = useSnackbar();
  const fileRef = useRef(null);
  const isEdit = Boolean(pi?._id);

  const [po, setPo] = useState(null);
  const [piDate, setPiDate] = useState(todayStr());
  const [items, setItems] = useState([emptyItem()]);
  const [doc, setDoc] = useState(null); // { fileName, fileUrl, fileType }
  const [remarks, setRemarks] = useState('');

  const [createPi, { isLoading: creating }] = useCreateProformaInvoiceMutation();
  const [updatePi, { isLoading: updating }] = useUpdateProformaInvoiceMutation();
  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();
  const saving = creating || updating;

  // Released POs only (backend also blocks duplicates per PO).
  const { data: posRes, isLoading: posLoading } = useGetPurchaseOrdersQuery(
    { limit: 200, sort: '-releasedAt', poStatus: 'RELEASED_TO_VENDOR' },
    { skip: !open || isEdit },
  );
  const poOptions = posRes?.data || [];

  useEffect(() => {
    if (!open) return;
    if (pi) {
      setPo({ _id: pi.poId, poNumber: pi.poNumber, vendorName: pi.vendorName });
      setPiDate(pi.piDate ? pi.piDate.slice(0, 10) : todayStr());
      setItems(pi.items?.length ? pi.items.map((it) => ({
        itemName: it.itemName, skuCode: it.skuCode || '', skuId: it.skuId || '',
        quantity: it.quantity, unit: it.unit || 'Pcs', rate: it.rate, gstRate: it.gstRate,
      })) : [emptyItem()]);
      setDoc(pi.piDocument?.fileUrl ? { ...pi.piDocument } : null);
      setRemarks(pi.remarks || '');
    } else {
      setPiDate(todayStr());
      setDoc(null);
      setRemarks('');
      if (presetPo) applyPo(presetPo);
      else { setPo(null); setItems([emptyItem()]); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pi, presetPo]);

  // Rule 3: pull items from the selected PO.
  const applyPo = (p) => {
    setPo(p);
    if (p?.items?.length) {
      setItems(p.items.map((it) => ({
        itemName: it.itemName, skuCode: it.skuCode || '', skuId: it.skuId || '',
        quantity: it.quantity, unit: it.unit || 'Pcs', rate: it.rate, gstRate: it.gstRate,
      })));
    }
  };

  const setItem = (idx, patch) => setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const addItem = () => setItems((cur) => [...cur, emptyItem()]);
  const removeItem = (idx) => setItems((cur) => (cur.length > 1 ? cur.filter((_, i) => i !== idx) : [emptyItem()]));

  const totalValue = useMemo(() => items.reduce((s, it) => s + lineCalc(it), 0), [items]);
  const paidAmount = pi?.paidAmount || 0;
  const validItems = items.filter((it) => it.itemName?.trim() && Number(it.quantity) > 0);

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { enqueueSnackbar('File exceeds 10 MB', { variant: 'warning' }); return; }
    try {
      const res = await uploadDoc(f).unwrap();
      const d = res?.data || {};
      setDoc({ fileName: d.fileName || f.name, fileUrl: d.url, fileType: d.mimeType || f.type });
      enqueueSnackbar('PI document uploaded', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Upload failed', { variant: 'error' });
    }
  };

  const handleSubmit = async () => {
    if (!isEdit && !po?._id) { enqueueSnackbar('Select a released PO first', { variant: 'warning' }); return; }
    if (validItems.length === 0) { enqueueSnackbar('Add at least one item with quantity', { variant: 'warning' }); return; }

    const payload = {
      piDate,
      items: validItems.map((it) => ({
        itemName: it.itemName.trim(), skuCode: it.skuCode?.trim() || '',
        skuId: it.skuId || undefined,
        quantity: Number(it.quantity), unit: it.unit || 'Pcs',
        rate: Number(it.rate) || 0, gstRate: Number(it.gstRate) || 0,
      })),
      piDocument: doc ? { fileName: doc.fileName, fileUrl: doc.fileUrl, fileType: doc.fileType } : undefined,
      remarks: remarks.trim(),
    };

    try {
      if (isEdit) {
        await updatePi({ id: pi._id, ...payload }).unwrap();
        enqueueSnackbar('Proforma invoice updated', { variant: 'success' });
      } else {
        const res = await createPi({ ...payload, poId: po._id }).unwrap();
        enqueueSnackbar(`PI ${res?.data?.piNumber || ''} created`, { variant: 'success' });
      }
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save proforma invoice', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: { xs: '100%', md: '92vh' }, display: 'flex', flexDirection: 'column', borderRadius: { xs: 0, md: '18px' }, overflow: 'hidden' } }}>
      {/* Header */}
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)', color: '#fff' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <ReceiptText size={22} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: '#fff' }}>
              {isEdit ? `Edit ${pi.piNumber}` : 'New Proforma Invoice'}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)' }}>
              Step 1.6 · PI Form — prerequisite for Advance Payment
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(false)} sx={{ color: '#fff' }}><X size={20} /></IconButton>
      </Box>

      {/* Body */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, bgcolor: '#f8fafc' }}>
        {/* Header section */}
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: 'primary.main' }}>
            <FileText size={18} /> PI Header
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={5}>
              {isEdit || presetPo ? (
                <TextField label="PO Number" fullWidth value={po?.poNumber || ''} disabled />
              ) : (
                <Autocomplete
                  options={poOptions}
                  loading={posLoading}
                  value={po}
                  getOptionLabel={(o) => (o ? `${o.poNumber} — ${o.vendorName}` : '')}
                  isOptionEqualToValue={(o, v) => o._id === v._id}
                  onChange={(_e, v) => applyPo(v)}
                  renderInput={(params) => (
                    <TextField {...params} label="Purchase Order *" placeholder="Released POs only"
                      InputProps={{ ...params.InputProps, endAdornment: (<>{posLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
                  )}
                />
              )}
            </Grid>
            <Grid item xs={6} sm={3}>
              <DateInputDDMMYYYY label="PI Date" fullWidth value={piDate}
                onChange={setPiDate} />
            </Grid>
            <Grid item xs={6} sm={2}>
              <TextField label="Unique Code" fullWidth value={pi?.uniqueCode || '(auto)'} disabled />
            </Grid>
            <Grid item xs={6} sm={2}>
              <TextField label="PI Number" fullWidth value={pi?.piNumber || '(auto)'} disabled />
            </Grid>
          </Grid>

          {/* Vendor snapshot */}
          {po ? (
            <Box sx={{ mt: 2, p: 1.5, borderRadius: '10px', bgcolor: alpha('#2563eb', 0.04), display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'center' }}>
              <Building2 size={16} color="#1d4ed8" />
              <Typography variant="caption" fontWeight={700}>{po.vendorName || pi?.vendorName || '—'}</Typography>
              {(po.vendorGST || pi?.vendorGST) && <Typography variant="caption" color="text.secondary">GST: {po.vendorGST || pi?.vendorGST}</Typography>}
              {(po.vendorPhone || pi?.vendorPhone) && <Typography variant="caption" color="text.secondary">📞 {po.vendorPhone || pi?.vendorPhone}</Typography>}
              {(po.vendorEmail || pi?.vendorEmail) && <Typography variant="caption" color="text.secondary">✉ {po.vendorEmail || pi?.vendorEmail}</Typography>}
            </Box>
          ) : null}

          {/* Document upload */}
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 1 }}>
              PI DOCUMENT (required before approval)
            </Typography>
            <input ref={fileRef} type="file" accept={ACCEPT} onChange={handleFile} hidden />
            {doc?.fileUrl ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: '10px', bgcolor: '#fff', maxWidth: 520 }}>
                <FileText size={18} />
                <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>{doc.fileName}</Typography>
                <Button size="small" startIcon={<ExternalLink size={14} />} href={fileHref(doc.fileUrl)} target="_blank" rel="noopener">View</Button>
                <Chip size="small" label="Remove" onDelete={() => setDoc(null)} deleteIcon={<X size={14} />} onClick={() => setDoc(null)} />
              </Box>
            ) : (
              <Button variant="outlined" startIcon={uploading ? <CircularProgress size={16} /> : <Upload size={16} />}
                onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? 'Uploading…' : 'Upload PDF / Image'}
              </Button>
            )}
          </Box>
        </Paper>

        {/* Items */}
        <Paper elevation={0} sx={SECTION}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Typography sx={{ fontWeight: 700, color: '#b45309', display: 'flex', alignItems: 'center', gap: 1 }}>
              <Plus size={18} /> Items
            </Typography>
            <Button size="small" startIcon={<Plus size={15} />} onClick={addItem} variant="outlined">Add Item</Button>
          </Box>

          <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: '2.2fr 0.9fr 0.65fr 0.65fr 0.75fr 0.6fr 1fr 36px', gap: 1, px: 1, mb: 0.5 }}>
            {['Description', 'SKU', 'Qty', 'Unit', 'Rate', 'GST %', 'Line Amount', ''].map((h, i) => (
              <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.62rem' }}>{h}</Typography>
            ))}
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {items.map((it, idx) => (
              <Box key={idx} sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '2.2fr 0.9fr 0.65fr 0.65fr 0.75fr 0.6fr 1fr 36px' },
                gap: 1, alignItems: 'center', p: { xs: 1.5, md: 0.5 }, px: { md: 1 },
                borderRadius: '10px', border: { xs: '1px solid', md: 'none' }, borderColor: 'divider',
                '&:hover': { bgcolor: alpha('#2563eb', 0.03) },
              }}>
                <TextField size="small" placeholder="Item description" value={it.itemName}
                  onChange={(e) => setItem(idx, { itemName: e.target.value })} />
                <TextField size="small" placeholder="SKU" value={it.skuCode}
                  onChange={(e) => setItem(idx, { skuCode: e.target.value.toUpperCase() })} />
                <TextField size="small" type="number" placeholder="0" value={it.quantity}
                  onChange={(e) => setItem(idx, { quantity: e.target.value })} inputProps={{ min: 0, style: { textAlign: 'right' } }} />
                <TextField size="small" select value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })}>
                  {UNITS.map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                </TextField>
                <TextField size="small" type="number" placeholder="0.00" value={it.rate}
                  onChange={(e) => setItem(idx, { rate: e.target.value })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} />
                <TextField size="small" select value={it.gstRate} onChange={(e) => setItem(idx, { gstRate: e.target.value })}>
                  {GST_PRESETS.map((g) => <MenuItem key={g} value={g}>{g}%</MenuItem>)}
                </TextField>
                <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {lineCalc(it).toFixed(2)}
                </Typography>
                <Tooltip title="Remove">
                  <span>
                    <IconButton size="small" color="error" onClick={() => removeItem(idx)}
                      disabled={items.length === 1 && !it.itemName}>
                      <Trash2 size={15} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            ))}
          </Box>

          {/* Summary */}
          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>TOTAL VALUE</Typography>
              <Typography variant="h6" fontWeight={800} color="primary.dark">{fmtINR(totalValue)}</Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>PAID AMOUNT</Typography>
              <Typography fontWeight={700}>{fmtINR(paidAmount)}</Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="#b45309" fontWeight={700}>BALANCE AMOUNT</Typography>
              <Typography fontWeight={800} sx={{ color: '#b45309' }}>{fmtINR(totalValue - paidAmount)}</Typography>
            </Box>
          </Box>
        </Paper>

        <TextField label="Remarks" fullWidth value={remarks} onChange={(e) => setRemarks(e.target.value)} sx={{ bgcolor: '#fff' }} />
      </Box>

      {/* Footer */}
      <Divider />
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#fff' }}>
        <Typography variant="caption" color="text.secondary">
          {validItems.length} item(s) · {fmtINR(totalValue)}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button variant="outlined" onClick={() => onClose?.(false)} disabled={saving || uploading}>Cancel</Button>
          <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
            onClick={handleSubmit} disabled={saving || uploading}>
            {isEdit ? 'Save Changes' : 'Create PI'}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};

export default ProformaInvoiceFormDrawer;
