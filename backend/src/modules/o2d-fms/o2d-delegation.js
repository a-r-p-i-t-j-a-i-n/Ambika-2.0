/**
 * O2D FMS → Delegation Suite tasks.
 *
 * NOW (Oct 2026): O2D work is listed in Ambika 2.0's own My FMS Tasks
 * (o2d-fms-tasks.js, built on the helpers below). Delegation gets no new O2D
 * tasks — each round asks it to close only (`closeOnly`), so the tasks it
 * already has still finish by themselves as their steps are done here. Rounds
 * also give due steps their Doer Assignment doers (settleDue), link or not.
 *
 * Before: every O2D step that is waiting on someone became a task in the
 * Suite's Delegation system (assigned by the MD), and that task closed itself
 * when the step was done here. This file works out WHAT is due — the same way
 * the Step Board reads it — and sends it to the Suite, which creates / updates
 * / closes the tasks:
 *
 *   - Order-level steps (up to and including the dispatch step): due once
 *     started and not done or skipped.
 *   - The steps after dispatch run once per Delivery Challan, one by one: for
 *     each live challan, its first step not yet done (read from the documents
 *     and the per-challan log, exactly like the Step Board) is due.
 *
 * One round: POST the due list to the Suite → it answers which of its open
 * tasks are no longer due → we tell it how each one ended (done / skipped /
 * cancelled). A round runs a few seconds after any O2D change and every minute
 * regardless, so a missed one (Suite asleep, network) only delays a task.
 *
 * Both directions are signed with ERP_SSO_SECRET, the secret the two systems
 * already share. Off unless SUITE_API_URL and ERP_SSO_SECRET are set.
 */
import mongoose from 'mongoose';
import User from '../auth/auth.model.js';
import { delegationLinkOn, postToSuite } from './suite-client.js';
import { O2DProcess, O2D_STEP_STATUS } from './o2d-fms.model.js';
import { o2dFmsService, loadDefMap, stepDoerIds, stepBuddyIds } from './o2d-fms.service.js';
import { o2dEvents } from './o2d-events.js';
import { computeEffectivePermissions } from '../../middleware/permission.middleware.js';
import { AppError } from '../../utils/apiResponse.js';
import { logger } from '../../utils/logger.js';

const SOURCE = 'o2d';
const ROUND_EVERY_MS = 60 * 1000;
const AFTER_CHANGE_MS = 3000;
const WARN_EVERY_MS = 10 * 60 * 1000;

export const DONE = [O2D_STEP_STATUS.DONE, O2D_STEP_STATUS.DELAYED];
export const FINISHED = [...DONE, O2D_STEP_STATUS.SKIPPED];

// ── The "do the work" buttons ──────────────────────────────────────────────
// Same screens as the Step Board's row buttons (frontend actionLinks.js and
// O2dStepBoard.jsx — keep in step with them). Each opens the screen for THAT
// order (and challan), carrying fromTask / fromStep / fromAction like the
// step's own "Do it now", so the screen returns to the step when saved.
const ACTIONS = {
  ORDER_INTAKE:            { label: 'Order Intake', route: '/order-intake' },
  ORDER_ENTRY:             { label: 'Order Entry', route: '/orders?so={soNumber}' },
  ORDER_DETAILS:           { label: 'Order Details', route: '/orders/{orderId}' },
  DISPATCH_PLAN:           { label: 'Dispatch Planning', route: '/dispatch-planning?so={soNumber}' },
  DISPATCH_PLAN_PDF:       { label: 'Dispatch Plan PDF', route: '/dispatch-planning/generate-pdf?so={soNumber}' },
  EMAIL_DISPATCH_SCHEDULE: { label: 'Email Dispatch Schedule', route: '/o2d/dispatch-schedule-email?so={soNumber}' },
  ACTUAL_DISPATCH:         { label: 'Dispatch Items', route: '/challans?so={soNumber}' },
  CHALLAN_PDF:             { label: 'Challan PDF', route: '/challans/generate-pdf?so={soNumber}' },
  INVOICE:                 { label: 'Invoicing', route: '/invoices?so={soNumber}' },
  INVOICE_ENTRY:           { label: 'Invoice & Eway Bill', route: '/o2d/invoice-entry?so={soNumber}' },
  INVOICE_EMAIL:           { label: 'Email Invoice & Eway', route: '/o2d/invoice-email?so={soNumber}' },
  TRACK_DELIVERY:          { label: 'Track Delivery', route: '/o2d/track-delivery?so={soNumber}' },
  PAYMENT_FOLLOWUP:        { label: 'Payment Follow-up', route: '/o2d/payments?part=followup&so={soNumber}' },
  PAYMENT_RECEIPT:         { label: 'Receive Payment', route: '/o2d/payments?part=receipt&so={soNumber}' },
  TRANSPORT_BILL_RECEIVE:  { label: 'Receive Transport Bill', route: '/o2d/transport-bill?part=receive&so={soNumber}' },
  TRANSPORT_BILL_STATUS:   { label: 'Transport Bill Payment', route: '/o2d/transport-bill?part=status&so={soNumber}' },
  PAYMENTS:                { label: 'Payments', route: '/o2d/payments' },
  TRANSPORT_BILL:          { label: 'Transport Bill', route: '/o2d/transport-bill' },
  CONTROL_TOWER:           { label: 'Dispatch Control Tower', route: '/dispatch-control-tower' },
};
// Steps saved without their own links fall back to these (as on the Step Board).
const ACTION_FALLBACKS = {
  '1.01': ['ORDER_ENTRY'], '2.02': ['ORDER_ENTRY'], '2.03': ['PPC'],
  '2.04': ['DISPATCH_PLAN', 'DISPATCH_PLAN_PDF'], '2.05': ['EMAIL_DISPATCH_SCHEDULE'],
  '2.06': ['ACTUAL_DISPATCH', 'CHALLAN_PDF'], '2.07': ['INVOICE_ENTRY'], '2.08': ['INVOICE_EMAIL'],
  '2.09': ['TRACK_DELIVERY'], '2.10': ['PAYMENT_FOLLOWUP'], '2.11': ['PAYMENT_RECEIPT'],
  '2.12': ['TRANSPORT_BILL_RECEIVE'], '2.13': ['TRANSPORT_BILL_STATUS'],
};
// Not offered as buttons (as on the Step Board): 2.03 Check Inventory is done
// on the step page itself — checklist, then Mark Done.
const HIDDEN_ACTIONS = ['PPC'];

const actionKeysOf = (s, def) => {
  let keys = s.actionLinks?.length ? s.actionLinks : (s.actionLink ? [s.actionLink] : (ACTION_FALLBACKS[s.stepCode] || []));
  if (def?.triggerKey === 'ACTUAL_DISPATCH' && !keys.includes('ACTUAL_DISPATCH')) keys = ['ACTUAL_DISPATCH', ...keys];
  return keys.filter((k) => !HIDDEN_ACTIONS.includes(k));
};

// Fill a route's {placeholders}: a missing path value drops the link, a
// missing query value drops that parameter (as actionLinks.js does).
const fillRoute = (route, values) => {
  const [pathPart, queryPart] = route.split('?');
  let path = pathPart;
  for (const [k, v] of Object.entries(values)) {
    if (path.includes(`{${k}}`)) {
      if (!v) return null;
      path = path.replaceAll(`{${k}}`, encodeURIComponent(String(v)));
    }
  }
  const params = new URLSearchParams();
  for (const pair of (queryPart || '').split('&').filter(Boolean)) {
    const [k, raw] = pair.split('=');
    const m = raw?.match(/^\{(\w+)\}$/);
    const v = m ? values[m[1]] : raw;
    if (v) params.set(k, String(v));
  }
  return { path, params };
};

// "Order Entry" is the work only while the order is not punched in yet (1.01);
// once it exists (2.02 and later) the task offers "Do Task" — the step page.
export const actionsFor = (p, s, def, dc) => actionKeysOf(s, def)
  .filter((key) => !(key === 'ORDER_ENTRY' && p.salesOrderId))
  .map((key) => {
    const meta = ACTIONS[key];
    const filled = meta && fillRoute(meta.route, { soNumber: p.soNumber, orderId: p.salesOrderId, processId: p._id });
    if (!filled) return null;
    filled.params.set('fromTask', String(p._id));
    filled.params.set('fromStep', s.stepCode);
    filled.params.set('fromAction', key);
    if (dc?.dcNumber) filled.params.set('dc', dc.dcNumber);
    return { key, label: meta.label, path: `${filled.path}?${filled.params.toString()}` };
  })
  .filter(Boolean);

export const stepPathFor = (p, s, dc) => `/o2d-fms/task/${p._id}/${encodeURIComponent(s.stepCode)}${dc?.dcNumber ? `?dc=${encodeURIComponent(dc.dcNumber)}` : ''}`;

// ── Reading the flow the way the Step Board does ───────────────────────────
export const isDispatchStep = (s, def) => !!(def?.quantityGated || def?.triggerKey === 'ACTUAL_DISPATCH')
  || actionKeysOf(s, def).includes('ACTUAL_DISPATCH');

export const orderedSteps = (p, defMap) => (p.steps || [])
  .map((s) => ({ s, def: defMap.get(s.stepCode) }))
  .sort((a, b) => (a.def?.sequence ?? 0) - (b.def?.sequence ?? 0));

/**
 * One challan's state on one post-dispatch step — a copy of the Step Board's
 * dcStepState (O2dStepBoard.jsx): the per-challan log wins, else the real
 * documents decide. → { state: 'cancelled' | 'done' | 'open', at, byName }
 */
export const dcStepState = (dc, stepCode, def) => {
  if (dc.cancelled) return { state: 'cancelled' };
  const log = dc.log?.[stepCode];
  if (log?.status === 'CANCELLED') return { state: 'cancelled' };
  if (log) return { state: 'done', at: log.doneAt, byName: log.doneByName };
  const done = (yes, at) => (yes ? { state: 'done', at: at || null } : { state: 'open' });
  switch (def?.triggerKey) {
    case 'INVOICE': return done(!!dc.invoice?.invoiceNo, dc.invoice?.date);
    case 'POD':     return done(!!dc.delivery?.delivered, dc.delivery?.date);
    case 'PAYMENT': return done(!!(dc.payment?.confirmed || dc.payment?.outcome === 'RECEIVED'), dc.payment?.receivedDate);
    default: break;
  }
  switch (stepCode) {
    case '2.07': return done(!!dc.invoice?.invoiceNo, dc.invoice?.date);
    case '2.08': return done(dc.invoice?.emailStatus === 'SENT', dc.invoice?.emailSentAt);
    case '2.09': return done(!!dc.delivery?.delivered, dc.delivery?.date);
    case '2.11': return done(!!(dc.payment?.confirmed || dc.payment?.outcome === 'RECEIVED'), dc.payment?.receivedDate);
    case '2.12': return done(dc.transport?.receiptStatus === 'DONE');
    case '2.13': return done(dc.transport?.paymentStatus === 'DONE');
    default: return { state: 'open' };
  }
};

export const addMinutes = (date, mins) => new Date(new Date(date).getTime() + (Number(mins) || 0) * 60000);
const iso = (d) => (d && !Number.isNaN(new Date(d).getTime()) ? new Date(d).toISOString() : null);
export const keyOf = (processId, stepCode, dcId) => [SOURCE, String(processId), stepCode, ...(dcId ? [String(dcId)] : [])].join(':');

export const parseKey = (key) => {
  const [src, processId, stepCode, dcId] = String(key || '').split(':');
  if (src !== SOURCE || !mongoose.isValidObjectId(processId) || !stepCode) return null;
  return { processId, stepCode, dcId: dcId || null };
};

export const challansBySo = async (soNumbers) => {
  const rows = soNumbers.length ? await o2dFmsService.listBoardConsignments({ soNumbers, lite: true }) : [];
  const map = new Map();
  rows.forEach((dc) => {
    if (!map.has(dc.soNumber)) map.set(dc.soNumber, []);
    map.get(dc.soNumber).push(dc);
  });
  return map;
};

const emailsById = async (ids) => {
  if (!ids.size) return new Map();
  const users = await User.find({ _id: { $in: [...ids] } }).select('email isActive').lean();
  return new Map(users
    .filter((u) => u.isActive !== false && u.email)
    .map((u) => [String(u._id), String(u.email).trim().toLowerCase()]));
};

// The step fields a round reads — not the checklists, comments, attachments
// or email bodies of every open order.
export const DUE_STEP_FIELDS = ['stepCode', 'status', 'startedAt', 'planned', 'leadTimeMins', 'actionLinks', 'actionLink',
  'taskTitle', 'assignees', 'assignedTo', 'buddies', 'buddyUserId', 'doersSettledAt'].map((f) => `steps.${f}`).join(' ');

/** Every O2D step (or challan step) waiting on someone right now → [{ p, s, def, dc, plannedAt }]. */
const collectDue = async (defMap) => {
  const processes = await O2DProcess.find({ isDeleted: { $ne: true }, isCompleted: { $ne: true } })
    .select(`salesOrderId soNumber poNumber partyName ${DUE_STEP_FIELDS}`)
    .lean();
  const dcsBySo = await challansBySo([...new Set(processes.map((p) => p.soNumber).filter(Boolean))]);

  const raw = [];
  for (const p of processes) {
    const steps = orderedSteps(p, defMap);
    const forkIdx = steps.findIndex(({ s, def }) => isDispatchStep(s, def));
    // Order-level steps — up to and including the dispatch step.
    steps.forEach(({ s, def }, i) => {
      if (forkIdx !== -1 && i > forkIdx) return;
      if (!s.startedAt || FINISHED.includes(s.status)) return;
      raw.push({ p, s, def, dc: null, plannedAt: s.planned || null });
    });
    if (forkIdx === -1) continue;
    // After dispatch: each live challan walks the remaining steps one by one.
    const after = steps.slice(forkIdx + 1);
    for (const dc of dcsBySo.get(p.soNumber) || []) {
      if (dc.cancelled) continue;
      let prevAt = dc.dcDate || null;
      for (const { s, def } of after) {
        // Skipped, or completed for the whole order → passed for every challan.
        if (FINISHED.includes(s.status)) continue;
        const st = dcStepState(dc, s.stepCode, def);
        if (st.state === 'cancelled') break;
        if (st.state === 'done') { prevAt = st.at || prevAt; continue; }
        // This challan's next step: due its lead time after the previous one.
        const lead = s.leadTimeMins ?? def?.slaMinutes ?? 60;
        raw.push({ p, s, def, dc, plannedAt: prevAt ? addMinutes(prevAt, lead) : (s.planned || null) });
        break;
      }
    }
  }
  return raw;
};

/**
 * A step that has come due takes the main doers and buddies FMS → Doer
 * Assignment has for it now — once (doersSettledAt), so a later reassign on
 * the order is kept. Steps already due when this rule arrived get it on the
 * first round too. A step with no main doer in Doer Assignment is left as it
 * is. Returns how many steps changed hands.
 */
export const settleDueStepDoers = async () => (await settleDue(await collectDue(await loadDefMap()))).changed;

// settleDueStepDoers on an already-collected due list → { changed, written }:
// `written` counts every step saved, even with the same people (their order
// may differ), so the caller knows when to read the due list again.
const settleDue = async (due) => {
  const unsettled = new Map();
  due.forEach(({ p, s }) => {
    if (!s.doersSettledAt) unsettled.set(`${p._id}:${s.stepCode}`, { p, s });
  });
  if (!unsettled.size) return { changed: 0, written: 0 };

  const active = (list) => (list || []).filter((u) => u?.id && u.isActive !== false).map((u) => String(u.id));
  const plan = new Map(((await o2dFmsService.getDoerPlan())?.steps || []).map((row) => [row.stepCode, {
    doers: active(row.doers),
    buddies: active(row.buddies),
  }]));
  const sorted = (list) => [...list].sort().join(',');
  let changed = 0;
  let written = 0;
  for (const { p, s } of unsettled.values()) {
    const want = plan.get(s.stepCode);
    if (!want?.doers.length) continue;
    const buddies = want.buddies.filter((id) => !want.doers.includes(id));
    const differs = sorted(stepDoerIds(s)) !== sorted(want.doers) || sorted(stepBuddyIds(s)) !== sorted(buddies);
    // Only if no one settled it in the meantime (reassign / update running orders).
    // eslint-disable-next-line no-await-in-loop
    const res = await O2DProcess.updateOne(
      { _id: p._id, steps: { $elemMatch: { stepCode: s.stepCode, doersSettledAt: null } } },
      {
        $set: {
          'steps.$.assignees': want.doers,
          'steps.$.assignedTo': want.doers[0] || null,
          'steps.$.buddies': buddies,
          'steps.$.buddyUserId': buddies[0] || null,
          'steps.$.doersSettledAt': new Date(),
        },
        ...(differs ? {
          $push: {
            activityTimeline: {
              action: 'STEP_REASSIGNED',
              description: `${s.stepCode} — doers set from Doer Assignment as the step came due`,
            },
          },
        } : {}),
      },
    );
    if (res.modifiedCount) written += 1;
    if (differs && res.modifiedCount) changed += 1;
  }
  if (changed) logger.info(`[o2d→delegation] ${changed} due step(s) given their doers from Doer Assignment`);
  return { changed, written };
};

/** Every O2D step (or challan step) waiting on someone right now, as Delegation task items. */
export const computeDueItems = async () => dueItemsFrom(await collectDue(await loadDefMap()));

const dueItemsFrom = async (raw) => {
  const ids = new Set();
  raw.forEach(({ s }) => [...stepDoerIds(s), ...stepBuddyIds(s)].forEach((id) => ids.add(id)));
  const emailOf = await emailsById(ids);
  const emails = (list) => [...new Set(list.map((id) => emailOf.get(id)).filter(Boolean))];

  return raw.map(({ p, s, def, dc, plannedAt }) => {
    const doers = emails(stepDoerIds(s));
    return {
      key: keyOf(p._id, s.stepCode, dc?.dcId),
      processId: String(p._id),
      stepCode: s.stepCode,
      stepName: def?.name || s.taskTitle || s.stepCode,
      soNumber: p.soNumber || null,
      poNumber: p.poNumber || null,
      partyName: p.partyName || null,
      dcNumber: dc?.dcNumber || null,
      plannedAt: iso(plannedAt),
      doers,
      buddies: emails(stepBuddyIds(s)).filter((e) => !doers.includes(e)),
      actions: actionsFor(p, s, def, dc),
      stepPath: stepPathFor(p, s, dc),
    };
  });
};

/**
 * How each (no longer due) task's step ended: 'done' | 'skipped' |
 * 'cancelled', or 'open' when it is in fact still waiting.
 */
export const computeOutcomes = async (keys) => {
  const refs = keys.map((key) => ({ key, ref: parseKey(key) }));
  const ids = [...new Set(refs.filter((r) => r.ref).map((r) => r.ref.processId))];
  const [processes, defMap] = await Promise.all([
    ids.length
      ? O2DProcess.find({ _id: { $in: ids } })
        .select('soNumber isDeleted steps.stepCode steps.status steps.actual steps.completedBy steps.skipReason')
        .lean()
      : [],
    loadDefMap(),
  ]);
  const byId = new Map(processes.map((p) => [String(p._id), p]));
  const needDc = new Set(refs
    .filter((r) => r.ref?.dcId)
    .map((r) => byId.get(r.ref.processId)?.soNumber)
    .filter(Boolean));
  const dcsBySo = await challansBySo([...needDc]);

  const completedIds = new Set();
  processes.forEach((p) => (p.steps || []).forEach((s) => s.completedBy && completedIds.add(String(s.completedBy))));
  const emailOf = await emailsById(completedIds);

  return refs.map(({ key, ref }) => {
    const p = ref && byId.get(ref.processId);
    if (!p || p.isDeleted) return { key, outcome: 'cancelled', reason: 'The order was deleted in O2D' };
    const s = (p.steps || []).find((x) => x.stepCode === ref.stepCode);
    if (!s) return { key, outcome: 'cancelled', reason: 'The step no longer exists on this order' };
    if (DONE.includes(s.status)) {
      return { key, outcome: 'done', at: iso(s.actual), byEmail: s.completedBy ? emailOf.get(String(s.completedBy)) || null : null };
    }
    if (s.status === O2D_STEP_STATUS.SKIPPED) return { key, outcome: 'skipped', at: iso(s.actual), reason: s.skipReason || 'Skipped in O2D' };
    if (!ref.dcId) return { key, outcome: 'open' };
    const dc = (dcsBySo.get(p.soNumber) || []).find((x) => String(x.dcId) === ref.dcId);
    if (!dc) return { key, outcome: 'cancelled', reason: 'The delivery challan was deleted' };
    const st = dcStepState(dc, s.stepCode, defMap.get(s.stepCode));
    if (st.state === 'cancelled') return { key, outcome: 'cancelled', reason: `Dispatch ${dc.dcNumber} was cancelled` };
    if (st.state === 'done') return { key, outcome: 'done', at: iso(st.at), byName: st.byName || null };
    return { key, outcome: 'open' };
  });
};

// ── Rounds ─────────────────────────────────────────────────────────────────
let running = false;
let runAgain = false;
let soonTimer = null;
let lastWarnAt = 0;

const runRound = async () => {
  if (running) { runAgain = true; return; }
  running = true;
  try {
    // One read of the open orders serves the whole round; it is read again
    // only when steps that just came due were given their doers.
    const defMap = await loadDefMap();
    let raw = await collectDue(defMap);
    // Steps that just came due take who Doer Assignment says now — before
    // the Delegation tasks are worked out, so the task goes to that person.
    let reread = false;
    try {
      reread = (await settleDue(raw)).written > 0;
    } catch (err) {
      logger.warn(`[o2d→delegation] could not apply Doer Assignment to due steps: ${err.message}`);
      reread = true; // some may have been saved before it stopped
    }
    if (reread) raw = await collectDue(defMap);
    // O2D work now lives in Ambika 2.0's own My FMS Tasks (o2d-fms-tasks.js):
    // Delegation gets no new tasks (closeOnly). The due list still goes over so
    // the tasks it already has close by themselves as their steps finish.
    if (delegationLinkOn()) {
      const due = await dueItemsFrom(raw);
      const res = await postToSuite('/erp/fms/sync', { source: SOURCE, due, closeOnly: true });
      const check = (Array.isArray(res?.data?.check) ? res.data.check : []).filter((k) => typeof k === 'string');
      if (check.length) {
        const items = (await computeOutcomes(check)).filter((o) => o.outcome !== 'open');
        if (items.length) await postToSuite('/erp/fms/close', { source: SOURCE, items });
      }
    }
    lastWarnAt = 0;
  } catch (err) {
    // Say it once, then every few minutes while it keeps failing.
    if (Date.now() - lastWarnAt > WARN_EVERY_MS) {
      lastWarnAt = Date.now();
      logger.warn(`[o2d→delegation] sync round failed: ${err.message}`);
    }
  } finally {
    running = false;
    if (runAgain) { runAgain = false; runSoon(); }
  }
};

const runSoon = () => {
  if (soonTimer) return;
  soonTimer = setTimeout(() => { soonTimer = null; runRound(); }, AFTER_CHANGE_MS);
  soonTimer.unref?.();
};

// Rounds run with or without the Delegation link: due steps must take their
// Doer Assignment doers either way (My FMS Tasks shows them).
export const startO2dDelegationSync = () => {
  o2dEvents.on('changed', runSoon);
  runSoon();
  const timer = setInterval(runRound, ROUND_EVERY_MS);
  timer.unref?.();
  logger.info(delegationLinkOn()
    ? '[o2d→delegation] on — due steps get their doers; Delegation only closes the O2D tasks it already has'
    : '[o2d→delegation] due steps get their doers (no Delegation link)');
  return timer;
};

// ── Completing from Delegation ─────────────────────────────────────────────
/**
 * A Delegation task for an O2D step was marked Completed there. Complete the
 * step here as that person, exactly like "Mark Done" on the step page — the
 * step's own rules (checklist, proof, fields, approval) still apply. A
 * challan's step finishes only through its real work (invoice, email,
 * delivery…), so that is refused with a pointer to the buttons.
 * → { state: 'done' | 'skipped' | 'cancelled' }
 */
export const completeFromDelegation = async ({ key, email } = {}) => {
  const ref = parseKey(key);
  if (!ref) throw new AppError('This is not an O2D task', 400);

  const [outcome] = await computeOutcomes([key]);
  if (outcome.outcome !== 'open') return { state: outcome.outcome };

  if (ref.dcId) {
    throw new AppError(
      'This challan\'s step completes by itself once its work is saved in O2D — use the button(s) in "O2D work" on this task.',
      422,
    );
  }

  const user = await User.findOne({ email: String(email || '').trim().toLowerCase() });
  if (!user || user.isActive === false) {
    throw new AppError('You have no active Ambika 2.0 account — open the ERP once from the Suite, then try again.', 403);
  }
  const perms = await computeEffectivePermissions(user);
  const privileged = perms.has('*') || perms.has('o2dfms.act') || perms.has('o2dfms.manage');
  await o2dFmsService.completeStep(
    ref.processId, ref.stepCode,
    { force: true, remarks: 'Completed from the Delegation task' },
    user, { privileged },
  );
  return { state: 'done' };
};
