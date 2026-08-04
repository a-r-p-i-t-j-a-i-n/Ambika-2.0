import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box, Paper, Stack, Typography, Autocomplete, TextField, Button, Chip, MenuItem,
  alpha, useTheme, CircularProgress, IconButton, Divider, Link, Tooltip, Alert,
} from '@mui/material';
import { ReceiptText, Upload, X, Save, Paperclip, FileCheck2, Eye, Pencil, ShieldCheck } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { useGetChallansQuery } from '../../store/api/dispatchControlApi';
import { useGetTransportersQuery } from '../../store/api/transporterApi';
import { useCreateSalesInvoiceMutation, useGetSalesInvoicesQuery, useUpdateSalesInvoiceMutation } from '../../store/api/salesInvoiceApi';
import { useUploadFileMutation } from '../../store/api/o2dFmsApi';
import { resolveFileUrl } from '../../utils/fileUrl';
import { useReturnToTask } from './useReturnToTask';
import { useFmsGate, FmsGateBanner, FmsGateDialog } from './FmsGate';
import { O2D } from './o2dTheme';
import BackButton from '../../components/BackButton';

const TRANSPORT_TYPES = ['Freight Paid', 'To Pay', 'Party Vehicle'];
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx';

// A reusable multi-file upload field → returns [{ fileName, url }] via onChange.
const UploadField = ({ label, max, files, onChange, folder = 'invoices', readOnly = false }) => {
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
        {!readOnly && (
          <Button component="label" size="small" startIcon={isLoading ? <CircularProgress size={13} /> : <Upload size={13} />} disabled={isLoading || files.length >= max}>
            Add
            <input type="file" hidden multiple accept={ACCEPT} onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
          </Button>
        )}
      </Stack>
      {files.length === 0 ? (
        <Typography variant="caption" color="text.disabled">No files yet</Typography>
      ) : (
        <Stack spacing={0.5}>
          {files.map((f, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="center" sx={{ p: 0.5, borderRadius: 1, bgcolor: alpha(theme.palette.success.main, 0.08) }}>
              <Paperclip size={13} color={theme.palette.success.dark} />
              <Link href={resolveFileUrl(f.url)} target="_blank" rel="noopener" underline="hover"
                sx={{ flex: 1, fontSize: '0.78rem', color: 'text.primary', cursor: 'pointer' }} noWrap>{f.fileName}</Link>
              <Tooltip title="Preview"><IconButton size="small" onClick={() => window.open(resolveFileUrl(f.url), '_blank', 'noopener')}><Eye size={13} /></IconButton></Tooltip>
              {!readOnly && <Tooltip title="Remove"><IconButton size="small" onClick={() => onChange(files.filter((_, j) => j !== i))}><X size={13} /></IconButton></Tooltip>}
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

  // Transporter master → the Transporter Name dropdown (active partners only).
  const { data: transportersRes } = useGetTransportersQuery({ limit: 1000, sort: 'name' });
  const transporterOptions = useMemo(
    () => (transportersRes?.data || []).filter((t) => t.isActive !== false),
    [transportersRes],
  );
  const [createInvoice, { isLoading: saving }] = useCreateSalesInvoiceMutation();
  const [updateInvoice, { isLoading: updating }] = useUpdateSalesInvoiceMutation();
  const { finishToTask } = useReturnToTask();
  const [searchParams] = useSearchParams();
  const soParam = searchParams.get('so') || '';
  const dcParam = searchParams.get('dc') || '';
  const [gateOpen, setGateOpen] = useState(false);

  const [dc, setDc] = useState(null);
  // An already-saved invoice for the selected challan → view/edit instead of re-create.
  const [existingId, setExistingId] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const loadedInvoiceIdRef = useRef(null);
  const gate = useFmsGate({ soNumber: dc?.soNumber || soParam, action: 'INVOICE_ENTRY' });
  const [form, setForm] = useState({
    status: 'Done', invoiceNo: '', invoiceDate: dayjs().format('YYYY-MM-DD'),
    invoiceAmount: '', transportType: 'Freight Paid', transporterName: '', lrNo: '', remarks: '',
  });
  const [invoiceFiles, setInvoiceFiles] = useState([]);
  const [ewayFiles, setEwayFiles] = useState([]);
  const [pdirFiles, setPdirFiles] = useState([]);

  // Look up whether the selected challan already has a (live) invoice.
  const dcId = dc?._id;
  const { data: existingRes } = useGetSalesInvoicesQuery({ dcId, limit: 5 }, { skip: !dcId });
  const existingInvoice = useMemo(() => {
    if (!dcId) return null;
    return (existingRes?.data || []).find(
      (inv) => String(inv.dcId?._id || inv.dcId) === String(dcId) && inv.status !== 'CANCELLED',
    ) || null;
  }, [existingRes, dcId]);

  // All live invoices for this SO → so an SO-scoped open lands on the challan that
  // still NEEDS invoicing (the pending consignment), never one already invoiced.
  const { data: soInvRes } = useGetSalesInvoicesQuery({ soNumber: soParam, limit: 100 }, { skip: !soParam });
  const invoicedDcIds = useMemo(
    () => new Set((soInvRes?.data || [])
      .filter((i) => i.status !== 'CANCELLED')
      .map((i) => String(i.dcId?._id || i.dcId))),
    [soInvRes],
  );

  const locked = !!existingId && !editMode;
  const busy = saving || updating;

  // Derive a readable file name from a stored URL/key.
  const nameFromUrl = (url, i) => {
    try { return decodeURIComponent(String(url).split('?')[0].split('/').pop()) || `File ${i + 1}`; }
    catch { return `File ${i + 1}`; }
  };
  const urlsToFiles = (urls) => (urls || []).map((url, i) => ({ url, fileName: nameFromUrl(url, i) }));

  // Load an existing invoice into the form (view mode) so the user sees the saved
  // details instead of a blank re-creation form.
  const loadInvoiceIntoForm = (inv) => {
    setExistingId(inv._id);
    setEditMode(false);
    setForm({
      status: inv.status === 'CANCELLED' ? 'Cancelled' : 'Done',
      invoiceNo: inv.invoiceNo || '',
      invoiceDate: inv.invoiceDate ? dayjs(inv.invoiceDate).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
      invoiceAmount: inv.invoiceAmount ?? '',
      transportType: inv.transportType || 'Freight Paid',
      transporterName: inv.transporterName || '',
      lrNo: inv.lrNo || '',
      remarks: inv.remarks || '',
    });
    setInvoiceFiles(urlsToFiles(inv.invoiceUrls));
    setEwayFiles(urlsToFiles(inv.ewayBillUrls));
    setPdirFiles(urlsToFiles(inv.pdirUrls));
  };

  // When the selected challan turns out to already have an invoice, load it once.
  useEffect(() => {
    if (existingInvoice && loadedInvoiceIdRef.current !== existingInvoice._id) {
      loadedInvoiceIdRef.current = existingInvoice._id;
      loadInvoiceIntoForm(existingInvoice);
    }
    // Depend on the invoice IDENTITY (a string), never the object — so a fresh query
    // reference for the same invoice can never re-run this and re-loop the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingInvoice?._id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Suggestions for the Invoice No box.
  // With a challan already chosen, the ONLY relevant suggestion is the number
  // captured against THAT dispatch — listing every other challan's number invites
  // picking one that belongs to a different consignment. With no challan chosen
  // the full list still works as a finder ("I know the invoice, find its DC").
  const invoiceNoOptions = useMemo(() => {
    if (dc) return dc.invoiceNo ? [dc.invoiceNo] : [];
    return [...new Set(challans.map((c) => c.invoiceNo).filter(Boolean))];
  }, [dc, challans]);
  const invoiceHint = dc?.invoiceNo
    ? `Captured at dispatch: ${dc.invoiceNo} — keep it, or type a different number.`
    : 'Type the tax invoice number, or pick one recorded at dispatch.';
  const challanByInvoiceNo = useMemo(() => {
    const m = new Map();
    challans.forEach((c) => { if (c.invoiceNo) m.set(c.invoiceNo, c); });
    return m;
  }, [challans]);

  // Pull dispatch details captured in Actual Dispatch onto a fresh invoice form.
  // Any prior existing-invoice state is cleared first (so switching challans never
  // carries the previous invoice's amount/files over); the useEffect then reloads
  // a saved invoice if the newly-picked challan already has one.
  const onPickDc = (v) => {
    // Idempotent — re-selecting the already-chosen challan must NOT re-fire all the
    // resets (that redundant cascade is what can spiral into an update loop).
    if (v && dc && String(v._id) === String(dc._id)) return;
    setDc(v);
    setExistingId(null);
    setEditMode(false);
    loadedInvoiceIdRef.current = null;
    setInvoiceFiles([]); setEwayFiles([]); setPdirFiles([]);
    setForm({
      status: 'Done',
      invoiceNo: v?.invoiceNo || '',
      invoiceDate: dayjs().format('YYYY-MM-DD'),
      invoiceAmount: '',
      transportType: v?.dispatchedThrough || 'Freight Paid',
      transporterName: v?.transporterName || '',
      lrNo: v?.lrNo || '',
      remarks: '',
    });
  };

  // Choosing an invoice number auto-selects its challan and fetches its details.
  const onPickInvoiceNo = (val) => {
    const inv = (val || '').trim();
    const c = challanByInvoiceNo.get(inv);
    if (c) onPickDc(c);
    else setForm((f) => ({ ...f, invoiceNo: inv }));
  };

  // Came from an FMS "Do it now"/"Do again":
  //  • ?dc=DC-xxx → select that exact challan.
  //  • ?so=…      → the invoice step recurs per challan, so land on the challan
  //    that is still PENDING (not yet invoiced). Only if every challan is already
  //    invoiced do we fall back to the latest one. This prevents opening an
  //    already-invoiced challan's locked/filled form when a fresh one is waiting.
  // presetRef holds the so/dc TARGET already applied — not a plain "done" flag.
  // This route stays mounted when only the query string changes (clicking a second
  // consignment goes ?dc=DC-071 → ?dc=DC-073 on the same path), so a boolean would
  // latch on the first challan and keep showing it for every later dispatch.
  // Keying on the target re-arms the pick whenever the URL points somewhere new,
  // while still firing only once per target so it never fights a manual selection.
  const presetRef = useRef('');
  useEffect(() => {
    const target = `${dcParam}|${soParam}`;
    if (!dcParam && !soParam) return;
    if (presetRef.current === target || !challans.length) return;
    if (dcParam) {
      const m = challans.find((c) => c.dcNumber === dcParam);
      if (m) { presetRef.current = target; onPickDc(m); }
      return;
    }
    if (soParam) {
      if (soInvRes === undefined) return; // wait for the SO's invoice list to load
      const soChallans = challans.filter((c) => c.soNumber === soParam);
      if (!soChallans.length) return;
      const pending = soChallans.find((c) => !invoicedDcIds.has(String(c._id)));
      presetRef.current = target;
      onPickDc(pending || soChallans[0]);
    }
    // Deps are stable primitives / query results only. We deliberately do NOT list
    // `dc` or `invoicedDcIds` (a fresh Set each time it recomputes): presetRef already
    // guards the one-shot-per-target pick, and keeping churny references out prevents
    // any chance of this effect re-entering in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challans, soParam, dcParam, soInvRes]);

  const reset = () => {
    setDc(null);
    setExistingId(null);
    setEditMode(false);
    loadedInvoiceIdRef.current = null;
    setForm({ status: 'Done', invoiceNo: '', invoiceDate: dayjs().format('YYYY-MM-DD'), invoiceAmount: '', transportType: 'Freight Paid', transporterName: '', lrNo: '', remarks: '' });
    setInvoiceFiles([]); setEwayFiles([]); setPdirFiles([]);
  };

  // Discard in-progress edits and return to the saved (view) state.
  const cancelEdit = () => { if (existingInvoice) loadInvoiceIntoForm(existingInvoice); };

  const save = async () => {
    if (!dc) return enqueueSnackbar('Select a delivery challan first.', { variant: 'warning' });
    if (!form.invoiceNo.trim()) return enqueueSnackbar('Invoice No is required.', { variant: 'warning' });
    const body = {
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
    };
    try {
      if (existingId) {
        // Edit-and-update the existing invoice — changes flow to the 2.8 email step.
        const res = await updateInvoice({ id: existingId, ...body }).unwrap();
        enqueueSnackbar(`Invoice ${res.data.invoiceNo} updated.`, { variant: 'success' });
        setEditMode(false);
        loadedInvoiceIdRef.current = null; // let the refetched invoice reload cleanly
      } else {
        const res = await createInvoice(body).unwrap();
        enqueueSnackbar(`Invoice ${res.data.invoiceNo} saved.`, { variant: 'success' });
        // Open the order's FMS task (checklist auto-marked); reset only if none.
        const opened = await finishToTask({ soNumber: dc?.soNumber, action: 'INVOICE_ENTRY' });
        if (!opened) reset();
      }
    } catch (e) {
      enqueueSnackbar(e?.data?.message || 'Could not save the invoice.', { variant: 'error' });
    }
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: O2D.canvas }}>
      <Box sx={{ position: 'sticky', top: 0, zIndex: 5, bgcolor: O2D.surface, borderBottom: `1px solid ${O2D.line}`, px: { xs: 1.5, md: 2 }, py: 1 }}>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <BackButton iconOnly sx={{ color: O2D.body, border: `1px solid ${O2D.line}`, borderRadius: '6px', flexShrink: 0 }} />
          <Box sx={{ width: 30, height: 30, borderRadius: '6px', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: alpha(O2D.brand, 0.1), color: O2D.brand }}>
            <ReceiptText size={16} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ color: O2D.ink, fontSize: { xs: '1rem', md: '1.1rem' }, fontWeight: 800, lineHeight: 1.2 }}>Create Invoice &amp; Eway Bill</Typography>
            <Typography noWrap sx={{ color: O2D.sub, fontSize: '0.72rem' }}>Step 2.7 — record the tax invoice &amp; e-way bill for a dispatch.</Typography>
          </Box>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.25, md: 1.75 }, py: 1.5, pb: 6, maxWidth: 1180, mx: 'auto' }}>
        {gate.blocked && <FmsGateBanner gate={gate.gate} onOpen={() => setGateOpen(true)} />}
        {/* Challan picker + auto-filled context */}
        <Paper elevation={0} sx={{ p: 2, borderRadius: '8px', mb: 1.5, border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
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

        {/* Already-invoiced challan → show saved details, locked, with an Edit action. */}
        {existingId && (
          <Alert
            severity={editMode ? 'warning' : 'info'}
            icon={editMode ? <Pencil size={18} /> : <ShieldCheck size={18} />}
            sx={{ mb: 2, borderRadius: 3, alignItems: 'center' }}
            action={locked && (
              <Button color="inherit" size="small" startIcon={<Pencil size={14} />} onClick={() => setEditMode(true)} sx={{ fontWeight: 700 }}>
                Edit
              </Button>
            )}
          >
            {editMode
              ? 'Editing the existing invoice for this challan — your changes will update it and carry into the email step (2.8).'
              : `This delivery challan is already invoiced (${form.invoiceNo || existingInvoice?.invoiceNo || '—'}). The saved details are shown below and locked — click Edit to change them.`}
          </Alert>
        )}

        {/* Form fields */}
        <Paper elevation={0} sx={{ p: 2, borderRadius: '8px', mb: 1.5, border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField select label="Status" value={form.status} onChange={set('status')} size="small" sx={{ minWidth: 160 }} disabled={locked}>
                <MenuItem value="Done">Done</MenuItem>
                <MenuItem value="Cancelled">Cancelled</MenuItem>
              </TextField>
              <Autocomplete
                freeSolo
                fullWidth
                disabled={locked}
                options={invoiceNoOptions}
                value={form.invoiceNo}
                selectOnFocus
                handleHomeEndKeys
                clearOnBlur={false}
                onChange={(_, val, reason) => {
                  // ONLY an explicit pick from the list may re-target the challan.
                  // Previously any committed value ran through onPickInvoiceNo, so
                  // typing a number that happened to match another dispatch silently
                  // swapped the whole form to that challan and discarded the entry.
                  if (reason === 'selectOption') onPickInvoiceNo(val || '');
                  else setForm((f) => ({ ...f, invoiceNo: String(val || '').trim() }));
                }}
                onInputChange={(_, val, reason) => { if (reason === 'input') setForm((f) => ({ ...f, invoiceNo: val })); }}
                onBlur={() => setForm((f) => ({ ...f, invoiceNo: f.invoiceNo.trim() }))}
                renderInput={(p) => (
                  <TextField {...p} label="Invoice No" size="small" required
                    placeholder="e.g. INV/2026/0143"
                    helperText={locked ? ' ' : invoiceHint} />
                )}
              />
              <TextField label="Invoice Date" type="date" value={form.invoiceDate} onChange={set('invoiceDate')} size="small" InputLabelProps={{ shrink: true }} sx={{ minWidth: 170 }} disabled={locked} />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Invoice Amount (₹)" type="number" value={form.invoiceAmount} onChange={set('invoiceAmount')} size="small" fullWidth disabled={locked} />
              <TextField select label="Type of Transportation" value={form.transportType} onChange={set('transportType')} size="small" fullWidth disabled={locked}>
                {TRANSPORT_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Autocomplete
                freeSolo
                fullWidth
                disabled={locked}
                options={transporterOptions}
                value={form.transporterName}
                onChange={(_, val) => setForm((f) => ({ ...f, transporterName: typeof val === 'string' ? val : (val?.name || '') }))}
                onInputChange={(_, val, reason) => { if (reason === 'input') setForm((f) => ({ ...f, transporterName: val })); }}
                getOptionLabel={(o) => (typeof o === 'string' ? o : (o?.name || ''))}
                isOptionEqualToValue={(o, val) => (typeof o === 'string' ? o : o?.name) === (typeof val === 'string' ? val : val?.name)}
                renderOption={(props, o) => (
                  <li {...props} key={o._id}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{o.name}</Typography>
                      {(o.contactPerson || o.phone || o.city) && (
                        <Typography variant="caption" color="text.secondary">
                          {[o.contactPerson, o.phone, o.city].filter(Boolean).join(' · ')}
                        </Typography>
                      )}
                    </Box>
                  </li>
                )}
                renderInput={(p) => (
                  <TextField {...p} label="Transporter Name" size="small"
                    placeholder="Select from transporter master / type" />
                )}
              />
              <TextField label="L.R. No" value={form.lrNo} onChange={set('lrNo')} size="small" fullWidth disabled={locked} />
            </Stack>
            <TextField label="Remarks (if any)" value={form.remarks} onChange={set('remarks')} size="small" fullWidth multiline minRows={2} disabled={locked} />
          </Stack>
        </Paper>

        {/* Attachments */}
        <Paper elevation={0} sx={{ p: 2, borderRadius: '8px', mb: 1.5, border: `1px solid ${O2D.line}`, bgcolor: O2D.surface }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <FileCheck2 size={18} color={theme.palette.primary.main} />
            <Typography sx={{ fontWeight: 800 }}>Attachments</Typography>
          </Stack>
          <Stack spacing={1.5}>
            <UploadField label="Invoice" max={5} files={invoiceFiles} onChange={setInvoiceFiles} readOnly={locked} />
            <UploadField label="Eway Bill" max={5} files={ewayFiles} onChange={setEwayFiles} readOnly={locked} />
            <UploadField label="PDIR" max={10} files={pdirFiles} onChange={setPdirFiles} readOnly={locked} />
          </Stack>
        </Paper>

        <Divider sx={{ mb: 2 }} />
        <Stack direction="row" spacing={1.5} justifyContent="flex-end">
          <Button onClick={reset} sx={{ fontWeight: 700, color: 'text.secondary' }}>Clear</Button>
          {locked ? (
            <Button variant="contained" startIcon={<Pencil size={16} />} onClick={() => setEditMode(true)} sx={{ fontWeight: 700, px: 3 }}>
              Edit Invoice
            </Button>
          ) : (
            <>
              {existingId && editMode && (
                <Button onClick={cancelEdit} sx={{ fontWeight: 700, color: 'text.secondary' }}>Cancel</Button>
              )}
              <Button variant="contained" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />} disabled={busy || gate.blocked} onClick={save} sx={{ fontWeight: 700, px: 3 }}>
                {busy ? 'Saving…' : existingId ? 'Update Invoice' : 'Save Invoice'}
              </Button>
            </>
          )}
        </Stack>
      </Box>
      <FmsGateDialog gate={gate.gate} open={gateOpen} onClose={() => setGateOpen(false)} />
    </Box>
  );
};

export default InvoiceEntryForm;
