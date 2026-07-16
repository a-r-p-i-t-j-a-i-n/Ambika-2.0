import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box, Grid, Paper, Stack, Typography, TextField, MenuItem, Autocomplete, Button, IconButton,
  Accordion, AccordionSummary, AccordionDetails, Chip, Divider, Snackbar, Alert, InputAdornment,
  Table, TableBody, TableRow, TableCell, useMediaQuery, useTheme, CircularProgress,
} from '@mui/material';
import {
  Factory, ChevronDown, Plus, Trash2, Save, Clock, Gauge, AlertTriangle, PauseCircle, XCircle, ArrowLeft,
} from 'lucide-react';
import {
  DprHero, Panel, RatioBar, HOUR_SLOTS, PLANNED_REASONS, DOWNTIME_REASONS, DEFECT_TYPES, SHIFTS,
  PPC_ACCENT, oeeColor, oeeBand, num, pct,
} from './dprMeta';
import {
  useGetDprOptionsQuery, useLazyGetDprOperationsQuery, useLazyGetDprDiesQuery,
  useCreateDprEntryMutation, useUpdateDprEntryMutation, useGetDprEntryQuery,
} from '../../../store/api/dprApi';

// ── Client-side OEE preview — mirrors backend oee.service exactly ──────────────
const minutesBetween = (start, stop) => {
  if (!start || !stop) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = stop.split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => !Number.isFinite(n))) return 0;
  let m = (eh * 60 + em) - (sh * 60 + sm);
  if (m < 0) m += 1440;
  return m;
};
const sum = (arr, pick) => (arr || []).reduce((a, x) => a + (Number(pick(x)) || 0), 0);
const clientOee = (s) => {
  const productionQty = sum(Object.values(s.hourly), (v) => v);
  const available = Number(s.availableMinutes) || minutesBetween(s.startTime, s.stopTime);
  const plannedTotal = sum(Object.values(s.planned), (v) => v);
  const downtimeTotal = sum(s.downtime, (x) => x.minutes);
  const netAvailable = Math.max(0, available - plannedTotal);
  const runTime = Math.max(0, netAvailable - downtimeTotal);
  const spm = Number(s.spm) || 0;
  const cavity = Number(s.cavity) || 1;
  const stdCycle = spm > 0 ? 1 / (spm * cavity) : 0;
  const rejectQty = sum(s.defects, (x) => x.qty);
  const reworkQty = Number(s.reworkQty) || 0;
  const goodQty = Math.max(0, productionQty - rejectQty - reworkQty);
  const earned = productionQty * stdCycle;
  const availability = netAvailable > 0 ? Math.min(1, runTime / netAvailable) : 0;
  // Performance capped at 100% (matches the backend OEE engine); Machine Eff =
  // Availability × Performance so the live preview equals the stored value.
  const performance = runTime > 0 && stdCycle > 0 ? Math.min(1, earned / runTime) : 0;
  const machineEff = availability * performance;
  const quality = productionQty > 0 ? Math.min(1, goodQty / productionQty) : 0;
  const oee = availability * performance * quality;
  return {
    productionQty, available, netAvailable, runTime, plannedTotal, downtimeTotal, rejectQty, goodQty,
    availability: availability * 100, performance: performance * 100,
    machineEff: machineEff * 100, quality: quality * 100, oee: oee * 100,
  };
};

const emptyHourly = () => Object.fromEntries(HOUR_SLOTS.map((h) => [h.key, '']));
const emptyPlanned = () => Object.fromEntries(PLANNED_REASONS.map((r) => [r.key, '']));

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const DprEntry = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const isEdit = !!editId;
  const isNarrow = useMediaQuery(theme.breakpoints.down('lg'));

  const { data: optRes } = useGetDprOptionsQuery();
  const options = optRes?.data || {};
  const [fetchOperations, { data: opsRes, isFetching: opsLoading }] = useLazyGetDprOperationsQuery();
  const [fetchDies, { data: diesRes }] = useLazyGetDprDiesQuery();
  const operations = opsRes?.data || [];
  const dies = diesRes?.data || [];

  const [createEntry, { isLoading: creating }] = useCreateDprEntryMutation();
  const [updateEntry, { isLoading: updating }] = useUpdateDprEntryMutation();
  const { data: editRes } = useGetDprEntryQuery(editId, { skip: !isEdit });

  const [snack, setSnack] = useState(null);

  // ── Form state ────────────────────────────────────────────────────────────
  const [f, setF] = useState({
    date: todayIso(), shift: 'A', machineCode: '', machineType: '', operatorName: '',
    skuCode: '', skuName: '', operationNo: '', operationName: '', operationLabel: '', operationDesc: '',
    isLastOperation: false, spm: '', cavity: 1, partRate: '',
    dieNo: '', coilNo: '', circleSize: '', startTime: '', stopTime: '', availableMinutes: '',
    strokes: '', reworkQty: '', rmConsumedKg: '', materialGrade: '', remarks: '',
  });
  const [hourly, setHourly] = useState(emptyHourly());
  const [planned, setPlanned] = useState(emptyPlanned());
  const [downtime, setDowntime] = useState([]); // [{reason, minutes}]
  const [defects, setDefects] = useState([]);    // [{type, qty}]
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  // Prefill from an existing entry when editing.
  useEffect(() => {
    const e = editRes?.data;
    if (!e) return;
    setF({
      date: (e.date || '').slice(0, 10) || todayIso(), shift: e.shift || 'A', machineCode: e.machineCode || '',
      machineType: e.machineType || '', operatorName: e.operatorName || '', skuCode: e.skuCode || '',
      skuName: e.skuName || '', operationNo: e.operationNo ?? '', operationName: e.operationName || '',
      operationLabel: e.operationLabel || '', operationDesc: '', isLastOperation: !!e.isLastOperation,
      spm: e.spm ?? '', cavity: e.cavity ?? 1, partRate: e.oee?.partRate ?? '', dieNo: e.dieNo || '',
      coilNo: e.coilNo || '', circleSize: e.circleSize || '', startTime: e.startTime || '', stopTime: e.stopTime || '',
      availableMinutes: e.availableMinutes ?? '', strokes: e.strokes ?? '', reworkQty: e.reworkQty ?? '',
      rmConsumedKg: e.rmConsumedKg ?? '', materialGrade: e.materialGrade || '', remarks: e.remarks || '',
    });
    const h = emptyHourly();
    (e.hourly || []).forEach((x) => { h[x.slot] = x.qty; });
    setHourly(h);
    const p = emptyPlanned();
    (e.plannedItems || []).forEach((x) => { p[x.reason] = x.minutes; });
    setPlanned(p);
    setDowntime((e.downtimeItems || []).map((x) => ({ reason: x.reason, minutes: x.minutes })));
    setDefects((e.defectItems || []).map((x) => ({ type: x.type, qty: x.qty })));
    if (e.skuCode) fetchOperations(e.skuCode);
  }, [editRes, fetchOperations]);

  // Auto-fill available minutes from start/stop (unless the user overrode it).
  useEffect(() => {
    if (f.startTime && f.stopTime) set('availableMinutes', String(minutesBetween(f.startTime, f.stopTime)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startTime, f.stopTime]);

  // ── Dependent dropdown handlers ─────────────────────────────────────────────
  const operatorOptions = useMemo(() => {
    const all = options.operators || [];
    if (!f.machineCode) return all.map((o) => o.name);
    const matched = all.filter((o) => (o.machineCodes || []).includes(f.machineCode)).map((o) => o.name);
    return matched.length ? matched : all.map((o) => o.name);
  }, [options.operators, f.machineCode]);

  const onPickMachine = (code) => {
    const m = (options.machines || []).find((x) => x.code === code);
    setF((p) => ({ ...p, machineCode: code || '', machineType: m?.machineType || '' }));
  };
  const onPickSku = (skuCode) => {
    const sku = (options.skus || []).find((s) => s.skuCode === skuCode);
    setF((p) => ({ ...p, skuCode: skuCode || '', skuName: sku?.skuName || '', operationNo: '', operationName: '', operationLabel: '', operationDesc: '', spm: '', cavity: 1, dieNo: '' }));
    if (skuCode) fetchOperations(skuCode);
  };
  const onPickOperation = (opNo) => {
    const op = operations.find((o) => String(o.operationNo) === String(opNo));
    if (!op) { set('operationNo', opNo); return; }
    setF((p) => ({
      ...p, operationNo: op.operationNo, operationName: op.operationName, operationLabel: op.operationLabel,
      operationDesc: op.operationDesc, isLastOperation: op.isLastOperation, spm: op.spm ?? '', cavity: op.cavity || 1,
      partRate: op.partRate || '', machineType: p.machineType || op.machineType || '', dieNo: '',
    }));
    if (f.skuCode) fetchDies({ skuCode: f.skuCode, operationDesc: op.operationDesc });
  };

  const live = useMemo(() => clientOee({
    hourly, planned, downtime, defects, reworkQty: f.reworkQty,
    availableMinutes: f.availableMinutes, startTime: f.startTime, stopTime: f.stopTime, spm: f.spm, cavity: f.cavity,
  }), [hourly, planned, downtime, defects, f.reworkQty, f.availableMinutes, f.startTime, f.stopTime, f.spm, f.cavity]);

  const hourlyTotal = live.productionQty;

  // ── Submit ──────────────────────────────────────────────────────────────────
  const buildPayload = () => ({
    date: f.date, shift: f.shift, machineCode: f.machineCode, machineType: f.machineType,
    operatorName: f.operatorName, skuCode: f.skuCode, skuName: f.skuName,
    operationNo: f.operationNo === '' ? null : Number(f.operationNo), operationName: f.operationName,
    operationLabel: f.operationLabel, isLastOperation: f.isLastOperation,
    spm: f.spm === '' ? null : Number(f.spm), cavity: Number(f.cavity) || 1,
    partRate: f.partRate === '' ? null : Number(f.partRate),
    dieNo: f.dieNo, coilNo: f.coilNo, circleSize: f.circleSize,
    startTime: f.startTime, stopTime: f.stopTime,
    availableMinutes: f.availableMinutes === '' ? null : Number(f.availableMinutes),
    strokes: Number(f.strokes) || 0, reworkQty: Number(f.reworkQty) || 0,
    rmConsumedKg: Number(f.rmConsumedKg) || 0, materialGrade: f.materialGrade, remarks: f.remarks,
    hourly: HOUR_SLOTS.map((h) => ({ slot: h.key, qty: Number(hourly[h.key]) || 0 })).filter((x) => x.qty > 0),
    plannedItems: PLANNED_REASONS.map((r) => ({ reason: r.key, minutes: Number(planned[r.key]) || 0 })).filter((x) => x.minutes > 0),
    downtimeItems: downtime.filter((x) => x.reason && Number(x.minutes) > 0).map((x) => ({ reason: x.reason, minutes: Number(x.minutes) })),
    defectItems: defects.filter((x) => x.type && Number(x.qty) > 0).map((x) => ({ type: x.type, qty: Number(x.qty) })),
  });

  const canSave = f.date && f.machineCode && f.skuCode;
  const submit = async () => {
    if (!canSave) { setSnack({ sev: 'warning', msg: 'Date, Machine and SKU are required.' }); return; }
    try {
      const payload = buildPayload();
      if (isEdit) await updateEntry({ id: editId, ...payload }).unwrap();
      else await createEntry(payload).unwrap();
      setSnack({ sev: 'success', msg: isEdit ? 'DPR entry updated.' : 'DPR entry saved. OEE computed.' });
      setTimeout(() => navigate('/ppc/dpr/register'), 700);
    } catch (err) {
      setSnack({ sev: 'error', msg: err?.data?.message || 'Could not save the entry.' });
    }
  };

  const busy = creating || updating;

  // ── Live OEE preview panel ───────────────────────────────────────────────────
  const OeePreview = (
    <Panel title="Live OEE — recomputed as you type" sx={{ position: isNarrow ? 'static' : 'sticky', top: 12 }}>
      <Stack alignItems="center" spacing={0.5} sx={{ mb: 1.5 }}>
        <Box sx={{
          width: 128, height: 128, borderRadius: '50%', display: 'grid', placeItems: 'center',
          background: `conic-gradient(${oeeColor(live.oee)} ${live.oee * 3.6}deg, ${theme.palette.mode === 'dark' ? '#2a2a3a' : '#eee'} 0deg)`,
        }}>
          <Box sx={{ width: 104, height: 104, borderRadius: '50%', bgcolor: 'background.paper', display: 'grid', placeItems: 'center' }}>
            <Box textAlign="center">
              <Typography sx={{ fontWeight: 900, fontSize: '1.7rem', lineHeight: 1, color: oeeColor(live.oee) }}>{live.oee.toFixed(1)}</Typography>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.1em', color: 'text.secondary' }}>OEE %</Typography>
            </Box>
          </Box>
        </Box>
        <Chip size="small" label={oeeBand(live.oee)} sx={{ fontWeight: 800, bgcolor: `${oeeColor(live.oee)}1f`, color: oeeColor(live.oee) }} />
      </Stack>
      <Stack spacing={1.25}>
        <RatioBar label="Availability" value={live.availability} />
        <RatioBar label="Performance" value={live.performance} />
        <RatioBar label="Quality" value={live.quality} />
      </Stack>
      <Divider sx={{ my: 1.5 }} />
      <Table size="small">
        <TableBody>
          {[
            ['Production (good)', `${num(live.goodQty)} / ${num(live.productionQty)}`],
            ['Available', `${num(live.available)} min`],
            ['Net available', `${num(live.netAvailable)} min`],
            ['Run time', `${num(live.runTime)} min`],
            ['Planned down', `${num(live.plannedTotal)} min`],
            ['Loss time', `${num(live.downtimeTotal)} min`],
            ['Rejected', `${num(live.rejectQty)} pcs`],
            ['Machine Eff.', pct(live.machineEff)],
          ].map(([k, v]) => (
            <TableRow key={k}>
              <TableCell sx={{ px: 0, py: 0.4, border: 0, color: 'text.secondary', fontSize: '0.75rem' }}>{k}</TableCell>
              <TableCell align="right" sx={{ px: 0, py: 0.4, border: 0, fontWeight: 700, fontSize: '0.78rem' }}>{v}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button fullWidth variant="contained" size="large" startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <Save size={18} />}
        onClick={submit} disabled={busy || !canSave}
        sx={{ mt: 1.5, bgcolor: PPC_ACCENT, fontWeight: 800, '&:hover': { bgcolor: '#5b21b6' } }}>
        {isEdit ? 'Update DPR entry' : 'Save DPR entry'}
      </Button>
    </Panel>
  );

  const numField = (props) => (
    <TextField size="small" fullWidth type="number" InputProps={{ inputProps: { min: 0 } }} {...props} />
  );

  return (
    <Box sx={{ pb: 6 }}>
      <DprHero icon={Factory} title={isEdit ? 'Edit DPR Entry' : 'New DPR Entry'}
        subtitle="Daily Production Report — one machine · one operation · one shift"
        action={<Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/ppc/dpr/register')} sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)' }} variant="outlined">Register</Button>} />

      <Box sx={{ p: { xs: 1.5, md: 2.5 } }}>
        <Grid container spacing={2}>
          {/* Left: the form */}
          <Grid item xs={12} lg={8}>
            <Stack spacing={2}>
              {/* Context */}
              <Panel title="Job context">
                <Grid container spacing={1.5}>
                  <Grid item xs={6} sm={3}><TextField size="small" fullWidth label="Date" type="date" InputLabelProps={{ shrink: true }} value={f.date} onChange={(e) => set('date', e.target.value)} /></Grid>
                  <Grid item xs={6} sm={3}>
                    <TextField size="small" fullWidth select label="Shift" value={f.shift} onChange={(e) => set('shift', e.target.value)}>
                      {SHIFTS.map((s) => <MenuItem key={s} value={s}>Shift {s}</MenuItem>)}
                    </TextField>
                  </Grid>
                  <Grid item xs={6} sm={3}>
                    <Autocomplete options={(options.machines || []).map((m) => m.code)} value={f.machineCode || null}
                      onChange={(_e, v) => onPickMachine(v)}
                      renderInput={(p) => <TextField {...p} size="small" label="Machine *" />} />
                  </Grid>
                  <Grid item xs={6} sm={3}><TextField size="small" fullWidth label="Machine type" value={f.machineType} InputProps={{ readOnly: true }} /></Grid>

                  <Grid item xs={12} sm={4}>
                    <Autocomplete freeSolo options={operatorOptions} value={f.operatorName || null}
                      onChange={(_e, v) => set('operatorName', v || '')}
                      onInputChange={(_e, v) => set('operatorName', v || '')}
                      renderInput={(p) => <TextField {...p} size="small" label="Operator" />} />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <Autocomplete options={(options.skus || []).map((s) => s.skuCode)} value={f.skuCode || null}
                      onChange={(_e, v) => onPickSku(v)}
                      getOptionLabel={(code) => { const s = (options.skus || []).find((x) => x.skuCode === code); return s ? `${s.skuCode} — ${s.skuName}` : code; }}
                      renderInput={(p) => <TextField {...p} size="small" label="SKU *" />} />
                  </Grid>
                  <Grid item xs={12} sm={4}>
                    <TextField size="small" fullWidth select label="Operation" value={f.operationNo === '' ? '' : String(f.operationNo)}
                      onChange={(e) => onPickOperation(e.target.value)}
                      InputProps={{ endAdornment: opsLoading ? <CircularProgress size={14} sx={{ mr: 2 }} /> : null }}
                      disabled={!f.skuCode}>
                      {operations.map((o) => <MenuItem key={o.operationNo} value={String(o.operationNo)}>{o.operationLabel}</MenuItem>)}
                    </TextField>
                  </Grid>

                  <Grid item xs={6} sm={3}>
                    <Autocomplete freeSolo options={dies.map((d) => d.completeDieNo)} value={f.dieNo || null}
                      onChange={(_e, v) => set('dieNo', v || '')} onInputChange={(_e, v) => set('dieNo', v || '')}
                      renderInput={(p) => <TextField {...p} size="small" label="Die No." />} />
                  </Grid>
                  <Grid item xs={6} sm={3}>{numField({ label: 'SPM', value: f.spm, onChange: (e) => set('spm', e.target.value), helperText: 'auto from routing' })}</Grid>
                  <Grid item xs={6} sm={3}>{numField({ label: 'Cavity', value: f.cavity, onChange: (e) => set('cavity', e.target.value) })}</Grid>
                  <Grid item xs={6} sm={3}>{numField({ label: 'Part rate (₹)', value: f.partRate, onChange: (e) => set('partRate', e.target.value) })}</Grid>

                  <Grid item xs={6} sm={3}><TextField size="small" fullWidth label="Coil No." value={f.coilNo} onChange={(e) => set('coilNo', e.target.value)} /></Grid>
                  <Grid item xs={6} sm={3}><TextField size="small" fullWidth label="Circle size" value={f.circleSize} onChange={(e) => set('circleSize', e.target.value)} /></Grid>
                  <Grid item xs={6} sm={3}><TextField size="small" fullWidth label="Material grade" value={f.materialGrade} onChange={(e) => set('materialGrade', e.target.value)} /></Grid>
                  <Grid item xs={6} sm={3}>{numField({ label: 'RM consumed (kg)', value: f.rmConsumedKg, onChange: (e) => set('rmConsumedKg', e.target.value) })}</Grid>
                </Grid>
              </Panel>

              {/* Timing */}
              <Panel title="Machine time">
                <Grid container spacing={1.5} alignItems="center">
                  <Grid item xs={6} sm={3}><TextField size="small" fullWidth label="Start" type="time" InputLabelProps={{ shrink: true }} value={f.startTime} onChange={(e) => set('startTime', e.target.value)} /></Grid>
                  <Grid item xs={6} sm={3}><TextField size="small" fullWidth label="Stop" type="time" InputLabelProps={{ shrink: true }} value={f.stopTime} onChange={(e) => set('stopTime', e.target.value)} /></Grid>
                  <Grid item xs={6} sm={3}>{numField({ label: 'Available (min)', value: f.availableMinutes, onChange: (e) => set('availableMinutes', e.target.value), InputProps: { startAdornment: <InputAdornment position="start"><Clock size={14} /></InputAdornment> } })}</Grid>
                  <Grid item xs={6} sm={3}>{numField({ label: 'No. of strokes', value: f.strokes, onChange: (e) => set('strokes', e.target.value) })}</Grid>
                </Grid>
              </Panel>

              {/* Hourly production */}
              <Panel title="Hourly production (pcs)" action={<Chip icon={<Gauge size={14} />} label={`Total ${num(hourlyTotal)}`} sx={{ fontWeight: 800, bgcolor: `${PPC_ACCENT}1f`, color: PPC_ACCENT }} />}>
                <Grid container spacing={1}>
                  {HOUR_SLOTS.map((h) => (
                    <Grid item xs={4} sm={3} md={2} key={h.key}>
                      <TextField size="small" fullWidth type="number" label={h.label} value={hourly[h.key]}
                        onChange={(e) => setHourly((p) => ({ ...p, [h.key]: e.target.value }))}
                        InputProps={{ inputProps: { min: 0 } }}
                        sx={{ '& input': { fontWeight: 700, textAlign: 'center' } }} />
                    </Grid>
                  ))}
                </Grid>
              </Panel>

              {/* Planned downtime */}
              <SectionAccordion icon={<PauseCircle size={18} color="#2563eb" />} title="Planned downtime" total={`${num(live.plannedTotal)} min`} tint="#2563eb">
                <Grid container spacing={1}>
                  {PLANNED_REASONS.map((r) => (
                    <Grid item xs={6} sm={4} md={3} key={r.key}>
                      <TextField size="small" fullWidth type="number" label={r.label} value={planned[r.key]}
                        onChange={(e) => setPlanned((p) => ({ ...p, [r.key]: e.target.value }))}
                        InputProps={{ inputProps: { min: 0 }, endAdornment: <InputAdornment position="end">m</InputAdornment> }} />
                    </Grid>
                  ))}
                </Grid>
              </SectionAccordion>

              {/* Unplanned downtime — add-row */}
              <SectionAccordion icon={<AlertTriangle size={18} color="#d97706" />} title="Unplanned downtime / idle loss" total={`${num(live.downtimeTotal)} min`} tint="#d97706">
                <AddRowList items={downtime} setItems={setDowntime} options={DOWNTIME_REASONS} valueKey="reason" amountKey="minutes" amountLabel="min" />
              </SectionAccordion>

              {/* Defects — add-row */}
              <SectionAccordion icon={<XCircle size={18} color="#dc2626" />} title="Rejections / defects" total={`${num(live.rejectQty)} pcs`} tint="#dc2626">
                <Grid container spacing={1} sx={{ mb: 1 }}>
                  <Grid item xs={6} sm={3}>{numField({ label: 'Rework qty', value: f.reworkQty, onChange: (e) => set('reworkQty', e.target.value) })}</Grid>
                </Grid>
                <AddRowList items={defects} setItems={setDefects} options={DEFECT_TYPES} valueKey="type" amountKey="qty" amountLabel="pcs" />
              </SectionAccordion>

              <Panel title="Remarks">
                <TextField size="small" fullWidth multiline minRows={2} placeholder="Any other remarks about this shift…" value={f.remarks} onChange={(e) => set('remarks', e.target.value)} />
              </Panel>
            </Stack>
          </Grid>

          {/* Right: live OEE */}
          <Grid item xs={12} lg={4}>{OeePreview}</Grid>
        </Grid>
      </Box>

      <Snackbar open={!!snack} autoHideDuration={3500} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.sev} variant="filled" onClose={() => setSnack(null)}>{snack.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  );
};

// Collapsible section with a running total in the header.
const SectionAccordion = ({ icon, title, total, tint, children }) => (
  <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '14px !important', '&:before': { display: 'none' }, overflow: 'hidden' }}>
    <AccordionSummary expandIcon={<ChevronDown size={18} />} sx={{ '& .MuiAccordionSummary-content': { alignItems: 'center', gap: 1 } }}>
      {icon}
      <Typography sx={{ fontWeight: 800, fontSize: '0.85rem', flex: 1 }}>{title}</Typography>
      <Chip size="small" label={total} sx={{ fontWeight: 800, bgcolor: `${tint}1f`, color: tint, mr: 1 }} />
    </AccordionSummary>
    <AccordionDetails sx={{ pt: 0 }}>{children}</AccordionDetails>
  </Accordion>
);

// Reusable "pick a reason + amount → add to list" control.
const AddRowList = ({ items, setItems, options, valueKey, amountKey, amountLabel }) => {
  const [sel, setSel] = useState(null);
  const [amt, setAmt] = useState('');
  const labelOf = Object.fromEntries(options.map((o) => [o.key, o.label]));
  const used = new Set(items.map((x) => x[valueKey]));
  const available = options.filter((o) => !used.has(o.key));
  const add = () => {
    if (!sel || !(Number(amt) > 0)) return;
    setItems((p) => [...p, { [valueKey]: sel.key, [amountKey]: Number(amt) }]);
    setSel(null); setAmt('');
  };
  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1 }}>
        <Autocomplete size="small" sx={{ flex: 1 }} options={available} value={sel}
          getOptionLabel={(o) => o.label || ''} isOptionEqualToValue={(a, b) => a.key === b.key}
          onChange={(_e, v) => setSel(v)} renderInput={(p) => <TextField {...p} label="Reason" />} />
        <TextField size="small" type="number" label={amountLabel} value={amt} onChange={(e) => setAmt(e.target.value)}
          sx={{ width: { xs: '100%', sm: 120 } }} InputProps={{ inputProps: { min: 0 } }}
          onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Button variant="outlined" startIcon={<Plus size={16} />} onClick={add} disabled={!sel || !(Number(amt) > 0)}>Add</Button>
      </Stack>
      {items.length === 0 ? (
        <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', py: 1 }}>None recorded.</Typography>
      ) : (
        <Stack spacing={0.5}>
          {items.map((it, i) => (
            <Stack key={it[valueKey]} direction="row" alignItems="center" spacing={1}
              sx={{ px: 1, py: 0.5, borderRadius: 2, bgcolor: 'action.hover' }}>
              <Typography sx={{ flex: 1, fontSize: '0.82rem', fontWeight: 600 }}>{labelOf[it[valueKey]] || it[valueKey]}</Typography>
              <Chip size="small" label={`${it[amountKey]} ${amountLabel}`} sx={{ fontWeight: 700 }} />
              <IconButton size="small" onClick={() => setItems((p) => p.filter((_, j) => j !== i))}><Trash2 size={15} /></IconButton>
            </Stack>
          ))}
        </Stack>
      )}
    </Box>
  );
};

export default DprEntry;
