/**
 * Purchase FMS doer plan — the O2D-style setup of a step: lead time, main
 * doers and buddies. Pure helpers (no models, no DB) shared by the service
 * and its tests.
 *
 * Legacy rows/tasks have only the single `doerUserId` / `assignedDoerId`;
 * every reader goes through stepPlanOf / taskDoerIds so they keep working.
 */

const HOUR_MS = 60 * 60 * 1000;
const UNIT_MS = { HOURS: HOUR_MS, DAYS: 24 * HOUR_MS };

const str = (v) => String(v ?? '');
export const uniqIds = (list) => [...new Set((list || []).filter(Boolean).map(str))];
export const sameIds = (a, b) => {
  const x = uniqIds(a).sort();
  const y = uniqIds(b).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** { value, unit } → milliseconds, or null when there is no usable lead time. */
export const leadTimeMs = (lt) => {
  const n = Number(lt?.value);
  if (!lt || !Number.isFinite(n) || n <= 0 || !UNIT_MS[lt.unit]) return null;
  return n * UNIT_MS[lt.unit];
};

/** Due date of a task: when the item reached the step + the step's lead time. */
export const plannedAtFor = (openedAt, lt) => {
  const ms = leadTimeMs(lt);
  const t = new Date(openedAt).getTime();
  return ms == null || Number.isNaN(t) ? null : new Date(t + ms);
};

export const isTaskOverdue = (task, now = Date.now()) => task?.status === 'OPEN'
  && !!task.plannedAt && new Date(task.plannedAt).getTime() < new Date(now).getTime();

/** A step's saved setup (FmsDoerAssignment row, legacy-safe). */
export const stepPlanOf = (row) => {
  const doerIds = uniqIds(row?.doerUserIds?.length ? row.doerUserIds : [row?.doerUserId]);
  return {
    doerIds,
    buddyIds: uniqIds(row?.backupUserIds).filter((id) => !doerIds.includes(id)),
    leadTime: leadTimeMs(row?.leadTime) == null ? null : { value: Number(row.leadTime.value), unit: row.leadTime.unit },
  };
};

/** Main doers of a task (legacy tasks: just assignedDoerId). Works on raw ids or populated users. */
export const taskDoerIds = (task) => uniqIds(
  (task?.assignedDoerIds?.length ? task.assignedDoerIds : [task?.assignedDoerId]).map((u) => u?._id || u),
);
export const taskBuddyIds = (task) => uniqIds((task?.buddyIds || []).map((u) => u?._id || u));

/**
 * Check one row of a plan save → { doerIds, buddyIds, leadTime?, error }.
 * `leadTime` is copied only when the row carries it (undefined = unchanged,
 * null = no lead time).
 */
export const normalizePlanRow = (row) => {
  const doerIds = uniqIds(row?.doerIds);
  const buddyIds = uniqIds(row?.buddyIds);
  const out = { stepKey: str(row?.stepKey).toUpperCase(), doerIds, buddyIds, error: '' };
  if (doerIds.some((id) => buddyIds.includes(id))) out.error = 'the same person cannot be both a main doer and a buddy';
  if (row && 'leadTime' in row && row.leadTime !== undefined) {
    if (row.leadTime === null) out.leadTime = null;
    else if (leadTimeMs(row.leadTime) == null) out.error = out.error || 'lead time must be more than 0 hours or days';
    else out.leadTime = { value: Number(row.leadTime.value), unit: row.leadTime.unit };
  }
  return out;
};

const fmtLead = (lt) => (lt ? `${lt.value} ${lt.unit === 'DAYS' ? 'day' : 'hour'}${Number(lt.value) === 1 ? '' : 's'}` : 'none');

/** One-line history text for a step's new setup. */
export const describePlan = ({ doers = [], buddies = [], leadTime = null }) => [
  `Main doers: ${doers.length ? doers.join(', ') : 'none'}`,
  `Buddies: ${buddies.length ? buddies.join(', ') : 'none'}`,
  `Lead time: ${fmtLead(leadTime)}`,
].join(' · ');
