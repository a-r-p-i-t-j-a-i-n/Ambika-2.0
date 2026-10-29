import React, { Suspense, useState } from 'react';
import { Box, Typography } from '@mui/material';
import StepQueueGrid from './StepQueueGrid';
import { pfmsPageSx, pfmsTitleSx, pfmsSubtitleSx } from '../pfmsTheme';

/**
 * The "Awaiting" view of a Purchase FMS step: title + StepQueueGrid + the
 * step's own create dialog for a queue row.
 *
 * `action` = { label, icon, Dialog, props(row) } — the step's existing create
 * dialog, opened from a row the server marked actionable, with that row's
 * record preset (e.g. FollowUpFormDrawer presetPo). Without `action` (or for a
 * row with no action) the row only opens its record.
 */
const StepQueuePanel = ({ queue, title, subtitle, total, action, gridProps }) => {
  const [activeRow, setActiveRow] = useState(null);
  const Dialog = action?.Dialog;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, ...pfmsPageSx }}>
      <Box>
        <Typography sx={pfmsTitleSx}>{title} ({total ?? 0})</Typography>
        <Typography sx={{ ...pfmsSubtitleSx, mt: 0.25 }}>{subtitle}</Typography>
      </Box>
      <StepQueueGrid
        queue={queue}
        {...gridProps}
        actionFor={(row) => (action && row.action ? { label: action.label, icon: action.icon, onClick: setActiveRow } : null)}
      />
      {Dialog && (
        <Suspense fallback={null}>
          <Dialog open={Boolean(activeRow)} onClose={() => setActiveRow(null)} {...(activeRow ? action.props(activeRow) : {})} />
        </Suspense>
      )}
    </Box>
  );
};

export default StepQueuePanel;
