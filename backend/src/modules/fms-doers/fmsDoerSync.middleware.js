import { fmsDoerService } from './fmsDoer.service.js';

// Write endpoints that never move a workflow item (pure previews).
const NON_WORKFLOW = /\/(preview-pdf|release-preview)\/?$/;

/**
 * Mounted in front of the Purchase FMS (and approval) routers. After a
 * successful state-changing request finishes, it queues a task reconcile so
 * items that just reached a step get their doer and items that moved on are
 * resolved — with the authenticated caller recorded as the actual performer.
 * Runs after the response is sent, never alters the request or the existing
 * workflow, and never fails it.
 */
export const fmsWorkflowSync = (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || NON_WORKFLOW.test(req.path)) return next();
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.user) return;
    fmsDoerService.enqueueSync({
      actor: { _id: req.user._id, name: req.user.name || '' },
      notify: true,
      openedVia: 'WORKFLOW',
    });
  });
  next();
};

export default fmsWorkflowSync;
