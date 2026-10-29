import React, { Suspense } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import AppLoader from '../../../components/AppLoader';
import { useGetStepQueueQuery } from '../../../store/api/procurementApi';
import StepQueuePanel from './StepQueuePanel';
import { pfmsStepTabsSx, pfmsUnderStepTabsStyle } from '../pfmsTheme';

/**
 * A Purchase FMS step screen with its "Awaiting" tab: the step's own records
 * list (unchanged) plus the upstream records waiting to enter the step
 * (StepQueuePanel). `?view=awaiting` opens the queue; without it the step
 * opens on its own records — unless it has none yet while records are
 * waiting, so a fresh step never opens on an empty table. It switches back by
 * itself once the first record exists.
 */
const AWAITING_VIEW = 'awaiting';

const StepWithQueue = (props) => {
  const { List, queue, listLabel, queueLabel, ownTotal, ...panel } = props;
  const [params, setParams] = useSearchParams();
  const { data: summary } = useGetStepQueueQuery({ queue, limit: 1 });
  const waiting = summary?.data?.unfilteredTotal;

  const explicit = params.get('view');
  const view = explicit === AWAITING_VIEW || (!explicit && ownTotal === 0 && waiting > 0) ? AWAITING_VIEW : 'records';
  const setView = (_e, v) => setParams({ view: v }, { replace: true });

  return (
    <Box>
      <Box sx={{ px: { xs: 1.5, md: 3 } }}>
        <Tabs value={view} onChange={setView} variant="scrollable" allowScrollButtonsMobile sx={pfmsStepTabsSx}>
          <Tab value="records" label={listLabel} />
          <Tab value={AWAITING_VIEW} label={`${queueLabel}${waiting === undefined ? '' : ` (${waiting})`}`} data-testid={`queue-tab-${queue}`} />
        </Tabs>
      </Box>
      <Box style={pfmsUnderStepTabsStyle}>
        {view === AWAITING_VIEW
          ? <StepQueuePanel queue={queue} total={waiting} {...panel} />
          : <Suspense fallback={<AppLoader />}><List /></Suspense>}
      </Box>
    </Box>
  );
};

export default StepWithQueue;
