import React, { useState } from 'react';
import {
  Box, Typography, Button, Tooltip, CircularProgress, ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import { RefreshCw } from 'lucide-react';
import { useSnackbar } from 'notistack';
import { useSyncFmsTasksMutation } from '../../store/api/fmsDoerApi';
import { PFMS, pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx } from '../procurement/pfmsTheme';
import O2dDoerPlan from './O2dDoerPlan';
import PurchaseDoerPlan from './PurchaseDoerPlan';

// The FMS flows this page sets up — O2D first (the default).
const FMS_CHOICES = [
  { key: 'O2D', label: 'O2D FMS' },
  { key: 'PURCHASE', label: 'Purchase FMS' },
];

/**
 * FMS → Doer Assignment. Pick an FMS, then set every step up in one grid:
 * lead time, main doers and buddies (O2D adds its Mandatory switch). Both
 * grids work the same way — edit in place, Save / Undo, optionally carry the
 * change to work already pending.
 */
const DoerAssignmentPage = () => {
  const { enqueueSnackbar } = useSnackbar();
  const [fmsKey, setFmsKey] = useState('O2D');
  const isO2d = fmsKey === 'O2D';
  const [syncTasks, { isLoading: syncing }] = useSyncFmsTasksMutation();

  const onSync = async () => {
    try { await syncTasks().unwrap(); enqueueSnackbar('Pending items re-checked', { variant: 'success' }); }
    catch (err) { enqueueSnackbar(err?.data?.message || 'Sync failed', { variant: 'error' }); }
  };

  return (
    <Box sx={{ ...pfmsPageSx, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Box>
          <Typography sx={pfmsTitleSx}>FMS Doer Assignment</Typography>
          <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>
            {isO2d
              ? 'Lead time, main doer, buddy and mandatory for every O2D step'
              : 'Lead time, main doers and buddies for every Purchase step'}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          {!isO2d && (
            <Tooltip title="Re-check which items are waiting at each step">
              <span>
                <Button variant="outlined" startIcon={syncing ? <CircularProgress size={14} /> : <RefreshCw size={16} />} onClick={onSync} disabled={syncing}>
                  Sync
                </Button>
              </span>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Which FMS to set up — O2D by default. */}
      <ToggleButtonGroup exclusive size="small" value={fmsKey} onChange={(_e, v) => v && setFmsKey(v)} aria-label="FMS"
        sx={{ alignSelf: 'flex-start', bgcolor: PFMS.surface }}>
        {FMS_CHOICES.map((c) => (
          <ToggleButton key={c.key} value={c.key} sx={{ textTransform: 'none', fontWeight: 700, px: 2.25 }}>{c.label}</ToggleButton>
        ))}
      </ToggleButtonGroup>

      {isO2d ? <O2dDoerPlan /> : <PurchaseDoerPlan />}
    </Box>
  );
};

export default DoerAssignmentPage;
