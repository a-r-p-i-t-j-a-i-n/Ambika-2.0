import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box, Paper, Stack, Typography, Chip, ToggleButtonGroup, ToggleButton,
  TextField, MenuItem, alpha, useTheme, Skeleton, Tooltip,
} from '@mui/material';
import {
  TrendingUp, TrendingDown, BarChart3, Activity, Flame, IndianRupee,
  ArrowUp, ArrowDown, LineChart as LineChartIcon, Sparkles,
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip,
  CartesianGrid, BarChart, Bar, ReferenceLine,
} from 'recharts';
import { useGetPricingAnalyticsQuery } from '../../store/api/pricingApi';
import { fmtINR } from '../../utils/formatters';

const BUY_SIDE_KINDS = ['RAW_MATERIAL', 'CONSUMABLE', 'PACKING'];
const ITEM_KIND_OPTIONS = [
  { value: '',              label: 'All Items' },
  { value: 'FINISHED_GOOD', label: 'Finished Goods' },
  { value: 'RAW_MATERIAL',  label: 'Raw Material' },
  { value: 'CONSUMABLE',    label: 'Consumables' },
  { value: 'PACKING',       label: 'Packing' },
];

const KpiCard = ({ label, value, hint, color, icon: Icon, theme, trend }) => (
  <Paper sx={{
    flex: '1 1 200px',
    minWidth: 180,
    p: 2,
    borderRadius: 2.5,
    background: 'linear-gradient(180deg, #ffffff 0%, #f7f9ff 100%)',
    border: `1px solid ${theme.palette.divider}`,
  }}>
    <Stack direction="row" spacing={1.25} alignItems="flex-start">
      <Box sx={{
        width: 36, height: 36, borderRadius: 1.5,
        display: 'grid', placeItems: 'center',
        bgcolor: alpha(color, 0.10), color,
      }}>
        <Icon size={18} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{
          fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'text.secondary',
        }}>
          {label}
        </Typography>
        <Typography sx={{
          fontWeight: 800, fontSize: '1.5rem', lineHeight: 1.1, mt: 0.25,
          fontVariantNumeric: 'tabular-nums', color,
        }}>
          {value}
        </Typography>
        {hint && (
          <Typography sx={{ fontSize: '0.72rem', color: 'text.disabled', mt: 0.5 }}>{hint}</Typography>
        )}
        {trend != null && (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
            {trend > 0
              ? <ArrowUp size={11} color={theme.palette.success.dark} />
              : trend < 0
                ? <ArrowDown size={11} color={theme.palette.error.dark} />
                : null}
            <Typography sx={{
              fontSize: '0.68rem', fontWeight: 800,
              color: trend > 0 ? theme.palette.success.dark : trend < 0 ? theme.palette.error.dark : 'text.disabled',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {trend > 0 ? '+' : ''}{trend.toFixed(2)}%
            </Typography>
          </Stack>
        )}
      </Box>
    </Stack>
  </Paper>
);

// Single tooltip used by both charts so the styling stays consistent.
const SoftTooltip = ({ active, payload, label, theme, suffix = '' }) => {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{
      bgcolor: '#fff', p: 1.25,
      border: `1px solid ${theme.palette.divider}`,
      borderRadius: 1.5,
      boxShadow: '0 6px 18px rgba(15, 23, 42, 0.10)',
    }}>
      <Typography sx={{ fontWeight: 800, fontSize: '0.78rem', mb: 0.25 }}>{label}</Typography>
      {payload.map((p) => (
        <Stack key={p.name} direction="row" spacing={1} justifyContent="space-between" sx={{ minWidth: 140 }}>
          <Typography sx={{ fontSize: '0.74rem', color: p.color }}>{p.name}</Typography>
          <Typography sx={{ fontSize: '0.74rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}{suffix}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
};

// Heatmap cell color: red for increase, green for decrease, neutral when 0/null.
const heatColor = (val, theme) => {
  if (val == null) return alpha(theme.palette.text.primary, 0.04);
  if (val === 0)   return alpha(theme.palette.text.primary, 0.06);
  const abs = Math.min(Math.abs(val), 50);
  const intensity = 0.10 + (abs / 50) * 0.60;
  return val > 0
    ? alpha(theme.palette.error.main, intensity)
    : alpha(theme.palette.success.main, intensity);
};
const heatTextColor = (val, theme) => {
  if (val == null) return 'text.disabled';
  const abs = Math.abs(val);
  if (abs > 25) return '#fff';
  return val > 0 ? theme.palette.error.dark : val < 0 ? theme.palette.success.dark : 'text.secondary';
};

const PricingAnalytics = () => {
  const theme = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();

  // State initialised from the URL so an analytics view is shareable.
  const [priceType, setPriceType] = useState(() => (searchParams.get('stream') === 'RM_COST' ? 'RM_COST' : 'SELLING'));
  const [itemType, setItemType] = useState(() => (
    BUY_SIDE_KINDS.includes(searchParams.get('kind')) || searchParams.get('kind') === 'FINISHED_GOOD'
      ? searchParams.get('kind') : ''
  ));
  const [months, setMonths] = useState(() => {
    const m = Number(searchParams.get('months'));
    return [3, 6, 12, 24].includes(m) ? m : 12;
  });

  // Mirror the view into the URL so the address bar is a shareable link.
  useEffect(() => {
    const next = new URLSearchParams();
    if (priceType === 'RM_COST' && !BUY_SIDE_KINDS.includes(itemType)) next.set('stream', 'RM_COST');
    if (itemType) next.set('kind', itemType);
    if (months !== 12) next.set('months', String(months));
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceType, itemType, months]);

  // Buy-side kinds only have a purchase price — force the RM_COST stream.
  const isBuySide = BUY_SIDE_KINDS.includes(itemType);
  const effectivePriceType = isBuySide ? 'RM_COST' : priceType;
  const streamWord = effectivePriceType === 'SELLING'
    ? 'selling'
    : (isBuySide ? 'purchase' : 'RM cost');

  const analyticsQuery = useMemo(() => ({
    priceType: effectivePriceType, months,
    ...(itemType ? { itemType } : {}),
  }), [effectivePriceType, months, itemType]);

  const { data, isFetching } = useGetPricingAnalyticsQuery(analyticsQuery);
  const a = data?.data;

  const monthly = useMemo(() => (a?.monthlyTimeline || []).map((m) => ({
    name: m.label, index: m.priceIndex, revisions: m.totalRevisions, avgChange: m.avgChangePercent,
  })), [a]);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Hero */}
      <Box sx={{
        position: 'relative', overflow: 'hidden', color: '#fff',
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)',
        px: { xs: 3, md: 5 }, pt: { xs: 4, md: 5 }, pb: { xs: 5, md: 7 },
      }}>
        <Box aria-hidden sx={{
          position: 'absolute', width: 420, height: 420, borderRadius: '50%',
          top: -160, right: -120,
          background: 'radial-gradient(circle, rgba(96,165,250,0.32) 0%, rgba(96,165,250,0) 60%)',
        }} />
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} sx={{ position: 'relative' }}>
          <Stack direction="row" spacing={2.5} alignItems="center" sx={{ flex: 1 }}>
            <Box sx={{
              width: 52, height: 52, borderRadius: 2.5,
              display: 'grid', placeItems: 'center',
              background: 'rgba(255,255,255,0.14)',
              border: '1px solid rgba(255,255,255,0.22)',
            }}>
              <BarChart3 size={26} color="#fff" />
            </Box>
            <Box>
              <Typography sx={{ color: '#fff', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 800, letterSpacing: '-0.02em' }}>
                Pricing Analytics
              </Typography>
              <Typography sx={{ color: 'rgba(255,255,255,0.82)', fontSize: '0.95rem', mt: 0.5, maxWidth: 720 }}>
                Trend, frequency &amp; volatility — the numbers behind every customer negotiation.
              </Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <TextField
              select size="small" value={itemType}
              onChange={(e) => setItemType(e.target.value)}
              sx={{ minWidth: 152 }}
              SelectProps={{
                displayEmpty: true,
                sx: {
                  bgcolor: 'rgba(255,255,255,0.16)',
                  color: '#fff', borderRadius: 1.5,
                  fontWeight: 700, fontSize: '0.78rem',
                  '& .MuiSelect-icon': { color: '#fff' },
                },
              }}
              InputProps={{
                sx: { '& fieldset': { border: '1px solid rgba(255,255,255,0.25)' } },
              }}
            >
              {ITEM_KIND_OPTIONS.map((o) => (
                <MenuItem key={o.value || 'all'} value={o.value}>{o.label}</MenuItem>
              ))}
            </TextField>

            {isBuySide ? (
              <Stack direction="row" spacing={0.75} alignItems="center" sx={{
                px: 1.5, borderRadius: 1.5,
                bgcolor: 'rgba(255,255,255,0.16)',
                border: '1px solid rgba(255,255,255,0.25)',
              }}>
                <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: '#fff' }}>
                  Purchase Price
                </Typography>
              </Stack>
            ) : (
              <ToggleButtonGroup
                exclusive size="small" value={priceType}
                onChange={(_, v) => v && setPriceType(v)}
                sx={{
                  bgcolor: 'rgba(255,255,255,0.10)',
                  p: 0.3, borderRadius: 1.5,
                  '& .MuiToggleButton-root': {
                    px: 1.5, py: 0.5, fontSize: '0.72rem', fontWeight: 700,
                    border: 'none', borderRadius: '8px !important',
                    color: 'rgba(255,255,255,0.7)', textTransform: 'none',
                    '&.Mui-selected': {
                      bgcolor: '#fff', color: theme.palette.primary.dark,
                      '&:hover': { bgcolor: '#fff' },
                    },
                  },
                }}
              >
                <ToggleButton value="SELLING">Selling</ToggleButton>
                <ToggleButton value="RM_COST">RM Cost</ToggleButton>
              </ToggleButtonGroup>
            )}

            <TextField
              select size="small" value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              SelectProps={{
                sx: {
                  bgcolor: 'rgba(255,255,255,0.16)',
                  color: '#fff', borderRadius: 1.5,
                  fontWeight: 700, fontSize: '0.78rem',
                  '& .MuiSelect-icon': { color: '#fff' },
                },
              }}
              InputProps={{
                sx: { '& fieldset': { border: '1px solid rgba(255,255,255,0.25)' } },
              }}
            >
              <MenuItem value={3}>Last 3 months</MenuItem>
              <MenuItem value={6}>Last 6 months</MenuItem>
              <MenuItem value={12}>Last 12 months</MenuItem>
              <MenuItem value={24}>Last 24 months</MenuItem>
            </TextField>
          </Stack>
        </Stack>
      </Box>

      <Box sx={{ px: { xs: 1.5, md: 2.5 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 5 }}>
        {/* KPIs */}
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 2.5 }}>
          {isFetching && !a ? (
            [...Array(5)].map((_, i) => <Skeleton key={i} variant="rectangular" sx={{ flex: '1 1 200px', minWidth: 180, height: 100, borderRadius: 2.5 }} />)
          ) : (
            <>
              <KpiCard theme={theme} label="This month change" value={`${a?.kpis?.thisMonthAvgChange?.toFixed(2) || '0.00'}%`}
                color={a?.kpis?.thisMonthAvgChange >= 0 ? theme.palette.success.dark : theme.palette.error.dark}
                icon={a?.kpis?.thisMonthAvgChange >= 0 ? TrendingUp : TrendingDown}
                hint={`avg ${streamWord} change`}
              />
              <KpiCard theme={theme} label="Revisions this month" value={a?.kpis?.thisMonthRevisions || 0}
                color={theme.palette.primary.main} icon={Activity}
                hint={`${a?.kpis?.windowTotalRevisions || 0} in window`}
              />
              <KpiCard theme={theme} label={`Avg change · ${a?.months || 12}mo`} value={`${a?.kpis?.windowAvgChange?.toFixed(2) || '0.00'}%`}
                color={theme.palette.warning.dark} icon={LineChartIcon}
                trend={a?.kpis?.windowAvgChange ?? 0}
              />
              <KpiCard theme={theme} label="Volatile SKUs" value={a?.kpis?.volatileSkus || 0}
                color={theme.palette.error.dark} icon={Flame}
                hint="3+ revisions in window"
              />
              <KpiCard theme={theme} label="SKUs revised" value={a?.kpis?.uniqueSkusRevised || 0}
                color={theme.palette.info.dark} icon={Sparkles}
                hint="unique SKUs with changes"
              />
            </>
          )}
        </Stack>

        {/* Charts: Index line + Revisions bar */}
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2.5} sx={{ mb: 2.5 }}>
          <Paper sx={{ flex: 2, p: 2.5, borderRadius: 3, boxShadow: '0 10px 28px rgba(30,58,138,0.06)' }}>
            <ChartHeader
              title={`Price Index (rebased 100 = ${monthly.find((m) => m.index)?.name || 'start'})`}
              subtitle={`Average ${streamWord} price per month`}
              icon={LineChartIcon}
              theme={theme}
            />
            <Box sx={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <LineChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: theme.palette.text.secondary }} />
                  <YAxis tick={{ fontSize: 11, fill: theme.palette.text.secondary }} domain={['auto', 'auto']} />
                  <RTooltip content={<SoftTooltip theme={theme} />} />
                  <ReferenceLine y={100} stroke={theme.palette.text.disabled} strokeDasharray="2 4" />
                  <Line type="monotone" dataKey="index" name="Index"
                    stroke={theme.palette.primary.main} strokeWidth={2.5}
                    dot={{ r: 4, fill: theme.palette.primary.main }}
                    activeDot={{ r: 6 }} />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </Paper>

          <Paper sx={{ flex: 1, p: 2.5, borderRadius: 3, boxShadow: '0 10px 28px rgba(30,58,138,0.06)' }}>
            <ChartHeader
              title="Revisions per month"
              subtitle="How active each month was"
              icon={BarChart3}
              theme={theme}
            />
            <Box sx={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.palette.divider} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: theme.palette.text.secondary }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: theme.palette.text.secondary }} />
                  <RTooltip content={<SoftTooltip theme={theme} />} />
                  <Bar dataKey="revisions" name="Revisions" fill={theme.palette.primary.main} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Paper>
        </Stack>

        {/* Top movers + Heatmap */}
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2.5}>
          {/* Top Movers */}
          <Paper sx={{ flex: 1, p: 2.5, borderRadius: 3, boxShadow: '0 10px 28px rgba(30,58,138,0.06)' }}>
            <ChartHeader title="Top movers" subtitle={`Biggest cumulative changes in last ${a?.months || 12} months`} icon={TrendingUp} theme={theme} />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <MoverList title="Increases" items={a?.topIncreases || []} color={theme.palette.error.dark} icon={ArrowUp} theme={theme} />
              <MoverList title="Decreases" items={a?.topDecreases || []} color={theme.palette.success.dark} icon={ArrowDown} theme={theme} />
            </Stack>
          </Paper>

          {/* Heatmap */}
          <Paper sx={{ flex: 1.5, p: 2.5, borderRadius: 3, boxShadow: '0 10px 28px rgba(30,58,138,0.06)' }}>
            <ChartHeader
              title="SKU × Month heatmap"
              subtitle="Red = price rose · Green = price fell · cell = avg % change that month"
              icon={Flame}
              theme={theme}
            />
            {isFetching ? (
              <Skeleton variant="rectangular" height={260} sx={{ borderRadius: 2 }} />
            ) : (a?.heatmap?.skus?.length ? (
              <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{
                  display: 'grid',
                  gridTemplateColumns: `minmax(140px, 1.4fr) repeat(${a.heatmap.months.length}, minmax(48px, 1fr))`,
                  gap: 0.5,
                  minWidth: 480,
                }}>
                  {/* Header row */}
                  <Box />
                  {a.heatmap.monthLabels.map((lbl) => (
                    <Typography key={lbl} sx={{
                      fontSize: '0.62rem', fontWeight: 800, color: 'text.disabled',
                      letterSpacing: '0.04em', textTransform: 'uppercase',
                      textAlign: 'center', py: 0.5,
                    }}>
                      {lbl}
                    </Typography>
                  ))}
                  {/* Rows */}
                  {a.heatmap.skus.map((sku) => (
                    <React.Fragment key={sku.skuId}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', py: 0.5 }}>
                        <Typography sx={{
                          fontFamily: 'ui-monospace, monospace', fontWeight: 800,
                          fontSize: '0.7rem', color: theme.palette.primary.dark,
                        }} noWrap>
                          {sku.code}
                        </Typography>
                        <Typography sx={{ fontSize: '0.62rem', color: 'text.disabled' }} noWrap>
                          {sku.name}
                        </Typography>
                      </Box>
                      {a.heatmap.months.map((m) => {
                        const val = sku.monthlyChanges[m];
                        return (
                          <Tooltip key={m} arrow placement="top"
                            title={val == null ? 'No change this month' : `${val > 0 ? '+' : ''}${val.toFixed(2)}%`}>
                            <Box sx={{
                              height: 32, borderRadius: 0.75,
                              display: 'grid', placeItems: 'center',
                              bgcolor: heatColor(val, theme),
                              color: heatTextColor(val, theme),
                              fontWeight: 800, fontSize: '0.62rem',
                              fontVariantNumeric: 'tabular-nums',
                              cursor: 'default',
                            }}>
                              {val == null ? '—' : `${val > 0 ? '+' : ''}${val.toFixed(0)}`}
                            </Box>
                          </Tooltip>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </Box>
              </Box>
            ) : (
              <Box sx={{ py: 6, textAlign: 'center', color: 'text.disabled' }}>
                <Flame size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
                <Typography sx={{ fontWeight: 700 }}>Not enough data yet</Typography>
                <Typography sx={{ fontSize: '0.82rem' }}>File a few revisions to see the volatility map.</Typography>
              </Box>
            ))}
          </Paper>
        </Stack>
      </Box>
    </Box>
  );
};

const ChartHeader = ({ title, subtitle, icon: Icon, theme }) => (
  <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.5 }}>
    <Box sx={{
      width: 30, height: 30, borderRadius: 1.25,
      display: 'grid', placeItems: 'center',
      bgcolor: alpha(theme.palette.primary.main, 0.10), color: theme.palette.primary.dark,
    }}>
      <Icon size={15} />
    </Box>
    <Box>
      <Typography sx={{ fontWeight: 800, fontSize: '0.92rem' }}>{title}</Typography>
      <Typography sx={{ fontSize: '0.74rem', color: 'text.secondary' }}>{subtitle}</Typography>
    </Box>
  </Stack>
);

const MoverList = ({ title, items, color, icon: Icon, theme }) => (
  <Box sx={{ flex: 1, minWidth: 0 }}>
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1 }}>
      <Icon size={12} color={color} />
      <Typography sx={{
        fontSize: '0.66rem', fontWeight: 800, color,
        letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>
        {title}
      </Typography>
    </Stack>
    {items.length === 0 ? (
      <Typography sx={{ fontSize: '0.78rem', color: 'text.disabled', fontStyle: 'italic' }}>
        Nothing notable
      </Typography>
    ) : (
      <Stack spacing={0.5}>
        {items.map((m) => (
          <Stack key={m.skuId} direction="row" alignItems="center" spacing={1} sx={{
            p: 0.75, borderRadius: 1,
            bgcolor: alpha(color, 0.04),
            border: `1px solid ${alpha(color, 0.10)}`,
          }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{
                fontFamily: 'ui-monospace, monospace', fontWeight: 800,
                fontSize: '0.74rem', color: theme.palette.primary.dark,
              }} noWrap>
                {m.code}
              </Typography>
              <Typography sx={{ fontSize: '0.66rem', color: 'text.disabled' }} noWrap>
                {m.name} · {m.revisions} rev{m.revisions === 1 ? '' : 's'}
              </Typography>
            </Box>
            <Typography sx={{
              fontSize: '0.78rem', fontWeight: 800, color,
              fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
            }}>
              {m.totalChangePercent > 0 ? '+' : ''}{m.totalChangePercent.toFixed(2)}%
            </Typography>
          </Stack>
        ))}
      </Stack>
    )}
  </Box>
);

export default PricingAnalytics;
