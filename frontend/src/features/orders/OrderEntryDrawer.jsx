import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Drawer, Box, Typography, IconButton, Divider, Button, TextField,
  MenuItem, Autocomplete, CircularProgress, InputAdornment, Chip,
  Tooltip, alpha, useTheme, LinearProgress, Stack, Paper,
} from '@mui/material';
import {
  X, Plus, Trash2, Save, FileText, Package, Building2,
  Calendar, Truck, MapPin, FileUp, CheckCircle2, AlertCircle, Hash,
  Layers, Receipt, Sparkles,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useSnackbar } from 'notistack';
import {
  useCreateOrderEntryMutation,
  useUploadOrderDocumentMutation,
} from '../../store/api/dispatchControlApi';
import { useGetPartiesQuery } from '../../store/api/partyApi';
import { useGetOrdersByPartyQuery } from '../../store/api/orderApi';
import { useGetSkuLookupQuery } from '../../store/api/skuApi';

const TRANSPORT_OPTIONS = ['Road', 'Rail', 'Air', 'Sea', 'Courier'];
const PARTY_GROUPS = ['Domestic', 'Export', 'OEM', 'Distributor', 'Direct'];

const emptyItem = () => ({
  _tempId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  skuId: '', skuName: '', skuCode: '', orderQty: '', asnCode: '', remark: '',
});

const baseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1').replace(/\/api\/v\d+\/?$/, '');
const resolveAssetUrl = (url) => (url?.startsWith('http') ? url : `${baseUrl}${url || ''}`);

// ── tiny presentational helpers ───────────────────────────────────────────
const SectionLabel = ({ icon: Icon, children }) => {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
      <Box sx={{
        width: 24, height: 24, borderRadius: '8px', display: 'grid', placeItems: 'center',
        bgcolor: alpha(theme.palette.primary.main, 0.10), color: 'primary.main',
      }}>
        <Icon size={13} strokeWidth={2.5} />
      </Box>
      <Typography sx={{
        fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary',
        textTransform: 'uppercase', letterSpacing: '0.08em',
      }}>{children}</Typography>
    </Box>
  );
};

const FieldGrid = ({ children, cols = 2 }) => (
  <Box sx={{
    display: 'grid',
    gridTemplateColumns: { xs: '1fr', sm: `repeat(${cols}, 1fr)` },
    gap: 1.5,
  }}>{children}</Box>
);

// ── Party preview — shows credit / lead / recent activity ────────────────
const PartyPreview = ({ party }) => {
  const theme = useTheme();
  const { data: recentRes } = useGetOrdersByPartyQuery(
    { partyId: party?._id, limit: 3, sort: '-orderDate' },
    { skip: !party?._id },
  );
  const recent = recentRes?.data || [];

  if (!party) return null;
  return (
    <Box sx={{
      mt: 1.25, p: 1.5, borderRadius: '12px',
      bgcolor: alpha(theme.palette.primary.main, 0.04),
      border: `1px dashed ${alpha(theme.palette.primary.main, 0.22)}`,
    }}>
      <Stack direction="row" spacing={2} flexWrap="wrap" sx={{ alignItems: 'center', rowGap: 0.5 }}>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <MapPin size={12} color={theme.palette.text.secondary} />
          <Typography variant="caption" color="text.primary" fontWeight={600}>
            {party.location || '—'}{party.state ? `, ${party.state}` : ''}
          </Typography>
        </Stack>
        {party.gstNo && (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Hash size={12} color={theme.palette.text.secondary} />
            <Typography variant="caption" color="text.secondary">{party.gstNo}</Typography>
          </Stack>
        )}
        <Chip label={`Credit ${party.creditPeriodDays || 30}d`} size="small" variant="outlined" />
        <Chip label={`Lead ${party.leadTimeDays || 7}d`} size="small" variant="outlined" />
      </Stack>
      {recent.length > 0 && (
        <Box sx={{ mt: 1, pt: 1, borderTop: `1px dashed ${alpha(theme.palette.primary.main, 0.18)}` }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
            Recent orders
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" rowGap={0.5}>
            {recent.map((o) => (
              <Chip
                key={o._id}
                size="small"
                label={`${o.soNumber} · ${Number(o.totalOrderQty || 0).toLocaleString('en-IN')} pcs · ${dayjs(o.orderDate).format('DD MMM')}`}
                sx={{ fontSize: '0.7rem' }}
              />
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
};

// ── PO document drop zone ────────────────────────────────────────────────
const DocumentDrop = ({ value, valueName, onChange, uploading, error }) => {
  const theme = useTheme();
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const onFiles = (files) => {
    const file = files?.[0];
    if (file) onChange(file);
  };

  return (
    <Box
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      sx={{
        cursor: uploading ? 'wait' : 'pointer',
        border: '1.5px dashed',
        borderColor: error ? 'error.main' : drag ? 'primary.main' : alpha(theme.palette.primary.main, 0.3),
        borderRadius: '12px',
        p: 1.5,
        bgcolor: drag ? alpha(theme.palette.primary.main, 0.06) : alpha(theme.palette.primary.main, 0.02),
        transition: 'all 160ms',
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        '&:hover': { borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.04) },
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls"
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
      <Box sx={{
        width: 38, height: 38, borderRadius: '10px', display: 'grid', placeItems: 'center',
        bgcolor: alpha(theme.palette.primary.main, 0.10), color: 'primary.main',
      }}>
        {uploading ? <CircularProgress size={16} /> : value ? <CheckCircle2 size={18} /> : <FileUp size={18} />}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {value ? (
          <>
            <Typography variant="body2" fontWeight={600} noWrap color="text.primary">{valueName || 'Uploaded document'}</Typography>
            <Typography variant="caption" color="text.secondary">Click or drop to replace</Typography>
          </>
        ) : (
          <>
            <Typography variant="body2" fontWeight={600} color="text.primary">Drop PO document or click to browse</Typography>
            <Typography variant="caption" color="text.secondary">PDF · PNG · JPG · XLSX up to 10&nbsp;MB</Typography>
          </>
        )}
      </Box>
      {value && (
        <Tooltip title="Open in new tab">
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); window.open(resolveAssetUrl(value), '_blank'); }}
          >
            <FileText size={14} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
};

// ── Main component ──────────────────────────────────────────────────────
const OrderEntryDrawer = ({ open, onClose }) => {
  const theme = useTheme();
  const { enqueueSnackbar } = useSnackbar();
  const [createOrderEntry, { isLoading: isSubmitting }] = useCreateOrderEntryMutation();
  const [uploadOrderDocument, { isLoading: isUploading }] = useUploadOrderDocumentMutation();

  const { data: partiesData } = useGetPartiesQuery({ limit: 250 });
  const { data: skusData }    = useGetSkuLookupQuery({ limit: 1000 });
  const parties = useMemo(() => partiesData?.data || [], [partiesData]);
  const skus    = useMemo(() => skusData?.data || [], [skusData]);

  const [form, setForm] = useState({
    poNumber: '',
    poDate: dayjs().format('YYYY-MM-DD'),
    party: null,
    place: '',
    orderDate: dayjs().format('YYYY-MM-DD'),
    transport: 'Road',
    partyGroup: '',
    orderDocument: '',
    orderDocumentName: '',
    leadTimeDays: 7,
  });
  const [items, setItems] = useState([emptyItem()]);
  const [fieldErrors, setFieldErrors] = useState({});

  // Reset on open.
  useEffect(() => {
    if (!open) return;
    setForm({
      poNumber: '',
      poDate: dayjs().format('YYYY-MM-DD'),
      party: null,
      place: '',
      orderDate: dayjs().format('YYYY-MM-DD'),
      transport: 'Road',
      partyGroup: '',
      orderDocument: '',
      orderDocumentName: '',
      leadTimeDays: 7,
    });
    setItems([emptyItem()]);
    setFieldErrors({});
  }, [open]);

  const handlePartyChange = (_, party) => {
    setForm((prev) => ({
      ...prev,
      party,
      place: party?.location || '',
      leadTimeDays: party?.leadTimeDays || 7,
    }));
  };

  const handleSkuPick = (index, sku) => {
    setItems((prev) => prev.map((it, i) => (
      i === index
        ? { ...it, skuId: sku?._id || '', skuName: sku?.name || '', skuCode: sku?.code || '' }
        : it
    )));
  };

  const handleItemChange = (index, field, value) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, [field]: value } : it)));
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (index) => setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));

  // ── Paste from Excel: split on \n and \t. Header row is auto-detected. ──
  const handlePaste = useCallback((e) => {
    const text = e.clipboardData?.getData('text');
    if (!text || !text.includes('\t')) return; // not tabular — let default paste happen
    e.preventDefault();
    const rows = text.split(/\r?\n/).filter((r) => r.trim()).map((row) => row.split('\t'));
    if (!rows.length) return;

    // Try to find SKU by code first, then by name. Pasted rows assumed to be
    // [SkuOrCode, qty, asn, remark] in any reasonable order — we keep it simple:
    // first non-numeric column = sku reference, first numeric = qty.
    const created = rows.map((cells) => {
      const trimmed = cells.map((c) => String(c || '').trim());
      const qty = trimmed.find((c) => /^\d[\d,]*$/.test(c));
      const skuRef = trimmed.find((c) => c && c !== qty && !/^\d[\d,]*$/.test(c));
      let sku = null;
      if (skuRef) {
        const key = skuRef.toLowerCase();
        sku = skus.find((s) => s.code?.toLowerCase() === key) || skus.find((s) => s.name?.toLowerCase() === key);
      }
      return {
        _tempId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        skuId: sku?._id || '',
        skuName: sku?.name || skuRef || '',
        skuCode: sku?.code || '',
        orderQty: qty ? qty.replace(/,/g, '') : '',
        asnCode: '',
        remark: '',
      };
    }).filter((it) => it.skuName || it.orderQty);

    if (!created.length) return;
    setItems((prev) => {
      // If the only existing row is empty, replace it; otherwise append.
      const onlyEmpty = prev.length === 1 && !prev[0].skuId && !prev[0].orderQty;
      return onlyEmpty ? created : [...prev, ...created];
    });
    enqueueSnackbar(`Pasted ${created.length} row${created.length > 1 ? 's' : ''} from clipboard`, { variant: 'success' });
  }, [skus, enqueueSnackbar]);

  // ── Upload PO doc ────────────────────────────────────────────────
  const handleDocChange = async (file) => {
    if (!file) return;
    try {
      const res = await uploadOrderDocument(file).unwrap();
      setForm((prev) => ({ ...prev, orderDocument: res.data?.url || res.url, orderDocumentName: file.name }));
      enqueueSnackbar('Document uploaded', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Upload failed', { variant: 'error' });
    }
  };

  // ── Live derived state ───────────────────────────────────────────
  const validItems = items.filter((i) => i.skuId && Number(i.orderQty) > 0);
  const totalQty   = validItems.reduce((s, i) => s + Number(i.orderQty || 0), 0);
  const isStep1Valid = Boolean(form.poNumber.trim() && form.party && form.orderDate);
  const isStep2Valid = validItems.length > 0;
  const canSubmit = isStep1Valid && isStep2Valid && !isSubmitting;

  // ── Validate + submit ────────────────────────────────────────────
  const handleSubmit = async () => {
    const errs = {};
    if (!form.poNumber.trim()) errs.poNumber = 'PO Number is required';
    if (!form.party)            errs.party    = 'Select a party';
    if (!validItems.length)     errs.items    = 'Add at least one SKU with a positive quantity';
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      enqueueSnackbar('Fix the highlighted fields and try again', { variant: 'warning' });
      return;
    }

    const payload = {
      poNumber: form.poNumber.trim(),
      poDate:   form.poDate ? new Date(form.poDate) : null,
      partyId:  form.party._id,
      partyName: form.party.name,
      location: form.party.location || '',
      place:    form.place || form.party.location || '',
      orderDate: new Date(form.orderDate),
      transport: form.transport,
      partyGroup: form.partyGroup || null,
      orderDocument: form.orderDocument || null,
      orderDocumentName: form.orderDocumentName || null,
      leadTimeDays: Number(form.leadTimeDays) || 7,
      items: validItems.map(({ _tempId, orderQty, ...rest }) => ({ ...rest, orderQty: Number(orderQty) })),
    };

    try {
      const res = await createOrderEntry(payload).unwrap();
      const so = res?.data?.soNumber || 'order';
      enqueueSnackbar(`Sales Order ${so} created`, { variant: 'success' });
      onClose?.();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to create order', { variant: 'error' });
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      disableEnforceFocus
      PaperProps={{
        sx: {
          width: { xs: '100%', md: 820 },
          p: 0,
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.default',
        },
      }}
    >
      {/* ── Header (sticky) ──────────────────────────────────────── */}
      <Box sx={{
        position: 'sticky', top: 0, zIndex: 10,
        bgcolor: 'background.paper',
        borderBottom: '1px solid', borderColor: 'divider',
        px: 3, py: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
          <Box sx={{
            width: 38, height: 38, borderRadius: '12px', display: 'grid', placeItems: 'center',
            background: `linear-gradient(135deg, ${theme.palette.primary.light}, ${theme.palette.primary.dark})`,
            color: 'common.white',
          }}>
            <Receipt size={18} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: 'text.primary', lineHeight: 1.15 }}>
              New Sales Order
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Sparkles size={11} /> Auto SO # · Validation enforced
            </Typography>
          </Box>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={onClose} startIcon={<X size={14} />} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={!canSubmit}
            startIcon={isSubmitting ? <CircularProgress size={14} color="inherit" /> : <Save size={14} />}
          >
            Submit Order
          </Button>
        </Stack>
      </Box>

      {/* progress bar to indicate completion */}
      <LinearProgress
        variant="determinate"
        value={(isStep1Valid ? 50 : 0) + (isStep2Valid ? 50 : 0)}
        sx={{ height: 3 }}
      />

      {/* ── Scroll body ──────────────────────────────────────────── */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: 3, py: 2.5 }}>
        {/* Step 1 — Customer & PO */}
        <Paper sx={{ p: 2.5, mb: 2, borderRadius: '14px' }}>
          <SectionLabel icon={Building2}>Step 1 · Customer & PO</SectionLabel>
          <FieldGrid cols={2}>
            <Box>
              <Autocomplete
                options={parties}
                value={form.party}
                onChange={handlePartyChange}
                getOptionLabel={(o) => o?.name || ''}
                isOptionEqualToValue={(a, b) => a._id === b?._id}
                renderInput={(p) => (
                  <TextField
                    {...p}
                    label="Party *"
                    placeholder="Search customer / party..."
                    error={Boolean(fieldErrors.party)}
                    helperText={fieldErrors.party || ' '}
                  />
                )}
                renderOption={(props, opt) => (
                  <li {...props} key={opt._id}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={700} noWrap>{opt.name}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {[opt.location, opt.state].filter(Boolean).join(', ') || opt.code || '—'}
                      </Typography>
                    </Box>
                  </li>
                )}
              />
              {form.party && <PartyPreview party={form.party} />}
            </Box>
            <Stack spacing={1.5}>
              <TextField
                label="PO Number *"
                value={form.poNumber}
                onChange={(e) => setForm((p) => ({ ...p, poNumber: e.target.value }))}
                placeholder="e.g. PODM02537/25-26"
                error={Boolean(fieldErrors.poNumber)}
                helperText={fieldErrors.poNumber || ' '}
                InputProps={{ startAdornment: <InputAdornment position="start"><Hash size={14} /></InputAdornment> }}
              />
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                <TextField
                  label="PO Date"
                  type="date"
                  value={form.poDate}
                  onChange={(e) => setForm((p) => ({ ...p, poDate: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Order Date *"
                  type="date"
                  value={form.orderDate}
                  onChange={(e) => setForm((p) => ({ ...p, orderDate: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                />
              </Box>
            </Stack>
          </FieldGrid>

          <Divider sx={{ my: 2 }} />

          <FieldGrid cols={4}>
            <TextField
              select
              label="Transport"
              value={form.transport}
              onChange={(e) => setForm((p) => ({ ...p, transport: e.target.value }))}
              InputProps={{ startAdornment: <InputAdornment position="start"><Truck size={14} /></InputAdornment> }}
            >
              {TRANSPORT_OPTIONS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
            <TextField
              label="Place"
              value={form.place}
              onChange={(e) => setForm((p) => ({ ...p, place: e.target.value }))}
              placeholder="Ship-to place"
              InputProps={{ startAdornment: <InputAdornment position="start"><MapPin size={14} /></InputAdornment> }}
            />
            <TextField
              select
              label="Party Group"
              value={form.partyGroup}
              onChange={(e) => setForm((p) => ({ ...p, partyGroup: e.target.value }))}
            >
              <MenuItem value="">—</MenuItem>
              {PARTY_GROUPS.map((g) => <MenuItem key={g} value={g}>{g}</MenuItem>)}
            </TextField>
            <TextField
              label="Lead (days)"
              type="number"
              value={form.leadTimeDays}
              onChange={(e) => setForm((p) => ({ ...p, leadTimeDays: Number(e.target.value) || 0 }))}
              InputProps={{ startAdornment: <InputAdornment position="start"><Calendar size={14} /></InputAdornment> }}
            />
          </FieldGrid>

          <Box sx={{ mt: 2 }}>
            <DocumentDrop
              value={form.orderDocument}
              valueName={form.orderDocumentName}
              onChange={handleDocChange}
              uploading={isUploading}
            />
          </Box>
        </Paper>

        {/* Step 2 — SKU lines */}
        <Paper sx={{ p: 2.5, borderRadius: '14px' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <SectionLabel icon={Package}>Step 2 · Line Items {validItems.length > 0 && `(${validItems.length})`}</SectionLabel>
            <Stack direction="row" spacing={1} alignItems="center">
              <Tooltip title="Paste rows from Excel — tab-separated [SKU code/name, qty, ASN, remark]" arrow>
                <Chip
                  icon={<Layers size={11} />}
                  label="Paste from Excel"
                  size="small"
                  variant="outlined"
                  sx={{ cursor: 'help' }}
                />
              </Tooltip>
              <Button size="small" variant="text" startIcon={<Plus size={14} />} onClick={addItem}>
                Add row
              </Button>
            </Stack>
          </Box>

          {fieldErrors.items && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'error.main', mb: 1, fontSize: '0.75rem' }}>
              <AlertCircle size={13} /> {fieldErrors.items}
            </Box>
          )}

          {/* SKU table — every row is an interactive editor */}
          <Box
            onPaste={handlePaste}
            sx={{
              border: '1px solid', borderColor: 'divider', borderRadius: '12px', overflow: 'hidden',
              bgcolor: 'background.paper',
            }}
          >
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '2.2fr 1fr 0.9fr 1fr 1.2fr 40px' },
              px: 1.5, py: 1, bgcolor: alpha(theme.palette.primary.main, 0.04),
              borderBottom: '1px solid', borderColor: 'divider',
              fontSize: '0.7rem', fontWeight: 700,
              textTransform: 'uppercase', color: 'text.secondary', letterSpacing: '0.06em',
            }}>
              <Box>SKU</Box>
              <Box>Code</Box>
              <Box sx={{ textAlign: 'right' }}>Qty *</Box>
              <Box>ASN / FCI</Box>
              <Box>Remark</Box>
              <Box />
            </Box>
            {items.map((it, idx) => (
              <Box key={it._tempId} sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '2.2fr 1fr 0.9fr 1fr 1.2fr 40px' },
                gap: 1,
                px: 1.5, py: 1, alignItems: 'center',
                borderBottom: idx === items.length - 1 ? 0 : '1px solid',
                borderColor: 'divider',
                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.02) },
              }}>
                <Autocomplete
                  options={skus}
                  value={skus.find((s) => s._id === it.skuId) || null}
                  onChange={(_, sku) => handleSkuPick(idx, sku)}
                  getOptionLabel={(o) => o?.name || ''}
                  isOptionEqualToValue={(a, b) => a._id === b?._id}
                  size="small"
                  renderInput={(p) => <TextField {...p} placeholder="Select SKU" />}
                  renderOption={(props, opt) => (
                    <li {...props} key={opt._id}>
                      <Box>
                        <Typography variant="body2" fontWeight={600}>{opt.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{opt.code}</Typography>
                      </Box>
                    </li>
                  )}
                />
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {it.skuCode || '—'}
                </Typography>
                <TextField
                  type="number"
                  size="small"
                  value={it.orderQty}
                  onChange={(e) => handleItemChange(idx, 'orderQty', e.target.value)}
                  inputProps={{ style: { textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' } }}
                  placeholder="0"
                />
                <TextField
                  size="small"
                  value={it.asnCode}
                  onChange={(e) => handleItemChange(idx, 'asnCode', e.target.value)}
                  placeholder="—"
                />
                <TextField
                  size="small"
                  value={it.remark}
                  onChange={(e) => handleItemChange(idx, 'remark', e.target.value)}
                  placeholder="—"
                />
                <IconButton
                  size="small"
                  onClick={() => removeItem(idx)}
                  disabled={items.length === 1}
                  sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                >
                  <Trash2 size={14} />
                </IconButton>
              </Box>
            ))}
          </Box>
        </Paper>
      </Box>

      {/* ── Sticky footer summary ────────────────────────────────── */}
      <Box sx={{
        position: 'sticky', bottom: 0, zIndex: 10,
        borderTop: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper',
        px: 3, py: 1.75,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Stack direction="row" spacing={2.5}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>SKUs</Typography>
            <Typography variant="h6" fontWeight={800} color="text.primary">{validItems.length}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Total Qty</Typography>
            <Typography variant="h6" fontWeight={800} color="primary.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {totalQty.toLocaleString('en-IN')}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Document</Typography>
            <Typography variant="body2" fontWeight={700} color={form.orderDocument ? 'success.main' : 'text.secondary'}>
              {form.orderDocument ? 'Attached' : 'Not attached'}
            </Typography>
          </Box>
        </Stack>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!canSubmit}
          startIcon={isSubmitting ? <CircularProgress size={14} color="inherit" /> : <Save size={14} />}
        >
          Submit Order
        </Button>
      </Box>
    </Drawer>
  );
};

export default OrderEntryDrawer;
