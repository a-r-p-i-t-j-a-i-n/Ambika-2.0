import { useNavigate } from 'react-router-dom';
import { useLazyGetActiveTaskQuery } from '../../store/api/o2dFmsApi';

/**
 * useOpenFmsTask
 * --------------
 * After a doer makes an entry directly in a module (sales order, dispatch plan,
 * challan, …), call the returned function to jump straight to that order's
 * ACTIVE FMS task with ?entryDone=1 — which auto-ticks the step's checklist so
 * the doer only reviews proof/comments and submits. This is what makes a
 * module-first entry show up in the FMS tracker as "done by X at <time>".
 *
 * Pass `action` (an action-link/trigger key like ACTUAL_DISPATCH) to land on the
 * step that OWNS that action — not merely the order's current step — and to mark
 * that connected action done on arrival (so it shows View / Do again).
 *
 * Usage:
 *   const openFmsTask = useOpenFmsTask();
 *   await createDispatch(...).unwrap();
 *   await openFmsTask({ soNumber, action: 'ACTUAL_DISPATCH' });
 */
export function useOpenFmsTask() {
  const navigate = useNavigate();
  const [resolve] = useLazyGetActiveTaskQuery();

  return async ({ soNumber, salesOrderId, intakeId, action } = {}) => {
    try {
      const res = await resolve({ soNumber, salesOrderId, intakeId, action }).unwrap();
      const t = res?.data;
      if (t?.processId && t?.stepCode) {
        const q = new URLSearchParams({ entryDone: '1' });
        if (action) q.set('doneAction', action);
        navigate(`/o2d-fms/task/${t.processId}/${encodeURIComponent(t.stepCode)}?${q.toString()}`);
        return true;
      }
    } catch { /* FMS not enabled for this order — ignore */ }
    return false;
  };
}
