import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, Grid, Chip, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Skeleton, Button, IconButton,
  Breadcrumbs, Link,
} from '@mui/material';
import {
  ArrowLeft, FileText, ExternalLink, CheckCircle2, Clock, Truck, Calendar,
  Package, MapPin, Hash, User, TrendingDown, TrendingUp,
} from 'lucide-react';
import { alpha } from '@mui/material/styles';
import { useGetOrderByIdQuery, useGetOrderScheduleQuery } from '../../store/api/orderApi';
import dayjs from 'dayjs';

// ─── Premium blue palette (aligned with theme) ──────────────────────────────
const C = {
  ink:        '#0b2545',
  body:       '#1e3a8a',
  text:       '#1d4ed8',
  primary:    '#1d4ed8',
  primaryDk:  '#1e3a8a',
  primaryLt:  '#3b82f6',
  accent:     '#2563eb',
  success:    '#0f766e',
  warning:    '#b45309',
  error:      '#be123c',
  wip:        '#5b6cff',
  slate:      '#475a8a',
  faint:      '#7d8fb3',
  line:       '#dbe4f3',
  lineSoft:   '#eaf0fb',
  surface:    '#ffffff',
  surfaceAlt: '#f5f8ff',
};

const WORKFLOW_STEPS = [
  { key: 'poEntry',         label: 'PO Entry in Tally',         who: 'Upasana' },
  { key: 'inventoryCheck',  label: 'Check Inventory',           who: 'Upasana' },
  { key: 'scheduling',      label: 'Create Dispatch Schedule',  who: 'Aarti'   },
  { key: 'emailSchedule',   label: 'Email Dispatch Schedule',   who: 'Aarti'   },
];

const fmt = (v) => Number(v || 0).toLocaleString('en-IN');

// ─── Components ─────────────────────────────────────────────────────────────
const PhaseCard = ({ phase }) => {
  const isPast = dayjs(phase.plannedDate).isBefore(dayjs(), 'day');
  return (
    <Box
      sx={{
        p: 1.25,
        borderRadius: 2,
        border: '1px solid',
        borderColor: C.lineSoft,
        bgcolor: C.surface,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 110,
        flexShrink: 0,
      }}
    >
      <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: C.slate, letterSpacing: '0.06em' }}>
        {phase.phaseNo}
      </Typography>
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: C.ink, my: 0.5 }}>
        {fmt(phase.plannedQty)}
      </Typography>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: isPast ? C.error : C.slate }}>
        {dayjs(phase.plannedDate).format('DD MMM')}
      </Typography>
    </Box>
  );
};

const StatusBadge = ({ value }) => {
  const map = {
    RECEIVED: C.warning, PLANNING: C.wip, IN_PROGRESS: C.primary,
    COMPLETED: C.success, CANCELLED: C.error, SHORT_CLOSED: C.slate,
  };
  const color = map[value] || C.slate;
  return (
    <Chip
      label={value?.replace('_', ' ')}
      size="small"
      sx={{
        bgcolor: alpha(color, 0.10),
        color,
        fontWeight: 700,
        fontSize: '0.65rem',
        letterSpacing: '0.06em',
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: alpha(color, 0.22),
      }}
    />
  );
};

const Insight = ({ label, value, subtext, color, trendIcon: TrendIcon }) => (
  <Paper
    sx={{
      p: 2,
      borderRadius: 2.5,
      border: '1px solid',
      borderColor: C.line,
      bgcolor: C.surface,
      height: '100%',
      minWidth: 0,
      position: 'relative',
      overflow: 'hidden',
      '&::before': {
        content: '""',
        position: 'absolute',
        inset: 0,
        background: `linear-gradient(135deg, ${alpha(color, 0.04)} 0%, transparent 60%)`,
        pointerEvents: 'none',
      },
    }}
  >
    <Typography sx={{ position: 'relative', fontSize: '0.66rem', fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1 }}>
      {label}
    </Typography>
    <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, color, letterSpacing: '-0.02em', lineHeight: 1 }}>
        {value}
      </Typography>
      {TrendIcon && <TrendIcon size={16} color={color} strokeWidth={2.5} />}
    </Box>
    <Typography sx={{ position: 'relative', fontSize: '0.74rem', fontWeight: 500, color: C.slate }}>
      {subtext}
    </Typography>
  </Paper>
);

const StatBlock = ({ label, value, color, accent }) => (
  <Paper
    sx={{
      p: 2.25,
      borderRadius: 2.5,
      border: '1px solid',
      borderColor: accent ? 'transparent' : C.line,
      background: accent
        ? `linear-gradient(135deg, ${C.primaryDk} 0%, ${C.primary} 100%)`
        : C.surface,
      color: accent ? '#ffffff' : 'inherit',
      boxShadow: accent ? `0 8px 20px ${alpha(C.primary, 0.22)}` : '0 1px 2px rgba(30,58,138,0.04)',
    }}
  >
    <Typography sx={{
      fontSize: '0.66rem',
      fontWeight: 700,
      color: accent ? 'rgba(255,255,255,0.85)' : C.slate,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      mb: 0.75,
    }}>
      {label}
    </Typography>
    <Typography sx={{
      fontSize: '1.6rem',
      fontWeight: 800,
      letterSpacing: '-0.02em',
      lineHeight: 1.15,
      color: accent ? '#ffffff' : (color || C.ink),
    }}>
      {value}
    </Typography>
  </Paper>
);

// ─── Page ───────────────────────────────────────────────────────────────────
const OrderDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: orderRes, isLoading } = useGetOrderByIdQuery(id);
  const order = orderRes?.data;
  const { data: scheduleRes } = useGetOrderScheduleQuery(order?.soNumber, { skip: !order?.soNumber });
  const schedule = scheduleRes?.data?.[0];

  // Performance metrics
  const totalPlanned = schedule?.items?.reduce((sum, item) => sum + (item.phases?.reduce((ps, p) => ps + (p.plannedQty || 0), 0) || 0), 0) || 0;
  const totalActual = schedule?.items?.reduce((sum, item) => sum + (item.phases?.reduce((ps, p) => ps + (p.totalActualQty || 0), 0) || 0), 0) || 0;
  const variance = totalActual - totalPlanned;
  const adherence = totalPlanned > 0 ? Math.round((totalActual / totalPlanned) * 100) : 0;
  const isLacking = variance < 0;

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rectangular" height={400} sx={{ borderRadius: 2 }} /></Box>;
  if (!order) return <Box sx={{ p: 3 }}><Typography>Order not found</Typography></Box>;

  const adherenceColor = adherence >= 90 ? C.success : adherence >= 50 ? C.warning : C.error;

  return (
    <Box sx={{ p: { xs: 2, md: 3.5 }, minHeight: '100vh' }}>
      {/* ── Header ───────────────────────────────────────────────── */}
      <Box sx={{ mb: 3 }}>
        <Breadcrumbs sx={{ mb: 1, '& .MuiBreadcrumbs-separator': { color: C.faint } }}>
          <Link
            underline="hover"
            sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '0.78rem', color: C.slate, fontWeight: 600 }}
            onClick={() => navigate('/orders')}
          >
            <Package size={13} /> Orders
          </Link>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: C.primary }}>
            {order.soNumber}
          </Typography>
        </Breadcrumbs>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <IconButton
            onClick={() => navigate(-1)}
            size="small"
            sx={{
              bgcolor: C.surface,
              border: '1px solid',
              borderColor: C.line,
              color: C.body,
              '&:hover': { bgcolor: C.surfaceAlt, borderColor: alpha(C.primary, 0.4) },
            }}
          >
            <ArrowLeft size={16} />
          </IconButton>
          <Typography sx={{
            fontSize: { xs: '1.15rem', sm: '1.35rem' },
            fontWeight: 700,
            color: C.ink,
            letterSpacing: '-0.015em',
            lineHeight: 1.2,
          }}>
            {order.soNumber}
          </Typography>
          <StatusBadge value={order.status} />
        </Box>
      </Box>

      {/* ── Performance Insights ─────────────────────────────────── */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={4}>
          <Insight
            label="Plan Adherence"
            value={`${adherence}%`}
            subtext={adherence >= 100 ? 'On track with plan' : 'Currently trailing plan'}
            color={adherenceColor}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Insight
            label="Variance Analysis"
            value={variance === 0 ? '0' : (variance > 0 ? `+${fmt(variance)}` : fmt(variance))}
            subtext={isLacking ? 'Lacking / behind plan' : 'Moving forward / ahead'}
            color={isLacking ? C.error : C.success}
            trendIcon={isLacking ? TrendingDown : TrendingUp}
          />
        </Grid>
        <Grid item xs={12} sm={12} md={4}>
          <Insight
            label="Pending Dispatch"
            value={fmt(order.totalBalanceQty)}
            subtext="Total remaining across all phases"
            color={C.primary}
          />
        </Grid>
      </Grid>

      {/* ── Main grid ────────────────────────────────────────────── */}
      <Grid container spacing={2.5}>
        {/* LEFT */}
        <Grid item xs={12} lg={8}>
          {/* Order totals */}
          <Grid container spacing={2} sx={{ mb: 2.5 }}>
            <Grid item xs={12} sm={4}>
              <StatBlock label="Total Order Qty" value={fmt(order.totalOrderQty)} accent />
            </Grid>
            <Grid item xs={12} sm={4}>
              <StatBlock label="Dispatched" value={fmt(order.totalDispatchedQty)} color={C.success} />
            </Grid>
            <Grid item xs={12} sm={4}>
              <StatBlock label="Pending Balance" value={fmt(order.totalBalanceQty)} color={C.error} />
            </Grid>
          </Grid>

          {/* SKU table */}
          <Paper sx={{ borderRadius: 2.5, border: '1px solid', borderColor: C.line, overflow: 'hidden', mb: 2.5 }}>
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: C.lineSoft, display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <Box sx={{ width: 30, height: 30, borderRadius: 1.5, bgcolor: alpha(C.primary, 0.10), border: `1px solid ${alpha(C.primary, 0.18)}`, color: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Package size={16} />
              </Box>
              <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: C.ink }}>SKU Line Items</Typography>
              <Chip
                label={order.items?.length || 0}
                size="small"
                sx={{ ml: 'auto', fontWeight: 700, bgcolor: alpha(C.primary, 0.10), color: C.primaryDk, border: `1px solid ${alpha(C.primary, 0.18)}` }}
              />
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>SKU Name</TableCell>
                    <TableCell>Code</TableCell>
                    <TableCell align="right">Order</TableCell>
                    <TableCell align="right">Dispatch</TableCell>
                    <TableCell align="right">Balance</TableCell>
                    <TableCell sx={{ width: 110 }}>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {order.items?.map((item, idx) => {
                    const pct = item.orderQty > 0 ? Math.round((item.dispatchedQty / item.orderQty) * 100) : 0;
                    const isDone = item.balanceQty <= 0;
                    return (
                      <TableRow key={idx} sx={{ '&:hover': { bgcolor: C.surfaceAlt } }}>
                        <TableCell><Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: C.ink }}>{item.skuName}</Typography></TableCell>
                        <TableCell><Typography sx={{ fontSize: '0.78rem', color: C.slate, fontWeight: 500 }}>{item.skuCode}</Typography></TableCell>
                        <TableCell align="right"><Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: C.ink }}>{fmt(item.orderQty)}</Typography></TableCell>
                        <TableCell align="right"><Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: C.success }}>{fmt(item.dispatchedQty)}</Typography></TableCell>
                        <TableCell align="right"><Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: isDone ? C.success : C.error }}>{fmt(item.balanceQty)}</Typography></TableCell>
                        <TableCell>
                          <Box sx={{
                            px: 1.25, py: 0.4, borderRadius: 1.25,
                            bgcolor: alpha(isDone ? C.success : C.warning, 0.10),
                            color: isDone ? C.success : C.warning,
                            border: `1px solid ${alpha(isDone ? C.success : C.warning, 0.20)}`,
                            fontSize: '0.66rem', fontWeight: 800, textAlign: 'center', letterSpacing: '0.04em',
                          }}>
                            {isDone ? 'COMPLETE' : `${pct}%`}
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          {/* Dispatch Schedule */}
          <Paper sx={{ p: 2.5, borderRadius: 2.5, border: '1px solid', borderColor: C.line, mb: 2.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5, flexWrap: 'wrap', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <Box sx={{ width: 30, height: 30, borderRadius: 1.5, bgcolor: alpha(C.primary, 0.10), border: `1px solid ${alpha(C.primary, 0.18)}`, color: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Calendar size={16} />
                </Box>
                <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: C.ink }}>
                  Dispatch Planning (Phases)
                </Typography>
              </Box>
              {schedule?.pdfUrl && (
                <Button
                  size="small"
                  startIcon={<ExternalLink size={14} />}
                  href={schedule.pdfUrl}
                  target="_blank"
                  sx={{ fontWeight: 700, color: C.primary }}
                >
                  View Schedule PDF
                </Button>
              )}
            </Box>

            {!schedule ? (
              <Box sx={{ p: 4, textAlign: 'center', bgcolor: C.surfaceAlt, borderRadius: 2, border: `1px dashed ${C.line}` }}>
                <Typography sx={{ fontSize: '0.85rem', color: C.slate, fontWeight: 500 }}>
                  No active dispatch schedule found for this order.
                </Typography>
                <Button size="small" sx={{ mt: 1, fontWeight: 700, color: C.primary }}>Create Schedule</Button>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {schedule.items?.map((item, idx) => (
                  <Box key={idx} sx={{ p: 1.75, borderRadius: 2, bgcolor: C.surfaceAlt, border: '1px solid', borderColor: C.lineSoft }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5, flexWrap: 'wrap', gap: 0.5 }}>
                      <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: C.primaryDk }}>{item.skuName}</Typography>
                      <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: C.slate, letterSpacing: '0.04em' }}>CODE: {item.skuCode}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1.25, overflowX: 'auto', pb: 0.5 }}>
                      {item.phases?.map((phase, pIdx) => (
                        <PhaseCard key={pIdx} phase={phase} />
                      ))}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Paper>

          {/* Dispatch History */}
          {schedule?.items?.some((i) => i.phases?.some((p) => p.actualDispatches?.length > 0)) && (
            <Paper sx={{ borderRadius: 2.5, border: '1px solid', borderColor: C.line, overflow: 'hidden', mb: 2.5 }}>
              <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: C.lineSoft, display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <Box sx={{ width: 30, height: 30, borderRadius: 1.5, bgcolor: alpha(C.success, 0.10), border: `1px solid ${alpha(C.success, 0.20)}`, color: C.success, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FileText size={16} />
                </Box>
                <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: C.ink }}>Dispatch History & Invoices</Typography>
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Item / Phase</TableCell>
                      <TableCell>Actual Date</TableCell>
                      <TableCell align="right">Qty</TableCell>
                      <TableCell>Invoice No</TableCell>
                      <TableCell align="center">Doc</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {schedule.items.map((item) =>
                      item.phases?.map((phase) =>
                        phase.actualDispatches?.map((dispatch, dIdx) => (
                          <TableRow key={`${item.skuCode}-${phase.phaseNo}-${dIdx}`} sx={{ '&:hover': { bgcolor: C.surfaceAlt } }}>
                            <TableCell>
                              <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: C.ink, display: 'block' }}>{item.skuName}</Typography>
                              <Typography sx={{ fontSize: '0.7rem', color: C.slate, fontWeight: 500 }}>{phase.phaseNo}</Typography>
                            </TableCell>
                            <TableCell><Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: C.text }}>{dayjs(dispatch.date).format('DD MMM YY')}</Typography></TableCell>
                            <TableCell align="right"><Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: C.success }}>{fmt(dispatch.qty)}</Typography></TableCell>
                            <TableCell><Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: C.primary }}>{dispatch.invoiceNo}</Typography></TableCell>
                            <TableCell align="center">
                              {dispatch.invoiceDoc && (
                                <IconButton size="small" href={dispatch.invoiceDoc} target="_blank" sx={{ color: C.slate }}>
                                  <ExternalLink size={14} />
                                </IconButton>
                              )}
                            </TableCell>
                          </TableRow>
                        )),
                      ),
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          {/* Workflow */}
          <Paper sx={{ p: 2.5, borderRadius: 2.5, border: '1px solid', borderColor: C.line }}>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: C.ink, mb: 2.5 }}>
              Order Execution Workflow
            </Typography>
            <Grid container spacing={1.5}>
              {WORKFLOW_STEPS.map((step) => {
                const data = order[step.key] || {};
                const isDone = data.status === 'DONE';
                return (
                  <Grid item xs={12} sm={6} key={step.key}>
                    <Box sx={{
                      p: 1.75, borderRadius: 2,
                      border: '1px solid',
                      borderColor: isDone ? alpha(C.success, 0.25) : C.lineSoft,
                      bgcolor: isDone ? alpha(C.success, 0.04) : C.surface,
                      display: 'flex', alignItems: 'center', gap: 1.5,
                    }}>
                      {isDone
                        ? <CheckCircle2 color={C.success} size={20} />
                        : <Clock color={C.faint} size={20} />}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: C.ink }}>{step.label}</Typography>
                        <Typography sx={{ fontSize: '0.7rem', color: C.slate, fontWeight: 500 }}>In-charge: {step.who}</Typography>
                      </Box>
                      <Chip
                        label={data.status || 'PENDING'}
                        size="small"
                        sx={{
                          fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.04em',
                          bgcolor: isDone ? alpha(C.success, 0.10) : C.lineSoft,
                          color: isDone ? C.success : C.slate,
                          border: `1px solid ${isDone ? alpha(C.success, 0.20) : C.line}`,
                        }}
                      />
                    </Box>
                  </Grid>
                );
              })}
            </Grid>
          </Paper>
        </Grid>

        {/* RIGHT */}
        <Grid item xs={12} lg={4}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Customer & Commercials */}
            <Paper sx={{ p: 2.5, borderRadius: 2.5, border: '1px solid', borderColor: C.line }}>
              <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 2 }}>
                Customer & Commercials
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {[
                  { icon: User,     label: 'Customer Name',  value: order.partyName },
                  { icon: Hash,     label: 'PO Number',      value: order.poNumber },
                  { icon: Calendar, label: 'PO Date',        value: order.poDate ? dayjs(order.poDate).format('DD MMM YYYY') : '—' },
                  { icon: MapPin,   label: 'Location',       value: order.location || '—' },
                  { icon: Truck,    label: 'Transport Mode', value: order.transport || 'Road' },
                ].map(({ icon: Icon, label, value }) => (
                  <Box key={label} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                    <Box sx={{ width: 32, height: 32, flexShrink: 0, borderRadius: 1.5, bgcolor: alpha(C.primary, 0.08), border: `1px solid ${alpha(C.primary, 0.16)}`, color: C.primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon size={15} />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: '0.7rem', color: C.slate, fontWeight: 600, letterSpacing: '0.02em' }}>{label}</Typography>
                      <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: C.ink, wordBreak: 'break-word' }}>{value}</Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Paper>

            {/* Quick Info */}
            <Paper sx={{ p: 2.5, borderRadius: 2.5, border: '1px solid', borderColor: C.line }}>
              <Typography sx={{ fontSize: '0.66rem', fontWeight: 700, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 2 }}>
                Quick Info
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                {[
                  ['Order Date',     dayjs(order.orderDate).format('DD MMM YYYY')],
                  ['Lead Time',      `${order.leadTimeDays || 0} Days`],
                  ['Financial Year', order.financialYear || '—'],
                ].map(([k, v]) => (
                  <Box key={k} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5, borderBottom: '1px dashed', borderColor: C.lineSoft }}>
                    <Typography sx={{ fontSize: '0.8rem', color: C.slate, fontWeight: 500 }}>{k}</Typography>
                    <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: C.ink }}>{v}</Typography>
                  </Box>
                ))}
                {order.orderDocument && (
                  <Button
                    fullWidth
                    href={order.orderDocument}
                    target="_blank"
                    startIcon={<ExternalLink size={15} />}
                    sx={{
                      mt: 1.25, borderRadius: 2,
                      bgcolor: C.lineSoft,
                      color: C.primaryDk,
                      border: `1px solid ${C.line}`,
                      fontWeight: 700,
                      '&:hover': { bgcolor: C.line, color: C.ink },
                      boxShadow: 'none',
                    }}
                  >
                    View PO Document
                  </Button>
                )}
              </Box>
            </Paper>

            {/* System meta */}
            <Box sx={{ p: 1.5, textAlign: 'center' }}>
              <Typography sx={{ fontSize: '0.72rem', color: C.faint, fontStyle: 'italic' }}>
                System ID: {order.uniqueO2DId}
              </Typography>
            </Box>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
};

export default OrderDetails;
