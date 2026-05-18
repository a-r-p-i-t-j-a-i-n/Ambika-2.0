import React, { useMemo, useState } from 'react';
import {
  Box, Stack, Typography, Chip, Tooltip, ToggleButtonGroup, ToggleButton,
  TextField, InputAdornment, alpha, useTheme, Divider,
} from '@mui/material';
import { Search, ShieldCheck, ShieldX, ShieldQuestion, AlertTriangle } from 'lucide-react';

/**
 * Reusable grouped permission editor.
 *
 * Two modes:
 *   - `userMode`     — tri-state per row: Inherit | Grant | Deny
 *                       (used inside UserDetailDrawer)
 *   - role mode      — binary per row: Off | On
 *                       (used inside RoleDetailDrawer)
 *
 * Props:
 *   groups       — [{ module, items: [{ slug, label, risk }] }]
 *   provenance   — (userMode only) { slug: { source: 'role'|'granted'|'denied', roleName? } }
 *   grants       — string[] of slugs explicitly granted (userMode)
 *   denies       — string[] of slugs explicitly denied  (userMode)
 *   selected     — string[] (role mode)
 *   onChange     — userMode: ({ grants, denies }) => void
 *                  role mode: (string[]) => void
 *   isRootTarget — true when editing the MD role (read-only)
 *   lockedSlugs  — Set<string> of slugs the actor cannot edit
 */
const RISK_STYLES = (theme) => ({
  low:      { color: theme.palette.text.secondary, label: 'Low' },
  medium:   { color: theme.palette.info.dark, label: 'Medium' },
  high:     { color: theme.palette.warning.dark, label: 'High' },
  critical: { color: theme.palette.error.dark, label: 'Critical' },
});

const PermissionPicker = ({
  groups = [],
  provenance = {},
  grants = [],
  denies = [],
  selected = [],
  onChange,
  userMode = false,
  isRootTarget = false,
  lockedSlugs = new Set(),
}) => {
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const risks = RISK_STYLES(theme);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        items: g.items.filter(
          (it) => it.slug.toLowerCase().includes(q) || (it.label || '').toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [groups, search]);

  const stateFor = (slug) => {
    if (userMode) {
      if (grants.includes(slug)) return 'granted';
      if (denies.includes(slug)) return 'denied';
      const p = provenance[slug];
      if (p?.source === 'role') return 'inheritOn';
      return 'inheritOff';
    }
    return selected.includes(slug) ? 'on' : 'off';
  };

  const setUserState = (slug, next) => {
    const g = new Set(grants);
    const d = new Set(denies);
    g.delete(slug); d.delete(slug);
    if (next === 'granted') g.add(slug);
    if (next === 'denied')  d.add(slug);
    onChange?.({ grants: [...g], denies: [...d] });
  };

  const toggleRole = (slug) => {
    const set = new Set(selected);
    if (set.has(slug)) set.delete(slug); else set.add(slug);
    onChange?.([...set]);
  };

  return (
    <Box>
      <TextField
        size="small"
        placeholder="Filter permissions…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ width: '100%', mb: 1.5 }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Search size={16} color={theme.palette.text.secondary} />
            </InputAdornment>
          ),
        }}
      />

      {isRootTarget && (
        <Box sx={{
          p: 1.5, mb: 2, borderRadius: 2,
          bgcolor: alpha(theme.palette.warning.main, 0.08),
          border: `1px solid ${alpha(theme.palette.warning.main, 0.22)}`,
          display: 'flex', alignItems: 'center', gap: 1,
        }}>
          <AlertTriangle size={16} color={theme.palette.warning.dark} />
          <Typography sx={{ fontSize: '0.78rem', color: theme.palette.warning.dark, fontWeight: 600 }}>
            Root role — bypasses every permission. Settings here are read-only.
          </Typography>
        </Box>
      )}

      {filtered.map((g) => (
        <Box key={g.module} sx={{ mb: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.secondary' }}>
              {g.module}
            </Typography>
            <Divider sx={{ flex: 1, opacity: 0.6 }} />
            <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled' }}>
              {g.items.length}
            </Typography>
          </Stack>

          <Stack spacing={0.5}>
            {g.items.map((it) => {
              const state = stateFor(it.slug);
              const r = risks[it.risk] || risks.low;
              const locked = isRootTarget || lockedSlugs.has(it.slug);
              const prov = provenance[it.slug];

              const stateChipLabel =
                userMode
                  ? state === 'granted'   ? 'Granted directly'
                    : state === 'denied'  ? 'Denied directly'
                    : state === 'inheritOn'  ? `From ${prov?.roleName || 'role'}`
                    : 'Not allowed'
                  : (state === 'on' ? 'Allowed' : 'Not allowed');

              const stateChipColor =
                userMode
                  ? state === 'granted' ? theme.palette.success.dark
                    : state === 'denied' ? theme.palette.error.dark
                    : state === 'inheritOn' ? theme.palette.primary.dark
                    : theme.palette.text.disabled
                  : (state === 'on' ? theme.palette.success.dark : theme.palette.text.disabled);

              const stateChipBg =
                userMode
                  ? state === 'granted' ? alpha(theme.palette.success.main, 0.10)
                    : state === 'denied' ? alpha(theme.palette.error.main, 0.10)
                    : state === 'inheritOn' ? alpha(theme.palette.primary.main, 0.08)
                    : alpha(theme.palette.text.disabled, 0.06)
                  : (state === 'on' ? alpha(theme.palette.success.main, 0.10) : alpha(theme.palette.text.disabled, 0.06));

              return (
                <Box
                  key={it.slug}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    alignItems: 'center',
                    gap: 1.5,
                    p: 1.25,
                    borderRadius: 2,
                    border: `1px solid ${theme.palette.divider}`,
                    bgcolor: theme.palette.background.paper,
                    '&:hover': { borderColor: alpha(theme.palette.primary.main, 0.35) },
                    transition: 'border-color 150ms',
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.84rem', color: 'text.primary' }} noWrap>
                        {it.label}
                      </Typography>
                      <Chip
                        size="small"
                        label={it.risk?.toUpperCase()}
                        sx={{
                          height: 18, fontSize: '0.62rem', fontWeight: 800,
                          color: r.color, bgcolor: alpha(r.color, 0.10),
                          border: `1px solid ${alpha(r.color, 0.20)}`,
                        }}
                      />
                    </Stack>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.25 }}>
                      <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} noWrap>
                        {it.slug}
                      </Typography>
                      <Chip
                        size="small"
                        label={stateChipLabel}
                        sx={{
                          height: 18, fontSize: '0.62rem', fontWeight: 700,
                          color: stateChipColor, bgcolor: stateChipBg, border: `1px solid ${alpha(stateChipColor, 0.20)}`,
                        }}
                      />
                    </Stack>
                  </Box>

                  {/* Controls */}
                  {userMode ? (
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      disabled={locked}
                      value={
                        state === 'granted' ? 'granted'
                        : state === 'denied' ? 'denied'
                        : 'inherit'
                      }
                      onChange={(_, v) => v && setUserState(it.slug, v)}
                      sx={{
                        '& .MuiToggleButton-root': {
                          px: 1, py: 0.3, fontSize: '0.68rem', fontWeight: 700,
                          border: `1px solid ${theme.palette.divider}`,
                          color: 'text.secondary',
                          textTransform: 'none',
                        },
                      }}
                    >
                      <Tooltip title="Inherit from role">
                        <ToggleButton value="inherit"
                          sx={{
                            '&.Mui-selected': {
                              bgcolor: alpha(theme.palette.primary.main, 0.10),
                              color: theme.palette.primary.dark,
                            },
                          }}>
                          <ShieldQuestion size={13} style={{ marginRight: 4 }} /> Inherit
                        </ToggleButton>
                      </Tooltip>
                      <Tooltip title="Grant directly">
                        <ToggleButton value="granted"
                          sx={{
                            '&.Mui-selected': {
                              bgcolor: alpha(theme.palette.success.main, 0.10),
                              color: theme.palette.success.dark,
                            },
                          }}>
                          <ShieldCheck size={13} style={{ marginRight: 4 }} /> Grant
                        </ToggleButton>
                      </Tooltip>
                      <Tooltip title="Deny directly">
                        <ToggleButton value="denied"
                          sx={{
                            '&.Mui-selected': {
                              bgcolor: alpha(theme.palette.error.main, 0.10),
                              color: theme.palette.error.dark,
                            },
                          }}>
                          <ShieldX size={13} style={{ marginRight: 4 }} /> Deny
                        </ToggleButton>
                      </Tooltip>
                    </ToggleButtonGroup>
                  ) : (
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      disabled={locked}
                      value={state}
                      onChange={() => toggleRole(it.slug)}
                      sx={{
                        '& .MuiToggleButton-root': {
                          px: 1.5, py: 0.4, fontSize: '0.68rem', fontWeight: 700,
                          border: `1px solid ${theme.palette.divider}`,
                          color: 'text.secondary',
                          textTransform: 'none',
                        },
                      }}
                    >
                      <ToggleButton value="off"
                        sx={{
                          '&.Mui-selected': {
                            bgcolor: alpha(theme.palette.text.disabled, 0.06),
                            color: 'text.disabled',
                          },
                        }}>
                        Off
                      </ToggleButton>
                      <ToggleButton value="on"
                        sx={{
                          '&.Mui-selected': {
                            bgcolor: alpha(theme.palette.success.main, 0.10),
                            color: theme.palette.success.dark,
                          },
                        }}>
                        On
                      </ToggleButton>
                    </ToggleButtonGroup>
                  )}
                </Box>
              );
            })}
          </Stack>
        </Box>
      ))}

      {filtered.length === 0 && (
        <Box sx={{ p: 4, textAlign: 'center', color: 'text.disabled' }}>
          <Typography sx={{ fontWeight: 600, fontSize: '0.86rem' }}>
            No permissions match "{search}"
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default PermissionPicker;
