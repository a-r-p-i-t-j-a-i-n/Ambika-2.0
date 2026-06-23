import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, Box, Typography, TextField, Button, IconButton, Divider,
  Grid, MenuItem, Autocomplete, CircularProgress, Paper, Tooltip, Chip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { X, Save, Layers, Building2, FileText, Trash2, Users } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetIndentsQuery,
  useCreateMultiIndentPurchaseOrderMutation,
} from '../../../store/api/procurementApi';
import { useGetVendorsQuery } from '../../../store/api/vendorApi';
import { fmtINR } from './poMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

/**
 * Multi-Indent Purchase Order (Step 1.4).
 *
 * Business rule: one PO = one vendor, but a PO may combine same-vendor approved
 * items from several indents. The user multi-selects approved indents; the form
 * groups their approved items by vendor (hybrid: Step 1.3 approved-vendor
 * assignments when present, otherwise an "Unassigned" group whose vendor the user
 * picks from the Vendor Master). One vendor group → one PO.
 */
const UNITS = ['Pcs', 'Kg', 'Meter', 'Roll', 'Box', 'Set', 'Litre', 'Dozen', 'Kgs', 'MT', 'Nos'];
const UNASSIGNED = '__UNASSIGNED__';
const todayStr = () => new Date().toISOString().slice(0, 10);

const NO_SPIN = {
  '& input[type=number]': { MozAppearance: 'textfield' },
  '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
};
const SECTION = { p: 2.5, borderRadius: '16px', border: '1px solid', borderColor: 'divider' };
const GRID_COLS = '110px 1.6fr 0.9fr 0.7fr 0.8fr 0.85fr 0.7fr 0.9fr 36px';

const vid = (v) => String(v?._id || v || '');

// Flatten one indent into candidate rows, each tagged with its vendor (or unassigned).
const rowsForIndent = (ind) => {
  const avs = ind.quotationApprovalStep?.approvedVendors || [];
  if (avs.length) {
    return avs.filter((av) => !av.poId).flatMap((av) =>
      (av.items || []).map((it, i) => ({
        key: `${ind._id}:${vid(av.vendorId)}:${it.skuCode || it.itemName || i}`,
        indentId: ind._id, indentNumber: ind.indentNumber,
        vendorId: vid(av.vendorId), vendorName: av.vendorName || 'Vendor',
        itemName: it.itemName || '', skuCode: it.skuCode || '', skuId: vid(it.skuId) || '',
        quantity: it.approvedQty || 0, unit: it.unit || 'Pcs',
        rate: it.approvedRate ?? 0, gstRate: it.gstRate ?? 18,
      })),
    );
  }
  // No Step 1.3 vendor split (Quote-Not-Required / simple approval) → unassigned.
  const src = ind.items?.length
    ? ind.items
    : (ind.productNameRevised
      ? [{ itemName: ind.productNameRevised, skuCode: ind.skuCode, skuId: ind.skuId, unit: ind.unit, approvedQuantity: ind.approvedQuantity, quantity: ind.quantity }]
      : []);
  return src.map((it, i) => ({
    key: `${ind._id}:U:${it.skuCode || it.itemName || i}`,
    indentId: ind._id, indentNumber: ind.indentNumber,
    vendorId: '', vendorName: '',
    itemName: it.itemName || '', skuCode: it.skuCode || '', skuId: vid(it.skuId) || '',
    quantity: it.approvedQuantity || it.revisedQuantity || it.quantity || 0, unit: it.unit || 'Pcs',
    rate: 0, gstRate: 18,
  }));
};

const lineCalc = (it) => {
  const taxable = (Number(it.quantity) || 0) * (Number(it.rate) || 0);
  const tax = taxable * (Number(it.gstRate) || 0) / 100;
  return { taxable, tax, total: taxable + tax };
};

const MultiIndentPoDrawer = ({ open, onClose }) => {
  const { enqueueSnackbar } = useSnackbar();

  const [selectedIndents, setSelectedIndents] = useState([]);
  const [groupKey, setGroupKey] = useState('');        // vendorId or UNASSIGNED
  const [manualVendor, setManualVendor] = useState(null); // Vendor-master pick for the unassigned group
  const [items, setItems] = useState([]);
  const [header, setHeader] = useState({ poDate: todayStr(), leadTime: '', paymentTerms: '', deliveryTerms: '', creditPeriod: 0, remarks: '' });

  const [createMulti, { isLoading: saving }] = useCreateMultiIndentPurchaseOrderMutation();

  // PO-eligible indents: approved quotations (incl. Quote-Not-Required) and
  // partially-POed indents that still have un-POed approved vendors.
  const { data: approvedRes, isLoading: l1 } = useGetIndentsQuery({ limit: 200, sort: '-createdAt', overallStatus: 'QUOTATION_APPROVED' }, { skip: !open });
  const { data: partialRes, isLoading: l2 } = useGetIndentsQuery({ limit: 200, sort: '-createdAt', overallStatus: 'PARTIAL_PO_CREATED' }, { skip: !open });
  const indentsLoading = l1 || l2;
  const indentOptions = useMemo(
    () => [...(approvedRes?.data || []), ...(partialRes?.data || [])],
    [approvedRes, partialRes],
  );

  const { data: vendorsRes, isLoading: vendorsLoading } = useGetVendorsQuery({ limit: 500, sort: 'name' }, { skip: !open });
  const vendorOptions = vendorsRes?.data || [];

  // Reset on open/close.
  useEffect(() => {
    if (!open) return;
    setSelectedIndents([]); setGroupKey(''); setManualVendor(null); setItems([]);
    setHeader({ poDate: todayStr(), leadTime: '', paymentTerms: '', deliveryTerms: '', creditPeriod: 0, remarks: '' });
  }, [open]);

  // All candidate rows across the selected indents.
  const allRows = useMemo(() => selectedIndents.flatMap(rowsForIndent), [selectedIndents]);

  // Group candidate rows by vendor (empty vendorId → the unassigned bucket).
  const groups = useMemo(() => {
    const map = new Map();
    allRows.forEach((r) => {
      const k = r.vendorId || UNASSIGNED;
      if (!map.has(k)) map.set(k, { key: k, vendorId: r.vendorId, vendorName: r.vendorName, rows: [], indents: new Set() });
      const g = map.get(k);
      g.rows.push(r);
      g.indents.add(r.indentNumber);
    });
    return [...map.values()];
  }, [allRows]);

  // When the selected group changes, load its rows into the editable item table.
  useEffect(() => {
    if (!groupKey) { setItems([]); return; }
    const g = groups.find((x) => x.key === groupKey);
    setItems(g ? g.rows.map((r) => ({ ...r })) : []);
    if (groupKey !== UNASSIGNED) setManualVendor(null);
  }, [groupKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill terms when a Vendor-master vendor is picked for the unassigned group.
  useEffect(() => {
    if (!manualVendor) return;
    setHeader((h) => ({
      ...h,
      creditPeriod: manualVendor.creditPeriodDays ?? h.creditPeriod,
      paymentTerms: h.paymentTerms || (manualVendor.creditPeriodDays ? `${manualVendor.creditPeriodDays} days credit` : ''),
    }));
  }, [manualVendor]);

  const setItem = (idx, patch) => setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx) => setItems((cur) => cur.filter((_, i) => i !== idx));

  const selectedGroup = groups.find((g) => g.key === groupKey) || null;
  const isUnassigned = groupKey === UNASSIGNED;

  // Effective vendor for the PO.
  const vendor = isUnassigned
    ? manualVendor
    : (selectedGroup ? { _id: selectedGroup.vendorId, name: selectedGroup.vendorName } : null);

  const totals = useMemo(() => {
    const t = items.reduce((acc, it) => {
      const { taxable, tax } = lineCalc(it);
      return { taxable: acc.taxable + taxable, tax: acc.tax + tax };
    }, { taxable: 0, tax: 0 });
    return { ...t, grand: t.taxable + t.tax };
  }, [items]);

  const validItems = items.filter((it) => it.itemName?.trim() && Number(it.quantity) > 0);

  const handleSubmit = async () => {
    if (!selectedIndents.length) { enqueueSnackbar('Select at least one approved indent', { variant: 'warning' }); return; }
    if (!groupKey) { enqueueSnackbar('Select a vendor group to create the PO', { variant: 'warning' }); return; }
    if (!vendor?._id) { enqueueSnackbar(isUnassigned ? 'Pick a vendor for the unassigned items' : 'Vendor is missing', { variant: 'warning' }); return; }
    if (!validItems.length) { enqueueSnackbar('Add at least one item with quantity', { variant: 'warning' }); return; }

    const indentIds = [...new Set(validItems.map((it) => it.indentId))];
    const payload = {
      indentIds,
      vendorId: vendor._id,
      poFormatType: 'OTHER',
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
      items: validItems.map((it) => ({
        indentId: it.indentId, indentNumber: it.indentNumber,
        itemName: it.itemName.trim(), skuCode: it.skuCode?.trim() || '',
        skuId: it.skuId || undefined,
        quantity: Number(it.quantity), unit: it.unit || 'Pcs',
        rate: Number(it.rate) || 0, gstRate: Number(it.gstRate) || 0,
      })),
    };

    try {
      const res = await createMulti(payload).unwrap();
      enqueueSnackbar(`PO ${res?.data?.poNumber || ''} created from ${indentIds.length} indent(s)`, { variant: 'success' });
      onClose?.(true);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to create purchase order', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: { xs: '100%', md: '92vh' }, display: 'flex', flexDirection: 'column', borderRadius: { xs: 0, md: '18px' }, overflow: 'hidden' } }}>
      {/* Header */}
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #5b21b6 0%, #6d28d9 55%, #7c3aed 100%)', color: '#fff' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Layers size={22} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: '#fff' }}>Multi-Indent Purchase Order</Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.85)' }}>
              Combine same-vendor approved items from multiple indents into one PO
            </Typography>
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(false)} sx={{ color: '#fff' }}><X size={20} /></IconButton>
      </Box>

      {/* Body */}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, bgcolor: '#f8fafc' }}>
        {/* 1 — pick indents */}
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: 'primary.main' }}>
            <FileText size={18} /> Approved Indents
          </Typography>
          <Autocomplete
            multiple
            options={indentOptions}
            loading={indentsLoading}
            value={selectedIndents}
            getOptionLabel={(o) => (o ? `${o.indentNumber} — ${o.productNameRevised || (o.items?.[0]?.itemName || '')}` : '')}
            isOptionEqualToValue={(o, v) => o._id === v._id}
            onChange={(_e, v) => { setSelectedIndents(v); setGroupKey(''); }}
            renderInput={(params) => (
              <TextField {...params} label="Select approved indents *" placeholder="Pick one or more"
                InputProps={{ ...params.InputProps, endAdornment: (<>{indentsLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
            )}
          />
        </Paper>

        {/* 2 — vendor groups */}
        {selectedIndents.length > 0 && (
          <Paper elevation={0} sx={SECTION}>
            <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: '#6d28d9' }}>
              <Users size={18} /> Vendor Groups — select one to create its PO
            </Typography>
            {groups.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No approved items found in the selected indents.</Typography>
            ) : (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                {groups.map((g) => {
                  const selected = g.key === groupKey;
                  const isU = g.key === UNASSIGNED;
                  return (
                    <Paper key={g.key} onClick={() => setGroupKey(g.key)} elevation={0}
                      sx={{
                        p: 1.75, minWidth: 210, cursor: 'pointer', borderRadius: '12px',
                        border: '2px solid', borderColor: selected ? '#6d28d9' : 'divider',
                        bgcolor: selected ? alpha('#6d28d9', 0.06) : '#fff',
                        transition: 'all .15s',
                      }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Building2 size={15} color={isU ? '#b45309' : '#6d28d9'} />
                        <Typography variant="body2" fontWeight={800} color={isU ? '#b45309' : 'text.primary'}>
                          {isU ? 'Unassigned — pick vendor' : g.vendorName}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                        <Chip size="small" label={`${g.rows.length} item(s)`} sx={{ fontWeight: 700, height: 20 }} />
                        <Chip size="small" label={`${g.indents.size} indent(s)`} variant="outlined" sx={{ fontWeight: 700, height: 20 }} />
                      </Box>
                    </Paper>
                  );
                })}
              </Box>
            )}

            {/* Vendor picker for the unassigned group */}
            {isUnassigned && (
              <Box sx={{ mt: 2 }}>
                <Autocomplete
                  options={vendorOptions}
                  loading={vendorsLoading}
                  value={manualVendor}
                  getOptionLabel={(o) => (o?.name || '')}
                  isOptionEqualToValue={(o, v) => o._id === v._id}
                  onChange={(_e, v) => setManualVendor(v)}
                  renderInput={(params) => (
                    <TextField {...params} label="Vendor for unassigned items *" placeholder="Select from Vendor Master"
                      InputProps={{ ...params.InputProps, endAdornment: (<>{vendorsLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
                  )}
                />
              </Box>
            )}

            {/* Vendor snapshot */}
            {vendor?.name && (
              <Box sx={{ mt: 2, p: 1.5, borderRadius: '10px', bgcolor: alpha('#6d28d9', 0.04), display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'center' }}>
                <Building2 size={16} color="#6d28d9" />
                <Typography variant="caption" fontWeight={700}>{vendor.name}</Typography>
                {vendor.gstNo && <Typography variant="caption" color="text.secondary">GST: {vendor.gstNo}</Typography>}
                {!vendor.gstNo && <Typography variant="caption" color="text.secondary">Vendor details auto-filled on save</Typography>}
              </Box>
            )}
          </Paper>
        )}

        {/* 3 — terms */}
        {groupKey && (
          <Paper elevation={0} sx={SECTION}>
            <Typography sx={{ fontWeight: 700, color: '#0f766e', mb: 2 }}>PO Terms</Typography>
            <Grid container spacing={2}>
              <Grid item xs={6} sm={3}>
                <DateInputDDMMYYYY label="PO Date" fullWidth value={header.poDate} onChange={(val) => setHeader((h) => ({ ...h, poDate: val }))} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField label="Lead Time" fullWidth value={header.leadTime} placeholder="e.g. 7 days" onChange={(e) => setHeader((h) => ({ ...h, leadTime: e.target.value }))} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField label="Credit Period (Days)" type="number" fullWidth value={header.creditPeriod} onChange={(e) => setHeader((h) => ({ ...h, creditPeriod: e.target.value }))} inputProps={{ min: 0 }} />
              </Grid>
              <Grid item xs={6} sm={3}>
                <TextField label="Payment Terms" fullWidth value={header.paymentTerms} onChange={(e) => setHeader((h) => ({ ...h, paymentTerms: e.target.value }))} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Delivery Terms" fullWidth value={header.deliveryTerms} onChange={(e) => setHeader((h) => ({ ...h, deliveryTerms: e.target.value }))} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Remarks" fullWidth value={header.remarks} onChange={(e) => setHeader((h) => ({ ...h, remarks: e.target.value }))} />
              </Grid>
            </Grid>
          </Paper>
        )}

        {/* 4 — items */}
        {groupKey && items.length > 0 && (
          <Paper elevation={0} sx={SECTION}>
            <Typography sx={{ fontWeight: 700, color: '#b45309', mb: 1.5 }}>Items</Typography>
            <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: GRID_COLS, gap: 1, px: 1, mb: 0.5 }}>
              {['Indent No', 'Item Name', 'SKU', 'Qty', 'Unit', 'Rate', 'GST %', 'Total', ''].map((h, i) => (
                <Typography key={i} variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.6rem' }}>{h}</Typography>
              ))}
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {items.map((it, idx) => {
                const { total } = lineCalc(it);
                return (
                  <Box key={it.key || idx} sx={{
                    display: 'grid', gridTemplateColumns: { xs: '1fr', md: GRID_COLS }, gap: 1, alignItems: 'center',
                    p: { xs: 1.5, md: 0.5 }, px: { md: 1 }, borderRadius: '10px',
                    border: { xs: '1px solid', md: 'none' }, borderColor: 'divider',
                    '&:hover': { bgcolor: alpha('#6d28d9', 0.03) },
                  }}>
                    <Chip size="small" label={it.indentNumber} sx={{ fontWeight: 700, height: 22, justifySelf: 'start' }} />
                    <TextField size="small" value={it.itemName} onChange={(e) => setItem(idx, { itemName: e.target.value })} />
                    <TextField size="small" value={it.skuCode} onChange={(e) => setItem(idx, { skuCode: e.target.value.toUpperCase() })} />
                    <TextField size="small" type="number" value={it.quantity} onChange={(e) => setItem(idx, { quantity: e.target.value })} inputProps={{ min: 0, style: { textAlign: 'right' } }} sx={NO_SPIN} />
                    <TextField size="small" select value={it.unit} onChange={(e) => setItem(idx, { unit: e.target.value })}>
                      {UNITS.map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                    </TextField>
                    <TextField size="small" type="number" value={it.rate} onChange={(e) => setItem(idx, { rate: e.target.value })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right' } }} sx={NO_SPIN} />
                    <TextField size="small" type="number" value={it.gstRate} onChange={(e) => setItem(idx, { gstRate: e.target.value })} inputProps={{ min: 0, max: 100, style: { textAlign: 'right' } }} sx={NO_SPIN} />
                    <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{total.toFixed(2)}</Typography>
                    <Tooltip title="Remove">
                      <span>
                        <IconButton size="small" color="error" onClick={() => removeItem(idx)} disabled={items.length === 1}><Trash2 size={15} /></IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                );
              })}
            </Box>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={700}>TAXABLE</Typography>
                <Typography fontWeight={700}>{fmtINR(totals.taxable)}</Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={700}>GST</Typography>
                <Typography fontWeight={700}>{fmtINR(totals.tax)}</Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="primary.main" fontWeight={700}>GRAND TOTAL</Typography>
                <Typography variant="h6" fontWeight={800} color="primary.dark">{fmtINR(totals.grand)}</Typography>
              </Box>
            </Box>
          </Paper>
        )}
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
            Create PO
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
};

export default MultiIndentPoDrawer;
