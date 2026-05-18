import React, { useState } from 'react';
import {
  Box, Typography, Tabs, Tab, Stack, Chip, Paper, alpha, useTheme,
} from '@mui/material';
import {
  ShieldCheck, Users as UsersIcon, KeyRound, LayoutGrid, ScrollText, Crown,
} from 'lucide-react';
import UsersTab from './components/UsersTab';
import RolesTab from './components/RolesTab';
import PermissionMatrixTab from './components/PermissionMatrixTab';
import AuditLogTab from './components/AuditLogTab';
import { usePermissions } from '../../hooks/usePermission';

const TABS = [
  { key: 'users',  label: 'Users',              icon: UsersIcon },
  { key: 'roles',  label: 'Roles',              icon: KeyRound  },
  { key: 'matrix', label: 'Permission Matrix',  icon: LayoutGrid },
  { key: 'audit',  label: 'Audit Log',          icon: ScrollText },
];

const AccessControl = () => {
  const theme = useTheme();
  const [tab, setTab] = useState('users');
  const { isRoot } = usePermissions();

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* ── Hero header ─────────────────────────────────────────── */}
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          color: '#ffffff',
          background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)',
          px: { xs: 3, md: 5 }, pt: { xs: 4, md: 5 }, pb: { xs: 5, md: 7 },
        }}
      >
        {/* decorative orbs */}
        <Box aria-hidden sx={{
          position: 'absolute', width: 420, height: 420, borderRadius: '50%',
          top: -160, right: -120,
          background: 'radial-gradient(circle, rgba(96,165,250,0.32) 0%, rgba(96,165,250,0) 60%)',
        }} />
        <Box aria-hidden sx={{
          position: 'absolute', width: 360, height: 360, borderRadius: '50%',
          bottom: -160, left: -100,
          background: 'radial-gradient(circle, rgba(91,108,255,0.30) 0%, rgba(91,108,255,0) 60%)',
        }} />

        <Stack direction="row" spacing={2.5} alignItems="center" sx={{ position: 'relative', mb: 1.5 }}>
          <Box sx={{
            width: 52, height: 52, borderRadius: 2.5,
            display: 'grid', placeItems: 'center',
            background: 'rgba(255,255,255,0.14)',
            border: '1px solid rgba(255,255,255,0.22)',
            backdropFilter: 'blur(8px)',
          }}>
            <ShieldCheck size={26} strokeWidth={2.2} color="#ffffff" />
          </Box>
          <Box>
            <Stack direction="row" spacing={1.25} alignItems="center">
              <Typography sx={{ color: '#ffffff', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 800, letterSpacing: '-0.02em' }}>
                Access Control
              </Typography>
              {isRoot && (
                <Chip
                  icon={<Crown size={13} style={{ marginLeft: 6 }} />}
                  label="MD · Root"
                  size="small"
                  sx={{
                    bgcolor: 'rgba(255,255,255,0.15)',
                    color: '#ffffff',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    border: '1px solid rgba(255,255,255,0.25)',
                    '& .MuiChip-icon': { color: '#ffffff' },
                  }}
                />
              )}
            </Stack>
            <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.95rem', mt: 0.5, maxWidth: 720 }}>
              Govern who can do what across every module. Roles flow from the MD;
              every grant, deny and assignment is permanently audited.
            </Typography>
          </Box>
        </Stack>
      </Box>

      {/* ── Tab strip ──────────────────────────────────────────── */}
      <Paper
        elevation={0}
        sx={{
          mx: { xs: 2, md: 4 },
          mt: { xs: -3, md: -4 },
          position: 'relative',
          borderRadius: 3,
          border: `1px solid ${theme.palette.divider}`,
          boxShadow: '0 16px 40px rgba(30, 58, 138, 0.12)',
          overflow: 'hidden',
        }}
      >
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{
            px: 1,
            borderBottom: `1px solid ${theme.palette.divider}`,
            bgcolor: alpha(theme.palette.primary.main, 0.02),
          }}
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <Tab
                key={t.key}
                value={t.key}
                disableRipple
                label={
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
                    <Icon size={16} />
                    <span>{t.label}</span>
                  </Stack>
                }
              />
            );
          })}
        </Tabs>

        <Box sx={{ p: { xs: 2, md: 3 } }}>
          {tab === 'users'  && <UsersTab />}
          {tab === 'roles'  && <RolesTab />}
          {tab === 'matrix' && <PermissionMatrixTab />}
          {tab === 'audit'  && <AuditLogTab />}
        </Box>
      </Paper>

      <Box sx={{ height: 32 }} />
    </Box>
  );
};

export default AccessControl;
