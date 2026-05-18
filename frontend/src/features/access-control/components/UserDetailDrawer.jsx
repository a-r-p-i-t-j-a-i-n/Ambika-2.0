import React, { useEffect, useMemo, useState } from 'react';
import {
  Drawer, Box, Stack, Typography, IconButton, Avatar, Chip, Button, Divider,
  Switch, FormControlLabel, alpha, useTheme, Autocomplete, TextField,
  CircularProgress, Skeleton,
} from '@mui/material';
import { X, Crown, ShieldCheck, Save, Power } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import {
  useGetAccessUserQuery,
  useGetPermissionRegistryQuery,
  useListRolesQuery,
  useUpdateAccessUserMutation,
} from '../../../store/api/accessControlApi';
import PermissionPicker from './PermissionPicker';

const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase() || '?';

const UserDetailDrawer = ({ userId, open, onClose }) => {
  const theme = useTheme();
  const { data: detailRes, isFetching } = useGetAccessUserQuery(userId, { skip: !userId });
  const { data: registryRes } = useGetPermissionRegistryQuery(undefined, { skip: !open });
  const { data: rolesRes }    = useListRolesQuery(undefined, { skip: !open });
  const [updateUser, { isLoading: saving }] = useUpdateAccessUserMutation();

  const detail   = detailRes?.data;
  const groups   = registryRes?.data?.grouped || [];
  const allRoles = rolesRes?.data || [];

  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);

  // Initialize form when detail loads
  useEffect(() => {
    if (!detail?.user) return;
    setForm({
      roles:            [...(detail.user.roles || [])],
      permissionGrants: [...(detail.user.permissionGrants || [])],
      permissionDenies: [...(detail.user.permissionDenies || [])],
      isActive:         detail.user.isActive !== false,
    });
    setDirty(false);
  }, [detail]);

  const isRootTarget = !!detail?.isRoot;

  const roleObjects = useMemo(
    () => allRoles.filter((r) => form?.roles?.includes(r.key)),
    [allRoles, form],
  );

  const handleSave = async () => {
    if (!form) return;
    try {
      await updateUser({
        id: userId,
        roles: form.roles,
        permissionGrants: form.permissionGrants,
        permissionDenies: form.permissionDenies,
        isActive: form.isActive,
      }).unwrap();
      enqueueSnackbar('Access updated', { variant: 'success' });
      setDirty(false);
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to update access', { variant: 'error' });
    }
  };

  const summary = useMemo(() => {
    if (!detail) return { effective: 0, granted: 0, denied: 0 };
    return {
      effective: detail.effectivePermissions?.length || 0,
      granted:   form?.permissionGrants?.length || 0,
      denied:    form?.permissionDenies?.length || 0,
    };
  }, [detail, form]);

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
      {/* ── Header ─────────────────────────────────────────────── */}
      <Box sx={{
        px: 2.5, py: 2,
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 60%, #1d4ed8 100%)',
        color: '#fff',
        position: 'relative',
      }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Avatar sx={{
            width: 48, height: 48, fontWeight: 800, fontSize: '0.95rem',
            background: 'rgba(255,255,255,0.16)', color: '#fff',
            border: '1px solid rgba(255,255,255,0.25)',
          }}>
            {initials(detail?.user?.name)}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: '1.05rem' }} noWrap>
                {detail?.user?.name || (isFetching ? 'Loading…' : 'User')}
              </Typography>
              {isRootTarget && (
                <Chip
                  size="small"
                  icon={<Crown size={11} style={{ marginLeft: 6 }} />}
                  label="ROOT"
                  sx={{
                    height: 18, fontSize: '0.6rem', fontWeight: 800,
                    bgcolor: alpha('#fbbf24', 0.25), color: '#fde68a',
                    border: '1px solid rgba(253, 224, 71, 0.4)',
                    '& .MuiChip-icon': { color: '#fde68a' },
                  }}
                />
              )}
            </Stack>
            <Typography sx={{ color: 'rgba(255,255,255,0.78)', fontSize: '0.8rem' }} noWrap>
              {detail?.user?.email}
            </Typography>
          </Box>
          <IconButton size="small" onClick={onClose} sx={{ color: '#fff', '&:hover': { bgcolor: alpha('#fff', 0.12), color: '#fff' } }}>
            <X size={18} />
          </IconButton>
        </Stack>

        {/* Stat strip */}
        <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
          {[
            { label: 'Effective', value: summary.effective, color: '#bfdbfe' },
            { label: 'Granted',   value: summary.granted,   color: '#a7f3d0' },
            { label: 'Denied',    value: summary.denied,    color: '#fecaca' },
          ].map((s) => (
            <Box key={s.label} sx={{
              flex: 1, p: 1, borderRadius: 1.5,
              bgcolor: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.18)',
            }}>
              <Typography sx={{ color: s.color, fontWeight: 800, fontSize: '1.1rem', lineHeight: 1 }}>
                {s.value}
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', mt: 0.25 }}>
                {s.label}
              </Typography>
            </Box>
          ))}
        </Stack>
      </Box>

      {/* ── Body ───────────────────────────────────────────────── */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, py: 2.5 }}>
        {(!detail || !form) && (
          <Stack spacing={1.5}>
            <Skeleton variant="rectangular" height={64} sx={{ borderRadius: 2 }} />
            <Skeleton variant="rectangular" height={100} sx={{ borderRadius: 2 }} />
            <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 2 }} />
          </Stack>
        )}

        {detail && form && (
          <>
            {/* Roles */}
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.secondary', mb: 1 }}>
              Roles
            </Typography>
            <Autocomplete
              multiple
              options={allRoles}
              getOptionLabel={(r) => r.name}
              isOptionEqualToValue={(a, b) => a.key === b.key}
              value={roleObjects}
              onChange={(_, v) => { setForm((f) => ({ ...f, roles: v.map((x) => x.key) })); setDirty(true); }}
              disabled={isRootTarget}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip
                    {...getTagProps({ index })}
                    key={option.key}
                    label={option.name}
                    icon={option.isRoot ? <Crown size={12} style={{ marginLeft: 6 }} /> : undefined}
                    size="small"
                    sx={{
                      bgcolor: option.isRoot ? alpha(theme.palette.warning.main, 0.15) : alpha(theme.palette.primary.main, 0.10),
                      color: option.isRoot ? theme.palette.warning.dark : theme.palette.primary.dark,
                      fontWeight: 700,
                      '& .MuiChip-icon': { color: 'inherit' },
                    }}
                  />
                ))
              }
              renderInput={(params) => <TextField {...params} placeholder="Pick role(s)" />}
            />

            {/* Status toggle */}
            <Box sx={{
              mt: 2, p: 1.5, borderRadius: 2,
              border: `1px solid ${theme.palette.divider}`,
              bgcolor: theme.palette.background.paper,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box sx={{
                  width: 32, height: 32, borderRadius: 1.5, display: 'grid', placeItems: 'center',
                  bgcolor: alpha(form.isActive ? theme.palette.success.main : theme.palette.error.main, 0.10),
                  color: form.isActive ? theme.palette.success.dark : theme.palette.error.dark,
                }}>
                  <Power size={16} />
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 700, fontSize: '0.86rem' }}>
                    {form.isActive ? 'Active account' : 'Suspended account'}
                  </Typography>
                  <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary' }}>
                    Suspended users keep their data but cannot sign in.
                  </Typography>
                </Box>
              </Stack>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.isActive}
                    onChange={(_, v) => { setForm((f) => ({ ...f, isActive: v })); setDirty(true); }}
                  />
                }
                label=""
                sx={{ m: 0 }}
              />
            </Box>

            <Divider sx={{ my: 2.5 }} />

            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
              <ShieldCheck size={16} color={theme.palette.primary.main} />
              <Typography sx={{ fontWeight: 800, fontSize: '0.95rem' }}>Effective permissions</Typography>
            </Stack>
            <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mb: 2 }}>
              Each row shows the slug, label, risk, and how the user currently has access
              ("From {`<role>`}", granted directly, denied directly, or not allowed). Use the
              toggle to override on a per-permission basis.
            </Typography>

            <PermissionPicker
              groups={groups}
              userMode
              isRootTarget={isRootTarget}
              provenance={detail.provenance || {}}
              grants={form.permissionGrants}
              denies={form.permissionDenies}
              onChange={({ grants, denies }) => {
                setForm((f) => ({ ...f, permissionGrants: grants, permissionDenies: denies }));
                setDirty(true);
              }}
            />
          </>
        )}
      </Box>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <Box sx={{
        px: 2.5, py: 1.75,
        borderTop: `1px solid ${theme.palette.divider}`,
        bgcolor: theme.palette.background.default,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5,
      }}>
        <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary' }}>
          {dirty ? 'Unsaved changes — they will be audited on save.' : 'No unsaved changes.'}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose} sx={{ color: 'text.secondary', fontWeight: 700 }}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={!saving && <Save size={16} />}
            disabled={!dirty || saving || isRootTarget}
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

export default UserDetailDrawer;
