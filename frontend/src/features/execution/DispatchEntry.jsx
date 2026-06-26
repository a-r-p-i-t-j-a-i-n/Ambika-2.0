import React, { useEffect, useMemo, useState } from 'react';
import {
  Drawer, Box, Paper, Typography, Stack, Autocomplete, TextField, MenuItem,
  Button, IconButton, Chip, Tooltip, Divider, alpha, useTheme, CircularProgress,
  LinearProgress, InputAdornment, Dialog, DialogTitle, DialogContent, DialogActions,
  createFilterOptions,
} from '@mui/material';
import {
  X, Save, Hash, Calendar, Truck, Building2, Layers,
  CheckCircle2, AlertTriangle, FileText, MapPin, Receipt,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useSnackbar } from 'notistack';

import { useGetOrdersQuery } from '../../store/api/orderApi';
import {
  useCreateActualDispatchMutation,
  useGetDispatchablePhasesQuery,
} from '../../store/api/dispatchControlApi';
import PhasePicker from './components/PhasePicker';
import { useReturnToTask } from '../o2d-fms/useReturnToTask';
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

// Variance is against the *effective* plan (planner's qty + carry-forward from
// earlier phases). That is the truth the dispatch desk should compare against.
const VarianceChip = ({ effective, dispatching }) => {
  const theme = useTheme();
  const diff = Number(dispatching || 0) - Number(effective || 0);
  if (!effective && !dispatching) return null;
  if (diff === 0 && effective > 0) {
    return <Chip size="small" color="success" label="On plan" icon={<CheckCircle2 size={11} />} sx={{ height: 20, fontSize: '0.65rem' }} />;
  }
  if (diff > 0) {
    return <Chip size="small" sx={{ height: 20, fontSize: '0.65rem', bgcolor: alpha(theme.palette.warning.main, 0.10), color: 'warning.main' }} icon={<AlertTriangle size={11} />} label={`+${diff.toLocaleString('en-IN')} over`} />;
  }
  return <Chip size="small" sx={{ height: 20, fontSize: '0.65rem', bgcolor: alpha(theme.palette.error.main, 0.10), color: 'error.main' }} icon={<AlertTriangle size={11} />} label={`${Math.abs(diff).toLocaleString('en-IN')} short → next phase`} />;
};

// Mirror the SERVER's earliest-first allocation so the operator SEES, before
// submitting, exactly how the qty they typed will land on each plan phase —
// how much fills it, how much carries forward, and whether it's late.
const computeAllocation = (line, phaseSels, dcDate) => {
  const sku = line.skuCode || line.skuName;
  const targets = (phaseSels || [])
    .filter((p) => p?.kind !== 'unplanned')
    .map((ph) => {
      const s = (ph.skus || []).find((x) => (x.skuCode || x.skuName) === sku);
      return s ? { phaseNo: ph.phaseNo, plannedDate: ph.plannedDate, pending: Math.max(0, Number(s.pendingQty || 0)) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.plannedDate || 0) - new Date(b.plannedDate || 0));
  if (!targets.length) return [];

  const dc = dcDate ? dayjs(dcDate).startOf('day') : dayjs().startOf('day');
  let remaining = Number(line.quantityPcs || 0);
  return targets.map((t, i) => {
    const isLast = i === targets.length - 1;
    const give = remaining <= 0 ? 0 : (isLast ? remaining : Math.max(0, Math.min(remaining, t.pending)));
    remaining -= give;
    const shortfall = Math.max(0, t.pending - give);        // carries to the next phase
    const over = isLast ? Math.max(0, give - t.pending) : 0; // surplus on the last phase
    const late = Boolean(t.plannedDate) && dc.isAfter(dayjs(t.plannedDate).startOf('day'));
    const lateDays = late ? dc.diff(dayjs(t.plannedDate).startOf('day'), 'day') : 0;
    return { ...t, give, shortfall, over, late, lateDays };
  });
};

// Plain-words preview row shown directly under a SKU line.
const AllocationPreview = ({ alloc }) => {
  const theme = useTheme();
  if (!alloc.length) return null;
  return (
    <Box sx={{ px: 1.25, pb: 1, pt: 0.25, display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
      <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: '0.05em', mr: 0.25 }}>
        Lands on →
      </Typography>
      {alloc.map((a) => (
        <Box key={a.phaseNo} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.6, px: 0.85, py: 0.3, borderRadius: '8px',
          border: '1px solid', borderColor: a.give > 0 ? alpha(theme.palette.primary.main, 0.25) : 'divider',
          bgcolor: a.give > 0 ? alpha(theme.palette.primary.main, 0.05) : 'transparent',
        }}>
          <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, color: 'primary.main' }}>{a.phaseNo}</Typography>
          {a.plannedDate && (
            <Typography sx={{ fontSize: '0.62rem', color: 'text.secondary' }}>{dayjs(a.plannedDate).format('DD MMM')}</Typography>
          )}
          <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {Number(a.give).toLocaleString('en-IN')}/{Number(a.pending).toLocaleString('en-IN')}
          </Typography>
          {a.shortfall > 0 && (
            <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: 'error.main' }}>
              · {Number(a.shortfall).toLocaleString('en-IN')} carries →
            </Typography>
          )}
          {a.over > 0 && (
            <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: 'warning.main' }}>
              · +{Number(a.over).toLocaleString('en-IN')} over
            </Typography>
          )}
          {a.late && (
            <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, color: 'error.main' }}>· {a.lateDays}d late</Typography>
          )}
        </Box>
      ))}
    </Box>
  );
};

const DispatchEntry = ({ open, onClose, presetOrder = null, presetSoNumber = null }) => {
  const theme = useTheme();
  const { enqueueSnackbar } = useSnackbar();

  const { data: ordersRes, isLoading: ordersLoading } = useGetOrdersQuery(
    { limit: 250, sort: '-orderDate', status: 'PLANNING,IN_PROGRESS,RECEIVED' },
    { skip: !open },
  );
  const orders = useMemo(() => ordersRes?.data || [], [ordersRes]);

  const [step1Order, setStep1Order] = useState(presetOrder || null);
  // Multiple plan phases can be fulfilled by one DC; the entered qty per SKU is
  // allocated across them (earliest-first) on the server.
  const [phaseSels, setPhaseSels] = useState([]);
  const isUnplanned = phaseSels.some((p) => p?.kind === 'unplanned');
  const [header, setHeader] = useState({
    dcDate: dayjs().format('YYYY-MM-DD'),
    vehicleNo: '',
    transportMode: 'Road',
    transporterName: '',
    clientEmail: '',
    invoiceNo: '',
    dispatchedThrough: 'Freight Paid',
    deliveryAddress: '',
    remark: '',
  });
  // Per-SKU lines: derived from selected phase when picked.
  const [lines, setLines] = useState([]);

  const soNumber = step1Order?.soNumber;
  const { data: dispatchablePhasesRes, isFetching: phasesFetching } = useGetDispatchablePhasesQuery(soNumber, { skip: !soNumber });
  const phasesData = dispatchablePhasesRes?.data;

  const [createActualDispatch, { isLoading: isSaving }] = useCreateActualDispatchMutation();
  // Returns to the FMS task (entryDone + the connected action marked done) when
  // this drawer was opened via a task's "Do it now"; falls back to the order's
  // active task otherwise.
  const { finishToTask } = useReturnToTask();

  // Transporter master — pick an existing transporter or add a new one inline.
  const { data: transRes, isFetching: transLoading } = useGetTransportersQuery({ limit: 500, sort: 'name', isActive: true }, { skip: !open });
  const transporters = useMemo(() => transRes?.data || [], [transRes]);
  const [createTransporter, { isLoading: creatingTransporter }] = useCreateTransporterMutation();
  // Inline "add transporter" dialog state (null = closed).
  const [newTransporter, setNewTransporter] = useState(null);

  // Reset whenever the drawer opens.
  useEffect(() => {
    if (!open) return;
    setStep1Order(presetOrder || null);
    setPhaseSels([]);
    setHeader({
      dcDate: dayjs().format('YYYY-MM-DD'),
      vehicleNo: '',
      transportMode: 'Road',
      transporterName: '',
      clientEmail: '',
      invoiceNo: '',
      dispatchedThrough: 'Freight Paid',
      deliveryAddress: '',
      remark: '',
    });
    setLines([]);
  }, [open, presetOrder]);

  // Came from an FMS "Do it now" with ?so=… → auto-select that order once the
  // (status-filtered) order list has loaded, so the doer starts at Step 2.
  useEffect(() => {
    if (!open || !presetSoNumber || step1Order || !orders.length) return;
    const match = orders.find((o) => o.soNumber === presetSoNumber);
    if (match) setStep1Order(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetSoNumber, orders]);

  // When phase(s) are picked, prefill the SKU lines. With several phases selected
  // we AGGREGATE each SKU across them (sum plan / effective / carry / pending), so
  // one row per SKU shows the combined target; the server allocates the entered
  // qty back to each phase (earliest-first).
  useEffect(() => {
    if (!phaseSels.length) { setLines([]); return; }
    if (isUnplanned) {
      // Show every order SKU; pending unknown at phase level → operator types qty.
      const newLines = (step1Order?.items || []).map((it) => ({
        orderItemId: it._id,
        skuId: it.skuId,
        skuCode: it.skuCode,
        skuName: it.skuName,
        plannedQty: 0,
        carryInQty: 0,
        effectivePlannedQty: 0,
        alreadyDispatchedQty: Number(it.dispatchedQty || 0),
        pendingFromPhase: 0,
        quantityPcs: 0,
        pcsPerBox: it.pcsPerBox || '',
        noOfBoxes: '',
        weightKg: '',
      }));
      setLines(newLines);
      return;
    }
    const map = new Map();
    phaseSels.filter((p) => p?.kind !== 'unplanned').forEach((ph) => {
      (ph.skus || []).forEach((sku) => {
        const key = sku.skuCode || sku.skuName;
        const cur = map.get(key) || {
          orderItemId: sku.scheduleItemId,   // server matches by skuCode anyway
          skuId: sku.skuId,
          skuCode: sku.skuCode,
          skuName: sku.skuName,
          phaseId: sku.phaseId,
          plannedQty: 0,
          carryInQty: 0,
          effectivePlannedQty: 0,
          alreadyDispatchedQty: 0,
          pendingFromPhase: 0,
          phaseCount: 0,
          pcsPerBox: '',
          noOfBoxes: '',
          weightKg: '',
        };
        cur.plannedQty += Number(sku.plannedQty || 0);
        cur.effectivePlannedQty += Number(sku.effectivePlannedQty || 0);
        cur.carryInQty += Number(sku.carryInQty || 0);
        cur.alreadyDispatchedQty += Number(sku.actualQty || 0);
        cur.pendingFromPhase += Number(sku.pendingQty || 0);
        cur.phaseCount += 1;
        map.set(key, cur);
      });
    });
    // Pre-fill the "Now" qty with the combined pending across the selected phases.
    setLines([...map.values()].map((l) => ({ ...l, quantityPcs: l.pendingFromPhase })));
  }, [phaseSels, step1Order, isUnplanned]);

  const updateLine = (idx, patch) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const totalDispatching = useMemo(() => lines.reduce((s, l) => s + Number(l.quantityPcs || 0), 0), [lines]);
  const isStep1Valid = Boolean(step1Order);
  const isStep2Valid = phaseSels.length > 0;
  const hasAnyQty   = lines.some((l) => Number(l.quantityPcs || 0) > 0);
  const canSubmit   = isStep1Valid && isStep2Valid && hasAnyQty && !isSaving;
  const progress    = (isStep1Valid ? 33 : 0) + (isStep2Valid ? 33 : 0) + (hasAnyQty ? 34 : 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const items = lines
      .filter((l) => Number(l.quantityPcs || 0) > 0)
      .map((l) => ({
        orderItemId: l.orderItemId,
        skuCode: l.skuCode,
        skuName: l.skuName,
        quantityPcs: Number(l.quantityPcs),
        ...(l.pcsPerBox ? { pcsPerBox: Number(l.pcsPerBox) } : {}),
        ...(l.noOfBoxes ? { noOfBoxes: Number(l.noOfBoxes) } : {}),
        ...(l.weightKg  ? { weightKg:  Number(l.weightKg) }  : {}),
      }));

    const payload = {
      soNumber: step1Order.soNumber,
      dcDate: new Date(header.dcDate),
      ...header,
      items,
      ...(isUnplanned
        ? { isUnplanned: true }
        : {
            // Server allocates the per-SKU qty across these phases (earliest-first).
            phaseRefs: phaseSels
              .filter((p) => p?.kind !== 'unplanned')
              .map((p) => ({ phaseNo: p.phaseNo, phaseId: p.phaseId })),
          }
      ),
    };

    try {
      const res = await createActualDispatch(payload).unwrap();
      const dcNumber = res?.data?.challan?.dcNumber || 'DC';
      enqueueSnackbar(`${dcNumber} created — plan vs actual updated`, { variant: 'success' });
      onClose?.();
      // Back to the FMS task: if we came from "Do it now" this returns to that
      // exact step (checklist auto-ticks, the action is marked done); otherwise
      // it opens the order's active task.
      if (step1Order?.soNumber) await finishToTask({ soNumber: step1Order.soNumber });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Could not record dispatch', { variant: 'error' });
    }
  };

  // Create the typed transporter in the master, then select it on the challan.
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

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      disableEnforceFocus
      PaperProps={{ sx: { width: { xs: '100%', md: 880 }, display: 'flex', flexDirection: 'column', bgcolor: 'background.default' } }}
    >
      {/* Header (sticky) */}
      <Box sx={{
        position: 'sticky', top: 0, zIndex: 10,
        bgcolor: 'background.paper',
        borderBottom: '1px solid', borderColor: 'divider',
        px: 3, py: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Stack direction="row" spacing={1.5} alignItems="center" minWidth={0}>
          <Box sx={{
            width: 38, height: 38, borderRadius: '12px', display: 'grid', placeItems: 'center',
            background: `linear-gradient(135deg, ${theme.palette.success.light}, ${theme.palette.success.dark})`,
            color: 'common.white',
          }}>
            <Truck size={18} />
          </Box>
          <Box minWidth={0}>
            <Typography variant="h6" fontWeight={800} sx={{ lineHeight: 1.1 }}>Record Actual Dispatch</Typography>
            <Typography variant="caption" color="text.secondary">
              Pick the plan phase this delivery fulfils · DC# auto-generated
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose} variant="outlined" startIcon={<X size={14} />} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={!canSubmit}
            startIcon={isSaving ? <CircularProgress size={14} color="inherit" /> : <Save size={14} />}
          >
            Submit Dispatch
          </Button>
        </Stack>
      </Box>
      <LinearProgress variant="determinate" value={progress} sx={{ height: 3 }} />

      <Box sx={{ flex: 1, overflowY: 'auto', px: 3, py: 2.5 }}>
        {/* Step 1 — Order */}
        <Paper sx={{ p: 2.5, borderRadius: '14px', mb: 2 }}>
          <SectionLabel icon={Building2} hint="Only orders with open plans are listed">Step 1 · Sales Order</SectionLabel>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <Autocomplete
              options={orders}
              value={step1Order}
              onChange={(_, val) => { setStep1Order(val); setPhaseSel(null); }}
              loading={ordersLoading}
              getOptionLabel={(o) => o ? `${o.soNumber} — ${o.partyName || ''}` : ''}
              isOptionEqualToValue={(a, b) => a._id === b?._id}
              sx={{ flex: 1, minWidth: 0 }}
              renderInput={(p) => <TextField {...p} placeholder="Search SO or party..." />}
              renderOption={(props, opt) => (
                <li {...props} key={opt._id}>
                  <Box>
                    <Typography variant="body2" fontWeight={700}>{opt.soNumber}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {opt.partyName} · Bal {Number(opt.totalBalanceQty || 0).toLocaleString('en-IN')}
                    </Typography>
                  </Box>
                </li>
              )}
            />
            {step1Order && (
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip size="small" label={`PO ${step1Order.poNumber}`} sx={{ fontWeight: 700 }} />
                <Chip size="small" label={`Bal ${Number(step1Order.totalBalanceQty || 0).toLocaleString('en-IN')}`} color="warning" variant="outlined" />
              </Stack>
            )}
          </Stack>
        </Paper>

        {/* Step 2 — Phase picker */}
        <Paper sx={{ p: 2.5, borderRadius: '14px', mb: 2, opacity: isStep1Valid ? 1 : 0.55, pointerEvents: isStep1Valid ? 'auto' : 'none' }}>
          <SectionLabel icon={Layers} hint="The plan phase this DC counts against">Step 2 · Plan Phase</SectionLabel>
          {phasesData?.grouped?.length === 0 && (
            <Box sx={{ p: 1.25, borderRadius: '10px', bgcolor: alpha(theme.palette.warning.main, 0.08), color: 'warning.main', fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <AlertTriangle size={14} /> No plan phases exist yet for this order. Choose <strong>Unplanned</strong> to proceed.
            </Box>
          )}
          <PhasePicker data={phasesData} value={phaseSels} onChange={setPhaseSels} isLoading={phasesFetching} />
          {phaseSels.length > 1 && !isUnplanned && (
            <Typography variant="caption" color="primary.main" sx={{ display: 'block', mt: 1, fontWeight: 600 }}>
              {phaseSels.length} phases selected — quantities below are combined; the entered qty is allocated across them earliest-first.
            </Typography>
          )}
          {isUnplanned && (
            <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 1 }}>
              ⚠ This dispatch will be flagged as <strong>unplanned</strong> on the risk panel.
            </Typography>
          )}
        </Paper>

        {/* Step 3 — Loadout */}
        <Paper sx={{ p: 2.5, borderRadius: '14px', mb: 2, opacity: isStep2Valid ? 1 : 0.55, pointerEvents: isStep2Valid ? 'auto' : 'none' }}>
          <SectionLabel icon={Receipt}>Step 3 · Loadout details</SectionLabel>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5, mb: 2 }}>
            <TextField
              label="DC Date *"
              type="date"
              value={header.dcDate}
              onChange={(e) => setHeader((p) => ({ ...p, dcDate: e.target.value }))}
              InputLabelProps={{ shrink: true }}
              InputProps={{ startAdornment: <InputAdornment position="start"><Calendar size={13} /></InputAdornment> }}
            />
            <TextField
              label="Vehicle No"
              value={header.vehicleNo}
              onChange={(e) => setHeader((p) => ({ ...p, vehicleNo: e.target.value.toUpperCase() }))}
              placeholder="MH-12-AB-1234"
            />
            <TextField select label="Transport mode" value={header.transportMode} onChange={(e) => setHeader((p) => ({ ...p, transportMode: e.target.value }))}>
              {TRANSPORT_MODES.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
            </TextField>
            <Autocomplete
              freeSolo
              selectOnFocus
              handleHomeEndKeys
              loading={transLoading}
              options={transporters}
              value={header.transporterName}
              getOptionLabel={(o) => (typeof o === 'string' ? o : (o.addLabel || o.name || ''))}
              isOptionEqualToValue={(o, v) => (o?.name || o) === (v?.name || v)}
              filterOptions={(opts, params) => {
                const filtered = transporterFilter(opts, params);
                const typed = params.inputValue.trim();
                const exists = opts.some((o) => (o.name || '').toLowerCase() === typed.toLowerCase());
                // Always offer a "create" row so a missing transporter can be added on the spot.
                if (typed && !exists) {
                  filtered.push({ addNew: true, name: typed, addLabel: `+ Add "${typed}" as a new transporter` });
                } else if (!typed) {
                  filtered.push({ addNew: true, name: '', addLabel: '+ Add a new transporter' });
                }
                return filtered;
              }}
              onChange={(_, val) => {
                if (val && typeof val === 'object' && val.addNew) {
                  setNewTransporter({ name: val.name, contactPerson: '', phone: '', email: '', city: '', gstNo: '' });
                  return;
                }
                const t = typeof val === 'string' ? null : val;
                setHeader((p) => ({
                  ...p,
                  transporterName: typeof val === 'string' ? val : (val?.name || ''),
                  // Convenience: adopt the transporter's primary mode when known.
                  transportMode: t?.modes?.[0] || p.transportMode,
                }));
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
                        <Typography variant="caption" color="text.secondary">
                          {[option.city, option.phone].filter(Boolean).join(' · ')}
                        </Typography>
                      )}
                    </Box>
                  )}
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Transporter"
                  placeholder="Select or add…"
                  helperText="Not listed? Type the name or pick “+ Add a new transporter”."
                  InputProps={{
                    ...params.InputProps,
                    startAdornment: <InputAdornment position="start"><Truck size={13} /></InputAdornment>,
                  }}
                />
              )}
            />
            <TextField
              label="Invoice / LR"
              value={header.invoiceNo}
              onChange={(e) => setHeader((p) => ({ ...p, invoiceNo: e.target.value }))}
              InputProps={{ startAdornment: <InputAdornment position="start"><Hash size={13} /></InputAdornment> }}
            />
            <TextField select label="Freight terms" value={header.dispatchedThrough} onChange={(e) => setHeader((p) => ({ ...p, dispatchedThrough: e.target.value }))}>
              {DC_THROUGH.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
            <TextField
              label="Client email (notify)"
              value={header.clientEmail}
              onChange={(e) => setHeader((p) => ({ ...p, clientEmail: e.target.value }))}
              sx={{ gridColumn: { xs: 'auto', sm: 'span 1' } }}
            />
            <TextField
              label="Delivery address"
              value={header.deliveryAddress}
              onChange={(e) => setHeader((p) => ({ ...p, deliveryAddress: e.target.value }))}
              sx={{ gridColumn: { xs: 'auto', sm: 'span 2' } }}
              InputProps={{ startAdornment: <InputAdornment position="start"><MapPin size={13} /></InputAdornment> }}
            />
          </Box>

          <Divider sx={{ my: 1 }} />

          <SectionLabel icon={Layers} hint="Effective plan = plan + carry-in from earlier short-falls">SKU loadout</SectionLabel>
          <Box sx={{
            border: '1px solid', borderColor: 'divider', borderRadius: '12px', overflow: 'hidden',
            bgcolor: 'background.paper',
          }}>
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '1.8fr 0.7fr 0.7fr 0.85fr 0.85fr 1fr 0.7fr 0.85fr' },
              px: 1.25, py: 1, bgcolor: alpha(theme.palette.primary.main, 0.04),
              borderBottom: '1px solid', borderColor: 'divider',
              fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              <Box>SKU</Box>
              <Box sx={{ textAlign: 'right' }}>Plan</Box>
              <Box sx={{ textAlign: 'right' }}>Carry-in</Box>
              <Box sx={{ textAlign: 'right' }}>Effective</Box>
              <Box sx={{ textAlign: 'right' }}>Already</Box>
              <Box sx={{ textAlign: 'right' }}>Now *</Box>
              <Box sx={{ textAlign: 'right' }}>Boxes</Box>
              <Box>Variance</Box>
            </Box>
            {lines.length === 0 ? (
              <Box sx={{ p: 2.5, textAlign: 'center', color: 'text.secondary' }}>
                <Typography variant="body2">Pick a plan phase to load SKUs.</Typography>
              </Box>
            ) : lines.map((l, idx) => {
              const effective = Number(l.effectivePlannedQty || l.plannedQty || 0);
              const carry = Number(l.carryInQty || 0);
              const pending = Number(l.pendingFromPhase ?? 0);
              const over = Number(l.quantityPcs || 0) > pending && !isUnplanned;
              const alloc = isUnplanned ? [] : computeAllocation(l, phaseSels, header.dcDate);
              return (
                <Box key={l.skuCode + idx} sx={{
                  borderBottom: idx === lines.length - 1 ? 0 : '1px solid', borderColor: 'divider',
                }}>
                <Box sx={{
                  display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.8fr 0.7fr 0.7fr 0.85fr 0.85fr 1fr 0.7fr 0.85fr' },
                  px: 1.25, py: 1, alignItems: 'center', gap: 1,
                }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700} noWrap>{l.skuName}</Typography>
                    <Typography variant="caption" color="text.secondary">{l.skuCode}</Typography>
                  </Box>
                  <Typography sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {Number(l.plannedQty || 0).toLocaleString('en-IN')}
                  </Typography>
                  <Box sx={{ textAlign: 'right' }}>
                    {carry === 0
                      ? <Typography variant="caption" color="text.disabled">—</Typography>
                      : (
                        <Typography sx={{
                          fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                          color: carry > 0 ? 'error.main' : 'success.main',
                        }}>
                          {carry > 0 ? '+' : '−'}{Math.abs(carry).toLocaleString('en-IN')}
                        </Typography>
                      )}
                  </Box>
                  <Tooltip arrow title="Effective = Plan + Carry-in. This is what must actually ship.">
                    <Typography sx={{
                      textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                      color: carry !== 0 ? 'warning.dark' : 'text.primary',
                    }}>
                      {effective.toLocaleString('en-IN')}
                    </Typography>
                  </Tooltip>
                  <Typography sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'success.main', fontWeight: 600 }}>
                    {Number(l.alreadyDispatchedQty || 0).toLocaleString('en-IN')}
                  </Typography>
                  <TextField
                    size="small"
                    type="number"
                    value={l.quantityPcs}
                    onChange={(e) => updateLine(idx, { quantityPcs: e.target.value })}
                    inputProps={{ style: { textAlign: 'right', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }, min: 0 }}
                    error={over}
                  />
                  <TextField
                    size="small"
                    type="number"
                    value={l.noOfBoxes}
                    onChange={(e) => updateLine(idx, { noOfBoxes: e.target.value })}
                    inputProps={{ style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' }, min: 0 }}
                  />
                  <VarianceChip effective={pending} dispatching={l.quantityPcs} />
                </Box>
                {Number(l.quantityPcs || 0) > 0 && alloc.length > 0 && <AllocationPreview alloc={alloc} />}
                </Box>
              );
            })}
          </Box>

          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              {lines.filter((l) => Number(l.quantityPcs) > 0).length} SKU{lines.filter((l) => Number(l.quantityPcs) > 0).length === 1 ? '' : 's'} in this dispatch
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 800 }}>
              Total: <span style={{ color: theme.palette.primary.main, fontVariantNumeric: 'tabular-nums' }}>{totalDispatching.toLocaleString('en-IN')}</span> pcs
            </Typography>
          </Box>
        </Paper>

        {/* Step 4 — Optional remark */}
        <Paper sx={{ p: 2.5, borderRadius: '14px', opacity: isStep2Valid ? 1 : 0.55 }}>
          <SectionLabel icon={FileText}>Step 4 · Notes (optional)</SectionLabel>
          <TextField
            multiline
            minRows={2}
            placeholder="Free-form notes for ops / accounts"
            value={header.remark}
            onChange={(e) => setHeader((p) => ({ ...p, remark: e.target.value }))}
            fullWidth
          />
        </Paper>
      </Box>

      {/* Footer summary (sticky) */}
      <Box sx={{
        position: 'sticky', bottom: 0, zIndex: 10,
        bgcolor: 'background.paper',
        borderTop: '1px solid', borderColor: 'divider',
        px: 3, py: 1.75,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <Stack direction="row" spacing={2.5}>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Phase</Typography>
            <Typography variant="body2" fontWeight={800}>
              {isUnplanned ? 'Unplanned' : (phaseSels.map((p) => p.phaseNo).filter(Boolean).join(', ') || '—')}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Total Qty</Typography>
            <Typography variant="h6" fontWeight={800} color="primary.main" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {totalDispatching.toLocaleString('en-IN')}
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>SKUs</Typography>
            <Typography variant="h6" fontWeight={800}>
              {lines.filter((l) => Number(l.quantityPcs) > 0).length}
            </Typography>
          </Box>
        </Stack>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={!canSubmit}
          startIcon={isSaving ? <CircularProgress size={14} color="inherit" /> : <Save size={14} />}
        >
          Submit Dispatch
        </Button>
      </Box>

      {/* Inline "Add transporter" — saves straight into the Transporter master. */}
      <Dialog open={!!newTransporter} onClose={() => !creatingTransporter && setNewTransporter(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Add transporter to master</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.75} sx={{ mt: 0.5 }}>
            <TextField
              label="Transporter name *" size="small" autoFocus
              value={newTransporter?.name || ''}
              onChange={(e) => setNewTransporter((p) => ({ ...p, name: e.target.value }))}
            />
            <Stack direction="row" spacing={1.5}>
              <TextField label="Contact person" size="small" fullWidth
                value={newTransporter?.contactPerson || ''}
                onChange={(e) => setNewTransporter((p) => ({ ...p, contactPerson: e.target.value }))} />
              <TextField label="Phone" size="small" fullWidth
                value={newTransporter?.phone || ''}
                onChange={(e) => setNewTransporter((p) => ({ ...p, phone: e.target.value }))} />
            </Stack>
            <TextField label="Email" size="small" fullWidth
              value={newTransporter?.email || ''}
              onChange={(e) => setNewTransporter((p) => ({ ...p, email: e.target.value }))} />
            <Stack direction="row" spacing={1.5}>
              <TextField label="City" size="small" fullWidth
                value={newTransporter?.city || ''}
                onChange={(e) => setNewTransporter((p) => ({ ...p, city: e.target.value }))} />
              <TextField label="GST No." size="small" fullWidth
                value={newTransporter?.gstNo || ''}
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
    </Drawer>
  );
};

export default DispatchEntry;
