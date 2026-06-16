import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Autocomplete, TextField, Button, Chip, MenuItem,
  alpha, useTheme, CircularProgress, IconButton, Divider, Link, Tooltip,
} from '@mui/material';
import { ReceiptText, Upload, X, Save, Paperclip, FileCheck2, Eye } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { useGetChallansQuery } from '../../store/api/dispatchControlApi';
import { useCreateSalesInvoiceMutation } from '../../store/api/salesInvoiceApi';
import { useUploadFileMutation } from '../../store/api/o2dFmsApi';
import { useReturnToTask } from './useReturnToTask';

const TRANSPORT_TYPES = ['Freight Paid', 'To Pay', 'Party Vehicle'];
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx';

// A reusable multi-file upload field → returns [{ fileName, url }] via onChange.
const UploadField = ({ label, max, files, onChange, folder = 'invoices' }) => {
  const theme = useTheme();
  const [upload, { isLoading }] = useUploadFileMutation();

  const handleFiles = async (list) => {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    if (files.length + incoming.length > max) {
      enqueueSnackbar(`${label}: up to ${max} files allowed.`, { variant: 'warning' });
      return;
    }
    let acc = [...files];
    for (const file of incoming) {
      try {
        const res = await upload({ file, folder }).unwrap();
        acc = [...acc, { fileName: res.data.fileName || file.name, url: res.data.url }];
      } catch (e) {
        enqueueSnackbar(`Upload failed: ${file.name}`, { variant: 'error' });
      }
    }
    onChange(acc);
  };

  return (
    <Box sx={{ p: 1.5, borderRadius: 2, border: `1px dashed ${theme.palette.divider}`, bgcolor: alpha(theme.palette.primary.main, 0.02) }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label} <span style={{ fontWeight: 500 }}>· up to {max}</span>
        </Typography>
        <Button component="label" size="small" startIcon={isLoading ? <CircularProgress size={13} /> : <Upload size={13} />} disabled={isLoading || files.length >= max}>
          Add
          <input type="file" hidden multiple accept={ACCEPT} onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
        </Button>
      </Stack>
      {files.length === 0 ? (
        <Typography variant="caption" color="text.disabled">No files yet</Typography>
      ) : (
        <Stack spacing={0.5}>
          {files.map((f, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ p: 0.5, borderRadius: 1, bgcolor: alpha(theme.palette.success.main, 0.08) }}>
              <Paperclip size={13} color={theme.palette.success.dark} />
              <Link href={f.url} target="_blank" rel="noopener" underline="hover"
                sx={{ flex: 1, fontSize: '0.78rem', color: 'text.primary', cursor: 'pointer' }} noWrap>{f.fileName}</Link>
              <Tooltip title="Preview"><IconButton size="small" onClick={() => window.open(f.url, '_blank', 'noopener')}><Eye size={13} /></IconButton></Tooltip>
              <Tooltip title="Remove"><IconButton size="small" onClick={() => onChange(files.filter((_, j) => j !== i))}><X size={13} /></IconButton></Tooltip>
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
};

/**
 * Invoice & Eway Bill entry (O2D Step 2.7)
 * ----------------------------------------
 * Pick a delivery challan → party/SO/PO/transporter auto-fill → capture invoice
 * details + upload Invoice / E-way / PDIR files → save. Feeds the 2.8 email step.
 * Route: /o2d/invoice-entry
 */
const InvoiceEntryForm = () => {
  const theme = useTheme();
  const { data: challansRes } = useGetChallansQuery({ limit: 300, sort: '-dcDate' });
  const challans = useMemo(() => challansRes?.data || [], [challansRes]);
  const [createInvoice, { isLoading: saving }] = useCreateSalesInvoiceMutation();
  const { active: fromTask, returnToTask } = useReturnToTask();

  const [dc, setDc] = useState(null);
  const [form, setForm] = useState({
    status: 'Done', invoiceNo: '', invoiceDate: dayjs().format('YYYY-MM-DD'),
    invoiceAmount: '', transportType: 'Freight Paid', transporterName: '', lrNo: '', remarks: '',
  });
  const [invoiceFiles, setInvoiceFiles] = useState([]);
  const [ewayFiles, setEwayFiles] = useState([]);
  const [pdirFiles, setPdirFiles] = useState([]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Invoice numbers captured in Actual Dispatch (the challan) → the dropdown.
  const invoiceNoOptions = useMemo(
    () => [...new Set(challans.map((c) => c.invoiceNo).filter(Boolean))],
    [challans],
  );
  const challanByInvoiceNo = useMemo(() => {
    const m = new Map();
    challans.forEach((c) => { if (c.invoiceNo) m.set(c.invoiceNo, c); });
    return m;
  }, [challans]);

  // Pull dispatch details captured in Actual Dispatch onto the invoice form.
  const onPickDc = (v) => {
    setDc(v);
    if (v) setForm((f) => ({
      ...f,
      invoiceNo: v.invoiceNo || f.invoiceNo,
      transporterName: v.transporterName || f.transporterName || '',
      transportType: v.dispatchedThrough || f.transportType,
      lrNo: f.lrNo || v.lrNo || '',
    }));
  };

  // Choosing an invoice number auto-selects its challan and fetches its details.
  const onPickInvoiceNo = (val) => {
    const inv = (val || '').trim();
    const c = challanByInvoiceNo.get(inv);
    if (c) onPickDc(c);
    else setForm((f) => ({ ...f, invoiceNo: inv }));
  };

  const reset = () => {
    setDc(null);
    setForm({ status: 'Done', invoiceNo: '', invoiceDate: dayjs().format('YYYY-MM-DD'), invoiceAmount: '', transportType: 'Freight Paid', transporterName: '', lrNo: '', remarks: '' });
    setInvoiceFiles([]); setEwayFiles([]); setPdirFiles([]);
  };

  const save = async () => {
    if (!dc) return enqueueSnackbar('Select a delivery challan first.', { variant: 'warning' });
    if (!form.invoiceNo.trim()) return enqueueSnackbar('Invoice No is required.', { variant: 'warning' });
    try {
      const res = await createInvoice({
        dcId: dc._id,
        invoiceNo: form.invoiceNo.trim(),
        invoiceDate: form.invoiceDate,
        invoiceAmount: Number(form.invoiceAmount) || 0,
        status: form.status === 'Cancelled' ? 'CANCELLED' : 'DONE',
        transportType: form.transportType,
        transporterName: form.transporterName,
        lrNo: form.lrNo,
        remarks: form.remarks,
        invoiceUrls: invoiceFiles.map((f) => f.url),
        ewayBillUrls: ewayFiles.map((f) => f.url),
        pdirUrls: pdirFiles.map((f) => f.url),
      }).unwrap();
      enqueueSnackbar(`Invoice ${res.data.invoiceNo} saved.`, { variant: 'success' });
      if (fromTask) setTimeout(returnToTask, 600); else reset();
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not save the invoice.', { variant: 'error' });
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box sx={{ color: '#fff', px: { xs: 3, md: 5 }, pt: { xs: 4, md: 5 }, pb: { xs: 5, md: 7 },
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)' }}>
        <Stack direction="row" spacing={2.5} alignItems="center">
          <Box sx={{ width: 52, height: 52, borderRadius: 2.5, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}>
            <ReceiptText size={26} color="#fff" />
          </Box>
          <Box>
            <Typography sx={{ color: '#fff', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 800 }}>Create Invoice & Eway Bill</Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.95rem', mt: 0.5 }}>Step 2.7 — record the tax invoice & e-way bill for a dispatch.</Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6, maxWidth: 980, mx: 'auto' }}>
        {/* Challan picker + auto-filled context */}
        <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
          <Autocomplete
            options={challans}
            value={dc}
            onChange={(_, v) => onPickDc(v)}
            getOptionLabel={(o) => (o ? `${o.dcNumber} — ${o.partyName} (SO ${o.soNumber || '—'})` : '')}
            isOptionEqualToValue={(a, b) => a._id === b._id}
            renderInput={(p) => <TextField {...p} label="Delivery Challan" placeholder="Search DC / SO / party…" size="small" />}
          />
          {dc && (
            <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap' }} useFlexGap>
              <Chip size="small" label={`Party: ${dc.partyName || '—'}`} />
              <Chip size="small" label={`SO: ${dc.soNumber || '—'}`} />
              <Chip size="small" label={`PO: ${dc.poNumber || '—'}`} />
              <Chip size="small" label={`Qty: ${dc.totalQuantityPcs ?? '—'} pcs`} />
            </Stack>
          )}
        </Paper>

        {/* Form fields */}
        <Paper sx={{ p: 2.5, borderRadius: 3, mb: 2 }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select label="Status" value={form.status} onChange={set('status')} size="small" sx={{ minWidth: 160 }}>
                <MenuItem value="Done">Done</MenuItem>
                <MenuItem value="Cancelled">Cancelled</MenuItem>
              </TextField>
              <Autocomplete
                freeSolo
                fullWidth
                options={invoiceNoOptions}
                value={form.invoiceNo}
                onChange={(_, val) => onPickInvoiceNo(val || '')}
                onInputChange={(_, val, reason) => { if (reason === 'input') setForm((f) => ({ ...f, invoiceNo: val })); }}
                renderInput={(p) => (
                  <TextField {...p} label="Invoice No" size="small" required
                    placeholder="Select from actual dispatch / type" />
                )}
              />
              <TextField label="Invoice Date" type="date" value={form.invoiceDate} onChange={set('invoiceDate')} size="small" InputLabelProps={{ shrink: true }} sx={{ minWidth: 170 }} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Invoice Amount (₹)" type="number" value={form.invoiceAmount} onChange={set('invoiceAmount')} size="small" fullWidth />
              <TextField select label="Type of Transportation" value={form.transportType} onChange={set('transportType')} size="small" fullWidth>
                {TRANSPORT_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Transporter Name" value={form.transporterName} onChange={set('transporterName')} size="small" fullWidth />
              <TextField label="L.R. No" value={form.lrNo} onChange={set('lrNo')} size="small" fullWidth />
            </Stack>
            <TextField label="Remarks (if any)" value={form.remarks} onChange={set('remarks')} size="small" fullWidth multiline minRows={2} />
          </Stack>
        </Paper>

        {/* Attachments */}
        <Paper sx={{ p: 2.5, borderRadius: 3, mb: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <FileCheck2 size={18} color={theme.palette.primary.main} />
            <Typography sx={{ fontWeight: 800 }}>Attachments</Typography>
          </Stack>
          <Stack spacing={1.5}>
            <UploadField label="Invoice" max={5} files={invoiceFiles} onChange={setInvoiceFiles} />
            <UploadField label="Eway Bill" max={5} files={ewayFiles} onChange={setEwayFiles} />
            <UploadField label="PDIR" max={10} files={pdirFiles} onChange={setPdirFiles} />
          </Stack>
        </Paper>

        <Divider sx={{ mb: 2 }} />
        <Stack direction="row" spacing={1.5} justifyContent="flex-end">
          <Button onClick={reset} sx={{ fontWeight: 700, color: 'text.secondary' }}>Clear</Button>
          <Button variant="contained" startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} disabled={saving} onClick={save} sx={{ fontWeight: 700, px: 3 }}>
            {saving ? 'Saving…' : 'Save Invoice'}
          </Button>
        </Stack>
      </Box>
    </Box>
  );
};

export default InvoiceEntryForm;
