import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Grid, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  LinearProgress, Skeleton, alpha, useTheme,
} from '@mui/material';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from 'recharts';
import { Boxes, PackageCheck, XCircle, Repeat, IndianRupee, Layers, Hammer } from 'lucide-react';
import {
  DprHero, Panel, StatTile, OeeChip, ratioColor, PPC_ACCENT, DEFECT_LABEL_OF, num, num2, pct, compactInr,
} from './dprMeta';
import DateRangeBar, { defaultRange } from './DateRangeBar';
import { useGetProductionDashboardQuery } from '../../../store/api/dprApi';

const ProductionDashboard = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [range, setRange] = useState(defaultRange());
  const params = useMemo(() => ({ from: range.from, to: range.to }), [range]);

  const { data, isFetching, refetch } = useGetProductionDashboardQuery(params);
  const d = data?.data || {};
  const s = d.summary || {};
  const bySku = d.bySku || [];
  const byOperation = d.byOperation || [];

  const trend = useMemo(() => (d.trend || []).map((t) => ({
    date: t.date?.slice(5), qty: t.productionQty, good: t.goodQty,
  })), [d.trend]);
  const defects = useMemo(() => (d.defectPareto || []).slice(0, 10).map((r) => ({
    name: DEFECT_LABEL_OF[r.key] || r.key, qty: r.value,
  })), [d.defectPareto]);
  const skuBars = useMemo(() => bySku.slice(0, 10).map((r) => ({
    name: (r.skuName || r.skuCode)?.slice(0, 16), qty: r.productionQty,
  })), [bySku]);

  return (
    <Box sx={{ pb: 6 }}>
      <DprHero icon={Boxes} title="Production Dashboard" subtitle="Output, rejections & value by SKU and operation" />
      <Box sx={{ p: { xs: 1.5, md: 2.5 } }}>
        <DateRangeBar value={range} onChange={setRange} onRefresh={refetch} isFetching={isFetching} />

        {isFetching && <LinearProgress sx={{ mb: 2, borderRadius: 2 }} />}

        {/* KPI row */}
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          <Grid item xs={6} md={3}><StatTile label="Total produced" value={`${num(s.productionQty)} pcs`} sub={`${num(s.entries || 0)} entries`} color={PPC_ACCENT} icon={Boxes} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Good" value={`${num(s.goodQty)} pcs`} color="#16a34a" icon={PackageCheck} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Rejected" value={`${num(s.rejectQty)} pcs`} sub={`${num(s.rejectPpm)} PPM`} color="#dc2626" icon={XCircle} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Rework" value={`${num(s.reworkQty)} pcs`} color="#d97706" icon={Repeat} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Production value" value={compactInr(s.productionValue)} color="#0f766e" icon={IndianRupee} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="RM consumed" value={`${num2(s.rmConsumedKg)} kg`} color={PPC_ACCENT} icon={Layers} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Strokes" value={num(s.strokes)} color="#0ea5e9" icon={Hammer} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Entries" value={num(s.entries)} color={PPC_ACCENT} icon={Layers} /></Grid>
        </Grid>

        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={7}>
            <Panel title="Daily production (pcs)">
              {trend.length ? (
                <Box sx={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="prodg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={PPC_ACCENT} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={PPC_ACCENT} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={alpha(theme.palette.text.primary, 0.08)} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <RTooltip formatter={(v) => `${num(v)} pcs`} />
                      <Area type="monotone" dataKey="qty" name="Produced" stroke={PPC_ACCENT} strokeWidth={2} fill="url(#prodg)" />
                      <Area type="monotone" dataKey="good" name="Good" stroke="#16a34a" strokeWidth={1.5} fill="none" />
                    </AreaChart>
                  </ResponsiveContainer>
                </Box>
              ) : <Empty />}
            </Panel>
          </Grid>
          <Grid item xs={12} md={5}>
            <Panel title="Top defects (pcs)">
              {defects.length ? (
                <Box sx={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={defects} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={alpha(theme.palette.text.primary, 0.08)} />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                      <RTooltip formatter={(v) => `${num(v)} pcs`} />
                      <Bar dataKey="qty" fill="#dc2626" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              ) : <Empty />}
            </Panel>
          </Grid>
        </Grid>

        <Panel title="Top SKUs by output" sx={{ mb: 2 }}>
          {skuBars.length ? (
            <Box sx={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={skuBars} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={alpha(theme.palette.text.primary, 0.08)} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                  <RTooltip formatter={(v) => `${num(v)} pcs`} />
                  <Bar dataKey="qty" fill={PPC_ACCENT} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          ) : <Empty />}
        </Panel>

        <Panel title={`By SKU (${bySku.length})`} sx={{ mb: 2 }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {['SKU', 'Entries', 'Produced', 'Good', 'Rej', 'Quality', 'OEE', 'Value'].map((h, i) => (
                    <TableCell key={h} align={i > 0 ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.72rem', textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {isFetching && !bySku.length
                  ? Array.from({ length: 6 }).map((_, i) => <TableRow key={i}><TableCell colSpan={8}><Skeleton height={26} /></TableCell></TableRow>)
                  : bySku.map((r) => (
                    <TableRow key={r.skuCode} hover sx={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/ppc/dpr/register?skuCode=${encodeURIComponent(r.skuCode)}`)}>
                      <TableCell>
                        <Typography sx={{ fontWeight: 800, fontSize: '0.8rem', lineHeight: 1.2 }}>{r.skuCode}</Typography>
                        {r.skuName && <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }} noWrap>{r.skuName}</Typography>}
                      </TableCell>
                      <TableCell align="right">{num(r.entries)}</TableCell>
                      <TableCell align="right">{num(r.productionQty)}</TableCell>
                      <TableCell align="right">{num(r.goodQty)}</TableCell>
                      <TableCell align="right" sx={{ color: r.rejectQty ? '#dc2626' : 'text.secondary' }}>{num(r.rejectQty)}</TableCell>
                      <TableCell align="right" sx={{ color: ratioColor(r.qualityPct), fontWeight: 700 }}>{pct(r.qualityPct)}</TableCell>
                      <TableCell align="right"><OeeChip value={r.oeePct} /></TableCell>
                      <TableCell align="right">{compactInr(r.productionValue)}</TableCell>
                    </TableRow>
                  ))}
                {!isFetching && !bySku.length && <TableRow><TableCell colSpan={8}><Empty /></TableCell></TableRow>}
              </TableBody>
            </Table>
          </Box>
        </Panel>

        <Panel title={`By operation (${byOperation.length})`}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {['Operation', 'Produced', 'Good', 'Rej', 'OEE', 'Avail', 'Perf', 'Quality'].map((h, i) => (
                    <TableCell key={h} align={i > 0 ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.72rem', textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {isFetching && !byOperation.length
                  ? Array.from({ length: 5 }).map((_, i) => <TableRow key={i}><TableCell colSpan={8}><Skeleton height={26} /></TableCell></TableRow>)
                  : byOperation.map((r) => (
                    <TableRow key={r.operation} hover>
                      <TableCell sx={{ fontWeight: 700 }}>{r.operation || '—'}</TableCell>
                      <TableCell align="right">{num(r.productionQty)}</TableCell>
                      <TableCell align="right">{num(r.goodQty)}</TableCell>
                      <TableCell align="right" sx={{ color: r.rejectQty ? '#dc2626' : 'text.secondary' }}>{num(r.rejectQty)}</TableCell>
                      <TableCell align="right"><OeeChip value={r.oeePct} /></TableCell>
                      <TableCell align="right" sx={{ color: ratioColor(r.availabilityPct), fontWeight: 700 }}>{pct(r.availabilityPct)}</TableCell>
                      <TableCell align="right" sx={{ color: ratioColor(r.performancePct), fontWeight: 700 }}>{pct(r.performancePct)}</TableCell>
                      <TableCell align="right" sx={{ color: ratioColor(r.qualityPct), fontWeight: 700 }}>{pct(r.qualityPct)}</TableCell>
                    </TableRow>
                  ))}
                {!isFetching && !byOperation.length && <TableRow><TableCell colSpan={8}><Empty /></TableCell></TableRow>}
              </TableBody>
            </Table>
          </Box>
        </Panel>
      </Box>
    </Box>
  );
};

const Empty = () => (
  <Stack alignItems="center" justifyContent="center" sx={{ py: 5, color: 'text.secondary' }}>
    <Typography sx={{ fontSize: '0.85rem' }}>No DPR data for this range yet.</Typography>
  </Stack>
);

export default ProductionDashboard;
