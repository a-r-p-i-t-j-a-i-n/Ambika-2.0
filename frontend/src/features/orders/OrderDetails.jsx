import React, { useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, Typography, Paper, Chip, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Skeleton, Button, IconButton, Stack, Tabs, Tab, alpha, Tooltip,
} from '@mui/material';
import {
  ArrowLeft, ExternalLink, CheckCircle2, Clock, Truck, Calendar,
  MapPin, Hash, User, CalendarPlus, Inbox, AlertTriangle, ChevronRight,
  ClipboardList, FileText, Boxes, Pencil, Ban, RotateCcw, History,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useGetOrderByIdQuery, useGetOrderScheduleQuery } from '../../store/api/orderApi';
import { useGetOrderComparisonQuery, useGetChallansQuery } from '../../store/api/dispatchControlApi';
import PlanVsActualPanel from './components/PlanVsActualPanel';
import DispatchEntry from '../execution/DispatchEntry';
import OrderEntryDrawer from './OrderEntryDrawer';
import CancelOrderDialog from './components/CancelOrderDialog';
import { resolveFileUrl } from '../../utils/fileUrl';
import { useSmartBack } from '../../hooks/useSmartBack';

// Neutrals follow the client's WARM palette (o2dTheme); status hues stay saturated.
const C = {
  ink: '#1c1e21', body: '#3f4650', primary: '#1d4ed8', primaryDk: '#1e3a8a',
  success: '#0f766e', warning: '#b45309', error: '#be123c', wip: '#5b6cff',
  slate: '#6b7280', faint: '#9ca3af', line: '#e4e1d9', lineSoft: '#eeebe4',
  surface: '#ffffff', surfaceAlt: '#f7f6f2', canvas: '#e9e7e1',
};

const fmt = (v) => Number(v || 0).toLocaleString('en-IN');
const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtDT = (d) => (d ? dayjs(d).format('DD MMM YYYY · hh:mm A') : '—');
const fmtD = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '—');

const RISK_LABEL = {
  OVERDUE_PLAN:        'phase overdue',
  UNPLANNED_DISPATCH:  'dispatched without a plan phase',
  OVER_DISPATCH:       'dispatched more than planned',
  BALANCE_NOT_PLANNED: 'balance quantity not yet planned',
};

const STATUS_COLOR = {
  RECEIVED: C.warning, PLANNING: C.wip, IN_PROGRESS: C.primary,
  COMPLETED: C.success, CANCELLED: C.error, SHORT_CLOSED: C.slate,
};

const StatusBadge = ({ value }) => {
  const color = STATUS_COLOR[value] || C.slate;
  return (
    <Chip label={(value || '').replace('_', ' ')} size="small" sx={{
      bgcolor: alpha(color, 0.1), color, fontWeight: 800, fontSize: '0.64rem',
      letterSpacing: '0.05em', border: `1px solid ${alpha(color, 0.22)}`,
    }} />
  );
};

// Hero action button — compact and fixed-width-ish so a 14" header never wraps.
const heroBtn = {
  fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, minWidth: 0,
  px: 1.25, py: 0.4, fontSize: '0.75rem', boxShadow: 'none', textTransform: 'none',
  borderRadius: '6px', color: C.body, background: C.surface,
  border: `1px solid ${C.line}`,
  '& .MuiButton-startIcon': { mr: 0.5 },
  '&:hover': { background: C.surfaceAlt, borderColor: C.line },
};

const Kpi = ({ label, value, sub, color }) => (
  <Box sx={{
    flex: '1 1 96px', minWidth: 88, px: 1.1, py: 0.6, borderRadius: '6px',
    bgcolor: C.surfaceAlt, border: `1px solid ${C.line}`,
  }}>
    <Typography sx={{ fontSize: '0.55rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.faint }} noWrap>
      {label}
    </Typography>
    <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: color || C.ink, lineHeight: 1.2 }}>
      {value}
    </Typography>
    {sub && <Typography sx={{ fontSize: '0.56rem', color: C.faint }} noWrap>{sub}</Typography>}
  </Box>
);

// ── Order Journey timeline node ──────────────────────────────────────
const JourneyNode = ({ node, last }) => {
  const color = node.late ? C.error : node.done ? C.success : C.faint;
  const Icon = node.icon;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 140, flexShrink: 0, position: 'relative' }}>
      {!last && (
        <Box sx={{ position: 'absolute', top: 17, left: '50%', width: '100%', height: 2,
          bgcolor: node.done ? alpha(C.success, 0.4) : C.line }} />
      )}
      <Box sx={{
        width: 36, height: 36, borderRadius: '50%', display: 'grid', placeItems: 'center',
        bgcolor: node.done ? color : C.surface, color: node.done ? '#fff' : color,
        border: `2px solid ${color}`, position: 'relative', zIndex: 1,
      }}>
        <Icon size={17} />
      </Box>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: C.ink, mt: 0.75, textAlign: 'center' }}>
        {node.label}
      </Typography>
      <Typography sx={{ fontSize: '0.64rem', color: node.late ? C.error : C.slate, textAlign: 'center', fontWeight: 600 }}>
        {node.date ? fmtDT(node.date) : '—'}
      </Typography>
      {node.sub && (
        <Typography sx={{ fontSize: '0.64rem', color: C.faint, textAlign: 'center' }}>
          {node.late ? '⚠ ' : ''}{node.sub}
        </Typography>
      )}
    </Box>
  );
};

const TABS = [
  { key: 'order',    label: 'Order',          icon: Inbox },
  { key: 'plan',     label: 'Plan vs Actual', icon: ClipboardList },
  { key: 'phases',   label: 'Phases',         icon: Calendar },
  { key: 'dispatch', label: 'Dispatch History', icon: Truck },
  { key: 'workflow', label: 'Workflow',       icon: CheckCircle2 },
  { key: 'docs',     label: 'Documents',      icon: FileText },
];

const WORKFLOW_STEPS = [
  { key: 'poEntry',        label: 'PO Entry in Tally' },
  { key: 'inventoryCheck', label: 'Check Inventory' },
  { key: 'scheduling',     label: 'Create Dispatch Schedule' },
  { key: 'emailSchedule',  label: 'Email Dispatch Schedule' },
];

const OrderDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const goBack = useSmartBack('/orders');
  const [searchParams, setSearchParams] = useSearchParams();
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [amendOpen, setAmendOpen] = useState(false);      // revise qty / add-remove items
  const [cancelMode, setCancelMode] = useState(null);     // 'cancel' | 'reopen' | null

  const tab = TABS.some((t) => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'order';
  const setTab = (t) => {
    const p = new URLSearchParams(searchParams);
    p.set('tab', t);
    setSearchParams(p, { replace: true });
  };

  const { data: orderRes, isLoading } = useGetOrderByIdQuery(id);
  const order = orderRes?.data;
  const { data: scheduleRes } = useGetOrderScheduleQuery(order?.soNumber, { skip: !order?.soNumber });
  const { data: comparisonRes } = useGetOrderComparisonQuery(order?.soNumber, { skip: !order?.soNumber });
  const { data: challansRes } = useGetChallansQuery(
    { soNumber: order?.soNumber, limit: 100, sort: '-dcDate' }, { skip: !order?.soNumber },
  );
  const schedule = scheduleRes?.data?.[0];
  const comparison = comparisonRes?.data;
  const challans = challansRes?.data || [];
  const isCancelled = order?.status === 'CANCELLED';

  // Roll phases up across all SKUs, keyed by phaseNo.
  const phaseRollup = useMemo(() => {
    const map = new Map();
    (schedule?.items || []).forEach((item) => {
      (item.phases || []).forEach((ph) => {
        const e = map.get(ph.phaseNo) || {
          phaseNo: ph.phaseNo, plannedDate: ph.plannedDate, plannedQty: 0, actualQty: 0,
          status: ph.status, skus: [],
        };
        e.plannedQty += ph.plannedQty || 0;
        e.actualQty  += ph.totalActualQty || 0;
        if (ph.plannedDate && (!e.plannedDate || dayjs(ph.plannedDate).isBefore(e.plannedDate))) {
          e.plannedDate = ph.plannedDate;
        }
        e.skus.push({
          skuName: item.skuName, skuCode: item.skuCode,
          plannedQty: ph.plannedQty || 0, actualQty: ph.totalActualQty || 0, status: ph.status,
        });
        map.set(ph.phaseNo, e);
      });
    });
    return [...map.values()].sort((a, b) => new Date(a.plannedDate || 0) - new Date(b.plannedDate || 0));
  }, [schedule]);

  const t = comparison?.totals || {};
  const ordered  = t.orderQty   ?? order?.totalOrderQty ?? 0;
  const planned  = t.plannedQty ?? phaseRollup.reduce((s, p) => s + p.plannedQty, 0);
  const actual   = t.actualQty  ?? order?.totalDispatchedQty ?? 0;
  const balance  = t.balanceQty ?? order?.totalBalanceQty ?? 0;
  const fulfilment = ordered > 0 ? Math.round((actual / ordered) * 100) : 0;
  const adherence  = planned > 0 ? Math.round((actual / planned) * 100) : 0;

  // The journey — received → planned → each phase → completed.
  const journey = useMemo(() => {
    if (!order) return [];
    const nodes = [{
      key: 'received', label: 'Order Received', icon: Inbox, done: true,
      date: order.createdAt || order.orderDate,
      sub: order.createdBy?.name ? `by ${order.createdBy.name}` : 'PO booked',
    }];
    nodes.push({
      key: 'planned', label: schedule ? 'Dispatch Planned' : 'Not Planned', icon: CalendarPlus,
      done: !!schedule, date: schedule?.createdAt,
      sub: schedule ? `${phaseRollup.length} phase(s)` : 'plan pending',
    });
    phaseRollup.forEach((ph) => {
      const done = ph.plannedQty > 0 && ph.actualQty >= ph.plannedQty;
      const late = !done && ph.plannedDate && dayjs(ph.plannedDate).isBefore(dayjs(), 'day');
      nodes.push({
        key: ph.phaseNo, label: `Phase ${ph.phaseNo}`, icon: Truck, done, late,
        date: ph.plannedDate, sub: `${fmt(ph.actualQty)} / ${fmt(ph.plannedQty)} pcs`,
      });
    });
    const completed = order.status === 'COMPLETED';
    nodes.push({
      key: 'done', label: completed ? 'Completed' : 'Pending Completion', icon: CheckCircle2,
      done: completed, date: completed ? order.updatedAt : null,
      sub: completed ? 'fully dispatched' : `${fmt(balance)} pcs left`,
    });
    return nodes;
  }, [order, schedule, phaseRollup, balance]);

  // What's lacking — every gap in plain words.
  const lacking = useMemo(() => {
    const out = [];
    if (!schedule) out.push('No dispatch plan has been created for this order yet.');
    if (balance > 0) out.push(`${fmt(balance)} pcs are still pending dispatch.`);
    phaseRollup.forEach((ph) => {
      if (ph.plannedQty > 0 && ph.actualQty < ph.plannedQty
          && ph.plannedDate && dayjs(ph.plannedDate).isBefore(dayjs(), 'day')) {
        out.push(`Phase ${ph.phaseNo} (due ${fmtD(ph.plannedDate)}) is short by ${fmt(ph.plannedQty - ph.actualQty)} pcs.`);
      }
    });
    (comparison?.rows || []).forEach((r) => {
      (r.risks || []).forEach((rk) => {
        out.push(`${r.skuName}: ${RISK_LABEL[rk.type] || rk.type}${rk.qty ? ` (${fmt(rk.qty)} pcs)` : ''}.`);
      });
    });
    return out;
  }, [schedule, balance, phaseRollup, comparison]);

  if (isLoading) return <Box sx={{ p: 3 }}><Skeleton variant="rectangular" height={420} sx={{ borderRadius: 2 }} /></Box>;
  if (!order) return <Box sx={{ p: 3 }}><Typography>Order not found.</Typography></Box>;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: C.canvas, pb: 4 }}>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <Box sx={{
        bgcolor: C.surface, borderBottom: `1px solid ${C.line}`,
        px: { xs: 1.5, md: 2 }, pt: 1.25, pb: 1.25,
        position: 'sticky', top: 0, zIndex: 5,
      }}>
        {/* One line, always. The SO number and the action buttons never wrap or
            shrink; the party name absorbs the slack and ellipsises instead — so a
            14" screen keeps the identity and every action on a single tidy row. */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.25, flexWrap: 'nowrap' }}>
          {/* Back = where the user actually came from (Step Board, task page…);
              /orders only as the deep-link fallback. */}
          <IconButton size="small" onClick={goBack}
            sx={{ color: C.body, border: `1px solid ${C.line}`, borderRadius: '6px', flexShrink: 0 }}>
            <ArrowLeft size={15} />
          </IconButton>
          <Typography sx={{ fontSize: { xs: '1rem', md: '1.15rem' }, fontWeight: 800, color: C.ink, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {order.soNumber}
          </Typography>
          <Box sx={{ flexShrink: 0 }}><StatusBadge value={order.status} /></Box>
          <Typography noWrap sx={{ fontSize: '0.8rem', color: C.slate, flex: 1, minWidth: 0 }}>
            · {order.partyName}
          </Typography>
          {/* A cancelled order is read-only: no planning / dispatching until it's
              re-opened. Amend stays available on every live order — the customer
              revising quantities (or adding an item) is normal business. */}
          {isCancelled ? (
            <Button size="small" variant="contained" startIcon={<RotateCcw size={13} />}
              onClick={() => setCancelMode('reopen')} sx={heroBtn}>
              Re-open
            </Button>
          ) : (
            <>
              <Tooltip title="Amend order — revise quantities, add or remove items">
                <Button size="small" variant="contained" startIcon={<Pencil size={13} />}
                  onClick={() => setAmendOpen(true)} sx={heroBtn}>
                  Amend
                </Button>
              </Tooltip>
              <Tooltip title="Plan dispatch phases">
                <Button size="small" variant="contained" startIcon={<CalendarPlus size={13} />}
                  onClick={() => navigate(`/dispatch-planning?so=${encodeURIComponent(order.soNumber)}`)} sx={heroBtn}>
                  Plan
                </Button>
              </Tooltip>
              <Tooltip title="Record an actual dispatch (creates a delivery challan)">
                <Button size="small" variant="contained" startIcon={<Truck size={13} />}
                  onClick={() => setDispatchOpen(true)} sx={heroBtn}>
                  Dispatch
                </Button>
              </Tooltip>
              <Tooltip title="Cancel this order">
                <Button size="small" variant="contained" startIcon={<Ban size={13} />}
                  onClick={() => setCancelMode('cancel')}
                  sx={{ ...heroBtn, color: C.error, borderColor: alpha(C.error, 0.4), '&:hover': { background: alpha(C.error, 0.06), borderColor: C.error } }}>
                  Cancel
                </Button>
              </Tooltip>
            </>
          )}
        </Stack>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Kpi label="Ordered"    value={fmt(ordered)} />
          <Kpi label="Planned"    value={fmt(planned)} />
          <Kpi label="Dispatched" value={fmt(actual)} color="#7ee0c8" />
          <Kpi label="Balance"    value={fmt(balance)} color={balance > 0 ? '#ffd9a0' : '#7ee0c8'} />
          <Kpi label="Fulfilment" value={`${fulfilment}%`} sub="of order qty" />
          <Kpi label="Adherence"  value={`${adherence}%`} sub="actual vs plan" />
          <Kpi label="Risks"      value={lacking.length} color={lacking.length ? '#ffb4b4' : '#7ee0c8'} />
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.5, md: 2.5 }, mt: 2 }}>
        {/* ── Cancelled banner — why, when, and what was already shipped ─── */}
        {isCancelled && (
          <Paper sx={{ p: 1.75, borderRadius: 3, mb: 2,
            border: `1px solid ${alpha(C.error, 0.35)}`, bgcolor: alpha(C.error, 0.05) }}>
            <Stack direction="row" spacing={1.25} alignItems="flex-start">
              <Box sx={{ p: 0.6, borderRadius: 1.5, bgcolor: alpha(C.error, 0.12), color: C.error, display: 'flex' }}><Ban size={16} /></Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, color: C.error }}>
                  This order is cancelled{order.cancelledAt ? ` · ${fmtDT(order.cancelledAt)}` : ''}
                </Typography>
                {order.cancelReason && (
                  <Typography sx={{ fontSize: '0.78rem', color: C.slate, mt: 0.25 }}>
                    Reason: {order.cancelReason}
                  </Typography>
                )}
                <Typography sx={{ fontSize: '0.72rem', color: C.faint, mt: 0.25 }}>
                  Planning and dispatching are locked. {actual > 0
                    ? `${fmt(actual)} pcs were already dispatched — those challans and invoices still stand.`
                    : 'Nothing was dispatched.'} Re-open it to make it active again.
                </Typography>
              </Box>
            </Stack>
          </Paper>
        )}

        {/* ── Revision history — every amendment the customer asked for ─── */}
        {(order.amendments || []).length > 0 && (
          <Paper sx={{ p: 1.75, borderRadius: 3, mb: 2,
            border: `1px solid ${alpha(C.warning, 0.3)}`, bgcolor: alpha(C.warning, 0.04) }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <History size={15} color={C.warning} />
              <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: C.warning }}>
                Order revisions (Rev {order.revisionNo || order.amendments.length})
              </Typography>
            </Stack>
            <Stack spacing={0.75}>
              {[...order.amendments].reverse().map((a, i) => (
                <Box key={i} sx={{ pl: 1, borderLeft: `2px solid ${alpha(C.warning, 0.4)}` }}>
                  <Typography sx={{ fontSize: '0.72rem', color: C.faint }}>
                    {fmtDT(a.at)}{a.byName ? ` · by ${a.byName}` : ''}{a.reason ? ` · ${a.reason}` : ''}
                  </Typography>
                  {(a.changes || []).map((c, j) => (
                    <Typography key={j} sx={{ fontSize: '0.78rem', fontWeight: 700, color: C.ink }}>• {c}</Typography>
                  ))}
                </Box>
              ))}
            </Stack>
          </Paper>
        )}

        {/* ── Order Journey ──────────────────────────────────── */}
        <Paper sx={{ p: 2, borderRadius: 3, border: `1px solid ${C.line}`, mb: 2 }}>
          <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: C.slate, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 1.5 }}>
            Order Journey
          </Typography>
          <Box sx={{ display: 'flex', overflowX: 'auto', pb: 1, alignItems: 'flex-start' }}>
            {journey.map((n, i) => (
              <JourneyNode key={n.key} node={n} last={i === journey.length - 1} />
            ))}
          </Box>
        </Paper>

        {/* ── What's Lacking ─────────────────────────────────── */}
        {lacking.length > 0 && (
          <Paper sx={{ p: 2, borderRadius: 3, mb: 2,
            border: `1px solid ${alpha(C.error, 0.25)}`, bgcolor: alpha(C.error, 0.035) }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <AlertTriangle size={16} color={C.error} />
              <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: C.error }}>
                What's Lacking ({lacking.length})
              </Typography>
            </Stack>
            <Stack spacing={0.5}>
              {lacking.map((l, i) => (
                <Typography key={i} sx={{ fontSize: '0.78rem', color: C.body, pl: 1 }}>• {l}</Typography>
              ))}
            </Stack>
          </Paper>
        )}

        {/* ── Tabs ───────────────────────────────────────────── */}
        <Paper sx={{ borderRadius: 3, border: `1px solid ${C.line}`, overflow: 'hidden' }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}
            variant="scrollable" scrollButtons="auto"
            sx={{ borderBottom: `1px solid ${C.line}`, px: 1,
              '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', fontSize: '0.82rem', minHeight: 46 } }}>
            {TABS.map((tb) => (
              <Tab key={tb.key} value={tb.key} label={tb.label}
                icon={<tb.icon size={14} />} iconPosition="start" />
            ))}
          </Tabs>

          <Box sx={{ p: { xs: 1.5, md: 2.5 } }}>
            {/* ORDER — exactly what was received, item-wise */}
            {tab === 'order' && (
              order?.items?.length ? (() => {
                const items = order.items;
                const totOrdered = items.reduce((s, it) => s + Number(it.orderQty || 0), 0);
                const totValue = items.reduce((s, it) => s + Number(it.orderQty || 0) * Number(it.rate || 0), 0);
                const hasRate = items.some((it) => Number(it.rate) > 0);
                return (
                  <Box>
                    <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
                      <Chip icon={<Boxes size={14} />} label={`${items.length} item${items.length === 1 ? '' : 's'}`}
                        sx={{ fontWeight: 700, bgcolor: alpha(C.primary, 0.08), color: C.primaryDk }} />
                      <Chip label={`Ordered: ${fmt(totOrdered)} pcs`} sx={{ fontWeight: 700, bgcolor: alpha(C.primary, 0.08), color: C.primaryDk }} />
                      {order.poNumber && <Chip label={`PO ${order.poNumber}`} variant="outlined" sx={{ fontWeight: 700 }} />}
                      {order.poDate && <Chip label={`PO date ${fmtD(order.poDate)}`} variant="outlined" sx={{ fontWeight: 700 }} />}
                      {hasRate && <Chip label={`Order value: ${inr(totValue)}`} sx={{ fontWeight: 700, bgcolor: alpha(C.success, 0.1), color: C.success }} />}
                    </Stack>
                    <TableContainer sx={{ border: `1px solid ${C.line}`, borderRadius: 2 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={{ '& th': { fontSize: '0.66rem', fontWeight: 800, color: C.slate, textTransform: 'uppercase', bgcolor: C.surfaceAlt, letterSpacing: '0.05em' } }}>
                            <TableCell>#</TableCell>
                            <TableCell>Item</TableCell>
                            <TableCell align="right">Ordered (pcs)</TableCell>
                            <TableCell align="right">Rate (₹)</TableCell>
                            <TableCell align="right">Value (₹)</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {items.map((it, i) => {
                            const q = Number(it.orderQty || 0);
                            const r = Number(it.rate || 0);
                            return (
                              <TableRow key={it._id || i} hover>
                                <TableCell><Typography sx={{ fontSize: '0.78rem', color: C.faint }}>{i + 1}</Typography></TableCell>
                                <TableCell>
                                  <Typography sx={{ fontSize: '0.84rem', fontWeight: 700, color: C.ink }}>{it.skuName}</Typography>
                                  <Typography sx={{ fontSize: '0.68rem', color: C.faint }}>{it.skuCode}{it.asnCode ? ` · ASN ${it.asnCode}` : ''}</Typography>
                                </TableCell>
                                <TableCell align="right"><Typography sx={{ fontSize: '0.88rem', fontWeight: 800, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>{fmt(q)}</Typography></TableCell>
                                <TableCell align="right"><Typography sx={{ fontSize: '0.82rem', color: C.slate, fontVariantNumeric: 'tabular-nums' }}>{r ? inr(r) : '—'}</Typography></TableCell>
                                <TableCell align="right"><Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: C.ink, fontVariantNumeric: 'tabular-nums' }}>{r ? inr(q * r) : '—'}</Typography></TableCell>
                              </TableRow>
                            );
                          })}
                          <TableRow sx={{ '& td': { borderTop: `2px solid ${C.line}`, bgcolor: C.surfaceAlt } }}>
                            <TableCell />
                            <TableCell><Typography sx={{ fontSize: '0.74rem', fontWeight: 800, color: C.ink, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total</Typography></TableCell>
                            <TableCell align="right"><Typography sx={{ fontSize: '0.88rem', fontWeight: 800, color: C.primaryDk, fontVariantNumeric: 'tabular-nums' }}>{fmt(totOrdered)}</Typography></TableCell>
                            <TableCell />
                            <TableCell align="right"><Typography sx={{ fontSize: '0.84rem', fontWeight: 800, color: hasRate ? C.success : C.faint, fontVariantNumeric: 'tabular-nums' }}>{hasRate ? inr(totValue) : '—'}</Typography></TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                );
              })() : <Empty icon={Inbox} text="This order has no item lines yet." />
            )}

            {/* PLAN VS ACTUAL */}
            {tab === 'plan' && (
              comparison
                ? <PlanVsActualPanel comparison={comparison} />
                : <Empty icon={ClipboardList} text="Plan-vs-actual appears once the order is planned and dispatched." />
            )}

            {/* PHASES */}
            {tab === 'phases' && (
              phaseRollup.length === 0
                ? <Empty icon={Calendar} text="No phases planned yet. Use 'Plan Phases' to schedule dispatches." />
                : (
                  <Stack spacing={2}>
                    {phaseRollup.map((ph) => {
                      const done = ph.plannedQty > 0 && ph.actualQty >= ph.plannedQty;
                      const late = !done && ph.plannedDate && dayjs(ph.plannedDate).isBefore(dayjs(), 'day');
                      const pct = ph.plannedQty > 0 ? Math.min(100, Math.round((ph.actualQty / ph.plannedQty) * 100)) : 0;
                      const c = done ? C.success : late ? C.error : C.primary;
                      return (
                        <Box key={ph.phaseNo} sx={{ border: `1px solid ${C.line}`, borderRadius: 2, overflow: 'hidden' }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, bgcolor: C.surfaceAlt, flexWrap: 'wrap' }}>
                            <Chip label={`Phase ${ph.phaseNo}`} size="small" sx={{ fontWeight: 800, bgcolor: alpha(c, 0.12), color: c }} />
                            <Stack direction="row" spacing={0.5} alignItems="center">
                              <Calendar size={12} color={C.slate} />
                              <Typography sx={{ fontSize: '0.76rem', fontWeight: 700, color: late ? C.error : C.slate }}>
                                {fmtD(ph.plannedDate)}{late ? ' · overdue' : ''}
                              </Typography>
                            </Stack>
                            <Box sx={{ flex: 1 }} />
                            <Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: C.ink }}>
                              {fmt(ph.actualQty)} / {fmt(ph.plannedQty)} pcs · {pct}%
                            </Typography>
                          </Box>
                          <TableContainer>
                            <Table size="small">
                              <TableHead>
                                <TableRow sx={{ '& th': { fontSize: '0.66rem', fontWeight: 800, color: C.slate, textTransform: 'uppercase' } }}>
                                  <TableCell>SKU</TableCell>
                                  <TableCell align="right">Planned</TableCell>
                                  <TableCell align="right">Actual</TableCell>
                                  <TableCell align="right">Balance</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {ph.skus.map((s, i) => (
                                  <TableRow key={i}>
                                    <TableCell>
                                      <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: C.ink }}>{s.skuName}</Typography>
                                      <Typography sx={{ fontSize: '0.68rem', color: C.faint }}>{s.skuCode}</Typography>
                                    </TableCell>
                                    <TableCell align="right"><Typography sx={{ fontSize: '0.82rem', fontWeight: 700 }}>{fmt(s.plannedQty)}</Typography></TableCell>
                                    <TableCell align="right"><Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: C.success }}>{fmt(s.actualQty)}</Typography></TableCell>
                                    <TableCell align="right"><Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: s.actualQty >= s.plannedQty ? C.success : C.warning }}>{fmt(Math.max(0, s.plannedQty - s.actualQty))}</Typography></TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </Box>
                      );
                    })}
                  </Stack>
                )
            )}

            {/* DISPATCH HISTORY */}
            {tab === 'dispatch' && (
              challans.length === 0
                ? <Empty icon={Truck} text="No delivery challans recorded for this order yet." />
                : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ '& th': { fontSize: '0.66rem', fontWeight: 800, color: C.slate, textTransform: 'uppercase' } }}>
                          <TableCell>DC #</TableCell>
                          <TableCell>Date</TableCell>
                          <TableCell>Phase</TableCell>
                          <TableCell align="right">Qty</TableCell>
                          <TableCell>Vehicle</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {challans.map((dc) => (
                          <TableRow key={dc._id} hover sx={{ cursor: 'pointer' }}
                            onClick={() => navigate(`/challans/${dc._id}`)}>
                            <TableCell><Typography sx={{ fontSize: '0.8rem', fontWeight: 800, color: C.primary }}>{dc.dcNumber}</Typography></TableCell>
                            <TableCell><Typography sx={{ fontSize: '0.78rem', color: C.slate }}>{fmtD(dc.dcDate)}</Typography></TableCell>
                            <TableCell>
                              {dc.isUnplanned
                                ? <Chip size="small" label="Unplanned" sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700, bgcolor: alpha(C.warning, 0.12), color: C.warning }} />
                                : <Typography sx={{ fontSize: '0.78rem', fontWeight: 700 }}>{dc.phaseRef?.phaseNo || '—'}</Typography>}
                            </TableCell>
                            <TableCell align="right"><Typography sx={{ fontSize: '0.82rem', fontWeight: 800 }}>{fmt(dc.totalQuantityPcs)}</Typography></TableCell>
                            <TableCell><Typography sx={{ fontSize: '0.76rem', color: C.slate }}>{dc.vehicleNo || '—'}</Typography></TableCell>
                            <TableCell><StatusBadge value={dc.status} /></TableCell>
                            <TableCell><ChevronRight size={15} color={C.faint} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )
            )}

            {/* WORKFLOW */}
            {tab === 'workflow' && (
              <Stack spacing={1.25}>
                {WORKFLOW_STEPS.map((step) => {
                  const d = order[step.key] || {};
                  const done = d.status === 'DONE';
                  return (
                    <Box key={step.key} sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 2,
                      border: `1px solid ${done ? alpha(C.success, 0.25) : C.line}`,
                      bgcolor: done ? alpha(C.success, 0.04) : C.surface,
                    }}>
                      {done ? <CheckCircle2 size={20} color={C.success} /> : <Clock size={20} color={C.faint} />}
                      <Box sx={{ flex: 1 }}>
                        <Typography sx={{ fontSize: '0.82rem', fontWeight: 700, color: C.ink }}>{step.label}</Typography>
                        <Typography sx={{ fontSize: '0.68rem', color: C.slate }}>
                          Planned: {fmtD(d.planned)}  ·  Actual: {fmtD(d.actual)}
                        </Typography>
                      </Box>
                      <StatusBadge value={d.status || 'PENDING'} />
                    </Box>
                  );
                })}
              </Stack>
            )}

            {/* DOCUMENTS */}
            {tab === 'docs' && (
              <Stack spacing={1.25}>
                <DocRow label="Purchase Order document" url={order.orderDocument} />
                <DocRow label="Dispatch Schedule PDF" url={schedule?.pdfUrl} />
                {challans.filter((d) => d.pdfUrl).map((d) => (
                  <DocRow key={d._id} label={`Challan ${d.dcNumber}`} url={d.pdfUrl} />
                ))}
                {!order.orderDocument && !schedule?.pdfUrl && !challans.some((d) => d.pdfUrl) && (
                  <Empty icon={FileText} text="No documents attached to this order yet." />
                )}
              </Stack>
            )}
          </Box>
        </Paper>

        {/* ── Customer & meta strip ──────────────────────────── */}
        <Paper sx={{ p: 2, borderRadius: 3, border: `1px solid ${C.line}`, mt: 2 }}>
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
            {[
              { icon: User, label: 'Customer', value: order.partyName },
              { icon: Hash, label: 'PO Number', value: order.poNumber || '—' },
              { icon: Calendar, label: 'PO Date', value: fmtD(order.poDate) },
              { icon: MapPin, label: 'Location', value: order.location || '—' },
              { icon: Truck, label: 'Transport', value: order.transport || 'Road' },
              { icon: Calendar, label: 'Order Date', value: fmtD(order.orderDate) },
              { icon: Boxes, label: 'SKU Lines', value: order.items?.length || 0 },
              { icon: Clock, label: 'Booked', value: fmtDT(order.createdAt) },
            ].map((m) => (
              <Stack key={m.label} direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 30, height: 30, borderRadius: 1.5, display: 'grid', placeItems: 'center',
                  bgcolor: alpha(C.primary, 0.08), color: C.primary }}>
                  <m.icon size={14} />
                </Box>
                <Box>
                  <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: C.faint, textTransform: 'uppercase' }}>{m.label}</Typography>
                  <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: C.ink }}>{m.value}</Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Paper>
      </Box>

      <DispatchEntry open={dispatchOpen} onClose={() => setDispatchOpen(false)} presetOrder={order} />
      {/* Amend — the same full order form used to punch it, pre-filled. Change a
          quantity (Dome Jar 100 → 2000), add or drop an item, then save. */}
      <OrderEntryDrawer open={amendOpen} onClose={() => setAmendOpen(false)} order={order} />
      <CancelOrderDialog
        open={!!cancelMode} mode={cancelMode || 'cancel'}
        order={order} onClose={() => setCancelMode(null)}
      />
    </Box>
  );
};

const Empty = ({ icon: Icon, text }) => (
  <Stack alignItems="center" sx={{ py: 5, color: C.faint, gap: 1 }}>
    <Icon size={32} style={{ opacity: 0.5 }} />
    <Typography sx={{ fontSize: '0.82rem', textAlign: 'center', maxWidth: 420 }}>{text}</Typography>
  </Stack>
);

const DocRow = ({ label, url }) => {
  if (!url) return null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 2, border: `1px solid ${C.line}` }}>
      <FileText size={16} color={C.primary} />
      <Typography sx={{ flex: 1, fontSize: '0.82rem', fontWeight: 700, color: C.ink }}>{label}</Typography>
      <Button size="small" startIcon={<ExternalLink size={13} />} href={resolveFileUrl(url)} target="_blank" sx={{ fontWeight: 700 }}>
        Open
      </Button>
    </Box>
  );
};

export default OrderDetails;
