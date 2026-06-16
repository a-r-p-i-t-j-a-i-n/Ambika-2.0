import { useNavigate, useSearchParams } from 'react-router-dom';

/**
 * When a step-entry form is opened from an FMS task's "Do it now" link, the
 * task context arrives as ?fromTask=<processId>&fromStep=<stepCode>. After the
 * entry is saved, `returnToTask()` sends the doer back to that task with
 * ?entryDone=1, which auto-marks the checklist so they just review & submit.
 */
export function useReturnToTask() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const fromTask = sp.get('fromTask');
  const fromStep = sp.get('fromStep');
  const active = !!(fromTask && fromStep);
  const returnToTask = () => {
    if (active) navigate(`/o2d-fms/task/${fromTask}/${encodeURIComponent(fromStep)}?entryDone=1`);
  };
  return { active, returnToTask };
}
