import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Autocomplete,
  Alert, Box, Typography, FormControlLabel, Checkbox, CircularProgress,
} from '@mui/material';
import { PermissionStatusChip } from './fmsDoerMeta';

/**
 * Pick a doer (active users only, from User Management) with a reason.
 * Shows the user's permission status for the step and requires an explicit
 * acknowledgement before assigning someone who lacks the step's permission.
 *
 * Used both for "Change Doer" (step config) and "Reassign" (one open task).
 */
const DoerPickerDialog = ({
  open, onClose, title, subtitle, users = [], loading = false, currentDoerId = null,
  allowUnassign = false, saving = false, confirmLabel = 'Save', onSubmit, note,
}) => {
  const [selected, setSelected] = useState(null);
  const [unassign, setUnassign] = useState(false);
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(null); setUnassign(false); setReason(''); setAck(false);
  }, [open]);

  const options = useMemo(() => users.filter((u) => String(u._id) !== String(currentDoerId || '')), [users, currentDoerId]);
  const missing = selected?.permissionStatus === 'MISSING';
  const canSave = !saving && (unassign || (selected && (!missing || ack)));

  const submit = () => onSubmit?.({
    doerUserId: unassign ? null : selected._id,
    reason: reason.trim(),
    acknowledgeMissingPermission: missing && ack,
  });

  return (
    <Dialog open={open} onClose={() => (saving ? null : onClose?.())} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        {title}
        {subtitle && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{subtitle}</Typography>}
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {note && <Alert severity="info" variant="outlined">{note}</Alert>}
        <Autocomplete
          options={options}
          loading={loading}
          value={selected}
          disabled={unassign}
          onChange={(_e, v) => { setSelected(v); setAck(false); }}
          getOptionLabel={(o) => o?.name || ''}
          isOptionEqualToValue={(o, v) => String(o._id) === String(v._id)}
          renderOption={(props, o) => (
            <li {...props} key={o._id}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={700} noWrap>{o.name}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>{[o.role, o.email].filter(Boolean).join(' · ')}</Typography>
                </Box>
                <PermissionStatusChip status={o.permissionStatus} missing={o.missingPermissions} />
              </Box>
            </li>
          )}
          renderInput={(params) => (
            <TextField {...params} label="Doer *" placeholder="Search active users"
              helperText="Only active users from User Management are listed"
              InputProps={{ ...params.InputProps, endAdornment: (<>{loading ? <CircularProgress size={14} /> : null}{params.InputProps.endAdornment}</>) }} />
          )}
        />
        {allowUnassign && currentDoerId && (
          <FormControlLabel
            control={<Checkbox checked={unassign} onChange={(e) => { setUnassign(e.target.checked); setSelected(null); }} />}
            label="Leave this step unassigned"
          />
        )}
        {missing && (
          <Alert severity="warning">
            This user does not currently have permission to perform this step ({(selected.missingPermissions || []).join(', ')}).
            Being the doer does not grant access — they will not be able to act until the permission is granted.
            <FormControlLabel sx={{ display: 'flex', mt: 1 }}
              control={<Checkbox size="small" checked={ack} onChange={(e) => setAck(e.target.checked)} />}
              label={<Typography variant="body2" fontWeight={600}>Assign anyway</Typography>} />
          </Alert>
        )}
        <TextField label="Reason" fullWidth multiline minRows={2} value={reason}
          onChange={(e) => setReason(e.target.value)} placeholder="Optional — recorded in the audit history" />
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={() => onClose?.()} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!canSave}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DoerPickerDialog;
