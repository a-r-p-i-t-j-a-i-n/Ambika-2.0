import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog, Box, Paper, Typography, Stack, Autocomplete, TextField, MenuItem,
  Button, Chip, alpha, useTheme, CircularProgress, Tooltip,
  LinearProgress, InputAdornment, DialogTitle, DialogContent, DialogActions,
  createFilterOptions,
} from '@mui/material';
import {
  X, Save, Hash, Calendar, Truck, Building2, Package,
  CheckCircle2, FileText, MapPin, Receipt, Info,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useSnackbar } from 'notistack';

import { useGetOrdersQuery } from '../../store/api/orderApi';
import { useGetSkuLookupQuery } from '../../store/api/skuApi';
import { useCreateActualDispatchMutation } from '../../store/api/dispatchControlApi';
import { useReturnToTask } from '../o2d-fms/useReturnToTask';
import { useFmsGate, FmsGateDialog, FmsGateBanner } from '../o2d-fms/FmsGate';
import { useGetTransportersQuery, useCreateTransporterMutation } from '../../store/api/transporterApi';

const TRANSPORT_MODES = ['Road', 'Rail', 'Air', 'Sea', 'Courier'];
const DC_THROUGH = ['Freight Paid', 'To Pay', 'Party Vehicle'];

// Lets the Transporter picker offer "Add «typed name»" when no master match exists.
const transporterFilter = createFilterOptions();

const SectionLabel = ({ icon: Icon, children, hint }) => {
  const theme = useTheme();
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
      <Box sx={{
        width: 24, height: 24, borderRadius: '8px', display: 'grid', placeItems: 'center',
        bgcolor: alpha(theme.palette.primary.main, 0.10), color: 'primary.main',
      }}>
        <Icon size={13} strokeWidth={2.5} />
      </Box>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {children}
      </Typography>
      {hint && <Typography variant="caption" color="text.secondary">· {hint}</Typography>}
    </Stack>
  );
};

const n = (v) => Number(v || 0);
const fmt = (v) => n(v).toLocaleString('en-IN');
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const fmtKg = (v) => round2(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Boxes and weight auto-fill from the item (SKU) master, exactly as the server
// computes them: boxes = ⌈pcs ÷ pcs-per-box⌉, and weight is proportional to the
// pcs shipped — e.g. a 105-pcs box weighing 35.80 kg gives ~17.90 kg for 52 pcs.
const autoBoxes = (qty, pcsPerBox) => (Number(pcsPerBox) > 0 ? Math.ceil(n(qty) / Number(pcsPerBox)) : 0);
const autoWeight = (qty, { pcsPerBox, weightPerBox, weightPerPc } = {}) => {
  if (Number(weightPerBox) > 0 && Number(pcsPerBox) > 0) return round2((n(qty) / Number(pcsPerBox)) * Number(weightPerBox));
  if (Number(weightPerPc) > 0) return round2(n(qty) * Number(weightPerPc));
  return 0;
};
// Resolve a line/order-item's packing (pcs-per-box, weight-per-box) from the SKU map.
const packFrom = (packMap, it) =>
  packMap?.get(String(it.skuId)) || packMap?.get(`code:${String(it.skuCode || '').toUpperCase()}`) || {};

// Build the dispatch lines straight from the SALES ORDER's items — the operator
// no longer thinks about plan phases (the server auto-allocates the qty across
// them earliest-first). Each line shows Ordered / Already / Balance, defaults the
// "Now" qty to the remaining balance, and auto-fills Boxes + Weight from the SKU
// master (both stay fully editable).
const linesFromOrder = (order, packMap) => (order?.items || []).map((it) => {
  const ordered = n(it.orderQty ?? it.qty);
  const already = n(it.dispatchedQty);
  const balance = it.balanceQty != null ? n(it.balanceQty) : Math.max(0, ordered - already);
  const pack = packFrom(packMap, it);
  const ppb = Number(pack.pcsPerBox) || Number(it.pcsPerBox) || 0;
  const wpb = Number(pack.weightPerBox) || 0;
  const wpp = Number(pack.weightPerPc) || 0;
  return {
    orderItemId: it._id,
    skuId: it.skuId,
    skuCode: it.skuCode,
    skuName: it.skuName,
    orderedQty: ordered,
    alreadyQty: already,
    balanceQty: balance,
    quantityPcs: balance, // default the "Now" qty to the remaining balance
    pcsPerBox: ppb || '',
    weightPerBox: wpb,
    weightPerPc: wpp,
    noOfBoxes: autoBoxes(balance, ppb),
    weightKg: autoWeight(balance, { pcsPerBox: ppb, weightPerBox: wpb, weightPerPc: wpp }),
    boxesTouched: false,
    weightTouched: false,
  };
});

const DispatchEntry = ({ open, onClose, presetOrder = null, presetSoNumber = null }) => {
  const theme = useTheme();
  const { enqueueSnackbar } = useSnackbar();

  const { data: ordersRes, isLoading: ordersLoading } = useGetOrdersQuery(
    { limit: 250, sort: '-orderDate', status: 'PLANNING,IN_PROGRESS,RECEIVED' },
    { skip: !open },
  );
  const orders = useMemo(() => ordersRes?.data || [], [ordersRes]);

  // Item (SKU) master packing → auto-fill Boxes + Weight per line. The lookup
  // endpoint returns pcsPerBox / weightPerBox / weightPerPc for every SKU.
  const { data: skuLookupRes } = useGetSkuLookupQuery({ limit: 2000 }, { skip: !open });
  const skuPacking = useMemo(() => {
    const m = new Map();
    (skuLookupRes?.data || []).forEach((s) => {
      const pack = { pcsPerBox: Number(s.pcsPerBox) || 0, weightPerBox: Number(s.weightPerBox) || 0, weightPerPc: Number(s.weightPerPc) || 0 };
      if (s._id) m.set(String(s._id), pack);
      if (s.code) m.set(`code:${String(s.code).toUpperCase()}`, pack);
    });
    return m;
  }, [skuLookupRes]);

  const [step1Order, setStep1Order] = useState(presetOrder || null);
  const [header, setHeader] = useState(null); // set on open
  const [lines, setLines] = useState([]);
  // Guards line-building so it runs at most once per (order, packing-ready) state —
  // makes the build idempotent so it can never enter an update loop even if the SKU
  // lookup result reference churns.
  const linesKeyRef = useRef(null);

  const soNumber = step1Order?.soNumber;
  // Sequential gate — block recording a dispatch until the prior FMS steps are done.
  const gate = useFmsGate({ soNumber, action: 'ACTUAL_DISPATCH' });
  const [gateOpen, setGateOpen] = useState(false);

  const [createActualDispatch, { isLoading: isSaving }] = useCreateActualDispatchMutation();
  // Returns to the FMS task (entryDone + the connected action marked done) when
  // this modal was opened via a task's "Do it now"; falls back to the order's
  // active task otherwise.
  const { finishToTask } = useReturnToTask();

  // Transporter master — pick an existing transporter or add a new one inline.
  const { data: transRes, isFetching: transLoading } = useGetTransportersQuery({ limit: 500, sort: 'name', isActive: true }, { skip: !open });
  const transporters = useMemo(() => transRes?.data || [], [transRes]);
  const [createTransporter, { isLoading: creatingTransporter }] = useCreateTransporterMutation();
  const [newTransporter, setNewTransporter] = useState(null);

  const freshHeader = () => ({
    dcDate: dayjs().format('YYYY-MM-DD'),
    vehicleNo: '', transportMode: 'Road', transporterName: '', clientEmail: '',
    invoiceNo: '', dispatchedThrough: 'Freight Paid', deliveryAddress: '', remark: '',
  });

  // Reset whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    linesKeyRef.current = null;
    setStep1Order(presetOrder || null);
    setHeader(freshHeader());
    setLines([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetOrder]);

  // Came from an FMS "Do it now" with ?so=… → auto-select that order once the
  // (status-filtered) order list has loaded, so the doer starts straight at loadout.
  useEffect(() => {
    if (!open || !presetSoNumber || step1Order || !orders.length) return;
    const match = orders.find((o) => o.soNumber === presetSoNumber);
    if (match) setStep1Order(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetSoNumber, orders]);

  // When the order changes, force a one-time rebuild for it.
  const pickOrder = (order) => {
    linesKeyRef.current = null;
    setStep1Order(order || null);
    if (!order) setLines([]);
  };

  // Build the SKU lines — and, once packing loads, back-fill Boxes/Weight — exactly
  // ONCE per (order, packing-ready) state. The ref guard makes this idempotent, so
  // it can never loop; any qty / hand-edited Boxes/Weight are preserved across the
  // single packing back-fill.
  useEffect(() => {
    if (!open || !step1Order) return;
    const key = `${step1Order._id}|${skuPacking.size ? 1 : 0}`;
    if (linesKeyRef.current === key) return;
    linesKeyRef.current = key;
    setLines((prev) => {
      const built = linesFromOrder(step1Order, skuPacking);
      if (!prev.length) return built;
      const prevByCode = new Map(prev.map((l) => [l.skuCode, l]));
      return built.map((b) => {
        const old = prevByCode.get(b.skuCode);
        if (!old) return b;
        return {
          ...b,
          quantityPcs: old.quantityPcs,
          boxesTouched: old.boxesTouched,
          weightTouched: old.weightTouched,
          noOfBoxes: old.boxesTouched ? old.noOfBoxes : b.noOfBoxes,
          weightKg: old.weightTouched ? old.weightKg : b.weightKg,
        };
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step1Order, skuPacking]);

  const updateLine = (idx, patch) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  // Changing "Now" qty re-derives Boxes + Weight (unless the user has hand-edited
  // them, which is tracked per-field and reset on a fresh qty).
  const setQty = (idx, val) => setLines((prev) => prev.map((l, i) => {
    if (i !== idx) return l;
    const ppb = Number(l.pcsPerBox) || 0;
    return {
      ...l,
      quantityPcs: val,
      boxesTouched: false,
      weightTouched: false,
      noOfBoxes: autoBoxes(n(val), ppb),
      weightKg: autoWeight(n(val), { pcsPerBox: ppb, weightPerBox: l.weightPerBox, weightPerPc: l.weightPerPc }),
    };
  }));

  const totalDispatching = useMemo(() => lines.reduce((s, l) => s + n(l.quantityPcs), 0), [lines]);
  const totalBoxes = useMemo(() => lines.reduce((s, l) => s + (n(l.quantityPcs) > 0 ? n(l.noOfBoxes) : 0), 0), [lines]);
  const totalWeight = useMemo(() => round2(lines.reduce((s, l) => s + (n(l.quantityPcs) > 0 ? n(l.weightKg) : 0), 0)), [lines]);
  const skuCount = lines.filter((l) => n(l.quantityPcs) > 0).length;
  const isStep1Valid = Boolean(step1Order);
  const hasAnyQty = skuCount > 0;
  // The FMS lock only applies once an order is actually chosen — never show the
  // "finish the previous step" banner on an empty form.
  const blocked = isStep1Valid && gate.blocked;
  const canSubmit = isStep1Valid && hasAnyQty && !isSaving && !blocked;
  const progress = (isStep1Valid ? 50 : 0) + (hasAnyQty ? 50 : 0);

  const handleSubmit = async () => {
    if (blocked) { setGateOpen(true); return; }
    if (!canSubmit) return;
    const items = lines
      .filter((l) => n(l.quantityPcs) > 0)
      .map((l) => ({
        orderItemId: l.orderItemId,
        skuCode: l.skuCode,
        skuName: l.skuName,
        quantityPcs: n(l.quantityPcs),
        ...(l.pcsPerBox ? { pcsPerBox: n(l.pcsPerBox) } : {}),
        ...(l.noOfBoxes !== '' && l.noOfBoxes != null ? { noOfBoxes: n(l.noOfBoxes) } : {}),
        ...(l.weightKg !== '' && l.weightKg != null ? { weightKg: n(l.weightKg) } : {}),
      }));

    // No phaseRefs — the server auto-allocates across the plan phases earliest-first.
    const payload = { soNumber: step1Order.soNumber, dcDate: new Date(header.dcDate), ...header, items };

    try {
      const res = await createActualDispatch(payload).unwrap();
      const dcNumber = res?.data?.challan?.dcNumber || 'DC';
      enqueueSnackbar(`${dcNumber} created — plan vs actual updated`, { variant: 'success' });
      onClose?.();
      if (step1Order?.soNumber) await finishToTask({ soNumber: step1Order.soNumber, action: 'ACTUAL_DISPATCH' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not record dispatch', { variant: 'error' });
    }
  };

  const saveNewTransporter = async () => {
    const name = (newTransporter?.name || '').trim();
    if (!name) { enqueueSnackbar('Transporter name is required.', { variant: 'warning' }); return; }
    try {
      const res = await createTransporter({
        name,
        contactPerson: newTransporter.contactPerson?.trim() || undefined,
        phone: newTransporter.phone?.trim() || undefined,
        email: newTransporter.email?.trim() || undefined,
        city: newTransporter.city?.trim() || undefined,
        gstNo: newTransporter.gstNo?.trim() || undefined,
      }).unwrap();
      const created = res?.data || res;
      setHeader((p) => ({ ...p, transporterName: created?.name || name }));
      setNewTransporter(null);
      enqueueSnackbar(`Transporter "${created?.name || name}" added to master.`, { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not add transporter.', { variant: 'error' });
    }
  };

  if (!header) return null;

  const GRID = { xs: '1.7fr 0.7fr 0.75fr 0.7fr 0.85fr 0.75fr 0.95fr', };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      scroll="paper"
      disableEnforceFocus
      PaperProps={{ sx: {
        borderRadius: { xs: 0, sm: 3 }, m: { xs: 0, sm: 2 },
        height: { xs: '100%', sm: '92vh' }, maxHeight: { xs: '100%', sm: '92vh' },
        display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden',
      } }}
    >
      {/* Header */}
      <Box sx={{
        bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider',
        px: { xs: 2, sm: 3 }, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
      }}>
        <Stack direction="row" spacing={1.5} alignItems="center" minWidth={0}>
          <Box sx={{
            width: 38, height: 38, borderRadius: '12px', display: 'grid', placeItems: 'center',
            background: `linear-gradient(135deg, ${theme.palette.success.light}, ${theme.palette.success.dark})`, color: 'common.white',
          }}>
            <Truck size={18} />
          </Box>
          <Box minWidth={0}>
            <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.1 }}>Record Actual Dispatch</Typography>
            <Typography variant="caption" color="text.secondary">Pick the order, enter what's going · DC# auto-generated</Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose} variant="outlined" startIcon={<X size={14} />} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>Cancel</Button>
          <Button onClick={handleSubmit} variant="contained" disabled={!canSubmit}
            startIcon={isSaving ? <CircularProgress size={14} color="inherit" /> : <Save size={14} />}>
            Submit Dispatch
          </Button>
        </Stack>
      </Box>
      <LinearProgress variant="determinate" value={progress} sx={{ height: 3 }} />

      {/* Scrollable body */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: { xs: 1.5, sm: 3 }, py: 2.5 }}>
        {blocked && <FmsGateBanner gate={gate.gate} onOpen={() => setGateOpen(true)} />}

        {/* Step 1 — Order */}
        <Paper sx={{ p: 2.5, borderRadius: '14px', mb: 2 }}>
          <SectionLabel icon={Building2} hint="Only orders with open plans are listed">Step 1 · Sales Order</SectionLabel>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <Autocomplete
              options={orders}
              value={step1Order}
              onChange={(_, val) => pickOrder(val)}
              loading={ordersLoading}
              getOptionLabel={(o) => (o ? `${o.soNumber} — ${o.partyName || ''}` : '')}
              isOptionEqualToValue={(a, b) => a._id === b?._id}
              sx={{ flex: 1, minWidth: 0 }}
              renderInput={(p) => <TextField {...p} placeholder="Search SO or party..." />}
              renderOption={(props, opt) => (
                <li {...props} key={opt._id}>
                  <Box>
                    <Typography variant="body2" fontWeight={700}>{opt.soNumber}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {opt.partyName} · Bal {fmt(opt.totalBalanceQty)}
                    </Typography>
                  </Box>
                </li>
              )}
            />
            {step1Order && (
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip size="small" label={`PO ${step1Order.poNumber}`} sx={{ fontWeight: 700 }} />
                <Chip size="small" label={`Bal ${fmt(step1Order.totalBalanceQty)}`} color="warning" variant="outlined" />
              </Stack>
            )}
          </Stack>
        </Paper>

        {/* Step 2 — Loadout (header + SKU table) */}
        <Paper sx={{ p: 2.5, borderRadius: '14px', mb: 2, opacity: isStep1Valid ? 1 : 0.55, pointerEvents: isStep1Valid ? 'auto' : 'none' }}>
          <SectionLabel icon={Receipt}>Step 2 · Loadout details</SectionLabel>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5, mb: 2 }}>
            <TextField label="DC Date *" type="date" value={header.dcDate}
              onChange={(e) => setHeader((p) => ({ ...p, dcDate: e.target.value }))} InputLabelProps={{ shrink: true }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Calendar size={13} /></InputAdornment> }} />
            <TextField label="Vehicle No" value={header.vehicleNo}
              onChange={(e) => setHeader((p) => ({ ...p, vehicleNo: e.target.value.toUpperCase() }))} placeholder="MH-12-AB-1234" />
            <TextField select label="Transport mode" value={header.transportMode} onChange={(e) => setHeader((p) => ({ ...p, transportMode: e.target.value }))}>
              {TRANSPORT_MODES.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
            </TextField>
            <Autocomplete
              freeSolo selectOnFocus handleHomeEndKeys loading={transLoading} options={transporters}
              value={header.transporterName}
              getOptionLabel={(o) => (typeof o === 'string' ? o : (o.addLabel || o.name || ''))}
              isOptionEqualToValue={(o, v) => (o?.name || o) === (v?.name || v)}
              filterOptions={(opts, params) => {
                const filtered = transporterFilter(opts, params);
                const typed = params.inputValue.trim();
                const exists = opts.some((o) => (o.name || '').toLowerCase() === typed.toLowerCase());
                if (typed && !exists) filtered.push({ addNew: true, name: typed, addLabel: `+ Add "${typed}" as a new transporter` });
                else if (!typed) filtered.push({ addNew: true, name: '', addLabel: '+ Add a new transporter' });
                return filtered;
              }}
              onChange={(_, val) => {
                if (val && typeof val === 'object' && val.addNew) {
                  setNewTransporter({ name: val.name, contactPerson: '', phone: '', email: '', city: '', gstNo: '' });
                  return;
                }
                const t = typeof val === 'string' ? null : val;
                setHeader((p) => ({ ...p, transporterName: typeof val === 'string' ? val : (val?.name || ''), transportMode: t?.modes?.[0] || p.transportMode }));
              }}
              onInputChange={(_, v, reason) => { if (reason === 'input') setHeader((p) => ({ ...p, transporterName: v })); }}
              renderOption={(props, option) => (
                <li {...props} key={option._id || option.addLabel || option.name}>
                  {option.addNew ? (
                    <Typography sx={{ fontWeight: 700, color: 'primary.main' }}>{option.addLabel}</Typography>
                  ) : (
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{option.name}</Typography>
                      {(option.city || option.phone) && (
                        <Typography variant="caption" color="text.secondary">{[option.city, option.phone].filter(Boolean).join(' · ')}</Typography>
                      )}
                    </Box>
                  )}
                </li>
              )}
              renderInput={(params) => (
                <TextField {...params} label="Transporter" placeholder="Select or add…"
                  helperText="Not listed? Type the name or pick “+ Add a new transporter”."
                  InputProps={{ ...params.InputProps, startAdornment: <InputAdornment position="start"><Truck size={13} /></InputAdornment> }} />
              )}
            />
            <TextField label="Invoice / LR" value={header.invoiceNo} onChange={(e) => setHeader((p) => ({ ...p, invoiceNo: e.target.value }))}
              InputProps={{ startAdornment: <InputAdornment position="start"><Hash size={13} /></InputAdornment> }} />
            <TextField select label="Freight terms" value={header.dispatchedThrough} onChange={(e) => setHeader((p) => ({ ...p, dispatchedThrough: e.target.value }))}>
              {DC_THROUGH.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
            <TextField label="Client email (notify)" value={header.clientEmail} onChange={(e) => setHeader((p) => ({ ...p, clientEmail: e.target.value }))} />
            <TextField label="Delivery address" value={header.deliveryAddress} onChange={(e) => setHeader((p) => ({ ...p, deliveryAddress: e.target.value }))}
              sx={{ gridColumn: { xs: 'auto', sm: 'span 2' } }}
              InputProps={{ startAdornment: <InputAdornment position="start"><MapPin size={13} /></InputAdornment> }} />
          </Box>

          {/* SKU loadout — plain: what's ordered, what's already gone, what's going now */}
          <SectionLabel icon={Package} hint="Enter what's going out now — the plan updates automatically">Items</SectionLabel>
          <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '12px', overflow: 'hidden', bgcolor: 'background.paper' }}>
            <Box sx={{
              display: { xs: 'none', sm: 'grid' }, gridTemplateColumns: GRID, px: 1.25, py: 1,
              bgcolor: alpha(theme.palette.primary.main, 0.04), borderBottom: '1px solid', borderColor: 'divider',
              fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              <Box>SKU</Box>
              <HeadCell hint="Total quantity on this sales order.">Ordered</HeadCell>
              <HeadCell hint="Quantity already dispatched against this order in earlier deliveries.">Dispatched</HeadCell>
              <HeadCell hint="Still to dispatch — Ordered minus Dispatched.">Balance</HeadCell>
              <HeadCell hint="Quantity going out in this delivery. The plan phases update automatically — you don't pick a phase.">Now *</HeadCell>
              <HeadCell hint="Auto-filled from the item master (pcs per box). Editable.">Boxes</HeadCell>
              <HeadCell hint="Auto-filled from the item master — proportional to the pcs shipped (kg per box ÷ pcs per box). Editable.">Weight (kg)</HeadCell>
            </Box>
            {lines.length === 0 ? (
              <Box sx={{ p: 2.5, textAlign: 'center', color: 'text.secondary' }}>
                <Typography variant="body2">Select an order to load its items.</Typography>
              </Box>
            ) : lines.map((l, idx) => {
              const done = l.balanceQty <= 0;
              const over = n(l.quantityPcs) > l.balanceQty;
              return (
                <Box key={l.skuCode + idx} sx={{
                  display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: GRID.xs },
                  px: 1.25, py: 1, alignItems: 'center', gap: 1,
                  borderBottom: idx === lines.length - 1 ? 0 : '1px solid', borderColor: 'divider',
                }}>
                  <Box sx={{ minWidth: 0, gridColumn: { xs: '1 / -1', sm: 'auto' } }}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Typography variant="body2" fontWeight={700} noWrap>{l.skuName}</Typography>
                      {done && <Chip size="small" label="Done" color="success" variant="outlined" sx={{ height: 18, fontSize: '0.6rem' }} icon={<CheckCircle2 size={10} />} />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {l.skuCode}
                      {l.pcsPerBox ? ` · ${fmt(l.pcsPerBox)}/box` : ''}
                      {l.weightPerBox ? ` · ${fmtKg(l.weightPerBox)} kg/box` : ''}
                    </Typography>
                  </Box>
                  <LabeledNum label="Ordered" value={fmt(l.orderedQty)} />
                  <LabeledNum label="Dispatched" value={fmt(l.alreadyQty)} color={l.alreadyQty ? 'success.main' : 'text.secondary'} />
                  <LabeledNum label="Balance" value={fmt(l.balanceQty)} strong />
                  <TextField size="small" type="number" label="" value={l.quantityPcs}
                    onChange={(e) => setQty(idx, e.target.value)}
                    inputProps={{ style: { textAlign: 'right', fontWeight: 800 }, min: 0 }} error={over}
                    helperText={over ? 'over balance' : ''} sx={{ '& .MuiFormHelperText-root': { m: 0, fontSize: '0.6rem' } }} />
                  <TextField size="small" type="number" value={l.noOfBoxes}
                    onChange={(e) => updateLine(idx, { noOfBoxes: e.target.value, boxesTouched: true })}
                    inputProps={{ style: { textAlign: 'right' }, min: 0 }} placeholder="Boxes" />
                  <TextField size="small" type="number" value={l.weightKg}
                    onChange={(e) => updateLine(idx, { weightKg: e.target.value, weightTouched: true })}
                    inputProps={{ style: { textAlign: 'right' }, min: 0, step: 'any' }} placeholder="Weight" />
                </Box>
              );
            })}
          </Box>

          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="caption" color="text.secondary">{skuCount} SKU{skuCount === 1 ? '' : 's'} in this dispatch</Typography>
            <Typography variant="body2" sx={{ fontWeight: 800 }}>
              Total: <span style={{ color: theme.palette.primary.main }}>{fmt(totalDispatching)}</span> pcs
              &nbsp;·&nbsp; <span style={{ color: theme.palette.primary.main }}>{fmt(totalBoxes)}</span> boxes
              &nbsp;·&nbsp; <span style={{ color: theme.palette.primary.main }}>{fmtKg(totalWeight)}</span> kg
            </Typography>
          </Box>
        </Paper>

        {/* Step 3 — Notes */}
        <Paper sx={{ p: 2.5, borderRadius: '14px', opacity: isStep1Valid ? 1 : 0.55 }}>
          <SectionLabel icon={FileText}>Step 3 · Notes (optional)</SectionLabel>
          <TextField multiline minRows={2} placeholder="Free-form notes for ops / accounts"
            value={header.remark} onChange={(e) => setHeader((p) => ({ ...p, remark: e.target.value }))} fullWidth />
        </Paper>
      </Box>

      {/* Footer */}
      <Box sx={{
        bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider',
        px: { xs: 2, sm: 3 }, py: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1,
      }}>
        <Stack direction="row" spacing={{ xs: 1.75, sm: 2.5 }}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Total Qty</Typography>
            <Typography variant="h6" fontWeight={800} color="primary.main">{fmt(totalDispatching)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Boxes</Typography>
            <Typography variant="h6" fontWeight={800}>{fmt(totalBoxes)}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Weight</Typography>
            <Typography variant="h6" fontWeight={800}>{fmtKg(totalWeight)}<Typography component="span" variant="caption" sx={{ ml: 0.25 }}>kg</Typography></Typography>
          </Box>
          <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>SKUs</Typography>
            <Typography variant="h6" fontWeight={800}>{skuCount}</Typography>
          </Box>
        </Stack>
        <Button variant="contained" onClick={handleSubmit} disabled={!canSubmit}
          startIcon={isSaving ? <CircularProgress size={14} color="inherit" /> : <Save size={14} />}>
          Submit Dispatch
        </Button>
      </Box>

      {/* Inline "Add transporter" — saves straight into the Transporter master. */}
      <Dialog open={!!newTransporter} onClose={() => !creatingTransporter && setNewTransporter(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Add transporter to master</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.75} sx={{ mt: 0.5 }}>
            <TextField label="Transporter name *" size="small" autoFocus value={newTransporter?.name || ''}
              onChange={(e) => setNewTransporter((p) => ({ ...p, name: e.target.value }))} />
            <Stack direction="row" spacing={1.5}>
              <TextField label="Contact person" size="small" fullWidth value={newTransporter?.contactPerson || ''}
                onChange={(e) => setNewTransporter((p) => ({ ...p, contactPerson: e.target.value }))} />
              <TextField label="Phone" size="small" fullWidth value={newTransporter?.phone || ''}
                onChange={(e) => setNewTransporter((p) => ({ ...p, phone: e.target.value }))} />
            </Stack>
            <TextField label="Email" size="small" fullWidth value={newTransporter?.email || ''}
              onChange={(e) => setNewTransporter((p) => ({ ...p, email: e.target.value }))} />
            <Stack direction="row" spacing={1.5}>
              <TextField label="City" size="small" fullWidth value={newTransporter?.city || ''}
                onChange={(e) => setNewTransporter((p) => ({ ...p, city: e.target.value }))} />
              <TextField label="GST No." size="small" fullWidth value={newTransporter?.gstNo || ''}
                onChange={(e) => setNewTransporter((p) => ({ ...p, gstNo: e.target.value.toUpperCase() }))} />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNewTransporter(null)} disabled={creatingTransporter}>Cancel</Button>
          <Button variant="contained" onClick={saveNewTransporter} disabled={creatingTransporter || !newTransporter?.name?.trim()}
            startIcon={creatingTransporter ? <CircularProgress size={14} color="inherit" /> : <Save size={14} />}>
            {creatingTransporter ? 'Saving…' : 'Save & select'}
          </Button>
        </DialogActions>
      </Dialog>

      <FmsGateDialog gate={gate.gate} open={gateOpen} onClose={() => setGateOpen(false)} />
    </Dialog>
  );
};

// Column header with an info (ⓘ) tooltip explaining the column, so terms like
// "Dispatched" / "Balance" are unambiguous on hover / tap.
const HeadCell = ({ children, hint }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.4 }}>
    <span>{children}</span>
    {hint && (
      <Tooltip title={hint} arrow enterTouchDelay={0} leaveTouchDelay={4000}>
        <Box component="span" sx={{ display: 'inline-flex', color: 'text.disabled', cursor: 'help', '&:hover': { color: 'primary.main' } }}>
          <Info size={12} />
        </Box>
      </Tooltip>
    )}
  </Box>
);

// Compact read-only figure with a tiny inline label (label shows on mobile where
// the column header is hidden).
const LabeledNum = ({ label, value, color = 'text.primary', strong }) => (
  <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
    <Typography component="span" sx={{ display: { xs: 'inline', sm: 'none' }, fontSize: '0.6rem', color: 'text.secondary', mr: 0.5, textTransform: 'uppercase' }}>{label}:</Typography>
    <Typography component="span" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: strong ? 800 : 600, color }}>{value}</Typography>
  </Box>
);

export default DispatchEntry;
