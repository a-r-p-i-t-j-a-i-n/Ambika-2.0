import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog, Box, Typography, TextField, Button, IconButton, Divider,
  Grid, Autocomplete, CircularProgress, Paper, Chip, FormControlLabel, Switch,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { X, Save, ReceiptText, Building2, FileText, Upload, ExternalLink, ListChecks, Package } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useGetInvoiceableGrnsQuery,
  useCreateVendorInvoiceMutation,
  useUpdateVendorInvoiceMutation,
  useGetInvoiceAdvancePositionQuery,
} from '../../../store/api/procurementApi';
import { useUploadOrderDocumentMutation } from '../../../store/api/dispatchControlApi';
import { fileHref } from '../indents/indentMeta';
import { fmtINR, fmtDate } from './invoiceMeta';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { PFMS, pfmsCardSx } from '../pfmsTheme';

/**
 * Create / edit a Vendor Invoice (Step 1.10). The user selects GRN No(s) — the
 * system auto-links each GRN's QC behind the scenes (only PASSED/PARTIAL,
 * not-fully-invoiced GRNs are listed). Supports ONE invoice against MULTIPLE GRNs
 * (same vendor + same PO). Selecting GRNs combines their items; Invoice Qty
 * defaults to the pending (uninvoiced) accepted qty. All amounts recomputed
 * server-side. Each option's `_id` is its linked qcId, so the create payload still
 * sends qcIds[] — derived from the selected GRNs.
 */
const todayStr = () => new Date().toISOString().slice(0, 10);
// PASSED → "Passed", PARTIAL → "Partial" for the GRN option label.
const qcStatusLabel = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase() : '—');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => Number(n) || 0;
const ACCEPT = '.pdf,image/*';
const SECTION = { p: 2.5, ...pfmsCardSx };
const EDIT_SX = {
  '& .MuiOutlinedInput-root': { bgcolor: '#fff', borderRadius: '8px' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#bcd0f5' },
};

const calcRow = (it) => {
  const taxable = round2(num(it.invoiceQty) * num(it.rate));
  const gst = round2(taxable * num(it.gstRate) / 100);
  return { taxable, gst, total: round2(taxable + gst) };
};

// Build combined rows from selected QC summaries (default invoiceQty = pending).
// One row per QC line: the same SKU on two lines (batches) or two GRNs stays two
// rows, each tied to its line by qcItemId.
const rowsFromQcs = (qcs = []) => qcs.flatMap((qc) => (qc.items || []).map((it) => ({
  qcId: qc._id, qcNumber: qc.qcNumber, grnId: qc.grnId, grnNumber: qc.grnNumber,
  qcItemId: it.qcItemId || '', grnItemId: it.grnItemId || '', batchNo: it.batchNo || '',
  skuId: it.skuId || '', skuCode: it.skuCode || '', itemName: it.itemName || '', unit: it.unit || 'Pcs',
  orderedQty: round2(it.orderedQty), grnReceivedQty: round2(it.grnReceivedQty ?? it.receivedQty),
  receivedQty: round2(it.receivedQty), acceptedQty: round2(it.acceptedQty), rejectedQty: round2(it.rejectedQty),
  alreadyInvoicedQty: round2(it.alreadyInvoicedQty), pendingInvoiceQty: round2(it.pendingInvoiceQty),
  invoiceQty: round2(it.pendingInvoiceQty), rate: round2(it.rate), gstRate: round2(it.gstRate), remarks: '',
})));

const COLS = '1.7fr 0.55fr 0.7fr 0.7fr 0.75fr 0.8fr 0.8fr 0.85fr 0.8fr 0.6fr 0.85fr 0.85fr 0.9fr 1.1fr';
const HEAD = ['Item / SKU', 'Unit', 'Ordered', 'Recv', 'Accepted', 'Invoiced', 'Pending', 'Inv Qty', 'Rate', 'GST %', 'Taxable', 'GST', 'Total', 'Remarks'];

const VendorInvoiceFormDialog = ({ open, onClose, invoice = null, presetQc = null }) => {
  const { enqueueSnackbar } = useSnackbar();
  const fileRef = useRef(null);
  const dnFileRef = useRef(null);
  const isEdit = Boolean(invoice?._id);

  const [selectedQcs, setSelectedQcs] = useState([]); // selected GRN summaries (create mode); each _id = its linked qcId
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({
    invoiceNumber: '', invoiceDate: todayStr(), invoiceReceivedDate: todayStr(),
    tdsAmount: '', otherCharges: '',
    debitNoteRequired: false, debitNoteNumber: '', debitNoteAmount: '', debitNoteReason: '', remarks: '',
  });
  const [doc, setDoc] = useState(null);
  const [dnDoc, setDnDoc] = useState(null);

  const [createInv, { isLoading: creating }] = useCreateVendorInvoiceMutation();
  const [updateInv, { isLoading: updating }] = useUpdateVendorInvoiceMutation();
  const [uploadDoc, { isLoading: uploading }] = useUploadOrderDocumentMutation();
  const saving = creating || updating;

  const { data: qcRes, isLoading: qcLoading } = useGetInvoiceableGrnsQuery({}, { skip: !open || isEdit });
  const qcOptions = useMemo(() => qcRes?.data || [], [qcRes]); // invoiceable GRNs (each carries its linked QC)
  // A preset (opened from a GRN / QC page) carries only display fields — resolve
  // each pick to its full eligible entry (vendor, PO, items) once the list loads.
  const selectedFull = useMemo(
    () => selectedQcs.map((s) => qcOptions.find((o) => o._id === s._id) || s),
    [selectedQcs, qcOptions],
  );
  const anchor = selectedFull[0] || null; // first pick fixes the vendor + PO

  const piId = anchor?.piId || invoice?.piId;
  // Server-computed PI advance position: what is still unallocated after the
  // PI's other invoices (this invoice's own share excluded when editing).
  const { data: advRes } = useGetInvoiceAdvancePositionQuery(
    { piId, excludeInvoiceId: invoice?._id || undefined },
    { skip: !open || !piId },
  );
  const advancePosition = advRes?.data || null;

  useEffect(() => {
    if (!open) return;
    if (invoice) {
      setForm({
        invoiceNumber: invoice.invoiceNumber || '', invoiceDate: invoice.invoiceDate ? invoice.invoiceDate.slice(0, 10) : todayStr(),
        invoiceReceivedDate: invoice.invoiceReceivedDate ? invoice.invoiceReceivedDate.slice(0, 10) : todayStr(),
        tdsAmount: invoice.tdsAmount ?? '', otherCharges: invoice.otherCharges ?? '',
        debitNoteRequired: !!invoice.debitNoteRequired, debitNoteNumber: invoice.debitNoteNumber || '',
        debitNoteAmount: invoice.debitNoteAmount ?? '', debitNoteReason: invoice.debitNoteReason || '', remarks: invoice.remarks || '',
      });
      setItems((invoice.items || []).map((it) => ({
        qcId: it.qcId || invoice.qcId || '', qcNumber: it.qcNumber || invoice.qcNumber || '',
        grnId: it.grnId || invoice.grnId || '', grnNumber: it.grnNumber || invoice.grnNumber || '',
        qcItemId: it.qcItemId || '', grnItemId: it.grnItemId || '', batchNo: it.batchNo || '',
        skuId: it.skuId || '', skuCode: it.skuCode || '', itemName: it.itemName || '', unit: it.unit || 'Pcs',
        orderedQty: round2(it.orderedQty), grnReceivedQty: round2(it.grnReceivedQty ?? it.receivedQty),
        receivedQty: round2(it.receivedQty), acceptedQty: round2(it.acceptedQty), rejectedQty: round2(it.rejectedQty),
        alreadyInvoicedQty: round2(it.alreadyInvoicedQty), pendingInvoiceQty: round2(it.pendingInvoiceQty || it.acceptedQty),
        invoiceQty: round2(it.invoiceQty), rate: round2(it.rate), gstRate: round2(it.gstRate), remarks: it.remarks || '',
      })));
      setDoc(invoice.invoiceDocument?.fileUrl ? { ...invoice.invoiceDocument } : null);
      setDnDoc(invoice.debitNoteDocument?.fileUrl ? { ...invoice.debitNoteDocument } : null);
    } else {
      setForm({ invoiceNumber: '', invoiceDate: todayStr(), invoiceReceivedDate: todayStr(), tdsAmount: '', otherCharges: '', debitNoteRequired: false, debitNoteNumber: '', debitNoteAmount: '', debitNoteReason: '', remarks: '' });
      setDoc(null); setDnDoc(null);
      setSelectedQcs(presetQc ? [presetQc] : []);
      setItems([]);
    }
  }, [open, invoice, presetQc]);

  // Rebuild combined rows whenever the QC selection changes (create mode). Once
  // the eligible list arrives, resolve any preset to the full (items) entry.
  useEffect(() => {
    if (isEdit || !open) return;
    setItems(rowsFromQcs(selectedFull));
  }, [selectedFull, isEdit, open]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (idx, patch) => setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const itemTotals = useMemo(() => items.reduce((a, it) => {
    const c = calcRow(it);
    return { taxable: round2(a.taxable + c.taxable), gst: round2(a.gst + c.gst), total: round2(a.total + c.total) };
  }, { taxable: 0, gst: 0, total: 0 }), [items]);
  const invoiceAmount = itemTotals.total;
  const debitNote = form.debitNoteRequired ? num(form.debitNoteAmount) : 0;
  // Preview of the server's allocation rule: min(available advance, invoice − debit
  // note). The server recomputes it on save; an invoice that already has a voucher
  // keeps its frozen share.
  const advancePaid = invoice?.voucherId
    ? round2(Math.min(num(invoice.advancePaid), Math.max(0, invoiceAmount - debitNote)))
    : round2(Math.max(0, Math.min(num(advancePosition?.advanceAvailable), invoiceAmount - debitNote)));
  const netPayable = round2(invoiceAmount - debitNote - advancePaid);

  // Group rows by GRN for the table, keeping the flat index for edits.
  const groups = useMemo(() => {
    const map = new Map();
    items.forEach((it, idx) => {
      const key = it.grnNumber || it.grnId || '—';
      if (!map.has(key)) map.set(key, { grnNumber: it.grnNumber || '—', qcNumber: it.qcNumber || '—', rows: [] });
      map.get(key).rows.push({ it, idx });
    });
    return [...map.values()];
  }, [items]);

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
    if (!isEdit && selectedQcs.length === 0) { enqueueSnackbar('Select at least one GRN', { variant: 'warning' }); return; }
    if (!form.invoiceNumber.trim()) { enqueueSnackbar('Enter the vendor invoice number', { variant: 'warning' }); return; }
    if (!items.some((it) => num(it.invoiceQty) > 0)) { enqueueSnackbar('Enter an invoice quantity on at least one item', { variant: 'warning' }); return; }
    const overNoRemark = items.find((it) => round2(it.invoiceQty) > round2(it.pendingInvoiceQty) && !it.remarks?.trim());
    if (overNoRemark) {
      enqueueSnackbar(`"${overNoRemark.itemName}" invoice qty exceeds pending (${overNoRemark.pendingInvoiceQty}). Reduce it or add remarks.`, { variant: 'warning' });
      return;
    }

    const payload = {
      invoiceNumber: form.invoiceNumber.trim(),
      invoiceDate: form.invoiceDate || undefined,
      invoiceReceivedDate: form.invoiceReceivedDate || undefined,
      items: items.map((it) => ({
        qcId: it.qcId || undefined, grnId: it.grnId || undefined,
        qcItemId: it.qcItemId || undefined, grnItemId: it.grnItemId || undefined,
        skuId: it.skuId || undefined, skuCode: it.skuCode, itemName: it.itemName, unit: it.unit,
        invoiceQty: round2(it.invoiceQty), rate: round2(it.rate), gstRate: round2(it.gstRate), remarks: it.remarks?.trim() || '',
      })),
      taxableAmount: itemTotals.taxable, gstAmount: itemTotals.gst, invoiceAmount: round2(invoiceAmount),
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
        const res = await createInv({ ...payload, qcIds: selectedQcs.map((q) => q._id) }).unwrap();
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

  return (
    <Dialog open={open} onClose={() => onClose?.(false)} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: { xs: '100%', md: '92vh' }, display: 'flex', flexDirection: 'column', borderRadius: { xs: 0, md: '8px' }, overflow: 'hidden' } }}>
      <Box sx={{ px: 3, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 55%, #3b82f6 100%)', color: '#fff' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <ReceiptText size={22} />
          <Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: '#fff' }}>{isEdit ? `Edit ${invoice.invoiceNumber}` : 'New Vendor Invoice'}</Typography>
            <Typography sx={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.8)' }}>Step 1.10 · Invoice against one or more GRNs</Typography>
          </Box>
        </Box>
        <IconButton onClick={() => onClose?.(false)} sx={{ color: '#fff' }}><X size={20} /></IconButton>
      </Box>

      <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => upload(setDoc)(e)} />
      <input ref={dnFileRef} type="file" accept={ACCEPT} hidden onChange={(e) => upload(setDnDoc)(e)} />

      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, bgcolor: PFMS.canvas }}>
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, fontWeight: 700, color: 'primary.main' }}><FileText size={18} /> Invoice Header</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={5}>
              {isEdit ? (
                <Box>
                  <Typography variant="caption" color="text.secondary" fontWeight={700}>Source GRNs / QCs</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {(invoice.grnNumbers?.length ? invoice.grnNumbers : [invoice.grnNumber]).filter(Boolean).map((g, i) => <Chip key={i} size="small" label={g} />)}
                  </Box>
                </Box>
              ) : (
                <Autocomplete
                  multiple options={qcOptions} loading={qcLoading} value={selectedQcs}
                  getOptionLabel={(o) => `${o.grnNumber || '—'} — PO ${o.poNumber || '—'} — ${o.vendorName || '—'} — QC ${qcStatusLabel(o.qcStatus)} — Pend ${o.pendingInvoiceQty ?? o.totalPendingInvoiceQty ?? '—'} ${(o.items || []).map((it) => it.skuCode).join(' ')}`}
                  isOptionEqualToValue={(o, v) => o._id === v._id}
                  getOptionDisabled={(o) => !!anchor?.vendorId && (String(o.vendorId) !== String(anchor.vendorId) || String(o.poId) !== String(anchor.poId))}
                  onChange={(_e, v) => setSelectedQcs(v)}
                  renderOption={(props, o) => {
                    const skus = [...new Set((o.items || []).map((it) => it.skuCode || it.itemName).filter(Boolean))];
                    return (
                      <li {...props} key={o._id}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={700}>
                            {o.grnNumber || '—'} <Typography component="span" variant="caption" color="text.secondary">· {fmtDate(o.grnDate)} · PO {o.poNumber || '—'} · QC {o.qcNumber || '—'} ({qcStatusLabel(o.qcStatus)})</Typography>
                          </Typography>
                          <Typography variant="caption" color="text.secondary" component="div" noWrap>
                            {o.vendorName || '—'} · Pending {o.pendingInvoiceQty ?? o.totalPendingInvoiceQty ?? '—'} of {o.totalAccepted ?? '—'} accepted · {skus.slice(0, 4).join(', ')}{skus.length > 4 ? ` +${skus.length - 4}` : ''}
                          </Typography>
                        </Box>
                      </li>
                    );
                  }}
                  renderTags={(value, getTagProps) => value.map((o, i) => (
                    <Chip {...getTagProps({ index: i })} key={o._id} size="small" label={o.grnNumber || o.qcNumber || '—'} sx={{ fontWeight: 700 }} />
                  ))}
                  noOptionsText="No GRN pending invoice"
                  renderInput={(params) => <TextField {...params} label="GRN No *" placeholder="GRN No — PO No — Vendor — QC Status — Pending Qty"
                    helperText={anchor ? `Same vendor (${anchor.vendorName}) & PO (${anchor.poNumber || '—'}) only · QC auto-linked` : 'Pick one or more GRNs of the same vendor & PO — QC is linked automatically'}
                    InputProps={{ ...params.InputProps, endAdornment: (<>{qcLoading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />} />
              )}
            </Grid>
            <Grid item xs={12} sm={4}><TextField label="Vendor Invoice No *" fullWidth value={form.invoiceNumber} onChange={(e) => set('invoiceNumber', e.target.value)} /></Grid>
            <Grid item xs={6} sm={3}><DateInputDDMMYYYY label="Invoice Date" fullWidth value={form.invoiceDate} onChange={(val) => set('invoiceDate', val)} /></Grid>
          </Grid>
          {(anchor || isEdit) && (
            <Box sx={{ mt: 2, p: 1.5, borderRadius: '10px', bgcolor: alpha('#2563eb', 0.04), display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
              <Building2 size={16} color="#1d4ed8" />
              <Typography variant="caption" fontWeight={700}>{anchor?.vendorName || invoice?.vendorName || '—'}</Typography>
              <Chip size="small" variant="outlined" label={`PO ${anchor?.poNumber || invoice?.poNumber || '—'}`} sx={{ fontWeight: 700 }} />
              <Chip size="small" variant="outlined" label={`${isEdit ? (invoice.grnNumbers?.length || 1) : selectedQcs.length} GRN(s)`} sx={{ fontWeight: 700 }} />
              <Chip size="small" color="info" variant="outlined" label={advancePosition ? `PI advance available ${fmtINR(advancePosition.advanceAvailable)} of ${fmtINR(advancePosition.advancePaid)}` : `Advance ${fmtINR(advancePaid)}`} sx={{ fontWeight: 700 }} />
            </Box>
          )}
        </Paper>

        {/* Combined items grouped by GRN */}
        {items.length > 0 && (
          <Paper elevation={0} sx={SECTION}>
            <Typography sx={{ fontWeight: 700, color: 'primary.main', mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
              <ListChecks size={18} /> Invoice Items <Chip size="small" label={items.length} color="primary" sx={{ fontWeight: 800, height: 20 }} />
            </Typography>
            <Box sx={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ minWidth: 1180 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: COLS, gap: 1, px: 1.25, py: 1, background: 'linear-gradient(90deg,#0b2545,#1d4ed8)' }}>
                  {HEAD.map((h, i) => (
                    <Typography key={i} variant="caption" sx={{ fontWeight: 800, color: '#fff', textTransform: 'uppercase', fontSize: '0.55rem', textAlign: i === 0 || i === 13 ? 'left' : 'right' }}>{h}</Typography>
                  ))}
                </Box>
                {groups.map((g, gi) => (
                  <React.Fragment key={gi}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.6, bgcolor: alpha('#0b2545', 0.06), borderTop: '1px solid', borderColor: 'divider' }}>
                      <Package size={13} color="#0b2545" />
                      <Typography variant="caption" sx={{ fontWeight: 800 }}>GRN {g.grnNumber}</Typography>
                      <Typography variant="caption" color="text.secondary">· QC {g.qcNumber}</Typography>
                    </Box>
                    {g.rows.map(({ it, idx }) => {
                      const c = calcRow(it);
                      const over = round2(it.invoiceQty) > round2(it.pendingInvoiceQty);
                      return (
                        <Box key={idx} sx={{ display: 'grid', gridTemplateColumns: COLS, gap: 1, alignItems: 'center', px: 1.25, py: 0.7, borderTop: '1px solid', borderColor: 'divider', '&:hover': { bgcolor: alpha('#2563eb', 0.05) } }}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={600} noWrap>{it.itemName}</Typography>
                            {it.skuCode ? <Typography variant="caption" color="primary.main" fontWeight={700}>{it.skuCode}</Typography> : null}
                            {it.batchNo ? <Typography variant="caption" color="text.secondary"> · Batch {it.batchNo}</Typography> : null}
                          </Box>
                          <Typography variant="body2" sx={{ textAlign: 'right', color: 'text.secondary' }}>{it.unit}</Typography>
                          <Typography variant="body2" sx={{ textAlign: 'right' }}>{it.orderedQty}</Typography>
                          <Typography variant="body2" sx={{ textAlign: 'right', color: 'text.secondary' }}>{it.grnReceivedQty}</Typography>
                          <Typography variant="body2" sx={{ textAlign: 'right', color: '#0f766e', fontWeight: 800 }}>{it.acceptedQty}</Typography>
                          <Typography variant="body2" sx={{ textAlign: 'right', color: 'text.secondary' }}>{it.alreadyInvoicedQty}</Typography>
                          <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700, color: '#1d4ed8' }}>{it.pendingInvoiceQty}</Typography>
                          <TextField size="small" type="number" value={it.invoiceQty} error={over} sx={EDIT_SX}
                            onChange={(e) => setItem(idx, { invoiceQty: e.target.value })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right', padding: '6px 8px' } }} />
                          <TextField size="small" type="number" value={it.rate} sx={EDIT_SX}
                            onChange={(e) => setItem(idx, { rate: e.target.value })} inputProps={{ min: 0, step: 0.01, style: { textAlign: 'right', padding: '6px 8px' } }} />
                          <TextField size="small" type="number" value={it.gstRate} sx={EDIT_SX}
                            onChange={(e) => setItem(idx, { gstRate: e.target.value })} inputProps={{ min: 0, max: 100, step: 0.01, style: { textAlign: 'right', padding: '6px 8px' } }} />
                          <Typography variant="body2" sx={{ textAlign: 'right' }}>{c.taxable.toFixed(2)}</Typography>
                          <Typography variant="body2" sx={{ textAlign: 'right', color: 'text.secondary' }}>{c.gst.toFixed(2)}</Typography>
                          <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 800, color: 'primary.dark' }}>{c.total.toFixed(2)}</Typography>
                          <TextField size="small" placeholder={over ? 'required (excess)' : 'note'} value={it.remarks} sx={EDIT_SX}
                            error={over && !it.remarks?.trim()} onChange={(e) => setItem(idx, { remarks: e.target.value })} inputProps={{ style: { padding: '6px 8px' } }} />
                        </Box>
                      );
                    })}
                  </React.Fragment>
                ))}
              </Box>
            </Box>
            <Box sx={{ mt: 1.5, p: 1.5, borderRadius: '12px', bgcolor: alpha('#1d4ed8', 0.05), display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <Amt label="TAXABLE" value={itemTotals.taxable} />
              <Amt label="GST" value={itemTotals.gst} />
              <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="primary.main" fontWeight={700}>INVOICE AMOUNT</Typography><Typography variant="h6" fontWeight={800} color="primary.dark">{fmtINR(itemTotals.total)}</Typography></Box>
            </Box>
          </Paper>
        )}

        {/* Financials */}
        <Paper elevation={0} sx={SECTION}>
          <Typography sx={{ fontWeight: 700, color: '#0f766e', mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}><ReceiptText size={18} /> Financials</Typography>
          <Grid container spacing={2}>
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
            <Amt label="− ADVANCE ADJUSTED" value={advancePaid} />
            <Box sx={{ textAlign: 'right' }}><Typography variant="caption" color="primary.main" fontWeight={700}>NET PAYABLE</Typography><Typography variant="h6" fontWeight={800} color="primary.dark">{fmtINR(netPayable)}</Typography></Box>
          </Box>
        </Paper>

        <TextField label="Remarks" fullWidth multiline minRows={2} value={form.remarks} onChange={(e) => set('remarks', e.target.value)} placeholder="Add any notes about this invoice…" />
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
