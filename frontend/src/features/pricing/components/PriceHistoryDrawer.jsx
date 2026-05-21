import React from 'react';
import {
  Drawer, Box, Stack, Typography, IconButton, Chip, Button, Divider, alpha, useTheme,
  Skeleton, Tooltip,
} from '@mui/material';
import { X, Paperclip, ArrowUp, ArrowDown, Edit3, History, CheckCircle2, AlertOctagon, Hourglass, FileEdit, ShieldCheck, CalendarClock, User as UserIcon, Link2 } from 'lucide-react';
import dayjs from 'dayjs';
import { enqueueSnackbar } from 'notistack';
import { useGetSkuPriceHistoryQuery } from '../../../store/api/pricingApi';
import { fmtINR, fmtFromNow } from '../../../utils/formatters';

// Full local date + time, plus the exact ISO + "x ago" hint shown on hover.
const DT_FORMAT = 'DD MMM YYYY · hh:mm A';
const fmtDT = (d) => (d ? dayjs(d).format(DT_FORMAT) : '—');
const fmtDTLong = (d) => (d ? dayjs(d).format('dddd, DD MMMM YYYY · hh:mm:ss A') : '—');

const STATUS_META = (theme) => ({
  LIVE:             { label: 'Live',       color: theme.palette.success.dark, bg: alpha(theme.palette.success.main, 0.10), icon: CheckCircle2 },
  PENDING_APPROVAL: { label: 'Pending',    color: theme.palette.warning.dark, bg: alpha(theme.palette.warning.main, 0.10), icon: Hourglass },
  REJECTED:         { label: 'Rejected',   color: theme.palette.error.dark,   bg: alpha(theme.palette.error.main, 0.10),   icon: AlertOctagon },
  SUPERSEDED:       { label: 'Superseded', color: theme.palette.text.secondary, bg: alpha(theme.palette.text.secondary, 0.06), icon: History },
});

const PriceHistoryDrawer = ({ skuId, skuCode, skuName, priceType, priceLabel, open, onClose, onRevise, canRevise }) => {
  const theme = useTheme();
  const statusMeta = STATUS_META(theme);
  const { data, isFetching } = useGetSkuPriceHistoryQuery({ skuId, priceType }, { skip: !skuId });
  const revs = data?.data || [];

  // The page keeps the URL in sync with the open SKU, so the current address
  // is already a shareable deep link straight to this price history.
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      enqueueSnackbar('Link copied — paste it to share this price history.', { variant: 'success' });
    } catch {
      enqueueSnackbar('Could not copy the link automatically.', { variant: 'error' });
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
            <History size={22} color="#fff" />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: '1.05rem' }} noWrap>
              Price history
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.78)', fontSize: '0.78rem', fontFamily: 'ui-monospace, monospace' }}>
              {skuCode} · {skuName}
            </Typography>
            <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.7rem', mt: 0.25 }}>
              {priceLabel || (priceType === 'SELLING' ? 'Selling Price' : 'RM Cost')}
            </Typography>
          </Box>
          <Tooltip title="Copy a shareable link to this price history" arrow>
            <IconButton size="small" onClick={handleCopyLink} sx={{ color: '#fff', '&:hover': { bgcolor: alpha('#fff', 0.12), color: '#fff' } }}>
              <Link2 size={17} />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={onClose} sx={{ color: '#fff', '&:hover': { bgcolor: alpha('#fff', 0.12), color: '#fff' } }}>
            <X size={18} />
          </IconButton>
        </Stack>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, py: 2.5 }}>
        {isFetching && (
          <Stack spacing={1.5}>
            {[...Array(4)].map((_, i) => <Skeleton key={i} variant="rectangular" height={86} sx={{ borderRadius: 2 }} />)}
          </Stack>
        )}

        {!isFetching && revs.length === 0 && (
          <Box sx={{ py: 6, textAlign: 'center', color: 'text.disabled' }}>
            <History size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
            <Typography sx={{ fontWeight: 700 }}>No revisions yet</Typography>
            <Typography sx={{ fontSize: '0.82rem' }}>
              This SKU hasn't been priced yet. {canRevise && 'Click "Revise" below to start.'}
            </Typography>
          </Box>
        )}

        {/* Mini-sparkline strip (visual trend) */}
        {revs.length > 1 && (
          <Box sx={{
            mb: 2, p: 1.5, borderRadius: 2,
            bgcolor: alpha(theme.palette.primary.main, 0.04),
            border: `1px solid ${alpha(theme.palette.primary.main, 0.12)}`,
          }}>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: 'text.secondary', letterSpacing: '0.06em', textTransform: 'uppercase', mb: 1 }}>
              Trend ({revs.filter((r) => r.status !== 'PENDING_APPROVAL').length} revisions)
            </Typography>
            <Sparkline revisions={revs.filter((r) => r.status !== 'PENDING_APPROVAL').slice().reverse()} />
          </Box>
        )}

        <Stack spacing={1.5}>
          {revs.map((r) => {
            const meta = statusMeta[r.status] || statusMeta.LIVE;
            const Icon = meta.icon;
            const up = (r.changePercent || 0) > 0;
            const down = (r.changePercent || 0) < 0;

            return (
              <Box key={r._id} sx={{
                p: 1.5, borderRadius: 2,
                border: `1px solid ${theme.palette.divider}`,
                bgcolor: theme.palette.background.paper,
                position: 'relative',
              }}>
                {r.isCorrection && (
                  <Chip size="small" label="CORRECTION" sx={{
                    position: 'absolute', top: 8, right: 8,
                    height: 16, fontSize: '0.6rem', fontWeight: 800,
                    color: theme.palette.info.dark, bgcolor: alpha(theme.palette.info.main, 0.10),
                  }} />
                )}
                <Stack direction="row" spacing={1.5} alignItems="flex-start">
                  <Box sx={{
                    width: 32, height: 32, borderRadius: 1.5,
                    display: 'grid', placeItems: 'center',
                    bgcolor: meta.bg, color: meta.color,
                  }}>
                    <Icon size={16} />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography sx={{ fontWeight: 800, fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtINR(r.oldPrice)} → {fmtINR(r.newPrice)}
                      </Typography>
                      {r.changePercent !== 0 && (
                        <Chip
                          size="small"
                          icon={up ? <ArrowUp size={10} style={{ marginLeft: 4 }} /> : <ArrowDown size={10} style={{ marginLeft: 4 }} />}
                          label={`${up ? '+' : ''}${r.changePercent?.toFixed?.(1)}%`}
                          sx={{
                            height: 20, fontWeight: 800, fontSize: '0.65rem',
                            color: up ? theme.palette.success.dark : theme.palette.error.dark,
                            bgcolor: up ? alpha(theme.palette.success.main, 0.10) : alpha(theme.palette.error.main, 0.10),
                            '& .MuiChip-icon': { color: 'inherit' },
                          }}
                        />
                      )}
                      <Chip size="small" label={meta.label} sx={{
                        height: 20, fontWeight: 700, fontSize: '0.65rem',
                        color: meta.color, bgcolor: meta.bg,
                      }}/>
                    </Stack>

                    {/* ── Event timeline: Requested → Approved → Effective ── */}
                    <Box sx={{
                      mt: 1, p: 1, borderRadius: 1.25,
                      bgcolor: alpha(theme.palette.text.primary, 0.025),
                      border: `1px solid ${alpha(theme.palette.text.primary, 0.06)}`,
                    }}>
                      <TimelineRow
                        icon={FileEdit}
                        label="Requested"
                        actor={r.requestedByName}
                        when={r.createdAt}
                        color={theme.palette.primary.main}
                        theme={theme}
                      />
                      {r.approvedAt && (
                        <TimelineRow
                          icon={ShieldCheck}
                          label={r.status === 'REJECTED' ? 'Rejected' : 'Approved'}
                          actor={r.approvedByName}
                          when={r.approvedAt}
                          color={r.status === 'REJECTED' ? theme.palette.error.main : theme.palette.success.dark}
                          theme={theme}
                        />
                      )}
                      <TimelineRow
                        icon={CalendarClock}
                        label="Effective from"
                        when={r.effectiveFrom}
                        color={theme.palette.info.dark}
                        theme={theme}
                        isLast
                      />
                    </Box>

                    {r.reason && (
                      <Box sx={{
                        mt: 0.75, px: 1, py: 0.5, borderRadius: 1,
                        bgcolor: alpha(theme.palette.primary.main, 0.04),
                        borderLeft: `2px solid ${alpha(theme.palette.primary.main, 0.3)}`,
                      }}>
                        <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: 'text.disabled', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                          Reason
                        </Typography>
                        <Typography sx={{ fontSize: '0.78rem', color: 'text.primary' }}>
                          {r.reason}
                        </Typography>
                      </Box>
                    )}

                    {r.attachmentUrl && (
                      <Tooltip title={`Open ${r.attachmentName}`}>
                        <Chip
                          size="small"
                          icon={<Paperclip size={11} style={{ marginLeft: 6 }} />}
                          label={r.attachmentName || 'Attached file'}
                          onClick={() => window.open(r.attachmentUrl, '_blank')}
                          sx={{
                            mt: 0.75, height: 22, fontWeight: 600, fontSize: '0.68rem',
                            color: theme.palette.primary.dark,
                            bgcolor: alpha(theme.palette.primary.main, 0.06),
                            border: `1px solid ${alpha(theme.palette.primary.main, 0.18)}`,
                            '& .MuiChip-icon': { color: 'inherit' },
                            cursor: 'pointer',
                          }}
                        />
                      </Tooltip>
                    )}

                    {r.rejectionReason && (
                      <Box sx={{
                        mt: 0.75, px: 1, py: 0.5, borderRadius: 1,
                        bgcolor: alpha(theme.palette.error.main, 0.06),
                        border: `1px solid ${alpha(theme.palette.error.main, 0.18)}`,
                      }}>
                        <Typography sx={{ fontSize: '0.74rem', color: theme.palette.error.dark, fontWeight: 600 }}>
                          Rejected: {r.rejectionReason}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                </Stack>
              </Box>
            );
          })}
        </Stack>
      </Box>

      <Box sx={{
        px: 2.5, py: 1.75,
        borderTop: `1px solid ${theme.palette.divider}`,
        bgcolor: theme.palette.background.default,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1,
      }}>
        <Button
          startIcon={<Link2 size={14} />}
          onClick={handleCopyLink}
          sx={{ color: theme.palette.primary.dark, fontWeight: 700 }}
        >
          Copy link
        </Button>
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose} sx={{ color: 'text.secondary', fontWeight: 700 }}>Close</Button>
          {canRevise && (
            <Button
              variant="contained"
              startIcon={<Edit3 size={14} />}
              onClick={() => { onRevise?.({ skuId, code: skuCode, name: skuName }); onClose(); }}
              sx={{ fontWeight: 700 }}
            >
              Revise this SKU
            </Button>
          )}
        </Stack>
      </Box>
    </Drawer>
  );
};

// One row of the per-revision event timeline.
// Shows: [icon] LABEL — actor name · full date+time (hover for relative + ISO)
const TimelineRow = ({ icon: Icon, label, actor, when, color, theme, isLast }) => (
  <Stack
    direction="row"
    spacing={1}
    alignItems="center"
    sx={{ py: 0.35, borderBottom: isLast ? 'none' : `1px dashed ${alpha(theme.palette.text.primary, 0.08)}` }}
  >
    <Box sx={{
      width: 20, height: 20, borderRadius: 0.75,
      display: 'grid', placeItems: 'center',
      bgcolor: alpha(color, 0.10), color,
      flexShrink: 0,
    }}>
      <Icon size={11} />
    </Box>
    <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: 'text.primary', minWidth: 80, letterSpacing: '0.02em' }}>
      {label}
    </Typography>
    {actor && (
      <Stack direction="row" spacing={0.4} alignItems="center" sx={{ color: 'text.secondary', minWidth: 0 }}>
        <UserIcon size={10} />
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 600 }} noWrap>{actor}</Typography>
      </Stack>
    )}
    <Box sx={{ flex: 1 }} />
    <Tooltip arrow title={`${fmtDTLong(when)}  (${fmtFromNow(when)})`}>
      <Typography sx={{
        fontSize: '0.72rem', color: 'text.secondary',
        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        borderBottom: `1px dotted ${alpha(theme.palette.text.primary, 0.2)}`,
        cursor: 'help',
      }}>
        {fmtDT(when)}
      </Typography>
    </Tooltip>
  </Stack>
);

const Sparkline = ({ revisions }) => {
  const theme = useTheme();
  if (revisions.length < 2) return null;
  const prices = revisions.map((r) => r.newPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const w = 100, h = 32;
  const step = revisions.length > 1 ? w / (revisions.length - 1) : 0;
  const points = revisions.map((r, i) => ({
    x: i * step,
    y: h - ((r.newPrice - min) / range) * (h - 6) - 3,
    price: r.newPrice,
  }));
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {fmtINR(revisions[0].newPrice)}
      </Typography>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ maxWidth: 200, height: h }}>
        <path d={d} fill="none" stroke={theme.palette.primary.main} strokeWidth="1.5" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2" fill={theme.palette.primary.main} />
        ))}
      </svg>
      <Typography sx={{ fontSize: '0.72rem', color: 'text.primary', fontWeight: 700, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {fmtINR(revisions[revisions.length - 1].newPrice)}
      </Typography>
    </Box>
  );
};

export default PriceHistoryDrawer;
