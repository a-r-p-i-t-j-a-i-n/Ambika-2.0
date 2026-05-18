import React, { useEffect, useState } from 'react';
import {
  Drawer, Box, Stack, Typography, IconButton, Chip, Button, Divider,
  TextField, alpha, useTheme, CircularProgress, Skeleton,
} from '@mui/material';
import { X, Crown, KeyRound, Save, Trash2, Lock } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import {
  useGetRoleQuery,
  useGetPermissionRegistryQuery,
  useUpdateRoleMutation,
  useDeleteRoleMutation,
} from '../../../store/api/accessControlApi';
import PermissionPicker from './PermissionPicker';

const RoleDetailDrawer = ({ roleId, open, onClose }) => {
  const theme = useTheme();
  const { data: roleRes, isFetching } = useGetRoleQuery(roleId, { skip: !roleId });
  const { data: regRes }              = useGetPermissionRegistryQuery(undefined, { skip: !open });
  const [updateRole, { isLoading: saving }]   = useUpdateRoleMutation();
  const [deleteRole, { isLoading: deleting }] = useDeleteRoleMutation();

  const role   = roleRes?.data;
  const groups = regRes?.data?.grouped || [];

  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!role) return;
    setForm({
      name:        role.name,
      description: role.description || '',
      permissions: [...(role.permissions || [])],
    });
    setDirty(false);
  }, [role]);

  const isRoot   = !!role?.isRoot;
  const isSystem = !!role?.isSystem;

  const handleSave = async () => {
    try {
      await updateRole({
        id: roleId,
        name: form.name.trim(),
        description: form.description,
        permissions: form.permissions,
      }).unwrap();
      enqueueSnackbar('Role updated', { variant: 'success' });
      setDirty(false);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to update role', { variant: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    try {
      await deleteRole(roleId).unwrap();
      enqueueSnackbar('Role deleted', { variant: 'success' });
      onClose();
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to delete role', { variant: 'error' });
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: { xs: '100%', sm: 560 },
          borderTopLeftRadius: { xs: 0, sm: 16 },
          borderBottomLeftRadius: { xs: 0, sm: 16 },
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        },
      }}
    >
      <Box sx={{
        px: 2.5, py: 2,
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 60%, #1d4ed8 100%)',
        color: '#fff',
      }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Box sx={{
            width: 48, height: 48, borderRadius: 2,
            display: 'grid', placeItems: 'center',
            background: 'rgba(255,255,255,0.16)',
            border: '1px solid rgba(255,255,255,0.22)',
          }}>
            {isRoot ? <Crown size={22} color="#fde68a" /> : <KeyRound size={22} color="#fff" />}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
              <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: '1.05rem' }} noWrap>
                {role?.name || 'Role'}
              </Typography>
              {isRoot && (
                <Chip size="small" label="ROOT" sx={{
                  height: 18, fontSize: '0.6rem', fontWeight: 800,
                  bgcolor: alpha('#fbbf24', 0.25), color: '#fde68a',
                  border: '1px solid rgba(253, 224, 71, 0.4)',
                }} />
              )}
              {isSystem && !isRoot && (
                <Chip size="small" icon={<Lock size={11} style={{ marginLeft: 6 }}/>}
                  label="SYSTEM"
                  sx={{
                    height: 18, fontSize: '0.6rem', fontWeight: 800,
                    bgcolor: 'rgba(255,255,255,0.15)', color: '#fff',
                    border: '1px solid rgba(255,255,255,0.25)',
                    '& .MuiChip-icon': { color: '#fff' },
                  }} />
              )}
            </Stack>
            <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.78rem', fontFamily: 'ui-monospace, monospace' }}>
              {role?.key}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} sx={{ color: '#fff', '&:hover': { bgcolor: alpha('#fff', 0.12), color: '#fff' } }}>
            <X size={18} />
          </IconButton>
        </Stack>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, py: 2.5 }}>
        {(!role || !form) && (
          <Stack spacing={1.5}>
            <Skeleton variant="rectangular" height={48} sx={{ borderRadius: 2 }} />
            <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 2 }} />
          </Stack>
        )}

        {role && form && (
          <>
            <Stack spacing={2} sx={{ mb: 3 }}>
              <TextField
                label="Display name"
                value={form.name}
                onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setDirty(true); }}
                disabled={isRoot}
                fullWidth
              />
              <TextField
                label="Description"
                multiline
                rows={2}
                value={form.description}
                onChange={(e) => { setForm((f) => ({ ...f, description: e.target.value })); setDirty(true); }}
                disabled={isRoot}
                fullWidth
              />
            </Stack>

            <Divider sx={{ my: 1.5 }} />

            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
              <Typography sx={{ fontWeight: 800, fontSize: '0.95rem' }}>Permissions</Typography>
              {!isRoot && (
                <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary' }}>
                  {form.permissions.length} selected
                </Typography>
              )}
            </Stack>

            <PermissionPicker
              groups={groups}
              selected={form.permissions}
              onChange={(next) => { setForm((f) => ({ ...f, permissions: next })); setDirty(true); }}
              isRootTarget={isRoot}
            />
          </>
        )}
      </Box>

      <Box sx={{
        px: 2.5, py: 1.75,
        borderTop: `1px solid ${theme.palette.divider}`,
        bgcolor: theme.palette.background.default,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5,
      }}>
        <Box>
          {!isRoot && !isSystem && (
            <Button
              size="small"
              color="error"
              startIcon={<Trash2 size={14} />}
              onClick={handleDelete}
              disabled={deleting}
              sx={{ fontWeight: 700, textTransform: 'none' }}
            >
              Delete role
            </Button>
          )}
        </Box>
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose} sx={{ color: 'text.secondary', fontWeight: 700 }}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={!saving && <Save size={16} />}
            disabled={!dirty || saving || isRoot}
            onClick={handleSave}
            sx={{ fontWeight: 700, px: 3 }}
          >
            {saving ? <CircularProgress size={18} color="inherit" /> : 'Save changes'}
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
};

export default RoleDetailDrawer;
