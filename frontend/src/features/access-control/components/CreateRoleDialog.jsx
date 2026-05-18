import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Stack, Typography, Box, CircularProgress, alpha, useTheme,
} from '@mui/material';
import { KeyRound } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import {
  useCreateRoleMutation,
  useGetPermissionRegistryQuery,
} from '../../../store/api/accessControlApi';
import PermissionPicker from './PermissionPicker';

const slugify = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

const CreateRoleDialog = ({ open, onClose }) => {
  const theme = useTheme();
  const [form, setForm] = useState({ key: '', name: '', description: '', permissions: [] });
  const [autoKey, setAutoKey] = useState(true);
  const { data: regRes } = useGetPermissionRegistryQuery(undefined, { skip: !open });
  const [createRole, { isLoading }] = useCreateRoleMutation();

  useEffect(() => {
    if (!open) {
      setForm({ key: '', name: '', description: '', permissions: [] });
      setAutoKey(true);
    }
  }, [open]);

  const handleNameChange = (v) => {
    setForm((f) => ({ ...f, name: v, key: autoKey ? slugify(v) : f.key }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await createRole({
        key: form.key,
        name: form.name.trim(),
        description: form.description.trim(),
        permissions: form.permissions,
      }).unwrap();
      enqueueSnackbar('Role created', { variant: 'success' });
      onClose();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to create role', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ pt: 3, px: 3, pb: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{
          width: 40, height: 40, borderRadius: 2,
          display: 'grid', placeItems: 'center',
          bgcolor: alpha(theme.palette.primary.main, 0.10), color: theme.palette.primary.dark,
        }}>
          <KeyRound size={20} />
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1.05rem' }}>Create a role</Typography>
          <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
            Bundle related permissions into a reusable role.
          </Typography>
        </Box>
      </DialogTitle>

      <form onSubmit={handleSubmit}>
        <DialogContent sx={{ px: 3, py: 2 }}>
          <Stack spacing={2}>
            <TextField
              label="Display name"
              value={form.name}
              onChange={(e) => handleNameChange(e.target.value)}
              required
              fullWidth
              autoFocus
            />
            <TextField
              label="Role key"
              value={form.key}
              onChange={(e) => { setAutoKey(false); setForm((f) => ({ ...f, key: e.target.value.toUpperCase() })); }}
              helperText="UPPER_SNAKE_CASE, must start with a letter. Used internally — cannot be changed later."
              required
              fullWidth
              inputProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } }}
            />
            <TextField
              label="Description (optional)"
              multiline rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              fullWidth
            />

            <Box>
              <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: 'text.secondary', mb: 1, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Permissions · {form.permissions.length} selected
              </Typography>
              <Box sx={{
                maxHeight: 360, overflowY: 'auto', pr: 0.5,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 2, p: 1.25,
              }}>
                <PermissionPicker
                  groups={regRes?.data?.grouped || []}
                  selected={form.permissions}
                  onChange={(next) => setForm((f) => ({ ...f, permissions: next }))}
                />
              </Box>
            </Box>
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={onClose} sx={{ color: 'text.secondary', fontWeight: 700 }}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isLoading || !form.name.trim() || !/^[A-Z][A-Z0-9_]{1,40}$/.test(form.key)}
            sx={{ fontWeight: 700, px: 3 }}
          >
            {isLoading ? <CircularProgress size={20} color="inherit" /> : 'Create role'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default CreateRoleDialog;
