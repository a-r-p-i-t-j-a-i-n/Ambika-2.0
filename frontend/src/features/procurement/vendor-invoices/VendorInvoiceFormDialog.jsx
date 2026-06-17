import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog, Box, Typography, TextField, Button, IconButton, Divider,
  Grid, Autocomplete, CircularProgress, Paper, Chip, FormControlLabel, Switch,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { X, Save, ReceiptText, Building2, FileText, Upload, ExternalLink, ListChecks, Pencil } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetIncomingQcsQuery,
  useCreateVendorInvoiceMutation,
  useUpdateVendorInvoiceMutation,
  useGetProformaInvoiceByIdQuery,
  useGetPurchaseOrderQuery,
  useGetIncomingQcByIdQuery,
} from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { fileHref } from '../indents/indentMeta';
import { fmtINR, varianceOf, VarianceChip, varianceRowBg } from './invoiceMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';

/**
 * Create / edit a Vendor Invoice (Step 1.10). Selecting an Incoming QC auto-loads
 * its received/accepted/rejected items; rate & GST default from the PO. Invoice
 * Qty / Rate / GST% / Remarks are editable (Invoice Qty ≤ Accepted Qty). All
 * amounts are recomputed server-side. Net payable = invoiceAmount − debitNote − advancePaid.
 */
const todayStr = () => new Date().toISOString().slice(0, 10);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ACCEPT = '.pdf,image/*';
const SECTION = { p: 2.5, borderRadius: '16px', border: '1px solid', borderColor: 'divider' };

// Per-row line amounts (display only — backend is authoritative).
const calcRow = (it) => {
  const taxable = round2((Number(it.invoiceQty) || 0) * (Number(it.rate) || 0));
  const gst = round2(taxable * (Number(it.gstRate) || 0) / 100);
  return { taxable, gst, total: round2(taxable + gst) };
};

// Build editable rows from QC items + PO rates (default invoiceQty = acceptedQty).
const buildRows = (qcItems = [], poItems = []) => qcItems.map((qi) => {
  const po = poItems.find((p) =>
    (p.skuCode && qi.skuCode && p.skuCode.toUpperCase() === qi.skuCode.toUpperCase())
    || (p.itemName && qi.itemName && p.itemName === qi.itemName)) || {};
  return {
    skuId: qi.skuId || '', skuCode: qi.skuCode || '', itemName: qi.itemName || '', unit: qi.unit || 'Pcs',
    orderedQty: round2(po.quantity), grnReceivedQty: round2(qi.receivedQty),
    receivedQty: round2(qi.receivedQty), acceptedQty: round2(qi.acceptedQty), rejectedQty: round2(qi.rejectedQty),
    invoiceQty: round2(qi.acceptedQty), rate: round2(po.rate), gstRate: round2(po.gstRate), remarks: '',
  };
});

const CMP_COLS = '1.8fr 1fr 0.5fr 0.8fr 0.85fr 0.85fr 0.85fr 0.85fr 0.85fr 0.95fr';
const CMP_HEAD = ['Item Name', 'SKU', 'Unit', 'PO Ordered', 'GRN Recv', 'QC Accepted', 'QC Rejected', 'Invoice Qty', 'Variance', 'Status'];

const COLS = '1.8fr 0.5fr 0.7fr 0.7fr 0.7fr 0.85fr 0.85fr 0.6fr 0.9fr 0.9fr 0.95fr 1.3fr';
const HEAD = ['Item / SKU', 'Unit', 'Recv', 'Acc', 'Rej', 'Inv Qty', 'Rate', 'GST %', 'Taxable', 'GST', 'Total', 'Remarks'];
const EDITABLE_COLS = new Set([5, 6, 7, 11]); // Inv Qty, Rate, GST %, Remarks
// Editable cells get a white field on an accent outline so they read as inputs.
const EDIT_SX = {
  '& .MuiOutlinedInput-root': { bgcolor: '#fff', borderRadius: '8px' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#bcd0f5' },
};

const VendorInvoiceFormDialog = ({ open, onClose, invoice = null, presetQc = null }) => {
  const { enqueueSnackbar } = useSnackbar();
  const fileRef = useRef(null);
  const dnFileRef = useRef(null);
  const builtForQc = useRef(null);
  const isEdit = Boolean(invoice?._id);

  const [qc, setQc] = useState(null);
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({
    invoiceNumber: '', invoiceDate: todayStr(), invoiceReceivedDate: todayStr(),
    invoiceAmount: '', taxableAmount: '', gstAmount: '', tdsAmount: '', otherCharges: '',
    debitNoteRequired: false, debitNoteNumber: '', debitNoteAmount: '', debitNoteReason: '', remarks: '',
  });
  const [doc, setDoc] = useState(null);
  const [dnDoc, setDnDoc] = useState(null);

  const [createInv, { isLoading: creating }] = useCreateVendorInvoiceMutation();
  const [updateInv, { isLoading: updating }] = useUpdateVendorInvoiceMutation();
  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();
  const saving = creating || updating;

  const { data: qcRes, isLoading: qcLoading } = useGetIncomingQcsQuery(
    { limit: 200, sort: '-createdAt' },
    { skip: !open || isEdit },
  );
  // Only PASSED / PARTIAL QC qualifies.
  const qcOptions = (qcRes?.data || []).filter((q) => ['PASSED', 'PARTIAL'].includes(q.qcStatus));

  // A preset QC (opened via "Create Invoice" elsewhere) may be a partial object
  // without items — fetch the full QC by id so the comparison + rows can load.
  const qcId = qc?._id;
  const { data: fullQcRes } = useGetIncomingQcByIdQuery(qcId, { skip: !qcId || isEdit || !!(qc?.items?.length) });
  const qcItems = qc?.items?.length ? qc.items : (fullQcRes?.data?.items || []);

  // PO rates/GST for the selected QC's PO (defaults for new rows).
  const poId = qc?.poId || fullQcRes?.data?.poId || invoice?.poId;
  const { data: poRes } = useGetPurchaseOrderQuery(poId, { skip: !poId || isEdit });
  const poItems = poRes?.data?.items || [];

  // Advance paid for the selected QC's PI (for net-payable preview).
  const piId = qc?.piId || invoice?.piId;
  const { data: piRes } = useGetProformaInvoiceByIdQuery(piId, { skip: !piId });
  const advancePaid = round2(invoice?.advancePaid ?? piRes?.data?.paidAmount ?? 0);

  useEffect(() => {
    if (!open) return;
    if (invoice) {
      setQc({ _id: invoice.qcId, qcNumber: invoice.qcNumber, vendorName: invoice.vendorName });
      setForm({
        invoiceNumber: invoice.invoiceNumber || '', invoiceDate: invoice.invoiceDate ? invoice.invoiceDate.slice(0, 10) : todayStr(),
        invoiceReceivedDate: invoice.invoiceReceivedDate ? invoice.invoiceReceivedDate.slice(0, 10) : todayStr(),
        invoiceAmount: invoice.invoiceAmount ?? '', taxableAmount: invoice.taxableAmount ?? '', gstAmount: invoice.gstAmount ?? '',
        tdsAmount: invoice.tdsAmount ?? '', otherCharges: invoice.otherCharges ?? '',
        debitNoteRequired: !!invoice.debitNoteRequired, debitNoteNumber: invoice.debitNoteNumber || '',
        debitNoteAmount: invoice.debitNoteAmount ?? '', debitNoteReason: invoice.debitNoteReason || '', remarks: invoice.remarks || '',
      });
      setItems((invoice.items || []).map((it) => ({
        skuId: it.skuId || '', skuCode: it.skuCode || '', itemName: it.itemName || '', unit: it.unit || 'Pcs',
        orderedQty: round2(it.orderedQty), grnReceivedQty: round2(it.grnReceivedQty ?? it.receivedQty),
        receivedQty: round2(it.receivedQty), acceptedQty: round2(it.acceptedQty), rejectedQty: round2(it.rejectedQty),
        invoiceQty: round2(it.invoiceQty), rate: round2(it.rate), gstRate: round2(it.gstRate), remarks: it.remarks || '',
      })));
      setDoc(invoice.invoiceDocument?.fileUrl ? { ...invoice.invoiceDocument } : null);
      setDnDoc(invoice.debitNoteDocument?.fileUrl ? { ...invoice.debitNoteDocument } : null);
    } else {
      setForm({ invoiceNumber: '', invoiceDate: todayStr(), invoiceReceivedDate: todayStr(), invoiceAmount: '', taxableAmount: '', gstAmount: '', tdsAmount: '', otherCharges: '', debitNoteRequired: false, debitNoteNumber: '', debitNoteAmount: '', debitNoteReason: '', remarks: '' });
      setDoc(null); setDnDoc(null);
      setItems([]); builtForQc.current = null;
      setQc(presetQc || null);
    }
  }, [open, invoice, presetQc]);

  // Auto-load item rows from the selected QC (re-runs once the full QC / PO rates arrive).
  useEffect(() => {
    if (isEdit || !open) return;
    if (!qc?._id || !qcItems.length) { setItems([]); builtForQc.current = null; return; }
    const key = `${qc._id}:${qcItems.length}:${poItems.length}`;
    if (builtForQc.current === key) return;
    setItems(buildRows(qcItems, poItems));
    builtForQc.current = key;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc?._id, qcItems.length, poItems.length, isEdit, open]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (idx, patch) => setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const itemsMode = items.length > 0;
  const itemTotals = useMemo(() => items.reduce((a, it) => {
    const c = calcRow(it);
    return { taxable: round2(a.taxable + c.taxable), gst: round2(a.gst + c.gst), total: round2(a.total + c.total) };
  }, { taxable: 0, gst: 0, total: 0 }), [items]);

  // Order-vs-received comparison summary.
  const cmpTotals = useMemo(() => items.reduce((a, it) => ({
    ordered:  round2(a.ordered + (Number(it.orderedQty) || 0)),
    received: round2(a.received + (Number(it.grnReceivedQty ?? it.receivedQty) || 0)),
    accepted: round2(a.accepted + (Number(it.acceptedQty) || 0)),
    invoice:  round2(a.invoice + (Number(it.invoiceQty) || 0)),
  }), { ordered: 0, received: 0, accepted: 0, invoice: 0 }), [items]);
  const totalVariance = round2(cmpTotals.invoice - cmpTotals.accepted);

  const invoiceAmount = itemsMode ? itemTotals.total : (Number(form.invoiceAmount) || 0);
  const netPayable = useMemo(() => round2(
    invoiceAmount - (form.debitNoteRequired ? (Number(form.debitNoteAmount) || 0) : 0) - advancePaid,
  ), [invoiceAmount, form.debitNoteRequired, form.debitNoteAmount, advancePaid]);

  const upload = (setter) => async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try {
      const res = await uploadDoc(f).unwrap();
      const d = res?.data || {};
      setter({ fileName: d.fileName || f.name, fileUrl: d.url, fileType: d.mimeType || f.type });
      enqueueSnackbar('Document uploaded', { variant: 'success' });
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Upload failed', { variant: 'error' }); }
  };

  const handleSubmit = async () => {
    if (!isEdit && !qc?._id) { enqueueSnackbar('Select a QC (PASSED/PARTIAL) first', { variant: 'warning' }); return; }
    if (!form.invoiceNumber.trim()) { enqueueSnackbar('Enter the vendor invoice number', { variant: 'warning' }); return; }

    if (itemsMode) {
      if (!items.some((it) => Number(it.invoiceQty) > 0)) { enqueueSnackbar('Enter an invoice quantity on at least one item', { variant: 'warning' }); return; }
      // EXCESS (invoiceQty > accepted) is allowed only with remarks (or override permission, enforced server-side).
      const excessNoRemark = items.find((it) => round2(it.invoiceQty) > round2(it.acceptedQty) && !it.remarks?.trim());
      if (excessNoRemark) {
        enqueueSnackbar(`"${excessNoRemark.itemName}" invoice qty exceeds accepted (${excessNoRemark.acceptedQty}). Add remarks to invoice the excess.`, { variant: 'warning' });
        return;
      }
    } else if (!(invoiceAmount > 0)) {
      enqueueSnackbar('Enter the invoice amount', { variant: 'warning' }); return;
    }

    const payload = {
      invoiceNumber: form.invoiceNumber.trim(),
      invoiceDate: form.invoiceDate || undefined,
      invoiceReceivedDate: form.invoiceReceivedDate || undefined,
      ...(itemsMode ? {
        items: items.map((it) => ({
          skuId: it.skuId || undefined, skuCode: it.skuCode, itemName: it.itemName, unit: it.unit,
          orderedQty: round2(it.orderedQty), grnReceivedQty: round2(it.grnReceivedQty ?? it.receivedQty),
          receivedQty: round2(it.receivedQty), acceptedQty: round2(it.acceptedQty), rejectedQty: round2(it.rejectedQty),
          invoiceQty: round2(it.invoiceQty), rate: round2(it.rate), gstRate: round2(it.gstRate), remarks: it.remarks?.trim() || '',
        })),
      } : {}),
      invoiceAmount: round2(invoiceAmount),
      taxableAmount: itemsMode ? itemTotals.taxable : round2(form.taxableAmount),
      gstAmount: itemsMode ? itemTotals.gst : round2(form.gstAmount),
      tdsAmount: round2(form.tdsAmount), otherCharges: round2(form.otherCharges),
      debitNoteRequired: form.debitNoteRequired,
      debitNoteNumber: form.debitNoteNumber.trim(),
      debitNoteAmount: form.debitNoteRequired ? round2(form.debitNoteAmount) : 0,
      debitNoteReason: form.debitNoteReason.trim(),
      invoiceDocument: doc ? { fileName: doc.fileName, fileUrl: doc.fileUrl, fileType: doc.fileType } : undefined,
      debitNoteDocument: dnDoc ? { fileName: dnDoc.fileName, fileUrl: dnDoc.fileUrl, fileType: dnDoc.fileType } : undefined,
      remarks: form.remarks.trim(),
    };
    try {
      if (isEdit) {
        await updateInv({ id: invoice._id, ...payload }).unwrap();
        enqueueSnackbar('Invoice updated', { variant: 'success' });
      } else {
        const res = await createInv({ ...payload, qcId: qc._id }).unwrap();
        enqueueSnackbar(`Invoice ${res?.data?.invoiceNumber || ''} saved`, { variant: 'success' });
      }
      onClose?.(true);
    } catch (err) { enqueueSnackbar(err?.data?.message || 'Failed to save invoice', { variant: 'error' }); }
  };

  const DocBox = ({ value, onPick, onClear, label }) => (
    <Box>
      <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 0.75 }}>{label}</Typography>
      {value?.fileUrl ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: '10px', bgcolor: '#fff' }}>
          <FileText size={16} />
          <Typography variant="body2" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>{value.fileName}</Typography>
          <Button size="small" startIcon={<ExternalLink size={13} />} href={fileHref(value.fileUrl)} target="_blank" rel="noopener">View</Button>
          <Chip size="small" label="Remove" onDelete={onClear} deleteIcon={<X size={13} />} onClick={onClear} />
        </Box>
      ) : (
        <Button variant="outlined" size="small" startIcon={uploading ? <CircularProgress size={14} /> : <Upload size={14} />} onClick={onPick} disabled={uploading}>Upload PDF / Image</Button>
      )}
    </Box>
  );

  const Amt = ({ label, value }) => (
    <Box sx={{ textAlign: 'right' }}>
      <Typography variant="caption" color="text.secondary" fontWeight={700}>{label}</Typography>
      <Typography fontWeight={700}>{fmtINR(value)}</Typography>
    </Box>
  );

  const CmpAmt = ({ label, value, color }) => (
    <Box sx={{ textAlign: 'right' }}>
      <Typography variant="caption" color="text.secondary" fontWeight={700}>{label}</Typography>
      <Typography fontWeight={800} sx={{ color: color || 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
    </Box>
  );

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: { xs: '100%', md: '92vh' }, display: 'flex', flexDirection: 'column', borderRadius: { xs: 0, md: '18px' }, overflow: 'hidden' } }}>
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)', color: '#fff' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <ReceiptText size={22} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: '#fff' }}>{isEdit ? `Edit ${invoice.invoiceNumber}` : 'New Vendor Invoice'}</Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)' }}>Step 1.10 · Invoice / Debit Note received</Typography>
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(false)} sx={{ color: '#fff' }}><X size={20} /></IconButton>
      </Box>

      <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => upload(setDoc)(e)} />
      <input ref={dnFileRef} type="file" accept={ACCEPT} hidden onChange={(e) => upload(setDnDoc)(e)} />

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, bgcolor: '#f8fafc' }}>
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: 'primary.main' }}><FileText size={18} /> Invoice Header</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={5}>
              {isEdit || presetQc ? (
                <TextField label="QC Number" fullWidth value={qc?.qcNumber || ''} disabled />
              ) : (
                <Autocomplete options={qcOptions} loading={qcLoading} value={qc}
                  getOptionLabel={(o) => (o ? `${o.qcNumber} — ${o.vendorName}` : '')}
                  isOptionEqualToValue={(o, v) => o._id === v._id} onChange={(_e, v) => setQc(v)}
                  noOptionsText="No QC is passed/partial yet"
                  renderInput={(params) => <TextField {...params} label="Incoming QC *" placeholder="QC PASSED / PARTIAL"
                    InputProps={{ ...params.InputProps, endAdornment: (<>{qcLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />} />
              )}
            </Grid>
            <Grid item xs={12} sm={4}><TextField label="Vendor Invoice No *" fullWidth value={form.invoiceNumber} onChange={(e) => set('invoiceNumber', e.target.value)} /></Grid>
            <Grid item xs={6} sm={3}><DateInputDDMMYYYY label="Invoice Date" fullWidth value={form.invoiceDate} onChange={(val) => set('invoiceDate', val)} /></Grid>
          </Grid>
          {qc ? (
            <Box sx={{ mt: 2, p: 1.5, borderRadius: '10px', bgcolor: alpha('#2563eb', 0.04), display: 'flex', flexWrap: 'wrap', gap: 2.5, alignItems: 'center' }}>
              <Building2 size={16} color="#1d4ed8" />
              <Typography variant="caption" fontWeight={700}>{qc.vendorName || invoice?.vendorName || '—'}</Typography>
              {(qc.grnNumber || invoice?.grnNumber) && <Chip size="small" variant="outlined" label={`GRN ${qc.grnNumber || invoice?.grnNumber}`} sx={{ fontWeight: 700 }} />}
              {(qc.poNumber || invoice?.poNumber) && <Chip size="small" variant="outlined" label={`PO ${qc.poNumber || invoice?.poNumber}`} sx={{ fontWeight: 700 }} />}
              <Chip size="small" color="info" variant="outlined" label={`Advance paid ${fmtINR(advancePaid)}`} sx={{ fontWeight: 700 }} />
            </Box>
          ) : null}
        </Paper>

        {/* Order vs Received comparison */}
        {itemsMode && (
          <Paper elevation={0} sx={SECTION}>
            <Typography sx={{ fontWeight: 700, color: 'primary.main', mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
              <ListChecks size={18} /> Order vs Received Comparison
            </Typography>
            <Box sx={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ minWidth: 980 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: CMP_COLS, gap: 1, px: 1.25, py: 1, background: 'linear-gradient(90deg,#0b2545,#1d4ed8)' }}>
                  {CMP_HEAD.map((h, i) => (
                    <Typography key={i} variant="caption" sx={{ fontWeight: 800, color: '#fff', textTransform: 'uppercase', fontSize: '0.55rem', letterSpacing: '0.03em', textAlign: i <= 1 ? 'left' : (i === 9 ? 'center' : 'right') }}>{h}</Typography>
                  ))}
                </Box>
                {items.map((it, idx) => {
                  const { variance, status } = varianceOf(it.invoiceQty, it.acceptedQty);
                  return (
                    <Box key={idx} sx={{ display: 'grid', gridTemplateColumns: CMP_COLS, gap: 1, alignItems: 'center', px: 1.25, py: 0.85, borderTop: '1px solid', borderColor: 'divider', bgcolor: varianceRowBg(status) }}>
                      <Typography variant="body2" fontWeight={600} noWrap>{it.itemName}</Typography>
                      <Typography variant="body2" color="primary.main" fontWeight={700} noWrap>{it.skuCode || '—'}</Typography>
                      <Typography variant="body2" color="text.secondary">{it.unit}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{it.orderedQty}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{it.grnReceivedQty ?? it.receivedQty}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', color: '#0f766e', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{it.acceptedQty}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', color: it.rejectedQty > 0 ? '#b45309' : 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>{it.rejectedQty}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{round2(it.invoiceQty)}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700, color: variance === 0 ? 'text.secondary' : (variance < 0 ? '#b45309' : '#be123c'), fontVariantNumeric: 'tabular-nums' }}>{variance > 0 ? `+${variance}` : variance}</Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'center' }}><VarianceChip status={status} /></Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
            <Box sx={{ mt: 1.5, p: 1.5, borderRadius: '12px', bgcolor: alpha('#1d4ed8', 0.05), display: 'flex', justifyContent: 'flex-end', gap: 3.5, flexWrap: 'wrap' }}>
              <CmpAmt label="ORDERED" value={cmpTotals.ordered} />
              <CmpAmt label="RECEIVED" value={cmpTotals.received} />
              <CmpAmt label="ACCEPTED" value={cmpTotals.accepted} color="#0f766e" />
              <CmpAmt label="INVOICE" value={cmpTotals.invoice} />
              <CmpAmt label="VARIANCE" value={totalVariance > 0 ? `+${totalVariance}` : totalVariance}
                color={totalVariance === 0 ? '#0f766e' : (totalVariance < 0 ? '#b45309' : '#be123c')} />
            </Box>
          </Paper>
        )}

        {/* Items (auto-loaded from the QC) */}
        {itemsMode && (
          <Paper elevation={0} sx={SECTION}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
              <Typography sx={{ fontWeight: 700, color: 'primary.main', display: 'flex', alignItems: 'center', gap: 1 }}>
                <ListChecks size={18} /> Invoice Items
                <Chip size="small" label={items.length} color="primary" sx={{ fontWeight: 800, height: 20 }} />
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Pencil size={11} /> Invoice Qty · Rate · GST % · Remarks are editable · Invoice Qty ≤ Accepted
              </Typography>
            </Box>

            <Box sx={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ minWidth: 1060 }}>
                {/* Header band */}
                <Box sx={{ display: 'grid', gridTemplateColumns: COLS, gap: 1, px: 1.25, py: 1, background: 'linear-gradient(90deg,#0b2545,#1d4ed8)' }}>
                  {HEAD.map((h, i) => (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.4, justifyContent: i === 0 || i === 11 ? 'flex-start' : 'flex-end' }}>
                      {EDITABLE_COLS.has(i) && <Pencil size={9} color="#cdd9f0" />}
                      <Typography variant="caption" sx={{ fontWeight: 800, color: '#fff', textTransform: 'uppercase', fontSize: '0.56rem', letterSpacing: '0.04em' }}>{h}</Typography>
                    </Box>
                  ))}
                </Box>
                {/* Rows */}
                {items.map((it, idx) => {
                  const c = calcRow(it);
                  const over = round2(it.invoiceQty) > round2(it.acceptedQty);
                  return (
                    <Box key={idx} sx={{
                      display: 'grid', gridTemplateColumns: COLS, gap: 1, alignItems: 'center', px: 1.25, py: 0.85,
                      bgcolor: idx % 2 ? alpha('#2563eb', 0.025) : '#fff',
                      borderTop: '1px solid', borderColor: 'divider',
                      '&:hover': { bgcolor: alpha('#2563eb', 0.06) },
                    }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={600} noWrap>{it.itemName}</Typography>
                        {it.skuCode ? <Typography variant="caption" color="primary.main" fontWeight={700}>{it.skuCode}</Typography> : null}
                      </Box>
                      <Typography variant="body2" sx={{ textAlign: 'right', color: 'text.secondary' }}>{it.unit}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{it.receivedQty}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', color: '#0f766e', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{it.acceptedQty}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', color: it.rejectedQty > 0 ? '#b45309' : 'text.disabled', fontWeight: it.rejectedQty > 0 ? 700 : 400, fontVariantNumeric: 'tabular-nums' }}>{it.rejectedQty}</Typography>
                      <TextField size="small" type="number" value={it.invoiceQty} error={over} sx={EDIT_SX}
                        onChange={(e) => setItem(idx, { invoiceQty: e.target.value })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right', padding: '6px 8px' } }} />
                      <TextField size="small" type="number" value={it.rate} sx={EDIT_SX}
                        onChange={(e) => setItem(idx, { rate: e.target.value })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right', padding: '6px 8px' } }} />
                      <TextField size="small" type="number" value={it.gstRate} sx={EDIT_SX}
                        onChange={(e) => setItem(idx, { gstRate: e.target.value })} inputProps={{ min: 0, max: 100, step: 0.01, style: { textAlign: 'right', padding: '6px 8px' } }} />
                      <Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.taxable.toFixed(2)}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{c.gst.toFixed(2)}</Typography>
                      <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 800, color: 'primary.dark', fontVariantNumeric: 'tabular-nums' }}>{c.total.toFixed(2)}</Typography>
                      <TextField size="small" placeholder={over ? 'required (excess)' : 'add note'} value={it.remarks} sx={EDIT_SX}
                        error={over && !it.remarks?.trim()}
                        onChange={(e) => setItem(idx, { remarks: e.target.value })} inputProps={{ style: { padding: '6px 8px' } }} />
                    </Box>
                  );
                })}
              </Box>
            </Box>

            {/* Totals bar */}
            <Box sx={{ mt: 1.5, p: 1.5, borderRadius: '12px', bgcolor: alpha('#1d4ed8', 0.05),
              display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <Amt label="TAXABLE" value={itemTotals.taxable} />
              <Amt label="GST" value={itemTotals.gst} />
              <Box sx={{ width: '1px', height: 34, bgcolor: 'divider', display: { xs: 'none', sm: 'block' } }} />
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="primary.main" fontWeight={700}>INVOICE AMOUNT</Typography>
                <Typography variant="h6" fontWeight={800} color="primary.dark">{fmtINR(itemTotals.total)}</Typography>
              </Box>
            </Box>
          </Paper>
        )}

        {/* Financials */}
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ fontWeight: 700, color: '#0f766e', mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}><ReceiptText size={18} /> Financials</Typography>
          <Grid container spacing={2}>
            {!itemsMode && (
              <>
                <Grid item xs={6} sm={3}><TextField label="Invoice Amount *" type="number" fullWidth value={form.invoiceAmount} onChange={(e) => set('invoiceAmount', e.target.value)} inputProps={{ min: 0, step: 0.01 }} /></Grid>
                <Grid item xs={6} sm={3}><TextField label="Taxable Amount" type="number" fullWidth value={form.taxableAmount} onChange={(e) => set('taxableAmount', e.target.value)} inputProps={{ min: 0, step: 0.01 }} /></Grid>
                <Grid item xs={6} sm={3}><TextField label="GST Amount" type="number" fullWidth value={form.gstAmount} onChange={(e) => set('gstAmount', e.target.value)} inputProps={{ min: 0, step: 0.01 }} /></Grid>
              </>
            )}
            {itemsMode && (
              <Grid item xs={12} sm={6}>
                <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: alpha('#0f766e', 0.05), display: 'flex', gap: 3 }}>
                  <Amt label="INVOICE" value={invoiceAmount} />
                  <Amt label="TAXABLE" value={itemTotals.taxable} />
                  <Amt label="GST" value={itemTotals.gst} />
                  <Typography variant="caption" color="text.disabled" sx={{ alignSelf: 'center' }}>auto from items</Typography>
                </Box>
              </Grid>
            )}
            <Grid item xs={6} sm={3}><TextField label="TDS Amount" type="number" fullWidth value={form.tdsAmount} onChange={(e) => set('tdsAmount', e.target.value)} inputProps={{ min: 0, step: 0.01 }} /></Grid>
            <Grid item xs={6} sm={3}><TextField label="Other Charges" type="number" fullWidth value={form.otherCharges} onChange={(e) => set('otherCharges', e.target.value)} inputProps={{ step: 0.01 }} /></Grid>
            <Grid item xs={12}><DocBox value={doc} onPick={() => fileRef.current?.click()} onClear={() => setDoc(null)} label="INVOICE DOCUMENT (required to approve)" /></Grid>
          </Grid>
        </Paper>

        {/* Debit note */}
        <Paper elevation={0} sx={SECTION}>
          <FormControlLabel control={<Switch checked={form.debitNoteRequired} onChange={(e) => set('debitNoteRequired', e.target.checked)} />} label={<Typography fontWeight={700} color="#b45309">Debit Note Required</Typography>} />
          {form.debitNoteRequired && (
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid item xs={6} sm={3}><TextField label="Debit Note No" fullWidth value={form.debitNoteNumber} onChange={(e) => set('debitNoteNumber', e.target.value)} /></Grid>
              <Grid item xs={6} sm={3}><TextField label="Debit Note Amount" type="number" fullWidth value={form.debitNoteAmount} onChange={(e) => set('debitNoteAmount', e.target.value)} inputProps={{ min: 0, step: 0.01 }} /></Grid>
              <Grid item xs={12} sm={6}><TextField label="Reason" fullWidth value={form.debitNoteReason} onChange={(e) => set('debitNoteReason', e.target.value)} /></Grid>
              <Grid item xs={12}><DocBox value={dnDoc} onPick={() => dnFileRef.current?.click()} onClear={() => setDnDoc(null)} label="DEBIT NOTE DOCUMENT" /></Grid>
            </Grid>
          )}
        </Paper>

        {/* Net payable */}
        <Paper elevation={0} sx={{ ...SECTION, bgcolor: alpha('#1d4ed8', 0.03) }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Amt label="INVOICE" value={invoiceAmount} />
            <Amt label="− DEBIT NOTE" value={form.debitNoteRequired ? form.debitNoteAmount : 0} />
            <Amt label="− ADVANCE PAID" value={advancePaid} />
            <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="primary.main" fontWeight={700}>NET PAYABLE</Typography><Typography variant="h6" fontWeight={800} color="primary.dark">{fmtINR(netPayable)}</Typography></Box>
          </Box>
        </Paper>

        <TextField
          label="Remarks"
          fullWidth
          multiline
          minRows={2}
          value={form.remarks}
          onChange={(e) => set('remarks', e.target.value)}
          placeholder="Add any notes about this invoice…"
          helperText="Invoice remarks"
          sx={{
            bgcolor: alpha('#2563eb', 0.05),
            borderRadius: '12px',
            '& .MuiOutlinedInput-root fieldset': { borderColor: '#2563eb', borderWidth: 2 },
            '& .MuiInputLabel-root': { fontWeight: 700, color: 'primary.main' },
          }} />
      </Box>

      <Divider />
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end', gap: 1.5, bgcolor: '#fff' }}>
        <Button variant="outlined" onClick={() => onClose?.(false)} disabled={saving || uploading}>Cancel</Button>
        <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} onClick={handleSubmit} disabled={saving || uploading}>
          {isEdit ? 'Save Changes' : 'Create Invoice'}
        </Button>
      </Box>
    </Dialog>
  );
};

export default VendorInvoiceFormDialog;
