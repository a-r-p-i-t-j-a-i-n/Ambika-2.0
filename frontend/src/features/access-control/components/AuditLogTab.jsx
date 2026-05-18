import React, { useMemo, useState } from 'react';
import {
  Box, Stack, Typography, Chip, Avatar, alpha, useTheme, Paper, Select, MenuItem,
  Skeleton, Pagination, Tooltip,
} from '@mui/material';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  UserPlus, Power, Shield, ShieldOff, KeyRound, Pencil, Trash2, RotateCcw,
} from 'lucide-react';
import { useGetAccessAuditLogQuery } from '../../../store/api/accessControlApi';

dayjs.extend(relativeTime);

const ACTION_META = {
  USER_INVITED:        { label: 'Invited',         icon: UserPlus, tone: 'primary' },
  USER_UPDATED:        { label: 'Updated',         icon: Pencil,   tone: 'primary' },
  USER_SUSPENDED:      { label: 'Suspended',       icon: Power,    tone: 'error' },
  USER_REACTIVATED:    { label: 'Reactivated',     icon: Power,    tone: 'success' },
  ROLE_ASSIGNED:       { label: 'Role assigned',   icon: KeyRound, tone: 'primary' },
  ROLE_REMOVED:        { label: 'Role removed',    icon: KeyRound, tone: 'warning' },
  PERMISSION_GRANTED:  { label: 'Permission +',    icon: Shield,   tone: 'success' },
  PERMISSION_DENIED:   { label: 'Permission –',    icon: ShieldOff,tone: 'error' },
  PERMISSION_RESET:    { label: 'Permission reset',icon: RotateCcw,tone: 'primary' },
  ROLE_CREATED:        { label: 'Role created',    icon: KeyRound, tone: 'success' },
  ROLE_UPDATED:        { label: 'Role updated',    icon: Pencil,   tone: 'primary' },
  ROLE_DELETED:        { label: 'Role deleted',    icon: Trash2,   tone: 'error' },
};

const TONE_COLORS = (theme) => ({
  primary: { color: theme.palette.primary.dark, bg: alpha(theme.palette.primary.main, 0.10) },
  success: { color: theme.palette.success.dark, bg: alpha(theme.palette.success.main, 0.10) },
  warning: { color: theme.palette.warning.dark, bg: alpha(theme.palette.warning.main, 0.10) },
  error:   { color: theme.palette.error.dark,   bg: alpha(theme.palette.error.main, 0.10) },
});

const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase() || '?';

const diffSummary = (before, after) => {
  if (!before && !after) return null;
  const lines = [];
  const keys = new Set([...(Object.keys(before || {})), ...(Object.keys(after || {}))]);
  for (const k of keys) {
    const b = JSON.stringify(before?.[k]);
    const a = JSON.stringify(after?.[k]);
    if (b !== a) {
      const fmt = (v) => v === undefined ? '—' : v;
      lines.push({ key: k, before: fmt(b), after: fmt(a) });
    }
  }
  return lines.slice(0, 4);
};

const AuditLogTab = () => {
  const theme = useTheme();
  const tones = TONE_COLORS(theme);
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isFetching } = useGetAccessAuditLogQuery({
    page, limit: 25, action: actionFilter || undefined,
  });

  const rows = data?.data?.rows || [];
  const total = data?.data?.total || 0;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <Box>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1rem' }}>Audit Log</Typography>
          <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
            {total} event{total === 1 ? '' : 's'} — append-only history of every access change.
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Select
          size="small"
          displayEmpty
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="">All actions</MenuItem>
          {Object.entries(ACTION_META).map(([k, v]) => (
            <MenuItem key={k} value={k}>{v.label}</MenuItem>
          ))}
        </Select>
      </Stack>

      <Paper sx={{ borderRadius: 3, p: 0 }}>
        {isFetching && rows.length === 0 && (
          <Stack spacing={1} sx={{ p: 2 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} variant="rectangular" height={64} sx={{ borderRadius: 2 }} />
            ))}
          </Stack>
        )}

        {rows.length === 0 && !isFetching && (
          <Box sx={{ p: 6, textAlign: 'center', color: 'text.disabled' }}>
            <Typography sx={{ fontWeight: 600 }}>No audit events yet.</Typography>
            <Typography sx={{ fontSize: '0.8rem' }}>
              Every access-control change will appear here.
            </Typography>
          </Box>
        )}

        <Stack divider={<Box sx={{ borderBottom: `1px solid ${theme.palette.divider}` }} />}>
          {rows.map((row) => {
            const meta = ACTION_META[row.action] || { label: row.action, icon: Pencil, tone: 'primary' };
            const tone = tones[meta.tone];
            const Icon = meta.icon;
            const diffs = diffSummary(row.before, row.after);

            return (
              <Box key={row._id} sx={{ p: 2, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                <Avatar sx={{
                  width: 36, height: 36, fontSize: '0.78rem', fontWeight: 700,
                  background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)', color: '#fff',
                }}>{initials(row.actorName)}</Avatar>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography sx={{ fontWeight: 700, fontSize: '0.86rem' }}>
                      {row.actorName}
                    </Typography>
                    <Chip
                      size="small"
                      icon={<Icon size={11} style={{ marginLeft: 6 }} />}
                      label={meta.label}
                      sx={{
                        height: 20, fontSize: '0.65rem', fontWeight: 800,
                        color: tone.color, bgcolor: tone.bg,
                        border: `1px solid ${alpha(tone.color, 0.20)}`,
                        '& .MuiChip-icon': { color: 'inherit' },
                      }}
                    />
                    <Typography sx={{ fontSize: '0.76rem', color: 'text.secondary' }}>
                      → <strong>{row.targetLabel}</strong> ({row.targetType})
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Tooltip title={dayjs(row.createdAt).format('DD MMM YYYY · HH:mm:ss')}>
                      <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled' }}>
                        {dayjs(row.createdAt).fromNow()}
                      </Typography>
                    </Tooltip>
                  </Stack>

                  {row.reason && (
                    <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary', mt: 0.5, fontStyle: 'italic' }}>
                      "{row.reason}"
                    </Typography>
                  )}

                  {diffs && diffs.length > 0 && (
                    <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.75 }}>
                      {diffs.map((d) => (
                        <Box key={d.key} sx={{
                          px: 1, py: 0.25, borderRadius: 1,
                          bgcolor: alpha(theme.palette.text.secondary, 0.04),
                          border: `1px solid ${theme.palette.divider}`,
                          fontSize: '0.7rem',
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        }}>
                          <strong style={{ color: theme.palette.text.secondary }}>{d.key}</strong>
                          {' '}
                          <span style={{ color: theme.palette.error.dark, textDecoration: 'line-through' }}>
                            {String(d.before).slice(0, 80)}
                          </span>
                          {' → '}
                          <span style={{ color: theme.palette.success.dark }}>
                            {String(d.after).slice(0, 80)}
                          </span>
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Box>
              </Box>
            );
          })}
        </Stack>
      </Paper>

      {pages > 1 && (
        <Stack alignItems="center" sx={{ mt: 2 }}>
          <Pagination count={pages} page={page} onChange={(_, p) => setPage(p)} color="primary" />
        </Stack>
      )}
    </Box>
  );
};

export default AuditLogTab;
