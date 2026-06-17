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
 * Usage:
 *   const openFmsTask = useOpenFmsTask();
 *   await createOrder(...).unwrap();
 *   await openFmsTask({ soNumber });   // navigates if a task exists; no-op otherwise
 */
export function useOpenFmsTask() {
  const navigate = useNavigate();
  const [resolve] = useLazyGetActiveTaskQuery();

  return async ({ soNumber, salesOrderId, intakeId } = {}) => {
    try {
      const res = await resolve({ soNumber, salesOrderId, intakeId }).unwrap();
      const t = res?.data;
      if (t?.processId && t?.stepCode) {
        navigate(`/o2d-fms/task/${t.processId}/${encodeURIComponent(t.stepCode)}?entryDone=1`);
        return true;
      }
    } catch { /* FMS not enabled for this order — ignore */ }
    return false;
  };
}
