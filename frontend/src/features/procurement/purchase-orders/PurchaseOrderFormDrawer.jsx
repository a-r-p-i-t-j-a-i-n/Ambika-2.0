import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, Box, Typography, TextField, Button, IconButton, Divider,
  Grid, MenuItem, Autocomplete, CircularProgress, Paper, Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { X, Save, ShoppingBag, Plus, Trash2, Building2, FileText } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetIndentsQuery,
  useCreatePurchaseOrderMutation,
  useUpdatePurchaseOrderMutation,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import { fmtINR } from './poMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

/**
 * Create / edit a Vendor Purchase Order (Step 1.4).
 *
 * Business rule: POs are NEVER standalone — an indent with an approved
 * quotation (QUOTATION_APPROVED / PO_READY) must be selected first.
 * Party = Vendor; selecting a vendor auto-fills GST/PAN/address/terms and
 * product rates from `party.suppliedProducts`.
 */
const UNITS = ['Pcs', 'Kg', 'Meter', 'Roll', 'Box', 'Set', 'Litre', 'Dozen'];
const JSL_UNITS = ['Kgs', 'MT', 'Pcs', 'Nos', 'Meter'];

// Hide the native number-input spinner arrows so the digits use the full cell width.
const NO_SPIN = {
  '& input[type=number]': { MozAppearance: 'textfield' },
  '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': {
    WebkitAppearance: 'none', margin: 0,
  },
};
const GST_PRESETS = [0, 5, 12, 18, 28];
const todayStr = () => new Date().toISOString().slice(0, 10);

const emptyItem = () => ({ itemName: '', skuCode: '', skuId: '', quantity: '', unit: 'Pcs', rate: '', gstRate: 18 });
const emptyJslItem = () => ({ grade: '', width: '', finish: '', quantity: '', unit: 'Kgs', baseRate: '', upfrontDiscount: '', bonanzaDiscount: '' });
const emptyItemFor = (fmt) => (fmt === 'JSL' ? emptyJslItem() : emptyItem());

const JSL_GST = 18;
const lineCalc = (it) => {
  const taxable = (Number(it.quantity) || 0) * (Number(it.rate) || 0);
  const tax = taxable * (Number(it.gstRate) || 0) / 100;
  return { taxable, tax, total: taxable + tax };
};
const jslLineCalc = (it) => {
  const finalPrice = (Number(it.baseRate) || 0) - (Number(it.upfrontDiscount) || 0) - (Number(it.bonanzaDiscount) || 0);
  const value = (Number(it.quantity) || 0) * finalPrice;
  return { finalPrice, value };
};

const SECTION = { p: 2.5, borderRadius: '16px', border: '1px solid', borderColor: 'divider' };
const OTHER_GRID = '1.7fr 0.85fr 0.7fr 0.95fr 0.7fr 0.8fr 0.8fr 0.65fr 0.85fr 36px';
const JSL_GRID = '1.1fr 0.8fr 0.95fr 0.7fr 0.9fr 0.9fr 0.95fr 0.95fr 0.85fr 0.9fr 36px';

const PurchaseOrderFormDrawer = ({ open, onClose, po = null, presetIndent = null }) => {
  const { enqueueSnackbar } = useSnackbar();
  const isEdit = Boolean(po?._id);

  const [indent, setIndent] = useState(null);
  const [vendor, setVendor] = useState(null);
  const [poFormatType, setPoFormatType] = useState('OTHER'); // 'JSL' | 'OTHER'
  const [approvedVendors, setApprovedVendors] = useState([]); // from Step 1.3 (multi-vendor)
  const [approvedVendorId, setApprovedVendorId] = useState('');
  const [header, setHeader] = useState({
    poDate: todayStr(), leadTime: '', deliveryTerms: '', paymentTerms: '', creditPeriod: 0, remarks: '',
  });
  const [items, setItems] = useState([emptyItem()]);

  const [createPo, { isLoading: creating }] = useCreatePurchaseOrderMutation();
  const [updatePo, { isLoading: updating }] = useUpdatePurchaseOrderMutation();
  const saving = creating || updating;

  // PO-eligible indents: QUOTATION_APPROVED (not yet PO'd) plus PO_READY indents
  // that still have an approved vendor awaiting a PO (multi-vendor — one PO per vendor).
  const { data: approvedRes, isLoading: approvedLoading } = useGetIndentsQuery(
    { limit: 200, sort: '-createdAt', overallStatus: 'QUOTATION_APPROVED' },
    { skip: !open || isEdit },
  );
  const { data: poReadyRes, isLoading: poReadyLoading } = useGetIndentsQuery(
    { limit: 200, sort: '-createdAt', overallStatus: 'PO_READY' },
    { skip: !open || isEdit },
  );
  const indentsLoading = approvedLoading || poReadyLoading;
  const indentOptions = useMemo(() => {
    const approved = approvedRes?.data || [];
    // PO_READY only when ≥1 approved vendor has no PO yet (else it's fully done).
    const poReady = (poReadyRes?.data || []).filter(
      (ind) => (ind.quotationApprovalStep?.approvedVendors || []).some((v) => !v.poId),
    );
    return [...approved, ...poReady];
  }, [approvedRes, poReadyRes]);

  const { data: partiesRes, isLoading: partiesLoading } = useGetPartiesQuery(
    { limit: 500, sort: 'name' },
    { skip: !open },
  );
  const vendorOptions = partiesRes?.data || [];

  // Vendor's catalog for item autocomplete + rate auto-fill.
  const vendorProducts = vendor?.suppliedProducts || [];

  // Hydrate on open.
  useEffect(() => {
    if (!open) return;
    if (po) {
      setIndent({ _id: po.indentId, indentNumber: po.indentNumber });
      const v = vendorOptions.find((p) => p._id === (po.vendorId?._id || po.vendorId));
      setVendor(v || { _id: po.vendorId?._id || po.vendorId, name: po.vendorName });
      setHeader({
        poDate: po.poDate ? po.poDate.slice(0, 10) : todayStr(),
        leadTime: po.leadTime || '', deliveryTerms: po.deliveryTerms || '',
        paymentTerms: po.paymentTerms || '', creditPeriod: po.creditPeriod || 0,
        remarks: po.remarks || '',
      });
      const fmt = po.poFormatType === 'JSL' ? 'JSL' : 'OTHER';
      setPoFormatType(fmt);
      setItems(po.items?.length ? po.items.map((it) => (fmt === 'JSL' ? {
        grade: it.grade || '', width: it.width || '', finish: it.finish || '',
        quantity: it.quantity, unit: it.unit || 'Kgs',
        baseRate: it.baseRate ?? '', upfrontDiscount: it.upfrontDiscount ?? '', bonanzaDiscount: it.bonanzaDiscount ?? '',
      } : {
        itemName: it.itemName, skuCode: it.skuCode || '', skuId: it.skuId || '',
        quantity: it.quantity, unit: it.unit || 'Pcs', rate: it.rate, gstRate: it.gstRate,
      })) : [emptyItemFor(fmt)]);
    } else {
      setIndent(null); setVendor(null); setApprovedVendors([]); setApprovedVendorId('');
      setPoFormatType('OTHER');
      setHeader({ poDate: todayStr(), leadTime: '', deliveryTerms: '', paymentTerms: '', creditPeriod: 0, remarks: '' });
      setItems([emptyItem()]);
      if (presetIndent) applyIndent(presetIndent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, po, presetIndent]);

  // Seed PO lines from the indent's approved items (multi-item, with a
  // legacy single-product fallback). Uses approved → revised → requested qty.
  const applyIndent = (ind) => {
    setIndent(ind);
    // Multi-vendor (Step 1.3) approved vendors drive the vendor picker when present.
    const avs = ind?.quotationApprovalStep?.approvedVendors || [];
    setApprovedVendors(avs);
    setApprovedVendorId('');
    if (avs.length) {
      // Auto-select the only vendor still awaiting a PO, if there is exactly one.
      const pending = avs.filter((v) => !v.poId);
      if (pending.length === 1) applyApprovedVendor(pending[0]);
      return; // items are set by applyApprovedVendor; skip the indent-item seeding
    }
    if (!ind) return;
    setItems((cur) => {
      const hasContent = cur.some((it) => it.itemName);
      if (hasContent) return cur;
      const src = ind.items?.length
        ? ind.items
        : (ind.productNameRevised
          ? [{ itemName: ind.productNameRevised, skuCode: ind.skuCode, skuId: ind.skuId, unit: ind.unit, approvedQuantity: ind.approvedQuantity, quantity: ind.quantity }]
          : []);
      const lines = src.map((it) => ({
        ...emptyItem(),
        itemName: it.itemName || '',
        skuCode: it.skuCode || '',
        skuId: it.skuId || '',
        quantity: it.approvedQuantity || it.revisedQuantity || it.quantity || '',
        unit: it.unit || 'Pcs',
      }));
      return lines.length ? lines : cur;
    });
  };

  // Multi-vendor: select one approved vendor (Step 1.3) → prefill that vendor's
  // approved items (qty/rate/gst). One PO is created per approved vendor.
  const applyApprovedVendor = (av) => {
    if (!av) { setApprovedVendorId(''); setVendor(null); setItems([emptyItem()]); return; }
    const vid = av.vendorId?._id || av.vendorId || '';
    setApprovedVendorId(vid);
    const party = vendorOptions.find((p) => p._id === vid);
    const v = party || { _id: vid, name: av.vendorName };
    setVendor(v);
    if (party) {
      setHeader((h) => ({
        ...h,
        creditPeriod: party.creditPeriodDays ?? h.creditPeriod,
        leadTime: h.leadTime || (party.leadTimeDays ? `${party.leadTimeDays} days` : ''),
        paymentTerms: h.paymentTerms || (party.creditPeriodDays ? `${party.creditPeriodDays} days credit` : ''),
      }));
    }
    const lines = (av.items || []).map((it) => ({
      ...emptyItem(),
      itemName: it.itemName || '',
      skuCode: it.skuCode || '',
      skuId: it.skuId?._id || it.skuId || '',
      quantity: it.approvedQty || '',
      unit: it.unit || 'Pcs',
      rate: it.approvedRate ?? '',
      gstRate: it.gstRate ?? 18,
    }));
    setItems(lines.length ? lines : [emptyItem()]);
  };

  // Vendor auto-fill: terms from Party + rates for matching products.
  const applyVendor = (v) => {
    setVendor(v);
    if (!v) return;
    setHeader((h) => ({
      ...h,
      creditPeriod: v.creditPeriodDays ?? h.creditPeriod,
      leadTime: h.leadTime || (v.leadTimeDays ? `${v.leadTimeDays} days` : ''),
      paymentTerms: h.paymentTerms || (v.creditPeriodDays ? `${v.creditPeriodDays} days credit` : ''),
    }));
    const products = v.suppliedProducts || [];
    if (products.length) {
      setItems((cur) => cur.map((it) => {
        if (it.rate) return it;
        const match = products.find((p) =>
          (it.skuCode && p.skuCode && p.skuCode.toUpperCase() === it.skuCode.toUpperCase()) ||
          (it.itemName && p.productName && p.productName.toLowerCase() === it.itemName.toLowerCase()));
        return match ? { ...it, rate: match.rate ?? it.rate, unit: it.unit || match.unit || 'Pcs' } : it;
      }));
    }
  };

  const setItem = (idx, patch) => setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const addItem = () => setItems((cur) => [...cur, emptyItemFor(poFormatType)]);
  const removeItem = (idx) => setItems((cur) => (cur.length > 1 ? cur.filter((_, i) => i !== idx) : [emptyItemFor(poFormatType)]));

  // Switching format resets item fields — warn if any data was entered.
  const handleFormatChange = (next) => {
    if (next === poFormatType) return;
    const hasData = items.some((it) => it.itemName?.trim() || it.grade?.trim() || Number(it.quantity) > 0 || it.rate || it.baseRate);
    if (hasData && !window.confirm('Changing PO format may reset item fields. Continue?')) return;
    setPoFormatType(next);
    setItems([emptyItemFor(next)]);
  };

  const isJsl = poFormatType === 'JSL';

  const totals = useMemo(() => {
    if (isJsl) {
      const taxable = items.reduce((s, it) => s + jslLineCalc(it).value, 0);
      const tax = taxable * JSL_GST / 100;
      return { taxable, tax, grand: taxable + tax };
    }
    const t = items.reduce((acc, it) => {
      const { taxable, tax } = lineCalc(it);
      return { taxable: acc.taxable + taxable, tax: acc.tax + tax };
    }, { taxable: 0, tax: 0 });
    return { ...t, grand: t.taxable + t.tax };
  }, [items, isJsl]);

  const validItems = isJsl
    ? items.filter((it) => Number(it.quantity) > 0 && (it.grade?.trim() || it.finish?.trim() || it.width?.trim()))
    : items.filter((it) => it.itemName?.trim() && Number(it.quantity) > 0);

  const handleSubmit = async () => {
    if (!isEdit && !indent?._id) { enqueueSnackbar('Select an approved indent first', { variant: 'warning' }); return; }
    if (!vendor?._id) { enqueueSnackbar('Vendor is mandatory', { variant: 'warning' }); return; }
    if (validItems.length === 0) {
      enqueueSnackbar(isJsl ? 'Add at least one item with grade and quantity' : 'Add at least one item with quantity', { variant: 'warning' });
      return;
    }

    const payload = {
      vendorId: vendor._id,
      poFormatType,
      poDate: header.poDate,
      vendorName: vendor.name || '',
      vendorGST: vendor.gstNo || '',
      vendorPAN: vendor.panNo || '',
      vendorAddress: vendor.location || vendor.address || '',
      vendorEmail: vendor.email || '',
      vendorPhone: vendor.phone || '',
      deliveryTerms: header.deliveryTerms.trim(),
      paymentTerms: header.paymentTerms.trim(),
      leadTime: header.leadTime.trim(),
      creditPeriod: Number(header.creditPeriod) || 0,
      remarks: header.remarks.trim(),
      items: validItems.map((it) => (isJsl ? {
        grade: it.grade?.trim() || '', width: it.width?.trim() || '', finish: it.finish?.trim() || '',
        quantity: Number(it.quantity), unit: it.unit || 'Kgs',
        baseRate: Number(it.baseRate) || 0,
        upfrontDiscount: Number(it.upfrontDiscount) || 0,
        bonanzaDiscount: Number(it.bonanzaDiscount) || 0,
      } : {
        itemName: it.itemName.trim(), skuCode: it.skuCode?.trim() || '',
        skuId: it.skuId || undefined,
        quantity: Number(it.quantity), unit: it.unit || 'Pcs',
        rate: Number(it.rate) || 0, gstRate: Number(it.gstRate) || 0,
      })),
    };

    try {
      if (isEdit) {
        await updatePo({ id: po._id, ...payload }).unwrap();
        enqueueSnackbar('Purchase order updated', { variant: 'success' });
      } else {
        const res = await createPo({ ...payload, indentId: indent._id }).unwrap();
        enqueueSnackbar(`PO ${res?.data?.poNumber || ''} saved as draft`, { variant: 'success' });
      }
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to save purchase order', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: { xs: '100%', md: '92vh' }, display: 'flex', flexDirection: 'column', borderRadius: { xs: 0, md: '18px' }, overflow: 'hidden' } }}>
      {/* Header */}
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)', color: '#fff' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <ShoppingBag size={22} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: '#fff' }}>
              {isEdit ? `Edit ${po.poNumber}` : 'New Purchase Order'}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)' }}>
              Step 1.4 · Create PO &amp; Release to Supplier
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(false)} sx={{ color: '#fff' }}><X size={20} /></IconButton>
      </Box>

      {/* Body */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, bgcolor: '#f8fafc' }}>
        {/* Source + vendor */}
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: 'primary.main' }}>
            <FileText size={18} /> Source Indent &amp; Vendor
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={4}>
              <TextField select fullWidth required label="PO Format Type" value={poFormatType}
                onChange={(e) => handleFormatChange(e.target.value)}
                helperText={isJsl ? 'JSL — grade/width/finish + discount pricing' : 'Other — standard item / rate'}>
                <MenuItem value="OTHER">Other</MenuItem>
                <MenuItem value="JSL">JSL</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={12} sm={8} />
            <Grid item xs={12} sm={6}>
              {isEdit ? (
                <TextField label="Indent Number" fullWidth value={indent?.indentNumber || ''} disabled />
              ) : (
                <Autocomplete
                  options={indentOptions}
                  loading={indentsLoading}
                  value={indent}
                  getOptionLabel={(o) => (o ? `${o.indentNumber} — ${o.productNameRevised}` : '')}
                  isOptionEqualToValue={(o, v) => o._id === v._id}
                  onChange={(_e, v) => applyIndent(v)}
                  renderInput={(params) => (
                    <TextField {...params} label="Approved Indent *" placeholder="Only QUOTATION_APPROVED indents"
                      helperText={presetIndent ? '' : 'PO can only be created from an approved quotation'}
                      InputProps={{ ...params.InputProps, endAdornment: (<>{indentsLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
                  )}
                />
              )}
            </Grid>
            <Grid item xs={12} sm={6}>
              {!isEdit && approvedVendors.length > 0 ? (
                <TextField select fullWidth label="Approved Vendor *" value={approvedVendorId}
                  onChange={(e) => applyApprovedVendor(approvedVendors.find((v) => (v.vendorId?._id || v.vendorId) === e.target.value))}
                  helperText="From Step 1.3 — one PO is created per approved vendor">
                  {approvedVendors.map((v) => {
                    const vid = v.vendorId?._id || v.vendorId;
                    return (
                      <MenuItem key={vid} value={vid} disabled={!!v.poId}>
                        {v.vendorName}{v.poId ? ` · PO ${v.poNumber || 'created'}` : ''}
                      </MenuItem>
                    );
                  })}
                </TextField>
              ) : (
                <Autocomplete
                  options={vendorOptions}
                  loading={partiesLoading}
                  value={vendor}
                  getOptionLabel={(o) => (o?.name || '')}
                  isOptionEqualToValue={(o, v) => o._id === v._id}
                  onChange={(_e, v) => applyVendor(v)}
                  renderInput={(params) => (
                    <TextField {...params} label="Vendor (Party) *" placeholder="Select vendor"
                      InputProps={{ ...params.InputProps, endAdornment: (<>{partiesLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
                  )}
                />
              )}
            </Grid>
          </Grid>

          {/* Vendor snapshot preview */}
          {vendor ? (
            <Box sx={{ mt: 2, p: 1.5, borderRadius: '10px', bgcolor: alpha('#2563eb', 0.04), display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'center' }}>
              <Building2 size={16} color="#1d4ed8" />
              <Typography variant="caption" fontWeight={700}>{vendor.name}</Typography>
              <Typography variant="caption" color="text.secondary">GST: {vendor.gstNo || '—'}</Typography>
              <Typography variant="caption" color="text.secondary">PAN: {vendor.panNo || '—'}</Typography>
              <Typography variant="caption" color="text.secondary">{vendor.location || vendor.address || '—'}</Typography>
              <Typography variant="caption" color="text.secondary">📞 {vendor.phone || '—'}</Typography>
              <Typography variant="caption" color="text.secondary">✉ {vendor.email || '—'}</Typography>
              {vendorProducts.length > 0 && (
                <Typography variant="caption" sx={{ color: '#0f766e', fontWeight: 700 }}>{vendorProducts.length} catalog product(s)</Typography>
              )}
            </Box>
          ) : null}
        </Paper>

        {/* Header / terms */}
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: '#0f766e' }}>
            <ShoppingBag size={18} /> PO Terms
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <DateInputDDMMYYYY label="PO Date" fullWidth value={header.poDate}
                onChange={(val) => setHeader((h) => ({ ...h, poDate: val }))} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField label="Lead Time" fullWidth value={header.leadTime} placeholder="e.g. 7 days"
                onChange={(e) => setHeader((h) => ({ ...h, leadTime: e.target.value }))} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField label="Credit Period (Days)" type="number" fullWidth value={header.creditPeriod}
                onChange={(e) => setHeader((h) => ({ ...h, creditPeriod: e.target.value }))} inputProps={{ min: 0 }} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <TextField label="Payment Terms" fullWidth value={header.paymentTerms}
                onChange={(e) => setHeader((h) => ({ ...h, paymentTerms: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Delivery Terms" fullWidth value={header.deliveryTerms}
                onChange={(e) => setHeader((h) => ({ ...h, deliveryTerms: e.target.value }))} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField label="Remarks" fullWidth value={header.remarks}
                onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))} />
            </Grid>
          </Grid>
        </Paper>

        {/* Items */}
        <Paper elevation={0} sx={SECTION}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <Typography sx={{ fontWeight: 700, color: '#b45309', display: 'flex', alignItems: 'center', gap: 1 }}>
              <Plus size={18} /> Items
            </Typography>
            <Button size="small" startIcon={<Plus size={15} />} onClick={addItem} variant="outlined">Add Item</Button>
          </Box>

          {isJsl ? (
            <>
              {/* JSL header row */}
              <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: JSL_GRID, gap: 1, px: 1, mb: 0.5 }}>
                {['Grade', 'Width', 'Finish', 'Qty', 'Unit', 'Base Rate', 'Upfront Disc.', 'Bonanza Disc.', 'Final Price', 'Value', ''].map((h, i) => (
                  <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.6rem' }}>{h}</Typography>
                ))}
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {items.map((it, idx) => {
                  const { finalPrice, value } = jslLineCalc(it);
                  return (
                    <Box key={idx} sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: JSL_GRID },
                      gap: 1, alignItems: 'center', p: { xs: 1.5, md: 0.5 }, px: { md: 1 },
                      borderRadius: '10px', border: { xs: '1px solid', md: 'none' }, borderColor: 'divider',
                      '&:hover': { bgcolor: alpha('#2563eb', 0.03) },
                    }}>
                      <TextField size="small" placeholder="Grade" value={it.grade}
                        onChange={(e) => setItem(idx, { grade: e.target.value })} />
                      <TextField size="small" placeholder="Width" value={it.width}
                        onChange={(e) => setItem(idx, { width: e.target.value })} />
                      <TextField size="small" placeholder="Finish" value={it.finish}
                        onChange={(e) => setItem(idx, { finish: e.target.value })} />
                      <TextField size="small" type="number" placeholder="0" value={it.quantity}
                        onChange={(e) => setItem(idx, { quantity: e.target.value })} inputProps={{ min: 0, style: { textAlign: 'right' } }} sx={NO_SPIN} />
                      <TextField size="small" select value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })}>
                        {JSL_UNITS.map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                      </TextField>
                      <TextField size="small" type="number" placeholder="0.00" value={it.baseRate}
                        onChange={(e) => setItem(idx, { baseRate: e.target.value })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} sx={NO_SPIN} />
                      <TextField size="small" type="number" placeholder="0.00" value={it.upfrontDiscount}
                        onChange={(e) => setItem(idx, { upfrontDiscount: e.target.value })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} sx={NO_SPIN} />
                      <TextField size="small" type="number" placeholder="0.00" value={it.bonanzaDiscount}
                        onChange={(e) => setItem(idx, { bonanzaDiscount: e.target.value })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} sx={NO_SPIN} />
                      <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{finalPrice.toFixed(2)}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value.toFixed(2)}</Typography>
                      <Tooltip title="Remove">
                        <span>
                          <IconButton size="small" color="error" onClick={() => removeItem(idx)}
                            disabled={items.length === 1 && !it.grade && !it.quantity}>
                            <Trash2 size={15} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>
                  );
                })}
              </Box>
            </>
          ) : (
            <>
              {/* OTHER header row */}
              <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: OTHER_GRID, gap: 1, px: 1, mb: 0.5 }}>
                {['Item Name', 'SKU', 'Qty', 'Unit', 'Rate', 'GST %', 'Taxable', 'Tax', 'Total', ''].map((h, i) => (
                  <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.62rem' }}>{h}</Typography>
                ))}
              </Box>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {items.map((it, idx) => {
                  const { taxable, tax, total } = lineCalc(it);
                  return (
                    <Box key={idx} sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr', md: OTHER_GRID },
                      gap: 1, alignItems: 'center', p: { xs: 1.5, md: 0.5 }, px: { md: 1 },
                      borderRadius: '10px', border: { xs: '1px solid', md: 'none' }, borderColor: 'divider',
                      '&:hover': { bgcolor: alpha('#2563eb', 0.03) },
                    }}>
                      <Autocomplete
                        freeSolo
                        options={vendorProducts}
                        getOptionLabel={(o) => (typeof o === 'string' ? o : o.productName || '')}
                        value={it.itemName}
                        onInputChange={(_e, v, reason) => { if (reason === 'input') setItem(idx, { itemName: v }); }}
                        onChange={(_e, val) => {
                          if (val && typeof val === 'object') {
                            setItem(idx, {
                              itemName: val.productName, skuCode: val.skuCode || '',
                              skuId: val.skuId || '', rate: val.rate ?? it.rate, unit: val.unit || it.unit,
                            });
                          }
                        }}
                        renderInput={(params) => <TextField {...params} size="small" placeholder="Item / vendor product" />}
                      />
                      <TextField size="small" placeholder="SKU" value={it.skuCode}
                        onChange={(e) => setItem(idx, { skuCode: e.target.value.toUpperCase() })} />
                      <TextField size="small" type="number" placeholder="0" value={it.quantity}
                        onChange={(e) => setItem(idx, { quantity: e.target.value })} inputProps={{ min: 0, style: { textAlign: 'right' } }} sx={NO_SPIN} />
                      <TextField size="small" select value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })}>
                        {UNITS.map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                      </TextField>
                      <TextField size="small" type="number" placeholder="0.00" value={it.rate}
                        onChange={(e) => setItem(idx, { rate: e.target.value })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} sx={NO_SPIN} />
                      <Autocomplete
                        freeSolo disableClearable size="small"
                        options={GST_PRESETS.map(String)}
                        value={it.gstRate === '' || it.gstRate == null ? '' : String(it.gstRate)}
                        onInputChange={(_e, v) => {
                          const cleaned = v.replace(/[^\d.]/g, '');
                          setItem(idx, { gstRate: cleaned === '' ? '' : Number(cleaned) });
                        }}
                        renderInput={(params) => (
                          <TextField {...params} size="small" placeholder="GST %" inputProps={{ ...params.inputProps, inputMode: 'decimal', style: { textAlign: 'right' } }}
                            InputProps={{ ...params.InputProps, endAdornment: <Typography variant="caption" sx={{ pr: 0.5, color: 'text.secondary' }}>%</Typography> }} />
                        )}
                      />
                      <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{taxable.toFixed(2)}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>{tax.toFixed(2)}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{total.toFixed(2)}</Typography>
                      <Tooltip title="Remove">
                        <span>
                          <IconButton size="small" color="error" onClick={() => removeItem(idx)}
                            disabled={items.length === 1 && !it.itemName}>
                            <Trash2 size={15} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>
                  );
                })}
              </Box>
            </>
          )}

          {/* Totals */}
          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>TOTAL TAXABLE VALUE</Typography>
              <Typography fontWeight={700}>{fmtINR(totals.taxable)}</Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>{isJsl ? 'GST @ 18%' : 'GST'}</Typography>
              <Typography fontWeight={700}>{fmtINR(totals.tax)}</Typography>
            </Box>
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="primary.main" fontWeight={700}>GRAND TOTAL</Typography>
              <Typography variant="h6" fontWeight={800} color="primary.dark">{fmtINR(totals.grand)}</Typography>
            </Box>
          </Box>
        </Paper>
      </Box>

      {/* Footer */}
      <Divider />
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#fff' }}>
        <Typography variant="caption" color="text.secondary">
          {validItems.length} item(s) · {fmtINR(totals.grand)}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button variant="outlined" onClick={() => onClose?.(false)} disabled={saving}>Cancel</Button>
          <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
            onClick={handleSubmit} disabled={saving}>
            {isEdit ? 'Save Changes' : 'Save as Draft'}
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};

export default PurchaseOrderFormDrawer;
