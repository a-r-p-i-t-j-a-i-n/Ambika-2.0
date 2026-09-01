import React, { useState } from 'react';
import {
  Box, Typography, Stack, Chip, Button, Paper, alpha, useTheme, Avatar,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Skeleton,
  IconButton, Tooltip,
} from '@mui/material';
import {
  ClipboardCheck, ArrowUp, ArrowDown, Check, X as XIcon, Paperclip,
  TriangleAlert, Hourglass, Crown, History,
} from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import {
  useGetPendingRevisionsQuery,
  useApproveRevisionMutation,
  useRejectRevisionMutation,
} from '../../store/api/pricingApi';
import { fmtINR } from '../../utils/formatters';
import { PageHero, pageSx, panelSx, primaryBtnSx, ghostBtnSx, BRAND, BRAND_DK, NAVY, O2D } from '../../components/pageKit';

const initials = (name = '') =>
  name.split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase() || '?';

const ApprovalInbox = () => {
  const theme = useTheme();
  const { data, isFetching } = useGetPendingRevisionsQuery();
  const [approve] = useApproveRevisionMutation();
  const [reject]  = useRejectRevisionMutation();

  const rows = data?.data || [];
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const handleApprove = async (id) => {
    try {
      await approve(id).unwrap();
      enqueueSnackbar('Revision approved — now live.', { variant: 'success' });
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to approve', { variant: 'error' });
    }
  };

  const handleReject = async () => {
    if (!rejectFor || rejectReason.trim().length < 2) return;
    try {
      await reject({ id: rejectFor._id, reason: rejectReason.trim() }).unwrap();
      enqueueSnackbar('Revision rejected.', { variant: 'success' });
      setRejectFor(null); setRejectReason('');
    } catch (err) {
      enqueueSnackbar(err?.data?.message || 'Failed to reject', { variant: 'error' });
    }
  };

  return (
    <Box sx={pageSx}>
      <PageHero
        icon={ClipboardCheck}
        title="Approval Inbox"
        subtitle={rows.length === 0
          ? 'All clear — no revisions awaiting your approval.'
          : `${rows.length} revision${rows.length === 1 ? '' : 's'} awaiting your approval.`}
        badge={<Chip icon={<Crown size={12} style={{ marginLeft: 6 }} />} label="MD" size="small"
          sx={{ height: 22, fontWeight: 800, fontSize: '0.68rem', color: BRAND_DK, bgcolor: alpha(BRAND, 0.1), border: `1px solid ${alpha(BRAND, 0.22)}`, '& .MuiChip-icon': { color: BRAND_DK } }} />}
      />

      <Box sx={{ position: 'relative' }}>
        {isFetching && rows.length === 0 && (
          <Stack spacing={1.5}>
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} variant="rectangular" height={148} sx={{ borderRadius: '10px' }} />
            ))}
          </Stack>
        )}

        {!isFetching && rows.length === 0 && (
          <Paper sx={{ p: 6, textAlign: 'center', borderRadius: '10px' }}>
            <Box sx={{
              width: 72, height: 72, mx: 'auto', mb: 2, borderRadius: '50%',
              display: 'grid', placeItems: 'center',
              bgcolor: alpha(theme.palette.success.main, 0.10),
              color: theme.palette.success.dark,
            }}>
              <Check size={32} />
            </Box>
            <Typography sx={{ fontWeight: 800, fontSize: '1.1rem' }}>Inbox zero</Typography>
            <Typography sx={{ color: 'text.secondary', mt: 0.5 }}>
              Nothing waiting on you — every revision below the threshold goes live automatically.
            </Typography>
          </Paper>
        )}

        <Stack spacing={2}>
          {rows.map((r) => {
            const up = (r.changePercent || 0) > 0;
            const flagged = r.flags?.negativeMargin || r.flags?.priceDecrease || r.flags?.overThreshold || r.flags?.farFutureDated;
            return (
              <Paper key={r._id} sx={{
                p: 2.5, borderRadius: '10px',
                border: r.flags?.negativeMargin
                  ? `1px solid ${alpha(theme.palette.error.main, 0.35)}`
                  : `1px solid ${theme.palette.divider}`,
                bgcolor: r.flags?.negativeMargin ? alpha(theme.palette.error.main, 0.02) : theme.palette.background.paper,
              }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  {/* Left: details */}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}>
                      <Typography sx={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontWeight: 800, fontSize: '0.86rem',
                        color: theme.palette.primary.dark,
                      }}>
                        {r.skuCode}
                      </Typography>
                      <Typography sx={{ fontSize: '0.86rem', color: 'text.primary', fontWeight: 600 }}>
                        · {r.skuName}
                      </Typography>
                      <Chip size="small" label={r.priceType === 'SELLING' ? 'Selling' : 'RM Cost'}
                        sx={{
                          height: 20, fontSize: '0.65rem', fontWeight: 700,
                          color: theme.palette.primary.dark,
                          bgcolor: alpha(theme.palette.primary.main, 0.08),
                        }} />
                      <Chip size="small" icon={<Hourglass size={11} style={{ marginLeft: 6 }}/>} label="PENDING"
                        sx={{
                          height: 20, fontSize: '0.65rem', fontWeight: 800,
                          color: theme.palette.warning.dark,
                          bgcolor: alpha(theme.palette.warning.main, 0.12),
                          '& .MuiChip-icon': { color: 'inherit' },
                        }} />
                    </Stack>

                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
                      <Typography sx={{ fontSize: '0.85rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtINR(r.oldPrice)}
                      </Typography>
                      <Box sx={{ color: 'text.disabled' }}>→</Box>
                      <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', fontVariantNumeric: 'tabular-nums', color: 'text.primary' }}>
                        {fmtINR(r.newPrice)}
                      </Typography>
                      {r.changePercent !== 0 && (
                        <Chip
                          size="small"
                          icon={up ? <ArrowUp size={11} style={{ marginLeft: 6 }}/> : <ArrowDown size={11} style={{ marginLeft: 6 }}/>}
                          label={`${up ? '+' : ''}${r.changePercent?.toFixed?.(1)}%`}
                          sx={{
                            height: 22, fontWeight: 800, fontSize: '0.72rem',
                            color: up ? theme.palette.success.dark : theme.palette.error.dark,
                            bgcolor: up ? alpha(theme.palette.success.main, 0.10) : alpha(theme.palette.error.main, 0.10),
                            border: `1px solid ${alpha(up ? theme.palette.success.main : theme.palette.error.main, 0.22)}`,
                            '& .MuiChip-icon': { color: 'inherit' },
                          }}
                        />
                      )}
                    </Stack>

                    <Stack direction="row" spacing={2} sx={{ mb: 1, color: 'text.secondary', flexWrap: 'wrap' }}>
                      <Typography sx={{ fontSize: '0.78rem' }}>
                        Effective from <strong>{dayjs(r.effectiveFrom).format('DD MMM YYYY')}</strong>
                      </Typography>
                      <Typography sx={{ fontSize: '0.78rem' }}>
                        Submitted <strong>{dayjs(r.createdAt).fromNow ? dayjs(r.createdAt).fromNow() : dayjs(r.createdAt).format('DD MMM')}</strong>
                      </Typography>
                    </Stack>

                    {r.reason && (
                      <Typography sx={{ fontSize: '0.85rem', color: 'text.primary', mb: 1, fontStyle: 'italic' }}>
                        "{r.reason}"
                      </Typography>
                    )}

                    <Stack direction="row" spacing={0.75} flexWrap="wrap" sx={{ mb: 1, gap: 0.5 }}>
                      {r.flags?.overThreshold && <FlagChip theme={theme} tone="warning" label="Above threshold" />}
                      {r.flags?.priceDecrease && <FlagChip theme={theme} tone="warning" label="Price decrease" />}
                      {r.flags?.farFutureDated && <FlagChip theme={theme} tone="info" label="Far-future dated" />}
                      {r.flags?.negativeMargin && <FlagChip theme={theme} tone="error" icon={<TriangleAlert size={11} />} label="Margin breach" />}
                      {!flagged && <FlagChip theme={theme} tone="info" label="Manual hold" />}
                    </Stack>

                    {r.priceType === 'SELLING' && r.rmCostAtSave != null && (
                      <Box sx={{
                        px: 1.5, py: 0.75, borderRadius: 1.5,
                        bgcolor: alpha(r.marginAtSave < 0 ? theme.palette.error.main : theme.palette.success.main, 0.04),
                        border: `1px solid ${alpha(r.marginAtSave < 0 ? theme.palette.error.main : theme.palette.success.main, 0.20)}`,
                        display: 'inline-flex', alignItems: 'center', gap: 1,
                      }}>
                        <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                          Margin after change:
                        </Typography>
                        <Typography sx={{
                          fontSize: '0.78rem', fontWeight: 800,
                          color: r.marginAtSave < 0 ? theme.palette.error.dark : theme.palette.success.dark,
                          fontVariantNumeric: 'tabular-nums',
                        }}>
                          {r.marginPercent?.toFixed?.(1)}% ({fmtINR(r.marginAtSave)}) · cost {fmtINR(r.rmCostAtSave)}
                        </Typography>
                      </Box>
                    )}

                    {r.attachmentUrl && (
                      <Box sx={{ mt: 1.25 }}>
                        <Chip
                          size="small"
                          icon={<Paperclip size={11} style={{ marginLeft: 6 }} />}
                          label={r.attachmentName || 'Attached proof'}
                          onClick={() => window.open(r.attachmentUrl, '_blank')}
                          sx={{
                            height: 24, fontWeight: 600, fontSize: '0.72rem',
                            color: theme.palette.primary.dark,
                            bgcolor: alpha(theme.palette.primary.main, 0.06),
                            border: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
                            cursor: 'pointer',
                            '& .MuiChip-icon': { color: 'inherit' },
                          }}
                        />
                      </Box>
                    )}
                  </Box>

                  {/* Right: requester + actions */}
                  <Stack spacing={1.5} alignItems="flex-end" sx={{ minWidth: { md: 200 } }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Avatar sx={{
                        width: 32, height: 32, fontSize: '0.72rem', fontWeight: 700,
                        background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)', color: '#fff',
                      }}>{initials(r.requestedByName)}</Avatar>
                      <Box>
                        <Typography sx={{ fontWeight: 700, fontSize: '0.78rem', textAlign: 'right' }}>
                          {r.requestedByName}
                        </Typography>
                        <Typography sx={{ fontSize: '0.7rem', color: 'text.disabled', textAlign: 'right' }}>
                          requester
                        </Typography>
                      </Box>
                    </Stack>
                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        startIcon={<XIcon size={14} />}
                        onClick={() => setRejectFor(r)}
                        sx={{ fontWeight: 700 }}
                      >
                        Reject
                      </Button>
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={<Check size={14} />}
                        onClick={() => handleApprove(r._id)}
                        sx={{ fontWeight: 700 }}
                      >
                        Approve
                      </Button>
                    </Stack>
                  </Stack>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      </Box>

      <Dialog open={!!rejectFor} onClose={() => setRejectFor(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: '10px' } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>Reject revision</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography sx={{ fontSize: '0.86rem', color: 'text.secondary', mb: 1.5 }}>
            {rejectFor && (
              <>
                {rejectFor.skuCode} · {fmtINR(rejectFor.oldPrice)} → {fmtINR(rejectFor.newPrice)}
              </>
            )}
          </Typography>
          <TextField
            label="Reason for rejection"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            multiline rows={3}
            fullWidth autoFocus
            placeholder="e.g. rate too low, please renegotiate"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setRejectFor(null)} sx={{ color: 'text.secondary', fontWeight: 700 }}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={rejectReason.trim().length < 2}
            onClick={handleReject}
            sx={{ fontWeight: 700 }}
          >
            Reject
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

const FlagChip = ({ theme, tone, label, icon }) => {
  const color =
    tone === 'error'   ? theme.palette.error.dark   :
    tone === 'warning' ? theme.palette.warning.dark :
                          theme.palette.info.dark;
  const bg = alpha(
    tone === 'error'   ? theme.palette.error.main   :
    tone === 'warning' ? theme.palette.warning.main :
                          theme.palette.info.main,
    0.10,
  );
  return (
    <Chip
      size="small"
      icon={icon}
      label={label}
      sx={{
        height: 20, fontSize: '0.65rem', fontWeight: 700,
        color, bgcolor: bg, border: `1px solid ${alpha(color, 0.22)}`,
        '& .MuiChip-icon': { color: 'inherit' },
      }}
    />
  );
};

export default ApprovalInbox;
