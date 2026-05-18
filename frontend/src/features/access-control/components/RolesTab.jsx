import React, { useState } from 'react';
import {
  Box, Grid, Card, CardActionArea, CardContent, Stack, Typography, Chip,
  Button, alpha, useTheme, Skeleton, Tooltip,
} from '@mui/material';
import { KeyRound, Users, Crown, ShieldCheck, Plus, Lock } from 'lucide-react';
import { useListRolesQuery } from '../../../store/api/accessControlApi';
import RoleDetailDrawer from './RoleDetailDrawer';
import CreateRoleDialog from './CreateRoleDialog';

const RolesTab = () => {
  const theme = useTheme();
  const { data, isFetching } = useListRolesQuery();
  const roles = data?.data || [];

  const [selectedId, setSelectedId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: '1rem' }}>Roles</Typography>
          <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
            {roles.length} role{roles.length === 1 ? '' : 's'} configured — system roles can be
            re-permissioned but not deleted.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Plus size={16} />}
          onClick={() => setCreateOpen(true)}
          sx={{ fontWeight: 700 }}
        >
          Create role
        </Button>
      </Stack>

      <Grid container spacing={2}>
        {isFetching && roles.length === 0 && Array.from({ length: 4 }).map((_, i) => (
          <Grid item xs={12} sm={6} md={4} key={i}>
            <Skeleton variant="rectangular" height={180} sx={{ borderRadius: 3 }} />
          </Grid>
        ))}

        {roles.map((r) => (
          <Grid item xs={12} sm={6} md={4} key={r._id}>
            <Card sx={{
              borderRadius: 3,
              border: r.isRoot
                ? `1px solid ${alpha(theme.palette.warning.main, 0.35)}`
                : `1px solid ${theme.palette.divider}`,
              transition: 'all 180ms ease',
              '&:hover': {
                borderColor: r.isRoot ? theme.palette.warning.main : alpha(theme.palette.primary.main, 0.45),
                transform: 'translateY(-2px)',
                boxShadow: '0 14px 30px rgba(30, 58, 138, 0.10)',
              },
            }}>
              <CardActionArea onClick={() => setSelectedId(r._id)} sx={{ p: 2.5 }}>
                <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                  <Stack direction="row" spacing={1.5} alignItems="flex-start">
                    <Box sx={{
                      width: 40, height: 40, borderRadius: 2,
                      display: 'grid', placeItems: 'center',
                      bgcolor: r.isRoot
                        ? alpha(theme.palette.warning.main, 0.12)
                        : alpha(theme.palette.primary.main, 0.10),
                      color: r.isRoot ? theme.palette.warning.dark : theme.palette.primary.dark,
                    }}>
                      {r.isRoot ? <Crown size={20} /> : <KeyRound size={20} />}
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                        <Typography sx={{ fontWeight: 800, fontSize: '0.95rem' }} noWrap>{r.name}</Typography>
                        {r.isSystem && !r.isRoot && (
                          <Tooltip title="System role — cannot be deleted">
                            <Lock size={11} color={theme.palette.text.disabled} />
                          </Tooltip>
                        )}
                      </Stack>
                      <Typography sx={{
                        fontSize: '0.7rem', color: 'text.disabled',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      }} noWrap>
                        {r.key}
                      </Typography>
                    </Box>
                  </Stack>

                  <Typography sx={{
                    mt: 1.5, fontSize: '0.8rem', color: 'text.secondary',
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden', minHeight: 38,
                  }}>
                    {r.description || 'No description.'}
                  </Typography>

                  <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap">
                    <Chip
                      size="small"
                      icon={<ShieldCheck size={12} style={{ marginLeft: 6 }} />}
                      label={r.isRoot ? 'All permissions' : `${r.permissions?.length || 0} permissions`}
                      sx={{
                        bgcolor: alpha(theme.palette.primary.main, 0.08),
                        color: theme.palette.primary.dark,
                        fontWeight: 700, height: 22,
                        '& .MuiChip-icon': { color: 'inherit' },
                      }}
                    />
                    <Chip
                      size="small"
                      icon={<Users size={12} style={{ marginLeft: 6 }} />}
                      label={`${r.memberCount || 0} member${(r.memberCount || 0) === 1 ? '' : 's'}`}
                      sx={{
                        bgcolor: alpha(theme.palette.text.secondary, 0.06),
                        color: 'text.secondary',
                        fontWeight: 700, height: 22,
                        '& .MuiChip-icon': { color: 'inherit' },
                      }}
                    />
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>

      <RoleDetailDrawer
        roleId={selectedId}
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
      />
      <CreateRoleDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </Box>
  );
};

export default RolesTab;
