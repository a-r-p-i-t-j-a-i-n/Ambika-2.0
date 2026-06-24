import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, IconButton, Chip, Table, TableHead, TableBody, TableRow,
  TableCell, Skeleton, alpha, useTheme, TablePagination, Divider, ToggleButtonGroup, ToggleButton, Tooltip,
} from '@mui/material';
import {
  ArrowLeft, Pencil, ArrowDownLeft, ArrowUpRight, Boxes, PackageOpen, AlertTriangle, ShoppingCart, Clock,
} from 'lucide-react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, ReferenceLine, CartesianGrid } from 'recharts';
import dayjs from 'dayjs';
import { useParams, useNavigate } from 'react-router-dom';
import { StatusChip, num, inr } from './imsMeta';
import { useGetImsForecastQuery, useGetImsMovementsQuery } from '../../store/api/imsApi';
import PolicyDrawer from './PolicyDrawer';

const TXN_LABEL = {
  GRN_IN: 'GRN receipt', OPENING: 'Opening', ADJUST_IN: 'Stock-in', ADJUST_OUT: 'Adjust out',
  CONSUME_OUT: 'Production issue', QC_REJECT_OUT: 'QC reject', RETURN_OUT: 'Return',
  TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out', DISPATCH_OUT: 'Dispatch',
};

const Metric = ({ label, value, color }) => (
  <Box sx={{ px: 1.5, py: 1, borderRadius: 2, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', minWidth: 110 }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{label}</Typography>
    <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: color || 'text.primary' }}>{value}</Typography>
  </Box>
);

const ImsItemDetail = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { skuId } = useParams();
  const [days, setDays] = useState(30);
  const [editSku, setEditSku] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const { data: fcRes, isFetching: fcLoading } = useGetImsForecastQuery({ skuId, days });
  const { data: mvRes, isFetching: mvLoading } = useGetImsMovementsQuery({ skuId, sort: '-movementDate', limit: 500 });

  const fc = fcRes?.data;
  const sku = fc?.sku;
  const m = fc?.metrics || {};
  const movements = useMemo(() => mvRes?.data || [], [mvRes]);
  const paged = useMemo(() => movements.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage), [movements, page, rowsPerPage]);
  const series = (fc?.series || []).map((p) => ({ ...p, label: dayjs(p.date).format('DD MMM') }));

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Header */}
      <Box sx={{ color: '#fff', px: { xs: 2, md: 4 }, pt: 3, pb: 5,
        background: 'linear-gradient(135deg, #0b2545 0%, #1e3a8a 55%, #1d4ed8 100%)' }}>
        <Button startIcon={<ArrowLeft size={16} />} onClick={() => navigate('/ims/stock')}
          sx={{ color: 'rgba(255,255,255,0.9)', mb: 1.5 }}>Back to Stock</Button>
        {fcLoading && !sku ? <Skeleton variant="text" width={280} sx={{ bgcolor: 'rgba(255,255,255,0.2)' }} /> : (
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" useFlexGap>
            <Stack direction="row" spacing={2} alignItems="center">
              <Box sx={{ width: 48, height: 48, borderRadius: 2.5, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.14)' }}>
                <Boxes size={24} color="#fff" />
              </Box>
              <Box>
                <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.3rem', md: '1.7rem' }, lineHeight: 1.1 }}>{sku?.skuName}</Typography>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                  <Typography sx={{ fontFamily: 'ui-monospace, monospace', color: 'rgba(255,255,255,0.85)' }}>{sku?.skuCode}</Typography>
                  {sku?.category && <Chip size="small" label={sku.category} sx={{ height: 20, bgcolor: 'rgba(255,255,255,0.16)', color: '#fff' }} />}
                  <StatusChip status={m.status} />
                </Stack>
              </Box>
            </Stack>
            <Button variant="contained" startIcon={<Pencil size={15} />} onClick={() => setEditSku(skuId)}
              sx={{ bgcolor: 'rgba(255,255,255,0.18)', '&:hover': { bgcolor: 'rgba(255,255,255,0.28)' } }}>
              Edit policy
            </Button>
          </Stack>
        )}
      </Box>

      <Box sx={{ px: { xs: 2, md: 4 }, mt: -3, position: 'relative', pb: 6 }}>
        {/* Metrics */}
        <Paper sx={{ p: 2, borderRadius: 3, mb: 2 }}>
          <Stack direction="row" spacing={1.25} flexWrap="wrap" useFlexGap>
            <Metric label="On hand" value={num(m.onHand)} color={theme.palette.primary.main} />
            <Metric label="In transit" value={num(m.inTransit)} />
            <Metric label="ADC / day" value={num(m.adc)} />
            <Metric label="Lead (days)" value={num(m.leadDays)} />
            <Metric label="Safety factor" value={num(m.safetyFactor)} />
            <Metric label="Reorder pt" value={num(m.reorderPoint)} />
            <Metric label="Max level" value={num(m.maxLevel)} />
            <Metric label="Days cover" value={m.daysCover == null ? '—' : `${num(m.daysCover)}d`} color={m.daysCover != null && m.daysCover < m.leadDays ? theme.palette.error.main : undefined} />
            <Metric label="Suggested order" value={num(m.suggestedOrderQty)} color={theme.palette.warning.dark} />
            <Metric label="Stock value" value={inr(m.stockValue)} />
          </Stack>
        </Paper>

        {/* Projection */}
        <Paper sx={{ p: 2.5, borderRadius: 3, mb: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
            <Typography sx={{ fontWeight: 800 }}>Stock projection</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" color={fc?.reorderDay != null ? 'warning' : 'default'}
                label={fc?.reorderDay != null ? `Reorder in ~${fc.reorderDay}d` : 'No reorder in window'} />
              <Chip size="small" color={fc?.stockoutDay != null ? 'error' : 'success'}
                label={fc?.stockoutDay != null ? `Stock-out in ~${fc.stockoutDay}d` : 'No stock-out in window'} />
              <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)}>
                {[15, 30, 60, 90].map((d) => <ToggleButton key={d} value={d}>{d}d</ToggleButton>)}
              </ToggleButtonGroup>
            </Stack>
          </Stack>
          {fcLoading ? <Skeleton variant="rounded" height={260} /> : (
            <Box sx={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <RTooltip />
                  <ReferenceLine y={m.reorderPoint} stroke={theme.palette.warning.main} strokeDasharray="4 4" label={{ value: 'Reorder', fontSize: 10, fill: theme.palette.warning.main }} />
                  <ReferenceLine y={m.maxLevel} stroke={theme.palette.success.main} strokeDasharray="4 4" label={{ value: 'Max', fontSize: 10, fill: theme.palette.success.main }} />
                  <Line type="monotone" dataKey="projected" stroke={theme.palette.primary.main} strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          )}
        </Paper>

        {/* Full IN/OUT history */}
        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}`, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Clock size={18} color={theme.palette.primary.main} />
            <Typography sx={{ fontWeight: 800 }}>In / Out history</Typography>
            <Chip size="small" label={`${movements.length} movements`} sx={{ ml: 1 }} />
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 980 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  {['Date', 'Recorded at', 'Type', 'Qty', 'Balance', 'By', 'Source / Ref', 'Details'].map((h, i) => (
                    <TableCell key={h} align={[3, 4].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {mvLoading && movements.length === 0 && (
                  <TableRow><TableCell colSpan={8}><Skeleton variant="rounded" height={200} /></TableCell></TableRow>
                )}
                {!mvLoading && movements.length === 0 && (
                  <TableRow><TableCell colSpan={8} sx={{ textAlign: 'center', py: 5, color: 'text.disabled' }}>No movements recorded for this item yet.</TableCell></TableRow>
                )}
                {paged.map((mv) => {
                  const isIn = mv.movementType === 'IN';
                  const ref = [mv.refNumber, mv.poNumber, mv.vendorName].filter(Boolean).join(' · ');
                  return (
                    <TableRow key={mv._id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{dayjs(mv.movementDate).format('DD MMM YYYY')}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Typography variant="caption" color="text.secondary">{dayjs(mv.createdAt || mv.movementDate).format('DD MMM, HH:mm')}</Typography>
                        <Typography variant="caption" sx={{ display: 'block', fontFamily: 'ui-monospace, monospace', opacity: 0.7 }}>{mv.movementNumber}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" icon={isIn ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
                          label={TXN_LABEL[mv.txnType] || mv.txnType}
                          sx={{ height: 22, fontWeight: 700, bgcolor: alpha(isIn ? theme.palette.success.main : theme.palette.error.main, 0.12), color: isIn ? theme.palette.success.dark : theme.palette.error.dark }} />
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: isIn ? 'success.main' : 'error.main' }}>
                        {isIn ? '+' : '−'}{num(mv.quantity)}
                      </TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{num(mv.balanceAfter)}</TableCell>
                      <TableCell><Typography variant="caption">{mv.performedByName || '—'}</Typography></TableCell>
                      <TableCell sx={{ maxWidth: 180 }}>
                        <Typography variant="caption" sx={{ fontWeight: 600 }}>{mv.sourceModule || '—'}</Typography>
                        {ref && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap title={ref}>{ref}</Typography>}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 260 }}><Typography variant="caption" color="text.secondary" noWrap title={mv.remarks}>{mv.remarks || '—'}</Typography></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
          <TablePagination
            component="div"
            count={movements.length}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50, 100]}
            labelRowsPerPage="Rows:"
          />
        </Paper>
      </Box>

      <PolicyDrawer skuId={editSku} onClose={() => setEditSku(null)} />
    </Box>
  );
};

export default ImsItemDetail;
