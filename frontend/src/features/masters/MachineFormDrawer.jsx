/**
 * Add / edit a machine. Right-anchored drawer, same chrome as the SKU and Party
 * forms.
 *
 * Every field here maps to a column on the master sheet. Two are deliberately
 * read-only-derived and shown, not typed:
 *   Machine UID   always "<code> - <name>" — it held for all 109 source rows,
 *                 so letting it be typed would only let it drift
 *   Machine Type  inferred from the code prefix; it is the controlled vocabulary
 *                 the process routes match against, and can still be overridden
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, CircularProgress, Drawer, FormControlLabel, IconButton, MenuItem,
  Stack, Switch, TextField, Typography, alpha,
} from '@mui/material';
import { Cpu, Save, X } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useCreateMachineMutation, useUpdateMachineMutation } from '../../store/api/machineApi';
import { O2D, BRAND, NAVY, Pill, Help } from './components/masterUi';
import { MACHINE_STATUS_OPTIONS, MACHINE_TYPE_META, MACHINE_FIELD_HELP as HELP } from './machineMeta';

/** Field label with its explanation one hover away. */
const lbl = (text, hint) => <>{text}<Help text={hint} /></>;

const YES_NO_OPTIONS = [
  { value: '', label: 'Not recorded' },
  { value: 'YES', label: 'Yes' },
  { value: 'NO', label: 'No' },
];

const MACHINE_TYPES = Object.keys(MACHINE_TYPE_META);

const emptyForm = {
  code: '', name: '', machineType: '', department: '', make: '',
  capacity: '', installationYear: '', machineStatus: 'IN_USE',
  amc: '', maintenanceManual: '', maintenanceManualType: '',
  dailyClitSheet: false, dailyClitLink: '',
  halfYearlyPm: false, halfYearlyPmLink: '',
  defaultSpm: 0, remarks: '',
};

/** Mirrors machineTypeFromCode on the server so the preview matches what is saved. */
const typeFromCode = (code) => {
  const c = String(code || '').toUpperCase();
  if (c.startsWith('CCP')) return 'Circle Cutting Press';
  if (c.startsWith('DAP')) return 'Double Action Press';
  if (c.startsWith('SAP')) return 'Single Action Press';
  if (c.startsWith('HYP')) return 'Hydraulic Press';
  if (c.startsWith('BF')) return 'Buffing Motor';
  if (/^S\d/.test(c)) return 'Spinning / Rolling Machine';
  if (/^C\d/.test(c)) return 'Cutting Machine';
  if (/^L\d/.test(c)) return 'Lathe';
  return 'Manual / Other';
};

const MachineFormDrawer = ({ open, onClose, machine }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [createMachine, { isLoading: isCreating }] = useCreateMachineMutation();
  const [updateMachine, { isLoading: isUpdating }] = useUpdateMachineMutation();
  const isSaving = isCreating || isUpdating;
  const isEdit = !!machine?._id;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(machine ? {
      code: machine.code || '',
      name: machine.name || '',
      machineType: machine.machineType || '',
      department: machine.department || '',
      make: machine.make || '',
      capacity: machine.capacity || '',
      installationYear: machine.installationYear ?? '',
      machineStatus: machine.machineStatus || 'IN_USE',
      amc: machine.amc || '',
      maintenanceManual: machine.maintenanceManual || '',
      maintenanceManualType: machine.maintenanceManualType || '',
      dailyClitSheet: !!machine.dailyClitSheet,
      dailyClitLink: machine.dailyClitLink || '',
      halfYearlyPm: !!machine.halfYearlyPm,
      halfYearlyPmLink: machine.halfYearlyPmLink || '',
      defaultSpm: machine.defaultSpm || 0,
      remarks: machine.remarks || '',
    } : emptyForm);
  }, [open, machine]);

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const derivedUid = useMemo(() => {
    const c = form.code.trim().toUpperCase();
    const n = form.name.trim();
    if (!c) return '—';
    return n ? `${c} - ${n}` : c;
  }, [form.code, form.name]);

  const effectiveType = form.machineType || typeFromCode(form.code);
  const thisYear = new Date().getFullYear();

  const validate = () => {
    const e = {};
    if (!form.code.trim()) e.code = 'Machine code is required';
    if (!form.name.trim()) e.name = 'Machine name is required';
    if (form.installationYear !== '' && form.installationYear !== null) {
      const y = Number(form.installationYear);
      if (!Number.isInteger(y) || y < 1900 || y > thisYear) {
        e.installationYear = `Enter a year between 1900 and ${thisYear}`;
      }
    }
    if (form.dailyClitLink && !/^https?:\/\//i.test(form.dailyClitLink.trim())) {
      e.dailyClitLink = 'Must start with http:// or https://';
    }
    if (form.halfYearlyPmLink && !/^https?:\/\//i.test(form.halfYearlyPmLink.trim())) {
      e.halfYearlyPmLink = 'Must start with http:// or https://';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      machineType: effectiveType,
      department: form.department.trim(),
      make: form.make.trim(),
      capacity: form.capacity.trim(),
      installationYear: form.installationYear === '' ? null : Number(form.installationYear),
      machineStatus: form.machineStatus,
      amc: form.amc,
      maintenanceManual: form.maintenanceManual,
      maintenanceManualType: form.maintenanceManualType.trim(),
      dailyClitSheet: !!form.dailyClitSheet,
      dailyClitLink: form.dailyClitLink.trim(),
      halfYearlyPm: !!form.halfYearlyPm,
      halfYearlyPmLink: form.halfYearlyPmLink.trim(),
      defaultSpm: Number(form.defaultSpm) || 0,
      remarks: form.remarks.trim(),
    };
    try {
      if (isEdit) await updateMachine({ id: machine._id, ...payload }).unwrap();
      else await createMachine(payload).unwrap();
      enqueueSnackbar(isEdit ? 'Machine updated' : 'Machine added', { variant: 'success' });
      onClose();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to save machine', { variant: 'error' });
    }
  };

  const sectionLabel = (text) => (
    <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: O2D.sub, mt: 0.5 }}>
      {text}
    </Typography>
  );

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', md: 760 }, display: 'flex', flexDirection: 'column' } }}
    >
      <Box sx={{ p: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${O2D.line}` }}>
        <Stack direction="row" spacing={1.3} alignItems="center">
          <Box sx={{ p: 1, borderRadius: '10px', bgcolor: alpha(BRAND, 0.08), display: 'flex', color: BRAND }}>
            <Cpu size={20} />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={900}>{isEdit ? 'Edit Machine' : 'Add Machine'}</Typography>
            <Typography variant="caption" color="text.secondary">
              {isEdit ? 'Operator assignments are kept when you save' : 'Machine code must be unique'}
            </Typography>
          </Box>
        </Stack>
        <IconButton onClick={onClose}><X size={18} /></IconButton>
      </Box>

      <Box sx={{ p: 2.5, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {sectionLabel('Identity')}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 2fr' }, gap: 1.5 }}>
          <TextField
            label={lbl('Machine Code', HELP.code)} required value={form.code}
            onChange={(e) => updateField('code', e.target.value.toUpperCase())}
            error={!!errors.code} helperText={errors.code || 'e.g. DAP01'}
          />
          <TextField
            label={lbl('Machine Name', HELP.name)} required value={form.name}
            onChange={(e) => updateField('name', e.target.value)}
            error={!!errors.name} helperText={errors.name}
          />
        </Box>

        {/* UID is derived, never typed — shown so it is not a surprise. */}
        <Box sx={{ p: 1.5, borderRadius: '8px', bgcolor: O2D.surfaceAlt, border: `1px solid ${O2D.lineSoft}` }}>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: O2D.sub }}>
            Machine UID — generated<Help text={HELP.uid} />
          </Typography>
          <Typography sx={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.86rem', fontWeight: 700, color: NAVY, mt: 0.4 }}>
            {derivedUid}
          </Typography>
        </Box>

        {sectionLabel('Classification')}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
          <TextField
            select label={lbl('Machine Type', HELP.machineType)} value={effectiveType}
            onChange={(e) => updateField('machineType', e.target.value)}
            helperText="Defaults from the code prefix; used to match process routes."
          >
            {MACHINE_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </TextField>
          <TextField label={lbl('Department / Section', HELP.department)} value={form.department} onChange={(e) => updateField('department', e.target.value)} />
          <TextField
            label={lbl('Make', HELP.make)} value={form.make} onChange={(e) => updateField('make', e.target.value)}
            helperText="Blank throughout the source sheet."
          />
          <TextField
            label={lbl('Capacity', HELP.capacity)} value={form.capacity} onChange={(e) => updateField('capacity', e.target.value)}
            helperText='Kept as written, e.g. "5 HP", "50 Ton".'
          />
          <TextField
            label={lbl('Installation Year', HELP.installationYear)} type="number" value={form.installationYear}
            onChange={(e) => updateField('installationYear', e.target.value)}
            error={!!errors.installationYear} helperText={errors.installationYear || `1900 – ${thisYear}`}
          />
          <TextField
            select label={lbl('Status', HELP.machineStatus)} value={form.machineStatus}
            onChange={(e) => updateField('machineStatus', e.target.value)}
            helperText="Retiring a machine keeps its history — it is never deleted."
          >
            {MACHINE_STATUS_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Pill color={o.color}>{o.label}</Pill>
                  <Typography sx={{ fontSize: '0.76rem', color: O2D.sub }}>{o.meaning}</Typography>
                </Stack>
              </MenuItem>
            ))}
          </TextField>
        </Box>

        {sectionLabel('Maintenance')}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
          <TextField select label={lbl('AMC', HELP.amc)} value={form.amc} onChange={(e) => updateField('amc', e.target.value)}>
            {YES_NO_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
          <TextField select label={lbl('Maintenance Manual', HELP.maintenanceManual)} value={form.maintenanceManual} onChange={(e) => updateField('maintenanceManual', e.target.value)}>
            {YES_NO_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
          <TextField
            label={lbl('Maintenance Manual Type', HELP.maintenanceManualType)} value={form.maintenanceManualType}
            onChange={(e) => updateField('maintenanceManualType', e.target.value)}
            helperText="Blank throughout the source sheet."
          />
          <TextField label={lbl('Default SPM', HELP.defaultSpm)} type="number" value={form.defaultSpm} onChange={(e) => updateField('defaultSpm', e.target.value)} helperText="Strokes per minute, used by the DPR." />
        </Box>

        <Stack spacing={1}>
          <FormControlLabel
            control={<Switch checked={form.dailyClitSheet} onChange={(e) => updateField('dailyClitSheet', e.target.checked)} />}
            label={<Typography sx={{ fontSize: '0.84rem', fontWeight: 600 }}>Daily CLIT sheet maintained<Help text={HELP.dailyClitSheet} /></Typography>}
          />
          <TextField
            label={lbl('Daily CLIT Sheet Link', HELP.dailyClitLink)} value={form.dailyClitLink}
            onChange={(e) => updateField('dailyClitLink', e.target.value)}
            error={!!errors.dailyClitLink} helperText={errors.dailyClitLink || 'Optional link to the check sheet.'}
            fullWidth
          />
          <FormControlLabel
            control={<Switch checked={form.halfYearlyPm} onChange={(e) => updateField('halfYearlyPm', e.target.checked)} />}
            label={<Typography sx={{ fontSize: '0.84rem', fontWeight: 600 }}>Half-yearly PM done<Help text={HELP.halfYearlyPm} /></Typography>}
          />
          <TextField
            label={lbl('Half-Yearly PM Check Sheet Link', HELP.halfYearlyPmLink)} value={form.halfYearlyPmLink}
            onChange={(e) => updateField('halfYearlyPmLink', e.target.value)}
            error={!!errors.halfYearlyPmLink} helperText={errors.halfYearlyPmLink}
            fullWidth
          />
        </Stack>

        <TextField label={lbl('Remarks', HELP.remarks)} value={form.remarks} onChange={(e) => updateField('remarks', e.target.value)} minRows={2} multiline fullWidth />

        {!isEdit && (
          <Typography sx={{ fontSize: '0.76rem', color: O2D.sub }}>
            Operators are assigned from the machine&apos;s detail page once it exists.
          </Typography>
        )}
      </Box>

      <Box sx={{ p: 2.5, borderTop: `1px solid ${O2D.line}`, display: 'flex', gap: 1.5, bgcolor: O2D.surfaceAlt }}>
        <Button variant="outlined" onClick={onClose} fullWidth>Cancel</Button>
        <Button
          variant="contained" onClick={handleSave} disabled={isSaving}
          startIcon={isSaving ? <CircularProgress size={16} color="inherit" /> : <Save size={16} />}
          fullWidth
        >
          {isEdit ? 'Save Changes' : 'Add Machine'}
        </Button>
      </Box>
    </Drawer>
  );
};

export default MachineFormDrawer;
