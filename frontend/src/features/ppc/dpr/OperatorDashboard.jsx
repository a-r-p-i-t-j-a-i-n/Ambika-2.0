import React, { useMemo, useState } from 'react';
import {
  Box, Grid, Stack, Typography, Autocomplete, TextField, Table, TableHead, TableBody, TableRow, TableCell,
  LinearProgress, Skeleton, alpha, useTheme,
} from '@mui/material';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from 'recharts';
import { Users, Gauge, PackageCheck, XCircle, Trophy, Timer } from 'lucide-react';
import {
  DprHero, Panel, StatTile, OeeChip, oeeColor, ratioColor, PPC_ACCENT, num, pct,
} from './dprMeta';
import DateRangeBar, { defaultRange } from './DateRangeBar';
import { useGetOperatorDashboardQuery, useGetDprOptionsQuery } from '../../../store/api/dprApi';

const rankColor = (i) => (i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : 'text.secondary');

const OperatorDashboard = () => {
  const theme = useTheme();
  const [range, setRange] = useState({ ...defaultRange(), operatorName: '' });
  const params = useMemo(() => {
    const p = { from: range.from, to: range.to };
    if (range.operatorName) p.operatorName = range.operatorName;
    return p;
  }, [range]);

  const { data, isFetching, refetch } = useGetOperatorDashboardQuery(params);
  const { data: optRes } = useGetDprOptionsQuery();
  const d = data?.data || {};
  const s = d.summary || {};
  const operators = d.operators || [];

  const trend = useMemo(() => (d.trend || []).map((t) => ({
    date: t.date?.slice(5), eff: t.performancePct, oee: t.oeePct,
  })), [d.trend]);
  const topOee = useMemo(() => operators.slice(0, 10).map((o) => ({
    name: (o.operatorName || '—').slice(0, 16), oee: o.oeePct,
  })), [operators]);

  const operatorOptions = (optRes?.data?.operators || []).map((o) => o.name);
  const best = operators[0] || {};

  return (
    <Box sx={{ pb: 6 }}>
      <DprHero icon={Users} title="Operator Efficiency" subtitle="Output, efficiency & quality by operator" />
      <Box sx={{ p: { xs: 1.5, md: 2.5 } }}>
        <DateRangeBar value={range} onChange={setRange} onRefresh={refetch} isFetching={isFetching}
          extra={(
            <Autocomplete size="small" sx={{ width: 200 }} options={operatorOptions} value={range.operatorName || null}
              onChange={(_e, v) => setRange((p) => ({ ...p, operatorName: v || '' }))}
              renderInput={(p) => <TextField {...p} label="Operator" />} />
          )} />

        {isFetching && <LinearProgress sx={{ mb: 2, borderRadius: 2 }} />}

        {/* KPI row */}
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          <Grid item xs={6} md={3}><StatTile label="Overall Operator Eff" value={pct(s.performancePct)} sub={`${num(s.entries || 0)} entries`} color={ratioColor(s.performancePct)} icon={Gauge} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Quality" value={pct(s.qualityPct)} color={ratioColor(s.qualityPct)} icon={PackageCheck} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Produced (good)" value={`${num(s.goodQty)} / ${num(s.productionQty)}`} color={PPC_ACCENT} icon={PackageCheck} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Entries" value={num(s.entries)} color={PPC_ACCENT} icon={Timer} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Overall OEE" value={pct(s.oeePct)} color={oeeColor(s.oeePct)} icon={Gauge} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Rejected" value={`${num(s.rejectQty)} pcs`} sub={`${num(s.rejectPpm)} PPM`} color="#dc2626" icon={XCircle} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Best operator" value={best.operatorName || '—'} sub={pct(best.oeePct)} color="#f59e0b" icon={Trophy} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Active operators" value={num(operators.length)} color={PPC_ACCENT} icon={Users} /></Grid>
        </Grid>

        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={7}>
            <Panel title="Operator efficiency trend">
              {trend.length ? (
                <Box sx={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="opereffg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={PPC_ACCENT} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={PPC_ACCENT} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={alpha(theme.palette.text.primary, 0.08)} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                      <RTooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
                      <Area type="monotone" dataKey="eff" name="Operator Eff." stroke={PPC_ACCENT} strokeWidth={2} fill="url(#opereffg)" />
                      <Area type="monotone" dataKey="oee" name="OEE" stroke="#16a34a" strokeWidth={1.5} fill="none" />
                    </AreaChart>
                  </ResponsiveContainer>
                </Box>
              ) : <Empty />}
            </Panel>
          </Grid>
          <Grid item xs={12} md={5}>
            <Panel title="Top operators by OEE">
              {topOee.length ? (
                <Box sx={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={topOee} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={alpha(theme.palette.text.primary, 0.08)} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                      <RTooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
                      <Bar dataKey="oee" fill={PPC_ACCENT} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              ) : <Empty />}
            </Panel>
          </Grid>
        </Grid>

        <Panel title={`Operator leaderboard (${operators.length})`}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {['#', 'Operator', 'Entries', 'Produced', 'Good', 'Rej', 'OEE', 'Avail', 'Operator Eff.', 'Quality'].map((h, i) => (
                    <TableCell key={h} align={i > 1 ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.72rem', textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {isFetching && !operators.length
                  ? Array.from({ length: 6 }).map((_, i) => <TableRow key={i}><TableCell colSpan={10}><Skeleton height={26} /></TableCell></TableRow>)
                  : operators.map((o, i) => (
                    <TableRow key={o.operatorName || i} hover>
                      <TableCell>
                        <Box sx={{
                          width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center',
                          fontWeight: 800, fontSize: '0.72rem', color: rankColor(i),
                          bgcolor: i < 3 ? alpha(rankColor(i), 0.14) : alpha(theme.palette.text.primary, 0.06),
                        }}>{i + 1}</Box>
                      </TableCell>
                      <TableCell sx={{ fontWeight: 800 }}>{o.operatorName || '—'}</TableCell>
                      <TableCell align="right">{num(o.entries)}</TableCell>
                      <TableCell align="right">{num(o.productionQty)}</TableCell>
                      <TableCell align="right">{num(o.goodQty)}</TableCell>
                      <TableCell align="right" sx={{ color: o.rejectQty ? '#dc2626' : 'text.secondary' }}>{num(o.rejectQty)}</TableCell>
                      <TableCell align="right"><OeeChip value={o.oeePct} /></TableCell>
                      <TableCell align="right" sx={{ color: ratioColor(o.availabilityPct), fontWeight: 700 }}>{pct(o.availabilityPct)}</TableCell>
                      <TableCell align="right" sx={{ color: ratioColor(o.performancePct), fontWeight: 700 }}>{pct(o.performancePct)}</TableCell>
                      <TableCell align="right" sx={{ color: ratioColor(o.qualityPct), fontWeight: 700 }}>{pct(o.qualityPct)}</TableCell>
                    </TableRow>
                  ))}
                {!isFetching && !operators.length && <TableRow><TableCell colSpan={10}><Empty /></TableCell></TableRow>}
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

export default OperatorDashboard;
