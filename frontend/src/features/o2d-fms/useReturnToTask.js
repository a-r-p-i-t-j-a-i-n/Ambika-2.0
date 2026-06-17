import { useNavigate, useSearchParams } from 'react-router-dom';
import { useOpenFmsTask } from './useOpenFmsTask';

/**
 * Bridges a step-entry form back to its FMS task so the checklist gets completed.
 *
 * Two cases, one API:
 *  - FMS-first: the form was opened from a task's "Do it now" link, so the task
 *    context arrives as ?fromTask=<processId>&fromStep=<stepCode>. We return
 *    straight to that exact step.
 *  - Module-first: the doer filled the form directly (sidebar / deep link). We
 *    resolve the order's ACTIVE task from its soNumber and open that.
 *
 * Either way the task opens with ?entryDone=1, which auto-ticks the checklist so
 * the doer only reviews proof/comments and submits → the entry shows in the
 * tracker as done-by-them.
 *
 * Usage after a successful save:
 *   const { finishToTask } = useReturnToTask();
 *   await finishToTask({ soNumber });   // returns true if it navigated
 */
export function useReturnToTask() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const openFmsTask = useOpenFmsTask();
  const fromTask = sp.get('fromTask');
  const fromStep = sp.get('fromStep');
  const active = !!(fromTask && fromStep);

  const returnToTask = () => {
    if (active) navigate(`/o2d-fms/task/${fromTask}/${encodeURIComponent(fromStep)}?entryDone=1`);
  };

  const finishToTask = async (ctx = {}) => {
    if (active) { returnToTask(); return true; }
    return openFmsTask(ctx); // module-first → resolve & open the order's active task
  };

  return { active, returnToTask, finishToTask };
}
