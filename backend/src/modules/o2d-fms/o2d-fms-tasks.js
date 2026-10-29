/**
 * FMS → My FMS Tasks, O2D side.
 *
 * Every O2D step waiting on someone — per order up to dispatch, then per
 * delivery challan — plus the ones finished in the last 30 days, as task rows:
 * who has it, by when, and the buttons that do the work (the same screens as
 * the Step Board). Worked out from the live O2D data with the Step Board's and
 * the old Delegation sync's rules (o2d-delegation.js); nothing is stored, so a
 * row can never disagree with its order. A row leaves "open" by itself once
 * the work is done on its screen.
 *
 * Built once for everybody (cached briefly, cleared on any O2D change), then
 * filtered per person.
 */
import User from '../auth/auth.model.js';
import { O2DProcess, TaskTemplate } from './o2d-fms.model.js';
import { loadDefMap, stepBuddyIds, stepDoerIds } from './o2d-fms.service.js';
import {
  DONE, DUE_STEP_FIELDS, FINISHED, actionsFor, addMinutes, challansBySo, dcStepState,
  isDispatchStep, keyOf, orderedSteps, stepPathFor,
} from './o2d-delegation.js';
import { o2dEvents } from './o2d-events.js';

const HISTORY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 20000;
const ACTIVE_FMS_KEY = process.env.O2D_ACTIVE_FMS || 'CURRENT_SHEET';

// Who last gave each step its doers, from the order's history: a reassign on
// the order or "Update running orders" carries the person; the automatic "set
// from Doer Assignment as the step came due" carries none (null).
// Descriptions start with the step code(s): "2.07 reassigned (…)",
// "2.04, 2.05 — doers updated from Doer Assignment".
const assignersOf = (timeline) => {
  const byStep = new Map();
  (timeline || []).forEach((entry) => {
    if (entry?.action !== 'STEP_REASSIGNED') return;
    const codes = /^\s*(\d+(?:\.\d+)*(?:\s*,\s*\d+(?:\.\d+)*)*)/.exec(entry.description || '')?.[1];
    if (!codes) return;
    codes.split(',').map((c) => c.trim()).forEach((code) => byStep.set(code, entry.actorId ? String(entry.actorId) : null));
  });
  return byStep;
};

const build = async () => {
  const since = new Date(Date.now() - HISTORY_DAYS * DAY_MS);
  const [defMap, processes, plan] = await Promise.all([
    loadDefMap(),
    O2DProcess.find({
      isDeleted: { $ne: true },
      $or: [{ isCompleted: { $ne: true } }, { completedAt: { $gte: since } }],
    })
      .select(`salesOrderId soNumber poNumber partyName isCompleted ${DUE_STEP_FIELDS} steps.actual steps.completedBy `
        + 'activityTimeline.action activityTimeline.description activityTimeline.actorId')
      .lean(),
    TaskTemplate.findOne({ isDefault: true, isActive: true, isDeleted: { $ne: true }, fmsKey: ACTIVE_FMS_KEY })
      .select('updatedBy createdBy').lean(),
  ]);
  const dcsBySo = await challansBySo([...new Set(processes.map((p) => p.soNumber).filter(Boolean))]);
  // Who saved Doer Assignment — the "assigned by" of a step nobody reassigned.
  const planBy = plan?.updatedBy || plan?.createdBy || null;

  const rows = [];
  for (const p of processes) {
    const steps = orderedSteps(p, defMap);
    const forkIdx = steps.findIndex(({ s, def }) => isDispatchStep(s, def));
    const assigners = assignersOf(p.activityTimeline);
    const row = (s, def, index, dc, extra) => {
      const doerIds = stepDoerIds(s);
      const assignedBy = assigners.has(s.stepCode) ? assigners.get(s.stepCode) : null;
      return {
        key: keyOf(p._id, s.stepCode, dc?.dcId),
        processId: String(p._id),
        soNumber: p.soNumber || null,
        poNumber: p.poNumber || null,
        partyName: p.partyName || null,
        dcNumber: dc?.dcNumber || null,
        stepCode: s.stepCode,
        stepName: def?.name || s.taskTitle || s.stepCode,
        stepNo: index + 1,
        stepTotal: steps.length,
        doerIds,
        buddyIds: stepBuddyIds(s).filter((id) => !doerIds.includes(id)),
        assignedById: assignedBy || (planBy ? String(planBy) : null),
        // Order-level step being worked on; a challan's step is just waiting.
        inProgress: !dc && s.status === 'IN_PROGRESS',
        actions: actionsFor(p, s, def, dc),
        stepPath: stepPathFor(p, s, dc),
        ...extra,
      };
    };
    const inHistory = (at) => Boolean(at) && new Date(at) >= since;

    // Order-level steps — up to and including the dispatch step.
    steps.forEach(({ s, def }, i) => {
      if (forkIdx !== -1 && i > forkIdx) return;
      if (s.startedAt && !FINISHED.includes(s.status)) {
        rows.push(row(s, def, i, null, { state: 'open', openedAt: s.startedAt, plannedAt: s.planned || null }));
      } else if (DONE.includes(s.status) && inHistory(s.actual)) {
        rows.push(row(s, def, i, null, {
          state: 'done', openedAt: s.startedAt || null, plannedAt: s.planned || null,
          doneAt: s.actual, doneById: s.completedBy ? String(s.completedBy) : null,
        }));
      }
    });
    if (forkIdx === -1) continue;

    // After dispatch: each live challan walks the remaining steps one by one —
    // exactly as o2d-delegation's collectDue decides what is due.
    const after = steps.map((x, i) => ({ ...x, i })).slice(forkIdx + 1);
    for (const dc of dcsBySo.get(p.soNumber) || []) {
      if (dc.cancelled) continue;
      let prevAt = dc.dcDate || null;
      for (const { s, def, i } of after) {
        const lead = s.leadTimeMins ?? def?.slaMinutes ?? 60;
        const plannedAt = prevAt ? addMinutes(prevAt, lead) : (s.planned || null);
        const st = dcStepState(dc, s.stepCode, def);
        const done = () => {
          if (inHistory(st.at)) {
            rows.push(row(s, def, i, dc, { state: 'done', openedAt: prevAt, plannedAt, doneAt: st.at, doneByName: st.byName || null }));
          }
        };
        // Skipped, or completed for the whole order → passed for every challan.
        if (FINISHED.includes(s.status)) {
          if (st.state === 'done') done();
          continue;
        }
        if (st.state === 'cancelled') break;
        if (st.state === 'done') {
          done();
          prevAt = st.at || prevAt;
          continue;
        }
        rows.push(row(s, def, i, dc, { state: 'open', openedAt: prevAt, plannedAt }));
        break;
      }
    }
  }

  // Names for everyone a row mentions.
  const ids = new Set();
  rows.forEach((r) => [...r.doerIds, ...r.buddyIds, r.assignedById, r.doneById].forEach((id) => id && ids.add(id)));
  const users = ids.size ? await User.find({ _id: { $in: [...ids] } }).select('name').lean() : [];
  const nameOf = new Map(users.map((u) => [String(u._id), u.name || '']));
  const person = (id) => ({ id, name: nameOf.get(id) || 'Unknown' });
  return rows.map((r) => ({
    ...r,
    doers: r.doerIds.map(person),
    buddies: r.buddyIds.map(person),
    assignedBy: r.assignedById ? person(r.assignedById) : null,
    doneByName: r.doneByName || (r.doneById ? nameOf.get(r.doneById) || null : null),
  }));
};

let cache = null; // { at, promise }
o2dEvents.on('changed', () => { cache = null; });

const allRows = () => {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.promise;
  const entry = { at: Date.now(), promise: build() };
  cache = entry;
  entry.promise.catch(() => { if (cache === entry) cache = null; });
  return entry.promise;
};

export const o2dFmsTasks = {
  /**
   * `scope: 'mine'` — rows where the user is a doer or buddy (`asBuddy` marks
   * the latter); `'all'` — everybody's (the route checks the permission).
   */
  async list(user, { scope = 'mine' } = {}) {
    const rows = await allRows();
    if (scope === 'all') return rows.map((r) => ({ ...r, asBuddy: false }));
    const uid = String(user?._id || '');
    return rows
      .filter((r) => r.doerIds.includes(uid) || r.buddyIds.includes(uid))
      .map((r) => ({ ...r, asBuddy: !r.doerIds.includes(uid) }));
  },
};

export default o2dFmsTasks;
