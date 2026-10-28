import React, { Suspense } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { PackageCheck } from 'lucide-react';
import { lazyWithRetry } from '../../../utils/lazyWithRetry';
import AppLoader from '../../../components/AppLoader';
import { useGetGrnStatsQuery, useGetStepQueueQuery } from '../../../store/api/procurementApi';
import StepQueuePanel from '../components/StepQueuePanel';
import { pfmsStepTabsSx, pfmsUnderStepTabsStyle } from '../pfmsTheme';

const GrnList = lazyWithRetry(() => import('./GrnList'));
const IncomingQCList = lazyWithRetry(() => import('../incoming-qc/IncomingQCList'));
const GrnFormDialog = lazyWithRetry(() => import('./GrnFormDialog'));

/**
 * Purchase FMS step "GRN & QC" — one step, because Incoming QC is entered on the
 * GRN page directly under the GRN. The QC records list stays one tab away for
 * historical QCs, draft QCs and internal-service QCs (which have no GRN).
 * `?view=qc` deep-links to that tab (the old /purchase-fms/incoming-qc lands here).
 *
 * The two "Awaiting" tabs list what is waiting to enter the step and has no
 * record here yet: POs ready for GRN (Create GRN opens the GRN form for that
 * PO) and received GRNs / service indents whose QC is pending (QC is entered on
 * their own page). With no GRN at all yet while POs are waiting, the step opens
 * on Awaiting GRN instead of an empty table.
 */
const VIEWS = ['grn', 'qc', 'awaiting-grn', 'awaiting-qc'];

const GrnQcStep = () => {
  const [params, setParams] = useSearchParams();
  const { data: grnStats } = useGetGrnStatsQuery();
  const { data: grnQueue } = useGetStepQueueQuery({ queue: 'GRN', limit: 1 });
  const { data: qcQueue } = useGetStepQueueQuery({ queue: 'INCOMING_QC', limit: 1 });
  const awaitingGrn = grnQueue?.data?.unfilteredTotal;
  const awaitingQc = qcQueue?.data?.unfilteredTotal;

  const requested = params.get('view');
  const view = VIEWS.includes(requested) ? requested
    : (grnStats?.data?.total === 0 && awaitingGrn > 0 ? 'awaiting-grn' : 'grn');
  // Always explicit — a bare URL may open on Awaiting GRN (see above).
  const setView = (_e, v) => setParams({ view: v }, { replace: true });
  const count = (n) => (n === undefined ? '' : ` (${n})`);

  return (
    <Box>
      <Box sx={{ px: { xs: 1.5, md: 3 } }}>
        <Tabs value={view} onChange={setView} variant="scrollable" allowScrollButtonsMobile sx={pfmsStepTabsSx}>
          <Tab value="grn" label="GRNs (with QC)" />
          <Tab value="qc" label="QC Records" />
          <Tab value="awaiting-grn" label={`Awaiting GRN${count(awaitingGrn)}`} data-testid="queue-tab-GRN" />
          <Tab value="awaiting-qc" label={`Awaiting QC${count(awaitingQc)}`} data-testid="queue-tab-INCOMING_QC" />
        </Tabs>
      </Box>
      <Box style={pfmsUnderStepTabsStyle}>
        {view === 'awaiting-grn' && (
          <StepQueuePanel queue="GRN" total={awaitingGrn}
            title="Awaiting GRN — Step 1.08"
            subtitle="Released POs whose material is ready for goods receipt (follow-up marked Ready for GRN, PI settled)"
            action={{ label: 'Create GRN', icon: <PackageCheck size={14} />, Dialog: GrnFormDialog, props: (r) => ({ presetPo: r.record }) }}
            gridProps={{ numberHeader: 'PO No', dateHeader: 'Ready On', showDue: true, amountHeader: 'PO Value', emptyText: 'No PO is ready for GRN' }} />
        )}
        {view === 'awaiting-qc' && (
          <StepQueuePanel queue="INCOMING_QC" total={awaitingQc}
            title="Awaiting QC — Step 1.09"
            subtitle="Received GRNs whose Incoming QC is pending, and internal-service indents waiting for their QC — open one to enter its QC"
            gridProps={{ numberHeader: 'GRN / Indent No', dateHeader: 'Received', showAmount: false, emptyText: 'Nothing is waiting for QC' }} />
        )}
        {(view === 'grn' || view === 'qc') && (
          <Suspense fallback={<AppLoader />}>
            {view === 'qc' ? <IncomingQCList /> : <GrnList />}
          </Suspense>
        )}
      </Box>
    </Box>
  );
};

export default GrnQcStep;
