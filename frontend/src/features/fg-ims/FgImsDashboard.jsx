import React, { useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, Skeleton, alpha, useTheme, Chip, Table, TableHead, TableBody, TableRow, TableCell,
} from '@mui/material';
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid, Legend,
} from 'recharts';
import { LayoutDashboard, Boxes, PackageOpen, AlertTriangle, IndianRupee, ClipboardList, ArrowDownLeft, ArrowUpRight, Factory, Truck } from 'lucide-react';
import dayjs from 'dayjs';
import { FgHero, StatusChip, STATUS_META, num, inr, TXN_LABEL } from './fgImsMeta';
import { useGetFgDashboardQuery } from '../../store/api/fgImsApi';

const compactInr = (v) => {
  const n = Number(v || 0);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(n % 1e7 ? 1 : 0)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(n % 1e5 ? 1 : 0)}L`;
  if (n >= 1e3) return `₹${Math.round(n / 1e3)}k`;
  return `₹${n}`;
};

const KpiCard = ({ label, value, color, icon: Icon }) => (
  <Paper elevation={0} sx={{
    p: 1.5, borderRadius: '14px', flex: 1, minWidth: 150,
    border: '1px solid', borderColor: 'divider',
    transition: 'box-shadow .15s, transform .15s', '&:hover': { boxShadow: 3, transform: 'translateY(-1px)' },
  }}>
    <Stack direction="row" spacing={1.25} alignItems="center">
      <Box sx={{ width: 38, height: 38, borderRadius: '11px', display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.12), color, flexShrink: 0 }}>
        <Icon size={19} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ display: 'block', fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary' }} noWrap>{label}</Typography>
        <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', lineHeight: 1.2, color }}>{value}</Typography>
      </Box>
    </Stack>
  </Paper>
);

const Panel = ({ title, children, sx }) => (
  <Paper elevation={0} sx={{ p: 2, borderRadius: '14px', border: '1px solid', borderColor: 'divider', ...sx }}>
    <Typography sx={{ fontWeight: 800, fontSize: '0.78rem', letterSpacing: '0.04em', textTransform: 'uppercase', color: 'text.secondary', mb: 1.5 }}>{title}</Typography>
    {children}
  </Paper>
);

const HBar = ({ data, color }) => (
  <Box sx={{ height: 260 }}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart layout="vertical" data={data} margin={{ top: 6, right: 16, left: 10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
        <RTooltip />
        <Bar dataKey="qty" fill={color} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  </Box>
);

const FgImsDashboard = () => {
  const theme = useTheme();
  const { data, isFetching } = useGetFgDashboardQuery();
  const d = data?.data;
  const s = d?.summary || {};

  const statusData = useMemo(() => ([
    { key: 'OK', value: s.ok || 0 },
    { key: 'LOW', value: s.low || 0 },
    { key: 'REORDER', value: s.reorder || 0 },
    { key: 'OUT_OF_STOCK', value: s.outOfStock || 0 },
    { key: 'OVERSTOCK', value: s.overstock || 0 },
  ].filter((x) => x.value > 0)), [s]);

  const categoryData = useMemo(() => (d?.byCategory || []).slice(0, 8).map((c) => ({ name: c.category, value: c.value })), [d]);
  const topDispatched = useMemo(() => (d?.topDispatched || []).map((t) => ({ name: t.skuName?.slice(0, 16) || t.skuCode, qty: t.qty })), [d]);
  const topProduced = useMemo(() => (d?.topProduced || []).map((t) => ({ name: t.skuName?.slice(0, 16) || t.skuCode, qty: t.qty })), [d]);

  if (isFetching && !d) {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <FgHero icon={LayoutDashboard} title="Finished Goods IMS" subtitle="Finished goods — stock health at a glance." />
        <Box sx={{ p: 4 }}><Skeleton variant="rounded" height={400} /></Box>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <FgHero icon={LayoutDashboard} title="Finished Goods IMS" subtitle="Finished goods — stock health, value, order book and what to produce next." />

      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
          <KpiCard label="Finished goods" value={num(s.itemCount)} color="#059669" icon={Boxes} />
          <KpiCard label="Total in stock" value={num(s.totalOnHand)} color="#0f766e" icon={PackageOpen} />
          <KpiCard label="Stock value" value={inr(s.totalStockValue)} color="#6366f1" icon={IndianRupee} />
          <KpiCard label="Booked (orders)" value={num(s.totalBooked)} color="#1d4ed8" icon={ClipboardList} />
          <KpiCard label="Need production" value={num((s.reorder || 0) + (s.outOfStock || 0))} color="#dc2626" icon={AlertTriangle} />
          <KpiCard label="Low cover" value={num(s.low)} color="#b45309" icon={AlertTriangle} />
        </Stack>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
          <Panel title="Stock status mix">
            <Box sx={{ height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="key" innerRadius={52} outerRadius={82} paddingAngle={2}>
                    {statusData.map((e) => <Cell key={e.key} fill={STATUS_META[e.key]?.color || '#94a3b8'} />)}
                  </Pie>
                  <RTooltip formatter={(v, n) => [v, STATUS_META[n]?.label || n]} />
                  <Legend formatter={(v) => <span style={{ fontSize: 12 }}>{STATUS_META[v]?.label || v}</span>} iconSize={9} />
                </PieChart>
              </ResponsiveContainer>
            </Box>
          </Panel>

          <Panel title="Stock value by category (top 8)">
            <Box sx={{ height: 230 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={alpha(theme.palette.text.primary, 0.08)} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={54} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={compactInr} width={48} />
                  <RTooltip formatter={(v) => inr(v)} />
                  <Bar dataKey="value" fill="#059669" radius={[4, 4, 0, 0]} maxBarSize={46} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Panel>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
          <Panel title="Top dispatched (last 30 days)">
            {topDispatched.length === 0
              ? <Typography variant="body2" color="text.disabled" sx={{ py: 4, textAlign: 'center' }}>No dispatches recorded yet.</Typography>
              : <HBar data={topDispatched} color="#dc2626" />}
          </Panel>
          <Panel title="Top produced (last 30 days)">
            {topProduced.length === 0
              ? <Typography variant="body2" color="text.disabled" sx={{ py: 4, textAlign: 'center' }}>No production recorded yet.</Typography>
              : <HBar data={topProduced} color="#059669" />}
          </Panel>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
          <Panel title={`Produce soon (${(d?.replenishList || []).length})`}>
            <Box sx={{ maxHeight: 280, overflowY: 'auto' }}>
              {(d?.replenishList || []).length === 0 ? (
                <Typography variant="body2" sx={{ py: 4, textAlign: 'center', color: 'success.main', fontWeight: 700 }}>Nothing to produce. 🎉</Typography>
              ) : (
                <Table size="small">
                  <TableBody>
                    {(d?.replenishList || []).map((r) => (
                      <TableRow key={r.skuId}>
                        <TableCell sx={{ border: 0, py: 0.75 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{r.skuName}</Typography>
                          <Typography variant="caption" color="text.secondary">{r.skuCode} · in stock {num(r.onHand)} · produce {num(r.suggestedProduceQty)}</Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ border: 0, py: 0.75 }}><StatusChip status={r.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Box>
          </Panel>

          <Panel title="Recent movements">
            <Box sx={{ maxHeight: 280, overflowY: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {['Date', 'Item', 'Type', 'Qty', 'Balance'].map((h, i) => (
                      <TableCell key={h} align={[3, 4].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.66rem', textTransform: 'uppercase' }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(d?.recentMovements || []).length === 0 && (
                    <TableRow><TableCell colSpan={5} sx={{ textAlign: 'center', py: 3, color: 'text.disabled' }}>No movements yet.</TableCell></TableRow>
                  )}
                  {(d?.recentMovements || []).map((m) => {
                    const isIn = m.movementType === 'IN';
                    return (
                      <TableRow key={m._id} hover>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{dayjs(m.movementDate).format('DD MMM')}</TableCell>
                        <TableCell><Typography variant="body2" noWrap sx={{ maxWidth: 180 }} title={m.skuName}>{m.skuName}</Typography></TableCell>
                        <TableCell>
                          <Chip size="small" icon={isIn ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />} label={TXN_LABEL[m.txnType] || (isIn ? 'In' : 'Out')}
                            sx={{ height: 20, fontWeight: 700, bgcolor: alpha(isIn ? '#059669' : '#dc2626', 0.12), color: isIn ? '#047857' : '#b91c1c' }} />
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700, color: isIn ? '#047857' : '#dc2626' }}>{isIn ? '+' : '−'}{num(m.quantity)}</TableCell>
                        <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(m.balanceAfter)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Panel>
        </Box>

        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }} useFlexGap>
          <Chip icon={<Factory size={15} />} label={`In production: ${num(s.totalInProduction)} units`} sx={{ fontWeight: 700 }} />
          <Chip icon={<Truck size={15} />} label={`Retail value in stock: ${inr(s.totalRetailValue)}`} sx={{ fontWeight: 700 }} />
        </Stack>
      </Box>
    </Box>
  );
};

export default FgImsDashboard;
