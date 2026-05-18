import React, { useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, Avatar, Chip, Divider, IconButton, Tooltip,
  alpha, useTheme, Skeleton,
} from '@mui/material';
import {
  User as UserIcon, Mail, Phone, ShieldCheck, Crown, Calendar, Clock,
  CheckCircle2, XCircle, Copy, Activity, Sparkles, KeyRound,
} from 'lucide-react';
import { useSelector } from 'react-redux';
import { enqueueSnackbar } from 'notistack';
import { fmtDate, fmtFromNow } from '../../utils/formatters';

const fmtMobile = (m) => {
  if (!m) return '—';
  const s = String(m).replace(/\D/g, '');
  if (s.length === 10) return `+91 ${s.slice(0, 5)} ${s.slice(5)}`;
  return m;
};

const initialsOf = (name, email) => (name || email || 'U')
  .split(' ').filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase();

const InfoRow = ({ icon: Icon, label, value, copyable, theme }) => (
  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 1.25 }}>
    <Box sx={{
      width: 32, height: 32, borderRadius: 1.5,
      display: 'grid', placeItems: 'center',
      bgcolor: alpha(theme.palette.primary.main, 0.08),
      color: theme.palette.primary.dark,
      flexShrink: 0,
    }}>
      <Icon size={15} />
    </Box>
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography sx={{
        fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'text.disabled', lineHeight: 1.4,
      }}>
        {label}
      </Typography>
      <Typography sx={{
        fontSize: '0.92rem', fontWeight: 600, color: 'text.primary',
        fontVariantNumeric: 'tabular-nums', wordBreak: 'break-word',
      }}>
        {value || '—'}
      </Typography>
    </Box>
    {copyable && value && value !== '—' && (
      <Tooltip title="Copy" arrow>
        <IconButton
          size="small"
          onClick={() => {
            navigator.clipboard.writeText(String(value));
            enqueueSnackbar(`${label} copied`, { variant: 'success' });
          }}
          sx={{ color: 'text.disabled', '&:hover': { color: 'primary.main' } }}
        >
          <Copy size={14} />
        </IconButton>
      </Tooltip>
    )}
  </Stack>
);

const Profile = () => {
  const theme = useTheme();
  const { user, permissions, isRoot } = useSelector((s) => s.auth);

  const initials = useMemo(() => initialsOf(user?.name, user?.email), [user]);
  const isMd = user?.role === 'MD' || isRoot;

  // Group permissions by namespace (everything before the dot)
  const permsByGroup = useMemo(() => {
    const groups = {};
    (permissions || []).forEach((p) => {
      const [ns] = p.split('.');
      (groups[ns] ||= []).push(p);
    });
    return groups;
  }, [permissions]);

  if (!user) {
    return (
      <Box sx={{ p: { xs: 2, md: 4 } }}>
        <Skeleton variant="rectangular" height={220} sx={{ borderRadius: 3, mb: 2 }} />
        <Skeleton variant="rectangular" height={360} sx={{ borderRadius: 3 }} />
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* ── Hero header ───────────────────────────────────────────── */}
      <Box sx={{
        position: 'relative', overflow: 'hidden', color: '#fff',
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)',
        px: { xs: 3, md: 5 }, pt: { xs: 4, md: 5 }, pb: { xs: 8, md: 10 },
      }}>
        <Box aria-hidden sx={{
          position: 'absolute', width: 420, height: 420, borderRadius: '50%',
          top: -160, right: -120,
          background: 'radial-gradient(circle, rgba(96,165,250,0.32) 0%, rgba(96,165,250,0) 60%)',
        }} />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ position: 'relative' }}>
          <Avatar sx={{
            width: { xs: 72, md: 88 }, height: { xs: 72, md: 88 },
            background: 'rgba(255,255,255,0.16)',
            border: '2px solid rgba(255,255,255,0.32)',
            color: '#fff', fontWeight: 800, fontSize: { xs: '1.6rem', md: '2rem' },
            backdropFilter: 'blur(8px)',
          }}>
            {initials}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 0.5 }}>
              <Typography sx={{
                color: '#fff', fontSize: { xs: '1.5rem', md: '2rem' },
                fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1,
              }}>
                {user.name}
              </Typography>
              {user.isActive ? (
                <Chip
                  size="small"
                  icon={<CheckCircle2 size={12} style={{ marginLeft: 8, color: '#86efac' }} />}
                  label="Active"
                  sx={{
                    height: 22, fontWeight: 700, fontSize: '0.7rem',
                    color: '#bbf7d0', bgcolor: 'rgba(34,197,94,0.18)',
                    border: '1px solid rgba(187,247,208,0.32)',
                    '& .MuiChip-icon': { color: '#86efac' },
                  }}
                />
              ) : (
                <Chip
                  size="small"
                  icon={<XCircle size={12} style={{ marginLeft: 8 }} />}
                  label="Inactive"
                  sx={{
                    height: 22, fontWeight: 700, fontSize: '0.7rem',
                    color: '#fecaca', bgcolor: 'rgba(239,68,68,0.18)',
                    border: '1px solid rgba(254,202,202,0.32)',
                  }}
                />
              )}
            </Stack>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Chip
                icon={isMd ? <Crown size={13} style={{ marginLeft: 8 }} /> : <ShieldCheck size={13} style={{ marginLeft: 8 }} />}
                label={isMd ? `${user.role || 'MD'} · Full Admin Access` : (user.role || 'Member')}
                sx={{
                  height: 26, fontWeight: 700, fontSize: '0.78rem',
                  color: isMd ? '#fde68a' : '#dbeafe',
                  bgcolor: isMd ? 'rgba(245,158,11,0.18)' : 'rgba(255,255,255,0.14)',
                  border: `1px solid ${isMd ? 'rgba(253,230,138,0.35)' : 'rgba(255,255,255,0.24)'}`,
                  '& .MuiChip-icon': { color: 'inherit' },
                }}
              />
              <Typography sx={{ color: 'rgba(255,255,255,0.75)', fontSize: '0.85rem', fontWeight: 500 }}>
                {user.email}
              </Typography>
            </Stack>
          </Box>
        </Stack>
      </Box>

      {/* ── Two-column body ───────────────────────────────────────── */}
      <Box sx={{
        mx: { xs: 2, md: 4 },
        mt: { xs: -6, md: -7 },
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: '1.4fr 1fr' },
        gap: 2.5,
        pb: 5,
      }}>
        {/* ── Account details card ─────────────────────────────── */}
        <Paper sx={{
          p: { xs: 2.5, md: 3.5 }, borderRadius: 3,
          boxShadow: '0 10px 28px rgba(30, 58, 138, 0.10)',
        }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
            <Box sx={{
              width: 32, height: 32, borderRadius: 1.5,
              display: 'grid', placeItems: 'center',
              bgcolor: alpha(theme.palette.primary.main, 0.10),
              color: theme.palette.primary.dark,
            }}>
              <UserIcon size={16} />
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: 'text.primary' }}>
                Account Details
              </Typography>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
                Personal info and contact on file
              </Typography>
            </Box>
          </Stack>
          <Divider sx={{ mb: 1 }} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 3 }}>
            <InfoRow icon={UserIcon} label="Full name"    value={user.name}    theme={theme} />
            <InfoRow icon={ShieldCheck} label="Designation" value={isMd ? 'MD (Admin)' : user.role} theme={theme} />
            <InfoRow icon={Mail} label="Email address"   value={user.email}   theme={theme} copyable />
            <InfoRow icon={Phone} label="Mobile (WhatsApp)" value={fmtMobile(user.mobile)} theme={theme} copyable />
          </Box>

          <Divider sx={{ my: 2 }} />

          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
            <Box sx={{
              width: 32, height: 32, borderRadius: 1.5,
              display: 'grid', placeItems: 'center',
              bgcolor: alpha(theme.palette.info.main, 0.10),
              color: theme.palette.info.dark,
            }}>
              <Activity size={16} />
            </Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: 'text.primary' }}>
              Activity
            </Typography>
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 3 }}>
            <InfoRow
              icon={Calendar}
              label="Member since"
              value={user.createdAt ? `${fmtDate(user.createdAt, 'DD MMM YYYY')} (${fmtFromNow(user.createdAt)})` : '—'}
              theme={theme}
            />
            <InfoRow
              icon={Clock}
              label="Last login"
              value={user.lastLoginAt
                ? `${fmtDate(user.lastLoginAt, 'DD MMM YYYY · hh:mm A')} (${fmtFromNow(user.lastLoginAt)})`
                : 'This is your first login'}
              theme={theme}
            />
            {user.invitedAt && (
              <InfoRow
                icon={Sparkles}
                label="Invited on"
                value={`${fmtDate(user.invitedAt, 'DD MMM YYYY')} (${fmtFromNow(user.invitedAt)})`}
                theme={theme}
              />
            )}
            <InfoRow
              icon={KeyRound}
              label="Account ID"
              value={user._id}
              theme={theme}
              copyable
            />
          </Box>
        </Paper>

        {/* ── Permissions card ──────────────────────────────────── */}
        <Paper sx={{
          p: { xs: 2.5, md: 3.5 }, borderRadius: 3,
          boxShadow: '0 10px 28px rgba(30, 58, 138, 0.10)',
          alignSelf: 'flex-start',
        }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
            <Box sx={{
              width: 32, height: 32, borderRadius: 1.5,
              display: 'grid', placeItems: 'center',
              bgcolor: alpha(isMd ? theme.palette.warning.main : theme.palette.primary.main, 0.10),
              color: isMd ? theme.palette.warning.dark : theme.palette.primary.dark,
            }}>
              {isMd ? <Crown size={16} /> : <ShieldCheck size={16} />}
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 800, fontSize: '1rem', color: 'text.primary' }}>
                {isMd ? 'Administrator Access' : 'My Permissions'}
              </Typography>
              <Typography sx={{ fontSize: '0.78rem', color: 'text.secondary' }}>
                {isMd
                  ? 'You have full root access to every module.'
                  : `${(permissions || []).length} permission${(permissions || []).length === 1 ? '' : 's'} granted via your role`}
              </Typography>
            </Box>
          </Stack>
          <Divider sx={{ mb: 2 }} />

          {isMd ? (
            <Box sx={{
              p: 2, borderRadius: 2,
              background: `linear-gradient(135deg, ${alpha(theme.palette.warning.main, 0.08)} 0%, ${alpha(theme.palette.warning.main, 0.02)} 100%)`,
              border: `1px solid ${alpha(theme.palette.warning.main, 0.18)}`,
            }}>
              <Stack direction="row" spacing={1.25} alignItems="flex-start">
                <Crown size={18} color={theme.palette.warning.dark} style={{ marginTop: 2 }} />
                <Box>
                  <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', color: theme.palette.warning.dark }}>
                    Root Admin (MD)
                  </Typography>
                  <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary', mt: 0.25 }}>
                    Permission checks are bypassed for your account. You can create accounts,
                    manage roles, approve price revisions, and access every screen in the system.
                  </Typography>
                </Box>
              </Stack>
            </Box>
          ) : Object.keys(permsByGroup).length === 0 ? (
            <Typography sx={{ fontSize: '0.85rem', color: 'text.disabled', fontStyle: 'italic' }}>
              No permissions granted yet. Ask the MD to assign you a role.
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              {Object.entries(permsByGroup).sort(([a], [b]) => a.localeCompare(b)).map(([ns, perms]) => (
                <Box key={ns}>
                  <Typography sx={{
                    fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: 'text.disabled', mb: 0.5,
                  }}>
                    {ns}
                  </Typography>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    {perms.sort().map((p) => (
                      <Chip
                        key={p}
                        size="small"
                        label={p.split('.').slice(1).join('.') || p}
                        sx={{
                          height: 22, fontSize: '0.7rem', fontWeight: 600,
                          color: theme.palette.primary.dark,
                          bgcolor: alpha(theme.palette.primary.main, 0.06),
                          border: `1px solid ${alpha(theme.palette.primary.main, 0.16)}`,
                          fontFamily: 'ui-monospace, monospace',
                        }}
                      />
                    ))}
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </Paper>
      </Box>
    </Box>
  );
};

export default Profile;
