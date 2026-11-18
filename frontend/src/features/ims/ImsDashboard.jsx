import React, { useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, Skeleton, Table, TableHead, TableBody, TableRow, TableCell,
  Button, LinearProgress, alpha,
} from '@mui/material';
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from 'recharts';
import {
  LayoutDashboard, Boxes, PackageOpen, AlertTriangle, IndianRupee, TrendingDown,
  ShoppingCart, CheckCircle2, ArrowRight, History, Flame, Layers,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import {
  ImsShell, Panel, TableScroll, KpiCard, KpiGrid, DashboardAlert, StatusChip, MoveChip, EmptyNote, Help,
  O2D, STOCK_TOKENS, STOCK_ORDER, num, inr, compactInr, imsTableSx, moveToken,
  Th,
} from './imsMeta';
import { FLUENT, headerBtnSx, primaryBtnSx } from './imsFluent';
import { useGetImsDashboardQuery } from '../../store/api/imsApi';
import { FIELD } from './imsFieldHelp';

const H = FIELD.ims;

// The warm chart palette — pulled from the same tokens the chips use, so a bar
// and a status pill for the same thing are never two different colours.
const CAT_COLORS = ['#1d4ed8', '#0f766e', '#c2410c', '#4338ca', '#b45309', '#15803d', '#7c3aed', '#0891b2'];

// A single row in the hand-built donut legend. Recharts' default legend is a
// cramped strip; a list gives room for the count AND the share, which is what
// the client actually reads.
const LegendRow = ({ token, count, total }) => {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ py: 0.45 }}>
      <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: token.color, flexShrink: 0 }} />
      <Typography sx={{ fontSize: '0.75rem', color: O2D.body, fontWeight: 600, mr: 'auto' }}>{token.label}</Typography>
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
        <Typography key={p.dataKey} sx={{ fontSize: '0.72rem', color: p.color || O2D.brand, fontWeight: 700 }}>
          {fmt ? fmt(p.value) : num(p.value)}
        </Typography>
      ))}
    </Box>
  );
};

const ImsDashboard = () => {
  const navigate = useNavigate();
  const { data, isFetching } = useGetImsDashboardQuery();
  const d = data?.data;
  const s = d?.summary || {};

  const needBuying = (s.reorder || 0) + (s.outOfStock || 0);
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
  const topConsumed = useMemo(
    () => (d?.topConsumed || []).map((t) => ({ name: (t.skuName || t.skuCode || '').slice(0, 18), qty: t.qty })),
    [d],
  );
  const reorderList = d?.reorderList || [];
  const maxConsumed = Math.max(1, ...topConsumed.map((t) => t.qty || 0));

  if (isFetching && !d) {
    return (
      <ImsShell icon={LayoutDashboard} title="Dashboard" subtitle="Consumables & Packaging — loading your stock position…">
        <Skeleton variant="rounded" height={72} />
        <Skeleton variant="rounded" height={280} />
        <Skeleton variant="rounded" height={280} />
      </ImsShell>
    );
  }

  return (
    <ImsShell
      icon={LayoutDashboard}
      title="Dashboard"
      subtitle="Consumables & Packaging — where your stock stands today, and what needs buying next."
      actions={(
        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ minWidth: 0 }}>
          {/* The buying verdict, as one clickable alert beside the stock list. */}
          <DashboardAlert
            count={needBuying}
            label={`item${needBuying === 1 ? ' needs' : 's need'} to be ordered`}
            okLabel="Every item is at a healthy level"
            detail={needBuying
              ? `${num(s.outOfStock)} out of stock · ${num(s.reorder)} at reorder point · ${num(s.low)} running low. Opens the Buying List.`
              : 'Nothing is at or below its reorder point right now.'}
            onClick={() => navigate('/ims/reorder')}
            onOkClick={() => navigate('/ims/stock')}
          />
          <Button size="small" variant="outlined" startIcon={<Boxes size={14} />} onClick={() => navigate('/ims/stock')} sx={headerBtnSx}>
            Open Stock List
          </Button>
          <Button size="small" variant="contained" disableElevation startIcon={<ShoppingCart size={14} />}
            onClick={() => navigate('/ims/reorder')} sx={primaryBtnSx(O2D.brand)}>
            Buying List
          </Button>
        </Stack>
      )}
    >
      {/* ── Headline numbers. Every card opens the screen that explains it. ── */}
      <KpiGrid compact>
        <KpiCard compact label="Items tracked" value={num(s.itemCount)} sub="Consumables & packaging"
          tone={FLUENT.teal} icon={Boxes} onClick={() => navigate('/ims/stock')}
          hint="Open Stock & Master Data with every item." />
        <KpiCard compact label="Closing Stock" value={num(s.totalOnHand)} sub="Total units across all items"
          tone={FLUENT.blue} icon={PackageOpen} onClick={() => navigate('/ims/stock?view=in-stock')}
          hint="Open Stock & Master Data showing only items with stock on hand." />
        <KpiCard compact label="Value in store" value={inr(s.totalStockValue)} sub="At last purchase cost"
          tone={FLUENT.grey} icon={IndianRupee} onClick={() => navigate('/ims/stock?view=value')}
          hint="Open Stock & Master Data ranked by stock value, highest first." />
        <KpiCard compact label="To order now" value={num(needBuying)} sub="Out of stock + at reorder point"
          tone={FLUENT.orange} icon={AlertTriangle} onClick={() => navigate('/ims/reorder')}
          hint="Open the Buying List." />
        <KpiCard compact label="Running low" value={num(s.low)} sub="Watch these next"
          tone={FLUENT.amber} icon={TrendingDown} onClick={() => navigate('/ims/stock?status=LOW')}
          hint="Open Stock & Master Data filtered to items running low." />
      </KpiGrid>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1.25fr)' }, gap: 1.25 }}>
        {/* ── Stock health donut + a legend that spells out every state ── */}
        <Panel title="How healthy is the stock?" icon={Layers}
          hint="Every tracked item sorted into one of five states.">
          {statusTotal === 0 ? (
            <EmptyNote icon={Boxes} title="No items tracked yet"
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
                          {STOCK_TOKENS[payload[0].name]?.label}: {payload[0].value}
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
                  <LegendRow key={k} token={STOCK_TOKENS[k]} total={statusTotal}
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
          hint="Stock value by category — the top 8 categories by rupee value.">
          {categoryData.length === 0 ? (
            <EmptyNote icon={IndianRupee} title="No stock value to show"
              hint="Value appears once items have both a Closing Stock quantity and a purchase cost." />
          ) : (
            <Box sx={{ height: 226 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={O2D.lineSoft} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: O2D.sub }} interval={0} angle={-16}
                    textAnchor="end" height={56} tickLine={false} axisLine={{ stroke: O2D.line }} />
                  <YAxis tick={{ fontSize: 10, fill: O2D.sub }} tickFormatter={compactInr} width={50}
                    tickLine={false} axisLine={false} />
                  <RTooltip cursor={{ fill: alpha(O2D.brand, 0.05) }} content={<ChartTip fmt={inr} />} />
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
        {/* ── What gets used most. A ranked bar list beats a chart here because
            the client reads it as "these are my fast movers". ── */}
        <Panel title="Fastest-moving items" icon={Flame}
          hint="Quantity issued to production over the last 30 days.">
          {topConsumed.length === 0 ? (
            <EmptyNote icon={Flame} title="Nothing issued in the last 30 days"
              hint="Record a production issue under Stock Out and it will show up here." />
          ) : (
            <Stack spacing={0.9}>
              {topConsumed.slice(0, 8).map((t, i) => (
                <Box key={`${t.name}-${i}`}>
                  <Stack direction="row" alignItems="baseline" spacing={1}>
                    <Typography noWrap sx={{ fontSize: '0.76rem', fontWeight: 600, color: O2D.body, mr: 'auto' }}>{t.name}</Typography>
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: O2D.ink, fontVariantNumeric: 'tabular-nums' }}>{num(t.qty)}</Typography>
                  </Stack>
                  <LinearProgress variant="determinate" value={Math.round((t.qty / maxConsumed) * 100)}
                    sx={{
                      height: 5, borderRadius: 3, mt: 0.3, bgcolor: O2D.lineSoft,
                      '& .MuiLinearProgress-bar': { borderRadius: 3, bgcolor: '#0f766e' },
                    }} />
                </Box>
              ))}
            </Stack>
          )}
        </Panel>

        {/* ── The actual buying list, short form ── */}
        <Panel title={`Buy next${reorderList.length ? ` — ${reorderList.length} item${reorderList.length > 1 ? 's' : ''}` : ''}`}
          icon={ShoppingCart} hint="Items at or below their reorder point, worst first."
          actions={reorderList.length > 0 && (
            <Button size="small" endIcon={<ArrowRight size={13} />} onClick={() => navigate('/ims/reorder')}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.brand }}>
              Full list
            </Button>
          )}
          dense
        >
          {reorderList.length === 0 ? (
            <EmptyNote icon={CheckCircle2} title="Nothing to buy right now"
              hint="Every item is above its reorder point. This list fills itself as stock is consumed."
              tone={STOCK_TOKENS.OK.color} />
          ) : (
            <Box sx={{ maxHeight: 268, overflowY: 'auto' }}>
              <Table size="small" sx={imsTableSx()}>
                <TableBody>
                  {reorderList.map((r) => (
                    <TableRow key={r.skuId} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/ims/item/${r.skuId}`)}>
                      <TableCell sx={{ py: 0.85 }}>
                        <Typography noWrap sx={{ fontSize: '0.78rem', fontWeight: 700, color: O2D.ink, maxWidth: 230 }}>{r.skuName}</Typography>
                        <Typography sx={{ fontSize: '0.67rem', color: O2D.sub }}>
                          {r.skuCode} · <b>{num(r.onHand)}</b> left · order <b>{num(r.suggestedOrderQty)}</b>
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
      </Box>

      {/* ── Latest activity ── */}
      <Panel title="Latest stock activity" icon={History}
        hint="The most recent items to come in or go out."
        actions={(
          <Button size="small" endIcon={<ArrowRight size={13} />} onClick={() => navigate('/ims/movements')}
            sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.brand }}>
            Full history
          </Button>
        )}
        dense
      >
        <TableScroll>
          <Table size="small" sx={imsTableSx(760)}>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ width: 64, whiteSpace: 'nowrap' }}>S.No.</TableCell>
                <TableCell align="center"><Th label="Date" hint={H.movementDate} /></TableCell>
                <TableCell><Th label="Item Name" hint={H.skuName} /></TableCell>
                <TableCell align="center"><Th label="What happened" hint={H.movementType} /></TableCell>
                <TableCell align="right"><Th label="Change" hint={H.movementQty} /></TableCell>
                <TableCell align="right">Balance after<Help text={H.balanceAfter} /></TableCell>
                <TableCell><Th label="Recorded by" hint={H.recordedBy} /></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(d?.recentMovements || []).length === 0 && (
                <TableRow><TableCell colSpan={7} sx={{ border: 0 }}>
                  <EmptyNote icon={History} title="No stock movements yet"
                    hint="Movements appear the moment you record a Stock In or a Stock Out." />
                </TableCell></TableRow>
              )}
              {(d?.recentMovements || []).map((m, i) => {
                const t = moveToken(m.movementType);
                return (
                  <TableRow key={m._id} hover>
                    <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{i + 1}</TableCell>
                    <TableCell align="center" sx={{ whiteSpace: 'nowrap', color: O2D.sub }}>{dayjs(m.movementDate).format('DD MMM')}</TableCell>
                    <TableCell>
                      <Typography noWrap sx={{ fontSize: '0.78rem', fontWeight: 600, color: O2D.ink, maxWidth: 240 }} title={m.skuName}>{m.skuName}</Typography>
                    </TableCell>
                    <TableCell align="center"><MoveChip movementType={m.movementType} txnType={m.txnType} /></TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, color: t.color, fontVariantNumeric: 'tabular-nums' }}>
                      {t.sign}{num(m.quantity)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{num(m.balanceAfter)}</TableCell>
                    <TableCell sx={{ color: O2D.sub }}>{m.performedByName || '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableScroll>
      </Panel>
    </ImsShell>
  );
};

export default ImsDashboard;
