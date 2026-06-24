import React, { useMemo } from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  Skeleton, alpha, useTheme, Button,
} from '@mui/material';
import { ShoppingCart, Download } from 'lucide-react';
import { ImsHero, StatusChip, num } from './imsMeta';
import { useGetImsReorderQuery } from '../../store/api/imsApi';

// Reorder list — items at/below reorder point with suggested order quantity.
const ImsReorder = () => {
  const theme = useTheme();
  const { data, isFetching } = useGetImsReorderQuery({});
  const rows = useMemo(() => data?.data || [], [data]);
  const totalSuggested = rows.reduce((s, r) => s + Number(r.suggestedOrderQty || 0), 0);

  const exportCsv = () => {
    const header = ['SKU', 'Item', 'Category', 'On hand', 'In transit', 'Reorder pt', 'Max level', 'Days cover', 'Suggested order', 'MOQ', 'Status'];
    const lines = rows.map((r) => [r.skuCode, r.skuName, r.category, r.onHand, r.inTransit, r.reorderPoint, r.maxLevel, r.daysCover ?? '', r.suggestedOrderQty, r.moq, r.status]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'ims-reorder-list.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <ImsHero icon={ShoppingCart} title="Reorder & Buying List" subtitle="Items at or below their reorder point — with the quantity to order up to max level."
        action={rows.length > 0 && (
          <Button variant="contained" color="inherit" startIcon={<Download size={16} />} onClick={exportCsv}
            sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: '#fff', '&:hover': { bgcolor: 'rgba(255,255,255,0.26)' } }}>
            Export CSV
          </Button>
        )} />

      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}`, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
            <Typography sx={{ fontWeight: 800 }}>{rows.length} item(s) need attention</Typography>
            <Typography variant="body2" color="text.secondary">Total suggested order: <b>{num(totalSuggested)}</b> units</Typography>
          </Box>
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 960 }}>
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                  {['SKU', 'Item', 'On hand', 'In transit', 'Reorder pt', 'Max', 'Days cover', 'Suggested order', 'Status'].map((h, i) => (
                    <TableCell key={h} align={[2, 3, 4, 5, 6, 7].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {isFetching && rows.length === 0 && (
                  <TableRow><TableCell colSpan={9}><Skeleton variant="rounded" height={200} /></TableCell></TableRow>
                )}
                {!isFetching && rows.length === 0 && (
                  <TableRow><TableCell colSpan={9} sx={{ textAlign: 'center', py: 5, color: 'success.main', fontWeight: 700 }}>All good — nothing to reorder right now. 🎉</TableCell></TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.skuId} hover>
                    <TableCell sx={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, color: theme.palette.primary.dark }}>{r.skuCode}</TableCell>
                    <TableCell sx={{ maxWidth: 240 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={r.skuName}>{r.skuName}</Typography>
                      <Typography variant="caption" color="text.secondary">{r.category}</Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{num(r.onHand)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.inTransit ? num(r.inTransit) : '—'}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.reorderPoint)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{num(r.maxLevel)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: r.daysCover != null && r.daysCover < r.leadDays ? 'error.main' : 'text.primary', fontWeight: 600 }}>
                      {r.daysCover == null ? '—' : `${num(r.daysCover)}d`}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: theme.palette.primary.main }}>{num(r.suggestedOrderQty)}</TableCell>
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

export default ImsReorder;
