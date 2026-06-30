/**
 * O2D FMS service — the flow engine.
 *
 * The two formulas that mirror the client's sheet live here and nowhere else:
 *   planned   = (slaFrom === ORDER_RECEIVED ? receivedAt : prevStep.actual) + slaMinutes
 *   delayMins = max(0, round((actual - planned) / 60000))
 */

import mongoose from 'mongoose';
import { StepDefinition, O2DProcess, TaskTemplate, O2D_STEP_STATUS, LEAD_TIME_UNIT_MINUTES, TRIGGER_KEY } from './o2d-fms.model.js';
import User from '../auth/auth.model.js';
import SalesOrder from '../order/order.model.js';

// ── MIS scoring (Rahul-Jain style) ──────────────────────────────────────────
// The MIS score is a PENALTY total — it can only be 0 (perfect) or negative.
// Every lapse subtracts points, so the MD reads accountability at a glance.
const MIS_W = { late: 2, overdue: 5, delayPerHour: 1, checklistMiss: 1 };
const computeMis = (m) => {
  const completed = m.completed || 0;
  const punctuality   = completed > 0 ? Math.round((m.onTime / completed) * 100) : 100;
  const accuracy      = m.checklistTotal > 0 ? Math.round((m.checklistDone / m.checklistTotal) * 100) : 100;
  const avgDelayMins  = completed > 0 ? Math.round(m.totalDelay / completed) : 0;
  const completionRate = m.assigned > 0 ? Math.round((completed / m.assigned) * 100) : 0;
  const checklistMisses = Math.max(0, (m.checklistTotal || 0) - (m.checklistDone || 0));
  const misScore = -(
    (m.late || 0) * MIS_W.late
    + (m.overdue || 0) * MIS_W.overdue
    + Math.floor((m.totalDelay || 0) / 60) * MIS_W.delayPerHour
    + checklistMisses * MIS_W.checklistMiss
  );
  // Grade band from the penalty (0 = A+, deeper minus = worse).
  const grade = misScore >= 0 ? 'A+' : misScore >= -10 ? 'A' : misScore >= -25 ? 'B' : misScore >= -50 ? 'C' : 'D';
  return { punctuality, accuracy, avgDelayMins, completionRate, misScore, grade };
};
import DispatchSchedule from '../schedule/schedule.model.js';
import { ApiFeatures } from '../../utils/apiFeatures.js';
import { AppError } from '../../utils/apiResponse.js';
import { logger } from '../../utils/logger.js';
import { notificationsService } from '../notifications/notification.service.js';

// Notify every assigned doer (and every buddy) that a step is waiting on them.
const notifyStepOwners = async (process, step) => {
  const link = `/o2d-fms/task/${process._id}/${encodeURIComponent(step.stepCode)}`;
  const title = `Your turn: ${step.taskTitle || step.stepCode}`;
  const body = `Order ${process.soNumber || ''} — ${process.partyName || ''}`;
  const doers = stepDoerIds(step);
  const buddies = stepBuddyIds(step).filter((id) => !doers.includes(id));
  for (const id of doers) await notificationsService.notify(id, { type: 'TASK_ASSIGNED', title, body, link });
  for (const id of buddies) await notificationsService.notify(id, { type: 'TASK_ASSIGNED', title: `Backup (buddy): ${title}`, body, link });
};

// FMS catalog scoping. 'V1' (FMS 1.0) also matches legacy docs saved before the
// fmsKey field existed (missing / null), so nothing disappears pre-migration.
const DEFAULT_FMS_KEY = 'V1';
// The FMS catalog that NEW orders run on. Switch this to change which flow the
// runtime builds (V1 = original; CURRENT_SHEET = the client's live-sheet flow).
const ACTIVE_FMS_KEY = process.env.O2D_ACTIVE_FMS || 'CURRENT_SHEET';
const fmsScope = (fmsKey = DEFAULT_FMS_KEY) => (
  fmsKey === DEFAULT_FMS_KEY
    ? { $or: [{ fmsKey: DEFAULT_FMS_KEY }, { fmsKey: { $exists: false } }, { fmsKey: null }] }
    : { fmsKey }
);

const addMinutes = (date, mins) => new Date(new Date(date).getTime() + (mins || 0) * 60000);
const leadTimeToMins = (lt) => (lt?.value ? lt.value * (LEAD_TIME_UNIT_MINUTES[lt.unit] || 60) : null);
const computeDelayMins = (planned, actual) => {
  if (!planned || !actual) return 0;
  return Math.max(0, Math.round((new Date(actual).getTime() - new Date(planned).getTime()) / 60000));
};

// Union of array + legacy-single user ids on a step.
const idStr = (v) => (v ? String(v._id || v) : null);
const stepDoerIds  = (step) => [...new Set([...(step.assignees || []).map(idStr), idStr(step.assignedTo)].filter(Boolean))];
const stepBuddyIds = (step) => [...new Set([...(step.buddies || []).map(idStr), idStr(step.buddyUserId)].filter(Boolean))];

// A step can be acted on by ANY assigned doer, ANY buddy, or a privileged user
// (root / o2dfms.act / o2dfms.manage). Because it's one shared step record, when
// one of them ticks the checklist or completes it, it's consistent for everyone.
const isAssigneeOrBuddy = (step, user) => {
  const uid = String(user?._id || '');
  return !!uid && (stepDoerIds(step).includes(uid) || stepBuddyIds(step).includes(uid));
};
const assertCanAct = (step, user, privileged) => {
  if (privileged || isAssigneeOrBuddy(step, user)) return;
  throw new AppError('This step is assigned to someone else — you can view it but not action it.', 403);
};

/**
 * Generalised completion gate. Returns human-readable reasons the step can't
 * be completed yet — checklist, yes/no verifications, required data fields,
 * proof attachments and approval are ALL checked. Empty array = good to go.
 */
const unmetRequirements = (step, def, payload = {}) => {
  const unmet = [];
  // Link requirement: the step's own setting wins (template/per-order override);
  // null means inherit the Step Definition's default.
  const linkRequired = step.requiresLink != null ? step.requiresLink : !!def?.requiresLink;
  if (linkRequired && !payload.link && !step.link) unmet.push('a link is required');

  const attachCount = (step.attachments?.length || 0) + (payload.attachments?.length || 0);
  if (def?.requiresAttachment && attachCount === 0) unmet.push('an attachment is required');
  if (step.proof?.required && attachCount < (step.proof.minCount || 1)) {
    unmet.push(`attach at least ${step.proof.minCount || 1} proof file(s) (${attachCount} so far)`);
  }

  const pendingChecklist = (step.checklist || []).filter((c) => !c.done).length;
  if (pendingChecklist > 0 && !def?.allowIncompleteChecklist) {
    unmet.push(`${pendingChecklist} checklist item(s) remaining`);
  }

  const unanswered = (step.verifications || []).filter((v) => !v.answer).length;
  if (unanswered > 0) unmet.push(`${unanswered} verification question(s) unanswered`);

  const emptyFields = (step.formFields || [])
    .filter((f) => f.required && (f.value === null || f.value === undefined || f.value === ''));
  if (emptyFields.length > 0) {
    unmet.push(`fill in: ${emptyFields.map((f) => f.label).join(', ')}`);
  }

  if (step.approval?.required && !step.approval.approvedBy) unmet.push('approval is pending');
  return unmet;
};

/** Resolve a StepDefinition's default owner to a User _id (or null). */
const resolveOwner = async (def) => {
  if (def.defaultOwnerUserId) return def.defaultOwnerUserId;
  if (def.defaultOwnerRole) {
    const u = await User.findOne({
      isActive: true,
      $or: [{ roles: def.defaultOwnerRole }, { role: def.defaultOwnerRole }],
    }).select('_id').lean();
    return u?._id || null;
  }
  return null;
};

/** Attach the matching StepDefinition (Who/What/How/When) onto each runtime step. */
const enrichSteps = (process, defMap) => {
  const obj = process.toObject ? process.toObject() : process;
  obj.steps = (obj.steps || []).map((s) => {
    const def = defMap.get(s.stepCode);
    return {
      ...s,
      name:        def?.name || s.stepCode,
      description: def?.description || '',
      tool:        def?.tool || null,
      slaMinutes:  def?.slaMinutes ?? null,
      phase:       def?.phase || null,
      sequence:    def?.sequence ?? 0,
      requiresLink:       s.requiresLink != null ? !!s.requiresLink : !!def?.requiresLink,
      requiresAttachment: !!def?.requiresAttachment,
      allowIncompleteChecklist: !!def?.allowIncompleteChecklist,
      defaultOwnerRole:   def?.defaultOwnerRole || null,
      triggerKey:         def?.triggerKey || 'MANUAL',
      // Phased/split dispatch: flag + denormalised progress so the tracker can render
      // the per-phase sub-steps and the "x / y dispatched" bar.
      quantityGated:      !!def?.quantityGated || def?.triggerKey === 'ACTUAL_DISPATCH',
      checklistTotal: (s.checklist || []).length,
      checklistDone:  (s.checklist || []).filter((c) => c.done).length,
      // Normalise connected screens to an array (legacy single → [single]) and
      // count how many have been completed, for the "x/y actions done" summary.
      actionLinks: (s.actionLinks?.length ? s.actionLinks : (s.actionLink ? [s.actionLink] : [])),
      actionLinksTotal: (s.actionLinks?.length ? s.actionLinks : (s.actionLink ? [s.actionLink] : [])).length,
      actionLinksDone: (s.actionProgress || []).length,
      isOverdue: s.status === O2D_STEP_STATUS.PENDING && s.planned && new Date(s.planned) < new Date(),
    };
  }).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  return obj;
};

const loadDefMap = async () => {
  const defs = await StepDefinition.find({ isDeleted: { $ne: true } }).lean();
  // V1 and CURRENT_SHEET can share stepCodes (1.01, 2.02…). Sort so the ACTIVE
  // FMS's defs are inserted LAST and therefore win the Map key — keeping the live
  // flow's names, trigger keys and requirements correct.
  defs.sort((a, b) => ((a.fmsKey === ACTIVE_FMS_KEY) ? 1 : 0) - ((b.fmsKey === ACTIVE_FMS_KEY) ? 1 : 0));
  return new Map(defs.map((d) => [d.stepCode, d]));
};

// Optimistic-concurrency retry. The O2DProcess is one big document that several of
// a doer's actions can hit at the same instant (e.g. on returning from a connected
// screen the UI fires "action-done" AND auto-ticks the checklist). When two saves
// race, Mongoose throws a VersionError; we just re-run the load-modify-save against
// a fresh copy so the write succeeds instead of failing with a 500.
const withVersionRetry = async (fn, tries = 4) => {
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const conflict = err?.name === 'VersionError' || err?.name === 'ParallelSaveError';
      if (conflict && attempt < tries) {
        await new Promise((r) => setTimeout(r, 40 * attempt));
        continue;
      }
      throw err;
    }
  }
  return undefined;
};

// ── Phased / split dispatch ────────────────────────────────────────────────
// A step is "quantity-gated" when it should complete only once the WHOLE order is
// dispatched (balance 0) — i.e. the dispatch step. Detected by the explicit flag
// OR by its ACTUAL_DISPATCH trigger (so no data migration is needed).
const isQuantityGated = (def) => !!(def && (def.quantityGated || def.triggerKey === TRIGGER_KEY.ACTUAL_DISPATCH));

// Order-level dispatch progress (qty from the SalesOrder totals — already kept fresh
// by createActualDispatch before it fires the trigger) + a best-effort phase count
// from the DispatchSchedule. Detailed per-phase rows are read live on the UI.
const computeOrderDispatchSummary = async (process) => {
  let order = null;
  if (process.salesOrderId) {
    order = await SalesOrder.findById(process.salesOrderId)
      .select('soNumber totalOrderQty totalDispatchedQty totalBalanceQty').lean();
  }
  if (!order && process.soNumber) {
    order = await SalesOrder.findOne({ soNumber: process.soNumber })
      .select('soNumber totalOrderQty totalDispatchedQty totalBalanceQty').lean();
  }
  const orderedQty    = Number(order?.totalOrderQty || 0);
  const dispatchedQty = Number(order?.totalDispatchedQty || 0);
  const balanceQty    = order?.totalBalanceQty != null
    ? Number(order.totalBalanceQty)
    : Math.max(0, orderedQty - dispatchedQty);
  const pct = orderedQty > 0 ? Math.min(100, Math.round((dispatchedQty / orderedQty) * 100)) : 0;
  const fullyDispatched = orderedQty > 0 && balanceQty <= 0;

  // Phase counts (best-effort) — a phaseNo group is "done" when every item's phase
  // with that label is DISPATCHED.
  let phasesTotal = 0;
  let phasesDone = 0;
  try {
    const soNumber = order?.soNumber || process.soNumber;
    if (soNumber) {
      const schedule = await DispatchSchedule.findOne({ soNumber }).select('items.phases.phaseNo items.phases.status').lean();
      if (schedule) {
        const byPhase = new Map(); // phaseNo -> { total, dispatched }
        for (const it of schedule.items || []) {
          for (const ph of it.phases || []) {
            const e = byPhase.get(ph.phaseNo) || { total: 0, dispatched: 0 };
            e.total += 1;
            if (ph.status === 'DISPATCHED') e.dispatched += 1;
            byPhase.set(ph.phaseNo, e);
          }
        }
        phasesTotal = byPhase.size;
        phasesDone = [...byPhase.values()].filter((e) => e.total > 0 && e.dispatched === e.total).length;
      }
    }
  } catch (err) {
    logger.warn?.(`[phased-dispatch] phase count failed: ${err.message}`);
  }

  return { orderedQty, dispatchedQty, balanceQty, pct, fullyDispatched, phasesTotal, phasesDone };
};

const buildDispatchProgress = (summary) => ({
  orderedQty: summary.orderedQty,
  dispatchedQty: summary.dispatchedQty,
  balanceQty: summary.balanceQty,
  pct: summary.pct,
  phasesTotal: summary.phasesTotal,
  phasesDone: summary.phasesDone,
  updatedAt: new Date(),
});

/**
 * Quantity-gated advance for the phased/split-dispatch step (trigger ACTUAL_DISPATCH).
 * Each recorded dispatch refreshes the step's progress. The step completes ONLY when
 * the whole order is dispatched (balance 0); until then it stays IN_PROGRESS and the
 * next step is activated so per-consignment invoice/POD/payment can still proceed.
 * Re-targeting works because IN_PROGRESS is not a terminal status — phases 2..N keep
 * hitting this same step.
 */
const applyPhasedDispatch = async (process, step, defMap, actor) => {
  const summary = await computeOrderDispatchSummary(process);
  const now = new Date();
  if (!step.startedAt) step.startedAt = now;
  step.dispatchProgress = buildDispatchProgress(summary);

  const idx = process.steps.findIndex((s) => s.stepCode === step.stepCode);
  const next = process.steps[idx + 1];
  // Activate the next step so downstream can proceed per consignment — but only if
  // it hasn't started yet, so we never drag the "current" pointer backwards.
  const activateNext = async () => {
    if (next && !next.startedAt) {
      const nextDef = defMap.get(next.stepCode);
      if (!next.planned) next.planned = addMinutes(now, next.leadTimeMins ?? nextDef?.slaMinutes ?? 60);
      next.startedAt = now;
      process.currentStepCode = next.stepCode;
      await notifyStepOwners(process, next);
    }
  };

  if (summary.fullyDispatched) {
    step.actual = now;
    step.completedBy = actor?._id || null;
    step.delayMins = computeDelayMins(step.planned, now);
    step.status = step.delayMins > 0 ? O2D_STEP_STATUS.DELAYED : O2D_STEP_STATUS.DONE;
    if (next) await activateNext();
    else { process.isCompleted = true; process.completedAt = now; process.currentStepCode = null; }
    process.activityTimeline.push({
      action: 'STEP_COMPLETED',
      description: `${step.stepCode} completed — fully dispatched (${summary.dispatchedQty}/${summary.orderedQty})`,
      actorId: actor?._id || null,
    });
  } else {
    step.status = O2D_STEP_STATUS.IN_PROGRESS;
    await activateNext();
    process.activityTimeline.push({
      action: 'DISPATCH_PROGRESS',
      description: `${step.stepCode} dispatch ${summary.dispatchedQty}/${summary.orderedQty} — ${summary.balanceQty} pending`,
      actorId: actor?._id || null,
    });
  }

  await process.save();
  return enrichSteps(process, defMap);
};

export const o2dFmsService = {
  // ── Process lifecycle ─────────────────────────────────────────────────────

  /**
   * Build the O2DProcess for a freshly-created Sales Order from the active
   * StepDefinition catalog. Idempotent — returns the existing process if one
   * already exists. Safe to call without an owner/catalog.
   */
  /** Seed step instances from the active catalog + default template. Shared by
   *  the Sales-Order and Order-Intake process builders. */
  async _seedSteps(received, fmsKey = DEFAULT_FMS_KEY) {
    // Runtime processes are built from ONE FMS catalog (V1 today). Scoping here is
    // what keeps a second catalog (e.g. CURRENT_SHEET) from leaking into orders.
    const defs = await StepDefinition.find({ isActive: true, isDeleted: { $ne: true }, ...fmsScope(fmsKey) })
      .sort({ sequence: 1 }).lean();
    if (!defs.length) return { steps: [], defs: [] };

    const template = await TaskTemplate.findOne({ isDefault: true, isActive: true, isDeleted: { $ne: true }, ...fmsScope(fmsKey) }).lean();
    const tplByStep = new Map((template?.steps || []).map((t) => [t.stepCode, t]));

    const steps = [];
    let cursor = received; // running planned-date cursor; each step adds its lead/SLA time
    for (let i = 0; i < defs.length; i += 1) {
      const def = defs[i];
      const tpl = tplByStep.get(def.stepCode);
      const leadTimeMins = leadTimeToMins(tpl?.leadTime) ?? def.slaMinutes;
      // Every step gets a planned due-date up-front, derived from the cumulative
      // lead/SLA times (so the whole schedule is visible the moment the FMS starts).
      cursor = addMinutes(cursor, leadTimeMins);
      const planned = cursor;

      // Doers: template multi-list → legacy single → role → step-definition default.
      let assignees = (tpl?.assigneeUserIds?.length ? tpl.assigneeUserIds
        : (tpl?.assigneeUserId ? [tpl.assigneeUserId] : []))
        .map((x) => String(x));
      if (!assignees.length && tpl?.assigneeRole) {
        const u = await resolveOwner({ defaultOwnerRole: tpl.assigneeRole });
        if (u) assignees = [String(u)];
      }
      if (!assignees.length) {
        const u = await resolveOwner(def);
        if (u) assignees = [String(u)];
      }
      const buddies = (tpl?.buddyUserIds?.length ? tpl.buddyUserIds
        : (tpl?.buddyUserId ? [tpl.buddyUserId] : []))
        .map((x) => String(x));

      steps.push({
        stepCode: def.stepCode,
        planned,
        leadTimeMins,
        status: O2D_STEP_STATUS.PENDING,
        assignees,
        buddies,
        assignedTo: assignees[0] || null,   // primary mirror
        buddyUserId: buddies[0] || null,
        taskTitle: tpl?.taskTitle || def.name,
        instructions: tpl?.instructions || def.description || null,
        checklist: (tpl?.checklist || []).map((c) => ({ text: c.text, done: false })),
        // Requirement types beyond the checklist (template-driven, all optional).
        verifications: (tpl?.verifications || []).map((v) => ({ question: v.question, answer: null })),
        formFields: (tpl?.formFields || []).map((f) => ({
          label: f.label, fieldType: f.fieldType || 'TEXT', required: f.required !== false, value: null,
        })),
        proof: tpl?.proof?.required ? { required: true, minCount: tpl.proof.minCount || 1 } : null,
        approval: tpl?.approval?.required
          ? { required: true, approverIds: (tpl.approval.approverIds || []).map(String) }
          : null,
        actionLink: tpl?.actionLink || null,
        // Multiple connected screens (each becomes a "Do it now"). Fall back to the
        // legacy single key so older templates keep working.
        actionLinks: (tpl?.actionLinks?.length ? tpl.actionLinks : (tpl?.actionLink ? [tpl.actionLink] : [])),
        actionProgress: [],
        // Explicit template override (true/false) or null to inherit the def at runtime.
        requiresLink: (tpl && tpl.requiresLink != null) ? tpl.requiresLink : null,
        startedAt: i === 0 ? received : null,
      });
    }
    return { steps, defs };
  },

  async buildProcessForOrder(order) {
    const existing = await O2DProcess.findOne({ salesOrderId: order._id });
    if (existing) return existing;

    const { steps, defs } = await this._seedSteps(order.receivedAt || order.createdAt || new Date(), ACTIVE_FMS_KEY);
    if (!steps.length) {
      logger.warn(`[O2D-FMS] No active StepDefinitions — process not created for SO ${order.soNumber}`);
      return null;
    }

    // Direct Sales Order (no preceding intake): skip ORDER_INTAKE steps so they
    // don't dangle forever, and start at the first remaining step.
    const defMap = new Map(defs.map((d) => [d.stepCode, d]));
    steps.forEach((s) => {
      if (defMap.get(s.stepCode)?.triggerKey === 'ORDER_INTAKE') { s.status = O2D_STEP_STATUS.SKIPPED; s.startedAt = null; s.planned = null; }
    });
    const firstPending = steps.find((s) => s.status === O2D_STEP_STATUS.PENDING);
    if (firstPending && !firstPending.startedAt) firstPending.startedAt = order.receivedAt || new Date();

    const proc = await O2DProcess.create({
      salesOrderId: order._id,
      source: 'SALES_ORDER',
      soNumber: order.soNumber,
      poNumber: order.poNumber,
      partyName: order.partyName,
      uniqueO2DId: order.uniqueO2DId,
      currentStepCode: firstPending?.stepCode || defs[0].stepCode,
      createdBy: order.createdBy,
      steps,
    });
    // Notify the first active step's doers/buddies so they receive it immediately.
    const firstStep = proc.steps.find((s) => s.stepCode === proc.currentStepCode);
    if (firstStep) { try { await notifyStepOwners(proc, firstStep); } catch (e) { logger.error(`[O2D-FMS] notify first step failed: ${e.message}`); } }
    return proc;
  },

  /** Start the FMS from an Order Intake (call/email/WhatsApp). Completes the
   *  ORDER_INTAKE step. The Sales Order is linked later on conversion. */
  async buildProcessForIntake(intake) {
    const existing = await O2DProcess.findOne({ intakeId: intake._id });
    if (existing) return existing;

    const { steps, defs } = await this._seedSteps(intake.receivedAt || new Date(), ACTIVE_FMS_KEY);
    if (!steps.length) return null;

    const process = await O2DProcess.create({
      intakeId: intake._id,
      source: 'INTAKE',
      soNumber: null,
      partyName: intake.partyName,
      currentStepCode: defs[0].stepCode,
      createdBy: intake.createdBy,
      steps,
    });
    // Auto-complete the "order received" step (whatever is mapped to ORDER_INTAKE).
    try { await this.advanceByTrigger({ processId: process._id }, 'ORDER_INTAKE', intake.createdBy ? { _id: intake.createdBy } : null); }
    catch (err) { logger.error(`[O2D-FMS] ORDER_INTAKE advance failed: ${err.message}`); }
    // Notify whoever owns the current step (no-op auto-advance leaves step 1 active).
    const fresh = await O2DProcess.findById(process._id);
    const curStep = fresh?.steps.find((s) => s.stepCode === fresh.currentStepCode);
    if (curStep) { try { await notifyStepOwners(fresh, curStep); } catch (e) { logger.error(`[O2D-FMS] notify intake step failed: ${e.message}`); } }
    return process;
  },

  /** Conversion: attach the now-created Sales Order to the intake's process and
   *  advance the ORDER_ENTRY step. Keeps a single process across the lifecycle. */
  async linkIntakeProcessToOrder(intakeId, order) {
    const process = await O2DProcess.findOne({ intakeId });
    if (!process) return null;
    process.salesOrderId = order._id;
    process.soNumber = order.soNumber;
    process.poNumber = order.poNumber;
    if (!process.uniqueO2DId) process.uniqueO2DId = order.uniqueO2DId;
    await process.save();
    await this.advanceByTrigger({ processId: process._id }, 'ORDER_ENTRY', order.createdBy ? { _id: order.createdBy } : null);
    return process;
  },

  async listProcesses(query) {
    const features = new ApiFeatures(O2DProcess.find({ isDeleted: { $ne: true } }), query)
      .filter().search(['soNumber', 'poNumber', 'partyName', 'uniqueO2DId']).sort().paginate();
    const { docs, pagination } = await features.exec();
    const defMap = await loadDefMap();
    return { docs: docs.map((d) => enrichSteps(d, defMap)), pagination };
  },

  async getProcessById(id) {
    const process = await O2DProcess.findById(id)
      .populate('steps.assignees steps.buddies', 'name email role')
      .populate('steps.assignedTo', 'name email role')
      .populate('steps.buddyUserId', 'name email role')
      .populate('steps.completedBy', 'name email role')
      .populate('steps.comments.userId', 'name')
      .populate('activityTimeline.actorId', 'name');
    if (!process) throw new AppError('O2D process not found', 404);
    const defMap = await loadDefMap();
    return enrichSteps(process, defMap);
  },

  async getProcessByOrder(salesOrderId) {
    const process = await O2DProcess.findOne({ salesOrderId })
      .populate('steps.assignees steps.buddies', 'name email role')
      .populate('steps.assignedTo', 'name email role')
      .populate('steps.buddyUserId', 'name email role')
      .populate('steps.completedBy', 'name email role')
      .populate('steps.comments.userId', 'name')
      .populate('activityTimeline.actorId', 'name');
    if (!process) return null;
    const defMap = await loadDefMap();
    return enrichSteps(process, defMap);
  },

  // ── Doer actions ──────────────────────────────────────────────────────────

  /** Complete a single step: stamp actual, compute delay, advance the flow.
   *  opts.bypassRequirements — skip link/attachment gates (used by the auto-advance
   *  bridge, since the real action already happened in another module). */
  async completeStep(processId, stepCode, payload, user, opts = {}) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);

    const idx = process.steps.findIndex((s) => s.stepCode === stepCode);
    if (idx === -1) throw new AppError(`Step '${stepCode}' not found on this process`, 404);

    const step = process.steps[idx];
    if (!opts.bypassRequirements) assertCanAct(step, user, opts.privileged);
    if ([O2D_STEP_STATUS.DONE, O2D_STEP_STATUS.DELAYED].includes(step.status)) {
      throw new AppError(`Step '${stepCode}' is already completed`, 409);
    }

    const defMap = await loadDefMap();
    const def = defMap.get(stepCode);
    if (!opts.bypassRequirements) {
      // Quantity-gated (phased dispatch): can't be ticked done while qty is pending —
      // it completes automatically once every phase is dispatched (balance 0).
      if (isQuantityGated(def)) {
        const summary = await computeOrderDispatchSummary(process);
        if (!summary.fullyDispatched) {
          throw new AppError(
            `Not fully dispatched yet — ${summary.dispatchedQty}/${summary.orderedQty} pcs (${summary.balanceQty} pending across phases). `
            + 'This step completes automatically when all phases are dispatched.',
            422,
          );
        }
      }
      // One gate for every requirement type: checklist, yes/no verifications,
      // data fields, proof attachments, approval, link.
      const unmet = unmetRequirements(step, def, payload);
      if (unmet.length) throw new AppError(`Cannot complete yet — ${unmet.join('; ')}.`, 422);
    }

    const actual = new Date();
    step.actual = actual;
    step.completedBy = user?._id || null;
    if (payload.link !== undefined) step.link = payload.link;
    if (payload.remarks !== undefined) step.remarks = payload.remarks;
    if (payload.attachments?.length) step.attachments.push(...payload.attachments);
    step.delayMins = computeDelayMins(step.planned, actual);
    step.status = step.delayMins > 0 ? O2D_STEP_STATUS.DELAYED : O2D_STEP_STATUS.DONE;

    // Advance: set the next step's planned (lead time wins over SLA), mark it
    // started, and move currentStep.
    const next = process.steps[idx + 1];
    if (next) {
      const nextDef = defMap.get(next.stepCode);
      // Planned dates are scheduled up-front from cumulative lead/SLA time. Only
      // fill one in if it's somehow missing — never override the schedule (keeps
      // the plan monotonic and faithful to the configured lead times).
      if (!next.planned) {
        const mins = next.leadTimeMins ?? nextDef?.slaMinutes ?? 60;
        next.planned = addMinutes(actual, mins);
      }
      next.startedAt = actual;
      process.currentStepCode = next.stepCode;
      await notifyStepOwners(process, next);
    } else {
      process.isCompleted = true;
      process.completedAt = actual;
      process.currentStepCode = null;
    }

    process.activityTimeline.push({
      action: 'STEP_COMPLETED',
      description: `${stepCode} completed${step.delayMins > 0 ? ` (late by ${step.delayMins} min)` : ''}`,
      actorId: user?._id || null,
    });

    await process.save();
    return enrichSteps(process, defMap);
  },

  /** Mark ONE of a step's connected action-links as done (e.g. the doer finished
   *  that screen's entry and came back). Does NOT complete the step — a step can
   *  have several linked actions and none are mandatory. Idempotent per key. */
  async markActionDone(processId, stepCode, { actionKey, link }, user, privileged = false) {
    if (!actionKey) throw new AppError('actionKey is required', 400);
    return withVersionRetry(async () => {
      const process = await O2DProcess.findById(processId);
      if (!process) throw new AppError('O2D process not found', 404);
      const step = process.steps.find((s) => s.stepCode === stepCode);
      if (!step) throw new AppError(`Step '${stepCode}' not found on this process`, 404);
      assertCanAct(step, user, privileged);

      if (!Array.isArray(step.actionProgress)) step.actionProgress = [];
      const existing = step.actionProgress.find((a) => a.key === actionKey);
      if (existing) {
        existing.doneAt = new Date();
        if (link) existing.link = link;
        existing.doneBy = user?._id || existing.doneBy || null;
        existing.doneByName = user?.name || existing.doneByName || null;
      } else {
        step.actionProgress.push({
          key: actionKey,
          link: link || null,
          doneAt: new Date(),
          doneBy: user?._id || null,
          doneByName: user?.name || null,
        });
      }
      process.activityTimeline.push({
        action: 'STEP_ACTION_DONE',
        description: `${stepCode} · action "${actionKey}" completed`,
        actorId: user?._id || null,
      });
      await process.save();
      const defMap = await loadDefMap();
      return enrichSteps(process, defMap);
    });
  },

  /** Per-order reassignment — set multiple doers and/or buddies on a step. */
  async assignStep(processId, stepCode, { assignees = [], buddies = [] }, actor) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);
    const step = process.steps.find((s) => s.stepCode === stepCode);
    if (!step) throw new AppError(`Step '${stepCode}' not found on this process`, 404);

    step.assignees = assignees || [];
    step.buddies = buddies || [];
    step.assignedTo = step.assignees[0] || null;   // primary mirror
    step.buddyUserId = step.buddies[0] || null;
    process.activityTimeline.push({
      action: 'STEP_REASSIGNED',
      description: `${stepCode} reassigned (${step.assignees.length} doer(s), ${step.buddies.length} buddy(ies))`,
      actorId: actor?._id || null,
    });
    await process.save();
    if (step.status === O2D_STEP_STATUS.PENDING && (step.assignees.length || step.buddies.length)) {
      await notifyStepOwners(process, step);
    }
    const defMap = await loadDefMap();
    return enrichSteps(process, defMap);
  },

  /**
   * Auto-advance bridge. Called by other modules after a real business action
   * (dispatch plan saved, actual dispatch recorded, invoice created…). Finds the
   * order's process, locates the first non-done step whose definition has the
   * matching triggerKey, and completes it. Non-fatal: callers wrap in try/catch.
   *
   * @param orderRef  { salesOrderId } or { soNumber }
   */
  async advanceByTrigger(orderRef, triggerKey, actor = null) {
    let query = null;
    if (orderRef?.processId) query = { _id: orderRef.processId };
    else if (orderRef?.salesOrderId) query = { salesOrderId: orderRef.salesOrderId };
    else if (orderRef?.intakeId) query = { intakeId: orderRef.intakeId };
    else if (orderRef?.soNumber) query = { soNumber: orderRef.soNumber };
    if (!query) return null;

    const process = await O2DProcess.findOne(query);
    if (!process) return null;

    const defMap = await loadDefMap();
    const target = process.steps.find((s) =>
      ![O2D_STEP_STATUS.DONE, O2D_STEP_STATUS.DELAYED, O2D_STEP_STATUS.SKIPPED].includes(s.status)
      && defMap.get(s.stepCode)?.triggerKey === triggerKey);
    if (!target) return null;

    // Phased / split dispatch: the dispatch step completes only when the whole order
    // is dispatched. Each dispatch refreshes progress and keeps the step IN_PROGRESS
    // (downstream still flows per consignment) until balance hits 0.
    if (isQuantityGated(defMap.get(target.stepCode))) {
      return applyPhasedDispatch(process, target, defMap, actor);
    }

    // If the step still has unmet requirements (checklist, verifications, data
    // fields, proof, approval), the real action only makes it the ACTIVE task —
    // the doer must still satisfy them. A step is never shown "complete" early.
    const unmet = unmetRequirements(target, defMap.get(target.stepCode), {});
    if (unmet.length) {
      if (!target.startedAt) target.startedAt = new Date();
      process.currentStepCode = target.stepCode;
      target.comments.push({
        userName: 'System',
        text: `${triggerKey.replace('_', ' ').toLowerCase()} done automatically — still needed: ${unmet.join('; ')}.`,
        at: new Date(),
      });
      process.activityTimeline.push({
        action: 'TRIGGER_AWAITS_CHECKLIST',
        description: `${target.stepCode} · ${triggerKey} done; requirements pending`,
        actorId: actor?._id || null,
      });
      await process.save();
      return enrichSteps(process, defMap);
    }

    // Nothing left — the real action IS the proof, so auto-complete & advance.
    return this.completeStep(
      process._id, target.stepCode,
      { remarks: `Auto-completed by ${triggerKey}` }, actor,
      { bypassRequirements: true },
    );
  },

  /**
   * Resolve the CURRENT (active) task for an order so a module entry can jump the
   * doer straight to it: returns { processId, stepCode } or null. Picks the
   * process's currentStepCode, else the first not-done/not-skipped step.
   */
  async getActiveTask({ soNumber, salesOrderId, intakeId } = {}) {
    let q = null;
    if (salesOrderId) q = { salesOrderId };
    else if (intakeId) q = { intakeId };
    else if (soNumber) q = { soNumber };
    if (!q) return null;
    const p = await O2DProcess.findOne({ ...q, isDeleted: { $ne: true } }).lean();
    if (!p) return null;
    const openCodes = [O2D_STEP_STATUS.DONE, O2D_STEP_STATUS.DELAYED, O2D_STEP_STATUS.SKIPPED];
    const stepCode = p.currentStepCode
      || (p.steps.find((s) => !openCodes.includes(s.status))?.stepCode)
      || null;
    return stepCode ? { processId: String(p._id), stepCode } : null;
  },

  /**
   * Sequential gate: can the doer perform `action` on this order yet?
   *
   * Maps the action (an action-link key like DISPATCH_PLAN, or a trigger key like
   * ACTUAL_DISPATCH) to its FMS step, then blocks if ANY earlier step is still
   * pending. Returns the earliest blocking step + a deep-link to its task so the
   * UI can say "finish step X.XX first" and send the doer straight there.
   *
   * Fail-open: no process / un-wired action ⇒ allowed (never blocks non-FMS work).
   */
  async getActionGate({ soNumber, salesOrderId, intakeId, action } = {}) {
    if (!action) return { allowed: true, ungated: true };
    let q = null;
    if (salesOrderId) q = { salesOrderId };
    else if (intakeId) q = { intakeId };
    else if (soNumber) q = { soNumber };
    if (!q) return { allowed: true, ungated: true };

    const process = await O2DProcess.findOne({ ...q, isDeleted: { $ne: true } });
    if (!process) return { allowed: true, ungated: true, reason: 'No FMS process for this order yet.' };

    const defMap = await loadDefMap();
    const enriched = enrichSteps(process, defMap); // sorted by sequence; has name/sequence/triggerKey/actionLinks
    const steps = enriched.steps || [];
    const keysOf = (s) => (s.actionLinks?.length ? s.actionLinks : (s.actionLink ? [s.actionLink] : []));
    // The step this action belongs to — by its connected action-link OR its trigger key.
    const target = steps.find((s) => keysOf(s).includes(action) || s.triggerKey === action);
    if (!target) return { allowed: true, ungated: true, reason: 'This action is not gated by the FMS.' };

    const DONE = [O2D_STEP_STATUS.DONE, O2D_STEP_STATUS.DELAYED, O2D_STEP_STATUS.SKIPPED];
    const blocking = steps
      .filter((s) => (s.sequence || 0) < (target.sequence || 0))
      .find((s) => !DONE.includes(s.status));

    const targetStep = { stepCode: target.stepCode, name: target.name || target.taskTitle || target.stepCode };
    if (!blocking) {
      return { allowed: true, processId: String(process._id), soNumber: process.soNumber, targetStep };
    }
    const name = blocking.name || blocking.taskTitle || blocking.stepCode;
    return {
      allowed: false,
      processId: String(process._id),
      soNumber: process.soNumber,
      action,
      targetStep,
      blockingStep: {
        stepCode: blocking.stepCode,
        name,
        status: blocking.status,
        taskUrl: `/o2d-fms/task/${String(process._id)}/${encodeURIComponent(blocking.stepCode)}`,
      },
      reason: `Step ${blocking.stepCode} — “${name}” — must be completed first.`,
    };
  },

  /** Throwing wrapper for server-side enforcement on the connected mutations. */
  async assertActionAllowed(ctx = {}) {
    const gate = await this.getActionGate(ctx);
    if (gate && gate.allowed === false) {
      const err = new AppError(
        `Can’t do this yet — ${gate.reason} Open the task to complete it first.`,
        409,
      );
      err.gate = gate; // structured payload for clients that surface it
      throw err;
    }
    return gate;
  },

  /** The doer's "My Tasks" — every step where I'm the owner OR buddy, with its
   *  status, so the UI can show actionable (pending) vs completed. */
  async getMyTasks(user, query = {}) {
    const uid = String(user._id);
    const filter = {
      isDeleted: { $ne: true },
      steps: { $elemMatch: { $or: [
        { assignees: user._id }, { assignedTo: user._id },
        { buddies: user._id }, { buddyUserId: user._id },
      ] } },
    };
    const processes = await O2DProcess.find(filter).lean();
    const defMap = await loadDefMap();

    const tasks = [];
    for (const p of processes) {
      for (const s of p.steps) {
        const isOwner = stepDoerIds(s).includes(uid);
        const isBuddy = stepBuddyIds(s).includes(uid);
        if (!isOwner && !isBuddy) continue;
        const def = defMap.get(s.stepCode);
        const checklist = s.checklist || [];
        const isDone = [O2D_STEP_STATUS.DONE, O2D_STEP_STATUS.DELAYED].includes(s.status);
        tasks.push({
          processId: p._id,
          salesOrderId: p.salesOrderId,
          soNumber: p.soNumber,
          partyName: p.partyName,
          stepCode: s.stepCode,
          stepId: s._id,
          name: s.taskTitle || def?.name || s.stepCode,
          tool: def?.tool || null,
          description: s.instructions || def?.description || '',
          asBuddy: isBuddy && !isOwner,
          status: s.status,
          requiresLink: s.requiresLink != null ? !!s.requiresLink : !!def?.requiresLink,
          requiresAttachment: !!def?.requiresAttachment,
          checklistTotal: checklist.length,
          checklistDone: checklist.filter((c) => c.done).length,
          planned: s.planned,
          completedAt: s.actual,
          delayMins: s.delayMins || 0,
          dispatchProgress: s.dispatchProgress || null, // phased dispatch: "1,000 / 5,000"
          isOverdue: !isDone && !!(s.planned && new Date(s.planned) < new Date()),
        });
      }
    }
    // Actionable first (pending / in-progress, most overdue), completed after.
    const isActionable = (st) => ![O2D_STEP_STATUS.DONE, O2D_STEP_STATUS.DELAYED, O2D_STEP_STATUS.SKIPPED].includes(st);
    tasks.sort((a, b) => {
      const ap = isActionable(a.status) ? 0 : 1;
      const bp = isActionable(b.status) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return new Date(a.planned || 0) - new Date(b.planned || 0);
    });
    return tasks;
  },

  /** Manager/MD view — every step across every order as a task row, with the
   *  doers, status and timing. Frontend filters & computes stats client-side. */
  async getAllTasks() {
    const processes = await O2DProcess.find({ isDeleted: { $ne: true } })
      .populate('steps.assignees steps.assignedTo steps.completedBy', 'name')
      .lean();
    const defMap = await loadDefMap();
    const now = Date.now();
    const tasks = [];
    for (const p of processes) {
      for (const s of p.steps) {
        const def = defMap.get(s.stepCode);
        const isDone = [O2D_STEP_STATUS.DONE, O2D_STEP_STATUS.DELAYED].includes(s.status);
        const doerObjs = (s.assignees?.length ? s.assignees : [s.assignedTo]).filter(Boolean);
        tasks.push({
          processId: p._id,
          stepCode: s.stepCode,
          soNumber: p.soNumber || (p.source === 'INTAKE' ? 'Intake' : ''),
          partyName: p.partyName,
          name: s.taskTitle || def?.name || s.stepCode,
          status: s.status,
          doers: doerObjs.map((u) => ({ _id: String(u._id || u), name: u.name || 'User' })),
          completedBy: s.completedBy?.name || null,
          planned: s.planned,
          completedAt: s.actual,
          delayMins: s.delayMins || 0,
          checklistTotal: (s.checklist || []).length,
          checklistDone: (s.checklist || []).filter((c) => c.done).length,
          isOverdue: !isDone && !!(s.planned && new Date(s.planned) < now),
        });
      }
    }
    return tasks;
  },

  /** Tick / untick a checklist item on a step. */
  async toggleChecklistItem(processId, stepCode, itemId, done, user, privileged = false) {
    return withVersionRetry(async () => {
      const process = await O2DProcess.findById(processId);
      if (!process) throw new AppError('O2D process not found', 404);
      const step = process.steps.find((s) => s.stepCode === stepCode);
      if (!step) throw new AppError(`Step '${stepCode}' not found`, 404);
      assertCanAct(step, user, privileged);
      const item = step.checklist.id(itemId);
      if (!item) throw new AppError('Checklist item not found', 404);
      item.done = !!done;
      item.doneBy = done ? user?._id || null : null;
      item.doneByName = done ? user?.name || null : null;
      item.doneAt = done ? new Date() : null;
      process.activityTimeline.push({
        action: done ? 'CHECKLIST_TICKED' : 'CHECKLIST_UNTICKED',
        description: `${stepCode} · ${item.text}`,
        actorId: user?._id || null,
      });
      await process.save();
      const defMap = await loadDefMap();
      return enrichSteps(process, defMap);
    });
  },

  /** Answer a Yes/No verification question. A "NO" must carry a remark. */
  async answerVerification(processId, stepCode, itemId, answer, remark, user, privileged = false) {
    return withVersionRetry(async () => {
      const process = await O2DProcess.findById(processId);
      if (!process) throw new AppError('O2D process not found', 404);
      const step = process.steps.find((s) => s.stepCode === stepCode);
      if (!step) throw new AppError(`Step '${stepCode}' not found`, 404);
      assertCanAct(step, user, privileged);
      const item = step.verifications.id(itemId);
      if (!item) throw new AppError('Verification question not found', 404);
      if (answer === 'NO' && !remark?.trim()) {
        throw new AppError('Answering "No" needs a short remark explaining why', 422);
      }
      item.answer = answer || null; // null = cleared
      item.remark = answer === 'NO' ? remark.trim() : null;
      item.answeredBy = answer ? user?._id || null : null;
      item.answeredByName = answer ? user?.name || null : null;
      item.answeredAt = answer ? new Date() : null;
      process.activityTimeline.push({
        action: 'VERIFICATION_ANSWERED',
        description: `${stepCode} · ${item.question} → ${answer || 'cleared'}`,
        actorId: user?._id || null,
      });
      await process.save();
      return enrichSteps(process, await loadDefMap());
    });
  },

  /** Fill (or clear) a data-capture field on a step. */
  async fillFormField(processId, stepCode, itemId, value, user, privileged = false) {
    return withVersionRetry(async () => {
      const process = await O2DProcess.findById(processId);
      if (!process) throw new AppError('O2D process not found', 404);
      const step = process.steps.find((s) => s.stepCode === stepCode);
      if (!step) throw new AppError(`Step '${stepCode}' not found`, 404);
      assertCanAct(step, user, privileged);
      const item = step.formFields.id(itemId);
      if (!item) throw new AppError('Field not found', 404);
      const has = !(value === null || value === undefined || value === '');
      item.value = has ? value : null;
      item.filledBy = has ? user?._id || null : null;
      item.filledByName = has ? user?.name || null : null;
      item.filledAt = has ? new Date() : null;
      process.activityTimeline.push({
        action: 'FIELD_FILLED',
        description: `${stepCode} · ${item.label}${has ? ` = ${String(value).slice(0, 80)}` : ' cleared'}`,
        actorId: user?._id || null,
      });
      await process.save();
      return enrichSteps(process, await loadDefMap());
    });
  },

  /** Approve a step's approval gate. Only a named approver (or root) may approve. */
  async approveStep(processId, stepCode, user, privileged = false) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);
    const step = process.steps.find((s) => s.stepCode === stepCode);
    if (!step) throw new AppError(`Step '${stepCode}' not found`, 404);
    if (!step.approval?.required) throw new AppError('This step has no approval gate', 409);
    if (step.approval.approvedBy) throw new AppError('Already approved', 409);
    const uid = String(user?._id || '');
    const isApprover = (step.approval.approverIds || []).map(String).includes(uid);
    if (!isApprover && !privileged) {
      throw new AppError('Only the named approver can approve this step', 403);
    }
    step.approval.approvedBy = user?._id || null;
    step.approval.approvedByName = user?.name || null;
    step.approval.approvedAt = new Date();
    process.activityTimeline.push({
      action: 'STEP_APPROVED',
      description: `${stepCode} approved by ${user?.name || 'user'}`,
      actorId: user?._id || null,
    });
    await process.save();
    // Tell the doers their gate is open.
    await notifyStepOwners(process, step).catch(() => {});
    return enrichSteps(process, await loadDefMap());
  },

  /** Add a comment to a step. */
  async addComment(processId, stepCode, text, user, privileged = false) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);
    const step = process.steps.find((s) => s.stepCode === stepCode);
    if (!step) throw new AppError(`Step '${stepCode}' not found`, 404);
    assertCanAct(step, user, privileged);
    step.comments.push({ userId: user?._id || null, userName: user?.name || null, text, at: new Date() });
    await process.save();
    const defMap = await loadDefMap();
    return enrichSteps(
      await O2DProcess.findById(processId)
        .populate('steps.assignedTo steps.buddyUserId steps.completedBy', 'name email role'),
      defMap,
    );
  },

  /** Attach proof files / voice notes to a step. */
  async addAttachments(processId, stepCode, items, user, privileged = false) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);
    const step = process.steps.find((s) => s.stepCode === stepCode);
    if (!step) throw new AppError(`Step '${stepCode}' not found`, 404);
    assertCanAct(step, user, privileged);

    const kindOf = (mime = '') => (mime.startsWith('audio/') ? 'audio'
      : mime.startsWith('video/') ? 'video'
      : mime.startsWith('image/') ? 'image' : 'file');

    for (const it of items || []) {
      step.attachments.push({
        fileName: it.fileName, fileUrl: it.fileUrl, fileKey: it.fileKey || null,
        fileType: it.fileType || null, sizeBytes: it.sizeBytes || 0,
        kind: it.kind || kindOf(it.fileType), uploadedBy: user?._id || null,
        uploadedByName: user?.name || null, uploadedAt: new Date(),
      });
    }
    process.activityTimeline.push({
      action: 'STEP_ATTACHMENT', description: `${items?.length || 0} file(s) attached to ${stepCode}`, actorId: user?._id || null,
    });
    await process.save();
    const defMap = await loadDefMap();
    return enrichSteps(
      await O2DProcess.findById(processId)
        .populate('steps.assignedTo steps.buddyUserId steps.completedBy', 'name email role'),
      defMap,
    );
  },

  /** Remove an attachment from a step (and from S3 if applicable). */
  async removeAttachment(processId, stepCode, attachmentId, user, privileged = false) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);
    const step = process.steps.find((s) => s.stepCode === stepCode);
    if (!step) throw new AppError(`Step '${stepCode}' not found`, 404);
    assertCanAct(step, user, privileged);
    const att = step.attachments.id(attachmentId);
    if (att?.fileKey) { try { const { deleteObject } = await import('../../common/uploads/s3.service.js'); await deleteObject(att.fileKey); } catch { /* non-fatal */ } }
    step.attachments.pull(attachmentId);
    await process.save();
    const defMap = await loadDefMap();
    return enrichSteps(process, defMap);
  },

  /** Per-order custom plan: override task/assignee/buddy/leadTime/checklist per step. */
  async planOrder(processId, stepsPlan, actor) {
    const process = await O2DProcess.findById(processId);
    if (!process) throw new AppError('O2D process not found', 404);

    for (const sp of stepsPlan || []) {
      const step = process.steps.find((s) => s.stepCode === sp.stepCode);
      if (!step) continue;
      if (sp.taskTitle !== undefined) step.taskTitle = sp.taskTitle;
      if (sp.instructions !== undefined) step.instructions = sp.instructions;
      if (sp.assignees !== undefined) {
        step.assignees = sp.assignees || [];
        step.assignedTo = step.assignees[0] || null;
      } else if (sp.assignedTo !== undefined) {
        step.assignedTo = sp.assignedTo || null;
        step.assignees = sp.assignedTo ? [sp.assignedTo] : [];
      }
      if (sp.buddies !== undefined) {
        step.buddies = sp.buddies || [];
        step.buddyUserId = step.buddies[0] || null;
      } else if (sp.buddyUserId !== undefined) {
        step.buddyUserId = sp.buddyUserId || null;
        step.buddies = sp.buddyUserId ? [sp.buddyUserId] : [];
      }
      if (sp.leadTime !== undefined) {
        const mins = leadTimeToMins(sp.leadTime);
        if (mins != null) {
          step.leadTimeMins = mins;
          // Re-time a not-yet-started step from now (only if still pending & unplanned-by-actual).
          if (step.status === O2D_STEP_STATUS.PENDING && step.startedAt) {
            step.planned = addMinutes(step.startedAt, mins);
          }
        }
      }
      if (Array.isArray(sp.checklist)) {
        // Replace checklist, preserving done-state for matching texts.
        const prev = new Map((step.checklist || []).map((c) => [c.text, c]));
        step.checklist = sp.checklist.map((c) => {
          const old = prev.get(c.text);
          return { text: c.text, done: old?.done || false, doneBy: old?.doneBy || null, doneByName: old?.doneByName || null, doneAt: old?.doneAt || null };
        });
      }
      if (sp.actionLink !== undefined) step.actionLink = sp.actionLink || null;
      if (sp.actionLinks !== undefined) step.actionLinks = sp.actionLinks || [];
      if (sp.requiresLink !== undefined) step.requiresLink = sp.requiresLink; // true/false, or null to inherit
      process.activityTimeline.push({
        action: 'STEP_PLAN_UPDATED',
        description: `${sp.stepCode} · task/plan updated`,
        actorId: actor?._id || null,
      });
    }
    await process.save();
    const defMap = await loadDefMap();
    return enrichSteps(process, defMap);
  },

  // ── MD dashboard ────────────────────────────────────────────────────────--

  async getDashboard() {
    const now = new Date();

    const [byStep, byPerson, totals, overdue, stageAgg, orderTotals, orderByStatus] = await Promise.all([
      // Bottleneck: pending count, overdue count and total delay per step.
      O2DProcess.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $unwind: '$steps' },
        { $group: {
          _id: '$steps.stepCode',
          pending:  { $sum: { $cond: [{ $eq: ['$steps.status', 'PENDING'] }, 1, 0] } },
          overdue:  { $sum: { $cond: [{ $and: [
            { $eq: ['$steps.status', 'PENDING'] },
            { $ne: ['$steps.planned', null] },
            { $lt: ['$steps.planned', now] },
          ] }, 1, 0] } },
          delayMins: { $sum: '$steps.delayMins' },
          completed: { $sum: { $cond: [{ $in: ['$steps.status', ['DONE', 'DELAYED']] }, 1, 0] } },
        } },
        { $sort: { delayMins: -1 } },
      ]),
      // Accountability: pending load + accumulated delay per assigned person.
      O2DProcess.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $unwind: '$steps' },
        { $match: { 'steps.assignedTo': { $ne: null } } },
        { $group: {
          _id: '$steps.assignedTo',
          pending:  { $sum: { $cond: [{ $eq: ['$steps.status', 'PENDING'] }, 1, 0] } },
          overdue:  { $sum: { $cond: [{ $and: [
            { $eq: ['$steps.status', 'PENDING'] },
            { $ne: ['$steps.planned', null] },
            { $lt: ['$steps.planned', now] },
          ] }, 1, 0] } },
          delayMins: { $sum: '$steps.delayMins' },
        } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        { $project: { name: '$user.name', email: '$user.email', pending: 1, overdue: 1, delayMins: 1 } },
        { $sort: { delayMins: -1 } },
      ]),
      O2DProcess.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: ['$isCompleted', 1, 0] } },
          inProgress: { $sum: { $cond: ['$isCompleted', 0, 1] } },
        } },
      ]),
      // Flat list of overdue steps for the action table.
      O2DProcess.aggregate([
        { $match: { isCompleted: false, isDeleted: { $ne: true } } },
        { $unwind: '$steps' },
        { $match: { 'steps.status': 'PENDING', 'steps.planned': { $ne: null, $lt: now } } },
        { $lookup: { from: 'users', localField: 'steps.assignedTo', foreignField: '_id', as: 'owner' } },
        { $unwind: { path: '$owner', preserveNullAndEmptyArrays: true } },
        { $project: {
          processId: '$_id', soNumber: 1, partyName: 1,
          stepCode: '$steps.stepCode', planned: '$steps.planned',
          ownerName: '$owner.name', ownerEmail: '$owner.email',
          overdueMins: { $round: [{ $divide: [{ $subtract: [now, '$steps.planned'] }, 60000] }, 0] },
        } },
        { $sort: { overdueMins: -1 } },
        { $limit: 100 },
      ]),
      // Stage funnel source: done / pending counts per stepCode across all orders.
      O2DProcess.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        { $unwind: '$steps' },
        { $group: {
          _id: '$steps.stepCode',
          done:    { $sum: { $cond: [{ $in: ['$steps.status', ['DONE', 'DELAYED']] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$steps.status', 'PENDING'] }, 1, 0] } },
          total:   { $sum: 1 },
        } },
      ]),
      // Order business totals (qty-based) — the real operational numbers.
      SalesOrder.aggregate([
        { $group: {
          _id: null,
          totalOrders:        { $sum: 1 },
          totalOrderQty:      { $sum: '$totalOrderQty' },
          totalDispatchedQty: { $sum: '$totalDispatchedQty' },
          totalBalanceQty:    { $sum: '$totalBalanceQty' },
        } },
      ]),
      // Orders grouped by lifecycle status.
      SalesOrder.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, qty: { $sum: '$totalOrderQty' } } },
      ]),
    ]);

    const defMap = await loadDefMap();
    const labelStep = (rows) => rows.map((r) => ({ ...r, name: defMap.get(r._id)?.name || r._id }));

    // ── Build the O2D stage funnel: how many orders cleared each business stage.
    // We bucket each step (by its definition's triggerKey) into a canonical stage
    // so it works for any FMS catalog (V1 or CURRENT_SHEET). MANUAL steps are
    // ignored here — they don't map to a business milestone.
    const STAGE_ORDER = [
      { key: TRIGGER_KEY.ORDER_INTAKE,    label: 'Order Received' },
      { key: TRIGGER_KEY.ORDER_ENTRY,     label: 'Order Entry' },
      { key: TRIGGER_KEY.DISPATCH_PLAN,   label: 'Dispatch Planned' },
      { key: TRIGGER_KEY.ACTUAL_DISPATCH, label: 'Dispatched' },
      { key: TRIGGER_KEY.INVOICE,         label: 'Invoiced' },
      { key: TRIGGER_KEY.POD,             label: 'Delivered (POD)' },
      { key: TRIGGER_KEY.PAYMENT,         label: 'Payment Received' },
    ];
    const stageMap = new Map(STAGE_ORDER.map((s) => [s.key, { ...s, done: 0, pending: 0, total: 0 }]));
    stageAgg.forEach((row) => {
      const trigger = defMap.get(row._id)?.triggerKey;
      const bucket = trigger && stageMap.get(trigger);
      if (!bucket) return;
      bucket.done += row.done;
      bucket.pending += row.pending;
      bucket.total += row.total;
    });
    const stageFunnel = STAGE_ORDER.map((s) => stageMap.get(s.key)).filter((s) => s.total > 0);
    const stageOf = (key) => stageMap.get(key) || { done: 0, pending: 0, total: 0 };

    const ot = orderTotals[0] || { totalOrders: 0, totalOrderQty: 0, totalDispatchedQty: 0, totalBalanceQty: 0 };
    const fulfillmentPct = ot.totalOrderQty > 0
      ? Math.round((ot.totalDispatchedQty / ot.totalOrderQty) * 100) : 0;

    return {
      totals: totals[0] || { total: 0, completed: 0, inProgress: 0 },
      overdueCount: overdue.length,
      byStep: labelStep(byStep),
      byPerson,
      overdue: overdue.map((o) => ({ ...o, name: defMap.get(o.stepCode)?.name || o.stepCode })),
      // ── Operational order intelligence (qty + stage based) ──
      orderStats: {
        ...ot,
        fulfillmentPct,
        byStatus: orderByStatus,
        // Headline counts straight from the step flow.
        planningPending: stageOf(TRIGGER_KEY.DISPATCH_PLAN).pending,
        dispatched:      stageOf(TRIGGER_KEY.ACTUAL_DISPATCH).done,
        invoiced:        stageOf(TRIGGER_KEY.INVOICE).done,
        delivered:       stageOf(TRIGGER_KEY.POD).done,
        paid:            stageOf(TRIGGER_KEY.PAYMENT).done,
        awaitingDispatch: stageOf(TRIGGER_KEY.ACTUAL_DISPATCH).pending,
        awaitingPayment:  stageOf(TRIGGER_KEY.PAYMENT).pending,
      },
      stageFunnel,
    };
  },

  /**
   * Doer scoreboard — per-person performance over completed steps.
   *   punctuality  = % of completed steps finished on/before planned
   *   avgDelayMins = mean lateness across completed steps
   *   throughput   = number of steps completed
   *   accuracy     = % of checklist items that were ticked (vs total) on their steps
   */
  async getDoerScores() {
    const rows = await O2DProcess.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $unwind: '$steps' },
      { $match: { 'steps.status': { $in: ['DONE', 'DELAYED'] }, 'steps.completedBy': { $ne: null } } },
      { $group: {
        _id: '$steps.completedBy',
        throughput: { $sum: 1 },
        onTime:     { $sum: { $cond: [{ $eq: ['$steps.delayMins', 0] }, 1, 0] } },
        totalDelay: { $sum: '$steps.delayMins' },
        checklistTotal: { $sum: { $size: { $ifNull: ['$steps.checklist', []] } } },
        checklistDone:  { $sum: { $size: { $filter: { input: { $ifNull: ['$steps.checklist', []] }, as: 'c', cond: '$$c.done' } } } },
      } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      { $project: {
        name: '$user.name', email: '$user.email',
        throughput: 1, totalDelay: 1,
        punctuality: { $round: [{ $multiply: [{ $cond: [{ $gt: ['$throughput', 0] }, { $divide: ['$onTime', '$throughput'] }, 0] }, 100] }, 0] },
        avgDelayMins: { $round: [{ $cond: [{ $gt: ['$throughput', 0] }, { $divide: ['$totalDelay', '$throughput'] }, 0] }, 0] },
        accuracy: { $round: [{ $multiply: [{ $cond: [{ $gt: ['$checklistTotal', 0] }, { $divide: ['$checklistDone', '$checklistTotal'] }, 1] }, 100] }, 0] },
      } },
      { $sort: { punctuality: -1, throughput: -1 } },
    ]);
    return rows;
  },

  /**
   * MIS Scoring — comprehensive per-doer KRA/KPI across ALL their assigned steps
   * (not just completed). Returns assigned/completed/pending/overdue/on-time/late,
   * delay, checklist accuracy and the penalty-based MIS score (≤ 0).
   */
  async getMisScores() {
    const now = new Date();
    const DONE = ['DONE', 'DELAYED'];
    const rows = await O2DProcess.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $unwind: '$steps' },
      { $match: { 'steps.assignedTo': { $ne: null } } },
      { $group: {
        _id: '$steps.assignedTo',
        assigned:  { $sum: 1 },
        completed: { $sum: { $cond: [{ $in: ['$steps.status', DONE] }, 1, 0] } },
        pending:   { $sum: { $cond: [{ $eq: ['$steps.status', 'PENDING'] }, 1, 0] } },
        overdue:   { $sum: { $cond: [{ $and: [{ $eq: ['$steps.status', 'PENDING'] }, { $ne: ['$steps.planned', null] }, { $lt: ['$steps.planned', now] }] }, 1, 0] } },
        onTime:    { $sum: { $cond: [{ $and: [{ $in: ['$steps.status', DONE] }, { $eq: ['$steps.delayMins', 0] }] }, 1, 0] } },
        late:      { $sum: { $cond: [{ $and: [{ $in: ['$steps.status', DONE] }, { $gt: ['$steps.delayMins', 0] }] }, 1, 0] } },
        totalDelay:{ $sum: '$steps.delayMins' },
        checklistTotal: { $sum: { $size: { $ifNull: ['$steps.checklist', []] } } },
        checklistDone:  { $sum: { $size: { $filter: { input: { $ifNull: ['$steps.checklist', []] }, as: 'c', cond: '$$c.done' } } } },
      } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    ]);

    const doers = rows.map((r) => ({
      userId: String(r._id),
      name: r.user?.name || 'Unassigned',
      email: r.user?.email || '',
      role: r.user?.role || (r.user?.roles || [])[0] || '',
      assigned: r.assigned, completed: r.completed, pending: r.pending, overdue: r.overdue,
      onTime: r.onTime, late: r.late, totalDelayMins: r.totalDelay,
      ...computeMis(r),
    })).sort((a, b) => b.misScore - a.misScore); // best (least-negative) first

    const totals = doers.reduce((a, d) => {
      a.doers += 1; a.assigned += d.assigned; a.completed += d.completed;
      a.pending += d.pending; a.overdue += d.overdue; a.misScore += d.misScore;
      return a;
    }, { doers: 0, assigned: 0, completed: 0, pending: 0, overdue: 0, misScore: 0 });
    totals.avgPunctuality = doers.length ? Math.round(doers.reduce((s, d) => s + d.punctuality, 0) / doers.length) : 0;

    return { doers, totals };
  },

  /** Per-doer deep profile for the MIS profile page. */
  async getDoerProfile(userId) {
    const uid = new mongoose.Types.ObjectId(String(userId));
    const now = new Date();
    const DONE = ['DONE', 'DELAYED'];
    const baseMatch = [
      { $match: { isDeleted: { $ne: true } } },
      { $unwind: '$steps' },
      { $match: { 'steps.assignedTo': uid } },
    ];

    const [summaryRows, byStepRows, monthlyRows, recentRows, user] = await Promise.all([
      O2DProcess.aggregate([...baseMatch, { $group: {
        _id: null,
        assigned:  { $sum: 1 },
        completed: { $sum: { $cond: [{ $in: ['$steps.status', DONE] }, 1, 0] } },
        pending:   { $sum: { $cond: [{ $eq: ['$steps.status', 'PENDING'] }, 1, 0] } },
        overdue:   { $sum: { $cond: [{ $and: [{ $eq: ['$steps.status', 'PENDING'] }, { $ne: ['$steps.planned', null] }, { $lt: ['$steps.planned', now] }] }, 1, 0] } },
        onTime:    { $sum: { $cond: [{ $and: [{ $in: ['$steps.status', DONE] }, { $eq: ['$steps.delayMins', 0] }] }, 1, 0] } },
        late:      { $sum: { $cond: [{ $and: [{ $in: ['$steps.status', DONE] }, { $gt: ['$steps.delayMins', 0] }] }, 1, 0] } },
        totalDelay:{ $sum: '$steps.delayMins' },
        checklistTotal: { $sum: { $size: { $ifNull: ['$steps.checklist', []] } } },
        checklistDone:  { $sum: { $size: { $filter: { input: { $ifNull: ['$steps.checklist', []] }, as: 'c', cond: '$$c.done' } } } },
      } }]),
      O2DProcess.aggregate([...baseMatch, { $group: {
        _id: '$steps.stepCode',
        assigned:  { $sum: 1 },
        completed: { $sum: { $cond: [{ $in: ['$steps.status', DONE] }, 1, 0] } },
        late:      { $sum: { $cond: [{ $and: [{ $in: ['$steps.status', DONE] }, { $gt: ['$steps.delayMins', 0] }] }, 1, 0] } },
        overdue:   { $sum: { $cond: [{ $and: [{ $eq: ['$steps.status', 'PENDING'] }, { $ne: ['$steps.planned', null] }, { $lt: ['$steps.planned', now] }] }, 1, 0] } },
        totalDelay:{ $sum: '$steps.delayMins' },
      } }, { $sort: { assigned: -1 } }]),
      O2DProcess.aggregate([...baseMatch,
        { $match: { 'steps.status': { $in: DONE }, 'steps.actual': { $ne: null } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$steps.actual' } },
          completed: { $sum: 1 },
          late:      { $sum: { $cond: [{ $gt: ['$steps.delayMins', 0] }, 1, 0] } },
          totalDelay:{ $sum: '$steps.delayMins' },
        } }, { $sort: { _id: 1 } }]),
      O2DProcess.aggregate([...baseMatch,
        { $project: {
          soNumber: 1, partyName: 1,
          stepCode: '$steps.stepCode', status: '$steps.status',
          planned: '$steps.planned', actual: '$steps.actual', delayMins: '$steps.delayMins',
          sortAt: { $ifNull: ['$steps.actual', '$steps.planned'] },
        } },
        { $sort: { sortAt: -1 } }, { $limit: 20 }]),
      User.findById(uid).select('name email role roles').lean(),
    ]);

    const defMap = await loadDefMap();
    const s = summaryRows[0] || {};
    return {
      doer: { userId: String(userId), name: user?.name || 'Unknown', email: user?.email || '', role: user?.role || (user?.roles || [])[0] || '' },
      summary: {
        assigned: s.assigned || 0, completed: s.completed || 0, pending: s.pending || 0, overdue: s.overdue || 0,
        onTime: s.onTime || 0, late: s.late || 0, totalDelayMins: s.totalDelay || 0,
        ...computeMis(s),
      },
      byStep: byStepRows.map((r) => ({ stepCode: r._id, name: defMap.get(r._id)?.name || r._id, assigned: r.assigned, completed: r.completed, late: r.late, overdue: r.overdue, avgDelayMins: r.completed ? Math.round(r.totalDelay / r.completed) : 0 })),
      monthly: monthlyRows.map((r) => ({ month: r._id, completed: r.completed, late: r.late, avgDelayMins: r.completed ? Math.round(r.totalDelay / r.completed) : 0 })),
      recent: recentRows.map((r) => ({ soNumber: r.soNumber, partyName: r.partyName, stepCode: r.stepCode, name: defMap.get(r.stepCode)?.name || r.stepCode, status: r.status, planned: r.planned, actual: r.actual, delayMins: r.delayMins || 0 })),
    };
  },

  /** Pending steps past their SLA that have not yet been escalated. For the email job. */
  async findOverdueSteps() {
    const now = new Date();
    const processes = await O2DProcess.find({
      isCompleted: false,
      isDeleted: { $ne: true },
      steps: { $elemMatch: { status: O2D_STEP_STATUS.PENDING, planned: { $ne: null, $lt: now }, escalatedAt: null } },
    }).populate('steps.assignedTo', 'name email').lean();

    const defMap = await loadDefMap();
    const breaches = [];
    for (const p of processes) {
      for (const s of p.steps) {
        if (s.status !== O2D_STEP_STATUS.PENDING || !s.planned || new Date(s.planned) >= now || s.escalatedAt) continue;
        breaches.push({
          processId: p._id, soNumber: p.soNumber, partyName: p.partyName,
          stepCode: s.stepCode, stepName: defMap.get(s.stepCode)?.name || s.stepCode,
          planned: s.planned, owner: s.assignedTo,
        });
      }
    }
    return breaches;
  },

  /** Stamp escalatedAt so the same breach isn't emailed twice. */
  async markEscalated(processId, stepCode) {
    await O2DProcess.updateOne(
      { _id: processId, 'steps.stepCode': stepCode },
      { $set: { 'steps.$.escalatedAt': new Date() } },
    );
  },

  // ── StepDefinition CRUD (config) ──────────────────────────────────────────

  async listDefinitions(fmsKey = DEFAULT_FMS_KEY) {
    return StepDefinition.find({ isDeleted: { $ne: true }, ...fmsScope(fmsKey) })
      .populate('defaultOwnerUserId', 'name email role')
      .sort({ sequence: 1 }).lean();
  },

  async createDefinition(data, actor) {
    const fmsKey = data.fmsKey || DEFAULT_FMS_KEY;
    const exists = await StepDefinition.findOne({ stepCode: data.stepCode, isDeleted: { $ne: true }, ...fmsScope(fmsKey) });
    if (exists) throw new AppError(`Step code '${data.stepCode}' already exists in this FMS`, 409);
    return StepDefinition.create({ ...data, fmsKey, createdBy: actor?._id });
  },

  async updateDefinition(id, data, actor) {
    const def = await StepDefinition.findById(id);
    if (!def) throw new AppError('Step definition not found', 404);
    Object.assign(def, data, { updatedBy: actor?._id });
    await def.save();
    return def.toObject();
  },

  async reorderDefinitions(orderList, actor) {
    // orderList = [{ id, sequence }]
    await Promise.all(orderList.map(({ id, sequence }) =>
      StepDefinition.updateOne({ _id: id }, { $set: { sequence, updatedBy: actor?._id } })));
    return this.listDefinitions();
  },

  async deactivateDefinition(id, actor) {
    const def = await StepDefinition.findByIdAndUpdate(
      id, { $set: { isActive: false, updatedBy: actor?._id } }, { new: true });
    if (!def) throw new AppError('Step definition not found', 404);
    return def.toObject();
  },

  // ── TaskTemplate CRUD (the reusable work plan) ────────────────────────────

  async listTemplates(fmsKey = DEFAULT_FMS_KEY) {
    return TaskTemplate.find({ isDeleted: { $ne: true }, ...fmsScope(fmsKey) })
      .populate('steps.assigneeUserId steps.buddyUserId', 'name email role')
      .sort({ isDefault: -1, name: 1 }).lean();
  },

  async getTemplate(id) {
    const tpl = await TaskTemplate.findById(id)
      .populate('steps.assigneeUserId steps.buddyUserId', 'name email role').lean();
    if (!tpl) throw new AppError('Template not found', 404);
    return tpl;
  },

  async createTemplate(data, actor) {
    const fmsKey = data.fmsKey || DEFAULT_FMS_KEY;
    // "Default" is a singleton PER FMS, so only unset others in the same catalog.
    if (data.isDefault) await TaskTemplate.updateMany({ isDefault: true, ...fmsScope(fmsKey) }, { $set: { isDefault: false } });
    return TaskTemplate.create({ ...data, fmsKey, createdBy: actor?._id });
  },

  async updateTemplate(id, data, actor) {
    const tpl = await TaskTemplate.findById(id);
    if (!tpl) throw new AppError('Template not found', 404);
    const fmsKey = tpl.fmsKey || DEFAULT_FMS_KEY;
    if (data.isDefault) await TaskTemplate.updateMany({ _id: { $ne: id }, isDefault: true, ...fmsScope(fmsKey) }, { $set: { isDefault: false } });
    Object.assign(tpl, data, { updatedBy: actor?._id });
    await tpl.save();
    return tpl.toObject();
  },

  async setDefaultTemplate(id) {
    const target = await TaskTemplate.findById(id).lean();
    if (!target) throw new AppError('Template not found', 404);
    const fmsKey = target.fmsKey || DEFAULT_FMS_KEY;
    await TaskTemplate.updateMany({ isDefault: true, ...fmsScope(fmsKey) }, { $set: { isDefault: false } });
    const tpl = await TaskTemplate.findByIdAndUpdate(id, { $set: { isDefault: true, isActive: true } }, { new: true });
    return tpl.toObject();
  },

  async deleteTemplate(id) {
    const tpl = await TaskTemplate.findByIdAndUpdate(id, { $set: { isDeleted: true, isDefault: false } }, { new: true });
    if (!tpl) throw new AppError('Template not found', 404);
    return { id };
  },
};

export default o2dFmsService;
