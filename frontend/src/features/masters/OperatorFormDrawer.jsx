/**
 * Add / edit a machine operator.
 *
 * The source sheet gives an operator only a name and the department of the row
 * they appear on, so that is what this form collects. `code` and `shift` are
 * carried because the pre-existing operator record already had them and the DPR
 * screen writes them — both stay optional and neither is invented here.
 *
 * Assigned machines are NOT edited from this form: they live on the operator's
 * detail page, against the assignment collection.
 */
import React, { useEffect, useState } from 'react';
import {
  Box, Button, CircularProgress, Drawer, FormControlLabel, IconButton,
  Stack, Switch, TextField, Typography, alpha,
} from '@mui/material';
import { HardHat, Save, X } from 'lucide-react';
import { useSnackbar } from 'notistack';
import {
  useCreateMachineOperatorMutation,
  useUpdateMachineOperatorMutation,
} from '../../store/api/machineOperatorApi';
import { O2D, BRAND, Help } from './components/masterUi';
import { OPERATOR_FIELD_HELP as HELP } from './machineMeta';

/** Field label with its explanation one hover away. */
const lbl = (text, hint) => <>{text}<Help text={hint} /></>;

const emptyForm = { name: '', code: '', department: '', shift: '', isActive: true, remarks: '' };

const OperatorFormDrawer = ({ open, onClose, operator }) => {
  const { enqueueSnackbar } = useSnackbar();
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [createOperator, { isLoading: isCreating }] = useCreateMachineOperatorMutation();
  const [updateOperator, { isLoading: isUpdating }] = useUpdateMachineOperatorMutation();
  const isSaving = isCreating || isUpdating;
  const isEdit = !!operator?._id;

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(operator ? {
      name: operator.name || '',
      code: operator.code || '',
      department: operator.department || '',
      shift: operator.shift || '',
      isActive: operator.isActive !== false,
      remarks: operator.remarks || '',
    } : emptyForm);
  }, [open, operator]);

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Operator name is required';
    else if (form.name.trim().length < 2) e.name = 'Name looks too short';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      department: form.department.trim(),
      shift: form.shift.trim(),
      isActive: !!form.isActive,
      remarks: form.remarks.trim(),
    };
    try {
      if (isEdit) await updateOperator({ id: operator._id, ...payload }).unwrap();
      else await createOperator(payload).unwrap();
      enqueueSnackbar(isEdit ? 'Operator updated' : 'Operator added', { variant: 'success' });
      onClose();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Unable to save operator', { variant: 'error' });
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 520 }, display: 'flex', flexDirection: 'column' } }}
    >
      <Box sx={{ p: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${O2D.line}` }}>
        <Stack direction="row" spacing={1.3} alignItems="center">
          <Box sx={{ p: 1, borderRadius: '10px', bgcolor: alpha(BRAND, 0.08), display: 'flex', color: BRAND }}>
            <HardHat size={20} />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={900}>{isEdit ? 'Edit Operator' : 'Add Operator'}</Typography>
            <Typography variant="caption" color="text.secondary">
              {isEdit ? 'Machine assignments are kept when you save' : 'Operator names must be unique'}
            </Typography>
          </Box>
        </Stack>
        <IconButton onClick={onClose}><X size={18} /></IconButton>
      </Box>

      <Box sx={{ p: 2.5, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label={lbl('Operator Name', HELP.name)} required value={form.name}
          onChange={(e) => updateField('name', e.target.value)}
          error={!!errors.name}
          helperText={errors.name || 'Identity is the name — spacing and case are ignored when checking for duplicates.'}
          fullWidth
        />

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
          <TextField
            label={lbl('Operator Code', HELP.code)} value={form.code}
            onChange={(e) => updateField('code', e.target.value.toUpperCase())}
            helperText="Optional — not present in the source sheet."
          />
          <TextField label={lbl('Department', HELP.department)} value={form.department} onChange={(e) => updateField('department', e.target.value)} />
          <TextField
            label={lbl('Shift', HELP.shift)} value={form.shift} onChange={(e) => updateField('shift', e.target.value)}
            helperText="Optional — used by the DPR."
          />
        </Box>

        <FormControlLabel
          control={<Switch checked={form.isActive} onChange={(e) => updateField('isActive', e.target.checked)} />}
          label={
            <Box>
              <Typography sx={{ fontSize: '0.84rem', fontWeight: 600 }}>Active<Help text={HELP.isActive} /></Typography>
              <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>
                Turn off when someone leaves — their history and assignments stay intact.
              </Typography>
            </Box>
          }
        />

        <TextField label={lbl('Remarks', HELP.remarks)} value={form.remarks} onChange={(e) => updateField('remarks', e.target.value)} minRows={2} multiline fullWidth />

        {!isEdit && (
          <Typography sx={{ fontSize: '0.76rem', color: O2D.sub }}>
            Machines are assigned from the operator&apos;s detail page once they exist.
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
          {isEdit ? 'Save Changes' : 'Add Operator'}
        </Button>
      </Box>
    </Drawer>
  );
};

export default OperatorFormDrawer;
