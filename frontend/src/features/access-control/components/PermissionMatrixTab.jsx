import React, { useMemo, useState } from 'react';
import {
  Box, Stack, TextField, InputAdornment, Tooltip, Chip, Avatar, Typography,
  Select, MenuItem, alpha, useTheme, Paper, Skeleton,
} from '@mui/material';
import { Search, Check, X, CircleDot, Crown } from 'lucide-react';
import {
  useListAccessUsersQuery,
  useGetPermissionRegistryQuery,
} from '../../../store/api/accessControlApi';

const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase() || '?';

const cellStateFor = (user, slug, allowedByRole) => {
  // Precomputed `allowedByRole` is a Set per user.
  if (user.permissionDenies?.includes(slug)) return 'denied';
  if (user.permissionGrants?.includes(slug)) return 'granted';
  if (user.isRoot) return 'role';
  if (allowedByRole.has(slug)) return 'role';
  return 'off';
};

const PermissionMatrixTab = () => {
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');

  const { data: usersRes, isFetching: uLoading } = useListAccessUsersQuery({});
  const { data: regRes,   isFetching: rLoading } = useGetPermissionRegistryQuery();

  const users  = usersRes?.data || [];
  const groups = regRes?.data?.grouped || [];

  // We need to know which slugs each role grants — fetch role list via the same registry
  // is not enough; instead derive `allowedByRole` from each user's `roleLabels` is
  // unreliable. We'll compute by listing roles separately.
  // For matrix correctness we re-use the user.roleLabels + an inline role map fetched here.
  // To keep this tab self-contained we infer from the registry: if a user is root, all true;
  // otherwise we cannot list role permissions without /roles. We'll fetch lazily below.
  // For now, use a simplified rule: rely on the backend-computed effective set if present.

  const visibleGroups = useMemo(() => {
    let g = groups;
    if (moduleFilter !== 'all') g = g.filter((x) => x.module === moduleFilter);
    return g;
  }, [groups, moduleFilter]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q),
    );
  }, [users, search]);

  return (
    <Box>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
        <TextField
          size="small"
          placeholder="Filter users…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ width: { xs: '100%', md: 280 } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search size={16} color={theme.palette.text.secondary} />
              </InputAdornment>
            ),
          }}
        />
        <Select
          size="small"
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="all">All modules</MenuItem>
          {groups.map((g) => (
            <MenuItem key={g.module} value={g.module}>{g.module}</MenuItem>
          ))}
        </Select>

        <Box sx={{ flex: 1 }} />

        <Stack direction="row" spacing={1.5} sx={{ fontSize: '0.74rem' }}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Check size={14} color={theme.palette.primary.main} />
            <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>via role</Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <CircleDot size={14} color={theme.palette.success.main} />
            <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>granted</Typography>
          </Stack>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <X size={14} color={theme.palette.error.main} />
            <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>denied</Typography>
          </Stack>
        </Stack>
      </Stack>

      {(uLoading || rLoading) && (
        <Skeleton variant="rectangular" height={360} sx={{ borderRadius: 3 }} />
      )}

      {!uLoading && !rLoading && (
        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Box sx={{
              display: 'grid',
              gridTemplateColumns: `260px repeat(${visibleGroups.reduce((n, g) => n + g.items.length, 0)}, 56px)`,
              minWidth: 'fit-content',
            }}>
              {/* Header — group bar */}
              <Box sx={{
                position: 'sticky', left: 0, zIndex: 2,
                bgcolor: alpha(theme.palette.primary.main, 0.04),
                borderRight: `1px solid ${theme.palette.divider}`,
                borderBottom: `1px solid ${theme.palette.divider}`,
                p: 1,
              }} />
              {visibleGroups.map((g) => (
                <Box
                  key={g.module}
                  sx={{
                    gridColumn: `span ${g.items.length}`,
                    bgcolor: alpha(theme.palette.primary.main, 0.04),
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    py: 1, px: 1.25,
                  }}
                >
                  <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.secondary' }}>
                    {g.module}
                  </Typography>
                </Box>
              ))}

              {/* Header — slugs row */}
              <Box sx={{
                position: 'sticky', left: 0, zIndex: 2,
                bgcolor: theme.palette.background.paper,
                borderRight: `1px solid ${theme.palette.divider}`,
                borderBottom: `1px solid ${theme.palette.divider}`,
                px: 1.5, py: 1.25,
              }}>
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  User · {filteredUsers.length}
                </Typography>
              </Box>
              {visibleGroups.flatMap((g) => g.items.map((it) => (
                <Tooltip key={it.slug} title={`${it.label} (${it.slug}) · ${it.risk?.toUpperCase()}`}>
                  <Box sx={{
                    px: 0.5, py: 1, borderBottom: `1px solid ${theme.palette.divider}`,
                    borderLeft: `1px solid ${theme.palette.divider}`,
                    display: 'grid', placeItems: 'center',
                    bgcolor: theme.palette.background.paper,
                  }}>
                    <Typography sx={{
                      fontSize: '0.62rem', fontWeight: 700, color: 'text.secondary',
                      writingMode: 'vertical-rl', transform: 'rotate(180deg)',
                      whiteSpace: 'nowrap', maxHeight: 80, overflow: 'hidden',
                    }}>
                      {it.slug.split('.')[1]}
                    </Typography>
                  </Box>
                </Tooltip>
              )))}

              {/* User rows */}
              {filteredUsers.map((u) => {
                // For role-based matrix coloring we can only rely on what backend tells us.
                // We approximate "via role" via a heuristic: user is not denied & not granted
                // but is allowed — this requires per-user effective set. Without /users/:id
                // for every user (expensive), we show 3 simple states using user fields.
                // Improvement opportunity: backend could pre-compute per-user effective list.
                const denySet  = new Set(u.permissionDenies || []);
                const grantSet = new Set(u.permissionGrants || []);
                return (
                  <React.Fragment key={u._id}>
                    <Box sx={{
                      position: 'sticky', left: 0, zIndex: 1,
                      bgcolor: theme.palette.background.paper,
                      borderRight: `1px solid ${theme.palette.divider}`,
                      borderBottom: `1px solid ${theme.palette.divider}`,
                      px: 1.5, py: 1,
                      display: 'flex', alignItems: 'center', gap: 1,
                    }}>
                      <Avatar sx={{
                        width: 28, height: 28, fontSize: '0.7rem', fontWeight: 700,
                        background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)', color: '#fff',
                      }}>{initials(u.name)}</Avatar>
                      <Box sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Typography sx={{ fontWeight: 700, fontSize: '0.76rem' }} noWrap>{u.name}</Typography>
                          {u.isRoot && <Crown size={11} color={theme.palette.warning.dark} />}
                        </Stack>
                        <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled' }} noWrap>{u.email}</Typography>
                      </Box>
                    </Box>

                    {visibleGroups.flatMap((g) => g.items.map((it) => {
                      let state = 'off';
                      if (u.isRoot) state = 'role';
                      else if (denySet.has(it.slug))  state = 'denied';
                      else if (grantSet.has(it.slug)) state = 'granted';
                      // role-derived "on" cannot be inferred from listUsers payload — leave as 'unknown' visually neutral

                      const icon =
                        state === 'role'    ? <Check size={14} color={theme.palette.primary.main} />
                        : state === 'granted' ? <CircleDot size={14} color={theme.palette.success.main} />
                        : state === 'denied'  ? <X size={14} color={theme.palette.error.main} />
                        : null;

                      return (
                        <Box key={`${u._id}-${it.slug}`} sx={{
                          borderBottom: `1px solid ${theme.palette.divider}`,
                          borderLeft: `1px solid ${theme.palette.divider}`,
                          display: 'grid', placeItems: 'center',
                          py: 1.5,
                          bgcolor: state === 'denied'
                            ? alpha(theme.palette.error.main, 0.05)
                            : state === 'granted'
                              ? alpha(theme.palette.success.main, 0.05)
                              : state === 'role'
                                ? alpha(theme.palette.primary.main, 0.04)
                                : theme.palette.background.paper,
                        }}>
                          {icon}
                        </Box>
                      );
                    }))}
                  </React.Fragment>
                );
              })}
            </Box>
          </Box>

          {filteredUsers.length === 0 && (
            <Box sx={{ p: 6, textAlign: 'center', color: 'text.disabled' }}>
              <Typography sx={{ fontWeight: 600 }}>No users match the filter.</Typography>
            </Box>
          )}
        </Paper>
      )}

      <Typography sx={{ mt: 1.5, fontSize: '0.72rem', color: 'text.disabled' }}>
        Cells show direct grants/denies and root access. For inherited (role-based) permissions,
        open a user to see the full provenance.
      </Typography>
    </Box>
  );
};

export default PermissionMatrixTab;
