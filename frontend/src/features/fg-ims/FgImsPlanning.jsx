import React, { useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Skeleton, alpha, Button,
} from '@mui/material';
import { Factory, Download } from 'lucide-react';
import { FgHero, StatusChip, num } from './fgImsMeta';
import { useGetFgReplenishQuery } from '../../store/api/fgImsApi';

// Production Plan — finished goods at/below reorder point with the quantity to
// produce to refill up to the target (max) level.
const FgImsPlanning = () => {
  const { data, isFetching } = useGetFgReplenishQuery({});
  const rows = useMemo(() => data?.data || [], [data]);
  const totalToProduce = rows.reduce((s, r) => s + Number(r.suggestedProduceQty || 0), 0);

  const exportCsv = () => {
    const header = ['SKU', 'Finished good', 'Category', 'In stock', 'In production', 'Booked', 'Available', 'Reorder pt', 'Target level', 'Days cover', 'Produce qty', 'Status'];
    const lines = rows.map((r) => [r.skuCode, r.skuName, r.category, r.onHand, r.inProduction, r.booked, r.projectedAvailable, r.reorderPoint, r.maxLevel, r.daysCover ?? '', r.suggestedProduceQty, r.status]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'fg-production-plan.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <FgHero icon={Factory} title="Production Plan" subtitle="Finished goods at or below their reorder point — with the quantity to produce to reach the target level."
        action={rows.length > 0 && (
          <Button variant="contained" color="inherit" startIcon={<Download size={16} />} onClick={exportCsv}
            sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: '#fff', '&:hover': { bgcolor: 'rgba(255,255,255,0.26)' } }}>
            Export CSV
          </Button>
        )} />

      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Typography sx={{ fontWeight: 800 }}>{rows.length} finished good(s) need production</Typography>
            <Typography variant="body2" color="text.secondary">Total to produce: <b>{num(totalToProduce)}</b> units</Typography>
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 1040 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha('#059669', 0.06) }}>
                  {['SKU', 'Finished good', 'In stock', 'In prod.', 'Booked', 'Available', 'Reorder pt', 'Target', 'Days cover', 'Produce qty', 'Status'].map((h, i) => (
                    <TableCell key={h} align={[2, 3, 4, 5, 6, 7, 8, 9].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {isFetching && rows.length === 0 && (
                  <TableRow><TableCell colSpan={11}><Skeleton variant="rounded" height={200} /></TableCell></TableRow>
                )}
                {!isFetching && rows.length === 0 && (
                  <TableRow><TableCell colSpan={11} sx={{ textAlign: 'center', py: 5, color: 'success.main', fontWeight: 700 }}>All good — nothing to produce right now. 🎉</TableCell></TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.skuId} hover>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: '#047857' }}>{r.skuCode}</TableCell>
                    <TableCell sx={{ maxWidth: 240 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={r.skuName}>{r.skuName}</Typography>
                      <Typography variant="caption" color="text.secondary">{r.category}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{num(r.onHand)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.inProduction ? num(r.inProduction) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.booked ? num(r.booked) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{num(r.projectedAvailable)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.reorderPoint)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.maxLevel)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.daysCover != null && r.daysCover < r.leadDays ? 'error.main' : 'text.primary', fontWeight: 600 }}>
                      {r.daysCover == null ? '—' : `${num(r.daysCover)}d`}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: '#047857' }}>{num(r.suggestedProduceQty)}</TableCell>
                    <TableCell><StatusChip status={r.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default FgImsPlanning;
