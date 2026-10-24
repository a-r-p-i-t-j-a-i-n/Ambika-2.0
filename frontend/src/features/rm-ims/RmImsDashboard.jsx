import React, { useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, Skeleton, Table, TableHead, TableBody, TableRow, TableCell, Button, alpha,
} from '@mui/material';
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from 'recharts';
import {
  Layers, Disc3, CircleDashed, PackageOpen, AlertTriangle, IndianRupee, Recycle,
  CheckCircle2, ArrowRight, History, ShoppingCart, TrendingDown,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import {
  RmShell, Panel, TableScroll, KpiTile, StatusChip, MoveChip, EmptyNote, Help, YieldChip,
  O2D, STOCK_TOKENS, STOCK_ORDER, moveToken, num, inr, compactInr, imsTableSx,
  Th,
} from './rmImsMeta';
import { useGetRmDashboardQuery } from '../../store/api/rmImsApi';
import { FIELD } from '../ims/imsFieldHelp';

const H = FIELD.rm;

const CAT_COLORS = ['#1d4ed8', '#0f766e', '#c2410c', '#4338ca', '#b45309', '#15803d', '#7c3aed', '#0891b2'];

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

const RmImsDashboard = () => {
  const navigate = useNavigate();
  const { data, isFetching } = useGetRmDashboardQuery();
  const d = data?.data;
  const s = d?.summary || {};

  const needBuying = (s.reorder || 0) + (s.outOfStock || 0);
  const byStatus = { OK: s.ok, LOW: s.low, REORDER: s.reorder, OUT_OF_STOCK: s.outOfStock, OVERSTOCK: s.overstock };
  const statusTotal = STOCK_ORDER.reduce((t, k) => t + (byStatus[k] || 0), 0);
  const statusData = useMemo(
    () => STOCK_ORDER.map((k) => ({ key: k, value: byStatus[k] || 0 })).filter((x) => x.value > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s],
  );
  const categoryData = useMemo(
    () => (d?.byCategory || []).slice(0, 8).map((c) => ({ name: c.category || 'Uncategorised', value: c.value })),
    [d],
  );
  const conversions = d?.recentConversions || [];
  const reorderList = d?.reorderList || [];

  // Average yield across the recent conversions — the single number that says
  // whether the cutting floor is wasting metal. hi 
  const avgYield = conversions.length
    ? Math.round((conversions.reduce((t, c) => t + Number(c.yieldRatioPct || 0), 0) / conversions.length) * 10) / 10
    : null;

  if (isFetching && !d) {
    return (
      <RmShell icon={Layers} title="Raw Material" subtitle="Loading your coil and circle position…">
        <Skeleton variant="rounded" height={72} />
        <Skeleton variant="rounded" height={280} />
        <Skeleton variant="rounded" height={280} />
      </RmShell>
    );
  }

  return (
    <RmShell
      icon={Layers}
      title="Raw Material"
      subtitle="Coils and circles — what you hold, what it's worth, and what needs buying."
      actions={(
        <Stack direction="row" spacing={0.75}>
          <Button size="small" variant="outlined" startIcon={<Recycle size={14} />} onClick={() => navigate('/rm-ims/conversion?new=1')}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', borderColor: O2D.line, color: O2D.body }}>
            Cut a coil
          </Button>
          <Button size="small" variant="contained" disableElevation startIcon={<ShoppingCart size={14} />}
            onClick={() => navigate('/rm-ims/reorder')}
            sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: O2D.brand }}>
            Buying list
          </Button>
        </Stack>
      )}
    >
      {/* The verdict — buying to do, or not. */}
      <Paper elevation={0} sx={{
        borderRadius: '8px', px: 1.75, py: 1.4,
        border: `1px solid ${needBuying ? STOCK_TOKENS.REORDER.border : STOCK_TOKENS.OK.border}`,
        bgcolor: needBuying ? STOCK_TOKENS.REORDER.tint : STOCK_TOKENS.OK.tint,
      }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <Box sx={{
            width: 34, height: 34, borderRadius: '9px', display: 'grid', placeItems: 'center', flexShrink: 0,
            bgcolor: needBuying ? STOCK_TOKENS.REORDER.bg : STOCK_TOKENS.OK.bg,
            color: needBuying ? STOCK_TOKENS.REORDER.color : STOCK_TOKENS.OK.color,
          }}>
            {needBuying ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
          </Box>
          <Box sx={{ minWidth: 0, mr: 'auto' }}>
            <Typography sx={{
              fontSize: '0.9rem', fontWeight: 800, lineHeight: 1.25,
              color: needBuying ? STOCK_TOKENS.REORDER.color : STOCK_TOKENS.OK.color,
            }}>
              {needBuying
                ? `${needBuying} raw-material item${needBuying > 1 ? 's need' : ' needs'} to be ordered`
                : 'Every coil and circle is at a healthy level'}
            </Typography>
            <Typography sx={{ fontSize: '0.72rem', color: O2D.sub }}>
              {needBuying
                ? `${num(s.outOfStock)} out of stock · ${num(s.reorder)} at reorder point · ${num(s.low)} running low.`
                : 'Nothing is at or below its reorder point right now.'}
            </Typography>
          </Box>
          {needBuying > 0 && (
            <Button size="small" variant="contained" disableElevation endIcon={<ArrowRight size={14} />}
              onClick={() => navigate('/rm-ims/reorder')}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px', bgcolor: STOCK_TOKENS.REORDER.color }}>
              See what to buy
            </Button>
          )}
        </Stack>
      </Paper>

      <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
        <KpiTile label="Coils" value={num(s.coilCount)} sub="Uncut raw metal"
          color="#0f766e" icon={Disc3} onClick={() => navigate('/rm-ims/stock?kind=COIL')} />
        <KpiTile label="Circles" value={num(s.circleCount)} sub="Cut and ready"
          color="#4338ca" icon={CircleDashed} onClick={() => navigate('/rm-ims/stock?kind=CIRCLE')} />
        <KpiTile label="Total Available Quantity" value={num(s.totalOnHand)} sub="Coils and circles together"
          color={O2D.brand} icon={PackageOpen} onClick={() => navigate('/rm-ims/stock')} />
        <KpiTile label="Value in store" value={inr(s.totalStockValue)} sub="At last known rate"
          color="#7c3aed" icon={IndianRupee} />
        <KpiTile label="To order now" value={num(needBuying)} sub="Open the buying list"
          color={STOCK_TOKENS.REORDER.color} icon={AlertTriangle} onClick={() => navigate('/rm-ims/reorder')} />
        <KpiTile label="Running low" value={num(s.low)} sub="Watch these next"
          color={STOCK_TOKENS.LOW.color} icon={TrendingDown} onClick={() => navigate('/rm-ims/stock?status=LOW')} />
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1.25fr)' }, gap: 1.25 }}>
        <Panel title="How healthy is the stock?" icon={Layers}
          hint="Every coil and circle sorted into one of five states.">
          {statusTotal === 0 ? (
            <EmptyNote icon={Layers} title="No raw material tracked yet"
              hint="Add coils and circles in Stock & Master Data, then set a planning policy so IMS can judge their health." />
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
                <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
                  <Box>
                    <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, color: O2D.ink, lineHeight: 1 }}>{statusTotal}</Typography>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: O2D.faint }}>Items</Typography>
                  </Box>
                </Box>
              </Box>
              <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
                {STOCK_ORDER.map((k) => (
                  <LegendRow key={k} token={STOCK_TOKENS[k]} total={statusTotal} count={byStatus[k] || 0} />
                ))}
                <Typography sx={{ fontSize: '0.66rem', color: O2D.faint, mt: 0.75 }}>
                  Hover a status chip anywhere in IMS to read what it means.
                </Typography>
              </Box>
            </Stack>
          )}
        </Panel>

        <Panel title="Where the money is sitting" icon={IndianRupee}
          hint="Stock value by category — the top 8 categories by rupee value.">
          {categoryData.length === 0 ? (
            <EmptyNote icon={IndianRupee} title="No stock value to show"
              hint="Value appears once items have both an on-hand quantity and a rate." />
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
        {/* ── Cutting performance. Yield is the number this screen exists for. ── */}
        <Panel title="Recent coil cutting" icon={Recycle}
          hint="How much of each coil came out as usable circles."
          actions={conversions.length > 0 && (
            <Button size="small" endIcon={<ArrowRight size={13} />} onClick={() => navigate('/rm-ims/conversion')}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.brand }}>
              Coil to Circle history
            </Button>
          )}
          dense
        >
          {conversions.length === 0 ? (
            <EmptyNote icon={Recycle} title="No coils cut yet"
              hint="Record a coil → circle conversion and the yield of each batch will appear here." />
          ) : (
            <>
              {avgYield != null && (
                <Box sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${O2D.lineSoft}`, bgcolor: O2D.surfaceAlt }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography sx={{ fontSize: '0.73rem', color: O2D.sub, mr: 'auto' }}>
                      Average yield across the last {conversions.length} batch{conversions.length > 1 ? 'es' : ''}
                    </Typography>
                    <YieldChip pct={avgYield} />
                  </Stack>
                </Box>
              )}
              <Box sx={{ maxHeight: 246, overflowY: 'auto' }}>
                <Table size="small" sx={imsTableSx()}>
                  <TableBody>
                    {conversions.map((c) => (
                      <TableRow key={c._id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate('/rm-ims/conversion')}>
                        <TableCell sx={{ py: 0.85 }}>
                          <Typography noWrap sx={{ fontSize: '0.78rem', fontWeight: 700, color: O2D.ink, maxWidth: 230 }}>{c.coilSkuName}</Typography>
                          <Typography sx={{ fontSize: '0.67rem', color: O2D.sub }}>
                            {/* A full cut accounts for the whole coil — its own round and
                                the partial rounds before it (settledKg). */}
                            {c.batchNo || c.conversionNumber} · coil <b>{num(c.settledKg ?? c.coilWeightKg)}kg</b> → circles <b>{num(c.circlesWeightKg)}kg</b> · scrap {num(c.scrapKg)}kg
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ py: 0.85, width: 88 }}><YieldChip pct={c.yieldRatioPct} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </>
          )}
        </Panel>

        <Panel title={`Buy next${reorderList.length ? ` — ${reorderList.length} item${reorderList.length > 1 ? 's' : ''}` : ''}`}
          icon={ShoppingCart} hint="Coils and circles at or below their reorder point, worst first."
          actions={reorderList.length > 0 && (
            <Button size="small" endIcon={<ArrowRight size={13} />} onClick={() => navigate('/rm-ims/reorder')}
              sx={{ textTransform: 'none', fontWeight: 700, fontSize: '0.72rem', color: O2D.brand }}>
              Full list
            </Button>
          )}
          dense
        >
          {reorderList.length === 0 ? (
            <EmptyNote icon={CheckCircle2} title="Nothing to buy right now"
              hint="Every coil and circle is above its reorder point. This list fills itself as material is consumed."
              tone={STOCK_TOKENS.OK.color} />
          ) : (
            <Box sx={{ maxHeight: 290, overflowY: 'auto' }}>
              <Table size="small" sx={imsTableSx()}>
                <TableBody>
                  {reorderList.map((r) => (
                    <TableRow key={r.skuId} hover sx={{ cursor: 'pointer' }} onClick={() => navigate('/rm-ims/reorder')}>
                      <TableCell sx={{ py: 0.85 }}>
                        <Typography noWrap sx={{ fontSize: '0.78rem', fontWeight: 700, color: O2D.ink, maxWidth: 230 }}>{r.skuName}</Typography>
                        <Typography sx={{ fontSize: '0.67rem', color: O2D.sub }}>
                          {r.skuCode} · <b>{num(r.onHand)}</b> left · order <b>{num(r.suggestedOrderQty)}</b>
                        </Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ py: 0.85, width: 110 }}><StatusChip status={r.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Panel>
      </Box>

      <Panel title="Latest stock activity" icon={History}
        hint="The most recent coils and circles to come in or go out."
        actions={(
          <Button size="small" endIcon={<ArrowRight size={13} />} onClick={() => navigate('/rm-ims/movements')}
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
                <TableCell><Th label="Date" hint={H.movementDate} /></TableCell>
                <TableCell><Th label="Item" hint={H.skuName} /></TableCell>
                <TableCell><Th label="What happened" hint={H.movementType} /></TableCell>
                <TableCell align="right"><Th label="Change" hint={H.movementQty} /></TableCell>
                <TableCell align="right">Balance after<Help text={H.balanceAfter} /></TableCell>
                <TableCell><Th label="Recorded by" hint={H.recordedBy} /></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(d?.recentMovements || []).length === 0 && (
                <TableRow><TableCell colSpan={7} sx={{ border: 0 }}>
                  <EmptyNote icon={History} title="No stock movements yet"
                    hint="Movements appear the moment you record a Stock In, a Stock Out or a conversion." />
                </TableCell></TableRow>
              )}
              {(d?.recentMovements || []).map((m, i) => {
                const t = moveToken(m.movementType);
                return (
                  <TableRow key={m._id} hover>
                    <TableCell align="center" sx={{ width: 64, fontVariantNumeric: 'tabular-nums', color: O2D.sub }}>{i + 1}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap', color: O2D.sub }}>{dayjs(m.movementDate).format('DD MMM')}</TableCell>
                    <TableCell>
                      <Typography noWrap sx={{ fontSize: '0.78rem', fontWeight: 600, color: O2D.ink, maxWidth: 240 }} title={m.skuName}>{m.skuName}</Typography>
                    </TableCell>
                    <TableCell><MoveChip movementType={m.movementType} txnType={m.txnType} /></TableCell>
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
    </RmShell>
  );
};

export default RmImsDashboard;
