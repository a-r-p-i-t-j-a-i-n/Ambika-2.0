import React, { useMemo, useState } from 'react';
import {
  Box, Grid, Stack, Typography, Chip, Table, TableHead, TableBody, TableRow, TableCell,
  LinearProgress, Skeleton, useTheme,
} from '@mui/material';
import { Award, Trophy, Cpu, Users, Package, Gauge } from 'lucide-react';
import {
  DprHero, Panel, StatTile, RatioBar, OeeChip, oeeColor, oeeBand, ratioColor, PPC_ACCENT, num, pct,
} from './dprMeta';
import DateRangeBar, { defaultRange } from './DateRangeBar';
import { useGetMisScoringQuery } from '../../../store/api/dprApi';

// Medal tint for the top three ranks; null → neutral badge.
const medalColor = (rank) => (rank === 1 ? '#f59e0b' : rank === 2 ? '#94a3b8' : rank === 3 ? '#b45309' : null);

// One leaderboard row — rank badge, name + secondary line, OEE chip.
const LeaderRow = ({ rank, name, sub, score }) => {
  const medal = medalColor(rank);
  return (
    <Stack direction="row" alignItems="center" spacing={1.5}
      sx={{
        px: 1.25, py: 1, borderRadius: '12px', transition: 'background .15s',
        '&:hover': { bgcolor: 'action.hover' },
      }}>
      <Box sx={{
        width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
        fontWeight: 900, fontSize: '0.82rem',
        bgcolor: medal ? `${medal}22` : 'action.selected',
        color: medal || 'text.secondary',
        border: medal ? `1.5px solid ${medal}` : '1px solid transparent',
      }}>{rank}</Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 800, fontSize: '0.85rem' }} noWrap>{name || '—'}</Typography>
        <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }} noWrap>{sub}</Typography>
      </Box>
      <OeeChip value={score} />
    </Stack>
  );
};

const DprMisScoring = () => {
  const theme = useTheme();
  const [range, setRange] = useState(defaultRange());
  const params = useMemo(() => {
    const p = {};
    if (range.from) p.from = range.from;
    if (range.to) p.to = range.to;
    return p;
  }, [range]);

  const { data, isFetching, refetch } = useGetMisScoringQuery(params);
  const d = data?.data || {};
  const summary = d.summary || {};
  const operators = d.operators || [];
  const machines = d.machines || [];
  const skus = d.skus || [];

  const oee = Number(summary.oeePct || 0);
  const gaugeTrack = theme.palette.mode === 'dark' ? '#2a2a3a' : '#eee';

  // Render a leaderboard list (skeleton while loading, Empty when there is nothing).
  const renderLeaders = (rows, nameKey) => {
    if (isFetching && !rows.length) {
      return Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} height={44} sx={{ borderRadius: '12px', transform: 'none' }} />
      ));
    }
    if (!rows.length) return <Empty />;
    return rows.slice(0, 12).map((r) => (
      <LeaderRow key={r[nameKey] ?? r.rank} rank={r.rank} name={r[nameKey]}
        sub={`${num(r.productionQty)} pcs · ${num(r.entries)} entries`} score={r.score} />
    ));
  };

  return (
    <Box sx={{ pb: 6 }}>
      <DprHero icon={Award} title="MIS Scoring" subtitle="OEE-based performance scorecard & leaderboards" />

      <Box sx={{ p: { xs: 1.5, md: 2.5 } }}>
        <DateRangeBar value={range} onChange={setRange} onRefresh={refetch} isFetching={isFetching} />

        {isFetching && <LinearProgress sx={{ mb: 2, borderRadius: 2 }} />}

        {/* ── Hero row: factory OEE gauge + headline KPIs ─────────────────── */}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={4}>
            <Panel title="Factory OEE" sx={{ height: '100%' }}>
              <Stack alignItems="center" spacing={1} sx={{ mb: 2 }}>
                <Box sx={{
                  width: 150, height: 150, borderRadius: '50%', display: 'grid', placeItems: 'center',
                  background: `conic-gradient(${oeeColor(oee)} ${oee * 3.6}deg, ${gaugeTrack} 0deg)`,
                }}>
                  <Box sx={{ width: 122, height: 122, borderRadius: '50%', bgcolor: 'background.paper', display: 'grid', placeItems: 'center' }}>
                    <Box textAlign="center">
                      <Typography sx={{ fontWeight: 900, fontSize: '2rem', lineHeight: 1, color: oeeColor(oee) }}>{oee.toFixed(1)}</Typography>
                      <Typography sx={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.1em', color: 'text.secondary' }}>OEE %</Typography>
                    </Box>
                  </Box>
                </Box>
                <Chip size="small" label={oeeBand(oee)} sx={{ fontWeight: 800, bgcolor: `${oeeColor(oee)}1f`, color: oeeColor(oee) }} />
              </Stack>
              <Stack spacing={1.25}>
                <RatioBar label="Availability" value={summary.availabilityPct} />
                <RatioBar label="Performance" value={summary.performancePct} />
                <RatioBar label="Quality" value={summary.qualityPct} />
              </Stack>
            </Panel>
          </Grid>

          <Grid item xs={12} md={8}>
            <Grid container spacing={1.5}>
              <Grid item xs={6} md={4}><StatTile label="Total produced" value={`${num(summary.goodQty)} / ${num(summary.productionQty)}`} sub="good / total pcs" color={PPC_ACCENT} icon={Package} /></Grid>
              <Grid item xs={6} md={4}><StatTile label="Rejected" value={`${num(summary.rejectQty)} pcs`} color="#dc2626" icon={Package} /></Grid>
              <Grid item xs={6} md={4}><StatTile label="Entries" value={num(summary.entries)} color="#0f766e" icon={Gauge} /></Grid>
              <Grid item xs={6} md={4}><StatTile label="Operators ranked" value={num(operators.length)} color="#2563eb" icon={Users} /></Grid>
              <Grid item xs={6} md={4}><StatTile label="Machines ranked" value={num(machines.length)} color="#7c3aed" icon={Cpu} /></Grid>
              <Grid item xs={6} md={4}><StatTile label="Loss time" value={`${num(summary.downtimeTotal)} min`} color="#d97706" icon={Gauge} /></Grid>
            </Grid>
          </Grid>
        </Grid>

        {/* ── Leaderboards ────────────────────────────────────────────────── */}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={6}>
            <Panel title="Operator leaderboard" action={<Trophy size={16} color={PPC_ACCENT} />} sx={{ height: '100%' }}>
              <Stack spacing={0.5}>{renderLeaders(operators, 'name')}</Stack>
            </Panel>
          </Grid>
          <Grid item xs={12} md={6}>
            <Panel title="Machine leaderboard" action={<Cpu size={16} color={PPC_ACCENT} />} sx={{ height: '100%' }}>
              <Stack spacing={0.5}>{renderLeaders(machines, 'machineCode')}</Stack>
            </Panel>
          </Grid>
        </Grid>

        {/* ── SKU performance ─────────────────────────────────────────────── */}
        <Panel title={`SKU performance (${skus.length})`}>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {['SKU', 'Produced', 'Good', 'Rej', 'OEE', 'Avail', 'Perf', 'Quality'].map((h, i) => (
                    <TableCell key={h} align={i === 0 ? 'left' : 'right'} sx={{ fontWeight: 800, fontSize: '0.72rem', textTransform: 'uppercase', color: 'text.secondary' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {isFetching && !skus.length
                  ? Array.from({ length: 6 }).map((_, i) => <TableRow key={i}><TableCell colSpan={8}><Skeleton height={26} /></TableCell></TableRow>)
                  : skus.map((r) => (
                    <TableRow key={r.skuCode} hover>
                      <TableCell>
                        <Typography sx={{ fontWeight: 800, fontSize: '0.8rem' }}>{r.skuCode}</Typography>
                        <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary' }} noWrap>{r.skuName || '—'}</Typography>
                      </TableCell>
                      <TableCell align="right">{num(r.productionQty)}</TableCell>
                      <TableCell align="right">{num(r.goodQty)}</TableCell>
                      <TableCell align="right" sx={{ color: r.rejectQty ? '#dc2626' : 'text.secondary' }}>{num(r.rejectQty)}</TableCell>
                      <TableCell align="right"><OeeChip value={r.score} /></TableCell>
                      <TableCell align="right" sx={{ color: ratioColor(r.availabilityPct), fontWeight: 700 }}>{pct(r.availabilityPct)}</TableCell>
                      <TableCell align="right" sx={{ color: ratioColor(r.performancePct), fontWeight: 700 }}>{pct(r.performancePct)}</TableCell>
                      <TableCell align="right" sx={{ color: ratioColor(r.qualityPct), fontWeight: 700 }}>{pct(r.qualityPct)}</TableCell>
                    </TableRow>
                  ))}
                {!isFetching && !skus.length && <TableRow><TableCell colSpan={8}><Empty /></TableCell></TableRow>}
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

export default DprMisScoring;
