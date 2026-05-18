import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  Stack, Typography, Chip, Box, CircularProgress, alpha, useTheme, Autocomplete,
} from '@mui/material';
import { UserPlus } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import { useInviteUserMutation, useListRolesQuery } from '../../../store/api/accessControlApi';

const InviteUserDialog = ({ open, onClose, onInvited }) => {
  const theme = useTheme();
  const [form, setForm] = useState({ name: '', email: '', roles: [] });
  const { data: rolesData } = useListRolesQuery();
  const [invite, { isLoading }] = useInviteUserMutation();

  const roles = useMemo(() => (rolesData?.data || []).map((r) => ({
    key: r.key, name: r.name, isRoot: r.isRoot,
  })), [rolesData]);

  useEffect(() => {
    if (!open) setForm({ name: '', email: '', roles: [] });
  }, [open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await invite({
        name:  form.name.trim(),
        email: form.email.trim(),
        roles: form.roles.map((r) => r.key),
      }).unwrap();
      onInvited?.(res.data);
      onClose();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to invite user', { variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ pt: 3, px: 3, pb: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{
          width: 40, height: 40, borderRadius: 2,
          display: 'grid', placeItems: 'center',
          bgcolor: alpha(theme.palette.primary.main, 0.10), color: theme.palette.primary.dark,
        }}>
          <UserPlus size={20} />
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1.05rem' }}>Invite a user</Typography>
          <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
            Send them a temporary password; they can change it after first login.
          </Typography>
        </Box>
      </DialogTitle>

      <form onSubmit={handleSubmit}>
        <DialogContent sx={{ px: 3, py: 2 }}>
          <Stack spacing={2}>
            <TextField
              label="Full Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              fullWidth
              autoFocus
            />
            <TextField
              label="Email Address"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              required
              fullWidth
            />
            <Autocomplete
              multiple
              options={roles}
              value={form.roles}
              onChange={(_, v) => setForm((f) => ({ ...f, roles: v }))}
              getOptionLabel={(o) => o.name}
              isOptionEqualToValue={(a, b) => a.key === b.key}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    {...getTagProps({ index })}
                    key={option.key}
                    label={option.name}
                    size="small"
                    sx={{
                      bgcolor: option.isRoot ? alpha(theme.palette.warning.main, 0.15) : alpha(theme.palette.primary.main, 0.10),
                      color: option.isRoot ? theme.palette.warning.dark : theme.palette.primary.dark,
                      fontWeight: 700,
                    }}
                  />
                ))
              }
              renderInput={(params) => (
                <TextField {...params} label="Assign role(s)" placeholder="Pick one or more" />
              )}
            />
            <Box sx={{
              p: 1.5, borderRadius: 2,
              bgcolor: alpha(theme.palette.info.main, 0.06),
              border: `1px solid ${alpha(theme.palette.info.main, 0.18)}`,
            }}>
              <Typography sx={{ fontSize: '0.78rem', color: theme.palette.info.dark, fontWeight: 600 }}>
                A 6-digit temporary password will be generated automatically. You'll see it
                once on the next screen — copy it before navigating away.
              </Typography>
            </Box>
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={onClose} sx={{ color: 'text.secondary', fontWeight: 700 }}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isLoading || !form.name.trim() || !form.email.trim()}
            sx={{ fontWeight: 700, px: 3 }}
          >
            {isLoading ? <CircularProgress size={20} color="inherit" /> : 'Send invite'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default InviteUserDialog;
