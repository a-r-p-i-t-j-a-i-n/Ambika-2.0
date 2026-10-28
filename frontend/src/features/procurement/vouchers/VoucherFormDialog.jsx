import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem,
  Box, Typography, Grid, CircularProgress, Alert, FormControl, FormLabel,
  RadioGroup, FormControlLabel, Radio, IconButton, Autocomplete,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Banknote, Info, Upload, FileText, X, ExternalLink } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetVendorInvoicesQuery,
  useGetVoucherExpenseLinksQuery,
  useCreateVoucherMutation,
  useUpdateVoucherMutation,
  usePostVoucherMutation,
} from '../../../store/api/procurementApi';
import { useGetPartiesQuery } from '../../../store/api/partyApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { fmtINR, fmtDate, EXPENSE_CATEGORIES, EXPENSE_TYPES, expenseTypeOf, expenseTypeMeta } from './voucherMeta';
import { fileHref } from '../indents/indentMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

const ACCEPT = '.pdf,image/*,.xls,.xlsx,.doc,.docx';
const NO_SPIN = {
  '& input[type=number]': { MozAppearance: 'textfield' },
  '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
};
const num = (n) => Number(n) || 0;
const emptyPurchase = { invoiceId: '', voucherDate: '', remarks: '' };
const emptyExpense = {
  expenseType: 'DIRECT', poId: '', grnId: '',
  voucherDate: '', expenseCategory: '', vendorId: '', partyName: '', expenseInvoiceNo: '', expenseInvoiceDate: '',
  basicValue: '', freightCharges: '', packingForwardingCharges: '', otherCharges: '', taxAmount: '',
  taxableAmount: '', gstRatePercent: '',
  tcsAmount: '', tdsAmount: '', advanceAmount: '', otherReason: '', paymentTerms: '', dueDate: '',
  preparedBy: '', remarks: '',
};

/**
 * Create / edit a Voucher (Step 1.11). Two formats:
 *  • PURCHASE — from a payment-pending Vendor Invoice (no payment captured here).
 *  • EXPENSE — company expense / direct bill (category + amounts, never an
 *    invoice). Expense Type: Direct (no PO/GRN), Against PO (no GRN) or Against
 *    GRN (a GRN raised without a PO). A linked bill takes its vendor from that
 *    PO / GRN; the backend enforces every rule (expenseLink.js).
 */
const VoucherFormDialog = ({ open, onClose, voucher, presetInvoice }) => {
  const { enqueueSnackbar } = useSnackbar();
  const isEdit = Boolean(voucher?._id);
  const fileRef = React.useRef(null);

  const [voucherType, setVoucherType] = useState('PURCHASE');
  const [pf, setPf] = useState(emptyPurchase);     // purchase form
  const [ef, setEf] = useState(emptyExpense);       // expense form
  const [invoiceDoc, setInvoiceDoc] = useState(null);
  const isExpense = voucherType === 'EXPENSE';

  const { data: invRes } = useGetVendorInvoicesQuery(
    { invoiceStatus: 'PAYMENT_PENDING', limit: 200, sort: '-createdAt' },
    { skip: !open || isExpense || Boolean(presetInvoice) },
  );
  const invoiceOptions = useMemo(() => {
    const list = invRes?.data || [];
    if (presetInvoice && !list.find((i) => i._id === presetInvoice._id)) return [presetInvoice, ...list];
    return presetInvoice ? [presetInvoice] : list;
  }, [invRes, presetInvoice]);

  // Vendor master, for linking a Direct Bill Passing expense to a real vendor
  // instead of (or alongside) a free-typed party name.
  const { data: partiesRes } = useGetPartiesQuery({ limit: 500, sort: 'name' }, { skip: !open || !isExpense });
  const partyOptions = partiesRes?.data || [];

  // Expense Against PO / GRN: only the documents the backend would accept now.
  const linkKind = ef.expenseType === 'AGAINST_PO' ? 'PO' : ef.expenseType === 'AGAINST_GRN' ? 'GRN' : null;
  const { data: linkRes, isFetching: linksLoading } = useGetVoucherExpenseLinksQuery(
    { type: linkKind, ...(isEdit ? { excludeVoucherId: voucher._id } : {}) },
    { skip: !open || !isExpense || !linkKind, refetchOnMountOrArgChange: true },
  );
  const linkOptions = useMemo(() => {
    const list = linkRes?.data || [];
    // Editing: keep the voucher's own PO / GRN selectable even if the list has moved on.
    if (isEdit && linkKind === 'PO' && voucher.poId && !list.some((o) => o._id === voucher.poId)) {
      return [{ _id: voucher.poId, poNumber: voucher.poNumber, vendorId: voucher.vendorId, vendorName: voucher.vendorName }, ...list];
    }
    if (isEdit && linkKind === 'GRN' && voucher.grnId && !list.some((o) => o._id === voucher.grnId)) {
      return [{ _id: voucher.grnId, grnNumber: voucher.grnNumbers?.[0], vendorId: voucher.vendorId, vendorName: voucher.vendorName }, ...list];
    }
    return list;
  }, [linkRes, isEdit, linkKind, voucher]);
  const linkedDoc = useMemo(() => {
    const id = linkKind === 'PO' ? ef.poId : linkKind === 'GRN' ? ef.grnId : '';
    return (id && linkOptions.find((o) => o._id === id)) || null;
  }, [linkKind, ef.poId, ef.grnId, linkOptions]);

  const [createVoucher, { isLoading: creating }] = useCreateVoucherMutation();
  const [updateVoucher, { isLoading: updating }] = useUpdateVoucherMutation();
  const [postVoucher, { isLoading: posting }] = usePostVoucherMutation();
  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();
  const busy = creating || updating || posting;

  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      setVoucherType(voucher.voucherType || 'PURCHASE');
      setPf({ invoiceId: voucher.invoiceId || '', voucherDate: voucher.voucherDate ? voucher.voucherDate.slice(0, 10) : '', remarks: voucher.remarks || '' });
      setEf({
        expenseType: expenseTypeOf(voucher) || 'DIRECT', poId: voucher.poId || '', grnId: voucher.grnId || '',
        voucherDate: voucher.voucherDate ? voucher.voucherDate.slice(0, 10) : '',
        expenseCategory: voucher.expenseCategory || '', vendorId: voucher.vendorId || '', partyName: voucher.partyName || voucher.vendorName || '',
        expenseInvoiceNo: voucher.expenseInvoiceNo || '', expenseInvoiceDate: voucher.expenseInvoiceDate ? voucher.expenseInvoiceDate.slice(0, 10) : '',
        basicValue: voucher.basicValue ?? '', freightCharges: voucher.freightCharges ?? '', packingForwardingCharges: voucher.packingForwardingCharges ?? '',
        otherCharges: voucher.otherCharges ?? '', taxAmount: voucher.taxAmount ?? '',
        taxableAmount: voucher.taxableAmount ?? '', gstRatePercent: voucher.gstRatePercent ?? '',
        tcsAmount: voucher.tcsAmount ?? '',
        tdsAmount: voucher.tdsAmount ?? '', advanceAmount: voucher.advanceAmount ?? '', otherReason: voucher.otherReason || '',
        paymentTerms: voucher.paymentTerms || '', dueDate: voucher.dueDate ? voucher.dueDate.slice(0, 10) : '', preparedBy: voucher.preparedBy || '',
        remarks: voucher.remarks || '',
      });
      setInvoiceDoc(voucher.invoiceDocument?.fileUrl ? { fileUrl: voucher.invoiceDocument.fileUrl, fileName: voucher.invoiceDocument.fileName } : null);
    } else {
      setVoucherType('PURCHASE');
      setPf({ ...emptyPurchase, invoiceId: presetInvoice?._id || '' });
      setEf(emptyExpense);
      setInvoiceDoc(null);
    }
  }, [open, isEdit, voucher, presetInvoice]);

  const selectedInvoice = useMemo(
    () => invoiceOptions.find((i) => i._id === pf.invoiceId) || presetInvoice || null,
    [invoiceOptions, pf.invoiceId, presetInvoice],
  );
  const src = isEdit ? voucher : selectedInvoice;

  const setE = (k) => (e) => setEf((f) => ({ ...f, [k]: e.target.value }));

  // A PO / GRN bill's vendor comes from that document — switching type drops
  // the previous document and its vendor.
  const changeExpenseType = (e) => {
    const expenseType = e.target.value;
    setEf((f) => (f.expenseType === expenseType ? f : { ...f, expenseType, poId: '', grnId: '', vendorId: '', partyName: '' }));
  };
  const pickLinkedDoc = (doc) => setEf((f) => {
    if (!doc) return { ...f, poId: '', grnId: '', vendorId: '', partyName: '' };
    const next = { ...f, vendorId: doc.vendorId || '', partyName: doc.vendorName || '' };
    if (linkKind === 'PO') return { ...next, poId: doc._id, paymentTerms: f.paymentTerms || doc.paymentTerms || '' };
    // The GRN's supplier invoice is usually the bill being passed.
    return {
      ...next, grnId: doc._id,
      expenseInvoiceNo: f.expenseInvoiceNo || doc.invoiceNumber || '',
      expenseInvoiceDate: f.expenseInvoiceDate || (doc.invoiceDate ? doc.invoiceDate.slice(0, 10) : ''),
    };
  });

  // When a taxable amount + GST rate are given, GST is derived (preview only —
  // the backend always computes the authoritative amount the same way).
  const gstAmount = useMemo(() => (
    (num(ef.taxableAmount) || num(ef.gstRatePercent)) ? Math.round(num(ef.taxableAmount) * num(ef.gstRatePercent)) / 100 : num(ef.taxAmount)
  ), [ef.taxableAmount, ef.gstRatePercent, ef.taxAmount]);
  // Bill value before TDS / advance — what the backend compares with the PO value.
  const grossBill = useMemo(() => (
    num(ef.basicValue) + num(ef.freightCharges) + num(ef.packingForwardingCharges) + num(ef.otherCharges)
    + gstAmount + num(ef.tcsAmount)
  ), [ef, gstAmount]);
  const expenseTotal = grossBill - num(ef.tdsAmount) - num(ef.advanceAmount);
  const overPoValue = linkKind === 'PO' && linkedDoc?.remainingAmount != null && grossBill > linkedDoc.remainingAmount + 0.005;

  const handleFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { enqueueSnackbar('File exceeds 10 MB', { variant: 'warning' }); return; }
    try {
      const res = await uploadDoc(f).unwrap();
      const d = res?.data || {};
      setInvoiceDoc({ fileName: d.fileName || f.name, fileUrl: d.url });
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Upload failed', { variant: 'error' }); }
  };

  const buildPayload = () => {
    if (isExpense) {
      const warn = (msg) => { enqueueSnackbar(msg, { variant: 'warning' }); return null; };
      if (linkKind === 'PO' && !ef.poId) return warn('Select the Purchase Order this expense is against');
      if (linkKind === 'GRN' && !ef.grnId) return warn('Select the GRN this expense is against');
      if (!ef.expenseCategory) return warn('Select an expense category');
      if (!linkKind && !ef.partyName.trim()) return warn('Vendor / party name is required');
      if (linkKind && !ef.expenseInvoiceNo.trim()) return warn(`Vendor Bill/Invoice No is required for an expense against a ${linkKind}`);
      if (!linkKind && ef.vendorId && !ef.expenseInvoiceNo.trim()) return warn('Vendor Bill/Invoice No is required for a vendor-master bill');
      if (overPoValue) return warn(`Bill value ${fmtINR(grossBill)} is above what is left on this PO (${fmtINR(linkedDoc.remainingAmount)})`);
      return {
        voucherType: 'EXPENSE',
        expenseType: ef.expenseType,
        poId: linkKind === 'PO' ? ef.poId : undefined,
        grnId: linkKind === 'GRN' ? ef.grnId : undefined,
        voucherDate: ef.voucherDate || undefined,
        expenseCategory: ef.expenseCategory,
        // null (not undefined) so an edit can also clear the vendor link.
        vendorId: ef.vendorId || null,
        partyName: ef.partyName.trim() || undefined,
        expenseInvoiceNo: ef.expenseInvoiceNo.trim() || undefined,
        expenseInvoiceDate: ef.expenseInvoiceDate || undefined,
        invoiceDocument: invoiceDoc ? { fileUrl: invoiceDoc.fileUrl, fileName: invoiceDoc.fileName } : undefined,
        basicValue: num(ef.basicValue), freightCharges: num(ef.freightCharges), packingForwardingCharges: num(ef.packingForwardingCharges),
        otherCharges: num(ef.otherCharges), taxAmount: num(ef.taxAmount),
        taxableAmount: num(ef.taxableAmount), gstRatePercent: num(ef.gstRatePercent),
        tcsAmount: num(ef.tcsAmount),
        tdsAmount: num(ef.tdsAmount), advanceAmount: num(ef.advanceAmount), otherReason: ef.otherReason.trim() || undefined,
        paymentTerms: ef.paymentTerms.trim() || undefined, dueDate: ef.dueDate || undefined, preparedBy: ef.preparedBy.trim() || undefined,
        remarks: ef.remarks.trim() || undefined,
      };
    }
    if (!pf.invoiceId) { enqueueSnackbar('Select an invoice', { variant: 'warning' }); return null; }
    return { voucherType: 'PURCHASE', invoiceId: pf.invoiceId, voucherDate: pf.voucherDate || undefined, remarks: pf.remarks.trim() || undefined };
  };

  // `direct`: create, then immediately post (Draft → Posted) in the same
  // action — reusing the exact same post() call the voucher detail page's own
  // "Post Voucher" button makes. Posting is NOT approval: it only moves the
  // voucher into the MD-approval queue (unchanged, still mandatory before
  // Tally Entry) and never records a payment — Final Payment remains the only
  // place that happens. Only offered for a brand-new voucher (`!isEdit`).
  const submit = async (direct = false) => {
    const payload = buildPayload();
    if (!payload) return;
    try {
      if (isEdit) {
        await updateVoucher({ id: voucher._id, ...payload }).unwrap();
        enqueueSnackbar('Voucher updated', { variant: 'success' });
        onClose?.(true);
        return;
      }
      const res = await createVoucher(payload).unwrap();
      if (direct && res?.data?._id) {
        try {
          await postVoucher({ id: res.data._id }).unwrap();
          enqueueSnackbar('Voucher created and posted — pending MD approval', { variant: 'success' });
        } catch (err) {
          // The voucher itself was created successfully as a draft — only the
          // immediate post failed. Nothing is lost; it's visible in the list
          // and can be posted from its own detail page.
          enqueueSnackbar(err?.data?.message || 'Voucher created as a draft, but posting failed — post it from the voucher page', { variant: 'error' });
        }
      } else {
        enqueueSnackbar('Voucher created', { variant: 'success' });
      }
      // Second arg = the newly created voucher, so a caller that isn't
      // already on the voucher list (e.g. a Quick Action) can open it.
      onClose?.(true, res?.data);
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to save voucher', { variant: 'error' }); }
  };

  const Amt = ({ label, value, strong }) => (
    <Box sx={{ textAlign: 'right' }}>
      <Typography variant="caption" color="text.secondary" fontWeight={700}>{label}</Typography>
      <Typography fontWeight={strong ? 800 : 700} color={strong ? 'primary.dark' : 'text.primary'}>{fmtINR(value)}</Typography>
    </Box>
  );
  const NumField = (label, key, sm = 4) => (
    <Grid item xs={6} sm={sm}>
      <TextField fullWidth size="small" type="number" label={label} value={ef[key]} onChange={setE(key)} inputProps={{ min: 0, step: 0.01 }} sx={NO_SPIN} />
    </Grid>
  );

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth={isExpense ? 'md' : 'sm'} fullWidth>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Banknote size={20} /> {isEdit ? `Edit ${isExpense ? 'Expense' : 'Purchase'} Voucher` : 'New Voucher'}
      </DialogTitle>
      <DialogContent dividers>
        {/* Step 1 — Voucher Type */}
        <FormControl sx={{ mb: 2 }}>
          <FormLabel sx={{ fontSize: '0.8rem', fontWeight: 700 }}>Voucher Type *</FormLabel>
          <RadioGroup row value={voucherType} onChange={(e) => setVoucherType(e.target.value)}>
            <FormControlLabel value="PURCHASE" control={<Radio />} label="Purchase Voucher" disabled={isEdit} />
            <FormControlLabel value="EXPENSE" control={<Radio />} label="Expense / Direct Bill" disabled={isEdit} />
          </RadioGroup>
          {isExpense && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: -0.5 }}>
              Office, service, repair, maintenance or other vendor bills — not from a Vendor Invoice.
            </Typography>
          )}
        </FormControl>

        {isExpense ? (
          <Grid container spacing={2}>
            <Grid item xs={12} sm={linkKind ? 6 : 12}>
              <TextField select fullWidth size="small" label="Expense Type *" value={ef.expenseType} onChange={changeExpenseType}
                helperText={expenseTypeMeta(ef.expenseType).help} inputProps={{ 'data-testid': 'expense-type' }}>
                {EXPENSE_TYPES.map((t) => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
              </TextField>
            </Grid>
            {linkKind && (
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  size="small"
                  options={linkOptions}
                  loading={linksLoading}
                  value={linkedDoc}
                  onChange={(_e, v) => pickLinkedDoc(v)}
                  isOptionEqualToValue={(o, v) => o._id === v._id}
                  getOptionLabel={(o) => `${(linkKind === 'PO' ? o.poNumber : o.grnNumber) || '—'} · ${o.vendorName || '—'}`}
                  renderOption={(props, o) => (
                    <li {...props} key={o._id}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={700} sx={{ color: 'text.primary' }}>
                          {linkKind === 'PO' ? o.poNumber : o.grnNumber}
                          <Typography component="span" variant="caption" color="text.secondary"> · {fmtDate(linkKind === 'PO' ? o.poDate : o.grnDate)}</Typography>
                        </Typography>
                        <Typography variant="caption" color="text.secondary" component="div" noWrap>
                          {o.vendorName || '—'}
                          {linkKind === 'PO'
                            ? ` · PO value ${fmtINR(o.grandTotal)}${o.expensedAmount ? ` · left ${fmtINR(o.remainingAmount)}` : ''}`
                            : `${o.invoiceNumber ? ` · Bill ${o.invoiceNumber}` : ''} · QC ${o.qcStatus || '—'}`}
                        </Typography>
                      </Box>
                    </li>
                  )}
                  noOptionsText={linkKind === 'PO'
                    ? 'No approved PO without a GRN or vendor invoice'
                    : 'No completed GRN raised without a PO is waiting for a bill'}
                  renderInput={(params) => (
                    <TextField {...params} label={linkKind === 'PO' ? 'Purchase Order *' : 'GRN (raised without PO) *'}
                      inputProps={{ ...params.inputProps, 'data-testid': 'expense-link' }}
                      helperText={linkKind === 'PO' ? 'Approved POs with no GRN and no vendor invoice' : 'Completed GRNs raised without a PO, not yet billed'} />
                  )}
                />
              </Grid>
            )}
            {linkKind && linkedDoc && (
              <Grid item xs={12}>
                <Box data-testid="expense-link-summary" sx={{ p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9', display: 'flex', flexWrap: 'wrap', columnGap: 3, rowGap: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">{linkKind} <b>{linkKind === 'PO' ? linkedDoc.poNumber : linkedDoc.grnNumber}</b></Typography>
                  <Typography variant="caption" color="text.secondary">Vendor <b>{linkedDoc.vendorName || '—'}</b></Typography>
                  {linkKind === 'PO' ? (
                    <>
                      {linkedDoc.grandTotal != null && <Typography variant="caption" color="text.secondary">PO value <b>{fmtINR(linkedDoc.grandTotal)}</b></Typography>}
                      {linkedDoc.expensedAmount > 0 && <Typography variant="caption" color="text.secondary">Already billed <b>{fmtINR(linkedDoc.expensedAmount)}</b></Typography>}
                      {linkedDoc.remainingAmount != null && <Typography variant="caption" color="text.secondary">Left to bill <b>{fmtINR(linkedDoc.remainingAmount)}</b></Typography>}
                    </>
                  ) : (
                    <>
                      {linkedDoc.grnDate && <Typography variant="caption" color="text.secondary">Received <b>{fmtDate(linkedDoc.grnDate)}</b></Typography>}
                      {linkedDoc.totalValue > 0 && <Typography variant="caption" color="text.secondary">GRN value <b>{fmtINR(linkedDoc.totalValue)}</b></Typography>}
                      {linkedDoc.qcStatus && <Typography variant="caption" color="text.secondary">QC <b>{linkedDoc.qcStatus}</b></Typography>}
                    </>
                  )}
                </Box>
              </Grid>
            )}
            <Grid item xs={12} sm={4}>
              <DateInputDDMMYYYY fullWidth size="small" label="Voucher Date" value={ef.voucherDate} onChange={(v) => setEf((f) => ({ ...f, voucherDate: v }))} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField select fullWidth size="small" label="Expense Category *" value={ef.expenseCategory} onChange={setE('expenseCategory')}>
                {EXPENSE_CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={4}>
              {linkKind ? (
                <TextField fullWidth size="small" label={`Vendor (from ${linkKind})`} value={ef.partyName}
                  placeholder={`Select a ${linkKind} first`} InputLabelProps={{ shrink: true }}
                  InputProps={{ readOnly: true }} inputProps={{ 'data-testid': 'expense-vendor' }}
                  helperText={`Always the ${linkKind}'s vendor`} />
              ) : (
              <Autocomplete
                size="small" freeSolo
                options={partyOptions}
                getOptionLabel={(o) => (typeof o === 'string' ? o : o?.name || '')}
                isOptionEqualToValue={(o, v) => o._id === v._id}
                value={ef.vendorId ? (partyOptions.find((p) => p._id === ef.vendorId) || ef.partyName) : ef.partyName}
                onChange={(_e, v) => {
                  if (v && typeof v === 'object') setEf((f) => ({ ...f, vendorId: v._id, partyName: v.name || '' }));
                  else setEf((f) => ({ ...f, vendorId: '', partyName: v || '' }));
                }}
                onInputChange={(_e, v, reason) => { if (reason === 'input') setEf((f) => ({ ...f, vendorId: '', partyName: v })); }}
                renderInput={(params) => <TextField {...params} label="Vendor / Party Name *" helperText="Pick from the vendor master, or type a one-off party name" />}
              />
              )}
            </Grid>
            <Grid item xs={12} sm={4}>
              <TextField fullWidth size="small" label={(ef.vendorId || linkKind) ? 'Vendor Bill/Invoice No *' : 'Vendor Bill/Invoice No (optional)'}
                value={ef.expenseInvoiceNo} onChange={setE('expenseInvoiceNo')} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <DateInputDDMMYYYY fullWidth size="small" label="Bill Date (optional)" value={ef.expenseInvoiceDate} onChange={(v) => setEf((f) => ({ ...f, expenseInvoiceDate: v }))} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <FormLabel sx={{ fontSize: '0.7rem', fontWeight: 700, display: 'block', mb: 0.5 }}>Invoice Upload</FormLabel>
              <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={handleFile} />
              {invoiceDoc ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, p: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: '8px' }}>
                  <FileText size={15} /><Typography variant="caption" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>{invoiceDoc.fileName}</Typography>
                  <Button size="small" startIcon={<ExternalLink size={12} />} href={fileHref(invoiceDoc.fileUrl)} target="_blank" rel="noopener">View</Button>
                  <IconButton size="small" color="error" onClick={() => setInvoiceDoc(null)}><X size={13} /></IconButton>
                </Box>
              ) : (
                <Button size="small" variant="outlined" startIcon={uploading ? <CircularProgress size={13} /> : <Upload size={14} />} onClick={() => fileRef.current?.click()} disabled={uploading}>Upload</Button>
              )}
            </Grid>

            <Grid item xs={12}><Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>AMOUNT DETAILS</Typography></Grid>
            {NumField('Basic Value', 'basicValue')}
            {NumField('Freight Charges', 'freightCharges')}
            {NumField('Packing & Forwarding', 'packingForwardingCharges')}
            {NumField('Other Charges', 'otherCharges')}
            {NumField('Taxable Amount', 'taxableAmount')}
            {NumField('GST Rate %', 'gstRatePercent')}
            {NumField('Tax Amount (if no GST rate)', 'taxAmount')}
            <Grid item xs={12}>
              <Typography variant="caption" color="text.secondary">
                Enter Taxable Amount + GST Rate % to compute GST automatically — leave Tax Amount blank in that case.
                {(num(ef.taxableAmount) || num(ef.gstRatePercent)) ? ` GST amount: ${fmtINR(gstAmount)}.` : ''}
              </Typography>
            </Grid>
            {NumField('TCS (+)', 'tcsAmount')}
            {NumField('TDS (−)', 'tdsAmount')}
            {NumField('Advance Payment (−)', 'advanceAmount')}
            <Grid item xs={12} sm={4}><TextField fullWidth size="small" label="Other Reason" value={ef.otherReason} onChange={setE('otherReason')} /></Grid>

            <Grid item xs={12} sm={4}><TextField fullWidth size="small" label="Payment Terms" value={ef.paymentTerms} onChange={setE('paymentTerms')} /></Grid>
            <Grid item xs={12} sm={4}>
              <DateInputDDMMYYYY fullWidth size="small" label="Due Date" value={ef.dueDate} onChange={(v) => setEf((f) => ({ ...f, dueDate: v }))} />
            </Grid>
            <Grid item xs={12} sm={4}><TextField fullWidth size="small" label="Prepared By" value={ef.preparedBy} onChange={setE('preparedBy')} /></Grid>

            <Grid item xs={12}>
              <Box sx={{ p: 2, borderRadius: '12px', border: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
                <Amt label="TOTAL AMOUNT PAYABLE" value={expenseTotal} strong />
              </Box>
            </Grid>
            {overPoValue && (
              <Grid item xs={12}>
                <Alert severity="warning" data-testid="expense-over-po" sx={{ borderRadius: '10px' }}>
                  Bill value before TDS / advance ({fmtINR(grossBill)}) is above what is left on PO {linkedDoc.poNumber} ({fmtINR(linkedDoc.remainingAmount)}).
                </Alert>
              </Grid>
            )}
            <Grid item xs={12}><TextField fullWidth size="small" multiline minRows={2} label="Remarks" value={ef.remarks} onChange={setE('remarks')} /></Grid>
          </Grid>
        ) : (
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField select fullWidth size="small" label="Invoice (Payment Pending)" value={pf.invoiceId}
                onChange={(e) => setPf((f) => ({ ...f, invoiceId: e.target.value }))} disabled={Boolean(presetInvoice) || isEdit}>
                {invoiceOptions.length === 0 && <MenuItem value="" disabled>No payment-pending invoices</MenuItem>}
                {invoiceOptions.map((i) => (
                  <MenuItem key={i._id} value={i._id}>{i.invoiceNumber} · {i.vendorName} · {fmtINR(i.netPayableAmount)}</MenuItem>
                ))}
              </TextField>
            </Grid>
            {src && (
              <Grid item xs={12}>
                <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: '#f1f5f9', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
                  <Typography variant="caption" color="text.secondary">Vendor <b>{src.vendorName}</b></Typography>
                  <Typography variant="caption" color="text.secondary">
                    GRN <b>{(src.grnNumbers?.length ? src.grnNumbers : [src.grnNumber].filter(Boolean)).join(', ') || '—'}</b>
                  </Typography>
                  <Typography variant="caption" color="text.secondary">PO <b>{src.poNumber || '—'}</b></Typography>
                </Box>
              </Grid>
            )}
            {src && (
              <Grid item xs={12}>
                <Box sx={{ p: 2, borderRadius: '12px', border: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'flex-end', gap: 3.5, flexWrap: 'wrap' }}>
                  <Amt label="INVOICE" value={num(src.invoiceAmount)} />
                  <Amt label="− ADVANCE" value={num(src.advancePaid)} />
                  <Amt label="− DEBIT NOTE" value={num(src.debitNoteAmount)} />
                  <Amt label="NET PAYABLE" value={num(src.netPayableAmount)} strong />
                </Box>
              </Grid>
            )}
            <Grid item xs={6}>
              <DateInputDDMMYYYY fullWidth size="small" label="Voucher Date" value={pf.voucherDate} onChange={(v) => setPf((f) => ({ ...f, voucherDate: v }))} />
            </Grid>
            <Grid item xs={6} />
            <Grid item xs={12}>
              <TextField fullWidth size="small" multiline minRows={2} label="Remarks" value={pf.remarks} onChange={(e) => setPf((f) => ({ ...f, remarks: e.target.value }))} />
            </Grid>
            <Grid item xs={12}>
              <Alert severity="info" icon={<Info size={18} />} sx={{ borderRadius: '10px', bgcolor: alpha('#1d4ed8', 0.06) }}>
                No payment is recorded here. The actual payment is recorded in <b>Step 1.13 — Final Payment</b>, after the Tally Entry.
              </Alert>
            </Grid>
          </Grid>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={() => onClose?.(false)} disabled={busy}>Cancel</Button>
        {!isEdit && (
          <Button variant="outlined" onClick={() => submit(false)} disabled={busy || uploading}
            startIcon={(creating && !posting) ? <CircularProgress size={16} color="inherit" /> : <Banknote size={16} />}>
            Save as Draft
          </Button>
        )}
        <Button variant="contained" onClick={() => submit(!isEdit)} disabled={busy || uploading}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <Banknote size={16} />}>
          {isEdit ? 'Save' : 'Save Directly'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default VoucherFormDialog;
