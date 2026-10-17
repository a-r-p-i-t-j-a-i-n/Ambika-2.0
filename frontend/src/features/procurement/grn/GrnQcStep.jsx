import React, { Suspense } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { lazyWithRetry } from '../../../utils/lazyWithRetry';
import AppLoader from '../../../components/AppLoader';

const GrnList = lazyWithRetry(() => import('./GrnList'));
const IncomingQCList = lazyWithRetry(() => import('../incoming-qc/IncomingQCList'));

/**
 * Purchase FMS step "GRN & QC" — one step, because Incoming QC is entered on the
 * GRN page directly under the GRN. The QC records list stays one tab away for
 * historical QCs, draft QCs and internal-service QCs (which have no GRN).
 * `?view=qc` deep-links to that tab (the old /purchase-fms/incoming-qc lands here).
 */
const GrnQcStep = () => {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'qc' ? 'qc' : 'grn';
  const setView = (_e, v) => setParams(v === 'qc' ? { view: 'qc' } : {}, { replace: true });

  return (
    <Box>
      <Box sx={{ px: { xs: 1.5, md: 3 } }}>
        <Tabs value={view} onChange={setView} sx={{ minHeight: 40, '& .MuiTab-root': { minHeight: 40, fontWeight: 700, textTransform: 'none' } }}>
          <Tab value="grn" label="GRNs (with QC)" />
          <Tab value="qc" label="QC Records" />
        </Tabs>
      </Box>
      <Suspense fallback={<AppLoader />}>
        {view === 'qc' ? <IncomingQCList /> : <GrnList />}
      </Suspense>
    </Box>
  );
};

export default GrnQcStep;
