import React, { useMemo, useState } from 'react';
import {
  Box, Stack, TextField, InputAdornment, Button, Chip, IconButton, Tooltip,
  Avatar, Typography, ToggleButtonGroup, ToggleButton, Paper, alpha, useTheme,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Search, UserPlus, Crown, Power, RefreshCw } from 'lucide-react';
import { enqueueSnackbar } from 'notistack';
import dayjs from 'dayjs';
import { useListAccessUsersQuery } from '../../../store/api/accessControlApi';
import UserDetailDrawer from './UserDetailDrawer';
import InviteUserDialog from './InviteUserDialog';

const STATUS_OPTIONS = [
  { value: 'all',       label: 'All' },
  { value: 'active',    label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase() || '?';

const UsersTab = () => {
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const { data, isFetching, refetch } = useListAccessUsersQuery({ search, status });
  const rows = data?.data || [];

  const columns = useMemo(() => [
    {
      field: 'name',
      headerName: 'User',
      flex: 1.4,
      minWidth: 260,
      renderCell: (p) => (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
          <Avatar sx={{
            width: 36, height: 36, fontSize: '0.78rem', fontWeight: 700,
            background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)', color: '#fff',
          }}>
            {initials(p.value)}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Typography sx={{ fontWeight: 700, fontSize: '0.86rem' }} noWrap>{p.value}</Typography>
              {p.row.isRoot && (
                <Tooltip title="Managing Director · root access">
                  <Crown size={13} color="#b45309" />
                </Tooltip>
              )}
            </Stack>
            <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary' }} noWrap>{p.row.email}</Typography>
          </Box>
        </Stack>
      ),
    },
    {
      field: 'roleLabels',
      headerName: 'Roles',
      flex: 1,
      minWidth: 220,
      renderCell: (p) => (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" alignItems="center" sx={{ gap: 0.5 }}>
          {(p.value || []).length === 0 && (
            <Typography sx={{ fontSize: '0.74rem', color: 'text.disabled', fontStyle: 'italic' }}>
              no role
            </Typography>
          )}
          {(p.value || []).map((label) => (
            <Chip
              key={label}
              label={label}
              size="small"
              sx={{
                bgcolor: alpha(theme.palette.primary.main, 0.10),
                color: theme.palette.primary.dark,
                fontWeight: 700, fontSize: '0.68rem', height: 22,
              }}
            />
          ))}
        </Stack>
      ),
    },
    {
      field: 'isActive',
      headerName: 'Status',
      width: 130,
      renderCell: (p) => (
        <Chip
          size="small"
          label={p.value === false ? 'Suspended' : 'Active'}
          sx={{
            height: 24, fontWeight: 700, fontSize: '0.7rem',
            color: p.value === false ? theme.palette.error.dark : theme.palette.success.dark,
            bgcolor: p.value === false ? alpha(theme.palette.error.main, 0.10) : alpha(theme.palette.success.main, 0.10),
            border: `1px solid ${p.value === false ? alpha(theme.palette.error.main, 0.22) : alpha(theme.palette.success.main, 0.22)}`,
          }}
        />
      ),
    },
    {
      field: 'lastLoginAt',
      headerName: 'Last login',
      width: 140,
      valueGetter: (_v, row) => row.lastLoginAt ? dayjs(row.lastLoginAt).fromNow?.() || dayjs(row.lastLoginAt).format('DD MMM') : '—',
      renderCell: (p) => (
        <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>{p.value}</Typography>
      ),
    },
    {
      field: 'createdAt',
      headerName: 'Member since',
      width: 150,
      valueGetter: (_v, row) => row.createdAt ? dayjs(row.createdAt).format('DD MMM YYYY') : '—',
      renderCell: (p) => (
        <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>{p.value}</Typography>
      ),
    },
  ], [theme]);

  return (
    <Box>
      {/* Toolbar */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        alignItems={{ md: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: { xs: '100%', md: 'auto' } }}>
          <TextField
            size="small"
            placeholder="Search users by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ width: { xs: '100%', md: 360 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={16} color={theme.palette.text.secondary} />
                </InputAdornment>
              ),
            }}
          />
          <ToggleButtonGroup
            exclusive
            value={status}
            onChange={(_, v) => v && setStatus(v)}
            size="small"
            sx={{
              '& .MuiToggleButton-root': {
                px: 1.5, py: 0.6, fontSize: '0.74rem', fontWeight: 700,
                border: `1px solid ${theme.palette.divider}`,
                color: 'text.secondary',
                '&.Mui-selected': {
                  bgcolor: alpha(theme.palette.primary.main, 0.10),
                  color: theme.palette.primary.dark,
                  borderColor: alpha(theme.palette.primary.main, 0.25),
                },
              },
            }}
          >
            {STATUS_OPTIONS.map((o) => (
              <ToggleButton key={o.value} value={o.value}>{o.label}</ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>

        <Stack direction="row" spacing={1}>
          <Tooltip title="Refresh">
            <IconButton onClick={refetch} sx={{ border: `1px solid ${theme.palette.divider}` }}>
              <RefreshCw size={16} />
            </IconButton>
          </Tooltip>
          <Button
            variant="contained"
            startIcon={<UserPlus size={16} />}
            onClick={() => setInviteOpen(true)}
            sx={{ fontWeight: 700 }}
          >
            Invite User
          </Button>
        </Stack>
      </Stack>

      {/* Grid */}
      <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <DataGrid
          rows={rows}
          columns={columns}
          getRowId={(r) => r._id}
          loading={isFetching}
          autoHeight
          rowHeight={64}
          disableRowSelectionOnClick
          onRowClick={(p) => setSelectedId(p.id)}
          sx={{
            cursor: 'pointer',
            '& .MuiDataGrid-row:hover': { bgcolor: alpha(theme.palette.primary.main, 0.05) },
          }}
        />
      </Paper>

      {/* Drawers + dialogs */}
      <UserDetailDrawer
        userId={selectedId}
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
      />
      <InviteUserDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={(payload) => {
          enqueueSnackbar(
            `User invited. Temporary password: ${payload.tempPassword}`,
            { variant: 'success', autoHideDuration: 8000 },
          );
        }}
      />
    </Box>
  );
};

export default UsersTab;
