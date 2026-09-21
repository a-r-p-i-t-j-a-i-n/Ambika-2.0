import React, { useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, Chip, Stack, IconButton, Skeleton, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, alpha,
} from '@mui/material';
import {
  ArrowLeft, Calendar, Truck, CheckCircle2, Clock, AlertTriangle, Package,
  ChevronRight, ClipboardList, FileText,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useGetOrderByIdQuery, useGetOrderScheduleQuery } from '../../store/api/orderApi';
import { useGetChallansQuery } from '../../store/api/dispatchControlApi';

const C = {
  ink: '#0b2545', body: '#1e3a8a', primary: '#1d4ed8', primaryDk: '#1e3a8a',
  success: '#0f766e', warning: '#b45309', error: '#be123c',
  slate: '#475a8a', faint: '#7d8fb3', line: '#dbe4f3',
  surface: '#ffffff', surfaceAlt: '#f5f8ff',
};

const fmt = (v) => Number(v || 0).toLocaleString('en-IN');
const fmtD = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');

const PHASE_STATUS = {
  PLANNED:     { label: 'Planned',     color: C.primary },
  IN_PROGRESS: { label: 'In Progress', color: C.warning },
  DISPATCHED:  { label: 'Dispatched',  color: C.success },
  DELAYED:     { label: 'Delayed',     color: C.error },
  CANCELLED:   { label: 'Cancelled',   color: C.slate },
};

const Kpi = ({ label, value, sub, color }) => (
  <Box sx={{
    flex: '1 1 140px', minWidth: 130, px: 1.75, py: 1.1, borderRadius: 2,
    bgcolor: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.16)',
  }}>
    <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' }}>
      {label}
    </Typography>
    <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: color || '#fff', lineHeight: 1.15 }}>
      {value}
    </Typography>
    {sub && <Typography sx={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.6)' }}>{sub}</Typography>}
  </Box>
);

const PhaseDetail = () => {
  const { id, phaseNo } = useParams();
  const navigate = useNavigate();

  const { data: orderRes, isLoading } = useGetOrderByIdQuery(id);
  const order = orderRes?.data;
  const { data: schedRes } = useGetOrderScheduleQuery(order?.soNumber, { skip: !order?.soNumber });
  const { data: challansRes } = useGetChallansQuery(
    { soNumber: order?.soNumber, limit: 100, sort: '-dcDate' }, { skip: !order?.soNumber },
  );
  const schedule = schedRes?.data?.[0];
  const challans = (challansRes?.data || []).filter((c) => c.phaseRef?.phaseNo === phaseNo);

  // Every SKU's slice of this phase.
  const rows = useMemo(() => {
    if (!schedule) return [];
    return (schedule.items || [])
      .map((item) => {
        const ph = (item.phases || []).find((p) => p.phaseNo === phaseNo);
        if (!ph) return null;
        const planned = ph.plannedQty || 0;
        const actual = ph.totalActualQty || 0;
        return {
          skuName: item.skuName, skuCode: item.skuCode,
          plannedDate: ph.plannedDate, status: ph.status, notes: ph.notes,
          planned, actual, remaining: Math.max(0, planned - actual),
          // Cancelled dispatches were reversed — never list them as shipments.
          dispatches: (ph.actualDispatches || []).filter((d) => !d.cancelled),
        };
      })
      .filter(Boolean);
  }, [schedule, phaseNo]);

  const plannedTotal = rows.reduce((s, r) => s + r.planned, 0);
  const actualTotal = rows.reduce((s, r) => s + r.actual, 0);
  const remainTotal = Math.max(0, plannedTotal - actualTotal);
  const achievePct = plannedTotal > 0 ? Math.round((actualTotal / plannedTotal) * 100) : 0;
  const plannedDate = rows[0]?.plannedDate;
  const late = plannedDate && dayjs(plannedDate).isBefore(dayjs(), 'day') && actualTotal < plannedTotal;
  const phaseStatus = late ? 'DELAYED' : (rows[0]?.status || 'PLANNED');
  const meta = PHASE_STATUS[phaseStatus] || PHASE_STATUS.PLANNED;

  // All dispatch events in this phase, newest first.
  const events = useMemo(() => {
    const out = [];
    rows.forEach((r) => (r.dispatches || []).forEach((d) => out.push({ skuName: r.skuName, ...d })));
    return out.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [rows]);

  if (isLoading) {
    return <Box sx={{ p: 3 }}><Skeleton variant="rectangular" height={420} sx={{ borderRadius: 2 }} /></Box>;
  }
  if (!order) return <Box sx={{ p: 3 }}><Typography>Order not found.</Typography></Box>;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: C.surfaceAlt, pb: 4 }}>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <Box sx={{
        background: `linear-gradient(135deg, ${C.ink} 0%, ${C.primaryDk} 55%, ${C.primary} 100%)`,
        color: '#fff', px: { xs: 2, md: 3 }, pt: 2, pb: 2.5,
      }}>
        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
          <IconButton size="small" onClick={() => navigate(`/orders/${id}`)}
            sx={{ color: '#fff', bgcolor: 'rgba(255,255,255,0.12)' }}>
            <ArrowLeft size={16} />
          </IconButton>
          <Box sx={{ width: 38, height: 38, borderRadius: 2, display: 'grid', placeItems: 'center',
            background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}>
            <Calendar size={19} color="#fff" />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: { xs: '1.1rem', md: '1.35rem' }, fontWeight: 800 }}>
              Phase {phaseNo}
            </Typography>
            <Typography sx={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.78)' }}>
              {order.soNumber} · {order.partyName}
            </Typography>
          </Box>
          <Chip
            icon={late ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
            label={late ? `Delayed · planned ${fmtD(plannedDate)}` : meta.label}
            sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: '#fff', fontWeight: 800, fontSize: '0.68rem',
              border: '1px solid rgba(255,255,255,0.28)', '& .MuiChip-icon': { color: '#fff' } }}
          />
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Kpi label="Planned Date" value={dayjs(plannedDate).isValid() ? dayjs(plannedDate).format('DD MMM YYYY') : '—'} sub={late ? 'overdue' : 'on schedule'} />
          <Kpi label="Planned" value={fmt(plannedTotal)} sub={`${rows.length} SKU(s)`} />
          <Kpi label="Dispatched" value={fmt(actualTotal)} color="#7ee0c8" sub={`${events.length} dispatch(es)`} />
          <Kpi label="Remaining" value={fmt(remainTotal)} color={remainTotal > 0 ? '#ffd9a0' : '#7ee0c8'} />
          <Kpi label="Achievement" value={`${achievePct}%`} />
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.5, md: 2.5 }, mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* ── The plan vs actual, per SKU ──────────────────────── */}
        <Paper sx={{ borderRadius: 3, border: `1px solid ${C.line}`, overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 1 }}>
            <ClipboardList size={16} color={C.primary} />
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: C.ink }}>
              What was planned vs what shipped
            </Typography>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { fontSize: '0.66rem', fontWeight: 800, color: C.slate, textTransform: 'uppercase', bgcolor: C.surfaceAlt } }}>
                  <TableCell>SKU (item)</TableCell>
                  <TableCell>Planned Date</TableCell>
                  <TableCell>Actually Dispatched On</TableCell>
                  <TableCell align="right">Planned</TableCell>
                  <TableCell align="right">Dispatched</TableCell>
                  <TableCell align="right">Remaining</TableCell>
                  <TableCell sx={{ minWidth: 120 }}>Progress</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r, i) => {
                  const pct = r.planned > 0 ? Math.min(100, Math.round((r.actual / r.planned) * 100)) : 0;
                  const done = r.remaining <= 0 && r.planned > 0;
                  const dispDates = (r.dispatches || []).map((d) => d.date).filter(Boolean)
                    .sort((a, b) => new Date(a) - new Date(b));
                  const lastDisp = dispDates[dispDates.length - 1];
                  const firstDisp = dispDates[0];
                  const lateDays = (lastDisp && r.plannedDate) ? dayjs(lastDisp).diff(dayjs(r.plannedDate), 'day') : null;
                  return (
                    <TableRow key={i} hover>
                      <TableCell>
                        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: C.ink }}>{r.skuName}</Typography>
                        <Typography sx={{ fontSize: '0.68rem', color: C.faint }}>{r.skuCode}</Typography>
                      </TableCell>
                      {/* Planned date — the committed delivery date */}
                      <TableCell>
                        <Stack direction="row" spacing={0.6} alignItems="center">
                          <Calendar size={13} color={C.primary} />
                          <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: C.ink }}>{fmtD(r.plannedDate)}</Typography>
                        </Stack>
                        <Typography sx={{ fontSize: '0.62rem', color: C.faint }}>committed to deliver</Typography>
                      </TableCell>
                      {/* Actual dispatch date(s) */}
                      <TableCell>
                        {lastDisp ? (
                          <>
                            <Stack direction="row" spacing={0.6} alignItems="center">
                              <Truck size={13} color={C.success} />
                              <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: C.ink }}>
                                {firstDisp !== lastDisp ? `${fmtD(firstDisp)} – ${fmtD(lastDisp)}` : fmtD(lastDisp)}
                              </Typography>
                            </Stack>
                            <Chip
                              size="small"
                              label={lateDays > 0 ? `${lateDays} day(s) late` : 'on / before time'}
                              sx={{
                                mt: 0.3, height: 17, fontSize: '0.6rem', fontWeight: 800,
                                color: lateDays > 0 ? C.error : C.success,
                                bgcolor: alpha(lateDays > 0 ? C.error : C.success, 0.1),
                              }}
                            />
                            {dispDates.length > 1 && (
                              <Typography component="span" sx={{ fontSize: '0.62rem', color: C.faint, ml: 0.6 }}>
                                {dispDates.length} dispatches
                              </Typography>
                            )}
                          </>
                        ) : (
                          <Stack direction="row" spacing={0.6} alignItems="center">
                            <Clock size={13} color={C.warning} />
                            <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: C.warning }}>Not dispatched yet</Typography>
                          </Stack>
                        )}
                      </TableCell>
                      <TableCell align="right"><Typography sx={{ fontSize: '0.84rem', fontWeight: 800, color: C.ink }}>{fmt(r.planned)}</Typography></TableCell>
                      <TableCell align="right"><Typography sx={{ fontSize: '0.84rem', fontWeight: 800, color: C.success }}>{fmt(r.actual)}</Typography></TableCell>
                      <TableCell align="right"><Typography sx={{ fontSize: '0.84rem', fontWeight: 800, color: done ? C.success : C.warning }}>{fmt(r.remaining)}</Typography></TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <LinearProgress variant="determinate" value={pct}
                            sx={{ flex: 1, height: 7, borderRadius: 4, bgcolor: alpha(C.ink, 0.08),
                              '& .MuiLinearProgress-bar': { bgcolor: done ? C.success : C.primary } }} />
                          <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, minWidth: 34, color: done ? C.success : C.primary }}>{pct}%</Typography>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={7}>
                    <Stack alignItems="center" sx={{ py: 5, color: C.faint, gap: 1 }}>
                      <Package size={30} style={{ opacity: 0.5 }} />
                      <Typography sx={{ fontSize: '0.82rem' }}>No SKUs found for phase {phaseNo}.</Typography>
                    </Stack>
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
          {rows.length > 0 && (
            <Box sx={{ display: 'flex', gap: 3, p: 2, borderTop: `1px solid ${C.line}`, bgcolor: C.surfaceAlt, flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: C.ink }}>Planned {fmt(plannedTotal)}</Typography>
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: C.success }}>Dispatched {fmt(actualTotal)}</Typography>
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: remainTotal > 0 ? C.warning : C.success }}>Remaining {fmt(remainTotal)}</Typography>
            </Box>
          )}
        </Paper>

        {/* ── Dispatch activity timeline ───────────────────────── */}
        <Paper sx={{ borderRadius: 3, border: `1px solid ${C.line}`, overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Truck size={16} color={C.primary} />
            <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: C.ink }}>Dispatch Activity</Typography>
            <Chip label={`${events.length} event(s)`} size="small"
              sx={{ ml: 'auto', height: 22, fontWeight: 700, bgcolor: alpha(C.primary, 0.1), color: C.primaryDk }} />
          </Box>
          {events.length === 0 ? (
            <Stack alignItems="center" sx={{ py: 5, color: C.faint, gap: 1 }}>
              <Clock size={30} style={{ opacity: 0.5 }} />
              <Typography sx={{ fontSize: '0.82rem' }}>Nothing dispatched against this phase yet.</Typography>
            </Stack>
          ) : (
            <Stack sx={{ p: 2 }} spacing={1.25}>
              {events.map((e, i) => (
                <Stack key={i} direction="row" spacing={1.5} alignItems="center"
                  sx={{ p: 1.4, borderRadius: 2, border: `1px solid ${C.line}` }}>
                  <Box sx={{ width: 34, height: 34, borderRadius: 1.5, flexShrink: 0, display: 'grid', placeItems: 'center',
                    bgcolor: alpha(C.success, 0.1), color: C.success }}>
                    <CheckCircle2 size={16} />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: C.ink }}>{e.skuName}</Typography>
                    <Typography sx={{ fontSize: '0.7rem', color: C.slate }}>
                      {fmtD(e.date)}{e.invoiceNo ? ` · Invoice ${e.invoiceNo}` : ''}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: C.success }}>+{fmt(e.qty)}</Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Paper>

        {/* ── Delivery challans fulfilling this phase ───────────── */}
        {challans.length > 0 && (
          <Paper sx={{ borderRadius: 3, border: `1px solid ${C.line}`, overflow: 'hidden' }}>
            <Box sx={{ p: 2, borderBottom: `1px solid ${C.line}`, display: 'flex', alignItems: 'center', gap: 1 }}>
              <FileText size={16} color={C.primary} />
              <Typography sx={{ fontSize: '0.9rem', fontWeight: 800, color: C.ink }}>Delivery Challans</Typography>
            </Box>
            <Stack sx={{ p: 1.5 }} spacing={1}>
              {challans.map((dc) => (
                <Stack key={dc._id} direction="row" spacing={1.5} alignItems="center"
                  onClick={() => navigate(`/challans/${dc._id}`)}
                  sx={{ p: 1.4, borderRadius: 2, border: `1px solid ${C.line}`, cursor: 'pointer',
                    '&:hover': { borderColor: alpha(C.primary, 0.4), bgcolor: alpha(C.primary, 0.03) } }}>
                  <Truck size={15} color={C.primary} />
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: C.primary }}>{dc.dcNumber}</Typography>
                    <Typography sx={{ fontSize: '0.7rem', color: C.slate }}>
                      {fmtD(dc.dcDate)} · {fmt(dc.totalQuantityPcs)} pcs · {dc.vehicleNo || 'no vehicle'}
                    </Typography>
                  </Box>
                  <ChevronRight size={15} color={C.faint} />
                </Stack>
              ))}
            </Stack>
          </Paper>
        )}

        {/* ── Planner note ──────────────────────────────────────── */}
        {rows.some((r) => r.notes) && (
          <Paper sx={{ p: 2, borderRadius: 3, border: `1px solid ${C.line}` }}>
            <Typography sx={{ fontSize: '0.64rem', fontWeight: 800, color: C.faint, textTransform: 'uppercase' }}>Planner Note</Typography>
            <Typography sx={{ fontSize: '0.84rem', color: C.body }}>
              {rows.find((r) => r.notes)?.notes}
            </Typography>
          </Paper>
        )}
      </Box>
    </Box>
  );
};

export default PhaseDetail;
