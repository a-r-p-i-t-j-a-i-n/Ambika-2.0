import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Dialog, Box, Typography, IconButton, Divider, Button, TextField,
  MenuItem, Autocomplete, CircularProgress, InputAdornment, Chip,
  Tooltip, alpha, useTheme, useMediaQuery, LinearProgress, Stack, Paper,
} from '@mui/material';
import {
  X, Plus, Trash2, Save, FileText, Package, Building2,
  Calendar, Truck, MapPin, FileUp, CheckCircle2, AlertCircle, Hash,
  Layers, Receipt, Sparkles, ListPlus, RotateCw, History, IndianRupee,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useSnackbar } from 'notistack';
import {
  useCreateOrderEntryMutation,
  useUploadOrderDocumentMutation,
} from '../../store/api/dispatchControlApi';
import { useGetPartiesQuery, useGetPartyByIdQuery } from '../../store/api/partyApi';
import { useGetOrdersByPartyQuery, useUpdateOrderMutation } from '../../store/api/orderApi';
import { useGetSkuLookupQuery } from '../../store/api/skuApi';
import { useOpenFmsTask } from '../o2d-fms/useOpenFmsTask';

const TRANSPORT_OPTIONS = ['Road', 'Rail', 'Air', 'Sea', 'Courier'];
const PARTY_GROUPS = ['Domestic', 'Export', 'OEM', 'Distributor', 'Direct'];

const emptyItem = () => ({
  _tempId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  skuId: '', skuName: '', skuCode: '', orderQty: '', rate: '', asnCode: '', remark: '',
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

// Map a saved order's line items into the drawer's editable item shape,
// preserving _id and dispatchedQty so an edit never wipes dispatch progress.
const orderItemsToForm = (order) => {
  const lines = order?.items || [];
  if (!lines.length) return [emptyItem()];
  return lines.map((it) => ({
    _tempId: String(it._id || `${it.skuCode || 'row'}-${Math.random().toString(36).slice(2, 8)}`),
    _id: it._id || undefined,
    skuId: it.skuId?._id || it.skuId || '',
    skuName: it.skuName || it.skuId?.name || '',
    skuCode: it.skuCode || it.skuId?.code || '',
    orderQty: it.orderQty ?? '',
    rate: it.rate ?? '',
    dispatchedQty: Number(it.dispatchedQty || 0),
    asnCode: it.asnCode || '',
    remark: it.remark || '',
  }));
};

// ── Main component ──────────────────────────────────────────────────────
const OrderEntryDrawer = ({ open, onClose, order = null, intake = null }) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const { enqueueSnackbar } = useSnackbar();
  const isEditMode = Boolean(order && order._id);
  const [createOrderEntry, { isLoading: isCreating }] = useCreateOrderEntryMutation();
  const [updateOrder, { isLoading: isUpdatingOrder }] = useUpdateOrderMutation();
  const [uploadOrderDocument, { isLoading: isUploading }] = useUploadOrderDocumentMutation();
  const openFmsTask = useOpenFmsTask();
  const isSubmitting = isCreating || isUpdatingOrder;

  const { data: partiesData } = useGetPartiesQuery({ limit: 250 });
  // Sales orders sell finished goods only — restrict the SKU picker to FINISHED_GOOD
  // items (raw materials, consumables, packing, circles are not directly sellable).
  const { data: skusData }    = useGetSkuLookupQuery({ limit: 1000, itemType: 'FINISHED_GOOD' });
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
  // Tracks which party the current line items were auto-filled from, so switching
  // party refreshes the catalog but we never silently clobber typed quantities.
  const [filledPartyId, setFilledPartyId] = useState(null);

  // The selected party's saved catalog (SKUs they regularly order). Fetched fresh
  // on selection so we always have the full `orderedSkus` list (the parties list
  // query may be trimmed). This is the "grouping" maintained per party.
  const selectedPartyId = form.party?._id || null;
  const { data: partyDetailRes, isFetching: partyDetailLoading } = useGetPartyByIdQuery(
    selectedPartyId, { skip: !selectedPartyId },
  );
  const partyDetail = partyDetailRes?.data || null;
  const partyCatalog = useMemo(
    () => (String(partyDetail?._id || '') === String(selectedPartyId || '') ? (partyDetail?.orderedSkus || []) : []),
    [partyDetail, selectedPartyId],
  );

  // Turn a party's saved catalog into editable, blank-quantity line rows.
  const catalogToItems = useCallback((catalog) => catalog.map((c, i) => ({
    _tempId: `cat-${selectedPartyId}-${i}-${c.skuCode || c.skuName || 'row'}`,
    skuId:   c.skuId || '',
    skuName: c.skuName || '',
    skuCode: c.skuCode || '',
    orderQty: '',
    rate: c.sellingPrice ? String(c.sellingPrice) : '',
    asnCode: '',
    remark: '',
  })), [selectedPartyId]);

  // Index the catalog by skuId / skuCode so each row can surface its price history.
  const catalogIndex = useMemo(() => {
    const m = new Map();
    partyCatalog.forEach((c) => {
      if (c.skuId) m.set(String(c.skuId), c);
      if (c.skuCode) m.set(`code:${String(c.skuCode).toLowerCase()}`, c);
    });
    return m;
  }, [partyCatalog]);
  const rowCatalog = (it) => (
    catalogIndex.get(String(it.skuId))
    || catalogIndex.get(`code:${String(it.skuCode || '').toLowerCase()}`)
    || null
  );

  // Replace the line items with the party's saved catalog (blank quantities).
  const loadCatalog = useCallback(() => {
    if (!partyCatalog.length) return;
    setItems(catalogToItems(partyCatalog));
    setFilledPartyId(selectedPartyId);
    enqueueSnackbar(
      `Loaded ${partyCatalog.length} item${partyCatalog.length > 1 ? 's' : ''} from ${form.party?.name || 'party'}'s catalog`,
      { variant: 'success' },
    );
  }, [partyCatalog, catalogToItems, selectedPartyId, form.party, enqueueSnackbar]);

  // Reset on open — prefill from the order when editing, blank when creating.
  useEffect(() => {
    if (!open) return;
    if (isEditMode) {
      const partyId = order.partyId?._id || order.partyId;
      const resolvedParty =
        parties.find((p) => p._id === partyId) ||
        (partyId ? { _id: partyId, name: order.partyName || '', location: order.location || '' } : null);
      setForm({
        poNumber: order.poNumber || '',
        poDate: order.poDate ? dayjs(order.poDate).format('YYYY-MM-DD') : '',
        party: resolvedParty,
        place: order.place || order.location || '',
        orderDate: order.orderDate ? dayjs(order.orderDate).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
        transport: order.transport || 'Road',
        partyGroup: order.partyGroup || '',
        orderDocument: order.orderDocument || '',
        orderDocumentName: order.orderDocumentName || '',
        leadTimeDays: order.leadTimeDays || 7,
      });
      setItems(orderItemsToForm(order));
      setFilledPartyId(partyId); // editing: keep the saved order's items, never auto-fill
    } else if (intake) {
      // Punch-in form pre-filled from an Order Intake (client auto-selected, rough
      // items carried over). The user adds the PO number and confirms SKUs.
      const pid = intake.partyId?._id || intake.partyId;
      const resolvedParty =
        parties.find((p) => p._id === pid) ||
        (pid ? { _id: pid, name: intake.partyName || intake.partyId?.name || '', location: '' } : null);
      setForm({
        poNumber: '',
        poDate: dayjs().format('YYYY-MM-DD'),
        party: resolvedParty,
        place: resolvedParty?.location || '',
        orderDate: dayjs().format('YYYY-MM-DD'),
        transport: 'Road',
        partyGroup: '',
        orderDocument: '',
        orderDocumentName: '',
        leadTimeDays: resolvedParty?.leadTimeDays || 7,
      });
      const hasIntakeItems = (intake.items || []).length > 0;
      setItems(hasIntakeItems
        ? intake.items.map((it) => ({
            _tempId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            skuId: '', skuName: it.skuName || '', skuCode: it.skuCode || '',
            orderQty: it.qty || '', rate: '', asnCode: '', remark: '',
          }))
        : [emptyItem()]);
      // Carried-over intake items win; if none, let the party's catalog auto-fill.
      setFilledPartyId(hasIntakeItems ? (pid || 'intake') : null);
    } else {
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
      setFilledPartyId(null);
    }
    setFieldErrors({});
  }, [open, order, intake, isEditMode, parties]);

  const handlePartyChange = (_, party) => {
    setForm((prev) => ({
      ...prev,
      party,
      place: party?.location || '',
      leadTimeDays: party?.leadTimeDays || 7,
    }));
  };

  // Auto-fill the line items from the newly selected party's catalog — but only
  // while the rows are "pristine" (no quantity typed yet) so we never wipe work.
  // Switching party reloads the new catalog; once the user types a qty we back off.
  useEffect(() => {
    if (!open || isEditMode) return;
    const pid = selectedPartyId;
    if (!pid || !partyCatalog.length) return;
    if (filledPartyId === pid) return;                       // already filled for this party
    const pristine = items.every((it) => !(Number(it.orderQty) > 0));
    if (!pristine) return;                                   // user has started — don't clobber
    setItems(catalogToItems(partyCatalog));
    setFilledPartyId(pid);
  }, [open, isEditMode, selectedPartyId, partyCatalog, items, filledPartyId, catalogToItems]);

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
  const clearItems = () => { setItems([emptyItem()]); setFilledPartyId(null); };

  // SKU picker value/options for a row. A catalog row may reference a SKU that the
  // FINISHED_GOOD lookup hasn't loaded — surface a fallback option so its name
  // still shows (and the row stays selectable) instead of rendering blank.
  const rowSkuValue = (it) => (
    skus.find((s) => s._id === it.skuId)
    || (it.skuId && (it.skuName || it.skuCode) ? { _id: it.skuId, name: it.skuName, code: it.skuCode } : null)
  );
  const rowSkuOptions = (it) => (
    it.skuId && it.skuName && !skus.some((s) => s._id === it.skuId)
      ? [{ _id: it.skuId, name: it.skuName, code: it.skuCode }, ...skus]
      : skus
  );

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
        rate: '',
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
  const totalValue = validItems.reduce((s, i) => s + Number(i.orderQty || 0) * Number(i.rate || 0), 0);
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
      // On edit, keep _id + dispatchedQty per line so dispatch progress survives;
      // the backend pre-save hook recomputes balance/extra/totals.
      items: validItems.map(({ _tempId, _id, orderQty, dispatchedQty, rate, ...rest }) => ({
        ...rest,
        ...(isEditMode && _id ? { _id } : {}),
        ...(isEditMode ? { dispatchedQty: Number(dispatchedQty || 0) } : {}),
        orderQty: Number(orderQty),
        rate: Number(rate) || 0,
      })),
      // When punching in from an intake, link it so the FMS process is reused.
      ...(intake && !isEditMode ? { intakeId: intake._id } : {}),
    };

    try {
      if (isEditMode) {
        const res = await updateOrder({ id: order._id, ...payload }).unwrap();
        const so = res?.data?.soNumber || order.soNumber || 'order';
        enqueueSnackbar(`Sales Order ${so} updated`, { variant: 'success' });
        onClose?.();
      } else {
        const res = await createOrderEntry(payload).unwrap();
        const so = res?.data?.soNumber || 'order';
        enqueueSnackbar(`Sales Order ${so} created`, { variant: 'success' });
        onClose?.();
        // Jump the doer straight to the FMS task for this order so the step's
        // checklist is completed and the entry shows in the tracker.
        if (res?.data?.soNumber) await openFmsTask({ soNumber: res.data.soNumber });
      }
    } catch (err) {
      enqueueSnackbar(err?.data?.message || `Failed to ${isEditMode ? 'update' : 'create'} order`, { variant: 'error' });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      disableEnforceFocus
      fullScreen={fullScreen}
      maxWidth="lg"
      fullWidth
      scroll="paper"
      PaperProps={{
        sx: {
          width: '100%',
          maxWidth: 1160,
          height: fullScreen ? '100%' : '92vh',
          m: fullScreen ? 0 : 2,
          p: 0,
          borderRadius: fullScreen ? 0 : 3,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
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
              {isEditMode ? `Edit Sales Order · ${order.soNumber || ''}` : 'New Sales Order'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Sparkles size={11} /> {isEditMode ? 'Update PO, party & line items' : 'Auto SO # · Validation enforced'}
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
            {isEditMode ? 'Save Changes' : 'Submit Order'}
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
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
            <SectionLabel icon={Package}>Step 2 · Line Items {validItems.length > 0 && `(${validItems.length})`}</SectionLabel>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              {partyCatalog.length > 0 && (
                <Button
                  size="small"
                  variant={filledPartyId === selectedPartyId ? 'text' : 'outlined'}
                  startIcon={filledPartyId === selectedPartyId ? <RotateCw size={13} /> : <ListPlus size={14} />}
                  onClick={loadCatalog}
                >
                  {filledPartyId === selectedPartyId ? 'Reload catalog' : `Load catalog (${partyCatalog.length})`}
                </Button>
              )}
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

          {/* Party catalog banner — auto-fill state & hints */}
          {selectedPartyId && !isEditMode && (
            partyDetailLoading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, color: 'text.secondary', fontSize: '0.78rem' }}>
                <CircularProgress size={13} /> Loading {form.party?.name}&apos;s saved items…
              </Box>
            ) : partyCatalog.length > 0 ? (
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, px: 1.5, py: 1,
                borderRadius: '10px',
                bgcolor: alpha(theme.palette.primary.main, filledPartyId === selectedPartyId ? 0.06 : 0.03),
                border: `1px dashed ${alpha(theme.palette.primary.main, 0.25)}`,
              }}>
                <Sparkles size={15} color={theme.palette.primary.main} />
                <Typography variant="caption" color="text.primary" sx={{ flex: 1 }}>
                  {filledPartyId === selectedPartyId ? (
                    <><strong>{partyCatalog.length} items</strong> loaded from <strong>{form.party?.name}</strong>&apos;s catalog — just type each quantity. Add, edit or remove rows freely.</>
                  ) : (
                    <><strong>{form.party?.name}</strong> has <strong>{partyCatalog.length} saved items</strong>. Click <strong>Load catalog</strong> to fill the rows (keeps your typed quantities safe).</>
                  )}
                </Typography>
                {filledPartyId === selectedPartyId && (
                  <Button size="small" variant="text" color="inherit" startIcon={<Trash2 size={12} />} onClick={clearItems} sx={{ color: 'text.secondary' }}>
                    Clear
                  </Button>
                )}
              </Box>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.5, color: 'text.secondary', fontSize: '0.78rem' }}>
                <AlertCircle size={13} /> No saved catalog for {form.party?.name} yet — add items manually below.
              </Box>
            )
          )}

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
              // Hide the native number spin-buttons (they clutter Qty/Price) and keep
              // every field the same compact height so the row reads as one clean line.
              '& input[type=number]': { MozAppearance: 'textfield' },
              '& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
              '& .MuiOutlinedInput-root': { minHeight: 38 },
            }}
          >
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '2fr 0.8fr 0.85fr 1.2fr 1.25fr 44px' },
              gap: 1,
              px: 1.5, py: 1, bgcolor: alpha(theme.palette.primary.main, 0.04),
              borderBottom: '1px solid', borderColor: 'divider',
              fontSize: '0.7rem', fontWeight: 700,
              textTransform: 'uppercase', color: 'text.secondary', letterSpacing: '0.06em',
            }}>
              <Box>SKU</Box>
              <Box>Code</Box>
              <Box sx={{ textAlign: 'right' }}>Quantity *</Box>
              <Box sx={{ textAlign: 'right' }}>Price ₹</Box>
              <Box>Remark</Box>
              <Box />
            </Box>
            {items.map((it, idx) => {
              const cat = rowCatalog(it);
              const history = (cat?.priceHistory || []).slice().sort((a, b) => new Date(b.at) - new Date(a.at));
              return (
              <Box key={it._tempId} sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '2fr 0.8fr 0.85fr 1.2fr 1.25fr 44px' },
                gap: 1,
                px: 1.5, py: 1, alignItems: 'center',
                borderBottom: idx === items.length - 1 ? 0 : '1px solid',
                borderColor: 'divider',
                '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.02) },
              }}>
                <Autocomplete
                  options={rowSkuOptions(it)}
                  value={rowSkuValue(it)}
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
                  type="number"
                  size="small"
                  value={it.rate}
                  onChange={(e) => handleItemChange(idx, 'rate', e.target.value)}
                  inputProps={{ style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }}
                  placeholder="0"
                  InputProps={{
                    startAdornment: <InputAdornment position="start" sx={{ mr: 0.25 }}><IndianRupee size={12} /></InputAdornment>,
                    endAdornment: history.length > 0 ? (
                      <InputAdornment position="end">
                        <Tooltip arrow placement="top" title={(
                          <Box sx={{ py: 0.5 }}>
                            <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>Price history</Typography>
                            {history.slice(0, 6).map((h, hi) => (
                              <Typography key={hi} variant="caption" sx={{ display: 'block', opacity: hi === 0 ? 1 : 0.8 }}>
                                ₹{Number(h.price).toLocaleString('en-IN')} · {dayjs(h.at).format('DD MMM YY')}{h.soNumber ? ` · ${h.soNumber}` : ''}{hi === 0 ? '  (latest)' : ''}
                              </Typography>
                            ))}
                            {history.length > 6 && <Typography variant="caption" sx={{ opacity: 0.7 }}>+{history.length - 6} more…</Typography>}
                          </Box>
                        )}>
                          <Box component="span" sx={{ display: 'inline-flex', cursor: 'help', color: 'primary.main' }}>
                            <History size={13} />
                          </Box>
                        </Tooltip>
                      </InputAdornment>
                    ) : null,
                  }}
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
              );
            })}
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
          {totalValue > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Order Value</Typography>
              <Typography variant="h6" fontWeight={800} color="text.primary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                ₹{totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
              </Typography>
            </Box>
          )}
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
          {isEditMode ? 'Save Changes' : 'Submit Order'}
        </Button>
      </Box>
    </Dialog>
  );
};

export default OrderEntryDrawer;
