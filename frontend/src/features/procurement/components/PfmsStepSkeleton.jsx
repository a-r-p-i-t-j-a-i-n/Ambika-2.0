import React from 'react';
import { Box, Skeleton } from '@mui/material';
import { CardStripSkeleton, TableSkeleton } from '../../o2d-fms/components/O2dUi';
import { pfmsPageSx } from '../pfmsTheme';

/**
 * Purchase FMS step placeholder (Vuetify v-skeleton-loader style) — shown while
 * a step's screen is loading, in the step's own layout: title + subtitle, the
 * KPI card strip, the filter bar and the table. The page keeps its shape and
 * nothing from the previous step stays on screen.
 */
const SK = { bgcolor: 'rgba(15, 23, 42, 0.07)' };
const PfmsStepSkeleton = ({ cards = 5 }) => (
  <Box role="progressbar" aria-label="Loading step" aria-busy="true" data-skeleton="pfms-step"
    sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, ...pfmsPageSx }}>
    <Box>
      <Skeleton animation="wave" variant="text" width={220} height={28} sx={SK} />
      <Skeleton animation="wave" variant="text" width={360} height={16} sx={{ ...SK, maxWidth: '80%' }} />
    </Box>
    <CardStripSkeleton count={cards} sx={{ px: 0 }} />
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', p: 1, borderRadius: '8px', border: '1px solid #e7ebf1', bgcolor: '#fff' }}>
      {[260, 160, 160, 140, 140].map((w, i) => (
        <Skeleton key={i} animation="wave" variant="rounded" height={40} sx={{ ...SK, flex: `1 1 ${w}px`, borderRadius: '8px' }} />
      ))}
    </Box>
    <Box sx={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #e7ebf1' }}>
      <TableSkeleton rows={8} columns={7} rowHeight={50} />
    </Box>
  </Box>
);

export default PfmsStepSkeleton;
