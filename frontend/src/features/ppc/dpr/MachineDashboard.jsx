import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Grid, Stack, Typography, Autocomplete, TextField, Table, TableHead, TableBody, TableRow, TableCell,
  LinearProgress, Skeleton, alpha, useTheme,
} from '@mui/material';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Cell,
} from 'recharts';
import { Cpu, Gauge, Timer, PauseCircle, PackageCheck, XCircle } from 'lucide-react';
import {
  DprHero, Panel, StatTile, OeeChip, oeeColor, ratioColor, PPC_ACCENT, LABEL_OF, num, num2, pct, compactInr,
} from './dprMeta';
import DateRangeBar, { defaultRange } from './DateRangeBar';
import { useGetMachineDashboardQuery, useGetDprOptionsQuery } from '../../../store/api/dprApi';

const MachineDashboard = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const [range, setRange] = useState({ ...defaultRange(), machineCode: '' });
  const params = useMemo(() => {
    const p = { from: range.from, to: range.to };
    if (range.machineCode) p.machineCode = range.machineCode;
    return p;
  }, [range]);

  const { data, isFetching, refetch } = useGetMachineDashboardQuery(params);
  const { data: optRes } = useGetDprOptionsQuery();
  const d = data?.data || {};
  const s = d.summary || {};
  const machines = d.machines || [];

  const trend = useMemo(() => (d.trend || []).map((t) => ({
    date: t.date?.slice(5), oee: t.oeePct, avail: t.availabilityPct, perf: t.performancePct,
  })), [d.trend]);
  const pareto = useMemo(() => (d.downtimePareto || []).slice(0, 10).map((r) => ({
    name: LABEL_OF[r.key] || r.key, minutes: r.value,
  })), [d.downtimePareto]);

  const machineOptions = (optRes?.data?.machines || []).map((m) => m.code);

  return (
    <Box sx={{ pb: 6 }}>
      <DprHero icon={Cpu} title="Machine Dashboard" subtitle="OEE, availability & downtime by machine" />
      <Box sx={{ p: { xs: 1.5, md: 2.5 } }}>
        <DateRangeBar value={range} onChange={setRange} onRefresh={refetch} isFetching={isFetching}
          extra={(
            <Autocomplete size="small" sx={{ width: 190 }} options={machineOptions} value={range.machineCode || null}
              onChange={(_e, v) => setRange((p) => ({ ...p, machineCode: v || '' }))}
              renderInput={(p) => <TextField {...p} label="Machine" />} />
          )} />

        {isFetching && <LinearProgress sx={{ mb: 2, borderRadius: 2 }} />}

        {/* KPI row */}
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          <Grid item xs={6} md={3}><StatTile label="Overall OEE" value={pct(s.oeePct)} sub={`${num(s.entries || 0)} entries`} color={oeeColor(s.oeePct)} icon={Gauge} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Availability" value={pct(s.availabilityPct)} color={ratioColor(s.availabilityPct)} icon={Timer} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Performance" value={pct(s.performancePct)} color={ratioColor(s.performancePct)} icon={Gauge} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Quality" value={pct(s.qualityPct)} color={ratioColor(s.qualityPct)} icon={PackageCheck} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Produced (good)" value={`${num(s.goodQty)} / ${num(s.productionQty)}`} color={PPC_ACCENT} icon={PackageCheck} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Loss time" value={`${num(s.downtimeTotal)} min`} sub={`+${num(s.plannedTotal)} planned`} color="#d97706" icon={PauseCircle} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Rejected" value={`${num(s.rejectQty)} pcs`} sub={`${num(s.rejectPpm)} PPM`} color="#dc2626" icon={XCircle} /></Grid>
          <Grid item xs={6} md={3}><StatTile label="Prod. value" value={compactInr(s.productionValue)} color="#0f766e" icon={PackageCheck} /></Grid>
        </Grid>

        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={7}>
            <Panel title="OEE trend">
              {trend.length ? (
                <Box sx={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="oeeg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={PPC_ACCENT} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={PPC_ACCENT} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={alpha(theme.palette.text.primary, 0.08)} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                      <RTooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
                      <Area type="monotone" dataKey="oee" name="OEE" stroke={PPC_ACCENT} strokeWidth={2} fill="url(#oeeg)" />
                      <Area type="monotone" dataKey="avail" name="Availability" stroke="#0ea5e9" strokeWidth={1.5} fill="none" />
                      <Area type="monotone" dataKey="perf" name="Performance" stroke="#16a34a" strokeWidth={1.5} fill="none" />
                    </AreaChart>
                  </ResponsiveContainer>
                </Box>
              ) : <Empty />}
            </Panel>
          </Grid>
          <Grid item xs={12} md={5}>
            <Panel title="Top downtime reasons (min)">
              {pareto.length ? (
                <Box sx={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={pareto} margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={alpha(theme.palette.text.primary, 0.08)} />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                      <RTooltip formatter={(v) => `${num(v)} min`} />
                      <Bar dataKey="minutes" fill="#d97706" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              ) : <Empty />}
            </Panel>
          </Grid>
        </Grid>

        <Panel title={`By machine (${machines.length})`}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {['Machine', 'Type', 'Entries', 'Produced', 'Good', 'Rej', 'OEE', 'Avail', 'Perf', 'Qual', 'Loss (min)'].map((h, i) => (
                    <TableCell key={h} align={i > 1 ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.72rem', textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {isFetching && !machines.length
                  ? Array.from({ length: 6 }).map((_, i) => <TableRow key={i}><TableCell colSpan={11}><Skeleton height={26} /></TableCell></TableRow>)
                  : machines.map((m) => (
                    <TableRow key={m.machineCode} hover sx={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/ppc/dpr/register?machineCode=${encodeURIComponent(m.machineCode)}`)}>
                      <TableCell sx={{ fontWeight: 800 }}>{m.machineCode}</TableCell>
                      <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{m.machineType || '—'}</TableCell>
                      <TableCell align="right">{num(m.entries)}</TableCell>
                      <TableCell align="right">{num(m.productionQty)}</TableCell>
                      <TableCell align="right">{num(m.goodQty)}</TableCell>
                      <TableCell align="right" sx={{ color: m.rejectQty ? '#dc2626' : 'text.secondary' }}>{num(m.rejectQty)}</TableCell>
                      <TableCell align="right"><OeeChip value={m.oeePct} /></TableCell>
                      <TableCell align="right" sx={{ color: ratioColor(m.availabilityPct), fontWeight: 700 }}>{pct(m.availabilityPct)}</TableCell>
                      <TableCell align="right" sx={{ color: ratioColor(m.performancePct), fontWeight: 700 }}>{pct(m.performancePct)}</TableCell>
                      <TableCell align="right" sx={{ color: ratioColor(m.qualityPct), fontWeight: 700 }}>{pct(m.qualityPct)}</TableCell>
                      <TableCell align="right">{num(m.downtimeTotal)}</TableCell>
                    </TableRow>
                  ))}
                {!isFetching && !machines.length && <TableRow><TableCell colSpan={11}><Empty /></TableCell></TableRow>}
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

export default MachineDashboard;
