import { fmsDoerService } from '../modules/fms-doers/fmsDoer.service.js';
import { logger } from '../utils/logger.js';

const INTERVAL_MS = Number(process.env.FMS_DOER_SYNC_INTERVAL_MS) || 10 * 60 * 1000;

/**
 * FMS doer task reconcile.
 *  - On startup: backfills tasks for items already waiting at a step (no
 *    workflow document is modified; nothing is notified — avoids a burst of
 *    alerts for old work).
 *  - Every INTERVAL_MS: catches changes made outside the API (scripts, imports)
 *    and notifies doers of newly opened tasks.
 * Request-driven syncs (fmsWorkflowSync middleware) handle the normal case.
 */
export const startFmsDoerSyncJob = () => {
  fmsDoerService.enqueueSync({ notify: false, openedVia: 'SYNC' })
    .then(() => logger.info('[fms-doers] startup task sync complete'));
  const timer = setInterval(() => {
    fmsDoerService.enqueueSync({ notify: true, openedVia: 'SYNC' });
  }, INTERVAL_MS);
  timer.unref?.();
  return timer;
};

export default startFmsDoerSyncJob;
