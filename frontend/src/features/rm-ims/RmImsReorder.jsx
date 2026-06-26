import React, { useMemo, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Table, TableHead, TableBody, TableRow, TableCell,
  ToggleButton, ToggleButtonGroup, Chip, Skeleton, alpha, useTheme,
} from '@mui/material';
import { ShoppingCart } from 'lucide-react';
import { ImsHero, StatusChip, num, inr } from '../ims/imsMeta';
import { useGetRmReorderQuery } from '../../store/api/rmImsApi';

const RmImsReorder = () => {
  const theme = useTheme();
  const [kind, setKind] = useState('ALL');
  const params = useMemo(() => (kind === 'ALL' ? {} : { kind }), [kind]);
  const { data, isFetching } = useGetRmReorderQuery(params);
  const rows = data?.data || [];
  const totalBuy = rows.reduce((s, r) => s + Number(r.buyCost || 0), 0);

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <ImsHero icon={ShoppingCart} title="RM Reorder & Buying List" subtitle="Coils & circles at or below reorder level, with suggested order quantity & cost." />
      <Box sx={{ px: { xs: 2, md: 4 }, mt: { xs: -3, md: -4 }, position: 'relative', pb: 6 }}>
        <Paper elevation={0} sx={{ p: 1.5, borderRadius: '14px', border: '1px solid', borderColor: 'divider', mb: 2 }}>
          <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap>
            <ToggleButtonGroup size="small" exclusive value={kind} onChange={(_, v) => v && setKind(v)}>
              <ToggleButton value="ALL" sx={{ textTransform: 'none', px: 2 }}>All</ToggleButton>
              <ToggleButton value="COIL" sx={{ textTransform: 'none', px: 2 }}>Coils</ToggleButton>
              <ToggleButton value="CIRCLE" sx={{ textTransform: 'none', px: 2 }}>Circles</ToggleButton>
            </ToggleButtonGroup>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip label={`${rows.length} to buy`} sx={{ fontWeight: 700 }} />
              <Chip color="primary" label={`Est. spend ${inr(totalBuy)}`} sx={{ fontWeight: 800 }} />
            </Stack>
          </Stack>
        </Paper>

        <Paper elevation={0} sx={{ borderRadius: '14px', border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
          <Box sx={{ overflowX: 'auto' }}>
            {isFetching ? <Skeleton variant="rounded" height={320} /> : (
              <Table size="small" sx={{ minWidth: 980 }}>
                <TableHead>
                  <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
                    {['SKU', 'Kind', 'On hand', 'Cover', 'Max', 'Order qty', 'Rate', 'Buy cost', 'Vendor', 'Status'].map((h, i) => (
                      <TableCell key={h} align={[2, 3, 4, 5, 6, 7].includes(i) ? 'right' : 'left'} sx={{ fontWeight: 800, fontSize: '0.68rem', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={10} sx={{ textAlign: 'center', py: 4, color: 'success.main', fontWeight: 700 }}>Nothing to reorder. 🎉</TableCell></TableRow>
                  )}
                  {rows.map((r) => (
                    <TableRow key={r.skuId} hover>
                      <TableCell sx={{ maxWidth: 240 }}>
                        <Typography variant="body2" fontWeight={700} noWrap>{r.skuName}</Typography>
                        <Typography variant="caption" color="text.secondary">{r.skuCode}</Typography>
                      </TableCell>
                      <TableCell><Chip size="small" variant="outlined" label={r.kind} sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700 }} /></TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>{num(r.onHand)}</TableCell>
                      <TableCell align="right">{r.daysCover == null ? '—' : `${num(r.daysCover)}d`}</TableCell>
                      <TableCell align="right">{num(r.maxLevel)}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 800, color: 'primary.main' }}>{num(r.suggestedOrderQty)}</TableCell>
                      <TableCell align="right">{r.rate ? inr(r.rate) : '—'}</TableCell>
                      <TableCell align="right">{r.buyCost ? inr(r.buyCost) : '—'}</TableCell>
                      <TableCell><Typography variant="caption" noWrap>{r.vendorName || '—'}</Typography></TableCell>
                      <TableCell><StatusChip status={r.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default RmImsReorder;
