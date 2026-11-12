import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Grid, TextField, Typography, Autocomplete, Button, IconButton, Alert, Table, TableHead, TableBody,
  TableRow, TableCell, Tooltip,
} from '@mui/material';
import { Plus, Trash2, PackageX } from 'lucide-react';
import { useGetVendorsQuery } from '../../../store/api/vendorApi';
import { useGetSkuLookupQuery } from '../../../store/api/skuApi';
import { purchaseUnitOf } from '../../../utils/unitConversion';
import { isPurchasableSku } from '../indents/IndentFormDrawer';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { fmtINR, directPurchaseLine, directPurchaseTotals } from './voucherMeta';

const NO_SPIN = {
  '& input[type=number]': { MozAppearance: 'textfield' },
  '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
};
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const canBuy = (s) => isPurchasableSku(s) && String(s?.itemType || '').toUpperCase() !== 'SCRAP';
let keySeq = 0;
export const newDirectPurchaseItem = () => ({
  key: `dp-${(keySeq += 1)}`, skuId: '', itemName: '', skuCode: '', unit: '', description: '',
  quantity: '', rate: '', discountAmount: '', gstRate: '',
});
export const emptyDirectPurchase = () => ({
  vendorId: '', vendorName: '', invoiceNumber: '', invoiceDate: '', voucherDate: '',
  paymentTerms: '', dueDate: '', remarks: '', items: [newDirectPurchaseItem()],
});
export const directPurchaseFromVoucher = (v) => ({
  vendorId: v.vendorId || '', vendorName: v.vendorName || '',
  invoiceNumber: v.invoiceNumber || '', invoiceDate: v.invoiceDate ? v.invoiceDate.slice(0, 10) : '',
  voucherDate: v.voucherDate ? v.voucherDate.slice(0, 10) : '',
  paymentTerms: v.paymentTerms || '', dueDate: v.dueDate ? v.dueDate.slice(0, 10) : '', remarks: v.remarks || '',
  items: (v.items || []).map((it) => ({
    key: `dp-${(keySeq += 1)}`, _id: it._id, skuId: it.skuId || '', itemName: it.itemName || '', skuCode: it.skuCode || '',
    unit: it.unit || '', description: it.description || '', quantity: it.quantity ?? '', rate: it.rate ?? '',
    discountAmount: it.discountAmount || '', gstRate: it.gstRate ?? '',
  })),
});

/** Client-side checks before save (the server re-checks every one). Returns a message or ''. */
export const directPurchaseProblem = (df) => {
  if (!df.vendorId) return 'Select the vendor from the Vendor Master';
  if (!df.invoiceNumber.trim()) return 'Vendor Invoice Number is required';
  if (!df.invoiceDate) return 'Invoice Date is required';
  if (!df.items.length) return 'Add at least one purchase item';
  for (let i = 0; i < df.items.length; i += 1) {
    const it = df.items[i];
    const n = `Item ${i + 1}`;
    if (!it.skuId) return `${n}: pick the item from the SKU Master list`;
    if (!(Number(it.quantity) > 0)) return `${n}: quantity must be greater than zero`;
    if (it.rate === '' || Number(it.rate) < 0) return `${n}: enter a rate (0 or more)`;
    if (it.gstRate === '' || Number(it.gstRate) < 0 || Number(it.gstRate) > 100) return `${n}: GST rate must be between 0 and 100`;
    const l = directPurchaseLine(it);
    if (Number(it.discountAmount) < 0 || l.discountAmount > l.grossAmount + 0.005) return `${n}: discount cannot be more than the line amount`;
  }
  if (!(directPurchaseTotals(df.items).grandTotal > 0)) return 'The voucher total must be greater than zero';
  return '';
};

/** API payload: only ids + the user's own figures (names / units / amounts come from the server). */
export const directPurchasePayload = (df, invoiceDoc) => ({
  voucherType: 'DIRECT_PURCHASE',
  vendorId: df.vendorId,
  invoiceNumber: df.invoiceNumber.trim(),
  invoiceDate: df.invoiceDate,
  voucherDate: df.voucherDate || undefined,
  paymentTerms: df.paymentTerms.trim() || undefined,
  dueDate: df.dueDate || undefined,
  remarks: df.remarks.trim() || undefined,
  invoiceDocument: invoiceDoc ? { fileUrl: invoiceDoc.fileUrl, fileName: invoiceDoc.fileName } : null,
  items: df.items.map((it) => ({
    ...(it._id ? { _id: it._id } : {}),
    skuId: it.skuId,
    description: it.description.trim() || undefined,
    quantity: Number(it.quantity),
    rate: Number(it.rate),
    discountAmount: Number(it.discountAmount) || 0,
    gstRate: Number(it.gstRate),
  })),
});

const addDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Direct Purchase Voucher form body (goods bought with no Indent / PO / GRN).
 * Vendor from the active Vendor Master; every line from the SKU Master. Totals
 * are a preview — the server recomputes and validates everything.
 */
const DirectPurchaseFields = ({ open, df, setDf, uploadField }) => {
  const { data: vendorsRes, isLoading: vendorsLoading } = useGetVendorsQuery({ limit: 1000, sort: 'name' }, { skip: !open });
  const vendorOptions = useMemo(() => {
    const allVendors = vendorsRes?.data || [];
    const active = allVendors.filter((v) => v.isActive !== false);
    // Editing a draft whose vendor was deactivated since: keep it visible (marked).
    const current = df.vendorId && !active.some((v) => v._id === df.vendorId)
      ? [allVendors.find((v) => v._id === df.vendorId) || { _id: df.vendorId, name: df.vendorName, isActive: false }]
      : [];
    return [...current, ...active];
  }, [vendorsRes, df.vendorId, df.vendorName]);
  const vendor = vendorOptions.find((v) => v._id === df.vendorId) || null;
  const vendorProduct = (skuId) => (vendor?.products || []).find((p) => p.skuId && String(p.skuId) === String(skuId)) || null;

  const { data: skuRes, isLoading: skusLoading } = useGetSkuLookupQuery({ limit: 2000 }, { skip: !open });
  const [skuSearch, setSkuSearch] = useState('');
  const [skuTerm, setSkuTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setSkuTerm(skuSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [skuSearch]);
  const { data: skuSearchRes } = useGetSkuLookupQuery({ search: escapeRegex(skuTerm), limit: 50 }, { skip: !open || skuTerm.length < 2 });
  const skuOptions = useMemo(() => {
    const byId = new Map();
    [...(skuRes?.data || []), ...(skuSearchRes?.data || [])].filter(canBuy).forEach((s) => byId.set(String(s._id), s));
    df.items.forEach((it) => {
      if (it.skuId && !byId.has(String(it.skuId))) byId.set(String(it.skuId), { _id: it.skuId, name: it.itemName, code: it.skuCode, unit: it.unit });
    });
    return [...byId.values()];
  }, [skuRes, skuSearchRes, df.items]);

  const set = (k) => (v) => setDf((f) => ({ ...f, [k]: v?.target ? v.target.value : v }));
  const setItem = (i, patch) => setDf((f) => ({ ...f, items: f.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));

  const pickVendor = (v) => setDf((f) => {
    const next = { ...f, vendorId: v?._id || '', vendorName: v?.name || '' };
    const days = Number(v?.creditPeriodDays) || 0;
    if (v && days > 0) {
      if (!f.paymentTerms.trim()) next.paymentTerms = `${days} days credit`;
      if (!f.dueDate && f.invoiceDate) next.dueDate = addDays(f.invoiceDate, days);
    }
    return next;
  });
  const pickInvoiceDate = (iso) => setDf((f) => {
    const days = Number(vendor?.creditPeriodDays) || 0;
    return { ...f, invoiceDate: iso, ...(iso && days > 0 && !f.dueDate ? { dueDate: addDays(iso, days) } : {}) };
  });
  const pickSku = (i, s) => {
    if (!s) { setItem(i, { skuId: '', itemName: '', skuCode: '', unit: '' }); return; }
    const vp = vendorProduct(s._id);
    const cur = df.items[i];
    setItem(i, {
      skuId: s._id, itemName: s.name || '', skuCode: s.code || '', unit: purchaseUnitOf(s),
      // Defaults only — the user can change them. Vendor Master rate / GST first.
      rate: cur.rate !== '' ? cur.rate : (vp?.rate || ''),
      gstRate: cur.gstRate !== '' ? cur.gstRate : (vp?.gstRate ?? s.gstRate ?? ''),
    });
  };

  const totals = directPurchaseTotals(df.items);
  const num = (label, i, k, extra = {}) => (
    <TextField size="small" type="number" value={df.items[i][k]} onChange={(e) => setItem(i, { [k]: e.target.value })}
      inputProps={{ min: 0, step: 'any', 'aria-label': label, 'data-testid': `dp-item-${k}-${i}`, ...extra }} sx={{ ...NO_SPIN, width: k === 'gstRate' ? 72 : 92 }} />
  );

  return (
    <Grid container spacing={2}>
      <Grid item xs={12}>
        <Alert severity="info" icon={<PackageX size={18} />} sx={{ borderRadius: '10px' }} data-testid="dp-financial-only">
          Direct purchase of goods with <b>no Purchase Indent, PO or GRN</b>. This voucher is financial only — it does
          <b> not</b> post stock. Goods that must go into stock are received through <b>GRN (Without PO)</b> and QC.
        </Alert>
      </Grid>

      <Grid item xs={12}><Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>VENDOR &amp; INVOICE DETAILS</Typography></Grid>
      <Grid item xs={12} sm={6}>
        <Autocomplete
          size="small"
          options={vendorOptions}
          loading={vendorsLoading}
          value={vendor}
          onChange={(_e, v) => pickVendor(v)}
          isOptionEqualToValue={(o, v) => o._id === v._id}
          getOptionLabel={(o) => `${o.name || '—'}${o.code ? ` (${o.code})` : ''}${o.isActive === false ? ' — inactive' : ''}`}
          getOptionDisabled={(o) => o.isActive === false}
          noOptionsText="No active vendor in the Vendor Master"
          renderInput={(params) => (
            <TextField {...params} label="Vendor *" inputProps={{ ...params.inputProps, 'data-testid': 'dp-vendor' }}
              helperText={vendor?.isActive === false ? 'This vendor is inactive in the Vendor Master — pick another' : 'Active vendors from the Vendor Master'}
              error={vendor?.isActive === false} />
          )}
        />
      </Grid>
      <Grid item xs={12} sm={6}>
        <TextField fullWidth size="small" label="Vendor Invoice Number *" value={df.invoiceNumber} onChange={set('invoiceNumber')}
          inputProps={{ 'data-testid': 'dp-invoice-no', maxLength: 120 }} />
      </Grid>
      <Grid item xs={6} sm={3} data-testid="dp-invoice-date">
        <DateInputDDMMYYYY fullWidth size="small" label="Invoice Date *" value={df.invoiceDate} onChange={pickInvoiceDate} />
      </Grid>
      <Grid item xs={6} sm={3} data-testid="dp-voucher-date">
        <DateInputDDMMYYYY fullWidth size="small" label="Voucher Date" value={df.voucherDate} onChange={set('voucherDate')} />
      </Grid>
      <Grid item xs={6} sm={3}>
        <TextField fullWidth size="small" label="Payment Terms" value={df.paymentTerms} onChange={set('paymentTerms')} inputProps={{ 'data-testid': 'dp-payment-terms' }} />
      </Grid>
      <Grid item xs={6} sm={3} data-testid="dp-due-date">
        <DateInputDDMMYYYY fullWidth size="small" label="Due Date" value={df.dueDate} onChange={set('dueDate')} />
      </Grid>

      <Grid item xs={12} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>PURCHASE ITEMS ({df.items.length})</Typography>
        <Button size="small" variant="outlined" startIcon={<Plus size={14} />} data-testid="dp-add-item"
          onClick={() => setDf((f) => ({ ...f, items: [...f.items, newDirectPurchaseItem()] }))}>Add Item</Button>
      </Grid>
      <Grid item xs={12}>
        <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: '10px' }}>
          <Table size="small" sx={{ minWidth: 1100, '& td, & th': { px: 0.75 } }}>
            <TableHead>
              <TableRow>
                {['#', 'Item / SKU *', 'SKU Code', 'Description', 'Qty *', 'Unit', 'Rate *', 'Discount ₹', 'GST % *', 'Tax', 'Line Total', ''].map((h, i) => (
                  <TableCell key={i} sx={{ fontWeight: 700, fontSize: '0.72rem', whiteSpace: 'nowrap' }} align={i >= 9 && i <= 10 ? 'right' : 'left'}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {df.items.map((it, i) => {
                const l = directPurchaseLine(it);
                const sku = skuOptions.find((s) => String(s._id) === String(it.skuId)) || null;
                return (
                  <TableRow key={it.key} data-testid={`dp-item-row-${i}`}>
                    <TableCell sx={{ fontSize: '0.78rem' }}>{i + 1}</TableCell>
                    <TableCell sx={{ minWidth: 280 }}>
                      <Autocomplete
                        size="small"
                        options={skuOptions}
                        loading={skusLoading}
                        value={sku}
                        onChange={(_e, s) => pickSku(i, s)}
                        onInputChange={(_e, v, reason) => { if (reason === 'input') setSkuSearch(v); }}
                        isOptionEqualToValue={(o, v) => String(o._id) === String(v._id)}
                        // The input shows the name (the code has its own column);
                        // options show and match both.
                        getOptionLabel={(o) => o.name || o.code || '—'}
                        filterOptions={(opts, { inputValue }) => {
                          const q = inputValue.trim().toLowerCase();
                          const hits = q ? opts.filter((o) => `${o.name || ''} ${o.code || ''}`.toLowerCase().includes(q)) : opts;
                          return hits.slice(0, 100);
                        }}
                        renderOption={(props, o) => (
                          <li {...props} key={o._id}>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="body2" fontWeight={600} noWrap>{o.name || '—'}</Typography>
                              <Typography variant="caption" color="text.secondary" noWrap component="div">
                                {[o.code, purchaseUnitOf(o), o.itemType && String(o.itemType).replace(/_/g, ' ')].filter(Boolean).join(' · ')}
                              </Typography>
                            </Box>
                          </li>
                        )}
                        noOptionsText="No active SKU matches"
                        renderInput={(params) => (
                          <TextField {...params} placeholder="Search SKU Master" inputProps={{ ...params.inputProps, 'data-testid': `dp-item-sku-${i}` }} />
                        )}
                      />
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }} data-testid={`dp-item-code-${i}`}>{it.skuCode || '—'}</TableCell>
                    <TableCell sx={{ minWidth: 170 }}>
                      <TextField size="small" fullWidth value={it.description} onChange={(e) => setItem(i, { description: e.target.value })}
                        inputProps={{ maxLength: 500, 'aria-label': 'Description', 'data-testid': `dp-item-description-${i}` }} />
                    </TableCell>
                    <TableCell>{num('Quantity', i, 'quantity')}</TableCell>
                    <TableCell sx={{ fontSize: '0.78rem' }} data-testid={`dp-item-unit-${i}`}>{it.unit || '—'}</TableCell>
                    <TableCell>{num('Rate', i, 'rate')}</TableCell>
                    <TableCell>{num('Discount', i, 'discountAmount')}</TableCell>
                    <TableCell>{num('GST rate', i, 'gstRate', { max: 100 })}</TableCell>
                    <TableCell align="right" sx={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }} data-testid={`dp-item-tax-${i}`}>{fmtINR(l.taxAmount)}</TableCell>
                    <TableCell align="right" sx={{ fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap' }} data-testid={`dp-item-total-${i}`}>{fmtINR(l.lineTotal)}</TableCell>
                    <TableCell>
                      <Tooltip title={df.items.length === 1 ? 'At least one item is required' : 'Remove item'}>
                        <span>
                          <IconButton size="small" color="error" disabled={df.items.length === 1} aria-label={`Remove item ${i + 1}`} data-testid={`dp-remove-item-${i}`}
                            onClick={() => setDf((f) => ({ ...f, items: f.items.filter((_x, j) => j !== i) }))}><Trash2 size={15} /></IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      </Grid>

      <Grid item xs={12}>
        <Box data-testid="dp-totals" sx={{ p: 2, borderRadius: '12px', border: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end', gap: 3.5, flexWrap: 'wrap' }}>
          {[['SUB TOTAL', totals.grossAmount, 'dp-subtotal'], ['− DISCOUNT', totals.discountTotal, 'dp-discount'], ['TAXABLE', totals.taxableAmount, 'dp-taxable'], ['TOTAL TAX', totals.taxAmount, 'dp-tax']].map(([label, value, id]) => (
            <Box key={id} sx={{ textAlign: 'right' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>{label}</Typography>
              <Typography fontWeight={700} data-testid={id}>{fmtINR(value)}</Typography>
            </Box>
          ))}
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="caption" color="text.secondary" fontWeight={700}>GRAND TOTAL</Typography>
            <Typography fontWeight={800} color="primary.dark" data-testid="dp-grand-total">{fmtINR(totals.grandTotal)}</Typography>
          </Box>
        </Box>
      </Grid>

      <Grid item xs={12} sm={4}>{uploadField}</Grid>
      <Grid item xs={12} sm={8}>
        <TextField fullWidth size="small" multiline minRows={2} label="Remarks" value={df.remarks} onChange={set('remarks')} inputProps={{ 'data-testid': 'dp-remarks', maxLength: 1000 }} />
      </Grid>
    </Grid>
  );
};

export default DirectPurchaseFields;
