import React, { useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, Skeleton, Table, TableHead, TableBody, TableRow, TableCell,
  Button, LinearProgress, alpha,
} from '@mui/material';
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from 'recharts';
import {
  LayoutDashboard, Boxes, PackageOpen, AlertTriangle, IndianRupee, TrendingDown, ClipboardList,
  Factory, Truck, CheckCircle2, ArrowRight, History, Layers,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import {
  FgShell, Panel, TableScroll, KpiTile, StatusChip, MoveChip, EmptyNote, Help,
  O2D, STOCK_TOKENS, STOCK_ORDER, num, inr, compactInr, imsTableSx, moveToken,
  FG_ACCENT, FG_ACCENT_DARK, FG_STATUS_LABEL,
} from './fgImsMeta';
import { useGetFgDashboardQuery } from '../../store/api/fgImsApi';

// The warm chart palette — pulled from the same tokens the chips use, so a bar
// and a status pill for the same thing are never two different colours.
const CAT_COLORS = ['#059669', '#0f766e', '#1d4ed8', '#4338ca', '#b45309', '#15803d', '#7c3aed', '#0891b2'];

// A single row in the hand-built donut legend. Recharts' default legend is a
// cramped strip; a list gives room for the count AND the share, which is what
// the planner actually reads.
const LegendRow = ({ statusKey, token, count, total }) => {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ py: 0.45 }}>
      <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: token.color, flexShrink: 0 }} />
      <Typography sx={{ fontSize: '0.75rem', color: O2D.body, fontWeight: 600, mr: 'auto' }}>
        {FG_STATUS_LABEL[statusKey] || token.label}
      </Typography>
      <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: O2D.ink, fontVariantNumeric: 'tabular-nums' }}>{count}</Typography>
      <Typography sx={{ fontSize: '0.68rem', color: O2D.faint, width: 34, textAlign: 'right' }}>{pct}%</Typography>
    </Stack>
  );
};

// Recharts tooltip restyled to the O2D popover look.
const ChartTip = ({ active, payload, label, fmt }) => {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{
      bgcolor: O2D.surface, border: `1px solid ${O2D.line}`, borderRadius: '7px',
      px: 1.1, py: 0.7, boxShadow: '0 8px 24px rgba(28,30,33,0.16)',
    }}>
      <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: O2D.ink }}>{label}</Typography>
      {payload.map((p) => (
        <Typography key={p.dataKey} sx={{ fontSize: '0.72rem', color: p.color || FG_ACCENT, fontWeight: 700 }}>
          {fmt ? fmt(p.value) : num(p.value)}
        </Typography>
      ))}
    </Box>
  );
};

// A ranked bar list — the client reads it as "these are my fast movers", which a
// chart axis does not convey as directly.
const RankedList = ({ items, color, emptyIcon, emptyTitle, emptyHint }) => {
  const max = Math.max(1, ...items.map((t) => t.qty || 0));
  if (!items.length) return <EmptyNote icon={emptyIcon} title={emptyTitle} hint={emptyHint} />;
  return (
    <Stack spacing={0.9}>
      {items.slice(0, 8).map((t, i) => (
        <Box key={`${t.name}-${i}`}>
          <Stack direction="row" alignItems="baseline" spacing={1}>
            <Typography noWrap sx={{ fontSize: '0.76rem', fontWeight: 600, color: O2D.body, mr: 'auto' }}>{t.name}</Typography>
            <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: O2D.ink, fontVariantNumeric: 'tabular-nums' }}>{num(t.qty)}</Typography>
          </Stack>
          <LinearProgress variant="determinate" value={Math.round((t.qty / max) * 100)}
            sx={{
              height: 5, borderRadius: 3, mt: 0.3, bgcolor: O2D.lineSoft,
              '& .MuiLinearProgress-bar': { borderRadius: 3, bgcolor: color },
            }} />
        </Box>
      ))}
    </Stack>
  );
};

const FgImsDashboard = () => {
  const navigate = useNavigate();
  const { data, isFetching } = useGetFgDashboardQuery();
  const d = data?.data;
  const s = d?.summary || {};

  const needProduction = (s.reorder || 0) + (s.outOfStock || 0);
  const statusTotal = STOCK_ORDER.reduce((t, k) => t + (({
    OK: s.ok, LOW: s.low, REORDER: s.reorder, OUT_OF_STOCK: s.outOfStock, OVERSTOCK: s.overstock,
  })[k] || 0), 0);

  const statusData = useMemo(() => {
    const map = { OK: s.ok, LOW: s.low, REORDER: s.reorder, OUT_OF_STOCK: s.outOfStock, OVERSTOCK: s.overstock };
    return STOCK_ORDER.map((k) => ({ key: k, value: map[k] || 0 })).filter((x) => x.value > 0);
  }, [s]);

  const categoryData = useMemo(
    () => (d?.byCategory || []).slice(0, 8).map((c) => ({ name: c.category || 'Uncategorised', value: c.value })),
    [d],
  );
  const topDispatched = useMemo(
    () => (d?.topDispatched || []).map((t) => ({ name: (t.skuName || t.skuCode || '').slice(0, 18), qty: t.qty })),
    [d],
  );
  const topProduced = useMemo(
    () => (d?.topProduced || []).map((t) => ({ name: (t.skuName || t.skuCode || '').slice(0, 18), qty: t.qty })),
    [d],
  );
  const replenishList = d?.replenishList || [];

  if (isFetching && !d) {
    return (
      <FgShell icon={LayoutDashboard} title="Finished Goods" subtitle="Loading your stock position…">
        <Skeleton variant="rounded" height={72} />
        <Skeleton variant="rounded" height={280} />
        <Skeleton variant="rounded" height={280} />
      </FgShell>
    );
  }

  return (
    <FgShell
      icon={LayoutDashboard}
      title="Finished Goods"
      subtitle="Where your finished stock stands today — and what needs producing next."
      actions={(
        <Stack direction="row" spacing={0.75}>
          <Button size="small" variant="outlined" startIcon={<Boxes size={14} />} onClick={() => navigate('/fg-ims/stock')}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
            Open stock list
          </Button>
          <Button size="small" variant="contained" disableElevation startIcon={<Factory size={14} />}
            onClick={() => navigate('/fg-ims/planning')}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: FG_ACCENT, '&:hover': { bgcolor: FG_ACCENT_DARK } }}>
            Production plan
          </Button>
        </Stack>
      )}
    >
      {/* ── The one-line verdict. This is the first thing to read: either there
          is production to schedule, or there isn't. ── */}
      <Paper elevation={0} sx={{
        borderRadius: '8px', px: 1.75, py: 1.4,
        border: `1px solid ${needProduction ? STOCK_TOKENS.REORDER.border : STOCK_TOKENS.OK.border}`,
        bgcolor: needProduction ? STOCK_TOKENS.REORDER.tint : STOCK_TOKENS.OK.tint,
      }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Box sx={{
            width: 34, height: 34, borderRadius: '9px', display: 'grid', placeItems: 'center', flexShrink: 0,
            bgcolor: needProduction ? STOCK_TOKENS.REORDER.bg : STOCK_TOKENS.OK.bg,
            color: needProduction ? STOCK_TOKENS.REORDER.color : STOCK_TOKENS.OK.color,
          }}>
            {needProduction ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          </Box>
          <Box sx={{ minWidth: 0, mr: 'auto' }}>
            <Typography sx={{
              fontSize: '0.9rem', fontWeight: 800, lineHeight: 1.25,
              color: needProduction ? STOCK_TOKENS.REORDER.color : STOCK_TOKENS.OK.color,
            }}>
              {needProduction
                ? `${needProduction} finished good${needProduction > 1 ? 's need' : ' needs'} production`
                : 'Every finished good is at a healthy level'}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>
              {needProduction
                ? `${num(s.outOfStock)} out of stock · ${num(s.reorder)} at the Reorder At level · ${num(s.low)} running low.`
                : 'Nothing is at or below its Reorder At level right now. Check back after the next dispatch.'}
            </Typography>
          </Box>
          {needProduction > 0 && (
            <Button size="small" variant="contained" disableElevation endIcon={<ArrowRight size={14} />}
              onClick={() => navigate('/fg-ims/planning')}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: STOCK_TOKENS.REORDER.color }}>
              See what to produce
            </Button>
          )}
        </Stack>
      </Paper>

      {/* ── Headline numbers. Every tile is a shortcut into the filtered list. ── */}
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
        <KpiTile label="Finished goods" value={num(s.itemCount)} sub="Tracked in the master list"
          color={FG_ACCENT} icon={Boxes} onClick={() => navigate('/fg-ims/stock')} />
        <KpiTile label="Closing Stock" value={num(s.totalOnHand)} sub="Total units across all items"
          color="#0f766e" icon={PackageOpen} onClick={() => navigate('/fg-ims/stock')} />
        <KpiTile label="Stock value" value={inr(s.totalStockValue)} sub="At the costing rate"
          color="#6366f1" icon={IndianRupee} />
        <KpiTile label="Booked (orders)" value={num(s.totalBooked)} sub="Committed to customer orders"
          color="#1d4ed8" icon={ClipboardList} />
        <KpiTile label="Need production" value={num(needProduction)} sub="At or below Reorder At"
          color={STOCK_TOKENS.REORDER.color} icon={AlertTriangle} onClick={() => navigate('/fg-ims/planning')} />
        <KpiTile label="Low cover" value={num(s.low)} sub="Watch these next"
          color={STOCK_TOKENS.LOW.color} icon={TrendingDown} onClick={() => navigate('/fg-ims/stock?status=LOW')} />
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1.25fr)' }, gap: 1.25 }}>
        {/* ── Stock health donut + a legend that spells out every state ── */}
        <Panel title="How healthy is the stock?" icon={Layers}
          hint="Every finished good sorted into one of five states.">
          {statusTotal === 0 ? (
            <EmptyNote icon={Boxes} title="No finished goods tracked yet"
              hint="Add items in Stock & Master Data, then set a planning policy so IMS can judge their health." />
          ) : (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="center">
              <Box sx={{ width: 172, height: 172, position: 'relative', flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} dataKey="value" nameKey="key" innerRadius={54} outerRadius={82}
                      paddingAngle={2} stroke="none">
                      {statusData.map((e) => <Cell key={e.key} fill={STOCK_TOKENS[e.key].color} />)}
                    </Pie>
                    <RTooltip content={({ active, payload }) => (active && payload?.length ? (
                      <Box sx={{ bgcolor: O2D.surface, border: `1px solid ${O2D.line}`, borderRadius: '7px', px: 1.1, py: 0.7 }}>
                        <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: STOCK_TOKENS[payload[0].name]?.color }}>
                          {FG_STATUS_LABEL[payload[0].name] || STOCK_TOKENS[payload[0].name]?.label}: {payload[0].value}
                        </Typography>
                      </Box>
                    ) : null)} />
                  </PieChart>
                </ResponsiveContainer>
                {/* The total sits in the hole — a donut without a centre number
                    makes the reader do arithmetic. */}
                <Box sx={{
                  position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
                  pointerEvents: 'none', textAlign: 'center',
                }}>
                  <Box>
                    <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, color: O2D.ink, lineHeight: 1 }}>{statusTotal}</Typography>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: O2D.faint }}>Items</Typography>
                  </Box>
                </Box>
              </Box>
              <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
                {STOCK_ORDER.map((k) => (
                  <LegendRow key={k} statusKey={k} token={STOCK_TOKENS[k]} total={statusTotal}
                    count={({ OK: s.ok, LOW: s.low, REORDER: s.reorder, OUT_OF_STOCK: s.outOfStock, OVERSTOCK: s.overstock })[k] || 0} />
                ))}
                <Typography sx={{ fontSize: '0.66rem', color: O2D.faint, mt: 0.75 }}>
                  Hover a status chip anywhere in IMS to read what it means.
                </Typography>
              </Box>
            </Stack>
          )}
        </Panel>

        {/* ── Where the money is parked ── */}
        <Panel title="Where the money is sitting" icon={IndianRupee}
          hint="Finished-stock value by category — the top 8 categories by rupee value.">
          {categoryData.length === 0 ? (
            <EmptyNote icon={IndianRupee} title="No stock value to show"
              hint="Value appears once items have both stock on hand and a costing rate." />
          ) : (
            <Box sx={{ height: 226 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={O2D.lineSoft} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: O2D.sub }} interval={0} angle={-16}
                    textAnchor="end" height={56} tickLine={false} axisLine={{ stroke: O2D.line }} />
                  <YAxis tick={{ fontSize: 10, fill: O2D.sub }} tickFormatter={compactInr} width={50}
                    tickLine={false} axisLine={false} />
                  <RTooltip cursor={{ fill: alpha(FG_ACCENT, 0.05) }} content={<ChartTip fmt={inr} />} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={44}>
                    {categoryData.map((c, i) => <Cell key={c.name} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Box>
          )}
        </Panel>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 1.25 }}>
        <Panel title="Most produced" icon={Factory} hint="Quantity completed on the line over the last 30 days.">
          <RankedList items={topProduced} color={FG_ACCENT}
            emptyIcon={Factory} emptyTitle="Nothing produced in the last 30 days"
            emptyHint="Record a Daily Production Report under Production In and it will show up here." />
        </Panel>

        <Panel title="Most dispatched" icon={Truck} hint="Quantity shipped to customers over the last 30 days.">
          <RankedList items={topDispatched} color={moveToken('OUT').color}
            emptyIcon={Truck} emptyTitle="Nothing dispatched in the last 30 days"
            emptyHint="Record a shipment under Dispatch Out and it will show up here." />
        </Panel>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 1.25 }}>
        {/* ── The actual production plan, short form ── */}
        <Panel title={`Produce next${replenishList.length ? ` — ${replenishList.length} item${replenishList.length > 1 ? 's' : ''}` : ''}`}
          icon={Factory} hint="Items at or below their Reorder At level, worst first."
          actions={replenishList.length > 0 && (
            <Button size="small" endIcon={<ArrowRight size={13} />} onClick={() => navigate('/fg-ims/planning')}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: FG_ACCENT }}>
              Full plan
            </Button>
          )}
          dense
        >
          {replenishList.length === 0 ? (
            <EmptyNote icon={CheckCircle2} title="Nothing to produce right now"
              hint="Every finished good is above its Reorder At level. This list fills itself as stock is dispatched."
              tone={STOCK_TOKENS.OK.color} />
          ) : (
            <Box sx={{ maxHeight: 268, overflowY: 'auto' }}>
              <Table size="small" sx={imsTableSx()}>
                <TableBody>
                  {replenishList.map((r) => (
                    <TableRow key={r.skuId} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/fg-ims/item/${r.skuId}`)}>
                      <TableCell sx={{ py: 0.85 }}>
                        <Typography noWrap sx={{ fontSize: '0.78rem', fontWeight: 700, color: O2D.ink, maxWidth: 230 }}>{r.skuName}</Typography>
                        <Typography sx={{ fontSize: '0.67rem', color: O2D.sub }}>
                          {r.skuCode} · <b>{num(r.onHand)}</b> in stock · produce <b>{num(r.suggestedProduceQty)}</b>
                        </Typography>
                      </TableCell>
                      <TableCell align="center" sx={{ py: 0.85, width: 110 }}><StatusChip status={r.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Panel>

        {/* ── Latest activity ── */}
        <Panel title="Latest stock activity" icon={History}
          hint="The most recent items produced or dispatched."
          actions={(
            <Button size="small" endIcon={<ArrowRight size={13} />} onClick={() => navigate('/fg-ims/movements')}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: FG_ACCENT }}>
              Full history
            </Button>
          )}
          dense
        >
          <TableScroll>
            <Table size="small" sx={imsTableSx(620)}>
              <TableHead>
                <TableRow>
                  <TableCell align="center">Date</TableCell>
                  <TableCell>Finished Good</TableCell>
                  <TableCell align="center">What happened</TableCell>
                  <TableCell align="right">Change</TableCell>
                  <TableCell align="right">Balance after<Help text="Stock on hand immediately after this movement was recorded." /></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(d?.recentMovements || []).length === 0 && (
                  <TableRow><TableCell colSpan={5} sx={{ border: 0 }}>
                    <EmptyNote icon={History} title="No stock movements yet"
                      hint="Movements appear the moment you record a Production In or a Dispatch Out." />
                  </TableCell></TableRow>
                )}
                {(d?.recentMovements || []).map((m) => {
                  const t = moveToken(m.movementType);
                  return (
                    <TableRow key={m._id} hover>
                      <TableCell align="center" sx={{ whiteSpace: 'nowrap', color: O2D.sub }}>{dayjs(m.movementDate).format('DD MMM')}</TableCell>
                      <TableCell>
                        <Typography noWrap sx={{ fontSize: '0.78rem', fontWeight: 600, color: O2D.ink, maxWidth: 200 }} title={m.skuName}>{m.skuName}</Typography>
                      </TableCell>
                      <TableCell align="center"><MoveChip movementType={m.movementType} txnType={m.txnType} /></TableCell>
                      <TableCell align="right" sx={{ fontWeight: 800, color: t.color, fontVariantNumeric: 'tabular-nums' }}>
                        {t.sign}{num(m.quantity)}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{num(m.balanceAfter)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableScroll>
        </Panel>
      </Box>

      {/* Two figures that do not warrant a tile of their own, but are worth
          stating plainly rather than leaving the reader to infer them. */}
      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap sx={{ px: 0.5 }}>
        <Stack direction="row" spacing={0.6} alignItems="center">
          <Box sx={{ color: FG_ACCENT, display: 'flex' }}><Factory size={14} /></Box>
          <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>
            In production: <b style={{ color: O2D.ink }}>{num(s.totalInProduction)}</b> units
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.6} alignItems="center">
          <Box sx={{ color: O2D.sub, display: 'flex' }}><Truck size={14} /></Box>
          <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>
            Retail value in stock: <b style={{ color: O2D.ink }}>{inr(s.totalRetailValue)}</b>
          </Typography>
        </Stack>
      </Stack>
    </FgShell>
  );
};

export default FgImsDashboard;
